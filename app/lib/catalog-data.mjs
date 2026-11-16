// Catalogues des serveurs MCP et des plugins mis à jour chaque jour : branche « catalog-data » du dépôt public
// de Skill Advisor (.github/workflows/catalogs.yml). Lus au plus une fois par 24 h, gardés dans
// ~/.skill-advisor/cache/, taille bornée, forme vérifiée. En cas d'échec : le cache, même ancien, puis la copie fournie.
// SA_CATALOG_DATA=off coupe toute lecture en ligne (les tests le font) ; SA_CATALOG_DATA_URL change l'adresse.
import fs from 'node:fs/promises';
import path from 'node:path';
import { homeOf, saDir, writePrivate } from './util.mjs';

export const DATA_URL = 'https://raw.githubusercontent.com/warezfr/skill-advisor/catalog-data/';
export const DATA_TTL = 24 * 60 * 60 * 1000;
const MAX_BYTES = 20 * 1024 * 1024;
const SHAPE = { mcp: (v) => v && v.kind === 'mcp' && Array.isArray(v.servers) && v.servers.length >= 100, plugins: (v) => v && v.kind === 'plugin' && Array.isArray(v.plugins) && v.plugins.length >= 50 };
const cacheFile = (home, name) => path.join(saDir(home), 'cache', name + '.json');

async function readCache(home, name) {
  try {
    const c = JSON.parse(await fs.readFile(cacheFile(home, name), 'utf8'));
    return c && Number.isFinite(c.at) && SHAPE[name](c.value) ? c : null;
  } catch { return null; }
}

async function download(url, fetchImpl, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('délai dépassé')), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const len = Number(res.headers && res.headers.get && res.headers.get('content-length'));
    if (len > MAX_BYTES) throw new Error('trop gros');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('trop gros');
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

// Catalogue « mcp » ou « plugins » le plus récent possible, sinon null (l'appelant prend sa copie fournie).
// Rend { value, source: 'online'|'cache' }.
export async function freshCatalog(name, opts = {}) {
  if (!SHAPE[name]) return null;
  const env = opts.env || process.env;
  const home = homeOf(opts);
  const now = opts.now || Date.now();
  const cached = await readCache(home, name);
  if (cached && now - cached.at < DATA_TTL && cached.at <= now) return { value: cached.value, source: 'cache' };
  if (String(env.SA_CATALOG_DATA || '').toLowerCase() === 'off') return cached ? { value: cached.value, source: 'cache' } : null;
  const base = env.SA_CATALOG_DATA_URL || DATA_URL;
  try {
    const v = await download(base + (name === 'mcp' ? 'mcp.json' : 'plugins.json'), opts.fetchImpl || fetch, opts.timeoutMs || 15000);
    if (!SHAPE[name](v)) throw new Error('forme inattendue');
    await writePrivate(cacheFile(home, name), JSON.stringify({ at: now, url: base, value: v }));
    return { value: v, source: 'online' };
  } catch (e) {
    console.error('[catalogue] ' + name + ' en ligne indisponible (' + (e && e.message) + ')');
    return cached ? { value: cached.value, source: 'cache' } : null;
  }
}
