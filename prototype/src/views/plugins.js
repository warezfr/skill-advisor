/* Skill Advisor · view plugins (route plugins) : plugins des agents (Claude Code, Codex, Gemini CLI, Copilot CLI, Antigravity).
   Liste lue sur le disque (SA.data.plugins), ce que chaque plugin apporte, hooks signalés, état par agent.
   Gestes par le CLI de chaque agent (POST /api/plugins/action) : activer, désactiver, mettre à jour, désinstaller.
   Mode démo : la machine d'exemple, en mémoire. Reprend le style de l'écran Serveurs MCP (classes mc-). */
(function () {
  'use strict';
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  var FILTERS = [['tous', 'Tous'], ['actifs', 'Actifs'], ['off', 'Désactivés'], ['hooks', 'Avec hooks']];
  var VERB = { enable: 'Activer', disable: 'Désactiver', update: 'Mettre à jour', uninstall: 'Désinstaller…' };
  var DONE = { enable: 'activé', disable: 'désactivé', update: 'mis à jour', uninstall: 'désinstallé' };
  /* Gestes possibles par agent, si l'état ne les donne pas (démo). Même table que app/lib/plugins-cli.mjs. */
  var VERBS = { 'claude-code': ['enable', 'disable', 'uninstall', 'update'], codex: ['uninstall'], 'gemini-cli': ['enable', 'disable', 'uninstall', 'update'],
    'github-copilot': ['enable', 'disable', 'uninstall', 'update'], antigravity: ['enable', 'disable', 'uninstall'] };

  function st() {
    var s = SA.state;
    if (!s.pl || typeof s.pl !== 'object') s.pl = {};
    var m = s.pl;
    if (typeof m.q !== 'string') m.q = '';
    if (!FILTERS.some(function (f) { return f[0] === m.f; })) m.f = 'tous';
    return m;
  }
  function live() { return !!(SA.live && SA.live.on); }
  function data() { var d = (SA.data || {}).plugins; return d && Array.isArray(d.plugins) ? d : { agents: [], plugins: [] }; }
  function plugins() { return data().plugins; }
  function find(id) { return plugins().filter(function (p) { return p.id === id; })[0] || null; }
  function agentName(id) {
    var a = (data().agents || []).filter(function (x) { return x.id === id; })[0];
    if (a) return a.name;
    var b = (SA.agents ? SA.agents() : []).filter(function (x) { return x.id === id; })[0];
    return b ? b.name : id;
  }
  function verbsOf(agent) {
    var a = (data().agents || []).filter(function (x) { return x.id === agent; })[0];
    return a && Array.isArray(a.verbs) ? a.verbs : VERBS[agent] || [];
  }
  function mine(p) { var out = []; Object.keys(p.ag || {}).forEach(function (a) { (p.ag[a] || []).forEach(function (e) { if (!e.other) out.push({ agent: a, e: e }); }); }); return out; }
  function isOn(p) { return mine(p).some(function (x) { return x.e.on !== false; }); }
  function hooks(p) { return ((p.contents || {}).hooks || []); }
  /* Gestes utiles du plugin : ceux qu'au moins un de ses agents permet, et qui changent quelque chose. */
  function verbs(p) {
    var out = [];
    mine(p).forEach(function (x) {
      verbsOf(x.agent).forEach(function (v) {
        if (v === 'enable' && x.e.on !== false) return;
        if (v === 'disable' && x.e.on === false) return;
        if (out.indexOf(v) < 0) out.push(v);
      });
    });
    return ['enable', 'disable', 'update', 'uninstall'].filter(function (v) { return out.indexOf(v) > -1; });
  }

  function keep(p) {
    var m = st(), q = m.q.trim().toLowerCase();
    if (m.f === 'actifs' && !isOn(p)) return false;
    if (m.f === 'off' && isOn(p)) return false;
    if (m.f === 'hooks' && !hooks(p).length) return false;
    if (!q) return true;
    return [p.name, p.title || '', (p.contents || {}).description || ''].concat(Object.keys(p.ag || {}).map(agentName)).join(' ').toLowerCase().indexOf(q) > -1;
  }
  function visible() { return plugins().filter(keep); }
  function fcount(f) { var m = st(), was = m.f, q = m.q; m.f = f; m.q = ''; var n = plugins().filter(keep).length; m.f = was; m.q = q; return n; }

  /* ------------------------------------------------------------ catalogue */
  var MARKET = { 'claude-plugins-official': 'Claude Code', 'awesome-copilot': 'Copilot CLI', 'copilot-plugins': 'Copilot CLI' };
  var PAGE = 30;
  function catalog() { var m = st(), c = live() && m.catFull ? m.catFull : SA.pluginCatalog; return c && Array.isArray(c.plugins) ? c : { plugins: [] }; }
  function catList() {
    var m = st(), q = (m.cq || '').trim().toLowerCase(), c = m.cc || '', a = m.ca || '';
    return catalog().plugins.filter(function (e) {
      if (c && (e.cats || []).indexOf(c) < 0) return false;
      if (a && e.agent !== a) return false;
      return !q || [e.name, e.title || '', e.description || '', e.author || ''].join(' ').toLowerCase().indexOf(q) > -1;
    }).sort(function (x, y) { return ((y.score || {}).total || 0) - ((x.score || {}).total || 0); });
  }
  function have() { var o = {}; plugins().forEach(function (p) { o[p.name] = true; }); return o; }
  function cardHTML(e, h) {
    var m = st(), id = SA.esc(e.id), sc = (e.score || {}).total, ask = m.ask === e.id;
    var sig = [MARKET[e.market] || e.market, e.author ? 'par ' + e.author : '', e.stars ? Math.round(e.stars / 100) / 10 + ' k étoiles' : '', e.internal ? 'maintenu dans la place de marché' : e.pinned ? 'version épinglée' : ''].filter(Boolean).join(' · ');
    var risky = e.verdict === 'rouge';
    return '<li class="mc-card" data-cid="' + id + '"><p class="mc-l1"><span class="mc-n">' + SA.esc(e.title || e.name) + '</span>' +
      (sc != null ? '<span class="mc-score" aria-label="Note ' + sc + ' sur 100">' + sc + '<span class="mut">/100</span></span>' : '') +
      (h[e.name] ? '<span class="bdg ok">Installé</span>' : '') + '</p>' +
      '<p class="mc-id mono">' + id + '</p>' + (e.description ? '<p class="mc-desc">' + SA.esc(e.description) + '</p>' : '') +
      '<p class="mc-notes">' + SA.esc(sig) + '</p>' +
      (risky ? '<p class="mc-notes pl-hooks">Le contrôle trouve un motif à risque dans sa description.</p>' : '') +
      (ask ? '<div class="mc-inst"><p class="sub">Installer ' + SA.esc(e.title || e.name) + ' pour ' + SA.esc(MARKET[e.market] || e.agent) + ' ? Skill Advisor lance la commande de l’agent : ' +
          '<span class="mono">' + SA.esc((e.agent === 'claude-code' ? 'claude' : 'copilot') + ' plugin install ' + e.id) + '</span>. Les hooks du plugin pourront lancer des commandes sans qu’on les appelle.</p>' +
          '<p class="cfm-a"><button type="button" class="btn primary" data-pl-igo="' + id + '" data-fk="igo"' + (m.busy ? ' disabled' : '') + '>' + (risky ? 'Installer malgré l’avertissement' : 'Installer') + '</button>' +
          '<button type="button" class="btn quiet" data-pl-ino data-fk="ino">Annuler</button></p></div>'
        : '<p><button type="button" class="btn" data-pl-inst="' + id + '" data-fk="inst:' + id + '">Installer…</button></p>') + '</li>';
  }
  function catHTML() {
    var m = st(), list = catList(), n = m.cn || PAGE, h = have(), c = catalog();
    var cats = ((SA.search || {}).cats || []).map(function (x) { return '<option value="' + SA.esc(x.id) + '"' + (m.cc === x.id ? ' selected' : '') + '>' + SA.esc(x.label) + '</option>'; }).join('');
    var date = c.generatedAt ? String(c.generatedAt).slice(0, 10).split('-').reverse().join('/') : '';
    return '<p class="mc-notes" data-st>' + (date ? 'Catalogue du ' + date + (c.sample ? ', extrait des ' + c.plugins.length + ' mieux notés' : ', ' + c.plugins.length + ' plugins') + ' des places de marché ouvertes de Claude Code et de Copilot CLI.' : 'Catalogue absent.') + '</p>' +
      (m.catLoading ? '<p class="mc-notes" role="status">Chargement du catalogue complet…</p>' : '') +
      '<div class="mc-tools" data-st><label class="vh" for="pl-cq">Chercher dans le catalogue</label>' +
      '<input id="pl-cq" class="fld mc-q" type="search" autocomplete="off" spellcheck="false" placeholder="Chercher un plugin" data-fk="cq" value="' + SA.esc(m.cq || '') + '">' +
      '<label class="vh" for="pl-cc">Type de projet</label><select id="pl-cc" class="fld mc-cc" data-fk="cc"><option value="">Tous les types de projet</option>' + cats + '</select>' +
      '<label class="vh" for="pl-ca">Agent</label><select id="pl-ca" class="fld mc-cc" data-fk="ca"><option value="">Claude Code et Copilot CLI</option>' +
        '<option value="claude-code"' + (m.ca === 'claude-code' ? ' selected' : '') + '>Claude Code</option><option value="github-copilot"' + (m.ca === 'github-copilot' ? ' selected' : '') + '>Copilot CLI</option></select></div>' +
      '<div class="pl-cregion">' + (list.length ? '<ul class="mc-list">' + list.slice(0, n).map(function (e) { return cardHTML(e, h); }).join('') + '</ul>' +
        (list.length > n ? '<p><button type="button" class="btn quiet" data-pl-more data-fk="more">Afficher ' + Math.min(PAGE, list.length - n) + ' de plus</button></p>' : '')
        : '<p class="mc-empty">Aucun plugin ne correspond.</p>') + '</div>';
  }
  function setTab(t) {
    var m = st();
    m.tab = t === 'cat' ? 'cat' : 'mine';
    if (m.tab === 'cat' && live() && !m.catFull && !m.catLoading && SA.live && typeof SA.live.call === 'function') {
      m.catLoading = true;
      Promise.resolve().then(function () { return SA.live.call('GET', '/api/plugins/catalog'); }).then(function (c) {
        var x = st(); x.catLoading = false;
        if (c && Array.isArray(c.plugins)) x.catFull = { generatedAt: c.generatedAt, plugins: c.plugins };
        refresh();
      }, function () { st().catLoading = false; refresh(); });
    }
    refresh('tab:' + m.tab);
  }
  function install(id) {
    var m = st(), e = catalog().plugins.filter(function (x) { return x.id === id; })[0];
    if (!e) return say('Plugin absent du catalogue.', true);
    m.ask = null;
    if (!live()) {
      var ag = {}; ag[e.agent === 'claude-code' ? 'claude' : e.agent] = [{ pluginId: e.id, scope: 'global', version: null, on: true }];
      SA.data.plugins.plugins = plugins().filter(function (p) { return p.name !== e.name; }).concat([{ id: e.name, name: e.name, title: e.title, ag: ag, contents: { description: e.description, skills: 0, commands: 0, agents: 0, hooks: [], mcp: [] }, on: true }]);
      return say((e.title || e.name) + ' installé (démonstration).', false, 'cq');
    }
    if (m.busy) return Promise.resolve(false);
    m.busy = true; m.msg = 'Installation en cours…'; m.fail = '';
    refresh();
    var pr;
    try { pr = SA.live.call('POST', '/api/plugins/install', { id: e.id, scope: SA.state.scope === 'projet' && e.agent === 'claude-code' ? 'project' : 'global', force: e.verdict === 'rouge' }); } catch (x) { pr = Promise.reject(x); }
    return Promise.resolve(pr).then(function (res) {
      st().busy = false;
      return say(res.installed ? (e.title || e.name) + ' installé pour ' + (MARKET[e.market] || e.agent) + '. Relancez l’agent pour le charger.' : 'Installation retenue : le contrôle demande votre accord.', !res.installed, 'cq');
    }, function (x) { st().busy = false; return say((x && x.message) || 'L’installation a échoué.', true, 'cq'); });
  }

  /* ------------------------------------------------------------ rendu */
  function what(p) {
    var c = p.contents || {}, out = [];
    if (c.skills) out.push(SA.pl(c.skills, 'skill', 'skills'));
    if (c.commands) out.push(SA.pl(c.commands, 'commande', 'commandes'));
    if (c.agents) out.push(SA.pl(c.agents, 'sous-agent', 'sous-agents'));
    if ((c.mcp || []).length) out.push(SA.pl(c.mcp.length, 'serveur MCP', 'serveurs MCP'));
    return out.join(' · ');
  }
  function chips(p) {
    var list = [];
    Object.keys(p.ag || {}).forEach(function (a) {
      (p.ag[a] || []).forEach(function (e) {
        var state = e.other ? 'autre projet' + (e.project ? ' (' + e.project + ')' : '') : e.on === true ? 'actif' : e.on === false ? 'désactivé' : 'installé';
        list.push({ name: agentName(a) + (e.version ? ' · ' + e.version : ''), state: state, on: !e.other && e.on !== false });
      });
    });
    return '<ul class="mc-ag" aria-label="Agents qui ont ce plugin">' + list.map(function (c) {
      return '<li class="mc-chip' + (c.on ? '' : ' is-off') + '"><span>' + SA.esc(c.name) + '</span><span class="mc-chip-s">' + SA.esc(c.state) + '</span></li>';
    }).join('') + '</ul>';
  }
  function menuHTML(p) {
    var id = SA.esc(p.id), m = st(), dis = m.busy ? ' disabled' : '', vs = verbs(p);
    if (!vs.length) return '<p class="mc-notes">Aucun geste possible depuis Skill Advisor pour ce plugin : faites-le dans l’agent.</p>';
    return '<div class="mc-menu" role="group" aria-label="Actions pour ' + SA.esc(p.title || p.name) + '">' + vs.map(function (v) {
      return '<button type="button" class="btn quiet" data-pl-do="' + v + '" data-pl-id="' + id + '" data-fk="' + v + ':' + id + '"' + dis + '>' + VERB[v] + '</button>';
    }).join('') + '</div>';
  }
  function confirmHTML(p) {
    var n = mine(p).filter(function (x) { return verbsOf(x.agent).indexOf('uninstall') > -1; }).length;
    return '<div class="mc-cf cfm" role="group" aria-labelledby="pl-cf-t"><p class="cfm-t" id="pl-cf-t">Désinstaller ' + SA.esc(p.title || p.name) + ' de ' + SA.pl(n, 'agent', 'agents') +
      ' ? Ses skills, commandes et serveurs MCP partent avec lui. Vous pourrez le réinstaller depuis sa place de marché.</p>' +
      '<p class="cfm-a"><button type="button" class="btn danger" data-pl-ok data-fk="ok">Désinstaller</button><button type="button" class="btn quiet" data-pl-no data-fk="no">Annuler</button></p></div>';
  }
  function rowHTML(p) {
    var m = st(), id = SA.esc(p.id), open = m.menu === p.id, c = m.confirm === p.id, h = hooks(p), w = what(p), desc = (p.contents || {}).description;
    return '<li class="mc-row' + (isOn(p) ? '' : ' is-off') + '" data-id="' + id + '">' +
      '<span aria-hidden="true"></span><div class="mc-main">' +
        '<p class="mc-l1"><span class="mc-n">' + SA.esc(p.title || p.name) + '</span>' + (isOn(p) ? '' : '<span class="bdg no">Désactivé</span>') +
          (p.otherOnly ? '<span class="bdg no">Autre projet</span>' : '') + '</p>' +
        (p.title && p.title !== p.name ? '<p class="mc-id mono">' + SA.esc(p.name) + '</p>' : '') +
        (desc ? '<p class="mc-desc">' + SA.esc(desc) + '</p>' : '') +
        (w ? '<p class="mc-notes">' + SA.esc(w) + '</p>' : '') +
        (h.length ? '<p class="mc-notes pl-hooks">Lance des commandes sans qu’on les appelle (hooks) : <span class="mono">' + SA.esc(h.join(', ')) + '</span></p>' : '') +
        chips(p) +
      '</div>' +
      '<button type="button" class="btn quiet mc-more" data-pl-menu="' + id + '" data-fk="menu:' + id + '" aria-expanded="' + open + '" aria-label="Actions pour ' + SA.esc(p.title || p.name) + '">Actions</button>' +
      (open || c ? '<div class="mc-pane">' + (c ? confirmHTML(p) : menuHTML(p)) + '</div>' : '') +
    '</li>';
  }
  function listHTML() {
    var l = visible();
    if (!plugins().length) return '<p class="mc-empty">Aucun plugin trouvé chez Claude Code, Codex, Gemini CLI, Copilot CLI ou Antigravity.</p>';
    if (!l.length) return '<p class="mc-empty">Aucun plugin ne correspond.</p>';
    return '<ul class="mc-list">' + l.map(rowHTML).join('') + '</ul>';
  }
  function render() {
    var m = st(), d = data();
    return '<div class="mc-mgr pl-mgr">' +
      '<p class="eye" data-st>Plugins</p>' +
      SA.h1('Plugins de vos agents') +
      '<p class="lede" data-st>Un plugin regroupe des skills, des commandes, des sous-agents, des hooks et des serveurs MCP. Skill Advisor les lit sur le disque et passe par la commande de chaque agent pour les gérer.</p>' +
      (d.error ? '<div class="note note-bad" role="alert"><p class="sub">' + SA.esc(d.error) + '</p></div>' : '') +
      '<div class="seg mc-tabs" role="group" aria-label="Vue" data-st>' +
        '<button type="button" data-pl-tab="mine" data-fk="tab:mine" aria-pressed="' + (m.tab !== 'cat') + '">Installés <span class="mut">' + plugins().length + '</span></button>' +
        '<button type="button" data-pl-tab="cat" data-fk="tab:cat" aria-pressed="' + (m.tab === 'cat') + '">Catalogue</button></div>' +
      '<p class="mc-msg" role="status">' + SA.esc(m.msg || '') + '</p>' +
      '<p class="mc-alert" role="alert">' + SA.esc(m.fail || '') + '</p>' +
      (m.tab === 'cat' ? catHTML() : '<div class="mc-tools" data-st>' +
        '<label class="vh" for="pl-q">Chercher un plugin</label>' +
        '<input id="pl-q" class="fld mc-q" type="search" autocomplete="off" spellcheck="false" placeholder="Chercher un plugin ou un agent" data-fk="q" value="' + SA.esc(m.q) + '">' +
        '<div class="seg" role="group" aria-label="Filtrer">' + FILTERS.map(function (f) {
          return '<button type="button" data-pl-f="' + f[0] + '" data-fk="f:' + f[0] + '" aria-pressed="' + (m.f === f[0]) + '">' + f[1] + ' <span class="mut">' + fcount(f[0]) + '</span></button>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="pl-region">' + listHTML() + '</div>') +
    '</div>';
  }

  /* ------------------------------------------------------------ actions */
  function refresh(focus) { if (SA.state.route !== 'plugins') return; if (focus) st().focus = focus; if (SA.repaint) SA.repaint(); }
  function say(msg, fail, focus) { var m = st(); m.msg = fail ? '' : msg; m.fail = fail ? msg : ''; refresh(focus); return Promise.resolve(!fail); }
  function act(id, verb) {
    var m = st(), p = find(id);
    if (!p) return say('Plugin introuvable.', true);
    if (verb === 'uninstall' && m.confirm !== id) { m.menu = null; m.confirm = id; return refresh('ok'); }
    m.menu = null; m.confirm = null;
    var label = p.title || p.name;
    if (!live()) {
      if (verb === 'uninstall') SA.data.plugins.plugins = plugins().filter(function (x) { return x !== p; });
      else if (verb === 'enable' || verb === 'disable') mine(p).forEach(function (x) { if (verbsOf(x.agent).indexOf(verb) > -1) x.e.on = verb === 'enable'; });
      return say(label + ' ' + DONE[verb] + ' (démonstration).', false, verb === 'uninstall' ? 'q' : 'menu:' + id);
    }
    if (m.busy) return Promise.resolve(false);
    if (!SA.live || typeof SA.live.call !== 'function') return say('Le serveur local ne répond pas. Rechargez la page.', true);
    m.busy = true; m.msg = ''; m.fail = '';
    refresh();
    var pr;
    try { pr = SA.live.call('POST', '/api/plugins/action', { name: p.name, verb: verb }); } catch (e) { pr = Promise.reject(e); }
    return Promise.resolve(pr).then(function (res) {
      st().busy = false;
      var n = (res.done || []).length, f = res.failed || [];
      return say(label + ' : ' + (n ? DONE[verb] + ' chez ' + SA.pl(n, 'agent', 'agents') + '.' : 'rien n’a changé.') +
        (f.length ? ' Échec : ' + f.map(function (x) { return agentName(x.agent) + ' : ' + x.message; }).join(' ; ') + '.' : ''), false, verb === 'uninstall' ? 'q' : 'menu:' + id);
    }, function (e) { st().busy = false; return say((e && e.message) || 'L’action a échoué. Réessayez.', true); });
  }
  function restoreFocus(root) {
    var m = st(), k = m.focus;
    if (!k) return;
    m.focus = null;
    var el = null, all = root.querySelectorAll('[data-fk]');
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-fk') === k) { el = all[i]; break; }
    if (!el || el.disabled) el = root.querySelector('#pl-q');
    if (el) try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  SA.views.plugins = {
    render: render,
    mount: function (root) {
      restoreFocus(root);
      root.addEventListener('click', function (e) {
        var t = e.target, b, m = st();
        if (!t || !t.closest) return;
        if ((b = t.closest('[data-pl-tab]'))) { setTab(b.getAttribute('data-pl-tab')); return; }
        if ((b = t.closest('[data-pl-inst]'))) { m.ask = b.getAttribute('data-pl-inst'); refresh('igo'); return; }
        if (t.closest('[data-pl-ino]')) { var k = m.ask; m.ask = null; refresh(k ? 'inst:' + k : null); return; }
        if ((b = t.closest('[data-pl-igo]'))) { install(b.getAttribute('data-pl-igo')); return; }
        if (t.closest('[data-pl-more]')) { m.cn = (m.cn || PAGE) + PAGE; refresh('more'); return; }
        if ((b = t.closest('[data-pl-f]'))) { m.f = b.getAttribute('data-pl-f'); refresh('f:' + m.f); return; }
        if ((b = t.closest('[data-pl-menu]'))) { var id = b.getAttribute('data-pl-menu'); m.confirm = null; m.menu = m.menu === id ? null : id; refresh('menu:' + id); return; }
        if ((b = t.closest('[data-pl-do]'))) { act(b.getAttribute('data-pl-id'), b.getAttribute('data-pl-do')); return; }
        if (t.closest('[data-pl-ok]') && m.confirm) { act(m.confirm, 'uninstall'); return; }
        if (t.closest('[data-pl-no]')) { var c = m.confirm; m.confirm = null; refresh(c ? 'menu:' + c : null); }
      });
      root.addEventListener('input', function (e) {
        var t = e.target;
        if (t && t.id === 'pl-cq') { st().cq = t.value; st().cn = PAGE; refresh(); var el = root.querySelector('#pl-cq'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } return; }
        if (t && t.id === 'pl-q') { st().q = t.value; var r = root.querySelector('.pl-region'); if (r) r.innerHTML = listHTML(); }
      });
      root.addEventListener('change', function (e) {
        var t = e.target;
        if (t && t.id === 'pl-cc') { st().cc = t.value; st().cn = PAGE; refresh('cc'); }
        if (t && t.id === 'pl-ca') { st().ca = t.value; st().cn = PAGE; refresh('ca'); }
      });
      root.addEventListener('keydown', function (e) {
        var m = st();
        if (e.key !== 'Escape') return;
        if (m.confirm) { e.preventDefault(); e.stopPropagation(); var c = m.confirm; m.confirm = null; refresh('menu:' + c); return; }
        if (m.menu) { e.preventDefault(); e.stopPropagation(); var id = m.menu; m.menu = null; refresh('menu:' + id); }
      });
    },
    actions: function () { return []; },
    keys: function () { return false; },
    _do: { visible: visible, plugins: plugins, setQuery: function (q) { st().q = q; }, setFilter: function (f) { st().f = f; }, act: act, verbs: verbs,
      setTab: setTab, catList: catList, setCat: function (c) { st().cc = c; }, setAgent: function (a) { st().ca = a; }, setCatQuery: function (q) { st().cq = q; }, install: install }
  };
})();
