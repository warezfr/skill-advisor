#!/usr/bin/env node
// Copie la base en ligne dans le prototype, sous une forme compacte.
// Usage : node tools/make-search-data.mjs [adresse]   → écrit src/search-data.js
// Le prototype publié ne peut pas appeler le réseau : il embarque cette copie, datée.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || process.env.CATALOG_URL;
if (!BASE) { console.error('Adresse du catalogue absente : passez-la en argument ou dans la variable CATALOG_URL.'); process.exit(2); }
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'search-data.js');
const get = async (f) => {
  const r = await fetch(BASE + '/api/catalog?file=' + f + '&t=' + Date.now());
  if (!r.ok) throw new Error(f + ' -> ' + r.status);
  return r.json();
};
const [cat, idx] = await Promise.all([get('catalog'), get('index')]);

const cats = cat.categories.map((c) => ({ id: c.id, label: c.label }));
const ci = Object.fromEntries(cats.map((c, i) => [c.id, i]));
const trend = Object.fromEntries((idx.trending || []).map((id, i) => [id, i + 1]));
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
const data = { generatedAt: cat.generatedAt, total: cat.totalSkillsListed, cats, items, details };
fs.writeFileSync(OUT, '/* Copie de la base en ligne. Fichier généré par tools/make-search-data.mjs : ne pas modifier à la main. */\n(function () {\n  window.SA = window.SA || {};\n  window.SA.search = ' + JSON.stringify(data) + ';\n})();\n');
console.log('search-data.js :', items.length, 'skills,', Object.keys(details).length, 'détaillés,', Math.round(fs.statSync(OUT).size / 1024), 'Ko, base du', cat.generatedAt);
