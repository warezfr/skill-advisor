#!/usr/bin/env node
// Catalogue des plugins : construit catalog/plugins.json depuis les places de marché ouvertes que les agents lisent par défaut.
//   - anthropics/claude-plugins-official (Claude Code, Apache-2.0) : installation « claude plugin install <nom>@claude-plugins-official » ;
//   - github/awesome-copilot et github/copilot-plugins (Copilot CLI, MIT) : « copilot plugin install <nom>@<place> ».
// Signaux : dépôt source (étoiles, dernier envoi, licence par GitHub GraphQL), éditeur, version épinglée (sha), description contrôlée.
// Note sur 100 : popularité 40, réputation 25, fraîcheur 15, sécurité 20 (comme les skills et les serveurs MCP).
// Usage : node tools/plugin-catalog.mjs [--work <cache>] [--out catalog/plugins.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, verdict } from './skill-scan.mjs';
import { catsOf, getJson, github, githubRepo, WEIGHTS } from './mcp-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MARKETS = [
  { id: 'claude-plugins-official', agent: 'claude-code', repo: 'anthropics/claude-plugins-official', file: '.claude-plugin/marketplace.json' },
  { id: 'awesome-copilot', agent: 'github-copilot', repo: 'github/awesome-copilot', file: '.github/plugin/marketplace.json' },
  { id: 'copilot-plugins', agent: 'github-copilot', repo: 'github/copilot-plugins', file: '.github/plugin/marketplace.json' },
];

// Catégories des places de marché → types de projet (complétés par les mots de la description).
const CAT_MAP = { security: ['securite'], design: ['ux', 'site-design'], database: ['database'], monitoring: ['devops'], deployment: ['devops'], testing: ['tests'],
  productivity: ['methode'], automation: ['methode'], migration: ['backend'], learning: ['methode'] };
// Éditeurs reconnus (organisations qui publient leurs propres plugins).
const KNOWN = /^(anthropic|github|microsoft|google( llc)?|amazon web services|aws|sap se|grafana|stripe|vercel|cloudflare|atlassian|figma|sentry|supabase|notion|linear|mongodb|neon|salesforce)$/i;

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

// Entrée d'une place de marché → forme du catalogue (sans signaux GitHub). null si inutilisable.
export function normalize(p, market) {
  if (!p || typeof p.name !== 'string' || !NAME_RE.test(p.name)) return null;
  const src = p.source;
  let repo = null, pinned = false, internal = false;
  if (typeof src === 'string') { internal = true; repo = market.repo; }
  else if (src && typeof src === 'object') {
    repo = githubRepo(src.url || src.repo && 'https://github.com/' + src.repo || '') || (typeof src.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(src.repo) ? src.repo : null);
    pinned = typeof src.sha === 'string' && /^[0-9a-f]{40}$/.test(src.sha);
    if (src.source === 'command') return null;
  }
  repo = repo || githubRepo(p.repository) || githubRepo(p.homepage);
  const author = p.author && typeof p.author === 'object' ? p.author.name : typeof p.author === 'string' ? p.author : null;
  const text = p.name + ' ' + (p.displayName || '') + ' ' + (p.description || '') + ' ' + (Array.isArray(p.keywords) ? p.keywords.join(' ') : '');
  const cats = [...new Set([...(CAT_MAP[p.category] || []), ...catsOf(text)])];
  return {
    id: p.name + '@' + market.id, name: p.name, market: market.id, agent: market.agent, title: clip(p.displayName || p.name, 80), description: clip(p.description, 300),
    author: author ? clip(author, 80) : null, category: typeof p.category === 'string' ? p.category : null, cats,
    homepage: typeof p.homepage === 'string' && /^https:\/\//.test(p.homepage) ? p.homepage : null, repo, pinned, internal,
    version: typeof p.version === 'string' ? clip(p.version, 40) : null,
  };
}

const days = (iso, now) => (iso ? (now - Date.parse(iso)) / 864e5 : Infinity);
function pct(sorted, v) {
  if (!sorted.length || !v) return 0;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  return lo / sorted.length;
}

