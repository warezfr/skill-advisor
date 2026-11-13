// Export et import d'une sauvegarde : une archive .tar.gz avec skill-advisor-backup.json à la racine.
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import * as tar from 'tar';
import { RESERVED, VERDICTS, defaultLabel, loadMeta, normalizeMeta, placeOf, pub, stamp, validCopy } from './backups.mjs';
import { AGENT_RE, COPY_LIMIT, MAX_ENTRIES, NAME_RE, backupsDir, copyTree, fail, fsMessage, homeOf, isTrackedSource, safeJoin, scanOf, sweepTmp, tmpDir } from './util.mjs';

export const FORMAT = 'skill-advisor/backup/1';
export const MANIFEST = 'skill-advisor-backup.json';
// Limites de l'archive (remplaçables par les tests).
export const archiveLimits = { size: COPY_LIMIT, entries: MAX_ENTRIES };

const bad = (message) => fail('BAD_ARCHIVE', message);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// Dossier de travail neuf sous ~/.skill-advisor/tmp.
// Les dossiers oubliés (arrêt brutal) de plus d'une heure partent d'abord.
async function workDir(home, prefix) {
  await sweepTmp({ home });
  await fs.mkdir(tmpDir(home), { recursive: true });
  return fs.mkdtemp(path.join(tmpDir(home), prefix));
}

// --- Export ---

// Rend un Buffer : l'archive .tar.gz de la sauvegarde. Fichiers et dossiers seulement, droits portables, sans propriétaire.
export async function exportBackup(opts = {}) {
  const home = homeOf(opts);
  const { dir, meta } = await loadMeta(home, opts.id);
  const stage = await workDir(home, 'export-');
  try {
    const root = path.join(stage, 'b');
    await copyTree(dir, root, { limit: archiveLimits.size, maxEntries: archiveLimits.entries });
    // Le manifeste porte meta.json sous sa forme version 2.
    await fs.writeFile(path.join(root, MANIFEST), JSON.stringify({ format: FORMAT, meta }, null, 2) + '\n');
    const top = (await fs.readdir(root)).sort((a, b) => (a === MANIFEST ? -1 : b === MANIFEST ? 1 : a < b ? -1 : 1));
    const pack = tar.c({ cwd: root, gzip: true, portable: true, filter: (p, st) => st.isFile() || st.isDirectory() }, top);
    const chunks = [];
    for await (const c of pack) chunks.push(c);
    return Buffer.concat(chunks);
  } catch (e) {
    if (e.code === 'BACKUP_FAILED') throw fail('BACKUP_FAILED', 'La sauvegarde dépasse ' + Math.round(archiveLimits.size / 1048576) + ' Mo. Export refusé.');
    throw fail('BACKUP_FAILED', 'L’export de la sauvegarde a échoué : ' + fsMessage(e) + '.');
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

// --- Import ---

// Découpe et vérifie le chemin d'une entrée. Rend les segments (vide pour la racine).
function entryPath(p) {
  if (typeof p !== 'string' || !p.length || p.length > 4096) throw bad('Archive refusée : chemin vide ou trop long.');
  if (/[\u0000-\u001f\u007f]/.test(p)) throw bad('Archive refusée : un nom contient un caractère de contrôle.');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) throw bad('Archive refusée : chemin absolu (' + p.slice(0, 80) + ').');
  // Barre oblique inverse : séparateur sous Windows, nom trompeur ailleurs.
  if (p.includes('\\')) throw bad('Archive refusée : un chemin contient une barre oblique inverse (' + p.slice(0, 80) + ').');
  const parts = p.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.some((s) => s === '..')) throw bad('Archive refusée : chemin qui sort du dossier (' + p.slice(0, 80) + ').');
  // Deux-points : flux caché d'un fichier sous Windows.
  if (process.platform === 'win32' && parts.some((s) => s.includes(':'))) throw bad('Archive refusée : nom invalide sous Windows (' + p.slice(0, 80) + ').');
  return parts;
}

