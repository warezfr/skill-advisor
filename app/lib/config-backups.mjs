// Sauvegarde de toute la configuration des agents, restaurable sur la même machine ou une autre.
// ~/.skill-advisor/backups/<id>/ :
//   meta.json      kind "config", résumé de chaque partie (config-meta.mjs) ;
//   settings.json  réglages de Skill Advisor : agents ajoutés à la main, agents masqués, agents qui reçoivent les installations ;
//   skills/        une sauvegarde de skills (meta.json version 2 et copies), même identifiant ;
//   mcp/           une sauvegarde de serveurs MCP (meta.json et servers.json 0600), même identifiant ;
//   plugins.json   recette de réinstallation : agent, plugin, place de marché et son dépôt GitHub, état. Jamais les fichiers.
// Seulement le dossier personnel : rien de propre à un projet. Les chemins viennent toujours de la machine qui restaure.
// Les plugins se réinstallent un par un, par le CLI de leur agent (restoreConfigPlugin) : chaque commande est construite ici.
import fs from 'node:fs/promises';
import path from 'node:path';
import { agentMap } from './registry.mjs';
import { allSkillNames, checkId, collectSkills, createManualBackup, loadMetaAt, reserveDir, restoreSkillsAt, writeBackup } from './backups.mjs';
import { CONFIG_KIND, PARTS, configLabel, normalizeConfigMeta, pubConfig } from './config-meta.mjs';
import { checkMcpImport, fileFor, loadMcpAt, rawPlaces, restoreMcpItems, writeMcpBackup, writeMcpPart } from './mcp-backups.mjs';
import { mcpState } from './mcp.mjs';
import { PLUGIN_AGENTS, REF_RE, pluginSources, pluginState, repoOf } from './plugins.mjs';
import { ID_RE, findBin, run } from './plugins-cli.mjs';
import { addCustomAgent, hideAgent, readSettings, setTargets } from './settings.mjs';
import { AGENT_RE, backupsDir, childEnv, disabledDir, fail, fsMessage, homeOf, lstatOrNull, readJson, rmOpts, safeJoin, scanOf, sharedDir, within, writeJsonAtomic } from './util.mjs';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const CTRL = /[\u0000-\u001f\u007f]/;
const CUSTOM_RE = /^custom-\d{1,9}$/;
const MARKET_RE = /^[A-Za-z0-9][\w.-]{0,99}$/;
const HOOK_RE = /^[A-Z][A-Za-z]+$/;
const BINS = { 'claude-code': 'claude', codex: 'codex', 'gemini-cli': 'gemini', 'github-copilot': 'copilot' };
// Places de marché connues d'office : le dépôt d'une recette n'est jamais ajouté sous ces noms.
const BUILTIN = {
  'claude-code': (m) => m === 'claude-plugins-official',
  codex: (m) => /^openai-[\w-]+$/.test(m),
  'github-copilot': (m) => m === 'awesome-copilot' || m === 'copilot-plugins',
};
const builtin = (agent, market) => !!(market && BUILTIN[agent] && BUILTIN[agent](market));

function text(v, max, what, lines) {
  if (v === undefined || v === null || v === '') return '';
  const bad = lines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : CTRL;
  if (typeof v !== 'string' || v.length > max || bad.test(v)) throw fail('BAD_INPUT', what + ' : ' + max + ' caractères au plus, sans caractère spécial.');
  return v.trim();
}

// Chemin gardé dans settings.json : « ~/… » dans le dossier personnel, sinon tel quel.
const keepPath = (home, p) => (within(p, home) ? '~/' + path.relative(home, p).split(path.sep).join('/') : p);
const usePath = (home, p) => (p === '~' || p.startsWith('~/') ? path.join(home, ...p.slice(2).split('/').filter(Boolean)) : p);
const realOf = (p) => fs.realpath(p).catch(() => null);
const hasFile = async (p) => !!(await fs.stat(p).catch(() => null));

async function sizeOf(dir) {
  let n = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += await sizeOf(p); else if (e.isFile()) n += (await fs.stat(p)).size;
  }
  return n;
}

// --- Recette des plugins ---

