// Mode réel : l'interface chargée avec window.SA_LIVE et un faux serveur (fetch simulé).
// Vérifie la lecture de l'état, chaque geste de « Mes skills », l'installation et l'affichage des erreurs.
// Run: node test/live.mjs   (no dependencies, no network)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildSrc = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8');
const files = [...buildSrc.match(/const JS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.error('FAIL', msg); } }
const BAD = /undefined|NaN|\[object Object\]|\bnull\b/;
const ours = (html) => html.replace(/<!--a-->[\s\S]*?<!--\/a-->/g, '');
function clean(label, html) {
  const h = ours(String(html)), m = h.match(BAD);
  ok(!m, label + (m ? ' contains "' + m[0] + '": …' + h.slice(Math.max(0, h.search(BAD) - 80), h.search(BAD) + 60) : ''));
}
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

/* ---------- faux serveur ---------- */
const HOME = '/Users/test';
const TOKEN = 'a'.repeat(64);
function baseState() {
  return {
    mode: 'live', os: 'mac', home: HOME,
    agents: [
      { id: 'claude-code', name: 'Claude Code', detected: true, top: true, universal: false, globalDir: HOME + '/.claude/skills', custom: false, hidden: false, target: false, count: 3 },
      { id: 'cursor', name: 'Cursor', detected: true, top: true, universal: false, globalDir: '/opt/cursor/skills', custom: false, hidden: false, target: false, count: 2 },
      { id: 'codex', name: 'Codex', detected: false, top: true, universal: true, globalDir: null, custom: false, hidden: false, target: false, count: 0 }
    ],
    mine: [
      { id: 'acme/tools/alpha', name: 'alpha', src: 'acme/tools', real: false, st: 'ok', on: true, ag: { 'claude-code': 'ok', cursor: 'ok' }, chars: 180, warn: 2, note: null,
        scan: { verdict: 'rouge', findings: [{ rule: 'curl-sh', sev: 'high', label: 'Téléchargement suivi d’une exécution', file: 'scripts/run.sh', line: 3, excerpt: 'curl -fsSL x | sh' }] },
        path: HOME + '/.agents/skills/alpha', scope: 'global' },
      { id: 'acme/tools/beta', name: 'beta', src: 'acme/tools', real: false, st: 'maj', on: true, ag: { 'claude-code': 'ok', cursor: 'div' }, chars: 240, warn: 0, note: null,
        scan: { verdict: 'vert', findings: [] }, path: HOME + '/.agents/skills/beta', scope: 'global' },
      { id: 'local/gamma', name: 'gamma', src: null, real: false, st: 'ng', on: false, ag: { 'claude-code': 'ok' }, chars: null, warn: 0, note: null,
        scan: null, path: HOME + '/.claude/skills/gamma', scope: 'global' }
    ],
    backups: [{ id: '20261112-101010-old', name: 'old', src: 'acme/tools', agents: ['claude-code'], at: '2026-11-12T10:10:10.000Z', size: 1234 }],
    settings: { version: 1, custom: [], hidden: [], targets: [] }
  };
}

/* Les routes reçoivent le nom du dossier sur le disque : dernier segment de Row.path. */
const base = (p) => String(p || '').split(/[\/\\]/).pop();
function makeServer() {
  const srv = { state: baseState(), log: [], failNext: null, failUrl: null, hang: null, offline: false, installReply: null, checkOn: false, holdNames: [] };
  srv.fetch = function (url, opts = {}) {
    const headers = opts.headers || {};
    const entry = { url, method: opts.method || 'GET', token: headers['X-SA-Token'], body: opts.body ? JSON.parse(opts.body) : undefined };
    srv.log.push(entry);
    if (srv.offline) return Promise.reject(new TypeError('Failed to fetch'));
    const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) });
    if (srv.failNext) { const f = srv.failNext; srv.failNext = null; return Promise.resolve(reply(f.status, f.body)); }
    if (srv.failUrl && srv.failUrl.url === url) { const f = srv.failUrl; srv.failUrl = null; return Promise.resolve(reply(f.status, f.body)); }
    const st = srv.state, b = entry.body || {};
    let data;
    if (url === '/api/state') data = st;
    else if (url === '/api/skills/check' && srv.checkOn) data = { outdated: st.mine.filter((r) => r.st === 'maj').map((r) => ({ name: base(r.path), scanNew: { verdict: 'vert', findings: [] } })) };
    else if (url === '/api/skills/remove') {
      st.mine = st.mine.filter((r) => !b.names.includes(base(r.path)));
      const bk = b.backup ? b.names.map((n) => ({ id: '20261113-120000-' + n, name: n, src: 'acme/tools', agents: ['claude-code'], at: '2026-11-13T12:00:00.000Z', size: 10 })) : [];
      st.backups = bk.concat(st.backups);
      data = { removed: b.names, backups: bk, failed: [], state: st };
    } else if (url === '/api/skills/update') {
      const names = b.names || [], force = b.force || [];
      const held = names.filter((n) => srv.holdNames.includes(n) && !force.includes(n));
      const updated = names.filter((n) => !held.includes(n));
      st.mine.forEach((r) => { if (updated.includes(base(r.path))) r.st = 'ok'; });
      data = { updated, held, failed: [], state: st };
    } else if (url === '/api/skills/disable' || url === '/api/skills/enable') {
      st.mine.forEach((r) => { if (b.names.includes(base(r.path))) r.on = url.endsWith('enable'); });
      data = { done: b.names, failed: [], state: st };
    } else if (url === '/api/backups/restore') {
      st.backups = st.backups.filter((x) => x.id !== b.id);
      data = { state: st };
    } else if (url === '/api/backups/delete') {
      st.backups = st.backups.filter((x) => x.id !== b.id);
      data = { state: st };
    } else if (url === '/api/skills/install') {
      data = srv.installReply ? srv.installReply(b) : { installed: b.items.map((i) => i.skill), skipped: [], failed: [], state: st };
    } else return Promise.resolve(reply(404, { error: 'not_found', message: 'Route inconnue.' }));
    const p = Promise.resolve(reply(200, JSON.parse(JSON.stringify(data))));
    if (srv.hang) { const h = srv.hang; srv.hang = null; return new Promise((res) => { h.release = () => res(p); }); }
    return p;
  };
  return srv;
}