// Extrait l'archive dans root. Chaque en-tête est vérifié avant d'écrire ; arrêt dès la première faute.
function extract(data, root) {
  return new Promise((resolve, reject) => {
    let err = null, settled = false, count = 0, total = 0;
    const done = (e) => {
      if (settled) return;
      settled = true;
      if (e) reject(e); else resolve();
    };
    const parser = new tar.Parser({ strict: true });
    const stop = (e) => {
      if (err) return;
      err = e && e.code === 'BAD_ARCHIVE' ? e : bad('Archive illisible ou abîmée.');
      try { parser.abort(err); } catch { /* déjà arrêté */ }
      done(err);
    };
    parser.on('entry', (entry) => {
      if (err) { entry.resume(); return; }
      try {
        if (++count > archiveLimits.entries) throw bad('Archive refusée : plus de ' + archiveLimits.entries + ' entrées.');
        total += entry.size || 0;
        if (total > archiveLimits.size) throw bad('Archive refusée : elle dépasse ' + Math.round(archiveLimits.size / 1048576) + ' Mo.');
        if (entry.type !== 'File' && entry.type !== 'Directory') throw bad('Archive refusée : elle contient un lien ou un fichier spécial (' + String(entry.path).slice(0, 80) + ').');
        const parts = entryPath(entry.path);
        const at = parts.length ? safeJoinAll(root, parts) : root;
        if (entry.type === 'Directory') {
          fsSync.mkdirSync(at, { recursive: true });
          entry.resume();
          return;
        }
        if (!parts.length) throw bad('Archive refusée : fichier sans nom.');
        fsSync.mkdirSync(path.dirname(at), { recursive: true });
        const chunks = [];
        entry.on('data', (c) => chunks.push(c));
        entry.on('end', () => {
          if (err) return;
          try { fsSync.writeFileSync(at, Buffer.concat(chunks), { flag: 'wx', mode: 0o644 }); } catch (e) { stop(bad('Archive refusée : fichier en double ou mal placé (' + parts.join('/').slice(0, 80) + ').')); }
        });
      } catch (e) {
        stop(e.code === 'BAD_ARCHIVE' ? e : bad('Archive refusée : ' + fsMessage(e) + '.'));
        entry.resume();
      }
    });
    parser.on('error', (e) => stop(e));
    parser.on('abort', (e) => stop(e));
    parser.on('close', () => done(err));
    parser.on('end', () => done(err));
    // Seulement du gzip : la décompression reste bornée ici.
    if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) { stop(bad('Le fichier n’est pas une archive .tar.gz.')); return; }
    // Décompression faite ici, bornée en octets produits : la garde de tar (1000 pour 1) refuserait un gros fichier répétitif.
    const cap = archiveLimits.size + (archiveLimits.entries + 16) * 2048 + 8 * 1048576;
    const z = zlib.createGunzip();
    let out = 0;
    z.on('data', (c) => {
      if (err) return;
      out += c.length;
      if (out > cap) { stop(bad('Archive refusée : elle dépasse ' + Math.round(archiveLimits.size / 1048576) + ' Mo.')); z.destroy(); return; }
      try { parser.write(c); } catch (e) { stop(e); }
    });
    z.on('end', () => { if (!err) { try { parser.end(); } catch (e) { stop(e); } } });
    z.on('error', (e) => stop(e));
    z.end(data);
  });
}

// Joint des segments à root, chacun contrôlé.
function safeJoinAll(root, parts) {
  let p = root;
  for (const s of parts) p = safeJoin(p, s);
  return p;
}

// Source et verrou : GitHub ou GitLab seulement (owner/repo ou adresse https exacte).
const validSrc = isTrackedSource;
const CTRL = /[\u0000-\u001f\u007f]/;
// Champs gardés d'une entrée de verrouillage, chacun vérifié. Les autres champs sont retirés.
const LOCK_KEYS = {
  sourceType: (v) => ['github', 'git', 'gitlab'].includes(v),
  skillPath: (v) => v.length <= 500 && !CTRL.test(v) && !v.includes('\\') && !v.startsWith('/') && !/^[A-Za-z]:/.test(v) && !v.split('/').includes('..'),
  ref: (v) => /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/.test(v) && !v.includes('..'),
  // Vide quand le paquet n'a pas pu lire l'empreinte.
  skillFolderHash: (v) => /^[A-Za-z0-9]{0,128}$/.test(v),
  pluginName: (v) => v.length <= 200 && !CTRL.test(v),
  installMode: (v) => ['symlink', 'copy', 'link'].includes(v),
  installedAt: (v) => v.length <= 64 && !CTRL.test(v),
  updatedAt: (v) => v.length <= 64 && !CTRL.test(v),
};

