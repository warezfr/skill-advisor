/* Skill Advisor prototype: view "gestion" (route gestion) — « Mes skills », vue dense.
   Recherche locale, filtres, tri, sélection multiple, grille skills × agents, activer / désactiver,
   différences avant mise à jour, coût en contexte, guide, sauvegarde avant désinstallation, fichier d'installation. */
(function () {
  window.SA = window.SA || {};
  var SA = window.SA;
  SA.views = SA.views || {};

  var FILTERS = [['tous', 'Tous'], ['maj', 'Mises à jour'], ['relire', 'À relire'], ['off', 'Désactivés'], ['ng', 'Non gérés']];
  var SORTS = [['nom', 'Nom'], ['etat', 'État'], ['ctx', 'Coût en contexte'], ['note', 'Note']];
  var CELL = { ok: ['ok', 'lien en place'], div: ['div', 'copie différente'], ko: ['ko', 'lien cassé'] };
  var CLI = { claude: 'claude-code', gemini: 'gemini-cli', copilot: 'github-copilot' };

  var wrap = null, typeT = 0, armed = null, msg = '', bound = false, focusNext = '';

  var esc = function (s) { return SA.esc(s); };
  function g() { return SA.state.g; }
  function mine() { return SA.state.mine || []; }
  function find(id) { return SA.mineRow(id); }
  /* Colonnes : les agents actifs. Un écart : un agent actif où le skill est absent, différent ou cassé.
     Les skills de plugin n'existent que dans leur agent : ce n'est pas un écart. */
  function cols() { return SA.agentsOn(); }
  function gaps(r) { var a = r.ag || {}; return r.kind !== 'plugin' && cols().some(function (c) { return a[c.id] !== 'ok'; }); }

  function matches(r, f) {
    if (f === 'maj') return r.st === 'maj';
    if (f === 'relire') return r.warn === 1 || r.warn === 2;
    if (f === 'off') return r.on === false;
    if (f === 'ng') return r.st === 'ng';
    return true;
  }
  function counts() {
    var c = { tous: 0, maj: 0, relire: 0, off: 0, ng: 0, chars: 0 };
    mine().forEach(function (r) {
      FILTERS.forEach(function (f) { if (matches(r, f[0])) c[f[0]]++; });
      if (r.on !== false) c.chars += r.chars || 0;
    });
    return c;
  }
  function rank(r) { return (r.st === 'maj' ? 0 : 10) + (r.warn === 2 ? 0 : r.warn === 1 ? 2 : 4) + (r.st === 'ng' ? 1 : 0); }
  function rows() {
    var s = g(), q = s.q.trim().toLowerCase();
    var out = mine().filter(function (r) {
      if (!matches(r, s.f)) return false;
      if (s.view === 'grille' && s.gapsOnly && !gaps(r)) return false;
      return !q || (r.name + ' ' + r.src).toLowerCase().indexOf(q) > -1;
    });
    out.sort(function (a, b) {
      if (s.sort === 'ctx') return (b.chars || 0) - (a.chars || 0);
      if (s.sort === 'note') return (b.note == null ? -1 : b.note) - (a.note == null ? -1 : a.note);
      if (s.sort === 'etat') return rank(a) - rank(b) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name) || a.src.localeCompare(b.src);
    });
    return out;
  }
  function selected() { var sel = g().sel; return mine().filter(function (r) { return sel[r.id]; }); }

  /* ---------- cellules ---------- */
  function nameBtn(r) {
    return '<button type="button" class="gs-name mono" ' + (r.real ? 'data-detail' : 'data-local') + '="' + esc(r.id) + '">' + esc(r.name) + '</button>';
  }
  function srcText(r) {
    if (r.kind === 'plugin') return 'plugin ' + r.plugin;
    if (r.kind === 'manuel') return r.dup ? 'copie manuelle · doublon' : r.match ? 'copie manuelle · source retrouvée : ' + r.match : 'copie manuelle · aucune source retrouvée';
    return r.src;
  }
  function dots(r) {
    var list = cols(), label = list.map(function (a) { var v = (r.ag || {})[a.id]; return a.name + ' : ' + (CELL[v] ? CELL[v][1] : 'absent'); }).join(' ; ');
    return '<span class="gs-dots" role="img" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
      list.map(function (a) { var v = (r.ag || {})[a.id]; return '<i class="gs-d gs-d-' + (v || 'no') + '"></i>'; }).join('') + '</span>';
  }
  function status(r) {
    var h = '';
    if (r.st === 'maj') h += '<span class="bdg up">Mise à jour</span>';
    else if (r.kind === 'plugin') h += '<span class="bdg no">Plugin</span>';
    else if (r.kind === 'manuel') h += '<span class="bdg no">Copie manuelle</span>';
    else h += '<span class="bdg ok">À jour</span>';
    if (r.warn === 2) h += r.real ? '<button type="button" class="bdg bad wbtn" data-warnpop="' + esc(r.id) + '">À relire</button>' : '<button type="button" class="bdg bad wbtn" data-local="' + esc(r.id) + '">À relire</button>';
    else if (r.warn === 1) h += r.real ? '<button type="button" class="bdg tr wbtn" data-warnpop="' + esc(r.id) + '">Avertissement</button>' : '<span class="bdg tr">Avertissement</span>';
    if (r.dup) h += '<span class="bdg tr">Doublon</span>';
    return h;
  }
  function ctx(r) {
    if (r.chars == null) return '<span class="mut">–</span>';
    return '<span class="' + (r.chars > SA.detail.CUT ? 'gs-over' : '') + '">' + SA.nb(r.chars) + '</span>';
  }
  function act(r) {
    var id = esc(r.id);
    if (armed === r.id) {
      return '<span class="gs-ask">Désinstaller ?</span><button type="button" class="gs-a gs-a-bad" data-gs-un-ok="' + id + '">Confirmer</button><button type="button" class="gs-a" data-gs-un-no="' + id + '">Annuler</button>';
    }
    var h = '';
    if (r.st === 'maj') h += '<button type="button" class="gs-a gs-a-up" data-gs-diff="' + id + '">Ce qui change</button>';
    if (r.kind === 'manuel' && r.match) h += '<button type="button" class="gs-a gs-a-up" data-gs-adopt="' + id + '">Prendre en charge</button>';
    h += '<button type="button" class="gs-a" data-guide="' + id + '">Guide</button>';
    if (r.kind !== 'plugin') h += '<button type="button" class="gs-a" data-gs-un="' + id + '" aria-label="Désinstaller ' + esc(r.name) + '">Désinstaller</button>';
    return h;
  }

  function rowHTML(r) {
    var sel = !!g().sel[r.id], plugin = r.kind === 'plugin';
    return '<tr class="gs-r' + (r.on === false ? ' is-off' : '') + (sel ? ' is-sel' : '') + '" data-id="' + esc(r.id) + '">' +
      '<td class="gs-c-cb"><button type="button" class="cb" role="checkbox" aria-checked="' + sel + '" data-gs-sel="' + esc(r.id) + '" aria-label="Sélectionner ' + esc(r.name) + '">' + SA.icon('check') + '</button></td>' +
      '<td class="gs-c-n">' + nameBtn(r) + '<span class="gs-src mut">' + esc(srcText(r)) + '</span></td>' +
      '<td class="gs-c-ag">' + dots(r) + '</td>' +
      '<td class="gs-c-st">' + status(r) + '</td>' +
      '<td class="gs-c-ctx mono">' + ctx(r) + '</td>' +
      '<td class="gs-c-on">' + (plugin ? '<span class="mut gs-na">par le plugin</span>'
        : '<button type="button" class="sw" role="switch" aria-checked="' + (r.on !== false) + '" data-gs-on="' + esc(r.id) + '" aria-label="' + esc(r.name) + ' : actif"></button>') + '</td>' +
      '<td class="gs-c-act">' + act(r) + '</td></tr>';
  }

  function listHTML(list) {
    var all = list.length && list.every(function (r) { return g().sel[r.id]; });
    return '<div class="gs-tablewrap"><table class="gs-table"><thead><tr>' +
      '<th class="gs-c-cb"><button type="button" class="cb" role="checkbox" aria-checked="' + !!all + '" data-gs-sel="all" aria-label="Tout sélectionner">' + SA.icon('check') + '</button></th>' +
      '<th scope="col">Skill</th><th scope="col" class="gs-c-ag">Agents</th><th scope="col" class="gs-c-st">État</th><th scope="col" class="gs-c-ctx">Contexte</th><th scope="col" class="gs-c-on">Actif</th><th scope="col" class="gs-c-act"><span class="vh">Actions</span></th>' +
      '</tr></thead><tbody>' + list.map(rowHTML).join('') + '</tbody></table></div>';
  }

  function gridHTML(list) {
    var c = cols();
    return '<div class="gs-tablewrap"><table class="gs-table gs-grid"><thead><tr><th scope="col">Skill</th>' +
      c.map(function (a) { return '<th scope="col" class="gs-gc">' + esc(a.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      list.map(function (r) {
        return '<tr class="gs-r' + (r.on === false ? ' is-off' : '') + '"><th scope="row" class="gs-c-n">' + nameBtn(r) + '<span class="gs-src mut">' + esc(srcText(r)) + '</span></th>' +
          c.map(function (a) {
            var v = (r.ag || {})[a.id], k = CELL[v];
            return '<td class="gs-gc"><span class="gs-cell gs-cell-' + (v || 'no') + '"><i class="gs-d gs-d-' + (v || 'no') + '" aria-hidden="true"></i><span' + (k && v !== 'ok' ? '' : ' class="vh"') + '>' + (k ? k[1] : 'absent') + '</span></span></td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="gs-legend mut"><span><i class="gs-d gs-d-ok"></i>lien vers le dossier commun</span><span><i class="gs-d gs-d-div"></i>copie différente</span><span><i class="gs-d gs-d-ko"></i>lien cassé</span><span><i class="gs-d gs-d-no"></i>absent</span></p>' +
      '<p class="gs-foot mut">La grille se lit, elle ne répare pas encore : pour corriger un écart, réinstallez le skill dans l’agent concerné.</p>';
  }

  /* ---------- zones redessinées ---------- */
  function subHTML() {
    var c = counts(), tok = Math.round(c.chars / 4 / 100) * 100;
    return SA.pl(c.maj, 'mise à jour', 'mises à jour') + ' · ' + c.relire + ' à relire · ' + SA.pl(c.off, 'désactivé', 'désactivés') +
      ' · environ ' + SA.nb(tok) + ' jetons de contexte pour les skills actifs';
  }
  function filtersHTML() {
    var s = g(), c = counts();
    return FILTERS.map(function (x) { return '<button type="button" data-gs-f="' + x[0] + '" aria-pressed="' + (x[0] === s.f) + '">' + x[1] + '<span class="gs-fn num">' + c[x[0]] + '</span></button>'; }).join('');
  }
  function toolsHTML() {
    var s = g();
    return '<label class="gs-sortl"><span class="vh">Trier par</span><select id="gs-sort" class="fld gs-sort">' +
        SORTS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === s.sort ? ' selected' : '') + '>Tri : ' + x[1] + '</option>'; }).join('') + '</select></label>' +
      '<div class="seg gs-view" role="group" aria-label="Affichage">' +
        [['liste', 'Liste'], ['grille', 'Grille']].map(function (x) { return '<button type="button" data-gs-view="' + x[0] + '" aria-pressed="' + (x[0] === s.view) + '">' + x[1] + '</button>'; }).join('') + '</div>';
  }
  function bulkHTML() {
    var sel = selected(), n = sel.length;
    if (!n) return '';
    if (armed === 'bulk') {
      return '<div class="gs-bulk" role="group" aria-label="Actions sur la sélection"><p class="gs-bulk-n">Désinstaller ' + SA.pl(n, 'skill', 'skills') + ' ? Une sauvegarde de chacun est gardée.</p>' +
        '<button type="button" class="btn danger" data-gs-bulk="un-ok">Confirmer</button><button type="button" class="btn quiet" data-gs-bulk="un-no">Annuler</button></div>';
    }
    var maj = sel.filter(function (r) { return r.st === 'maj'; }).length;
    return '<div class="gs-bulk" role="group" aria-label="Actions sur la sélection"><p class="gs-bulk-n"><span class="num">' + n + '</span> ' + (n > 1 ? 'sélectionnés' : 'sélectionné') + '</p>' +
      (maj ? '<button type="button" class="btn" data-gs-bulk="maj">Mettre à jour<span class="kbd">' + maj + '</span></button>' : '') +
      '<button type="button" class="btn" data-gs-bulk="off">Désactiver</button>' +
      '<button type="button" class="btn" data-gs-bulk="on">Activer</button>' +
      '<button type="button" class="btn" data-gs-bulk="un">Désinstaller</button>' +
      '<button type="button" class="btn quiet" data-gs-bulk="clear">Tout désélectionner</button></div>';
  }
  function backupsHTML() {
    var b = SA.state.backups || [];
    if (!b.length) return '';
    return '<section class="gs-bk" aria-labelledby="gs-bk-t"><h2 class="h2" id="gs-bk-t">Sauvegardes</h2>' +
      '<p class="sub">Chaque désinstallation garde ici une copie du skill, tel qu’il était.</p>' +
      '<ul class="ledger gs-bkl">' + b.map(function (r, i) {
        return '<li><span class="mono gs-bk-n">' + esc(r.name) + '</span><span class="mut gs-src">' + esc(srcText(r)) + '</span>' +
          '<button type="button" class="gs-a gs-a-up" data-gs-restore="' + i + '">Restaurer</button><button type="button" class="gs-a" data-gs-bk-del="' + i + '">Supprimer la sauvegarde</button></li>';
      }).join('') + '</ul></section>';
  }
  function dynHTML() {
    var s = g(), list = rows(), c = counts();
    var gapN = mine().filter(gaps).length;
    return (msg ? '<p class="gs-msg" role="status" tabindex="-1">' + esc(msg) + '</p>' : '') +
      (SA.offline() ? '<div class="note note-warn"><p class="note-t">Hors ligne</p><p class="sub">Recherche de mises à jour suspendue : l’état affiché est le dernier connu. Activer, désactiver et désinstaller restent possibles.</p></div>' : '') +
      bulkHTML() +
      (s.view === 'grille'
        ? '<p class="gs-gapbar"><button type="button" class="sw" role="switch" aria-checked="' + !!s.gapsOnly + '" data-gs-gaps aria-labelledby="gs-gap-l"></button><span id="gs-gap-l">Écarts seulement</span><span class="mut">' + SA.pl(gapN, 'skill n’est pas', 'skills ne sont pas') + ' au même état dans tous les agents</span></p>'
        : '') +
      (list.length
        ? (s.view === 'grille' ? gridHTML(list) : listHTML(list))
        : '<div class="empty gs-none"><p class="sub">Aucun skill ne correspond.</p><p class="empty-a"><button type="button" class="btn" data-gs-reset>Effacer la recherche et les filtres</button></p></div>') +
      '<p class="gs-count mono mut">' + list.length + ' sur ' + c.tous + (list.length > 1 ? ' affichés' : ' affiché') + '</p>' +
      backupsHTML() +
      '<section class="gs-why"><h2 class="h2">Bon à savoir</h2>' +
        '<p class="sub"><strong>Désactiver</strong> laisse le skill sur le disque : l’agent ne le charge plus et il ne pèse plus en contexte. Quand l’agent a un réglage pour cela, Skill Advisor s’en sert ; sinon le skill est rangé dans un dossier de réserve et revient d’un clic. Tous les agents n’ont pas ce réglage : le détail par agent reste à établir par essai.</p>' +
        '<p class="sub"><strong>Copie manuelle</strong> : désinstallable, avec sauvegarde. Si sa source est retrouvée par son empreinte, « Prendre en charge » la rattache et elle se met à jour comme les autres.</p>' +
        '<p class="sub"><strong>Plugin</strong> : c’est le plugin qui installe, met à jour et active ses skills. Skill Advisor les montre et les contrôle, sans y toucher.</p>' +
        '<p class="gs-file"><button type="button" class="btn" data-gs-export>Exporter le fichier d’installation</button>' +
        '<button type="button" class="btn" disabled>Restaurer depuis un fichier</button><span class="mut">Restauration : à confirmer par les essais.</span></p></section>';
  }

  function render() {
    var c = counts();
    if (!c.tous && !(SA.state.backups || []).length) {
      return '<div class="gs"><p class="eye" data-st>Mes skills</p>' + SA.h1('Aucun skill installé') +
        '<div class="empty" data-st><p class="sub">Rien n’a été trouvé dans les dossiers de vos agents. Les skills installés ici, ou ajoutés à la main, apparaîtront dans cette liste.</p>' +
        '<p class="empty-a"><button type="button" class="btn primary" data-go-step="1">Obtenir un conseil</button><button type="button" class="btn" data-go-route="recherche">Ouvrir la recherche</button></p></div></div>';
    }
    return '<div class="gs">' +
      '<p class="eye" data-st>Mes skills</p>' +
      SA.h1(SA.pl(c.tous, 'skill', 'skills') + ' sur cette machine') +
      '<p class="gs-sub sub" id="gs-sub" data-st>' + subHTML() + '</p>' +
      '<div class="gs-bar" data-st>' +
        '<div class="gs-qbox"><label class="vh" for="gs-q">Chercher dans mes skills</label>' +
          '<input id="gs-q" class="fld gs-q" type="search" placeholder="Chercher dans mes skills" autocomplete="off" spellcheck="false" value="' + esc(g().q) + '"><span class="kbd gs-qk" aria-hidden="true">/</span></div>' +
        '<div class="gs-tools" id="gs-tools">' + toolsHTML() + '</div>' +
        '<button type="button" class="btn primary gs-all" id="gs-all"' + (c.maj ? '' : ' hidden') + ' data-gs-all>Tout mettre à jour<span class="kbd">' + c.maj + '</span></button>' +
      '</div>' +
      '<div class="seg gs-seg" id="gs-filters" role="group" aria-label="Filtrer les skills" data-st>' + filtersHTML() + '</div>' +
      '<div id="gs-dyn" data-st>' + dynHTML() + '</div>' +
    '</div>';
  }

  /* Redessine les zones qui dépendent de l'état, sans toucher au champ de recherche. Le focus suit le bouton. */
  function fkey(el) {
    if (!el || !el.attributes) return null;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (/^data-(gs-|guide)/.test(a.name)) { var tr = el.closest('tr'); return [a.name, a.value, tr ? tr.getAttribute('data-id') : '']; }
    }
    return null;
  }
  function refresh() {
    if (!wrap || !wrap.isConnected) return;
    if (!mine().length && !(SA.state.backups || []).length) { SA.repaint(); return; }
    var k = wrap.contains(document.activeElement) ? fkey(document.activeElement) : null;
    var c = counts(), h1 = wrap.querySelector('h1');
    if (h1) h1.textContent = SA.pl(c.tous, 'skill', 'skills') + ' sur cette machine';
    wrap.querySelector('#gs-sub').textContent = subHTML();
    wrap.querySelector('#gs-tools').innerHTML = toolsHTML();
    wrap.querySelector('#gs-filters').innerHTML = filtersHTML();
    wrap.querySelector('#gs-dyn').innerHTML = dynHTML();
    var all = wrap.querySelector('#gs-all');
    all.hidden = !c.maj;
    all.querySelector('.kbd').textContent = c.maj;
    if (k) {
      var hit = null;
      wrap.querySelectorAll('[' + k[0] + ']').forEach(function (el) {
        if (hit || el.getAttribute(k[0]) !== k[1]) return;
        var tr = el.closest('tr');
        if ((tr ? tr.getAttribute('data-id') : '') === k[2]) hit = el;
      });
      if (hit && !hit.disabled) hit.focus({ preventScroll: true });
    }
    /* Un geste qui remplace son propre bouton dit où le focus doit aller : jamais perdu, jamais sur « Confirmer ». */
    if (focusNext) {
      var nx = wrap.querySelector(focusNext);
      focusNext = '';
      if (nx) nx.focus({ preventScroll: true });
    }
    SA.sync();
  }

  /* ---------- gestes ---------- */
  function applyUpdate(r) {
    if (!r || r.st !== 'maj') return;
    r.st = 'ok';
    if (r.diff && r.diff.scan.level === 2) {
      r.warn = 2;
      r.local = [{ label: 'Téléchargement suivi d’une exécution', file: 'scripts/publier.sh', line: 2, excerpt: 'curl -fsSL https://exemple.invalid/outil.sh | sh' }];
    }
    delete r.diff;
  }
  function updateMany(list) {
    var done = 0, held = [];
    list.forEach(function (r) {
      if (r.st !== 'maj') return;
      if (r.diff && r.diff.scan.level === 2) { held.push(r.name); return; }
      applyUpdate(r); done++;
    });
    msg = SA.pl(done, 'skill mis à jour', 'skills mis à jour') + '.' +
      (held.length ? ' ' + held.join(', ') + (held.length > 1 ? ' demandent' : ' demande') + ' votre lecture : la nouvelle version ajoute un motif à risque.' : '');
  }
  function uninstall(list) {
    var s = SA.state, gone = {};
    list.forEach(function (r) { if (r.kind !== 'plugin') { gone[r.id] = true; s.backups.unshift(r); } });
    s.mine = s.mine.filter(function (r) { return !gone[r.id]; });
    s.lastInstall = s.lastInstall.filter(function (id) { return !gone[id]; });
    Object.keys(gone).forEach(function (id) { delete g().sel[id]; });
    var n = Object.keys(gone).length;
    msg = SA.pl(n, 'skill désinstallé', 'skills désinstallés') + '. ' + (n > 1 ? 'Leurs sauvegardes sont' : 'Sa sauvegarde est') + ' en bas de page.';
  }

  function diffHTML(r) {
    var d = r.diff, add = 0, del = 0;
    d.files.forEach(function (f) { add += f[1]; del += f[2]; });
    return '<div class="dt"><p class="eye">Mise à jour</p><p class="dt-name mono">' + esc(r.name) + '</p>' +
      '<p class="dt-src mono mut">' + esc(r.src) + ' · ' + esc(d.from) + ' → ' + esc(d.to) + '</p>' +
      '<section class="dt-sec"><h3 class="h2">Nouveau contrôle</h3>' +
        '<p class="dt-flag"><span class="bdg ' + (d.scan.level === 2 ? 'bad' : 'ok') + '">' + (d.scan.level === 2 ? 'Motif à risque ajouté' : 'Rien de nouveau') + '</span><span>' + esc(d.scan.text) + '</span></p></section>' +
      '<section class="dt-sec"><h3 class="h2">Fichiers modifiés</h3>' +
        '<ul class="ledger dt-aud">' + d.files.map(function (f) { return '<li><span class="mono">' + esc(f[0]) + '</span><span class="mono"><span class="gs-add">+' + f[1] + '</span> <span class="gs-del">−' + f[2] + '</span></span></li>'; }).join('') + '</ul>' +
        '<p class="mut dt-note">' + SA.pl(d.files.length, 'fichier', 'fichiers') + ', ' + add + ' lignes ajoutées, ' + del + ' retirées.</p></section>' +
      '<section class="dt-sec"><h3 class="h2">Extrait des différences</h3>' +
        '<pre class="code gs-diff" tabindex="0"><code>' + d.lines.map(function (l) { return '<span class="gs-l gs-l' + (l[0] === '+' ? 'a' : l[0] === '-' ? 'd' : 'c') + '">' + esc(l[0] + ' ' + l[1]) + '</span>'; }).join('') + '</code></pre>' +
        '<p class="mut dt-note">Skill fictif de la machine d’exemple. L’ancienne version est gardée : elle sert à cette comparaison et à la sauvegarde.</p></section>' +
      '<p class="dt-cta"><button type="button" class="btn primary" data-gs-apply="' + esc(r.id) + '">' + (d.scan.level === 2 ? 'Mettre à jour malgré tout' : 'Mettre à jour') + '</button>' +
      '<button type="button" class="btn" data-gs-later>Plus tard</button></p></div>';
  }
  function openDiff(id) {
    var r = find(id);
    if (!r || !r.diff) return;
    bindDoc();
    SA.openDrawer(diffHTML(r), 'Ce qui change');
  }

  function exportHTML() {
    var skills = mine().filter(function (r) { return r.st !== 'ng'; }).map(function (r) {
      return { source: r.src, skill: r.name, actif: r.on !== false, agents: Object.keys(r.ag || {}).map(function (k) { return CLI[k] || k; }) };
    });
    var txt = JSON.stringify({ format: 'skill-advisor/1', skills: skills }, null, 2);
    return '<div class="dt" data-copy-scope><p class="eye">Fichier d’installation</p>' +
      '<p class="sub">' + SA.pl(skills.length, 'skill géré', 'skills gérés') + '. Les copies manuelles et les skills de plugin n’y figurent pas : ils n’ont pas de source à rejouer.</p>' +
      '<p class="dt-cta"><button type="button" class="btn primary" data-gs-copy>Copier le fichier</button></p>' +
      '<pre class="code gs-export" tabindex="0"><code><!--a-->' + esc(txt) + '<!--/a--></code></pre>' +
      '<p class="mut dt-note">Format provisoire. Le fichier sert à retrouver la même installation sur une autre machine ou dans une équipe ; la restauration reste à confirmer par les essais.</p></div>';
  }

  /* Boutons du tiroir : hors de la vue, une seule écoute au document. */
  function bindDoc() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var a = t.closest('[data-gs-apply]');
      if (a) {
        var r = find(a.getAttribute('data-gs-apply'));
        var risky = r && r.diff && r.diff.scan.level === 2;
        applyUpdate(r);
        msg = r ? r.name + ' mis à jour.' + (risky ? ' Il passe « à relire ».' : '') : '';
        SA.closeDrawer();
        if (SA.viewId() === 'gestion') refresh(); else SA.repaint();
        return;
      }
      if (t.closest('[data-gs-later]')) { SA.closeDrawer(); return; }
      var c = t.closest('[data-gs-copy]');
      if (c) { var code = document.querySelector('.gs-export code'); if (code) SA.copy(code.textContent, c); }
    });
  }

  function onClick(e) {
    var t = e.target.closest('button');
    if (!t || !wrap.contains(t) || t.disabled) return;
    var s = g(), v;
    function has(n) { return t.hasAttribute(n); }
    if (has('data-gs-f')) { s.f = t.getAttribute('data-gs-f'); armed = null; }
    else if (has('data-gs-view')) { s.view = t.getAttribute('data-gs-view'); armed = null; }
    else if (has('data-gs-gaps')) s.gapsOnly = !s.gapsOnly;
    else if (has('data-gs-reset')) { s.f = 'tous'; s.q = ''; s.gapsOnly = false; wrap.querySelector('#gs-q').value = ''; }
    else if (has('data-gs-sel')) {
      v = t.getAttribute('data-gs-sel');
      if (v === 'all') {
        var list = rows(), all = list.every(function (r) { return s.sel[r.id]; });
        list.forEach(function (r) { if (all) delete s.sel[r.id]; else s.sel[r.id] = true; });
      } else if (s.sel[v]) delete s.sel[v]; else s.sel[v] = true;
      if (armed === 'bulk') armed = null;
    }
    else if (has('data-gs-on')) { v = find(t.getAttribute('data-gs-on')); if (v) v.on = v.on === false; msg = ''; }
    else if (has('data-gs-diff')) { openDiff(t.getAttribute('data-gs-diff')); return; }
    else if (has('data-gs-adopt')) {
      v = find(t.getAttribute('data-gs-adopt'));
      if (v && v.match) { v.st = 'ok'; v.src = v.match; delete v.match; delete v.kind; msg = v.name + ' est maintenant géré : il se mettra à jour comme les autres.'; }
    }
    else if (has('data-gs-un')) { armed = t.getAttribute('data-gs-un'); focusNext = '[data-gs-un-no]'; }
    else if (has('data-gs-un-no')) { focusNext = '[data-gs-un="' + armed + '"]'; armed = null; }
    else if (has('data-gs-un-ok')) { v = find(t.getAttribute('data-gs-un-ok')); armed = null; if (v) uninstall([v]); focusNext = '.gs-msg'; }
    else if (has('data-gs-all')) updateMany(mine());
    else if (has('data-gs-bulk')) {
      v = t.getAttribute('data-gs-bulk');
      var sel = selected();
      if (v === 'maj') updateMany(sel);
      else if (v === 'off' || v === 'on') { sel.forEach(function (r) { if (r.kind !== 'plugin') r.on = v === 'on'; }); msg = SA.pl(sel.filter(function (r) { return r.kind !== 'plugin'; }).length, 'skill', 'skills') + (v === 'on' ? ' activés.' : ' désactivés.'); }
      else if (v === 'un') { armed = 'bulk'; focusNext = '[data-gs-bulk="un-no"]'; }
      else if (v === 'un-no') { armed = null; focusNext = '[data-gs-bulk="un"]'; }
      else if (v === 'un-ok') { armed = null; uninstall(sel); focusNext = '.gs-msg'; }
      else if (v === 'clear') { s.sel = {}; armed = null; }
    }
    else if (has('data-gs-restore')) {
      v = SA.state.backups.splice(Number(t.getAttribute('data-gs-restore')), 1)[0];
      if (v) { SA.state.mine.push(v); msg = v.name + ' restauré depuis sa sauvegarde.'; }
    }
    else if (has('data-gs-bk-del')) { SA.state.backups.splice(Number(t.getAttribute('data-gs-bk-del')), 1); msg = 'Sauvegarde supprimée.'; }
    else if (has('data-gs-export')) { bindDoc(); SA.openDrawer(exportHTML(), 'Fichier d’installation'); return; }
    else return;
    refresh();
  }

  function mount(root) {
    wrap = root.querySelector('.gs');
    armed = null;
    msg = '';
    if (!wrap) return;
    bindDoc();
    wrap.addEventListener('click', onClick);
    wrap.addEventListener('input', function (e) {
      if (e.target.id !== 'gs-q') return;
      g().q = e.target.value;
      clearTimeout(typeT);
      typeT = setTimeout(refresh, 100);
    });
    wrap.addEventListener('change', function (e) {
      if (e.target.id !== 'gs-sort') return;
      g().sort = e.target.value;
      refresh();
      var sel = wrap.querySelector('#gs-sort');
      if (sel) sel.focus({ preventScroll: true });
    });
  }

  SA.views.gestion = {
    wide: true,
    render: render,
    mount: mount,
    actions: function () { return []; },
    openDiff: openDiff
  };
})();