/* ---------- faux DOM minimal ---------- */
function stub() {
  const s = { textContent: '', innerHTML: '', hidden: false, value: '', style: { setProperty() {} },
    querySelector() { return stub(); }, querySelectorAll() { return []; }, addEventListener() {}, focus() {}, setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } };
  return s;
}
function btn(attrs) {
  return { attrs, disabled: false, hasAttribute(n) { return n in attrs; }, getAttribute(n) { return n in attrs ? attrs[n] : null; },
    closest(sel) {
      if (sel === 'button') return this;
      const m = sel.match(/^\[([\w-]+)\]$/);
      return m && m[1] in attrs ? this : null;
    } };
}
function makeWin(srv, withView, extra = {}) {
  const docHandlers = [];
  const view = stub();
  const win = Object.assign({ matchMedia: null, setTimeout, clearTimeout, Promise, JSON, SA_LIVE: { token: TOKEN }, fetch: srv.fetch }, extra);
  win.console = { log() {}, warn() {}, error(...a) { if (String(a[0]).indexOf('[Skill Advisor]') !== 0) console.error(...a); } };
  win.window = win;
  win.document = {
    readyState: 'complete', addEventListener(t, f) { if (t === 'click') docHandlers.push(f); },
    getElementById(id) { return withView && id === 'view' ? view : null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    documentElement: { getAttribute() { return null; }, setAttribute() {} }
  };
  const ctx = vm.createContext(win);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), ctx, { filename: f });
  return { win, SA: win.SA, view, docHandlers };
}

/* ======================================================= 1. échec de lecture : écran d'erreur, pas de démarrage */
{
  const srv = makeServer();
  srv.failNext = { status: 500, body: { error: 'inventory', message: 'Le dossier des skills est illisible.' } };
  const { SA, view } = makeWin(srv, true);
  ok(SA.live && SA.live.on === true, 'SA.live exists in live mode');
  ok(/Lecture de votre machine/.test(view.innerHTML), 'loading state shown before the state arrives');
  const r = await SA.live.ready;
  ok(r === false, 'ready resolves false when /api/state fails');
  ok(/Le dossier des skills est illisible/.test(view.innerHTML), 'error screen shows the API message');
  ok(/Impossible de lire votre machine/.test(view.innerHTML), 'error screen has a title');
}
{
  const srv = makeServer();
  srv.offline = true;
  const { SA, view } = makeWin(srv, true);
  const r = await SA.live.ready;
  ok(r === false && /serveur local ne répond pas/.test(view.innerHTML), 'unreachable server: clear message, no start');
}
{
  const srv = makeServer();
  srv.failNext = { status: 403, body: { error: 'forbidden' } };
  const { SA, view } = makeWin(srv, true);
  ok(await SA.live.ready === false && /Accès refusé/.test(view.innerHTML), 'forbidden without message: French text');
}
{
  const srv = makeServer();
  srv.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new SyntaxError('Unexpected token <')) });
  const { SA, view } = makeWin(srv, true);
  ok(await SA.live.ready === false && /code 500/.test(view.innerHTML) && !/Unexpected token/.test(view.innerHTML), 'non-JSON error: French text with the status');
}
{
  const srv = makeServer();
  srv.state = { mode: 'live', home: HOME };
  const { SA, view } = makeWin(srv, true);
  ok(await SA.live.ready === false && /Réponse inattendue/.test(view.innerHTML), 'malformed state: error screen, no start');
}

