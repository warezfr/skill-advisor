// Tests des données de recherche (getSearchData) : adresse, conversion, cache, échecs. Aucun réseau réel.
// Le fetch est simulé ; un seul essai passe par un petit serveur sur 127.0.0.1.
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { getSearchData, catalogInfo, catalogBase, toSearch, SEARCH_TTL } from '../lib/catalog.mjs';
import { makeHome, assertInHome, rmHome } from './helpers.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUNDLED_AT = '2026-11-12T17:23:56.759Z';
const BASE = 'https://catalogue.example.org';
const homes = [];
async function home() { const h = await makeHome(); homes.push(h); return h; }
after(async () => { for (const h of homes) await rmHome(h); });

// Jamais l'adresse de la machine : chaque test fixe la sienne.
let savedEnv;
beforeEach(() => { savedEnv = process.env.CATALOG_URL; delete process.env.CATALOG_URL; });
afterEach(() => { if (savedEnv === undefined) delete process.env.CATALOG_URL; else process.env.CATALOG_URL = savedEnv; });

const skillOf = (id, name, source, installs, total, warnings = [], extra = {}) => ({
  id, name, source, installs, official: false, description: 'Description de ' + name, stars: 12, pushedAt: '2026-10-01', license: 'MIT',
  score: { total, popularite: 1, source: 2, fraicheur: 3, securite: 4 }, warnings, audits: {}, scan: null, fileCount: 2, scripts: 0, ...extra,
});
function fixture() {
  const cat = {
    generatedAt: '2026-11-14T10:00:00.000Z', totalSkillsListed: 92899,
    categories: [{ id: 'frontend', label: 'Frameworks front', byScore: ['a/b/one'], byInstalls: ['a/b/two'] }, { id: 'tests', label: 'Tests', byScore: [], byInstalls: [] }],
    skills: {
      'a/b/one': skillOf('a/b/one', 'one', 'a/b', 10, 81, [{ level: 'moyen', text: 'Attention.', code: 'W1' }], {
        official: true, audits: { Snyk: { status: 'pass', riskLevel: 'LOW', auditedAt: '2026-10-19T00:00:00Z', summary: 'Rien', slug: 's1', categories: ['x'] } },
        scan: { verdict: 'orange', findings: [{ label: 'Motif', file: 'SKILL.md', line: 3, excerpt: 'curl x', sev: 'medium' }] },
      }),
      'a/b/two': skillOf('a/b/two', 'two', 'a/b', 3, 40, [{ level: 'eleve', text: 'Danger.', code: 'W2' }]),
    },
  };
  const idx = { skills: [{ id: 'a/b/one', n: 'one', s: 'a/b', i: 10, c: ['frontend'], o: 1, t: 80, w: 0 }, { id: 'x/y/three', n: 'three', s: 'x/y', i: 5, c: [], o: 0 }], trending: ['x/y/three'] };
  return { cat, idx };
}

// fetch simulé : rend de vraies réponses (Response) et compte les appels.
function fakeFetch(routes) {
  const f = async (url, init) => {
    f.calls.push(url);
    const r = routes(url, init);
    return r instanceof Promise ? r : r;
  };
  f.calls = [];
  return f;
}
const json = (v, init) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
function catalogue(cat, idx) {
  return fakeFetch((url) => {
    if (url === BASE + '/api/catalog') return json(cat);
    if (url === BASE + '/api/catalog?file=index') return json(idx);
    return new Response('absent', { status: 404 });
  });
}
const bundled = { source: 'bundled', generatedAt: BUNDLED_AT, search: null };
const cachePath = (h) => path.join(h, '.skill-advisor', 'cache', 'search-data.json');

test('sans adresse : copie fournie, aucun appel réseau', async () => {
  const h = await home();
  const f = fakeFetch(() => json({}));
  assert.deepEqual(await getSearchData({ home: h, fetchImpl: f }), bundled);
  assert.deepEqual(await getSearchData({ home: h, fetchImpl: f, url: null }), bundled);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await catalogInfo({ home: h }), { source: 'bundled', generatedAt: BUNDLED_AT });
});

test('date de la copie fournie : celle de prototype/src/search-data.js', async () => {
  const text = await fs.readFile(path.join(repo, 'prototype', 'src', 'search-data.js'), 'utf8');
  assert.equal(/"generatedAt":"([^"]+)"/.exec(text)[1], BUNDLED_AT);
});

