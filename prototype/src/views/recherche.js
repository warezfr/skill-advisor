/* Skill Advisor prototype: view "recherche" (route recherche), version compacte.
   Données réelles : copie de la base en ligne (search-data.js). Le détail et les rapports sont dans views/detail.js.
   Filtres sur une ligne, résultats dès le premier écran, touche « / », bouton d'ajout à la sélection. */
(function () {
  window.SA = window.SA || {};
  var SA = window.SA;
  SA.views = SA.views || {};

  var PAGE = 30;
  var MINS = [[0, 'Installations'], [10000, '10 k et plus'], [100000, '100 k et plus'], [1000000, '1 M et plus']];
  var WARNS = [['tous', 'Avertissements'], ['sans-eleve', 'Sans avert. élevé'], ['aucun', 'Aucun avert.']];
  var SORTS = [['note', 'Tri : note'], ['installs', 'Tri : installations'], ['tendance', 'Tri : tendance']];
  var SHORT = {
    'site-design': 'Design web', frontend: 'Front', mobile: 'Mobile', backend: 'Backend', database: 'Base de données',
    data: 'Données', ia: 'IA', tests: 'Tests', devops: 'DevOps', securite: 'Sécurité', marketing: 'Marketing',
    documents: 'Documents', ux: 'UX', ecommerce: 'E-commerce', methode: 'Méthode', 'desktop-jeu': 'Bureau et jeux'
  };
  var typeT = null, loadT = null, hay = null;

  function esc(s) { return SA.esc(s); }
  function db() { return SA.search || { items: [], cats: [], details: {}, total: 0, generatedAt: '' }; }
  function fresh() { return { q: '', cat: '', min: 0, off: false, warn: 'tous', sort: 'note', shown: PAGE }; }
  function st() {
    var s = SA.state;
    if (!s.search) s.search = fresh();
    return s.search;
  }
  function active(f) { return !!(f.q || f.cat || f.min || f.off || f.warn !== 'tous'); }

  /* Texte cherché : nom et source pour tous, plus la description de l'auteur pour les skills notés. */
  function text(it) {
    if (!hay) hay = {};
    if (hay[it[0]] == null) {
      var k = db().details[it[0]];
      hay[it[0]] = (it[1] + ' ' + it[2] + (k && k.d ? ' ' + k.d : '')).toLowerCase();
    }
    return hay[it[0]];
  }

  function results() {
    var f = st(), d = db(), q = f.q.trim().toLowerCase(), words = q ? q.split(/\s+/) : [];
    var ci = -1;
    d.cats.forEach(function (c, i) { if (c.id === f.cat) ci = i; });
    var out = d.items.filter(function (it) {
      if (it[3] < f.min) return false;
      if (f.off && !it[5]) return false;
      if (ci >= 0 && it[4].indexOf(ci) < 0) return false;
      if (f.warn === 'sans-eleve' && it[7] === 2) return false;
      if (f.warn === 'aucun' && it[7] !== 0) return false;
      if (words.length) {
        var h = text(it);
        for (var i = 0; i < words.length; i++) if (h.indexOf(words[i]) < 0) return false;
      }
      return true;
    });
    if (f.sort === 'installs') out.sort(function (a, b) { return b[3] - a[3]; });
    else if (f.sort === 'tendance') out.sort(function (a, b) { return (a[8] || 9999) - (b[8] || 9999) || b[3] - a[3]; });
    else out.sort(function (a, b) { return (b[6] == null ? -1 : b[6]) - (a[6] == null ? -1 : a[6]) || b[3] - a[3]; });
    return out;
  }

  function rowHtml(it) {
    var d = db();
    var tags = it[4].slice(0, 2).map(function (i) { return '<span class="tag">' + esc(SHORT[d.cats[i].id] || d.cats[i].label) + '</span>'; }).join('');
    return '<li class="sr-row" data-row>' +
      '<div class="sr-main"><p class="sr-l1"><button type="button" class="sr-name mono" data-detail="' + esc(it[0]) + '">' + esc(it[1]) + '</button>' +
        '<span class="sr-src mono mut">' + esc(it[2]) + (it[5] ? ' · officielle' : '') + '</span></p>' +
        '<p class="sr-tags">' + tags + SA.detail.badge(it[7], it[0]) + '</p></div>' +
      '<p class="sr-inst mono"><span class="num">' + SA.short(it[3]) + '</span><span class="mut sr-u">installations</span></p>' +
      '<p class="sr-score">' + (it[6] != null ? '<span class="num">' + it[6] + '</span><span class="sr-u mut">sur 100</span>' : '<span class="sr-u mut">pas encore noté</span>') + '</p>' +
      '<div class="sr-act">' + SA.addBtn(it[0]) + '</div></li>';
  }

  function listing() {
    var r = results(), f = st(), shown = r.slice(0, f.shown);
    return {
      count: r.length,
      status: SA.nb(r.length) + (r.length > 1 ? ' résultats' : ' résultat') + ' · base du ' + SA.dbDate(),
      html: shown.length ? shown.map(rowHtml).join('')
        : '<li class="sr-none"><p class="sub">Aucun skill ne correspond à ces filtres.</p>' +
          (active(f) ? '<p class="empty-a"><button type="button" class="btn" data-sr-reset>Effacer les filtres</button></p>' : '') + '</li>',
      more: r.length > f.shown
    };
  }

  function paint(root, fade) {
    var L = listing(), ul = root.querySelector('#sr-list');
    if (!ul) return;
    root.querySelector('#sr-status').textContent = L.status;
    root.querySelector('#sr-more').hidden = !L.more;
    var rs = root.querySelector('#sr-resetbtn');
    if (rs) rs.hidden = !active(st());
    if (fade && SA.swap && !SA.rm) SA.swap(ul, L.html, function () { SA.sync(); }); else ul.innerHTML = L.html;
    if (SA.sync) SA.sync();
  }

  function select(id, label, opts, cur) {
    return '<label class="sr-f"><span class="vh">' + label + '</span><select id="' + id + '" class="fld">' +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
      '</select></label>';
  }

  function skeleton() {
    var one = '<li class="sr-row" aria-hidden="true"><div class="sr-main"><p class="skl sr-skl-a">nom du skill</p><p class="skl sr-skl-b">catégories</p></div><p class="skl sr-skl-c">000</p><p class="skl sr-skl-c">00</p><p class="skl sr-skl-d">Ajouter</p></li>';
    return one + one + one + one + one + one;
  }

  SA.views.recherche = {
    render: function () {
      var f = st(), d = db(), ready = SA.state.dbReady, L = ready ? listing() : null;
      return '<p class="eye" data-st>Recherche</p>' +
        SA.h1('Chercher parmi ' + SA.nb(d.total) + ' skills') +
        (SA.offline() ? '<div class="note note-warn" role="status" data-st><p class="note-t">Hors ligne</p><p class="sub">La base en ligne ne répond pas : vous cherchez dans la copie locale du ' + esc(SA.dbDate()) + '.</p></div>' : '') +
        '<div class="sr-qbox" data-st><label class="vh" for="sr-q">Nom, source, technologie ou description</label>' +
          '<input id="sr-q" class="fld sr-q" type="search" placeholder="Nom, source, technologie ou description" autocomplete="off" spellcheck="false" value="' + esc(f.q) + '">' +
          '<span class="kbd sr-qk" aria-hidden="true">/</span></div>' +
        '<div class="sr-filters" data-st>' +
          select('sr-cat', 'Type de projet', [['', 'Type de projet']].concat(d.cats.map(function (c) { return [c.id, c.label]; })), f.cat) +
          select('sr-min', 'Installations', MINS, f.min) +
          select('sr-warn', 'Avertissements', WARNS, f.warn) +
          '<span class="sr-offbox"><button type="button" class="sw" role="switch" aria-checked="' + String(!!f.off) + '" aria-labelledby="sr-l-off" data-sr-off></button><span id="sr-l-off">Officielles</span></span>' +
          select('sr-sort', 'Tri', SORTS, f.sort) +
        '</div>' +
        '<p class="sr-statusbar" data-st><span class="sr-status mono mut" id="sr-status" aria-live="polite">' + (ready ? L.status : 'Lecture de la base…') + '</span>' +
          '<button type="button" class="lnk" id="sr-resetbtn" data-sr-reset' + (active(f) ? '' : ' hidden') + '>Effacer les filtres</button></p>' +
        '<ul class="ledger sr-list" id="sr-list" data-st>' + (ready ? L.html : skeleton()) + '</ul>' +
        '<p class="sr-morebox"><button type="button" class="btn" id="sr-more"' + (ready && L.more ? '' : ' hidden') + '>Afficher ' + PAGE + ' de plus</button></p>' +
        '<p class="sr-foot mut">Les ' + SA.nb(d.items.length) + ' skills les plus installés se cherchent ici ; ' + SA.nb(Object.keys(d.details).length) + ' sont notés et contrôlés, et leur description est cherchée aussi. Installations et audits : skills.sh. Étoiles : GitHub. Un avertissement n’empêche pas l’installation : il est affiché et vous décidez.</p>';
    },

    mount: function (root) {
      clearTimeout(loadT);
      if (!SA.state.dbReady) {
        loadT = setTimeout(function () {
          SA.state.dbReady = true;
          if (root.isConnected && SA.viewId() === 'recherche') paint(root, false);
        }, SA.rm ? 0 : 600);
      }
      if (SA.state.focusSearch) {
        delete SA.state.focusSearch;
        setTimeout(function () { var q = root.querySelector('#sr-q'); if (q && root.isConnected) q.focus(); }, 60);
      }
      root.addEventListener('input', function (e) {
        if (e.target.id !== 'sr-q') return;
        var f = st();
        f.q = e.target.value; f.shown = PAGE;
        clearTimeout(typeT);
        typeT = setTimeout(function () { if (root.isConnected && SA.state.dbReady) paint(root, false); }, 120);
      });
      root.addEventListener('change', function (e) {
        var f = st(), id = e.target.id;
        if (id === 'sr-cat') f.cat = e.target.value;
        else if (id === 'sr-min') f.min = Number(e.target.value);
        else if (id === 'sr-warn') f.warn = e.target.value;
        else if (id === 'sr-sort') f.sort = e.target.value;
        else return;
        f.shown = PAGE;
        paint(root, true);
      });
      root.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !root.contains(b)) return;
        var f = st();
        if (b.id === 'sr-more') { f.shown += PAGE; paint(root, false); return; }
        if (b.hasAttribute('data-sr-off')) { f.off = !f.off; b.setAttribute('aria-checked', String(f.off)); f.shown = PAGE; paint(root, true); return; }
        if (b.hasAttribute('data-sr-reset')) {
          SA.state.search = fresh();
          SA.repaint();
          var q = document.getElementById('sr-q');
          if (q) q.focus();
        }
      });
    },

    actions: function () { return []; }
  };
})();