// Une entrée de recette vérifiée, ou null. Tout champ qui sert à une commande est contrôlé ici.
export function cleanPlugin(x) {
  if (!isObj(x) || typeof x.agent !== 'string' || !Object.hasOwn(PLUGIN_AGENTS, x.agent)) return null;
  if (typeof x.pluginId !== 'string' || !ID_RE.test(x.pluginId) || typeof x.name !== 'string' || !ID_RE.test(x.name)) return null;
  const market = x.market === null || x.market === undefined ? null : x.market;
  if (market !== null && (typeof market !== 'string' || !MARKET_RE.test(market) || x.pluginId !== x.name + '@' + market)) return null;
  if (market === null && x.pluginId !== x.name) return null;
  const repo = x.repo === null || x.repo === undefined ? null : repoOf(x.repo);
  if (x.repo && !repo) return null;
  const ref = typeof x.ref === 'string' && REF_RE.test(x.ref) && !x.ref.includes('..') ? x.ref : null;
  if (x.ref && !ref) return null;
  return {
    agent: x.agent, pluginId: x.pluginId, name: x.name, market,
    version: typeof x.version === 'string' && !CTRL.test(x.version) ? x.version.slice(0, 40) : null,
    on: x.on === true ? true : x.on === false ? false : null,
    hooks: Array.isArray(x.hooks) ? x.hooks.filter((h) => typeof h === 'string' && HOOK_RE.test(h)).slice(0, 20) : [],
    how: x.how === 'auto' ? 'auto' : 'manual', repo, ref,
    why: typeof x.why === 'string' && !CTRL.test(x.why) ? x.why.slice(0, 200) : '',
  };
}

// Comment chaque plugin du dossier personnel se réinstallera. Les plugins propres à un projet n'y sont pas.
export async function pluginRecipe(home) {
  const st = await pluginState({ home });
  const src = await pluginSources({ home });
  const items = [];
  for (const row of st.plugins) {
    for (const [agent, entries] of Object.entries(row.ag)) {
      for (const e of entries) {
        if (e.other || e.scope !== 'global') continue;
        const at = e.pluginId.lastIndexOf('@');
        const market = at > 0 ? e.pluginId.slice(at + 1) : null;
        const base = { agent, pluginId: e.pluginId, name: at > 0 ? e.pluginId.slice(0, at) : e.pluginId, market, version: e.version, on: e.on,
          hooks: (row.contents && row.contents.hooks) || [] };
        let how = 'manual', repo = null, ref = null, why = '';
        if (agent === 'claude-code' || agent === 'codex') {
          repo = !builtin(agent, market) && market ? src[agent][market] || null : null;
          if (builtin(agent, market) || repo) how = 'auto'; else why = 'Source de la place de marché ' + (market || '?') + ' inconnue.';
        } else if (agent === 'gemini-cli') {
          const g = src['gemini-cli'][e.pluginId];
          if (g) { how = 'auto'; repo = g.repo; ref = g.ref; } else why = 'Extension installée depuis un dossier local ou une source inconnue.';
        } else if (agent === 'github-copilot') {
          if (builtin(agent, market)) how = 'auto'; else why = market ? 'Place de marché ' + market + ' inconnue de Copilot CLI.' : 'Installation directe : source inconnue.';
        } else why = PLUGIN_AGENTS[agent] + ' n’a pas de commande d’installation.';
        const clean = cleanPlugin({ ...base, how, repo, ref, why });
        if (clean) items.push(clean);
      }
    }
  }
  return items;
}

const pluginSummary = (items) => ({ count: items.length, auto: items.filter((i) => i.how === 'auto').length, manual: items.filter((i) => i.how === 'manual').length,
  hooks: items.filter((i) => i.hooks.length).length, agents: [...new Set(items.map((i) => i.agent))] });

// --- Réglages ---

export function cleanSettings(x) {
  const ids = (a) => (Array.isArray(a) ? [...new Set(a.filter((i) => typeof i === 'string' && AGENT_RE.test(i)))].slice(0, 500) : []);
  const custom = [];
  for (const c of isObj(x) && Array.isArray(x.custom) ? x.custom.slice(0, 50) : []) {
    if (!isObj(c) || typeof c.id !== 'string' || !CUSTOM_RE.test(c.id) || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60 || CTRL.test(c.name)) continue;
    if (typeof c.dir !== 'string' || !c.dir || c.dir.length > 1024 || CTRL.test(c.dir)) continue;
    // Jamais un chemin réseau (\\serveur\partage, //serveur) : le lire enverrait l'identité Windows à ce serveur.
    if (/^[\\/]{2}/.test(c.dir) || !(c.dir === '~' || c.dir.startsWith('~/') || path.isAbsolute(c.dir)) || c.dir.split(/[\\/]/).includes('..')) continue;
    custom.push({ id: c.id, name: c.name.trim(), dir: c.dir });
  }
  return { version: 1, custom, hidden: ids(isObj(x) ? x.hidden : null), targets: ids(isObj(x) ? x.targets : null) };
}

const settingsSummary = (d) => ({ custom: d.custom.length, hidden: d.hidden.length, targets: d.targets.length, agents: [...new Set([...d.custom.map((c) => c.id), ...d.hidden, ...d.targets])] });

// --- Création ---

