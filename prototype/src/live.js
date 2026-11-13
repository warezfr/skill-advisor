/* Skill Advisor prototype: mode réel (SA.live).
   Chargé après machine-data.js, avant core.js. Sans window.SA_LIVE, ne fait rien : l'aperçu reste la machine d'exemple.
   Avec, lit l'état de la machine auprès du serveur local avant SA.start(), puis relaie chaque geste à l'API.
   Les formes de l'API (Agent, Row, Backup) sont adaptées ici, en un seul endroit, à celles du prototype. */
(function () {
  'use strict';
  if (!window.SA_LIVE) return;
  window.SA = window.SA || {};
  var SA = window.SA;
  SA.data = SA.data || {};

  var token = String(window.SA_LIVE.token || '');
  /* Le code de l'adresse ne sert qu'une fois : on le retire de la barre d'adresse et de l'historique.
     Le jeton des appels vient de window.SA_LIVE. */
  try {
    if (window.history && window.history.replaceState && window.location && window.location.search) window.history.replaceState(null, '', window.location.pathname);
  } catch (e) { /* navigateur sans historique : rien à retirer */ }
  var OFF = 'Le serveur local ne répond pas. Vérifiez que Skill Advisor tourne encore dans le terminal, puis rechargez la page.';
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function fail(message, code, status) { var e = new Error(message); e.code = code; e.status = status || 0; return e; }

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

  /* Remplace l'état connu. Après le premier chargement, ne touche qu'aux lignes et aux sauvegardes :
     le parcours, la sélection et l'installation en cours restent. */
  function apply(st) {
    if (!st || !Array.isArray(st.mine) || !Array.isArray(st.agents)) throw fail('Réponse inattendue du serveur local.', 'BAD_STATE');
    var home = String(st.home || '');
    SA.live.state = st;
    SA.data.home = { mac: home, win: home, linux: home };
    SA.data.agents = st.agents.map(function (a) { return agent(a, home); });
    SA.data.mine = unique(st.mine.map(row));
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

  /* ---------- appels ---------- */
  function send(path, opts) {
    var req;
    try { req = window.fetch(path, opts); } catch (e) { return Promise.reject(fail(OFF, 'OFFLINE')); }
    return Promise.resolve(req).catch(function () { throw fail(OFF, 'OFFLINE'); });
  }
  /* Réponse en erreur : le serveur répond toujours en JSON { error, message }. */
  function refused(res) {
    return Promise.resolve().then(function () { return res.json(); }).catch(function () { return null; }).then(function (data) {
      var m = data && data.message;
      if (!m) m = res.status === 403 ? 'Accès refusé. Rouvrez Skill Advisor depuis l’adresse affichée dans le terminal.' : 'Le serveur local a refusé la demande (code ' + res.status + ').';
      var e = fail(m, (data && data.error) || 'HTTP', res.status);
      /* Refus ROUGE : les skills en cause, quand le serveur les nomme. */
      if (data && Array.isArray(data.names)) e.names = data.names.slice(0, 1000);
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

  function refresh() {
    return call('GET', '/api/state').then(function (st) { apply(st); return st; });
  }

  /* ---------- écrans d'attente et d'erreur, avant SA.start() ---------- */
  function screen(html) {
    var v = document.getElementById ? document.getElementById('view') : null;
    if (v) v.innerHTML = html;
    return v;
  }
  function showError(e) {
    var v = screen('<p class="eye">Skill Advisor</p><h1 class="d d-s" tabindex="-1">Impossible de lire votre machine</h1>' +
      '<div class="note note-bad" role="alert"><p class="note-t">' + esc(e && e.message ? e.message : OFF) + '</p>' +
      '<p class="sub">Rien n’a été modifié. Relancez Skill Advisor si besoin, puis rechargez la page.</p></div>' +
      '<p class="empty-a"><button type="button" class="btn primary" data-live-reload>Recharger la page</button></p>');
    var b = v && v.querySelector ? v.querySelector('[data-live-reload]') : null;
    if (b && b.addEventListener) b.addEventListener('click', function () { window.location.reload(); });
  }

  SA.live = { on: true, loaded: false, state: null, call: call, upload: upload, download: download, refresh: refresh };
  screen('<p class="eye">Skill Advisor</p><h1 class="d d-s">Lecture de votre machine…</h1>' +
    '<p class="lede" role="status">Inventaire des agents et des skills installés. Cela prend quelques secondes.</p>');
  /* ready ne rejette jamais : true quand l'état est chargé, false quand l'écran d'erreur est affiché. */
  SA.live.ready = call('GET', '/api/state').then(function (st) {
    first(st);
    return true;
  }).catch(function (e) {
    showError(e);
    return false;
  });
})();
