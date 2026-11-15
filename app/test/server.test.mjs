// Tests du serveur local (app/server.mjs) et du catalogue (app/lib/catalog.mjs).
// Lancer : node --test app/test/server.test.mjs   (pas de réseau, pas de vrai dossier personnel)
// Le programme lancé pour de vrai est testé dans app/test/main.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import * as tar from 'tar';
import { fileURLToPath } from 'node:url';

import { createServer } from '../server.mjs';

// Catalogue chargé à la demande : un défaut de ce module ne bloque pas les tests du serveur.
let getCatalog, clearCatalogCache;

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKEN = 'a'.repeat(64);

// Dossier jetable sous le dossier temporaire du système, jamais le vrai dossier personnel.
const made = [];
function throwaway(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const real = fs.realpathSync(dir);
  assert.ok(real.startsWith(fs.realpathSync(os.tmpdir()) + path.sep), 'dossier jetable hors du dossier temporaire');
  assert.notEqual(real, fs.realpathSync(os.homedir()));
  made.push(real);
  return real;
}

// Retire les dossiers jetables de cette passe : préfixe sa- et dossier temporaire exigés.
function cleanup() {
  const tmp = fs.realpathSync(os.tmpdir());
  for (const dir of made.splice(0)) {
    assert.ok(dir.startsWith(tmp + path.sep) && path.basename(dir).startsWith('sa-'), 'refus de supprimer ' + dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Agents connus du faux lib : cachés, non détectés et personnalisés compris.
const KNOWN_AGENTS = ['claude-code', 'cursor', 'zed', 'custom-1'];

// Faux lib : état en mémoire, journal des appels, erreurs à la demande.
function fakeLib() {
  const log = [];
  const st = { mode: 'live', os: 'mac', home: '/fake', version: '1.0.0', project: null, half: false, agents: [], mine: [], backups: [], settings: { version: 1, custom: [], hidden: [], targets: [] } };
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
    checkDelay: 0,
    stateDelay: 0,
    async state() {
      log.push(['state']);
      if (lib.stateDelay) await new Promise((r) => setTimeout(r, lib.stateDelay));
      log.push(['state:end']);
      return structuredClone(st);
    },
    async catalog() { log.push(['catalog']); return { skills: {}, source: 'bundled' }; },
    async searchData() { log.push(['searchData']); return { source: 'bundled', generatedAt: '2026-11-12T17:23:56.759Z', search: null }; },
    getProject() { return st.project; },
    async setProject(a) {
      log.push(['setProject', a]);
      if (a.dir === '/refuse') throw err('BAD_INPUT', 'Dossier refusé.');
      st.project = a.dir;
    },
    async preview(a) {
      log.push(['preview', a]);
      if (a.name === 'absent') throw err('NOT_FOUND', 'Skill introuvable.');
      return { name: a.name, files: [{ path: 'SKILL.md', status: 'changed', added: 2, removed: 1 }], scan: { verdict: 'vert', findings: [] }, scanOld: { verdict: 'vert' }, same: false };
    },
    // Écriture en deux temps : "half" est vrai entre les deux.
    async install(a) {
      log.push(['install:start', a]);
      st.half = true;
      if (lib.delay) await new Promise((r) => setTimeout(r, lib.delay));
      try { maybeThrow(a.items.map((i) => i.skill)); } finally { st.half = false; }
      for (const i of a.items) st.mine.push({ id: i.source + '/' + i.skill, name: i.skill });
      log.push(['install:end', a]);
      const held = a.items.filter((i) => i.skill === 'risky' && !(a.force || []).includes('risky')).map((i) => ({ name: i.skill, verdict: 'rouge', findings: [] }));
      return { installed: a.items.map((i) => i.skill).filter((n) => !held.some((h) => h.name === n)), held, conflicts: [], skipped: [], failed: a.items.filter((i) => i.skill === 'casse').map((i) => ({ name: i.skill, message: 'Dépôt introuvable.', detail: 'fatal: repository not found /chemin/secret' })) };
    },
    async remove(a) {
      log.push(['remove', a]); maybeThrow(a.names);
      st.mine = st.mine.filter((r) => !a.names.includes(r.name));
      return { removed: a.names, backups: [], failed: [] };
    },
    async update(a) { log.push(['update', a]); return { updated: a.names || [], held: [], failed: [] }; },
    outdated: [],
    async check(a) {
      log.push(['check', a]);
      if (lib.checkDelay) await new Promise((r) => setTimeout(r, lib.checkDelay));
      log.push(['check:end']);
      return { outdated: lib.outdated.map((name) => ({ name, scanNew: null })) };
    },
    async saveCheck(a) { log.push(['saveCheck', a]); },
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
    async removeAgentSkills(a) {
      log.push(['removeAgentSkills', a]);
      // Agent qui lit le dossier partagé : refus SHARED avec les lecteurs.
      if (a.agent === 'zed') { const e = err('SHARED', 'Zed lit le dossier partagé. Retirez ces skills pour tous ses lecteurs.'); e.readers = ['zed', 'cursor', 'Bad Id', 7]; throw e; }
      return { removed: [], backups: [], failed: [] };
    },
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
  ({ getCatalog, clearCatalogCache } = await import('../lib/catalog.mjs').catch(() => ({})));
  root = throwaway('sa-root-');
  fs.mkdirSync(path.join(root, 'prototype', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'prototype', 'dist', 'preview.html'),
    '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>T</title>\n</head>\n<body><p>ok</p>\n<script>\nwindow.X=1;\n</script>\n</body></html>\n');
  lib = fakeLib();
  server = createServer({ lib, token: TOKEN, port: 0, root });
  if (!server.listening) await once(server, 'listening');
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  cleanup();
});

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

const LIVE = (t) => '<script>window.SA_LIVE={token:' + (t ? '"' + t + '"' : 'null') + '}</script>';
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
// Scripts en ligne d'une page, lus sans le code du serveur.
function inlineScripts(html) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script/gi;
  let m;
  while ((m = re.exec(html))) if (!/\ssrc\s*=/i.test(m[1] || '')) out.push(m[2]);
  return out;
}
const cspHashes = (csp) => (csp.match(/'sha256-[^']+'/g) || []).map((h) => h.slice(8, -1)).sort();
// Chaque script en ligne de la page reçue a son empreinte dans l'en-tête, et rien d'autre.
function assertCsp(r) {
  assert.ok(!r.text.includes('\r'), 'retour chariot dans la page servie');
  const scripts = inlineScripts(r.text);
  assert.ok(scripts.length >= 2, 'scripts en ligne absents');
  assert.deepEqual(cspHashes(r.headers['content-security-policy']), scripts.map(sha).sort());
}

test('GET / avec un code neuf : jeton injecté juste après <head>, sans cookie', async () => {
  const r = await req(port, 'GET', '/?c=' + server.newCode());
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  assert.ok(r.text.includes('<head>\n' + LIVE(TOKEN)), r.text.slice(0, 200));
  assert.ok(r.text.includes('window.X=1;'));
  assert.equal(r.headers['set-cookie'], undefined);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.match(csp, /https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /https:\/\/fonts\.gstatic\.com/);
  assert.match(csp, /img-src 'self' data:/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
  // Les deux scripts en ligne (injecté et existant) ont leur empreinte.
  assert.equal(cspHashes(csp).length, 2);
  assertCsp(r);
});

test('GET / sans code, code faux ou ancien ?t= : la page, sans jeton', async () => {
  for (const p of ['/', '/?c=' + 'b'.repeat(32), '/?t=' + TOKEN, '/?c=' + TOKEN, '/?c=']) {
    const r = await req(port, 'GET', p, { headers: { cookie: 'sa=' + TOKEN } });
    assert.equal(r.status, 200, p);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.ok(r.text.includes('<head>\n' + LIVE(null)), p);
    assert.ok(r.text.includes('window.X=1;'));
    assert.ok(!r.text.includes(TOKEN), p);
    assert.equal(r.headers['set-cookie'], undefined);
    assertCsp(r);
  }
  // Host étranger : refusé, et le code reste valable.
  const c = server.newCode();
  let r = await req(port, 'GET', '/?c=' + c, { headers: { host: 'evil.example:' + port } });
  assert.equal(r.status, 403);
  assert.ok(!r.text.includes(TOKEN));
  r = await req(port, 'GET', '/?c=' + c);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes(LIVE(TOKEN)));
});

test('code : 32 caractères hexadécimaux, un seul usage, signalé une fois', async () => {
  const used = [];
  const onUsed = (c) => used.push(c);
  server.on('codeUsed', onUsed);
  try {
    const c = server.newCode();
    assert.match(c, /^[0-9a-f]{32}$/);
    assert.notEqual(server.newCode(), c);
    let r = await req(port, 'GET', '/?c=' + c);
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(LIVE(TOKEN)));
    // Rechargement de la même adresse : la page revient, sans jeton.
    r = await req(port, 'GET', '/?c=' + c);
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(LIVE(null)));
    assert.ok(!r.text.includes(TOKEN));
    assert.deepEqual(used, [c]);
  } finally { server.off('codeUsed', onUsed); }
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
    assert.ok(r.text.includes(LIVE(TOKEN)));
    t += 2;
    r = await req(sp, 'GET', '/?c=' + b);
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(LIVE(null)));
    assert.ok(!r.text.includes(TOKEN));
  } finally { s.closeAllConnections(); s.close(); }
});

