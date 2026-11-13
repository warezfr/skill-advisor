// Skill Advisor prototype build: concatenates src/ into dist/page.html (publishable
// fragment) and dist/preview.html (full document). Node only, no dependencies.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');

const FONTS = 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap';

const CSS = ['shell.css', 'views/wizard-a.css', 'views/wizard-b.css', 'views/recherche.css', 'views/v2.css'];
const JS = [
  'data.js', 'search-data.js', 'file-data.js', 'reco.js', 'machine-data.js', 'core.js', 'views/detail.js',
  'views/accueil.js', 'views/objectif.js', 'views/questions.js', 'views/resultats.js', 'views/confirmation.js',
  'views/guide.js', 'views/gestion.js', 'views/recherche.js', 'views/agents.js'
];
const REQUIRED = new Set(['index.html', 'shell.css', 'core.js']);

const missing = [];
function read(rel) {
  const p = join(src, rel);
  if (!existsSync(p)) {
    if (REQUIRED.has(rel)) throw new Error(`Fichier requis absent : src/${rel}`);
    missing.push(rel);
    console.warn(`[build] attention : src/${rel} absent, ignoré`);
    return '';
  }
  return readFileSync(p, 'utf8');
}

const markup = read('index.html').trim();
const css = CSS.map((f) => {
  const s = read(f);
  return s ? `/* ---- ${f} ---- */\n${s.trim()}\n` : '';
}).join('\n').replace(/<\/style/gi, '<\\/style');
const js = JS.map((f) => {
  const s = read(f);
  return s ? `/* ---- ${f} ---- */\n${s.trim()}\n` : '';
}).join('\n').replace(/<\/script/gi, '<\\/script');

const head = [
  '<title>Skill Advisor Prototype</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  `<link rel="stylesheet" href="${FONTS}">`,
  `<style>\n${css}</style>`
].join('\n');
const body = `${markup}\n<script>\n${js}\nif (window.SA && typeof SA.start === 'function') SA.start();\n</script>`;

const page = `${head}\n${body}\n`;
const preview = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>html{color-scheme:light} body{margin:0;font:14px system-ui} img{max-width:100%} [hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}
</body>
</html>
`;

mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'page.html'), page);
writeFileSync(join(dist, 'preview.html'), preview);
const kb = (n) => (Buffer.byteLength(n) / 1024).toFixed(1);
console.log(`[build] dist/page.html ${kb(page)} Ko · dist/preview.html ${kb(preview)} Ko${missing.length ? ` · ${missing.length} fichier(s) ignoré(s)` : ''}`);
