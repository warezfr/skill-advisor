// Socle de l'interface : pont réel (live.js), routeur, clavier et thème (core.js), page (index.html),
// construction (build.mjs) et styles de base (shell.css).
// Les scripts tournent dans node:vm, face à un petit DOM écrit ici, un faux fetch et de faux stockages.
// Run: node test/shell.mjs   (no dependencies, no network, no real home folder)
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.error('FAIL', msg); } }
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

/* =====================================================================================================
   Petit DOM : arbre, attributs, sélecteurs courants, événements qui remontent, focus.
   Comme un navigateur, un élément retiré, désactivé ou caché perd le focus : il retombe sur <body>.
   ===================================================================================================== */
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: '\u00a0' };
const decode = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, k) => {
  if (ENT[k] != null) return ENT[k];
  if (/^#x/i.test(k)) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k[0] === '#') return String.fromCodePoint(+k.slice(1));
  return m;
});
const encode = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class NodeList {
  constructor(a) { a.forEach((n, i) => { this[i] = n; }); this.length = a.length; }
  forEach(f, t) { for (let i = 0; i < this.length; i++) f.call(t, this[i], i, this); }
  item(i) { return this[i] || null; }
}

/* ---------- sélecteurs ---------- */
function splitTop(s, seps) {
  const out = []; let depth = 0, cur = '', q = '';
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (!depth && seps.includes(ch)) { out.push([cur, ch]); cur = ''; continue; }
    cur += ch;
  }
  out.push([cur, '']);
  return out;
}
function parseCompound(s) {
  const c = { tag: null, id: null, cls: [], attrs: [], nots: [], pseudo: [] };
  let rest = s.trim();
  const tag = /^([a-zA-Z][\w-]*|\*)/.exec(rest);
  if (tag) { if (tag[1] !== '*') c.tag = tag[1].toLowerCase(); rest = rest.slice(tag[0].length); }
  while (rest) {
    let m;
    if ((m = /^#([\w-]+)/.exec(rest))) c.id = m[1];
    else if ((m = /^\.([\w-]+)/.exec(rest))) c.cls.push(m[1]);
    else if ((m = /^\[\s*([\w-]+)\s*(?:([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/.exec(rest))) c.attrs.push({ name: m[1], op: m[2] || '', val: m[3] != null ? m[3] : m[4] != null ? m[4] : m[5] });
    else if ((m = /^:not\(([^)]*)\)/.exec(rest))) c.nots.push(parseList(m[1]));
    else if ((m = /^:([\w-]+)/.exec(rest))) c.pseudo.push(m[1]);
    else throw new Error('sélecteur non géré par le DOM de test : ' + s);
    rest = rest.slice(m[0].length);
  }
  return c;
}
function parseComplex(s) {
  const parts = []; let comb = null;
  for (const [chunk, sep] of splitTop(s.trim().replace(/\s*>\s*/g, '>'), [' ', '>'])) {
    if (chunk.trim()) { parts.push({ comb, comp: parseCompound(chunk) }); comb = sep || null; } else if (sep === '>') comb = '>';
  }
  return parts;
}
const selCache = new Map();
function parseList(sel) {
  if (!selCache.has(sel)) selCache.set(sel, splitTop(sel, [',']).map(([c]) => parseComplex(c)).filter((p) => p.length));
  return selCache.get(sel);
}
const FORM = new Set(['button', 'input', 'select', 'textarea']);
function matchCompound(el, c) {
  if (c.tag && el.localName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  const cl = (el.getAttribute('class') || '').split(/\s+/);
  for (const k of c.cls) if (!cl.includes(k)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    const v = el.getAttribute(a.name);
    if (a.op === '=' && v !== a.val) return false;
    if (a.op === '^=' && !v.startsWith(a.val)) return false;
    if (a.op === '$=' && !v.endsWith(a.val)) return false;
    if (a.op === '*=' && !v.includes(a.val)) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.val)) return false;
  }
  for (const p of c.pseudo) {
    if (p === 'disabled') { if (!(FORM.has(el.localName) && el.hasAttribute('disabled'))) return false; }
    else if (p === 'checked') { if (!el.hasAttribute('checked')) return false; }
    else throw new Error('pseudo-classe non gérée par le DOM de test : ' + p);
  }
  for (const n of c.nots) if (n.some((parts) => matchComplex(el, parts))) return false;
  return true;
}
function matchComplex(el, parts, i = parts.length - 1) {
  if (!matchCompound(el, parts[i].comp)) return false;
  if (i === 0) return true;
  const up = el.parentNode;
  if (parts[i].comb === '>') return !!(up && up.nodeType === 1 && matchComplex(up, parts, i - 1));
  for (let p = up; p && p.nodeType === 1; p = p.parentNode) if (matchComplex(p, parts, i - 1)) return true;
  return false;
}
const matches = (el, sel) => parseList(sel).some((parts) => matchComplex(el, parts));

/* ---------- nœuds ---------- */
class Text {
  constructor(t) { this.nodeType = 3; this.data = t; this.parentNode = null; }
  get textContent() { return this.data; }
}
class El {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.nodeType = 1; this.localName = tag.toLowerCase(); this.tagName = tag.toUpperCase();
    this.childNodes = []; this.parentNode = null; this._a = new Map(); this._l = {}; this._v = undefined;
    this.style = { setProperty() {}, removeProperty() {} }; this.scrollTop = 0;
  }
  getAttribute(n) { return this._a.has(n) ? this._a.get(n) : null; }
  hasAttribute(n) { return this._a.has(n); }
  setAttribute(n, v) { this._a.set(n, String(v)); if (n === 'disabled' || n === 'hidden' || n === 'inert') this.ownerDocument._lose(this); }
  removeAttribute(n) { this._a.delete(n); }
  get attributes() { const a = [...this._a].map(([name, value]) => ({ name, value })); return a; }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() {
    const el = this, list = () => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean), set = (l) => el._a.set('class', l.join(' '));
    return {
      contains: (k) => list().includes(k),
      add: (...ks) => { const l = list(); ks.forEach((k) => { if (!l.includes(k)) l.push(k); }); set(l); },
      remove: (...ks) => set(list().filter((k) => !ks.includes(k))),
      toggle: (k, force) => { const has = list().includes(k), on = force === undefined ? !has : !!force; if (on && !has) set(list().concat(k)); if (!on && has) set(list().filter((x) => x !== k)); return on; }
    };
  }
  _flag(n, v) { if (v) this.setAttribute(n, ''); else this.removeAttribute(n); }
  get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { this._flag('hidden', v); }
  get disabled() { return this.hasAttribute('disabled'); } set disabled(v) { this._flag('disabled', v); }
  get inert() { return this.hasAttribute('inert'); } set inert(v) { this._flag('inert', v); }
  get value() { return this._v !== undefined ? this._v : (this.getAttribute('value') || ''); }
  set value(v) { this._v = String(v); }
  get type() { return this.getAttribute('type') || (this.localName === 'button' ? 'submit' : 'text'); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.documentElement; }
  contains(o) { for (let n = o; n; n = n.parentNode) if (n === this) return true; return false; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i > -1) { this.childNodes.splice(i, 1); c.parentNode = null; this.ownerDocument._gone(c); } return c; }
  replaceChild(n, o) {
    const i = this.childNodes.indexOf(o);
    if (n.parentNode) n.parentNode.removeChild(n);
    this.childNodes[i] = n; n.parentNode = this; o.parentNode = null; this.ownerDocument._gone(o);
    return o;
  }
  cloneNode() { const e = new El(this.ownerDocument, this.localName); this._a.forEach((v, k) => e._a.set(k, v)); return e; }
  _clear() { const old = this.childNodes; this.childNodes = []; old.forEach((c) => { c.parentNode = null; this.ownerDocument._gone(c); }); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this._clear(); if (v !== '' && v != null) this.appendChild(new Text(String(v))); }
  get innerHTML() {
    return this.childNodes.map((n) => {
      if (n.nodeType === 3) return encode(n.data);
      const at = [...n._a].map(([k, v]) => ' ' + k + '="' + encode(v) + '"').join('');
      return '<' + n.localName + at + '>' + (VOID.has(n.localName) ? '' : n.innerHTML + '</' + n.localName + '>');
    }).join('');
  }
  set innerHTML(h) { this._clear(); parseInto(this, String(h)); }
  matches(sel) { return matches(this, sel); }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; }
  _walk(out) { for (const c of this.childNodes) if (c.nodeType === 1) { out.push(c); c._walk(out); } return out; }
  querySelectorAll(sel) { return new NodeList(this._walk([]).filter((n) => matches(n, sel))); }
  querySelector(sel) { return this._walk([]).find((n) => matches(n, sel)) || null; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((x) => x !== f); }
  dispatchEvent(e) { return this.ownerDocument._dispatch(this, e); }
  click() { if (!this.disabled) this.dispatchEvent(event('click')); }
  focus() { if (this.ownerDocument._canFocus(this)) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
  getClientRects() { return [1]; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  scrollIntoView() {}
}
function parseInto(parent, html) {
  const doc = parent.ownerDocument;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let cur = parent, m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      let n = cur;
      while (n !== parent && n.localName !== m[1].toLowerCase()) n = n.parentNode;
      if (n !== parent) cur = n.parentNode;
    } else if (m[2]) {
      const el = new El(doc, m[2]);
      const ar = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
      let a;
      while ((a = ar.exec(m[3] || ''))) el._a.set(a[1], decode(a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : ''));
      el.parentNode = cur; cur.childNodes.push(el);
      if (!m[4] && !VOID.has(el.localName)) cur = el;
    } else if (m[5] != null) { const t = new Text(decode(m[5])); t.parentNode = cur; cur.childNodes.push(t); }
  }
}
function event(type, init) {
  return Object.assign({ type, bubbles: true, defaultPrevented: false, _stop: false, key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; } }, init || {});
}
const FOCUSABLE = new Set(['button', 'input', 'select', 'textarea']);
function makeDoc() {
  const doc = { nodeType: 9, _l: {}, readyState: 'complete', visibilityState: 'visible', title: '' };
  const html = new El(doc, 'html'), body = new El(doc, 'body');
  html.appendChild(body);
  Object.assign(doc, {
    documentElement: html, body, activeElement: body, win: null,
    createElement: (t) => new El(doc, t),
    getElementById: (id) => html._walk([]).find((n) => n.getAttribute('id') === id) || null,
    querySelector: (s) => html.querySelector(s), querySelectorAll: (s) => html.querySelectorAll(s),
    contains: (n) => html.contains(n),
    addEventListener(t, f) { (doc._l[t] = doc._l[t] || []).push(f); },
    removeEventListener(t, f) { doc._l[t] = (doc._l[t] || []).filter((x) => x !== f); },
    dispatchEvent: (e) => doc._dispatch(doc, e),
    /* Un nœud retiré emporte le focus avec lui. */
    _gone(n) { if (n.nodeType === 1 && n.contains(doc.activeElement)) doc.activeElement = body; },
    /* Un élément désactivé, caché ou rendu inerte perd le focus. */
    _lose(n) { if (doc.activeElement !== body && n.contains(doc.activeElement) && !doc._canFocus(doc.activeElement)) doc.activeElement = body; },
    _canFocus(el) {
      if (!el.isConnected || el.hasAttribute('disabled')) return false;
      for (let n = el; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute('hidden') || n.hasAttribute('inert')) return false;
      return FOCUSABLE.has(el.localName) || (el.localName === 'a' && el.hasAttribute('href')) || el.hasAttribute('tabindex');
    },
    _dispatch(target, e) {
      if (!e.target) e.target = target;
      const chain = [];
      for (let n = target; n; n = n.parentNode) chain.push(n);
      if (target !== doc) chain.push(doc);
      if (doc.win) chain.push(doc.win);
      for (const n of chain) {
        for (const f of ((n._l || {})[e.type] || []).slice()) f.call(n, e);
        if (e._stop || e.bubbles === false) break;
      }
      return !e.defaultPrevented;
    }
  });
  return doc;
}

