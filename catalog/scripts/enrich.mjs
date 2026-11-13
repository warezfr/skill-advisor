// Enrichissement : présélection par pertinence, fiche skills.sh (description, audits), dépôt GitHub, fichiers du skill.
// Lecture seule. Les fichiers téléchargés vont dans skills-raw/ (données non fiables, jamais exécutées).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from "node:url";
import { execFileSync } from 'node:child_process';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(DIR, 'skills-raw');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const all = JSON.parse(fs.readFileSync(path.join(DIR, 'search-all.json'), 'utf8'));

const CATS = {
  'site-design': ['Sites web et design d’interface', /(frontend-design|web-design|landing|tailwind|ui-ux|design-taste|visual-design|website|html|css|shadcn|webflow|framer|web-interface)/],
  frontend: ['Frameworks front (React, Next.js, Vue…)', /(react(?!-native)|next|vue|svelte|astro|nuxt|angular|remix|vite|typescript)/],
  mobile: ['Applications mobiles', /(react-native|flutter|swift|ios|android|kotlin|expo|mobile)/],
  backend: ['Backend et API', /(api|backend|fastapi|django|laravel|golang|node|nest|express|rails|spring|python|php|rust)/],
  database: ['Bases de données', /(postgres|database|supabase|prisma|sql|mongo|redis|drizzle|schema|neon)/],
  data: ['Analyse de données', /(data|pandas|excel|xlsx|csv|chart|visualiz|analytics|sql|statistic|jupyter|notebook|bigquery|dashboard)/],
  ia: ['IA, agents et LLM', /(agent|mcp|prompt|rag|llm|claude|openai|ai-sdk|eval|langchain)/],
  tests: ['Tests, revue et débogage', /(test|tdd|playwright|e2e|review|debug|qa|cypress|vitest|jest)/],
  devops: ['DevOps et déploiement', /(docker|kubernetes|k8s|github-actions|terraform|deploy|cloudflare|wrangler|vercel|aws|azure|gcp|devops|infra|ci-cd)/],
  securite: ['Sécurité', /(secur|owasp|secret|pentest|vuln|auth|compliance|threat)/],
  marketing: ['SEO, marketing et contenu', /(seo|copy|marketing|content|email|brand|social|ads|growth|newsletter)/],
  documents: ['Documents bureautiques', /(pdf|docx|pptx|xlsx|word|slides|presentation|document|excel)/],
  ux: ['Design system, accessibilité, animation', /(design-system|accessib|a11y|animation|motion|figma|ux|typograph|color)/],
  ecommerce: ['E-commerce, CMS et paiement', /(shopify|wordpress|stripe|ecommerce|e-commerce|woocommerce|payment|cms|commerce)/],
  methode: ['Méthode de travail (plan, git, docs)', /(git|doc|plan|brainstorm|find-skills|writing|workflow|commit|spec|research|skill-creator)/],
  'desktop-jeu': ['Bureau, jeux et 3D', /(electron|game|three|tauri|unity|godot|desktop|3d|webgl|phaser)/],
};

const short = {};
for (const [cat, [label, re]] of Object.entries(CATS)) {
  const cands = Object.values(all)
    .filter((e) => e.cats[cat] && re.test((e.skillId + ' ' + e.name).toLowerCase()))
    .sort((a, b) => b.installs - a.installs)
    .slice(0, 10)
    .map((e) => ({ id: e.id, source: e.source, skillId: e.skillId, name: e.name, installs: e.installs, bestRank: Math.min(...e.cats[cat].map((h) => h.rank)) }));
  short[cat] = { label, cands };
}
fs.writeFileSync(path.join(DIR, 'shortlist2.json'), JSON.stringify(short, null, 1));
const ids = [...new Set(Object.values(short).flatMap((c) => c.cands.map((x) => x.id)))];
console.log('présélection:', ids.length);

const gh = (args) => {
  try { return JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })); }
  catch (e) { return { __error: String(e.stderr || e.message).slice(0, 200) }; }
};

const info = {};
// 1. Fiches skills.sh
for (const id of ids) {
  const e = all[id];
  const rec = (info[id] = { id, source: e.source, skillId: e.skillId, name: e.name, installs: e.installs });
  try {
    const r = await fetch('https://www.skills.sh/' + id, { redirect: 'follow' });
    rec.pageStatus = r.status;
    if (r.ok) {
      const h = await r.text();
      const d = h.match(/<meta name="description" content="([^"]*)"/);
      rec.desc = d ? d[1].replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null;
      rec.audits = {};
      for (const m of h.matchAll(/(Gen Agent Trust Hub|Socket|Snyk|Runlayer|ZeroLeaks)\\"\}\],\[\\"\$\\",\\"span\\",null,\{\\"className\\":\\"[^"]*\\",\\"children\\":\\"(Pass|Warn|Fail)\\"/g)) rec.audits[m[1]] = m[2];
      const fs1 = h.match(/First Seen[^A-Za-z0-9]{0,200}?([A-Z][a-z]{2} \d{1,2}, \d{4})/);
      rec.firstSeen = fs1 ? fs1[1] : null;
    }
  } catch (err) { rec.pageError = String(err).slice(0, 120); }
  await sleep(1300);
}
fs.writeFileSync(path.join(DIR, 'info.json'), JSON.stringify(info, null, 1));
console.log('fiches lues:', Object.values(info).filter((r) => r.pageStatus === 200).length, '/', ids.length);