// Navigateurs en snap : le navigateur reçoit /start?k=<clé>, jamais le code ; la clé sert une fois et vit 2 minutes.
test('GET /start : clé de lancement à usage unique, 2 minutes, renvoi vers le code', async () => {
  let t = 5_000_000;
  const s = createServer({ lib: fakeLib(), token: TOKEN, port: 0, root, now: () => t });
  if (!s.listening) await once(s, 'listening');
  try {
    const sp = s.address().port;
    const code = s.newCode();
    const k = s.newLaunchKey(code);
    assert.match(k, /^[0-9a-f]{16}$/);
    assert.notEqual(s.newLaunchKey(code), k);
    assert.throws(() => s.newLaunchKey('f'.repeat(32)));
    // Host étranger : refusé, la clé reste valable.
    let r = await req(sp, 'GET', '/start?k=' + k, { headers: { host: 'evil.example:' + sp } });
    assert.equal(r.status, 403);
    assert.ok(!r.text.includes(code));
    // Juste avant 2 minutes : renvoi vers le code, sans cache ni référent, sans cookie.
    t += 2 * 60 * 1000 - 1;
    r = await req(sp, 'GET', '/start?k=' + k);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/?c=' + code);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['set-cookie'], undefined);
    assert.equal(r.text, '');
    // Deuxième usage : rien.
    r = await req(sp, 'GET', '/start?k=' + k);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/');
    // Le renvoi ne consomme pas le code : la page le consomme.
    r = await req(sp, 'GET', '/?c=' + code);
    assert.ok(r.text.includes(LIVE(TOKEN)));
    // Clé expirée, inconnue, absente, mal formée : renvoi vers la page sans jeton, jamais le code.
    const c2 = s.newCode();
    const old = s.newLaunchKey(c2);
    t += 2 * 60 * 1000;
    for (const p of ['/start?k=' + old, '/start?k=' + 'e'.repeat(16), '/start', '/start?k=' + c2, '/start?k=' + old.toUpperCase()]) {
      r = await req(sp, 'GET', p);
      assert.equal(r.status, 302, p);
      assert.equal(r.headers.location, '/', p);
      assert.ok(!r.text.includes(c2) && !(r.headers.location || '').includes(c2), p);
    }
    // Le code lui-même reste valable (10 minutes), pour l'adresse du terminal.
    r = await req(sp, 'GET', '/?c=' + c2);
    assert.ok(r.text.includes(LIVE(TOKEN)));
    // POST /start : inconnu.
    r = await req(sp, 'POST', '/start?k=' + s.newLaunchKey(s.newCode()));
    assert.equal(r.status, 404);
  } finally { s.closeAllConnections(); s.close(); }
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
  assert.ok(r.text.includes(LIVE(TOKEN)));
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
    assert.ok(!r.text.includes(TOKEN));
    fs.mkdirSync(path.join(empty, 'prototype', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(empty, 'prototype', 'dist', 'preview.html'), '<html><head></head><body></body></html>');
    r = await req(s.address().port, 'GET', '/?c=' + c);
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(LIVE(TOKEN)));
  } finally { s.closeAllConnections(); s.close(); }
});

