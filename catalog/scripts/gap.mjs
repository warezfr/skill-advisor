// Seconde passe : recherches complémentaires pour les technologies absentes, puis enrichissement des meilleurs résultats.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from "node:url";
import { execFileSync } from 'node:child_process';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(DIR, 'skills-raw');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const all = JSON.parse(fs.readFileSync(path.join(DIR, 'search-all.json'), 'utf8'));
const info = JSON.parse(fs.readFileSync(path.join(DIR, 'info.json'), 'utf8'));
const repos = JSON.parse(fs.readFileSync(path.join(DIR, 'repos.json'), 'utf8'));

const EXTRA = ['rust', 'java spring boot', 'dotnet csharp', 'ruby on rails', 'python', 'typescript', 'angular', 'nuxt', 'mongodb', 'redis', 'aws', 'jupyter notebook', 'scientific research', 'wcag accessibility audit', 'threat model', 'ai sdk', 'langchain', 'nestjs', 'helm', 'docs writer', 'swift', 'kotlin', 'svelte', 'security audit'];
for (const q of process.env.IDS_FILE ? [] : EXTRA) {
  try {
    const r = await fetch('https://skills.sh/api/search?q=' + encodeURIComponent(q) + '&limit=30');
    if (r.ok) for (const [rank, s] of ((await r.json()).skills || []).entries()) {
      const e = (all[s.id] ||= { id: s.id, source: s.source, skillId: s.skillId, name: s.name, installs: s.installs, cats: {} });
      (e.cats.extra ||= []).push({ q, rank });
    }
  } catch { /* ignoré */ }
  await sleep(1200);
}
fs.writeFileSync(path.join(DIR, 'search-all.json'), JSON.stringify(all));

// mot-clé -> catégorie. On prend les 2 skills les plus installés dont le nom correspond.
const GAPS = [
  ['mobile', /swift/], ['mobile', /kotlin|android/],
  ['frontend', /svelte/], ['frontend', /astro(?!n)/], ['frontend', /angular/], ['frontend', /nuxt/], ['frontend', /typescript/],
  ['backend', /django/], ['backend', /fastapi/], ['backend', /laravel/], ['backend', /rails/], ['backend', /spring|java(?!script)/], ['backend', /rust/], ['backend', /python/], ['backend', /dotnet|csharp/], ['backend', /nestjs|nest-/],
  ['database', /postgres/], ['database', /mongo/], ['database', /drizzle/], ['database', /redis/],
  ['data', /pandas/], ['data', /jupyter|notebook/], ['data', /^sql|sql-|analytics/], ['data', /statistic|scientific/], ['data', /bigquery|dbt/],
  ['devops', /docker/], ['devops', /kubernetes|k8s|helm/], ['devops', /terraform/], ['devops', /github-actions|ci-cd/], ['devops', /^aws|aws-/], ['devops', /vercel-deploy|deploy-to-vercel/],
  ['securite', /security-audit/], ['securite', /owasp/], ['securite', /threat/],
  ['ux', /accessib|a11y|wcag/], ['ux', /design-system/],
  ['ecommerce', /wordpress|^wp-/], ['ecommerce', /woocommerce/], ['ecommerce', /stripe/],
  ['methode', /^git-|git-workflow|commit/], ['methode', /writing-plans|planning|^plan/], ['methode', /documentation|docs-|doc-coauthor/],
  ['desktop-jeu', /electron/], ['desktop-jeu', /godot/], ['desktop-jeu', /unity/],
  ['ia', /ai-sdk/], ['ia', /langchain|langgraph/],
  ['marketing', /^seo|seo-/],
];
const gapPicks = {};
for (const [cat, re] of GAPS) {
  const top = Object.values(all).filter((e) => re.test(e.skillId.toLowerCase()) && /^[\w.-]+\/[\w.-]+$/.test(e.source)).sort((a, b) => b.installs - a.installs).slice(0, 2);
  for (const e of top) (gapPicks[cat] ||= []).push(e.id);
}
fs.writeFileSync(path.join(DIR, 'gap-picks.json'), JSON.stringify(gapPicks, null, 1));
const ids = (process.env.IDS_FILE ? JSON.parse(fs.readFileSync(process.env.IDS_FILE, 'utf8')) : [...new Set(Object.values(gapPicks).flat())]).filter((id) => !info[id] && all[id]);
console.log('nouveaux skills à enrichir:', ids.length);