test('conversion : lignes, catégories, tendance, détails comme make-search-data.mjs', async () => {
  const h = await home();
  const { cat, idx } = fixture();
  const f = catalogue(cat, idx);
  const r = await getSearchData({ home: h, url: BASE, fetchImpl: f });
  assert.equal(r.source, 'online');
  assert.equal(r.generatedAt, '2026-11-14T10:00:00.000Z');
  assert.deepEqual(f.calls.sort(), [BASE + '/api/catalog', BASE + '/api/catalog?file=index']);
  const s = r.search;
  assert.deepEqual(Object.keys(s), ['generatedAt', 'total', 'cats', 'items', 'details']);
  assert.equal(s.total, 92899);
  assert.deepEqual(s.cats, [{ id: 'frontend', label: 'Frameworks front' }, { id: 'tests', label: 'Tests' }]);
  assert.deepEqual(s.items, [
    ['a/b/one', 'one', 'a/b', 10, [0], 1, 81, 1, 0],
    ['x/y/three', 'three', 'x/y', 5, [], 0, null, null, 1],
    ['a/b/two', 'two', 'a/b', 3, [0], 0, 40, 2, 0],
  ]);
  assert.deepEqual(s.details['a/b/one'], {
    d: 'Description de one', st: 12, p: '2026-10-01', l: 'MIT', sc: [1, 2, 3, 4],
    a: [['Snyk', 'pass', 'LOW', '2026-10-19', 'Rien', 's1', ['x']]],
    w: [['moyen', 'Attention.', 'W1']],
    fd: [['Motif', 'SKILL.md', 3, 'curl x', 'medium']], v: 'orange', f: 2, sx: 0,
  });
  assert.deepEqual(Object.keys(s.details).sort(), ['a/b/one', 'a/b/two']);
  // Même forme que la copie fournie : mêmes clés, lignes de neuf champs, mêmes clés de détail.
  const ctx = { window: {} };
  vm.runInNewContext(await fs.readFile(path.join(repo, 'prototype', 'src', 'search-data.js'), 'utf8'), ctx);
  const ref = ctx.window.SA.search;
  assert.deepEqual(Object.keys(s), Object.keys(ref));
  assert.equal(ref.items[0].length, s.items[0].length);
  assert.deepEqual(Object.keys(s.details['a/b/one']), Object.keys(Object.values(ref.details)[0]));
  assert.deepEqual(toSearch(cat, idx), s);
});

test('cache : 6 heures, sous ~/.skill-advisor/cache, pour la même adresse', async () => {
  const h = await home();
  const { cat, idx } = fixture();
  const f = catalogue(cat, idx);
  const t0 = Date.parse('2026-11-14T12:00:00Z');
  const first = await getSearchData({ home: h, url: BASE, fetchImpl: f, now: t0 });
  assert.equal(f.calls.length, 2);
  assertInHome(h, cachePath(h));
  const saved = JSON.parse(await fs.readFile(cachePath(h), 'utf8'));
  assert.equal(saved.url, BASE);
  assert.equal(saved.at, t0);
  if (process.platform !== 'win32') assert.equal((await fs.stat(cachePath(h))).mode & 0o077, 0, 'cache lisible par l’utilisateur seulement');
  // Dans les 6 heures : aucun appel. Les barres finales ne changent pas l'adresse.
  assert.deepEqual(await getSearchData({ home: h, url: BASE + '/', fetchImpl: f, now: t0 + SEARCH_TTL - 1 }), first);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(await catalogInfo({ home: h, url: BASE, now: t0 + 1000 }), { source: 'online', generatedAt: '2026-11-14T10:00:00.000Z' });
  // Après 6 heures, ou une autre adresse : nouveau téléchargement.
  await getSearchData({ home: h, url: BASE, fetchImpl: f, now: t0 + SEARCH_TTL });
  assert.equal(f.calls.length, 4);
  assert.deepEqual(await catalogInfo({ home: h, url: 'https://autre.example.org', now: t0 + SEARCH_TTL }), { source: 'bundled', generatedAt: BUNDLED_AT });
  const other = fakeFetch(() => new Response('non', { status: 503 }));
  assert.deepEqual(await getSearchData({ home: h, url: 'https://autre.example.org', fetchImpl: other, now: t0 + SEARCH_TTL }), bundled);
  assert.equal(other.calls.length, 2);
  // Cache abîmé ou daté du futur : ignoré, nouveau téléchargement.
  await fs.writeFile(cachePath(h), '{pas du json');
  await getSearchData({ home: h, url: BASE, fetchImpl: f, now: t0 + SEARCH_TTL + 5 });
  assert.equal(f.calls.length, 6);
  await getSearchData({ home: h, url: BASE, fetchImpl: f, now: t0 });
  assert.equal(f.calls.length, 8);
  assert.deepEqual((await fs.readdir(path.dirname(cachePath(h)))).sort(), ['search-data.json'], 'aucun fichier temporaire laissé');
});

