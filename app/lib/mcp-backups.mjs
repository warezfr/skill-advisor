// Sauvegardes de serveurs MCP : ~/.skill-advisor/backups/<id>/ avec meta.json (kind: "mcp") et servers.json (0600).
// Par défaut, chaque valeur secrète est remplacée par une référence de variable dans la syntaxe de l'agent
// (mcp-convert.mjs : scrub) ; « Inclure les valeurs secrètes » les garde telles quelles.
// Restaurer : chaque entrée revient chez son agent, telle quelle. Appliquer : convertie pour d'autres agents (add-mcp).
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkId, reserveDir } from './backups.mjs';
import { scrub, toCanonical } from './mcp-convert.mjs';
import { MCP_KIND, mcpLabel, normalizeMcpMeta, pubMcp, validServerName } from './mcp-meta.mjs';
import { agentOf, checkServerName, mcpIdsFor, mcpPaths, mcpRemove, mcpState, mcpUpsert, stashFile } from './mcp.mjs';
import { keyPathOf, readEntry, writeEntry } from './mcp-write.mjs';
import { AGENT_RE, backupsDir, fail, homeOf, readJson, rmOpts, safeJoin, writeJsonAtomic, writePrivate } from './util.mjs';

const MCP_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// Lit une sauvegarde MCP : meta vérifié et entrées. Lève NOT_FOUND ou BAD_NAME.
export async function loadMcpBackup(home, id) {
  checkId(id);
  const dir = safeJoin(backupsDir(home), id);
  const meta = normalizeMcpMeta(await readJson(path.join(dir, 'meta.json'), null), id);
  if (!meta) throw fail('NOT_FOUND', 'Sauvegarde introuvable.');
  const data = await readJson(path.join(dir, 'servers.json'), null);
  const items = [];
  for (const it of (isObj(data) && Array.isArray(data.items)) ? data.items : []) {
    if (!isObj(it) || !validServerName(it.name) || !Array.isArray(it.places)) continue;
    const places = it.places.filter((p) => isObj(p) && typeof p.agent === 'string' && AGENT_RE.test(p.agent) && MCP_ID_RE.test(p.mcpId || '') && isObj(p.entry))
      .map((p) => ({ agent: p.agent, mcpId: p.mcpId, off: !!p.off, entry: p.entry }));
    if (places.length) items.push({ name: it.name, scope: it.scope === 'project' ? 'project' : 'global', places });
  }
  if (!items.length) throw fail('BAD_NAME', 'Sauvegarde incohérente.');
  return { dir, meta, items };
}

// Écrit une sauvegarde. items : [{ name, scope, places: [{ agent, mcpId, off, entry }] }] (entrées brutes).
export async function writeMcpBackup(opts) {
  const home = homeOf(opts);
  const keep = !!opts.secrets;
  const items = opts.items.map((it) => {
    const vars = new Set();
    const places = it.places.map((p) => {
      if (keep) return { ...p };
      const s = scrub(p.entry, p.mcpId);
      s.vars.forEach((v) => vars.add(v));
      return { ...p, entry: s.entry };
    });
    return { name: it.name, scope: it.scope, places, vars: [...vars].sort() };
  });
  if (!items.length) throw fail('BAD_INPUT', 'Aucun serveur à sauvegarder.');
  const first = items[0].name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 40) || 'serveur';
  const { id, dir } = await reserveDir(home, 'mcp-' + first);
  try {
    const servers = JSON.stringify({ version: 1, items: items.map((i) => ({ name: i.name, scope: i.scope, places: i.places })) }, null, 2) + '\n';
    await writePrivate(path.join(dir, 'servers.json'), servers);
    const meta = {
      version: 2, kind: MCP_KIND, id, label: (typeof opts.label === 'string' && opts.label.trim()) || mcpLabel(items.map((i) => i.name)),
      note: opts.note || '', origin: opts.origin || 'manual', at: new Date().toISOString(), size: Buffer.byteLength(servers),
      items: items.map((i) => ({ name: i.name, scope: i.scope, agents: [...new Set(i.places.map((p) => p.agent))], secrets: keep ? 'kept' : 'vars', vars: i.vars })),
    };
    await writeJsonAtomic(path.join(dir, 'meta.json'), meta);
    return pubMcp(normalizeMcpMeta(meta, id));
  } catch (e) {
    await fs.rm(dir, rmOpts()).catch(() => {});
    throw fail('BACKUP_FAILED', 'La sauvegarde des serveurs MCP a échoué.', { detail: String(e.message || e) });
  }
}

