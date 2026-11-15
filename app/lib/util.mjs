// Outils communs du socle machine : erreurs, validation, chemins, JSON, droits des fichiers.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanSkillDir } from '../../tools/skill-scan.mjs';

// Noms de skills et identifiants d'agents.
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const AGENT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OWNER_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

// Erreur avec un code stable et un message en français.
export function fail(code, message, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

export function homeOf(opts) {
  return (opts && opts.home) || os.homedir();
}

export function checkName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name === '.' || name === '..') {
    throw fail('BAD_NAME', 'Nom de skill invalide : ' + String(name).slice(0, 80) + '.');
  }
  return name;
}

export function checkAgentId(id) {
  if (typeof id !== 'string' || !AGENT_RE.test(id)) {
    throw fail('BAD_NAME', 'Identifiant d’agent invalide : ' + String(id).slice(0, 80) + '.');
  }
  return id;
}

// Source : owner/repo (sans segment qui commence par un point) ou URL https.
export function checkSource(src) {
  if (typeof src === 'string' && OWNER_REPO_RE.test(src)) {
    const [owner, repo] = src.split('/');
    if (!owner.startsWith('.') && !repo.startsWith('.')) return src;
  } else if (typeof src === 'string' && src.length <= 2000 && /^https:\/\/[^\s]+$/.test(src)) {
    try {
      const u = new URL(src);
      if (u.protocol === 'https:' && u.hostname) return src;
    } catch { /* invalide */ }
  }
  throw fail('BAD_SOURCE', 'Source invalide. Indiquez owner/repo ou une adresse https.');
}

// Source suivie par les mises à jour (verrou, source affichée) : owner/repo, ou adresse https de github.com ou gitlab.com.
// Chaîne brute contrôlée : ni identifiant, ni port, ni adresse IP, ni caractère de contrôle.
export function isTrackedSource(src) {
  if (typeof src !== 'string' || src.length > 2000 || /[\u0000- \u007f]/.test(src)) return false;
  if (OWNER_REPO_RE.test(src)) return !src.split('/').some((s) => s.startsWith('.'));
  const m = /^https:\/\/(github\.com|gitlab\.com)\/[^\s\\]+$/.exec(src);
  if (!m) return false;
  try {
    const u = new URL(src);
    return u.protocol === 'https:' && u.hostname === m[1] && !u.username && !u.password && !u.port;
  } catch { return false; }
}

// Retire les dossiers de travail export-*, import-*, stage-* et update-* oubliés sous ~/.skill-advisor/tmp,
// et les anciennes versions old-* qu'un remplacement n'a pas pu effacer. Ne lève jamais d'erreur.
export async function sweepTmp(opts = {}) {
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) && opts.maxAgeMs >= 0 ? opts.maxAgeMs : 3600000;
  const dir = tmpDir(homeOf(opts));
  let names;
  try { names = await fs.readdir(dir); } catch { return; }
  const now = Date.now();
  for (const n of names) {
    if (!/^(export|import|stage|update|old)-/.test(n)) continue;
    try {
      const at = path.join(dir, n);
      const l = await fs.lstat(at);
      // Lien : retiré sans être suivi.
      if (now - l.mtimeMs > maxAgeMs) await fs.rm(at, { recursive: true, force: true });
    } catch { /* suivant */ }
  }
}

// Joint un nom à un dossier parent et vérifie que le résultat reste dedans.
export function safeJoin(parent, name) {
  const base = path.resolve(parent);
  const p = path.resolve(base, name);
  if (path.dirname(p) !== base) throw fail('BAD_NAME', 'Chemin refusé : ' + String(name).slice(0, 80) + '.');
  return p;
}

// Dossiers propres à Skill Advisor.
export function saDir(home) { return path.join(home, '.skill-advisor'); }
export function sharedDir(home) { return path.join(home, '.agents', 'skills'); }
export function disabledDir(home) { return path.join(saDir(home), 'disabled'); }
export function backupsDir(home) { return path.join(saDir(home), 'backups'); }
export function tmpDir(home) { return path.join(saDir(home), 'tmp'); }

// Droits de ~/.skill-advisor : dossiers 0700, fichiers 0600 (sans effet sous Windows).
const PRIVATE = '.skill-advisor';
// Racine ~/.skill-advisor d'un chemin qui passe par elle, sinon null.
function privateRoot(p) {
  const parts = path.resolve(p).split(path.sep);
  const i = parts.lastIndexOf(PRIVATE);
  return i < 1 ? null : parts.slice(0, i + 1).join(path.sep) || path.sep;
}
export function isPrivate(p) { return privateRoot(p) !== null; }