test('page en CRLF ou CR sur le disque : servie en LF, empreintes justes', async () => {
  for (const eol of ['\r\n', '\r']) {
    const dir = throwaway('sa-crlf-');
    fs.mkdirSync(path.join(dir, 'prototype', 'dist'), { recursive: true });
    const lf = '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>T</title>\n</head>\n<body><p>ok</p>\n<script>\nwindow.X=1;\nwindow.Y="a";\n</script>\n</body></html>\n';
    fs.writeFileSync(path.join(dir, 'prototype', 'dist', 'preview.html'), lf.replace(/\n/g, eol));
    const s = createServer({ lib: fakeLib(), token: TOKEN, port: 0, root: dir });
    if (!s.listening) await once(s, 'listening');
    try {
      for (const p of ['/?c=' + s.newCode(), '/']) {
        const r = await req(s.address().port, 'GET', p);
        assert.equal(r.status, 200);
        assertCsp(r);
        // L'empreinte est celle du script tel que le navigateur le lit : en LF.
        assert.ok(cspHashes(r.headers['content-security-policy']).includes(sha('\nwindow.X=1;\nwindow.Y="a";\n')), JSON.stringify(eol));
        assert.equal(r.headers['content-length'], String(Buffer.byteLength(r.text)));
      }
    } finally { s.closeAllConnections(); s.close(); }
  }
});

// La page vraiment servie : prototype/dist/preview.html, fichier construit.
const dist = path.join(repo, 'prototype', 'dist', 'preview.html');

test('GET / sert la vraie interface, avec et sans code', async () => {
  assert.ok(fs.existsSync(dist), 'prototype/dist/preview.html absent : lancez npm run build');
  const s = createServer({ lib: fakeLib(), token: TOKEN, port: 0, root: repo });
  if (!s.listening) await once(s, 'listening');
  try {
    const sp = s.address().port;
    const withCode = await req(sp, 'GET', '/?c=' + s.newCode());
    const bare = await req(sp, 'GET', '/');
    for (const r of [withCode, bare]) {
      assert.equal(r.status, 200);
      assert.equal(r.headers['set-cookie'], undefined);
      // Une interface, pas une page vide.
      assert.ok(r.text.includes('id="app"') && r.text.includes('id="view"'), 'structure de l\'interface absente');
      assert.ok(r.text.includes('SA.start'), 'démarrage de l\'interface absent');
      assertCsp(r);
    }
    assert.ok(/<head>\s*<script>window\.SA_LIVE=\{token:"a{64}"\}<\/script>/.test(withCode.text));
    assert.ok(/<head>\s*<script>window\.SA_LIVE=\{token:null\}<\/script>/.test(bare.text));
    assert.ok(!bare.text.includes(TOKEN));
  } finally { s.closeAllConnections(); s.close(); }
});

