// Aides de test : dossier personnel jetable, skill posé à la main, garde-fous.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
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

// Lien relatif ~/.claude/skills/<name> -> <cible>, comme le fait le paquet skills.
export async function putLink(home, agentDir, name, target) {
  const dir = path.join(home, agentDir);
  await fs.mkdir(dir, { recursive: true });
  const at = path.join(dir, name);
  assertInHome(home, at);
  await fs.symlink(path.relative(dir, target), at, 'dir');
  return at;
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
