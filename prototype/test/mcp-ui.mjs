// Écran Serveurs MCP : rendu et actions en démo (machine d'exemple) et en mode réel (faux SA.live).
// Même approche que agents.mjs : les fichiers de la construction tournent dans une vm, sans DOM. Ni réseau ni fichier écrit.
// Lancer : node prototype/test/mcp-ui.mjs
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
const V = SA.views.mcp;
SA.sync = function () {};
SA.repaint = function () {};

const BAD = /undefined|NaN|\[object Object\]|\bnull\b|—/;
let fails = 0, runs = 0;
function fail(msg) { fails++; console.error('FAIL', msg); }
function ok(cond, msg) { runs++; if (!cond) fail(msg); }
function eq(a, b, msg) { runs++; const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) fail(msg + '\n  attendu ' + y + '\n  obtenu  ' + x); }
function render(label) {
  runs++;
  let html;
  try { html = V.render(); } catch (e) { fail(label + ' render threw: ' + e.stack); return ''; }
  const m = html.match(BAD);
  if (m) { const i = html.search(BAD); fail(label + ' contient "' + m[0] + '": ' + html.slice(Math.max(0, i - 80), i + 60)); }
  // Chaque <button> a un texte ou un aria-label ; chaque case a un état.
  for (const b of html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []) {
    if (!/aria-label="[^"]+"/.test(b) && !/>[^<\s][^<]*</.test(b.replace(/<svg[\s\S]*?<\/svg>/g, ''))) {
      // Case dans un label : son nom vient du texte du label.
      if (!/role="checkbox"/.test(b)) fail(label + ' bouton sans nom : ' + b.slice(0, 120));
    }
    if (/role="checkbox"/.test(b) && !/aria-checked="(true|false)"/.test(b)) fail(label + ' case sans état');
  }
  return html;
}
// Une ligne : de son data-id jusqu'à la ligne suivante (les pastilles d'agents sont des <li> elles aussi).
const row = (h, id) => { const i = h.indexOf('data-id="' + id + '"'); if (i < 0) return ''; const j = h.indexOf('<li class="mc-row', i); return h.slice(i, j < 0 ? h.length : j); };
const tick = () => new Promise((r) => setTimeout(r, 0));

if (!V || !V._do) { console.error('FAIL la vue mcp n’expose pas _do'); process.exit(1); }
const T = V._do;

// ================================================================ démo
SA.live = undefined;
SA.initState({ route: 'mcp' });
ok(SA.viewId() === 'mcp', 'route mcp → vue mcp');
let html = render('demo');
ok(/Serveurs MCP de vos agents/.test(html), 'demo : titre');
eq(T.servers().map((s) => s.name), ['github', 'fetch', 'filesystem', 'docs-exemple'], 'demo : quatre serveurs fictifs');
ok(/npx -y @modelcontextprotocol\/server-github/.test(row(html, 'github')), 'demo : commande lancée');
ok(/1 valeur secrète masquée/.test(row(html, 'github')), 'demo : secret signalé, jamais montré');
ok(/Distant · HTTP/.test(row(html, 'docs-exemple')) && /https:\/\/mcp\.exemple\.dev\/mcp/.test(row(html, 'docs-exemple')), 'demo : serveur distant');
ok(/Claude Code/.test(row(html, 'github')) && /Cursor/.test(row(html, 'github')), 'demo : noms des agents');

T.setQuery('cline');
eq(T.visible().map((s) => s.name), ['filesystem'], 'demo : recherche par nom d’agent');
T.setQuery('UVX');
eq(T.visible().map((s) => s.name), ['fetch'], 'demo : recherche par commande, sans casse');
T.setQuery('rien de tel');
ok(/Aucun serveur ne correspond/.test(render('demo/vide')), 'demo : recherche sans résultat');
T.setQuery('');

await T.setOn('fetch', false);
ok(T.servers().find((s) => s.name === 'fetch').on === false, 'demo : fetch désactivé');
T.setFilter('off');
eq(T.visible().map((s) => s.name), ['fetch'], 'demo : filtre Désactivés');
html = render('demo/off');
ok(/désactivé/.test(row(html, 'fetch')) && /Désactivé/.test(row(html, 'fetch')), 'demo : état désactivé affiché');
SA.state.mc.menu = 'fetch';
html = render('demo/menu-off');
ok(/data-mc-on="fetch"/.test(html) && !/data-mc-off="fetch"/.test(html), 'demo : menu propose Réactiver, plus Désactiver');
await T.setOn('fetch', true);
T.setFilter('tous');
ok(T.servers().find((s) => s.name === 'fetch').on === true, 'demo : fetch réactivé');