// Entrée de verrouillage d'une archive : gardée seulement si la mise à jour ira chercher la source affichée.
// Rend l'entrée nettoyée, ou null si un champ ne se vérifie pas (source locale, adresse qui diffère, chemin qui sort…).
function cleanLock(lock) {
  if (!isObj(lock) || typeof lock.source !== 'string' || !validSrc(lock.source)) return null;
  const src = lock.source;
  const out = { source: src };
  if (lock.sourceUrl !== undefined && lock.sourceUrl !== null) {
    const bare = src.replace(/\.git$/, '');
    const same = src.startsWith('https://') ? [bare, bare + '.git'] : ['https://github.com/' + bare + '.git', 'https://github.com/' + bare];
    if (!same.includes(lock.sourceUrl)) return null;
    out.sourceUrl = lock.sourceUrl;
  }
  for (const [k, ok] of Object.entries(LOCK_KEYS)) {
    const v = lock[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !ok(v)) return null;
    out[k] = v;
  }
  return out;
}

const isDir = async (p) => { try { const l = await fs.lstat(p); return l.isDirectory(); } catch { return false; } };
const isFile = async (p) => { try { const l = await fs.lstat(p); return l.isFile(); } catch { return false; } };

// Lit et vérifie le manifeste. Rend { label, note, items, warnings } prêts à copier.
async function readManifest(root) {
  const file = path.join(root, MANIFEST);
  const missing = () => bad('Archive refusée : manifeste ' + MANIFEST + ' absent ou invalide.');
  if (!(await isFile(file)) || (await fs.stat(file)).size > 4 * 1024 * 1024) throw missing();
  let man;
  try { man = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw missing(); }
  if (!isObj(man) || man.format !== FORMAT || !isObj(man.meta)) throw missing();
  const m = man.meta;
  const list = m.version === 2 ? m.items : null;
  if (!Array.isArray(list) || !list.length || list.length > 1000) throw missing();
  const items = [], seen = new Set(), warnings = [];
  for (const it of list) {
    const name = isObj(it) ? it.name : undefined;
    if (typeof name !== 'string' || !NAME_RE.test(name) || name === '.' || name === '..' || RESERVED.has(name)) {
      throw bad('Archive refusée : nom de skill invalide (' + String(name).slice(0, 80) + ').');
    }
    if (seen.has(name)) throw bad('Archive refusée : le skill ' + name + ' apparaît deux fois.');
    seen.add(name);
    if (!(await isFile(path.join(root, name, 'SKILL.md')))) throw bad('Archive refusée : le skill ' + name + ' manque dans l’archive.');
    const places = Array.isArray(it.places) && it.places.length ? it.places : [{ agent: 'universal', off: false, copy: name }];
    if (places.length > 1000) throw missing();
    for (const p of places) {
      if (!isObj(p) || typeof p.agent !== 'string' || !AGENT_RE.test(p.agent) || !validCopy(p.copy, name)) throw bad('Archive refusée : emplacement invalide pour ' + name + '.');
      if (!(await isFile(path.join(root, ...p.copy.split('/'), 'SKILL.md')))) throw bad('Archive refusée : une copie de ' + name + ' manque dans l’archive.');
    }
    // Source ou verrou invérifiable : retiré, le skill est gardé.
    let src = typeof it.src === 'string' ? it.src : '';
    if (src && !validSrc(src)) { warnings.push('Skill Advisor ignore la source du skill ' + name + ' : elle est invalide.'); src = ''; }
    // Le verrou doit pointer vers la source affichée.
    let lock = cleanLock(it.lock);
    if (lock && src && lock.source !== src) lock = null;
    if (it.lock !== null && it.lock !== undefined && !lock) {
      warnings.push('Skill Advisor importe le skill ' + name + ' sans son entrée de verrouillage : il ne peut pas vérifier sa source.');
    }
    items.push({
      name, src,
      agents: Array.isArray(it.agents) ? [...new Set(it.agents.filter((a) => typeof a === 'string' && AGENT_RE.test(a)))] : [],
      places: places.map(placeOf),
      lock,
      skipped: Array.isArray(it.skipped) ? it.skipped.filter((s) => typeof s === 'string' && s.length <= 4096).slice(0, 1000) : [],
      copy: name,
      before: VERDICTS.includes(it.verdict) ? it.verdict : null,
    });
  }
  const label = typeof m.label === 'string' && m.label.trim() && !/[\u0000-\u001f\u007f]/.test(m.label) ? m.label.trim().slice(0, 80) : '';
  const note = typeof m.note === 'string' ? m.note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 500) : '';
  return { label, note, items, warnings };
}

