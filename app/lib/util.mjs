// Outils communs du socle machine : erreurs, validation, chemins, JSON.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanSkillDir } from '../../tools/skill-scan.mjs';

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

// Retire les dossiers de travail export-* et import-* oubliés sous ~/.skill-advisor/tmp. Ne lève jamais d'erreur.
export async function sweepTmp(opts = {}) {
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) && opts.maxAgeMs >= 0 ? opts.maxAgeMs : 3600000;
  const dir = tmpDir(homeOf(opts));
  let names;
  try { names = await fs.readdir(dir); } catch { return; }
  const now = Date.now();
  for (const n of names) {
    if (!/^(export|import)-/.test(n)) continue;
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
  const walk = async (from, to, rel, stack) => {
    await fs.mkdir(to);
    for (const e of await fs.readdir(from, { withFileTypes: true })) {
      if (++counter.n > maxEntries) throw tooBig();
      const p = path.join(from, e.name), q = path.join(to, e.name), r = rel + e.name;
      if (e.isSymbolicLink()) {
        if (verbatim) { await fs.symlink(await fs.readlink(p), q); continue; }
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

// Un skill dans un dossier d'agent : un lien (même cassé) ou un dossier qui contient SKILL.md.
export async function isSkillEntry(p) {
  const l = await lstatOrNull(p);
  if (!l) return false;
  if (l.isSymbolicLink()) return true;
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

// Écriture atomique : fichier temporaire puis renommage.
export async function writeJsonAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, file);
  } catch (e) {
    // Échec : le fichier temporaire ne reste pas.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export function osName() {
  return process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
}

// Lien vers un dossier : symbolique sur mac/linux, jonction sous Windows.
export async function linkDir(target, at) {
  if (process.platform === 'win32') await fs.symlink(path.resolve(target), at, 'junction');
  else await fs.symlink(path.relative(path.dirname(at), target), at, 'dir');
}
