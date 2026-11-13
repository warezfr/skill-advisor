#!/usr/bin/env node
// Extrait le début du SKILL.md des skills détaillés, pour le panneau de détail du prototype.
// Usage : node tools/make-file-data.mjs   → écrit src/file-data.js
// Requêtes anonymes vers des dépôts publics. Seuls les skills sous licence permissive sont repris,
// en extrait, avec leur chemin d'origine. Le produit, lui, lira le fichier installé sur la machine.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'src', 'file-data.js');
const PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|CC0-1\.0|Unlicense)$/;
const MAX_LINES = 48, MAX_CHARS = 2200, TREE_BUDGET = 45;
const UA = { 'User-Agent': 'curl/8' };

const win = {}; win.window = win; vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(root, 'src', 'search-data.js'), 'utf8'), win);
const db = win.SA.search;

const raw = async (repo, p) => {
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${p}`, { headers: UA });
  return r.ok ? r.text() : null;
};
const trees = new Map();
let treeCalls = 0;
async function tree(repo) {
  if (trees.has(repo)) return trees.get(repo);
  let list = null;
  if (treeCalls < TREE_BUDGET) {
    treeCalls++;
    const r = await fetch(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`, { headers: UA });
    if (r.ok) list = ((await r.json()).tree || []).filter((t) => t.type === 'blob').map((t) => t.path);
  }
  trees.set(repo, list);
  return list;
}

// Longueur de « name + description » du frontmatter : ce que l'agent garde en contexte pour chaque skill listé.
function frontLen(md, name) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description\s*:/.test(l));
  if (i < 0) return null;
  let v = lines[i].replace(/^description\s*:\s*/, '');
  const block = /^[>|][+-]?\s*$/.test(v) || v === '';
  const parts = block ? [] : [v];
  for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) parts.push(lines[j].trim());
  v = parts.join(' ').replace(/^["']|["']$/g, '');
  return v ? name.length + v.length : null;
}

const out = {};
let ok = 0, skipped = 0, miss = 0;
const ids = Object.keys(db.details).filter((id) => {
  if (PERMISSIVE.test(db.details[id].l || '')) return true;
  skipped++;
  return false;
});

for (const id of ids) {
  const [owner, rp, ...rest] = id.split('/');
  const repo = owner + '/' + rp, name = rest.join('/');
  const leaf = name.split(':').pop();
  let p = null, md = null;
  for (const c of [`skills/${leaf}/SKILL.md`, `${leaf}/SKILL.md`, `.claude/skills/${leaf}/SKILL.md`, `.agents/skills/${leaf}/SKILL.md`]) {
    md = await raw(repo, c);
    if (md) { p = c; break; }
  }
  if (!md) {
    const t = await tree(repo);
    const hit = t && t.find((x) => x.toLowerCase().endsWith('/' + leaf.toLowerCase() + '/skill.md'));
    if (hit) { md = await raw(repo, hit); p = hit; }
  }
  if (!md) { miss++; continue; }
  const lines = md.split(/\r?\n/);
  let x = lines.slice(0, MAX_LINES).join('\n');
  if (x.length > MAX_CHARS) x = x.slice(0, x.lastIndexOf('\n', MAX_CHARS));
  out[id] = { p, n: lines.length, dl: frontLen(md, leaf), x, cut: x.length < md.trimEnd().length };
  ok++;
  if (ok % 25 === 0) console.log('…', ok);
}

fs.writeFileSync(OUT, '/* Début du SKILL.md des skills détaillés, sous licence permissive. Fichier généré par tools/make-file-data.mjs : ne pas modifier à la main. */\n(function () {\n  window.SA = window.SA || {};\n  window.SA.files = ' + JSON.stringify(out) + ';\n})();\n');
console.log('file-data.js :', ok, 'extraits,', miss, 'introuvables,', skipped, 'écartés (licence),', treeCalls, 'appels d’arborescence,', Math.round(fs.statSync(OUT).size / 1024), 'Ko');