test('page construite : le mode réel garde le jeton dans sessionStorage (version 1.0)', () => {
  // Rempli par prototype/src/live.js, puis npm run build.
  assert.ok(fs.readFileSync(dist, 'utf8').includes('sessionStorage'), 'mode réel sans sessionStorage : mettez à jour live.js puis lancez npm run build');
});

test('empreintes justes avec des caractères dont la minuscule change de longueur', async () => {
  const dir = throwaway('sa-casse-');
  fs.mkdirSync(path.join(dir, 'prototype', 'dist'), { recursive: true });
  // « İ » devient deux caractères en minuscule : la fin du script ne doit pas glisser.
  fs.writeFileSync(path.join(dir, 'prototype', 'dist', 'preview.html'),
    '<!doctype html>\n<html>\n<head>\n<title>İİİ</title>\n</head>\n<body><p>İstanbul İzmir</p>\n<SCRIPT type="module">\nwindow.Z="İ";\n</SCRIPT>\n<script src="x.js"></script>\n</body></html>\n');
  const s = createServer({ lib: fakeLib(), token: TOKEN, port: 0, root: dir });
  if (!s.listening) await once(s, 'listening');
  try {
    const r = await req(s.address().port, 'GET', '/?c=' + s.newCode());
    assert.equal(r.status, 200);
    assertCsp(r);
    assert.ok(cspHashes(r.headers['content-security-policy']).includes(sha('\nwindow.Z="İ";\n')));
  } finally { s.closeAllConnections(); s.close(); }
});

test('vraie interface copiée en CRLF (checkout Windows) : même page, empreintes justes', async () => {
  assert.ok(fs.existsSync(dist), 'prototype/dist/preview.html absent : lancez npm run build');
  const lf = fs.readFileSync(dist, 'utf8').replace(/\r\n?/g, '\n');
  const dir = throwaway('sa-crlf-');
  fs.mkdirSync(path.join(dir, 'prototype', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'prototype', 'dist', 'preview.html'), lf.replace(/\n/g, '\r\n'));
  const a = createServer({ lib: fakeLib(), token: TOKEN, port: 0, root: dir });
  const b = createServer({ lib: fakeLib(), token: TOKEN, port: 0, root: repo });
  for (const s of [a, b]) if (!s.listening) await once(s, 'listening');
  try {
    const crlf = await req(a.address().port, 'GET', '/?c=' + a.newCode());
    const ref = await req(b.address().port, 'GET', '/?c=' + b.newCode());
    assert.equal(crlf.status, 200);
    assertCsp(crlf);
    assert.equal(crlf.text, ref.text);
    assert.equal(crlf.headers['content-security-policy'], ref.headers['content-security-policy']);
  } finally { for (const s of [a, b]) { s.closeAllConnections(); s.close(); } }
});

// ---------- Routes ----------

const last = (name) => lib.log.filter((l) => l[0] === name).at(-1);

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
  assert.deepEqual([r.json.held, r.json.conflicts, r.json.skipped, r.json.failed], [[], [], [], []]);
  assert.ok(r.json.state.mine.some((x) => x.name === 'pdf'));
  const call = lib.log.find((l) => l[0] === 'install:start');
  assert.deepEqual(call[1], { items: [{ source: 'anthropics/skills', skill: 'pdf' }], agents: ['claude-code'], scope: 'global' });
});

