// Tests du programme lancé pour de vrai (node app/server.mjs) et de l'ouverture du navigateur (app/lib/open.mjs).
// Lancer : node --test app/test/main.test.mjs   (pas de réseau, pas de vrai dossier personnel)
// Chaque serveur lancé reçoit --home <A> et, en HOME/USERPROFILE, un leurre <B> qui doit rester vide :
// un câblage qui perdrait le dossier personnel écrirait dans B, jamais dans le vrai dossier personnel.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { makeHome, assertSafeHome, assertInHome, rmHome, lexists } from './helpers.mjs';
import { readOptions, start, StartError, WIRING } from '../server.mjs';
import { openAddress, hasScreen, openerCommand, headlessHelp, MANUAL } from '../lib/open.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(repo, 'app', 'server.mjs');
const REAL_HOME = path.resolve(os.homedir());
const WIN = process.platform === 'win32';

// ---------- Dossiers jetables ----------

const homes = [];
const children = [];
after(async () => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) { c.kill(); await once(c, 'exit'); }
  for (const h of homes.splice(0)) await rmHome(h);
});

// Dossier jetable vide (préfixe sa-test- : rmHome le retire).
async function emptyDir() {
  const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sa-test-')));
  assert.ok(d.startsWith(await fs.realpath(os.tmpdir()) + path.sep));
  assert.notEqual(d, REAL_HOME);
  homes.push(d);
  return d;
}

// Dossier personnel jetable avec les deux skills d'exemple dans Claude Code (vrais dossiers, aucun lien).
async function seededHome() {
  const h = await makeHome();
  homes.push(h);
  await assertSafeHome(h);
  const dest = path.join(h, '.claude', 'skills');
  assertInHome(h, dest);
  await fs.mkdir(dest, { recursive: true });
  for (const n of ['safe-notes', 'risky-installer']) await fs.cp(path.join(repo, 'examples', 'skills', n), path.join(dest, n), { recursive: true });
  return h;
}

async function listAll(dir) {
  try { return await fs.readdir(dir); } catch { return []; }
}

// ---------- Programme lancé ----------

// Lance node app/server.mjs. Rend { child, out, err, exit } ; exit : promesse du code de sortie.
function launch(args, decoy) {
  assert.ok(decoy && decoy !== REAL_HOME, 'leurre absent');
  const env = { ...process.env, HOME: decoy, USERPROFILE: decoy, CATALOG_URL: '' };
  const child = spawn(process.execPath, [SERVER, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const run = { child, out: '', err: '' };
  child.stdout.on('data', (c) => { run.out += c; });
  child.stderr.on('data', (c) => { run.err += c; });
  run.exit = new Promise((resolve) => child.on('exit', (code, signal) => resolve(code === null ? signal : code)));
  return run;
}

// Attend la ligne d'adresse, ou la sortie du programme.
async function ready(run, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = /^Skill Advisor: (http:\/\/127\.0\.0\.1:(\d+)\/\?c=([0-9a-f]{32}))\n/.exec(run.out);
    if (m) return { url: m[1], port: Number(m[2]), code: m[3] };
    if (run.child.exitCode !== null) throw new Error('le serveur s’est arrêté : ' + run.err);
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('serveur pas prêt : ' + run.err);
}

async function stop(run) {
  if (run.child.exitCode === null && run.child.signalCode === null) { run.child.kill(); await run.exit; }
}

function request(port, method, p, { token, body, raw, type } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: '127.0.0.1:' + port };
    if (token) headers['x-sa-token'] = token;
    let data = raw;
    if (body !== undefined) { data = Buffer.from(JSON.stringify(body)); headers['content-type'] = 'application/json'; }
    if (type) headers['content-type'] = type;
    if (data !== undefined) headers['content-length'] = data.length;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), json });
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}

// Ouvre la page avec le code et lit le jeton injecté.
async function tokenOf(port, code) {
  const r = await request(port, 'GET', '/?c=' + code);
  assert.equal(r.status, 200);
  const m = /window\.SA_LIVE=\{token:"([0-9a-f]{64})"\}/.exec(r.text);
  assert.ok(m, 'jeton absent de la page');
  return m[1];
}

// ---------- Options et erreurs de démarrage (constat 94) ----------

