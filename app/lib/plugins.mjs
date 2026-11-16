// Plugins des agents : inventaire en lecture seule, depuis les fichiers que chaque agent tient sur le disque.
//   - Claude Code : ~/.claude/plugins/installed_plugins.json (version 2), état dans enabledPlugins de ~/.claude/settings.json
//     et des réglages du projet (.claude/settings.json, .claude/settings.local.json) ;
//   - Codex : ~/.codex/plugins/cache/<place>/<plugin>/<version>/, état dans [plugins."nom@place"] de ~/.codex/config.toml ;
//   - Gemini CLI : ~/.gemini/extensions/<nom>/gemini-extension.json, état dans extension-enablement.json ;
//   - Copilot CLI : ~/.copilot/installed-plugins/<place>/<plugin>/ et _direct/<id>/ (état non documenté) ;
//   - Antigravity : ~/.gemini/config/plugins/<nom>/ (état non documenté).
// Pour chaque plugin : version, portée, état, et ce qu'il apporte (skills, commandes, sous-agents, hooks, serveurs MCP).
// Les hooks lancent des commandes sans qu'on les appelle : ils sont nommés. Aucun chemin hors du dossier personnel n'est lu.
import fs from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';
import * as jsonc from 'jsonc-parser';
import { homeOf, within } from './util.mjs';

export const PLUGIN_AGENTS = {
  'claude-code': 'Claude Code', codex: 'Codex', 'gemini-cli': 'Gemini CLI', 'github-copilot': 'GitHub Copilot CLI', antigravity: 'Antigravity',
};

async function readText(p) { try { return await fs.readFile(p, 'utf8'); } catch { return null; } }
async function readJsonc(p) {
  const t = await readText(p);
  if (t === null) return null;
  const errors = [];
  const v = jsonc.parse(t, errors, { allowTrailingComma: true });
  return errors.length || !v || typeof v !== 'object' ? undefined : v;
}
async function dirs(p) { try { return (await fs.readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } }
async function files(p, re) { try { return (await fs.readdir(p, { withFileTypes: true })).filter((e) => e.isFile() && re.test(e.name)).map((e) => e.name); } catch { return []; } }
async function isFile(p) { try { return (await fs.stat(p)).isFile(); } catch { return false; } }

// Chemin lu seulement s'il reste dans le dossier personnel (un fichier de réglages peut citer n'importe quel chemin).
async function inside(home, p) {
  if (typeof p !== 'string' || !p) return null;
  const abs = path.resolve(home, p);
  let real = abs;
  try { real = await fs.realpath(abs); } catch { return null; }
  let h = home;
  try { h = await fs.realpath(home); } catch { /* garde home */ }
  return within(real, h) ? real : null;
}

// Ce qu'un plugin apporte, lu dans son dossier : manifeste, skills, commandes, sous-agents, hooks, serveurs MCP.
export async function contents(dir) {
  const m = (await readJsonc(path.join(dir, '.claude-plugin', 'plugin.json'))) || (await readJsonc(path.join(dir, '.antigravity-plugin', 'plugin.json')))
    || (await readJsonc(path.join(dir, 'plugin.json'))) || (await readJsonc(path.join(dir, 'gemini-extension.json'))) || {};
  const list = (v, def) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [def]).filter((x) => typeof x === 'string' && !path.isAbsolute(x) && !x.split(/[\\/]/).includes('..'));
  let skills = 0;
  for (const rel of list(m.skills, 'skills')) {
    for (const d of await dirs(path.join(dir, rel))) if (await isFile(path.join(dir, rel, d, 'SKILL.md'))) skills++;
  }
  let commands = 0;
  for (const rel of list(m.commands, 'commands')) commands += (await files(path.join(dir, rel), /\.(md|toml)$/i)).length;
  let agents = 0;
  for (const rel of list(m.agents, 'agents')) agents += (await files(path.join(dir, rel), /\.md$/i)).length;
  const hooksFile = m.hooks && typeof m.hooks === 'object' ? m.hooks : (await readJsonc(path.join(dir, typeof m.hooks === 'string' ? m.hooks : path.join('hooks', 'hooks.json')))) || (await readJsonc(path.join(dir, 'hooks.json')));
  const hookMap = hooksFile && typeof hooksFile === 'object' ? (hooksFile.hooks && typeof hooksFile.hooks === 'object' ? hooksFile.hooks : hooksFile) : {};
  const hooks = Object.keys(hookMap).filter((k) => /^[A-Z][A-Za-z]+$/.test(k)).sort();
  let mcp = [];
  if (m.mcpServers && typeof m.mcpServers === 'object') mcp = Object.keys(m.mcpServers);
  else {
    const f = (await readJsonc(path.join(dir, typeof m.mcpServers === 'string' ? m.mcpServers : '.mcp.json'))) || (await readJsonc(path.join(dir, 'mcp_config.json'))) || (await readJsonc(path.join(dir, 'mcp.json')));
    if (f && typeof f === 'object') mcp = Object.keys(f.mcpServers && typeof f.mcpServers === 'object' ? f.mcpServers : f);
  }
  const author = m.author && typeof m.author === 'object' ? m.author.name : typeof m.author === 'string' ? m.author : null;
  return {
    title: typeof m.name === 'string' ? m.name.slice(0, 80) : null, description: typeof m.description === 'string' ? m.description.slice(0, 300) : null,
    version: typeof m.version === 'string' ? m.version.slice(0, 40) : null, author: author ? String(author).slice(0, 80) : null,
    homepage: typeof m.homepage === 'string' && /^https:\/\//.test(m.homepage) ? m.homepage : null,
    skills, commands, agents, hooks, mcp: mcp.filter((k) => typeof k === 'string').slice(0, 50),
  };
}