// Entrées brutes d'un serveur, chez tous ses agents (fichiers et copies désactivées).
async function rawPlaces(home, project, name, scope) {
  const st = await mcpState({ home, project });
  const row = st.servers.find((s) => s.name === name && s.scope === scope);
  if (!row) return null;
  const places = [];
  for (const [agent, entries] of Object.entries(row.ag)) {
    for (const e of entries) {
      let entry;
      if (e.stash) {
        const d = await readStashOf(home, project, e.mcpId, scope, name);
        entry = d && d.entry;
      } else entry = await readEntry(e.path, e.format, keyPathOf(e.key), name).catch(() => undefined);
      if (isObj(entry)) places.push({ agent, mcpId: e.mcpId, off: !!e.stash, entry });
    }
  }
  return places;
}

const readStashOf = (home, project, mcpId, scope, name) => readJson(stashFile(home, mcpId, scope, project, name), null);

// Sauvegarde à la demande : servers = [{ name, scope }]. Rend { backup, failed: [{ name, scope, message }] }.
export async function createMcpBackup(opts = {}) {
  const home = homeOf(opts);
  const list = Array.isArray(opts.servers) ? opts.servers : [];
  if (!list.length || list.length > 200) throw fail('BAD_INPUT', 'Choisissez de 1 à 200 serveurs MCP.');
  const items = [], failed = [];
  for (const s of list) {
    const name = checkServerName(s && s.name);
    const scope = s.scope === 'project' ? 'project' : 'global';
    if (scope === 'project' && !opts.project) { failed.push({ name, scope, message: 'Aucun projet ouvert.' }); continue; }
    const places = await rawPlaces(home, opts.project, name, scope);
    if (!places || !places.length) { failed.push({ name, scope, message: 'Serveur introuvable.' }); continue; }
    items.push({ name, scope, places });
  }
  if (!items.length) return { backup: null, failed };
  const backup = await writeMcpBackup({ home, items, secrets: !!opts.secrets, label: opts.label, note: opts.note, origin: 'manual' });
  return { backup, failed };
}

// Retire un serveur, avec sauvegarde au choix (faite avant toute écriture).
export async function removeMcp(opts = {}) {
  const home = homeOf(opts);
  const r = await mcpRemove({
    ...opts, home,
    keep: opts.backup ? async (t) => writeMcpBackup({ home, secrets: !!opts.secrets, origin: 'remove',
      items: [{ name: t.name, scope: t.scope, places: t.items.map((i) => ({ agent: i.agent, mcpId: i.mcpId, off: i.off, entry: i.entry })) }] }) : null,
  });
  return { removed: r.done, failed: r.failed, backups: r.backup ? [r.backup] : [] };
}

// Fichier de réglages d'un agent add-mcp pour une portée (chemins de l'enregistrement, jamais ceux de la sauvegarde).
async function fileFor(home, project, mcpId, scope) {
  const p = (await mcpPaths({ home, cwd: project || home })).find((x) => x.id === mcpId);
  if (!p) return null;
  const file = scope === 'project' ? p.local : p.global;
  return file ? { file, format: p.format, key: scope === 'project' ? p.localKey : p.key } : null;
}