test('readOptions : valeurs par défaut et options reconnues', () => {
  const d = readOptions(['--home', path.join(os.tmpdir(), 'x')]);
  assert.deepEqual({ ...d, home: undefined }, { port: 0, open: true, home: undefined, project: null });
  const o = readOptions(['--port', '8123', '--no-open', '--home', 'rel', '--project', 'mon projet']);
  assert.equal(o.port, 8123);
  assert.equal(o.open, false);
  assert.equal(o.home, path.resolve('rel'));
  assert.equal(o.project, path.resolve('mon projet'));
  for (const bad of [['--bidon'], ['--port'], ['--port', 'abc'], ['--port', '-1'], ['--port', '65536'], ['--port', '1.5'], ['--project', ' '], ['positionnel']]) {
    assert.throws(() => readOptions(bad), (e) => e instanceof StartError && e.exit === 2 && /^(Option|Port)/.test(e.message), bad.join(' '));
  }
  assert.equal(readOptions(['--version']).version, true);
  assert.equal(readOptions(['--help']).help, true);
});

// Constat 71 : --version et --help répondent, puis s'arrêtent avec le code 0, sans rien écrire.
test('--version : la version de package.json, code 0, rien écrit', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  const decoy = await emptyDir();
  const A = await emptyDir();
  const run = launch(['--version', '--home', A], decoy);
  assert.equal(await run.exit, 0);
  assert.equal(run.out, pkg.version + '\n');
  assert.equal(run.err, '');
  assert.deepEqual(await listAll(decoy), []);
  assert.deepEqual(await listAll(A), []);
});

test('--help : l\'usage en français, code 0, rien écrit', async () => {
  const decoy = await emptyDir();
  const A = await emptyDir();
  const run = launch(['--help', '--home', A], decoy);
  assert.equal(await run.exit, 0);
  assert.equal(run.err, '');
  assert.match(run.out, /^Usage : node app\/server\.mjs \[--port <n>\] \[--no-open\]/);
  for (const o of ['--port', '--no-open', '--project', '--home', '--version', '--help']) assert.ok(run.out.includes('  ' + o), o);
  assert.doesNotMatch(run.out, /—/);
  assert.doesNotMatch(run.out, /Skill Advisor: http/);
  assert.deepEqual(await listAll(decoy), []);
  assert.deepEqual(await listAll(A), []);
});

test('option inconnue : code 2, ligne d\'usage, rien démarré', async () => {
  const decoy = await emptyDir();
  const A = await emptyDir();
  const run = launch(['--bidon', '--no-open', '--home', A], decoy);
  assert.equal(await run.exit, 2);
  assert.equal(run.out, '');
  assert.match(run.err, /Option invalide\. Usage : node app\/server\.mjs/);
  assert.ok(!/\n\s+at /.test(run.err), 'trace dans le terminal');
  assert.deepEqual(await listAll(decoy), []);
});

test('port invalide : code 2, message en français', async () => {
  const decoy = await emptyDir();
  const A = await emptyDir();
  for (const p of ['abc', '70000']) {
    const run = launch(['--port', p, '--no-open', '--home', A], decoy);
    assert.equal(await run.exit, 2, p);
    assert.equal(run.out, '');
    assert.equal(run.err.trim(), 'Port invalide : ' + p);
  }
});

test('port déjà pris : code 1, message en français, sans trace', async () => {
  const decoy = await emptyDir();
  const A = await emptyDir();
  const busy = net.createServer();
  busy.listen(0, '127.0.0.1');
  await once(busy, 'listening');
  const p = busy.address().port;
  try {
    const run = launch(['--port', String(p), '--no-open', '--home', A], decoy);
    assert.equal(await run.exit, 1);
    assert.equal(run.out, '');
    assert.equal(run.err.trim(), 'Le port ' + p + ' est déjà pris. Choisissez-en un autre avec --port.');
  } finally { busy.close(); }
});

test('--project refusé : dossier absent, dossier personnel, racine', async () => {
  const decoy = await emptyDir();
  const A = await emptyDir();
  for (const dir of [path.join(A, 'absent'), A, path.parse(A).root]) {
    const run = launch(['--project', dir, '--no-open', '--home', A], decoy);
    assert.equal(await run.exit, 2, dir);
    assert.equal(run.out, '');
    assert.match(run.err, /^Option --project : /, dir);
  }
  assert.deepEqual(await listAll(decoy), []);
});

