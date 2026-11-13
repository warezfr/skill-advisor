// Sauvegardes : ~/.skill-advisor/backups/<AAAAMMJJ-HHMMSS>-<nom>/ = copies des skills + meta.json (version 2, un ou plusieurs skills).
import fs from 'node:fs/promises';
import path from 'node:path';
import { agentMap } from './registry.mjs';
import { AGENT_RE, COPY_LIMIT, MAX_ENTRIES, NAME_RE, backupsDir, checkAgentId, checkName, copyTree, disabledDir, exists, fail, fsMessage, homeOf, isSkillEntry, linkDir, lstatOrNull, lockPath, readJson, safeJoin, scanOf, sharedDir, statOrNull, treeHash, writeJsonAtomic } from './util.mjs';

const ID_RE = /^(\d{8}-\d{6})-(.+)$/;
const COPY_RE = /^copies\/\d{1,6}$/;
export const UNIVERSAL = 'universal';
export const ORIGINS = ['remove', 'manual', 'import', 'replace'];
export const VERDICTS = ['vert', 'vert-remarques', 'orange', 'rouge'];
// Noms qui se heurtent à la structure d'une sauvegarde.
export const RESERVED = new Set(['copies', 'meta.json', 'skill-advisor-backup.json']);
// Limites de toute une sauvegarde (remplaçables par les tests).
export const limits = { size: COPY_LIMIT, entries: MAX_ENTRIES };

// Vérifie un identifiant de sauvegarde.
export function checkId(id) {
  const m = typeof id === 'string' && ID_RE.exec(id);
  if (!m || !NAME_RE.test(m[2]) || m[2] === '..' || m[2] === '.') throw fail('BAD_NAME', 'Identifiant de sauvegarde invalide.');
  return id;
}

export const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// Date française, heure locale : « 13/11/2026 15:04 ».
export function defaultLabel(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// Chemin relatif d'une copie : <nom> ou copies/<n>/<nom>.
export function validCopy(copy, name) {
  return typeof copy === 'string' && (copy === name || (copy.endsWith('/' + name) && COPY_RE.test(copy.slice(0, -name.length - 1))));
}

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
// Place gardée dans meta.json. link : l'entrée était un lien (sa cible n'est jamais notée).
export const placeOf = (p) => ({ agent: p.agent, off: !!p.off, copy: p.copy, ...(p.link === true ? { link: true } : {}) });
const validName = (n) => typeof n === 'string' && NAME_RE.test(n) && n !== '.' && n !== '..';

// Lit meta.json (version 1 ou 2) sous la forme version 2. Rend null si incohérent.
export function normalizeMeta(raw, id) {
  if (!isObj(raw) || raw.id !== id) return null;
  const list = raw.version === 2 ? raw.items
    : [{ name: raw.name, src: raw.src, agents: raw.agents, places: raw.places, lock: raw.lock, skipped: raw.skipped, verdict: null }];
  if (!Array.isArray(list) || !list.length) return null;
  const items = [], seen = new Set();
  for (const it of list) {
    if (!isObj(it) || !validName(it.name) || seen.has(it.name)) return null;
    if (list.length > 1 && RESERVED.has(it.name)) return null;
    seen.add(it.name);
    const places = Array.isArray(it.places) && it.places.length ? it.places : [{ agent: UNIVERSAL, off: false, copy: it.name }];
    for (const p of places) if (!isObj(p) || typeof p.agent !== 'string' || !AGENT_RE.test(p.agent) || !validCopy(p.copy, it.name)) return null;
    items.push({
      name: it.name,
      src: typeof it.src === 'string' ? it.src : '',
      agents: Array.isArray(it.agents) ? it.agents.filter((a) => typeof a === 'string' && AGENT_RE.test(a)) : [],
      places: places.map(placeOf),
      lock: isObj(it.lock) ? it.lock : null,
      skipped: Array.isArray(it.skipped) ? it.skipped.filter((s) => typeof s === 'string') : [],
      copy: it.name,
      verdict: VERDICTS.includes(it.verdict) ? it.verdict : null,
    });
  }
  const at = typeof raw.at === 'string' ? raw.at : '';
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 80) : defaultLabel(at);
  return {
    version: 2, id, label, note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
    origin: ORIGINS.includes(raw.origin) ? raw.origin : 'remove', at,
    size: Number.isFinite(raw.size) && raw.size >= 0 ? raw.size : 0, items,
  };
}

