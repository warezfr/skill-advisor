// Actions sur la machine : installer, supprimer, mettre à jour, vérifier, désactiver, réactiver.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { call, cli, mapError, parseOutdated } from './worker.mjs';
import { agentMap, listAgents } from './registry.mjs';
import { createBackup, loadMeta, readLockEntry, writeLockEntry } from './backups.mjs';
import { checkFile } from './inventory.mjs';
import { AGENT_RE, NAME_RE, checkAgentId, checkName, checkSource, copyTree, disabledDir, fail, fsMessage, homeOf, isSkillEntry, isTrackedSource, linkDir, lstatOrNull, readJson, safeJoin, scanOf, sharedDir, statOrNull, treeHash, writeJsonAtomic } from './util.mjs';

const UNIVERSAL = 'universal';
const names = (list) => {
  if (!Array.isArray(list)) throw fail('BAD_NAME', 'Liste de skills attendue.');
  return [...new Set(list.map(checkName))];
};
const agentIds = (list) => {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list)) throw fail('BAD_NAME', 'Liste d’agents attendue.');
  return [...new Set(list.map(checkAgentId))];
};
const copyFilter = async (src) => !!(await statOrNull(src));
// Sous-dossiers de ~/.skill-advisor/disabled.
const disabledIds = async (home) => (await fs.readdir(disabledDir(home)).catch(() => [])).filter((d) => AGENT_RE.test(d));
// Entrée d'échec conforme au contrat : { name, message }.
const failure = (name, message) => ({ name, message });

function known(map, ids) {
  for (const id of ids) if (!map[id]) throw fail('NOT_FOUND', 'Agent inconnu : ' + id + '.');
  return ids;
}

// Opérations du disque remplaçables par les tests (échec simulé entre deux volumes).
export const io = { rename: (a, b) => fs.rename(a, b), cp: (a, b, o) => fs.cp(a, b, o) };