// Restaure : chaque entrée revient chez son agent d'origine, telle quelle ; une entrée désactivée revient désactivée.
// conflict : skip (défaut) ou replace (la version présente est d'abord sauvegardée).
export async function restoreMcpBackup(opts = {}) {
  const home = homeOf(opts);
  const { items, meta } = await loadMcpBackup(home, opts.id);
  const replace = opts.conflict === 'replace';
  const applied = [], skipped = [], failed = [], backups = [], warnings = [];
  for (const it of items) {
    if (it.scope === 'project' && !opts.project) { skipped.push({ name: it.name, agent: null, reason: 'Ouvrez le projet de ce serveur pour le restaurer.' }); continue; }
    for (const p of it.places) {
      try {
        const f = await fileFor(home, opts.project, p.mcpId, it.scope);
        if (!f) throw fail('UNSUPPORTED', 'Cet agent n’a pas de réglages MCP pour cette portée.');
        if (p.off) {
          const sp = stashFile(home, p.mcpId, it.scope, opts.project, it.name);
          if (await fs.stat(sp).then(() => true, () => false)) { skipped.push({ name: it.name, agent: p.agent, reason: 'Déjà désactivé chez cet agent.' }); continue; }
          await writePrivate(sp, JSON.stringify({ v: 1, name: it.name, mcpId: p.mcpId, scope: it.scope, project: it.scope === 'project' ? opts.project : null,
            path: f.file, key: f.key, format: f.format, entry: p.entry, at: new Date().toISOString() }) + '\n');
          applied.push({ name: it.name, agent: p.agent, off: true });
          continue;
        }
        const present = await readEntry(f.file, f.format, keyPathOf(f.key), it.name);
        if (present !== undefined && !replace) { skipped.push({ name: it.name, agent: p.agent, reason: 'Un serveur de ce nom existe déjà chez cet agent.' }); continue; }
        if (present !== undefined) backups.push(await writeMcpBackup({ home, origin: 'replace', items: [{ name: it.name, scope: it.scope, places: [{ agent: p.agent, mcpId: p.mcpId, off: false, entry: present }] }] }));
        await writeEntry({ home, file: f.file, format: f.format, keyPath: keyPathOf(f.key), name: it.name, value: p.entry, replace: present !== undefined });
        applied.push({ name: it.name, agent: p.agent });
      } catch (e) { failed.push({ name: it.name, agent: p.agent, message: e.code ? e.message : 'Écriture impossible.' }); }
    }
  }
  const vars = [...new Set(meta.items.filter((i) => i.secrets === 'vars').flatMap((i) => i.vars))];
  if (vars.length && applied.length) warnings.push('Valeurs secrètes remplacées par des variables : définissez ' + vars.join(', ') + ' dans votre environnement, ou dans les réglages de l’agent.');
  return { applied, skipped, failed, backups, warnings };
}

// Applique une sauvegarde à d'autres agents : chaque serveur est converti pour l'agent visé (add-mcp).
// opts = { id, names?: [name], agents: [agentId], conflict: skip|replace }.
export async function applyMcpBackup(opts = {}) {
  const home = homeOf(opts);
  const { items, meta } = await loadMcpBackup(home, opts.id);
  const want = Array.isArray(opts.names) && opts.names.length ? new Set(opts.names) : null;
  const agents = Array.isArray(opts.agents) ? opts.agents.filter((a) => typeof a === 'string' && AGENT_RE.test(a)) : [];
  if (!agents.length) throw fail('BAD_INPUT', 'Choisissez au moins un agent.');
  const replace = opts.conflict === 'replace';
  const st = await mcpState({ home, project: opts.project });
  const applied = [], skipped = [], failed = [], backups = [], warnings = new Set();
  for (const it of items) {
    if (want && !want.has(it.name)) continue;
    if (it.scope === 'project' && !opts.project) { skipped.push({ name: it.name, agent: null, reason: 'Ouvrez un projet pour y poser ce serveur.' }); continue; }
    const src = it.places.find((p) => !p.off) || it.places[0];
    for (const agent of agents) {
      const ids = mcpIdsFor(agent, st.detectedMcp);
      if (!ids.length) { failed.push({ name: it.name, agent, message: 'Skill Advisor ne sait pas écrire les réglages MCP de cet agent.' }); continue; }
      for (const mcpId of ids) {
        const conv = toCanonical(src.entry, mcpId);
        conv.warnings.forEach((w) => warnings.add(w));
        if (!conv.config) { failed.push({ name: it.name, agent, message: conv.warnings[0] }); continue; }
        try {
          let present;
          const f = await fileFor(home, opts.project, mcpId, it.scope);
          if (f) present = await readEntry(f.file, f.format, keyPathOf(f.key), it.name).catch(() => undefined);
          if (present !== undefined && !replace) { skipped.push({ name: it.name, agent, reason: 'Un serveur de ce nom existe déjà chez cet agent.' }); continue; }
          if (present !== undefined) backups.push(await writeMcpBackup({ home, origin: 'replace', items: [{ name: it.name, scope: it.scope, places: [{ agent, mcpId, off: false, entry: present }] }] }));
          const r = await mcpUpsert({ home, project: opts.project, mcpId, name: it.name, config: conv.config, scope: it.scope, replace: present !== undefined });
          if (r.lossy) warnings.add('Les commentaires de ' + path.basename(r.path) + ' (' + agentOf(mcpId) + ') n’ont pas pu être gardés : le fichier a été réécrit.');
          applied.push({ name: it.name, agent });
        } catch (e) { failed.push({ name: it.name, agent, message: e.code && e.code !== 'CLI_FAILED' ? e.message : 'Écriture impossible.' }); }
      }
    }
  }
  const vars = [...new Set(meta.items.filter((i) => i.secrets === 'vars' && (!want || want.has(i.name))).flatMap((i) => i.vars))];
  if (vars.length && applied.length) warnings.add('Valeurs secrètes remplacées par des variables : définissez ' + vars.join(', ') + ' dans votre environnement, ou dans les réglages de l’agent.');
  return { applied, skipped, failed, backups, warnings: [...warnings] };
}

