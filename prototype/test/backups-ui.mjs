// Écran Sauvegardes et action « Sauvegarder » de Mes skills, en mode démo et en mode réel (fetch simulé).
// Même approche que live.mjs : les fichiers du build tournent dans une vm, sans DOM, sans réseau, sans écriture.
// Run: node test/backups-ui.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildSrc = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8');
const files = [...buildSrc.match(/const JS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const cssFiles = [...buildSrc.match(/const CSS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.error('FAIL', msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '\n  attendu ' + JSON.stringify(b) + '\n  obtenu  ' + JSON.stringify(a)); }
const BAD = /undefined|NaN|\[object Object\]|\bnull\b|—/;
function clean(label, html) {
  const h = String(html), m = h.match(BAD);
  ok(!m, label + (m ? ' contient "' + m[0] + '": …' + h.slice(Math.max(0, h.search(BAD) - 80), h.search(BAD) + 60) : ''));
}
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const txt = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

ok(files.includes('views/sauvegardes.js'), 'build : views/sauvegardes.js dans la liste JS');
ok(cssFiles.includes('views/sauvegardes.css'), 'build : views/sauvegardes.css dans la liste CSS');
const index = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
ok(/data-route="sauvegardes"[\s\S]*?<span>Sauvegardes<\/span>/.test(index), 'index.html : entrée « Sauvegardes » dans le rail');
ok(index.indexOf('data-route="gestion"') < index.indexOf('data-route="sauvegardes"') && index.indexOf('data-route="sauvegardes"') < index.indexOf('data-route="agents"'), 'index.html : Sauvegardes entre Mes skills et Agents');

/* ---------- faux DOM ---------- */
function stub() {
  return { textContent: '', innerHTML: '', hidden: false, value: '', style: { setProperty() {} },
    querySelector() { return stub(); }, querySelectorAll() { return []; }, addEventListener() {}, focus() {}, setAttribute() {}, removeAttribute() {},
    classList: { add() {}, remove() {}, toggle() {} } };
}
function btn(attrs) {
  return { attrs, disabled: false, hasAttribute(n) { return n in attrs; }, getAttribute(n) { return n in attrs ? attrs[n] : null; },
    closest(sel) {
      if (sel === 'button') return this;
      const m = sel.match(/^\[([\w-]+)\]$/);
      return m && m[1] in attrs ? this : null;
    } };
}
function makeWin(fetchFn, liveOn) {
  const handlers = {}, els = {}, links = [], urls = [], flags = {};
  const win = { matchMedia: null, setTimeout, clearTimeout, Promise, JSON, Date, Math, encodeURIComponent, fetch: fetchFn };
  if (liveOn) win.SA_LIVE = { token: TOKEN };
  win.console = { log() {}, warn() {}, error(...a) { if (String(a[0]).indexOf('[Skill Advisor]') !== 0) console.error(...a); } };
  win.window = win;
  win.URL = { createObjectURL(b) { urls.push(b); return 'blob:essai-' + urls.length; }, revokeObjectURL() {} };
  win.document = {
    readyState: 'complete',
    addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); },
    /* Sans #view, SA.repaint ne fait rien ; flags.view le fournit le temps d'un changement de route. */
    getElementById(id) { return id === 'view' && !flags.view ? null : (els[id] = els[id] || stub()); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement(tag) { const a = { tag, href: '', download: '', clicked: 0, style: {}, setAttribute(k, v) { this[k] = v; }, click() { this.clicked++; } }; links.push(a); return a; },
    body: { appendChild(n) { n.attached = true; return n; }, removeChild(n) { n.attached = false; return n; } },
    documentElement: { getAttribute() { return null; }, setAttribute() {} }
  };
  const ctx = vm.createContext(win);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), ctx, { filename: f });
  const SA = win.SA;
  SA.sync = () => {};
  const drawer = { html: '', title: '', n: 0 };
  SA.openDrawer = (html, title) => { drawer.html = html; drawer.title = title; drawer.n++; SA.drawerOpen = true; };
  SA.closeDrawer = () => { SA.drawerOpen = false; };
  return { win, SA, handlers, els, links, urls, drawer, flags };
}
/* Conteneur de la vue Mes skills, comme dans live.mjs. */
function gsWrap() {
  const parts = {};
  return { isConnected: true, handlers: {}, parts, addEventListener(t, f) { this.handlers[t] = f; }, contains() { return true; },
    querySelector(sel) { return (parts[sel] = parts[sel] || stub()); }, querySelectorAll() { return []; } };
}
function mountGestion(SA) {
  const w = gsWrap();
  SA.views.gestion.mount({ querySelector(sel) { return sel === '.gs' ? w : null; } });
  const click = async (attrs) => { w.handlers.click({ target: btn(attrs) }); await tick(); };
  const type = (id, value) => w.handlers.input({ target: { id, value } });
  return { w, click, type, dyn: () => w.parts['#gs-dyn'].innerHTML };
}