// --- Lecteurs par agent : rendent [{ id, name, scope, project, version, path, on }] ---

async function claudeCode(home, project) {
  const reg = await readJsonc(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  if (reg === null) return { found: false, list: [] };
  if (reg === undefined || typeof reg.plugins !== 'object') return { found: true, error: true, list: [] };
  const enabled = {};
  const merge = (s) => { if (s && s.enabledPlugins && typeof s.enabledPlugins === 'object') Object.assign(enabled, s.enabledPlugins); };
  merge(await readJsonc(path.join(home, '.claude', 'settings.json')));
  if (project) {
    merge(await readJsonc(path.join(project, '.claude', 'settings.json')));
    merge(await readJsonc(path.join(project, '.claude', 'settings.local.json')));
  }
  const list = [];
  for (const [id, entries] of Object.entries(reg.plugins)) {
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || typeof e !== 'object') continue;
      const scope = e.scope === 'project' || e.scope === 'local' ? 'project' : 'global';
      const pp = typeof e.projectPath === 'string' ? e.projectPath : null;
      list.push({ id, name: id.split('@')[0], scope, project: pp, other: scope === 'project' && (!project || !pp || path.resolve(pp) !== path.resolve(project)),
        version: typeof e.version === 'string' ? e.version : null, path: await inside(home, e.installPath), on: enabled[id] === undefined ? null : enabled[id] === true });
    }
  }
  return { found: true, list };
}

async function codex(home) {
  const t = await readText(path.join(home, '.codex', 'config.toml'));
  let conf = {};
  if (t !== null) { try { conf = TOML.parse(t); } catch { return { found: true, error: true, list: [] }; } }
  const table = conf.plugins && typeof conf.plugins === 'object' ? conf.plugins : {};
  const cache = path.join(home, '.codex', 'plugins', 'cache');
  const list = [], seen = new Set();
  for (const market of await dirs(cache)) {
    for (const plugin of await dirs(path.join(cache, market))) {
      const versions = (await dirs(path.join(cache, market, plugin))).sort();
      const v = versions[versions.length - 1];
      const id = plugin + '@' + market;
      seen.add(id);
      const st = table[id] && typeof table[id] === 'object' ? table[id].enabled : undefined;
      list.push({ id, name: plugin, scope: 'global', project: null, version: v || null, path: v ? await inside(home, path.join(cache, market, plugin, v)) : null, on: st === undefined ? null : st === true });
    }
  }
  for (const [id, v] of Object.entries(table)) {
    if (id === '_default' || seen.has(id) || !v || typeof v !== 'object') continue;
    list.push({ id, name: id.split('@')[0], scope: 'global', project: null, version: null, path: null, on: v.enabled === undefined ? null : v.enabled === true });
  }
  return { found: t !== null || list.length > 0, list };
}

async function gemini(home) {
  const root = path.join(home, '.gemini', 'extensions');
  const names = await dirs(root);
  if (!names.length) return { found: false, list: [] };
  const en = (await readJsonc(path.join(root, 'extension-enablement.json'))) || {};
  const list = [];
  for (const n of names) {
    const rules = en[n] && Array.isArray(en[n].overrides) ? en[n].overrides : [];
    // Dernière règle : « ! » au début désactive.
    const last = rules.length ? String(rules[rules.length - 1]) : null;
    const man = await readJsonc(path.join(root, n, 'gemini-extension.json'));
    list.push({ id: n, name: n, scope: 'global', project: null, version: man && typeof man.version === 'string' ? man.version : null, path: await inside(home, path.join(root, n)), on: last === null ? true : !last.startsWith('!') });
  }
  return { found: true, list };
}

async function copilot(home) {
  const root = path.join(home, '.copilot', 'installed-plugins');
  const list = [];
  for (const market of await dirs(root)) {
    for (const plugin of await dirs(path.join(root, market))) {
      const id = market === '_direct' ? plugin : plugin + '@' + market;
      list.push({ id, name: plugin, scope: 'global', project: null, version: null, path: await inside(home, path.join(root, market, plugin)), on: null });
    }
  }
  return { found: list.length > 0, list };
}

