// Aides de test : dossier personnel jetable, skill posé à la main, sources locales, garde-fous.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { Header } from 'tar';
import { call } from '../lib/worker.mjs';

const REAL_HOME = path.resolve(os.homedir());

// Refuse tout chemin hors du dossier jetable (et le vrai dossier personnel).
export function assertInHome(home, p) {
  const rel = path.relative(home, path.resolve(p));
  assert.ok(path.resolve(home) !== REAL_HOME, 'vrai dossier personnel refusé');
  assert.ok(rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)), 'hors du dossier jetable : ' + p);
}

// Crée un dossier personnel jetable (chemin réel, sans lien /var -> /private/var).
export async function makeHome() {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-test-'));
  const home = await fs.realpath(raw);
  assert.ok(home.startsWith(await fs.realpath(os.tmpdir())), 'dossier jetable hors du dossier temporaire');
  assert.notEqual(home, REAL_HOME);
  for (const d of ['.claude', '.cursor', '.gemini']) await fs.mkdir(path.join(home, d), { recursive: true });
  return home;
}

// Vérifie, avant toute écriture, que chaque dossier d'agent est dans le dossier jetable.
export async function assertSafeHome(home) {
  const agents = await call('getSupportedAgents', [], { home });
  assert.ok(agents.length > 70);
  for (const a of agents) {
    if (a.globalSkillsDir) {
      const rel = path.relative(home, a.globalSkillsDir);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('ARRÊT : dossier d’agent hors du dossier jetable : ' + a.globalSkillsDir);
    }
  }
  return agents;
}

export function skillMd(name, desc, body) {
  return '---\nname: ' + name + '\ndescription: ' + desc + '\n---\n\n' + (body || '# ' + name + '\n\nInstructions.\n');
}

// Pose un skill partagé dans ~/.agents/skills/<name>.
export async function putShared(home, name, desc, body) {
  const dir = path.join(home, '.agents', 'skills', name);
  assertInHome(home, dir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), skillMd(name, desc || 'Un skill de test.', body));
  return dir;
}

// Lien ~/.claude/skills/<name> -> <cible>, comme le fait le paquet skills :
// relatif sur mac et Linux, jonction à cible absolue sous Windows (aucun droit spécial requis).
export async function putLink(home, agentDir, name, target) {
  const dir = path.join(home, agentDir);
  await fs.mkdir(dir, { recursive: true });
  const at = path.join(dir, name);
  assertInHome(home, at);
  if (process.platform === 'win32') await fs.symlink(path.resolve(target), at, 'junction');
  else await fs.symlink(path.relative(dir, target), at, 'dir');
  return at;
}

// Lien vers un dossier pour un test : jonction sous Windows, lien symbolique ailleurs.
export async function dirLink(target, at) {
  if (process.platform === 'win32') await fs.symlink(path.resolve(path.dirname(at), target), at, 'junction');
  else await fs.symlink(target, at, 'dir');
}

// Les liens de fichier demandent un droit spécial sous Windows (mode développeur) : sondé une fois.
let fileLinks = null;
export async function fileLinksOk() {
  if (fileLinks !== null) return fileLinks;
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-link-'));
  try {
    await fs.writeFile(path.join(d, 'a'), 'x');
    await fs.symlink('a', path.join(d, 'b'), 'file');
    fileLinks = true;
  } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    fileLinks = false;
  } finally { await fs.rm(d, { recursive: true, force: true }); }
  return fileLinks;
}
export const NO_FILE_LINK = 'liens de fichier refusés (EPERM) : compte Windows sans le droit de créer des liens symboliques';

// git présent ? Les sources locales des tests passent par lui.
let gitOk = null;
export function hasGit() {
  if (gitOk === null) { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); gitOk = true; } catch { gitOk = false; } }
  return gitOk;
}

