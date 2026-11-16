// Écran Plugins : rendu, filtres, gestes en démo et en mode réel (faux SA.live). Fichiers de la construction dans une vm.
// Lancer : node prototype/test/plugins-ui.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildSrc = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8');
const files = [...buildSrc.match(/const JS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const win = { matchMedia: null, console, setTimeout, clearTimeout };
win.window = win;
win.document = { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, documentElement: { getAttribute() { return null; } } };
const ctx = vm.createContext(win);
for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), ctx, { filename: f });
const SA = win.SA;
const V = SA.views.plugins;
SA.sync = function () {};
SA.repaint = function () {};

const BAD = /undefined|NaN|\[object Object\]|\bnull\b|—/;
let fails = 0, runs = 0;
const fail = (m) => { fails++; console.error('FAIL', m); };
const ok = (c, m) => { runs++; if (!c) fail(m); };
const eq = (a, b, m) => { runs++; const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) fail(m + '\n  attendu ' + y + '\n  obtenu  ' + x); };
function render(label) {
  runs++;
  let html;
  try { html = V.render(); } catch (e) { fail(label + ' : ' + e.stack); return ''; }
  const m = html.match(BAD);
  if (m) { const i = html.search(BAD); fail(label + ' contient "' + m[0] + '": ' + html.slice(Math.max(0, i - 80), i + 60)); }
  return html;
}
const T = V._do;

// démo
SA.live = undefined;
SA.initState({ route: 'plugins' });
ok(SA.viewId() === 'plugins', 'route plugins');
let html = render('demo');
ok(/Plugins de vos agents/.test(html), 'titre');
ok(/6 skills · 4 commandes · 2 sous-agents/.test(html), 'contenu compté');
ok(/hooks\) : <span class="mono">PreToolUse/.test(html), 'hooks signalés');
ok(/Claude Code · 0\.3\.1/.test(html) && /désactivé/.test(html) && /Gemini CLI · 0\.3\.1/.test(html), 'état par agent et version');
T.setFilter('hooks');
eq(T.visible().map((p) => p.name), ['outils-revue'], 'filtre Avec hooks');
T.setFilter('tous');
T.setQuery('gemini');
eq(T.visible().map((p) => p.name), ['docs-exemple'], 'recherche par agent');
T.setQuery('');
const docs = T.plugins().find((p) => p.name === 'docs-exemple');
eq(T.verbs(docs), ['enable', 'disable', 'update', 'uninstall'], 'gestes : activer (Claude Code) et désactiver (Gemini)');
await T.act('docs-exemple', 'enable');
ok(docs.ag.claude[0].on === true, 'démo : activé');
await T.act('outils-revue', 'uninstall');
ok(/Désinstaller outils-revue de 1 agent \?/.test(render('demo/confirm')), 'désinstaller : confirmation');
await T.act('outils-revue', 'uninstall');
ok(!T.plugins().some((p) => p.name === 'outils-revue'), 'démo : désinstallé');
ok(SA.crumbHtml().includes('Plugins'), 'fil d’Ariane');

// mode réel
const calls = [];
let reply = { done: [{ agent: 'claude-code', pluginId: 'ecc@ecc' }], failed: [{ agent: 'codex', pluginId: 'ecc@m', message: 'Codex ne permet pas de désactiver un plugin depuis sa ligne de commande.' }] };
SA.data.plugins = { agents: [{ id: 'claude-code', name: 'Claude Code', count: 1, verbs: ['enable', 'disable', 'uninstall', 'update'] }, { id: 'codex', name: 'Codex', count: 1, verbs: ['uninstall'] }],
  plugins: [{ id: 'ecc', name: 'ecc', title: 'ecc', on: true, otherOnly: false, contents: { skills: 314, commands: 98, agents: 71, hooks: ['PreToolUse'], mcp: [] },
    ag: { 'claude-code': [{ pluginId: 'ecc@ecc', scope: 'global', version: '2.2.3', on: true }], codex: [{ pluginId: 'ecc@m', scope: 'global', version: '1', on: null }] } }] };
