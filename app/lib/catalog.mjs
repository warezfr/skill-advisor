// Catalogue : version en ligne (CATALOG_URL + /api/catalog) ou, à défaut, catalog/catalog.json.
// Le résultat est gardé en mémoire 10 minutes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