test('--project accepté : l\'état porte le projet ; --no-open n\'ouvre rien ; Ctrl+C arrête', async () => {
  const decoy = await emptyDir();
  const A = await seededHome();
  const P = await emptyDir();
  const run = launch(['--project', P, '--no-open', '--port', '0', '--home', A], decoy);
  const { port, code } = await ready(run);
  // Une seule ligne, sans jeton.
  assert.equal(run.out.split('\n').filter(Boolean).length, 1);
  const token = await tokenOf(port, code);
  assert.ok(!run.out.includes(token) && !run.err.includes(token));
  const r = await request(port, 'GET', '/api/state', { token });
  assert.equal(r.status, 200, r.text.slice(0, 300));
  assert.equal(r.json.cwd, P);
  // Plus de fichier de renvoi : aucun dossier run/.
  assert.equal(await lexists(path.join(A, '.skill-advisor', 'run')), false);
  if (!WIN) {
    run.child.kill('SIGINT');
    assert.equal(await run.exit, 0);
  } else await stop(run);
  assert.deepEqual(await listAll(decoy), []);
});

// ---------- Ouverture du navigateur (constats 84 et 86, puis navigateurs en snap) ----------
// Jamais par un vrai lancement : start() reçoit une commande factice.

function fakeRun(onCall) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args]);
    const p = new EventEmitter();
    p.unref = () => {};
    if (onCall) setImmediate(() => onCall(p));
    return p;
  };
  return { run, calls };
}

const START = /^http:\/\/127\.0\.0\.1:(\d+)\/start\?k=([0-9a-f]{16})$/;

test('start sans --no-open : le navigateur reçoit /start?k=<clé>, jamais le code ; la clé sert une fois', async () => {
  const A = await seededHome();
  const lines = [], warns = [];
  const { run, calls } = fakeRun();
  const s = await start({ home: A, port: 0, open: true }, { out: (x) => lines.push(x), warn: (x) => warns.push(x), opener: { platform: 'darwin', env: {}, run } });
  try {
    // Ligne prête inchangée : elle porte le code, dans le terminal de l'utilisateur.
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^Skill Advisor: http:\/\/127\.0\.0\.1:\d+\/\?c=[0-9a-f]{32}\n$/);
    assert.equal(lines[0], 'Skill Advisor: ' + s.url + '\n');
    const code = new URL(s.url).searchParams.get('c');
    const port = s.server.address().port;
    assert.equal(calls.length, 1);
    const [cmd, args] = calls[0];
    assert.equal(cmd, 'open');
    assert.equal(args.length, 1);
    const m = START.exec(args[0]);
    assert.ok(m, args[0]);
    assert.equal(Number(m[1]), port);
    assert.ok(!args.join(' ').includes(code), 'code dans les arguments');
    assert.ok(!args.join(' ').includes('?c='), 'code dans les arguments');
    assert.deepEqual(warns, []);
    // Aucun fichier de renvoi : ni dossier run/, ni fichier .html.
    assert.equal(await lexists(path.join(A, '.skill-advisor', 'run')), false);
    // Premier usage : renvoi vers l'adresse à usage unique, sans cache ni référent.
    let r = await request(port, 'GET', '/start?k=' + m[2]);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/?c=' + code);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['set-cookie'], undefined);
    assert.ok(!r.text.includes(code));
    // Deuxième usage : la clé ne vaut plus rien, le code ne sort plus.
    r = await request(port, 'GET', '/start?k=' + m[2]);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/');
    assert.ok(!r.text.includes(code));
    // Le code reçu par le renvoi ouvre la session.
    await tokenOf(port, code);
  } finally { s.server.closeAllConnections(); s.server.close(); await once(s.server, 'close'); }
});

test('start sous Linux et Windows : xdg-open et rundll32 reçoivent la même adresse /start', async () => {
  for (const [platform, env, cmd] of [['linux', { DISPLAY: ':0' }, 'xdg-open'], ['win32', {}, 'rundll32']]) {
    const A = await emptyDir();
    const { run, calls } = fakeRun();
    const s = await start({ home: A, port: 0, open: true }, { out: () => {}, warn: () => {}, opener: { platform, env, run } });
    try {
      assert.equal(calls.length, 1, platform);
      assert.equal(calls[0][0], cmd);
      const target = calls[0][1][calls[0][1].length - 1];
      assert.match(target, START);
      if (platform === 'win32') assert.deepEqual(calls[0][1], ['url.dll,FileProtocolHandler', target]);
      assert.equal(await lexists(path.join(A, '.skill-advisor', 'run')), false);
    } finally { s.server.close(); await once(s.server, 'close'); }
  }
});

