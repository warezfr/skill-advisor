// Écriture des réglages MCP d'un agent : une entrée de serveur posée ou retirée, rien d'autre.
// Chaque format est édité en gardant les commentaires et la mise en forme (jsonc-parser, document yaml, TOML au texte),
// puis le résultat est relu : l'objet obtenu doit être exactement l'ancien, à cette entrée près. Sinon, rien n'est écrit.
// Écriture : copie préalable dans ~/.skill-advisor/mcp-copies, fichier temporaire, contrôle que le fichier
// n'a pas changé depuis la lecture (un agent ouvert réécrit parfois ses réglages), puis renommage.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as jsonc from 'jsonc-parser';
import TOML from '@iarna/toml';
import YAML from 'yaml';
import { fail, mkdirp, renameRetry, rmOpts, saDir, writePrivate } from './util.mjs';

export const keyPathOf = (configKey) => (configKey ? String(configKey).split('.') : []);
export const copiesDir = (home) => path.join(saDir(home), 'mcp-copies');
const KEEP_COPIES = 40;

// Lecture stricte d'un texte de réglages. Rend l'objet, ou lève BROKEN_CONFIG.
export function parseStrict(format, text) {
  if (!text || !text.trim()) return {};
  let v;
  try {
    if (format === 'toml') v = TOML.parse(text);
    else if (format === 'yaml' || format === 'yaml-1.1') {
      const doc = YAML.parseDocument(text, { version: format === 'yaml-1.1' ? '1.1' : '1.2' });
      if (doc.errors.length) throw new Error('yaml');
      v = doc.toJS() ?? {};
    } else {
      const errors = [];
      v = jsonc.parse(text, errors, { allowTrailingComma: true, disallowComments: false });
      if (errors.length) throw new Error('json');
    }
  } catch {
    throw fail('BROKEN_CONFIG', 'Fichier de réglages mal formé : Skill Advisor n’y écrit pas.');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail('BROKEN_CONFIG', 'Fichier de réglages mal formé : Skill Advisor n’y écrit pas.');
  return v;
}

// Forme canonique (clés triées, dates en texte) : sert à comparer deux lectures.
export function canon(v) {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export function getIn(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object' || !Object.hasOwn(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}

// Copie de obj avec l'entrée keys posée (value) ou retirée (undefined) ; un parent vidé reste en place.
function withEntry(obj, keys, value) {
  const out = structuredClone(canon(obj));
  let cur = out;
  for (const k of keys.slice(0, -1)) {
    if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) {
      if (value === undefined) return out;
      cur[k] = {};
    }
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete cur[last]; else cur[last] = canon(value);
  return out;
}

// Copie de obj sans les parents de keyPath restés vides (du plus profond au premier) ; null si aucun n'est vide.
function prune(obj, keyPath) {
  const out = structuredClone(obj);
  let changed = false;
  for (let n = keyPath.length; n > 0; n--) {
    const parent = n > 1 ? getIn(out, keyPath.slice(0, n - 1)) : out;
    const k = keyPath[n - 1];
    const v = parent && parent[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) { delete parent[k]; changed = true; } else break;
  }
  return changed ? out : null;
}

// --- TOML au texte : les commentaires et l'ordre du fichier restent ---

const BARE = /^[A-Za-z0-9_-]+$/;
const tomlKey = (k) => (BARE.test(k) ? k : JSON.stringify(k));

// Clés d'un en-tête [a."b c".d] ; null si la ligne n'est pas un en-tête de table simple.
function headerKeys(line) {
  const m = /^\s*\[(?!\[)\s*(.+?)\s*\](?!\])\s*(#.*)?$/.exec(line);
  if (!m) return null;
  const keys = [];
  const s = m[1];
  let i = 0;
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i];
      let j = i + 1, v = '';
      while (j < s.length && s[j] !== q) { if (q === '"' && s[j] === '\\' && j + 1 < s.length) { v += JSON.parse('"' + s[j] + s[j + 1] + '"'); j += 2; continue; } v += s[j++]; }
      if (s[j] !== q) return null;
      keys.push(v); i = j + 1;
    } else {
      const m2 = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m2) return null;
      keys.push(m2[0]); i += m2[0].length;
    }
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (i < s.length) { if (s[i] !== '.') return null; i++; }
  }
  return keys;
}
const isHeader = (line) => /^\s*\[/.test(line);
const startsWith = (keys, prefix) => prefix.every((k, i) => keys[i] === k);

// Retire les tables [prefix] et [prefix.*] ; rend le texte, ou null si l'entrée n'est pas sous cette forme.
function tomlRemove(text, prefix) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  let skipping = false, found = false;
  for (const line of lines) {
    if (isHeader(line)) {
      const k = headerKeys(line);
      skipping = !!(k && startsWith(k, prefix));
      if (skipping) { found = true; continue; }
    }
    if (!skipping) out.push(line);
  }
  if (!found) return null;
  // Lignes vides en double laissées par le retrait : une seule.
  return out.join(eol).replace(new RegExp('(' + eol + '){3,}', 'g'), eol + eol);
}

