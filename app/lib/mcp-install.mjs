// Installation d'un serveur MCP du catalogue (catalog/mcp.json) chez les agents choisis.
// La page n'envoie qu'un identifiant du catalogue, des agents et des valeurs de variables :
// la commande est toujours construite ici, depuis le catalogue, avec une version exacte (jamais « latest »).
// Valeurs des variables : celles que l'utilisateur a saisies, sinon une référence ${NOM} dans la syntaxe de l'agent.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderRef } from './mcp-convert.mjs';
import { agentOf, mcpIdsFor, mcpState, mcpUpsert } from './mcp.mjs';
import { keyPathOf, readEntry } from './mcp-write.mjs';
import { writeMcpBackup } from './mcp-backups.mjs';
import { fail, homeOf } from './util.mjs';
import { freshCatalog } from './catalog-data.mjs';

const CATALOG = fileURLToPath(new URL('../../catalog/mcp.json', import.meta.url));
let catalogP = null;

// Catalogue MCP : celui de la branche catalog-data (mis à jour chaque jour, cache de 24 h), sinon la copie fournie,
// lue une fois. Rend { generatedAt, servers: [], source: 'online'|'cache'|'bundled' } même s'il manque.
export async function mcpCatalog(opts = {}) {
  if (opts.file) return JSON.parse(await fs.readFile(opts.file, 'utf8'));
  const fresh = opts.home ? await freshCatalog('mcp', { home: opts.home }) : null;
  if (fresh) return { ...fresh.value, source: fresh.source };
  if (!catalogP) catalogP = fs.readFile(CATALOG, 'utf8').then((t) => ({ ...JSON.parse(t), source: 'bundled' }), () => ({ generatedAt: null, servers: [], source: 'bundled' }));
  return catalogP;
}

const VAR_RE = /^[A-Za-z_][\w-]{0,127}$/;
const PKG_RE = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
const IMAGE_RE = /^[a-z0-9][\w.\-/:]*$/i;
const VERSION_RE = /^[\w.+-]{1,64}$/;