test('Linux sans écran : rien n\'est ouvert ni écrit, marche à suivre affichée', async () => {
  const A = await emptyDir();
  const warns = [];
  const { run, calls } = fakeRun();
  const s = await start({ home: A, port: 0, open: true }, { out: () => {}, warn: (x) => warns.push(x), opener: { platform: 'linux', env: {}, run } });
  try {
    assert.equal(calls.length, 0);
    assert.deepEqual(await listAll(A), []);
    const port = s.server.address().port;
    assert.equal(warns.length, 1);
    assert.ok(warns[0].includes('ssh -L ' + port + ':127.0.0.1:' + port), warns[0]);
    assert.ok(!warns[0].includes('?c='), 'code dans l\'aide');
    assert.ok(!warns[0].includes('k='), 'clé dans l\'aide');
  } finally { s.server.close(); await once(s.server, 'close'); }
  assert.equal(hasScreen('linux', { WAYLAND_DISPLAY: 'wayland-0' }), true);
  assert.equal(hasScreen('linux', {}), false);
  assert.equal(hasScreen('darwin', {}), true);
  assert.equal(hasScreen('win32', {}), true);
});

test('ouverture en échec (commande absente ou code non nul) : une aide, une fois', async () => {
  const url = 'http://127.0.0.1:4000/start?k=' + 'a'.repeat(16);
  for (const [platform, fail] of [['linux', (p) => p.emit('error', new Error('ENOENT'))], ['darwin', (p) => p.emit('exit', 1)], ['linux', (p) => { p.emit('error', new Error('x')); p.emit('exit', 3); }]]) {
    const warns = [];
    const { run } = fakeRun(fail);
    const o = await openAddress({ url, platform, env: { DISPLAY: ':0' }, run, warn: (x) => warns.push(x) });
    assert.equal(o.opened, true);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(warns, [MANUAL], platform);
  }
  // Windows : code de sortie ignoré (rundll32 ne dit rien).
  const warns = [];
  const { run, calls } = fakeRun((p) => p.emit('exit', 1));
  await openAddress({ url, platform: 'win32', env: {}, run, warn: (x) => warns.push(x) });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(warns, []);
  assert.deepEqual(calls[0], ['rundll32', ['url.dll,FileProtocolHandler', url]]);
  assert.deepEqual(openerCommand(url, 'darwin'), ['open', [url]]);
  assert.deepEqual(openerCommand(url, 'linux'), ['xdg-open', [url]]);
  // Commande qui lève une erreur au lancement : une aide.
  const w2 = [];
  const o = await openAddress({ url, platform: 'darwin', env: {}, run: () => { throw new Error('spawn'); }, warn: (x) => w2.push(x) });
  assert.equal(o.opened, false);
  assert.deepEqual(w2, [MANUAL]);
});

test('ouverture : seule une adresse /start?k=<16 hex> de 127.0.0.1 part vers le navigateur', async () => {
  const bads = ['http://127.0.0.1:4000/?c=' + 'b'.repeat(32), 'http://evil.example/start?k=' + 'b'.repeat(16), 'http://127.0.0.1:4000/start?k=' + 'b'.repeat(15),
    'http://127.0.0.1:4000/start?k=' + 'b'.repeat(16) + '&c=' + 'b'.repeat(32), 'file:///tmp/open.html', 'http://localhost:4000/start?k=' + 'b'.repeat(16), null];
  for (const bad of bads) {
    const warns = [];
    const { run, calls } = fakeRun();
    const o = await openAddress({ url: bad, platform: 'darwin', env: {}, run, warn: (x) => warns.push(x) });
    assert.equal(o.opened, false, String(bad));
    assert.equal(calls.length, 0, String(bad));
    assert.deepEqual(warns, [MANUAL], String(bad));
  }
  assert.match(headlessHelp('http://127.0.0.1:4000/start?k=' + 'c'.repeat(16)), /ssh -L 4000:127\.0\.0\.1:4000/);
});

// ---------- Câblage du vrai lib (constat 40) ----------