// Ajoute la table de l'entrée à la fin du fichier.
function tomlAppend(text, keys, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let obj = value;
  for (const k of [...keys].reverse()) obj = { [k]: obj };
  let block = TOML.stringify(obj).replace(/\r?\n/g, eol);
  // @iarna/toml écrit aussi les tables parentes vides ([mcp_servers]) : inutiles si le fichier les a déjà.
  const parent = keys.slice(0, -1).map(tomlKey).join('.');
  if (parent) block = block.replace(new RegExp('^\\[' + parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]' + eol + '(' + eol + ')?', 'm'), '');
  const base = text.replace(/\s+$/, '');
  return (base ? base + eol + eol : '') + block.replace(/\s+$/, '') + eol;
}

// --- Édition d'une entrée, tous formats ---

// Rend { text, lossy } : le nouveau texte, et lossy = vrai quand le fichier a dû être réécrit en entier (commentaires perdus).
// value undefined : retrait. Lève NOT_FOUND (retrait d'une entrée absente), EXISTS (pose sur une entrée présente sans replace).
export function editEntry(format, text, keyPath, name, value, opts = {}) {
  const keys = [...keyPath, name];
  const before = parseStrict(format, text);
  const had = getIn(before, keys) !== undefined;
  if (value === undefined && !had) throw fail('NOT_FOUND', 'Serveur absent de ce fichier de réglages.');
  if (value !== undefined && had && !opts.replace) throw fail('EXISTS', 'Un serveur de ce nom existe déjà dans ce fichier.');
  const expected = withEntry(before, keys, value);
  // Retrait du dernier serveur : en TOML, la table parente disparaît avec ses sous-tables. Les deux formes sont justes.
  const pruned = value === undefined ? prune(expected, keyPath) : null;
  const check = (t) => {
    try { const v = parseStrict(format, t); return same(v, expected) || (pruned !== null && same(v, pruned)); } catch { return false; }
  };
  let out = null;
  if (format === 'json') {
    const eol = text && text.includes('\r\n') ? '\r\n' : '\n';
    const indent = /\n(\t| +)\S/.exec(text || '');
    const fo = { insertSpaces: !(indent && indent[1] === '\t'), tabSize: indent && indent[1] !== '\t' ? indent[1].length : 2, eol };
    const base = text && text.trim() ? text : '{}' + eol;
    out = jsonc.applyEdits(base, jsonc.modify(base, keys, value, { formattingOptions: fo }));
  } else if (format === 'yaml' || format === 'yaml-1.1') {
    const doc = YAML.parseDocument(text || '', { version: format === 'yaml-1.1' ? '1.1' : '1.2' });
    if (!doc.contents) doc.contents = doc.createNode({});
    if (value === undefined) doc.deleteIn(keys); else doc.setIn(keys, doc.createNode(value));
    out = doc.toString();
  } else if (format === 'toml') {
    let t = text || '';
    if (had) t = tomlRemove(t, keys);
    if (t !== null && value !== undefined) t = tomlAppend(t, keys, value);
    out = t;
  } else {
    throw fail('BAD_INPUT', 'Format de réglages inconnu : ' + format);
  }
  if (out !== null && check(out)) return { text: out, lossy: false };
  // Édition au texte impossible (forme inhabituelle) : réécriture complète, vérifiée elle aussi.
  let full;
  if (format === 'toml') full = TOML.stringify(expected);
  else if (format === 'json') full = JSON.stringify(expected, null, 2) + '\n';
  else full = YAML.stringify(expected, { version: format === 'yaml-1.1' ? '1.1' : '1.2' });
  if (!check(full)) throw fail('WRITE_FAILED', 'Skill Advisor n’a pas pu préparer ce fichier de réglages sans risque.');
  return { text: full, lossy: true };
}

// --- Écriture sur le disque, sous garde ---

const sha = (b) => crypto.createHash('sha256').update(b ?? '').digest('hex');
async function readOrNull(p) { try { return await fs.readFile(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }

// Chemin réel du fichier (un lien vers des dotfiles reste un lien : on écrit dans sa cible).
async function target(file) {
  try { return await fs.realpath(file); } catch { return path.resolve(file); }
}

// Copie de l'état d'avant dans ~/.skill-advisor/mcp-copies (0600), les 40 plus récentes gardées.
async function keepCopy(home, file, bytes) {
  if (bytes === null) return null;
  const dir = copiesDir(home);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const name = stamp + '-' + crypto.randomBytes(3).toString('hex') + '-' + path.basename(file).replace(/[^\w.-]/g, '_');
  await writePrivate(path.join(dir, name), bytes);
  const all = (await fs.readdir(dir).catch(() => [])).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_COPIES))) await fs.rm(path.join(dir, old), { force: true }).catch(() => {});
  return path.join(dir, name);
}

