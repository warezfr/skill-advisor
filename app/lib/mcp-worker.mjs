// Processus enfant : importe add-mcp avec HOME déjà fixé par le parent (add-mcp lit homedir() à l'import).
// Même protocole que skills-worker.mjs : une requête { fn, args } par ligne, une réponse JSON par ligne.
// Les entrées de serveurs sortent masquées (mcp-mask.mjs) : aucune valeur secrète ne quitte ce processus.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import * as jsonc from 'jsonc-parser';
import TOML from '@iarna/toml';
import YAML from 'yaml';
import { describe, maskIdentity } from './mcp-mask.mjs';
import { parseStrict } from './mcp-write.mjs';

// Clé d'OpenCode : mcp.servers (V2) ou mcp (V1), comme resolveOpenCodeUpsertKey d'add-mcp 2.6.1.
const looksLikeServer = (v) => !!v && typeof v === 'object' && ('type' in v || 'command' in v || 'url' in v);
function openCodeKey(doc, name) {
  const mcp = doc && typeof doc.mcp === 'object' && doc.mcp && !Array.isArray(doc.mcp) ? doc.mcp : null;
  if (!mcp) return 'mcp';
  const native = mcp.servers && typeof mcp.servers === 'object' && !Array.isArray(mcp.servers) && !looksLikeServer(mcp.servers) ? mcp.servers : null;
  const legacy = Object.keys(mcp).filter((k) => !(k === 'servers' && native) && k !== 'timeout');
  if (native && Object.hasOwn(native, name)) return 'mcp.servers';
  if (legacy.includes(name)) return 'mcp';
  return native && !legacy.length ? 'mcp.servers' : 'mcp';
}

const out = process.stdout.write.bind(process.stdout);
console.log = console.info = console.warn = console.debug = (...a) => process.stderr.write(a.join(' ') + '\n');
process.on('SIGTERM', () => process.exit(143));

// Lecture stricte d'un fichier de réglages : add-mcp lit un JSON cassé sans erreur (analyseur tolérant).
// Rend 'missing', 'ok' ou 'broken' ; un fichier 'broken' ne recevra jamais d'écriture.
function strictCheck(file, format) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? 'missing' : 'broken'; }
  if (!text.trim()) return 'ok';
  try {
    if (format === 'toml') TOML.parse(text);
    else if (format === 'yaml' || format === 'yaml-1.1') {
      const docs = YAML.parseAllDocuments(text, { version: format === 'yaml-1.1' ? '1.1' : '1.2' });
      if (docs.some((d) => d.errors.length)) return 'broken';
    } else {
      const errors = [];
      const v = jsonc.parse(text, errors, { allowTrailingComma: true, disallowComments: false });
      if (errors.length || v === undefined || v === null || typeof v !== 'object' || Array.isArray(v)) return 'broken';
    }
    return 'ok';
  } catch { return 'broken'; }
}

