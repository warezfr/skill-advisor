#!/usr/bin/env node
// Catalogue des serveurs MCP : construit catalog/mcp.json à partir de sources publiques, sans compte.
//   - registre officiel MCP (registry.modelcontextprotocol.io, v0.1) : la base ;
//   - GitHub (GraphQL, jeton GITHUB_TOKEN ou GH_TOKEN) : étoiles, dernier envoi, propriétaire, licence, archivage ;
//   - npm (api.npmjs.org) : téléchargements du mois ; registre npm : attestation de provenance ;
//   - catalogue Docker (github.com/docker/mcp-registry, MIT) : serveurs construits et signés par Docker ;
//   - OSV (api.osv.dev) : failles et versions malveillantes connues.
// Note sur 100 : popularité 40, réputation de la source 25, fraîcheur 15, sécurité 20 (comme les skills).
// Usage : node tools/mcp-catalog.mjs [--work <dossier de cache>] [--out catalog/mcp.json] [--max 1200]
// Sans jeton GitHub, les étoiles manquent et la note de popularité ne repose que sur npm et Docker.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, verdict } from './skill-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEIGHTS = { popularite: 40, source: 25, fraicheur: 15, securite: 20 };

// --- Parties pures (testées sans réseau) ---

// Catégories : les 16 types de projet du catalogue des skills, lus dans le nom, le titre et la description.
export const CATS = {
  'site-design': /\b(web ?design|landing page|tailwind|website builder|html|css|shadcn|webflow|framer|wix|squarespace|screenshot)\b/,
  frontend: /\b(react(?!.native)|next\.?js|vue|svelte|astro|nuxt|angular|vite|storybook|front-?end)\b/,
  mobile: /\b(react.native|flutter|swift|ios|android|kotlin|expo|mobile app|xcode|app store|play store|simulator)\b/,
  backend: /\b(backend|fastapi|django|laravel|express|rails|spring boot|graphql|openapi|swagger|grpc|webhooks?|rest api|postman)\b/,
  database: /\b(postgres\w*|mysql|sqlite|mongo\w*|redis|supabase|neon|databases?|sql|prisma|clickhouse|snowflake|bigquery|duckdb|elasticsearch|vector (db|database|store)|pinecone|qdrant)\b/,
  data: /\b(analytics|pandas|excel|csv|spreadsheets?|jupyter|notebooks?|dashboards?|dbt|metabase|tableau|power ?bi|charts?|statistics?|data (analysis|science|pipeline|warehouse))\b/,
  ia: /\b(llms?|rag|embeddings?|openai|anthropic|gemini|hugging ?face|langchain|prompts?|fine-?tun\w*|inference|image generation|speech|transcri\w*)\b/,
  tests: /\b(tests?|testing|playwright|puppeteer|selenium|e2e|qa|debug\w*|sentry|lint\w*|code review|browser automation)\b/,
  devops: /\b(docker|kubernetes|k8s|helm|terraform|deploy\w*|cloudflare|vercel|netlify|aws|azure|gcp|google cloud|devops|ci\/cd|github actions|grafana|datadog|prometheus|observability|monitoring|incident)\b/,
  securite: /\b(security|secure code|owasp|pentest\w*|vulnerabilit\w*|threat|sast|dast|cve|compliance|secret scanning|malware|siem)\b/,
  marketing: /\b(seo|marketing|newsletter|social media|ads|google ads|crm|hubspot|mailchimp|twitter|linkedin|youtube|instagram|email campaigns?|copywriting)\b/,
  documents: /\b(pdf|docx|pptx|word documents?|slides|presentations?|google docs|confluence|ocr|office documents?|markdown conversion)\b/,
  ux: /\b(design systems?|accessib\w*|a11y|wcag|figma|ux|user interface|animation)\b/,
  ecommerce: /\b(shopify|wordpress|stripe|e-?commerce|woocommerce|payments?|paypal|checkout|cms|magento|square)\b/,
  methode: /\b(git|github|gitlab|bitbucket|jira|linear|asana|trello|clickup|project management|issue track\w*|wiki|knowledge base|obsidian|notion)\b/,
  'desktop-jeu': /\b(electron|games?|unity|godot|unreal|blender|3d|desktop app\w*|tauri|webgl|minecraft)\b/,
};
// Texte classé : nom court (sans l'espace de noms), titre, description, sans la mention générique du protocole.
export function catText(e) {
  return [String(e.id || '').split('/').pop(), e.title, e.description].join(' ')
    .replace(/model context protocol|\bmcp\b|\bai (agents?|assistants?)\b/gi, ' ');
}
export function catsOf(text) {
  const t = String(text || '').toLowerCase();
  return Object.keys(CATS).filter((k) => CATS[k].test(t));
}