test('échecs : réseau, statut, forme inattendue, plus de 20 Mo → copie fournie, rien en cache', async () => {
  const h = await home();
  const { cat, idx } = fixture();
  const cases = {
    réseau: () => Promise.reject(new TypeError('fetch failed')),
    statut: () => new Response('erreur', { status: 500 }),
    'pas du json': () => new Response('<html>', { status: 200 }),
    'tableau': () => json([1, 2]),
    'sans catégories': (u) => json(u.endsWith('index') ? idx : { ...cat, categories: undefined }),
    'avertissements cassés': (u) => json(u.endsWith('index') ? idx : { ...cat, skills: { x: { id: 'x', name: 'x', score: { total: 1 }, warnings: 3 } } }),
    'index vide': (u) => json(u.endsWith('index') ? { skills: [] } : { ...cat, skills: {} }),
    'sans date': (u) => json(u.endsWith('index') ? idx : { ...cat, generatedAt: 5 }),
    'en-tête trop gros': () => new Response('{}', { status: 200, headers: { 'content-length': String(21 * 1024 * 1024) } }),
    'corps trop gros': () => new Response(new ReadableStream({
      start(c) { const chunk = new Uint8Array(1024 * 1024).fill(32); for (let i = 0; i < 21; i++) c.enqueue(chunk); c.close(); },
    }), { status: 200 }),
  };
  for (const [what, route] of Object.entries(cases)) {
    const f = fakeFetch(route);
    assert.deepEqual(await getSearchData({ home: h, url: BASE, fetchImpl: f }), bundled, what);
    assert.ok(f.calls.length >= 1, what);
  }
  assert.equal(await fs.stat(cachePath(h)).catch(() => null), null);
});

test('délai dépassé : copie fournie, sans attendre', async () => {
  const h = await home();
  const f = fakeFetch((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  }));
  const t = Date.now();
  assert.deepEqual(await getSearchData({ home: h, url: BASE, fetchImpl: f, timeoutMs: 50 }), bundled);
  assert.ok(Date.now() - t < 3000);
});

test('adresses : https seulement, http pour 127.0.0.1 ; CATALOG_URL avant les réglages', async () => {
  assert.equal(catalogBase('https://catalogue.example.org/'), 'https://catalogue.example.org');
  assert.equal(catalogBase('https://catalogue.example.org/sous/dossier//'), 'https://catalogue.example.org/sous/dossier');
  assert.equal(catalogBase('http://127.0.0.1:8123'), 'http://127.0.0.1:8123');
  for (const bad of ['http://catalogue.example.org', 'http://localhost:80', 'ftp://x.org', 'file:///etc/passwd', 'javascript:alert(1)', 'https://u:p@x.org', 'https://x.org/?q=1', '', 'x', null, 3, 'https://' + 'a'.repeat(2001)]) {
    assert.equal(catalogBase(bad), null, String(bad).slice(0, 40));
  }
  const h = await home();
  const { cat, idx } = fixture();
  const f = catalogue(cat, idx);
  // http vers un autre hôte : refusé sans appel.
  assert.deepEqual(await getSearchData({ home: h, url: 'http://catalogue.example.org', fetchImpl: f }), bundled);
  assert.equal(f.calls.length, 0);
  // Réglages : catalogUrl.
  const settings = path.join(h, '.skill-advisor', 'settings.json');
  assertInHome(h, settings);
  await fs.mkdir(path.dirname(settings), { recursive: true });
  await fs.writeFile(settings, JSON.stringify({ version: 1, catalogUrl: BASE }));
  assert.equal((await getSearchData({ home: h, fetchImpl: f })).source, 'online');
  assert.equal(f.calls.length, 2);
  // La variable passe avant les réglages.
  process.env.CATALOG_URL = 'https://env.example.org';
  const g = fakeFetch(() => new Response('non', { status: 500 }));
  assert.deepEqual(await getSearchData({ home: h, fetchImpl: g }), bundled);
  assert.ok(g.calls.every((u) => u.startsWith('https://env.example.org/')));
  assert.equal(g.calls.length, 2);
});

