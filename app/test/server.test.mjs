// Tests du serveur local (app/server.mjs) et du catalogue (app/lib/catalog.mjs).
// Lancer : node --test app/test/server.test.mjs   (pas de réseau, pas de vrai dossier personnel)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import * as tar from 'tar';
import { fileURLToPath } from 'node:url';

import { createServer, browserCommand } from '../server.mjs';
import { getCatalog, clearCatalogCache } from '../lib/catalog.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKEN = 'a'.repeat(64);

// Dossier jetable sous le dossier temporaire du système, jamais le vrai dossier personnel.
function throwaway(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const real = fs.realpathSync(dir);
  assert.ok(real.startsWith(fs.realpathSync(os.tmpdir()) + path.sep), 'dossier jetable hors du dossier temporaire');
  assert.notEqual(real, fs.realpathSync(os.homedir()));
  return real;
}

// Agents connus du faux lib : cachés, non détectés et personnalisés compris.
const KNOWN_AGENTS = ['claude-code', 'cursor', 'zed', 'custom-1'];

// Faux lib : état en mémoire, journal des appels, erreurs à la demande.
function fakeLib() {
  const log = [];
  const st = { mode: 'live', os: 'mac', home: '/fake', agents: [], mine: [], backups: [], settings: { version: 1, custom: [], hidden: [], targets: [] } };
  const err = (code, message) => Object.assign(new Error(message), { code });
  // Le nom "boom-<CODE>" déclenche une erreur avec ce code.
  const maybeThrow = (names = []) => {
    for (const n of names) {
      const m = /^boom-([A-Z_]+)$/.exec(n);
      if (m) throw err(m[1] === 'PLAIN' ? undefined : m[1], m[1] === 'PLAIN' ? 'détail interne /chemin/secret' : 'Erreur ' + m[1] + '.');
    }
  };
  const lib = {
    log, st,
    delay: 0,
    async state() { log.push(['state']); return structuredClone(st); },
    async catalog() { log.push(['catalog']); return { skills: {}, source: 'bundled' }; },
    async install(a) {
      log.push(['install:start', a]);
      if (lib.delay) await new Promise((r) => setTimeout(r, lib.delay));
      maybeThrow(a.items.map((i) => i.skill));
      for (const i of a.items) st.mine.push({ id: i.source + '/' + i.skill, name: i.skill });
      log.push(['install:end', a]);
      return { installed: a.items.map((i) => i.skill), skipped: [], failed: [] };
    },
    async remove(a) {
      log.push(['remove', a]); maybeThrow(a.names);
      st.mine = st.mine.filter((r) => !a.names.includes(r.name));
      return { removed: a.names, backups: [], failed: [] };
    },
    async update(a) { log.push(['update', a]); return { updated: a.names || [], held: [], failed: [] }; },
    async check() { log.push(['check']); return { outdated: [] }; },
    async disable(a) { log.push(['disable', a]); maybeThrow(a.names); return { done: a.names, failed: [] }; },
    async enable(a) { log.push(['enable', a]); return { done: a.names, failed: [] }; },
    async restoreBackup(a) {
      log.push(['restoreBackup', a]);
      if (a.id === 'absent') throw err('NOT_FOUND', 'Sauvegarde introuvable.');
      if (a.id === 'rouge') { const e = err('ROUGE', 'risky porte un motif à risque. Confirmez pour le restaurer.'); e.names = ['risky']; throw e; }
    },
    async deleteBackup(a) { log.push(['deleteBackup', a]); },
    async addCustomAgent(a) {
      log.push(['addCustomAgent', a]);
      if (a.name === 'double') throw err('EXISTS', 'Cet agent existe déjà.');
      const agent = { id: 'custom-1', name: a.name, custom: true, globalDir: a.dir };
      st.agents.push(agent);
      return agent;
    },
    async removeCustomAgent(a) { log.push(['removeCustomAgent', a]); st.agents = st.agents.filter((x) => x.id !== a.id); },
    async hideAgent(a) { log.push(['hideAgent', a]); st.settings.hidden.push(a.id); },
    async showAgent(a) { log.push(['showAgent', a]); },
    async setTargets(a) { log.push(['setTargets', a]); st.settings.targets = a.ids; },
    async removeAgentSkills(a) { log.push(['removeAgentSkills', a]); return { removed: [], backups: [], failed: [] }; },
    async createManualBackup(a) {
      log.push(['createManualBackup:start', a]);
      if (lib.delay) await new Promise((r) => setTimeout(r, lib.delay));
      maybeThrow(a.names);
      log.push(['createManualBackup:end', a]);
      return { backup: { id: '20261113-120000-' + a.names[0], origin: 'manual', label: a.label || '', note: a.note || '' }, failed: [] };
    },
    async applyBackup(a) {
      log.push(['applyBackup:start', a]);
      if (lib.delay) await new Promise((r) => setTimeout(r, lib.delay));
      if (a.id === 'absent') throw err('NOT_FOUND', 'Sauvegarde introuvable.');
      // Comme le vrai lib : agent inconnu refusé avant toute écriture.
      const unknown = a.agents.find((x) => !KNOWN_AGENTS.includes(x));
      if (unknown) throw err('NOT_FOUND', 'Agent inconnu : ' + unknown + '.');
      log.push(['applyBackup:end', a]);
      return { applied: (a.names || ['pdf']).map((name) => ({ name, agent: a.agents[0] })), skipped: [], failed: [], backups: [] };
    },
    async exportBackup(a) {
      log.push(['exportBackup', a]);
      if (lib.delay) await new Promise((r) => setTimeout(r, lib.delay));
      log.push(['exportBackup:end', a]);
      if (a.id === 'absent') throw err('NOT_FOUND', 'Sauvegarde introuvable.');
      // "flux" : un flux lisible ; sinon un Buffer.
      if (a.id === 'flux') return Readable.from([Buffer.from([0x1f, 0x8b]), Buffer.from('suite')]);
      // "tar" : un vrai flux du paquet tar (Minipass), sur un dossier jetable.
      if (a.id === 'tar') return tar.c({ gzip: true, cwd: lib.tarDir }, ['.']);
      return Buffer.from([0x1f, 0x8b, 1, 2, 3]);
    },
    async importBackup(a) {
      log.push(['importBackup', { size: a.data.length, isBuffer: Buffer.isBuffer(a.data) }]);
      if (lib.delay) await new Promise((r) => setTimeout(r, lib.delay));
      log.push(['importBackup:end']);
      if (a.data.subarray(0, 3).toString() === 'BAD') throw err('BAD_ARCHIVE', 'Archive refusée.');
      return { backup: { id: '20261113-130000-pdf', origin: 'import' }, warnings: [] };
    }
  };
  return lib;
}

