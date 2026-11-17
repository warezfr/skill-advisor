// Actions sur la machine : installer, désinstaller, mettre à jour, vérifier, désactiver, réactiver.
import fs from 'node:fs/promises';
import path from 'node:path';
import { cli, mapError, parseOutdated, session } from './worker.mjs';
import { agentMap, listAgents } from './registry.mjs';
import { backupKind, createBackup, loadMeta, writeLockEntry } from './backups.mjs';
import { checkFile } from './inventory.mjs';
import { AGENT_RE, NAME_RE, checkAgentId, checkName, checkSource, copyLink, copyTree, disabledDir, fail, fsMessage, homeOf, isSkillEntry, isTrackedSource, keyIn, linkDir, lockKeyFor, lockOf, lockSkills, lstatOrNull, mkdirp, readJson, renameRetry, retryBusy, rmOpts, safeJoin, scanOf, sharedDir, statOrNull, tmpDir, treeHash, within, writeJsonAtomic, folderOf } from './util.mjs';

// Règle du nom de dossier et clé du verrou : dans util.mjs (sans import circulaire avec backups.mjs), reprises ici.
export { folderOf, lockKey, lockOf } from './util.mjs';

const UNIVERSAL = 'universal';
// Pseudo-identifiant du dossier partagé ~/.agents/skills dans les requêtes.
export const SHARED = 'shared';
const names = (list) => {
  if (!Array.isArray(list)) throw fail('BAD_NAME', 'Liste de skills attendue.');
  return [...new Set(list.map(checkName))];
};
const agentIds = (list) => {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list)) throw fail('BAD_NAME', 'Liste d’agents attendue.');
  return [...new Set(list.map(checkAgentId))];
};
// Sous-dossiers de ~/.skill-advisor/disabled.
const disabledIds = async (home) => (await fs.readdir(disabledDir(home)).catch(() => [])).filter((d) => AGENT_RE.test(d));
// Entrée d'échec conforme au contrat : { name, message } ; detail (texte brut) part dans le terminal.
const failure = (name, message, detail) => (detail ? { name, message, detail } : { name, message });

function known(map, ids) {
  // Identifiant inconnu : jamais repris dans le message.
  for (const id of ids) if (!map[id]) throw fail('NOT_FOUND', 'Cet agent n’est pas sur cette machine. Actualisez la page, puis réessayez.');
  return ids;
}

// Nom affiché d'un agent ; « universal » est le dossier partagé. Jamais l'identifiant.
const label = (map, id) => (id === UNIVERSAL || id === SHARED ? 'le dossier partagé' : (map[id] && map[id].name) || 'un agent retiré');
const labels = (map, ids) => [...new Set(ids.map((id) => label(map, id)))].join(', ');
// « Cursor lit le dossier partagé » ou « Cursor, Codex lisent le dossier partagé ».
const reads = (map, ids) => { const l = [...new Set(ids.map((id) => label(map, id)))]; return l.join(', ') + (l.length > 1 ? ' lisent' : ' lit') + ' le dossier partagé'; };

// Lecteurs détectés du dossier partagé.
function detectedReaders(map) {
  return Object.values(map).filter((a) => a.shared && a.detected).map((a) => a.id);
}
// « shared » vaut les lecteurs détectés ; aucun détecté : tous les lecteurs connus.
function readers(map) {
  const det = detectedReaders(map);
  return det.length ? det : Object.values(map).filter((a) => a.shared).map((a) => a.id);
}
// « shared » vaut tous les lecteurs du dossier partagé.
function expandShared(map, ids) {
  if (!ids || !ids.includes(SHARED)) return ids;
  return [...new Set(ids.flatMap((id) => (id === SHARED ? readers(map) : [id])))];
}

// Opérations du disque remplaçables par les tests (échec simulé entre deux volumes, installation coupée).
// cp : copie fidèle sans limite de taille ; chaque lien interne est recréé avec son type (jonction sous Windows).
export const io = {
  rename: (a, b) => fs.rename(a, b),
  cp: (a, b) => copyTree(a, b, { links: 'verbatim', limit: Infinity, maxEntries: Infinity }),
  request: (s, fn, args, o) => s.request(fn, args, o),
  // Effacement de l'ancienne entrée écartée par swapIn.
  drop: (p) => rmEntry(p),
};

// Effacement patient : sous Windows, un fichier ouvert (antivirus, terminal) se libère souvent en quelques instants.