/* ======================================================= 1. mode démo */
const TOKEN = 'b'.repeat(64);
{
  let calls = 0;
  const d = makeWin(() => { calls++; return Promise.reject(new Error('aucun réseau en démo')); }, false);
  const { SA, links } = d;
  const V = SA.views.sauvegardes;
  ok(V && typeof V.render === 'function' && V._do, 'demo : vue sauvegardes enregistrée avec _do');
  ok(Array.isArray(SA.data.backups) && SA.data.backups.length >= 4, 'demo : sauvegardes d’exemple dans machine-data.js');
  eq([...new Set(SA.data.backups.map((b) => b.origin))].sort(), ['import', 'manual', 'remove', 'replace'], 'demo : une sauvegarde par origine');
  ok(SA.data.backups.every((b) => Array.isArray(b.items) && b.items.length && b.id && b.label && b.at && b.size > 0), 'demo : forme Backup complète');
  ok(SA.data.backups.some((b) => b.items.some((i) => i.verdict === 'rouge')), 'demo : un élément rouge pour l’avertissement');
  const ids = new Set(SA.data.agents.map((a) => a.id));
  ok(SA.data.backups.every((b) => b.items.every((i) => i.agents.every((a) => ids.has(a)))), 'demo : agents des sauvegardes = ids de la démo');

  /* l'état par défaut reste vide (live.mjs, agents.mjs) ; la démo se remplit au démarrage et au réglage « Machine » */
  SA.initState();
  eq(SA.state.backups.length, 0, 'demo : initState garde backups vide');
  ok(typeof SA.demoBackups === 'function' && SA.demoBackups().length === SA.data.backups.length, 'demo : SA.demoBackups()');
  ok(SA.demoBackups()[0] !== SA.data.backups[0] && SA.demoBackups()[0].items !== SA.data.backups[0].items, 'demo : copies, pas les objets d’origine');
  SA.setPv('machine', 'vide');
  eq(SA.state.backups.length, 0, 'demo : machine vide, aucune sauvegarde');
  SA.setPv('machine', 'pleine');
  eq(SA.state.backups.length, SA.data.backups.length, 'demo : machine pleine, sauvegardes d’exemple');

  /* route */
  SA.state.route = 'gestion';
  d.flags.view = true;
  SA.setRoute('sauvegardes');
  d.flags.view = false;
  eq(SA.state.route, 'sauvegardes', 'demo : SA.setRoute accepte « sauvegardes »');
  eq(SA.viewId(), 'sauvegardes', 'demo : viewId');
  clean('dossier sauvegardes', SA._dossier());

  /* écran */
  SA.initState({ route: 'sauvegardes', backups: SA.demoBackups() });
  let html = V.render();
  clean('demo render', html);
  for (const o of ['à la suppression', 'à la demande', 'importée', 'avant remplacement']) ok(html.indexOf(o) > -1, 'demo : origine « ' + o + ' »');
  for (const b of ['Restaurer', 'Appliquer à d’autres agents', 'Exporter', 'Supprimer', 'Importer une sauvegarde']) ok(html.indexOf(b) > -1, 'demo : bouton « ' + b + ' »');
  ok(/accept="[^"]*\.tar\.gz/.test(html), 'demo : champ fichier .tar.gz');
  ok(/\d+(,\d)? (Ko|Mo|o)\b/.test(txt(html)), 'demo : taille affichée');
  ok(/bdg bad/.test(html), 'demo : badge du verdict rouge');
  const multi = SA.state.backups.find((b) => b.items.length > 1);
  ok(multi && txt(html).indexOf(multi.items.length + ' skills') > -1, 'demo : nombre d’éléments');

  /* valeurs hostiles échappées */
  SA.state.backups.unshift({ id: 'x"><b>', label: '<img src=x onerror=alert(1)>', note: 'a & "b"', origin: 'manual', at: '2026-11-13T09:00:00.000Z', size: 12,
    items: [{ name: 'we"ird<', src: '<s>', agents: ['claude'], verdict: 'vert' }] });
  html = V.render();
  ok(!/<img src=x/.test(html) && !/<b>/.test(html) && !/we"ird</.test(html) && !/<s>/.test(html), 'demo : valeurs échappées');
  ok(/&lt;img src=x/.test(html), 'demo : libellé échappé visible');
  SA.state.backups.shift();

  /* ancienne forme (ligne retirée par Mes skills ou Agents) */
  SA.state.backups.push(Object.assign({}, SA.data.mine[0]));
  html = V.render();
  clean('demo render ancienne forme', html);
  ok(html.indexOf(SA.data.mine[0].name) > -1, 'demo : ancienne forme lue comme un élément');
  SA.state.backups.pop();

  /* exporter : l'application locale est nécessaire */
  const n0 = links.length;
  await V._do.exportB(SA.state.backups[0].id);
  ok(links.length === n0 && /application locale/.test(V.render()), 'demo : export expliqué, rien de téléchargé');

  /* importer : expliqué aussi */
  await V._do.importFile({ name: 'a.tar.gz', size: 10 });
  ok(/application locale/.test(V.render()) && calls === 0, 'demo : import expliqué, aucun appel');

  /* restaurer en mémoire */
  const rb = SA.state.backups.find((b) => b.origin === 'manual');
  const before = SA.state.mine.length;
  const fresh = rb.items.filter((i) => !SA.state.mine.some((r) => r.name === i.name)).length;
  await V._do.restore(rb.id);
  ok(SA.state.mine.length === before + fresh, 'demo : restaurer remet les skills absents : ' + (SA.state.mine.length - before) + ' / ' + fresh);
  ok(!SA.state.backups.some((b) => b.id === rb.id), 'demo : sauvegarde restaurée retirée de la liste');
  ok(/restaur/i.test(V.render()), 'demo : message de restauration');

  /* restaurer quand le skill est déjà là : refus, comme le serveur (EXISTS) */
  const name0 = SA.state.mine[0].name;
  SA.state.backups.unshift({ id: 'dup', label: 'Doublon', origin: 'manual', at: '2026-11-13T09:00:00.000Z', size: 10, items: [{ name: name0, src: 'x/y', agents: ['claude'], verdict: 'vert' }] });
  const m1 = SA.state.mine.length;
  await V._do.restore('dup');
  ok(SA.state.mine.length === m1 && SA.state.backups.some((b) => b.id === 'dup'), 'demo : restauration refusée si le skill existe');
  ok(/existe déjà/.test(V.render()) && /role="alert"/.test(V.render()), 'demo : refus affiché');

  /* supprimer : confirmation d'abord */
  V._do.askDelete('dup');
  html = V.render();
  ok(/Supprimer cette sauvegarde/.test(html) && /data-sv-del-ok/.test(html), 'demo : confirmation de suppression');
  V._do.cancelDelete();
  ok(!/data-sv-del-ok/.test(V.render()), 'demo : annuler la suppression');
  V._do.askDelete('dup');
  await V._do.confirmDelete();
  ok(!SA.state.backups.some((b) => b.id === 'dup'), 'demo : sauvegarde supprimée');

  /* appliquer à d'autres agents */
  const ab = SA.state.backups.find((b) => b.items.some((i) => i.verdict === 'rouge'));
  SA.state.agents = { claude: true, cursor: true };
  V._do.openApply(ab.id);
  let dr = d.drawer.html;
  clean('demo apply drawer', dr);
  ok(d.drawer.title && /Appliquer/.test(d.drawer.title), 'demo : tiroir ouvert');
  ok(ab.items.every((i) => dr.indexOf(i.name) > -1), 'demo : chaque élément listé');
  eq(Object.keys(V._do.ap().names).filter((n) => V._do.ap().names[n]).sort(), ab.items.map((i) => i.name).sort(), 'demo : tous les éléments cochés');
  eq(Object.keys(V._do.ap().agents).filter((k) => V._do.ap().agents[k]).sort(), ['claude', 'cursor'], 'demo : agents cochés = cibles');
  ok(/Si le skill existe déjà/.test(dr) && /Passer/.test(dr) && /Remplacer/.test(dr), 'demo : choix du conflit');
  ok(/Appliquer malgré l’avertissement/.test(dr), 'demo : case pour forcer un élément rouge');
  V._do.setConflict('replace');
  ok(/Le dossier partagé ~\/\.agents\/skills sera remplacé/.test(V._do.drawerHTML()) && /concernés : [^<]*Claude Code/.test(V._do.drawerHTML()), 'demo : « Remplacer » prévient pour le dossier partagé');
  V._do.setConflict('skip');
  ok(/type="checkbox"[^>]*data-sv-ap-item/.test(dr) && /checked/.test(dr), 'demo : cases à cocher');
  const undet = SA.agents().find((a) => a.st === 'no' && !a.custom);
  ok(undet && dr.indexOf('data-sv-ap-agent="' + undet.id + '"') < 0, 'demo : agent non détecté caché sans recherche : ' + (undet && undet.id));
  V._do.setQuery(undet.name.slice(0, 3));
  ok(V._do.drawerHTML().indexOf('data-sv-ap-agent="' + undet.id + '"') > -1, 'demo : recherche montre un agent non détecté');
  V._do.setQuery('');
  /* agent ajouté à la main en démo (id c1) : accepté par l'application */
  SA.state.custom = [{ id: 'c1', name: 'Outil maison', st: 'ok', sig: ['man'], cmd: '', rel: '', abs: '/opt/outil', custom: true }];
  V._do.openApply(ab.id);
  ok(/Outil maison/.test(d.drawer.html), 'demo : agent ajouté à la main listé');
  V._do.setAgent('c1', true);
  await V._do.submitApply();
  ok(V._do.ap().result && V._do.ap().result.applied.some((x) => x.agent === 'c1'), 'demo : application à un agent ajouté à la main');
  SA.state.custom = [];
  const rouge = ab.items.find((i) => i.verdict === 'rouge');
  /* un skill déjà là pour un agent : passé, puis remplacé avec une sauvegarde « avant remplacement » */
  const row = SA.state.mine.find((r) => r.kind !== 'plugin');
  ab.items.push({ name: row.name, src: row.src, agents: ['claude'], verdict: 'vert' });
  V._do.openApply(ab.id);
  V._do.setAgent('claude', true); V._do.setAgent('cursor', false);
  row.ag.claude = 'ok';
  await V._do.submitApply();
  let res = V._do.ap().result;
  ok(res && res.skipped.some((s) => s.name === row.name && s.agent === 'claude'), 'demo : conflit passé : ' + JSON.stringify(res));
  ok(res.skipped.some((s) => s.name === rouge.name) || res.failed.some((s) => s.name === rouge.name), 'demo : élément rouge non forcé laissé de côté');
  clean('demo apply result', d.drawer.html);
  ok(/Passé/.test(d.drawer.html), 'demo : résultat par élément et agent');
  const nb = SA.state.backups.length;
  V._do.openApply(ab.id);
  V._do.setAgent('claude', true); V._do.setAgent('cursor', false);
  V._do.setConflict('replace');
  V._do.setForce(rouge.name, true);
  await V._do.submitApply();
  res = V._do.ap().result;
  ok(res.applied.some((s) => s.name === row.name && s.agent === 'claude'), 'demo : remplacé');
  ok(res.applied.some((s) => s.name === rouge.name), 'demo : élément rouge forcé appliqué');
  ok(SA.state.backups.length === nb + 1 && SA.state.backups[0].origin === 'replace', 'demo : sauvegarde « avant remplacement » faite');
  ok(SA.state.mine.some((r) => r.name === rouge.name && r.ag.claude === 'ok'), 'demo : skill appliqué visible dans Mes skills');
  ok(/Appliqué/.test(d.drawer.html), 'demo : résultat appliqué affiché');
  /* rien de choisi : message, rien n'est fait */
  V._do.openApply(ab.id);
  Object.keys(V._do.ap().agents).forEach((k) => V._do.setAgent(k, false));
  await V._do.submitApply();
  ok(!V._do.ap().result && /au moins un agent/.test(d.drawer.html), 'demo : aucun agent choisi, message');

  /* Mes skills : action « Sauvegarder » en mémoire */
  SA.initState({ route: 'gestion', backups: [] });
  const g = mountGestion(SA);
  const [r1, r2] = SA.state.mine.filter((r) => r.kind !== 'plugin');
  SA.state.g.sel = { [r1.id]: true, [r2.id]: true };
  await g.click({ 'data-gs-bulk': 'clear' });
  SA.state.g.sel = { [r1.id]: true, [r2.id]: true };
  await g.click({ 'data-gs-bulk': 'x' });
  ok(/data-gs-bulk="save"/.test(g.dyn()), 'demo gestion : action groupée « Sauvegarder »');
  await g.click({ 'data-gs-bulk': 'save' });
  ok(/id="gs-save-l"[^>]*maxlength="80"|maxlength="80"[^>]*id="gs-save-l"/.test(g.dyn()) && /maxlength="500"/.test(g.dyn()), 'demo gestion : nom et note, longueurs bornées');
  g.type('gs-save-l', 'Avant le salon');
  g.type('gs-save-n', 'Version stable');
  await g.click({ 'data-gs-f': 'tous' });
  ok(/value="Avant le salon"/.test(g.dyn()), 'demo gestion : le nom tapé survit au rafraîchissement');
  await g.click({ 'data-gs-save-ok': '' });
  const nbk = SA.state.backups[0];
  ok(SA.state.backups.length === 1 && nbk.origin === 'manual' && nbk.label === 'Avant le salon' && nbk.note === 'Version stable', 'demo gestion : sauvegarde manuelle : ' + JSON.stringify(nbk && { origin: nbk.origin, label: nbk.label }));
  eq(nbk.items.map((i) => i.name).sort(), [r1.name, r2.name].sort(), 'demo gestion : éléments de la sauvegarde');
  ok(/Sauvegarde faite/.test(g.dyn()), 'demo gestion : message');
  /* action de ligne */
  ok(new RegExp('data-gs-save="' + r1.id.replace(/[/.]/g, '\\$&') + '"').test(SA.views.gestion.render()), 'demo gestion : action de ligne « Sauvegarder »');
  await g.click({ 'data-gs-save': r1.id });
  g.type('gs-save-l', '');
  await g.click({ 'data-gs-save-ok': '' });
  ok(SA.state.backups.length === 2 && SA.state.backups[0].items.length === 1 && SA.state.backups[0].label, 'demo gestion : sauvegarde d’une ligne, libellé par défaut');
  /* résumé en bas de Mes skills, lien vers l'écran */
  const gh = SA.views.gestion.render();
  ok(/data-go-route="sauvegardes"/.test(gh), 'demo gestion : lien vers Sauvegardes');
  ok(/2 sauvegardes/.test(txt(gh)), 'demo gestion : résumé du nombre');
  ok(!/data-gs-bk-del="1"/.test(gh), 'demo gestion : plus la liste complète');
  clean('demo gestion', gh);
  ok(calls === 0, 'demo : aucun appel réseau');
}