// Import d'une archive déjà extraite et contrôlée (archive.mjs) : servers.json vérifié, nouvel identifiant.
// L'état des secrets (variables ou valeurs gardées) est repris du manifeste. Rend { backup, warnings }.
export async function importMcpFrom(home, root, m) {
  const bad = (msg) => fail('BAD_ARCHIVE', msg);
  const file = path.join(root, 'servers.json');
  const st = await fs.stat(file).catch(() => null);
  if (!st || !st.isFile() || st.size > 4 * 1024 * 1024) throw bad('Archive refusée : servers.json absent ou trop gros.');
  let data;
  try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw bad('Archive refusée : servers.json illisible.'); }
  const marks = new Map((Array.isArray(m.items) ? m.items : []).filter(isObj).map((i) => [(i.scope === 'project' ? 'project' : 'global') + '\u0000' + i.name, i]));
  const items = [], warnings = [];
  for (const it of (isObj(data) && Array.isArray(data.items)) ? data.items.slice(0, 200) : []) {
    if (!isObj(it) || !validServerName(it.name) || !Array.isArray(it.places)) throw bad('Archive refusée : serveur invalide.');
    const scope = it.scope === 'project' ? 'project' : 'global';
    const places = it.places.slice(0, 100).map((p) => {
      if (!isObj(p) || typeof p.agent !== 'string' || !AGENT_RE.test(p.agent) || !MCP_ID_RE.test(p.mcpId || '') || !isObj(p.entry)) throw bad('Archive refusée : emplacement invalide pour ' + it.name + '.');
      return { agent: p.agent, mcpId: p.mcpId, off: !!p.off, entry: p.entry };
    });
    if (!places.length) throw bad('Archive refusée : serveur sans emplacement.');
    const mk = marks.get(scope + '\u0000' + it.name) || {};
    items.push({ name: it.name, scope, places, secrets: mk.secrets === 'kept' ? 'kept' : 'vars', vars: Array.isArray(mk.vars) ? mk.vars : [] });
    const e = places[0].entry;
    const what = typeof e.command === 'string' ? [e.command, ...(Array.isArray(e.args) ? e.args : [])].join(' ') : (e.url || e.httpUrl || e.serverUrl || e.uri || '');
    warnings.push('Le serveur ' + it.name + ' lance : ' + String(what).slice(0, 160) + '. Ne l’appliquez que si vous lui faites confiance.');
  }
  if (!items.length) throw bad('Archive refusée : aucun serveur.');
  const first = items[0].name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 40) || 'serveur';
  const { id, dir } = await reserveDir(home, 'mcp-' + first);
  try {
    const servers = JSON.stringify({ version: 1, items: items.map((i) => ({ name: i.name, scope: i.scope, places: i.places })) }, null, 2) + '\n';
    await writePrivate(path.join(dir, 'servers.json'), servers);
    const meta = {
      version: 2, kind: MCP_KIND, id, label: typeof m.label === 'string' ? m.label.slice(0, 80) : '', note: typeof m.note === 'string' ? m.note.slice(0, 500) : '',
      origin: 'import', at: new Date().toISOString(), size: Buffer.byteLength(servers),
      items: items.map((i) => ({ name: i.name, scope: i.scope, agents: [...new Set(i.places.map((p) => p.agent))], secrets: i.secrets, vars: i.vars })),
    };
    await writeJsonAtomic(path.join(dir, 'meta.json'), meta);
    return { backup: pubMcp(normalizeMcpMeta(meta, id)), warnings };
  } catch (e) {
    await fs.rm(dir, rmOpts()).catch(() => {});
    throw e;
  }
}
