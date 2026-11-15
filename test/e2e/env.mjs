// Dossier personnel jetable et vrai serveur, pour les essais bout à bout. Jamais le vrai dossier personnel.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { until, sleep } from './cdp.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Crée un dossier jetable sous os.tmpdir() (chemin réel) et vérifie qu'il n'est pas le vrai dossier personnel.
export function tempDir(prefix) {
  // realpath natif : sous Windows, développe les noms courts (C:\Users\RUNNER~1) comme le serveur.
  const tmp = fs.realpathSync.native(os.tmpdir());
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(tmp, prefix)));
  const real = path.resolve(os.homedir());
  if (!d.startsWith(tmp + path.sep) || d === real) throw new Error('ARRÊT : dossier d\'essai inattendu : ' + d);
  return d;
}

// Dossier personnel jetable : Claude Code, Cursor et Windsurf détectés, les deux skills d'exemple copiés à la main dans Claude Code.
export function makeHome() {
  const home = tempDir('sa-e2e-home-');
  for (const d of ['.claude/skills', '.cursor', '.codeium/windsurf']) fs.mkdirSync(path.join(home, d), { recursive: true });
  for (const n of ['safe-notes', 'risky-installer']) {
    fs.cpSync(path.join(ROOT, 'examples', 'skills', n), path.join(home, '.claude', 'skills', n), { recursive: true });
  }
  return home;
}

// Retire un dossier jetable ; Windows garde parfois des fichiers verrouillés un instant (profil Chrome).
export async function removeDir(d) {
  if (!d || !d.startsWith(fs.realpathSync.native(os.tmpdir()))) return;
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); return; } catch { await sleep(300); }
  }
}

// Lance node app/server.mjs --no-open --port 0 --home <home>, avec HOME et USERPROFILE sur ce dossier.
// Rend { url, base, stop, stderr }.
export async function startServer(home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  // Ni réseau ni catalogue en ligne pendant ces essais.
  for (const k of ['SA_NET', 'CATALOG_URL', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']) delete env[k];
  const srv = spawn(process.execPath, [path.join(ROOT, 'app', 'server.mjs'), '--no-open', '--port', '0', '--home', home],
    { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { err += d; });
  const url = await until(() => {
    if (srv.exitCode !== null) throw new Error('Le serveur s\'est arrêté : ' + err.slice(-600));
    const m = out.match(/Skill Advisor: (http:\/\/127\.0\.0\.1:\d+\/\?c=[0-9a-f]+)/);
    return m && m[1];
  }, 'ligne « Skill Advisor: http://127.0.0.1:<port>/?c=<code> »', 30000);
  return {
    url,
    base: url.split('/?')[0],
    stderr: () => err,
    async stop() {
      if (srv.exitCode !== null) return;
      srv.kill();
      await Promise.race([new Promise((r) => srv.once('exit', r)), sleep(3000)]);
      if (srv.exitCode === null) srv.kill('SIGKILL');
    },
  };
}