/* ======================================================= 2. mode réel */
const HOME = '/Users/test';
function liveState() {
  return {
    mode: 'live', os: 'mac', home: HOME, cwd: '/w',
    agents: [
      { id: 'claude-code', name: 'Claude Code', detected: true, top: true, universal: false, globalDir: HOME + '/.claude/skills', custom: false, hidden: false, target: true, count: 1 },
      { id: 'cursor', name: 'Cursor', detected: true, top: true, universal: false, globalDir: HOME + '/.cursor/skills', custom: false, hidden: false, target: false, count: 0 },
      { id: 'codex', name: 'Codex', detected: false, top: true, universal: true, globalDir: null, custom: false, hidden: false, target: false, count: 0 },
      { id: 'zed', name: 'Zed', detected: false, top: false, universal: false, globalDir: HOME + '/.zed/skills', custom: false, hidden: false, target: false, count: 0 },
      { id: 'custom-1', name: 'Mon outil', detected: false, top: false, universal: false, globalDir: '/opt/outil/skills', custom: true, hidden: false, target: false, count: 0 }
    ],
    mine: [
      { id: 'acme/tools/alpha', name: 'alpha', src: 'acme/tools', real: false, st: 'ok', on: true, ag: { 'claude-code': 'ok' }, chars: 10, warn: 0, note: null,
        scan: { verdict: 'vert', findings: [] }, path: HOME + '/.agents/skills/alpha', scope: 'global' },
      { id: 'acme/tools/beta', name: 'beta', src: 'acme/tools', real: false, st: 'ok', on: true, ag: { 'claude-code': 'ok' }, chars: 10, warn: 0, note: null,
        scan: { verdict: 'vert', findings: [] }, path: HOME + '/.agents/skills/beta-dir', scope: 'global' }
    ],
    backups: [
      { id: '20261113-090000-lot', label: 'Lot du matin', note: 'Avant mise à jour', origin: 'manual', at: '2026-11-13T09:00:00.000Z', size: 4096,
        items: [{ name: 'alpha', src: 'acme/tools', agents: ['claude-code'], verdict: 'vert' }, { name: 'risque', src: 'x/y', agents: ['claude-code'], verdict: 'rouge' }, { name: 'gamma', src: null, agents: [], verdict: 'orange' }],
        name: 'alpha', src: 'acme/tools', agents: ['claude-code'] },
      /* sauvegarde d'avant cette étape : pas d'items */
      { id: '20261112-101010-old', name: 'old', src: 'acme/tools', agents: ['claude-code'], at: '2026-11-12T10:10:10.000Z', size: 1234 }
    ],
    settings: { version: 1, custom: [], hidden: [], targets: ['claude-code'] }
  };
}
function makeServer() {
  const srv = { state: liveState(), log: [], failNext: null, applyReply: null, importReply: null };
  srv.fetch = function (url, opts = {}) {
    const headers = opts.headers || {};
    const json = headers['Content-Type'] === 'application/json';
    const entry = { url, method: opts.method || 'GET', headers, token: headers['X-SA-Token'], raw: opts.body, body: json && typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined };
    srv.log.push(entry);
    const reply = (status, data, extra = {}) => ({
      ok: status >= 200 && status < 300, status,
      headers: { get(n) { return (extra.headers || {})[String(n).toLowerCase()] || null; } },
      json: () => (data === undefined ? Promise.reject(new SyntaxError('no json')) : Promise.resolve(JSON.parse(JSON.stringify(data)))),
      blob: () => Promise.resolve(extra.blob)
    });
    if (srv.failNext) { const f = srv.failNext; srv.failNext = null; return Promise.resolve(reply(f.status, f.body)); }
    const st = srv.state, b = entry.body || {};
    if (url === '/api/state') return Promise.resolve(reply(200, st));
    if (url.indexOf('/api/backups/export?id=') === 0) {
      const id = decodeURIComponent(url.split('=')[1]);
      return Promise.resolve(reply(200, undefined, { blob: { size: 3, type: 'application/gzip', id }, headers: { 'content-type': 'application/gzip', 'content-disposition': 'attachment; filename="skill-advisor-' + id + '.tar.gz"' } }));
    }
    let data;
    if (url === '/api/backups/restore' || url === '/api/backups/delete') { st.backups = st.backups.filter((x) => x.id !== b.id); data = { state: st }; }
    else if (url === '/api/backups/create') {
      const bk = { id: '20261113-120000-manuel', label: b.label || 'Sauvegarde', note: b.note || '', origin: 'manual', at: '2026-11-13T12:00:00.000Z', size: 99, items: b.names.map((n) => ({ name: n, src: 'acme/tools', agents: ['claude-code'], verdict: 'vert' })) };
      st.backups = [bk].concat(st.backups);
      data = { backup: bk, failed: [], state: st };
    } else if (url === '/api/backups/apply') data = srv.applyReply ? srv.applyReply(b) : { applied: [], skipped: [], failed: [], backups: [], state: st };
    else if (url === '/api/backups/import') data = srv.importReply || { backup: { id: '20261113-130000-imp', label: 'Importée', origin: 'import', at: '2026-11-13T13:00:00.000Z', size: 10, items: [{ name: 'alpha', src: null, agents: [], verdict: 'orange' }] }, warnings: ['alpha : un motif à relire.'], state: st };
    else return Promise.resolve(reply(404, { error: 'NOT_FOUND', message: 'Route inconnue.' }));
    return Promise.resolve(reply(200, data));
  };
  return srv;
}
async function liveWin() {
  const srv = makeServer();
  const w = makeWin((u, o) => srv.fetch(u, o), true);
  ok(await w.SA.live.ready === true, 'live : état lu');
  w.SA.go = () => true;
  w.SA.state.route = 'sauvegardes';
  return Object.assign(w, { srv, V: w.SA.views.sauvegardes, last: () => srv.log[srv.log.length - 1] });
}