// opts = { label, note, secrets, parts? }. Rend { backup, failed: [{ part, name, message }] }.
export async function createConfigBackup(opts = {}) {
  const home = homeOf(opts);
  const label = text(opts.label, 80, 'Nom de la sauvegarde', false);
  const note = text(opts.note, 500, 'Note', true);
  const want = Array.isArray(opts.parts) && opts.parts.length ? PARTS.filter((p) => opts.parts.includes(p)) : PARTS;
  if (!want.length) throw fail('BAD_INPUT', 'Choisissez au moins une partie à sauvegarder.');
  const secrets = !!opts.secrets;
  const map = await agentMap({ home });
  const { id, dir } = await reserveDir(home, 'configuration');
  const parts = {}, failed = [];
  try {
    if (want.includes('settings')) {
      const s = await readSettings({ home });
      const data = { version: 1, custom: s.custom.map((c) => ({ id: c.id, name: c.name, dir: keepPath(home, c.dir) })), hidden: s.hidden, targets: s.targets };
      await writeJsonAtomic(path.join(dir, 'settings.json'), data);
      parts.settings = settingsSummary(data);
    }
    if (want.includes('skills')) {
      const names = await allSkillNames(home, map);
      const { items, failed: f } = await collectSkills(home, map, names);
      for (const x of f) failed.push({ part: 'skills', name: x.name, message: x.message });
      let kept = items;
      if (items.length) {
        try { await writeBackup(home, { origin: 'manual', label: 'Skills', items }, { dir: path.join(dir, 'skills'), id }); } catch (e) {
          // Trop de skills pour une sauvegarde : les autres parties restent ; l'utilisateur le voit.
          if (e.code !== 'BACKUP_FAILED') throw e;
          failed.push({ part: 'skills', name: 'skills', message: e.message + ' Les skills ne sont pas dans cette sauvegarde.' });
          kept = null;
        }
      }
      if (kept) parts.skills = { count: items.length, names: items.map((i) => i.name), agents: [...new Set(items.flatMap((i) => [...i.agents, ...i.places.map((p) => p.agent)]))] };
    }
    if (want.includes('mcp')) {
      const st = await mcpState({ home });
      const items = [];
      for (const s of st.servers.filter((x) => x.scope === 'global')) {
        const places = await rawPlaces(home, null, s.name, 'global', st);
        if (places && places.length) items.push({ name: s.name, scope: 'global', places });
        else failed.push({ part: 'mcp', name: s.name, message: 'Réglages de ce serveur illisibles.' });
      }
      let vars = [], agents = [];
      if (items.length) {
        const b = await writeMcpBackup({ home, items, secrets, origin: 'manual', label: 'Serveurs MCP' }, { dir: path.join(dir, 'mcp'), id });
        vars = [...new Set(b.items.flatMap((i) => i.vars))];
        agents = [...new Set(b.items.flatMap((i) => i.agents))];
      }
      parts.mcp = { count: items.length, secrets: secrets ? 'kept' : 'vars', vars, agents };
    }
    if (want.includes('plugins')) {
      const items = await pluginRecipe(home);
      await writeJsonAtomic(path.join(dir, 'plugins.json'), { version: 1, items });
      parts.plugins = pluginSummary(items);
    }
    if (!Object.keys(parts).length) throw fail('BACKUP_FAILED', failed.length ? failed[0].message : 'Rien à sauvegarder.');
    const meta = { version: 2, kind: CONFIG_KIND, id, label: '', note, origin: 'manual', at: new Date().toISOString(), size: await sizeOf(dir), parts };
    meta.label = label || configLabel(meta.at);
    await writeJsonAtomic(path.join(dir, 'meta.json'), meta);
    return { backup: pubConfig(normalizeConfigMeta(meta, id)), failed };
  } catch (e) {
    await fs.rm(dir, rmOpts()).catch(() => {});
    if (e.code === 'BACKUP_FAILED' || e.code === 'BAD_INPUT') throw e;
    throw fail('BACKUP_FAILED', 'La sauvegarde de la configuration a échoué : ' + (e.code ? e.message : fsMessage(e) + '.'));
  }
}

// --- Lecture ---

export async function loadConfigBackup(home, id) {
  checkId(id);
  const dir = safeJoin(backupsDir(home), id);
  const raw = await readJson(path.join(dir, 'meta.json'), null);
  if (!raw) throw fail('NOT_FOUND', 'Sauvegarde introuvable.');
  const meta = normalizeConfigMeta(raw, id);
  if (!meta) throw fail('BAD_NAME', 'Sauvegarde incohérente.');
  return { dir, meta };
}

// Recette relue et vérifiée à chaque usage : une entrée invalide vaut null (jamais lancée).
async function readPlugins(dir) {
  const d = await readJson(path.join(dir, 'plugins.json'), null);
  return (isObj(d) && Array.isArray(d.items) ? d.items.slice(0, 500) : []).map(cleanPlugin);
}