// Requête brute : permet de fixer Host et Origin à la main.
// length : Content-Length annoncé à la main. chunks : corps envoyé par morceaux, sans Content-Length.
function req(port, method, p, { headers = {}, body, raw, length, chunks: parts } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: '127.0.0.1:' + port, ...headers };
    let data = raw;
    if (body !== undefined) { data = JSON.stringify(body); if (!h['content-type']) h['content-type'] = 'application/json'; }
    if (data !== undefined) h['content-length'] = Buffer.byteLength(data);
    if (length !== undefined) h['content-length'] = length;
    let done = null;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        done = { status: res.statusCode, headers: res.headers, text, json, buf };
        resolve(done);
      });
    });
    // Le serveur peut couper la connexion après sa réponse (413) : erreur d'écriture tolérée.
    r.on('error', (e) => { if (!done && !['ECONNRESET', 'EPIPE'].includes(e.code)) reject(e); else if (!done) setTimeout(() => (done ? resolve(done) : reject(e)), 200); });
    if (parts) {
      (async () => {
        for (const c of parts) {
          if (r.destroyed) return;
          r.write(c);
          await new Promise((ok) => setTimeout(ok, 2));
        }
        r.end();
      })();
      return;
    }
    if (data !== undefined) r.write(data);
    r.end();
  });
}

// Envoi brut d'une archive par morceaux (sans fin de corps si stall) : dit si le serveur coupe la connexion.
function rawUpload(port, { total, stall = false }) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let head = '', sent = 0, closed = false;
    const done = () => resolve({ head, sent, closed });
    const timer = setTimeout(() => { s.destroy(); done(); }, 4000);
    s.on('data', (c) => { head += c.toString('latin1'); });
    s.on('error', () => {});
    s.on('close', () => { closed = true; clearTimeout(timer); done(); });
    s.write('POST /api/backups/import HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nX-SA-Token: ' + TOKEN +
      '\r\nContent-Type: application/gzip\r\nTransfer-Encoding: chunked\r\n\r\n');
    const chunk = Buffer.alloc(Math.min(total, 64 * 1024), 7);
    (async () => {
      while (sent < total && !s.destroyed) {
        s.write(chunk.length.toString(16) + '\r\n'); s.write(chunk); s.write('\r\n');
        sent += chunk.length;
        await new Promise((ok) => setTimeout(ok, 2));
      }
      // stall : le corps ne finit jamais, le serveur doit couper seul.
      if (!stall && !s.destroyed) s.write('0\r\n\r\n');
    })();
  });
}

let root, lib, server, port;
const api = (method, p, opts = {}) => req(port, method, p, { ...opts, headers: { 'x-sa-token': TOKEN, ...(opts.headers || {}) } });

before(async () => {
  root = throwaway('sa-root-');
  fs.mkdirSync(path.join(root, 'prototype', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'prototype', 'dist', 'preview.html'),
    '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>T</title>\n</head>\n<body><p>ok</p>\n<script>\nwindow.X=1;\n</script>\n</body></html>\n');
  lib = fakeLib();
  server = createServer({ lib, token: TOKEN, port: 0, root });
  if (!server.listening) await once(server, 'listening');
  port = server.address().port;
});

after(async () => { server.close(); });

// ---------- Sécurité ----------

test('écoute sur 127.0.0.1 seulement', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

test('jeton absent ou faux : 403', async () => {
  let r = await req(port, 'GET', '/api/state');
  assert.equal(r.status, 403);
  assert.deepEqual(r.json, { error: 'forbidden' });
  r = await req(port, 'GET', '/api/state', { headers: { 'x-sa-token': 'b'.repeat(64) } });
  assert.equal(r.status, 403);
  r = await req(port, 'GET', '/api/state', { headers: { 'x-sa-token': 'court' } });
  assert.equal(r.status, 403);
  // Le jeton dans l'adresse ne vaut pas sur /api.
  r = await req(port, 'GET', '/api/state?t=' + TOKEN);
  assert.equal(r.status, 403);
});

test('Host étranger : 403', async () => {
  let r = await api('GET', '/api/state', { headers: { host: 'evil.example:' + port } });
  assert.equal(r.status, 403);
  r = await api('GET', '/api/state', { headers: { host: '127.0.0.1:1' } });
  assert.equal(r.status, 403);
  r = await api('GET', '/api/state', { headers: { host: 'localhost:' + port } });
  assert.equal(r.status, 200);
});

test('Origin étrangère : 403, origine locale acceptée', async () => {
  let r = await api('GET', '/api/state', { headers: { origin: 'http://evil.example' } });
  assert.equal(r.status, 403);
  r = await api('POST', '/api/agents/hide', { headers: { origin: 'null' }, body: { id: 'cursor' } });
  assert.equal(r.status, 403);
  r = await api('GET', '/api/state', { headers: { origin: 'http://127.0.0.1:' + port } });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/state', { headers: { origin: 'http://localhost:' + port } });
  assert.equal(r.status, 200);
});

test('en-têtes de sécurité', async () => {
  const r = await api('GET', '/api/state');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['content-type'], /^application\/json/);
  const csp = r.headers['content-security-policy'];
  assert.ok(csp && /default-src 'none'/.test(csp));
  assert.equal(r.headers['set-cookie'], undefined);
});