/* ======================================================= 1b. agents cibles et masqués */
{
  const srv = makeServer();
  srv.state.agents.push({ id: 'cline', name: 'Cline', detected: true, top: false, universal: true, globalDir: HOME + '/.agents/skills', custom: false, hidden: true, target: false, count: 0 });
  const { SA } = makeWin(srv, false);
  await SA.live.ready;
  ok(SA.state.agents['claude-code'] && SA.state.agents.cursor && !SA.state.agents.cline, 'no target set: detected agents selected, hidden one left out: ' + JSON.stringify(SA.state.agents));
  SA.state.cart = [SA.search.items.find((it) => !SA.mineRow(it[0]))[0]];
  SA.state.route = 'wizard'; SA.state.step = 4;
  ok(!/Installer dans Cline/.test(SA.views.confirmation.render()), 'hidden agent not offered in the install list');
}
{
  const srv = makeServer();
  srv.state.agents[1].target = true;
  const { SA } = makeWin(srv, false);
  await SA.live.ready;
  ok(SA.state.agents.cursor && !SA.state.agents['claude-code'], 'targets set: only targets selected: ' + JSON.stringify(SA.state.agents));
}
{
  /* Masqué mais cible : il reçoit l'installation, il reste donc visible et décochable. */
  const srv = makeServer();
  srv.state.agents[1].target = true; srv.state.agents[1].hidden = true;
  const { SA } = makeWin(srv, false);
  await SA.live.ready;
  SA.go = () => true;
  const cfR = { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  SA.state.cart = [SA.search.items.find((it) => !SA.mineRow(it[0]))[0]];
  SA.state.route = 'wizard'; SA.state.step = 4;
  SA.views.confirmation.mount(cfR);
  ok(/Installer dans Cursor/.test(SA.views.confirmation.render()), 'hidden target still listed, so it can be unchecked');
  const a = SA.views.confirmation.actions();
  await a[a.length - 1].on(); await tick();
  const p = srv.log.filter((e) => e.url === '/api/skills/install').pop();
  ok(p && JSON.stringify(p.body.agents) === '["cursor"]', 'install payload matches the visible checked agents: ' + JSON.stringify(p && p.body.agents));
}

/* ======================================================= 2. lecture de l'état */
const srv = makeServer();
const { SA, docHandlers } = makeWin(srv, false);
const V = SA.views;
ok(await SA.live.ready === true, 'ready resolves true');
SA.go = () => true; SA.setRoute = () => true;
ok(srv.log[0].url === '/api/state' && srv.log[0].method === 'GET', 'first call reads /api/state');
ok(SA.state.mine.length === 3, 'state.mine replaced: ' + SA.state.mine.length);
ok(SA.data.mine.length === 3, 'data.mine replaced');
ok(SA.state.backups.length === 1 && SA.state.backups[0].id === '20261112-101010-old', 'backups replaced');
const cc = SA.data.agents.find((a) => a.id === 'claude-code');
ok(cc && cc.st === 'ok' && cc.rel === '.claude/skills' && Array.isArray(cc.sig) && cc.universal === false, 'agent mapped: ' + JSON.stringify(cc));
const cu = SA.data.agents.find((a) => a.id === 'cursor');
ok(cu && cu.abs === '/opt/cursor/skills', 'agent outside home keeps its absolute folder');
const cx = SA.data.agents.find((a) => a.id === 'codex');
ok(cx && cx.st === 'no' && cx.rel === '', 'undetected agent: st no, rel empty');
ok(SA.state.agents['claude-code'] && SA.state.agents.cursor && !SA.state.agents.codex, 'detected agents are selected');
ok(SA.state.os === 'mac' && SA.path('.claude/skills') === HOME + '/.claude/skills', 'home and os from the state');
ok(SA.mineRow('local/gamma').src === 'copie manuelle' && SA.mineRow('local/gamma').kind === 'manuel', 'row without source shown as a manual copy');
ok((SA.mineRow('acme/tools/alpha').local || []).length === 1, 'findings copied to row.local');
ok(srv.log.every((e) => e.token === TOKEN), 'token header on every call');

/* rendus avec l'état réel : rien de « undefined » ni « null » */
SA.state.route = 'accueil'; clean('accueil live', V.accueil.render());
ok(/alpha : motifs à risque/.test(V.accueil.render()), 'accueil lists the warned row from state.mine');
const txt = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
ok(/3 skills dans 2 agents/.test(txt(V.accueil.render())), 'accueil title counts state.mine and the selected agents');
ok(/, 1 non contrôlé\./.test(V.accueil.render()), 'accueil counts the unscanned row, singular');
ok(/2 skills lus/.test(V.accueil.render()) && /: 1 sans motif connu/.test(V.accueil.render()), 'accueil: unscanned row neither read nor clean');
{
  /* Une différence sans contrôle, une ligne avec une source retrouvée : rien ne casse, rien de simulé. */
  const b = SA.mineRow('acme/tools/beta'), g = SA.mineRow('local/gamma');
  b.diff = { from: 'a1', to: 'b2' }; g.match = 'acme/tools';
  let h = '';
  try { h = V.accueil.render(); } catch (e) { h = 'THROW ' + e.message; }
  ok(!/THROW/.test(h), 'accueil: diff without scan does not throw: ' + h.slice(0, 80));
  ok(!/data-gs-adopt/.test(V.gestion.render()), 'live: no « Prendre en charge » (no server route for it)');
  ok(!/source retrouvée|aucune source/.test(V.gestion.render()), 'live: no claim about a fingerprint search');
  ok(/skill-advisor\/disabled/.test(V.gestion.render()) && !/Quand l’agent a un réglage/.test(V.gestion.render()), 'live: disable text matches the server (reserve folder)');
  delete b.diff; delete g.match;
}
SA.state.route = 'gestion';
clean('gestion live', V.gestion.render());
SA.state.g.view = 'grille'; clean('gestion grille live', V.gestion.render()); SA.state.g.view = 'liste';
clean('dossier live', SA._dossier());

/* ---------- vue gestion montée sur un faux conteneur ---------- */
const parts = {};
const wrap = { isConnected: true, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; }, contains() { return true; },
  querySelector(sel) { return (parts[sel] = parts[sel] || stub()); }, querySelectorAll() { return []; } };