// Note sur 100. gh : informations GitHub par dépôt. Un plugin interne à la place de marché ne reprend pas les étoiles
// du dépôt de la place (elles ne disent rien de lui) : popularité fixée à 60 %.
export function score(list, gh, now) {
  const stars = [...new Set(list.filter((e) => !e.internal).map((e) => e.repo))].map((r) => (gh[r] || {}).stars || 0).filter(Boolean).sort((a, b) => a - b);
  return list.map((e) => {
    const g = gh[e.repo] || {};
    const pop = e.internal ? 0.6 : pct(stars, g.stars || 0);
    let src = 10;
    if (e.author && KNOWN.test(e.author.trim())) src += 8;
    if (g.license || e.internal) src += 4;
    if (e.pinned || e.internal) src += 3;
    const fresh = days(g.pushedAt, now);
    const fr = fresh <= 90 ? 15 : fresh <= 180 ? 10 : fresh <= 365 ? 5 : 0;
    const findings = scanText(e.title + '\n' + e.description, 'description');
    const v = verdict(findings);
    let sec = v === 'rouge' ? 0 : v === 'orange' ? 12 : 20;
    if (!e.internal && !e.pinned) sec = Math.max(0, sec - 5);
    if (g.archived) sec = Math.max(0, sec - 10);
    const parts = { popularite: Math.round(pop * WEIGHTS.popularite), source: Math.min(WEIGHTS.source, src), fraicheur: e.internal ? 10 : fr, securite: sec };
    return { ...e, stars: e.internal ? null : g.stars || null, pushedAt: g.pushedAt || null, license: g.license || null, archived: !!g.archived,
      verdict: v, findings: findings.map((f) => f.rule).filter((r, i, l) => l.indexOf(r) === i),
      score: { total: parts.popularite + parts.source + parts.fraicheur + parts.securite, ...parts } };
  }).sort((a, b) => b.score.total - a.score.total || a.id.localeCompare(b.id));
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const work = path.resolve(opt('--work', path.join(ROOT, '.cache', 'plugin-catalog')));
  const outFile = path.resolve(opt('--out', path.join(ROOT, 'catalog', 'plugins.json')));
  fs.mkdirSync(work, { recursive: true });
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const now = Date.now();
  const all = [];
  for (const m of MARKETS) {
    const j = await getJson('https://raw.githubusercontent.com/' + m.repo + '/main/' + m.file);
    const list = (Array.isArray(j.plugins) ? j.plugins : []).map((p) => normalize(p, m)).filter(Boolean);
    console.error(m.id + ' : ' + list.length + ' plugins');
    all.push(...list);
  }
  const gh = await github(work, new Set(all.map((e) => e.repo).filter(Boolean)), token, 'github-plugins.json');
  const scored = score(all, gh, now);
  const doc = {
    generatedAt: new Date(now).toISOString(), kind: 'plugin', weights: WEIGHTS, markets: MARKETS.map((m) => ({ id: m.id, agent: m.agent, repo: m.repo })),
    counts: { plugins: scored.length, byMarket: Object.fromEntries(MARKETS.map((m) => [m.id, scored.filter((e) => e.market === m.id).length])) },
    plugins: scored,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(doc) + '\n');
  console.error('écrit : ' + path.relative(ROOT, outFile) + ' (' + scored.length + ' plugins, ' + Math.round(fs.statSync(outFile).size / 1024) + ' Ko)');
  const demo = path.resolve(opt('--demo', path.join(ROOT, 'prototype', 'src', 'plugin-catalog-data.js')));
  fs.writeFileSync(demo, demoData(doc));
  console.error('écrit : ' + path.relative(ROOT, demo));
}

// Extrait pour la page (démo et premier affichage) : les 60 mieux notés.
export function demoData(doc, n = 60) {
  const keep = ['id', 'name', 'market', 'agent', 'title', 'description', 'author', 'cats', 'homepage', 'repo', 'stars', 'verdict', 'score', 'internal', 'pinned'];
  const plugins = doc.plugins.slice(0, n).map((p) => Object.fromEntries(keep.map((k) => [k, p[k] === undefined ? null : p[k]])));
  return '/* Extrait du catalogue des plugins (catalog/plugins.json). Fichier généré par tools/plugin-catalog.mjs : ne pas modifier à la main. */\n' +
    '(function () {\n  window.SA = window.SA || {};\n  window.SA.pluginCatalog = ' + JSON.stringify({ generatedAt: doc.generatedAt, counts: doc.counts, sample: true, plugins }) + ';\n})();\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('Échec : ' + (e && e.message)); process.exit(1); });
}