// Agents ajoutés à la main de la sauvegarde déjà présents ici, sur le même dossier réel : { ancien id: id d'ici }.
async function sameCustom(home, data) {
  const cur = await readSettings({ home });
  const out = {};
  for (const c of data.custom) {
    const real = await realOf(usePath(home, c.dir));
    if (!real) continue;
    for (const x of cur.custom) if ((await realOf(x.dir)) === real) out[c.id] = x.id;
  }
  return out;
}

// --- Restauration ---

// Réglages : agents ajoutés à la main (même dossier réel : repris ; dossier présent : ajouté avec les contrôles habituels),
// agents masqués ajoutés aux masqués, agents cibles repris si aucun n'est choisi ici (ou si conflict vaut replace).
// Rend { report, idMap } : idMap relie les identifiants custom-<n> de la sauvegarde à ceux de cette machine.
async function restoreSettings(home, dir, conflict) {
  const data = cleanSettings(await readJson(path.join(dir, 'settings.json'), null));
  const report = { added: [], same: [], skipped: [], hidden: 0, targets: 0 };
  const idMap = await sameCustom(home, data);
  for (const c of data.custom) {
    if (idMap[c.id]) { report.same.push(c.name); continue; }
    const want = usePath(home, c.dir);
    const real = await realOf(want);
    if (!real) { report.skipped.push({ name: c.name, reason: 'Dossier absent sur cette machine : ' + want + '.' }); continue; }
    try {
      const a = await addCustomAgent({ home, name: c.name, dir: real });
      idMap[c.id] = a.id;
      report.added.push(a.name);
    } catch (e) { report.skipped.push({ name: c.name, reason: e.code ? e.message : 'Ajout impossible.' }); }
  }
  const mapId = (id) => (CUSTOM_RE.test(id) ? idMap[id] || null : id);
  const now = await readSettings({ home });
  for (const id of data.hidden.map(mapId).filter(Boolean)) {
    if (now.hidden.includes(id)) continue;
    await hideAgent({ home, id });
    report.hidden++;
  }
  const targets = data.targets.map(mapId).filter(Boolean);
  if (targets.length && (conflict === 'replace' || !now.targets.length)) { await setTargets({ home, ids: targets }); report.targets = targets.length; }
  return { report, idMap };
}

// Identifiants custom-<n> de la sauvegarde remplacés par ceux de cette machine ; places des agents inconnus retirées.
function remapSkill(it, idMap) {
  const m = (id) => (CUSTOM_RE.test(id) ? idMap[id] || null : id);
  return { ...it, agents: it.agents.map(m).filter(Boolean), places: it.places.filter((p) => m(p.agent)).map((p) => ({ ...p, agent: m(p.agent) })) };
}

async function restoreSkills(home, dir, id, idMap, opts) {
  const out = { restored: [], skipped: [], held: [], failed: [], backups: [] };
  const sk = path.join(dir, 'skills');
  if (!(await hasFile(path.join(sk, 'meta.json')))) return out;
  const { meta } = await loadMetaAt(sk, id);
  const force = Array.isArray(opts.force) ? opts.force : [];
  const map = await agentMap({ home });
  const conflicts = [];
  const one = (it) => restoreSkillsAt(home, sk, { ...meta, items: [it] }, { force, onlyDetected: true, map });
  for (const raw of meta.items) {
    const it = remapSkill(raw, idMap);
    if (!it.places.length) { out.skipped.push({ name: it.name, reason: 'Les agents qui avaient ce skill ne sont pas sur cette machine.' }); continue; }
    try { await one(it); out.restored.push(it.name); } catch (e) {
      if (e.code === 'ROUGE') out.held.push(it.name);
      else if (e.code === 'EXISTS') conflicts.push(it);
      else if (e.code === 'NOT_FOUND') out.skipped.push({ name: it.name, reason: e.message });
      else out.failed.push({ name: it.name, message: e.code ? e.message : 'Restauration impossible.' });
    }
  }
  if (!conflicts.length) return out;
  if (opts.conflict !== 'replace') {
    for (const it of conflicts) out.skipped.push({ name: it.name, reason: 'Déjà installé sur cette machine.' });
    return out;
  }
  // Remplacement : une seule sauvegarde des skills présents, puis désinstallation et restauration de chacun.
  const names = conflicts.map((i) => i.name);
  try {
    const b = await createManualBackup({ home, names, origin: 'replace', label: 'Avant restauration de la configuration' });
    out.backups.push(b.backup);
  } catch (e) {
    for (const n of names) out.failed.push({ name: n, message: 'Sauvegarde de la version présente impossible : rien n’a été remplacé.' + (e.code ? ' ' + e.message : '') });
    return out;
  }
  const { remove } = await import('./actions.mjs');
  for (const it of conflicts) {
    try {
      const r = await remove({ home, names: [it.name] });
      if (r.failed.length) throw fail('BACKUP_FAILED', r.failed[0].message);
      await one(it);
      out.restored.push(it.name);
    } catch (e) {
      if (e.code === 'ROUGE') out.held.push(it.name);
      else out.failed.push({ name: it.name, message: e.code ? e.message : 'Remplacement impossible.' });
    }
  }
  return out;
}