// Déplace une entrée (dossier ou lien) sans suivre les liens, même entre deux volumes.
async function moveEntry(src, dest) {
  await mkdirp(path.dirname(dest));
  try { await retryBusy(() => io.rename(src, dest)); return; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  // Entre deux volumes : copie sous un nom caché voisin, renommage, puis effacement de la source.
  // Le point initial écarte ce nom des skills ; une copie ratée est effacée.
  const tmp = path.join(path.dirname(dest), '.sa-move-' + process.pid + '-' + Date.now() + '-' + path.basename(dest));
  try {
    const l = await fs.lstat(src);
    // Lien recréé avec son type : jonction sous Windows (aucun droit spécial requis).
    if (l.isSymbolicLink()) await copyLink(src, tmp);
    else await io.cp(src, tmp);
    await renameRetry(tmp, dest);
  } catch (e) {
    await fs.rm(tmp, rmOpts()).catch(() => {});
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
  // Effacement retenté sous Windows (lien ou fichier encore ouvert par un autre programme).
  if (l.isSymbolicLink() || !l.isDirectory()) await retryBusy(() => fs.unlink(p));
  else await retryBusy(() => fs.rm(p, rmOpts()));
  return true;
}

async function forgetOutdated(home, gone) {
  const c = await readJson(checkFile(home), null);
  if (!c || !Array.isArray(c.outdated)) return;
  const lock = await lockSkills(home);
  // check.json garde les clés du verrou ; gone peut tenir des noms de dossier.
  c.outdated = c.outdated.filter((n) => !gone.includes(n) && !gone.includes(folderOf(n)) && !gone.some((g) => keyIn(lock, g) === n));
  await writeJsonAtomic(checkFile(home), c);
}

// Même source ? owner/repo, adresse GitHub ou autre adresse, sans .git ni / final, sans casse.
export function sameSource(a, b) {
  const norm = (s) => String(s || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '').replace(/^https:\/\/github\.com\//i, '').toLowerCase();
  return !!a && !!b && norm(a) === norm(b);
}

// --- Sources résolues : une session par source ---

// Dossier de travail privé sous ~/.skill-advisor/tmp.
async function workDir(home, tag) {
  await mkdirp(tmpDir(home));
  return fs.mkdtemp(path.join(tmpDir(home), tag + '-'));
}

// Résout une source dans l'enfant et pose une copie de chaque skill demandé dans un dossier de travail.
// Rend { sess, stage, info, staged: [{ name, skill, path } | { name, error }] } ; à fermer avec closeSource.
async function openSource(home, source, wanted, o = {}) {
  const sess = session({ home, cwd: o.cwd || home, timeoutMs: o.timeoutMs });
  let stage = null;
  try {
    const info = await io.request(sess, 'resolve', [source, { names: wanted, ...(o.ref ? { ref: o.ref } : {}) }], { timeoutMs: o.timeoutMs || 300000 });
    stage = await workDir(home, 'stage');
    const staged = await io.request(sess, 'stage', [{ names: wanted, dir: stage }], { timeoutMs: o.timeoutMs || 120000 });
    return { sess, stage, info, staged };
  } catch (e) {
    await sess.close();
    if (stage) await fs.rm(stage, rmOpts()).catch(() => {});
    throw e;
  }
}
async function closeSource(src) {
  if (!src) return;
  await src.sess.close();
  if (src.stage) await fs.rm(src.stage, rmOpts()).catch(() => {});
}
// Échec de pose d'un skill dans la copie de travail : skill absent de la source, ou autre cause.
function stageError(name, source, err) {
  return mapError(err.code, err.message, { notFound: 'Le skill ' + name + ' est introuvable dans ' + source + '.' });
}

// Vérification statique d'une copie de travail : échec du contrôle traité comme rouge.
function checkStaged(dir) {
  return scanOf(dir) || { verdict: 'rouge', findings: [] };
}

// --- Installer ---

// Toutes les entrées d'un dossier de skill sur la machine : dossier partagé, dossiers des agents, entrées désactivées.
async function entriesOf(home, map, folder) {
  const out = [];
  const shared = safeJoin(sharedDir(home), folder);
  if (await isSkillEntry(shared)) out.push({ agent: UNIVERSAL, off: false, at: shared });
  for (const a of Object.values(map)) {
    if (!a.dir) continue;
    const at = safeJoin(a.dir, folder);
    if (await isSkillEntry(at)) out.push({ agent: a.id, off: false, at });
  }
  for (const d of await disabledIds(home)) {
    const at = safeJoin(safeJoin(disabledDir(home), d), folder);
    if (await isSkillEntry(at)) out.push({ agent: d, off: true, at });
  }
  return out;
}

// Vrai si chaque entrée (dossier ou lien lisible) a le même contenu que ref.
async function sameContent(list, ref) {
  const want = await treeHash(ref);
  for (const at of list) {
    const real = await fs.realpath(at).catch(() => null);
    if (!real || (await treeHash(real).catch(() => null)) !== want) return false;
  }
  return list.length > 0;
}

// Places à sauvegarder avant un remplacement : vrais contenus lisibles, un seul exemplaire par dossier réel.
async function backupPlaces(home, map, entries) {
  const places = [], seen = [];
  for (const e of entries) {
    const l = await lstatOrNull(e.at);
    if (!l) continue;
    let target = e.at;
    const link = l.isSymbolicLink();
    if (link) {
      // Lien désactivé : sa cible relative se lit depuis le dossier de l'agent.
      const own = map[e.agent] && map[e.agent].dir;
      target = e.off && own ? path.resolve(own, await fs.readlink(e.at)) : e.at;
    }
    const real = await fs.realpath(target).catch(() => null);
    const md = real ? await statOrNull(path.join(real, 'SKILL.md')) : null;
    if (!md || !md.isFile() || seen.includes(real)) continue;
    seen.push(real);
    places.push({ agent: e.agent, off: e.off, path: target, ...(link ? { link: true } : {}) });
  }
  return places;
}

export async function install(opts = {}) {
  const home = homeOf(opts);
  const scope = opts.scope === 'project' ? 'project' : 'global';
  const project = opts.project !== undefined ? opts.project : (opts.cwd && path.resolve(opts.cwd) !== path.resolve(home) ? opts.cwd : null);
  if (!Array.isArray(opts.items) || opts.items.length === 0) throw fail('BAD_INPUT', 'Aucun skill à installer.');
  const map = await agentMap({ home });
  let agents = agentIds(opts.agents);
  if (!agents || agents.length === 0) agents = (await listAgents({ home })).filter((a) => a.target).map((a) => a.id);
  known(map, agents.filter((id) => id !== SHARED));
  if (agents.length === 0) throw fail('NOT_FOUND', 'Aucun agent cible. Choisissez au moins un agent.');
  const custom = agents.filter((id) => id !== SHARED && map[id].custom);
  if (custom.length && scope !== 'global') throw fail('BAD_NAME', 'Les agents personnalisés reçoivent seulement des installations globales.');
  if (scope === 'project' && !project) throw fail('BAD_INPUT', 'Choisissez d’abord le dossier du projet.');
  const cwd = scope === 'project' ? project : home;
  // Mode d'installation : dossier partagé visé → ~/.agents/skills et des liens ; sinon une copie par agent.
  const sharedOn = agents.some((id) => id === SHARED || map[id].shared);
  const own = agents.filter((id) => id !== SHARED && !map[id].shared && !map[id].custom);
  const replace = opts.replace ? names(opts.replace) : [];
  const force = opts.force ? names(opts.force) : [];
  const installed = [], held = [], conflicts = [], skipped = [], failed = [], backups = [], warnings = [];
  // Chaque élément validé seul : une source ou un nom refusé n'arrête pas les autres.
  const bySource = new Map();
  for (const it of opts.items) {
    const name = it && typeof it.skill === 'string' ? it.skill.slice(0, 200) : String(it && it.skill).slice(0, 80);
    try {
      checkName(it && it.skill);
      checkSource(it && it.source);
    } catch (e) {
      failed.push(failure(name, e.code === 'BAD_SOURCE' ? 'Skill Advisor ne sait pas installer depuis cette source. Installez ce skill à la main.' : 'Skill Advisor ne sait pas installer un skill qui porte ce nom. Installez-le à la main.'));
      continue;
    }
    const list = bySource.get(it.source) || [];
    if (!list.includes(it.skill)) list.push(it.skill);
    bySource.set(it.source, list);
  }
  let netErr = null;
  const lock = scope === 'global' ? await lockSkills(home) : {};
  for (const [source, skills] of bySource) {
    let src = null;
    try {
      src = await openSource(home, source, skills, { cwd, timeoutMs: opts.timeoutMs });
    } catch (e) {
      if (e.code === 'GITHUB_LIMIT' || e.code === 'NETWORK') netErr = e;
      const msg = e.code === 'SOURCE_NOT_FOUND' ? 'Source introuvable ou privée : ' + source + '. Elle a peut-être été renommée ou retirée.' : e.message;
      for (const s of skills) failed.push(failure(s, msg, e.detail));
      continue;
    }
    try {
      // Dossiers de projet des agents (portée projet seulement).
      const projectDirs = {};
      if (scope === 'project') for (const a of await io.request(src.sess, 'getSupportedAgents', [])) projectDirs[a.id] = a.projectSkillsDir;
      const ready = [];
      for (const st of src.staged) {
        if (st.error) { const e = stageError(st.name, source, st.error); failed.push(failure(st.name, e.message, e.detail)); continue; }
        const folder = path.basename(st.path);
        const wants = (list) => list.includes(st.name) || list.includes(folder);
        // 1. Contrôle statique de la copie de travail, avant toute écriture.
        const scan = checkStaged(st.path);
        if (scan.verdict === 'rouge' && !wants(force)) { held.push({ name: st.name, verdict: scan.verdict, findings: scan.findings }); continue; }
        // 2. Même nom déjà présent : copie faite à la main, ou autre source.
        if (scope === 'global') {
          const found = await entriesOf(home, map, folder);
          const key = keyIn(lock, folder);
          const entry = key ? lock[key] : null;
          let kind = !found.length ? null : !entry ? 'manual' : !sameSource(entry.source, source) && !sameSource(entry.sourceUrl, source) ? 'other-source' : null;
          // Contenu identique partout (copie déjà posée par Skill Advisor, sans verrou) : pas de conflit.
          if (kind && (await sameContent(found.map((f) => f.at), st.path))) kind = null;
          if (kind && !wants(replace)) { conflicts.push({ name: st.name, kind, src: entry && typeof entry.source === 'string' ? entry.source : '' }); continue; }
          if (kind) {
            try {
              const places = await backupPlaces(home, map, found);
              if (places.length) {
                const holders = [...new Set(found.filter((f) => map[f.agent]).map((f) => f.agent))];
                backups.push(await createBackup({ home, name: folder, src: (entry && entry.source) || '', agents: holders, places, lock: entry, origin: 'replace' }));
              }
            } catch (e) {
              failed.push(failure(st.name, 'Sauvegarde impossible, rien n’a été remplacé. ' + e.message));
              continue;
            }
            // L'ancienne entrée du verrou décrirait l'ancien contenu.
            if (key && key !== st.skill) await writeLockEntry(home, key, null).catch(() => {});
          }
        } else {
          // Projet : dossier partagé du projet et dossiers de projet des agents visés ; verrou skills-lock.json du projet.
          const dirs = [path.join(cwd, '.agents', 'skills'), ...own.map((id) => projectDirs[id]).filter(Boolean).map((d) => path.join(cwd, d))];
          const found = [];
          for (const d of [...new Set(dirs)]) { const at = safeJoin(d, folder); if (await isSkillEntry(at)) found.push(at); }
          const plock = await readJson(path.join(cwd, 'skills-lock.json'), null);
          const pk = plock && plock.skills ? keyIn(plock.skills, folder) : null;
          const pentry = pk ? plock.skills[pk] : null;
          let kind = !found.length ? null : !pentry ? 'manual' : !sameSource(pentry.source, source) && !sameSource(pentry.sourceUrl, source) ? 'other-source' : null;
          if (kind && (await sameContent(found, st.path))) kind = null;
          if (kind && !wants(replace)) { conflicts.push({ name: st.name, kind, src: pentry && typeof pentry.source === 'string' ? pentry.source : '' }); continue; }
        }
        ready.push({ ...st, folder });
      }
      if (!ready.length) continue;
      const pkg = ready.map((r) => r.skill);
      const lib = sharedOn ? [UNIVERSAL, ...own] : own;
      let res = { installed: [], skipped: [], failed: [] };
      if (lib.length) {
        try {
          res = await io.request(src.sess, 'install', [{ skills: pkg, agents: lib, mode: sharedOn ? 'symlink' : 'copy', scope, cwd }], { timeoutMs: opts.timeoutMs || 120000 });
        } catch (e) {
          for (const r of ready) failed.push(failure(r.name, e.message, e.detail));
          continue;
        }
      }
      for (const r of ready) {
        const ok = res.installed.filter((t) => t.skill === r.skill);
        for (const f of res.failed.filter((x) => x.skill === r.skill)) {
          const e = mapError(f.code, f.message);
          if (!failed.some((x) => x.name === r.name)) failed.push(failure(r.name, 'Installation impossible pour ' + label(map, f.agent) + '. ' + (e.code === 'CLI_FAILED' ? 'Réessayez.' : e.message), e.detail));
        }
        for (const t of res.skipped.filter((x) => x.skill === r.skill)) skipped.push({ name: r.name, agent: t.agent, reason: t.reason });
        // Agents personnalisés : lien vers le dossier partagé s'il est visé, sinon copie de la copie de travail.
        let customOk = 0;
        for (const id of custom) {
          const at = safeJoin(map[id].dir, r.folder);
          const canonical = safeJoin(sharedOn ? sharedDir(home) : path.dirname(r.path), r.folder);
          try {
            if (sharedOn && !ok.length) break;
            await swapIn(at, (tmp) => (sharedOn ? linkDir(canonical, tmp) : copyTree(r.path, tmp)), { home, warnings });
            customOk++;
          } catch (e) {
            failed.push(failure(r.name, 'Installé, mais pas pour l’agent ' + map[id].name + ' : ' + fsMessage(e) + '.'));
          }
        }
        if ((ok.length || (!lib.length && customOk)) && !installed.includes(r.name)) installed.push(r.name);
      }
    } finally {
      await closeSource(src);
    }
  }
  // Rien n'a pu être tenté à cause du réseau ou de la limite GitHub : erreur 502 plutôt qu'une liste d'échecs.
  if (netErr && !installed.length && !held.length && !conflicts.length && !skipped.length
    && failed.every((f) => f.message === netErr.message)) throw netErr;
  return { installed, held, conflicts, skipped, failed, backups, ...(warnings.length ? { warnings } : {}) };
}

// --- Désinstaller ---

// Vrai si at est un lien vers le dossier partagé du skill (shared), même cassé. Jamais une copie propre.
async function linksTo(at, shared, sharedReal) {
  const l = await lstatOrNull(at);
  if (!l || !l.isSymbolicLink()) return false;
  const raw = await fs.readlink(at).catch(() => null);
  // Jonction Windows : cible absolue, parfois préfixée de \\?\.
  const target = raw === null ? null : path.resolve(path.dirname(at), raw.replace(/^\\\\\?\\/, ''));
  if (target && within(target, shared) && within(shared, target)) return true;
  // Lien vers le même dossier réel par un autre chemin : seulement si le dossier partagé est un vrai dossier.
  return !!sharedReal && (await fs.realpath(at).catch(() => null)) === sharedReal;
}

// Reste-t-il une entrée du skill quelque part : dossier d'un agent ou entrée désactivée ?
async function anyEntryLeft(home, map, name) {
  for (const a of Object.values(map)) if (!a.shared && a.dir && (await isSkillEntry(safeJoin(a.dir, name)))) return true;
  for (const d of await disabledIds(home)) if (await isSkillEntry(safeJoin(safeJoin(disabledDir(home), d), name))) return true;
  return false;
}

// Pseudo-agent « shared » : retire le skill du dossier partagé ~/.agents/skills, sa version désactivée,
// et les liens des agents vers lui. Ne touche jamais la copie propre d'un agent (vrai dossier, ou lien vers autre chose).
async function removeShared(home, map, list, backup) {
  const removed = [], backups = [], failed = [];
  const off = safeJoin(disabledDir(home), UNIVERSAL);
  for (const name of list) {
    const shared = safeJoin(sharedDir(home), name);
    const offAt = safeJoin(off, name);
    const sl = await lstatOrNull(shared);
    const sharedIs = await isSkillEntry(shared);
    const offIs = await isSkillEntry(offAt);
    const sharedReal = sl && sl.isDirectory() ? await fs.realpath(shared).catch(() => null) : null;
    // Liens vers le dossier partagé, relevés avant tout effacement.
    const links = [];
    for (const a of Object.values(map)) {
      if (a.shared || !a.dir) continue;
      const at = safeJoin(a.dir, name);
      if (await linksTo(at, shared, sharedReal)) links.push({ id: a.id, at });
    }
    if (!sharedIs && !offIs && !links.length) { failed.push(failure(name, 'Ce skill n’est pas dans le dossier partagé : ' + name + '.')); continue; }
    if (backup) {
      // Le dossier partagé et sa version désactivée ; les liens reviennent par la liste des agents.
      const places = [];
      for (const [at, isOff] of [[shared, false], [offAt, true]]) {
        const real = await fs.realpath(at).catch(() => null);
        const md = real ? await statOrNull(path.join(real, 'SKILL.md')) : null;
        if (!md || !md.isFile() || places.some((p) => p.real === real)) continue;
        const l = await lstatOrNull(at);
        places.push({ agent: UNIVERSAL, off: isOff, path: at, real, ...(l && l.isSymbolicLink() ? { link: true } : {}) });
      }
      if (places.length) {
        const agents = [...new Set([...(sharedIs ? detectedReaders(map) : []), ...links.map((l) => l.id)])];
        const lk = await lockOf(home, name);
        const lock = lk ? lk.entry : null;
        try {
          backups.push(await createBackup({ home, name, src: (lock && lock.source) || '', agents, places: places.map(({ real, ...p }) => p), lock }));
        } catch (e) {
          failed.push(failure(name, 'Sauvegarde impossible, rien n’a été désinstallé. ' + e.message));
          continue;
        }
      }
    }
    try {
      for (const l of links) await rmEntry(l.at);
      if (sharedIs) await rmEntry(shared);
      if (offIs) await rmEntry(offAt);
    } catch (e) {
      failed.push(failure(name, 'Désinstallation incomplète : ' + fsMessage(e) + '.'));
      continue;
    }
    // Une copie propre restante garde son entrée de verrou : elle reste suivie par les mises à jour.
    if (!(await anyEntryLeft(home, map, name))) {
      const lk = await lockOf(home, name);
      if (lk) await writeLockEntry(home, lk.key, null);
      await forgetOutdated(home, [name]);
    }
    removed.push(name);
  }
  return { removed, backups, failed };
}

export async function remove(opts = {}) {
  const home = homeOf(opts);
  const list = names(opts.names);
  const asked = agentIds(opts.agents);
  // « shared » : le dossier partagé et les liens vers lui seulement. Les autres agents demandés suivent la règle générale.
  if (asked && asked.includes(SHARED)) {
    const map = await agentMap({ home });
    const rest = asked.filter((id) => id !== SHARED);
    // Tout identifiant est contrôlé avant la première écriture.
    known(map, expandShared(map, rest));
    const a = await removeShared(home, map, list, !!opts.backup);
    if (!rest.length) return a;
    const b = await remove({ ...opts, agents: rest });
    const removed = [...new Set([...a.removed, ...b.removed])];
    // Un nom retiré d'un côté n'est pas un échec de l'autre (le lien déjà parti, par exemple).
    const failed = [...a.failed, ...b.failed].filter((f) => !removed.includes(f.name));
    return { removed, backups: [...a.backups, ...b.backups], failed };
  }
  const map = await agentMap({ home });
  const only = expandShared(map, asked);
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
        failed.push(failure(name, reads(map, only) + ', encore utilisé par ' + labels(map, others) + '. Désinstallez ce skill pour tous ces agents.'));
        continue;
      }
    }
    // Sauvegarde, avant toute suppression, de chaque entrée qui va disparaître : dossier partagé, copies et liens
    // des agents, entrées désactivées. Un lien garde son agent (link: true) ; une entrée désactivée garde off.
    if (opts.backup) {
      const places = [], seen = [];
      const add = async (agent, isOff, at) => {
        const l = await lstatOrNull(at);
        if (!l) return;
        const link = l.isSymbolicLink();
        let target = at;
        if (link && isOff && map[agent] && map[agent].dir) {
          target = path.resolve(map[agent].dir, await fs.readlink(at));
          // Cible dans le dossier partagé, lui-même désactivé : son contenu est dans disabled/universal.
          if (!(await statOrNull(target)) && path.dirname(target) === sharedDir(home)) target = safeJoin(safeJoin(disabledDir(home), UNIVERSAL), path.basename(target));
        }
        const real = await fs.realpath(target).catch(() => null);
        const md = real ? await statOrNull(path.join(real, 'SKILL.md')) : null;
        if (!md || !md.isFile()) return;
        // Une entrée active liée au dossier partagé sauvegardé revient comme lien : pas de place à elle.
        // Une entrée désactivée garde toujours sa place, pour revenir désactivée.
        if (!isOff && seen.includes(real)) return;
        seen.push(real);
        places.push({ agent, off: isOff, path: target, ...(link ? { link: true } : {}) });
      };
      if (touchesShared && sharedBefore) await add(UNIVERSAL, false, shared);
      for (const e of entries) await add(e.id, false, e.at);
      for (const e of off) await add(e.id, true, e.at);
      const agents = [...new Set([...holders, ...off.map((e) => e.id).filter((id) => map[id])])];
      if (places.length) {
        const lk = await lockOf(home, name);
        const lock = lk ? lk.entry : null;
        try {
          backups.push(await createBackup({ home, name, src: (lock && lock.source) || '', agents, places, lock }));
        } catch (e) {
          failed.push(failure(name, 'Sauvegarde impossible, rien n’a été désinstallé. ' + e.message));
          continue;
        }
      }
    }
    // « Désinstallé » se juge sur le disque, pas sur la réponse du paquet.
    let ok = false;
    const lib = targets.filter((id) => !map[id].custom);
    if (lib.length && (holders.length || sharedBefore)) {
      const s = session({ home });
      try {
        const r = await s.request('removeSkills', [[name], { scope: 'global', agents: only ? lib : undefined, cwd: home }]);
        for (const f of r.failed) { const e = mapError(f.code, f.message); failed.push(failure(name, e.message, e.detail)); }
      } catch (e) {
        failed.push(failure(name, e.message, e.detail));
        continue;
      } finally { await s.close(); }
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
      if (!only && !(await lstatOrNull(shared))) {
        const lk = await lockOf(home, name);
        if (lk) await writeLockEntry(home, lk.key, null);
      }
    } catch (e) {
      failed.push(failure(name, 'Désinstallation incomplète : ' + fsMessage(e) + '.'));
      continue;
    }
    if (ok) removed.push(name);
    else if (!failed.some((f) => f.name === name)) {
      const rd = (only || []).filter((id) => map[id].shared);
      failed.push(failure(name, rd.length
        ? reads(map, rd) + ', encore utilisé par d’autres agents. Désinstallez ce skill pour tous ces agents.'
        : 'Le skill ' + name + ' n’a pas été désinstallé.'));
    }
  }
  if (removed.length && !only) await forgetOutdated(home, removed);
  return { removed, backups, failed };
}