// Forme publique (Backup) : name, src et agents reprennent le premier skill.
export function pub(m) {
  const items = m.items.map((i) => ({ name: i.name, src: i.src, agents: i.agents, verdict: i.verdict }));
  return { id: m.id, label: m.label, note: m.note, origin: m.origin, at: m.at, size: m.size, items, name: items[0].name, src: items[0].src, agents: items[0].agents };
}

// Ouvre une sauvegarde : dossier et meta.json normalisé.
export async function loadMeta(home, id) {
  checkId(id);
  const dir = safeJoin(backupsDir(home), id);
  const raw = await readJson(path.join(dir, 'meta.json'), null);
  if (!raw) throw fail('NOT_FOUND', 'Sauvegarde introuvable.');
  const meta = normalizeMeta(raw, id);
  if (!meta) throw fail('BAD_NAME', 'Sauvegarde incohérente.');
  return { dir, meta };
}

export async function readLockEntry(home, name) {
  const lock = await readJson(lockPath(home), null);
  return (lock && lock.skills && lock.skills[name]) || null;
}

// Remet une entrée dans le fichier de verrouillage global (écriture atomique).
export async function writeLockEntry(home, name, entry) {
  const file = lockPath(home);
  let lock = await readJson(file, null);
  if (!lock || typeof lock !== 'object' || !lock.skills || typeof lock.version !== 'number') lock = { version: 3, skills: {}, dismissed: {} };
  if (entry) lock.skills[name] = entry; else delete lock.skills[name];
  await writeJsonAtomic(file, lock);
}

