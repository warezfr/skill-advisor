/* Skill Advisor · core
   Shared helpers, state, router, transitions, rail, dossier, selection (cart),
   action bar, drawer, preview panel, keyboard and theme. Plain browser JS, one IIFE on window.SA. */
window.SA = window.SA || {};
(function () {
  'use strict';
  var SA = window.SA;
  SA.views = SA.views || {};
  SA.data = SA.data || {};

  var IDS = ['objectif', 'questions', 'resultats', 'confirmation', 'guide'];
  var STEPS = ['Objectif', 'Questions', 'Recommandations', 'Installation', 'Guide'];
  var LAST = IDS.length;
  var WEIGHTS = [
    { label: 'Popularité', max: 40 }, { label: 'Réputation de la source', max: 25 },
    { label: 'Fraîcheur', max: 15 }, { label: 'Sécurité', max: 20 }
  ];
  var SHORT = {
    type: 'Type', tech: 'Technologie', host: 'Hébergement', needs: 'Besoins', os: 'Plateforme',
    source: 'Source', tool: 'Outil', out: 'Livrable'
  };
  /* Réglages d'aperçu : ils servent à montrer chaque état du prototype, le produit ne les aura pas. */
  var PV = [
    ['machine', 'Machine', [['pleine', 'Avec des skills'], ['vide', 'Vide']]],
    ['net', 'Réseau', [['on', 'En ligne'], ['off', 'Hors ligne']]],
    ['agents', 'Agents', [['ok', 'Détectés'], ['none', 'Aucun']]],
    ['install', 'Installation', [['ok', 'Réussit'], ['fail', 'Échoue sur un skill']]]
  ];

  function D() { return SA.data || {}; }
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { if (window.console) console.error('[Skill Advisor]', e); return fallback; }
  }
  function wait(ms, fn) { return setTimeout(fn, SA.rm ? 0 : ms); }

  SA.rm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* Stockages du navigateur : absents, refusés ou pleins, l'interface marche sans eux. */
  function store(kind) { try { return window[kind] || null; } catch (e) { return null; } }
  function sget(kind, k) { try { var st = store(kind); return st ? st.getItem(k) : null; } catch (e) { return null; } }
  function sset(kind, k, v) { try { var st = store(kind); if (st) st.setItem(k, v); } catch (e) { /* stockage refusé */ } }
  SA.expired = function () { return !!(SA.live && SA.live.expired); };
  /* Commande de démarrage à montrer (constat 38) : sous Windows, « npm.cmd start ». Même règle que live.js. */
  SA.npmStart = function () {
    var n = window.navigator || {};
    return /Win/.test(String(n.platform || '') + ' ' + String(n.userAgent || '')) ? 'npm.cmd start' : 'npm start';
  };

  /* Thème choisi (clé sa-theme), appliqué dès le chargement. La page construite le fait déjà dans <head>. */
  var THEME_KEY = 'sa-theme';
  (function () {
    var t = sget('localStorage', THEME_KEY), r = document.documentElement;
    if ((t === 'light' || t === 'dark') && r && r.setAttribute) { try { r.setAttribute('data-theme', t); } catch (e) { /* rien */ } }
  })();

  /* ------------------------------------------------------------------ helpers */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  SA.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  };

  SA.h = function (text) {
    var words = String(text == null ? '' : text).trim().split(/\s+/);
    return '<h1 class="d" data-st tabindex="-1">' + words.map(function (w, i) {
      return '<span class="w" style="--wi:' + i + '"><span>' + SA.esc(w) + '</span></span>';
    }).join(' ') + '</h1>';
  };
  /* Titre compact des écrans de travail (Recherche, Mes skills, Agents) : la place va aux données. */
  SA.h1 = function (text) {
    return '<h1 class="d d-s" data-st tabindex="-1">' + SA.esc(text) + '</h1>';
  };

  var IC = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2M5.46 5.46l1.41 1.41M17.13 17.13l1.41 1.41M5.46 18.54l1.41-1.41M17.13 6.87l1.41-1.41"/>',
    moon: '<path d="M19.5 14.6A7.75 7.75 0 0 1 9.4 4.5a7.75 7.75 0 1 0 10.1 10.1z"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    chevron: '<path d="M9.5 6l6 6-6 6"/>',
    sliders: '<path d="M5 8h9M18 8h1M5 16h1M10 16h9"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/>',
    refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V9h-4.5"/>'
  };
  SA.icon = function (name) {
    return '<svg class="ic ic-' + name + '" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (IC[name] || '') + '</svg>';
  };

  SA.total = function (parts) {
    return (parts || []).reduce(function (a, b) { return a + (+b || 0); }, 0);
  };
  SA.nb = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
  SA.short = function (n) {
    return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n);
  };
  SA.day = function (iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; };
  SA.pl = function (n, one, many) { return n + ' ' + (n > 1 ? many : one); };
  SA.dbDate = function () {
    var g = (SA.search || {}).generatedAt || '';
    return g ? SA.day(g) + ' à ' + g.slice(11, 16) + ' UTC' : 'date inconnue';
  };

  SA.scoreBar = function (parts) {
    var w = D().weights || WEIGHTS;
    parts = parts || [];
    var label = w.map(function (x, i) { return x.label + ' ' + (parts[i] || 0) + ' sur ' + x.max; }).join(', ');
    return '<div class="bar" role="img" aria-label="' + SA.esc(label) + '">' +
      w.map(function (x, i) { return '<i style="--w:' + (+parts[i] || 0) + '%"></i>'; }).join('') + '</div>';
  };

  SA.sep = function () { return SA.state && SA.state.os === 'win' ? '\\' : '/'; };
  SA.path = function (rel) {
    var os = (SA.state && SA.state.os) || 'mac';
    var home = (D().home || {})[os] || '';
    rel = String(rel || '');
    if (os === 'win') {
      rel = rel.replace(/\//g, '\\');
      return rel ? home + '\\' + rel : home;
    }
    return rel ? home + '/' + rel : home;
  };
  /* Dossier du projet pour la portée « Ce projet seulement ».
     Mode réel : State.project, ou null quand aucun projet n'est choisi (les vues demandent alors le dossier).
     Démonstration : un dossier d'exemple. */
  SA.projRoot = function () {
    if (SA.live && SA.live.on) {
      var p = (SA.live.state || {}).project;
      return p ? String(p) : null;
    }
    var os = (SA.state && SA.state.os) || 'mac', sep = SA.sep();
    return ((D().home || {})[os] || '') + sep + 'code' + sep + 'mon-app';
  };
  /* Absolute path of a relative agent folder, following SA.state.scope. Sans projet choisi : « … » à la place du dossier. */
  SA.target = function (rel) {
    if (!SA.state || SA.state.scope !== 'projet') return SA.path(rel);
    var sep = SA.sep(), root = SA.projRoot() || '…';
    rel = String(rel || '').replace(/\//g, sep);
    return rel ? root + sep + rel : root;
  };

  function goalObj() {
    var g = D().goals || {};
    return SA.state.goal ? g[SA.state.goal] || null : null;
  }
  SA.goalObj = goalObj;

  /* ---- base réelle ---- */
  SA.item = function (id) { return SA.reco ? SA.reco.item(id) : null; };
  SA.det = function (id) { return ((SA.search || {}).details || {})[id] || null; };
  SA.offline = function () { return !!(SA.state && SA.state.pv && SA.state.pv.net === 'off'); };
  /* Date et source de la base. Mode réel : live.js la remplit ; sinon, la copie embarquée. */
  if (!SA.catalogInfo) SA.catalogInfo = { source: 'bundled', generatedAt: (SA.search || {}).generatedAt || '' };
  /* « Base du 12/11/2026 · copie fournie » ou « · en ligne » : le même texte partout. */
  SA.baseLabel = function () {
    var c = SA.catalogInfo || {}, d = c.generatedAt ? SA.day(String(c.generatedAt)) : '';
    return (d ? 'Base du ' + d : 'Base de date inconnue') + ' · ' + (c.source === 'online' ? 'en ligne' : 'copie fournie');
  };

  /* ---- machine ---- */
  SA.mineRow = function (id) {
    var list = (SA.state && SA.state.mine) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };
  SA.agents = function () {
    var s = SA.state || {}, list = (D().agents || []).concat(s.custom || []);
    if (s.pv && s.pv.agents === 'none') {
      return list.map(function (a) { return a.custom ? a : Object.assign({}, a, { st: 'no', sig: [], rel: '' }); });
    }
    return list;
  };
  SA.agentsOn = function () {
    var on = SA.state.agents || {};
    return SA.agents().filter(function (a) { return a.st !== 'no' && on[a.id]; });
  };
  SA.agentPath = function (a) { return a.abs ? a.abs : a.rel ? SA.path(a.rel) : ''; };

  /* ---- sauvegardes ---- */
  SA.ORIGIN = { remove: 'à la suppression', manual: 'à la demande', import: 'importée', replace: 'avant remplacement' };
  var VERDICTS = { vert: 1, 'vert-remarques': 1, orange: 1, rouge: 1 };
  /* Clés venues de la machine : jamais une propriété héritée (constructor, toString…). */
  function own(o, k) { return k != null && Object.prototype.hasOwnProperty.call(o, k); }
  SA.own = own;
  function verdictOf(r) {
    if (r.scan && own(VERDICTS, r.scan.verdict)) return r.scan.verdict;
    return r.warn === 2 ? 'rouge' : r.warn === 1 ? 'orange' : null;
  }
  /* Une forme unique pour l'écran : la forme Backup du contrat, ou une ligne de Mes skills gardée telle quelle
     (désinstallation en démo, sauvegarde d'avant l'étape 1). */
  SA.normBackup = function (b) {
    b = b || {};
    var cfg = b.kind === 'config';
    var items = cfg ? [] : Array.isArray(b.items) && b.items.length ? b.items : [{
      name: b.name, src: b.src, agents: b.agents || Object.keys(b.ag || {}), verdict: b.verdict || verdictOf(b)
    }];
    var mcp = b.kind === 'mcp';
    items = items.map(function (i) {
      var o = { name: String(i.name == null ? '' : i.name), src: i.src ? String(i.src) : '', agents: (i.agents || []).map(String), verdict: own(VERDICTS, i.verdict) ? i.verdict : null };
      /* Serveur MCP : portée, et valeurs secrètes gardées ou remplacées par des variables (noms à définir). */
      if (mcp) {
        o.scope = i.scope === 'project' ? 'project' : 'global';
        o.secrets = i.secrets === 'kept' ? 'kept' : 'vars';
        o.vars = Array.isArray(i.vars) ? i.vars.filter(function (v) { return typeof v === 'string'; }) : [];
      }
      return o;
    });
    var size = Number(b.size);
    return {
      kind: cfg ? 'config' : mcp ? 'mcp' : 'skill',
      id: String(b.id == null ? '' : b.id), label: String(b.label || (items[0] && items[0].name) || 'Sauvegarde'), note: b.note ? String(b.note) : '',
      origin: own(SA.ORIGIN, b.origin) ? b.origin : 'remove', at: b.at ? String(b.at) : '', size: isFinite(size) && size > 0 ? size : 0,
      items: items, parts: cfg && b.parts && typeof b.parts === 'object' ? b.parts : null, raw: b
    };
  };
  SA.size = function (n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' o';
    var k = n / 1024, u = 'Ko';
    if (k >= 1024) { k /= 1024; u = 'Mo'; }
    return (k >= 10 ? String(Math.round(k)) : k.toFixed(1).replace('.', ',').replace(/,0$/, '')) + ' ' + u;
  };
  /* Copies des sauvegardes d'exemple : la démo les modifie sans toucher aux données d'origine. */
  SA.demoBackups = function () {
    return (D().backups || []).map(function (b) {
      return Object.assign({}, b, { agents: (b.agents || []).slice(), items: (b.items || []).map(function (i) { return Object.assign({}, i, { agents: (i.agents || []).slice() }); }) });
    });
  };

  /* ---- sélection : un seul panier, alimenté par le conseil et par la recherche ---- */
  SA.cart = {
    list: function () { return SA.state.cart; },
    has: function (id) { return SA.state.cart.indexOf(id) > -1; },
    count: function () { return SA.state.cart.length; },
    items: function () { return SA.state.cart.map(SA.item).filter(Boolean); },
    add: function (id) {
      if (!SA.item(id) || SA.mineRow(id) || SA.cart.has(id)) return false;
      /* « Installation à la main » : l'application ne sait pas l'installer, la sélection la refuse. */
      if (SA.reco && typeof SA.reco.manual === 'function' && SA.reco.manual(id)) return false;
      SA.state.cart.push(id);
      return true;
    },
    remove: function (id) {
      var i = SA.state.cart.indexOf(id);
      if (i < 0) return false;
      SA.state.cart.splice(i, 1);
      return true;
    },
    toggle: function (id) { return SA.cart.has(id) ? SA.cart.remove(id) : SA.cart.add(id); }
  };

  /* Bouton d'ajout, le même partout. Son état est remis à jour par SA.sync(). */
  SA.addBtn = function (id, wide) {
    if (SA.mineRow(id)) return '<span class="bdg ok">Installé</span>';
    var on = SA.cart.has(id), it = SA.item(id);
    /* L'application ne sait pas l'installer : un badge et sa page skills.sh, jamais de bouton d'ajout. */
    var why = SA.reco && typeof SA.reco.manual === 'function' ? SA.reco.manual(id) : '';
    if (why) {
      var url = it ? 'https://skills.sh/' + String(it[2] || '').split('/').concat([it[1]]).map(encodeURIComponent).join('/') : '';
      return '<span class="bdg wsl" title="' + SA.esc(why) + '">Installation à la main</span>' +
        (wide ? ' <span class="sub">' + SA.esc(why) + '</span>' : '') +
        (url ? ' <a class="btn quiet" href="' + SA.esc(url) + '" target="_blank" rel="noopener noreferrer">Page skills.sh</a>' : '');
    }
    return '<button type="button" class="btn add' + (on ? ' is-on' : '') + '" data-cart-add="' + SA.esc(id) + '"' + (wide ? ' data-wide' : '') +
      ' aria-pressed="' + on + '" aria-label="' + (on ? 'Retirer ' : 'Ajouter ') + SA.esc(it ? it[1] : id) + (on ? ' de' : ' à') + ' la sélection">' +
      addLabel(on, wide) + '</button>';
  };
  function addLabel(on, wide) {
    return SA.icon(on ? 'check' : 'plus') + '<span>' + (on ? (wide ? 'Dans la sélection' : 'Ajouté') : (wide ? 'Ajouter à la sélection' : 'Ajouter')) + '</span>';
  }
  function refreshAdd() {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('[data-cart-add]').forEach(function (b) {
      var id = b.getAttribute('data-cart-add'), on = SA.cart.has(id);
      if (b.getAttribute('role') === 'checkbox') {
        if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on));
      } else if (b.getAttribute('aria-pressed') !== String(on)) {
        var it = SA.item(id);
        b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-label', (on ? 'Retirer ' : 'Ajouter ') + (it ? it[1] : id) + (on ? ' de' : ' à') + ' la sélection');
        b.innerHTML = addLabel(on, b.hasAttribute('data-wide'));
      }
      var row = b.closest('[data-row]');
      if (row) row.classList.toggle('is-on', on);
    });
  }

  SA.label = function (qid, value) {
    var g = goalObj();
    var q = g && (g.qs || []).filter(function (x) { return x.id === qid; })[0];
    function one(v) {
      var o = q && (q.opts || []).filter(function (x) { return x[0] === v; })[0];
      return o ? o[1] : String(v);
    }
    if (Array.isArray(value)) return value.map(one).join(', ');
    return value == null ? '' : one(value);
  };

  SA.answered = function () {
    var s = SA.state, g = goalObj();
    if (!s.goal || !g) return false;
    return (g.qs || []).every(function (q) {
      var a = s.answers[q.id];
      return q.multi ? Array.isArray(a) && a.length > 0 : !!a;
    });
  };

  /* Une étape s'ouvre si ce qu'elle demande existe : un objectif pour les questions, des réponses pour les
     recommandations, une sélection pour l'installation, une installation pour le guide.
     Venir de la recherche ouvre l'installation sans ouvrir le questionnaire. */
  SA.canStep = function (n) {
    var s = SA.state;
    if (n <= 1) return true;
    if (n === 2) return !!(s.goal && goalObj());
    if (n === 3) return SA.answered();
    if (n === 4) return s.cart.length > 0 || !!(s.inst && s.inst.phase !== 'idle');
    return (s.lastInstall || []).length > 0;
  };

  /* Furthest reachable wizard step */
  SA.reach = function () {
    var s = SA.state;
    if ((s.lastInstall || []).length) return 5;
    if (s.cart.length) return 4;
    if (!s.goal || !goalObj()) return 1;
    return SA.answered() ? 3 : 2;
  };

  /* ------------------------------------------------------------------ state */
  SA.initState = function (over) {
    var agents = {};
    (D().agents || []).forEach(function (a) { if (a.st === 'ok') agents[a.id] = true; });
    var mine = (D().mine || []).map(function (r) { return Object.assign({}, r, { ag: Object.assign({}, r.ag) }); });
    SA.state = Object.assign({
      route: mine.length ? 'accueil' : 'wizard', step: 1, dir: 1,
      goal: null, answers: {}, qi: 0,
      os: 'mac', agents: agents, custom: [], scope: 'global', scanned: {},
      cart: [], preselected: {}, lastInstall: [], telemetryOff: false, installing: false, guideTab: 0,
      mine: mine, backups: [],
      pv: { machine: 'pleine', net: 'on', agents: 'ok', install: 'ok' },
      dbReady: false, search: null,
      g: { f: 'tous', q: '', sort: 'nom', view: 'liste', sel: {} }
    }, over || {});
    return SA.state;
  };
  SA.initState();

  /* ------------------------------------------------------------------ focus après un nouveau rendu */
  /* Avant le rendu : une clé du contrôle actif (data-fk, id, attributs data-*, sinon libellé), son rang et sa ligne.
     Après : le même contrôle, sinon le suivant du même genre, sinon le message de résultat, sinon le titre.
     Jamais <body>. Les valeurs sont comparées en JavaScript, jamais glissées dans un sélecteur. */
  function act() { return document.activeElement || null; }
  /* Focus perdu : sur <body>, sur un nœud retiré, ou sur un contrôle désactivé ou caché
     (un navigateur laisse le focus sur un bouton qui vient d'être désactivé). */
  function lost(root) {
    var a = act();
    return !a || a === document.body || a.isConnected === false || (root && root.isConnected === false) || (!!a.getAttribute && !usable(a));
  }
  function dataOf(el) {
    var out = [], at = el.attributes || [];
    for (var i = 0; i < at.length; i++) {
      var n = at[i].name;
      if (n.indexOf('data-') === 0 && n !== 'data-st' && n !== 'data-fk') out.push(n + '=' + at[i].value);
    }
    return out.sort();
  }
  function tagOf(el) { return String(el.localName || el.tagName || '').toLowerCase(); }
  function labelOf(el) { return String(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function rowOf(el) { var r = el.closest ? el.closest('[data-row]') : null; return r ? r.getAttribute('data-row') : null; }
  function each(root, sel) { return root && root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(sel)) : []; }
  function usable(el) {
    if (!el || el.disabled || el.hasAttribute('disabled')) return false;
    return !(el.closest && el.closest('[hidden], [inert]'));
  }
  function sameAs(k) {
    return function (el) {
      if (k.fk) return el.getAttribute('data-fk') === k.fk;
      if (k.id) return el.id === k.id;
      if (k.data.length) return dataOf(el).join('&') === k.data.join('&');
      return (el.getAttribute('class') || '') === k.cls && labelOf(el) === k.label;
    };
  }
  function kindOf(k) {
    var pre = k.fk && k.fk.indexOf(':') > 0 ? k.fk.slice(0, k.fk.indexOf(':') + 1) : '';
    var names = k.data.map(function (x) { return x.split('=')[0]; }).join('&');
    return function (el) {
      if (k.fk) return !!pre && String(el.getAttribute('data-fk') || '').indexOf(pre) === 0;
      if (k.id || !names) return false;
      return dataOf(el).map(function (x) { return x.split('=')[0]; }).join('&') === names;
    };
  }
  function focusKey(root) {
    var a = act();
    if (!root || !a || a === document.body || a === root || !root.contains || !root.contains(a) || !a.getAttribute) return null;
    var k = { tag: tagOf(a), fk: a.getAttribute('data-fk') || '', id: a.id || '', data: dataOf(a), cls: a.getAttribute('class') || '', label: labelOf(a), row: rowOf(a) };
    var all = each(root, k.tag);
    var same = all.filter(sameAs(k));
    k.idx = Math.max(0, same.indexOf(a));
    k.ridx = Math.max(0, same.filter(function (el) { return rowOf(el) === k.row; }).indexOf(a));
    k.kidx = Math.max(0, all.filter(kindOf(k)).indexOf(a));
    if (k.tag === 'input' || k.tag === 'textarea') k.field = { v: a.value, s: a.selectionStart, e: a.selectionEnd };
    return k;
  }
  function put(el) {
    if (!el) return false;
    if (!el.hasAttribute('tabindex') && !/^(button|input|select|textarea|a)$/.test(tagOf(el))) el.setAttribute('tabindex', '-1');
    safe(function () { el.focus({ preventScroll: true }); });
    return act() === el;
  }
  function pick(list, i) { return list.length ? list[Math.min(i, list.length - 1)] : null; }
  function heading(root) {
    var h = root && root.querySelector ? root.querySelector('h1') || root.querySelector('h2') || root.querySelector('h3') : null;
    return h && usable(h) ? h : null;
  }
  function viewHeading() { return heading($('view')); }
  function restoreFocus(k, root, fallback) {
    if (!k || !root) return false;
    var all = each(root, k.tag), same = all.filter(sameAs(k));
    var mine = same.filter(function (el) { return rowOf(el) === k.row; });
    var el = mine.length ? pick(mine, k.ridx) : pick(same, k.idx);
    if (el && usable(el)) {
      if (put(el)) {
        if (k.field && el.value === k.field.v && el.setSelectionRange && k.field.s != null) safe(function () { el.setSelectionRange(k.field.s, k.field.e); });
        return true;
      }
    }
    /* Disparu : le suivant du même genre (à son rang), sinon le précédent. Désactivé : on ne le remplace pas par un voisin. */
    if (!el) {
      var kind = all.filter(kindOf(k)).filter(usable);
      if (put(pick(kind, k.kidx))) return true;
    }
    var msg = each(root, '[role="status"][tabindex], [role="alert"][tabindex]').filter(usable)[0];
    if (put(msg)) return true;
    if (put(heading(root))) return true;
    if (fallback && put(fallback)) return true;
    return put(viewHeading());
  }
  /* Pour les rendus partiels des vues : garde le focus dans region pendant fn(). */
  SA.keepFocus = function (region, fn, fallback) {
    var k = focusKey(region);
    var r = fn ? fn() : undefined;
    if (k && lost(region)) restoreFocus(k, region, fallback);
    return r;
  };

  /* ------------------------------------------------------------------ router */
  var busy = false;

  function viewId() {
    var s = SA.state;
    if (s.route === 'accueil') return 'accueil';
    if (s.route === 'recherche') return 'recherche';
    if (s.route === 'gestion') return 'gestion';
    if (s.route === 'agents') return 'agents';
    if (s.route === 'mcp') return 'mcp';
    if (s.route === 'plugins') return 'plugins';
    if (s.route === 'sauvegardes') return 'sauvegardes';
    return IDS[s.step - 1] || 'objectif';
  }
  SA.viewId = viewId;
  function curView() { return SA.views[viewId()]; }

  function stagger(root) {
    var n = 0;
    root.querySelectorAll('[data-st]').forEach(function (el) {
      el.style.setProperty('--i', Math.min(n++, 12));
    });
  }

  function placeholder() {
    return '<p class="eye" data-st>Skill Advisor</p>' + SA.h('Écran indisponible') +
      '<p class="lede" data-st>Cet écran n’a pas pu s’afficher. Choisissez un autre écran dans le menu.</p>';
  }

  function paint(first, still) {
    /* Replace #view with a bare clone: listeners attached by a previous mount() die with the old node,
       so delegated handlers never stack and a view's timers see isConnected === false once left. */
    var old = $('view');
    var key = still ? focusKey(old) : null;
    var v = old.cloneNode(false);
    old.parentNode.replaceChild(v, old);
    var view = curView();
    var html = view && typeof view.render === 'function' ? safe(function () { return view.render(); }, null) : null;
    if (html == null) html = placeholder();
    v.innerHTML = html;
    v.setAttribute('data-view', viewId());
    $('work').classList.toggle('no-pane', !!(view && view.wide));
    stagger(v);
    v.classList.remove('leave', 'enter');
    if (!still) {
      void v.offsetWidth;
      v.classList.add('enter');
      $('scroll').scrollTop = 0;
      $('work').scrollTop = 0;
    }
    if (!first && !still) {
      var h = v.querySelector('h1');
      if (h) safe(function () { h.focus({ preventScroll: true }); });
    }
    if (view && typeof view.mount === 'function') safe(function () { view.mount(v); });
    /* Même lieu : le focus revient au contrôle utilisé, sauf si la vue l'a déjà placé elle-même. */
    if (key && lost(v)) restoreFocus(key, v);
    if (!still) SA.countUp(v);
    else v.querySelectorAll('[data-count]').forEach(function (el) { el.textContent = SA.nb(el.getAttribute('data-count')); });
    SA.sync();
  }

  /* Redessine la vue en place, sans transition : pour un changement d'état, pas de lieu. */
  SA.repaint = function () {
    if (busy || !$('view') || SA.expired()) return;
    var sc = $('scroll'), top = sc.scrollTop, wtop = $('work').scrollTop;
    safe(function () { paint(false, true); });
    sc.scrollTop = top;
    $('work').scrollTop = wtop;
  };

  function navigate() {
    busy = true;
    var v = $('view');
    v.style.setProperty('--dir', SA.state.dir < 0 ? -1 : 1);
    v.classList.remove('enter');
    v.classList.add('leave');
    safe(renderRail);
    safe(renderCrumb);
    safe(renderTitle);
    wait(190, function () {
      if (!SA.expired()) safe(function () { paint(false); });
      busy = false;
    });
  }

  SA.go = function (step, dir) {
    if (busy || SA.expired()) return false;
    step = Math.max(1, Math.min(LAST, parseInt(step, 10) || 1));
    var s = SA.state;
    if (s.route === 'wizard' && s.step === step) return false;
    s.dir = dir ? (dir < 0 ? -1 : 1) : (s.route !== 'wizard' || step >= s.step ? 1 : -1);
    s.step = step;
    s.route = 'wizard';
    if (SA.drawerOpen) SA.closeDrawer();
    navigate();
    return true;
  };

  var ORDER = { accueil: 0, wizard: 1, recherche: 2, gestion: 3, mcp: 4, plugins: 5, sauvegardes: 6, agents: 7 };
  SA.setRoute = function (route) {
    if (busy || SA.expired() || !(route in ORDER)) return false;
    var s = SA.state;
    if (s.route === route) return false;
    s.dir = ORDER[route] > ORDER[s.route] ? 1 : -1;
    s.route = route;
    if (SA.drawerOpen) SA.closeDrawer();
    navigate();
    return true;
  };

  /* Crossfade a sub-region. A second call during the fade only updates the
     pending content, so the latest state always wins and nothing plays twice. */
  SA.swap = function (el, html, after) {
    if (!el) return;
    el._swapHtml = html;
    el._swapAfter = after;
    if (el._swapT) return;
    el.classList.remove('swap-in');
    el.classList.add('swap-out');
    el._swapT = wait(140, function () {
      el._swapT = null;
      el.innerHTML = el._swapHtml;
      stagger(el);
      el.classList.remove('swap-out');
      void el.offsetWidth;
      el.classList.add('swap-in');
      SA.countUp(el);
      var fn = el._swapAfter;
      el._swapHtml = el._swapAfter = null;
      if (typeof fn === 'function') safe(fn);
    });
  };

  SA.countUp = function (root) {
    if (!root) return;
    root.querySelectorAll('[data-count]').forEach(function (el) {
      var to = parseFloat(el.getAttribute('data-count'));
      if (!isFinite(to)) return;
      var dec = (String(el.getAttribute('data-count')).split('.')[1] || '').length;
      var fmt = function (x) { return dec ? x.toFixed(dec) : SA.nb(Math.round(x)); };
      if (el._cu) cancelAnimationFrame(el._cu);
      if (SA.rm || !window.requestAnimationFrame) { el.textContent = fmt(to); return; }
      var t0 = null, dur = 900;
      var from = parseFloat(el.getAttribute('data-from'));
      if (!isFinite(from)) from = 0;
      el.removeAttribute('data-from');
      if (from === to) { el.textContent = fmt(to); return; }
      el.textContent = fmt(from);
      var step = function (t) {
        if (t0 === null) t0 = t;
        var p = Math.min(1, (t - t0) / dur);
        var e = 1 - Math.pow(1 - p, 4);
        el.textContent = fmt(from + (to - from) * e);
        el._cu = p < 1 ? requestAnimationFrame(step) : 0;
      };
      el._cu = requestAnimationFrame(step);
    });
  };

  SA.collapse = function (el, done) {
    if (!el) { if (done) done(); return; }
    if (SA.rm || !el.animate) { if (done) done(); return; }
    var h = el.offsetHeight;
    el.style.overflow = 'hidden';
    var a = el.animate([
      { height: h + 'px', opacity: 1 },
      { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' }
    ], { duration: 320, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
    a.onfinish = function () { if (done) safe(done); };
  };

  SA.copy = function (text, btn) {
    function label(txt) {
      if (!btn) return;
      if (btn._copyT) clearTimeout(btn._copyT);
      if (btn._copyH == null) {
        btn._copyH = btn.innerHTML;
        btn._copyL = btn.getAttribute('aria-label');
        btn.style.minWidth = btn.offsetWidth + 'px';
      }
      btn.innerHTML = SA.icon('check') + '<span>' + SA.esc(txt) + '</span>';
      if (btn._copyL != null) btn.setAttribute('aria-label', txt);
      btn._copyT = setTimeout(function () {
        btn.innerHTML = btn._copyH;
        if (btn._copyL != null) btn.setAttribute('aria-label', btn._copyL);
        btn._copyH = null;
        btn._copyL = null;
        btn._copyT = null;
        btn.style.minWidth = '';
      }, 1400);
    }
    function selectNear() {
      var box = btn && btn.closest ? (btn.closest('[data-copy-scope]') || btn.parentNode) : null;
      var code = box && box.querySelector ? box.querySelector('pre code, pre, [data-copy-text], code') : null;
      if (code && window.getSelection) {
        var r = document.createRange();
        r.selectNodeContents(code);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }
      return false;
    }
    function fallback() {
      var ok = false;
      safe(function () {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
      });
      if (ok) label('Copié');
      else if (selectNear()) label('Sélectionné');
      else label('Copie impossible');
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(text)).then(function () { label('Copié'); }, fallback).catch(fallback);
      } else fallback();
    } catch (e) { fallback(); }
  };

  /* ------------------------------------------------------------------ drawer */
  var opener = null, dOpen = false, dT = null, lastBtn = null, dKind = '';
  SA.drawerOpen = false;

  SA.openDrawer = function (html, title, kind) {
    var d = $('drawer'), sc = $('scrim'), b = $('drawer-body');
    if (!dOpen) opener = lastBtn && lastBtn.isConnected ? lastBtn : document.activeElement;
    clearTimeout(dT);
    dKind = kind || '';
    $('drawer-title').textContent = title || '';
    b.classList.remove('swap-in');
    b.innerHTML = html || '';
    b._h = null;
    stagger(b);
    b.scrollTop = 0;
    d.hidden = false;
    sc.hidden = false;
    void d.offsetWidth;
    d.classList.add('open');
    sc.classList.add('open');
    b.classList.add('swap-in');
    $('app').setAttribute('inert', '');
    dOpen = true;
    SA.drawerOpen = true;
    SA.countUp(b);
    var c = $('drawer-close');
    safe(function () { c.focus({ preventScroll: true }); });
  };

  SA.closeDrawer = function () {
    if (!dOpen) return;
    var d = $('drawer'), sc = $('scrim'), b = $('drawer-body');
    dOpen = false;
    dKind = '';
    SA.drawerOpen = false;
    d.classList.remove('open');
    sc.classList.remove('open');
    $('app').removeAttribute('inert');
    dT = wait(360, function () {
      d.hidden = true;
      sc.hidden = true;
      b.innerHTML = '';
    });
    var o = opener;
    opener = null;
    if (o && document.contains(o) && typeof o.focus === 'function') safe(function () { o.focus({ preventScroll: true }); });
  };

  function trapTab(e) {
    var d = $('drawer');
    var f = Array.prototype.slice.call(d.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return el.getClientRects().length > 0; });
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (!d.contains(a)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  }

  /* ------------------------------------------------------------------ rail */
  var stepBtns = [], navBtns = [];

  function buildRail() {
    var ol = $('rail-ol');
    var steps = D().steps || STEPS;
    ol.innerHTML = steps.map(function (label, i) {
      return '<li><button type="button" class="rail-step" data-step="' + (i + 1) + '">' +
        '<span class="rail-dot" aria-hidden="true"></span>' +
        '<span class="rail-ix">' + pad(i + 1) + '</span>' +
        '<span class="rail-tx">' + SA.esc(label) + '</span>' +
        '<span class="vh rail-sr"></span></button></li>';
    }).join('');
    stepBtns = Array.prototype.slice.call(ol.querySelectorAll('.rail-step'));
    navBtns = Array.prototype.slice.call(document.querySelectorAll('.rail-link'));
  }

  function renderRail() {
    var s = SA.state;
    navBtns.forEach(function (b) {
      if (b.getAttribute('data-route') === s.route) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('rail-steps').hidden = s.route !== 'wizard';
    /* Mode réel : serveur joignable ou arrêté, date et source de la base (live.js). Démonstration : le réglage « Réseau ». */
    if (SA.live && SA.live.on && SA.live.paintRail) SA.live.paintRail();
    else {
      var local = document.querySelector('.rail-net');
      if (local) local.textContent = SA.offline() ? 'Hors ligne · copie locale' : 'En local · 127.0.0.1';
      var pip = document.querySelector('.rail-pip');
      if (pip) pip.classList.toggle('is-off', SA.offline());
    }
    /* While an install runs, the rail cannot leave the step (same rule as Retour). */
    var lockNav = !!s.installing;
    [document.querySelector('.rail-nav'), $('rail-steps')].forEach(function (el) {
      if (!el) return;
      if (lockNav) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
    /* Arrivé à l'installation par la recherche : les étapes du questionnaire n'ont pas été faites, on ne les coche pas. */
    var skipped = s.step >= 4 && !SA.answered();
    stepBtns.forEach(function (b, i) {
      var n = i + 1, done = n < s.step && !(skipped && n < 4);
      b.classList.toggle('is-done', done);
      b.classList.toggle('is-cur', n === s.step);
      b.classList.toggle('is-todo', n !== s.step && !done);
      b.disabled = n !== s.step && !safe(function () { return SA.canStep(n); }, false);
      if (n === s.step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      var sr = b.querySelector('.rail-sr');
      var txt = n === s.step ? ', étape en cours' : done ? ', terminée' : '';
      if (sr.textContent !== txt) sr.textContent = txt;
    });
    $('rail-ol').style.setProperty('--p', skipped ? 0 : s.step - 1);
  }

  /* Fil d'Ariane : { html, count }. Recherche est une entrée de premier niveau : son fil dit la date et la source de la base. */
  function crumbParts() {
    var s = SA.state, steps = D().steps || STEPS;
    var html, count = '';
    function two(a, b) { return '<span class="sub">' + a + '</span><span class="crumb-sep" aria-hidden="true">/</span><span>' + SA.esc(b) + '</span>'; }
    if (s.route === 'wizard') {
      html = two('Conseil', steps[s.step - 1] || '');
      count = pad(s.step) + ' / ' + pad(steps.length);
    } else if (s.route === 'accueil') html = two('Accueil', 'Ma machine');
    else if (s.route === 'recherche') html = two('Recherche', SA.baseLabel());
    else if (s.route === 'gestion') html = two('Gestion', 'Mes skills');
    else if (s.route === 'sauvegardes') html = two('Gestion', 'Sauvegardes');
    else if (s.route === 'mcp') html = two('Gestion', 'Serveurs MCP');
    else if (s.route === 'plugins') html = two('Gestion', 'Plugins');
    else html = two('Gestion', 'Agents');
    return { html: html, count: count };
  }
  /* Pour les essais : le fil d'Ariane sans page. */
  SA.crumbHtml = function () { return crumbParts().html; };
  /* Titre de la page (constat 52) : le nom de l'écran, comme dans le menu, puis « Skill Advisor ». */
  var TITLES = { accueil: 'Ma machine', wizard: 'Conseil', recherche: 'Recherche', gestion: 'Mes skills', mcp: 'Serveurs MCP', plugins: 'Plugins', sauvegardes: 'Sauvegardes', agents: 'Agents' };
  function renderTitle() {
    var r = SA.state.route, t = (own(TITLES, r) ? TITLES[r] + ' · ' : '') + 'Skill Advisor';
    if (document.title !== t) document.title = t;
  }
  function renderCrumb() {
    var c = $('crumb'), n = $('crumb-count'), p = crumbParts();
    if (c._h !== p.html) { c.innerHTML = p.html; c._h = p.html; }
    if (n.textContent !== p.count) n.textContent = p.count;
  }

  /* ------------------------------------------------------------------ sélection : volet, bandeau, tiroir */
  function cartRows(cls) {
    return SA.cart.items().map(function (it) {
      return '<li' + cls('ct:' + it[0], 'ct-row') + '>' +
        '<button type="button" class="ct-name mono" data-detail="' + SA.esc(it[0]) + '">' + SA.esc(it[1]) + '</button>' +
        '<span class="num ct-note">' + (it[6] == null ? '' : it[6]) + '</span>' +
        '<button type="button" class="ct-rm" data-cart-rm="' + SA.esc(it[0]) + '" aria-label="Retirer ' + SA.esc(it[1]) + ' de la sélection">' + SA.icon('close') + '</button></li>';
    }).join('');
  }
  function cartCta() {
    var s = SA.state, n = SA.cart.count();
    if (!n || (s.route === 'wizard' && s.step >= 4)) return '';
    return '<p class="ct-cta"><button type="button" class="btn primary" data-cart-go>Installer ' + SA.pl(n, 'skill', 'skills') + '</button></p>';
  }
  function cartHtml(cls) {
    var n = SA.cart.count();
    return n
      ? '<ul class="ct-list">' + cartRows(cls) + '</ul>' + cartCta()
      : '<p class="ds-none">Aucun skill choisi. Ajoutez-en depuis le conseil ou la recherche.</p>';
  }
  function plain(key, base) { return base ? ' class="' + base + '"' : ''; }

  SA.openCart = function () {
    SA.openDrawer('<div class="ct-drawer">' + cartHtml(plain) + '</div>', 'Sélection', 'cart');
  };

  function renderBand() {
    var band = $('cart-band');
    if (!band) return;
    var s = SA.state, n = SA.cart.count();
    var hide = !n || (s.route === 'wizard' && s.step >= 3);
    if (band.hidden !== hide) band.hidden = hide;
    if (dOpen && dKind === 'cart') {
      var db = $('drawer-body'), dh = '<div class="ct-drawer">' + cartHtml(plain) + '</div>';
      if (db._h !== dh) SA.keepFocus(db, function () { db.innerHTML = dh; db._h = dh; }, $('drawer-close'));
    }
    if (hide) return;
    var txt = SA.pl(n, 'skill', 'skills') + ' dans la sélection';
    var el = band.querySelector('.cb-txt');
    if (el.textContent !== txt) el.textContent = txt;
  }

  /* ------------------------------------------------------------------ dossier */
  var seen = {}, lastSig = null;

  function buildDossier(anim) {
    var s = SA.state, data = D(), g = goalObj();
    var next = {}, k = 0, out = [];

    function cls(key, base) {
      next[key] = true;
      if (anim && !seen[key]) return ' class="' + base + (base ? ' ' : '') + 'ds-new" style="--k:' + (k++) + '"';
      return base ? ' class="' + base + '"' : '';
    }
    function tagCls(key) {
      next[key] = true;
      if (anim && !seen[key]) return ' class="tag ds-pop" style="--k:' + (k++) + '"';
      return ' class="tag"';
    }
    function row(key, dt, dd) {
      return '<div' + cls(key, 'ds-row') + '><dt>' + SA.esc(dt) + '</dt><dd>' + dd + '</dd></div>';
    }
    function sec(title, body, extra) {
      return '<section class="ds-sec"><h3 class="ds-h">' + SA.esc(title) + (extra || '') + '</h3>' + body + '</section>';
    }
    function installRows() {
      var n = SA.agentsOn().length;
      return '<dl class="ds-dl">' +
        row('os=' + s.os, 'Système', SA.esc((data.osLabel || {})[s.os] || s.os)) +
        row('ag=' + n, 'Agents', n + (n > 1 ? ' sélectionnés' : ' sélectionné')) +
        row('sc=' + s.scope, 'Portée', s.scope === 'projet' ? 'Ce projet seulement' : 'Tous les projets') +
        '</dl>';
    }
    /* list : les agents à montrer. Par défaut, ceux qui recevront les installations (interrupteurs). */
    function agentList(prefix, list) {
      var on = list || SA.agentsOn();
      if (!on.length) return '<p class="ds-none">' + (list ? 'Aucun agent n’a de skill.' : 'Aucun agent actif.') + '</p>';
      return '<ul class="ds-list">' + on.map(function (a) {
        var rel = a.abs ? a.abs : String(a.rel || '').replace(/\//g, SA.sep());
        if (!a.abs && s.scope === 'projet' && rel) rel = '…' + SA.sep() + rel;
        return '<li' + cls(prefix + a.id + '@' + s.os + s.scope, '') + '><span>' + SA.esc(a.name) + '</span><span class="mono mut">' + SA.esc(rel) + '</span></li>';
      }).join('') + '</ul>';
    }
    function machine() {
      var mine = s.mine || [];
      var maj = mine.filter(function (r) { return r.st === 'maj'; }).length;
      var off = mine.filter(function (r) { return r.on === false; }).length;
      return sec('Cette machine', '<dl class="ds-dl">' +
        row('gi=' + mine.length, 'Skills installés', '<span class="num">' + mine.length + '</span>') +
        row('gm=' + maj, 'Mises à jour', '<span class="num">' + maj + '</span>') +
        row('go=' + off, 'Désactivés', '<span class="num">' + off + '</span>') +
        row('gos=' + s.os, 'Système', SA.esc((data.osLabel || {})[s.os] || s.os)) +
        '</dl>');
    }

    var n = SA.cart.count();
    var cart = sec('Sélection', cartHtml(cls), n ? '<span class="ds-hn num">' + n + '</span>' : '');

    if (s.route === 'recherche') {
      var sd = SA.search || { items: [], cats: [], details: {}, total: 0 }, sf = s.search || {};
      var act = [];
      if (sf.q) act.push('Texte : ' + sf.q);
      if (sf.cat) (sd.cats || []).forEach(function (c) { if (c.id === sf.cat) act.push(c.label); });
      if (sf.min) act.push('Au moins ' + SA.nb(sf.min) + ' installations');
      if (sf.off) act.push('Sources officielles seulement');
      if (sf.warn === 'sans-eleve') act.push('Sans avertissement élevé');
      if (sf.warn === 'aucun') act.push('Aucun avertissement');
      out.push(cart);
      /* Date et source de la base : le même texte que la vue et le pied du menu (SA.baseLabel). */
      out.push(sec('Base de la recherche', '<dl class="ds-dl">' +
        row('sr-total', 'Recensés par skills.sh', '<span class="num">' + SA.nb(sd.total) + '</span>') +
        row('sr-items', 'Dans la recherche', '<span class="num">' + SA.nb(sd.items.length) + '</span>') +
        row('sr-det', 'Notés et contrôlés', '<span class="num">' + SA.nb(Object.keys(sd.details).length) + '</span>') +
        '</dl><p class="ds-note">' + SA.esc(SA.baseLabel()) + '</p>'));
      out.push(sec('Filtres actifs', act.length
        ? '<ul class="ds-list">' + act.map(function (a) { return '<li' + cls('srf:' + a, '') + '><span>' + SA.esc(a) + '</span></li>'; }).join('') + '</ul>'
        : '<p class="ds-none">Aucun filtre.</p>'));
    } else if (s.route === 'accueil' || s.route === 'gestion' || s.route === 'sauvegardes' || s.route === 'mcp' || s.route === 'plugins') {
      if (n) out.push(cart);
      out.push(machine());
      out.push(sec('Agents actifs', agentList('ga:', holderAgents(s.mine))));
    } else if (s.route === 'agents') {
      if (n) out.push(cart);
      out.push(sec('Installation', installRows()));
      out.push(sec('Agents actifs', agentList('aa:')));
    } else if (!g && !n) {
      out.push('<div class="ds-empty">' +
        '<div class="ds-scene" aria-hidden="true"><div class="ds-stack">' +
        ghost('pdf', [28, 18, 9, 16]) +
        ghost('tdd', [31, 20, 12, 15]) +
        ghost('frontend-design', [34, 22, 13, 18]) +
        '</div></div>' +
        '<p class="ds-empty-txt">Votre dossier se remplit au fil des réponses.</p></div>');
    } else {
      if (g) {
        var rows = row('goal=' + s.goal, 'Objectif', SA.esc(g.title));
        var tags = [g.tag || s.goal];
        (g.qs || []).forEach(function (q) {
          var a = s.answers[q.id];
          if (a == null || (Array.isArray(a) && !a.length) || a === '') return;
          var short = SHORT[q.id] || String(q.q || q.id).replace(/\s*\?\s*$/, '');
          var key = 'q:' + q.id + '=' + (Array.isArray(a) ? a.join(',') : a);
          rows += row(key, short, SA.esc(SA.label(q.id, a)));
          (Array.isArray(a) ? a : [a]).forEach(function (v) {
            if (v === 'nsp') return;
            var t = SA.label(q.id, v);
            /* Lower-case plain words, keep names with inner capitals (iOS, SQL, SwiftUI). */
            if (!/[A-Z]/.test(t.slice(1))) t = t.toLowerCase();
            if (tags.indexOf(t) === -1) tags.push(t);
          });
        });
        var tagHtml = '<div class="ds-tags">' + tags.map(function (t) {
          return '<span' + tagCls('tag:' + t) + '>' + SA.esc(t) + '</span>';
        }).join('') + '</div>';
        out.push(sec('Projet', '<dl class="ds-dl">' + rows + '</dl>' + tagHtml));
      }
      if (s.step >= 3 || n) out.push(cart);
      if (s.step === 3) {
        var w = data.weights || WEIGHTS;
        out.push(sec('Lire la note', '<ul class="ds-legend">' + w.map(function (x, i) {
          return '<li><i class="ds-sw" style="background:var(--s' + (i + 1) + ')"></i><span>' + SA.esc(x.label) + '</span><span class="mono">' + x.max + '</span></li>';
        }).join('') + '</ul><p class="ds-note">Score calculé par Skill Advisor. Ce ne sont pas des avis d’utilisateurs.</p>'));
      }
      if (s.step >= 4) {
        out.push(sec('Installation', installRows()));
        if (s.step === 4 && n) {
          /* Même plan que l'écran d'installation : dossier partagé puis un lien par agent à dossier propre coché,
             ou, sans le dossier partagé, une copie par agent et aucun lien. */
          /* ownN : nombre d'agents à dossier propre. Jamais « k », le compteur d'animation de ce rendu. */
          var p = installPlan(), ownN = p.own.length, mul = '<span class="mono mut">' + n + ' × ' + ownN + '</span>';
          out.push(sec('Résumé', '<dl class="ds-dl">' +
            row('rs=' + n, 'Skills', '<span class="num">' + n + '</span>') +
            row('ra=' + p.reach, 'Agents', '<span class="num">' + p.reach + '</span>') +
            (p.shared
              ? row('rd=' + n, 'Dossiers créés', '<span class="num">' + n + '</span>') +
                row('rl=' + n + 'x' + ownN, 'Liens créés', '<span class="num">' + (n * ownN) + '</span> ' + mul)
              : row('rd=' + n + 'x' + ownN, 'Dossiers créés', '<span class="num">' + (n * ownN) + '</span> ' + mul) +
                row('rl=0', 'Liens créés', '<span class="num">0</span>')) +
            '</dl>'));
        }
      }
    }
    return { html: out.join(''), keys: next };
  }

  /* Plan d'installation de l'étape 4 : celui de l'écran d'installation (SA.installPlan), sinon la même règle ici.
     shared : le dossier partagé est écrit ; own : agents à dossier propre cochés ; reach : agents qui liront les skills. */
  function installPlan() {
    var p = typeof SA.installPlan === 'function' ? safe(SA.installPlan, null) : null;
    if (p && Array.isArray(p.own)) return p;
    var live = !!(SA.live && SA.live.on), on = SA.agentsOn();
    var reads = function (a) { return live ? !!a.universal : a.rel === '.agents/skills'; };
    return { shared: on.some(reads), own: on.filter(function (a) { return !reads(a); }), reach: on.length };
  }
  /* Agents qui ont réellement des skills (Row.ag présent ou copie différente), jamais d'après les interrupteurs. */
  function holderAgents(rows) {
    var ids = [];
    if (SA.detail && typeof SA.detail.holders === 'function') ids = SA.detail.holders(rows || []);
    else (rows || []).forEach(function (r) {
      Object.keys((r && r.ag) || {}).forEach(function (id) { var v = r.ag[id]; if ((v === 'ok' || v === 'div') && ids.indexOf(id) < 0) ids.push(id); });
    });
    return SA.agents().filter(function (a) { return ids.indexOf(a.id) > -1; });
  }
  /* Pour les essais : le contenu du volet de droite sans page. */
  SA.panelHtml = function () { return buildDossier(false).html; };

  function ghost(name, parts) {
    return '<div class="ds-card"><div><span class="ds-cname">' + name + '</span><span class="ds-cline"></span></div>' +
      '<span class="ds-mini">' + parts.map(function (p) { return '<i style="--w:' + p + '%"></i>'; }).join('') + '</span></div>';
  }

  function renderDossier() {
    var el = $('dossier');
    var sig = buildDossier(false).html;
    if (sig === lastSig) return;
    lastSig = sig;
    var r = buildDossier(true);
    /* Un « Retirer » du volet : le focus va au suivant, sinon au titre de la section. */
    SA.keepFocus(el, function () { el.innerHTML = r.html; });
    seen = r.keys;
  }
  SA._dossier = function () { return buildDossier(false).html; };

  /* ------------------------------------------------------------------ action bar */
  var acts = [];
  function renderActions() {
    var view = curView();
    var list = view && typeof view.actions === 'function' ? safe(function () { return view.actions(); }, []) : [];
    if (!Array.isArray(list)) list = [];
    acts = list;
    var bar = $('actions'), inn = $('actions-in');
    var had = !!(inn.contains && inn.contains(act()));
    if (!list.length) {
      bar.hidden = true;
      inn.innerHTML = '';
      /* La barre disparaît sous le focus : il va au titre de la vue. */
      if (had && lost()) put(viewHeading());
      return;
    }
    var btns = inn.querySelectorAll('button');
    if (btns.length !== list.length) {
      var hadFocus = inn.contains(document.activeElement);
      inn.innerHTML = list.map(function (a, i) { return '<button type="button" data-ai="' + i + '"></button>'; }).join('');
      btns = inn.querySelectorAll('button');
      if (hadFocus && btns[btns.length - 1]) btns[btns.length - 1].focus({ preventScroll: true });
    }
    list.forEach(function (a, i) {
      var b = btns[i];
      var kind = a.kind === 'primary' ? ' primary' : a.kind === 'quiet' ? ' quiet' : a.kind === 'danger' ? ' danger' : '';
      var c = 'btn' + kind;
      if (b.className !== c) b.className = c;
      var h = SA.esc(a.label) + (a.kbd ? '<span class="kbd" aria-hidden="true">' + SA.esc(a.kbd) + '</span>' : '');
      if (b._h !== h) { b.innerHTML = h; b._h = h; }
      if (b.disabled !== !!a.disabled) b.disabled = !!a.disabled;
    });
    bar.hidden = false;
    /* Le bouton utilisé se désactive : le focus reste dans la barre, sinon il va au titre de la vue. */
    if (had && lost()) {
      var on = Array.prototype.slice.call(inn.querySelectorAll('button')).filter(usable);
      if (!put(on[on.length - 1])) put(viewHeading());
    }
  }

  function clickPrimary() {
    if ($('actions').hidden) return false;
    var b = $('actions-in').querySelector('.btn.primary:not(:disabled)');
    if (!b) return false;
    b.click();
    return true;
  }

  /* ------------------------------------------------------------------ aperçu du prototype */
  var pvPop = null;
  function pvHtml() {
    var pv = SA.state.pv;
    return '<p class="eye">Aperçu du prototype</p><h2 class="h2" id="pv-t">Voir chaque état</h2>' +
      '<p class="sub pv-lede">Ces réglages servent à parcourir le prototype. Le produit n’en aura pas : il lira l’état réel de la machine.</p>' +
      PV.map(function (p) {
        return '<div class="pv-row"><p class="pv-l" id="pv-l-' + p[0] + '">' + p[1] + '</p><div class="seg" role="group" aria-labelledby="pv-l-' + p[0] + '">' +
          p[2].map(function (o) { return '<button type="button" data-pv="' + p[0] + '" data-v="' + o[0] + '" aria-pressed="' + (pv[p[0]] === o[0]) + '">' + o[1] + '</button>'; }).join('') +
          '</div></div>';
      }).join('') +
      '<p class="pv-foot"><button type="button" class="btn" data-pv-close>Fermer</button></p>';
  }
  function openPv() {
    if (!pvPop) {
      pvPop = document.createElement('dialog');
      pvPop.className = 'sr-pop pv-pop';
      pvPop.setAttribute('aria-labelledby', 'pv-t');
      pvPop.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-pv]') : null;
        if (b) { SA.setPv(b.getAttribute('data-pv'), b.getAttribute('data-v')); pvPop.innerHTML = pvHtml(); return; }
        if (e.target === pvPop || (e.target.closest && e.target.closest('[data-pv-close]'))) pvPop.close();
      });
      document.body.appendChild(pvPop);
    }
    pvPop.innerHTML = pvHtml();
    if (pvPop.showModal) { if (!pvPop.open) pvPop.showModal(); } else pvPop.setAttribute('open', '');
  }
  SA.setPv = function (key, val) {
    var s = SA.state;
    if (!s.pv || s.pv[key] === val || s.installing) return;
    s.pv[key] = val;
    if (key === 'machine') {
      var fresh = (D().mine || []).map(function (r) { return Object.assign({}, r, { ag: Object.assign({}, r.ag) }); });
      s.mine = val === 'vide' ? [] : fresh;
      s.backups = val === 'vide' ? [] : SA.demoBackups();
      s.g.sel = {};
      s.lastInstall = [];
      if (val === 'vide' && s.route === 'accueil') s.route = 'wizard';
    }
    if (key === 'net') s.dbReady = false;
    if (key === 'agents') s.scanned = {};
    if (SA.repaint) SA.repaint();
  };

  /* ------------------------------------------------------------------ theme */
  function effTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function renderTheme() {
    var b = $('theme-btn'), dark = effTheme() === 'dark';
    b.innerHTML = SA.icon(dark ? 'sun' : 'moon');
    b.setAttribute('aria-label', dark ? 'Passer en thème clair' : 'Passer en thème sombre');
  }
  function toggleTheme() {
    var root = document.documentElement;
    var nextT = effTheme() === 'dark' ? 'light' : 'dark';
    if (!SA.rm) {
      root.classList.add('theming');
      clearTimeout(toggleTheme._t);
      toggleTheme._t = setTimeout(function () { root.classList.remove('theming'); }, 420);
    }
    root.setAttribute('data-theme', nextT);
    sset('localStorage', THEME_KEY, nextT);
    renderTheme();
  }

  /* ------------------------------------------------------------------ parcours gardé au rechargement */
  /* sessionStorage (clé sa-journey) : l'onglet garde l'objectif, les réponses, la sélection, le lieu et l'étape.
     Jamais l'installation en cours. Relu au démarrage : seuls les identifiants encore valides reviennent. */
  var JOURNEY = 'sa-journey', restored = false, lastJ = null;
  function saveJourney() {
    if (!SA._started || !restored) return;
    var s = SA.state;
    var j = JSON.stringify({ v: 1, route: s.route, step: s.step, goal: s.goal, answers: s.answers, qi: s.qi, cart: s.cart,
      preselected: s.preselected, auto: s.auto || {}, lastInstall: s.lastInstall, scope: s.scope, guideTab: s.guideTab });
    if (j === lastJ) return;
    lastJ = j;
    sset('sessionStorage', JOURNEY, j);
  }
  function strs(a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; }
  function restoreJourney() {
    restored = true;
    var raw = sget('sessionStorage', JOURNEY), j = null;
    if (!raw) return;
    try { j = JSON.parse(raw); } catch (e) { return; }
    if (!j || typeof j !== 'object' || Array.isArray(j) || j.v !== 1) return;
    var s = SA.state, goals = D().goals || {};
    if (typeof j.goal === 'string' && own(goals, j.goal)) {
      s.goal = j.goal;
      var a = j.answers && typeof j.answers === 'object' && !Array.isArray(j.answers) ? j.answers : {}, ok = {};
      (goals[j.goal].qs || []).forEach(function (q) {
        var ids = (q.opts || []).map(function (o) { return o[0]; }), v = own(a, q.id) ? a[q.id] : null;
        if (q.multi) { var l = strs(v).filter(function (x) { return ids.indexOf(x) > -1; }); if (l.length) ok[q.id] = l; }
        else if (typeof v === 'string' && ids.indexOf(v) > -1) ok[q.id] = v;
      });
      s.answers = ok;
      if (typeof j.qi === 'number' && j.qi >= 0 && j.qi % 1 === 0) s.qi = j.qi;
    }
    s.cart = [];
    strs(j.cart).forEach(function (id) { SA.cart.add(id); });
    /* Choix automatiques (constat 26) : posés après la sélection, car SA.cart.add marque chaque ajout comme un choix à la main.
       Seuls les ids encore dans la sélection et marqués true reviennent. */
    s.auto = {};
    if (j.auto && typeof j.auto === 'object' && !Array.isArray(j.auto)) {
      Object.keys(j.auto).forEach(function (id) { if (j.auto[id] === true && s.cart.indexOf(id) > -1) s.auto[id] = true; });
    }
    s.lastInstall = strs(j.lastInstall).filter(function (id) { return !!(SA.item(id) || SA.mineRow(id)); });
    if (j.scope === 'global' || j.scope === 'projet') s.scope = j.scope;
    if (j.preselected && typeof j.preselected === 'object' && !Array.isArray(j.preselected)) {
      s.preselected = {};
      Object.keys(j.preselected).forEach(function (k) { if (j.preselected[k] === true) s.preselected[k] = true; });
    }
    if (typeof j.guideTab === 'number' && j.guideTab >= 0 && j.guideTab % 1 === 0) s.guideTab = j.guideTab;
    if (typeof j.route === 'string' && own(ORDER, j.route)) {
      s.route = j.route;
      var st = parseInt(j.step, 10);
      if (st >= 1 && st <= LAST) s.step = st;
      /* Une étape qui ne s'ouvre plus : la plus avancée qui s'ouvre. */
      if (!safe(function () { return SA.canStep(s.step); }, false)) s.step = SA.reach();
    }
  }

  /* ------------------------------------------------------------------ sync */
  SA.sync = function () {
    if (SA.expired()) return;
    safe(saveJourney);
    safe(renderRail);
    safe(renderCrumb);
    safe(renderTitle);
    safe(renderDossier);
    safe(renderActions);
    safe(renderBand);
    safe(refreshAdd);
  };

  /* ------------------------------------------------------------------ events */
  function bind() {
    document.querySelector('.rail-nav').addEventListener('click', function (e) {
      var b = e.target.closest('.rail-link');
      if (b) SA.setRoute(b.getAttribute('data-route'));
    });
    $('rail-ol').addEventListener('click', function (e) {
      var b = e.target.closest('.rail-step');
      if (!b || b.disabled) return;
      SA.go(parseInt(b.getAttribute('data-step'), 10));
    });
    /* Safari does not focus buttons on click: remember the last pressed control so the drawer can give focus back. */
    document.addEventListener('click', function (e) {
      lastBtn = e.target && e.target.closest ? e.target.closest('button, a[href]') : null;
    }, true);
    $('theme-btn').addEventListener('click', toggleTheme);
    var pvb = $('pv-btn'), rb = $('refresh-btn'), sample = document.querySelector('.rail-sample');
    if (SA.live && SA.live.on) {
      /* Mode réel : pas de réglages d'aperçu, la machine affichée est la vôtre ; « Actualiser » relit son état. */
      if (pvb) pvb.hidden = true;
      if (rb) {
        rb.innerHTML = SA.icon('refresh') + '<span>Actualiser</span>';
        rb.hidden = false;
        rb.addEventListener('click', function () { if (SA.live.manual) SA.live.manual(); });
      }
    } else {
      if (pvb) {
        pvb.innerHTML = SA.icon('sliders') + '<span>Aperçu</span>';
        pvb.hidden = false;
        pvb.addEventListener('click', openPv);
      }
      if (rb) rb.hidden = true;
      if (sample) sample.textContent = 'Base réelle · machine d’exemple';
    }
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onMq = function () { renderTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    }

    $('actions-in').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ai]');
      if (!b || b.disabled) return;
      var a = acts[parseInt(b.getAttribute('data-ai'), 10)];
      if (a && typeof a.on === 'function') safe(function () { a.on(); });
    });

    /* Gestes communs à tous les écrans, au volet et au tiroir : une seule écoute. */
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var b;
      if ((b = t.closest('[data-cart-add]'))) {
        if (b.disabled) return;
        SA.cart.toggle(b.getAttribute('data-cart-add'));
        SA.sync();
        return;
      }
      if ((b = t.closest('[data-cart-rm]'))) { SA.cart.remove(b.getAttribute('data-cart-rm')); SA.sync(); return; }
      if (t.closest('[data-cart-go]')) { if (SA.cart.count()) SA.go(4, 1); return; }
      if (t.closest('[data-cart-open]')) { SA.openCart(); return; }
      if ((b = t.closest('[data-detail]'))) { if (SA.detail) SA.detail.open(b.getAttribute('data-detail')); return; }
      if ((b = t.closest('[data-warnpop]'))) { if (SA.detail) SA.detail.warnings(b.getAttribute('data-warnpop')); return; }
      if ((b = t.closest('[data-go-route]'))) { SA.setRoute(b.getAttribute('data-go-route')); return; }
      if ((b = t.closest('[data-go-step]'))) { SA.go(parseInt(b.getAttribute('data-go-step'), 10)); return; }
    });

    $('drawer-close').innerHTML = SA.icon('close');
    $('drawer-close').addEventListener('click', SA.closeDrawer);
    $('scrim').addEventListener('click', SA.closeDrawer);

    /* Pointer tilt for the empty-state stack, rAF throttled */
    var pane = $('dossier-pane'), raf = 0, px = 0, py = 0;
    pane.addEventListener('mousemove', function (e) {
      if (SA.rm) return;
      var r = pane.getBoundingClientRect();
      if (!r.width || !r.height) return;
      px = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      py = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      if (!raf) raf = requestAnimationFrame(function () {
        raf = 0;
        pane.style.setProperty('--tx', px.toFixed(3));
        pane.style.setProperty('--ty', py.toFixed(3));
      });
    });
    pane.addEventListener('mouseleave', function () {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      pane.style.setProperty('--tx', '0');
      pane.style.setProperty('--ty', '0');
    });

    document.addEventListener('keydown', function (e) {
      if (SA.expired()) return;
      /* Une fenêtre modale (rapport, aperçu) gère elle-même son clavier. */
      if (document.querySelector('dialog[open]')) return;
      if (dOpen) {
        if (e.key === 'Escape') { e.preventDefault(); SA.closeDrawer(); }
        else if (e.key === 'Tab') trapTab(e);
        return;
      }
      var t = e.target && e.target.closest ? e.target : document.body;
      var typing = !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
      if (typing) {
        /* Échap dans un champ de recherche : vide le champ et le filtre (événement input, écouté par la vue).
           Le focus reste dans le champ. Le navigateur ne vide pas le champ en silence. */
        if (e.key === 'Escape' && t.matches && t.matches('input[type="search"]')) {
          e.preventDefault();
          if (t.value !== '') {
            t.value = '';
            safe(function () { t.dispatchEvent(new window.Event('input', { bubbles: true })); });
          }
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      /* Raccourcis à une touche (« / » et chiffres) : seulement quand le focus est sur <body> ou sur le conteneur #view
         (constat 53). Jamais depuis un titre, un message ou un contrôle.
         Exception : les chiffres sur une puce de réponse, où le questionnaire laisse le focus. */
      var free = t === document.body || t === document.documentElement || t === $('view');
      var pill = !!t.closest('.opt');
      if (e.key === '/' && !free) return;
      /* « / » : chercher, depuis n'importe quel écran. */
      if (e.key === '/' && !busy && !SA.state.installing) {
        e.preventDefault();
        if (SA.state.route === 'recherche' || SA.state.route === 'gestion') {
          var q = $('view').querySelector('input[type="search"]');
          if (q) q.focus();
        } else {
          SA.state.focusSearch = true;
          SA.setRoute('recherche');
        }
        return;
      }
      if (e.key === 'Enter') {
        /* A held Enter must not walk through several steps. */
        if (e.repeat) { e.preventDefault(); return; }
        /* Sur une puce de réponse, Entrée continue dès que tout est répondu : le focus y arrive tout seul
           après chaque question, et Entrée ne doit pas cocher ou décocher par surprise. Espace reste le geste de choix. */
        if (t.closest('.opt') && !$('actions').hidden && $('actions-in').querySelector('.btn.primary:not(:disabled)')) {
          e.preventDefault();
          if (!busy) clickPrimary();
          return;
        }
        if (t.closest('button, a[href], [role="button"], [role="switch"], [role="checkbox"]')) return;
        if (busy) { e.preventDefault(); return; }
        if (clickPrimary()) e.preventDefault();
        return;
      }
      if (busy) return;
      if (!free && !(pill && /^[0-9]$/.test(e.key))) return;
      var view = curView();
      if (view && typeof view.keys === 'function') {
        var handled = safe(function () { return view.keys(e); }, false);
        if (handled) e.preventDefault();
      }
    });
  }

  /* ------------------------------------------------------------------ start */
  SA.start = function () {
    if (SA._started) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', SA.start);
      return;
    }
    if (!$('app') || SA.expired()) return;
    SA._started = true;
    if (!document.documentElement.getAttribute('lang')) document.documentElement.setAttribute('lang', 'fr');
    if (!SA.state) SA.initState();
    safe(restoreJourney);
    /* La coquille s'affiche : fin de l'écran de chargement. */
    $('app').classList.remove('is-boot');
    /* Démo : la machine d'exemple a déjà quelques sauvegardes. En mode réel, elles viennent du serveur. */
    if (!(SA.live && SA.live.on) && !(SA.state.backups || []).length && SA.state.mine.length) SA.state.backups = SA.demoBackups();
    buildRail();
    bind();
    renderTheme();
    $('view').style.setProperty('--dir', 1);
    paint(true);
  };
})();
