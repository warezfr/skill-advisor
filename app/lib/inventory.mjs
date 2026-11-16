// Inventaire : état complet de la machine (agents, skills installés, sauvegardes, réglages, projet, version).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call } from './worker.mjs';
import { listAgents, readsShared } from './registry.mjs';
import { readSettings } from './settings.mjs';
import { listBackups } from './backups.mjs';
import { catalogInfo as catalogOf } from './catalog.mjs';
import { mcpState } from './mcp.mjs';
import { pluginState } from './plugins.mjs';
import { verbsOf } from './plugins-cli.mjs';
import { AGENT_RE, NAME_RE, disabledDir, homeOf, keyIn, lockPath, lstatOrNull, osName, readJson, saDir, scanOf, sharedDir, statOrNull } from './util.mjs';

const CATALOG = fileURLToPath(new URL('../../catalog/catalog.json', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../../package.json', import.meta.url));
let versionP = null;

// Version de Skill Advisor, lue une fois dans package.json.
function appVersion() {
  if (!versionP) versionP = fs.readFile(PACKAGE, 'utf8').then((t) => String(JSON.parse(t).version || ''), () => '');
  return versionP;
}
// Source et date du catalogue : catalogInfo lit le cache ou la copie fournie, jamais le réseau (l'état doit rester rapide).
async function catalogState(home) {
  const c = await catalogOf({ home }).catch(() => ({ source: 'bundled', generatedAt: null }));
  return { source: c.source === 'online' ? 'online' : 'bundled', generatedAt: c.generatedAt || null };
}
// Chemin réel, ou le chemin résolu s'il n'existe pas.
async function real(p) { try { return await fs.realpath(p); } catch { return path.resolve(p); } }
const OWNER_REPO = /^[\w-][\w.-]*\/[\w-][\w.-]*$/;
let catalogP = null;

// Catalogue embarqué, lu une seule fois.
function catalog() {
  if (!catalogP) catalogP = fs.readFile(CATALOG, 'utf8').then((t) => JSON.parse(t).skills || {}, () => ({}));
  return catalogP;
}

export const checkFile = (home) => path.join(saDir(home), 'check.json');

// Description du front matter de SKILL.md (forme simple, guillemets, bloc | ou >).
export function descriptionOf(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description\s*:/.test(l));
  if (i < 0) return null;
  let v = lines[i].replace(/^description\s*:\s*/, '');
  if (/^[|>][+-]?\s*$/.test(v)) {
    const block = [];
    for (let j = i + 1; j < lines.length && (/^\s+/.test(lines[j]) || lines[j] === ''); j++) block.push(lines[j].trim());
    return block.join(v[0] === '>' ? ' ' : '\n').trim();
  }
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\''))) v = v.slice(1, -1);
  return v;
}

async function readOrNull(p) { try { return await fs.readFile(p, 'utf8'); } catch { return null; } }
async function readdirOrEmpty(p) { try { return await fs.readdir(p, { withFileTypes: true }); } catch { return []; } }

// Statut d'un agent qui a son propre dossier : ok, ko (lien cassé), div (copie différente), ou absent.
async function agentStatus(entry, sharedMd) {
  const l = await lstatOrNull(entry);
  if (!l) return null;
  if (l.isSymbolicLink()) return (await statOrNull(path.join(entry, 'SKILL.md'))) ? 'ok' : 'ko';
  if (!l.isDirectory()) return null;
  if (sharedMd === null) return 'ok';
  const own = await readOrNull(path.join(entry, 'SKILL.md'));
  return own !== null && own !== sharedMd ? 'div' : 'ok';
}

// Entrées désactivées : { nom: [{ agent, path }] }. Un agent qui n'existe plus (retiré du paquet ou des réglages)
// garde ses skills désactivés visibles : sans cela, ils resteraient cachés sous ~/.skill-advisor/disabled.
async function readDisabled(home) {
  const out = {};
  for (const a of await readdirOrEmpty(disabledDir(home))) {
    if (!a.isDirectory() || !AGENT_RE.test(a.name)) continue;
    for (const e of await readdirOrEmpty(path.join(disabledDir(home), a.name))) {
      if (!NAME_RE.test(e.name)) continue;
      (out[e.name] = out[e.name] || []).push({ agent: a.name, path: path.join(disabledDir(home), a.name, e.name) });
    }
  }
  return out;
}