async function antigravity(home) {
  const root = path.join(home, '.gemini', 'config', 'plugins');
  const list = [];
  for (const n of await dirs(root)) list.push({ id: n, name: n, scope: 'global', project: null, version: null, path: await inside(home, path.join(root, n)), on: null });
  return { found: list.length > 0, list };
}

const READERS = { 'claude-code': claudeCode, codex, 'gemini-cli': gemini, 'github-copilot': copilot, antigravity };

// --- Sources de réinstallation (sauvegarde complète) ---

export const REPO_RE = /^[A-Za-z0-9][\w.-]{0,99}\/[A-Za-z0-9][\w.-]{0,99}$/;
export const REF_RE = /^[A-Za-z0-9][\w.\/-]{0,199}$/;
// Dépôt GitHub « owner/repo » tiré d'une source : owner/repo, ou adresse https://github.com/owner/repo(.git). Sinon null.
export function repoOf(s) {
  if (typeof s !== 'string') return null;
  const m = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(s);
  const r = m ? m[1] : s;
  return REPO_RE.test(r) && !r.includes('..') && !r.endsWith('.git') ? r : null;
}

// Où chaque agent a pris ses places de marché et ses extensions : seulement des dépôts GitHub (les autres sources ne se réinstallent pas).
// Rend { 'claude-code': { place: repo }, codex: { place: repo }, 'gemini-cli': { extension: { repo, ref } } }.
export async function pluginSources(opts = {}) {
  const home = homeOf(opts);
  const out = { 'claude-code': {}, codex: {}, 'gemini-cli': {} };
  const fromSource = (s) => (s && typeof s === 'object' ? (s.source === 'github' ? repoOf(s.repo) : (s.source === 'git' || s.source === 'url') ? repoOf(s.url) : null) : null);
  const known = (await readJsonc(path.join(home, '.claude', 'plugins', 'known_marketplaces.json'))) || {};
  const extra = ((await readJsonc(path.join(home, '.claude', 'settings.json'))) || {}).extraKnownMarketplaces || {};
  for (const src of [extra, known]) {
    if (!src || typeof src !== 'object') continue;
    for (const [name, v] of Object.entries(src)) { const r = v && fromSource(v.source); if (r) out['claude-code'][name] = r; }
  }
  const t = await readText(path.join(home, '.codex', 'config.toml'));
  let conf = {};
  try { conf = t ? TOML.parse(t) : {}; } catch { conf = {}; }
  for (const [name, v] of Object.entries(conf.marketplaces && typeof conf.marketplaces === 'object' ? conf.marketplaces : {})) {
    const r = v && typeof v === 'object' && v.source_type !== 'local' ? repoOf(v.source) : null;
    if (r) out.codex[name] = r;
  }
  const root = path.join(home, '.gemini', 'extensions');
  for (const n of await dirs(root)) {
    const m = await readJsonc(path.join(root, n, '.gemini-extension-install.json'));
    if (!m || (m.type !== 'git' && m.type !== 'github-release')) continue;
    const r = repoOf(m.source);
    const ref = typeof m.releaseTag === 'string' ? m.releaseTag : typeof m.ref === 'string' ? m.ref : null;
    if (r) out['gemini-cli'][n] = { repo: r, ref: ref && REF_RE.test(ref) && !ref.includes('..') ? ref : null };
  }
  return out;
}

// État des plugins : agents (un par lecteur trouvé) et plugins (un par identifiant, avec ag[agent] = [entrées]).
export async function pluginState(opts = {}) {
  const home = homeOf(opts);
  const project = opts.project || null;
  const agents = [], rows = new Map();
  for (const [agent, read] of Object.entries(READERS)) {
    let r;
    try { r = await read(home, project); } catch { r = { found: true, error: true, list: [] }; }
    if (!r.found) continue;
    agents.push({ id: agent, name: PLUGIN_AGENTS[agent], count: r.list.filter((x) => !x.other).length, error: r.error ? 'Fichier des plugins illisible.' : null });
    for (const e of r.list) {
      // Un même plugin chez deux agents (superpowers@place chez Claude Code, superpowers chez Antigravity) : une seule ligne.
      let row = rows.get(e.name);
      if (!row) { row = { id: e.name, name: e.name, ag: {}, contents: null }; rows.set(e.name, row); }
      (row.ag[agent] = row.ag[agent] || []).push({ pluginId: e.id, scope: e.scope, project: e.project ? path.basename(e.project) : null, other: !!e.other, version: e.version, on: e.on, read: !!e.path });
      if (!row.contents && e.path) row.contents = await contents(e.path).catch(() => null);
    }
  }
  const plugins = [...rows.values()].map((r) => {
    const all = Object.values(r.ag).flat();
    r.on = all.some((e) => e.on !== false && !e.other);
    r.otherOnly = all.every((e) => e.other);
    r.title = (r.contents && r.contents.title && !/^app-[0-9a-f]{16,}/.test(r.contents.title) ? r.contents.title : r.name);
    return r;
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { agents, plugins };
}