test('install : replace, force et le dossier partagé sont transmis', async () => {
  const body = { items: [{ source: 'a/b', skill: 'risky' }], agents: ['shared', 'claude-code'], scope: 'global', replace: ['risky'], force: ['risky'] };
  let r = await api('POST', '/api/skills/install', { body });
  assert.equal(r.status, 200);
  assert.deepEqual(last('install:start')[1], body);
  assert.deepEqual(r.json.installed, ['risky']);
  // Sans force : retenu, avec le verdict.
  r = await api('POST', '/api/skills/install', { body: { ...body, force: undefined, replace: undefined } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.installed, []);
  assert.deepEqual(r.json.held, [{ name: 'risky', verdict: 'rouge', findings: [] }]);
  assert.deepEqual(last('install:start')[1], { items: body.items, agents: body.agents, scope: 'global' });
  for (const bad of [{ replace: ['../x'] }, { force: ['a b'] }, { replace: 'risky' }]) {
    r = await api('POST', '/api/skills/install', { body: { ...body, ...bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});

test('install : un élément refusé va dans failed, les autres continuent', async () => {
  lib.log.length = 0;
  const items = [
    { source: 'anthropics/skills', skill: 'docx' },
    { source: 'uizze.sh', skill: 'ios-design' },
    { source: 'a/b', skill: 'nom avec espace' },
    { source: 'a/b', skill: 'ns:nom' },
    { source: 'https://exemple.com/depot', skill: 'xlsx' },
    { skill: 'sans-source' }
  ];
  const r = await api('POST', '/api/skills/install', { body: { items, agents: ['claude-code'], scope: 'global' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.installed, ['docx', 'xlsx']);
  assert.deepEqual(r.json.failed.map((f) => f.name), ['ios-design', 'nom avec espace', 'ns:nom', 'sans-source']);
  for (const f of r.json.failed) {
    assert.equal(typeof f.message, 'string');
    assert.match(f.message, /à la main/);
    assert.ok(f.message.split(/\s+/).length <= 20, f.message);
  }
  assert.ok(r.json.state);
  // Le lib ne reçoit que les éléments valables.
  assert.deepEqual(last('install:start')[1].items, [items[0], items[4]]);
});

test('install : aucun élément valable, 200 sans appeler le lib', async () => {
  lib.log.length = 0;
  const bad = ['file:///etc', 'http://github.com/a/b', 'https://', 'https://exemple.com/a b', '../x', '.git/x', 'a/..', 'https://x.com/' + 'a'.repeat(2000)];
  const r = await api('POST', '/api/skills/install', { body: { items: bad.map((source, i) => ({ source, skill: 'x' + i })).concat([{ source: 'a/b', skill: '../x' }]), agents: [], scope: 'global' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.installed, r.json.held, r.json.conflicts, r.json.skipped], [[], [], [], []]);
  assert.deepEqual(r.json.failed.map((f) => f.name), [...bad.map((s, i) => 'x' + i), '../x']);
  assert.ok(r.json.state);
  assert.equal(lib.log.filter((l) => l[0].startsWith('install')).length, 0);
});

test('install : le détail brut d\'un échec reste dans le terminal', async () => {
  const seen = [];
  const old = console.error;
  console.error = (...a) => seen.push(a.join(' '));
  let r;
  try { r = await api('POST', '/api/skills/install', { body: { items: [{ source: 'a/b', skill: 'casse' }], agents: [], scope: 'global' } }); } finally { console.error = old; }
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.failed, [{ name: 'casse', message: 'Dépôt introuvable.' }]);
  assert.ok(!r.text.includes('/chemin/secret'));
  assert.ok(seen.some((l) => l.includes('repository not found')), seen.join('|'));
});

test('install : corps mal formé, 400 pour toute la requête', async () => {
  lib.log.length = 0;
  const ok = { items: [{ source: 'a/b', skill: 'x' }], agents: [], scope: 'global' };
  const cases = [
    [{ ...ok, agents: ['Bad Id'] }, 'BAD_NAME'],
    [{ ...ok, scope: 'partout' }, 'BAD_INPUT'],
    [{ agents: [] }, 'BAD_INPUT'],
    [{ ...ok, items: [] }, 'BAD_INPUT'],
    [{ ...ok, items: 'a/b' }, 'BAD_INPUT'],
    [{ ...ok, items: ['a/b'] }, 'BAD_INPUT'],
    [{ ...ok, items: [{ source: 'a/b' }] }, 'BAD_INPUT'],
    [{ ...ok, items: [{ source: 'a/b', skill: 3 }] }, 'BAD_INPUT'],
    [{ ...ok, agents: undefined }, 'BAD_INPUT']
  ];
  for (const [body, code] of cases) {
    const r = await api('POST', '/api/skills/install', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error, code, JSON.stringify(body));
  }
  const r = await api('POST', '/api/skills/install', { body: { ...ok, agents: ['Bad Id'] } });
  assert.match(r.json.message, /agent/);
  assert.equal(lib.log.filter((l) => l[0].startsWith('install')).length, 0);
});

test('projet : POST /api/project, et portée projet refusée sans projet', async () => {
  lib.log.length = 0;
  const body = { items: [{ source: 'a/b', skill: 'x' }], agents: [], scope: 'project' };
  let r = await api('POST', '/api/skills/install', { body });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'BAD_INPUT');
  assert.match(r.json.message, /projet/);
  assert.equal(lib.log.filter((l) => l[0].startsWith('install')).length, 0);
  r = await api('POST', '/api/project', { body: { dir: '/tmp/mon projet' } });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ['state']);
  assert.equal(r.json.state.project, '/tmp/mon projet');
  assert.deepEqual(last('setProject')[1], { dir: '/tmp/mon projet' });
  r = await api('POST', '/api/skills/install', { body });
  assert.equal(r.status, 200);
  assert.equal(last('install:start')[1].scope, 'project');
  // Refus du lib, corps invalides, puis retrait du projet.
  r = await api('POST', '/api/project', { body: { dir: '/refuse' } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { error: 'BAD_INPUT', message: 'Dossier refusé.' });
  for (const b of [{}, { dir: 3 }, { dir: '' }, { dir: 'a\u0000b' }, { dir: '/' + 'x'.repeat(1024) }, { dir: ['/tmp'] }]) {
    r = await api('POST', '/api/project', { body: b });
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(r.json.error, 'BAD_INPUT');
  }
  assert.equal(lib.st.project, '/tmp/mon projet');
  r = await api('POST', '/api/project', { body: { dir: null } });
  assert.equal(r.status, 200);
  assert.equal(r.json.state.project, null);
  assert.deepEqual(last('setProject')[1], { dir: null });
});

test('GET /api/skills/preview et /api/search-data', async () => {
  let r = await api('GET', '/api/skills/preview?name=pdf');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { name: 'pdf', files: [{ path: 'SKILL.md', status: 'changed', added: 2, removed: 1 }], scan: { verdict: 'vert', findings: [] }, scanOld: { verdict: 'vert' }, same: false });
  assert.deepEqual(last('preview')[1], { name: 'pdf' });
  lib.log.length = 0;
  for (const q of ['', '?name=', '?name=../x', '?name=a%20b', '?x=1']) {
    r = await api('GET', '/api/skills/preview' + q);
    assert.equal(r.status, 400, q);
    assert.equal(r.json.error, 'BAD_NAME', q);
  }
  assert.equal(lib.log.filter((l) => l[0] === 'preview').length, 0);
  r = await api('GET', '/api/skills/preview?name=absent');
  assert.equal(r.status, 404);
  r = await req(port, 'GET', '/api/skills/preview?name=pdf');
  assert.equal(r.status, 403);
  r = await api('GET', '/api/search-data');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { source: 'bundled', generatedAt: '2026-11-12T17:23:56.759Z', search: null });
  r = await req(port, 'GET', '/api/search-data');
  assert.equal(r.status, 403);
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
  } finally { s.closeAllConnections(); s.close(); }
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
  // Agent qui lit le dossier partagé : 409 SHARED, avec les lecteurs au bon format seulement.
  r = await api('POST', '/api/agents/empty', { body: { id: 'zed', backup: true } });
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, { error: 'SHARED', message: 'Zed lit le dossier partagé. Retirez ces skills pour tous ses lecteurs.', readers: ['zed', 'cursor'] });
  // Nom ou dossier vide, trop long ou avec un caractère de contrôle.
  for (const body of [{ name: '', dir: '/a' }, { name: 'a\nb', dir: '/a' }, { name: 'a', dir: '/a\u0000' }, { name: 'x'.repeat(65), dir: '/a' }, { name: 'a' }]) {
    r = await api('POST', '/api/agents/custom', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error, 'BAD_INPUT');
  }
});

// ---------- Erreurs ----------

test('codes d\'erreur du lib vers HTTP, sans trace', async () => {
  const cases = [['BAD_NAME', 400], ['BAD_SOURCE', 400], ['NOT_FOUND', 404], ['EXISTS', 409], ['GITHUB_LIMIT', 502], ['CLI_FAILED', 500], ['OUTSIDE_HOME', 500],
    ['NETWORK', 502], ['SOURCE_NOT_FOUND', 404], ['SHARED', 409]];
  for (const [code, status] of cases) {
    const r = await api('POST', '/api/skills/disable', { body: { names: ['boom-' + code] } });
    assert.equal(r.status, status, code);
    assert.deepEqual(r.json, { error: code, message: 'Erreur ' + code + '.' });
  }
  // Erreur imprévue : le détail part dans le terminal (capturé ici), pas dans la réponse.
  const seen = [];
  const old = console.error;
  console.error = (...a) => seen.push(a.join(' '));
  let r;
  try { r = await api('POST', '/api/skills/disable', { body: { names: ['boom-PLAIN'] } }); } finally { console.error = old; }
  assert.ok(seen.some((l) => l.includes('détail interne')), seen.join('|'));
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

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const installBody = (s) => ({ items: [{ source: 'a/b', skill: s }], agents: [], scope: 'global' });

test('deux POST simultanés passent l\'un après l\'autre', async () => {
  lib.log.length = 0;
  lib.delay = 80;
  try {
    const [a, b] = await Promise.all([
      api('POST', '/api/skills/install', { body: installBody('un') }),
      api('POST', '/api/skills/install', { body: installBody('deux') })
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
  // Une écriture en échec libère aussi les lectures.
  lib.delay = 40;
  try {
    const [w, s] = await Promise.all([api('POST', '/api/skills/install', { body: installBody('boom-CLI_FAILED') }), pause(10).then(() => api('GET', '/api/state'))]);
    assert.equal(w.status, 500);
    assert.equal(s.status, 200);
    assert.equal(s.json.half, false);
  } finally { lib.delay = 0; }
});

test('lecture de l\'état pendant une écriture : jamais un état à moitié écrit', async () => {
  lib.log.length = 0;
  lib.delay = 120;
  try {
    const w = api('POST', '/api/skills/install', { body: installBody('lent') });
    await pause(30);
    assert.equal(lib.st.half, true, 'l\'écriture devrait être en cours');
    const reads = await Promise.all([api('GET', '/api/state'), api('GET', '/api/state')]);
    for (const r of reads) {
      assert.equal(r.status, 200);
      assert.equal(r.json.half, false);
      assert.ok(r.json.mine.some((x) => x.name === 'lent'), 'la lecture doit voir l\'état d\'après l\'écriture');
    }
    assert.equal((await w).status, 200);
  } finally { lib.delay = 0; }
});

// Une écriture en attente ne reste pas bloquée derrière un flot continu de lectures : les lectures venues après elle l'attendent.
test('écriture en attente : un flot de lectures ne la retient pas', async () => {
  lib.log.length = 0;
  lib.stateDelay = 60;
  // Écriture qui dure : une lecture commencée pendant elle se verrait dans le journal.
  lib.delay = 40;
  try {
    const reads = [];
    const t0 = Date.now();
    // Lectures qui se chevauchent pendant 1,2 seconde : sans priorité, il y a toujours une lecture en cours.
    const flow = (async () => { while (Date.now() - t0 < 1200) { reads.push(api('GET', '/api/state')); await pause(20); } })();
    await pause(80);
    const t1 = Date.now();
    const w = await api('POST', '/api/skills/install', { body: installBody('juste') });
    const waited = Date.now() - t1;
    await flow;
    for (const r of await Promise.all(reads)) { assert.equal(r.status, 200); assert.equal(r.json.half, false); }
    assert.equal(w.status, 200);
    assert.ok(waited < 600, 'écriture retenue ' + waited + ' ms par les lectures');
    // Pendant l'écriture, aucune lecture ne commence.
    const seq = lib.log.map((l) => l[0]);
    const s = seq.indexOf('install:start'), e = seq.indexOf('install:end');
    assert.ok(s > 0 && e > s, seq.join(' '));
    assert.ok(!seq.slice(s, e).includes('state'), seq.join(' '));
    // Des lectures ont eu lieu avant et après.
    assert.ok(seq.slice(0, s).includes('state') && seq.slice(e).includes('state'));
  } finally { lib.stateDelay = 0; lib.delay = 0; }
});

// check.json n'est écrit que dans la file des écritures, et jamais quand une écriture a eu lieu pendant la vérification.
test('check : check.json écrit dans la file, sauf si une écriture a eu lieu pendant la vérification', async () => {
  const waitLog = async (name) => { for (let i = 0; i < 100 && !lib.log.some((l) => l[0] === name); i++) await pause(10); };
  lib.outdated = ['pdf'];
  try {
    // 1. Seule : la vérification ne demande pas d'écrire ; le serveur écrit ensuite, dans la file.
    lib.log.length = 0;
    let r = await api('GET', '/api/skills/check');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { outdated: [{ name: 'pdf', scanNew: null }] });
    await waitLog('saveCheck');
    assert.deepEqual(lib.log.find((l) => l[0] === 'check')[1], { save: false });
    assert.deepEqual(lib.log.find((l) => l[0] === 'saveCheck')[1], { outdated: ['pdf'] });
    // 2. Une écriture commence et finit pendant la vérification : rien d'écrit.
    lib.log.length = 0;
    lib.checkDelay = 200;
    const c = api('GET', '/api/skills/check');
    await pause(20);
    assert.equal((await api('POST', '/api/skills/install', { body: installBody('pendant') })).status, 200);
    assert.equal((await c).status, 200);
    await pause(60);
    assert.ok(!lib.log.some((l) => l[0] === 'saveCheck'), JSON.stringify(lib.log.map((l) => l[0])));
    // 3. Une écriture en cours au début de la vérification, finie après : rien d'écrit non plus.
    lib.log.length = 0;
    lib.checkDelay = 0;
    lib.delay = 150;
    const w = api('POST', '/api/skills/install', { body: installBody('avant') });
    await pause(20);
    r = await api('GET', '/api/skills/check');
    assert.equal(r.status, 200);
    assert.equal((await w).status, 200);
    await pause(60);
    assert.ok(!lib.log.some((l) => l[0] === 'saveCheck'), JSON.stringify(lib.log.map((l) => l[0])));
    // 4. Vérification seule, puis lecture de l'état : check.json écrit, la lecture répond.
    lib.log.length = 0;
    lib.delay = 0;
    lib.checkDelay = 0;
    r = await api('GET', '/api/skills/check');
    await waitLog('saveCheck');
    const state = await api('GET', '/api/state');
    assert.equal(state.status, 200);
    assert.ok(lib.log.some((l) => l[0] === 'saveCheck'));
  } finally { lib.outdated = []; lib.checkDelay = 0; lib.delay = 0; }
});

test('lecture de l\'état : attend l\'écriture en cours, pas toute la file', async () => {
  lib.log.length = 0;
  lib.delay = 80;
  lib.stateDelay = 30;
  try {
    const writes = ['f1', 'f2', 'f3'].map((s) => api('POST', '/api/skills/install', { body: installBody(s) }));
    await pause(20);
    const read = await api('GET', '/api/state');
    assert.equal(read.status, 200);
    assert.equal(read.json.half, false);
    const names = read.json.mine.map((x) => x.name);
    // Vu après la première écriture, avant la deuxième : celle-ci attend la fin de la lecture.
    assert.ok(names.includes('f1') && !names.includes('f2') && !names.includes('f3'), names.join(','));
    for (const w of await Promise.all(writes)) assert.equal(w.status, 200);
    const seq = lib.log.map((l) => l[0] + (l[0].startsWith('install') ? ':' + l[1].items[0].skill : ''));
    // La lecture venue du client suit l'état rendu avec la première écriture.
    const i = seq.indexOf('state', seq.indexOf('install:end:f1') + 2);
    assert.ok(i > 0 && i < seq.indexOf('install:start:f2'), seq.join(' '));
    assert.ok(seq.indexOf('state:end', i) < seq.indexOf('install:start:f2'), seq.join(' '));
  } finally { lib.delay = 0; lib.stateDelay = 0; }
});

test('check, preview et search-data n\'attendent pas la file et ne la bloquent pas', async () => {
  lib.log.length = 0;
  // Une vérification lente ne retient pas une installation.
  lib.checkDelay = 400;
  try {
    const t0 = Date.now();
    const check = api('GET', '/api/skills/check');
    await pause(20);
    const w = await api('POST', '/api/skills/install', { body: installBody('vite') });
    assert.equal(w.status, 200);
    assert.ok(Date.now() - t0 < 300, 'installation retenue par la vérification');
    assert.ok(!lib.log.some((l) => l[0] === 'check:end'), 'la vérification devrait encore tourner');
    assert.equal((await check).status, 200);
  } finally { lib.checkDelay = 0; }
  // Une écriture lente ne retient ni check, ni preview, ni search-data.
  lib.delay = 400;
  try {
    const w = api('POST', '/api/skills/install', { body: installBody('long') });
    await pause(20);
    const t0 = Date.now();
    const quick = await Promise.all([api('GET', '/api/skills/check'), api('GET', '/api/skills/preview?name=pdf'), api('GET', '/api/search-data'), api('GET', '/api/catalog')]);
    for (const r of quick) assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 < 300, 'lecture retenue par une écriture');
    assert.ok(!lib.log.some((l) => l[0] === 'install:end' && l[1].items[0].skill === 'long'));
    assert.equal((await w).status, 200);
  } finally { lib.delay = 0; }
});

// ---------- Client parti ----------

// Envoie des en-têtes et un début de corps, puis coupe la connexion.
function abortUpload(pathname, type, announced) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('error', () => {});
    s.on('close', resolve);
    s.write('POST ' + pathname + ' HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nX-SA-Token: ' + TOKEN +
      '\r\nContent-Type: ' + type + '\r\nContent-Length: ' + announced + '\r\n\r\n{"id":"c', () => setTimeout(() => s.destroy(), 30));
  });
}

test('onglet fermé ou envoi annulé : aucune trace dans le terminal, le serveur continue', async () => {
  lib.log.length = 0;
  const seen = [];
  const old = console.error;
  console.error = (...a) => seen.push(a.join(' '));
  try {
    await abortUpload('/api/agents/hide', 'application/json', 500);
    await abortUpload('/api/backups/import', 'application/gzip', 5000);
    await pause(150);
  } finally { console.error = old; }
  assert.deepEqual(seen, []);
  assert.equal(lib.log.filter((l) => l[0] === 'hideAgent' || l[0] === 'importBackup').length, 0);
  const r = await api('GET', '/api/state');
  assert.equal(r.status, 200);
  // Une vraie erreur interne reste écrite dans le terminal.
  console.error = (...a) => seen.push(a.join(' '));
  try { await api('POST', '/api/skills/disable', { body: { names: ['boom-PLAIN'] } }); } finally { console.error = old; }
  assert.equal(seen.length, 1);
  assert.match(seen[0], /détail interne/);
});

test('téléchargement d\'une sauvegarde annulé : aucune trace', async () => {
  const seen = [];
  const old = console.error;
  console.error = (...a) => seen.push(a.join(' '));
  // Flux sans fin : le client part au milieu.
  const endless = fakeLib();
  endless.exportBackup = async () => new Readable({ read() { setTimeout(() => this.push(Buffer.alloc(65536, 1)), 2); } });
  const s = createServer({ lib: endless, token: TOKEN, port: 0, root });
  if (!s.listening) await once(s, 'listening');
  try {
    await new Promise((resolve) => {
      const c = net.connect(s.address().port, '127.0.0.1');
      c.on('error', () => {});
      c.on('close', resolve);
      c.once('data', () => c.destroy());
      c.write('GET /api/backups/export?id=flux HTTP/1.1\r\nHost: 127.0.0.1:' + s.address().port + '\r\nX-SA-Token: ' + TOKEN + '\r\n\r\n');
    });
    await pause(150);
    // La file n'est pas restée bloquée.
    const r = await req(s.address().port, 'POST', '/api/agents/hide', { headers: { 'x-sa-token': TOKEN }, body: { id: 'cursor' } });
    assert.equal(r.status, 200);
  } finally { console.error = old; s.closeAllConnections(); s.close(); }
  assert.deepEqual(seen, []);
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