// Commande d'un serveur du catalogue, pour un agent (variables dans sa syntaxe). values : { NOM: valeur saisie }.
// Rend la forme commune d'add-mcp. Lève BAD_INPUT si l'entrée du catalogue est incohérente.
export function configFor(server, mcpId, values = {}) {
  const ins = server && server.install;
  if (!ins || typeof ins !== 'object') throw fail('BAD_INPUT', 'Entrée du catalogue incomplète.');
  const val = (v) => (Object.hasOwn(values, v.name) && typeof values[v.name] === 'string' && values[v.name] !== '' ? values[v.name] : renderRef(mcpId, v.name));
  if (ins.type === 'remote') {
    if (typeof ins.url !== 'string' || !/^https:\/\//.test(ins.url)) throw fail('BAD_INPUT', 'Adresse du serveur invalide.');
    const headers = {};
    for (const h of ins.headers || []) if (VAR_RE.test(h.name) && (h.required || Object.hasOwn(values, h.name))) headers[h.name] = val(h);
    return { type: ins.transport === 'sse' ? 'sse' : 'http', url: ins.url, ...(Object.keys(headers).length ? { headers } : {}) };
  }
  if (!VERSION_RE.test(String(ins.version || '')) || /^(latest|\*|x)$/i.test(ins.version)) throw fail('BAD_INPUT', 'Version du serveur absente ou non épinglée.');
  const env = {};
  for (const v of ins.env || []) if (VAR_RE.test(v.name) && (v.required || v.secret || Object.hasOwn(values, v.name))) env[v.name] = val(v);
  const extra = (Array.isArray(ins.args) ? ins.args : []).filter((a) => typeof a === 'string' && a.length <= 200);
  let command, args;
  if (ins.type === 'npm') {
    if (!PKG_RE.test(ins.id)) throw fail('BAD_INPUT', 'Nom de paquet invalide.');
    command = 'npx'; args = ['-y', ins.id + '@' + ins.version, ...extra];
  } else if (ins.type === 'pypi') {
    if (!PKG_RE.test(ins.id)) throw fail('BAD_INPUT', 'Nom de paquet invalide.');
    command = 'uvx'; args = [ins.id + '@' + ins.version, ...extra];
  } else if (ins.type === 'oci') {
    if (!IMAGE_RE.test(ins.id)) throw fail('BAD_INPUT', 'Nom d’image invalide.');
    const image = /:[\w.-]+$/.test(ins.id.split('/').pop()) ? ins.id : ins.id + ':' + ins.version;
    command = 'docker'; args = ['run', '-i', '--rm', ...Object.keys(env).flatMap((k) => ['-e', k]), image, ...extra];
  } else {
    throw fail('BAD_INPUT', 'Type de serveur inconnu.');
  }
  return { command, args, ...(Object.keys(env).length ? { env } : {}) };
}

// Nom du serveur dans les réglages des agents : dernière partie de l'identifiant du catalogue.
export function localName(server) {
  return String(server.id).split('/').pop().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'serveur';
}

// Installe un serveur du catalogue. opts = { id, agents: [agentId], scope, values: { NOM: valeur }, name?, replace?, force? }.
// Un serveur au contrôle « Motif à risque » ou à faille connue est retenu (held) sauf force.
// Rend { installed: [{ agent, mcpId }], skipped, failed, held: null|{ verdict, vulns }, backups, warnings, name }.
export async function installMcp(opts = {}) {
  const home = homeOf(opts);
  const cat = await mcpCatalog(opts.catalogFile ? { file: opts.catalogFile } : { home });
  const server = (cat.servers || []).find((s) => s.id === opts.id);
  if (!server) throw fail('NOT_FOUND', 'Serveur absent du catalogue.');
  const agents = Array.isArray(opts.agents) ? opts.agents.filter((a) => typeof a === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(a)) : [];
  if (!agents.length) throw fail('BAD_INPUT', 'Choisissez au moins un agent.');
  const values = {};
  for (const [k, v] of Object.entries(opts.values && typeof opts.values === 'object' ? opts.values : {})) {
    if (!VAR_RE.test(k) || typeof v !== 'string' || v.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw fail('BAD_INPUT', 'Valeur invalide pour ' + k.slice(0, 40) + '.');
    values[k] = v;
  }
  const vulns = Array.isArray(server.vulns) ? server.vulns : [];
  if ((server.verdict === 'rouge' || vulns.length) && !opts.force) return { installed: [], skipped: [], failed: [], held: { verdict: server.verdict || null, vulns }, backups: [], warnings: [], name: localName(server) };
  const name = typeof opts.name === 'string' && /^[\w.-]{1,64}$/.test(opts.name) ? opts.name : localName(server);
  const scope = opts.scope === 'project' ? 'project' : 'global';
  const st = await mcpState({ home, project: opts.project });
  const installed = [], skipped = [], failed = [], backups = [], warnings = new Set();
  const need = [...(server.install.env || []), ...(server.install.headers || [])].filter((v) => v.required || v.secret);
  const missing = need.filter((v) => !values[v.name]).map((v) => v.name);
  for (const agent of agents) {
    const ids = mcpIdsFor(agent, st.detectedMcp);
    if (!ids.length) { failed.push({ agent, message: 'Skill Advisor ne sait pas écrire les réglages MCP de cet agent.' }); continue; }
    for (const mcpId of ids) {
      try {
        const config = configFor(server, mcpId, values);
        // Serveur du même nom déjà chez cet agent (dans ce fichier, pas une copie désactivée).
        const row = st.servers.find((s) => s.name === name && s.scope === scope);
        const e = row && (row.ag[agentOf(mcpId)] || []).find((x) => x.mcpId === mcpId && !x.stash);
        const present = e ? await readEntry(e.path, e.format, keyPathOf(e.key), name).catch(() => undefined) : undefined;
        if (present !== undefined && !opts.replace) { skipped.push({ agent, mcpId, reason: 'Un serveur de ce nom existe déjà chez cet agent.' }); continue; }
        if (present !== undefined) backups.push(await writeMcpBackup({ home, origin: 'replace', items: [{ name, scope, places: [{ agent, mcpId, off: false, entry: present }] }] }));
        const w = await mcpUpsert({ home, project: opts.project, mcpId, name, config, scope, replace: present !== undefined });
        if (w.lossy) warnings.add('Les commentaires des réglages de ' + agent + ' n’ont pas pu être gardés : le fichier a été réécrit.');
        installed.push({ agent, mcpId });
      } catch (e) { failed.push({ agent, mcpId, message: e.code && e.code !== 'CLI_FAILED' ? e.message : 'Écriture impossible.' }); }
    }
  }
  if (missing.length && installed.length) warnings.add('Variables à définir avant le premier lancement : ' + missing.join(', ') + '. Elles sont écrites comme références (${NOM}) dans les réglages.');
  return { installed, skipped, failed, held: null, backups, warnings: [...warnings], name };
}