SA.live = { on: true, state: {}, call(method, p, body) { calls.push({ method, p, body }); return Promise.resolve(Object.assign({}, reply, { state: {} })); } };
SA.initState({ route: 'plugins' });
eq(T.verbs(T.plugins()[0]), ['disable', 'update', 'uninstall'], 'live : Codex sans désactiver ; actif, pas d’« Activer »');
await T.act('ecc', 'disable');
eq(calls.at(-1), { method: 'POST', p: '/api/plugins/action', body: { name: 'ecc', verb: 'disable' } }, 'live : geste envoyé');
ok(/ecc : désactivé chez 1 agent\./.test(SA.state.pl.msg) && /Codex : Codex ne permet pas/.test(SA.state.pl.msg), 'live : bilan avec l’échec par agent');
SA.data.plugins = { agents: [], plugins: [] };
ok(/Aucun plugin trouvé/.test(render('live/vide')), 'live : aucun plugin');

// Catalogue : extrait embarqué en démo, complet en mode réel ; installation par /api/plugins/install.
SA.pluginCatalog = { generatedAt: '2026-11-16T00:00:00Z', sample: true, plugins: [
  { id: 'pg@claude-plugins-official', name: 'pg', market: 'claude-plugins-official', agent: 'claude-code', title: 'Postgres', description: 'PostgreSQL helpers.', author: 'Anthropic', cats: ['database'], verdict: 'vert', internal: true, score: { total: 90 } },
  { id: 'aws-core@awesome-copilot', name: 'aws-core', market: 'awesome-copilot', agent: 'github-copilot', title: 'AWS', description: 'Deploy to AWS.', cats: ['devops'], stars: 3500, verdict: 'vert', score: { total: 80 } },
  { id: 'odd@claude-plugins-official', name: 'odd', market: 'claude-plugins-official', agent: 'claude-code', title: 'Odd', description: 'Odd one.', cats: ['devops'], verdict: 'rouge', score: { total: 30 } },
] };
SA.data.plugins = { agents: [], plugins: [] };
SA.initState({ route: 'plugins' });
T.setTab('cat');
await new Promise((r) => setTimeout(r, 0));
eq(calls.at(-1), { method: 'GET', p: '/api/plugins/catalog', body: undefined }, 'live : catalogue chargé à la demande');
ok(/Catalogue du 16\/11\/2026/.test(render('live/catalogue')), 'catalogue : date');
eq(T.catList().map((e) => e.name), ['pg', 'aws-core', 'odd'], 'catalogue : par note (extrait tant que le complet n’est pas là)');
T.setAgent('github-copilot');
eq(T.catList().map((e) => e.name), ['aws-core'], 'catalogue : filtre agent');
T.setAgent(''); T.setCat('devops');
eq(T.catList().map((e) => e.name), ['aws-core', 'odd'], 'catalogue : type de projet');
T.setCat('');
reply = { installed: true, held: null, id: 'odd@claude-plugins-official' };
await T.install('odd@claude-plugins-official');
eq(calls.at(-1), { method: 'POST', p: '/api/plugins/install', body: { id: 'odd@claude-plugins-official', scope: 'global', force: true } }, 'installation : accord donné pour un motif à risque');
ok(/Odd installé pour Claude Code/.test(SA.state.pl.msg), 'installation : message');
const sug = SA.reco.plugins(Object.keys(SA.reco.map).find((g) => (SA.reco.map[g].base || []).includes('devops')) || Object.keys(SA.reco.map)[0], {});
ok(Array.isArray(sug) && !sug.some((r) => r.e.verdict === 'rouge'), 'conseil : plugins sans motif à risque');

console.log(runs + ' vérifications, ' + fails + ' échec(s)');
process.exit(fails ? 1 : 0);