export async function listBackups(opts = {}) {
  const root = backupsDir(homeOf(opts));
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
    const meta = normalizeMeta(await readJson(path.join(root, e.name, 'meta.json'), null), e.name);
    if (meta) out.push(pub(meta));
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

// Réserve un dossier neuf <horodatage>-<nom> dans les sauvegardes.
export async function reserveDir(home, name) {
  const root = backupsDir(home);
  await fs.mkdir(root, { recursive: true });
  let t = Date.now();
  for (;;) {
    const id = stamp(new Date(t)) + '-' + name;
    try { await fs.mkdir(safeJoin(root, id)); return { id, dir: safeJoin(root, id) }; } catch (e) { if (e.code !== 'EEXIST') throw e; t += 1000; }
  }
}

// Écrit une sauvegarde. items : [{ name, src, agents, places: [{ agent, off, path }], lock }] ; la première place est la copie principale.
// Liens internes suivis, liens externes et boucles ignorés. Limites : toute la sauvegarde.
async function writeBackup(home, { origin, label, note, items }) {
  for (const it of items) {
    checkName(it.name);
    if (it.name === 'meta.json' || it.name === 'skill-advisor-backup.json' || (items.length > 1 && RESERVED.has(it.name))) {
      throw fail('BAD_NAME', 'Le nom ' + it.name + ' est réservé aux sauvegardes.');
    }
  }
  const names = items.map((i) => i.name).join(', ');
  let dir = null;
  try {
    const r = await reserveDir(home, items[0].name);
    dir = r.dir;
    const counter = { n: 0 };
    let size = 0;
    const out = [];
    for (const it of items) {
      // Copie principale dans <id>/<nom>, les autres contenus dans <id>/copies/<n>/<nom>.
      const kept = [], places = [], skipped = [];
      for (const [i, p] of it.places.entries()) {
        const copy = i === 0 ? it.name : 'copies/' + i + '/' + it.name;
        const at = path.join(dir, ...copy.split('/'));
        await fs.mkdir(path.dirname(at), { recursive: true });
        const c = await copyTree(p.path, at, { prefix: copy + '/', used: size, counter, limit: limits.size, maxEntries: limits.entries });
        const hash = await treeHash(at);
        const same = kept.find((k) => k.hash === hash);
        if (same) {
          // Seulement cette copie : copies/<n>/ peut tenir celle d'un autre skill.
          await fs.rm(at, { recursive: true, force: true });
          if (i > 0) await fs.rmdir(path.dirname(at)).catch(() => {});
          places.push(placeOf({ ...p, copy: same.copy }));
          continue;
        }
        size = c.size;
        skipped.push(...c.skipped);
        kept.push({ hash, copy });
        places.push(placeOf({ ...p, copy }));
      }
      // Verdict de la copie principale, lu à sa place d'origine.
      const scan = scanOf(it.places[0].path);
      out.push({ name: it.name, src: it.src || '', agents: it.agents || [], places, lock: it.lock || null, skipped, copy: it.name, verdict: scan ? scan.verdict : null });
    }
    const at = new Date().toISOString();
    const meta = { version: 2, id: r.id, label: label || defaultLabel(at), note: note || '', origin, at, size, items: out };
    await writeJsonAtomic(path.join(dir, 'meta.json'), meta);
    return pub(normalizeMeta(meta, r.id));
  } catch (e) {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    // Limite dépassée : message pour l'ensemble quand il y a plusieurs skills.
    if (e.code === 'BACKUP_FAILED' && items.length > 1) {
      throw fail('BACKUP_FAILED', 'Ensemble, ces skills dépassent ' + Math.round(limits.size / 1048576) + ' Mo ou ' + limits.entries + ' éléments. Sauvegarde refusée.');
    }
    if (e.code === 'BACKUP_FAILED') throw e;
    throw fail('BACKUP_FAILED', 'La sauvegarde de ' + names + ' a échoué : ' + fsMessage(e) + '.');
  }
}

// Sauvegarde d'un skill. places = [{ agent, off, path }], le premier est la copie principale.
// Sans places, from est le dossier partagé (ancien usage). origin : remove (défaut) ou replace.
export async function createBackup(opts = {}) {
  const home = homeOf(opts);
  const name = checkName(opts.name);
  const places = Array.isArray(opts.places) && opts.places.length ? opts.places : [{ agent: UNIVERSAL, off: false, path: opts.from }];
  for (const p of places) {
    if (!p || typeof p.path !== 'string' || !(await exists(p.path))) throw fail('NOT_FOUND', 'Dossier du skill introuvable pour la sauvegarde : ' + name + '.');
    checkAgentId(p.agent);
  }
  const agents = (opts.agents || []).map(checkAgentId);
  const lock = opts.lock !== undefined ? opts.lock : await readLockEntry(home, name);
  const origin = opts.origin === 'replace' ? 'replace' : 'remove';
  return writeBackup(home, { origin, items: [{ name, src: opts.src || '', agents, places, lock }] });
}

// Sous-dossiers de ~/.skill-advisor/disabled.
const disabledIds = async (home) => (await fs.readdir(disabledDir(home)).catch(() => [])).filter((d) => AGENT_RE.test(d));

// Vrais dossiers d'un skill pour tous les agents (comme la sauvegarde d'une suppression) :
// dossier partagé, copies propres aux agents, entrées désactivées. Un seul exemplaire par dossier réel.
// Un lien vers un dossier qui tient SKILL.md compte aussi (dossier de travail lié) : son contenu est copié, link: true.
export async function skillPlaces(home, map, name) {
  const shared = safeJoin(sharedDir(home), name);
  const sharedOk = !!(await statOrNull(path.join(shared, 'SKILL.md')));
  const places = [], seen = [], holders = [];
  const add = async (agent, off, at) => {
    const l = await lstatOrNull(at);
    if (!l) return;
    const link = l.isSymbolicLink();
    const st = link ? await statOrNull(at) : l;
    const md = link && st && st.isDirectory() ? await statOrNull(path.join(at, 'SKILL.md')) : null;
    if (!st || !st.isDirectory() || (link && !(md && md.isFile()))) return;
    const real = await fs.realpath(at).catch(() => null);
    if (!real || seen.includes(real)) return;
    seen.push(real);
    places.push({ agent, off, path: at, ...(link ? { link: true } : {}) });
  };
  if (await isSkillEntry(shared)) await add(UNIVERSAL, false, shared);
  for (const a of Object.values(map)) {
    if (a.shared) { if (sharedOk && a.detected) holders.push(a.id); continue; }
    if (!a.dir) continue;
    const at = safeJoin(a.dir, name);
    if (await isSkillEntry(at)) { holders.push(a.id); await add(a.id, false, at); }
  }
  for (const d of await disabledIds(home)) {
    const at = safeJoin(safeJoin(disabledDir(home), d), name);
    if (!(await isSkillEntry(at))) continue;
    await add(d, true, at);
    if (map[d]) holders.push(d);
  }
  return { places, agents: [...new Set(holders)] };
}

// Texte libre : chaîne, longueur bornée, sans caractère de contrôle (sauf retours à la ligne si lines).
function text(v, max, what, lines) {
  if (v === undefined || v === null || v === '') return '';
  const bad = lines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (typeof v !== 'string' || v.length > max || bad.test(v)) throw fail('BAD_INPUT', what + ' : ' + max + ' caractères au plus, sans caractère spécial.');
  return v.trim();
}

// Sauvegarde à la demande d'un ou plusieurs skills. Rend { backup, failed } ; failed = noms sans rien à sauvegarder.
export async function createManualBackup(opts = {}) {
  const home = homeOf(opts);
  if (!Array.isArray(opts.names) || !opts.names.length) throw fail('BAD_NAME', 'Choisissez au moins un skill à sauvegarder.');
  const list = [...new Set(opts.names.map(checkName))];
  const label = text(opts.label, 80, 'Nom de la sauvegarde', false);
  const note = text(opts.note, 500, 'Note', true);
  const map = await agentMap({ home });
  const items = [], failed = [];
  for (const name of list) {
    if (RESERVED.has(name)) { failed.push({ name, message: 'Le nom ' + name + ' est réservé aux sauvegardes. Renommez ce skill pour le sauvegarder.' }); continue; }
    const { places, agents } = await skillPlaces(home, map, name);
    if (!places.length) { failed.push({ name, message: 'Skill introuvable : ' + name + '.' }); continue; }
    const lock = await readLockEntry(home, name);
    items.push({ name, src: (lock && typeof lock.source === 'string' && lock.source) || '', agents, places, lock });
  }
  if (!items.length) throw fail('NOT_FOUND', failed.length === 1 ? failed[0].message : 'Aucun des skills choisis n’a été trouvé.');
  const backup = await writeBackup(home, { origin: 'manual', label, note, items });
  return { backup, failed };
}

// Remet chaque copie à sa place : dossier partagé ou dossier de l'agent (agent disparu : copie ignorée).
// Une copie sauvegardée désactivée revient désactivée, dans ~/.skill-advisor/disabled/<agent>/<nom>. Toujours un vrai dossier, jamais un lien vers l'ancienne cible.
// Puis recrée les liens des agents qui lisaient le dossier partagé. Destinations tirées du registre, jamais de meta.json.
// Contrôle statique refait sur chaque copie : un skill rouge n'est restauré que si son nom est dans force (sinon ROUGE).
// Plusieurs skills : tout est vérifié avant la première écriture, et tout est défait en cas d'échec.
export async function restoreBackup(opts = {}) {
  const home = homeOf(opts);
  if (opts.force !== undefined && opts.force !== null && !Array.isArray(opts.force)) throw fail('BAD_NAME', 'Liste de skills attendue pour force.');
  const force = (opts.force || []).map(checkName);
  const { dir, meta } = await loadMeta(home, opts.id);
  const map = await agentMap({ home });
  const plan = [], used = new Set(), links = [], locks = [], red = [];
  for (const it of meta.items) {
    const name = it.name;
    let n = 0;
    for (const p of it.places) {
      const src = path.join(dir, ...p.copy.split('/'));
      if (!(await statOrNull(path.join(src, 'SKILL.md')))) throw fail('NOT_FOUND', 'La sauvegarde ne contient plus le skill ' + name + '.');
      const a = map[p.agent];
      let to = p.off ? safeJoin(safeJoin(disabledDir(home), p.agent), name)
        : p.agent === UNIVERSAL ? safeJoin(sharedDir(home), name) : a && !a.shared && a.dir ? safeJoin(a.dir, name) : null;
      if (!to || used.has(to)) continue;
      used.add(to);
      n++;
      plan.push({ name, src, to, agent: p.agent, active: !p.off });
    }
    if (!n) throw fail('NOT_FOUND', 'Les agents de cette sauvegarde n’existent plus (' + name + ').');
    // Verdict enregistré, puis chaque copie à restaurer vérifiée à nouveau (échec du contrôle : traité comme rouge).
    const srcs = [...new Set(plan.filter((p) => p.name === name).map((p) => p.src))];
    const isRed = (src) => { const r = scanOf(src); return !r || r.verdict === 'rouge'; };
    if (!force.includes(name) && (it.verdict === 'rouge' || srcs.some(isRed))) red.push(name);
    locks.push(it);
  }
  if (red.length) {
    throw fail('ROUGE', (red.length === 1 ? 'Le skill ' + red[0] + ' a le verdict rouge.' : 'Les skills ' + red.join(', ') + ' ont le verdict rouge.')
      + (red.length === 1 ? ' Confirmez pour le restaurer quand même.' : ' Confirmez pour les restaurer quand même.'), { names: red });
  }
  for (const p of plan) {
    if (await exists(p.to)) {
      throw fail('EXISTS', !p.active ? 'Un skill nommé ' + p.name + ' est déjà désactivé. Supprimez-le avant de restaurer.' : p.agent === UNIVERSAL ? 'Un skill nommé ' + p.name + ' est déjà installé. Supprimez-le avant de restaurer.'
        : 'Un skill nommé ' + p.name + ' existe déjà pour l’agent ' + p.agent + '. Supprimez-le avant de restaurer.');
    }
    if (p.active && (await exists(safeJoin(safeJoin(disabledDir(home), p.agent), p.name)))) {
      throw fail('EXISTS', 'Un skill nommé ' + p.name + ' est désactivé. Réactivez-le ou supprimez-le avant de restaurer.');
    }
    // Copie désactivée : refusée si le même skill est actif à sa place (dossier partagé ou dossier de l'agent).
    const a = map[p.agent];
    const live = p.agent === UNIVERSAL ? safeJoin(sharedDir(home), p.name) : a && !a.shared && a.dir ? safeJoin(a.dir, p.name) : null;
    if (!p.active && live && (await exists(live))) {
      throw fail('EXISTS', 'Un skill nommé ' + p.name + ' est actif ' + (p.agent === UNIVERSAL ? 'dans ~/.agents/skills' : 'pour l’agent ' + p.agent) + '. Supprimez-le avant de restaurer sa copie désactivée.');
    }
  }
  // Liens à recréer : agents valides et connus, avec leur propre dossier, sans copie à eux, ni copie désactivée.
  for (const it of meta.items) {
    const target = safeJoin(sharedDir(home), it.name);
    if (!used.has(target)) continue;
    for (const id of it.agents) {
      const a = map[id];
      if (!a || a.shared || !a.dir || it.places.some((p) => p.off && p.agent === id)) continue;
      const at = safeJoin(a.dir, it.name);
      if (!used.has(at) && !(await exists(at))) links.push({ dir: a.dir, at, target });
    }
  }
  const made = [], wrote = [];
  try {
    for (const p of plan) {
      await fs.mkdir(path.dirname(p.to), { recursive: true });
      made.push(p.to);
      await fs.cp(p.src, p.to, { recursive: true, errorOnExist: true, force: false });
    }
    for (const l of links) {
      await fs.mkdir(l.dir, { recursive: true });
      await linkDir(l.target, l.at);
      made.push(l.at);
    }
    for (const it of locks) {
      if (!it.lock || (await readLockEntry(home, it.name))) continue;
      await writeLockEntry(home, it.name, it.lock);
      wrote.push(it.name);
    }
  } catch (e) {
    // Restauration annulée : rien de partiel ne reste, entrées de verrouillage comprises.
    for (const n of wrote) await writeLockEntry(home, n, null).catch(() => {});
    for (const p of made.reverse()) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    throw fail('BACKUP_FAILED', 'La restauration de ' + meta.items.map((i) => i.name).join(', ') + ' a échoué : ' + fsMessage(e) + '.');
  }
  return pub(meta);
}

export async function deleteBackup(opts = {}) {
  const home = homeOf(opts);
  checkId(opts.id);
  const dir = safeJoin(backupsDir(home), opts.id);
  if (!(await exists(path.join(dir, 'meta.json')))) throw fail('NOT_FOUND', 'Sauvegarde introuvable.');
  await fs.rm(dir, { recursive: true, force: true });
}