// 2. Dépôts GitHub
const repos = {};
const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|ps1|pl|php)$/i;
for (const src of [...new Set(ids.map((id) => all[id].source))]) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(src)) { repos[src] = { notGithub: true }; continue; }
  const r = gh(['repos/' + src]);
  if (r.__error) { repos[src] = { error: r.__error }; continue; }
  const t = gh(['repos/' + src + '/git/trees/' + r.default_branch + '?recursive=1']);
  repos[src] = {
    stars: r.stargazers_count, pushedAt: r.pushed_at, license: r.license ? r.license.spdx_id : null, archived: r.archived,
    owner: r.owner.login, ownerType: r.owner.type, branch: r.default_branch, desc: r.description,
    tree: t.__error ? null : t.tree.filter((x) => x.type === 'blob').map((x) => ({ p: x.path, s: x.size })), truncated: !!t.truncated,
  };
}
fs.writeFileSync(path.join(DIR, 'repos.json'), JSON.stringify(Object.fromEntries(Object.entries(repos).map(([k, v]) => [k, { ...v, tree: v.tree ? v.tree.length : null }])), null, 1));
console.log('dépôts lus:', Object.values(repos).filter((r) => r.stars != null).length, '/', Object.keys(repos).length);

// 3. Fichiers du skill (SKILL.md + scripts), enregistrés comme données
let files = 0;
for (const id of ids) {
  const rec = info[id];
  const repo = repos[rec.source];
  if (!repo || !repo.tree) { rec.files = null; continue; }
  const cands = repo.tree.filter((f) => /(^|\/)SKILL\.md$/i.test(f.p));
  const pick = cands.find((f) => f.p.toLowerCase().endsWith('/' + rec.skillId.toLowerCase() + '/skill.md') || f.p.toLowerCase() === rec.skillId.toLowerCase() + '/skill.md')
    || cands.find((f) => f.p.toLowerCase().includes('/' + rec.skillId.toLowerCase() + '/'))
    || (cands.length === 1 ? cands[0] : null);
  if (!pick) { rec.files = []; rec.skillPath = null; continue; }
  const folder = pick.p.replace(/SKILL\.md$/i, '');
  const inFolder = repo.tree.filter((f) => f.p.startsWith(folder));
  rec.skillPath = pick.p;
  rec.fileCount = inFolder.length;
  rec.scripts = inFolder.filter((f) => SCRIPT_EXT.test(f.p)).map((f) => f.p.slice(folder.length));
  rec.otherBinaries = inFolder.filter((f) => /\.(exe|dll|so|dylib|bin|jar|wasm|zip|tar|gz|pkg|dmg)$/i.test(f.p)).map((f) => f.p.slice(folder.length));
  const toGet = [pick, ...inFolder.filter((f) => SCRIPT_EXT.test(f.p) && f.s < 150000).slice(0, 8)];
  const dest = path.join(RAW, id.replace(/[^\w.-]+/g, '__'));
  fs.mkdirSync(dest, { recursive: true });
  rec.files = [];
  for (const f of toGet) {
    try {
      const r = await fetch('https://raw.githubusercontent.com/' + rec.source + '/' + repo.branch + '/' + f.p.split('/').map(encodeURIComponent).join('/'));
      if (!r.ok) continue;
      const txt = await r.text();
      const name = f.p.slice(folder.length).replace(/[^\w.-]+/g, '__') || 'SKILL.md';
      fs.writeFileSync(path.join(dest, name + '.txt'), txt);
      rec.files.push({ rel: f.p.slice(folder.length) || 'SKILL.md', bytes: txt.length, saved: name + '.txt' });
      files++;
    } catch { /* ignoré : noté par l'absence du fichier */ }
    await sleep(120);
  }
}
for (const [src, r] of Object.entries(repos)) delete r.tree;
fs.writeFileSync(path.join(DIR, 'info.json'), JSON.stringify(info, null, 1));
fs.writeFileSync(path.join(DIR, 'repos.json'), JSON.stringify(repos, null, 1));
console.log('fichiers enregistrés:', files, '| skills avec SKILL.md:', Object.values(info).filter((r) => r.files && r.files.length).length, '/', ids.length);
const aud = Object.values(info).filter((r) => r.audits && Object.keys(r.audits).length);
console.log('fiches avec audits:', aud.length, '| avec Warn/Fail:', aud.filter((r) => Object.values(r.audits).some((v) => v !== 'Pass')).length);
