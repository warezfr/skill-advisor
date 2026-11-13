// Collecte : recherche skills.sh par type de projet. Lecture seule, 1 requête toutes les 1,2 s.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from "node:url";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CATS = [
  ['site-design', 'Sites web et design d’interface', ['frontend design', 'landing page design', 'web design guidelines', 'tailwind css', 'ui ux design']],
  ['frontend', 'Frameworks front (React, Next.js, Vue…)', ['react best practices', 'next.js', 'vue', 'svelte', 'astro']],
  ['mobile', 'Applications mobiles', ['react native', 'flutter', 'swiftui ios', 'android kotlin', 'expo mobile app']],
  ['backend', 'Backend et API', ['api design', 'node backend', 'python fastapi', 'django', 'laravel php', 'golang']],
  ['database', 'Bases de données', ['postgres', 'database schema design', 'supabase', 'prisma', 'sql optimization']],
  ['data', 'Analyse de données', ['data analysis', 'pandas data science', 'excel spreadsheet analysis', 'data visualization charts', 'sql analytics']],
  ['ia', 'IA, agents et LLM', ['ai agent development', 'mcp server', 'prompt engineering', 'rag llm', 'claude api']],
  ['tests', 'Tests, revue et débogage', ['testing', 'playwright e2e', 'test driven development', 'code review', 'debugging']],
  ['devops', 'DevOps et déploiement', ['docker', 'kubernetes', 'github actions ci cd', 'terraform', 'cloudflare deploy']],
  ['securite', 'Sécurité', ['security review', 'security audit', 'owasp', 'secrets detection']],
  ['marketing', 'SEO, marketing et contenu', ['seo', 'copywriting', 'marketing strategy', 'content strategy', 'email marketing']],
  ['documents', 'Documents bureautiques', ['pdf', 'docx word document', 'pptx presentation slides', 'xlsx excel']],
  ['ux', 'Design system, accessibilité, animation', ['design system', 'accessibility', 'animation motion', 'figma']],
  ['ecommerce', 'E-commerce, CMS et paiement', ['shopify', 'wordpress', 'stripe payments', 'ecommerce']],
  ['methode', 'Méthode de travail (plan, git, docs)', ['git workflow', 'documentation writing', 'project planning', 'brainstorming', 'find skills']],
  ['desktop-jeu', 'Bureau, jeux et 3D', ['electron desktop app', 'game development', 'three.js 3d', 'tauri']],
];

const all = {}; // id -> {id, source, skillId, name, installs, cats:{cat:[{q,rank}]}}
const log = [];
for (const [cat, label, queries] of CATS) {
  for (const q of queries) {
    const url = 'https://skills.sh/api/search?q=' + encodeURIComponent(q) + '&limit=30';
    let res;
    try {
      const r = await fetch(url);
      if (!r.ok) { log.push({ cat, q, status: r.status }); await sleep(3000); continue; }
      res = await r.json();
    } catch (e) { log.push({ cat, q, error: String(e) }); await sleep(3000); continue; }
    const skills = res.skills || [];
    log.push({ cat, q, n: skills.length, type: res.searchType });
    skills.forEach((s, rank) => {
      const e = (all[s.id] ||= { id: s.id, source: s.source, skillId: s.skillId, name: s.name, installs: s.installs, cats: {} });
      (e.cats[cat] ||= []).push({ q, rank });
    });
    await sleep(1200);
  }
}

// Présélection : par catégorie, on garde ce qui sort dans les 12 premiers résultats d'au moins une requête,
// puis on classe par installations et on garde 12 candidats.
const short = {};
for (const [cat, label] of CATS) {
  const cands = Object.values(all)
    .filter((e) => e.cats[cat] && e.cats[cat].some((h) => h.rank < 12))
    .sort((a, b) => b.installs - a.installs)
    .slice(0, 12)
    .map((e) => ({ id: e.id, source: e.source, skillId: e.skillId, name: e.name, installs: e.installs, hits: e.cats[cat] }));
  short[cat] = { label, cands };
}

fs.writeFileSync(path.join(OUT, 'search-all.json'), JSON.stringify(all));
fs.writeFileSync(path.join(OUT, 'shortlist.json'), JSON.stringify(short, null, 1));
fs.writeFileSync(path.join(OUT, 'search-log.json'), JSON.stringify(log, null, 1));
const uniq = new Set(Object.values(short).flatMap((c) => c.cands.map((x) => x.id)));
console.log('requêtes:', log.length, '| échecs:', log.filter((l) => l.status || l.error).length, '| skills vus:', Object.keys(all).length, '| présélection unique:', uniq.size);
for (const [cat, v] of Object.entries(short)) console.log(cat.padEnd(12), v.cands.slice(0, 5).map((c) => c.name + ' ' + c.installs).join(' | '));