// Déplace une entrée (dossier ou lien) sans suivre les liens, même entre deux volumes.
async function moveEntry(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try { await io.rename(src, dest); return; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  // Entre deux volumes : copie sous un nom caché voisin, renommage, puis effacement de la source.
  // Le point initial écarte ce nom des skills ; une copie ratée est effacée.
  const tmp = path.join(path.dirname(dest), '.sa-move-' + process.pid + '-' + Date.now() + '-' + path.basename(dest));
  try {
    const l = await fs.lstat(src);
    if (l.isSymbolicLink()) await fs.symlink(await fs.readlink(src), tmp);
    else await io.cp(src, tmp, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    await fs.rename(tmp, dest);
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
  await rmEntry(src);
}

// Applique tous les déplacements, ou défait ceux déjà faits. Rend l'erreur, ou null.
async function moveAll(moves) {
  const made = [];
  try {
    for (const m of moves) { await moveEntry(m.from, m.to); made.push(m); }
    return null;
  } catch (e) {
    for (const m of made.reverse()) await moveEntry(m.to, m.from).catch(() => {});
    return e;
  }
}

async function rmEntry(p) {
  const l = await lstatOrNull(p);
  if (!l) return false;
  if (l.isSymbolicLink() || !l.isDirectory()) await fs.unlink(p);
  else await fs.rm(p, { recursive: true, force: true });
  return true;
}

async function forgetOutdated(home, gone) {
  const c = await readJson(checkFile(home), null);
  if (!c || !Array.isArray(c.outdated)) return;
  c.outdated = c.outdated.filter((n) => !gone.includes(n));
  await writeJsonAtomic(checkFile(home), c);
}

// --- Installer ---

export async function install(opts = {}) {
  const home = homeOf(opts);
  const scope = opts.scope === 'project' ? 'project' : 'global';
  const cwd = opts.cwd || home;
  if (!Array.isArray(opts.items) || opts.items.length === 0) throw fail('BAD_NAME', 'Aucun skill à installer.');
  const items = opts.items.map((it) => ({ source: checkSource(it && it.source), skill: checkName(it && it.skill) }));
  let agents = agentIds(opts.agents);
  const map = await agentMap({ home });
  if (!agents || agents.length === 0) agents = (await listAgents({ home })).filter((a) => a.target).map((a) => a.id);
  known(map, agents);
  if (agents.length === 0) throw fail('NOT_FOUND', 'Aucun agent cible. Choisissez au moins un agent.');
  const custom = agents.filter((id) => map[id].custom);
  if (custom.length && scope !== 'global') throw fail('BAD_NAME', 'Les agents personnalisés reçoivent seulement des installations globales.');
  let lib = agents.filter((id) => !map[id].custom);
  if (lib.length === 0) lib = [UNIVERSAL];
  const installed = [], skipped = [], failed = [];
  let limit = null;
  const bySource = new Map();
  for (const it of items) bySource.set(it.source, [...(bySource.get(it.source) || []), it.skill]);
  for (const [source, skills] of bySource) {
    let res;
    try {
      res = await call('installSkills', [source, { skills, agents: lib, scope, mode: 'auto', cwd }], { home, cwd, timeoutMs: opts.timeoutMs });
    } catch (e) {
      if (e.code === 'GITHUB_LIMIT') limit = e;
      for (const s of skills) failed.push(failure(s, e.message));
      continue;
    }
    for (const t of res.installed) if (!installed.includes(t.skill)) installed.push(t.skill);
    for (const t of res.skipped) if (!skipped.includes(t.skill) && !installed.includes(t.skill)) skipped.push(t.skill);
    for (const f of res.failed) {
      const e = mapError(f.code, f.message);
      if (e.code === 'GITHUB_LIMIT') limit = e;
      if (!failed.some((x) => x.name === f.skill)) failed.push(failure(f.skill, e.message));
    }
    // Agents personnalisés : lien vers le dossier partagé, sinon copie.
    for (const name of custom.length ? skills : []) {
      const t = res.installed.find((x) => x.skill === name);
      if (!t) continue;
      const from = t.canonicalPath || t.path;
      for (const id of custom) {
        const at = safeJoin(map[id].dir, name);
        try {
          if (await lstatOrNull(at)) continue;
          if (path.dirname(from) === sharedDir(home)) await linkDir(from, at);
          else await fs.cp(from, at, { recursive: true, dereference: true, filter: copyFilter });
        } catch (e) {
          failed.push(failure(name, 'Installé, mais pas pour l’agent ' + id + ' : ' + fsMessage(e) + '.'));
        }
      }
    }
  }
  // Tout a buté sur la limite de GitHub : erreur 502 plutôt qu'une liste d'échecs.
  if (limit && !installed.length && !skipped.length) throw limit;
  return { installed, skipped, failed };
}

// --- Supprimer ---

export async function remove(opts = {}) {
  const home = homeOf(opts);
  const list = names(opts.names);
  const only = agentIds(opts.agents);
  const map = await agentMap({ home });
  if (only) known(map, only);
  const targets = only || Object.keys(map);
  const removed = [], backups = [], failed = [];
  for (const name of list) {
    const shared = safeJoin(sharedDir(home), name);
    const sharedOk = !!(await statOrNull(path.join(shared, 'SKILL.md')));
    // Agents qui ont ce skill, parmi ceux visés.
    const holders = [], entries = [];
    for (const id of targets) {
      const a = map[id];
      if (a.shared) { if (sharedOk && a.detected) holders.push(id); continue; }
      if (!a.dir) continue;
      const at = safeJoin(a.dir, name);
      if (await isSkillEntry(at)) { holders.push(id); entries.push({ id, at }); }
    }
    const touchesShared = !only || only.some((id) => map[id].shared);
    const sharedBefore = touchesShared && (await isSkillEntry(shared));
    // Entrées désactivées visées : ~/.skill-advisor/disabled/<agent>/<nom>.
    const off = [];
    const offIds = only ? [...only.filter((id) => !map[id].shared), ...(touchesShared ? [UNIVERSAL] : [])] : await disabledIds(home);
    for (const d of offIds) {
      const at = safeJoin(safeJoin(disabledDir(home), d), name);
      if (await isSkillEntry(at)) off.push({ id: d, at });
    }
    if (!holders.length && !sharedBefore && !off.length) {
      failed.push(failure(name, 'Skill introuvable : ' + name + '.'));
      continue;
    }
    // Un agent qui lit le dossier partagé ne peut pas perdre le skill seul, si d'autres le lisent encore.
    if (only && sharedBefore && only.every((id) => map[id].shared)) {
      const others = Object.values(map).filter((a) => a.shared && a.detected && !only.includes(a.id)).map((a) => a.id);
      for (const a of Object.values(map)) {
        if (a.shared || !a.dir) continue;
        const l = await lstatOrNull(safeJoin(a.dir, name));
        if (l && l.isSymbolicLink()) others.push(a.id);
      }
      if (others.length) {
        failed.push(failure(name, only.join(', ') + ' lit le dossier partagé ~/.agents/skills, encore utilisé par ' + others.join(', ') + '. Supprimez ce skill pour tous les agents.'));
        continue;
      }
    }
    // Sauvegarde, avant toute suppression, de chaque vrai dossier qui va disparaître :
    // dossier partagé, copies propres aux agents, entrées désactivées. Un seul exemplaire par dossier réel.
    if (opts.backup) {
      const places = [], seen = [];
      const add = async (agent, isOff, at) => {
        const l = await lstatOrNull(at);
        const real = l && l.isDirectory() ? await fs.realpath(at).catch(() => null) : null;
        if (!real || seen.includes(real)) return;
        seen.push(real);
        places.push({ agent, off: isOff, path: at });
      };
      if (touchesShared && sharedBefore) await add(UNIVERSAL, false, shared);
      for (const e of entries) await add(e.id, false, e.at);
      for (const e of off) await add(e.id, true, e.at);
      // Seulement des liens à supprimer : copie du dossier partagé, qui reste en place.
      if (!places.length && sharedOk) places.push({ agent: UNIVERSAL, off: false, path: shared });
      const agents = [...new Set([...holders, ...off.map((e) => e.id).filter((id) => map[id])])];
      if (places.length) {
        const lock = await readLockEntry(home, name);
        try {
          backups.push(await createBackup({ home, name, src: (lock && lock.source) || '', agents, places, lock }));
        } catch (e) {
          failed.push(failure(name, 'Sauvegarde impossible, rien n’a été supprimé. ' + e.message));
          continue;
        }
      }
    }
    // « Supprimé » se juge sur le disque, pas sur la réponse du paquet.
    let ok = false;
    const lib = targets.filter((id) => !map[id].custom);
    if (lib.length && (holders.length || sharedBefore)) {
      try {
        const r = await call('removeSkills', [[name], { scope: 'global', agents: only ? lib : undefined, cwd: home }], { home });
        for (const f of r.failed) failed.push(failure(name, mapError(f.code, f.message).message));
      } catch (e) {
        failed.push(failure(name, e.message));
        continue;
      }
    }
    // Agents personnalisés et liens cassés : le paquet ne les connaît pas.
    try {
      for (const e of entries) {
        const l = await lstatOrNull(e.at);
        if (!l) { ok = true; continue; }
        if (map[e.id].custom || (l.isSymbolicLink() && !(await statOrNull(e.at)))) { await rmEntry(e.at); ok = true; }
      }
      if (sharedBefore && !(await lstatOrNull(shared))) ok = true;
      for (const e of off) if (await rmEntry(e.at)) ok = true;
      if (!only && !(await lstatOrNull(shared)) && (await readLockEntry(home, name))) await writeLockEntry(home, name, null);
    } catch (e) {
      failed.push(failure(name, 'Suppression incomplète : ' + fsMessage(e) + '.'));
      continue;
    }
    if (ok) removed.push(name);
    else if (!failed.some((f) => f.name === name)) {
      const readers = (only || []).filter((id) => map[id].shared);
      failed.push(failure(name, readers.length
        ? readers.join(', ') + ' lit le dossier partagé ~/.agents/skills, encore utilisé par d’autres agents. Supprimez ce skill pour tous les agents.'
        : 'Le skill ' + name + ' n’a pas été supprimé.'));
    }
  }
  if (removed.length && !only) await forgetOutdated(home, removed);
  return { removed, backups, failed };
}

export async function removeAgentSkills(opts = {}) {
  const home = homeOf(opts);
  const id = checkAgentId(opts.agent);
  const map = await agentMap({ home });
  known(map, [id]);
  const dir = map[id].shared ? sharedDir(home) : map[id].dir;
  const list = [];
  for (const e of dir ? await fs.readdir(dir).catch(() => []) : []) {
    if (NAME_RE.test(e) && (await isSkillEntry(path.join(dir, e)))) list.push(e);
  }
  if (!list.length) return { removed: [], backups: [], failed: [] };
  return remove({ home, names: list, agents: [id], backup: !!opts.backup });
}

// --- Vérifier et mettre à jour ---

export async function check(opts = {}) {
  const home = homeOf(opts);
  const r = await cli(['check', '-g'], { home, cwd: home, timeoutMs: opts.timeoutMs });
  const text = r.stdout + '\n' + r.stderr;
  const all = parseOutdated(text);
  if (r.code !== 0 && r.code !== 1) throw mapError(undefined, text);
  if (!all.length && /Failed to check skills from|Failed to update/.test(text)) {
    const e = mapError(undefined, text);
    throw e.code === 'GITHUB_LIMIT' ? e : fail('CLI_FAILED', 'La vérification des mises à jour a échoué. Vérifiez la connexion, puis réessayez.', { detail: text.slice(-2000) });
  }
  // Un skill entièrement désactivé manque sur le disque : la CLI le croit à réinstaller.
  const outdated = [];
  for (const n of all) if (!(await lstatOrNull(safeJoin(safeJoin(disabledDir(home), UNIVERSAL), n)))) outdated.push(n);
  await writeJsonAtomic(checkFile(home), { at: new Date().toISOString(), outdated });
  return { outdated: outdated.map((name) => ({ name, scanNew: null })) };
}

// Mise à jour d'un seul skill par la CLI.
async function updateOne({ home, name, timeoutMs }) {
  const r = await cli(['update', name, '-g', '-y'], { home, cwd: home, timeoutMs });
  const text = r.stdout + '\n' + r.stderr;
  if (r.code !== 0 || /Failed to (update|check)/.test(text)) throw mapError(undefined, text);
}

// Vrais dossiers d'un skill (dossier partagé et copies des agents), hors liens.
async function realCopies(home, map, name) {
  const out = [];
  const shared = safeJoin(sharedDir(home), name);
  const l = await lstatOrNull(shared);
  if (l && l.isDirectory()) out.push(shared);
  for (const a of Object.values(map)) {
    if (!a.dir || a.custom) continue;
    const at = safeJoin(a.dir, name);
    const s = await lstatOrNull(at);
    if (s && s.isDirectory() && !out.includes(at)) out.push(at);
  }
  return out;
}

export async function update(opts = {}) {
  const home = homeOf(opts);
  const wanted = opts.names ? names(opts.names) : null;
  const force = opts.force ? names(opts.force) : [];
  const runCheck = opts.runCheck || (async () => (await check({ home, timeoutMs: opts.timeoutMs })).outdated.map((o) => o.name));
  const runUpdate = opts.runUpdate || updateOne;
  const outdated = await runCheck({ home });
  // Seulement les skills signalés par check ; un skill entièrement désactivé n'est pas réinstallé.
  const todo = [];
  for (const n of wanted || outdated) {
    if (!outdated.includes(n) || todo.includes(n)) continue;
    if (await lstatOrNull(safeJoin(safeJoin(disabledDir(home), UNIVERSAL), n))) continue;
    todo.push(n);
  }
  const map = await agentMap({ home });
  const updated = [], held = [], failed = [];
  for (const name of todo) {
    const copies = await realCopies(home, map, name);
    const lock = await readLockEntry(home, name);
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-update-'));
    const restore = async () => {
      for (const [i, c] of copies.entries()) {
        await fs.rm(c, { recursive: true, force: true });
        await fs.cp(path.join(tmp, String(i)), c, { recursive: true, verbatimSymlinks: true });
      }
      if (lock) await writeLockEntry(home, name, lock);
    };
    try {
      // Copie fidèle : les liens restent des liens, pour revenir tels quels.
      for (const [i, c] of copies.entries()) await copyTree(c, path.join(tmp, String(i)), { links: 'verbatim' });
      // Agents où le skill est désactivé : la mise à jour ne doit pas le remettre.
      const offAgents = [];
      for (const a of Object.values(map)) {
        if (a.dir && (await lstatOrNull(safeJoin(safeJoin(disabledDir(home), a.id), name))) && !(await lstatOrNull(safeJoin(a.dir, name)))) offAgents.push(a);
      }
      try {
        await runUpdate({ home, name, timeoutMs: opts.timeoutMs });
      } catch (e) {
        await restore();
        failed.push(failure(name, e.message));
        continue;
      } finally {
        for (const a of offAgents) await rmEntry(safeJoin(a.dir, name));
      }
      const dir = (await statOrNull(path.join(sharedDir(home), name, 'SKILL.md'))) ? safeJoin(sharedDir(home), name) : copies[0];
      const scan = dir ? scanOf(dir) : null;
      if (scan && scan.verdict === 'rouge' && !force.includes(name)) {
        await restore();
        held.push(name);
      } else updated.push(name);
    } catch (e) {
      failed.push(failure(name, e.code === 'BACKUP_FAILED' ? e.message : 'Mise à jour incomplète : ' + fsMessage(e) + '.'));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
  if (updated.length) await forgetOutdated(home, updated);
  return { updated, held, failed };
}

// --- Désactiver et réactiver ---

// Agents visés pour un skill : ids propres, et « universal » pour le dossier partagé.
function slots(map, only) {
  const ids = only || Object.keys(map);
  const own = ids.filter((id) => !map[id].shared && map[id].dir);
  const universal = ids.some((id) => map[id].shared) || !only;
  return { own, universal };
}

export async function disable(opts = {}) {
  const home = homeOf(opts);
  const list = names(opts.names);
  const only = agentIds(opts.agents);
  const map = await agentMap({ home });
  if (only) known(map, only);
  const { own, universal } = slots(map, only);
  const done = [], failed = [];
  for (const name of list) {
    const shared = safeJoin(sharedDir(home), name);
    const moves = [];
    // Seulement de vrais skills : un lien, ou un dossier avec SKILL.md.
    for (const id of own) {
      const at = safeJoin(map[id].dir, name);
      if (await isSkillEntry(at)) moves.push({ from: at, to: safeJoin(safeJoin(disabledDir(home), id), name) });
    }
    if (universal && (await isSkillEntry(shared))) {
      // Le dossier partagé ne part pas si un agent non visé y est encore lié.
      const users = [];
      for (const a of Object.values(map)) {
        if (!a.dir || own.includes(a.id)) continue;
        const at = safeJoin(a.dir, name);
        const l = await lstatOrNull(at);
        if (l && l.isSymbolicLink()) {
          const real = await fs.realpath(at).catch(() => null);
          if (real && real === (await fs.realpath(shared).catch(() => shared))) users.push(a.id);
        }
      }
      // Les autres agents détectés qui lisent le dossier partagé le perdraient aussi.
      if (only) for (const a of Object.values(map)) if (a.shared && a.detected && !only.includes(a.id)) users.push(a.id);
      if (users.length) {
        failed.push(failure(name, 'D’autres agents utilisent encore ce skill : ' + users.join(', ') + '. Désactivez-le aussi pour eux.'));
        continue;
      }
      moves.push({ from: shared, to: safeJoin(safeJoin(disabledDir(home), UNIVERSAL), name) });
    }
    if (!moves.length) { failed.push(failure(name, 'Rien à désactiver pour ' + name + '.')); continue; }
    const busy = [];
    for (const m of moves) if (await lstatOrNull(m.to)) busy.push(m.to);
    if (busy.length) { failed.push(failure(name, 'Ce skill est déjà désactivé pour cet agent.')); continue; }
    const err = await moveAll(moves);
    if (err) failed.push(failure(name, 'Désactivation annulée : ' + fsMessage(err) + '.'));
    else done.push(name);
  }
  return { done, failed };
}

export async function enable(opts = {}) {
  const home = homeOf(opts);
  const list = names(opts.names);
  const only = agentIds(opts.agents);
  const map = await agentMap({ home });
  if (only) known(map, only);
  const done = [], failed = [];
  for (const name of list) {
    const moves = [];
    // Sans liste d'agents : tous les sous-dossiers, sauf ceux d'agents disparus.
    const ids = only ? [...new Set(only.map((id) => (map[id].shared ? UNIVERSAL : id)))]
      : (await disabledIds(home)).filter((id) => id === UNIVERSAL || (map[id] && map[id].dir));
    // Dossier partagé d'abord, pour que les liens des agents retrouvent leur cible.
    ids.sort((a, b) => (a === UNIVERSAL ? -1 : b === UNIVERSAL ? 1 : 0));
    let bad = null;
    for (const id of ids) {
      const from = safeJoin(safeJoin(disabledDir(home), id), name);
      if (!(await lstatOrNull(from))) continue;
      const to = safeJoin(id === UNIVERSAL ? sharedDir(home) : map[id].dir, name);
      if (await lstatOrNull(to)) { bad = 'Un skill nommé ' + name + ' est déjà actif pour ' + id + '.'; break; }
      moves.push({ from, to });
    }
    if (bad) { failed.push(failure(name, bad)); continue; }
    if (!moves.length) { failed.push(failure(name, 'Rien à réactiver pour ' + name + '.')); continue; }
    const err = await moveAll(moves);
    if (err) failed.push(failure(name, 'Réactivation annulée : ' + fsMessage(err) + '.'));
    else done.push(name);
  }
  return { done, failed };
}

// --- Appliquer une sauvegarde ---

// État d'un emplacement, comparé au contenu sauvegardé (hash) : absent, lien cassé, autre (pas un dossier), même ou différent.
async function placeState(at, hash) {
  const l = await lstatOrNull(at);
  if (!l) return { kind: 'absent' };
  const link = l.isSymbolicLink();
  const real = await fs.realpath(at).catch(() => null);
  if (!real) return { kind: 'broken', link };
  const st = await statOrNull(real);
  if (!st || !st.isDirectory()) return { kind: 'other', link };
  return { kind: (await treeHash(real)) === hash ? 'same' : 'diff', link, real };
}

// Agents qui ont vraiment le skill, avant toute écriture (même règle que remove) : lecteurs détectés du dossier partagé
// quand il tient le skill, agents avec une entrée active dans leur propre dossier.
async function holdersOf(map, name, sh) {
  const out = [];
  for (const a of Object.values(map)) {
    if (a.shared) { if (a.detected && (sh.kind === 'same' || sh.kind === 'diff')) out.push(a.id); continue; }
    if (a.dir && (await isSkillEntry(safeJoin(a.dir, name)))) out.push(a.id);
  }
  return out;
}

const hiddenNear = (at, tag) => path.join(path.dirname(at), '.sa-' + tag + '-' + process.pid + '-' + Date.now() + '-' + path.basename(at));

// Pose une entrée neuve à la place de at : préparée sous un nom caché voisin, puis renommée.
// L'ancienne entrée est écartée, puis effacée ; elle revient si le renommage échoue. Jamais de skill à moitié écrit.
async function swapIn(at, make) {
  await fs.mkdir(path.dirname(at), { recursive: true });
  const tmp = hiddenNear(at, 'apply');
  const old = (await lstatOrNull(at)) ? hiddenNear(at, 'old') : null;
  try {
    await make(tmp);
    if (old) await fs.rename(at, old);
    try { await fs.rename(tmp, at); } catch (e) { if (old) await fs.rename(old, at).catch(() => {}); throw e; }
  } catch (e) {
    await rmEntry(tmp).catch(() => {});
    throw e;
  }
  if (old) await rmEntry(old).catch(() => {});
}


// Copie des skills choisis d'une sauvegarde vers les agents choisis.
// Lecteurs du dossier partagé : ~/.agents/skills/<nom>. Agents avec leur dossier : lien vers ce dossier. Agents personnalisés : copie.
export async function applyBackup(opts = {}) {
  const home = homeOf(opts);
  const { dir, meta } = await loadMeta(home, opts.id);
  const conflict = opts.conflict === undefined || opts.conflict === null ? 'skip' : opts.conflict;
  if (conflict !== 'skip' && conflict !== 'replace') throw fail('BAD_INPUT', 'Choix invalide en cas de conflit : skip ou replace.');
  const agents = agentIds(opts.agents);
  if (!agents || !agents.length) throw fail('BAD_INPUT', 'Choisissez au moins un agent.');
  const map = await agentMap({ home });
  known(map, agents);
  const wanted = opts.names === undefined || opts.names === null ? meta.items.map((i) => i.name) : names(opts.names);
  const force = opts.force ? names(opts.force) : [];
  const applied = [], skipped = [], failed = [], backups = [], warnings = [];
  const skip = (name, agent, reason) => skipped.push({ name, agent, reason });
  const failAt = (name, agent, message) => failed.push({ name, agent, message });
  for (const name of wanted) {
    const it = meta.items.find((i) => i.name === name);
    if (!it) { failAt(name, null, 'Ce skill n’est pas dans la sauvegarde : ' + name + '.'); continue; }
    const src = path.join(dir, name);
    if (!(await statOrNull(path.join(src, 'SKILL.md')))) { for (const id of agents) failAt(name, id, 'La sauvegarde ne contient plus le skill ' + name + '.'); continue; }
    // Contrôle statique refait sur la copie sauvegardée : rouge seulement si forcé.
    const scan = scanOf(src);
    if ((it.verdict === 'rouge' || !scan || scan.verdict === 'rouge') && !force.includes(name)) { for (const id of agents) skip(name, id, 'rouge'); continue; }
    const hash = await treeHash(src);
    const shared = safeJoin(sharedDir(home), name);
    const sh = await placeState(shared, hash);
    // Dossier partagé désactivé : ni les lecteurs du dossier partagé ni les agents liés à lui ne le reçoivent.
    const sharedOff = !!(await lstatOrNull(safeJoin(safeJoin(disabledDir(home), UNIVERSAL), name)));
    let plan = [], writeShared = false, replaceShared = false;
    for (const id of agents) {
      const a = map[id];
      if ((a.shared && sharedOff) || (!a.shared && (await lstatOrNull(safeJoin(safeJoin(disabledDir(home), id), name))))) {
        failAt(name, id, 'Ce skill est désactivé pour ' + id + '. Réactivez-le ou supprimez-le d’abord.');
        continue;
      }
      if (a.shared) {
        if (sh.kind === 'same') { skip(name, id, 'identical'); continue; }
        if (sh.kind === 'other') { failAt(name, id, 'Un fichier occupe la place du skill ' + name + ' dans ~/.agents/skills.'); continue; }
        if (sh.kind === 'diff') { if (conflict === 'skip') { skip(name, id, 'exists'); continue; } replaceShared = true; } else writeShared = true;
        plan.push({ id, kind: 'shared' });
        continue;
      }
      if (!a.dir) { failAt(name, id, 'Cet agent n’a pas de dossier de skills.'); continue; }
      const at = safeJoin(a.dir, name);
      const st = await placeState(at, hash);
      if (st.kind === 'same') { skip(name, id, 'identical'); continue; }
      if (st.kind === 'other') { failAt(name, id, 'Un fichier occupe la place du skill ' + name + ' pour ' + id + '.'); continue; }
      if (st.kind === 'diff' && conflict === 'skip') { skip(name, id, 'exists'); continue; }
      if (a.custom) { plan.push({ id, kind: 'copy', at, st }); continue; }
      if (sharedOff) { failAt(name, id, 'Ce skill est désactivé dans ~/.agents/skills. Réactivez-le ou supprimez-le d’abord.'); continue; }
      // Lien vers le dossier partagé : celui-ci doit tenir le contenu sauvegardé.
      if (sh.kind === 'other') { failAt(name, id, 'Un fichier occupe la place du skill ' + name + ' dans ~/.agents/skills.'); continue; }
      if (sh.kind === 'diff') { if (conflict === 'skip') { skip(name, id, 'exists'); continue; } replaceShared = true; } else if (sh.kind !== 'same') writeShared = true;
      plan.push({ id, kind: 'link', at, st, keep: st.kind === 'diff' && st.link && !!sh.real && st.real === sh.real });
    }
    if (!plan.length) continue;
    // Remplacement : sauvegarde d'abord de chaque vrai dossier qui sera écrasé.
    const places = [], seen = [];
    const keep = async (agent, at, st) => {
      if (!st || st.kind !== 'diff' || st.link || seen.includes(st.real)) return;
      seen.push(st.real);
      places.push({ agent, off: false, path: at });
    };
    if (replaceShared) await keep(UNIVERSAL, shared, sh);
    for (const p of plan) if (p.kind !== 'shared' && !p.keep) await keep(p.id, p.at, p.st);
    if (places.length) {
      try {
        const lock = await readLockEntry(home, name);
        backups.push(await createBackup({ home, name, src: (lock && lock.source) || '', agents: await holdersOf(map, name, sh), places, lock, origin: 'replace' }));
      } catch (e) {
        for (const p of plan) failAt(name, p.id, 'Sauvegarde impossible, rien n’a été remplacé. ' + e.message);
        continue;
      }
    }
    let sharedOk = sh.kind === 'same', sharedNew = false;
    if (writeShared || replaceShared) {
      try {
        await swapIn(shared, (tmp) => copyTree(src, tmp));
        sharedOk = true;
        sharedNew = true;
      } catch (e) {
        const msg = e.code === 'BACKUP_FAILED' ? e.message : 'Écriture impossible dans ~/.agents/skills : ' + fsMessage(e) + '.';
        for (const p of plan) if (p.kind !== 'copy') failAt(name, p.id, msg);
        plan = plan.filter((p) => p.kind === 'copy');
      }
    }
    let done = false;
    for (const p of plan) {
      try {
        if (p.kind === 'link' && !p.keep) await swapIn(p.at, (tmp) => linkDir(shared, tmp));
        else if (p.kind === 'copy') await swapIn(p.at, (tmp) => copyTree(src, tmp));
        applied.push({ name, agent: p.id });
        done = true;
      } catch (e) {
        failAt(name, p.id, e.code === 'BACKUP_FAILED' ? e.message : 'Application impossible pour ' + p.id + ' : ' + fsMessage(e) + '.');
      }
    }
    // Entrée de verrouillage sauvegardée : remise quand la source est connue et que le dossier partagé tient ce contenu.
    const lockSrc = it.lock && typeof it.lock.source === 'string' ? it.lock.source : '';
    const usable = !!it.lock && isTrackedSource(lockSrc) && (!it.src || it.src === lockSrc);
    try {
      if (usable && (sharedNew || (done && sharedOk))) {
        if (sharedNew || !(await readLockEntry(home, name))) await writeLockEntry(home, name, it.lock);
      } else if (!usable && sharedNew && (await readLockEntry(home, name))) {
        // Nouveau contenu sans origine connue : l'ancienne entrée le ferait passer pour l'ancien skill.
        await writeLockEntry(home, name, null);
        warnings.push(name + ' n’est plus suivi par les mises à jour : la sauvegarde ne dit pas d’où il vient.');
      }
    } catch (e) { failAt(name, null, 'Skill appliqué, mais le fichier de verrouillage n’a pas été mis à jour : ' + fsMessage(e) + '.'); }
  }
  return { applied, skipped, failed, backups, warnings };
}