const b0 = (SA.state.backups || []).length;
T.select('github'); T.select('fetch');
html = render('demo/sel');
ok(/2 serveurs choisis/.test(html) && /Sauvegarder la sélection/.test(html), 'demo : barre de sélection');
await T.save(T.selected(), false);
ok(SA.state.backups.length === b0 + 1 && SA.state.backups[0].kind === 'mcp', 'demo : sauvegarde MCP ajoutée à la liste');
eq(SA.state.backups[0].items.map((i) => i.name), ['github', 'fetch'], 'demo : deux serveurs sauvegardés');

T.askRemove('filesystem');
html = render('demo/confirm');
ok(/Retirer filesystem des réglages de 2 agents/.test(html), 'demo : confirmation, nombre d’agents');
ok(/aria-checked="true"[^>]*data-mc-keep/.test(html), 'demo : « Garder une sauvegarde » cochée par défaut');
ok(/aria-checked="false"[^>]*data-mc-secrets/.test(html), 'demo : « Inclure les valeurs secrètes » décochée par défaut');
ok(/remplacés par des variables/.test(html), 'demo : explication des variables');
T.setSecrets(true);
ok(/tels quels/.test(render('demo/confirm-secrets')), 'demo : explication quand les secrets sont gardés');
await T.confirm();
ok(!T.servers().some((s) => s.name === 'filesystem'), 'demo : filesystem retiré');
ok(SA.state.backups[0].items[0].name === 'filesystem' && SA.state.backups[0].items[0].secrets === 'kept', 'demo : sauvegarde du retrait, secrets gardés');
render('demo/apres');

// ================================================================ catalogue (démo) et conseil
const FIX = { generatedAt: '2026-11-16T00:00:00Z', sample: true, counts: { registry: 64814 }, servers: [
  { id: 'io.github.acme/postgres-mcp', title: 'Postgres', description: 'Query your PostgreSQL database.', cats: ['database'], stars: 12000, downloads: 45000, docker: true, verified: 'github', verdict: 'vert', vulns: [],
    install: { type: 'npm', id: '@acme/postgres-mcp', version: '1.4.0', env: [{ name: 'DATABASE_URL', secret: true, required: true, description: 'Adresse de la base' }] }, score: { total: 88 } },
  { id: 'com.stripe/mcp', title: 'Stripe', description: 'Payments and billing.', cats: ['ecommerce'], verified: 'domain', verdict: 'vert', vulns: [],
    install: { type: 'remote', url: 'https://mcp.stripe.com', transport: 'http', headers: [{ name: 'Authorization', secret: true, required: true }] }, score: { total: 81 } },
  { id: 'io.github.x/risky', title: 'Risky DB', description: 'Database helper.', cats: ['database'], verdict: 'vert', vulns: ['GHSA-1'],
    install: { type: 'pypi', id: 'risky-mcp', version: '0.1.0', env: [] }, score: { total: 40 } },
] };
SA.mcpCatalog = FIX;
SA.live = undefined;
SA.initState({ route: 'mcp' });
T.setTab('cat');
html = render('demo/catalogue');
ok(/Catalogue du 16\/11\/2026/.test(html) && /extrait des 3 mieux notés/.test(html), 'catalogue : date et extrait');
ok(/88<span class="mut">\/100/.test(html) && /12 k étoiles/.test(html) && /Catalogue Docker/.test(html), 'catalogue : note et signaux');
ok(/npx -y @acme\/postgres-mcp@1\.4\.0/.test(html) && /Distant : https:\/\/mcp\.stripe\.com/.test(html), 'catalogue : commande épinglée et adresse');
ok(/Domaine de l’éditeur vérifié/.test(html), 'catalogue : domaine vérifié');
eq(T.catList().map((e) => e.id), ['io.github.acme/postgres-mcp', 'com.stripe/mcp', 'io.github.x/risky'], 'catalogue : par note');
T.setCat('database');
eq(T.catList().map((e) => e.id), ['io.github.acme/postgres-mcp', 'io.github.x/risky'], 'catalogue : type de projet');
T.setCat(''); T.setCatQuery('payments');
eq(T.catList().map((e) => e.id), ['com.stripe/mcp'], 'catalogue : recherche dans la description');
T.setCatQuery('');

