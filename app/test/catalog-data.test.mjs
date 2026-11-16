// Catalogues MCP et plugins de la branche catalog-data : téléchargement, cache de 24 h, forme vérifiée, repli ;
// contrôle des catalogues avant publication (tools/check-catalogs.mjs). Aucun réseau : fetch simulé.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeHome, rmHome } from './helpers.mjs';
import { freshCatalog, DATA_TTL, DATA_URL } from '../lib/catalog-data.mjs';
import { check } from '../../tools/check-catalogs.mjs';

const MCP = { kind: 'mcp', generatedAt: '2026-11-17T04:30:00Z', servers: Array.from({ length: 120 }, (_, i) => ({ id: 'io.github.a/s' + i, stars: 10, install: { type: 'npm' }, score: { total: 50 } })) };
const PLUG = { kind: 'plugin', plugins: Array.from({ length: 60 }, (_, i) => ({ id: 'p' + i + '@m' })) };
const res = (body, status = 200) => ({ ok: status === 200, status, headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const ON = { SA_CATALOG_DATA: '' };

test('branche catalog-data : téléchargé, gardé 24 h (0600), puis relu ; adresse par défaut', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const urls = [];
  const fetchImpl = async (u) => { urls.push(u); return res(String(u).endsWith('mcp.json') ? MCP : PLUG); };
  const a = await freshCatalog('mcp', { home, env: ON, fetchImpl, now: 1000 });
  assert.equal(a.source, 'online');
  assert.equal(a.value.servers.length, 120);
  assert.deepEqual(urls, [DATA_URL + 'mcp.json']);
  const file = path.join(home, '.skill-advisor', 'cache', 'mcp.json');
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const b = await freshCatalog('mcp', { home, env: ON, fetchImpl, now: 1000 + DATA_TTL - 1 });
  assert.equal(b.source, 'cache');
  assert.equal(urls.length, 1, 'pas de second téléchargement avant 24 h');
  await freshCatalog('mcp', { home, env: ON, fetchImpl, now: 1000 + DATA_TTL + 1 });
  assert.equal(urls.length, 2, 'téléchargé de nouveau après 24 h');
  assert.equal((await freshCatalog('plugins', { home, env: ON, fetchImpl })).value.plugins.length, 60);
  assert.equal(await freshCatalog('autre', { home, env: ON, fetchImpl }), null);
});

test('branche catalog-data : échec réseau, réponse refusée, coupure : cache même ancien, sinon null', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const down = async () => { throw new Error('ENOTFOUND'); };
  assert.equal(await freshCatalog('mcp', { home, env: ON, fetchImpl: down }), null, 'rien en cache : copie fournie (null)');
  assert.equal(await freshCatalog('mcp', { home, env: ON, fetchImpl: async () => res({ kind: 'mcp', servers: [] }) }), null, 'catalogue trop petit refusé');
  assert.equal(await freshCatalog('mcp', { home, env: ON, fetchImpl: async () => res('pas du json') }), null);
  assert.equal(await freshCatalog('mcp', { home, env: ON, fetchImpl: async () => res('', 404) }), null);
  let called = false;
  assert.equal(await freshCatalog('mcp', { home, env: { SA_CATALOG_DATA: 'off' }, fetchImpl: async () => { called = true; return res(MCP); } }), null);
  assert.equal(called, false, 'SA_CATALOG_DATA=off : aucun appel réseau');
  await freshCatalog('mcp', { home, env: ON, fetchImpl: async () => res(MCP), now: 1000 });
  const old = await freshCatalog('mcp', { home, env: ON, fetchImpl: down, now: 1000 + 10 * DATA_TTL });
  assert.equal(old.source, 'cache', 'ancien cache gardé quand le réseau manque');
  const custom = [];
  await freshCatalog('plugins', { home, env: { SA_CATALOG_DATA_URL: 'https://exemple.test/d/' }, fetchImpl: async (u) => { custom.push(u); return res(PLUG); } });
  assert.deepEqual(custom, ['https://exemple.test/d/plugins.json']);
});

test('contrôle avant publication : forme, tailles minimales, étoiles présentes', () => {
  const big = { kind: 'mcp', servers: Array.from({ length: 600 }, () => ({ stars: 5, install: {}, score: { total: 1 } })) };
  const plugs = { kind: 'plugin', plugins: Array.from({ length: 400 }, () => ({})) };
  assert.deepEqual(check(big, plugs), []);
  assert.match(check({ ...big, servers: big.servers.slice(0, 10) }, plugs)[0], /10 serveurs/);
  assert.match(check({ ...big, servers: big.servers.map((s) => ({ ...s, stars: null })) }, plugs)[0], /jeton ou quota GitHub/);
  assert.match(check(big, { kind: 'plugin', plugins: [] })[0], /plugins\.json : 0 plugins/);
  assert.equal(check(null, null).length, 2);
});