// Crée un dossier ; sous ~/.skill-advisor, chaque dossier créé l'est en 0700 et la racine est remise en 0700.
export async function mkdirp(dir) {
  const root = privateRoot(dir);
  if (!root) { await fs.mkdir(dir, { recursive: true }); return; }
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => {});
}

// Au démarrage : ~/.skill-advisor existe et n'est lisible que par l'utilisateur.
export async function prepareSaDir(home) {
  await mkdirp(saDir(home));
}

// Écrit un fichier texte ; sous ~/.skill-advisor, en 0600.
export async function writePrivate(file, data) {
  await mkdirp(path.dirname(file));
  await fs.writeFile(file, data, isPrivate(file) ? { mode: 0o600 } : undefined);
}

// Le dossier réel de l'utilisateur : seul cas où les variables XDG et *_HOME sont reprises.
export function isRealHome(home) {
  return path.resolve(home) === path.resolve(os.homedir());
}

// Fichier de verrouillage global du paquet skills, comme le paquet le calcule.
export function lockPath(home) {
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg && isRealHome(home)) return path.join(xdg, 'skills', '.skill-lock.json');
  return path.join(home, '.agents', '.skill-lock.json');
}

// Environnement des processus enfants : liste blanche, jamais tout process.env.
const PASS = ['PATH', 'Path', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL',
  'GITHUB_TOKEN', 'GH_TOKEN', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy'];
const REAL_ONLY = ['XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'VIBE_HOME', 'HERMES_HOME',
  'AUTOHAND_HOME', 'GROK_HOME', 'SARVAM_HOME', 'REASONIX_HOME', 'FLATPAK_XDG_CONFIG_HOME'];

export function childEnv(home) {
  const env = {};
  for (const k of PASS) if (process.env[k] !== undefined) env[k] = process.env[k];
  const real = isRealHome(home);
  if (real) for (const k of REAL_ONLY) if (process.env[k] !== undefined) env[k] = process.env[k];
  if (process.platform === 'win32') {
    env.APPDATA = real && process.env.APPDATA ? process.env.APPDATA : path.join(home, 'AppData', 'Roaming');
    env.LOCALAPPDATA = real && process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA : path.join(home, 'AppData', 'Local');
  }
  env.HOME = home;
  env.USERPROFILE = home;
  env.DISABLE_TELEMETRY = '1';
  env.DO_NOT_TRACK = '1';
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

// Chemin réel, même si la fin n'existe pas encore : le plus proche parent existant est résolu.
export async function realish(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(await fs.realpath(cur), ...rest); } catch { /* parent suivant */ }
    const up = path.dirname(cur);
    if (up === cur) return path.resolve(p);
    rest.unshift(path.basename(cur));
    cur = up;
  }
}