SA.state.agents = { claude: true };
T.openInstall('io.github.acme/postgres-mcp');
html = render('demo/installer');
ok(/aria-checked="true"[^>]*data-mc-iag="claude"/.test(html), 'installer : agents cibles cochés');
ok(/type="password"[^>]*data-mc-var="DATABASE_URL"/.test(html), 'installer : secret en champ masqué');
ok(/Laissez un champ vide/.test(html), 'installer : variables expliquées');
await T.install();
ok(T.servers().some((x) => x.name === 'postgres-mcp' && x.ag.claude), 'installer (démo) : serveur ajouté');
ok(/postgres-mcp installé chez 1 agent/.test(SA.state.mc.msg), 'installer (démo) : message');

T.openInstall('io.github.x/risky');
html = render('demo/risque');
ok(/Faille connue pour cette version : GHSA-1/.test(html) && /Installer malgré l’avertissement/.test(html), 'installer : avertissement de faille');
await T.install();
ok(/Cochez « Installer malgré l’avertissement »/.test(SA.state.mc.fail), 'installer : retenu sans accord');
T.inst().force = true;
await T.install();
ok(T.servers().some((x) => x.name === 'risky'), 'installer : accepté avec accord');
T.setTab('mine');

// Conseil : serveurs MCP classés par catégories et mots-clés de l'objectif.
const goal = Object.keys(SA.reco.map).find((g) => (SA.reco.map[g].base || []).includes('database')) || Object.keys(SA.reco.map)[0];
const sugg = SA.reco.mcp(goal, {}, FIX.servers);
ok(Array.isArray(sugg), 'conseil : liste de serveurs MCP');
if ((SA.reco.map[goal].base || []).includes('database')) ok(sugg[0] && sugg[0].e.id === 'io.github.acme/postgres-mcp', 'conseil : base de données en tête pour ' + goal);
ok(!SA.reco.mcp(goal, {}, [{ id: 'x/y', cats: ['database'], verdict: 'rouge', score: { total: 99 } }]).length, 'conseil : motif à risque jamais conseillé');

// ================================================================ mode réel (faux serveur)
const calls = [];
let reply = () => ({ done: [{ agent: 'cursor' }], failed: [] });
let reject = null;
SA.data.agents = [{ id: 'claude-code', name: 'Claude Code', st: 'ok' }, { id: 'cursor', name: 'Cursor', st: 'ok' }];
SA.data.mcp = { agents: [], servers: [
  { id: 'gh', name: 'gh', scope: 'global', kind: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'], url: null, env: { T: '••••' }, headers: {}, secrets: 1, on: true, differs: true,
    ag: { 'claude-code': [{ mcpId: 'claude-code', on: true }], cursor: [{ mcpId: 'cursor', on: false, stash: true }] } },
  { id: 'project:loc', name: 'loc', scope: 'project', kind: 'http', command: null, args: [], url: 'https://h/mcp', env: {}, headers: {}, secrets: 0, on: true, differs: false,
    ag: { 'claude-code': [{ mcpId: 'claude-code', on: true }] } },
] };
SA.live = { on: true, state: {}, call(method, p, body) { calls.push({ method, p, body }); if (reject) return Promise.reject(new Error(reject)); return Promise.resolve(Object.assign(reply(p, body), { state: {} })); } };
SA.initState({ route: 'mcp' });
html = render('live');
ok(/Réglages différents d’un agent à l’autre/.test(row(html, 'gh')), 'live : réglages différents signalés');
ok(/Projet/.test(row(html, 'project:loc')), 'live : portée projet signalée');
ok(/actif/.test(row(html, 'gh')) && /désactivé/.test(row(html, 'gh')), 'live : état par agent');
T.setFilter('diff');
eq(T.visible().map((s) => s.name), ['gh'], 'live : filtre Réglages différents');
T.setFilter('tous');

await T.setOn('gh', false);
eq(calls.at(-1), { method: 'POST', p: '/api/mcp/disable', body: { name: 'gh', scope: 'global' } }, 'live : disable');
ok(/gh : désactivé chez 1 agent/.test(SA.state.mc.msg), 'live : message de résultat ' + SA.state.mc.msg);
await T.setOn('project:loc', true);
eq(calls.at(-1).body, { name: 'loc', scope: 'project' }, 'live : portée projet transmise');