const SKIP_REMOTE = /(^|\.)smithery\.ai$|(^|\.)run\.tools$/;
const meta = (x) => (x && x._meta && x._meta['io.modelcontextprotocol.registry/official']) || {};

// owner/repo d'une adresse GitHub, sinon null.
export function githubRepo(url) {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(String(url || ''));
  return m ? m[1] + '/' + m[2] : null;
}

// Espace de noms du registre : domaine vérifié (com.stripe/…), compte GitHub vérifié (io.github.<compte>/…).
export function namespaceOf(name) {
  const ns = String(name || '').split('/')[0];
  if (/^io\.github\./i.test(ns)) return { kind: 'github', owner: ns.slice('io.github.'.length) };
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(ns)) return { kind: 'domain', domain: ns.split('.').reverse().join('.') };
  return { kind: 'other' };
}

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const varsOf = (list) => (Array.isArray(list) ? list : []).filter((v) => v && typeof v.name === 'string' && /^[A-Za-z_][\w-]{0,127}$/.test(v.name)).slice(0, 30)
  .map((v) => ({ name: v.name, secret: !!v.isSecret, required: !!v.isRequired, description: clip(v.description, 160) }));

// Installation préférée d'une entrée du registre : paquet npm, PyPI, image Docker, ou serveur distant.
// Toujours une version exacte (jamais latest) ; rend null si rien d'installable proprement.
export function installOf(server) {
  const pk = Array.isArray(server.packages) ? server.packages : [];
  const order = { npm: 0, pypi: 1, oci: 2 };
  const pkg = pk.filter((p) => p && Object.hasOwn(order, p.registryType) && typeof p.identifier === 'string' && p.identifier)
    .filter((p) => !p.transport || !p.transport.type || p.transport.type === 'stdio')
    .sort((a, b) => order[a.registryType] - order[b.registryType])[0];
  if (pkg) {
    const version = String(pkg.version || server.version || '');
    if (!version || /^(latest|\*|x)$/i.test(version)) return null;
    const runtime = pkg.registryType === 'npm' ? 'npx' : pkg.registryType === 'pypi' ? 'uvx' : 'docker';
    const args = (Array.isArray(pkg.packageArguments) ? pkg.packageArguments : []).filter((a) => a && a.type === 'positional' && typeof a.value === 'string').map((a) => a.value).slice(0, 20);
    return { type: pkg.registryType, id: pkg.identifier, version, runtime, env: varsOf(pkg.environmentVariables), args };
  }
  const remote = (Array.isArray(server.remotes) ? server.remotes : []).find((r) => {
    if (!r || typeof r.url !== 'string' || !/^https:\/\//.test(r.url) || /\{/.test(r.url)) return false;
    try { return !SKIP_REMOTE.test(new URL(r.url).hostname); } catch { return false; }
  });
  if (remote) {
    return { type: 'remote', url: remote.url, transport: remote.type === 'sse' ? 'sse' : 'http', headers: varsOf(remote.headers) };
  }
  return null;
}

// Entrées du registre → une par nom, dernière version active, installable.
export function normalize(raw) {
  const out = new Map();
  for (const x of raw) {
    const s = x && x.server;
    const m = meta(x);
    if (!s || typeof s.name !== 'string' || m.status === 'deleted' || m.status === 'deprecated') continue;
    const install = installOf(s);
    if (!install) continue;
    const prev = out.get(s.name);
    if (prev && String(prev.updatedAt) >= String(m.updatedAt || '')) continue;
    out.set(s.name, {
      id: s.name, title: clip(s.title || '', 80), description: clip(s.description, 300), version: String(s.version || ''),
      repo: githubRepo(s.repository && s.repository.url) || null, website: typeof s.websiteUrl === 'string' && /^https:\/\//.test(s.websiteUrl) ? s.websiteUrl : null,
      install, namespace: namespaceOf(s.name), publishedAt: m.publishedAt || null, updatedAt: m.updatedAt || null,
    });
  }
  return [...out.values()];
}

// Candidat à la présélection : un signal de confiance ou de popularité.
// Gabarits et exemples publiés par erreur (« template-server-name », « example-mcp »…) : jamais candidats.
const PLACEHOLDER = /(^|[-_./ ])(template|example|sample|boilerplate|hello[- ]?world|my[- ]?mcp[- ]?server|test[- ]?server)([-_. ]|$)/i;
export function candidate(e, sig) {
  const g = sig.github[e.repo] || {};
  if (g.archived) return false;
  if (PLACEHOLDER.test(e.id.split('/').pop()) || PLACEHOLDER.test(e.title)) return false;
  return (g.stars || 0) >= 50 || (sig.downloads[e.install.id] || 0) >= 2000 || sig.docker.has(e.repo || '') || sig.docker.has(e.install.id)
    || (e.namespace.kind === 'domain' && e.description.length >= 20);
}

// Rang en centile (0 à 1) de v parmi les valeurs triées.
function pct(sorted, v) {
  if (!sorted.length || !v) return 0;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  return lo / sorted.length;
}
const days = (iso, now) => (iso ? (now - Date.parse(iso)) / 864e5 : Infinity);

// Note sur 100 et constatations, pour chaque candidat. now : date de calcul (millisecondes).
export function score(list, sig, now) {
  const stars = list.map((e) => (sig.github[e.repo] || {}).stars || 0).filter(Boolean).sort((a, b) => a - b);
  const dls = list.map((e) => sig.downloads[e.install.id] || 0).filter(Boolean).sort((a, b) => a - b);
  return list.map((e) => {
    const g = sig.github[e.repo] || {};
    const dl = sig.downloads[e.install.id] || 0;
    const docker = sig.docker.has(e.repo || '') || sig.docker.has(e.install.id);
    const pop = Math.max(pct(stars, g.stars || 0), pct(dls, dl), docker ? 0.6 : 0);
    let src = 0;
    if (e.namespace.kind === 'domain') src += 10;
    else if (e.namespace.kind === 'github' && g.owner && e.namespace.owner.toLowerCase() === String(g.owner).toLowerCase()) src += 5;
    if (docker) src += 7;
    if (g.org) src += 4;
    if (g.license) src += 4;
    const fresh = Math.min(days(g.pushedAt, now), days(e.updatedAt, now));
    const fr = fresh <= 90 ? 15 : fresh <= 180 ? 10 : fresh <= 365 ? 5 : 0;
    const findings = scanText(e.title + '\n' + e.description, 'description');
    const v = verdict(findings);
    const vulns = sig.osv[e.install.type + ':' + e.install.id + '@' + e.install.version] || [];
    let sec = 20;
    if (v === 'rouge') sec = 0; else if (v === 'orange') sec -= 8;
    if (vulns.length) sec = Math.max(0, sec - 15);
    if (e.install.type === 'npm' && sig.provenance[e.install.id + '@' + e.install.version] === false) sec -= 3;
    if (e.install.type === 'remote' && e.namespace.kind !== 'domain') sec -= 4;
    sec = Math.max(0, sec);
    const parts = { popularite: Math.round(pop * WEIGHTS.popularite), source: Math.min(WEIGHTS.source, src), fraicheur: fr, securite: sec };
    const total = parts.popularite + parts.source + parts.fraicheur + parts.securite;
    const cats = catsOf(catText(e));
    return {
      ...e, cats, docker, stars: g.stars || null, downloads: dl || null, license: g.license || null, pushedAt: g.pushedAt || null, org: !!g.org,
      provenance: e.install.type === 'npm' ? (sig.provenance[e.install.id + '@' + e.install.version] ?? null) : null,
      vulns, verdict: v, findings: findings.map((f) => f.rule).filter((r, i, l) => l.indexOf(r) === i),
      score: { total, ...parts },
    };
  });
}

// Garde les meilleurs : les max premiers par note, et au moins perCat par catégorie.
export function pick(scored, max = 1200, perCat = 40) {
  const byScore = [...scored].sort((a, b) => b.score.total - a.score.total || (b.stars || 0) - (a.stars || 0) || a.id.localeCompare(b.id));
  const keep = new Set(byScore.slice(0, max).map((e) => e.id));
  for (const c of Object.keys(CATS)) byScore.filter((e) => e.cats.includes(c)).slice(0, perCat).forEach((e) => keep.add(e.id));
  return byScore.filter((e) => keep.has(e.id));
}

// --- Collecte (réseau) ---

const UA = { 'user-agent': 'skill-advisor-catalog (+https://github.com/warezfr/skill-advisor)', accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function getJson(url, opts = {}) {
  for (let i = 0; ; i++) {
    let r;
    try { r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(60000) }); } catch (e) { if (i < 3) { await sleep(2000 * (i + 1)); continue; } throw e; }
    if ((r.status === 429 || r.status >= 500) && i < 4) { await sleep(3000 * (i + 1)); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.json();
  }
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
async function cached(work, name, fn) {
  const f = path.join(work, name);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}

async function registry(work) {
  return cached(work, 'registry.json', async () => {
    const all = [];
    let cursor = null;
    for (let page = 0; page < 5000; page++) {
      const u = new URL('https://registry.modelcontextprotocol.io/v0.1/servers');
      u.searchParams.set('limit', '100');
      u.searchParams.set('version', 'latest');
      if (cursor) u.searchParams.set('cursor', cursor);
      const j = await getJson(u);
      all.push(...(j.servers || []));
      cursor = j.metadata && j.metadata.nextCursor;
      if (page % 50 === 0) console.error('registre : ' + all.length + ' entrées');
      if (!cursor) break;
    }
    return all;
  });
}

export async function github(work, repos, token, file = 'github.json') {
  return cached(work, file, async () => {
    const out = {};
    if (!token) { console.error('GitHub : pas de jeton (GITHUB_TOKEN), étoiles absentes.'); return out; }
    const list = [...repos];
    for (let i = 0; i < list.length; i += 80) {
      const chunk = list.slice(i, i + 80);
      const q = 'query {' + chunk.map((r, k) => {
        const [o, n] = r.split('/');
        return ' r' + k + ': repository(owner: ' + JSON.stringify(o) + ', name: ' + JSON.stringify(n) + ') { stargazerCount pushedAt isArchived licenseInfo { spdxId } owner { login __typename } }';
      }).join('') + ' }';
      // Limite secondaire de GitHub (403) : pause entre les lots, et attente d'une minute avant de reprendre un lot refusé.
      let j = null;
      for (let t = 0; t < 4 && !j; t++) {
        try {
          j = await getJson('https://api.github.com/graphql', { method: 'POST', headers: { authorization: 'bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) });
        } catch (e) {
          if (!/HTTP 403|HTTP 429/.test(e.message) || t === 3) { console.error('GitHub : lot ignoré (' + e.message + ')'); break; }
          console.error('GitHub : limite atteinte, pause d’une minute');
          await sleep(65000);
        }
      }
      await sleep(800);
      if (!j) continue;
      chunk.forEach((r, k) => {
        const d = j.data && j.data['r' + k];
        if (d) out[r] = { stars: d.stargazerCount, pushedAt: d.pushedAt, archived: d.isArchived, license: d.licenseInfo && d.licenseInfo.spdxId !== 'NOASSERTION' ? d.licenseInfo.spdxId : null, owner: d.owner.login, org: d.owner.__typename === 'Organization' };
      });
      if ((i / 80) % 25 === 0) console.error('GitHub : ' + Object.keys(out).length + ' / ' + list.length);
    }
    return out;
  });
}

async function downloads(work, names) {
  return cached(work, 'npm-downloads.json', async () => {
    const out = {};
    const plain = names.filter((n) => !n.startsWith('@')), scoped = names.filter((n) => n.startsWith('@'));
    for (let i = 0; i < plain.length; i += 120) {
      const chunk = plain.slice(i, i + 120);
      try {
        const j = await getJson('https://api.npmjs.org/downloads/point/last-month/' + chunk.join(','));
        if (chunk.length === 1) out[chunk[0]] = (j && j.downloads) || 0;
        else for (const [k, v] of Object.entries(j || {})) out[k] = (v && v.downloads) || 0;
      } catch (e) { console.error('npm : lot ignoré (' + e.message + ')'); }
    }
    await pool(scoped, 8, async (n) => {
      try { const j = await getJson('https://api.npmjs.org/downloads/point/last-month/' + n.replace('/', '%2F')); out[n] = j.downloads || 0; } catch { /* paquet absent */ }
    });
    return out;
  });
}

// Catalogue Docker : dépôts sources et images des serveurs de docker/mcp-registry.
async function docker(work, token) {
  return cached(work, 'docker.json', async () => {
    const headers = token ? { authorization: 'bearer ' + token } : {};
    const tree = await getJson('https://api.github.com/repos/docker/mcp-registry/git/trees/main?recursive=1', { headers });
    const files = (tree.tree || []).map((t) => t.path).filter((p) => /^servers\/[^/]+\/server\.yaml$/.test(p));
    const out = [];
    await pool(files, 8, async (p) => {
      try {
        const r = await fetch('https://raw.githubusercontent.com/docker/mcp-registry/main/' + p, { headers: UA, signal: AbortSignal.timeout(30000) });
        const t = await r.text();
        const src = /^\s*project:\s*(\S+)/m.exec(t);
        const img = /^\s*image:\s*(\S+)/m.exec(t);
        out.push({ repo: githubRepo(src && src[1]), image: img ? img[1] : null });
      } catch { /* fichier illisible */ }
    });
    return out;
  });
}

async function osv(list) {
  const out = {};
  const qs = list.filter((e) => e.install.type === 'npm' || e.install.type === 'pypi')
    .map((e) => ({ key: e.install.type + ':' + e.install.id + '@' + e.install.version, q: { package: { name: e.install.id, ecosystem: e.install.type === 'npm' ? 'npm' : 'PyPI' }, version: e.install.version } }));
  for (let i = 0; i < qs.length; i += 500) {
    const chunk = qs.slice(i, i + 500);
    try {
      const j = await getJson('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: chunk.map((c) => c.q) }) });
      (j.results || []).forEach((r, k) => { const ids = (r.vulns || []).map((v) => v.id); if (ids.length) out[chunk[k].key] = ids.slice(0, 10); });
    } catch (e) { console.error('OSV : lot ignoré (' + e.message + ')'); }
  }
  return out;
}

async function provenance(list) {
  const out = {};
  await pool(list.filter((e) => e.install.type === 'npm'), 8, async (e) => {
    try {
      const j = await getJson('https://registry.npmjs.org/' + e.install.id.replace('/', '%2F') + '/' + encodeURIComponent(e.install.version));
      out[e.install.id + '@' + e.install.version] = !!(j.dist && j.dist.attestations);
    } catch { /* version absente */ }
  });
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const work = path.resolve(opt('--work', path.join(ROOT, '.cache', 'mcp-catalog')));
  const outFile = path.resolve(opt('--out', path.join(ROOT, 'catalog', 'mcp.json')));
  const max = Number(opt('--max', 1200));
  fs.mkdirSync(work, { recursive: true });
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const now = Date.now();

  const raw = await registry(work);
  const entries = normalize(raw);
  console.error('installables : ' + entries.length + ' sur ' + raw.length + ' entrées');
  const gh = await github(work, new Set(entries.map((e) => e.repo).filter(Boolean)), token);
  // Téléchargements npm : seulement pour les paquets d'un dépôt un peu suivi, ou d'un domaine vérifié.
  const npmNames = [...new Set(entries.filter((e) => e.install.type === 'npm' && ((gh[e.repo] || {}).stars >= 10 || e.namespace.kind === 'domain')).map((e) => e.install.id))];
  const dl = await downloads(work, npmNames);
  const dk = await docker(work, token);
  // Catalogue Docker : par image, ou par dépôt seulement s'il ne porte qu'un ou deux serveurs du registre
  // (un dépôt qui en porte des dizaines, comme microsoft/mcp, ne dit rien de chacun).
  const perRepo = {};
  for (const e of entries) if (e.repo) perRepo[e.repo] = (perRepo[e.repo] || 0) + 1;
  const dockerSet = new Set(dk.flatMap((d) => [d.repo && (perRepo[d.repo] || 0) <= 2 ? d.repo : null, d.image]).filter(Boolean));
  const sig = { github: gh, downloads: dl, docker: dockerSet, osv: {}, provenance: {} };
  const cands = entries.filter((e) => candidate(e, sig));
  console.error('candidats : ' + cands.length);
  // OSV et provenance sur une présélection, puis note définitive.
  const pre = pick(score(cands, sig, now), Math.round(max * 1.5), 60);
  sig.osv = await osv(pre);
  sig.provenance = await provenance(pre);
  const final = pick(score(pre, sig, now), max, 40);
  const cats = Object.keys(CATS).map((c) => ({ id: c, count: final.filter((e) => e.cats.includes(c)).length }));
  const doc = {
    generatedAt: new Date(now).toISOString(), kind: 'mcp', weights: WEIGHTS,
    sources: ['registry.modelcontextprotocol.io (v0.1)', 'GitHub GraphQL', 'api.npmjs.org', 'github.com/docker/mcp-registry', 'api.osv.dev'],
    counts: { registry: raw.length, installable: entries.length, candidates: cands.length, servers: final.length, github: Object.keys(gh).length },
    categories: cats,
    servers: final.map(({ namespace, ...e }) => ({ ...e, verified: namespace.kind === 'domain' ? 'domain' : namespace.kind === 'github' ? 'github' : null })),
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(doc) + '\n');
  console.error('écrit : ' + path.relative(ROOT, outFile) + ' (' + final.length + ' serveurs, ' + Math.round(fs.statSync(outFile).size / 1024) + ' Ko)');
  const demo = path.resolve(opt('--demo', path.join(ROOT, 'prototype', 'src', 'mcp-catalog-data.js')));
  fs.writeFileSync(demo, demoData(doc));
  console.error('écrit : ' + path.relative(ROOT, demo));
}

// Extrait du catalogue pour la page (démo et premier affichage) : les 60 mieux notés, sans les constatations détaillées.
export function demoData(doc, n = 60) {
  const servers = doc.servers.slice(0, n).map((s) => ({
    id: s.id, title: s.title, description: s.description, version: s.version, repo: s.repo, website: s.website, install: s.install,
    cats: s.cats, docker: s.docker, stars: s.stars, downloads: s.downloads, verified: s.verified, verdict: s.verdict, vulns: s.vulns, score: s.score,
  }));
  const data = { generatedAt: doc.generatedAt, counts: doc.counts, sample: true, servers };
  return '/* Extrait du catalogue MCP (catalog/mcp.json). Fichier généré par tools/mcp-catalog.mjs : ne pas modifier à la main. */\n' +
    '(function () {\n  window.SA = window.SA || {};\n  window.SA.mcpCatalog = ' + JSON.stringify(data) + ';\n})();\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('Échec : ' + (e && e.message)); process.exit(1); });
}