// Statut d'un plugin de la recette sur cette machine : invalid, installed, manual, auto ou no-cli.
async function pluginStatus(it, st, env, findImpl) {
  if (!it) return 'invalid';
  if (st.plugins.some((p) => p.ag[it.agent] && p.ag[it.agent].some((e) => e.pluginId === it.pluginId && !e.other))) return 'installed';
  if (it.how !== 'auto') return 'manual';
  return BINS[it.agent] && findImpl(BINS[it.agent], env) ? 'auto' : 'no-cli';
}

async function listPlugins(home, dir, opts) {
  const items = await readPlugins(dir);
  const st = await pluginState({ home });
  const env = childEnv(home);
  const findImpl = opts.findBin || findBin;
  const out = [];
  for (const [i, it] of items.entries()) {
    out.push({ index: i, agent: it ? it.agent : null, pluginId: it ? it.pluginId : null, name: it ? it.name : null, market: it ? it.market : null,
      repo: it ? it.repo : null, on: it ? it.on : null, hooks: it ? it.hooks : [], why: it ? it.why : 'Entrée invalide dans la sauvegarde.',
      status: await pluginStatus(it, st, env, findImpl) });
  }
  return out;
}

// Restaure les parties choisies : réglages, skills, serveurs MCP. Les plugins sont seulement listés (restoreConfigPlugin les installe).
// opts = { id, parts?, conflict: skip|replace, force?: [noms de skills] }.
export async function restoreConfigBackup(opts = {}) {
  const home = homeOf(opts);
  const { dir, meta } = await loadConfigBackup(home, opts.id);
  const conflict = opts.conflict === 'replace' ? 'replace' : 'skip';
  const asked = Array.isArray(opts.parts) && opts.parts.length ? opts.parts : PARTS;
  const want = PARTS.filter((p) => asked.includes(p) && meta.parts[p]);
  const out = { settings: null, skills: null, mcp: null, plugins: null, backups: [], warnings: [] };
  // Chaque partie à part : un échec est noté dans son bilan, les autres parties continuent.
  const why = (e) => (e && e.code ? e.message : 'Erreur inattendue : ' + fsMessage(e) + '.');
  let idMap = {};
  if (want.includes('settings')) {
    try { const s = await restoreSettings(home, dir, conflict); out.settings = s.report; idMap = s.idMap; }
    catch (e) { out.settings = { added: [], same: [], skipped: [{ name: 'Réglages', reason: why(e) }], hidden: 0, targets: 0 }; }
  } else {
    // Réglages non restaurés : un agent ajouté à la main n'est repris que s'il existe déjà ici, sur le même dossier.
    idMap = await sameCustom(home, cleanSettings(await readJson(path.join(dir, 'settings.json'), null))).catch(() => ({}));
  }
  if (want.includes('skills')) {
    try { out.skills = await restoreSkills(home, dir, meta.id, idMap, { ...opts, conflict }); out.backups.push(...out.skills.backups); }
    catch (e) { out.skills = { restored: [], skipped: [], held: [], failed: [{ name: 'skills', message: why(e) }], backups: [] }; }
  }
  if (want.includes('mcp') && (await hasFile(path.join(dir, 'mcp', 'meta.json')))) {
    try {
      const { items, meta: m } = await loadMcpAt(path.join(dir, 'mcp'), meta.id);
      out.mcp = await restoreMcpItems(home, items, m, { conflict, onlyDetected: true, oneBackup: true });
      out.backups.push(...out.mcp.backups);
      out.warnings.push(...out.mcp.warnings);
    } catch (e) { out.mcp = { applied: [], skipped: [], failed: [{ name: 'Serveurs MCP', agent: null, message: why(e) }], backups: [], warnings: [] }; }
  }
  if (want.includes('plugins')) {
    try { out.plugins = await listPlugins(home, dir, opts); } catch (e) { out.plugins = []; out.warnings.push('Plugins : ' + why(e)); }
  }
  return out;
}