// Une vérification par fonction : un nom manquant se voit seul.
describe('câblage : chaque fonction appelée existe dans son module', () => {
  for (const [key, [mod, fn]] of Object.entries(WIRING)) {
    test(key + ' -> ' + mod + '.' + fn, async () => {
      const m = await import(new URL('../lib/' + mod + '.mjs', import.meta.url).href);
      assert.equal(typeof m[fn], 'function');
    });
  }
});


// Un seul serveur pour toute la suite ; les tests passent dans l'ordre et chacun vérifie le disque.
describe('vrai serveur, vrai lib, dossier jetable : chaque route sans réseau', () => {
  let decoy, A, P, run, api, skills, backupsDir;
  const brief = (r) => r.status + ' ' + r.text.slice(0, 300);
  const settingsOf = async () => JSON.parse(await fs.readFile(path.join(A, '.skill-advisor', 'settings.json'), 'utf8'));
  const ids = {};

  before(async () => {
    decoy = await emptyDir();
    A = await seededHome();
    P = await emptyDir();
    run = launch(['--no-open', '--port', '0', '--home', A], decoy);
    const { port, code } = await ready(run);
    const token = await tokenOf(port, code);
    api = (method, p, opts = {}) => request(port, method, p, { token, ...opts });
    skills = path.join(A, '.claude', 'skills');
    backupsDir = path.join(A, '.skill-advisor', 'backups');
  });

  after(async () => {
    await stop(run);
    // Le leurre n'a rien reçu : chaque appel a bien eu le dossier jetable.
    assert.deepEqual(await listAll(decoy), []);
    // Aucune trace dans le terminal du serveur.
    assert.ok(!/\n\s+at /.test(run.err), run.err);
  });

  test('état : les deux skills d\'exemple, tous les agents connus, catalogue fourni', async () => {
    let r = await api('GET', '/api/state');
    assert.equal(r.status, 200, brief(r));
    const st = r.json;
    assert.equal(st.mode, 'live');
    assert.equal(st.home, A);
    assert.equal(st.cwd, A);
    assert.ok(st.agents.length >= 78, String(st.agents.length));
    const rows = Object.fromEntries(st.mine.map((x) => [x.name, x]));
    assert.deepEqual(Object.keys(rows).sort(), ['risky-installer', 'safe-notes']);
    assert.equal(rows['risky-installer'].warn, 2);
    assert.equal(rows['safe-notes'].warn, 0);
    assert.equal(rows['safe-notes'].ag['claude-code'], 'ok');
    for (const x of st.mine) assert.equal(x.scope, 'global');
    r = await api('GET', '/api/catalog');
    assert.equal(r.status, 200, brief(r));
    assert.equal(r.json.source, 'bundled');
  });

  test('installation refusée sans réseau : portée projet sans projet, source inconnue', async () => {
    let r = await api('POST', '/api/skills/install', { body: { items: [{ source: 'a/b', skill: 'x' }], agents: ['claude-code'], scope: 'project' } });
    assert.equal(r.status, 400, brief(r));
    assert.equal(r.json.error, 'BAD_INPUT');
    r = await api('POST', '/api/skills/install', { body: { items: [{ source: 'uizze.sh', skill: 'ios-design' }], agents: ['claude-code'], scope: 'global' } });
    assert.equal(r.status, 200, brief(r));
    assert.deepEqual(r.json.failed.map((f) => f.name), ['ios-design']);
    assert.equal(r.json.state.mine.length, 2);
  });

  test('désactiver puis réactiver', async () => {
    let r = await api('POST', '/api/skills/disable', { body: { names: ['safe-notes'], agents: ['claude-code'] } });
    assert.equal(r.status, 200, brief(r));
    assert.deepEqual(r.json.done, ['safe-notes']);
    assert.equal(await lexists(path.join(skills, 'safe-notes')), false);
    assert.equal(await lexists(path.join(A, '.skill-advisor', 'disabled', 'claude-code', 'safe-notes', 'SKILL.md')), true);
    assert.equal(r.json.state.mine.find((x) => x.name === 'safe-notes').on, false);
    r = await api('POST', '/api/skills/enable', { body: { names: ['safe-notes'], agents: ['claude-code'] } });
    assert.equal(r.status, 200, brief(r));
    assert.deepEqual(r.json.done, ['safe-notes']);
    assert.equal(await lexists(path.join(skills, 'safe-notes', 'SKILL.md')), true);
  });

  test('sauvegarde manuelle, export, import, application, suppression', async () => {
    let r = await api('POST', '/api/backups/create', { body: { names: ['safe-notes'], label: 'Essai' } });
    assert.equal(r.status, 200, brief(r));
    const manual = r.json.backup;
    assert.equal(manual.origin, 'manual');
    assert.equal(manual.label, 'Essai');
    assert.equal(await lexists(path.join(backupsDir, manual.id, 'meta.json')), true);
    assert.ok(r.json.state.backups.some((b) => b.id === manual.id));
    r = await api('GET', '/api/backups/export?id=' + encodeURIComponent(manual.id));
    assert.equal(r.status, 200, brief(r));
    assert.equal(r.headers['content-type'], 'application/gzip');
    assert.deepEqual([...r.buf.subarray(0, 2)], [0x1f, 0x8b]);
    r = await api('POST', '/api/backups/import', { raw: r.buf, type: 'application/gzip' });
    assert.equal(r.status, 200, brief(r));
    const imported = r.json.backup;
    assert.equal(imported.origin, 'import');
    assert.notEqual(imported.id, manual.id);
    assert.equal(await lexists(path.join(backupsDir, imported.id)), true);
    // Appliquer vers Cursor : le skill arrive dans le dossier partagé.
    r = await api('POST', '/api/backups/apply', { body: { id: manual.id, agents: ['cursor'], conflict: 'skip' } });
    assert.equal(r.status, 200, brief(r));
    assert.deepEqual(r.json.applied, [{ name: 'safe-notes', agent: 'cursor' }]);
    assert.equal(await lexists(path.join(A, '.agents', 'skills', 'safe-notes', 'SKILL.md')), true);
    // Supprimer la sauvegarde importée : son dossier part, l'autre reste.
    r = await api('POST', '/api/backups/delete', { body: { id: imported.id } });
    assert.equal(r.status, 200, brief(r));
    assert.equal(await lexists(path.join(backupsDir, imported.id)), false);
    assert.equal(await lexists(path.join(backupsDir, manual.id)), true);
  });

  test('désinstaller avec sauvegarde, puis restaurer : refus du motif à risque, puis force', async () => {
    const before = new Set(await listAll(backupsDir));
    let r = await api('POST', '/api/skills/remove', { body: { names: ['risky-installer'], agents: ['claude-code'], backup: true } });
    assert.equal(r.status, 200, brief(r));
    assert.deepEqual(r.json.removed, ['risky-installer']);
    assert.equal(await lexists(path.join(skills, 'risky-installer')), false);
    const added = (await listAll(backupsDir)).filter((n) => !before.has(n));
    assert.equal(added.length, 1, added.join(','));
    assert.ok(!r.json.state.mine.some((x) => x.name === 'risky-installer'));
    r = await api('POST', '/api/backups/restore', { body: { id: added[0] } });
    assert.equal(r.status, 409, brief(r));
    assert.equal(r.json.error, 'ROUGE');
    assert.deepEqual(r.json.names, ['risky-installer']);
    assert.equal(await lexists(path.join(skills, 'risky-installer')), false);
    r = await api('POST', '/api/backups/restore', { body: { id: added[0], force: ['risky-installer'] } });
    assert.equal(r.status, 200, brief(r));
    assert.equal(await lexists(path.join(skills, 'risky-installer', 'SKILL.md')), true);
    assert.ok(r.json.state.mine.some((x) => x.name === 'risky-installer'));
  });

  test('agents : masquer, montrer, cibles', async () => {
    let r = await api('POST', '/api/agents/hide', { body: { id: 'cursor' } });
    assert.equal(r.status, 200, brief(r));
    assert.ok((await settingsOf()).hidden.includes('cursor'));
    assert.equal(r.json.state.agents.find((a) => a.id === 'cursor').hidden, true);
    r = await api('POST', '/api/agents/show', { body: { id: 'cursor' } });
    assert.equal(r.status, 200, brief(r));
    assert.ok(!(await settingsOf()).hidden.includes('cursor'));
    r = await api('POST', '/api/agents/targets', { body: { ids: ['claude-code'] } });
    assert.equal(r.status, 200, brief(r));
    assert.deepEqual((await settingsOf()).targets, ['claude-code']);
  });

  test('agent personnalisé : ajout, doublon refusé, vidage, retrait', async () => {
    const own = path.join(A, 'outils', 'mon agent é', 'skills');
    await fs.mkdir(own, { recursive: true });
    await fs.cp(path.join(repo, 'examples', 'skills', 'safe-notes'), path.join(own, 'safe-notes'), { recursive: true });
    let r = await api('POST', '/api/agents/custom', { body: { name: 'Mon agent', dir: own } });
    assert.equal(r.status, 200, brief(r));
    const custom = r.json.agent;
    ids.custom = custom.id;
    assert.match(custom.id, /^custom-\d+$/);
    assert.ok(r.json.state.agents.some((a) => a.id === custom.id && a.custom));
    assert.ok((await settingsOf()).custom.some((c) => c.id === custom.id));
    r = await api('POST', '/api/agents/custom', { body: { name: 'Encore', dir: own } });
    assert.equal(r.status, 409, brief(r));
    assert.equal(r.json.error, 'EXISTS');
    r = await api('POST', '/api/agents/empty', { body: { id: custom.id, backup: false } });
    assert.equal(r.status, 200, brief(r));
    assert.deepEqual(r.json.removed, ['safe-notes']);
    assert.equal(await lexists(path.join(own, 'safe-notes')), false);
    r = await api('DELETE', '/api/agents/custom/' + custom.id);
    assert.equal(r.status, 200, brief(r));
    assert.ok(!(await settingsOf()).custom.some((c) => c.id === custom.id));
    assert.ok(!r.json.state.agents.some((a) => a.id === custom.id));
  });

  test('vider un agent qui lit le dossier partagé : 409 SHARED avec les lecteurs, rien retiré', async () => {
    const r0 = await api('GET', '/api/state');
    const reader = r0.json.agents.find((a) => a.universal && a.detected);
    assert.ok(reader, 'aucun lecteur détecté du dossier partagé');
    const r = await api('POST', '/api/agents/empty', { body: { id: reader.id, backup: true } });
    assert.equal(r.status, 409, brief(r));
    assert.equal(r.json.error, 'SHARED');
    assert.ok(Array.isArray(r.json.readers) && r.json.readers.includes(reader.id), brief(r));
    assert.equal(await lexists(path.join(A, '.agents', 'skills', 'safe-notes', 'SKILL.md')), true);
  });

  test('retirer du dossier partagé (agents: [shared]) : la copie propre de Claude Code reste', async () => {
    const own = path.join(skills, 'safe-notes', 'SKILL.md');
    assert.equal((await fs.lstat(path.join(skills, 'safe-notes'))).isSymbolicLink(), false);
    assert.equal(await lexists(own), true);
    const r = await api('POST', '/api/skills/remove', { body: { names: ['safe-notes'], agents: ['shared'], backup: false } });
    assert.equal(r.status, 200, brief(r));
    assert.deepEqual(r.json.removed, ['safe-notes']);
    assert.equal(await lexists(path.join(A, '.agents', 'skills', 'safe-notes')), false);
    assert.equal(await lexists(own), true);
    assert.ok(r.json.state.mine.some((x) => x.name === 'safe-notes'));
  });

  test('projet : choix, refus, retrait ; cwd du lib = projet, sinon dossier personnel', async () => {
    let r = await api('POST', '/api/project', { body: { dir: P } });
    assert.equal(r.status, 200, brief(r));
    assert.equal(r.json.state.cwd, P);
    for (const [dir, status] of [[A, 400], [path.join(A, '.skill-advisor'), 400], [path.dirname(A), 400], [path.join(P, 'absent'), 404], ['relatif', 400]]) {
      r = await api('POST', '/api/project', { body: { dir } });
      assert.equal(r.status, status, dir + ' ' + brief(r));
    }
    r = await api('GET', '/api/state');
    assert.equal(r.json.cwd, P);
    r = await api('POST', '/api/project', { body: { dir: null } });
    assert.equal(r.status, 200, brief(r));
    assert.equal(r.json.state.cwd, A);
  });

  test('état : champ project du contrat (version 1.0)', async () => {
    let r = await api('POST', '/api/project', { body: { dir: P } });
    assert.equal(r.status, 200, brief(r));
    assert.equal(r.json.state.project, P);
    r = await api('POST', '/api/project', { body: { dir: null } });
    assert.equal(r.json.state.project, null);
  });
});