V.gestion.mount({ querySelector(sel) { return sel === '.gs' ? wrap : null; } });
const click = async (attrs) => { wrap.handlers.click({ target: btn(attrs) }); await tick(); };
const dyn = () => parts['#gs-dyn'].innerHTML;
const last = () => srv.log[srv.log.length - 1];

/* désinstaller : la case est cochée par défaut */
await click({ 'data-gs-un': 'acme/tools/alpha' });
ok(/Garder une sauvegarde/.test(dyn()) && /aria-checked="true"[^>]*data-gs-keep/.test(dyn()), 'row confirm shows a checked backup box');
clean('gestion armed', dyn());
await click({ 'data-gs-un-ok': 'acme/tools/alpha' });
ok(last().url === '/api/skills/remove' && last().method === 'POST', 'uninstall calls /api/skills/remove');
ok(JSON.stringify(last().body) === JSON.stringify({ names: ['alpha'], backup: true }), 'uninstall sends backup true by default: ' + JSON.stringify(last().body));
ok(!SA.mineRow('acme/tools/alpha'), 'state replaced after uninstall');
ok(SA.state.backups.length === 2, 'backups replaced after uninstall');
ok(/sauvegarde/i.test(dyn()) && /désinstallé/.test(dyn()) && !/sans sauvegarde/.test(dyn()), 'message says a backup was kept');

/* désinstaller sans sauvegarde */
await click({ 'data-gs-un': 'local/gamma' });
await click({ 'data-gs-keep': '' });
ok(/aria-checked="false"[^>]*data-gs-keep/.test(dyn()), 'box unchecked');
await click({ 'data-gs-un-ok': 'local/gamma' });
ok(JSON.stringify(last().body) === JSON.stringify({ names: ['gamma'], backup: false }), 'uninstall sends backup false when unchecked: ' + JSON.stringify(last().body));
ok(/sans sauvegarde/.test(dyn()), 'message says no backup was kept');

/* la case revient cochée à chaque nouvelle confirmation */
await click({ 'data-gs-un': 'acme/tools/beta' });
ok(/aria-checked="true"[^>]*data-gs-keep/.test(dyn()), 'box checked again on the next confirm');
await click({ 'data-gs-un-no': 'acme/tools/beta' });

/* mise à jour : tout, puis une seule depuis le tiroir, forcée */
await click({ 'data-gs-all': '' });
ok(last().url === '/api/skills/update' && JSON.stringify(last().body.names) === '["beta"]', 'update all sends the outdated names: ' + JSON.stringify(last().body));
ok(SA.mineRow('acme/tools/beta').st === 'ok', 'state replaced after update');
srv.state.mine.find((r) => r.name === 'beta').st = 'maj';
srv.state.mine.find((r) => r.name === 'beta').diff = { from: 'a1', to: 'b2', scan: { level: 2, text: 'Nouveau motif à risque.' } };
await SA.live.refresh();
ok(SA.mineRow('acme/tools/beta').st === 'maj', 'refresh reads the state again');
const ev = (attrs) => { docHandlers.forEach((h) => h({ target: btn(attrs) })); return tick(); };
await ev({ 'data-gs-apply': 'acme/tools/beta' });
ok(last().url === '/api/skills/update' && JSON.stringify(last().body) === JSON.stringify({ names: ['beta'], force: ['beta'] }), 'risky single update is forced: ' + JSON.stringify(last().body));

/* « Ce qui change » sans différences connues : contrôle de la version installée */
srv.state.mine.find((r) => r.name === 'beta').st = 'maj';
delete srv.state.mine.find((r) => r.name === 'beta').diff;
await SA.live.refresh();
let drawer = '';
SA.openDrawer = (html) => { drawer = html; };
V.gestion.openDiff('acme/tools/beta');
ok(/après (son )?téléchargement/.test(drawer), 'diff drawer without diff explains the later check');
clean('diff drawer live', drawer);

/* activer, désactiver */
await click({ 'data-gs-on': 'acme/tools/beta' });
ok(last().url === '/api/skills/disable' && JSON.stringify(last().body) === JSON.stringify({ names: ['beta'] }), 'switch off calls disable: ' + JSON.stringify(last()));
ok(SA.mineRow('acme/tools/beta').on === false, 'state replaced after disable');
SA.state.g.sel = { 'acme/tools/beta': true };
await click({ 'data-gs-bulk': 'on' });
ok(last().url === '/api/skills/enable' && JSON.stringify(last().body) === JSON.stringify({ names: ['beta'] }), 'bulk enable: ' + JSON.stringify(last()));

/* désinstallation groupée : case cochée par défaut */
await click({ 'data-gs-bulk': 'un' });
ok(/Garder une sauvegarde/.test(dyn()), 'bulk confirm shows the backup box');
await click({ 'data-gs-bulk': 'un-no' });