{
  const t = await liveWin();
  const { SA, V, srv } = t;
  ok(typeof SA.live.upload === 'function' && typeof SA.live.download === 'function', 'live : SA.live.upload et SA.live.download');
  ok(SA.state.backups.length === 2 && Array.isArray(SA.state.backups[1].items) && SA.state.backups[1].items.length === 1, 'live : ancienne sauvegarde lue avec un élément');
  let html = V.render();
  clean('live render', html);
  ok(/Lot du matin/.test(html) && /Avant mise à jour/.test(html) && /à la demande/.test(html), 'live : libellé, note, origine');
  ok(/3 skills/.test(txt(html)) && /4 Ko/.test(txt(html)), 'live : nombre et taille');
  ok(/bdg bad/.test(html) && /bdg tr/.test(html), 'live : badges rouge et orange');

  /* restaurer, erreur EXISTS affichée */
  srv.failNext = { status: 409, body: { error: 'EXISTS', message: 'alpha existe déjà dans ~/.agents/skills.' } };
  await V._do.restore('20261113-090000-lot');
  ok(t.last().url === '/api/backups/restore' && t.last().method === 'POST' && t.last().body.id === '20261113-090000-lot', 'live : restore envoie l’id');
  html = V.render();
  ok(/alpha existe déjà dans ~\/\.agents\/skills\./.test(html) && /role="alert"/.test(html), 'live : erreur du serveur affichée');
  ok(SA.state.backups.length === 2, 'live : rien de changé après l’erreur');
  await V._do.restore('20261112-101010-old');
  ok(SA.state.backups.length === 1 && !/existe déjà/.test(V.render()), 'live : restauration faite, état remplacé, erreur effacée');

  /* appliquer */
  srv.applyReply = (b) => ({
    applied: [{ name: 'alpha', agent: 'codex' }],
    skipped: [{ name: 'alpha', agent: 'claude-code', reason: 'identical' }, { name: 'alpha', agent: 'custom-1', reason: 'exists' }, { name: 'gamma', agent: 'codex', reason: 'autre-raison' }, { name: 'risque', agent: 'cursor', reason: 'rouge' }],
    /* agent null : le serveur le met quand l'échec ne vise aucun agent (skill absent de la sauvegarde) */
    failed: [{ name: 'risque', agent: 'codex', message: 'Écriture refusée.' }, { name: 'zeta', agent: null, message: 'Ce skill n’est pas dans la sauvegarde : zeta.' }],
    backups: [{ id: 'r1', origin: 'replace' }], state: srv.state
  });
  V._do.openApply('20261113-090000-lot');
  let dr = t.drawer.html;
  clean('live apply drawer', dr);
  eq(Object.keys(V._do.ap().agents).filter((k) => V._do.ap().agents[k]), ['claude-code'], 'live : agents cochés = cibles');
  ok(dr.indexOf('Claude Code') > -1 && dr.indexOf('Cursor') > -1, 'live : agents détectés listés');
  ok(dr.indexOf('Mon outil') > -1, 'live : agent ajouté à la main listé');
  ok(dr.indexOf('Zed') < 0, 'live : agent non détecté caché sans recherche');
  ok(dr.indexOf('Claude Code') < dr.indexOf('Mon outil'), 'live : détectés d’abord');
  V._do.setQuery('ze');
  ok(/Zed/.test(V._do.drawerHTML()), 'live : la recherche trouve un agent non détecté');
  V._do.setItem('gamma', false);
  V._do.setAgent('codex', true);
  V._do.setAgent('custom-1', true);
  V._do.setConflict('replace');
  V._do.setForce('risque', true);
  await V._do.submitApply();
  const ap = t.last();
  ok(ap.url === '/api/backups/apply' && ap.method === 'POST' && ap.token === TOKEN, 'live : POST /api/backups/apply avec le jeton');
  eq(ap.body, { id: '20261113-090000-lot', names: ['alpha', 'risque'], agents: ['claude-code', 'codex', 'custom-1'], conflict: 'replace', force: ['risque'] }, 'live : charge de apply');
  dr = t.drawer.html;
  clean('live apply result', dr);
  ok(/Appliqué/.test(dr) && /Codex/.test(dr), 'live : appliqué par élément et agent');
  ok(/déjà identique/.test(dr) && /existe déjà/.test(dr), 'live : raisons connues traduites');
  ok(/Passé/.test(dr) && !/autre-raison/.test(dr), 'live : raison inconnue rendue sans le code brut');
  ok(/Écriture refusée\./.test(dr), 'live : échec par élément affiché');
  ok(/motif à risque, non forcé/.test(dr), 'live : raison « rouge » traduite');
  ok(/pas dans la sauvegarde : zeta\./.test(dr), 'live : échec sans agent affiché');
  ok(/1 sauvegarde/.test(txt(dr)) && /avant remplacement/.test(dr), 'live : sauvegarde de la version remplacée signalée');
  /* force ne contient que les éléments rouges cochés */
  V._do.openApply('20261113-090000-lot');
  V._do.setForce('alpha', true);
  V._do.setItem('risque', false);
  V._do.setForce('risque', true);
  await V._do.submitApply();
  eq(t.last().body, { id: '20261113-090000-lot', names: ['alpha', 'gamma'], agents: ['claude-code'], conflict: 'skip' }, 'live : sans élément rouge coché, pas de force');
  /* erreur de apply */
  V._do.openApply('20261113-090000-lot');
  srv.failNext = { status: 400, body: { error: 'BAD_INPUT', message: 'Agent inconnu.' } };
  await V._do.submitApply();
  ok(/Agent inconnu\./.test(t.drawer.html) && /role="alert"/.test(t.drawer.html), 'live : erreur de apply dans le tiroir');
  /* id d'agent non valide : rien n'est envoyé */
  V._do.openApply('20261113-090000-lot');
  V._do.ap().agents['../x'] = true;
  const nA = srv.log.length;
  await V._do.submitApply();
  ok(srv.log.length === nA, 'live : id d’agent non valide, aucun appel');
  /* id bien formé mais inconnu de l'état : rien n'est envoyé non plus */
  V._do.openApply('20261113-090000-lot');
  V._do.ap().agents['inconnu'] = true;
  await V._do.submitApply();
  ok(srv.log.length === nA && /role="alert"/.test(t.drawer.html), 'live : agent inconnu, aucun appel, message');
  /* deux éléments du même nom : un seul nom envoyé */
  srv.state.backups.unshift({ id: '20261113-092000-dbl', label: 'Double', origin: 'manual', at: '2026-11-13T09:20:00.000Z', size: 10,
    items: [{ name: 'alpha', src: null, agents: [], verdict: 'vert' }, { name: 'alpha', src: null, agents: [], verdict: 'vert' }] });
  await SA.live.refresh();
  V._do.openApply('20261113-092000-dbl');
  await V._do.submitApply();
  eq(t.last().body.names, ['alpha'], 'live : noms dédoublonnés');
  srv.state.backups.shift();
  await SA.live.refresh();

  /* un élément rouge nommé comme une propriété d'objet n'est jamais forcé sans la case */
  srv.state.backups.unshift({ id: '20261113-091000-proto', label: 'Proto', origin: 'import', at: '2026-11-13T09:10:00.000Z', size: 10,
    items: [{ name: 'constructor', src: null, agents: [], verdict: 'rouge' }, { name: 'toString', src: null, agents: [], verdict: 'vert' }] });
  await SA.live.refresh();
  V._do.openApply('20261113-091000-proto');
  ok(!/data-sv-ap-force="constructor" checked/.test(t.drawer.html), 'live : case de force non cochée pour « constructor »');
  await V._do.submitApply();
  eq(t.last().body, { id: '20261113-091000-proto', names: ['constructor', 'toString'], agents: ['claude-code'], conflict: 'skip' }, 'live : « constructor » non forcé sans la case');
  srv.applyReply = (b) => ({ applied: [], skipped: [{ name: 'constructor', agent: 'claude-code', reason: 'constructor' }], failed: [], backups: [], state: srv.state });
  V._do.openApply('20261113-091000-proto');
  await V._do.submitApply();
  ok(!/function|native code/.test(t.drawer.html) && /laissé de côté/.test(t.drawer.html), 'live : raison « constructor » rendue sans code');
  SA.state.backups.unshift({ id: 'o', label: 'O', origin: 'constructor', at: '', size: 0, items: [{ name: 'a', verdict: 'toString' }] });
  ok(!/function|native code/.test(V.render()) && /à la suppression/.test(V.render()), 'live : origine et verdict inconnus sans code');
  SA.state.backups.shift();
  srv.state.backups.shift();
  await SA.live.refresh();
  /* une réponse malformée rend la main */
  srv.applyReply = () => ({ applied: [null], skipped: [], failed: [], backups: [], state: srv.state });
  V._do.openApply('20261113-090000-lot');
  await V._do.submitApply();
  ok(!V._do.ap().busy && /role="alert"/.test(t.drawer.html) && !/TypeError/.test(t.drawer.html), 'live : réponse malformée, erreur en français, verrou rendu');
  ok(!/applications? faites?/.test(V.render()), 'live : réponse malformée, aucun bilan annoncé sur l’écran');
  srv.applyReply = null;

  /* exporter */
  const nL = t.links.length;
  await V._do.exportB('20261113-090000-lot');
  const ex = t.last();
  ok(ex.url === '/api/backups/export?id=20261113-090000-lot' && ex.method === 'GET' && ex.token === TOKEN, 'live : GET export avec le jeton : ' + ex.url);
  const a = t.links[t.links.length - 1];
  ok(t.links.length === nL + 1 && a.download === 'skill-advisor-20261113-090000-lot.tar.gz' && a.href === 'blob:essai-' + t.urls.length && a.clicked === 1, 'live : lien de téléchargement : ' + JSON.stringify(a && { d: a.download, h: a.href, c: a.clicked }));
  ok(t.urls[t.urls.length - 1].id === '20261113-090000-lot', 'live : le Blob de la réponse est téléchargé');
  ok(/skill-advisor-20261113-090000-lot\.tar\.gz/.test(V.render()), 'live : message nomme le fichier');
  srv.failNext = { status: 404, body: { error: 'NOT_FOUND', message: 'Sauvegarde introuvable.' } };
  const nL2 = t.links.length;
  await V._do.exportB('20261113-090000-lot');
  ok(t.links.length === nL2 && /Sauvegarde introuvable\./.test(V.render()), 'live : erreur d’export affichée, rien de téléchargé');
  /* nom de fichier douteux dans Content-Disposition : le nom par défaut est pris */
  const realFetch = srv.fetch;
  srv.fetch = (u, o) => u.indexOf('/api/backups/export') === 0
    ? Promise.resolve({ ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === 'content-disposition' ? 'attachment; filename="..evil.command"' : null) }, json: () => Promise.reject(new Error('x')), blob: () => Promise.resolve({ size: 1 }) })
    : realFetch(u, o);
  await V._do.exportB('20261113-090000-lot');
  srv.fetch = realFetch;
  eq(t.links[t.links.length - 1].download, 'skill-advisor-20261113-090000-lot.tar.gz', 'live : nom douteux remplacé par le nom par défaut');

  /* importer */
  const file = { name: 'skill-advisor-x.tar.gz', size: 2048, type: '' };
  await V._do.importFile(file);
  const im = t.last();
  ok(im.url === '/api/backups/import' && im.method === 'POST', 'live : POST /api/backups/import');
  ok(im.headers['Content-Type'] === 'application/gzip' && im.token === TOKEN, 'live : en-têtes de l’import : ' + JSON.stringify(im.headers));
  ok(im.raw === file, 'live : le corps est le fichier lui-même');
  html = V.render();
  ok(/alpha : un motif à relire\./.test(html), 'live : avertissements de l’import affichés');
  ok(/Importée/.test(html), 'live : message de l’import');
  clean('live import', html);
  const nI = srv.log.length;
  await V._do.importFile({ name: 'notes.zip', size: 10 });
  ok(srv.log.length === nI && /\.tar\.gz/.test(V.render()) && /role="alert"/.test(V.render()), 'live : mauvais fichier refusé avant l’envoi');
  await V._do.importFile({ name: 'gros.tar.gz', size: 201 * 1024 * 1024 });
  ok(srv.log.length === nI && /200 Mo/.test(V.render()), 'live : fichier trop gros refusé avant l’envoi');
  srv.failNext = { status: 400, body: { error: 'BAD_ARCHIVE', message: 'Archive non valide : chemin absolu.' } };
  await V._do.importFile(file);
  ok(/Archive non valide : chemin absolu\./.test(V.render()), 'live : refus de l’archive affiché');

  /* supprimer */
  const delId = SA.state.backups[0].id;
  V._do.askDelete(delId);
  await V._do.confirmDelete();
  ok(t.last().url === '/api/backups/delete' && t.last().body.id === delId, 'live : delete envoie l’id');

  /* un clic sur le document avec une cible simulée ne lève pas */
  let thrown = null;
  try { (t.handlers.click || []).forEach((h) => h({ target: btn({ 'data-sv-ap-go': '' }) })); } catch (e) { thrown = e; }
  ok(!thrown, 'live : clic sur le document sans erreur : ' + (thrown && thrown.message));

  /* Mes skills : sauvegarde à la demande */
  SA.state.route = 'gestion';
  const g = mountGestion(SA);
  SA.state.g.sel = { 'acme/tools/alpha': true, 'acme/tools/beta': true };
  await g.click({ 'data-gs-bulk': 'save' });
  g.type('gs-save-l', '  Lot du soir  ');
  g.type('gs-save-n', 'Note');
  await g.click({ 'data-gs-save-ok': '' });
  ok(t.last().url === '/api/backups/create' && t.last().method === 'POST', 'live gestion : POST /api/backups/create');
  eq(t.last().body, { names: ['alpha', 'beta-dir'], label: 'Lot du soir', note: 'Note' }, 'live gestion : charge (noms de dossier)');
  ok(/Sauvegarde faite/.test(g.dyn()), 'live gestion : message');
  ok(SA.state.backups[0].id === '20261113-120000-manuel', 'live gestion : état remplacé');
  await g.click({ 'data-gs-save': 'acme/tools/alpha' });
  await g.click({ 'data-gs-save-ok': '' });
  eq(t.last().body, { names: ['alpha'] }, 'live gestion : sans nom ni note, champs omis');
  /* 80 caractères au plus, sans couper un caractère en deux */
  await g.click({ 'data-gs-save': 'acme/tools/alpha' });
  g.type('gs-save-l', 'a'.repeat(79) + '😀😀');
  await g.click({ 'data-gs-save-ok': '' });
  /* le serveur compte en unités UTF-16 (String.length) : l'emoji qui dépasse est retiré entier */
  eq(t.last().body.label, 'a'.repeat(79), 'live gestion : libellé coupé sans moitié d’emoji');
  ok(t.last().body.label.length <= 80, 'live gestion : libellé de 80 unités au plus');
  await g.click({ 'data-gs-save': 'acme/tools/alpha' });
  g.type('gs-save-l', 'a'.repeat(78) + '😀😀');
  await g.click({ 'data-gs-save-ok': '' });
  eq(t.last().body.label, 'a'.repeat(78) + '😀', 'live gestion : emoji entier gardé quand il tient');
  srv.failNext = { status: 500, body: { error: 'BACKUP_FAILED', message: 'Sauvegarde refusée : plus de 200 Mo.' } };
  await g.click({ 'data-gs-save': 'acme/tools/alpha' });
  await g.click({ 'data-gs-save-ok': '' });
  ok(/Sauvegarde refusée : plus de 200 Mo\./.test(g.dyn()), 'live gestion : erreur affichée');
  clean('live gestion', SA.views.gestion.render());
}

