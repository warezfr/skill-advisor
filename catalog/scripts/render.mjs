#!/usr/bin/env node
// Télécharge le catalogue en ligne et en fait une copie lisible.
// Usage : node catalog/scripts/render.mjs [adresse]
// Écrit catalog/catalog.json et catalog/CATALOGUE.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || process.env.CATALOG_URL;
if (!BASE) { console.error('Adresse du catalogue absente : passez-la en argument ou dans la variable CATALOG_URL.'); process.exit(2); }
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await fetch(BASE + '/api/catalog?t=' + Date.now()); // le paramètre évite la copie en cache
if (!r.ok) { console.error('Lecture impossible :', r.status); process.exit(1); }
const c = await r.json();
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(c, null, 1));

const K = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n));
const LV = { eleve: 'ÉLEVÉ', moyen: 'moyen', info: 'info' };
const warn = (s) => {
  const w = s.warnings.filter((x) => x.level !== 'info');
  if (!w.length) return 'aucun';
  return w.map((x) => LV[x.level] + ' : ' + x.text.replace(/\|/g, '/').replace(/\s*\(.*$/, '')).join(' ; ');
};
let md = '# Catalogue Skill Advisor\n\nCopie de la base en ligne du ' + c.generatedAt.slice(0, 16).replace('T', ' à ') + ' UTC. Fichier généré par `catalog/scripts/render.mjs`, ne pas modifier à la main.\n\n';
md += '- ' + c.counts.skills + ' skills dans ' + c.counts.categories + ' types de projet, sur ' + c.totalSkillsListed.toLocaleString('fr-FR') + ' recensés par skills.sh.\n';
md += '- Note sur 100 : popularité ' + c.weights.popularite + ', réputation de la source ' + c.weights.source + ', fraîcheur ' + c.weights.fraicheur + ', sécurité ' + c.weights.securite + '.\n';
md += '- Un avertissement n’écarte pas un skill : il est affiché et l’utilisateur décide. ' + c.counts.avecAvertissementEleve + ' skills portent un avertissement élevé.\n';
md += '- Les étoiles sont celles du dépôt entier. Les descriptions sont celles des auteurs.\n';
for (const cat of c.categories) {
  md += '\n## ' + cat.label + '\n\n### Les mieux notés\n\n| # | Skill | Source | Note | Installations | Étoiles | Avertissements |\n|---|---|---|---|---|---|---|\n';
  cat.byScore.forEach((id, i) => { const s = c.skills[id]; md += '| ' + (i + 1) + ' | [' + s.name + '](' + s.url + ') | ' + s.source + (s.official ? ' (officielle)' : '') + ' | ' + s.score.total + ' | ' + K(s.installs) + ' | ' + K(s.stars) + ' | ' + warn(s) + ' |\n'; });
  md += '\n### Les plus installés\n\n| # | Skill | Installations | Note | Avertissements |\n|---|---|---|---|---|\n';
  cat.byInstalls.forEach((id, i) => { const s = c.skills[id]; md += '| ' + (i + 1) + ' | [' + s.name + '](' + s.url + ') | ' + K(s.installs) + ' | ' + s.score.total + ' | ' + warn(s) + ' |\n'; });
}
fs.writeFileSync(path.join(OUT, 'CATALOGUE.md'), md);
console.log('catalogue du', c.generatedAt, '|', c.counts.skills, 'skills |', c.counts.avecAvertissementEleve, 'avec avertissement élevé');
for (const cat of c.categories) console.log(cat.id.padEnd(12), String(cat.byScore.length).padStart(2), '|', cat.byScore.slice(0, 5).map((id) => c.skills[id].name + ' ' + c.skills[id].score.total).join(', '));