let a = null;
const fns = {
  // Chemins de réglages de chaque agent, global et projet : sert au parent et aux tests d'isolement.
  paths: async (o = {}) => {
    const types = a.getAgentTypes();
    const [g, l] = await Promise.all([
      a.listInstalledServers({ global: true, agents: types }),
      a.listInstalledServers({ global: false, agents: types, cwd: o.cwd || process.cwd() }),
    ]);
    const local = new Map(l.map((x) => [x.agentType, x.configPath]));
    return types.map((t) => {
      const ag = a.agents[t];
      const gl = g.find((x) => x.agentType === t);
      return {
        id: t, name: ag.displayName, format: ag.format, key: ag.configKey, localKey: ag.localConfigKey || ag.configKey,
        transports: ag.supportedTransports, global: (gl && gl.configPath) || ag.configPath,
        local: ag.localConfigPath ? local.get(t) || null : null,
      };
    });
  },
  // Prépare la pose d'un serveur chez un agent : fichier, format, clé et entrée native (transformConfig d'add-mcp).
  // L'écriture est faite par le parent (mcp-write.mjs), qui garde les commentaires du fichier ; add-mcp, lui, réécrit
  // tout le fichier TOML ou YAML. Cas repris d'add-mcp : clé d'OpenCode (mcp ou mcp.servers), dossier .github/mcp.json
  // de Claude Code en projet, droits 0600 de fx. o = { mcpId, name, config (McpServerConfig), local, cwd }.
  prepare: async (o = {}) => {
    const ag = a.agents[o.mcpId];
    if (!ag) throw Object.assign(new Error('Agent MCP inconnu.'), { code: 'BAD_INPUT' });
    const local = !!o.local;
    if (local && !ag.localConfigPath) throw Object.assign(new Error(ag.displayName + ' n’a pas de réglages MCP de projet.'), { code: 'UNSUPPORTED' });
    const transport = o.config && o.config.url ? (o.config.type === 'sse' ? 'sse' : 'http') : 'stdio';
    if (!ag.supportedTransports.includes(transport)) {
      throw Object.assign(new Error(ag.displayName + ' ne sait pas lancer ce type de serveur (' + (transport === 'stdio' ? 'local' : transport.toUpperCase()) + ').'), { code: 'UNSUPPORTED' });
    }
    if (local && o.mcpId === 'claude-code' && !fs.existsSync(path.join(o.cwd, '.mcp.json')) && fs.existsSync(path.join(o.cwd, '.github', 'mcp.json'))) {
      throw Object.assign(new Error('Ce projet range ses serveurs dans .github/mcp.json : regroupez-les d’abord dans .mcp.json.'), { code: 'UNSUPPORTED' });
    }
    const [list] = await a.listInstalledServers({ global: !local, agents: [o.mcpId], cwd: o.cwd });
    const file = list.configPath;
    let key = local ? ag.localConfigKey || ag.configKey : ag.configKey;
    if (o.mcpId === 'opencode') {
      let doc = {};
      try { doc = parseStrict('json', fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'BROKEN_CONFIG') throw e; }
      key = openCodeKey(doc, o.name);
    }
    const entry = ag.transformConfig(o.name, o.config, { local, configKey: key });
    return { file, format: ag.format, key, entry, mode: o.mcpId === 'fx' ? 0o600 : null };
  },
  // Inventaire : agents détectés et leurs serveurs, global et (si un projet est donné) projet. Rien n'est écrit.
  inventory: async (o = {}) => {
    const detected = await a.detectGlobalAgents();
    const lists = [await a.listInstalledServers({ global: true })];
    if (o.project) lists.push(await a.listInstalledServers({ global: false, cwd: o.project }));
    const agents = [];
    for (const list of lists) {
      for (const x of list) {
        agents.push({
          id: x.agentType, name: x.displayName, scope: x.scope === 'local' ? 'project' : 'global', path: x.configPath,
          format: a.agents[x.agentType].format,
          error: x.error || strictCheck(x.configPath, a.agents[x.agentType].format) === 'broken'
            ? 'Fichier de réglages mal formé : Skill Advisor le lit sans y écrire.' : null,
          servers: x.servers.map((s) => ({ name: String(s.serverName), identity: maskIdentity(s.identity), key: s.configKey, ...describe(s.config) })),
        });
      }
    }
    return { detected, agents };
  },
};

const send = (obj) => new Promise((resolve) => out(JSON.stringify(obj) + '\n', resolve));
// Une erreur d'add-mcp peut citer un morceau du fichier lu : seuls le code et une ligne courte partent.
const brief = (e) => ({ code: (e && e.code) || 'CLI_FAILED', message: String((e && e.message) || e).split('\n')[0].slice(0, 300) });

async function main() {
  a = await import('add-mcp');
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let req;
    try { req = JSON.parse(line); } catch { await send({ ok: false, error: { code: 'CLI_FAILED', message: 'Requête illisible.' } }); continue; }
    const { fn, args = [] } = req;
    try {
      if (!Object.hasOwn(fns, fn)) throw Object.assign(new Error('Fonction inconnue : ' + fn), { code: 'CLI_FAILED' });
      const result = await fns[fn](...args);
      await send({ ok: true, result: result === undefined ? null : result });
    } catch (e) {
      await send({ ok: false, error: brief(e) });
    }
  }
}

main().then(() => process.exit(0), async (e) => { await send({ ok: false, error: brief(e) }); process.exit(0); });