/* sauvegardes */
const firstBk = SA.state.backups[0].id;
await click({ 'data-gs-restore': '0' });
ok(last().url === '/api/backups/restore' && last().body.id === firstBk, 'restore sends the backup id: ' + JSON.stringify(last().body));
const nextBk = SA.state.backups[0].id;
await click({ 'data-gs-bk-del': '0' });
ok(last().url === '/api/backups/delete' && last().body.id === nextBk, 'delete backup sends the id');

/* pendant un appel : boutons désactivés, texte de progression */
srv.hang = {};
const h = srv.hang;
wrap.handlers.click({ target: btn({ 'data-gs-on': 'acme/tools/beta' }) });
await tick();
ok(/en cours/.test(dyn()), 'progress text while a call runs');
ok(/data-gs-on="acme\/tools\/beta"[^>]*disabled|disabled[^>]*data-gs-on="acme\/tools\/beta"/.test(dyn()), 'buttons disabled while a call runs');
const before = srv.log.length;
wrap.handlers.click({ target: btn({ 'data-gs-all': '' }) });
ok(srv.log.length === before, 'no second call while one runs');
h.release(); await tick();
ok(!/en cours/.test(dyn()), 'progress text gone after the call');

/* erreur de l'API : message en français, rien de faux */
const onBefore = SA.mineRow('acme/tools/beta').on;
srv.failNext = { status: 500, body: { error: 'cli_failed', message: 'Le moteur n’a pas pu écrire dans le dossier.' } };
await click({ 'data-gs-on': 'acme/tools/beta' });
ok(/Le moteur n’a pas pu écrire dans le dossier\./.test(dyn()), 'API error message shown');
ok(SA.mineRow('acme/tools/beta').on === onBefore, 'no fake change after an error');
srv.offline = true;
await click({ 'data-gs-on': 'acme/tools/beta' });
ok(/serveur local ne répond pas/.test(dyn()), 'offline server message shown');
srv.offline = false;

/* mise à jour lancée depuis « Ma machine » : l'erreur attend l'écran Mes skills */
SA.state.route = 'accueil';
srv.failNext = { status: 502, body: { error: 'github', message: 'GitHub ne répond pas. Réessayez dans un moment.' } };
await ev({ 'data-gs-apply': 'acme/tools/beta' });
ok(last().url === '/api/skills/update', 'update from the home screen calls the server');
SA.state.route = 'gestion';
V.gestion.mount({ querySelector(sel) { return sel === '.gs' ? wrap : null; } });
ok(/GitHub ne répond pas\./.test(V.gestion.render()), 'error from a call made elsewhere is shown in Mes skills');
V.gestion.mount({ querySelector(sel) { return sel === '.gs' ? wrap : null; } });
ok(!/GitHub ne répond pas\./.test(V.gestion.render()), 'that error is shown once');

/* ======================================================= 3. installation */
const pick = SA.search.items.filter((it) => !SA.mineRow(it[0])).slice(0, 2);
SA.state.route = 'wizard'; SA.state.step = 4; SA.state.cart = []; SA.state.inst = null;
pick.forEach((it) => SA.cart.add(it[0]));
ok(SA.cart.count() === 2, 'cart filled');
const cfH = {};
const cfRoot = { addEventListener(t, f) { cfH[t] = f; }, querySelector() { return null; }, querySelectorAll() { return []; } };
V.confirmation.mount(cfRoot);
clean('confirmation live', V.confirmation.render());
ok(/-a claude-code -a cursor/.test(V.confirmation.render()), 'command uses CLI ids without a second mapping');
/* Le serveur coupe toujours la télémétrie : la commande le montre, l'interrupteur ne peut pas la rallumer. */
ok(/DISABLE_TELEMETRY=1 npx/.test(V.confirmation.render()), 'live: command always carries DISABLE_TELEMETRY=1');
ok(/aria-checked="true"[^>]*disabled[^>]*><\/button><\/div><\/section>/.test(V.confirmation.render()), 'live: telemetry switch on and locked');
{
  const sw = { closest(sel) { return sel === '.cf-tel .sw' ? sw : null; } };
  cfH.click({ target: sw });
  ok(SA.state.telemetryOff === true && /DISABLE_TELEMETRY=1 npx/.test(V.confirmation.render()), 'live: clicking the switch keeps telemetry off');
}
let acts = V.confirmation.actions();
await acts[acts.length - 1].on(); await tick();
const inst = srv.log.filter((e) => e.url === '/api/skills/install').pop();
ok(inst && inst.method === 'POST', 'install calls /api/skills/install');
ok(inst && JSON.stringify(inst.body) === JSON.stringify({ items: pick.map((it) => ({ source: it[2], skill: it[1] })), agents: ['claude-code', 'cursor'], scope: 'global' }), 'install payload: ' + JSON.stringify(inst && inst.body));
ok(SA.state.inst.phase === 'done', 'install done: ' + SA.state.inst.phase);
ok(pick.every((it) => SA.state.inst.st[it[0]] === 'done'), 'every skill marked installed');
clean('confirmation done', V.confirmation.render());