test('POST sans JSON : 415, JSON invalide : 400', async () => {
  let r = await api('POST', '/api/agents/hide', { raw: 'id=cursor', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.status, 415);
  r = await api('POST', '/api/agents/hide', { raw: '{"id":"cursor"}', headers: { 'content-type': 'text/plain' } });
  assert.equal(r.status, 415);
  r = await api('POST', '/api/agents/hide', { raw: '{pas du json', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.equal(typeof r.json.message, 'string');
  r = await api('POST', '/api/agents/hide', { raw: '[1,2]', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/agents/hide', { raw: '{"id":"cursor"}', headers: { 'content-type': 'application/json; charset=utf-8' } });
  assert.equal(r.status, 200);
});

test('corps de plus de 1 Mo : 413', async () => {
  const big = JSON.stringify({ id: 'x'.repeat(1024 * 1024 + 10) });
  const r = await api('POST', '/api/agents/hide', { raw: big, headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 413);
  assert.equal(r.json.error, 'TOO_LARGE');
});

test('route inconnue : 404', async () => {
  let r = await api('GET', '/api/rien');
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'NOT_FOUND');
  r = await api('PUT', '/api/state');
  assert.equal(r.status, 404);
  r = await req(port, 'GET', '/autre?t=' + TOKEN);
  assert.equal(r.status, 404);
});

// ---------- Page ----------

const COOKIE = 'sa=' + TOKEN + '; HttpOnly; SameSite=Strict; Path=/';
const GONE = 'Ce lien a déjà servi ou a expiré. Relancez Skill Advisor (npm start) et ouvrez la nouvelle adresse affichée.';

test('GET / injecte SA_LIVE juste après <head>', async () => {
  const r = await req(port, 'GET', '/?c=' + server.newCode());
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  assert.ok(r.text.includes('<head>\n<script>window.SA_LIVE={token:"' + TOKEN + '"}</script>'), r.text.slice(0, 200));
  assert.ok(r.text.includes('window.X=1;'));
  assert.deepEqual(r.headers['set-cookie'], [COOKIE]);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.match(csp, /https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /https:\/\/fonts\.gstatic\.com/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  // Les deux scripts en ligne (injecté et existant) ont leur empreinte.
  assert.equal((csp.match(/'sha256-/g) || []).length, 2);
});

test('GET / sans code, code faux ou ancien ?t= : 403 en HTML', async () => {
  for (const p of ['/', '/?c=' + 'b'.repeat(32), '/?t=' + TOKEN, '/?c=' + TOKEN]) {
    const r = await req(port, 'GET', p);
    assert.equal(r.status, 403, p);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.ok(r.text.includes(GONE), p);
    assert.ok(r.text.includes('lang="fr"'));
    assert.ok(!r.text.includes('SA_LIVE'));
    assert.ok(!r.text.includes(TOKEN));
    assert.equal(r.headers['set-cookie'], undefined);
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
  }
  // Host étranger : refusé, et le code reste valable.
  const c = server.newCode();
  let r = await req(port, 'GET', '/?c=' + c, { headers: { host: 'evil.example:' + port } });
  assert.equal(r.status, 403);
  r = await req(port, 'GET', '/?c=' + c);
  assert.equal(r.status, 200);
});

test('code : 32 caractères hexadécimaux, un seul usage', async () => {
  const c = server.newCode();
  assert.match(c, /^[0-9a-f]{32}$/);
  assert.notEqual(server.newCode(), c);
  let r = await req(port, 'GET', '/?c=' + c);
  assert.equal(r.status, 200);
  r = await req(port, 'GET', '/?c=' + c);
  assert.equal(r.status, 403);
  assert.ok(r.text.includes(GONE));
  assert.ok(!r.text.includes(TOKEN));
});

test('code : expire après 10 minutes (horloge injectée)', async () => {
  let t = 1_000_000;
  const s = createServer({ lib: fakeLib(), token: TOKEN, port: 0, root, now: () => t });
  if (!s.listening) await once(s, 'listening');
  try {
    const sp = s.address().port;
    const a = s.newCode(), b = s.newCode();
    t += 10 * 60 * 1000 - 1;
    let r = await req(sp, 'GET', '/?c=' + a);
    assert.equal(r.status, 200);
    t += 2;
    r = await req(sp, 'GET', '/?c=' + b);
    assert.equal(r.status, 403);
    assert.ok(r.text.includes(GONE));
  } finally { s.close(); }
});

test('cookie : rechargement de la page, cookie faux refusé', async () => {
  const c = server.newCode();
  let r = await req(port, 'GET', '/?c=' + c);
  assert.equal(r.status, 200);
  const cookie = r.headers['set-cookie'][0].split(';')[0];
  assert.equal(cookie, 'sa=' + TOKEN);
  // Rechargement : même adresse (code déjà servi) ou adresse nue.
  for (const p of ['/?c=' + c, '/']) {
    r = await req(port, 'GET', p, { headers: { cookie: 'autre=1; ' + cookie + '; x=y' } });
    assert.equal(r.status, 200, p);
    assert.ok(r.text.includes('window.SA_LIVE={token:"' + TOKEN + '"}'));
  }
  // Cookie faux ou ancien : 403 seul, mais un code neuf passe.
  const stale = 'sa=' + 'b'.repeat(64);
  for (const h of [stale, 'xsa=' + TOKEN, 'sa=' + TOKEN.slice(1)]) {
    r = await req(port, 'GET', '/', { headers: { cookie: h } });
    assert.equal(r.status, 403, h);
  }
  r = await req(port, 'GET', '/?c=' + server.newCode(), { headers: { cookie: stale } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.headers['set-cookie'], [COOKIE]);
  // Cookie valide, Host étranger : 403.
  r = await req(port, 'GET', '/', { headers: { cookie, host: 'evil.example:' + port } });
  assert.equal(r.status, 403);
});

test('API : le cookie ou le code ne suffisent pas, l\'en-tête reste exigé', async () => {
  const c = server.newCode();
  let r = await req(port, 'GET', '/api/state', { headers: { cookie: 'sa=' + TOKEN } });
  assert.equal(r.status, 403);
  assert.deepEqual(r.json, { error: 'forbidden' });
  r = await req(port, 'GET', '/api/state?c=' + c);
  assert.equal(r.status, 403);
  r = await req(port, 'POST', '/api/agents/hide', { headers: { cookie: 'sa=' + TOKEN }, body: { id: 'cursor' } });
  assert.equal(r.status, 403);
  // Le code n'a pas été consommé par /api.
  r = await req(port, 'GET', '/?c=' + c);
  assert.equal(r.status, 200);
  r = await api('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.equal(r.headers['set-cookie'], undefined);
});

test('interface absente : 500, le code reste valable', async () => {
  const empty = throwaway('sa-vide-');
  const s = createServer({ lib: fakeLib(), token: TOKEN, port: 0, root: empty });
  if (!s.listening) await once(s, 'listening');
  try {
    const c = s.newCode();
    let r = await req(s.address().port, 'GET', '/?c=' + c);
    assert.equal(r.status, 500);
    assert.equal(r.headers['set-cookie'], undefined);
    fs.mkdirSync(path.join(empty, 'prototype', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(empty, 'prototype', 'dist', 'preview.html'), '<html><head></head><body></body></html>');
    r = await req(s.address().port, 'GET', '/?c=' + c);
    assert.equal(r.status, 200);
  } finally { s.close(); }
});

test('GET / sert la vraie interface quand elle existe', async (t) => {
  const real = path.join(repo, 'prototype', 'dist', 'preview.html');
  if (!fs.existsSync(real)) return t.skip('prototype/dist/preview.html absent');
  const s = createServer({ lib: fakeLib(), token: TOKEN, port: 0, root: repo });
  if (!s.listening) await once(s, 'listening');
  try {
    const r = await req(s.address().port, 'GET', '/?c=' + s.newCode());
    assert.equal(r.status, 200);
    assert.ok(/<head>\s*<script>window\.SA_LIVE=\{token:"[0-9a-f]{64}"\}<\/script>/.test(r.text));
  } finally { s.close(); }
});

// ---------- Routes ----------

test('GET /api/state et /api/catalog', async () => {
  let r = await api('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.equal(r.json.mode, 'live');
  r = await api('GET', '/api/catalog');
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'bundled');
});

test('POST /api/skills/install renvoie le résultat et l\'état', async () => {
  const r = await api('POST', '/api/skills/install', { body: { items: [{ source: 'anthropics/skills', skill: 'pdf' }], agents: ['claude-code'], scope: 'global' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.installed, ['pdf']);
  assert.ok(r.json.state.mine.some((x) => x.name === 'pdf'));
  const call = lib.log.find((l) => l[0] === 'install:start');
  assert.deepEqual(call[1], { items: [{ source: 'anthropics/skills', skill: 'pdf' }], agents: ['claude-code'], scope: 'global' });
});

test('install refuse une source ou un nom invalide', async () => {
  let r = await api('POST', '/api/skills/install', { body: { items: [{ source: 'file:///etc', skill: 'pdf' }], agents: [], scope: 'global' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'BAD_SOURCE');
  r = await api('POST', '/api/skills/install', { body: { items: [{ source: 'a/b', skill: '../x' }], agents: [], scope: 'global' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'BAD_NAME');
  r = await api('POST', '/api/skills/install', { body: { items: [{ source: 'https://github.com/a/b', skill: 'x' }], agents: ['Bad Id'], scope: 'global' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'BAD_NAME');
  assert.match(r.json.message, /agent/);
  for (const src of ['http://github.com/a/b', 'https://', 'https://exemple.com/a b', '../x', '.git/x', 'a/..', 'https://x.com/' + 'a'.repeat(2000)]) {
    r = await api('POST', '/api/skills/install', { body: { items: [{ source: src, skill: 'x' }], agents: [], scope: 'global' } });
    assert.equal(r.status, 400, src);
    assert.equal(r.json.error, 'BAD_SOURCE', src);
  }
  r = await api('POST', '/api/skills/install', { body: { items: [{ source: 'a/b', skill: 'x' }], agents: [], scope: 'partout' } });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/skills/install', { body: { agents: [] } });
  assert.equal(r.status, 400);
});

test('remove, update, check, disable, enable', async () => {
  let r = await api('POST', '/api/skills/remove', { body: { names: ['pdf'], agents: ['claude-code'], backup: true } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.removed, ['pdf']);
  assert.ok(r.json.state);
  assert.deepEqual(lib.log.find((l) => l[0] === 'remove')[1], { names: ['pdf'], agents: ['claude-code'], backup: true });
  r = await api('POST', '/api/skills/update', { body: { names: ['pdf'], force: ['pdf'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.updated, ['pdf']);
  assert.ok(r.json.state);
  r = await api('POST', '/api/skills/update', { body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(lib.log.filter((l) => l[0] === 'update').at(-1)[1], { names: undefined, force: undefined });
  r = await api('GET', '/api/skills/check');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { outdated: [] });
  r = await api('POST', '/api/skills/disable', { body: { names: ['pdf'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.done, ['pdf']);
  assert.ok(r.json.state);
  r = await api('POST', '/api/skills/enable', { body: { names: ['pdf'], agents: ['cursor'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.done, ['pdf']);
  r = await api('POST', '/api/skills/remove', { body: { names: 'pdf' } });
  assert.equal(r.status, 400);
});

test('sauvegardes : restore et delete', async () => {
  let r = await api('POST', '/api/backups/restore', { body: { id: '20261113-101500-pdf' } });
  assert.equal(r.status, 200);
  assert.ok(r.json.state);
  assert.deepEqual(Object.keys(r.json), ['state']);
  r = await api('POST', '/api/backups/delete', { body: { id: '20261113-101500-pdf' } });
  assert.equal(r.status, 200);
  assert.deepEqual(lib.log.find((l) => l[0] === 'deleteBackup')[1], { id: '20261113-101500-pdf' });
  r = await api('POST', '/api/backups/delete', { body: { id: '../../etc' } });
  assert.equal(r.status, 400);
});

test('sauvegardes : restore avec force, et refus ROUGE en 409 avec les noms', async () => {
  let r = await api('POST', '/api/backups/restore', { body: { id: '20261113-101500-pdf', force: ['pdf'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(lib.log.filter((l) => l[0] === 'restoreBackup').at(-1)[1], { id: '20261113-101500-pdf', force: ['pdf'] });
  r = await api('POST', '/api/backups/restore', { body: { id: '20261113-101500-pdf', force: ['../x'] } });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/backups/restore', { body: { id: 'rouge' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'ROUGE');
  assert.match(r.json.message, /motif à risque/);
  assert.deepEqual(r.json.names, ['risky']);
});

// ---------- Sauvegardes, étape 1 ----------

const last = (name) => lib.log.filter((l) => l[0] === name).at(-1);

test('POST /api/backups/create : résultat, état, champs transmis', async () => {
  let r = await api('POST', '/api/backups/create', { body: { names: ['pdf', 'docx'], label: 'Avant ménage', note: 'Ligne 1\nLigne 2' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.backup.origin, 'manual');
  assert.deepEqual(r.json.failed, []);
  assert.ok(r.json.state);
  assert.deepEqual(last('createManualBackup:start')[1], { names: ['pdf', 'docx'], label: 'Avant ménage', note: 'Ligne 1\nLigne 2' });
  // label et note facultatifs.
  r = await api('POST', '/api/backups/create', { body: { names: ['pdf'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(last('createManualBackup:start')[1], { names: ['pdf'], label: undefined, note: undefined });
});

test('create refuse un corps invalide', async () => {
  const cases = [
    [{}, 'BAD_INPUT'],
    [{ names: [] }, 'BAD_INPUT'],
    [{ names: 'pdf' }, 'BAD_INPUT'],
    [{ names: ['../x'] }, 'BAD_NAME'],
    [{ names: ['pdf'], label: 'x'.repeat(81) }, 'BAD_INPUT'],
    [{ names: ['pdf'], label: 'a\nb' }, 'BAD_INPUT'],
    [{ names: ['pdf'], label: 3 }, 'BAD_INPUT'],
    [{ names: ['pdf'], note: 'x'.repeat(501) }, 'BAD_INPUT'],
    [{ names: ['pdf'], note: 'a\u0000b' }, 'BAD_INPUT'],
    [{ names: ['pdf'], note: null }, 'BAD_INPUT']
  ];
  lib.log.length = 0;
  for (const [body, code] of cases) {
    const r = await api('POST', '/api/backups/create', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error, code, JSON.stringify(body));
    assert.equal(typeof r.json.message, 'string');
  }
  assert.equal(lib.log.filter((l) => l[0].startsWith('createManualBackup')).length, 0);
  // Limites exactes acceptées.
  const r = await api('POST', '/api/backups/create', { body: { names: ['pdf'], label: 'x'.repeat(80), note: 'y'.repeat(500) } });
  assert.equal(r.status, 200);
});

test('POST /api/backups/apply : résultat, état, champs transmis', async () => {
  let r = await api('POST', '/api/backups/apply', { body: { id: '20261113-101500-pdf', names: ['pdf'], agents: ['cursor', 'custom-1', 'zed'], conflict: 'replace', force: ['pdf'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.applied, [{ name: 'pdf', agent: 'cursor' }]);
  assert.deepEqual(r.json.skipped, []);
  assert.deepEqual(r.json.failed, []);
  assert.deepEqual(r.json.backups, []);
  assert.ok(r.json.state);
  assert.deepEqual(last('applyBackup:start')[1], { id: '20261113-101500-pdf', names: ['pdf'], agents: ['cursor', 'custom-1', 'zed'], conflict: 'replace', force: ['pdf'] });
  // names et force facultatifs.
  r = await api('POST', '/api/backups/apply', { body: { id: '20261113-101500-pdf', agents: ['claude-code'], conflict: 'skip' } });
  assert.equal(r.status, 200);
  assert.deepEqual(last('applyBackup:start')[1], { id: '20261113-101500-pdf', names: undefined, agents: ['claude-code'], conflict: 'skip', force: undefined });
  // Sauvegarde absente : 404 du lib.
  r = await api('POST', '/api/backups/apply', { body: { id: 'absent', agents: ['cursor'], conflict: 'skip' } });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'NOT_FOUND');
  // Agent au bon format mais inconnu : le lib refuse (404), son message part tel quel.
  for (const agent of ['inconnu', 'custom-9']) {
    r = await api('POST', '/api/backups/apply', { body: { id: '20261113-101500-pdf', agents: ['cursor', agent], conflict: 'skip' } });
    assert.equal(r.status, 404, agent);
    assert.deepEqual(r.json, { error: 'NOT_FOUND', message: 'Agent inconnu : ' + agent + '.' });
  }
});

test('apply refuse un corps invalide', async () => {
  const ok = { id: '20261113-101500-pdf', agents: ['cursor'], conflict: 'skip' };
  const cases = [
    [{ ...ok, id: '../../etc' }, 'BAD_NAME'],
    [{ ...ok, id: undefined }, 'BAD_INPUT'],
    [{ ...ok, agents: [] }, 'BAD_INPUT'],
    [{ ...ok, agents: undefined }, 'BAD_INPUT'],
    [{ ...ok, agents: ['Bad Id'] }, 'BAD_NAME'],
    [{ ...ok, agents: ['../x'] }, 'BAD_NAME'],
    [{ ...ok, agents: 'cursor' }, 'BAD_INPUT'],
    [{ ...ok, conflict: undefined }, 'BAD_INPUT'],
    [{ ...ok, conflict: 'merge' }, 'BAD_INPUT'],
    [{ ...ok, names: [] }, 'BAD_INPUT'],
    [{ ...ok, names: ['../x'] }, 'BAD_NAME'],
    [{ ...ok, names: ['pdf'], force: ['docx'] }, 'BAD_INPUT'],
    [{ ...ok, force: ['../x'] }, 'BAD_NAME'],
    [{ ...ok, force: 'pdf' }, 'BAD_INPUT']
  ];
  lib.log.length = 0;
  for (const [body, code] of cases) {
    const r = await api('POST', '/api/backups/apply', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error, code, JSON.stringify(body));
  }
  assert.equal(lib.log.filter((l) => l[0].startsWith('applyBackup')).length, 0);
  // force sans names : seul le format est contrôlé, le lib décide.
  const r = await api('POST', '/api/backups/apply', { body: { ...ok, force: ['pdf'] } });
  assert.equal(r.status, 200);
});

test('GET /api/backups/export : archive et en-têtes', async () => {
  let r = await api('GET', '/api/backups/export?id=20261113-101500-pdf');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/gzip');
  assert.equal(r.headers['content-disposition'], 'attachment; filename="skill-advisor-20261113-101500-pdf.tar.gz"');
  assert.equal(r.headers['content-length'], '5');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['content-security-policy'], /default-src 'none'/);
  assert.deepEqual([...r.buf], [0x1f, 0x8b, 1, 2, 3]);
  assert.deepEqual(last('exportBackup')[1], { id: '20261113-101500-pdf' });
  // Flux lisible.
  r = await api('GET', '/api/backups/export?id=flux');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/gzip');
  assert.equal(r.buf.toString('latin1'), '\x1f\x8bsuite');
  // Vrai flux tar : l'archive arrive entière et se relit.
  lib.tarDir = throwaway('sa-tar-');
  fs.mkdirSync(path.join(lib.tarDir, 'pdf'));
  fs.writeFileSync(path.join(lib.tarDir, 'pdf', 'SKILL.md'), '---\nname: pdf\n---\n');
  r = await api('GET', '/api/backups/export?id=tar');
  assert.equal(r.status, 200);
  assert.deepEqual([...r.buf.subarray(0, 2)], [0x1f, 0x8b]);
  const seen = [];
  await new Promise((ok, ko) => {
    const p = new tar.Parser({ onReadEntry: (e) => { seen.push(e.path); e.resume(); } });
    p.on('end', ok); p.on('error', ko);
    p.end(r.buf);
  });
  assert.ok(seen.includes('./pdf/SKILL.md'), seen.join(','));
});

test('export : identifiant absent, invalide ou inconnu', async () => {
  lib.log.length = 0;
  for (const q of ['', '?id=', '?id=../../etc', '?id=a%22b', '?x=1']) {
    const r = await api('GET', '/api/backups/export' + q);
    assert.equal(r.status, 400, q);
    assert.equal(r.json.error, 'BAD_NAME', q);
    if (q === '' || q === '?id=' || q === '?x=1') assert.equal(r.json.message, 'Identifiant de sauvegarde absent.', q);
  }
  // Identifiant refusé : le lib n'est pas appelé.
  assert.equal(lib.log.filter((l) => l[0] === 'exportBackup').length, 0);
  const r = await api('GET', '/api/backups/export?id=absent');
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'NOT_FOUND');
  assert.match(r.headers['content-type'], /^application\/json/);
  // Jeton exigé.
  const f = await req(port, 'GET', '/api/backups/export?id=20261113-101500-pdf');
  assert.equal(f.status, 403);
});

test('POST /api/backups/import : archive transmise en Buffer', async () => {
  const data = Buffer.from([0x1f, 0x8b, 8, 0, 9, 9, 9]);
  for (const type of ['application/gzip', 'application/octet-stream']) {
    const r = await api('POST', '/api/backups/import', { raw: data, headers: { 'content-type': type } });
    assert.equal(r.status, 200, type);
    assert.equal(r.json.backup.origin, 'import');
    assert.deepEqual(r.json.warnings, []);
    assert.ok(r.json.state);
    assert.deepEqual(last('importBackup')[1], { size: 7, isBuffer: true });
  }
  // Envoi par morceaux, sans Content-Length.
  const r = await api('POST', '/api/backups/import', { chunks: [data.subarray(0, 3), data.subarray(3)], headers: { 'content-type': 'application/gzip' } });
  assert.equal(r.status, 200);
  assert.deepEqual(last('importBackup')[1], { size: 7, isBuffer: true });
});

test('import : type refusé, archive vide ou refusée par le lib', async () => {
  lib.log.length = 0;
  for (const type of ['application/json', 'text/plain', 'multipart/form-data; boundary=x', undefined]) {
    const headers = type ? { 'content-type': type } : {};
    const r = await api('POST', '/api/backups/import', { raw: Buffer.from('{"a":1}'), headers });
    assert.equal(r.status, 415, String(type));
    assert.equal(r.json.error, 'UNSUPPORTED_TYPE');
  }
  let r = await api('POST', '/api/backups/import', { raw: Buffer.alloc(0), headers: { 'content-type': 'application/gzip' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'BAD_ARCHIVE');
  assert.equal(lib.log.filter((l) => l[0] === 'importBackup').length, 0);
  r = await api('POST', '/api/backups/import', { raw: Buffer.from('BAD archive'), headers: { 'content-type': 'application/gzip' } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { error: 'BAD_ARCHIVE', message: 'Archive refusée.' });
  // Jeton exigé, Origin étrangère refusée.
  r = await req(port, 'POST', '/api/backups/import', { raw: Buffer.from('x'), headers: { 'content-type': 'application/gzip' } });
  assert.equal(r.status, 403);
  r = await api('POST', '/api/backups/import', { raw: Buffer.from('x'), headers: { 'content-type': 'application/gzip', origin: 'http://evil.example' } });
  assert.equal(r.status, 403);
  // Une route JSON garde sa limite de 1 Mo.
  r = await api('POST', '/api/backups/create', { raw: JSON.stringify({ names: ['pdf'], note: 'x'.repeat(1024 * 1024) }), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 413);
});

test('import : plus de 200 Mo annoncés, 413 sans garder le corps', async () => {
  lib.log.length = 0;
  const r = await api('POST', '/api/backups/import', { raw: Buffer.from('petit'), length: String(200 * 1024 * 1024 + 1), headers: { 'content-type': 'application/gzip' } });
  assert.equal(r.status, 413);
  assert.equal(r.json.error, 'TOO_LARGE');
  assert.match(r.json.message, /200 Mo/);
  // Corps jamais lu en entier : la connexion ne resert pas.
  assert.equal(r.headers.connection, 'close');
  assert.equal(lib.log.filter((l) => l[0] === 'importBackup').length, 0);
});

test('import : flux qui dépasse la limite, 413 et arrêt de la lecture', async () => {
  const small = fakeLib();
  const s = createServer({ lib: small, token: TOKEN, port: 0, root, archiveLimit: 1024 });
  if (!s.listening) await once(s, 'listening');
  try {
    const sp = s.address().port;
    const parts = Array.from({ length: 64 }, () => Buffer.alloc(512, 7));
    const r = await req(sp, 'POST', '/api/backups/import', { chunks: parts, headers: { 'x-sa-token': TOKEN, 'content-type': 'application/gzip' } });
    assert.equal(r.status, 413);
    assert.equal(r.json.error, 'TOO_LARGE');
    assert.equal(small.log.filter((l) => l[0] === 'importBackup').length, 0);
    // Envoi qui continue bien au-delà : 413 quand même, puis le serveur coupe la connexion.
    const flood = await rawUpload(sp, { total: 16 * 1024 * 1024 });
    assert.match(flood.head, /^HTTP\/1\.1 413 /);
    assert.ok(flood.closed, 'connexion non coupée');
    assert.ok(flood.sent < 16 * 1024 * 1024, 'tout le corps a été accepté : ' + flood.sent);
    // Envoi qui s'arrête au milieu : coupé environ 1 s après la réponse.
    const stall = await rawUpload(sp, { total: 4096, stall: true });
    assert.match(stall.head, /^HTTP\/1\.1 413 /);
    assert.ok(stall.closed, 'connexion lente non coupée');
    assert.equal(small.log.filter((l) => l[0] === 'importBackup').length, 0);
    // Exactement la limite : accepté.
    const ok = await req(sp, 'POST', '/api/backups/import', { raw: Buffer.alloc(1024, 7), headers: { 'x-sa-token': TOKEN, 'content-type': 'application/gzip' } });
    assert.equal(ok.status, 200);
  } finally { s.close(); }
});

test('sauvegardes : create, apply, import et export passent par la file', async () => {
  lib.log.length = 0;
  lib.delay = 60;
  try {
    const [a, b, c, d] = await Promise.all([
      api('POST', '/api/backups/apply', { body: { id: '20261113-101500-pdf', agents: ['cursor'], conflict: 'skip' } }),
      api('POST', '/api/backups/create', { body: { names: ['pdf'] } }),
      api('POST', '/api/backups/import', { raw: Buffer.from('arch'), headers: { 'content-type': 'application/gzip' } }),
      api('GET', '/api/backups/export?id=20261113-101500-pdf')
    ]);
    for (const x of [a, b, c, d]) assert.equal(x.status, 200);
    const seq = lib.log.map((l) => l[0]).filter((n) => /^(applyBackup|createManualBackup|importBackup|exportBackup)/.test(n));
    // Aucun appel ne commence pendant un autre : chaque début est suivi de sa fin.
    assert.equal(seq.length, 8, seq.join(','));
    for (let k = 0; k < seq.length; k += 2) assert.equal(seq[k + 1], seq[k].replace(/:start$/, '') + ':end', seq.join(','));
  } finally { lib.delay = 0; }
});

test('code BAD_ARCHIVE du lib : 400', async () => {
  const r = await api('POST', '/api/skills/disable', { body: { names: ['boom-BAD_ARCHIVE'] } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { error: 'BAD_ARCHIVE', message: 'Erreur BAD_ARCHIVE.' });
});

test('agents : custom, delete, hide, show, targets, empty', async () => {
  let r = await api('POST', '/api/agents/custom', { body: { name: 'Mon agent', dir: '/tmp/x/skills' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.agent.id, 'custom-1');
  assert.ok(r.json.state.agents.some((a) => a.id === 'custom-1'));
  r = await api('DELETE', '/api/agents/custom/custom-1');
  assert.equal(r.status, 200);
  assert.ok(r.json.state);
  assert.deepEqual(lib.log.find((l) => l[0] === 'removeCustomAgent')[1], { id: 'custom-1' });
  r = await api('DELETE', '/api/agents/custom/..%2F..');
  assert.equal(r.status, 400);
  r = await api('POST', '/api/agents/hide', { body: { id: 'cursor' } });
  assert.equal(r.status, 200);
  r = await api('POST', '/api/agents/show', { body: { id: 'cursor' } });
  assert.equal(r.status, 200);
  r = await api('POST', '/api/agents/targets', { body: { ids: ['claude-code', 'cursor'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.state.settings.targets, ['claude-code', 'cursor']);
  r = await api('POST', '/api/agents/empty', { body: { id: 'cursor', backup: true } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.removed, []);
  assert.deepEqual(lib.log.find((l) => l[0] === 'removeAgentSkills')[1], { agent: 'cursor', backup: true });
  r = await api('POST', '/api/agents/targets', { body: { ids: 'cursor' } });
  assert.equal(r.status, 400);
  // Nom ou dossier vide, trop long ou avec un caractère de contrôle.
  for (const body of [{ name: '', dir: '/a' }, { name: 'a\nb', dir: '/a' }, { name: 'a', dir: '/a\u0000' }, { name: 'x'.repeat(65), dir: '/a' }, { name: 'a' }]) {
    r = await api('POST', '/api/agents/custom', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error, 'BAD_INPUT');
  }
});

// ---------- Erreurs ----------

test('codes d\'erreur du lib vers HTTP, sans trace', async () => {
  const cases = [['BAD_NAME', 400], ['BAD_SOURCE', 400], ['NOT_FOUND', 404], ['EXISTS', 409], ['GITHUB_LIMIT', 502], ['CLI_FAILED', 500], ['OUTSIDE_HOME', 500]];
  for (const [code, status] of cases) {
    const r = await api('POST', '/api/skills/disable', { body: { names: ['boom-' + code] } });
    assert.equal(r.status, status, code);
    assert.deepEqual(r.json, { error: code, message: 'Erreur ' + code + '.' });
  }
  const r = await api('POST', '/api/skills/disable', { body: { names: ['boom-PLAIN'] } });
  assert.equal(r.status, 500);
  assert.equal(r.json.error, 'INTERNAL');
  assert.ok(!r.text.includes('/chemin/secret'));
  assert.ok(!/at .*\.mjs/.test(r.text));
  const e = await api('POST', '/api/agents/custom', { body: { name: 'double', dir: '/tmp/y' } });
  assert.equal(e.status, 409);
  const n = await api('POST', '/api/backups/restore', { body: { id: 'absent' } });
  assert.equal(n.status, 404);
});

// ---------- File d'attente ----------

test('deux POST simultanés passent l\'un après l\'autre', async () => {
  lib.log.length = 0;
  lib.delay = 80;
  try {
    const body = (s) => ({ items: [{ source: 'a/b', skill: s }], agents: [], scope: 'global' });
    const [a, b] = await Promise.all([
      api('POST', '/api/skills/install', { body: body('un') }),
      api('POST', '/api/skills/install', { body: body('deux') })
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const seq = lib.log.filter((l) => l[0].startsWith('install')).map((l) => l[0]);
    assert.deepEqual(seq, ['install:start', 'install:end', 'install:start', 'install:end']);
  } finally { lib.delay = 0; }
});

test('une erreur ne bloque pas la file', async () => {
  const r1 = await api('POST', '/api/skills/disable', { body: { names: ['boom-CLI_FAILED'] } });
  assert.equal(r1.status, 500);
  const r2 = await api('POST', '/api/skills/enable', { body: { names: ['pdf'] } });
  assert.equal(r2.status, 200);
});

// ---------- Catalogue ----------

test('catalogue : en ligne, puis cache', async () => {
  clearCatalogCache();
  let hits = 0;
  const s = http.createServer((q, res) => {
    hits++;
    assert.equal(q.url, '/api/catalog');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ generatedAt: 'x', source: 'skills.sh', skills: { 'a/b/c': { id: 'a/b/c' } } }));
  });
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  try {
    const url = 'http://127.0.0.1:' + s.address().port;
    const c = await getCatalog({ url, bundledPath: path.join(repo, 'catalog', 'catalog.json') });
    assert.equal(c.source, 'online');
    assert.ok(c.skills['a/b/c']);
    const c2 = await getCatalog({ url, bundledPath: path.join(repo, 'catalog', 'catalog.json') });
    assert.equal(c2.source, 'online');
    assert.equal(hits, 1);
  } finally { s.close(); clearCatalogCache(); }
});

test('catalogue : sans adresse, échec, délai dépassé ou mauvaise réponse : fichier fourni', async () => {
  const bundledPath = path.join(repo, 'catalog', 'catalog.json');
  clearCatalogCache();
  let c = await getCatalog({ url: '', bundledPath });
  assert.equal(c.source, 'bundled');
  assert.ok(Object.keys(c.skills).length > 0);
  // Port fermé.
  clearCatalogCache();
  const closed = http.createServer();
  closed.listen(0, '127.0.0.1'); await once(closed, 'listening');
  const deadPort = closed.address().port; closed.close(); await once(closed, 'close');
  c = await getCatalog({ url: 'http://127.0.0.1:' + deadPort, bundledPath });
  assert.equal(c.source, 'bundled');
  // Serveur muet : délai dépassé.
  clearCatalogCache();
  const mute = http.createServer(() => {});
  mute.listen(0, '127.0.0.1'); await once(mute, 'listening');
  const t0 = Date.now();
  c = await getCatalog({ url: 'http://127.0.0.1:' + mute.address().port, bundledPath, timeoutMs: 150 });
  assert.equal(c.source, 'bundled');
  assert.ok(Date.now() - t0 < 3000);
  mute.closeAllConnections(); mute.close();
  // Réponse sans "skills" ou statut 500.
  clearCatalogCache();
  const bad = http.createServer((q, res) => { res.statusCode = q.url.includes('x500') ? 500 : 200; res.end('{"rien":1}'); });
  bad.listen(0, '127.0.0.1'); await once(bad, 'listening');
  c = await getCatalog({ url: 'http://127.0.0.1:' + bad.address().port, bundledPath });
  assert.equal(c.source, 'bundled');
  bad.close();
  clearCatalogCache();
});

test('catalogue : fichier fourni absent ou illisible : erreur NOT_FOUND en français', async () => {
  const dir = throwaway('sa-cat-');
  for (const [file, content] of [['absent.json', null], ['casse.json', '{pas du json'], ['vide.json', '{"rien":1}']]) {
    const bundledPath = path.join(dir, file);
    if (content !== null) fs.writeFileSync(bundledPath, content);
    clearCatalogCache();
    await assert.rejects(getCatalog({ url: '', bundledPath }), (e) => {
      assert.equal(e.code, 'NOT_FOUND', file);
      assert.match(e.message, /^Catalogue/);
      assert.ok(!e.message.includes(dir), 'chemin dans le message');
      return true;
    });
  }
  clearCatalogCache();
});

test('catalogue : la variable CATALOG_URL sert d\'adresse par défaut', async () => {
  clearCatalogCache();
  const s = http.createServer((q, res) => { res.end(JSON.stringify({ skills: { z: {} } })); });
  s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const old = process.env.CATALOG_URL;
  process.env.CATALOG_URL = 'http://127.0.0.1:' + s.address().port;
  try {
    const c = await getCatalog({ bundledPath: path.join(repo, 'catalog', 'catalog.json') });
    assert.equal(c.source, 'online');
    assert.ok(c.skills.z);
  } finally {
    if (old === undefined) delete process.env.CATALOG_URL; else process.env.CATALOG_URL = old;
    s.close(); clearCatalogCache();
  }
});

// ---------- Programme ----------

test('ouverture du navigateur : commande et arguments, sans shell', () => {
  const url = 'http://127.0.0.1:5000/?c=' + 'c'.repeat(32);
  assert.deepEqual(browserCommand(url, 'darwin'), ['open', [url]]);
  assert.deepEqual(browserCommand(url, 'win32'), ['rundll32', ['url.dll,FileProtocolHandler', url]]);
  assert.deepEqual(browserCommand(url, 'linux'), ['xdg-open', [url]]);
});

// Environnement d'enfant : dossier personnel jetable, aucune variable qui pointe ailleurs.
function childEnv(home) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/_HOME$|^XDG_|^CLAUDE_CONFIG_DIR$|^APPDATA$|^LOCALAPPDATA$|^CATALOG_URL$/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), DISABLE_TELEMETRY: '1' };
}

// Vérifie, avant tout lancement, que chaque dossier d'agent vu par "skills" est dans le dossier jetable.
async function assertAgentsInside(home) {
  const code = 'import("skills").then(async (m) => { const a = await m.getSupportedAgents(); process.stdout.write(JSON.stringify(a.map((x) => x.globalSkillsDir).filter(Boolean))); })';
  const p = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: repo, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (c) => { out += c; });
  const [exit] = await once(p, 'exit');
  assert.equal(exit, 0, 'impossible de lire les agents');
  const dirs = JSON.parse(out);
  assert.ok(dirs.length > 0);
  for (const d of dirs) {
    assert.ok(path.resolve(d).startsWith(home + path.sep), 'dossier d\'agent hors du dossier jetable : ' + d);
  }
}

const sliceA = fs.existsSync(path.join(repo, 'app', 'lib', 'inventory.mjs'));
test('node app/server.mjs --no-open --port 0 --home <jetable>', { todo: sliceA ? false : 'app/lib/inventory.mjs absent' }, async () => {
  const home = throwaway('sa-home-');
  await assertAgentsInside(home);
  const p = spawn(process.execPath, [path.join(repo, 'app', 'server.mjs'), '--no-open', '--port', '0', '--home', home],
    { cwd: repo, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let out = '';
    const line = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('pas de ligne prête : ' + out)), 10000);
      p.stdout.on('data', (c) => {
        out += c;
        const i = out.indexOf('\n');
        if (i >= 0) { clearTimeout(timer); resolve(out.slice(0, i)); }
      });
      p.on('exit', (c) => { clearTimeout(timer); reject(new Error('arrêt du serveur, code ' + c)); });
    });
    const m = /^Skill Advisor: http:\/\/127\.0\.0\.1:(\d+)\/\?c=([0-9a-f]{32})$/.exec(line);
    assert.ok(m, 'ligne prête inattendue : ' + line);
    // Le jeton de session ne sort jamais dans la ligne.
    assert.ok(!/[0-9a-f]{64}/.test(line));
    const cport = Number(m[1]);
    const g = await req(cport, 'GET', '/?c=' + m[2]);
    assert.equal(g.status, 200);
    const t = /window\.SA_LIVE=\{token:"([0-9a-f]{64})"\}/.exec(g.text);
    assert.ok(t, 'jeton absent de la page');
    const again = await req(cport, 'GET', '/?c=' + m[2]);
    assert.equal(again.status, 403);
    const r = await req(cport, 'GET', '/api/state', { headers: { 'x-sa-token': t[1] } });
    if (r.status === 200) {
      assert.equal(r.json.mode, 'live');
    } else {
      assert.equal(r.status, 500);
      assert.equal(typeof r.json.error, 'string');
      assert.equal(typeof r.json.message, 'string');
      assert.ok(!/\n\s+at /.test(r.text));
    }
    const f = await req(cport, 'GET', '/api/state', { headers: { 'x-sa-token': 'b'.repeat(64) } });
    assert.equal(f.status, 403);
    // Branchement réel des routes de sauvegarde, cas d'échec seulement : rien n'est écrit hors du dossier jetable.
    const h = { 'x-sa-token': t[1] };
    const absent = '20260101-000000-absent';
    const checks = [
      ['GET', '/api/backups/export?id=' + absent, {}, 404, 'NOT_FOUND'],
      ['POST', '/api/backups/import', { raw: Buffer.from('pas une archive'), headers: { ...h, 'content-type': 'application/gzip' } }, 400, 'BAD_ARCHIVE'],
      ['POST', '/api/backups/apply', { body: { id: absent, agents: ['claude-code'], conflict: 'skip' } }, 404, 'NOT_FOUND'],
      ['POST', '/api/backups/create', { body: { names: ['absent-skill'] } }, 404, 'NOT_FOUND']
    ];
    for (const [method, p, o, status, code] of checks) {
      const x = await req(cport, method, p, { ...o, headers: { ...h, ...(o.headers || {}) } });
      assert.equal(x.status, status, p + ' ' + x.text);
      assert.equal(x.json.error, code, p);
      assert.equal(typeof x.json.message, 'string');
      assert.ok(!x.json.message.includes(home), 'chemin dans le message : ' + p);
    }
  } finally {
    p.kill();
  }
});
