#!/usr/bin/env node
// Construit le catalogue à partir d'un instantané de collecte.
// Usage : node catalog/scripts/build.mjs catalog/snapshot-2026-11-12 2026-11-12
// Écrit catalog/catalog.json et catalog/CATALOGUE.md.
import fs from 'node:fs';
import path from 'node:path';

const SNAP = process.argv[2];
const TODAY = new Date(process.argv[3] + 'T00:00:00Z');
const OUT = path.resolve(SNAP, '..');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(SNAP, f), 'utf8'));
const info = rd('info.json'), repos = rd('repos.json'), scan = rd('scan.json'), short = rd('shortlist2.json'), gaps = rd('gap-picks.json');
const key = (id) => id.replace(/[^\w.-]+/g, '__');

const OFFICIAL = new Set(['anthropics', 'vercel-labs', 'vercel', 'microsoft', 'cloudflare', 'supabase', 'prisma', 'flutter', 'expo', 'firebase', 'shopify', 'github', 'openai', 'stripe', 'clerk', 'getsentry', 'vuejs-ai', 'greensock', 'dbt-labs', 'better-auth', 'angular', 'sveltejs', 'nuxt', 'mongodb', 'aws', 'wordpress', 'langchain-ai', 'upstash', 'apollographql']);

// Retraits décidés à la lecture des descriptions : hors sujet pour la catégorie, doublon, ou outil trop spécifique.
const DROP = {
  'site-design': ['heygen-com/hyperframes/tailwind', 'anthropics/claude-code/frontend-design', 'leonxlnx/taste-skill/design-taste-frontend-v1'],
  backend: ['microsoft/azure-skills/python-appservice-deploy', 'wshobson/agents/python-testing-patterns'],
  database: ['prisma/skills/prisma-mongodb-upgrade', 'prisma/skills/prisma-driver-adapter-implementation', 'prisma/skills/prisma-compute', 'prisma/skills/prisma-upgrade-v7', 'prisma/skills/prisma-postgres-setup', 'giuseppe-trisciuoglio/developer-kit/nestjs-drizzle-crud-generator'],
  data: ['yuan1z0825/nature-skills/nature-data', 'github/awesome-copilot/datanalysis-credit-risk', 'jimliu/baoyu-design/claude-dashboard', 'coreyhaines31/marketingskills/analytics', 'wshobson/agents/postgresql-table-design', 'k-dense-ai/scientific-agent-skills/scientific-brainstorming'],
  tests: ['emilkowalski/skills/review-animations', 'mattpocock/skills/review'],
  devops: ['microsoft/azure-skills/python-appservice-deploy', 'microsoft/azure-skills/azure-cloud-migrate', 'microsoft/azure-skills/azure-enterprise-infra-planner', 'microsoft/azure-skills/azure-app-onboard-prereq', 'cloudflare/skills/cloudflare-one'],
  securite: ['firebase/agent-skills/firestore-security-rules-auditor'],
  ux: ['heygen-com/hyperframes/hyperframes-animation', 'heygen-com/hyperframes/remotion-to-hyperframes', 'heygen-com/hyperframes/figma'],
  methode: ['larksuite/cli/lark-doc', 'mattpocock/skills/writing-beats', 'mattpocock/skills/writing-shape', 'mattpocock/skills/writing-fragments', 'anthropics/skills/docx', 'samber/cc-skills-golang/golang-documentation'],
  'desktop-jeu': ['jimliu/baoyu-skills/baoyu-electron-extract'],
};

const clamp = (x) => Math.max(0, Math.min(1, x));
function score(r, repo, sc) {
  const pop = Math.round(40 * clamp((Math.log10(Math.max(r.installs, 1)) - 3) / 3.5));
  const official = OFFICIAL.has(r.source.split('/')[0].toLowerCase());
  const src = Math.min(25, Math.round(20 * clamp((Math.log10(Math.max(repo.stars, 1)) - 2) / 3.5)) + (official ? 5 : 0));
  const days = (TODAY - new Date(repo.pushedAt)) / 864e5;
  const fresh = days <= 30 ? 15 : days <= 90 ? 12 : days <= 180 ? 8 : days <= 365 ? 4 : 0;
  const a = r.audits || {};
  const n = Object.keys(a).length;
  const warns = Object.values(a).filter((v) => v === 'Warn').length;
  let sec = n === 0 ? 10 : Math.max(4, 20 - 6 * warns);
  if (sc && sc.verdict === 'orange') sec = Math.max(0, sec - 4);
  return { total: pop + src + fresh + sec, pop, src, fresh, sec, official };
}