/* une installation qui échoue sur un skill, portée projet */
const pick2 = SA.search.items.filter((it) => !SA.mineRow(it[0]) && !pick.includes(it)).slice(0, 2);
SA.state.inst = null; SA.state.cart = []; SA.state.scope = 'projet';
pick2.forEach((it) => SA.cart.add(it[0]));
srv.installReply = (b) => ({ installed: [b.items[0].skill], skipped: [], failed: [{ name: b.items[1].skill, message: 'Dépôt introuvable sur GitHub.' }], state: srv.state });
acts = V.confirmation.actions();
await acts[acts.length - 1].on(); await tick();
const inst2 = srv.log.filter((e) => e.url === '/api/skills/install').pop();
ok(inst2.body.scope === 'project', 'project scope mapped to "project"');
ok(SA.state.inst.phase === 'fail' && SA.state.inst.st[pick2[1][0]] === 'fail', 'failed skill marked');
ok(/Dépôt introuvable sur GitHub\./.test(V.confirmation.render()), 'per-skill error shown');
clean('confirmation fail', V.confirmation.render());

/* serveur injoignable pendant l'installation */
SA.state.inst = null; SA.state.scope = 'global';
srv.offline = true;
acts = V.confirmation.actions();
await acts[acts.length - 1].on(); await tick();
ok(SA.state.inst.phase === 'fail' && /serveur local ne répond pas/.test(V.confirmation.render()), 'install offline: failure shown, no fake success');
srv.offline = false;
ok(srv.log.filter((e) => e.method === 'POST').length > 10 && srv.log.every((e) => e.token === TOKEN), 'token header on every call, POST included: ' + JSON.stringify(srv.log.filter((e) => e.token !== TOKEN)));

/* ======================================================= 4. mode démo : même case de sauvegarde, sans serveur */
{
  const srvD = makeServer();
  const d = makeWin(srvD, false);
  delete d.win.SA_LIVE;
  let demoFetch = 0;
  const ctx2 = vm.createContext({ matchMedia: null, setTimeout, clearTimeout, console: d.win.console, document: d.win.document, fetch: () => { demoFetch++; return Promise.reject(new Error('no')); } });
  ctx2.window = ctx2;
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), ctx2, { filename: f });
  const S = ctx2.SA;
  ok(!S.live, 'demo mode: no SA.live');
  S.initState({ route: 'gestion' });
  const p2 = {};
  const w2 = { isConnected: true, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; }, contains() { return true; },
    querySelector(sel) { return (p2[sel] = p2[sel] || stub()); }, querySelectorAll() { return []; } };
  S.views.gestion.mount({ querySelector(sel) { return sel === '.gs' ? w2 : null; } });
  const c2 = (attrs) => w2.handlers.click({ target: btn(attrs) });
  const [r1, r2] = S.state.mine.filter((r) => r.kind !== 'plugin');
  c2({ 'data-gs-un': r1.id });
  ok(/aria-checked="true"[^>]*data-gs-keep/.test(p2['#gs-dyn'].innerHTML), 'demo: box checked by default');
  c2({ 'data-gs-un-ok': r1.id });
  ok(S.state.backups.length === 1 && S.state.backups[0].id === r1.id, 'demo: backup kept when checked');
  ok(/écran Sauvegardes/.test(p2['#gs-dyn'].innerHTML), 'demo: message says where the backup is');
  c2({ 'data-gs-un': r2.id }); c2({ 'data-gs-keep': '' }); c2({ 'data-gs-un-ok': r2.id });
  ok(S.state.backups.length === 1 && !S.mineRow(r2.id), 'demo: no backup when unchecked');
  ok(/sans sauvegarde/.test(p2['#gs-dyn'].innerHTML), 'demo: message says no backup');
  ok(!/Chaque désinstallation garde/.test(S.views.gestion.render()), 'demo: backups text no longer promises a backup for every uninstall');
  ok(demoFetch === 0, 'demo: no call to the server');
  ok(S.state.telemetryOff === false, 'demo: telemetry switch keeps its default');
}

