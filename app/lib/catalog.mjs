// Catalogue : version en ligne (CATALOG_URL + /api/catalog) ou, à défaut, catalog/catalog.json.
// Le résultat est gardé en mémoire 10 minutes.
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeOf, renameRetry } from './util.mjs';

const BUNDLED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'catalog', 'catalog.json');
const MAX_AGE = 10 * 60 * 1000;
const cache = new Map();

// Vide le cache (tests).
export function clearCatalogCache() { cache.clear(); }

// Un catalogue utilisable a un objet "skills".
function usable(c) {
  return c && typeof c === 'object' && !Array.isArray(c) && c.skills && typeof c.skills === 'object';
}

// Le champ "source" du fichier décrit sa fabrication : il est gardé dans "origin".
function tag(c, source) {
  const out = { ...c, source };
  if (typeof c.source === 'string') out.origin = c.source;
  return out;
}

async function online(url, timeoutMs) {
  const base = String(url).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return null;
  try {
    const res = await fetch(base + '/api/catalog', { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const c = await res.json();
    return usable(c) ? c : null;
  } catch {
    return null;
  }
}

// Fichier fourni avec l'application. Absent, cassé ou sans "skills" : erreur NOT_FOUND, sans chemin dans le message.
async function bundled(file) {
  let c = null;
  try { c = JSON.parse(await readFile(file, 'utf8')); } catch {}
  if (!usable(c)) throw Object.assign(new Error('Catalogue introuvable ou illisible. Réinstallez Skill Advisor.'), { code: 'NOT_FOUND' });
  return c;
}

export async function getCatalog({ url = process.env.CATALOG_URL, bundledPath = BUNDLED, timeoutMs = 8000 } = {}) {
  const key = (url || '') + '\n' + bundledPath;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < MAX_AGE) return hit.value;
  let value = null;
  if (url) {
    const c = await online(url, timeoutMs);
    if (c) value = tag(c, 'online');
  }
  if (!value) value = tag(await bundled(bundledPath), 'bundled');
  cache.set(key, { at: Date.now(), value });
  return value;
}

// --- Données de recherche de la page (SA.search), tirées du catalogue en ligne ---
// Même forme que prototype/src/search-data.js, fabriquée comme prototype/tools/make-search-data.mjs.

const SEARCH_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prototype', 'src', 'search-data.js');
export const SEARCH_TTL = 6 * 60 * 60 * 1000;
export const SEARCH_MAX_BYTES = 20 * 1024 * 1024;
const cacheFile = (home) => path.join(home, '.skill-advisor', 'cache', 'search-data.json');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
let bundledAt = null;

// Date de la copie fournie avec la page, lue dans le fichier sans l'exécuter.
async function bundledDate() {
  if (bundledAt === null) {
    let head = '';
    try {
      const fd = await open(SEARCH_JS, 'r');
      try { const b = Buffer.alloc(4096); const { bytesRead } = await fd.read(b, 0, 4096, 0); head = b.subarray(0, bytesRead).toString('utf8'); } finally { await fd.close(); }
    } catch { /* fichier absent */ }
    const m = /"generatedAt"\s*:\s*"([^"\\]{1,64})"/.exec(head);
    bundledAt = m ? m[1] : '';
  }
  return bundledAt || null;
}

// Adresse acceptée : https avec un nom d'hôte, ou http vers 127.0.0.1 (essais). Sans utilisateur ni mot de passe.
// Rend la base sans barre finale, ou null.
export function catalogBase(u) {
  if (typeof u !== 'string' || !u.trim() || u.length > 2000) return null;
  let x;
  try { x = new URL(u.trim()); } catch { return null; }
  if (x.username || x.password || x.search || x.hash) return null;
  if (!(x.protocol === 'https:' && x.hostname) && !(x.protocol === 'http:' && x.hostname === '127.0.0.1')) return null;
  return (x.origin + x.pathname).replace(/\/+$/, '');
}