test('redirection vers une adresse http : refusée', async () => {
  const h = await home();
  const { cat } = fixture();
  const f = fakeFetch(() => { const r = json(cat); Object.defineProperty(r, 'url', { value: 'http://evil.example.org/api/catalog' }); return r; });
  assert.deepEqual(await getSearchData({ home: h, url: BASE, fetchImpl: f }), bundled);
});

test('vrai serveur sur 127.0.0.1 : réponse lue en flux, corps sans taille annoncée borné à 20 Mo', async () => {
  const h = await home();
  const { cat, idx } = fixture();
  let big = false;
  const srv = http.createServer((req, res) => {
    if (big) {
      // Envoi par morceaux, sans content-length.
      res.writeHead(200, { 'content-type': 'application/json' });
      const chunk = Buffer.alloc(1024 * 1024, 32);
      let n = 0;
      const push = () => { while (n < 25) { n++; if (!res.write(chunk)) { res.once('drain', push); return; } } res.end(); };
      res.on('error', () => {});
      push();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.includes('file=index') ? idx : cat));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + srv.address().port;
  try {
    const r = await getSearchData({ home: h, url });
    assert.equal(r.source, 'online');
    assert.equal(r.search.items.length, 3);
    big = true;
    const h2 = await home();
    assert.deepEqual(await getSearchData({ home: h2, url }), bundled);
  } finally {
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
});

test('données réelles : catalog/catalog.json se convertit, la copie fournie passe le contrôle de forme', async () => {
  // Entrée : le catalogue fourni avec l'application, sans index.
  const cat = JSON.parse(await fs.readFile(path.join(repo, 'catalog', 'catalog.json'), 'utf8'));
  const s = toSearch(cat, { skills: [], trending: [] });
  assert.equal(s.items.length, Object.keys(cat.skills).length);
  const ctx = { window: {} };
  vm.runInNewContext(await fs.readFile(path.join(repo, 'prototype', 'src', 'search-data.js'), 'utf8'), ctx);
  const ref = ctx.window.SA.search;
  for (const id of Object.keys(s.details)) assert.deepEqual(Object.keys(s.details[id]), Object.keys(ref.details[id] || s.details[id]), id);
  // Sortie : les 1 551 lignes de la copie fournie, mises en cache, sont acceptées telles quelles.
  const h = await home();
  const t = Date.parse('2026-11-14T12:00:00Z');
  await fs.mkdir(path.dirname(cachePath(h)), { recursive: true });
  await fs.writeFile(cachePath(h), JSON.stringify({ url: BASE, at: t, search: JSON.parse(JSON.stringify(ref)) }));
  const f = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
  const r = await getSearchData({ home: h, url: BASE, fetchImpl: f, now: t + 60000 });
  assert.equal(r.source, 'online');
  assert.equal(r.search.items.length, ref.items.length);
  assert.ok(ref.items.length > 1500);
  assert.equal(f.calls.length, 0);
});

// État de la machine : State.catalog = catalogInfo({ home }), lu sans réseau (cache ou copie fournie).
test('getState : catalogue du cache en ligne, sans téléchargement', async () => {
  const { getState } = await import('../lib/inventory.mjs');
  const { assertSafeHome } = await import('./helpers.mjs');
  const h = await home();
  await assertSafeHome(h);
  // Sans adresse : copie fournie.
  assert.deepEqual((await getState({ home: h })).catalog, { source: 'bundled', generatedAt: BUNDLED_AT });
  // Adresse dans les réglages et cache frais : « en ligne », même date que catalogInfo.
  const settings = path.join(h, '.skill-advisor', 'settings.json');
  assertInHome(h, settings);
  await fs.mkdir(path.dirname(settings), { recursive: true });
  await fs.writeFile(settings, JSON.stringify({ version: 1, catalogUrl: BASE }));
  const { cat, idx } = fixture();
  await getSearchData({ home: h, fetchImpl: catalogue(cat, idx) });
  const saved = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('aucun réseau dans getState'); };
  try {
    const st = await getState({ home: h });
    assert.deepEqual(st.catalog, { source: 'online', generatedAt: '2026-11-14T10:00:00.000Z' });
    assert.deepEqual(st.catalog, await catalogInfo({ home: h }));
  } finally { globalThis.fetch = saved; }
  assert.equal(calls, 0);
});