const gh = (args) => {
  try { return JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })); }
  catch (e) { return { __error: String(e.stderr || e.message).slice(0, 200) }; }
};
const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|ps1|pl|php)$/i;

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
    }
  } catch (err) { rec.pageError = String(err).slice(0, 120); }
  await sleep(1300);
}
const trees = {};
for (const src of [...new Set(ids.map((id) => all[id].source))]) {
  let r = repos[src];
  if (!r || r.stars == null) {
    const g = gh(['repos/' + src]);
    if (g.__error) { repos[src] = { error: g.__error }; continue; }
    r = repos[src] = { stars: g.stargazers_count, pushedAt: g.pushed_at, license: g.license ? g.license.spdx_id : null, archived: g.archived, owner: g.owner.login, ownerType: g.owner.type, branch: g.default_branch, desc: g.description };
  }
  const t = gh(['repos/' + src + '/git/trees/' + r.branch + '?recursive=1']);
  trees[src] = t.__error ? null : t.tree.filter((x) => x.type === 'blob').map((x) => ({ p: x.path, s: x.size }));
}
for (const id of ids) {
  const rec = info[id];
  const repo = repos[rec.source];
  const tree = trees[rec.source];
  if (!repo || !tree) { rec.files = null; continue; }
  const cands = tree.filter((f) => /(^|\/)SKILL\.md$/i.test(f.p));
  const sid = rec.skillId.toLowerCase();
  let pick = cands.find((f) => f.p.toLowerCase().endsWith('/' + sid + '/skill.md') || f.p.toLowerCase() === sid + '/skill.md') || cands.find((f) => f.p.toLowerCase().includes('/' + sid + '/')) || (cands.length === 1 ? cands[0] : null);
  if (!pick && cands.length <= 60) {
    // Le dossier ne porte pas le nom du skill : on le retrouve par le champ name du frontmatter.
    for (const f of cands) {
      try {
        const t = await (await fetch('https://raw.githubusercontent.com/' + rec.source + '/' + repo.branch + '/' + f.p.split('/').map(encodeURIComponent).join('/'))).text();
        const m = t.match(/^name:\s*["']?([^"'\n]+)/m);
        if (m && [sid, String(rec.name).toLowerCase()].includes(m[1].trim().toLowerCase())) { pick = f; break; }
      } catch { /* ignoré */ }
    }
  }
  if (!pick) { rec.files = []; rec.skillPath = null; continue; }
  const folder = pick.p.replace(/SKILL\.md$/i, '');
  const inFolder = tree.filter((f) => f.p.startsWith(folder));
  rec.skillPath = pick.p;
  rec.fileCount = inFolder.length;
  rec.scripts = inFolder.filter((f) => SCRIPT_EXT.test(f.p)).map((f) => f.p.slice(folder.length));
  rec.otherBinaries = inFolder.filter((f) => /\.(exe|dll|so|dylib|bin|jar|wasm|zip|tar|gz|pkg|dmg)$/i.test(f.p)).map((f) => f.p.slice(folder.length));
  const dest = path.join(RAW, id.replace(/[^\w.-]+/g, '__'));
  fs.mkdirSync(dest, { recursive: true });
  rec.files = [];
  for (const f of [pick, ...inFolder.filter((x) => SCRIPT_EXT.test(x.p) && x.s < 150000).slice(0, 8)]) {
    try {
      const r = await fetch('https://raw.githubusercontent.com/' + rec.source + '/' + repo.branch + '/' + f.p.split('/').map(encodeURIComponent).join('/'));
      if (!r.ok) continue;
      const txt = await r.text();
      const name = f.p.slice(folder.length).replace(/[^\w.-]+/g, '__') || 'SKILL.md';
      fs.writeFileSync(path.join(dest, name + '.txt'), txt);
      rec.files.push({ rel: f.p.slice(folder.length) || 'SKILL.md', bytes: txt.length, saved: name + '.txt' });
    } catch { /* ignoré */ }
    await sleep(120);
  }
}
fs.writeFileSync(path.join(DIR, 'info.json'), JSON.stringify(info, null, 1));
fs.writeFileSync(path.join(DIR, 'repos.json'), JSON.stringify(repos, null, 1));
console.log('total fiches:', Object.keys(info).length, '| dépôts:', Object.keys(repos).length);
const K = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
const A = (a) => (!a || !Object.keys(a).length ? '—' : ['Gen Agent Trust Hub', 'Socket', 'Snyk'].map((p) => (a[p] ? a[p][0] : '·')).join(''));
for (const [cat, list] of Object.entries(gapPicks)) {
  console.log('\n## ' + cat);
  for (const id of list) { const r = info[id] || {}; const rp = repos[r.source] || {}; console.log([String(r.name).slice(0, 36).padEnd(36), String(r.source).slice(0, 30).padEnd(30), K(r.installs || 0).padStart(5), (rp.stars != null ? K(rp.stars) : '?').padStart(5), (rp.pushedAt || '').slice(0, 7), A(r.audits), (r.desc || '').slice(0, 80)].join(' | ')); }
}