// Retire tous les skills d'un agent. Un lecteur du dossier partagé ne peut pas le vider seul : erreur SHARED.
export async function removeAgentSkills(opts = {}) {
  const home = homeOf(opts);
  const id = checkAgentId(opts.agent);
  const map = await agentMap({ home });
  if (id === SHARED || (map[id] && map[id].shared)) {
    const dir = sharedDir(home);
    let n = 0;
    for (const e of await fs.readdir(dir).catch(() => [])) if (NAME_RE.test(e) && (await isSkillEntry(path.join(dir, e)))) n++;
    if (!n) return { removed: [], backups: [], failed: [] };
    // readers : lecteurs détectés du dossier partagé ; l'interface propose de désinstaller ces skills pour eux tous.
    const rd = detectedReaders(map);
    const who = rd.length ? ' Ses lecteurs : ' + labels(map, rd) + '.' : '';
    const head = id === SHARED ? 'Le dossier partagé (~/.agents/skills) sert à tous les agents qui le lisent.'
      : map[id].name + ' lit le dossier partagé (~/.agents/skills), comme d’autres agents.';
    throw fail('SHARED', head + who + ' Désinstallez ces skills du dossier partagé pour tous ces agents.', { readers: rd });
  }
  known(map, [id]);
  const dir = map[id].dir;
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
    throw e.code === 'CLI_FAILED' ? fail('CLI_FAILED', 'La vérification des mises à jour a échoué. Vérifiez la connexion, puis réessayez.', { detail: text.slice(-2000) }) : e;
  }
  // Un skill entièrement désactivé manque sur le disque : la CLI le croit à réinstaller.
  const outdated = [];
  for (const n of all) {
    const off = safeJoin(disabledDir(home), UNIVERSAL);
    if (!(await lstatOrNull(safeJoin(off, n))) && !(await lstatOrNull(safeJoin(off, folderOf(n))))) outdated.push(n);
  }
  // save: false : le serveur écrit check.json lui-même, dans sa file des écritures (saveCheck).
  if (opts.save !== false) await saveCheck({ home, outdated });
  return { outdated: outdated.map((name) => ({ name, scanNew: null })) };
}