// Adresse configurée : variable CATALOG_URL, sinon catalogUrl des réglages.
async function configuredUrl(home, url) {
  if (url !== undefined) return url || null;
  if (process.env.CATALOG_URL) return process.env.CATALOG_URL;
  try {
    const raw = JSON.parse(await readFile(path.join(home, '.skill-advisor', 'settings.json'), 'utf8'));
    return isObj(raw) && typeof raw.catalogUrl === 'string' ? raw.catalogUrl : null;
  } catch { return null; }
}

// Lit une réponse JSON bornée en octets, même sans en-tête de taille.
async function readBounded(res, max) {
  const len = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) throw new Error('trop gros');
  const chunks = [];
  let n = 0;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) { await reader.cancel().catch(() => {}); throw new Error('trop gros'); }
      chunks.push(Buffer.from(value));
    }
  } else {
    const b = Buffer.from(await res.arrayBuffer());
    if (b.length > max) throw new Error('trop gros');
    chunks.push(b);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Conversion du catalogue et de son index en SA.search. Lève une erreur si la forme n'est pas celle attendue.
export function toSearch(cat, idx) {
  if (!isObj(cat) || !Array.isArray(cat.categories) || !isObj(cat.skills) || !isObj(idx) || !Array.isArray(idx.skills)) throw new Error('forme');
  if (typeof cat.generatedAt !== 'string' || !cat.generatedAt) throw new Error('date');
  const cats = cat.categories.map((c) => ({ id: c.id, label: c.label }));
  const ci = Object.fromEntries(cats.map((c, i) => [c.id, i]));
  const trend = Object.fromEntries((Array.isArray(idx.trending) ? idx.trending : []).map((id, i) => [id, i + 1]));
  const level = (s) => (s.warnings.some((w) => w.level === 'eleve') ? 2 : s.warnings.some((w) => w.level === 'moyen') ? 1 : 0);
  const keep = new Map();
  for (const s of idx.skills.slice(0, 1500)) keep.set(s.id, s);
  for (const s of Object.values(cat.skills)) {
    if (keep.has(s.id)) continue;
    keep.set(s.id, { id: s.id, n: s.name, s: s.source, i: s.installs, c: cat.categories.filter((c) => c.byScore.includes(s.id) || c.byInstalls.includes(s.id)).map((c) => c.id), o: s.official ? 1 : 0, t: s.score.total, w: level(s) });
  }
  // [id, nom, source, installations, [catégories], officielle, note, avertissement, rang de tendance]
  const items = [...keep.values()].map((s) => {
    const k = cat.skills[s.id];
    return [s.id, s.n, s.s, s.i, (s.c || []).map((c) => ci[c]).filter((x) => x != null), s.o ? 1 : 0, k ? k.score.total : (s.t ?? null), k ? level(k) : (s.w ?? null), trend[s.id] || 0];
  });
  const details = {};
  for (const s of Object.values(cat.skills)) {
    details[s.id] = {
      d: (s.description || '').slice(0, 240), st: s.stars, p: s.pushedAt, l: s.license,
      sc: [s.score.popularite, s.score.source, s.score.fraicheur, s.score.securite],
      // audits : [auditeur, statut, niveau de risque, date, résumé, identifiant du rapport, catégories]
      a: Object.entries(s.audits || {}).map(([p, a]) => [p, a.status, a.riskLevel || '', (a.auditedAt || '').slice(0, 10), a.summary || '', a.slug || '', a.categories || []]),
      w: s.warnings.map((w) => [w.level, w.text.slice(0, 220), w.code]),
      // constats de notre contrôle : [libellé, fichier, ligne, extrait, gravité]
      fd: s.scan ? s.scan.findings.map((f) => [f.label, f.file, f.line, (f.excerpt || '').slice(0, 160), f.sev]) : [],
      v: s.scan ? s.scan.verdict : null, f: s.fileCount || 0, sx: s.scripts || 0,
    };
  }
  const search = { generatedAt: cat.generatedAt, total: cat.totalSkillsListed, cats, items, details };
  if (!validSearch(search)) throw new Error('résultat');
  return search;
}

// Forme attendue par la page : chaque ligne a ses neuf champs, chaque id est une chaîne.
function validSearch(s) {
  if (!isObj(s) || typeof s.generatedAt !== 'string' || !Number.isFinite(s.total) || !Array.isArray(s.cats) || !Array.isArray(s.items) || !s.items.length || !isObj(s.details)) return false;
  if (!s.cats.every((c) => isObj(c) && typeof c.id === 'string' && typeof c.label === 'string')) return false;
  return s.items.every((r) => Array.isArray(r) && r.length === 9 && typeof r[0] === 'string' && typeof r[1] === 'string' && Array.isArray(r[4]));
}

async function readCache(home, base, t) {
  try {
    const c = JSON.parse(await readFile(cacheFile(home), 'utf8'));
    if (!isObj(c) || c.url !== base || !Number.isFinite(c.at) || c.at > t || t - c.at >= SEARCH_TTL || !validSearch(c.search)) return null;
    return c;
  } catch { return null; }
}

// Écriture atomique, compacte, lisible seulement par l'utilisateur.
async function writeCache(home, value) {
  const file = cacheFile(home);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await renameRetry(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

async function download(base, fetchImpl, timeoutMs) {
  // Minuterie active, pas AbortSignal.timeout : sous Node 22 sa minuterie ne retient pas le processus.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('délai dépassé')), timeoutMs);
  try { return await fetchBoth(base, fetchImpl, ac.signal); } finally { clearTimeout(timer); }
}

async function fetchBoth(base, fetchImpl, signal) {
  const get = async (u) => {
    const res = await fetchImpl(u, { signal, redirect: 'follow', headers: { accept: 'application/json' } });
    if (!res || !res.ok) throw new Error('statut');
    // Redirection vers une adresse refusée (http, autre forme) : refusée aussi.
    if (res.url && !catalogBase(new URL(res.url).origin)) throw new Error('redirection');
    return readBounded(res, SEARCH_MAX_BYTES);
  };
  // Chaque réponse : 20 Mo au plus.
  const [cat, idx] = await Promise.all([get(base + '/api/catalog'), get(base + '/api/catalog?file=index')]);
  return toSearch(cat, idx);
}

const pending = new Map();

// Rend { source: 'online' | 'bundled', generatedAt, search }. Ne lève jamais d'erreur : en cas de doute, la copie fournie.
export async function getSearchData(opts = {}) {
  const home = homeOf(opts);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const t = typeof opts.now === 'function' ? opts.now() : Number.isFinite(opts.now) ? opts.now : Date.now();
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 8000;
  const fallback = async () => ({ source: 'bundled', generatedAt: await bundledDate(), search: null });
  try {
    const base = catalogBase(await configuredUrl(home, opts.url));
    if (!base || typeof fetchImpl !== 'function') return await fallback();
    const hit = await readCache(home, base, t);
    if (hit) return { source: 'online', generatedAt: hit.search.generatedAt, search: hit.search };
    // Une seule fois à la fois par dossier et par adresse.
    const key = home + '\n' + base;
    if (!pending.has(key)) {
      pending.set(key, (async () => {
        const search = await download(base, fetchImpl, timeoutMs);
        await writeCache(home, { url: base, at: t, search }).catch(() => {});
        return search;
      })().finally(() => pending.delete(key)));
    }
    const search = await pending.get(key);
    return { source: 'online', generatedAt: search.generatedAt, search };
  } catch {
    return fallback();
  }
}

// Source et date pour State.catalog, sans réseau : le cache encore valable, sinon la copie fournie.
export async function catalogInfo(opts = {}) {
  const home = homeOf(opts);
  const t = typeof opts.now === 'function' ? opts.now() : Number.isFinite(opts.now) ? opts.now : Date.now();
  try {
    const base = catalogBase(await configuredUrl(home, opts.url));
    const hit = base && (await readCache(home, base, t));
    if (hit) return { source: 'online', generatedAt: hit.search.generatedAt };
  } catch { /* copie fournie */ }
  return { source: 'bundled', generatedAt: await bundledDate() };
}
