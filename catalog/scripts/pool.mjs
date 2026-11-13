// Élargit la présélection : par catégorie, les 24 skills les plus installés dont le nom correspond au sujet.
// Écrit pool.json (catégorie -> ids) et pool-ids.json (ids pas encore enrichis).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const all = JSON.parse(fs.readFileSync(path.join(DIR, 'search-all.json'), 'utf8'));
const info = JSON.parse(fs.readFileSync(path.join(DIR, 'info.json'), 'utf8'));
const CATS = {
  'site-design': /(frontend-design|web-design|landing|tailwind|ui-ux|design-taste|visual-design|website|html|css|shadcn|webflow|framer|web-interface|interface-design|ui-design)/,
  frontend: /(react(?!-native)|next|vue|svelte|astro|nuxt|angular|remix|vite|typescript)/,
  mobile: /(react-native|flutter|swift|ios|android|kotlin|expo|mobile)/,
  backend: /(api|backend|fastapi|django|laravel|golang|node|nest|express|rails|spring|python|php|rust|java(?!script)|dotnet|csharp)/,
  database: /(postgres|database|supabase|prisma|sql|mongo|redis|drizzle|schema|neon)/,
  data: /(data|pandas|excel|xlsx|csv|chart|visualiz|analytics|statistic|jupyter|notebook|bigquery|dashboard|dbt|scientific)/,
  ia: /(agent|mcp|prompt|rag|llm|claude|openai|ai-sdk|eval|langchain|langgraph)/,
  tests: /(test|tdd|playwright|e2e|review|debug|qa|cypress|vitest|jest)/,
  devops: /(docker|kubernetes|k8s|helm|github-actions|terraform|deploy|cloudflare|wrangler|vercel|aws|azure|gcp|devops|infra|ci-cd)/,
  securite: /(secur|owasp|secret|pentest|vuln|auth|compliance|threat)/,
  marketing: /(seo|copy|marketing|content|email|brand|social|ads|growth|newsletter)/,
  documents: /(pdf|docx|pptx|xlsx|word|slides|presentation|document|excel)/,
  ux: /(design-system|accessib|a11y|wcag|animation|motion|figma|ux|typograph|color)/,
  ecommerce: /(shopify|wordpress|stripe|ecommerce|e-commerce|woocommerce|payment|cms|commerce)/,
  methode: /(git|doc|plan|brainstorm|find-skills|writing|workflow|commit|spec|research|skill-creator|architecture|handoff)/,
  'desktop-jeu': /(electron|game|three|tauri|unity|godot|desktop|3d|webgl|phaser)/,
};
const pool = {};
for (const [cat, re] of Object.entries(CATS)) {
  pool[cat] = Object.values(all)
    .filter((e) => /^[\w.-]+\/[\w.-]+$/.test(e.source) && re.test((e.skillId + ' ' + e.name).toLowerCase()) && (e.cats[cat] || e.cats.extra))
    .sort((a, b) => b.installs - a.installs).slice(0, 24).map((e) => e.id);
}
const ids = [...new Set(Object.values(pool).flat())].filter((id) => !info[id]);
fs.writeFileSync(path.join(DIR, 'pool.json'), JSON.stringify(pool, null, 1));
fs.writeFileSync(path.join(DIR, 'pool-ids.json'), JSON.stringify(ids));
console.log('pool:', Object.entries(pool).map(([k, v]) => k + ' ' + v.length).join(' · '));
console.log('à enrichir:', ids.length);