// Écrit ~/.skill-advisor/check.json : clés du verrou qui ont une mise à jour.
export async function saveCheck(opts = {}) {
  const home = homeOf(opts);
  const list = opts.outdated;
  if (!Array.isArray(list) || list.some((n) => typeof n !== 'string' || n.length > 255)) throw fail('BAD_INPUT', 'Liste de skills à mettre à jour invalide.');
  await writeJsonAtomic(checkFile(home), { at: new Date().toISOString(), outdated: [...new Set(list)] });
}

// Qui tient un skill avant une mise à jour : dossier partagé réel, agents liés à lui, copies propres, agents personnalisés.
async function holdersOfSkill(home, map, folder) {
  const shared = safeJoin(sharedDir(home), folder);
  const sl = await lstatOrNull(shared);
  const sharedReal = sl && sl.isDirectory() && (await statOrNull(path.join(shared, 'SKILL.md'))) ? await fs.realpath(shared) : null;
  const h = { shared: sharedReal ? shared : null, links: [], copies: [], customCopies: [], none: [] };
  for (const a of Object.values(map)) {
    if (a.shared || !a.dir) continue;
    const at = safeJoin(a.dir, folder);
    const l = await lstatOrNull(at);
    if (!l) { if (!a.custom) h.none.push(a.id); continue; }
    if (l.isSymbolicLink()) {
      const real = await fs.realpath(at).catch(() => null);
      if (!a.custom && real && real === sharedReal) h.links.push(a.id);
      continue;
    }
    if (l.isDirectory() && (await statOrNull(path.join(at, 'SKILL.md')))) (a.custom ? h.customCopies : h.copies).push({ id: a.id, at });
  }
  return h;
}