// Vrai si child est parent lui-même ou se trouve dedans (sans casse sur mac et Windows).
export function within(child, parent) {
  const fold = (s) => (process.platform === 'darwin' || process.platform === 'win32' ? s.toLowerCase() : s);
  const rel = path.relative(fold(path.resolve(parent)), fold(path.resolve(child)));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

export const COPY_LIMIT = 200 * 1024 * 1024;
export const MAX_ENTRIES = 100000;

// Copie d'un dossier de skill, bornée en taille et en nombre d'entrées.
// links: 'inroot' suit les liens qui restent dans le skill et ignore les autres (notés dans skipped, de même que les boucles) ;
// 'verbatim' recopie chaque lien tel quel. used : octets déjà comptés. counter : { n } partagé entre plusieurs copies.
// Rend { size, skipped } ; skipped donne des chemins relatifs avec des /.
export async function copyTree(src, dest, opts = {}) {
  const limit = opts.limit || COPY_LIMIT;
  const maxEntries = opts.maxEntries || MAX_ENTRIES;
  const verbatim = opts.links === 'verbatim';
  const root = await fs.realpath(src);
  const out = { size: opts.used || 0, skipped: [] };
  const counter = opts.counter || { n: 0 };
  const tooBig = () => fail('BACKUP_FAILED', 'Le skill dépasse ' + Math.round(limit / 1048576) + ' Mo. Copie refusée.');
  const copyFile = async (a, b, n) => {
    out.size += n;
    if (out.size > limit) throw tooBig();
    await fs.copyFile(a, b);
  };
  // Dossiers : 0700 sous ~/.skill-advisor (sauvegardes, dossiers de travail), sinon ordinaires (0755, selon le masque).
  // ordinary : dossiers ordinaires même sous ~/.skill-advisor (copie désactivée d'un skill, comme un dossier déplacé).
  const mode = !opts.ordinary && isPrivate(dest) ? 0o700 : 0o755;
  const walk = async (from, to, rel, stack) => {
    await fs.mkdir(to, { mode });
    for (const e of await fs.readdir(from, { withFileTypes: true })) {
      if (++counter.n > maxEntries) throw tooBig();
      const p = path.join(from, e.name), q = path.join(to, e.name), r = rel + e.name;
      if (e.isSymbolicLink()) {
        if (verbatim) { await copyLink(p, q); continue; }
        const real = await fs.realpath(p).catch(() => null);
        const st = real && within(real, root) ? await statOrNull(real) : null;
        if (st && st.isDirectory() && !stack.includes(real)) await walk(real, q, r + '/', [...stack, real]);
        else if (st && st.isFile()) await copyFile(real, q, st.size);
        else out.skipped.push(r);
      } else if (e.isDirectory()) await walk(p, q, r + '/', [...stack, p]);
      else if (e.isFile()) await copyFile(p, q, (await fs.lstat(p)).size);
      else out.skipped.push(r);
    }
  };
  await walk(root, dest, opts.prefix || '', [root]);
  return out;
}

export async function exists(p) {
  try { await fs.lstat(p); return true; } catch { return false; }
}
export async function lstatOrNull(p) { try { return await fs.lstat(p); } catch { return null; } }
export async function statOrNull(p) { try { return await fs.stat(p); } catch { return null; } }

// Un skill dans un dossier d'agent : un dossier qui contient SKILL.md, ou un lien vers un tel dossier.
// Un lien cassé ne compte que s'il visait <…>/skills/<nom> ou <…>/universal/<nom> (lien posé par le moteur) :
// un dossier d'agent ajouté à la main peut contenir d'autres liens (outils, bibliothèques) qu'il ne faut jamais toucher.
export async function isSkillEntry(p) {
  const l = await lstatOrNull(p);
  if (!l) return false;
  if (l.isSymbolicLink()) {
    const st = await statOrNull(p);
    if (st) return st.isDirectory() && !!(await statOrNull(path.join(p, 'SKILL.md')));
    let t;
    try { t = await fs.readlink(p); } catch { return false; }
    const parts = t.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] === path.basename(p) && ['skills', 'universal'].includes(parts[parts.length - 2]);
  }
  if (!l.isDirectory()) return false;
  const md = await statOrNull(path.join(p, 'SKILL.md'));
  return !!(md && md.isFile());
}