/* ======================================================= 3. relecture : dossier partagé, focus, verrou, ROUGE */
const SHARED = 'Le dossier partagé ~/.agents/skills sera remplacé : tous les agents qui le lisent recevront cette version.';
const sharedBox = (h) => { const m = String(h).match(/id="sv-ap-shared"[^>]*>([\s\S]*?)<\/div>/); return m ? txt(m[1]) : ''; };
function keyEv(key) { return { key, pd: 0, si: 0, preventDefault() { this.pd++; }, stopPropagation() { this.si++; }, stopImmediatePropagation() { this.si++; } }; }
function idTarget(id) { return { id, closest(sel) { return sel === '#' + id ? this : null; } }; }
function clickEv(target) { return Object.assign(keyEv(''), { target }); }
{
  const t = await liveWin();
  const { SA, V, srv, win } = t;
  const ID = '20261113-090000-lot';
  /* Codex lit le dossier partagé et il est détecté ; Cursor a son propre dossier, sans lien vers ces skills. */
  srv.state.agents.find((a) => a.id === 'codex').detected = true;
  await SA.live.refresh();

  /* 7. « Remplacer » prévient que le dossier partagé change pour tous les agents qui le lisent */
  V._do.openApply(ID);
  ok(!sharedBox(V._do.drawerHTML()), '7 : rien en « Passer »');
  V._do.setConflict('replace');
  let box = sharedBox(V._do.drawerHTML());
  ok(box.indexOf(SHARED) > -1, '7 : avertissement en « Remplacer » : ' + box);
  ok(/Claude Code/.test(box) && /Codex/.test(box), '7 : agents concernés nommés, Codex compris sans être coché : ' + box);
  ok(!/Cursor/.test(box) && !/Mon outil/.test(box), '7 : Cursor et l’agent ajouté à la main hors de la liste : ' + box);
  ok(sharedBox('<div id="sv-ap-shared">' + t.els['sv-ap-shared'].innerHTML + '</div>').indexOf(SHARED) > -1, '7 : zone mise à jour au changement du choix');
  V._do.setAgent('claude-code', false);
  V._do.setAgent('custom-1', true);
  ok(!sharedBox(V._do.drawerHTML()) && !/Le dossier partagé/.test(t.els['sv-ap-shared'].innerHTML), '7 : seul un agent ajouté à la main, pas d’avertissement');
  V._do.setAgent('zed', true);
  ok(sharedBox(V._do.drawerHTML()).indexOf(SHARED) > -1, '7 : agent à dossier propre (lien), avertissement');
  V._do.setConflict('skip');
  ok(!/Le dossier partagé/.test(t.els['sv-ap-shared'].innerHTML), '7 : retour à « Passer », avertissement retiré');
  clean('7 drawer', V._do.drawerHTML());
  /* nom de dossier (beta-dir) différent du nom de la ligne (beta) : Cursor, qui a ce skill, est nommé sans être coché */
  srv.state.mine[1].ag = { 'claude-code': 'ok', cursor: 'ok' };
  srv.state.mine.push({ id: 'p/beta-dir', name: 'beta-dir', src: 'p/q', real: false, st: 'ok', on: true, ag: { zed: 'ok' }, chars: 1, warn: 0, note: null,
    scan: { verdict: 'vert', findings: [] }, path: '/w/.agents/skills/beta-dir', scope: 'project' });
  srv.state.agents.find((a) => a.id === 'zed').detected = true;
  srv.state.backups.push({ id: '20261113-093000-beta', label: 'Beta', origin: 'manual', at: '2026-11-13T09:30:00.000Z', size: 10,
    items: [{ name: 'beta-dir', src: 'acme/tools', agents: ['claude-code'], verdict: 'vert' }] });
  await SA.live.refresh();
  V._do.openApply('20261113-093000-beta');
  V._do.setConflict('replace');
  box = sharedBox(V._do.drawerHTML());
  ok(/Cursor/.test(box), '7 : agent lié par le nom de dossier nommé : ' + box);
  ok(!/Zed/.test(box), '7 : ligne de projet ignorée : ' + box);
  srv.state.mine.pop();
  srv.state.mine[1].ag = { 'claude-code': 'ok' };
  srv.state.agents.find((a) => a.id === 'zed').detected = false;
  srv.state.backups.pop();
  await SA.live.refresh();

  /* 9. une application en cours prend le verrou de l'écran */
  const real = srv.fetch;
  let open;
  const gate = new Promise((r) => { open = r; });
  srv.fetch = (u, o) => (u === '/api/backups/apply' ? gate.then(() => real(u, o)) : real(u, o));
  srv.applyReply = () => ({
    applied: [{ name: 'alpha', agent: 'codex' }], skipped: [{ name: 'alpha', agent: 'claude-code', reason: 'identical' }],
    failed: [{ name: 'risque', agent: 'codex', message: 'Écriture refusée.' }], backups: [], warnings: ['alpha : lien de Cursor remplacé.'], state: srv.state
  });
  V._do.openApply(ID);
  V._do.setAgent('codex', true);
  const going = V._do.submitApply();
  await tick();
  let html = V.render();
  const rowBtns = html.match(/<button[^>]*data-sv-(restore|apply|export|del)=[^>]*>/g) || [];
  ok(rowBtns.length >= 8 && rowBtns.every((b) => / disabled/.test(b)), '9 : boutons de la liste désactivés pendant l’appel');
  ok(/data-sv-import[^>]* disabled/.test(html), '9 : import désactivé pendant l’appel');
  ok(/Application en cours/.test(txt(html)), '9 : état affiché sur l’écran');
  ok(/data-sv-ap-cancel[^>]* disabled/.test(V._do.drawerHTML()), '9 : Annuler désactivé pendant l’appel');
  (t.handlers.click || []).forEach((h) => h({ target: btn({ 'data-sv-ap-cancel': '' }) }));
  ok(SA.drawerOpen === true, '9 : Annuler ignoré pendant l’appel');
  const esc1 = keyEv('Escape');
  (t.handlers.keydown || []).forEach((h) => h(esc1));
  ok(esc1.si > 0 && esc1.pd > 0, '9 : Échap arrêté pendant l’appel');
  for (const id of ['drawer-close', 'scrim']) {
    const ev = clickEv(idTarget(id));
    (t.handlers.click || []).forEach((h) => h(ev));
    ok(ev.si > 0, '9 : clic sur ' + id + ' arrêté pendant l’appel');
  }
  const nLog = srv.log.length;
  await V._do.submitApply();
  await V._do.restore(ID);
  ok(srv.log.length === nLog, '9 : aucun autre appel pendant l’application');
  open();
  await going;
  await tick();
  html = V.render();
  ok(!/<button[^>]*data-sv-apply=[^>]* disabled/.test(html), '9 : verrou rendu après l’appel');
  ok(/alpha : lien de Cursor remplacé\./.test(V._do.drawerHTML()), 'warnings : avertissements de apply dans le tiroir');
  /* hors appel, Échap et la croix passent */
  const esc0 = keyEv('Escape');
  (t.handlers.keydown || []).forEach((h) => h(esc0));
  ok(esc0.si === 0, '9 : Échap libre hors appel');
  /* ici le cœur n'a pas fermé le tiroir : la suite prévue après Échap ne touche à rien */
  await tick();
  ok(SA.drawerOpen === true && V._do.ap() !== null, '9 : tiroir resté ouvert, état gardé');
  srv.fetch = real;

  /* 8. après fermeture, le focus revient au bouton « Appliquer » de la ligne, retrouvé par comparaison */
  const focused = [];
  const mk = (fk) => ({ disabled: false, getAttribute(n) { return n === 'data-fk' ? fk : null; }, focus() { focused.push(fk); } });
  win.document.querySelectorAll = (sel) => (sel === '[data-fk]' ? [mk('restore:' + ID), mk('apply:' + ID), mk('apply:autre')] : []);
  (t.handlers.click || []).forEach((h) => h({ target: btn({ 'data-sv-ap-close': '' }) }));
  ok(SA.drawerOpen === false, '8 : Fermer ferme le tiroir');
  await tick();
  eq(focused, ['apply:' + ID], '8 : focus rendu au bouton de la ligne');
  ok(V._do.ap() === null, '8 : tiroir fermé, état du tiroir effacé');

  /* 9. le bilan reste sur l'écran, échecs compris */
  html = V.render();
  ok(/Écriture refusée\./.test(html) && /risque/.test(txt(html)) && /Codex/.test(txt(html)), '9 : bilan par skill gardé sur l’écran, échec compris');
  ok(/déjà identique/.test(html), '9 : passés gardés sur l’écran');
  ok(/alpha : lien de Cursor remplacé\./.test(html) && /À relire après l’application/.test(html) && !/À relire après l’import/.test(html), 'warnings : sur l’écran, titre de l’application');
  clean('9 écran', html);

  /* 8. Échap (fermé par le cœur) et la croix rendent aussi le focus */
  focused.length = 0;
  V._do.openApply(ID);
  (t.handlers.keydown || []).forEach((h) => h(keyEv('Escape')));
  SA.closeDrawer();
  await tick();
  eq(focused, ['apply:' + ID], '8 : focus rendu après Échap');
  focused.length = 0;
  V._do.openApply(ID);
  (t.handlers.click || []).forEach((h) => h(clickEv(idTarget('drawer-close'))));
  SA.closeDrawer();
  await tick();
  eq(focused, ['apply:' + ID], '8 : focus rendu après la croix');
  win.document.querySelectorAll = () => [];
  /* un tiroir d'une autre vue : rien de bloqué ni déplacé */
  focused.length = 0;
  SA.openDrawer('<p>autre</p>', 'Sélection', 'cart');
  const esc2 = keyEv('Escape');
  (t.handlers.keydown || []).forEach((h) => h(esc2));
  ok(esc2.si === 0 && focused.length === 0, '8 : autre tiroir non touché');
  SA.closeDrawer();

  /* un autre geste efface le bilan de l'écran */
  await V._do.exportB(ID);
  ok(!/Écriture refusée\./.test(V.render()) && !/lien de Cursor/.test(V.render()), '9 : bilan effacé par le geste suivant');

  /* réponse malformée : verrou de l'écran rendu, aucun bilan */
  srv.applyReply = () => ({ applied: [null], skipped: [], failed: [], backups: [], state: srv.state });
  V._do.openApply(ID);
  await V._do.submitApply();
  html = V.render();
  ok(!/<button[^>]*data-sv-apply=[^>]* disabled/.test(html) && !/Écriture refusée/.test(html), '9 : réponse malformée, verrou rendu, pas de bilan');
  srv.applyReply = null;
  SA.closeDrawer();

  /* ROUGE : restaurer demande confirmation puis renvoie avec force */
  srv.failNext = { status: 409, body: { error: 'ROUGE', message: 'risque porte un motif à risque.' } };
  await V._do.restore(ID);
  html = V.render();
  ok(/Ce skill porte un motif à risque\. Restaurer malgré tout \?/.test(html), 'ROUGE : question posée : ' + txt(html).slice(0, 300));
  ok(/data-sv-rg-ok/.test(html) && /data-sv-rg-no/.test(html), 'ROUGE : boutons de confirmation');
  ok(!/role="alert"/.test(html), 'ROUGE : pas affiché comme une erreur');
  ok(SA.state.backups.some((b) => b.id === ID), 'ROUGE : rien de restauré');
  clean('ROUGE question', html);
  const nR = srv.log.length;
  V._do.cancelRestore();
  ok(!/Restaurer malgré tout/.test(V.render()) && srv.log.length === nR, 'ROUGE : annuler, rien envoyé');
  srv.failNext = { status: 409, body: { error: 'ROUGE', message: 'risque porte un motif à risque.' } };
  await V._do.restore(ID);
  srv.failNext = { status: 409, body: { error: 'ROUGE', message: 'risque porte encore un motif à risque.' } };
  await V._do.confirmRestore();
  eq(t.last().body, { id: ID, force: ['risque'] }, 'ROUGE : renvoi avec force = éléments rouges');
  ok(/encore un motif/.test(V.render()) && /role="alert"/.test(V.render()) && !/Restaurer malgré tout/.test(V.render()), 'ROUGE : second refus affiché comme une erreur');
  /* le serveur nomme aussi un skill que la sauvegarde ne marque pas rouge (contrôle refait) */
  srv.failNext = { status: 409, body: { error: 'ROUGE', message: 'Les skills alpha, risque ont le verdict rouge.', names: ['alpha', 'risque', 3] } };
  await V._do.restore(ID);
  srv.failNext = { status: 409, body: { error: 'ROUGE', message: 'encore' } };
  await V._do.confirmRestore();
  eq(t.last().body, { id: ID, force: ['risque', 'alpha'] }, 'ROUGE : noms renvoyés par le serveur ajoutés à force');
  /* sans élément marqué rouge : force = tous les éléments */
  srv.state.backups.push({ id: '20261112-101010-old', name: 'old', src: 'acme/tools', agents: ['claude-code'], at: '2026-11-12T10:10:10.000Z', size: 1234 });
  await SA.live.refresh();
  srv.failNext = { status: 409, body: { error: 'ROUGE', message: 'x' } };
  await V._do.restore('20261112-101010-old');
  await V._do.confirmRestore();
  eq(t.last().body, { id: '20261112-101010-old', force: ['old'] }, 'ROUGE : sans rouge connu, force = tous les noms');
  ok(!SA.state.backups.some((b) => b.id === '20261112-101010-old') && /restaurée/.test(V.render()), 'ROUGE : restauration faite après confirmation');
}

console.log(`${checks} checks, ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