/* ---------- faux stockage, fausse horloge ---------- */
function storage(init, broken) {
  const m = new Map(Object.entries(init || {}));
  const boom = () => { throw new Error('stockage refusé'); };
  return { _m: m, getItem: broken ? boom : (k) => (m.has(k) ? m.get(k) : null), setItem: broken ? boom : (k, v) => { m.set(k, String(v)); }, removeItem: broken ? boom : (k) => { m.delete(k); } };
}

/* ---------- données minimales : pas de dépendance aux vues ni aux données des collègues ---------- */
const EMBEDDED = '2026-11-12T17:23:56.759Z';
const searchData = (over) => Object.assign({
  generatedAt: EMBEDDED, total: 92899, cats: [{ id: 'site-design', label: 'Sites' }],
  items: [['acme/kit/alpha', 'alpha', 'acme/kit', 1200, [0], 0, 80, 0], ['acme/kit/beta', 'beta', 'acme/kit', 900, [0], 0, 70, 0], ['acme/kit/gamma', 'gamma', 'acme/kit', 500, [0], 0, 60, 0]],
  details: {}
}, over || {});
const STUB = `
  window.SA = window.SA || {};
  SA.search = ${JSON.stringify(searchData())};
  SA.data = {
    goals: { site: { title: 'Créer un site', tag: 'site', qs: [
      { id: 'type', q: 'Quel type ?', opts: [['vitrine', 'Vitrine'], ['blog', 'Blog']] },
      { id: 'needs', multi: true, q: 'Quels besoins ?', opts: [['seo', 'Référencement'], ['a11y', 'Accessibilité'], ['nsp', 'Je ne sais pas']] }] } },
    agents: [{ id: 'claude', name: 'Claude Code', st: 'ok', rel: '.claude/skills', sig: [] }, { id: 'cursor', name: 'Cursor', st: 'ok', rel: '.cursor/skills', sig: [] }],
    home: { mac: '/Users/demo', win: 'C:\\\\Users\\\\demo', linux: '/home/demo' },
    osLabel: { mac: 'macOS', win: 'Windows', linux: 'Linux' },
    mine: [{ id: 'local/notes', name: 'notes', src: 'copie manuelle', st: 'ng', on: true, ag: { claude: 'ok' }, chars: 120, warn: 0 }],
    backups: []
  };
  SA.reco = { item: function (id) { var l = (SA.search || {}).items || []; for (var i = 0; i < l.length; i++) if (l[i][0] === id) return l[i]; return null; } };
`;

/* ---------- faux serveur ---------- */
const HOME = '/Users/test';
const TOKEN = 'a'.repeat(64);
function baseState(over) {
  return Object.assign({
    mode: 'live', os: 'mac', home: HOME, cwd: '/somewhere/skill-advisor', version: '1.0.0', project: null, catalog: { source: 'bundled', generatedAt: EMBEDDED },
    agents: [
      { id: 'claude-code', name: 'Claude Code', detected: true, top: true, universal: false, globalDir: HOME + '/.claude/skills', custom: false, hidden: false, target: false, count: 1 },
      { id: 'cursor', name: 'Cursor', detected: true, top: true, universal: true, globalDir: HOME + '/.agents/skills', custom: false, hidden: false, target: false, count: 1 }
    ],
    mine: [{ id: 'local/one', name: 'one', src: null, real: false, st: 'ng', on: true, ag: { 'claude-code': 'ok' }, chars: 10, warn: 0, note: null, scan: null, path: HOME + '/.claude/skills/one', scope: 'global' }],
    backups: [], settings: { version: 1, custom: [], hidden: [], targets: [] }
  }, over || {});
}
function makeServer(over) {
  const srv = { state: baseState(over), log: [], offline: false, failNext: null, hang: null, searchData: undefined };
  srv.fetch = function (url, opts = {}) {
    const headers = opts.headers || {};
    srv.log.push({ url, method: opts.method || 'GET', token: headers['X-SA-Token'], body: opts.body ? JSON.parse(opts.body) : undefined });
    if (srv.offline) return Promise.reject(new TypeError('Failed to fetch'));
    const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(JSON.parse(JSON.stringify(data))) });
    let res;
    if (srv.failNext) { res = reply(srv.failNext.status, srv.failNext.body); srv.failNext = null; }
    else if (url === '/api/state') res = reply(200, srv.state);
    else if (url === '/api/search-data') res = srv.searchData === undefined ? reply(404, { error: 'NOT_FOUND', message: 'Route inconnue.' }) : reply(200, srv.searchData);
    else if (url === '/api/skills/disable') res = reply(200, { done: [], failed: [], state: srv.state });
    else if (url === '/api/project') { srv.state.project = JSON.parse(opts.body).dir; res = reply(200, { state: srv.state }); }
    else res = reply(404, { error: 'NOT_FOUND', message: 'Route inconnue.' });
    if (srv.hang) { const h = srv.hang; srv.hang = null; return new Promise((r) => { h.release = () => r(res); }); }
    return Promise.resolve(res);
  };
  return srv;
}
const gets = (srv, url) => srv.log.filter((e) => e.url === url).length;

/* ---------- vue d'essai : un écran avec chaque sorte de contrôle ---------- */
function testView(model) {
  return {
    renders: 0, keysSeen: [], seenTotal: null,
    render() {
      this.renders++;
      if (this.seenTotal === null) this.seenTotal = model.SA().search.total;
      const rows = model.rows.map((r) => '<li data-row="' + r + '">' +
        '<button type="button" class="sw" role="switch" aria-checked="' + !!model.on[r] + '" data-sw="' + r + '"></button>' +
        '<button type="button" data-act="go">Ouvrir</button>' +
        '<button type="button" data-rm="' + r + '"' + (model.locked ? ' disabled' : '') + '>Retirer ' + r + '</button></li>').join('');
      return '<p class="eye">Essai</p><h1 class="d d-s" data-st tabindex="-1">Titre ' + this.renders + '</h1>' +
        (model.msg ? '<p class="gs-msg" role="status" tabindex="-1">' + model.msg + '</p>' : '') +
        '<input id="q" type="search" value="' + model.q + '">' +
        '<ul>' + rows + '</ul>' +
        '<button type="button" data-scope="global">Tous les projets</button><button type="button" data-scope="projet">Ce projet seulement</button>' +
        '<button type="button" id="more">Afficher plus</button>' +
        '<button type="button" class="plain">Sans attribut</button>' +
        '<button type="button" data-fk="cle-1">Avec clé</button>' +
        '<button type="button" class="opt" data-v="a">Réponse A</button>' +
        '<p class="lede">' + model.rows.length + ' lignes</p>';
    },
    mount(v) {
      this.mountedRoot = v;
      v.addEventListener('input', (e) => { if (e.target.id === 'q') model.q = e.target.value; });
      if (model.mountFocus) { const el = v.querySelector(model.mountFocus); if (el) el.focus(); }
    },
    actions() { return model.actions || []; },
    keys(e) { this.keysSeen.push(e.key); return true; }
  };
}
const ROUTES = ['accueil', 'objectif', 'questions', 'resultats', 'confirmation', 'guide', 'gestion', 'sauvegardes', 'recherche', 'agents'];