/* ======================================================= 5. corrections de relecture : une fenêtre neuve par cas */
/* La recherche automatique des mises à jour (300 ms après le montage) ne part pas : chaque test la lance lui-même. */
const quietTimer = (f, ms, ...a) => (ms >= 300 ? 0 : setTimeout(f, ms, ...a));
/* Faux conteneur : refuse, comme le navigateur, un sélecteur d'attribut mal formé, et garde chaque sélecteur reçu. */
function strictWrap() {
  const parts = {}, sels = [];
  const okSel = (sel) => !/\[/.test(sel) || /^(\[[\w-]+(="(?:[^"\\]|\\.)*")?\])+$/.test(sel);
  const w = { isConnected: true, handlers: {}, sels, parts, addEventListener(t, f) { this.handlers[t] = f; }, contains() { return true; },
    querySelector(sel) { sels.push(sel); if (!okSel(sel)) throw new SyntaxError('invalid selector ' + sel); return (parts[sel] = parts[sel] || stub()); },
    querySelectorAll(sel) { sels.push(sel); if (!okSel(sel)) throw new SyntaxError('invalid selector ' + sel); return []; } };
  return w;
}
async function liveGestion(edit, extra = {}) {
  const s = makeServer();
  if (edit) edit(s.state, s);
  const w = makeWin(s, false, Object.assign({ setTimeout: quietTimer }, extra));
  const ready = await w.SA.live.ready;
  w.SA.go = () => true; w.SA.setRoute = () => true;
  w.SA.state.route = 'gestion';
  const wr = strictWrap();
  w.SA.views.gestion.mount({ querySelector(sel) { return sel === '.gs' ? wr : null; } });
  const clickW = async (attrs) => { let e = null; try { wr.handlers.click({ target: btn(attrs) }); } catch (x) { e = x; } await tick(); return e; };
  const evW = async (attrs) => { let e = null; try { w.docHandlers.forEach((h) => h({ target: btn(attrs) })); } catch (x) { e = x; } await tick(); return e; };
  return { srv: s, SA: w.SA, win: w.win, wr, ready, click: clickW, ev: evW, dyn: () => wr.parts['#gs-dyn'].innerHTML, last: () => s.log[s.log.length - 1] };
}

/* ---------- 6. nom de dossier, portée projet, ids uniques ---------- */
{
  const t = await liveGestion((st) => {
    st.mine.push(
      { id: 'acme/tools/Pretty Name', name: 'Pretty Name', src: 'acme/tools', real: false, st: 'ok', on: true, ag: { 'claude-code': 'ok' }, chars: 10, warn: 0, note: null,
        scan: { verdict: 'vert', findings: [] }, path: HOME + '\\.agents\\skills\\pretty-dir', scope: 'global' },
      { id: 'acme/tools/alpha', name: 'alpha', src: 'acme/tools', real: false, st: 'maj', on: true, ag: { 'claude-code': 'ok' }, chars: 10, warn: 0, note: null,
        scan: { verdict: 'vert', findings: [] }, path: '/work/proj/.agents/skills/alpha', scope: 'project' },
      { id: 'local/bad name', name: 'bad name', src: null, real: false, st: 'ng', on: true, ag: { 'claude-code': 'ok' }, chars: 10, warn: 0, note: null,
        scan: null, path: HOME + '/.agents/skills/bad name', scope: 'global' });
  });
  const { SA, srv: s6 } = t;
  const ids = SA.state.mine.map((r) => r.id);
  ok(new Set(ids).size === ids.length, '6: row ids unique: ' + JSON.stringify(ids));
  const pj = SA.state.mine.find((r) => r.scope === 'project');
  ok(pj && pj.id === 'acme/tools/alpha#project' && SA.mineRow('acme/tools/alpha').scope === 'global', '6: project duplicate gets the #project suffix: ' + (pj && pj.id));
  await t.click({ 'data-gs-on': 'acme/tools/Pretty Name' });
  ok(t.last().url === '/api/skills/disable' && JSON.stringify(t.last().body) === '{"names":["pretty-dir"]}', '6: gesture sends the folder name (backslash path): ' + JSON.stringify(t.last().body));
  await t.click({ 'data-gs-un': 'acme/tools/Pretty Name' });
  await t.click({ 'data-gs-un-ok': 'acme/tools/Pretty Name' });
  ok(t.last().url === '/api/skills/remove' && JSON.stringify(t.last().body.names) === '["pretty-dir"]', '6: uninstall sends the folder name: ' + JSON.stringify(t.last().body));
  const h = SA.views.gestion.render();
  ok(/Skill de projet : gérez-le depuis le dossier du projet\./.test(h), '6: project row explains why its actions are off');
  ok(/data-gs-un="acme\/tools\/alpha#project"[^>]*disabled/.test(h), '6: project row: uninstall disabled');
  ok(/data-gs-on="acme\/tools\/alpha#project"[^>]*disabled/.test(h), '6: project row: switch disabled');
  ok(!/data-gs-un="acme\/tools\/alpha"[^>]*disabled/.test(h), '6: global row with the same name stays usable');
  /* tiroir d'un skill de projet : l'explication, et un bouton coupé qui n'envoie rien */
  let pdr = '';
  SA.openDrawer = (html) => { pdr = html; };
  SA.closeDrawer = () => {};
  SA.views.gestion.openDiff('acme/tools/alpha#project');
  ok(/Skill de projet : gérez-le depuis le dossier du projet\./.test(pdr) && /data-gs-apply="acme\/tools\/alpha#project"[^>]*disabled/.test(pdr), '6: project drawer: explanation, update button disabled');
  const nP = s6.log.length;
  await t.ev({ 'data-gs-apply': 'acme/tools/alpha#project' });
  ok(s6.log.length === nP, '6: project row update sends nothing (would hit the global skill of the same folder)');
  /* lot : la ligne de projet et le nom non valide sont écartés et nommés */
  SA.state.g.sel = { 'acme/tools/alpha': true, 'acme/tools/alpha#project': true, 'local/bad name': true };
  const n0 = s6.log.length;
  await t.click({ 'data-gs-bulk': 'off' });
  ok(s6.log.length === n0 + 1 && JSON.stringify(t.last().body) === '{"names":["alpha"]}', '6: batch sends only the valid global folder: ' + JSON.stringify(t.last().body));
  ok(/bad name/.test(t.dyn()) && /projet/.test(t.dyn()), '6: dropped rows named in the message: ' + t.dyn().slice(0, 300));
  /* lot fait seulement de lignes écartées : aucun appel */
  SA.state.g.sel = { 'acme/tools/alpha#project': true };
  const n1 = s6.log.length;
  await t.click({ 'data-gs-bulk': 'on' });
  ok(s6.log.length === n1, '6: batch with only a project row sends nothing');
  ok(/projet/.test(t.dyn()), '6: and says why');
  /* « Tout mettre à jour » ne touche pas au skill de projet */
  await t.click({ 'data-gs-all': '' });
  const up = s6.log.slice(n1).filter((e) => e.url === '/api/skills/update');
  ok(up.length === 1 && JSON.stringify(up[0].body) === '{"names":["beta"]}', '6: update all leaves the project row out: ' + JSON.stringify(up.map((e) => e.body)));
}

/* ---------- 5. mise à jour retenue par le serveur, puis forcée ---------- */
{
  const t = await liveGestion((st, s) => { s.holdNames = ['beta']; });
  const { SA } = t;
  await t.click({ 'data-gs-all': '' });
  ok(JSON.stringify(t.last().body) === '{"names":["beta"]}', '5: first update not forced');
  ok(SA.state.held && SA.state.held.beta === true, '5: held name kept on SA.state.held: ' + JSON.stringify(SA.state.held));
  let drawer = '';
  SA.openDrawer = (html) => { drawer = html; };
  SA.views.gestion.openDiff('acme/tools/beta');
  ok(/La nouvelle version ajoute un motif à risque/.test(drawer), '5: drawer says the new version adds a risky pattern');
  ok(/Mettre à jour malgré tout/.test(drawer), '5: drawer offers the forced update');
  clean('5: held drawer', drawer);
  await t.ev({ 'data-gs-apply': 'acme/tools/beta' });
  ok(JSON.stringify(t.last().body) === '{"names":["beta"],"force":["beta"]}', '5: forced update sent: ' + JSON.stringify(t.last().body));
  ok(!(SA.state.held || {}).beta, '5: held entry cleared once updated');
}

/* ---------- 10. échec de la relecture de l'état après la recherche ---------- */
{
  const t = await liveGestion((st, s) => { s.checkOn = true; });
  t.srv.failUrl = { url: '/api/state', status: 500, body: { error: 'inventory', message: 'Inventaire impossible.' } };
  await t.click({ 'data-gs-check': '' });
  await tick();
  ok(t.srv.log.some((e) => e.url === '/api/skills/check'), '10: check called');
  ok(!/Recherche des mises à jour…/.test(t.dyn()), '10: progress text gone after a failed refresh');
  ok(/Inventaire impossible\./.test(t.dyn()), '10: refresh error shown');
  const n = t.srv.log.length;
  await t.click({ 'data-gs-on': 'acme/tools/beta' });
  ok(t.srv.log.length === n + 1, '10: page not locked after the failure');
}
{
  /* done() qui lève : le verrou est rendu quand même */
  const t = await liveGestion();
  t.srv.fetch = ((f) => (url, o) => (url === '/api/skills/disable' ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ done: [], failed: 5 }) }) : f(url, o)))(t.srv.fetch);
  t.win.fetch = t.srv.fetch;
  await t.click({ 'data-gs-on': 'acme/tools/beta' });
  ok(!/en cours/.test(t.dyn()), '10: busy cleared when the reply is malformed: ' + t.dyn().slice(0, 120));
  ok(/Réponse inattendue du serveur local/.test(t.dyn()) && !/is not a function|TypeError/.test(t.dyn()), '10: malformed reply: French text, no raw JS error');
}