// Remet src (copie fidèle) à la place de at sans rien détruire d'abord : copie voisine cachée, ancien écarté, renommage.
async function putBack(src, at, ctx) {
  await swapIn(at, (tmp) => copyTree(src, tmp, { links: 'verbatim' }), ctx);
}

// Source à résoudre pour une entrée du verrou.
function lockSource(entry) {
  if (entry.sourceType === 'well-known' && typeof entry.sourceBaseUrl === 'string') return entry.sourceBaseUrl;
  return typeof entry.sourceUrl === 'string' && entry.sourceUrl ? entry.sourceUrl : entry.source;
}

export async function update(opts = {}) {
  const home = homeOf(opts);
  const wanted = opts.names ? names(opts.names) : null;
  const force = opts.force ? names(opts.force) : [];
  const runCheck = opts.runCheck || (async () => (await check({ home, timeoutMs: opts.timeoutMs })).outdated.map((o) => o.name));
  const outdated = await runCheck({ home });
  // check rend des clés du verrou ; names tient des noms de dossier.
  const outFolders = new Map();
  // Le paquet installe dans le dossier folderOf(clé).
  for (const k of outdated) outFolders.set(folderOf(k), k);
  const updated = [], held = [], failed = [], warnings = [];
  const todo = [];
  for (const n of wanted || [...outFolders.keys()]) {
    if (todo.includes(n)) continue;
    const key = outFolders.has(n) ? outFolders.get(n) : [...outFolders.values()].find((k) => folderOf(k) === n);
    if (!key) { if (wanted) failed.push(failure(n, 'Rien à mettre à jour pour ' + n + '.')); continue; }
    // Un skill entièrement désactivé n'est pas réinstallé.
    if (await lstatOrNull(safeJoin(safeJoin(disabledDir(home), UNIVERSAL), n))) continue;
    todo.push(n);
  }
  const map = await agentMap({ home });
  for (const name of todo) {
    const lk = await lockOf(home, name);
    if (!lk) { failed.push(failure(name, 'Ce skill n’est pas suivi par les mises à jour : il a été copié à la main.')); continue; }
    const before = await holdersOfSkill(home, map, name);
    if (!before.shared && !before.copies.length && !before.customCopies.length) { failed.push(failure(name, 'Skill introuvable sur la machine : ' + name + '.')); continue; }
    let src = null, snap = null;
    try {
      src = await openSource(home, lockSource(lk.entry), [lk.key], { ref: lk.entry.ref, timeoutMs: opts.timeoutMs });
    } catch (e) {
      failed.push(failure(name, e.code === 'SOURCE_NOT_FOUND' ? 'Source introuvable ou privée : ' + lk.entry.source + '. Elle a peut-être été renommée ou retirée.' : e.message, e.detail));
      continue;
    }
    try {
      const st = src.staged[0];
      if (!st || st.error) { const e = stageError(lk.key, lk.entry.source, (st && st.error) || {}); failed.push(failure(name, e.message, e.detail)); continue; }
      // Nouvelle version vérifiée avant toute écriture.
      const scan = checkStaged(st.path);
      if (scan.verdict === 'rouge' && !force.includes(name) && !force.includes(lk.key)) { held.push(name); continue; }
      // Copie fidèle de chaque vrai dossier, pour revenir en arrière.
      const reals = [...(before.shared ? [before.shared] : []), ...before.copies.map((c) => c.at), ...before.customCopies.map((c) => c.at)];
      snap = await workDir(home, 'update');
      for (const [i, c] of reals.entries()) await copyTree(c, path.join(snap, String(i)), { links: 'verbatim' });
      try {
        // Copies propres d'abord, dossier partagé et ses liens ensuite : le verrou garde le mode du dossier partagé.
        const runs = [];
        if (before.copies.length) runs.push({ agents: before.copies.map((c) => c.id), mode: 'copy' });
        if (before.shared) runs.push({ agents: [UNIVERSAL, ...before.links], mode: 'symlink' });
        for (const r of runs) {
          const res = await io.request(src.sess, 'install', [{ skills: [st.skill], agents: r.agents, mode: r.mode, scope: 'global', cwd: home }], { timeoutMs: opts.timeoutMs || 120000 });
          if (res.failed.length) throw mapError(res.failed[0].code, res.failed[0].message);
        }
        for (const c of before.customCopies) await swapIn(c.at, (tmp) => copyTree(st.path, tmp), { home, warnings });
        // Aucun agent ne gagne le skill : une entrée apparue chez un agent qui ne l'avait pas est retirée.
        for (const id of before.none) {
          const at = safeJoin(map[id].dir, name);
          if (await lstatOrNull(at)) await rmEntry(at);
        }
      } catch (e) {
        let kept = '';
        try {
          for (const [i, c] of reals.entries()) await putBack(path.join(snap, String(i)), c, { home, warnings });
          for (const id of before.none) { const at = safeJoin(map[id].dir, name); if (await lstatOrNull(at)) await rmEntry(at); }
          await writeLockEntry(home, lk.key, lk.entry);
        } catch (e2) {
          // Remise en place ratée : l'ancienne version part dans les sauvegardes, sinon reste à part (jamais balayée).
          const owners = [...(before.shared ? [UNIVERSAL] : []), ...before.copies.map((c) => c.id), ...before.customCopies.map((c) => c.id)];
          try {
            await createBackup({ home, name, src: lk.entry.source || '', agents: [], origin: 'replace', lock: lk.entry,
              places: reals.map((c, i) => ({ agent: owners[i], off: false, path: path.join(snap, String(i)) })) });
            kept = ' Une sauvegarde de l’ancienne version est gardée.';
          } catch {
            const keep = path.join(path.dirname(snap), 'kept-' + path.basename(snap));
            await fs.rename(snap, keep).catch(() => {});
            kept = ' L’ancienne version est gardée dans ' + keep + '.';
            snap = null;
          }
        }
        failed.push(failure(name, (e.code === 'BACKUP_FAILED' || e.code === 'NETWORK' || e.code === 'GITHUB_LIMIT' || e.code === 'SOURCE_NOT_FOUND' ? e.message : 'Mise à jour annulée : ' + (e.code && /^E[A-Z]+$/.test(e.code) ? fsMessage(e) : 'l’outil skills a échoué') + '.') + kept, e.detail));
        continue;
      }
      updated.push(name);
    } catch (e) {
      failed.push(failure(name, e.code === 'BACKUP_FAILED' ? e.message : 'Mise à jour impossible : ' + fsMessage(e) + '.'));
    } finally {
      await closeSource(src);
      if (snap) await fs.rm(snap, rmOpts()).catch(() => {});
    }
  }
  if (updated.length) await forgetOutdated(home, updated);
  return { updated, held, failed, ...(warnings.length ? { warnings } : {}) };
}

