// Skill Advisor build: concatenates src/ into dist/page.html (publishable
// fragment) and dist/preview.html (full document). Node only, no dependencies.
// Usage : node prototype/build.mjs [--src <dossier>] [--out <dossier>]
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

const FONTS = 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap';

const CSS = ['shell.css', 'views/wizard-a.css', 'views/wizard-b.css', 'views/recherche.css', 'views/v2.css', 'views/agents.css', 'views/sauvegardes.css', 'views/mcp.css'];
const JS = [
  'data.js', 'search-data.js', 'mcp-catalog-data.js', 'plugin-catalog-data.js', 'file-data.js', 'reco.js', 'machine-data.js', 'live.js', 'core.js', 'views/detail.js',
  'views/accueil.js', 'views/objectif.js', 'views/questions.js', 'views/resultats.js', 'views/confirmation.js',
  'views/guide.js', 'views/gestion.js', 'views/sauvegardes.js', 'views/recherche.js', 'views/agents.js', 'views/mcp.js', 'views/plugins.js'
];
const REQUIRED = new Set(['index.html', 'shell.css', 'core.js']);

// Icône de l'onglet : la règle du logo, quatre barres aux poids de la note (40, 25, 15, 20).
const ICON_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<rect x='0' y='10' width='11.5' height='12' rx='1' fill='#0F3A8A'/>" +
  "<rect x='12.5' y='10' width='7' height='12' rx='1' fill='#1F5FD1'/>" +
  "<rect x='20.5' y='10' width='4.5' height='12' rx='1' fill='#6F9BEA'/>" +
  "<rect x='26' y='10' width='6' height='12' rx='1' fill='#B5CBF3'/></svg>";
export const ICON = 'data:image/svg+xml,' + encodeURIComponent(ICON_SVG);

// Thème choisi (localStorage, clé sa-theme), appliqué avant les styles : pas d'éclair au premier affichage.
const THEME = "<script>try{var t=window.localStorage&&localStorage.getItem('sa-theme');" +
  "if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>";

// En mode réel (window.SA_LIVE), l'interface démarre une fois l'état de la machine lu ; sinon tout de suite.
export const BOOT = [
  "if (window.SA && typeof SA.start === 'function') {",
  '  if (SA.live && SA.live.ready) SA.live.ready.then(function (ok) { if (ok) SA.start(); });',
  '  else SA.start();',
  '}'
].join('\n');

// Rend les deux pages en mémoire, sans rien écrire. opts.src : dossier des sources (par défaut prototype/src).
export function render(opts = {}) {
  const src = opts.src || join(root, 'src');
  const missing = [];
  function read(rel) {
    const p = join(src, rel);
    if (!existsSync(p)) {
      if (REQUIRED.has(rel)) throw new Error(`Fichier requis absent : src/${rel}`);
      missing.push(rel);
      console.warn(`[build] attention : src/${rel} absent, ignoré`);
      return '';
    }
    // Fins de ligne en LF, quelles que soient celles du checkout (Git pour Windows : CRLF).
    return readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
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
    '<title>Skill Advisor</title>',
    `<link rel="icon" href="${ICON}">`,
    THEME,
    '<meta name="claude:viewport-fit-sides" content="cover">',
    `<link rel="stylesheet" href="${FONTS}">`,
    `<style>\n${css}</style>`
  ].join('\n');
  const body = `${markup}\n<script>\n${js}\n${BOOT}\n</script>`;

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
  return { page, preview, missing };
}

// Écrit page.html et preview.html dans opts.out (par défaut prototype/dist).
export function write(opts = {}) {
  const dist = opts.out || join(root, 'dist');
  const r = render(opts);
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'page.html'), r.page);
  writeFileSync(join(dist, 'preview.html'), r.preview);
  return Object.assign({ out: dist }, r);
}

// Vrai quand ce fichier est lancé par node, faux quand il est importé (tests).
function isMain() {
  const arg = process.argv[1];
  if (!arg) return false;
  const real = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
  const a = real(arg), b = real(fileURLToPath(import.meta.url));
  return process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
  const opts = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--src' || args[i] === '--out') && args[i + 1]) opts[args[i].slice(2)] = resolve(args[++i]);
    else { console.error('Usage : node prototype/build.mjs [--src <dossier>] [--out <dossier>]'); process.exit(2); }
  }
  const r = write(opts);
  const kb = (n) => (Buffer.byteLength(n) / 1024).toFixed(1);
  console.log(`[build] ${join(r.out, 'page.html')} ${kb(r.page)} Ko · ${join(r.out, 'preview.html')} ${kb(r.preview)} Ko${r.missing.length ? ` · ${r.missing.length} fichier(s) ignoré(s)` : ''}`);
}