// Pose (value) ou retire (undefined) une entrée dans un fichier de réglages, sous garde.
// Rend { path, copy, lossy }. Lève BROKEN_CONFIG, NOT_FOUND, EXISTS, CONFLICT (fichier changé pendant l'écriture), WRITE_FAILED.
export async function writeEntry(opts) {
  const { home, file, format, keyPath, name } = opts;
  const real = await target(file);
  const bytes = await readOrNull(real);
  const text = bytes === null ? '' : bytes.toString('utf8');
  const { text: next, lossy } = editEntry(format, text, keyPath, name, opts.value, { replace: !!opts.replace });
  const copy = await keepCopy(home, real, bytes);
  let mode;
  try { mode = (await fs.stat(real)).mode & 0o777; } catch { mode = opts.newMode || 0o644; }
  await mkdirp(path.dirname(real));
  const tmp = real + '.sa-' + process.pid + '-' + crypto.randomBytes(3).toString('hex') + '.tmp';
  try {
    await fs.writeFile(tmp, next, { mode });
    if (opts.beforeCommit) await opts.beforeCommit(real); // tests : un autre programme écrit pendant l'opération
    // Le fichier a changé depuis la lecture (agent ouvert qui réécrit ses réglages) : rien n'est remplacé.
    const now = await readOrNull(real);
    if (sha(now) !== sha(bytes)) throw fail('CONFLICT', 'Le fichier de réglages a changé pendant l’opération. Fermez l’agent, puis réessayez.');
    await renameRetry(tmp, real);
  } catch (e) {
    await fs.rm(tmp, rmOpts()).catch(() => {});
    if (e.code && /^[A-Z_]+$/.test(e.code) && !/^E[A-Z]+$/.test(e.code)) throw e;
    throw fail('WRITE_FAILED', 'Écriture impossible dans ' + path.basename(real) + '.', { detail: String(e.message || e) });
  }
  return { path: real, copy, lossy };
}

// Lit l'entrée brute (non masquée) d'un serveur : sert à la mise de côté et aux sauvegardes, jamais à la page.
export async function readEntry(file, format, keyPath, name) {
  const bytes = await readOrNull(await target(file));
  if (bytes === null) return undefined;
  return getIn(parseStrict(format, bytes.toString('utf8')), [...keyPath, name]);
}