export async function getState(opts = {}) {
  const home = homeOf(opts);
  // Projet : celui que donne le serveur ; sans lui (appel direct), le dossier courant s'il n'est pas le dossier personnel.
  // Comparaison par chemins réels : un dossier personnel atteint par un lien n'est pas un projet.
  let project = opts.project !== undefined ? opts.project : null;
  const cwd = project || opts.cwd || home;
  if (opts.project === undefined && opts.cwd) project = (await real(opts.cwd)) !== (await real(home)) ? opts.cwd : null;
  if (project && (await real(project)) === (await real(home))) project = null;
  const scope = project ? 'all' : 'global';
  // Serveurs MCP : lus à part ; un échec ne bloque pas l'état des skills.
  const mcpP = mcpState({ home, project }).catch((e) => ({ error: e.message || 'Lecture des réglages MCP impossible.', detected: [], agents: [], servers: [] }));
  const plugP = pluginState({ home, project }).catch(() => ({ error: 'Lecture des plugins impossible.', agents: [], plugins: [] }));
  const [snap, settings, lockRaw, checked, cat, backups, version, catalogInfo, mcp, plugins] = await Promise.all([
    call('snapshot', [{ cwd: project || home, scope }], { home, cwd: project || home }),
    readSettings({ home }),
    readJson(lockPath(home), null),
    readJson(checkFile(home), null),
    catalog(),
    listBackups({ home }),
    appVersion(),
    catalogState(home),
    mcpP,
    plugP,
  ]);
  const agents = await listAgents({ home, settings, supported: snap.supported, detected: snap.detected });
  const lock = (lockRaw && lockRaw.skills) || {};
  const outdated = new Set((checked && Array.isArray(checked.outdated)) ? checked.outdated : []);
  const det = new Set(snap.detected);
  const infos = snap.supported.filter((a) => a.id !== 'universal');
  const sharedReaders = infos.filter((a) => readsShared(a) && det.has(a.id)).map((a) => a.id);
  // Agents avec leur propre dossier global : connus (hors lecteurs du dossier partagé) et personnalisés.
  const ownDirs = infos.filter((a) => !readsShared(a) && a.globalSkillsDir).map((a) => ({ id: a.id, dir: a.globalSkillsDir }))
    .concat(settings.custom.map((c) => ({ id: c.id, dir: c.dir })));
  const shared = sharedDir(home);
  const disabled = await readDisabled(home);

  const row = (name, src, inLock, p, sc) => {
    const id = src && OWNER_REPO.test(src) ? src + '/' + name : 'local/' + name;
    const c = cat[id];
    return {
      id, name, src: src || 'local', real: !!c, st: !inLock ? 'ng' : outdated.has(name) ? 'maj' : 'ok', on: true, ag: {},
      chars: null, desc: null, warn: 0, note: c && c.score && typeof c.score.total === 'number' ? c.score.total : null, scan: null, path: p, scope: sc,
    };
  };
  const finish = async (r, desc, scanDir) => {
    if (desc == null && scanDir) desc = descriptionOf(await readOrNull(path.join(scanDir, 'SKILL.md')));
    r.chars = typeof desc === 'string' ? desc.length : null;
    // Description du front matter : le guide d'usage la montre pour les skills hors catalogue (constat 77).
    r.desc = typeof desc === 'string' ? desc : null;
    r.scan = scanDir ? scanOf(scanDir) : null;
    r.warn = r.scan ? (r.scan.verdict === 'rouge' ? 2 : r.scan.verdict === 'orange' ? 1 : 0) : 0;
  };

  const mine = [];
  const seen = new Set();
  // Chemins réels des skills globaux : un skill de projet qui est en fait l'un d'eux n'est pas compté deux fois.
  const globalReal = new Set(await Promise.all(snap.skills.filter((s) => s.scope !== 'project').map((s) => real(s.path))));
  for (const s of snap.skills) {
    if (s.scope === 'project') {
      if (!project || globalReal.has(await real(s.path))) continue;
      const r = row(s.name, s.source, !!s.source, s.path, 'project');
      for (const a of s.agents) r.ag[a] = 'ok';
      await finish(r, s.description, s.path);
      mine.push(r);
      continue;
    }
    const folder = path.basename(s.path);
    const entry = lock[s.name] || lock[folder];
    const r = row(s.name, (entry && entry.source) || s.source, !!entry, s.path, 'global');
    const inShared = path.dirname(s.path) === shared;
    const sharedMd = inShared ? await readOrNull(path.join(s.path, 'SKILL.md')) : null;
    if (inShared) for (const id of sharedReaders) r.ag[id] = 'ok';
    for (const a of ownDirs) {
      const st = await agentStatus(path.join(a.dir, folder), sharedMd);
      if (st) r.ag[a.id] = st;
    }
    await finish(r, s.description, s.path);
    mine.push(r);
    seen.add(s.name); seen.add(folder);
  }

  // Liens cassés et skills des agents personnalisés, absents de la liste du paquet.
  for (const a of ownDirs) {
    for (const e of await readdirOrEmpty(a.dir)) {
      if (seen.has(e.name) || !NAME_RE.test(e.name) || (!e.isDirectory() && !e.isSymbolicLink())) continue;
      const p = path.join(a.dir, e.name);
      const st = await agentStatus(p, null);
      const md = await statOrNull(path.join(p, 'SKILL.md'));
      if (st !== 'ko' && !md) continue;
      // Clé du verrou par la règle du nom de dossier (clé « PDF » pour le dossier pdf).
      const k = keyIn(lock, e.name), entry = k ? lock[k] : null;
      let r = mine.find((x) => x.scope === 'global' && x.name === e.name && x._extra);
      if (!r) {
        r = row(e.name, entry && entry.source, !!entry, p, 'global');
        r._extra = true;
        await finish(r, null, st === 'ko' ? null : p);
        mine.push(r);
      }
      r.ag[a.id] = st;
    }
  }

  // Skills entièrement désactivés : rangés dans ~/.skill-advisor/disabled.
  for (const [name, list] of Object.entries(disabled)) {
    let r = mine.find((x) => x.scope === 'global' && (x.name === name || path.basename(x.path) === name));
    if (!r) {
      const k = keyIn(lock, name), entry = k ? lock[k] : null;
      const real = list.find((d) => d.agent === 'universal') || list[0];
      let dir = real.path;
      const l = await lstatOrNull(dir);
      if (l && l.isSymbolicLink()) {
        const own = ownDirs.find((a) => a.id === real.agent);
        dir = own ? path.resolve(own.dir, await fs.readlink(dir)) : dir;
      }
      const ok = await statOrNull(path.join(dir, 'SKILL.md'));
      r = row(name, entry && entry.source, !!entry, real.path, 'global');
      await finish(r, null, ok ? dir : null);
      mine.push(r);
    }
    r.off = list.map((d) => d.agent);
  }
  for (const r of mine) {
    if (r.off && Object.keys(r.ag).length === 0) r.on = false;
    delete r.off; delete r._extra;
  }
  mine.sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
  // Écran Agents : nombre de serveurs MCP de chaque agent (tous ses fichiers de réglages, global et projet).
  const mcpCount = {};
  for (const x of mcp.agents) mcpCount[x.id] = (mcpCount[x.id] || 0) + x.count;
  for (const a of agents) a.mcp = mcpCount[a.id] || 0;
  // Nombre de plugins de chaque agent (dossier personnel et projet ouvert).
  const plugCount = {};
  for (const x of plugins.agents) { plugCount[x.id] = x.count; x.verbs = verbsOf(x.id); }
  for (const a of agents) a.plugins = plugCount[a.id] || 0;
  return { mode: 'live', os: osName(), version, home, cwd, project: project || null, catalog: catalogInfo, agents, mine, backups, settings, mcp, plugins };
}