/* ---------- 11. id de ligne avec guillemet ou barre oblique inverse ---------- */
{
  const ID = 'local/we"ird\\';
  const t = await liveGestion((st) => {
    st.mine.push({ id: ID, name: 'weird', src: null, real: false, st: 'ng', on: true, ag: {}, chars: null, warn: 0, note: null, scan: null, path: HOME + '/.agents/skills/weird', scope: 'global' });
  });
  let e = await t.click({ 'data-gs-un': ID });
  e = e || await t.click({ 'data-gs-un-no': ID });
  ok(!e, '11: cancel on an id with a quote does not throw: ' + (e && e.message));
  ok(!t.wr.sels.some((s) => s.indexOf('we"ird') > -1), '11: the raw id never reaches a selector');
  e = await t.click({ 'data-gs-f': 'tous' });
  ok(!e, '11: later refresh still works: ' + (e && e.message));
}

/* ---------- 7. le jeton quitte la barre d'adresse ---------- */
{
  const calls = [];
  const t = await liveGestion(null, { history: { replaceState(...a) { calls.push(a); } }, location: { pathname: '/', search: '?t=' + TOKEN, reload() {} } });
  ok(calls.length === 1 && JSON.stringify(calls[0]) === JSON.stringify([null, '', '/']), '7: query string removed: ' + JSON.stringify(calls));
  ok(t.srv.log.every((e) => e.token === TOKEN), '7: token still sent from SA_LIVE');
}

console.log(`${checks} checks, ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