// --- Ce qui change ---

// Fichiers d'un dossier, chemins relatifs avec des / : contenu lu (liens internes suivis, comme treeHash).
async function filesOf(dir) {
  const out = new Map();
  const root = await fs.realpath(dir);
  const walk = async (d, rel, stack) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      let p = path.join(d, e.name), st = null;
      if (e.isSymbolicLink()) {
        p = await fs.realpath(p).catch(() => null);
        st = p && (p === root || p.startsWith(root + path.sep)) ? await statOrNull(p) : null;
        if (!st || (st.isDirectory() && stack.includes(p))) continue;
      }
      const isDir = st ? st.isDirectory() : e.isDirectory();
      if (isDir) { if (e.name !== '.git') await walk(p, rel + e.name + '/', [...stack, p]); } else if (st ? st.isFile() : e.isFile()) out.set(rel + e.name, await fs.readFile(p));
    }
  };
  await walk(root, '', [root]);
  return out;
}
// Lignes ajoutées et retirées (comptées sans ordre : un aperçu, pas un diff exact).
function lineCounts(a, b) {
  const split = (buf) => (buf ? buf.toString('utf8').replace(/\r\n/g, '\n').split('\n') : []);
  const old = new Map();
  for (const l of split(a)) old.set(l, (old.get(l) || 0) + 1);
  let added = 0;
  for (const l of split(b)) { const n = old.get(l) || 0; if (n) old.set(l, n - 1); else added++; }
  let removed = 0;
  for (const n of old.values()) removed += n;
  return { added, removed };
}

