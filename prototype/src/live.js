/* Skill Advisor : mode réel (SA.live).
   Chargé après machine-data.js, avant core.js. Sans window.SA_LIVE, ne fait rien : l'aperçu reste la machine d'exemple.
   Avec, lit l'état de la machine auprès du serveur local avant SA.start(), puis relaie chaque geste à l'API.
   Les formes de l'API (Agent, Row, Backup) sont adaptées ici, en un seul endroit, à celles de l'interface. */
(function () {
  'use strict';
  if (!window.SA_LIVE) return;
  window.SA = window.SA || {};
  var SA = window.SA;
  SA.data = SA.data || {};

  /* ---------- stockage de la session : jamais d'exception, même stockage refusé ---------- */
  var KEY = 'sa-token';
  function sget(k) { try { return window.sessionStorage ? window.sessionStorage.getItem(k) : null; } catch (e) { return null; } }
  function sset(k, v) { try { if (window.sessionStorage) window.sessionStorage.setItem(k, v); } catch (e) { /* stockage refusé */ } }
  function sdel(k) { try { if (window.sessionStorage) window.sessionStorage.removeItem(k); } catch (e) { /* stockage refusé */ } }

  /* Jeton : donné par la page (adresse à usage unique), sinon gardé par l'onglet (rechargement). */
  var given = window.SA_LIVE.token;
  var token = typeof given === 'string' && given ? given : null;
  if (token) sset(KEY, token);
  else token = sget(KEY) || null;
  /* Le code de l'adresse ne sert qu'une fois : on le retire de la barre d'adresse et de l'historique. */
  try {
    if (window.history && window.history.replaceState && window.location && window.location.search) window.history.replaceState(null, '', window.location.pathname);
  } catch (e) { /* navigateur sans historique : rien à retirer */ }

  /* Commande de démarrage (constat 38) : sous Windows, « npm.cmd start ». core.js expose la même règle (SA.npmStart). */
  var NAV = window.navigator || {};
  var NPM = /Win/.test(String(NAV.platform || '') + ' ' + String(NAV.userAgent || '')) ? 'npm.cmd start' : 'npm start';
  var OFF = 'Le serveur local ne répond pas. Relancez Skill Advisor dans le terminal (' + NPM + '), puis ouvrez la nouvelle adresse.';
  var EXPIRED = 'Relancez Skill Advisor (' + NPM + '), puis ouvrez la nouvelle adresse.';
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function fail(message, code, status) { var e = new Error(message); e.code = code; e.status = status || 0; return e; }
  function el(id) { return document.getElementById ? document.getElementById(id) : null; }
  function one(sel) { return document.querySelector ? document.querySelector(sel) : null; }

  /* ---------- formes ---------- */
  /* Dossier relatif au dossier personnel, ou null s'il est ailleurs. */
  function rel(home, dir) {
    if (!dir) return '';
    dir = String(dir);
    if (!home) return null;
    if (dir === home) return '';
    var p = dir.charAt(home.length);
    if (dir.indexOf(home) === 0 && (p === '/' || p === '\\')) return dir.slice(home.length + 1).replace(/\\/g, '/');
    return null;
  }
  function agent(a, home) {
    var r = rel(home, a.globalDir);
    return Object.assign({}, a, {
      /* Un agent ajouté à la main reçoit les installations comme un agent détecté (même règle que agents.js). */
      st: a.detected || a.custom ? 'ok' : 'no', sig: [], cmd: '',
      rel: r == null ? '' : r, abs: r == null ? String(a.globalDir) : ''
    });
  }
  function row(r) {
    var o = Object.assign({}, r, { src: r.src || 'copie manuelle', ag: Object.assign({}, r.ag || {}) });
    if (o.st === 'ng' && !o.kind) o.kind = 'manuel';
    if (o.warn == null) o.warn = 0;
    var f = (r.scan && r.scan.findings) || [];
    if (!o.local && f.length) {
      o.local = f.map(function (x) {
        return { label: x.label || x.rule || 'Motif à risque', file: x.file || '', line: x.line == null ? '' : x.line, excerpt: x.excerpt || '' };
      });
    }
    return o;
  }
  /* Deux lignes au même id (un skill global et un skill de projet du même nom) : la ligne de projet reçoit sa portée en suffixe.
     Elle n'est plus reliée à la base : son détail est celui d'un skill local. */
  function unique(list) {
    var seen = {};
    /* Les lignes globales passent d'abord : elles gardent l'id du catalogue. */
    var g = function (o) { return o.scope !== 'project'; };
    list.filter(g).concat(list.filter(function (o) { return !g(o); })).forEach(function (o) {
      if (seen[o.id]) {
        var id = o.id + '#' + (o.scope || 'autre'), n = 2;
        while (seen[id]) id = o.id + '#' + (o.scope || 'autre') + '-' + n++;
        o.id = id; o.real = false;
      }
      seen[o.id] = true;
    });
    return list;
  }
  /* Sauvegarde : une sauvegarde d'avant l'étape 1 (sans items) est lue comme un seul élément. */
  function backup(b) {
    var items = Array.isArray(b.items) && b.items.length ? b.items : [{ name: b.name, src: b.src || null, agents: b.agents || [], verdict: b.verdict || null }];
    items = items.map(function (i) { return Object.assign({}, i, { agents: (i.agents || []).slice() }); });
    return Object.assign({}, b, { src: b.src || 'copie manuelle', agents: (b.agents || []).slice(), items: items });
  }
  function copy(r) { return Object.assign({}, r, { ag: Object.assign({}, r.ag) }); }

  /* Moment du dernier état reçu : l'actualisation automatique attend 5 s après lui. */
  var lastState = 0, inflight = 0;
  var GAP = 5000;

  /* Remplace l'état connu. Après le premier chargement, ne touche qu'aux lignes et aux sauvegardes :
     le parcours, la sélection et l'installation en cours restent. */
  function apply(st) {
    if (!st || !Array.isArray(st.mine) || !Array.isArray(st.agents)) throw fail('Réponse inattendue du serveur local.', 'BAD_STATE');
    var home = String(st.home || '');
    lastState = Date.now();
    SA.live.state = st;
    describe(st);
    SA.data.home = { mac: home, win: home, linux: home };
    SA.data.agents = st.agents.map(function (a) { return agent(a, home); });
    SA.data.mine = unique(st.mine.map(row));
    /* Serveurs MCP des agents (lecture seule) : { agents, servers }, valeurs secrètes déjà masquées par le serveur local. */
    SA.data.mcp = st.mcp && Array.isArray(st.mcp.servers) ? st.mcp : { agents: [], servers: [] };
    /* Plugins des agents (lecture seule, gestes par le CLI de chaque agent). */
    SA.data.plugins = st.plugins && Array.isArray(st.plugins.plugins) ? st.plugins : { agents: [], plugins: [] };
    var s = SA.state;
    if (!SA.live.loaded || !s) return;
    s.mine = SA.data.mine.map(copy);
    s.backups = (st.backups || []).map(backup);
    var g = s.g || {}, sel = g.sel || {};
    Object.keys(sel).forEach(function (id) { if (!SA.mineRow(id)) delete sel[id]; });
  }

  function first(st) {
    apply(st);
    var os = st.os === 'win' || st.os === 'linux' ? st.os : 'mac';
    /* Le serveur lance toujours le moteur avec DISABLE_TELEMETRY=1 : l'interface le montre tel quel. */
    SA.initState({ os: os, backups: (st.backups || []).map(backup), telemetryOff: true });
    /* Agents cochés : les cibles choisies, sinon les agents détectés et non masqués. */
    var can = SA.data.agents.filter(function (a) { return a.detected || a.custom; });
    var targets = can.filter(function (a) { return a.target; });
    if (!targets.length) targets = can.filter(function (a) { return !a.hidden; });
    SA.state.agents = {};
    targets.forEach(function (a) { SA.state.agents[a.id] = true; });
    SA.live.loaded = true;
  }

  /* ---------- catalogue ---------- */
  var embedded = SA.search || null, online = null;
  function info(source, at) { SA.catalogInfo = { source: source, generatedAt: at || '' }; }
  info('bundled', embedded && embedded.generatedAt);
  /* Date et source décrivent toujours la base que la page utilise : la base reçue de /api/search-data,
     sinon la copie embarquée (« en ligne » seulement si le serveur lit en ligne la même version). */
  function describe(st) {
    if (online) return info(online.source, online.generatedAt);
    var at = embedded && embedded.generatedAt, c = (st && st.catalog) || {};
    info(c.source === 'online' && at && c.generatedAt === at ? 'online' : 'bundled', at);
  }
  function goodSearch(x) {
    return !!x && typeof x === 'object' && Array.isArray(x.items) && Array.isArray(x.cats) && !!x.details && typeof x.details === 'object';
  }
  /* Base en ligne, quand le serveur en a une : elle remplace la copie embarquée avant SA.start().
     Tout échec garde la copie embarquée. */
  function catalog() {
    return call('GET', '/api/search-data').then(function (d) {
      if (d && goodSearch(d.search)) {
        SA.search = d.search;
        online = { source: d.source === 'online' ? 'online' : 'bundled', generatedAt: d.generatedAt || d.search.generatedAt || '' };
        describe();
      }
    }).catch(function () { /* copie embarquée */ });
  }

  /* ---------- pied du menu : serveur joignable ou arrêté ---------- */
  function paintRail() {
    var net = one('.rail-net'), pip = one('.rail-pip');
    var txt = SA.live.down ? 'Serveur arrêté' : 'En local · 127.0.0.1';
    if (net && net.textContent !== txt) net.textContent = txt;
    if (pip && pip.classList) { pip.classList.toggle('is-down', !!SA.live.down); pip.classList.remove('is-off'); }
    var sample = one('.rail-sample'), base = SA.baseLabel ? SA.baseLabel() : '';
    if (sample && sample.textContent !== base) sample.textContent = base;
  }
  function setDown(v) {
    v = !!v;
    if (SA.live.down === v) return;
    SA.live.down = v;
    if (SA._started) paintRail();
  }

  /* ---------- session expirée : écran plein, plus aucun geste ---------- */
  function screen(html) {
    var v = el('view');
    if (v) v.innerHTML = html;
    return v;
  }
  function boot(on) {
    var a = el('app');
    if (a && a.classList) a.classList.toggle('is-boot', !!on);
  }
  function focusTitle(v) {
    var h = v && v.querySelector ? v.querySelector('h1') : null;
    if (h && h.focus) { try { h.focus({ preventScroll: true }); } catch (e) { /* rien */ } }
  }
  function expire(refusedByServer) {
    SA.live.expired = true;
    token = null;
    sdel(KEY);
    if (SA.drawerOpen && SA.closeDrawer) { try { SA.closeDrawer(); } catch (e) { /* rien */ } }
    boot(true);
    /* Nouveau nœud #view : une vue qui écrit encore dans son ancienne racine (fin d'un appel) n'efface pas ce message. */
    var old = el('view');
    if (old && old.cloneNode && old.parentNode && old.parentNode.replaceChild) {
      try { old.parentNode.replaceChild(old.cloneNode(false), old); } catch (e) { /* on garde l'ancien */ }
    }
    try { document.title = 'Session expirée · Skill Advisor'; } catch (e) { /* rien */ }
    var v = screen('<p class="eye">' + (refusedByServer ? 'Accès refusé' : 'Skill Advisor') + '</p>' +
      '<h1 class="d d-s" tabindex="-1">Session expirée</h1>' +
      '<p class="lede" role="alert">' + esc(EXPIRED) + '</p>');
    focusTitle(v);
  }

  /* ---------- appels ---------- */
  function send(path, opts) {
    if (SA.live.expired || !token) return Promise.reject(fail('Session expirée. ' + EXPIRED, 'forbidden', 403));
    var req;
    inflight++;
    var done = function () { inflight = Math.max(0, inflight - 1); };
    try { req = window.fetch(path, opts); } catch (e) { done(); setDown(true); return Promise.reject(fail(OFF, 'OFFLINE')); }
    return Promise.resolve(req).then(function (res) {
      done();
      /* Une réponse, même en erreur, prouve que le serveur tourne. */
      setDown(false);
      return res;
    }, function () {
      done();
      setDown(true);
      throw fail(OFF, 'OFFLINE');
    });
  }
  /* Réponse en erreur : le serveur répond toujours en JSON { error, message }. */
  function refused(res) {
    return Promise.resolve().then(function () { return res.json(); }).catch(function () { return null; }).then(function (data) {
      var m = data && data.message;
      if (res.status === 403) {
        /* Jeton refusé : le serveur a été relancé, ou la page vient d'ailleurs. */
        expire(true);
        m = 'Session expirée. ' + EXPIRED;
      }
      if (!m) m = 'Le serveur local a refusé la demande (code ' + res.status + ').';
      var e = fail(m, (data && data.error) || 'HTTP', res.status);
      /* Les skills en cause (refus ROUGE) et les agents qui lisent le dossier partagé (refus SHARED). */
      if (data && Array.isArray(data.names)) e.names = data.names.slice(0, 1000);
      /* Lecteurs : des identifiants (textes), 100 au plus. */
      if (data && Array.isArray(data.readers)) e.readers = data.readers.filter(function (x) { return typeof x === 'string'; }).slice(0, 100);
      throw e;
    });
  }
  function reply(res) {
    if (!res.ok) return refused(res);
    return Promise.resolve().then(function () { return res.json(); }).catch(function () { return null; }).then(function (data) {
      if (data && data.state) apply(data.state);
      return data || {};
    });
  }
  function call(method, path, body) {
    var opts = { method: method, headers: { 'X-SA-Token': token } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return send(path, opts).then(reply);
  }
  /* Envoie un fichier tel quel (l'archive d'une sauvegarde), sans le lire en JavaScript. */
  function upload(path, data, type) {
    return send(path, { method: 'POST', headers: { 'X-SA-Token': token, 'Content-Type': type }, body: data }).then(reply);
  }
  /* Télécharge une réponse binaire : rend { blob, name }. Le nom vient de Content-Disposition. */
  function download(path) {
    return send(path, { method: 'GET', headers: { 'X-SA-Token': token } }).then(function (res) {
      if (!res.ok) return refused(res);
      var cd = (res.headers && res.headers.get && res.headers.get('content-disposition')) || '';
      var m = /filename="?([^";]+)"?/i.exec(cd);
      var name = m ? m[1].replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_') : '';
      return Promise.resolve(res.blob()).then(function (blob) { return { blob: blob, name: name }; });
    });
  }

  /* Relit l'état de la machine ; une fois l'interface lancée, la vue en cours est redessinée (le focus reste). */
  function refresh() {
    return reload().then(function (st) {
      if (SA._started && SA.repaint) SA.repaint();
      return st;
    });
  }
  /* Relit l'état sans redessiner : la vue redessine elle-même ses zones (une confirmation ouverte reste ouverte). */
  function reload() {
    return call('GET', '/api/state').then(function (st) {
      apply(st);
      return st;
    });
  }

  /* ---------- actualisation : retour sur la fenêtre (5 s au plus), bouton « Actualiser » ---------- */
  function auto() {
    if (!SA.live.loaded || !SA._started || SA.live.expired || inflight > 0) return;
    if (SA.state && (SA.state.installing || (SA.state.inst && SA.state.inst.phase === 'run'))) return;
    if (Date.now() - lastState < GAP) return;
    refresh().catch(function () { /* le pied du menu dit déjà « Serveur arrêté » */ });
  }
  function say(txt) {
    var r = el('rail-live');
    if (!r) return;
    /* Même texte deux fois de suite : une espace insécable le fait annoncer encore. */
    if (r.textContent === txt) txt += '\u00a0';
    r.textContent = txt;
  }
  var manualBusy = false;
  function manual() {
    if (manualBusy || SA.live.expired) return;
    manualBusy = true;
    var b = el('refresh-btn');
    if (b) b.setAttribute('aria-busy', 'true');
    say('Actualisation…');
    refresh().then(function () { say('État de la machine actualisé.'); }, function (e) {
      if (!SA.live.expired) say(e && e.message ? e.message : OFF);
    }).then(function () {
      manualBusy = false;
      if (b) b.removeAttribute('aria-busy');
    });
  }
  if (window.addEventListener) window.addEventListener('focus', auto);
  if (document.addEventListener) {
    document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'hidden') auto(); });
  }

  /* ---------- écrans d'attente et d'erreur, avant SA.start() ---------- */
  function showError(e) {
    var v = screen('<p class="eye">Skill Advisor</p><h1 class="d d-s" tabindex="-1">Impossible de lire votre machine</h1>' +
      '<div class="note note-bad" role="alert"><p class="note-t">' + esc(e && e.message ? e.message : OFF) + '</p>' +
      '<p class="sub">Rien n’a été modifié.</p></div>' +
      '<p class="empty-a"><button type="button" class="btn primary" data-live-retry>Réessayer</button></p>');
    var b = v && v.querySelector ? v.querySelector('[data-live-retry]') : null;
    if (b && b.addEventListener) b.addEventListener('click', function () {
      load().then(function (ok) { if (ok && SA.start) SA.start(); });
    });
    focusTitle(v);
  }
  function loading() {
    boot(true);
    screen('<p class="eye">Skill Advisor</p><h1 class="d d-s">Lecture de votre machine…</h1>' +
      '<p class="lede" role="status">Inventaire des agents et des skills installés. Cela prend quelques secondes.</p>');
  }
  /* Rend true quand l'état est chargé, false quand un écran d'erreur est affiché. Ne rejette jamais. */
  function load() {
    if (!token) { expire(false); return Promise.resolve(false); }
    loading();
    return call('GET', '/api/state').then(function (st) {
      first(st);
      return catalog().then(function () { return !SA.live.expired; });
    }).catch(function (e) {
      if (!SA.live.expired) showError(e);
      return false;
    });
  }

  SA.live = {
    on: true, loaded: false, state: null, down: false, expired: false,
    call: call, upload: upload, download: download, refresh: refresh, reload: reload, manual: manual, paintRail: paintRail
  };
  SA.live.ready = load();
})();