/* ---------- une fenêtre ---------- */
function makeWin(o = {}) {
  const doc = makeDoc();
  /* noLose : comme un navigateur, un bouton désactivé garde le focus (document.activeElement ne bouge pas). */
  if (o.noLose) doc._lose = () => {};
  doc.body.innerHTML = read('index.html');
  const session = o.session || storage(), local = o.local || storage();
  const clock = o.clock || { t: 1800000000000 };
  const FakeDate = function (...a) { return a.length ? new Date(...a) : new Date(clock.t); };
  FakeDate.now = () => clock.t;
  const errors = [];
  const win = {
    _l: {}, document: doc, sessionStorage: session, localStorage: local, Date: FakeDate, Promise, JSON, setTimeout, clearTimeout,
    location: { search: o.query || '', pathname: '/' }, navigator: o.navigator || {}, innerHeight: 800,
    history: { replaceState(a, b, url) { win.location.search = ''; win.location.pathname = url; } },
    matchMedia: (q) => ({ matches: /reduce/.test(q), addEventListener() {}, addListener() {} }),
    addEventListener(t, f) { (win._l[t] = win._l[t] || []).push(f); },
    removeEventListener(t, f) { win._l[t] = (win._l[t] || []).filter((x) => x !== f); },
    dispatchEvent(e) { for (const f of (win._l[e.type] || []).slice()) f.call(win, e); return true; },
    Event: function (type, init) { return event(type, init); },
    console: { log() {}, warn() {}, error(...a) { errors.push(a.map(String).join(' ')); } }
  };
  if (o.noStorage) { delete win.sessionStorage; delete win.localStorage; }
  win.window = win; doc.win = win;
  if (o.srv) win.fetch = o.srv.fetch;
  if (o.live) win.SA_LIVE = o.live;
  const ctx = vm.createContext(win);
  vm.runInContext(STUB, ctx, { filename: 'stub-data.js' });
  for (const f of (o.live ? ['live.js', 'core.js'] : ['core.js']).concat(o.extra || [])) vm.runInContext(read(f), ctx, { filename: f });
  const SA = win.SA;
  const model = Object.assign({ rows: ['a', 'b', 'c'], on: {}, q: '', msg: '', locked: false, mountFocus: '', actions: null, SA: () => SA }, o.model || {});
  const view = testView(model);
  for (const r of ROUTES) SA.views[r] = view;
  const $ = (id) => doc.getElementById(id);
  const h = {
    win, doc, SA, ctx, session, local, clock, errors, model, view, $,
    q: (s) => doc.querySelector(s),
    text: (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : ''),
    /* Démarrage comme dans la page construite (BOOT de build.mjs). */
    boot() { vm.runInContext(o.bootCode, ctx, { filename: 'boot.js' }); },
    async ready() { h.boot(); if (SA.live && SA.live.ready) await SA.live.ready; await tick(); return h; },
    press(key, init) { const e = event('keydown', Object.assign({ key }, init || {})); doc.activeElement.dispatchEvent(e); return e; },
    active() { return doc.activeElement; },
    onBody() { return doc.activeElement === doc.body; }
  };
  return h;
}

/* =====================================================================================================
   0. build.mjs : importé sans rien écrire, titre, icône, langue, fins de ligne
   ===================================================================================================== */