// Aperçu d'une mise à jour : nouvelle version résolue dans un dossier de travail, comparée au contenu installé.
export async function preview(opts = {}) {
  const home = homeOf(opts);
  const name = checkName(opts.name);
  const lk = await lockOf(home, name);
  if (!lk) throw fail('NOT_FOUND', 'Ce skill n’est pas suivi par les mises à jour : ' + name + '.');
  const map = await agentMap({ home });
  const h = await holdersOfSkill(home, map, name);
  const current = h.shared || (h.copies[0] && h.copies[0].at) || (h.customCopies[0] && h.customCopies[0].at);
  if (!current) throw fail('NOT_FOUND', 'Skill introuvable sur la machine : ' + name + '.');
  let src;
  try {
    src = await openSource(home, lockSource(lk.entry), [lk.key], { ref: lk.entry.ref, timeoutMs: opts.timeoutMs });
  } catch (e) {
    if (e.code === 'SOURCE_NOT_FOUND') throw fail('SOURCE_NOT_FOUND', 'Source introuvable ou privée : ' + lk.entry.source + '. Elle a peut-être été renommée ou retirée.', { detail: e.detail });
    throw e;
  }
  try {
    const st = src.staged[0];
    if (!st || st.error) throw stageError(lk.key, lk.entry.source, (st && st.error) || {});
    const [a, b] = await Promise.all([filesOf(current), filesOf(st.path)]);
    const files = [];
    for (const p of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const x = a.get(p), y = b.get(p);
      if (x && y && x.equals(y)) continue;
      files.push({ path: p, status: !x ? 'added' : !y ? 'removed' : 'changed', ...lineCounts(x, y) });
    }
    const scan = checkStaged(st.path);
    const old = scanOf(current);
    return { name, files, scan: { verdict: scan.verdict, findings: scan.findings }, scanOld: { verdict: old ? old.verdict : null }, same: files.length === 0 };
  } finally {
    await closeSource(src);
  }
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
  const map = await agentMap({ home });
  const only = expandShared(map, agentIds(opts.agents));
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
        failed.push(failure(name, 'D’autres agents utilisent encore ce skill : ' + labels(map, users) + '. Désactivez-le aussi pour eux.'));
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
  const map = await agentMap({ home });
  const only = expandShared(map, agentIds(opts.agents));
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
      if (await lstatOrNull(to)) { bad = 'Un skill nommé ' + name + ' est déjà actif pour ' + label(map, id) + '.'; break; }
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

// Efface l'ancienne entrée écartée par swapIn : deux essais. Encore là : déplacée sous ~/.skill-advisor/tmp
// (balayé au démarrage), sinon laissée en place ; dans les deux cas, ctx.warnings le dit.
async function dropOld(old, name, ctx = {}) {
  for (let i = 0; i < 2; i++) {
    try { await io.drop(old); return; } catch { if (i === 0) await new Promise((r) => setTimeout(r, 150)); }
  }
  const say = (t) => { if (Array.isArray(ctx.warnings)) ctx.warnings.push(t); };
  if (ctx.home) {
    const to = path.join(tmpDir(ctx.home), 'old-' + process.pid + '-' + Date.now() + '-' + name);
    try {
      await mkdirp(tmpDir(ctx.home));
      await renameRetry(old, to);
      say('L’ancienne version de ' + name + ' n’a pas pu être effacée. Elle a été rangée dans ' + to + '. Skill Advisor l’effacera plus tard.');
      return;
    } catch { /* autre disque, fichier occupé : laissée en place */ }
  }
  say('L’ancienne version de ' + name + ' n’a pas pu être effacée. Elle reste dans ' + old + '. Vous pouvez effacer ce dossier.');
}

// Pose une entrée neuve à la place de at : préparée sous un nom caché voisin, puis renommée.
// L'ancienne entrée est écartée, puis effacée ; elle revient si le renommage échoue. Jamais de skill à moitié écrit.
// ctx = { home, warnings } : où ranger l'ancienne entrée si elle résiste, et où le dire.
async function swapIn(at, make, ctx = {}) {
  await fs.mkdir(path.dirname(at), { recursive: true });
  const tmp = hiddenNear(at, 'apply');
  const old = (await lstatOrNull(at)) ? hiddenNear(at, 'old') : null;
  try {
    await make(tmp);
    // Renommages retentés sous Windows (fichier tout juste écrit, encore ouvert par l'antivirus).
    if (old) await renameRetry(at, old);
    try { await renameRetry(tmp, at); } catch (e) { if (old) await renameRetry(old, at).catch(() => {}); throw e; }
  } catch (e) {
    await rmEntry(tmp).catch(() => {});
    throw e;
  }
  if (old) await dropOld(old, path.basename(at), ctx);
}


// Copie des skills choisis d'une sauvegarde vers les agents choisis.
// Lecteurs du dossier partagé : ~/.agents/skills/<nom>. Agents avec leur dossier : lien vers ce dossier. Agents personnalisés : copie.
export async function applyBackup(opts = {}) {
  const home = homeOf(opts);
  const kind = await backupKind(home, opts.id);
  if (kind === 'mcp') return (await import('./mcp-backups.mjs')).applyMcpBackup(opts);
  if (kind === 'config') throw fail('UNSUPPORTED', 'Une sauvegarde de toute la configuration se restaure ; elle ne s’applique pas à d’autres agents.');
  const { dir, meta } = await loadMeta(home, opts.id);
  const conflict = opts.conflict === undefined || opts.conflict === null ? 'skip' : opts.conflict;
  if (conflict !== 'skip' && conflict !== 'replace') throw fail('BAD_INPUT', 'Choix invalide en cas de conflit : skip ou replace.');
  const map = await agentMap({ home });
  const agents = expandShared(map, agentIds(opts.agents));
  if (!agents || !agents.length) throw fail('BAD_INPUT', 'Choisissez au moins un agent.');
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
        failAt(name, id, 'Ce skill est désactivé pour ' + label(map, id) + '. Activez-le ou désinstallez-le d’abord.');
        continue;
      }
      if (a.shared) {
        if (sh.kind === 'same') { skip(name, id, 'identical'); continue; }
        if (sh.kind === 'other') { failAt(name, id, 'Un fichier occupe la place du skill ' + name + ' dans le dossier partagé.'); continue; }
        if (sh.kind === 'diff') { if (conflict === 'skip') { skip(name, id, 'exists'); continue; } replaceShared = true; } else writeShared = true;
        plan.push({ id, kind: 'shared' });
        continue;
      }
      if (!a.dir) { failAt(name, id, 'Cet agent n’a pas de dossier de skills.'); continue; }
      const at = safeJoin(a.dir, name);
      const st = await placeState(at, hash);
      if (st.kind === 'same') { skip(name, id, 'identical'); continue; }
      if (st.kind === 'other') { failAt(name, id, 'Un fichier occupe la place du skill ' + name + ' pour ' + label(map, id) + '.'); continue; }
      if (st.kind === 'diff' && conflict === 'skip') { skip(name, id, 'exists'); continue; }
      if (a.custom) { plan.push({ id, kind: 'copy', at, st }); continue; }
      if (sharedOff) { failAt(name, id, 'Ce skill est désactivé dans le dossier partagé. Activez-le ou désinstallez-le d’abord.'); continue; }
      // Lien vers le dossier partagé : celui-ci doit tenir le contenu sauvegardé.
      if (sh.kind === 'other') { failAt(name, id, 'Un fichier occupe la place du skill ' + name + ' dans le dossier partagé.'); continue; }
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
        const lk = await lockOf(home, name);
        const lock = lk ? lk.entry : null;
        backups.push(await createBackup({ home, name, src: (lock && lock.source) || '', agents: await holdersOf(map, name, sh), places, lock, origin: 'replace' }));
      } catch (e) {
        for (const p of plan) failAt(name, p.id, 'Sauvegarde impossible, rien n’a été remplacé. ' + e.message);
        continue;
      }
    }
    let sharedOk = sh.kind === 'same', sharedNew = false;
    if (writeShared || replaceShared) {
      try {
        await swapIn(shared, (tmp) => copyTree(src, tmp), { home, warnings });
        sharedOk = true;
        sharedNew = true;
      } catch (e) {
        const msg = e.code === 'BACKUP_FAILED' ? e.message : 'Écriture impossible dans le dossier partagé : ' + fsMessage(e) + '.';
        for (const p of plan) if (p.kind !== 'copy') failAt(name, p.id, msg);
        plan = plan.filter((p) => p.kind === 'copy');
      }
    }
    let done = false;
    for (const p of plan) {
      try {
        if (p.kind === 'link' && !p.keep) await swapIn(p.at, (tmp) => linkDir(shared, tmp), { home, warnings });
        else if (p.kind === 'copy') await swapIn(p.at, (tmp) => copyTree(src, tmp), { home, warnings });
        applied.push({ name, agent: p.id });
        done = true;
      } catch (e) {
        failAt(name, p.id, e.code === 'BACKUP_FAILED' ? e.message : 'Application impossible pour ' + label(map, p.id) + ' : ' + fsMessage(e) + '.');
      }
    }
    // Entrée de verrouillage sauvegardée : remise quand la source est connue et que le dossier partagé tient ce contenu.
    const lockSrc = it.lock && typeof it.lock.source === 'string' ? it.lock.source : '';
    const usable = !!it.lock && isTrackedSource(lockSrc) && (!it.src || it.src === lockSrc);
    try {
      if (usable && (sharedNew || (done && sharedOk))) {
        // Clé du paquet (front matter « PDF » pour le dossier pdf) : la clé déjà là, sinon celle tirée de la copie sauvegardée.
        const lk = await lockOf(home, name);
        if (sharedNew || !lk) await writeLockEntry(home, lk ? lk.key : await lockKeyFor(home, name, src), it.lock);
      } else if (!usable && sharedNew && (await lockOf(home, name))) {
        // Nouveau contenu sans origine connue : l'ancienne entrée le ferait passer pour l'ancien skill.
        await writeLockEntry(home, (await lockOf(home, name)).key, null);
        warnings.push(name + ' n’est plus suivi par les mises à jour : la sauvegarde ne dit pas d’où il vient.');
      }
    } catch (e) { failAt(name, null, 'Skill appliqué, mais le fichier de verrouillage n’a pas été mis à jour : ' + fsMessage(e) + '.'); }
  }
  return { applied, skipped, failed, backups, warnings };
}