// Empreinte du contenu d'un dossier, vu comme copyTree le copie : liens internes suivis, liens externes et boucles ignorés.
export async function treeHash(dir) {
  const h = crypto.createHash('sha256');
  const root = await fs.realpath(dir);
  const walk = async (d, rel, stack) => {
    const list = (await fs.readdir(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of list) {
      let p = path.join(d, e.name), st = null;
      if (e.isSymbolicLink()) {
        p = await fs.realpath(p).catch(() => null);
        st = p && within(p, root) ? await statOrNull(p) : null;
        if (!st || (st.isDirectory() && stack.includes(p))) continue;
      }
      if (st ? st.isDirectory() : e.isDirectory()) { h.update('d\0' + rel + e.name + '\0'); await walk(p, rel + e.name + '/', [...stack, p]); } else if (st ? st.isFile() : e.isFile()) {
        const data = await fs.readFile(p);
        h.update('f\0' + rel + e.name + '\0' + data.length + '\0');
        h.update(data);
      }
    }
  };
  await walk(root, '', [root]);
  return h.digest('hex');
}

// Vérification statique d'un dossier de skill, ou null si elle échoue.
export function scanOf(dir) {
  try { const r = scanSkillDir(dir); return { verdict: r.verdict, findings: r.findings }; } catch { return null; }
}

// Message français pour une erreur du système de fichiers.
const FS_TEXT = { EACCES: 'accès refusé', EPERM: 'opération non permise', ENOENT: 'fichier ou dossier introuvable', ENOTDIR: 'un fichier occupe la place d’un dossier',
  EEXIST: 'un fichier du même nom existe déjà', ENOTEMPTY: 'dossier non vide', ENOSPC: 'disque plein', EROFS: 'disque en lecture seule', EBUSY: 'fichier occupé' };
export function fsMessage(e) {
  const t = e && FS_TEXT[e.code];
  if (t) return t + (e.path ? ' (' + e.path + ')' : '');
  return e && e.code && /^E[A-Z]+$/.test(e.code) ? 'erreur du système de fichiers (' + e.code + ')' : 'erreur inattendue';
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

// --- Verrous passagers de Windows (antivirus, indexation) ---

// Opérations du disque, remplaçables par les tests. delays : attentes en millisecondes entre deux essais.
// Un seul objet pour tout le socle : settings.mjs le reprend tel quel.
export const disk = { platform: process.platform, delays: [100, 200, 400, 800], rename: (a, b) => fs.rename(a, b) };
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

// Lance op(). Sous Windows, EPERM, EBUSY ou EACCES vient souvent d'un fichier encore ouvert par un autre programme :
// nouvel essai après une attente croissante. opts.stop : fonction qui rend vrai quand un nouvel essai est inutile.
export async function retryBusy(op, opts = {}) {
  for (let i = 0; ; i++) {
    try { return await op(); } catch (e) {
      if (disk.platform !== 'win32' || !BUSY.has(e.code) || i >= disk.delays.length) throw e;
      if (opts.stop && (await opts.stop())) throw e;
      await new Promise((r) => setTimeout(r, disk.delays[i]));
    }
  }
}

// Renomme, avec les essais répétés de retryBusy.
export function renameRetry(from, to, opts = {}) {
  return retryBusy(() => disk.rename(from, to), opts);
}

// Options d'effacement d'un dossier : essais répétés sous Windows seulement (ailleurs, un refus est définitif).
export function rmOpts() {
  return disk.platform === 'win32' ? { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } : { recursive: true, force: true };
}

// Écriture atomique : fichier temporaire puis renommage (retenté sous Windows). Sous ~/.skill-advisor : fichier 0600, dossiers 0700.
export async function writeJsonAtomic(file, data) {
  await mkdirp(path.dirname(file));
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.' + crypto.randomBytes(3).toString('hex') + '.tmp';
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', isPrivate(file) ? { encoding: 'utf8', mode: 0o600 } : 'utf8');
    await renameRetry(tmp, file);
  } catch (e) {
    // Échec : le fichier temporaire ne reste pas.
    await fs.rm(tmp, rmOpts()).catch(() => {});
    throw e;
  }
}

// --- Noms : dossier sur le disque et clé du verrou ---

// Nom du dossier que le paquet crée pour un skill (sanitizeName de skills 1.8.1).
export function folderOf(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9._]+/g, '-').replace(/^[.\-]+|[.\-]+$/g, '').substring(0, 255) || 'unnamed-skill';
}
// Entrées du verrou global : { clé: entrée }.
export async function lockSkills(home) {
  const lock = await readJson(lockPath(home), null);
  return (lock && lock.skills && typeof lock.skills === 'object') ? lock.skills : {};
}
// Clé d'un dossier dans des entrées du verrou : la clé égale au dossier, sinon celle dont le dossier calculé lui est égal.
export function keyIn(skills, folder) {
  if (Object.hasOwn(skills, folder)) return folder;
  return Object.keys(skills).find((k) => folderOf(k) === folder) || null;
}
export async function lockKey(home, folder) { return keyIn(await lockSkills(home), folder); }
// Entrée du verrou d'un dossier : { key, entry } ou null.
export async function lockOf(home, folder) {
  const skills = await lockSkills(home);
  const key = keyIn(skills, folder);
  return key ? { key, entry: skills[key] } : null;
}
// Nom du front matter de SKILL.md (forme simple ou entre guillemets), ou null.
export function frontName(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  const l = m && m[1].split(/\r?\n/).find((x) => /^name\s*:/.test(x));
  if (!l) return null;
  let v = l.replace(/^name\s*:\s*/, '').trim();
  if (v.length > 1 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\'')))) v = v.slice(1, -1);
  return v || null;
}
// Clé sous laquelle écrire l'entrée du verrou d'un dossier : la clé déjà présente, sinon le nom du front matter
// de dir/SKILL.md quand le paquet en tire ce dossier (le paquet verrouille par ce nom), sinon le nom du dossier.
export async function lockKeyFor(home, folder, dir) {
  const k = await lockKey(home, folder);
  if (k) return k;
  const n = dir ? frontName(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => '')) : null;
  return n && n.length <= 255 && folderOf(n) === folder ? n : folder;
}

export function osName() {
  return process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
}

// Lien vers un dossier : symbolique sur mac/linux, jonction sous Windows.
export async function linkDir(target, at) {
  if (process.platform === 'win32') await fs.symlink(path.resolve(target), at, 'junction');
  else await fs.symlink(path.relative(path.dirname(at), target), at, 'dir');
}

// Recopie le lien src en dest, sans le suivre. Sous Windows : jonction à cible absolue vers un dossier
// (ou une cible absente), lien de fichier sinon ; lien de fichier refusé (EPERM) : copie du fichier.
export const platform = { name: process.platform };
export async function copyLink(src, dest) {
  const target = await fs.readlink(src);
  if (platform.name !== 'win32') { await fs.symlink(target, dest); return; }
  const abs = path.resolve(path.dirname(src), target);
  const st = await statOrNull(abs);
  if (!st || st.isDirectory()) { await fs.symlink(abs, dest, 'junction'); return; }
  try { await fs.symlink(target, dest, 'file'); } catch (e) {
    if (e.code !== 'EPERM') throw e;
    await fs.copyFile(abs, dest);
  }
}