// Ce que la restauration fera, sans rien écrire.
export async function previewConfigBackup(opts = {}) {
  const home = homeOf(opts);
  const { dir, meta } = await loadConfigBackup(home, opts.id);
  const out = { backup: pubConfig(meta), settings: null, skills: null, mcp: null, plugins: null };
  let idMap = {};
  if (meta.parts.settings) {
    const data = cleanSettings(await readJson(path.join(dir, 'settings.json'), null));
    const same = await sameCustom(home, data);
    const custom = [];
    for (const c of data.custom) custom.push({ name: c.name, dir: c.dir, status: same[c.id] ? 'same' : (await realOf(usePath(home, c.dir))) ? 'new' : 'missing' });
    out.settings = { custom, hidden: data.hidden.length, targets: data.targets.length };
    idMap = same;
  }
  if (meta.parts.skills && (await hasFile(path.join(dir, 'skills', 'meta.json')))) {
    const sk = path.join(dir, 'skills');
    const { meta: sm } = await loadMetaAt(sk, meta.id);
    const map = await agentMap({ home });
    out.skills = [];
    for (const raw of sm.items) {
      // Mêmes règles que la restauration : agents remappés, agents absents passés, collision sur les places visées.
      const it = remapSkill(raw, idMap);
      const places = it.places.filter((p) => p.agent === 'universal' || (map[p.agent] && map[p.agent].detected));
      let exists = false;
      for (const p of places) {
        const a = map[p.agent];
        const to = p.agent === 'universal' ? safeJoin(sharedDir(home), it.name) : a && !a.shared && a.dir ? safeJoin(a.dir, it.name) : null;
        if ((to && (await lstatOrNull(to))) || (await lstatOrNull(safeJoin(safeJoin(disabledDir(home), p.agent), it.name)))) exists = true;
      }
      // Retenu à la restauration si le verdict noté ou le contrôle d'une copie donne rouge (ou échoue).
      const red = raw.verdict === 'rouge' || [...new Set(raw.places.map((p) => p.copy))].some((c) => { const r = scanOf(path.join(sk, ...c.split('/'))); return !r || r.verdict === 'rouge'; });
      out.skills.push({ name: it.name, verdict: red ? 'rouge' : raw.verdict, status: !places.length ? 'absent' : exists ? 'exists' : 'new' });
    }
  }
  if (meta.parts.mcp && (await hasFile(path.join(dir, 'mcp', 'meta.json')))) {
    const { items } = await loadMcpAt(path.join(dir, 'mcp'), meta.id);
    const st = await mcpState({ home });
    const det = new Set(st.detectedMcp || []);
    const list = [];
    for (const it of items) {
      const row = st.servers.find((s) => s.name === it.name && s.scope === 'global');
      for (const p of it.places) {
        const e = p.entry;
        const runs = String(typeof e.command === 'string' ? [e.command, ...(Array.isArray(e.args) ? e.args : [])].join(' ') : (e.url || e.httpUrl || e.serverUrl || e.uri || ''));
        // Absent : même règle que la restauration (agent non détecté et fichier de réglages absent).
        const f = await fileFor(home, null, p.mcpId, 'global').catch(() => null);
        const absent = !det.has(p.mcpId) && !(f && (await hasFile(f.file)));
        const keys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).slice(0, 50) : []);
        list.push({ name: it.name, agent: p.agent, off: p.off, status: absent ? 'absent' : row && row.ag[p.agent] ? 'exists' : 'new',
          runs: runs.slice(0, 2000), long: runs.length > 2000, env: [...keys(e.env), ...keys(e.headers), ...keys(e.http_headers)] });
      }
    }
    out.mcp = { items: list, secrets: meta.parts.mcp.secrets, vars: meta.parts.mcp.vars };
  }
  if (meta.parts.plugins) out.plugins = await listPlugins(home, dir, opts);
  return out;
}

