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
    else if (url.indexOf('/api/skills/preview?name=') === 0) {
      /* Comparaison de la nouvelle version : rouge pour un nom retenu (holdNames) ou listé dans previewRouge. */
      const n = decodeURIComponent(url.slice('/api/skills/preview?name='.length));
      if (srv.previewFail) { const f = srv.previewFail; srv.previewFail = null; return Promise.resolve(reply(f.status, f.body)); }
      const red = srv.holdNames.includes(n) || (srv.previewRouge || []).includes(n);
      data = { name: n, same: false,
        files: [{ path: 'SKILL.md', status: 'changed', added: 3, removed: 1 }, { path: 'scripts/new.sh', status: 'added', added: 12, removed: 0 }, { path: 'old.md', status: 'removed', added: 0, removed: 4 }],
        scan: red ? { verdict: 'rouge', findings: [{ rule: 'curl-sh', sev: 'high', label: 'Téléchargement suivi d’une exécution', file: 'scripts/new.sh', line: 2, excerpt: 'curl -fsSL x | sh' }] } : { verdict: 'vert', findings: [] },
        scanOld: { verdict: 'vert' } };
    }
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
      /* Motif à risque : refus 409 tant que les noms cités ne sont pas dans force. */
      if (srv.rougeNames && !srv.rougeNames.every((n) => (b.force || []).includes(n))) {
        return Promise.resolve(reply(409, { error: 'ROUGE', message: 'Le skill ' + srv.rougeNames.join(', ') + ' contient un motif à risque.', names: srv.rougeNames }));
      }
      st.backups = st.backups.filter((x) => x.id !== b.id);
      data = { state: st };
    } else if (url === '/api/backups/create') {
      const bk = { id: '20261113-130000-' + b.names[0], label: b.label || b.names[0], origin: 'manual', at: '2026-11-13T13:00:00.000Z', size: 10,
        items: b.names.map((n) => ({ name: n, src: 'acme/tools', agents: ['claude-code'], verdict: 'vert' })) };
      st.backups = [bk].concat(st.backups);
      data = { backup: bk, failed: [], state: st };
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
    activeElement: null,
    getElementById(id) { if (win.__ids && win.__ids[id]) return win.__ids[id]; return withView && id === 'view' ? view : null; },
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
  /* Contrat 1.0 : « Session expirée. Relancez Skill Advisor (npm start), puis ouvrez la nouvelle adresse. », sans conseil de rechargement. */
  ok(await SA.live.ready === false && /Session expirée/.test(view.innerHTML) && /ouvrez la nouvelle adresse/.test(view.innerHTML) && !/Rechargez/.test(view.innerHTML),
    'forbidden without message: French text: ' + view.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
{
  /* Refus SHARED : les lecteurs envoyés par le serveur arrivent sur l'erreur, textes seulement, 100 au plus. */
  const srv = makeServer();
  const { SA } = makeWin(srv, false);
  await SA.live.ready;
  const many = [42, null, { id: 'x' }, 'cursor'].concat(Array.from({ length: 150 }, (_, i) => 'agent-' + i));
  srv.failNext = { status: 409, body: { error: 'SHARED', message: 'Cursor lit le dossier partagé.', readers: many } };
  let e = null;
  try { await SA.live.call('POST', '/api/agents/empty', { id: 'cursor', backup: true }); } catch (x) { e = x; }
  ok(e && e.code === 'SHARED' && e.status === 409 && /dossier partagé/.test(e.message), 'SHARED refusal: code, status and message kept: ' + (e && e.code));
  ok(e && Array.isArray(e.readers) && e.readers.length === 100 && e.readers[0] === 'cursor' && e.readers.every((x) => typeof x === 'string'), 'SHARED refusal: readers copied, strings only, at most 100: ' + (e && e.readers && e.readers.length));
  srv.failNext = { status: 409, body: { error: 'SHARED', message: 'Refus.', readers: 'cursor' } };
  e = null;
  try { await SA.live.call('POST', '/api/agents/empty', { id: 'cursor', backup: true }); } catch (x) { e = x; }
  ok(e && e.readers === undefined, 'SHARED refusal: readers that are not a list are ignored');
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
const { SA, docHandlers, win: mainWin } = makeWin(srv, false);
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
/* Contrat 1.0 : le tiroir lit GET /api/skills/preview (remplace l'ancien texte « contrôlée après son téléchargement »). */
{
  const dk = drawerKit(mainWin, SA);
  V.gestion.openDiff('acme/tools/beta');
  ok(/télécharge la nouvelle version/.test(dk.html) && /data-gs-later/.test(dk.html) && !/data-gs-apply/.test(dk.html), 'Ce qui change: loading state, no update button yet');
  await tick();
  const pvCall = srv.log.filter((e) => e.url.indexOf('/api/skills/preview') === 0).pop();
  ok(pvCall && pvCall.method === 'GET' && pvCall.url === '/api/skills/preview?name=beta' && pvCall.token === TOKEN, 'Ce qui change: GET /api/skills/preview with the folder name: ' + JSON.stringify(pvCall));
  const pt = txt(dk.pvHTML);
  ok(/SKILL\.md/.test(pt) && /Modifié/.test(pt) && /scripts\/new\.sh/.test(pt) && /Ajouté/.test(pt) && /old\.md/.test(pt) && /Retiré/.test(pt), 'Ce qui change: files added, removed, changed: ' + pt.slice(0, 300));
  ok(/\+3/.test(pt) && /−1/.test(pt) && /15 lignes ajoutées, 5 retirées/.test(pt), 'Ce qui change: line counts per file and in total: ' + pt.slice(0, 400));
  ok(/Aucun motif connu/.test(pt) && /Version installée : Aucun motif connu/.test(pt), 'Ce qui change: verdict of the new version, then of the installed one');
  ok(/data-gs-apply="acme\/tools\/beta"/.test(dk.pvHTML) && !/data-gs-force/.test(dk.pvHTML) && />Mettre à jour</.test(dk.pvHTML), 'Ce qui change: plain update button for a clean version');
  clean('diff drawer live', dk.text());
  /* Échec de la comparaison : message, Réessayer, aucun bouton de mise à jour. */
  srv.previewFail = { status: 502, body: { error: 'NETWORK', message: 'GitHub ne répond pas.' } };
  V.gestion.openDiff('acme/tools/beta');
  await tick();
  ok(/Comparaison impossible/.test(dk.pvHTML) && /GitHub ne répond pas\./.test(dk.pvHTML) && /data-gs-pv-retry/.test(dk.pvHTML) && !/data-gs-apply/.test(dk.pvHTML), 'Ce qui change: error state with retry, no update button: ' + txt(dk.pvHTML));
  const nPv = srv.log.length;
  docHandlers.forEach((h) => h({ target: btn({ 'data-gs-pv-retry': 'acme/tools/beta' }) }));
  await tick();
  ok(srv.log.slice(nPv).some((e) => e.url === '/api/skills/preview?name=beta') && /SKILL\.md/.test(dk.pvHTML), 'Ce qui change: retry fetches the comparison again');
  /* Nouvelle version à risque : le bouton le dit et force. */
  srv.previewRouge = ['beta'];
  V.gestion.openDiff('acme/tools/beta');
  await tick();
  ok(/Motif à risque/.test(dk.pvHTML) && /Téléchargement suivi d’une exécution/.test(dk.pvHTML), 'Ce qui change: risky verdict with its findings');
  ok(/data-gs-force[^>]*>Mettre à jour malgré l’avertissement</.test(dk.pvHTML), 'Ce qui change: forced update button for a risky version');
  srv.previewRouge = [];
}

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
/* Contrat 1.0 : une installation de projet demande State.project (sinon la page la bloque). */
srv.state.project = '/work/proj';
await SA.live.refresh();
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
/* ---------- mini DOM : le HTML rendu est relu pour retrouver les éléments, et le focus est suivi ---------- */
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
function unesc(v) { return v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function parseHTML(html, doc) {
  const nodes = [], stack = [];
  const re = /<(\/?)([a-zA-Z0-9]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[2].toLowerCase();
    if (m[1]) { while (stack.length && stack.pop().tag !== tag) { /* fermeture */ } continue; }
    const attrs = {};
    m[3].replace(/([\w:-]+)(?:="([^"]*)")?/g, (_, k, v) => { attrs[k] = v === undefined ? '' : unesc(v); return ''; });
    const n = node(tag, attrs, stack[stack.length - 1] || null, doc);
    nodes.push(n);
    if (!VOID.has(tag)) stack.push(n);
  }
  return nodes;
}
function node(tag, attrs, parent, doc) {
  return {
    tag, attrs, parent, hidden: 'hidden' in attrs, disabled: 'disabled' in attrs, id: attrs.id || '',
    get attributes() { return Object.keys(this.attrs).map((name) => ({ name, value: this.attrs[name] })); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    matches(sel) { return matchSel(this, sel); },
    closest(sel) { for (let n = this; n; n = n.parent) if (matchSel(n, sel)) return n; return null; },
    focus() { doc.activeElement = this; }, scrollIntoView() {}
  };
}
function matchSel(n, sel) {
  if (!n || !n.attrs) return false;
  if (sel[0] === '#') return n.attrs.id === sel.slice(1);
  if (sel[0] === '.') return (' ' + (n.attrs.class || '') + ' ').indexOf(' ' + sel.slice(1) + ' ') > -1;
  const a = sel.match(/^\[([\w-]+)(?:="((?:[^"\\]|\\.)*)")?\]$/);
  if (a) return a[1] in n.attrs && (a[2] === undefined || n.attrs[a[1]] === a[2]);
  return n.tag === sel;
}
/* Faux conteneur : refuse, comme le navigateur, un sélecteur d'attribut mal formé, et garde chaque sélecteur reçu.
   Les zones redessinées (#gs-dyn, #gs-tools, #gs-filters) sont relues : leurs éléments sont trouvés et prennent le focus. */
const STUBS = new Set(['#gs-sub', '#gs-chk', '#gs-tools', '#gs-filters', '#gs-dyn', '#gs-all', '#gs-check', '#gs-live', 'h1', '#gs-q']);
function strictWrap(doc) {
  const parts = {}, sels = [], cache = { html: null, nodes: [] };
  const okSel = (sel) => !/\[/.test(sel) || /^(\[[\w-]+(="(?:[^"\\]|\\.)*")?\])+$/.test(sel);
  const part = (sel) => {
    if (!parts[sel]) { const st = stub(); st.id = sel[0] === '#' ? sel.slice(1) : ''; st.attributes = st.id ? [{ name: 'id', value: st.id }] : []; st.getAttribute = (k) => (k === 'id' ? st.id : null); st.closest = () => null; if (doc) st.focus = () => { doc.activeElement = st; }; parts[sel] = st; }
    return parts[sel];
  };
  const dom = () => {
    const html = ['#gs-tools', '#gs-filters', '#gs-dyn'].map((k) => (parts[k] ? parts[k].innerHTML : '')).join('');
    if (html !== cache.html) { cache.html = html; cache.nodes = parseHTML(html, doc || {}); }
    return cache.nodes;
  };
  const w = { isConnected: true, handlers: {}, sels, parts, dom, addEventListener(t, f) { this.handlers[t] = f; },
    /* Faux bouton ou zone fixe : dans la vue. Élément relu : seulement s'il est encore dans le rendu courant. */
    contains(n) { return !!n && (!('tag' in n) || dom().includes(n)); },
    querySelector(sel) {
      sels.push(sel);
      if (!okSel(sel)) throw new SyntaxError('invalid selector ' + sel);
      if (STUBS.has(sel) || !doc) return part(sel);
      return dom().find((n) => matchSel(n, sel)) || null;
    },
    querySelectorAll(sel) { sels.push(sel); if (!okSel(sel)) throw new SyntaxError('invalid selector ' + sel); return doc ? dom().filter((n) => matchSel(n, sel)) : []; } };
  return w;
}
/* Tiroir simulé : garde le HTML ouvert et fournit la zone #gs-pv que « Ce qui change » réécrit après la réponse. */
function drawerKit(win, SA) {
  const k = { html: '', pvId: null, pvHTML: '' };
  SA.openDrawer = (html) => { k.html = html; SA.drawerOpen = true; const m = html.match(/id="gs-pv"[^>]*?data-id="([^"]*)"/); k.pvId = m ? unesc(m[1]) : null; k.pvHTML = ''; };
  SA.closeDrawer = () => { SA.drawerOpen = false; };
  win.__ids = win.__ids || {};
  win.__ids['gs-pv'] = { getAttribute: (a) => (a === 'data-id' ? k.pvId : null), contains: () => false, querySelector: () => null, focus() {},
    set innerHTML(v) { k.pvHTML = v; }, get innerHTML() { return k.pvHTML; } };
  k.text = () => k.html + k.pvHTML;
  return k;
}
async function liveGestion(edit, extra = {}) {
  const s = makeServer();
  if (edit) edit(s.state, s);
  const w = makeWin(s, false, Object.assign({ setTimeout: quietTimer }, extra));
  const ready = await w.SA.live.ready;
  w.SA.go = () => true; w.SA.setRoute = () => true;
  w.SA.state.route = 'gestion';
  const doc = w.win.document;
  const wr = strictWrap(doc);
  w.SA.views.gestion.mount({ querySelector(sel) { return sel === '.gs' ? wr : null; } });
  /* Premier rendu : le contenu de #gs-dyn, comme le navigateur l'aurait. */
  wr.querySelector('#gs-dyn').innerHTML = (w.SA.views.gestion.render().match(/<div id="gs-dyn" data-st>([\s\S]*)<\/div><\/div>$/) || [])[1] || '';
  /* Un clic sur un élément rendu : il prend le focus d'abord, comme dans le navigateur. Sinon, un faux bouton. */
  const find = (attrs) => { const k = Object.keys(attrs); return wr.dom().find((n) => k.every((a) => n.attrs[a] === attrs[a])) || null; };
  const clickW = async (attrs) => {
    let e = null;
    const n = find(attrs);
    if (n) doc.activeElement = n;
    try { wr.handlers.click({ target: n || btn(attrs) }); } catch (x) { e = x; }
    await tick(); return e;
  };
  const keyW = async (key, target) => {
    const ev = { key, target: target || doc.activeElement || {}, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    wr.handlers.keydown(ev); await tick(); return ev;
  };
  const focused = () => doc.activeElement;
  const evW = async (attrs) => { let e = null; try { w.docHandlers.forEach((h) => h({ target: btn(attrs) })); } catch (x) { e = x; } await tick(); return e; };
  return { srv: s, SA: w.SA, win: w.win, wr, doc, ready, click: clickW, key: keyW, find, focused, ev: evW, dyn: () => wr.parts['#gs-dyn'].innerHTML, last: () => s.log[s.log.length - 1] };
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
  const e5 = await t.click({ 'data-gs-all': '' });
  ok(!e5, '5: update all does not throw: ' + (e5 && e5.stack));
  ok(JSON.stringify(t.last().body) === '{"names":["beta"]}', '5: first update not forced');
  ok(SA.state.held && SA.state.held.beta === true, '5: held name kept on SA.state.held: ' + JSON.stringify(SA.state.held));
  ok(!/0 skill mis à jour/.test(t.dyn()) && /beta demande votre lecture/.test(t.dyn()), '5: nothing updated: no « 0 skill mis à jour », only the held name: ' + t.dyn().slice(0, 300));
  /* Plus que des mises à jour retenues : « Tout mettre à jour » n'a rien à faire, il disparaît et ne renvoie rien. */
  ok(t.wr.parts['#gs-all'].hidden === true, '5: update-all hidden when only held updates remain');
  const nHeld = t.srv.log.length;
  await t.click({ 'data-gs-all': '' });
  ok(!t.srv.log.slice(nHeld).some((e) => e.url === '/api/skills/update'), '5: update-all does not resend a held update');
  const dk = drawerKit(t.win, SA);
  SA.views.gestion.openDiff('acme/tools/beta');
  ok(/La nouvelle version ajoute un motif à risque/.test(dk.html), '5: drawer says the new version adds a risky pattern');
  await tick();
  /* Contrat 1.0 : libellé « Mettre à jour malgré l’avertissement » (au lieu de « malgré tout »), après la comparaison. */
  ok(/data-gs-force[^>]*>Mettre à jour malgré l’avertissement</.test(dk.pvHTML), '5: drawer offers the forced update: ' + txt(dk.pvHTML).slice(0, 200));
  clean('5: held drawer', dk.text());
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

/* ---------- 13. constat 61 : la recherche automatique des mises à jour ne bloque pas la page ---------- */
/* Minuterie pilotée : les attentes de 300 ms et plus restent en file, le test les déclenche. */
function heldTimers() {
  const q = [];
  let n = 0;
  return {
    q,
    set: (f, ms, ...a) => (ms >= 300 ? (q.push({ id: 'h' + (++n), f, ms }), 'h' + n) : setTimeout(f, ms, ...a)),
    clear: (id) => { if (typeof id === 'string') { const i = q.findIndex((x) => x.id === id); if (i > -1) q.splice(i, 1); } else clearTimeout(id); },
    fire: (ms) => { const i = q.findIndex((x) => x.ms === ms); if (i < 0) return false; const x = q.splice(i, 1)[0]; x.f(); return true; }
  };
}
{
  /* Serveur qui ne répond pas : la page reste utilisable, la progression est en tête de liste, l'attente s'arrête à 20 s. */
  const T = heldTimers();
  const t = await liveGestion((st, s) => { s.checkOn = true; }, { setTimeout: T.set, clearTimeout: T.clear });
  const head = () => t.wr.parts['#gs-chk'] ? t.wr.parts['#gs-chk'].textContent : '';
  t.srv.hang = {};
  const h0 = t.srv.hang;
  ok(T.fire(300), '13: automatic check planned at first visit');
  await tick();
  ok(t.srv.log.some((e) => e.url === '/api/skills/check'), '13: automatic check sent');
  ok(/Recherche des mises à jour/.test(head()), '13: progress shown at the head of the list: ' + head());
  ok(!/Recherche des mises à jour/.test(t.dyn()), '13: progress not in the message area');
  ok(t.wr.parts['#gs-check'].disabled === true, '13: the check button waits for the running check');
  ok(!(t.wr.parts['#gs-all'] || {}).disabled, '13: « Tout mettre à jour » stays usable');
  ok(!/data-gs-on="acme\/tools\/beta"[^>]*disabled/.test(t.dyn()), '13: row switches stay usable during the check');
  const n = t.srv.log.length;
  await t.click({ 'data-gs-on': 'acme/tools/beta' });
  ok(t.srv.log.length === n + 1 && t.last().url === '/api/skills/disable', '13: another action runs during the check: ' + t.last().url);
  ok(/désactivé/.test(t.dyn()), '13: its result is shown: ' + txt(t.dyn()).slice(0, 160));
  ok(T.fire(20000), '13: a 20 s limit is set for the automatic check');
  await tick();
  ok(/20 secondes/.test(head()) && /Rechercher les mises à jour/.test(head()) && !/—/.test(head()), '13: after 20 s, a French note at the head of the list: ' + head());
  ok(t.wr.parts['#gs-check'].disabled === false, '13: after 20 s, the check button is usable again');
  const msgBefore = t.dyn();
  if (h0.release) h0.release();
  await tick();
  ok(t.dyn() === msgBefore && /20 secondes/.test(head()), '13: a reply after the limit changes nothing on screen');
  ok(!t.srv.log.slice(n + 1).some((e) => e.url === '/api/state'), '13: a reply after the limit does not reload the state');
}
{
  /* Réponse à temps : l'état est relu sans remonter la vue, une confirmation ouverte reste ouverte. */
  const T = heldTimers();
  const t = await liveGestion((st, s) => { s.checkOn = true; }, { setTimeout: T.set, clearTimeout: T.clear });
  const head = () => t.wr.parts['#gs-chk'] ? t.wr.parts['#gs-chk'].textContent : '';
  let reps = 0;
  t.SA._started = true;
  t.SA.repaint = () => { reps++; };
  await t.click({ 'data-gs-un': 'local/gamma' });
  ok(/data-gs-un-ok="local\/gamma"/.test(t.dyn()), '13: uninstall confirmation open');
  ok(T.fire(300), '13: automatic check planned');
  await tick(12);
  ok(t.srv.log.some((e) => e.url === '/api/state' && e.method === 'GET'), '13: state reloaded after the check');
  ok(reps === 0, '13: the view is not mounted again (a confirmation would close): ' + reps);
  ok(/data-gs-un-ok/.test(t.dyn()), '13: the open confirmation is still there');
  ok(/1 mise à jour trouvée\./.test(head()), '13: result at the head of the list: ' + head());
  ok(!T.q.some((x) => x.ms === 20000), '13: the 20 s limit is cleared once the reply arrived');
}
{
  /* Réponse arrivée sur un autre écran : celui-ci est redessiné avec les nouveaux comptes. */
  const T = heldTimers();
  const t = await liveGestion((st, s) => { s.checkOn = true; }, { setTimeout: T.set, clearTimeout: T.clear });
  let reps = 0;
  t.SA._started = true;
  t.SA.repaint = () => { reps++; };
  t.srv.hang = {};
  const h0 = t.srv.hang;
  T.fire(300);
  await tick();
  t.SA.state.route = 'accueil';
  h0.release();
  await tick(12);
  ok(reps === 1, '13: reply on another screen: that screen is repainted once: ' + reps);
  t.SA.state.route = 'gestion';
}
{
  /* Échec de la recherche automatique : note en tête de liste, pas d'alerte qui prend le focus. */
  const T = heldTimers();
  const t = await liveGestion((st, s) => { s.checkOn = true; }, { setTimeout: T.set, clearTimeout: T.clear });
  const head = () => t.wr.parts['#gs-chk'] ? t.wr.parts['#gs-chk'].textContent : '';
  t.srv.failUrl = { url: '/api/skills/check', status: 502, body: { error: 'NETWORK', message: 'Pas de connexion à GitHub.' } };
  T.fire(300);
  await tick();
  ok(/Pas de connexion à GitHub\./.test(head()), '13: failure told at the head of the list: ' + head());
  ok(!/gs-err/.test(t.dyn()), '13: no alert in the message area for the automatic check');
}
{
  /* Constat 48 : aucun reste de prototype dans Mes skills en mode réel (liste et grille). */
  const t = await liveGestion();
  const LEFT = /prototype|à confirmer|provisoire|ne répare pas|Restaurer depuis un fichier|reste à établir/i;
  const list = t.SA.views.gestion.render();
  ok(!LEFT.test(list), '48: live list without prototype leftovers: ' + (list.match(LEFT) || [''])[0]);
  t.SA.state.g.view = 'grille';
  const grid = t.SA.views.gestion.render();
  ok(!LEFT.test(grid) && /gs-foot/.test(grid), '48: live grid without prototype leftovers: ' + (grid.match(LEFT) || [''])[0]);
  ok(!/<button[^>]*disabled[^>]*>Restaurer depuis/.test(list + grid), '48: no dead button');
  t.SA.state.g.view = 'liste';
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

/* ---------- 12. version 1.0 : confirmation en ligne entière, focus, Échap, sélection visible, restauration à risque ---------- */
const where = (n) => (n ? (n.tag + ' ' + Object.keys(n.attrs).filter((k) => /^data-|^id$|^class$/.test(k)).map((k) => k + '=' + n.attrs[k]).join(' ')) : String(n));
{
  const t = await liveGestion();
  const { SA } = t;
  /* Constats 2 et 3 : la confirmation s'ouvre dans une ligne entière sous le skill, hors de la cellule des gestes. */
  await t.click({ 'data-gs-un': 'acme/tools/alpha' });
  const okB = t.find({ 'data-gs-un-ok': 'acme/tools/alpha' }), noB = t.find({ 'data-gs-un-no': 'acme/tools/alpha' });
  const xr = okB && okB.closest('tr');
  ok(xr && xr.matches('.gs-xr') && xr.getAttribute('data-id') === 'acme/tools/alpha', '12: row confirm sits in a full-width row under the skill: ' + where(xr));
  const xtd = okB && okB.closest('td');
  ok(xtd && xtd.getAttribute('colspan') === '7' && !xtd.matches('.gs-c-act'), '12: confirm cell spans the 7 columns, not the actions cell');
  ok(noB && t.focused() === noB, '12: focus on « Annuler » of the confirm: ' + where(t.focused()));
  ok(/<label class="cfm-k"><button[^>]*data-gs-keep[^>]*>[\s\S]*?<\/button><span>Garder une sauvegarde<\/span><\/label>/.test(t.dyn()), '12: backup box is the product checkbox, its text inside the label');
  /* Constat 55 : Échap annule et rend le focus au bouton d'origine. */
  const esc1 = await t.key('Escape');
  ok(esc1.defaultPrevented && !t.find({ 'data-gs-un-ok': 'acme/tools/alpha' }), '12: Escape closes the row confirm');
  ok(t.focused() && t.focused().getAttribute('data-gs-un') === 'acme/tools/alpha' && t.wr.contains(t.focused()), '12: Escape gives the focus back to « Désinstaller »: ' + where(t.focused()));
  /* Constat 55 : le focus reste sur l'interrupteur après activer ou désactiver. */
  await t.click({ 'data-gs-on': 'acme/tools/beta' });
  ok(t.last().url === '/api/skills/disable', '12: switch calls disable');
  ok(t.focused() && t.focused().getAttribute('data-gs-on') === 'acme/tools/beta' && t.wr.contains(t.focused()), '12: focus stays on the switch after disable: ' + where(t.focused()));
  ok(/1 skill désactivé/.test(t.wr.parts['#gs-live'].textContent), '12: result announced in the status zone: ' + t.wr.parts['#gs-live'].textContent);
  await t.click({ 'data-gs-on': 'acme/tools/beta' });
  ok(t.last().url === '/api/skills/enable' && t.focused() && t.focused().getAttribute('data-gs-on') === 'acme/tools/beta', '12: focus stays on the switch after enable: ' + where(t.focused()));
  /* Formulaire « Sauvegarder » : ligne entière, focus sur le nom, Entrée valide, focus sur le message. */
  await t.click({ 'data-gs-save': 'acme/tools/beta' });
  const lab = t.find({ id: 'gs-save-l' });
  ok(lab && lab.closest('tr') && lab.closest('tr').matches('.gs-xr') && t.focused() === lab, '12: save form in a full-width row, focus on the name field: ' + where(t.focused()));
  const ent = await t.key('Enter', lab);
  ok(ent.defaultPrevented && t.last().url === '/api/backups/create' && JSON.stringify(t.last().body) === '{"names":["beta"]}', '12: Enter in the name field sends the backup: ' + JSON.stringify(t.last()));
  ok(t.focused() && t.focused().matches('.gs-msg') && t.wr.contains(t.focused()), '12: focus on the result message, not on body: ' + where(t.focused()));
  /* Désinstaller puis confirmer : focus sur le message. */
  await t.click({ 'data-gs-un': 'local/gamma' });
  await t.click({ 'data-gs-un-ok': 'local/gamma' });
  ok(t.last().url === '/api/skills/remove' && t.focused() && t.focused().matches('.gs-msg'), '12: after uninstall, focus on the message: ' + where(t.focused()));
}
{
  /* Échap tapé dans un champ : il agit sur le champ (ou son formulaire) seulement, jamais sur une confirmation de ligne. */
  const t = await liveGestion((st, s) => { s.rougeNames = ['old']; });
  const field = (id) => ({ id, localName: 'input', tagName: 'INPUT', type: id === 'gs-q' ? 'search' : 'text', value: 'al', attrs: { id },
    getAttribute(k) { return k === 'id' ? id : null; }, hasAttribute(k) { return k === 'id'; }, closest() { return null; }, matches(sel) { return sel === '#' + id; }, focus() {} });
  const esc = (target) => { const ev = { key: 'Escape', target, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }; t.wr.handlers.keydown(ev); return ev; };
  await t.click({ 'data-gs-un': 'acme/tools/alpha' });
  let ev = esc(field('gs-q')); await tick();
  ok(t.find({ 'data-gs-un-ok': 'acme/tools/alpha' }), '12: Escape in the search field leaves the row confirm open');
  ok(!ev.defaultPrevented && !ev.stopped, '12: Escape in the search field goes on to the core, which clears the field: ' + JSON.stringify([ev.defaultPrevented, ev.stopped]));
  ev = esc(field('gs-sort')); await tick();
  ok(t.find({ 'data-gs-un-ok': 'acme/tools/alpha' }) && !ev.stopped, '12: Escape in the sort list leaves the row confirm open');
  ev = esc(t.find({ 'data-gs-un-no': 'acme/tools/alpha' })); await tick();
  ok(ev.defaultPrevented && !t.find({ 'data-gs-un-ok': 'acme/tools/alpha' }), '12: Escape on the confirm itself still closes it');
  /* Question « Restaurer malgré tout » : Échap dans la recherche la laisse ouverte. */
  await t.click({ 'data-gs-restore': '0' });
  ok(/data-gs-rg-ok/.test(t.dyn()), '12: ROUGE question open');
  ev = esc(field('gs-q')); await tick();
  ok(/data-gs-rg-ok/.test(t.dyn()) && !ev.stopped, '12: Escape in the search field leaves the ROUGE question open');
  await t.click({ 'data-gs-rg-no': '' });
  /* Formulaire « Sauvegarder » : Échap dans le nom ou la note ferme ce formulaire, rien d'autre. */
  await t.click({ 'data-gs-save': 'acme/tools/beta' });
  ok(t.find({ id: 'gs-save-l' }), '12: save form open');
  ev = esc(t.find({ id: 'gs-save-n' }) || field('gs-save-n')); await tick();
  ok(ev.defaultPrevented && !t.find({ id: 'gs-save-l' }), '12: Escape in the note field closes the save form');
}
{
  /* Constat 78 : les actions groupées ne visent que les lignes affichées, et la confirmation les compte et les nomme. */
  const t = await liveGestion();
  const { SA } = t;
  await t.click({ 'data-gs-sel': 'all' });
  ok(Object.keys(SA.state.g.sel).length === 3, '12: select all selects the 3 shown rows');
  SA.state.g.q = 'beta';
  await t.click({ 'data-gs-f': 'tous' });
  ok(/1<\/span> sélectionné/.test(t.dyn()) && /2 autres masqués par le filtre, non concernés/.test(t.dyn()), '12: bar counts the visible selection and the hidden one: ' + txt(t.dyn()).slice(0, 200));
  await t.click({ 'data-gs-bulk': 'off' });
  ok(t.last().url === '/api/skills/disable' && JSON.stringify(t.last().body) === '{"names":["beta"]}', '12: bulk disable sends the visible row only: ' + JSON.stringify(t.last().body));
  await t.click({ 'data-gs-bulk': 'un' });
  ok(/Désinstaller 1 skill : beta \?/.test(txt(t.dyn())), '12: bulk confirm counts and names the skills: ' + txt(t.dyn()).slice(0, 200));
  ok(t.focused() && t.focused().getAttribute('data-gs-bulk') === 'un-no', '12: focus on « Annuler » of the bulk confirm: ' + where(t.focused()));
  await t.key('Escape');
  ok(!/data-gs-bulk="un-ok"/.test(t.dyn()) && t.focused() && t.focused().getAttribute('data-gs-bulk') === 'un', '12: Escape cancels the bulk confirm, focus back on « Désinstaller »: ' + where(t.focused()));
  await t.click({ 'data-gs-bulk': 'un' });
  await t.click({ 'data-gs-bulk': 'un-ok' });
  ok(t.last().url === '/api/skills/remove' && JSON.stringify(t.last().body.names) === '["beta"]', '12: bulk uninstall sends the visible row only: ' + JSON.stringify(t.last().body));
}
{
  /* Constats 32 et 47 : restaurer depuis Mes skills une sauvegarde à risque pose la question, puis renvoie avec force. */
  const t = await liveGestion((st, s) => { s.rougeNames = ['old']; });
  await t.click({ 'data-gs-restore': '0' });
  ok(t.last().url === '/api/backups/restore' && JSON.stringify(t.last().body) === '{"id":"20261112-101010-old"}', '12: first restore is not forced');
  ok(/Ce skill porte un motif à risque\. Restaurer malgré tout \?/.test(t.dyn()) && /data-gs-rg-ok/.test(t.dyn()) && !/note-bad/.test(t.dyn()), '12: ROUGE refusal asks a real question, not an error: ' + txt(t.dyn()).slice(0, 300));
  ok(t.focused() && t.focused().hasAttribute('data-gs-rg-no'), '12: focus on « Annuler » of the question: ' + where(t.focused()));
  await t.key('Escape');
  ok(!/data-gs-rg-ok/.test(t.dyn()) && t.focused() && t.focused().hasAttribute('data-gs-restore'), '12: Escape cancels, focus back on « Restaurer la plus récente »: ' + where(t.focused()));
  await t.click({ 'data-gs-restore': '0' });
  const e = await t.click({ 'data-gs-rg-ok': '' });
  ok(!e, '12: confirm does not throw: ' + (e && e.stack));
  ok(JSON.stringify(t.last().body) === '{"id":"20261112-101010-old","force":["old"]}', '12: confirm resends with force: ' + JSON.stringify(t.last().body));
  ok(/restaurée/.test(t.dyn()) && t.focused() && t.focused().matches('.gs-msg'), '12: success message, focused: ' + where(t.focused()));
}
{
  /* Constats 16 et 35 : aucun reste de prototype, en mode réel comme en démonstration. */
  const t = await liveGestion();
  const LEFT = /Restaurer depuis un fichier|Format provisoire|pas encore|à confirmer|data-gs-export|prototype/i;
  const h = t.SA.views.gestion.render();
  ok(!LEFT.test(h), '12: live list without leftovers: ' + (h.match(LEFT) || [''])[0]);
  t.SA.state.g.view = 'grille';
  const gh = t.SA.views.gestion.render();
  ok(!LEFT.test(gh), '12: live grid without leftovers: ' + (gh.match(LEFT) || [''])[0]);
  ok(/data-go-route="sauvegardes"/.test(h) && /exportez la sauvegarde depuis l’écran Sauvegardes/.test(h), '12: moving machines points to the Sauvegardes screen');
}

/* ---------- 13. constats 54 et 56 : contraste des bords de champ et du texte indicatif, dans les deux thèmes ---------- */
{
  const shell = fs.readFileSync(path.join(root, 'src', 'shell.css'), 'utf8');
  const v2 = fs.readFileSync(path.join(root, 'src', 'views', 'v2.css'), 'utf8');
  const tok = (block, name) => { const m = block.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})')); return m && m[1]; };
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const light = shell.slice(0, shell.indexOf('prefers-color-scheme')), dark = shell.slice(shell.indexOf('prefers-color-scheme'));
  ok(/\.fld \{[^}]*border: 1px solid var\(--ink-3\)/.test(v2), '54: field border uses --ink-3');
  ok(/\.fld::placeholder \{ color: var\(--ink-3\); opacity: 1; \}/.test(v2), '56: placeholder uses --ink-3 at full opacity');
  for (const [label, b] of [['clair', light], ['sombre', dark]]) {
    const r = ratio(tok(b, 'ink-3'), tok(b, 'bg'));
    ok(r >= 4.5, '54/56: --ink-3 on --bg ' + label + ' = ' + r.toFixed(2) + ' (3:1 for borders, 4.5:1 for text)');
  }
}
/* Constats 16 et 35 en démonstration aussi : aucun bouton mort, aucune note de prototype. */
{
  const ctx3 = vm.createContext({ matchMedia: null, setTimeout, clearTimeout, console, document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, documentElement: { getAttribute() { return null; }, setAttribute() {} } } });
  ctx3.window = ctx3;
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), ctx3, { filename: f });
  ctx3.SA.initState({ route: 'gestion' });
  const LEFT = /Restaurer depuis un fichier|Format provisoire|pas encore|à confirmer|data-gs-export/;
  const h = ctx3.SA.views.gestion.render();
  ok(!LEFT.test(h), '13: demo list without leftovers: ' + (h.match(LEFT) || [''])[0]);
  ctx3.SA.state.g.view = 'grille';
  ok(!LEFT.test(ctx3.SA.views.gestion.render()), '13: demo grid without leftovers');
  ok(!/>À relire<\/button>|>Avertissement</.test(h) && /Motif à risque/.test(h), '13: demo badges use the verdict names of the contract');
}
console.log(`${checks} checks, ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