// Dépôt git local servi à la place de https://gitlab.com/acme/<repo> : la règle insteadOf va dans le
// ~/.gitconfig du dossier jetable, lu par git dans l'enfant (HOME jetable). Aucun réseau.
// skills : { dossier: { name?, desc?, body?, files?: { chemin: texte } } }. Chemin avec espace et accent.
export async function makeRepo(home, repo, skills) {
  const dir = path.join(home, 'dépôts sources', repo);
  assertInHome(home, dir);
  await fs.mkdir(dir, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], { env, stdio: 'pipe' });
  const write = async (map) => {
    for (const [folder, s] of Object.entries(map)) {
      const at = path.join(dir, 'skills', folder);
      if (s === null) { await fs.rm(at, { recursive: true, force: true }); continue; }
      await fs.mkdir(at, { recursive: true });
      await fs.writeFile(path.join(at, 'SKILL.md'), skillMd(s.name || folder, s.desc || 'Un skill de test.', s.body));
      for (const [f, t] of Object.entries(s.files || {})) {
        await fs.mkdir(path.dirname(path.join(at, f)), { recursive: true });
        await fs.writeFile(path.join(at, f), t);
      }
    }
  };
  await write(skills);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'v1');
  const url = 'https://gitlab.com/acme/' + repo;
  const cfg = path.join(home, '.gitconfig');
  assertInHome(home, cfg);
  await fs.appendFile(cfg, '[url "' + dir.split(path.sep).join('/') + '"]\n\tinsteadOf = ' + url + '.git\n');
  return {
    source: url, dir,
    // Nouvelle version du dépôt.
    async commit(map) { await write(map); git('add', '-A'); git('commit', '-qm', 'suite'); },
  };
}

// Adresse https://gitlab.com/acme/<repo> détournée vers un dossier absent : dépôt introuvable, sans réseau.
export async function missingRepo(home, repo) {
  const cfg = path.join(home, '.gitconfig');
  assertInHome(home, cfg);
  const dir = path.join(home, 'dépôts sources', 'absent-' + repo);
  await fs.appendFile(cfg, '[url "' + dir.split(path.sep).join('/') + '"]\n\tinsteadOf = https://gitlab.com/acme/' + repo + '.git\n');
  return 'https://gitlab.com/acme/' + repo;
}

export async function putLock(home, entries) {
  const file = path.join(home, '.agents', '.skill-lock.json');
  assertInHome(home, file);
  let lock = { version: 3, skills: {}, dismissed: {} };
  try { lock = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* neuf */ }
  const now = new Date().toISOString();
  for (const [name, src] of Object.entries(entries)) {
    lock.skills[name] = {
      source: src, sourceType: 'github', sourceUrl: 'https://github.com/' + src + '.git',
      skillPath: 'skills/' + name + '/SKILL.md', skillFolderHash: 'abc123', installedAt: now, updatedAt: now,
    };
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(lock, null, 2));
}

export async function readLock(home) {
  try { return JSON.parse(await fs.readFile(path.join(home, '.agents', '.skill-lock.json'), 'utf8')); } catch { return null; }
}

// Le skill de démonstration : dossier partagé, lien depuis Claude Code, entrée de verrou.
export async function demoHome() {
  const home = await makeHome();
  await assertSafeHome(home);
  const shared = await putShared(home, 'demo-skill', 'Démonstration pour les tests.');
  await putLink(home, '.claude/skills', 'demo-skill', shared);
  await putLock(home, { 'demo-skill': 'vercel-labs/agent-skills' });
  return home;
}

export async function rmHome(home) {
  if (!home) return;
  const tmp = await fs.realpath(os.tmpdir());
  assert.ok(home.startsWith(tmp + path.sep) && path.basename(home).startsWith('sa-test-'));
  await fs.rm(home, { recursive: true, force: true });
}

export async function lexists(p) {
  try { await fs.lstat(p); return true; } catch { return false; }
}

// Archive tar faite à la main, bloc par bloc, pour fabriquer des archives piégées.
// entries : [{ path, type?, body?, size?, linkpath? }] ; size sans body : en-tête seul, sans contenu.
export function tarOf(entries, opts = {}) {
  const blocks = [];
  for (const e of entries) {
    const type = e.type || 'File';
    const body = e.body === undefined ? null : Buffer.from(e.body);
    const size = e.size !== undefined ? e.size : body ? body.length : 0;
    const h = new Header({ path: e.path, type, mode: type === 'Directory' ? 0o755 : 0o644, size, mtime: new Date(0), linkpath: e.linkpath || '' });
    h.encode();
    blocks.push(h.block);
    if (body) {
      blocks.push(body);
      if (body.length % 512) blocks.push(Buffer.alloc(512 - (body.length % 512)));
    }
  }
  if (!opts.noEnd) blocks.push(Buffer.alloc(1024));
  const raw = Buffer.concat(blocks);
  return opts.gzip === false ? raw : zlib.gzipSync(raw);
}

// Toutes les entrées d'un dossier, chemins relatifs avec des /, triés.
export async function listTree(dir) {
  const out = [];
  const walk = async (d, rel) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const r = rel + e.name;
      if (e.isDirectory()) { out.push(r + '/'); await walk(path.join(d, e.name), r + '/'); } else out.push(r);
    }
  };
  await walk(dir, '');
  return out.sort();
}