// Noms des places de marché déjà connues d'un agent (Claude Code, Codex).
async function marketNames(home, agent) {
  if (agent === 'claude-code') {
    const a = await readJson(path.join(home, '.claude', 'plugins', 'known_marketplaces.json'), null);
    const s = await readJson(path.join(home, '.claude', 'settings.json'), null);
    return [...Object.keys(isObj(a) ? a : {}), ...Object.keys(isObj(s) && isObj(s.extraKnownMarketplaces) ? s.extraKnownMarketplaces : {})];
  }
  if (agent === 'codex') {
    const t = await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8').catch(() => '');
    return [...t.matchAll(/^\[marketplaces\.("?)([\w.-]+)\1\]/gm)].map((m) => m[2]);
  }
  return [];
}

// Commandes d'une réinstallation, construites ici à partir d'une entrée vérifiée (cleanPlugin). Rend { bin, steps }.
export function reinstallPlan(it, known = []) {
  const steps = [];
  const addMarket = !!(it.repo && it.market && !known.includes(it.market) && !builtin(it.agent, it.market));
  if (it.agent === 'claude-code') {
    if (addMarket) steps.push({ args: ['plugin', 'marketplace', 'add', it.repo], market: it.market });
    steps.push({ args: ['plugin', 'install', it.pluginId, '--scope', 'user'] });
    if (it.on === false) steps.push({ args: ['plugin', 'disable', it.pluginId, '--scope', 'user'] });
    return { bin: 'claude', steps };
  }
  if (it.agent === 'codex') {
    if (addMarket) steps.push({ args: ['plugin', 'marketplace', 'add', it.repo], market: it.market });
    steps.push({ args: ['plugin', 'add', it.pluginId] });
    return { bin: 'codex', steps };
  }
  if (it.agent === 'gemini-cli') {
    if (!it.repo) throw fail('UNSUPPORTED', 'Source de l’extension inconnue.');
    steps.push({ args: ['extensions', 'install', 'https://github.com/' + it.repo, ...(it.ref ? ['--ref', it.ref] : []), '--consent'] });
    if (it.on === false) steps.push({ args: ['extensions', 'disable', it.pluginId, '--scope', 'user'] });
    return { bin: 'gemini', steps };
  }
  if (it.agent === 'github-copilot' && builtin(it.agent, it.market)) return { bin: 'copilot', steps: [{ args: ['plugin', 'install', it.pluginId] }] };
  throw fail('UNSUPPORTED', PLUGIN_AGENTS[it.agent] + ' ne sait pas réinstaller ce plugin.');
}

// Réinstalle un plugin de la recette (index), par le CLI de son agent. Rend { status, message, done: [commandes] }.
// La place de marché citée n'est ajoutée que si son nom manque ; son nom est vérifié après l'ajout.
export async function restoreConfigPlugin(opts = {}) {
  const home = homeOf(opts);
  if ((opts.env || process.env).SA_PLUGIN_CLI === 'off') throw fail('UNSUPPORTED', 'Les commandes des agents sont coupées (SA_PLUGIN_CLI=off).');
  const { dir } = await loadConfigBackup(home, opts.id);
  const items = await readPlugins(dir);
  if (!Number.isSafeInteger(opts.index) || opts.index < 0 || opts.index >= items.length) throw fail('NOT_FOUND', 'Plugin absent de la sauvegarde.');
  const it = items[opts.index];
  if (!it) throw fail('BAD_NAME', 'Entrée de plugin invalide dans la sauvegarde : rien n’a été lancé.');
  const env = childEnv(home);
  const findImpl = opts.findBin || findBin;
  const status = await pluginStatus(it, await pluginState({ home }), env, findImpl);
  if (status === 'installed') return { status: 'skipped', message: 'Déjà installé.', done: [] };
  if (status === 'manual') return { status: 'manual', message: it.why || 'À réinstaller à la main.', done: [] };
  const plan = reinstallPlan(it, await marketNames(home, it.agent));
  const bin = findImpl(plan.bin, env);
  if (!bin) throw fail('UNSUPPORTED', 'Commande « ' + plan.bin + ' » introuvable : installez ' + PLUGIN_AGENTS[it.agent] + ' d’abord.');
  const done = [];
  const before = await marketNames(home, it.agent);
  for (const step of plan.steps) {
    const r = await run(bin, step.args, { cwd: home, env, timeoutMs: 300000 });
    if (r.code !== 0) {
      console.error('[plugins] ' + plan.bin + ' ' + step.args.join(' ') + ' : ' + r.out.slice(-2000));
      const line = r.out.split('\n').map((l) => l.trim()).filter(Boolean).pop() || 'code ' + r.code;
      throw fail('CLI_FAILED', PLUGIN_AGENTS[it.agent] + ' a refusé : ' + line.slice(0, 200), { done });
    }
    done.push(plan.bin + ' ' + step.args.join(' '));
    const after = step.market ? await marketNames(home, it.agent) : null;
    if (after && !after.includes(step.market)) {
      // Place ajoutée sous un autre nom : retirée, pour ne rien laisser que l'utilisateur n'a pas vu.
      for (const n of after.filter((x) => !before.includes(x) && MARKET_RE.test(x))) {
        await run(bin, ['plugin', 'marketplace', 'remove', n], { cwd: home, env, timeoutMs: 120000 }).catch(() => null);
      }
      throw fail('CLI_FAILED', 'La place de marché ajoutée ne s’appelle pas « ' + step.market + ' » : installation arrêtée.', { done });
    }
  }
  const message = it.agent === 'codex' && it.on === false ? 'Ce plugin était désactivé : désactivez-le dans Codex.' : '';
  return { status: 'installed', message, done };
}

// --- Import d'une archive extraite (archive.mjs) ---

// Chaque partie est vérifiée à nouveau ; seuls les fichiers cités sont gardés ; le résumé est recalculé.
export async function importConfigFrom(home, root, m) {
  const bad = (msg) => fail('BAD_ARCHIVE', msg);
  if (!normalizeConfigMeta({ ...m, id: 'x' }, 'x')) throw bad('Archive refusée : manifeste de configuration invalide.');
  const { checkSkillsMeta, stageSkills } = await import('./archive.mjs');
  const readSmall = async (f) => {
    const st = await fs.lstat(f).catch(() => null);
    if (!st) return undefined;
    if (!st.isFile() || st.size > 4 * 1024 * 1024) throw bad('Archive refusée : ' + path.basename(f) + ' trop gros ou invalide.');
    try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { throw bad('Archive refusée : ' + path.basename(f) + ' illisible.'); }
  };
  const { id, dir } = await reserveDir(home, 'configuration');
  const parts = {}, warnings = [];
  try {
    const settings = await readSmall(path.join(root, 'settings.json'));
    if (settings !== undefined) {
      const data = cleanSettings(settings);
      await writeJsonAtomic(path.join(dir, 'settings.json'), data);
      for (const c of data.custom) warnings.push('L’agent ajouté à la main ' + c.name + ' utilise le dossier ' + c.dir + '.');
      parts.settings = settingsSummary(data);
    }
    const sm = await readSmall(path.join(root, 'skills', 'meta.json'));
    if (sm !== undefined) {
      const man = await checkSkillsMeta(path.join(root, 'skills'), sm);
      await fs.mkdir(path.join(dir, 'skills'));
      const r = await stageSkills(path.join(root, 'skills'), man, path.join(dir, 'skills'));
      warnings.push(...r.warnings);
      await writeJsonAtomic(path.join(dir, 'skills', 'meta.json'), { version: 2, id, label: 'Skills', note: '', origin: 'import', at: new Date().toISOString(), size: await sizeOf(path.join(dir, 'skills')), items: r.items });
      parts.skills = { count: r.items.length, names: r.items.map((i) => i.name), agents: [...new Set(r.items.flatMap((i) => [...i.agents, ...i.places.map((p) => p.agent)]))] };
    }
    const mm = await readSmall(path.join(root, 'mcp', 'meta.json'));
    if (mm !== undefined) {
      if (!isObj(mm)) throw bad('Archive refusée : mcp/meta.json invalide.');
      const r = await checkMcpImport(path.join(root, 'mcp'), mm);
      warnings.push(...r.warnings);
      await fs.mkdir(path.join(dir, 'mcp'));
      await writeMcpPart(path.join(dir, 'mcp'), id, r.items, { label: 'Serveurs MCP' });
      parts.mcp = { count: r.items.length, secrets: r.items.some((i) => i.secrets === 'kept') ? 'kept' : 'vars', vars: [...new Set(r.items.flatMap((i) => i.vars))],
        agents: [...new Set(r.items.flatMap((i) => i.places.map((p) => p.agent)))] };
    }
    const pl = await readSmall(path.join(root, 'plugins.json'));
    if (pl !== undefined) {
      const list = isObj(pl) && Array.isArray(pl.items) ? pl.items.slice(0, 500) : [];
      const items = list.map(cleanPlugin).filter(Boolean);
      if (list.length > items.length) warnings.push((list.length - items.length) + ' plugin(s) de l’archive ignoré(s) : entrée invalide.');
      for (const i of items) {
        if (i.how === 'auto' && i.repo) warnings.push('Le plugin ' + i.name + ' (' + PLUGIN_AGENTS[i.agent] + ') sera réinstallé depuis github.com/' + i.repo + '. Vérifiez que vous faites confiance à cette source.');
        if (i.hooks.length) warnings.push('Le plugin ' + i.name + ' a des hooks (' + i.hooks.join(', ') + ') : ils lancent des commandes sans que vous les appeliez.');
      }
      await writeJsonAtomic(path.join(dir, 'plugins.json'), { version: 1, items });
      parts.plugins = pluginSummary(items);
    }
    if (!Object.keys(parts).length) throw bad('Archive refusée : aucune partie de configuration.');
    const label = typeof m.label === 'string' && m.label.trim() && !CTRL.test(m.label) ? m.label.trim().slice(0, 80) : '';
    const note = typeof m.note === 'string' ? m.note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 500) : '';
    const meta = { version: 2, kind: CONFIG_KIND, id, label, note, origin: 'import', at: new Date().toISOString(), size: await sizeOf(dir), parts };
    if (!meta.label) meta.label = configLabel(meta.at);
    await writeJsonAtomic(path.join(dir, 'meta.json'), meta);
    return { backup: pubConfig(normalizeConfigMeta(meta, id)), warnings };
  } catch (e) {
    await fs.rm(dir, rmOpts()).catch(() => {});
    throw e;
  }
}