// Taille des fichiers d'un dossier (aucun lien : l'extraction n'en crée pas).
async function sizeOf(dir) {
  let n = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += await sizeOf(p); else if (e.isFile()) n += (await fs.stat(p)).size;
  }
  return n;
}

// data : Buffer de l'archive. Rend { backup, warnings } ; la sauvegarde importée a un nouvel identifiant.
export async function importBackup(opts = {}) {
  const home = homeOf(opts);
  const data = opts.data;
  if (!Buffer.isBuffer(data) || !data.length) throw bad('Le fichier envoyé est vide ou n’est pas une archive.');
  const stage = await workDir(home, 'import-');
  try {
    const root = path.join(stage, 'x');
    await fs.mkdir(root);
    await extract(data, root);
    const man = await readManifest(root);
    // Nouveau dossier : seulement les copies citées par le manifeste.
    const fresh = path.join(stage, 'new');
    await fs.mkdir(fresh);
    const moved = new Set();
    for (const it of man.items) {
      for (const copy of [it.name, ...it.places.map((p) => p.copy)]) {
        if (moved.has(copy)) continue;
        moved.add(copy);
        const to = path.join(fresh, ...copy.split('/'));
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(path.join(root, ...copy.split('/')), to);
      }
    }
    // Contrôle statique de chaque skill, à nouveau. Le verdict est celui de la copie principale.
    const warnings = [...man.warnings], items = [];
    for (const it of man.items) {
      const scan = scanOf(path.join(fresh, it.name));
      const verdict = scan ? scan.verdict : null;
      if (verdict === 'rouge') warnings.push('Le skill ' + it.name + ' a le verdict rouge. Ne l’appliquez que si vous lui faites confiance.');
      else if (it.before && verdict !== it.before) warnings.push('Le verdict du skill ' + it.name + ' a changé : ' + (verdict || 'inconnu') + ' au lieu de ' + it.before + '.');
      // Les autres copies vont aussi dans des dossiers d'agents à la restauration : chacune est vérifiée.
      for (const copy of new Set(it.places.map((p) => p.copy).filter((c) => c !== it.name))) {
        const s = scanOf(path.join(fresh, ...copy.split('/')));
        if (!s) warnings.push('Skill Advisor n’a pas pu vérifier une autre copie du skill ' + it.name + '.');
        else if (s.verdict === 'rouge') warnings.push('Une autre copie du skill ' + it.name + ' a le verdict rouge. Ne la restaurez que si vous lui faites confiance.');
      }
      const { before, ...rest } = it;
      items.push({ ...rest, verdict });
    }
    const size = await sizeOf(fresh);
    const at = new Date().toISOString();
    const root2 = backupsDir(home);
    await fs.mkdir(root2, { recursive: true });
    let t = Date.now();
    for (let tries = 0; ; tries++) {
      const id = stamp(new Date(t)) + '-' + items[0].name;
      const meta = { version: 2, id, label: man.label || defaultLabel(at), note: man.note, origin: 'import', at, size, items };
      const dest = safeJoin(root2, id);
      if (!(await fs.lstat(dest).catch(() => null))) {
        await fs.writeFile(path.join(fresh, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
        try {
          await fs.rename(fresh, dest);
          return { backup: pub(normalizeMeta(meta, id)), warnings };
        } catch (e) { if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(e.code) || tries > 50) throw e; }
      }
      t += 1000;
    }
  } catch (e) {
    if (e.code === 'BAD_ARCHIVE' || e.code === 'BACKUP_FAILED') throw e;
    throw fail('BACKUP_FAILED', 'L’import de la sauvegarde a échoué : ' + fsMessage(e) + '.');
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