const distFile = path.join(root, 'dist', 'preview.html');
const distBefore = fs.existsSync(distFile) ? fs.statSync(distFile).mtimeMs : null;
const build = await import(pathToFileURL(path.join(root, 'build.mjs')).href);
ok(distBefore === (fs.existsSync(distFile) ? fs.statSync(distFile).mtimeMs : null), 'importing build.mjs writes nothing in dist');
ok(typeof build.render === 'function' && typeof build.BOOT === 'string', 'build.mjs exports render() and BOOT');
const bootCode = build.BOOT;
const win0 = (o) => makeWin(Object.assign({ bootCode }, o));
{
  const buildSrc = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8');
  const list = buildSrc.match(/const JS = \[([\s\S]*?)\];/);
  ok(list && /'live\.js'/.test(list[1]) && /'core\.js'/.test(list[1]), 'build.mjs keeps the literal JS list read by the other tests');

  const out = build.render();
  ok(/<title>Skill Advisor<\/title>/.test(out.preview) && /<title>Skill Advisor<\/title>/.test(out.page), 'finding 52: page title is "Skill Advisor"');
  ok(!/Prototype<\/title>/.test(out.preview), 'finding 52: no "Prototype" in the title');
  ok(/<html lang="fr">/.test(out.preview), 'preview has lang="fr"');
  const ico = /<link rel="icon" href="(data:image\/svg\+xml,[^"]+)"/.exec(out.preview);
  ok(ico, 'inline SVG favicon as a data: URI');
  if (ico) {
    const svg = decodeURIComponent(ico[1].slice('data:image/svg+xml,'.length));
    ok(/^<svg[^>]+xmlns='http:\/\/www\.w3\.org\/2000\/svg'/.test(svg) && (svg.match(/<rect /g) || []).length === 4, 'favicon draws the four bars of the logo: ' + svg.slice(0, 120));
    ok(!/["#<>\s]/.test(ico[1].slice('data:image/svg+xml,'.length).replace(/%[0-9A-F]{2}/gi, '')), 'favicon URI is fully encoded (no raw quote, #, <, > or space)');
  }
  const headEnd = out.preview.indexOf('</head>');
  const early = out.preview.indexOf("'sa-theme'");
  ok(early > -1 && early < headEnd && early < out.preview.indexOf('<style>\n'), 'finding 76: the theme is applied by a script in the head, before the styles and the first paint');

  /* Fins de ligne : une copie CRLF des sources donne la même page, sans retour chariot. */
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sa-shell-')));
  const inTmp = (p) => { const r = path.relative(fs.realpathSync(os.tmpdir()), p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
  if (!inTmp(tmp)) throw new Error('dossier jetable hors du dossier temporaire : ' + tmp);
  try {
    const copy = (to, eol) => {
      const walk = (rel) => {
        for (const e of fs.readdirSync(path.join(SRC, rel), { withFileTypes: true })) {
          const r = path.join(rel, e.name);
          if (e.isDirectory()) { fs.mkdirSync(path.join(to, r), { recursive: true }); walk(r); }
          else if (/\.(js|css|html)$/.test(e.name)) fs.writeFileSync(path.join(to, r), fs.readFileSync(path.join(SRC, r), 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, eol));
        }
      };
      fs.mkdirSync(to, { recursive: true });
      walk('');
    };
    const lf = path.join(tmp, 'lf'), crlf = path.join(tmp, 'crlf'), outDir = path.join(tmp, 'out dist é');
    copy(lf, '\n'); copy(crlf, '\r\n');
    ok(fs.readFileSync(path.join(crlf, 'core.js'), 'utf8').includes('\r\n'), 'the CRLF copy really has CRLF');
    const a = build.render({ src: lf }), b = build.render({ src: crlf });
    ok(!b.preview.includes('\r') && !b.page.includes('\r'), 'CRLF sources: the built pages hold no carriage return');
    ok(a.preview === b.preview && a.page === b.page, 'CRLF sources: same output as LF sources');
    /* En ligne de commande : écrit dans --out, jamais dans dist quand --out est donné. Pas de shell. */
    execFileSync(process.execPath, [path.join(root, 'build.mjs'), '--src', crlf, '--out', outDir], { stdio: 'pipe' });
    const written = fs.readFileSync(path.join(outDir, 'preview.html'), 'utf8');
    ok(written === b.preview && fs.readFileSync(path.join(outDir, 'page.html'), 'utf8') === b.page, 'command line build writes the same pages to --out (path with a space and an accent)');
    ok(distBefore === (fs.existsSync(distFile) ? fs.statSync(distFile).mtimeMs : null), 'build with --out leaves prototype/dist alone');
  } finally {
    if (inTmp(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* =====================================================================================================
   1. index.html : neutre avant le démarrage
   ===================================================================================================== */
{
  const html = read('index.html');
  ok(!/machine d.exemple/.test(html), 'finding 66: no demo wording in the static markup');
  ok(/id="pv-btn"[^>]*\bhidden\b/.test(html), 'finding 66: the demo settings button is hidden until the demo shows it');
  ok(/class="app is-boot"/.test(html), 'finding 66: the shell is marked as booting in the static markup');
  ok(/id="refresh-btn"[^>]*\bhidden\b/.test(html) && /Actualiser/.test(html), 'finding 14: an "Actualiser" button exists in the rail, hidden by default');
  const status = (html.match(/<div class="rail-status">[\s\S]*?<\/div>/) || [''])[0];
  ok(/id="rail-live"/.test(html) && !/id="rail-live"/.test(status), 'the "Actualiser" announcement sits outside .rail-status (hidden on narrow screens)');
  ok(!/prototype/i.test(read('core.js').match(/function placeholder\(\)[\s\S]*?\n  \}/)[0]), 'the fallback screen never says "prototype"');
}

/* =====================================================================================================
   2. Session : jeton de SA_LIVE, jeton de sessionStorage, session expirée
   ===================================================================================================== */
{
  /* jeton dans la page : rangé dans sessionStorage, adresse nettoyée */
  const srv = makeServer();
  const h = win0({ live: { token: TOKEN }, srv, query: '?c=abc123' });
  ok(h.session.getItem('sa-token') === TOKEN, 'token from SA_LIVE stored in sessionStorage (sa-token)');
  ok(h.win.location.search === '', 'query string removed');
  await h.ready();
  ok(h.SA._started === true, 'interface started');
  ok(srv.log.length >= 1 && srv.log[0].url === '/api/state' && srv.log.every((e) => e.token === TOKEN), 'token header on every call');
}
{
  /* rechargement : la page arrive sans jeton, il vient de sessionStorage */
  const srv = makeServer();
  const h = win0({ live: { token: null }, srv, session: storage({ 'sa-token': TOKEN }) });
  await h.ready();
  ok(h.SA._started === true && srv.log[0].token === TOKEN, 'token read from sessionStorage when SA_LIVE.token is null');
  ok(h.session.getItem('sa-token') === TOKEN, 'stored token kept');
}
{
  /* aucun jeton : écran de session expirée, aucun appel */
  const srv = makeServer();
  const h = win0({ live: { token: null }, srv });
  await h.ready();
  const t = h.text(h.$('view'));
  ok(h.SA._started !== true && srv.log.length === 0, 'no token: nothing is fetched, nothing starts');
  ok(/Session expirée/.test(t) && /Relancez Skill Advisor \(npm start\), puis ouvrez la nouvelle adresse\./.test(t), 'no token: session-expired message: ' + t);
  ok(!/recharg/i.test(t) && !h.$('view').querySelector('button'), 'session expired: no reload advice, no reload button');
  ok(h.$('app').classList.contains('is-boot'), 'session expired: full-page screen, the shell stays hidden');
  ok(h.SA.live.expired === true, 'SA.live.expired is set');
}
{
  /* stockage refusé par le navigateur : pas d'exception, la session de la page marche quand même */
  const srv = makeServer();
  const h = win0({ live: { token: TOKEN }, srv, session: storage(null, true), local: storage(null, true) });
  await h.ready();
  ok(h.SA._started === true && srv.log[0].token === TOKEN, 'broken storage: the page token still works');
  const h2 = win0({ live: { token: TOKEN }, srv: makeServer(), noStorage: true });
  await h2.ready();
  ok(h2.SA._started === true, 'no storage object at all: still starts');
}
{
  /* 403 sur /api/state : session expirée, jeton oublié */
  const srv = makeServer();
  srv.failNext = { status: 403, body: { error: 'forbidden' } };
  const h = win0({ live: { token: null }, srv, session: storage({ 'sa-token': 'b'.repeat(64) }) });
  await h.ready();
  const t = h.text(h.$('view'));
  ok(h.SA._started !== true && /Session expirée/.test(t) && /ouvrez la nouvelle adresse/.test(t), '403 on /api/state: session-expired screen: ' + t);
  ok(h.session.getItem('sa-token') === null, '403: the stale token is removed from sessionStorage');
  ok(!/recharg/i.test(t), '403: no reload advice');
}
{
  /* 403 après le démarrage : même écran, le clavier ne ramène pas l'interface */
  const srv = makeServer();
  const h = win0({ live: { token: TOKEN }, srv });
  await h.ready();
  h.q('[data-sw="a"]').focus();
  srv.failNext = { status: 403, body: { error: 'forbidden' } };
  const e = await h.SA.live.call('POST', '/api/skills/disable', { names: ['one'] }).catch((x) => x);
  await tick();
  ok(e && e.status === 403 && e.code === 'forbidden', 'call rejected with status and code: ' + (e && e.code));
  ok(/Session expirée/.test(h.text(h.$('view'))) && h.$('app').classList.contains('is-boot') && h.SA.live.expired === true, '403 after start: session-expired screen replaces the interface');
  ok(!h.onBody() && h.$('view').contains(h.active()), '403 after start: focus goes to the message, not to body');
  /* une vue qui écrit encore dans sa racine de montage (fin de l'appel) n'efface pas le message */
  const staleRoot = h.view.mountedRoot;
  if (staleRoot) staleRoot.innerHTML = '<p>Ancien rendu</p>';
  ok(staleRoot && /Session expirée/.test(h.text(h.$('view'))) && !/Ancien rendu/.test(h.text(h.$('view'))), 'session expired: a late write by the view into its old root does not cover the message');
  h.SA.repaint(); h.SA.sync();
  ok(/Session expirée/.test(h.text(h.$('view'))), 'session expired: repaint and sync leave the message alone');
  const route = h.SA.state.route;
  h.doc.body.focus(); h.doc.activeElement = h.doc.body;
  h.press('/'); h.press('2'); await tick();
  ok(h.SA.state.route === route && /Session expirée/.test(h.text(h.$('view'))), 'session expired: shortcuts no longer navigate');
  ok(h.SA.setRoute('gestion') === false && h.SA.go(2) === false, 'session expired: the router is stopped');
}

/* =====================================================================================================
   3. Écran de chargement et pied du menu (constat 66)
   ===================================================================================================== */
{
  const srv = makeServer();
  srv.hang = {};
  const hang = srv.hang;
  const h = win0({ live: { token: TOKEN }, srv });
  h.boot();
  await tick();
  const all = h.text(h.doc.body);
  ok(h.$('app').classList.contains('is-boot'), 'loading: the shell is marked is-boot');
  ok(/Skill Advisor/.test(h.text(h.$('view'))) && /Lecture de votre machine…/.test(h.text(h.$('view'))), 'loading: product name and "Lecture de votre machine…"');
  ok(!/machine d.exemple/.test(all) && !/Aperçu/.test(all), 'loading: no demo wording anywhere in the page: ' + (all.match(/.{20}(machine d.exemple|Aperçu).{10}/) || [''])[0]);
  ok(h.$('pv-btn').hidden === true, 'loading: demo settings button hidden');
  hang.release();
  await h.SA.live.ready; await tick();
  ok(h.SA._started === true && !h.$('app').classList.contains('is-boot'), 'started: is-boot removed');
  ok(h.text(h.q('.rail-net')) === 'En local · 127.0.0.1', 'live rail: "En local · 127.0.0.1"');
  ok(h.text(h.q('.rail-sample')) === 'Base du 12/11/2026 · copie fournie', 'live rail: catalogue date and source: ' + h.text(h.q('.rail-sample')));
  const all2 = h.text(h.$('rail'));
  ok(!/machine d.exemple/.test(all2) && !/Aperçu/.test(all2) && h.$('pv-btn').hidden === true, 'live rail: never any demo wording: ' + all2);
  ok(h.$('refresh-btn').hidden === false && /Actualiser/.test(h.text(h.$('refresh-btn')) + h.$('refresh-btn').getAttribute('aria-label')), 'live rail: "Actualiser" button shown');
  ok(h.errors.length === 0, 'live start: no error logged: ' + h.errors.join(' | '));
}
{
  /* démonstration : rien ne change, le bouton d'aperçu revient */
  const h = win0({});
  ok(h.SA.live === undefined, 'no SA_LIVE: no live bridge');
  await h.ready();
  ok(h.SA._started === true && !h.$('app').classList.contains('is-boot'), 'demo starts at once, is-boot removed');
  ok(h.$('pv-btn').hidden === false && /Aperçu/.test(h.text(h.$('pv-btn'))), 'demo: the preview settings button is shown');
  ok(/machine d.exemple/.test(h.text(h.q('.rail-sample'))), 'demo: the rail says it is the example machine');
  ok(h.$('refresh-btn').hidden === true, 'demo: no "Actualiser" button');
  ok(h.SA.catalogInfo && h.SA.catalogInfo.source === 'bundled' && h.SA.catalogInfo.generatedAt === EMBEDDED, 'demo: SA.catalogInfo comes from the embedded copy');
  ok(h.errors.length === 0, 'demo start: no error logged: ' + h.errors.join(' | '));
}

/* =====================================================================================================
   4. Serveur arrêté (constat 95), champs des erreurs
   ===================================================================================================== */
{
  const srv = makeServer();
  const h = win0({ live: { token: TOKEN }, srv });
  await h.ready();
  srv.offline = true;
  const e = await h.SA.live.call('POST', '/api/skills/disable', { names: ['one'] }).catch((x) => x);
  await tick();
  ok(e && e.code === 'OFFLINE' && e.status === 0, 'network error: code OFFLINE, status 0');
  ok(/serveur local ne répond pas/.test(e.message) && !/recharg/i.test(e.message), 'finding 95: no reload advice when the server is stopped: ' + e.message);
  ok(/npm start/.test(e.message), 'finding 95: the message says how to start again');
  ok(e.message.split(/[.:] /).every((s) => s.trim().split(/\s+/).length <= 20), 'message in short sentences');
  ok(h.text(h.q('.rail-net')) === 'Serveur arrêté' && h.q('.rail-pip').classList.contains('is-down'), 'finding 95: the rail says "Serveur arrêté": ' + h.text(h.q('.rail-net')));
  ok(h.SA.live.down === true, 'SA.live.down is true');
  h.SA.sync();
  ok(h.text(h.q('.rail-net')) === 'Serveur arrêté', 'the rail keeps "Serveur arrêté" after a sync');
  /* une réponse, même en erreur, prouve que le serveur tourne */
  srv.offline = false;
  srv.failNext = { status: 500, body: { error: 'INTERNAL', message: 'Erreur interne.' } };
  await h.SA.live.call('POST', '/api/skills/disable', { names: ['one'] }).catch((x) => x);
  ok(h.text(h.q('.rail-net')) === 'En local · 127.0.0.1' && !h.q('.rail-pip').classList.contains('is-down') && h.SA.live.down === false, 'the rail comes back to "En local" as soon as the server answers');
  srv.offline = true;
  await h.SA.live.refresh().catch(() => {});
  ok(h.text(h.q('.rail-net')) === 'Serveur arrêté', 'down again after a failed refresh');
  srv.offline = false;
  await h.SA.live.refresh();
  ok(h.text(h.q('.rail-net')) === 'En local · 127.0.0.1', 'and back after a successful one');

  /* champs attachés aux erreurs */
  srv.failNext = { status: 409, body: { error: 'SHARED', message: 'Ce dossier est partagé.', readers: ['cursor', 'codex'] } };
  const s = await h.SA.live.call('POST', '/api/agents/empty', { id: 'cursor', backup: true }).catch((x) => x);
  ok(s.code === 'SHARED' && s.status === 409 && s.message === 'Ce dossier est partagé.' && JSON.stringify(s.readers) === '["cursor","codex"]', 'error reply: code, status, message and readers attached: ' + JSON.stringify([s.code, s.status, s.readers]));
  srv.failNext = { status: 409, body: { error: 'ROUGE', message: 'Motif à risque.', names: ['alpha'] } };
  const r = await h.SA.live.call('POST', '/api/backups/restore', { id: 'x' }).catch((x) => x);
  ok(r.code === 'ROUGE' && JSON.stringify(r.names) === '["alpha"]' && r.readers === undefined, 'error reply: names attached');
  ok(typeof h.SA.live.upload === 'function' && typeof h.SA.live.download === 'function', 'upload and download kept');
}
{
  /* serveur arrêté dès le chargement : message clair, pas de conseil de rechargement */
  const srv = makeServer();
  srv.offline = true;
  const h = win0({ live: { token: TOKEN }, srv });
  await h.ready();
  const t = h.text(h.$('view'));
  ok(h.SA._started !== true && /serveur local ne répond pas/.test(t) && /npm start/.test(t), 'server stopped at load: clear message: ' + t);
  ok(!/recharg/i.test(t) && !h.$('view').querySelector('[data-live-reload]'), 'server stopped at load: no reload advice');
  ok(h.SA.live.expired !== true, 'a stopped server is not an expired session');
}
{
  /* erreur du serveur au chargement : « Réessayer » relit l'état sans recharger la page */
  const srv = makeServer();
  srv.failNext = { status: 500, body: { error: 'INTERNAL', message: 'Le dossier des skills est illisible.' } };
  const h = win0({ live: { token: TOKEN }, srv });
  await h.ready();
  ok(h.SA._started !== true && /Le dossier des skills est illisible/.test(h.text(h.$('view'))), 'server error at load: the API message is shown');
  const b = h.$('view').querySelector('[data-live-retry]');
  ok(b && /Réessayer/.test(h.text(b)), 'server error at load: a "Réessayer" button');
  if (b) { b.click(); await tick(12); }
  ok(h.SA._started === true && !h.$('app').classList.contains('is-boot'), 'retry: the state is read again and the interface starts');
}

/* =====================================================================================================
   5. État : actualisation au retour sur la fenêtre, 5 s au plus, bouton « Actualiser » (constat 14)
   ===================================================================================================== */
{
  const srv = makeServer();
  const h = win0({ live: { token: TOKEN }, srv });
  await h.ready();
  const focus = async () => { h.win.dispatchEvent(event('focus')); await tick(); };
  ok(gets(srv, '/api/state') === 1, 'one state read at start');
  h.clock.t += 1000; await focus();
  ok(gets(srv, '/api/state') === 1, 'focus right after the load: no second read (5 s limit)');
  h.clock.t += 5000;
  srv.state.mine.push(Object.assign({}, srv.state.mine[0], { id: 'local/two', name: 'two', path: HOME + '/.claude/skills/two' }));
  const before = h.view.renders;
  h.q('[data-sw="b"]').focus();
  await focus();
  ok(gets(srv, '/api/state') === 2, 'finding 14: the state is read again when the window gets the focus');
  ok(h.SA.state.mine.length === 2 && !!h.SA.mineRow('local/two'), 'the new row is in the state');
  ok(h.view.renders > before, 'finding 14: the current view re-renders after a refresh');
  ok(!h.onBody() && h.active().getAttribute('data-sw') === 'b' && h.active().isConnected, 'the re-render keeps the focus on the control in use');
  await focus();
  ok(gets(srv, '/api/state') === 2, 'second focus at once: no new read');
  h.clock.t += 4000; await focus();
  ok(gets(srv, '/api/state') === 2, '4 s later: still no read');
  h.clock.t += 1500; await focus();
  ok(gets(srv, '/api/state') === 3, 'more than 5 s later: read again');

  /* visibilitychange : seulement quand l'onglet redevient visible */
  h.clock.t += 6000;
  h.doc.visibilityState = 'hidden'; h.doc.dispatchEvent(event('visibilitychange')); await tick();
  ok(gets(srv, '/api/state') === 3, 'tab hidden: no read');
  h.doc.visibilityState = 'visible'; h.doc.dispatchEvent(event('visibilitychange')); await tick();
  ok(gets(srv, '/api/state') === 4, 'tab visible again: read');

  /* un appel en cours : pas de lecture par-dessus */
  h.clock.t += 6000;
  srv.hang = {};
  const hang = srv.hang;
  const p = h.SA.live.call('POST', '/api/skills/disable', { names: ['one'] });
  await focus();
  ok(gets(srv, '/api/state') === 4, 'a call is running: no automatic read');
  hang.release(); await p; await tick();
  /* la réponse d'une action porte l'état : pas de relecture dans les 5 s */
  await focus();
  ok(gets(srv, '/api/state') === 4, 'an action just returned the state: no read within 5 s');

  /* une installation en cours : pas de nouveau rendu par-dessus */
  h.clock.t += 6000;
  h.SA.state.installing = true;
  await focus();
  ok(gets(srv, '/api/state') === 4, 'an install is running: no automatic read');
  h.SA.state.installing = false;

  /* bouton Actualiser : toujours, même dans les 5 s */
  await focus();
  const n = gets(srv, '/api/state');
  const btn = h.$('refresh-btn');
  btn.focus(); btn.click(); await tick();
  ok(gets(srv, '/api/state') === n + 1, 'finding 14: "Actualiser" reads the state at once');
  ok(h.active() === btn, '"Actualiser": the focus stays on the button');
  ok(/actualis/i.test(h.text(h.$('rail-live'))), '"Actualiser": the result is announced in a status region: ' + h.text(h.$('rail-live')));
  ok(h.$('rail-live').getAttribute('role') === 'status', 'the status region has role=status');
  srv.offline = true;
  btn.click(); await tick();
  ok(/ne répond pas/.test(h.text(h.$('rail-live'))) && h.text(h.q('.rail-net')) === 'Serveur arrêté', '"Actualiser" with a stopped server: says so');
  ok(h.errors.length === 0, 'refresh: no error logged: ' + h.errors.join(' | '));
}

/* =====================================================================================================
   6. Catalogue : /api/search-data remplace SA.search avant le démarrage
   ===================================================================================================== */
{
  const srv = makeServer();
  const fresh = searchData({ generatedAt: '2026-11-13T08:00:00.000Z', total: 5, items: searchData().items.concat([['new/repo/zeta', 'zeta', 'new/repo', 10, [0], 0, 50, 0]]) });
  srv.searchData = { source: 'online', generatedAt: '2026-11-13T08:00:00.000Z', search: fresh };
  const h = win0({ live: { token: TOKEN }, srv });
  await h.ready();
  ok(srv.log[0].url === '/api/state' && srv.log[1] && srv.log[1].url === '/api/search-data' && srv.log[1].token === TOKEN, 'search-data is read after the state, with the token');
  ok(h.SA.search.total === 5 && !!h.SA.item('new/repo/zeta'), 'SA.search replaced by the online catalogue');
  ok(h.view.seenTotal === 5, 'replaced before SA.start(): the first render already sees it');
  ok(JSON.stringify(h.SA.catalogInfo) === JSON.stringify({ source: 'online', generatedAt: '2026-11-13T08:00:00.000Z' }), 'SA.catalogInfo: ' + JSON.stringify(h.SA.catalogInfo));
  ok(h.text(h.q('.rail-sample')) === 'Base du 13/11/2026 · en ligne', 'rail: "Base du 13/11/2026 · en ligne": ' + h.text(h.q('.rail-sample')));
}
{
  const srv = makeServer();
  srv.searchData = { source: 'bundled', generatedAt: '2026-11-01T00:00:00.000Z', search: null };
  const h = win0({ live: { token: TOKEN }, srv });
  await h.ready();
  ok(h.SA._started === true && h.SA.search.total === 92899, 'search null: the embedded copy is kept');
  ok(JSON.stringify(h.SA.catalogInfo) === JSON.stringify({ source: 'bundled', generatedAt: EMBEDDED }), 'search null: catalogInfo describes the embedded copy: ' + JSON.stringify(h.SA.catalogInfo));
  ok(h.text(h.q('.rail-sample')) === 'Base du 12/11/2026 · copie fournie', 'rail: "· copie fournie"');
}
{
  /* route absente, réponse mal formée, réseau coupé : la copie embarquée reste, le démarrage a lieu */
  for (const [label, prep] of [
    ['404', (s) => { s.searchData = undefined; }],
    ['bad shape', (s) => { s.searchData = { source: 'online', generatedAt: 'x', search: { items: 'no', cats: [], details: {} } }; }],
    ['no cats', (s) => { s.searchData = { source: 'online', generatedAt: 'x', search: { items: [], details: {} } }; }]
  ]) {
    const srv = makeServer(); prep(srv);
    const h = win0({ live: { token: TOKEN }, srv });
    await h.ready();
    ok(h.SA._started === true && h.SA.search.total === 92899 && h.SA.catalogInfo.source === 'bundled' && h.SA.catalogInfo.generatedAt === EMBEDDED, 'search-data ' + label + ': embedded copy kept, interface started');
  }
}

{
  /* State.catalog seul (search null) : « en ligne » seulement si c'est la même version que la copie embarquée */
  const a = makeServer({ catalog: { source: 'online', generatedAt: EMBEDDED } });
  a.searchData = { source: 'online', generatedAt: EMBEDDED, search: null };
  const ha = win0({ live: { token: TOKEN }, srv: a });
  await ha.ready();
  ok(ha.SA.catalogInfo.source === 'online' && ha.text(ha.q('.rail-sample')) === 'Base du 12/11/2026 · en ligne', 'State.catalog online, same version: « en ligne »: ' + ha.text(ha.q('.rail-sample')));
  ok(ha.SA.baseLabel() === 'Base du 12/11/2026 · en ligne', 'SA.baseLabel() gives the same text to the views');
  a.state.catalog = { source: 'online', generatedAt: '2027-01-05T08:00:00.000Z' };
  await ha.SA.live.refresh();
  ok(ha.SA.baseLabel() === 'Base du 12/11/2026 · copie fournie' && ha.text(ha.q('.rail-sample')) === 'Base du 12/11/2026 · copie fournie', 'online catalogue of another version, page on its own copy: « copie fournie » with the copy date: ' + ha.SA.baseLabel());
}
{
  /* « Installation à la main » : la sélection refuse l'entrée, pas de bouton d'ajout */
  const h = win0({});
  await h.ready();
  h.SA.reco.manual = (id) => (id === 'acme/kit/beta' ? 'Sa source n’est pas un dépôt GitHub : installez-le depuis sa page skills.sh.' : '');
  ok(h.SA.cart.add('acme/kit/beta') === false && h.SA.cart.toggle('acme/kit/beta') === false && h.SA.cart.count() === 0, 'manual entry refused by the selection');
  ok(h.SA.cart.add('acme/kit/alpha') === true, 'an installable entry is still accepted');
  const btn = h.SA.addBtn('acme/kit/beta', true);
  ok(/Installation à la main/.test(btn) && !/data-cart-add/.test(btn) && /href="https:\/\/skills\.sh\/acme\/kit\/beta"/.test(btn), 'addBtn: badge and skills.sh page instead of the add button: ' + btn);
}

/* =====================================================================================================
   7. Focus après un nouveau rendu (constat 11)
   ===================================================================================================== */
{
  const h = win0({});
  await h.ready();
  const SA = h.SA, m = h.model;
  const same = (sel) => { const el = h.q(sel); return el && h.active() === el && el.isConnected; };

  /* par attributs data-* et valeur */
  h.q('[data-sw="b"]').focus();
  m.on.b = true; SA.repaint();
  ok(same('[data-sw="b"]') && h.active().getAttribute('aria-checked') === 'true', 'finding 11: after SA.repaint the focus is back on the switch that was used: ' + h.active().tagName);
  h.q('[data-scope="projet"]').focus(); SA.repaint();
  ok(same('[data-scope="projet"]'), 'finding 11: scope button keeps the focus');

  /* par clé data-fk, par id */
  h.q('[data-fk="cle-1"]').focus(); SA.repaint();
  ok(same('[data-fk="cle-1"]'), 'data-fk key');
  h.q('#more').focus(); SA.repaint();
  ok(same('#more'), 'id (« Afficher plus »)');

  /* deux contrôles aux mêmes attributs : le même rang */
  const second = h.doc.querySelectorAll('[data-act="go"]')[1];
  second.focus(); SA.repaint();
  ok(h.active() === h.doc.querySelectorAll('[data-act="go"]')[1] && h.active().closest('[data-row]').getAttribute('data-row') === 'b', 'same attributes twice: the one of the same row');

  /* sans attribut : par son libellé */
  h.q('.plain').focus(); SA.repaint();
  ok(same('.plain'), 'plain button found by its label');

  /* champ : le focus, la valeur et la sélection restent */
  const q = h.q('#q'); q.focus(); q.value = 'doc'; q.dispatchEvent(event('input')); q.setSelectionRange(1, 2);
  SA.repaint();
  ok(same('#q') && h.active().value === 'doc' && h.active().selectionStart === 1 && h.active().selectionEnd === 2, 'search field: focus and caret kept');
  m.q = '';

  /* contrôle disparu : le suivant du même genre, sinon le précédent */
  h.q('[data-rm="b"]').focus();
  m.rows = ['a', 'c']; SA.repaint();
  ok(same('[data-rm="c"]'), 'removed control: focus on the next one of the same kind: ' + (h.active().getAttribute('data-rm') || h.active().tagName));
  m.rows = ['a']; SA.repaint();
  ok(same('[data-rm="a"]'), 'last one removed: focus on the one before');
  /* plus aucun : le titre de la vue */
  m.rows = []; SA.repaint();
  ok(h.active().localName === 'h1' && h.$('view').contains(h.active()), 'nothing left: focus on the first heading of the view, never on body: ' + h.active().tagName);

  /* contrôle désactivé après le geste : le message de résultat, sinon le titre */
  m.rows = ['a', 'b'];
  SA.repaint();
  h.q('[data-rm="a"]').focus();
  m.locked = true; m.msg = 'Désinstallation en cours…'; SA.repaint();
  ok(h.active().getAttribute('role') === 'status' && h.$('view').contains(h.active()), 'control disabled by the gesture: focus on the result message: ' + h.active().tagName);
  h.q('[data-sw="a"]').focus();
  m.msg = ''; m.locked = false; SA.repaint();
  h.q('[data-rm="a"]').focus();
  m.locked = true; SA.repaint();
  ok(h.active().localName === 'h1', 'control disabled, no message: focus on the heading');
  m.locked = false; SA.repaint();

  /* une vue qui place elle-même le focus garde la main */
  h.q('[data-sw="a"]').focus();
  m.mountFocus = '#more'; SA.repaint();
  ok(same('#more'), 'a view that sets the focus in mount() keeps its choice');
  m.mountFocus = '';

  /* le focus hors de la vue n'est jamais déplacé */
  h.$('theme-btn').focus(); SA.repaint();
  ok(h.active() === h.$('theme-btn'), 'focus in the rail is left alone by a repaint');
  h.doc.activeElement = h.doc.body; SA.repaint();
  ok(h.onBody(), 'focus on body before the repaint: nothing is stolen');

  /* aide exportée pour les rendus partiels des vues */
  ok(typeof SA.keepFocus === 'function', 'SA.keepFocus exported for partial re-renders');
  const ul = h.$('view').querySelector('ul');
  h.q('[data-sw="b"]').focus();
  SA.keepFocus(ul, () => { ul.innerHTML = ul.innerHTML; });
  ok(same('[data-sw="b"]'), 'SA.keepFocus restores the focus inside a region');

  /* navigation : le titre de la nouvelle vue */
  h.q('[data-sw="a"]').focus();
  SA.setRoute('gestion'); await tick();
  ok(h.active().localName === 'h1' && h.$('view').contains(h.active()), 'navigation: focus on the heading of the new view');
  ok(h.errors.length === 0, 'focus: no error logged: ' + h.errors.join(' | '));
}
{
  /* sélection : volet de droite, tiroir, barre d'action */
  const h = win0({});
  await h.ready();
  const SA = h.SA;
  SA.setRoute('recherche'); await tick();
  ['acme/kit/alpha', 'acme/kit/beta', 'acme/kit/gamma'].forEach((id) => SA.cart.add(id));
  SA.sync();
  const rm = (rootId, id) => [].slice.call(h.$(rootId).querySelectorAll('[data-cart-rm]')).find((b) => b.getAttribute('data-cart-rm') === id);
  let b = rm('dossier', 'acme/kit/beta');
  ok(!!b, 'the right pane lists the selection');
  b.focus(); b.click(); await tick();
  ok(SA.cart.count() === 2 && h.active() === rm('dossier', 'acme/kit/gamma'), 'finding 11: « Retirer » in the right pane: focus on the next one: ' + (h.active().getAttribute('data-cart-rm') || h.active().tagName));
  b = h.active(); b.click(); await tick();
  ok(h.active() === rm('dossier', 'acme/kit/alpha'), 'last one removed: focus on the one before');
  h.active().click(); await tick();
  ok(SA.cart.count() === 0 && !h.onBody() && h.$('dossier').contains(h.active()), 'selection emptied: focus stays in the pane, never on body: ' + h.active().tagName);

  ['acme/kit/alpha', 'acme/kit/beta'].forEach((id) => SA.cart.add(id));
  SA.sync();
  SA.openCart(); await tick();
  b = rm('drawer-body', 'acme/kit/alpha');
  b.focus(); b.click(); await tick();
  ok(h.active() === rm('drawer-body', 'acme/kit/beta'), 'finding 11: « Retirer » in the drawer: focus on the next one');
  h.active().click(); await tick();
  ok(h.$('drawer').contains(h.active()) && !h.onBody(), 'drawer emptied: focus stays inside the dialog: ' + h.active().id);
  SA.closeDrawer(); await tick(40);

  /* barre d'action : le bouton utilisé disparaît ou se désactive */
  let ran = 0;
  h.model.actions = [{ label: 'Retour', on() {} }, { label: 'Installer 1 skill', kind: 'primary', on() { ran++; } }];
  SA.sync();
  const prim = h.$('actions-in').querySelector('.btn.primary');
  prim.focus(); prim.click();
  ok(ran === 1, 'action ran');
  h.model.actions = [];
  SA.repaint();
  ok(!h.onBody() && h.$('view').contains(h.active()), 'finding 11: the action bar empties under the focus: focus on the view heading: ' + h.active().tagName);
  h.model.actions = [{ label: 'Retour', on() {} }, { label: 'Installer', kind: 'primary', on() {} }];
  SA.sync();
  h.$('actions-in').querySelector('.btn.primary').focus();
  h.model.actions = [{ label: 'Retour', on() {} }, { label: 'Installer', kind: 'primary', disabled: true, on() {} }];
  SA.sync();
  ok(!h.onBody(), 'the focused action gets disabled: the focus is not lost: ' + h.active().tagName);
  {
    /* Navigateur : le bouton désactivé garde le focus ; core.js le déplace quand même vers un contrôle utilisable. */
    const n = win0({ noLose: true });
    await n.ready();
    n.model.actions = [{ label: 'Retour', on() {} }, { label: 'Installer', kind: 'primary', on() {} }];
    n.SA.sync();
    n.$('actions-in').querySelector('.btn.primary').focus();
    n.model.actions = [{ label: 'Retour', on() {} }, { label: 'Installer', kind: 'primary', disabled: true, on() {} }];
    n.SA.sync();
    ok(!n.active().disabled && !n.onBody() && /Retour/.test(n.text(n.active())), 'browser-like DOM: focus leaves the disabled action for a usable one: ' + n.text(n.active()));
    /* même chose dans la vue : le contrôle utilisé se désactive pendant le geste */
    n.model.rows = ['a', 'b']; n.SA.repaint();
    n.q('[data-rm="a"]').focus();
    n.model.locked = true; n.SA.repaint();
    ok(n.active().localName === 'h1' && !n.active().disabled, 'browser-like DOM: a control disabled by the repaint hands the focus to the heading');
  }
  ok(h.errors.length === 0, 'selection focus: no error logged: ' + h.errors.join(' | '));
}

/* =====================================================================================================
   8. Échap dans un champ de recherche (constat 12)
   ===================================================================================================== */
{
  const h = win0({});
  await h.ready();
  const q = h.q('#q');
  q.focus(); q.value = 'docker'; q.dispatchEvent(event('input'));
  ok(h.model.q === 'docker', 'the view filter follows the field');
  const e = h.press('Escape');
  ok(q.value === '' && h.model.q === '', 'finding 12: Escape clears the field AND the filter: field "' + q.value + '", filter "' + h.model.q + '"');
  ok(h.active() === q, 'finding 12: the focus stays in the field');
  ok(e.defaultPrevented === true, 'the browser default (silent clear) is prevented');
  const e2 = h.press('Escape');
  ok(h.active() === q && q.value === '' && e2.defaultPrevented === true, 'Escape in an empty search field: the focus stays');
  /* les frappes dans un champ ne déclenchent aucun raccourci */
  const route = h.SA.state.route;
  h.press('/'); h.press('2'); await tick();
  ok(h.SA.state.route === route && h.view.keysSeen.length === 0, 'typing in a field never triggers a shortcut');
}

/* =====================================================================================================
   9. Raccourcis à une touche (constat 53)
   ===================================================================================================== */
{
  const h = win0({});
  await h.ready();
  const SA = h.SA, seen = h.view.keysSeen;
  const reset = async () => { seen.length = 0; if (SA.state.route !== 'accueil') { SA.setRoute('accueil'); await tick(); } };

  /* depuis <body> : ils agissent */
  h.doc.activeElement = h.doc.body;
  h.press('2');
  ok(seen.join() === '2', 'digit from body: passed to the view');
  h.press('/'); await tick();
  ok(SA.state.route === 'recherche', '"/" from body: opens the search');
  await reset();

  /* depuis le conteneur #view : ils agissent */
  h.doc.activeElement = h.$('view');
  h.press('3');
  ok(seen.join() === '3', 'digit from the #view container: passed to the view');
  h.press('/'); await tick();
  ok(SA.state.route === 'recherche', '"/" from the #view container: opens the search');
  await reset();

  /* depuis le titre de la vue (focus après une navigation) : jamais (constat 53) */
  h.$('view').querySelector('h1').focus();
  ok(h.active().localName === 'h1', 'the view heading holds the focus');
  h.press('3'); h.press('/'); await tick();
  ok(seen.length === 0 && SA.state.route === 'accueil', 'finding 53: no shortcut from the view heading: ' + seen.join() + ' ' + SA.state.route);
  /* depuis un message de la vue : jamais */
  h.model.msg = 'Fait.'; SA.repaint();
  h.q('.gs-msg').focus();
  ok(h.active().matches('.gs-msg'), 'the view message holds the focus');
  h.press('4'); h.press('/'); await tick();
  ok(seen.length === 0 && SA.state.route === 'accueil', 'finding 53: no shortcut from a message of the view: ' + seen.join() + ' ' + SA.state.route);
  h.model.msg = ''; SA.repaint();
  await reset();

  /* depuis un bouton du menu : jamais */
  h.$('theme-btn').focus();
  h.press('5'); h.press('/'); await tick();
  ok(seen.length === 0 && SA.state.route === 'accueil', 'finding 53: no shortcut from a rail button: ' + seen.join() + ' ' + SA.state.route);
  h.q('.rail-link[data-route="gestion"]').focus();
  h.press('1'); h.press('/'); await tick();
  ok(seen.length === 0 && SA.state.route === 'accueil', 'finding 53: no shortcut from a navigation entry');

  /* depuis un bouton de la vue : jamais */
  h.q('[data-act="go"]').focus();
  h.press('2'); h.press('/'); await tick();
  ok(seen.length === 0 && SA.state.route === 'accueil', 'finding 53: no shortcut from a button of the view');
  h.q('[data-sw="a"]').focus();
  h.press('2');
  ok(seen.length === 0, 'finding 53: no shortcut from a switch');

  /* puce de réponse : son chiffre est affiché dessus, le questionnaire y laisse le focus après chaque réponse */
  h.q('.opt').focus();
  h.press('1');
  ok(seen.join() === '1', 'digit from an answer pill still answers (the wizard leaves the focus there)');
  h.press('/'); await tick();
  ok(SA.state.route === 'accueil', '"/" from an answer pill: no shortcut');
  seen.length = 0;

  /* avec une touche de modification : jamais */
  h.doc.activeElement = h.doc.body;
  h.press('2', { ctrlKey: true }); h.press('/', { metaKey: true }); await tick();
  ok(seen.length === 0 && SA.state.route === 'accueil', 'no shortcut with a modifier key');

  /* Entrée garde son rôle : action principale hors d'un bouton */
  let ran = 0;
  h.model.actions = [{ label: 'Continuer', kind: 'primary', on() { ran++; } }];
  SA.sync();
  h.$('view').querySelector('h1').focus();
  h.press('Enter');
  ok(ran === 1, 'Enter from the heading still runs the primary action');
}

/* =====================================================================================================
   10. Parcours gardé au rechargement (constat 76)
   ===================================================================================================== */
{
  const session = storage();
  const a = win0({ session });
  await a.ready();
  a.SA.state.goal = 'site';
  a.SA.state.answers = { type: 'vitrine', needs: ['seo', 'a11y'] };
  a.SA.state.preselected = { 'site|x': true };
  a.SA.cart.add('acme/kit/alpha'); a.SA.cart.add('acme/kit/gamma');
  a.SA.go(3); await tick();
  ok(a.SA.state.step === 3 && a.SA.state.route === 'wizard', 'journey moved to step 3');
  const raw = session.getItem('sa-journey');
  ok(!!raw && JSON.parse(raw).goal === 'site', 'finding 76: the journey is written to sessionStorage (sa-journey)');
  ok(!/installing|"inst"/.test(raw || ''), 'the running install is never stored');

  /* rechargement : même onglet, même stockage */
  const b = win0({ session });
  await b.ready();
  const s = b.SA.state;
  ok(s.route === 'wizard' && s.step === 3, 'finding 76: route and step restored after a reload: ' + s.route + ' ' + s.step);
  ok(s.goal === 'site' && JSON.stringify(s.answers) === JSON.stringify({ type: 'vitrine', needs: ['seo', 'a11y'] }), 'finding 76: goal and answers restored');
  ok(JSON.stringify(s.cart) === JSON.stringify(['acme/kit/alpha', 'acme/kit/gamma']), 'finding 76: selection restored');
  ok(s.preselected['site|x'] === true, 'preselection marks restored (no second automatic tick)');
  ok(b.$('view').getAttribute('data-view') === 'resultats', 'the restored step is the one displayed');
  ok(b.errors.length === 0, 'restore: no error logged: ' + b.errors.join(' | '));

  /* guide : l'installation faite reste connue */
  b.SA.state.lastInstall = ['acme/kit/beta'];
  b.SA.go(5); await tick();
  const c = win0({ session });
  await c.ready();
  ok(JSON.stringify(c.SA.state.lastInstall) === '["acme/kit/beta"]' && c.SA.state.step === 5 && c.SA.canStep(5), 'finding 76: the guide stays reachable after a reload');
}
{
  /* données périmées ou abîmées : seuls les identifiants encore valides reviennent */
  const bad = { v: 1, route: 'wizard', step: 4, goal: 'zzz', answers: { type: 'vitrine' }, cart: ['acme/kit/alpha', 'gone/x/y', 'local/notes', 42], lastInstall: ['nope'], scope: 'ailleurs', preselected: 'x' };
  const h = win0({ session: storage({ 'sa-journey': JSON.stringify(bad) }) });
  await h.ready();
  const s = h.SA.state;
  ok(s.goal === null && JSON.stringify(s.answers) === '{}', 'unknown goal dropped with its answers');
  ok(JSON.stringify(s.cart) === '["acme/kit/alpha"]', 'unknown and installed ids dropped from the selection: ' + JSON.stringify(s.cart));
  ok(s.lastInstall.length === 0 && s.scope === 'global' && typeof s.preselected === 'object', 'other fields checked');
  ok(s.route === 'wizard' && s.step === 4, 'step 4 kept: the selection opens it');

  const h2 = win0({ session: storage({ 'sa-journey': JSON.stringify({ v: 1, route: 'wizard', step: 5, goal: 'site', answers: { type: 'nope', needs: ['seo', 'zzz'], autre: 'x' }, cart: [] }) }) });
  await h2.ready();
  ok(h2.SA.state.step === 2 && h2.SA.state.goal === 'site', 'a step that cannot open falls back to the furthest reachable one: ' + h2.SA.state.step);
  ok(JSON.stringify(h2.SA.state.answers) === JSON.stringify({ needs: ['seo'] }), 'answers checked against the questions: ' + JSON.stringify(h2.SA.state.answers));

  for (const raw of ['{pas du json', '[]', 'null', '{"v":99,"route":"gestion"}', '{"v":1,"route":"nulle-part","step":"x"}']) {
    const h3 = win0({ session: storage({ 'sa-journey': raw }) });
    await h3.ready();
    ok(h3.SA._started === true && h3.SA.state.route === 'accueil' && h3.errors.length === 0, 'unusable stored journey ignored: ' + raw);
  }
  const h4 = win0({ session: storage(null, true), local: storage(null, true) });
  await h4.ready();
  h4.SA.go(1); await tick();
  ok(h4.SA._started === true && h4.errors.length === 0, 'storage that throws: the interface works without it');
}
{
  /* mode réel : le parcours revient après la lecture de la machine */
  const session = storage({ 'sa-token': TOKEN, 'sa-journey': JSON.stringify({ v: 1, route: 'gestion', step: 1, goal: 'site', answers: {}, cart: ['acme/kit/beta'] }) });
  const h = win0({ live: { token: null }, srv: makeServer(), session });
  await h.ready();
  ok(h.SA.state.route === 'gestion' && h.SA.state.goal === 'site' && JSON.stringify(h.SA.state.cart) === '["acme/kit/beta"]', 'live: journey restored after the state is read');
  ok(h.SA.state.mine.length === 1 && h.SA.state.mine[0].id === 'local/one', 'live: the machine state still comes from the server');
}

/* =====================================================================================================
   11. Thème gardé (constat 76)
   ===================================================================================================== */
{
  const local = storage({ 'sa-theme': 'dark' });
  const h = win0({ local });
  ok(h.doc.documentElement.getAttribute('data-theme') === 'dark', 'finding 76: stored theme applied as soon as the script loads');
  await h.ready();
  ok(/clair/.test(h.$('theme-btn').getAttribute('aria-label')), 'theme button offers the other theme');
  h.$('theme-btn').click();
  ok(h.doc.documentElement.getAttribute('data-theme') === 'light' && local.getItem('sa-theme') === 'light', 'finding 76: the chosen theme is written to localStorage (sa-theme)');
  const h2 = win0({ local });
  ok(h2.doc.documentElement.getAttribute('data-theme') === 'light', 'and read back by the next page');
  const h3 = win0({});
  ok(h3.doc.documentElement.getAttribute('data-theme') === null, 'no stored theme: the system theme stays in charge');
  const h4 = win0({ local: storage({ 'sa-theme': 'rose' }) });
  ok(h4.doc.documentElement.getAttribute('data-theme') === null, 'unknown stored value ignored');
}

/* =====================================================================================================
   12. Dossier du projet (constat 45)
   ===================================================================================================== */
{
  const srv = makeServer();
  const h = win0({ live: { token: TOKEN }, srv });
  await h.ready();
  const SA = h.SA;
  ok(SA.projRoot() === null, 'finding 45: no project set: SA.projRoot() is null (never the server folder)');
  SA.state.scope = 'projet';
  ok(!/null|undefined|skill-advisor/.test(SA.target('.claude/skills')), 'no project: SA.target() shows no "null" and not the server folder: ' + SA.target('.claude/skills'));
  ok(!/null|undefined/.test(SA._dossier()), 'no project: the right pane shows no "null"');
  await SA.live.call('POST', '/api/project', { dir: '/w/mon site' });
  ok(SA.projRoot() === '/w/mon site', 'finding 45: SA.projRoot() reads SA.live.state.project: ' + SA.projRoot());
  ok(SA.target('.claude/skills') === '/w/mon site/.claude/skills' && SA.target('') === '/w/mon site', 'SA.target() uses the project folder');
  SA.state.scope = 'global';
  ok(SA.target('.claude/skills') === HOME + '/.claude/skills', 'global scope: home folder');
  const d = win0({});
  await d.ready();
  ok(d.SA.projRoot() === '/Users/demo/code/mon-app', 'demo: example project folder unchanged');
}

/* =====================================================================================================
   13. Couleurs forcées (constat 51)
   ===================================================================================================== */
{
  const css = read('shell.css');
  const at = css.indexOf('@media (forced-colors: active)');
  ok(at > -1, 'finding 51: shell.css has a forced-colors block');
  let block = '';
  if (at > -1) {
    let depth = 0, i = css.indexOf('{', at);
    const start = i;
    for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
    block = css.slice(start, i + 1);
  }
  const rule = (selRe) => { const m = new RegExp(selRe + '[^{}]*\\{([^}]*)\\}').exec(block); return m ? m[1] : ''; };
  ok(/border[^;]*ButtonText|border[^;]*CanvasText/.test(rule('\\.sw::before')), 'finding 51: the switch track gets a visible border');
  ok(/background[^;]*(ButtonText|CanvasText)/.test(rule('\\.sw::after')), 'finding 51: the switch knob gets a system colour');
  ok(/Highlight/.test(rule('\\.sw\\[aria-checked="true"\\]::before')), 'finding 51: a checked switch uses Highlight');
  ok(/Highlight/.test(rule('\\.rail-link\\[aria-current="page"\\]')), 'finding 51: the current nav entry uses Highlight');
  ok(/Highlight/.test(rule('\\.seg > button\\[aria-pressed="true"\\]')), 'finding 51: the chosen segment uses Highlight');
  ok(/\.rail-pip/.test(block), 'finding 51: the status dot is handled too');
  ok(!/#[0-9a-f]{3,6}\b|rgb\(|var\(--/i.test(block), 'forced-colors block uses system colours only');
  ok(/\.rail-pip\.is-down/.test(css) && /\.app\.is-boot/.test(css), 'shell.css styles the stopped-server dot and the boot screen');
}

/* =====================================================================================================
   14. Version 1.0, derniers correctifs : Résumé, choix automatiques gardés, npm.cmd, titre de la page
   ===================================================================================================== */
/* Section « Résumé » du volet de droite, telle que la page l'affiche (rendu animé de #dossier). */
const summary = (h) => {
  const sec = Array.from(h.$('dossier').querySelectorAll('section')).find((x) => /Résumé/.test(h.text(x.querySelector('h3'))));
  return sec ? h.text(sec) : '';
};
{
  /* Claude Code seul, un skill : une copie, aucun lien. */
  const h = win0({ live: { token: TOKEN }, srv: makeServer() });
  await h.ready();
  const SA = h.SA;
  SA.state.agents = { 'claude-code': true };
  SA.cart.add('acme/kit/alpha');
  SA.go(4); await tick();
  const res = summary(h);
  ok(/Dossiers créés\s*1\s+1 × 1/.test(res) && /Liens créés\s*0$/.test(res), 'step 4 summary, Claude Code alone: 1 copy, 0 links: ' + res);
}
{
  /* Dossier partagé + 2 agents à dossier propre, 3 skills : 3 dossiers partagés, 6 liens. */
  const agents = baseState().agents.concat([
    { id: 'windsurf', name: 'Windsurf', detected: true, top: true, universal: false, globalDir: HOME + '/.codeium/windsurf/skills', custom: false, hidden: false, target: false, count: 0 }
  ]);
  const h = win0({ live: { token: TOKEN }, srv: makeServer({ agents }) });
  await h.ready();
  const SA = h.SA;
  SA.state.agents = { 'claude-code': true, windsurf: true, cursor: true };
  ['acme/kit/alpha', 'acme/kit/beta', 'acme/kit/gamma'].forEach((id) => SA.cart.add(id));
  SA.go(4); await tick();
  const res = summary(h);
  ok(/Dossiers créés\s*3\s*Liens/.test(res), 'step 4 summary, shared folder: 3 shared folders: ' + res);
  ok(/Liens créés\s*6\s+3 × 2/.test(res), 'step 4 summary, shared folder: 6 links (3 skills × 2 own-folder agents): ' + res);
}
{
  /* Constat 26 après un rechargement : les choix automatiques restent automatiques, les choix à la main restent à la main. */
  const session = storage();
  const a = win0({ session, extra: ['views/detail.js'] });
  await a.ready();
  a.SA.state.goal = 'site';
  a.SA.cart.addAuto('acme/kit/alpha');
  a.SA.cart.add('acme/kit/beta');
  a.SA.go(4); await tick();
  const j = JSON.parse(session.getItem('sa-journey') || '{}');
  ok(j.auto && j.auto['acme/kit/alpha'] === true && !('acme/kit/beta' in j.auto), 'the journey stores the automatic picks (SA.state.auto): ' + JSON.stringify(j.auto));
  const b = win0({ session, extra: ['views/detail.js'] });
  await b.ready();
  ok(JSON.stringify(b.SA.state.cart) === '["acme/kit/alpha","acme/kit/beta"]', 'reload: selection restored: ' + JSON.stringify(b.SA.state.cart));
  ok(JSON.stringify(b.SA.state.auto) === '{"acme/kit/alpha":true}', 'reload: automatic picks restored, the manual one is not marked: ' + JSON.stringify(b.SA.state.auto));
  b.SA.cart.dropAuto();
  ok(JSON.stringify(b.SA.state.cart) === '["acme/kit/beta"]', 'finding 26 after a reload: a new goal drops the automatic pick only: ' + JSON.stringify(b.SA.state.cart));
  /* Données abîmées : seuls les ids encore dans la sélection et marqués true reviennent. */
  const c = win0({ session: storage({ 'sa-journey': JSON.stringify({ v: 1, route: 'wizard', step: 4, goal: 'site', answers: {}, cart: ['acme/kit/alpha', 'acme/kit/beta'], auto: { 'acme/kit/alpha': 'oui', 'acme/kit/beta': true, 'acme/kit/gamma': true, constructor: true } }) }), extra: ['views/detail.js'] });
  await c.ready();
  ok(JSON.stringify(c.SA.state.auto) === '{"acme/kit/beta":true}', 'stored automatic picks checked against the selection: ' + JSON.stringify(c.SA.state.auto));
  const d = win0({ session: storage({ 'sa-journey': JSON.stringify({ v: 1, route: 'wizard', step: 4, goal: 'site', answers: {}, cart: ['acme/kit/alpha'], auto: ['acme/kit/alpha'] }) }), extra: ['views/detail.js'] });
  await d.ready();
  ok(JSON.stringify(d.SA.state.auto) === '{}' && d.errors.length === 0, 'stored automatic picks of the wrong shape ignored: ' + JSON.stringify(d.SA.state.auto));
}
{
  /* Constat 38 : sous Windows, la commande à taper est « npm.cmd start ». */
  const WINNAV = { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' };
  const h = win0({ live: { token: null }, srv: makeServer(), navigator: WINNAV });
  await h.ready();
  let t = h.text(h.$('view'));
  ok(/Relancez Skill Advisor \(npm\.cmd start\), puis ouvrez la nouvelle adresse\./.test(t) && !/npm start/.test(t), 'finding 38: Windows, session expired: npm.cmd start: ' + t);
  const srv = makeServer();
  srv.offline = true;
  const h2 = win0({ live: { token: TOKEN }, srv, navigator: { platform: '', userAgent: WINNAV.userAgent } });
  await h2.ready();
  t = h2.text(h2.$('view'));
  ok(/serveur local ne répond pas/.test(t) && /\(npm\.cmd start\)/.test(t) && !/npm start/.test(t), 'finding 38: Windows (user agent only), server stopped: npm.cmd start: ' + t);
  const srv3 = makeServer();
  const h3 = win0({ live: { token: TOKEN }, srv: srv3, navigator: WINNAV });
  await h3.ready();
  srv3.failNext = { status: 403, body: { error: 'forbidden' } };
  const e = await h3.SA.live.call('POST', '/api/skills/disable', { names: ['one'] }).catch((x) => x);
  ok(/\(npm\.cmd start\)/.test(e.message), 'finding 38: Windows, 403 after start: npm.cmd start in the error: ' + e.message);
  /* macOS (Darwin) et Linux : npm start. */
  const m = win0({ live: { token: null }, srv: makeServer(), navigator: { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Darwin' } });
  await m.ready();
  ok(/\(npm start\)/.test(m.text(m.$('view'))), 'finding 38: macOS keeps npm start: ' + m.text(m.$('view')));
  const l = win0({ live: { token: null }, srv: makeServer(), navigator: { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' } });
  await l.ready();
  ok(/\(npm start\)/.test(l.text(l.$('view'))), 'finding 38: Linux keeps npm start');
  const dw = win0({ navigator: WINNAV }), dm = win0({});
  ok(dw.SA.npmStart() === 'npm.cmd start' && dm.SA.npmStart() === 'npm start', 'finding 38: SA.npmStart() for the other screens (demo mode too)');
}
{
  /* Constat 52 : le titre de la page suit l'écran. */
  const h = win0({});
  await h.ready();
  const SA = h.SA;
  ok(h.doc.title === 'Ma machine · Skill Advisor', 'finding 52: title on start: ' + h.doc.title);
  for (const [r, want] of [['wizard', 'Conseil'], ['recherche', 'Recherche'], ['gestion', 'Mes skills'], ['sauvegardes', 'Sauvegardes'], ['agents', 'Agents'], ['accueil', 'Ma machine']]) {
    SA.setRoute(r); await tick();
    ok(h.doc.title === want + ' · Skill Advisor', 'finding 52: title of ' + r + ': ' + h.doc.title);
  }
  SA.go(3); await tick();
  ok(h.doc.title === 'Conseil · Skill Advisor', 'finding 52: every step of the wizard is « Conseil »: ' + h.doc.title);
  const x = win0({ live: { token: null }, srv: makeServer() });
  await x.ready();
  ok(x.doc.title === 'Session expirée · Skill Advisor', 'finding 52: session expired screen: ' + x.doc.title);
}

console.log(fails ? `${fails} FAILED on ${checks} checks` : `ok: ${checks} checks`);
process.exit(fails ? 1 : 0);