reply = () => ({ backup: { label: 'Serveurs MCP : gh' }, failed: [] });
T.select('gh');
await T.save(T.selected(), true);
eq(calls.at(-1), { method: 'POST', p: '/api/mcp/backup', body: { servers: [{ name: 'gh', scope: 'global' }], secrets: true } }, 'live : backup avec secrets');
ok(/Sauvegarde créée : « Serveurs MCP : gh »/.test(SA.state.mc.msg), 'live : message de sauvegarde');

reply = () => ({ removed: [{ agent: 'claude-code' }], failed: [{ agent: 'cursor', message: 'Fichier de réglages mal formé : Skill Advisor n’y écrit pas.' }], backups: [{ id: 'x' }] });
T.askRemove('gh');
await T.confirm();
eq(calls.at(-1), { method: 'POST', p: '/api/mcp/remove', body: { name: 'gh', scope: 'global', backup: true, secrets: false } }, 'live : remove avec sauvegarde, sans secrets');
ok(/retiré chez 1 agent/.test(SA.state.mc.msg) && /Cursor : Fichier de réglages mal formé/.test(SA.state.mc.msg) && /sauvegarde est gardée/.test(SA.state.mc.msg), 'live : message avec l’échec par agent');
ok(!SA.state.mc.sel.gh, 'live : ligne retirée de la sélection');

T.askRemove('project:loc');
T.setKeep(false);
await T.confirm();
eq(calls.at(-1).body, { name: 'loc', scope: 'project', backup: false, secrets: false }, 'live : remove sans sauvegarde');

reject = 'Le fichier de réglages a changé pendant l’opération. Fermez l’agent, puis réessayez.';
await T.setOn('gh', false);
ok(SA.state.mc.fail === reject && !SA.state.mc.msg, 'live : erreur du serveur affichée');
ok(/role="alert">Le fichier de réglages a changé/.test(render('live/erreur')), 'live : alerte rendue');
reject = null;

SA.data.mcp = { error: 'La lecture des réglages MCP a échoué.', agents: [], servers: [] };
html = render('live/erreur-lecture');
ok(/La lecture des réglages MCP a échoué/.test(html) && /Aucun serveur MCP/.test(html), 'live : échec de lecture signalé');

// Mode réel : catalogue complet chargé à la demande, installation par /api/mcp/install.
SA.data.mcp = { agents: [], servers: [] };
SA.data.agents = [{ id: 'claude-code', name: 'Claude Code', st: 'ok', detected: true }, { id: 'cursor', name: 'Cursor', st: 'ok', detected: true }];
reply = (p) => (p === '/api/mcp/catalog' ? { generatedAt: '2026-11-16T00:00:00Z', counts: { registry: 64814 }, servers: FIX.servers.concat([{ id: 'io.github.z/extra', title: 'Extra', cats: [], verdict: 'vert', vulns: [], install: { type: 'npm', id: 'extra', version: '1.0.0', env: [] }, score: { total: 70 } }]) }
  : { installed: [{ agent: 'cursor', mcpId: 'cursor' }], skipped: [], failed: [], held: null, backups: [], warnings: ['Variables à définir avant le premier lancement : DATABASE_URL.'], name: 'postgres-mcp' });
SA.initState({ route: 'mcp' });
T.setTab('cat');
await tick(); await tick();
eq(calls.at(-1), { method: 'GET', p: '/api/mcp/catalog', body: undefined }, 'live : catalogue chargé à la demande');
ok(T.catList().length === 4 && /4 serveurs retenus sur 65 k/.test(render('live/catalogue')), 'live : catalogue complet affiché');
SA.state.agents = { cursor: true };
T.openInstall('io.github.acme/postgres-mcp');
T.inst().values.DATABASE_URL = '';
await T.install();
eq(calls.at(-1), { method: 'POST', p: '/api/mcp/install', body: { id: 'io.github.acme/postgres-mcp', agents: ['cursor'], scope: 'global', values: {}, replace: false, force: false } }, 'live : installation, champ vide non envoyé');
ok(/postgres-mcp : installé chez 1 agent\./.test(SA.state.mc.msg) && /DATABASE_URL/.test(SA.state.mc.msg), 'live : message et variable à définir');

ok(SA.crumbHtml().includes('Serveurs MCP'), 'fil d’Ariane');
await tick();
console.log(`${runs} vérifications, ${fails} échec(s)`);
process.exit(fails ? 1 : 0);