const catalog = { generatedAt: process.argv[3], method: 'skills.sh (recherche, fiches, audits) + GitHub (étoiles, dernier changement) + contrôle statique tools/skill-scan.mjs', weights: { popularite: 40, source: 25, fraicheur: 15, securite: 20 }, categories: [] };
const excluded = [];
for (const [cat, v] of Object.entries(short)) {
  const ids = [...new Set([...v.cands.map((c) => c.id), ...(gaps[cat] || [])])];
  const rows = [];
  for (const id of ids) {
    const r = info[id];
    if (!r) continue;
    const repo = repos[r.source] || {};
    const sc = scan[key(id)];
    const a = r.audits || {};
    const why = (DROP[cat] || []).includes(id) ? 'hors sujet ou doublon pour cette catégorie'
      : repo.stars == null ? 'source hors GitHub : dépôt non vérifiable'
      : Object.values(a).includes('Fail') ? 'audit en échec (' + Object.entries(a).filter(([, s]) => s === 'Fail').map(([p]) => p).join(', ') + ')'
      : sc && sc.verdict === 'rouge' ? 'notre contrôle : ' + [...new Set(sc.findings.filter((f) => f.sev === 'high').map((f) => f.label))].join(' ; ')
      : /deprecated|unmaintained/i.test(r.desc || '') ? 'déclaré obsolète par son auteur'
      : repo.archived ? 'dépôt archivé'
      : repo.stars < 100 && !OFFICIAL.has(r.source.split('/')[0].toLowerCase()) ? 'dépôt à moins de 100 étoiles et source non officielle'
      : null;
    if (why) { excluded.push({ cat, id, installs: r.installs, stars: repo.stars ?? null, why }); continue; }
    const s = score(r, repo, sc);
    rows.push({
      id, name: r.name, source: r.source, url: 'https://skills.sh/' + id, installs: r.installs,
      stars: repo.stars, pushedAt: (repo.pushedAt || '').slice(0, 10), license: repo.license || null, official: s.official,
      audits: a, scan: sc ? { verdict: sc.verdict, findings: sc.findings.filter((f) => f.sev !== 'low').slice(0, 3).map((f) => ({ rule: f.rule, label: f.label, file: f.file.replace(/\.txt$/, '').replace(/__/g, '/'), line: f.line })) } : { verdict: 'non-controle', findings: [] },
      scripts: r.scripts ? r.scripts.length : null, score: { total: s.total, popularite: s.pop, source: s.src, fraicheur: s.fresh, securite: s.sec },
      description: r.desc || '',
    });
  }
  rows.sort((a, b) => b.score.total - a.score.total);
  const perSource = {};
  const picks = rows.filter((x) => (perSource[x.source] = (perSource[x.source] || 0) + 1) <= 3).slice(0, 6);
  catalog.categories.push({ id: cat, label: v.label, candidates: ids.length, skills: picks });
}
catalog.excluded = excluded.sort((a, b) => b.installs - a.installs);
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 1));

const K = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n));
const AUD = (a) => (!Object.keys(a).length ? 'aucun' : ['Gen Agent Trust Hub', 'Socket', 'Snyk'].filter((p) => a[p]).map((p) => p.split(' ')[0] + ' ' + ({ Pass: 'réussi', Warn: 'avert.', Fail: 'échec' })[a[p]]).join(', '));
const VER = { vert: 'vert', 'vert-remarques': 'vert, remarques', orange: 'orange', 'non-controle': 'non contrôlé' };
let md = '# Catalogue de départ — ' + catalog.generatedAt + '\n\nFichier généré par `catalog/scripts/build.mjs`. Ne pas modifier à la main.\n\n';
md += 'Note sur 100 : popularité 40, réputation de la source 25, fraîcheur 15, sécurité 20. Les étoiles sont celles du dépôt entier. Les descriptions sont celles des auteurs.\n';
for (const c of catalog.categories) {
  md += '\n## ' + c.label + '\n\n| Skill | Source | Note | Installations | Étoiles du dépôt | Audits skills.sh | Notre contrôle |\n|---|---|---|---|---|---|---|\n';
  for (const s of c.skills) md += '| [' + s.name + '](' + s.url + ') | ' + s.source + (s.official ? ' (officielle)' : '') + ' | ' + s.score.total + ' | ' + K(s.installs) + ' | ' + K(s.stars) + ' | ' + AUD(s.audits) + ' | ' + VER[s.scan.verdict] + ' |\n';
  md += '\n' + c.skills.map((s) => '- **' + s.name + '** : ' + s.description.replace(/\|/g, '/').slice(0, 170)).join('\n') + '\n';
}
md += '\n## Écartés, et pourquoi\n\n| Skill | Catégorie | Installations | Étoiles | Raison |\n|---|---|---|---|---|\n';
const seen = new Set();
for (const e of catalog.excluded) { if (seen.has(e.id)) continue; seen.add(e.id); md += '| ' + e.id + ' | ' + e.cat + ' | ' + K(e.installs) + ' | ' + (e.stars == null ? '—' : K(e.stars)) + ' | ' + e.why + ' |\n'; }
fs.writeFileSync(path.join(OUT, 'CATALOGUE.md'), md);

const all = catalog.categories.flatMap((c) => c.skills);
console.log('catégories:', catalog.categories.length, '| skills retenus:', all.length, '(uniques:', new Set(all.map((s) => s.id)).size + ')', '| écartés:', seen.size);
for (const c of catalog.categories) console.log(c.id.padEnd(12), c.skills.map((s) => s.name + ' ' + s.score.total).join(' | '));
const why = {}; for (const e of catalog.excluded) why[e.why.split(' (')[0].split(' : ')[0]] = (why[e.why.split(' (')[0].split(' : ')[0]] || 0) + 1;
console.log(why);
