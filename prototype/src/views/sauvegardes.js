/* Skill Advisor · view sauvegardes (route sauvegardes) : la liste des sauvegardes et leurs gestes.
   Restaurer à leur place, appliquer à d'autres agents (tiroir), exporter, importer, supprimer.
   Mode démo : en mémoire, sur SA.state.backups. Mode réel : chaque geste passe par le serveur local,
   l'état revient avec la réponse. Toute valeur venue de la machine est échappée avant d'entrer dans le HTML. */
(function () {
  'use strict';
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  var NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  var AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
  var MAX = 200 * 1024 * 1024;
  var FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.tar\.gz$/;
  var LOCAL = 'Il demande l’application locale : lancez Skill Advisor sur votre machine avec npm start. La machine d’exemple ne lit ni n’écrit aucun fichier.';
  var REASON = {
    identical: 'déjà identique',
    exists: 'existe déjà, la version présente reste',
    rouge: 'motif à risque, non forcé'
  };
  var esc = function (s) { return SA.esc(s); };
  /* Table sans prototype : un nom de skill comme « constructor » n'y trouve rien d'hérité. */
  function bag() { return Object.create(null); }

  function live() { return !!(SA.live && SA.live.on); }
  function st() {
    var s = SA.state;
    if (!s.sv || typeof s.sv !== 'object') s.sv = { msg: '', err: '', warns: [], wt: '', res: null, busy: '', del: null, rg: null, ap: null, focus: '' };
    return s.sv;
  }
  function raws() { return SA.state.backups || []; }
  /* Recherche par comparaison : un id ne sert jamais à construire un sélecteur. */
  function indexOf(id) {
    var l = raws();
    for (var i = 0; i < l.length; i++) if (String(l[i] && l[i].id) === String(id)) return i;
    return -1;
  }
  function find(id) { var i = indexOf(id); return i < 0 ? null : SA.normBackup(raws()[i]); }
  function list() { return raws().map(SA.normBackup); }

  function when(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'le ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' à ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function verdictBdg(v) {
    if (v === 'rouge') return '<span class="bdg bad">Motif à risque</span>';
    if (v === 'orange') return '<span class="bdg tr">Avertissement</span>';
    return '';
  }
  function errText(e) {
    if (e && e.code && e.message) return e.message;
    return e && e.code ? 'Le serveur local n’a pas répondu.' : 'Réponse inattendue du serveur local. Rechargez la page pour voir l’état réel.';
  }

  /* ------------------------------------------------------------ outils partagés avec Mes skills (démo) */
  function stamp(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '-' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
  }
  /* Coupe à n unités UTF-16 au plus (le serveur compte String.length), sans garder la moitié d'un emoji. */
  function cut(s, n) {
    var out = '';
    Array.from(String(s || '').trim()).every(function (c) { if (out.length + c.length > n) return false; out += c; return true; });
    return out;
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sauvegarde'; }
  function verdictOfRow(r) {
    if (r.scan && r.scan.verdict) return r.scan.verdict;
    return r.warn === 2 ? 'rouge' : r.warn === 1 ? 'orange' : 'vert';
  }
  /* Sauvegarde en mémoire, à la forme du contrat, faite de lignes de Mes skills. */
  function fromRows(rows, origin, label, note) {
    var d = new Date(), items = rows.map(function (r) {
      return { name: r.name, src: r.kind === 'manuel' ? null : r.src, agents: Object.keys(r.ag || {}), verdict: verdictOfRow(r) };
    });
    label = cut(label, 80) || (rows.length === 1 ? rows[0].name : 'Sauvegarde de ' + rows.length + ' skills');
    var id = stamp(d) + '-' + slug(label), n = 2, base = id;
    while (indexOf(id) > -1) id = base + '-' + n++;
    return {
      id: id, label: label, note: cut(note, 500), origin: origin, at: d.toISOString(),
      size: rows.reduce(function (a, r) { return a + (r.chars || 200) * 24; }, 0),
      items: items, name: items[0].name, src: items[0].src, agents: items[0].agents.slice(), rows: rows.map(copyRow)
    };
  }
  function copyRow(r) { return Object.assign({}, r, { ag: Object.assign({}, r.ag || {}) }); }
  function rowFrom(item, ag) {
    var id = (item.src ? item.src : 'local') + '/' + item.name, base = id, n = 2;
    while (SA.mineRow(id)) id = base + '#' + n++;
    var r = { id: id, name: item.name, src: item.src || 'copie manuelle', real: false, st: item.src ? 'ok' : 'ng', on: true, ag: ag,
      chars: null, warn: item.verdict === 'rouge' ? 2 : item.verdict === 'orange' ? 1 : 0 };
    if (!item.src) r.kind = 'manuel';
    return r;
  }
  function targets() {
    var on = SA.state.agents || {};
    return Object.keys(on).filter(function (k) { return on[k]; });
  }
  /* Restauration en mémoire : refusée, comme sur le serveur, si un skill du même nom est déjà là. */
  function restoreDemo(raw) {
    var b = SA.normBackup(raw), mine = SA.state.mine;
    var clash = b.items.filter(function (i) { return mine.some(function (r) { return r.name === i.name; }); });
    if (clash.length) {
      return { ok: false, text: clash.map(function (i) { return i.name; }).join(', ') + (clash.length > 1 ? ' existent' : ' existe') + ' déjà sur cette machine. Skill Advisor n’a rien restauré.' };
    }
    if (!Array.isArray(raw.items)) mine.push(copyRow(raw));
    else if (Array.isArray(raw.rows)) raw.rows.forEach(function (r) { mine.push(copyRow(r)); });
    else b.items.forEach(function (i) {
      /* Sans dossier d'origine connu (sauvegarde importée) : les agents cibles. */
      var ag = {};
      (i.agents.length ? i.agents : targets()).forEach(function (a) { ag[a] = 'ok'; });
      mine.push(rowFrom(i, ag));
    });
    var k = raws().indexOf(raw);
    if (k > -1) raws().splice(k, 1);
    return { ok: true, text: b.label + ' restaurée : ' + SA.pl(b.items.length, 'skill remis', 'skills remis') + ' à leur place.' };
  }
  SA.backup = { fromRows: fromRows, restoreDemo: restoreDemo, cut: cut };

  /* ------------------------------------------------------------ appels */
  function repaint(focus) {
    if (focus) st().focus = focus;
    if (SA.state.route === 'sauvegardes' && SA.repaint) SA.repaint();
  }
  function run(label, fn, done) {
    var s = st();
    if (s.busy) return Promise.resolve(false);
    s.busy = label; s.err = ''; s.msg = ''; s.warns = []; s.wt = ''; s.res = null; s.rg = null;
    repaint();
    var ok = false;
    /* Réussi ou non, et même si done() lève : le verrou est rendu et l'écran redessiné. */
    return Promise.resolve().then(fn).then(function (res) { done(res || {}); ok = true; }).catch(function (e) {
      s.msg = ''; s.err = errText(e);
    }).then(function () {
      s.busy = '';
      repaint(s.err ? 'err' : s.rg ? 'rg-no' : 'msg');
      return ok;
    });
  }
  function say(msg, err) {
    var s = st();
    if (s.busy) return Promise.resolve(false);
    s.msg = msg || ''; s.err = err || ''; s.warns = []; s.wt = ''; s.res = null;
    repaint(err ? 'err' : 'msg');
    return Promise.resolve(!err);
  }

  /* Noms à forcer après un refus ROUGE : les éléments marqués rouges, sinon tous (verdict inconnu ou ancien).
     Plus les noms que le serveur a cités dans son refus (contrôle refait sur chaque copie). */
  function forceNames(b, said) {
    var red = b.items.filter(function (i) { return i.verdict === 'rouge'; }).map(function (i) { return i.name; });
    var inB = b.items.map(function (i) { return i.name; });
    (said || []).forEach(function (n) { if (inB.indexOf(n) > -1) red.push(n); });
    return (red.length ? red : inB).filter(function (n, k, l) { return l.indexOf(n) === k; });
  }
  var ASK = {};
  function restore(id, force) {
    var i = indexOf(id), b = find(id);
    if (i < 0) return Promise.resolve(false);
    if (st().busy) return Promise.resolve(false);
    var said = force ? st().rgNames : null;
    st().del = null; st().rg = null; st().rgNames = null;
    if (live()) {
      var body = { id: b.id };
      if (force) body.force = forceNames(b, said);
      return run('Restauration en cours…', function () {
        return SA.live.call('POST', '/api/backups/restore', body).catch(function (e) {
          /* Motif à risque : une question d'abord, puis un seul renvoi avec force. */
          if (!force && e && e.code === 'ROUGE') { st().rgNames = Array.isArray(e.names) ? e.names.filter(function (n) { return typeof n === 'string'; }) : null; return ASK; }
          throw e;
        });
      }, function (res) {
        if (res === ASK) { st().rg = b.id; return; }
        st().msg = b.label + ' restaurée : ' + SA.pl(b.items.length, 'skill remis', 'skills remis') + ' à leur place.';
      });
    }
    var r = restoreDemo(raws()[i]);
    return r.ok ? say(r.text) : say('', r.text);
  }
  function confirmRestore() {
    var id = st().rg;
    st().rg = null;
    if (id == null || indexOf(id) < 0) { repaint(); return Promise.resolve(false); }
    return restore(id, true);
  }
  function cancelRestore() { var id = st().rg; st().rg = null; st().rgNames = null; repaint(id != null ? 'restore:' + id : ''); }
  function askDelete(id) { if (indexOf(id) > -1 && !st().busy) { st().rg = null; st().del = String(id); repaint('del-no'); } }
  function cancelDelete() { var id = st().del; st().del = null; repaint(id ? 'del:' + id : ''); }
  function confirmDelete() {
    var id = st().del, i = indexOf(id), b = find(id);
    st().del = null;
    if (i < 0) { repaint(); return Promise.resolve(false); }
    if (live()) return run('Suppression en cours…', function () { return SA.live.call('POST', '/api/backups/delete', { id: b.id }); }, function () { st().msg = 'Sauvegarde supprimée : ' + b.label + '.'; });
    raws().splice(i, 1);
    return say('Sauvegarde supprimée : ' + b.label + '.');
  }

  function exportB(id) {
    var b = find(id);
    if (!b) return Promise.resolve(false);
    if (!live()) return say('L’export crée une archive sur votre disque. ' + LOCAL);
    var U = window.URL;
    if (!U || typeof U.createObjectURL !== 'function' || !document.createElement) return say('', 'Ce navigateur ne permet pas le téléchargement. Essayez avec un autre navigateur.');
    return run('Préparation de l’archive…', function () {
      return SA.live.download('/api/backups/export?id=' + encodeURIComponent(b.id));
    }, function (r) {
      /* Nom proposé par le serveur gardé seulement s'il a la forme attendue. */
      var name = FILE.test(r.name || '') ? r.name : 'skill-advisor-' + b.id.replace(/[^A-Za-z0-9._-]/g, '_') + '.tar.gz';
      var url = U.createObjectURL(r.blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { U.revokeObjectURL(url); }, 4000);
      st().msg = 'Archive téléchargée : ' + name + '. Importez-la sur une autre machine depuis cet écran.';
    });
  }

  function importFile(file) {
    if (!file) return Promise.resolve(false);
    if (!live()) return say('L’import lit une archive de votre disque. ' + LOCAL);
    var name = String(file.name || '');
    if (!/\.(tar\.gz|tgz)$/i.test(name)) return say('', 'Choisissez une archive .tar.gz exportée par Skill Advisor.');
    if (Number(file.size) > MAX) return say('', 'Cette archive dépasse 200 Mo : Skill Advisor ne peut pas l’importer.');
    return run('Import en cours…', function () {
      return SA.live.upload('/api/backups/import', file, 'application/gzip');
    }, function (res) {
      var s = st(), b = res.backup ? SA.normBackup(res.backup) : null;
      s.warns = (Array.isArray(res.warnings) ? res.warnings : []).map(String);
      s.msg = 'Sauvegarde importée' + (b ? ' : ' + b.label + ', ' + SA.pl(b.items.length, 'skill', 'skills') : '') + '. Skill Advisor a contrôlé de nouveau chaque skill.';
    });
  }

  /* ------------------------------------------------------------ tiroir « Appliquer à d'autres agents » */
  function agentsAll() {
    return SA.agents().map(function (a) {
      return { id: String(a.id), name: String(a.name || a.id), custom: !!a.custom, universal: !!a.universal, detected: live() ? !!a.detected : a.st !== 'no' };
    });
  }
  function agentName(id) {
    var a = agentsAll().filter(function (x) { return x.id === id; })[0];
    return a ? a.name : id;
  }
  function ap() { return st().ap; }

  function openApply(id) {
    var b = find(id);
    if (!b || st().busy) return;
    var names = bag(), ags = bag(), known = bag();
    b.items.forEach(function (i) { names[i.name] = true; });
    agentsAll().forEach(function (a) { known[a.id] = a; });
    targets().forEach(function (k) { if (known[k] && (known[k].detected || known[k].custom)) ags[k] = true; });
    st().ap = { id: b.id, names: names, agents: ags, conflict: 'skip', force: bag(), q: '', result: null, warns: [], err: '', busy: false };
    st().del = null; st().rg = null;
    bindDoc();
    SA.openDrawer(drawerHTML(), 'Appliquer à d’autres agents', 'sv-apply');
  }
  /* Zone sous le choix du conflit, mise à jour sans redessiner le tiroir (le focus reste). */
  function paintShared() {
    var el = document.getElementById ? document.getElementById('sv-ap-shared') : null;
    if (el && ap()) el.innerHTML = sharedHTML();
  }
  function setItem(name, on) { var a = ap(); if (a) { a.names[name] = !!on; paintShared(); } }
  function setAgent(id, on) { var a = ap(); if (a) { if (on) a.agents[id] = true; else delete a.agents[id]; paintShared(); } }
  function setForce(name, on) { var a = ap(); if (a) a.force[name] = !!on; }
  function setConflict(c) { var a = ap(); if (a && (c === 'skip' || c === 'replace')) { a.conflict = c; paintShared(); } }

  /* « Remplacer » touche ~/.agents/skills dès qu'un agent choisi le lit ou y pointe par un lien :
     tout agent connu, sauf ceux ajoutés à la main (ils reçoivent une copie). */
  var SHARED = 'Le dossier partagé ~/.agents/skills sera remplacé : tous les agents qui le lisent recevront cette version.';
  function sharedHTML() {
    var a = ap();
    if (!a || a.conflict !== 'replace') return '';
    var all = agentsAll(), chosen = bag(), linked = bag();
    Object.keys(a.agents).forEach(function (k) { if (a.agents[k] === true) chosen[k] = true; });
    if (!all.some(function (x) { return chosen[x.id] === true && !x.custom; })) return '';
    /* Agents qui ont déjà un des skills choisis : leur lien pointe vers le dossier partagé. */
    /* Les éléments portent le nom du dossier : dernier segment de path, sinon le nom de la ligne. Lignes de projet ignorées. */
    (SA.state.mine || []).forEach(function (r) {
      if (!r || r.kind === 'plugin' || r.scope === 'project') return;
      var dir = r.path ? String(r.path).split(/[\\/]/).filter(Boolean).pop() : r.name;
      if (a.names[dir] === true) Object.keys(r.ag || {}).forEach(function (k) { linked[k] = true; });
    });
    var names = all.filter(function (x) {
      return x.detected && !x.custom && (x.universal || chosen[x.id] === true || linked[x.id] === true);
    }).map(function (x) { return esc(x.name); });
    return '<p class="sv-shared">' + esc(SHARED) + '</p>' +
      (names.length ? '<p class="mut sv-hint">Agents détectés concernés : ' + names.join(', ') + '.</p>' : '');
  }
  function setQuery(q) {
    var a = ap();
    if (!a) return;
    a.q = String(q == null ? '' : q);
    var el = document.getElementById ? document.getElementById('sv-ap-others') : null;
    if (el) el.innerHTML = othersHTML();
  }

  function agentBox(a) {
    var on = ap().agents[a.id] === true;
    return '<li><label class="sv-cb"><input type="checkbox" data-sv-ap-agent="' + esc(a.id) + '"' + (on ? ' checked' : '') + '><span>' + esc(a.name) + '</span></label></li>';
  }
  function othersHTML() {
    var a = ap(), q = a.q.trim().toLowerCase();
    var others = agentsAll().filter(function (x) { return !x.custom && !x.detected; });
    var shown = others.filter(function (x) {
      return a.agents[x.id] === true || (q && (x.name.toLowerCase().indexOf(q) > -1 || x.id.indexOf(q) > -1));
    });
    var hint = q && !shown.length ? 'Aucun agent ne correspond.'
      : !q ? SA.pl(others.length, 'autre agent connu', 'autres agents connus') + '. Cherchez-en un par son nom.' : '';
    return (shown.length ? '<ul class="sv-cks">' + shown.map(agentBox).join('') + '</ul>' : '') + (hint ? '<p class="mut sv-hint">' + hint + '</p>' : '');
  }
  function formHTML(b) {
    var a = ap(), all = agentsAll();
    var det = all.filter(function (x) { return x.detected && !x.custom; }), cus = all.filter(function (x) { return x.custom; });
    return '<section class="dt-sec"><h3 class="h2">Skills à appliquer</h3><ul class="sv-cks">' + b.items.map(function (i) {
        return '<li><label class="sv-cb"><input type="checkbox" data-sv-ap-item="' + esc(i.name) + '"' + (a.names[i.name] === true ? ' checked' : '') + '><span class="mono">' + esc(i.name) + '</span>' + verdictBdg(i.verdict) + '</label>' +
          (i.verdict === 'rouge'
            ? '<label class="sv-cb sv-force"><input type="checkbox" data-sv-ap-force="' + esc(i.name) + '"' + (a.force[i.name] === true ? ' checked' : '') + '><span>Appliquer malgré l’avertissement</span></label>'
            : '') + '</li>';
      }).join('') + '</ul></section>' +
      '<section class="dt-sec"><h3 class="h2">Agents</h3>' +
        (det.length ? '<p class="sv-gh">Détectés sur cette machine</p><ul class="sv-cks">' + det.map(agentBox).join('') + '</ul>' : '<p class="mut sv-hint">Aucun agent détecté.</p>') +
        '<p class="sv-gh">Autres agents</p>' +
        '<label class="vh" for="sv-ap-q">Chercher un autre agent</label>' +
        '<input id="sv-ap-q" class="fld sv-q" type="search" autocomplete="off" spellcheck="false" placeholder="Chercher un agent" value="' + esc(a.q) + '">' +
        '<div id="sv-ap-others">' + othersHTML() + '</div>' +
        (cus.length ? '<p class="sv-gh">Ajoutés à la main</p><ul class="sv-cks">' + cus.map(agentBox).join('') + '</ul>' : '') +
      '</section>' +
      '<section class="dt-sec"><h3 class="h2">Si le skill existe déjà</h3><div class="sv-cks" role="radiogroup" aria-label="Si le skill existe déjà">' +
        '<label class="sv-cb"><input type="radio" name="sv-ap-conflict" data-sv-ap-conflict="skip"' + (a.conflict === 'skip' ? ' checked' : '') + '><span>Passer : la version présente reste</span></label>' +
        '<label class="sv-cb"><input type="radio" name="sv-ap-conflict" data-sv-ap-conflict="replace"' + (a.conflict === 'replace' ? ' checked' : '') + '><span>Remplacer (une sauvegarde de la version présente est faite)</span></label>' +
      '</div><div id="sv-ap-shared" aria-live="polite">' + sharedHTML() + '</div>' +
      '<p class="mut sv-hint">Skill Advisor passe toujours un skill identique.</p></section>' +
      (a.err ? '<div class="note note-bad sv-ap-err" role="alert" id="sv-ap-err" tabindex="-1"><p class="sub">' + esc(a.err) + '</p></div>' : '') +
      '<p class="dt-cta"><button type="button" class="btn primary" data-sv-ap-go' + (a.busy ? ' disabled' : '') + '>' + (a.busy ? 'Application en cours…' : 'Appliquer') + '</button>' +
      '<button type="button" class="btn" data-sv-ap-cancel' + (a.busy ? ' disabled' : '') + '>Annuler</button></p>';
  }
  /* Lignes du bilan, dans l'ordre des skills : gardées aussi sur l'écran après la fermeture du tiroir. */
  var MARK = { ok: '<span class="bdg ok">Appliqué</span>', no: '<span class="bdg no">Passé</span>', bad: '<span class="bdg bad">Échec</span>' };
  function resRows(r, order) {
    var rows = [];
    r.applied.forEach(function (x) { rows.push({ name: x.name, agent: x.agent, k: 'ok', t: '' }); });
    r.skipped.forEach(function (x) { rows.push({ name: x.name, agent: x.agent, k: 'no', t: SA.own(REASON, x.reason) ? REASON[x.reason] : 'laissé de côté' }); });
    r.failed.forEach(function (x) { rows.push({ name: x.name, agent: x.agent, k: 'bad', t: typeof x.message === 'string' && x.message ? x.message : 'échec' }); });
    rows.sort(function (p, q) { return order.indexOf(p.name) - order.indexOf(q.name); });
    return rows;
  }
  function resList(rows) {
    return '<ul class="ledger sv-res">' + rows.map(function (p) {
      return '<li><span class="mono sv-res-n">' + esc(p.name) + '</span><span class="sv-res-a">' + (p.agent === null ? '' : esc(agentName(p.agent))) + '</span>' + MARK[p.k] +
        (p.t ? '<span class="sv-res-t' + (p.k === 'bad' ? ' sv-fail' : ' mut') + '">' + esc(p.t) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function warnsHTML(title, l) {
    return '<div class="note note-warn sv-warns"><p class="note-t">' + esc(title) + '</p><ul class="sv-wl">' +
      l.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
  }
  function resultHTML() {
    var a = ap(), r = a.result, rows = resRows(r, Object.keys(a.names));
    var nb = r.backups.length;
    return '<section class="dt-sec"><h3 class="h2" id="sv-ap-res" tabindex="-1">Résultat</h3>' +
      '<p class="sub">' + SA.pl(r.applied.length, 'application faite', 'applications faites') + ', ' + SA.pl(r.skipped.length, 'passée', 'passées') + ', ' + SA.pl(r.failed.length, 'échec', 'échecs') + '.</p>' +
      (rows.length ? resList(rows) : '') +
      (a.warns.length ? warnsHTML('À relire', a.warns) : '') +
      (nb ?'<p class="sub">' + (nb > 1 ? 'Skill Advisor a fait ' + nb + ' sauvegardes de la version présente. Elles figurent' : 'Skill Advisor a fait 1 sauvegarde de la version présente. Elle figure') + ' dans la liste, « avant remplacement ».</p>' : '') +
      '</section><p class="dt-cta"><button type="button" class="btn primary" data-sv-ap-close>Fermer</button></p>';
  }
  function drawerHTML() {
    var a = ap(), b = a ? find(a.id) : null;
    if (!b) return '<p class="sub">Cette sauvegarde n’existe plus.</p>';
    var meta = [when(b.at), SA.ORIGIN[b.origin]].filter(Boolean).join(' · ');
    return '<div class="dt sv-ap"><p class="eye">Sauvegarde</p><p class="dt-name">' + esc(b.label) + '</p>' +
      (meta ? '<p class="dt-src mut">' + esc(meta) + '</p>' : '') +
      '<p class="sub">Copie les skills choisis dans le dossier de chaque agent choisi. Les autres skills de ces agents ne bougent pas.</p>' +
      (a.result ? resultHTML() : formHTML(b)) + '</div>';
  }
  function paintDrawer(focusId) {
    if (!SA.drawerOpen) return;
    SA.openDrawer(drawerHTML(), 'Appliquer à d’autres agents', 'sv-apply');
    var el = focusId && document.getElementById ? document.getElementById(focusId) : null;
    if (el && el.focus) try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  /* Application en mémoire : même règles que le serveur, sur les lignes de Mes skills. */
  function applyDemo(b, names, agents, conflict, force) {
    var res = { applied: [], skipped: [], failed: [], backups: [] }, mine = SA.state.mine, saved = bag();
    names.forEach(function (n) {
      var item = b.items.filter(function (i) { return i.name === n; })[0];
      agents.forEach(function (ag) {
        var one = { name: n, agent: ag };
        if (item.verdict === 'rouge' && force.indexOf(n) < 0) { one.reason = 'rouge'; res.skipped.push(one); return; }
        var row = mine.filter(function (r) { return r.name === n && r.kind !== 'plugin'; })[0];
        if (!row) { var o = {}; o[ag] = 'ok'; row = rowFrom(item, o); row.from = b.id; mine.push(row); res.applied.push(one); return; }
        if (!row.ag[ag]) { row.ag[ag] = 'ok'; res.applied.push(one); return; }
        /* La démo ne lit pas le contenu : une ligne déjà venue de cette sauvegarde est identique. */
        if (row.from === b.id) { one.reason = 'identical'; res.skipped.push(one); return; }
        if (conflict !== 'replace') { one.reason = 'exists'; res.skipped.push(one); return; }
        if (!saved[row.id]) {
          var bk = fromRows([row], 'replace', row.name, 'Version présente avant d’appliquer « ' + b.label + ' ».');
          raws().unshift(bk);
          res.backups.push(bk);
          saved[row.id] = true;
        }
        row.ag[ag] = 'ok';
        row.from = b.id;
        res.applied.push(one);
      });
    });
    return res;
  }

  function submitApply() {
    var a = ap(), b = a ? find(a.id) : null, s = st();
    if (!a || !b || a.busy || a.result || s.busy) return Promise.resolve(false);
    var all = agentsAll().map(function (x) { return x.id; });
    var names = b.items.map(function (i) { return i.name; }).filter(function (n, k, l) { return a.names[n] === true && l.indexOf(n) === k; });
    var agents = Object.keys(a.agents).filter(function (k) { return a.agents[k] === true; });
    agents.sort(function (x, y) { var i = all.indexOf(x), j = all.indexOf(y); return (i < 0 ? 1e6 : i) - (j < 0 ? 1e6 : j); });
    var rouge = bag();
    b.items.forEach(function (i) { if (i.verdict === 'rouge') rouge[i.name] = true; });
    var force = names.filter(function (n) { return rouge[n] === true && a.force[n] === true; });
    a.err = !names.length ? 'Choisissez au moins un skill.'
      : !agents.length ? 'Choisissez au moins un agent.'
      : !agents.every(function (k) { return AGENT.test(k) && all.indexOf(k) > -1; }) ? 'Un agent choisi n’est plus connu. Rechargez la page.'
      : live() && !names.every(function (n) { return NAME.test(n); }) ? 'Cette sauvegarde contient un nom de skill non valide : Skill Advisor ne peut pas l’appliquer.'
      : '';
    if (a.err) { paintDrawer('sv-ap-err'); return Promise.resolve(false); }
    var conflict = a.conflict === 'replace' ? 'replace' : 'skip';
    /* Chaque ligne du bilan nomme un skill, et un agent ou null (échec qui ne vise aucun agent) : sinon, erreur avant tout message. */
    function lines(l) {
      l = Array.isArray(l) ? l : [];
      if (!l.every(function (x) { return x && typeof x === 'object' && typeof x.name === 'string' && (typeof x.agent === 'string' || x.agent === null); })) throw new Error('bilan malformé');
      return l;
    }
    function finish(res) {
      var r = { applied: lines(res.applied), skipped: lines(res.skipped), failed: lines(res.failed), backups: Array.isArray(res.backups) ? res.backups : [] };
      var warns = (Array.isArray(res.warnings) ? res.warnings : []).filter(function (w) { return typeof w === 'string' && w; });
      a.busy = false;
      a.result = r;
      a.warns = warns;
      s.busy = ''; s.err = '';
      /* Le bilan par skill reste sur l'écran une fois le tiroir fermé, échecs compris. */
      s.warns = warns.slice(); s.wt = 'À relire après l’application';
      s.res = resRows(r, Object.keys(a.names));
      s.msg = b.label + ' : ' + SA.pl(r.applied.length, 'application faite', 'applications faites') + ', ' + SA.pl(r.skipped.length, 'passée', 'passées') + ', ' + SA.pl(r.failed.length, 'échec', 'échecs') + '.';
      if (SA.sync) SA.sync();
      repaint();
      paintDrawer('sv-ap-res');
      return true;
    }
    if (!live()) return Promise.resolve(finish(applyDemo(b, names, agents, conflict, force)));
    var body = { id: b.id, names: names, agents: agents, conflict: conflict };
    if (force.length) body.force = force;
    a.busy = true; a.err = '';
    /* Verrou de l'écran pendant l'appel ; le bilan précédent ne reste pas affiché. */
    s.busy = 'Application en cours…';
    s.msg = ''; s.err = ''; s.warns = []; s.wt = ''; s.res = null; s.del = null; s.rg = null;
    repaint();
    paintDrawer();
    return Promise.resolve().then(function () { return SA.live.call('POST', '/api/backups/apply', body); }).then(function (res) {
      return finish(res || {});
    }).catch(function (e) {
      s.busy = '';
      a.busy = false;
      a.result = null;
      a.err = errText(e);
      repaint();
      paintDrawer('sv-ap-err');
      return false;
    });
  }

  /* Gestes du tiroir : il est hors de la vue, une seule écoute au document. */
  /* Le tiroir ouvert est-il celui-ci ? (un autre écran peut ouvrir le sien) */
  function ours() {
    if (!SA.drawerOpen || !ap()) return false;
    var d = document.getElementById ? document.getElementById('drawer-body') : null;
    return !!(d && d.querySelector && d.querySelector('.sv-ap'));
  }
  /* Recherche par comparaison d'attribut, jamais par un sélecteur fait d'un id. */
  function focusKey(root, k) {
    var els = root && root.querySelectorAll ? root.querySelectorAll('[data-fk]') : [];
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-fk') !== k) continue;
      if (!els[i].disabled) try { els[i].focus({ preventScroll: true }); } catch (e) { els[i].focus(); }
      return;
    }
  }
  /* Après la fermeture : l'état du tiroir est effacé et le focus revient au bouton de la ligne,
     redessinée entre-temps (le bouton d'ouverture n'existe plus). */
  function closed(id) {
    if (SA.drawerOpen) return;
    st().ap = null;
    focusKey(document, 'apply:' + id);
  }
  function stop(e) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation(); else if (e.stopPropagation) e.stopPropagation();
  }
  /* Échap, la croix et le voile ferment le tiroir dans core.js : écoutés avant lui, en capture. */
  function guard(e) {
    if (!ours()) return;
    if (ap().busy) { stop(e); return; }
    var id = ap().id;
    setTimeout(function () { closed(id); }, 0);
  }
  var bound = false;
  function bindDoc() {
    if (bound || !document.addEventListener) return;
    bound = true;
    document.addEventListener('keydown', function (e) { if (e && e.key === 'Escape') guard(e); }, true);
    document.addEventListener('click', function (e) {
      var t = e && e.target && e.target.closest ? e.target : null;
      if (t && (t.closest('#drawer-close') || t.closest('#scrim'))) guard(e);
    }, true);
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      if (t.closest('[data-sv-ap-go]')) { submitApply(); return; }
      if (t.closest('[data-sv-ap-cancel]') || t.closest('[data-sv-ap-close]')) {
        var a = ap();
        if (!a || a.busy) return;
        SA.closeDrawer();
        closed(a.id);
      }
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.hasAttribute || !ap()) return;
      if (t.hasAttribute('data-sv-ap-item')) setItem(t.getAttribute('data-sv-ap-item'), t.checked);
      else if (t.hasAttribute('data-sv-ap-agent')) setAgent(t.getAttribute('data-sv-ap-agent'), t.checked);
      else if (t.hasAttribute('data-sv-ap-force')) setForce(t.getAttribute('data-sv-ap-force'), t.checked);
      else if (t.hasAttribute('data-sv-ap-conflict') && t.checked) setConflict(t.getAttribute('data-sv-ap-conflict'));
    });
    document.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'sv-ap-q') setQuery(e.target.value);
    });
  }

  /* ------------------------------------------------------------ rendu */
  function rowHTML(b) {
    var s = st(), id = esc(b.id), dis = s.busy ? ' disabled' : '';
    var red = b.items.filter(function (i) { return i.verdict === 'rouge'; }).length;
    var orange = b.items.filter(function (i) { return i.verdict === 'orange'; }).length;
    var meta = [when(b.at), SA.pl(b.items.length, 'skill', 'skills'), b.size ? SA.size(b.size) : ''].filter(Boolean);
    var act = s.del === b.id
      ? '<span class="gs-ask">Supprimer cette sauvegarde ? Vous ne pourrez pas la récupérer.</span>' +
        '<button type="button" class="btn danger" data-sv-del-ok data-fk="del-ok"' + dis + '>Supprimer</button>' +
        '<button type="button" class="btn quiet" data-sv-del-no data-fk="del-no"' + dis + '>Annuler</button>'
      : s.rg === b.id
      ? '<span class="gs-ask">Ce skill porte un motif à risque. Restaurer malgré tout ?</span>' +
        '<button type="button" class="btn danger" data-sv-rg-ok data-fk="rg-ok"' + dis + '>Restaurer malgré tout</button>' +
        '<button type="button" class="btn quiet" data-sv-rg-no data-fk="rg-no"' + dis + '>Annuler</button>'
      : '<button type="button" class="btn" data-sv-restore="' + id + '" data-fk="restore:' + id + '"' + dis + '>Restaurer</button>' +
        '<button type="button" class="btn" data-sv-apply="' + id + '" data-fk="apply:' + id + '"' + dis + '>Appliquer à d’autres agents</button>' +
        '<button type="button" class="btn quiet" data-sv-export="' + id + '" data-fk="export:' + id + '"' + dis + '>Exporter</button>' +
        '<button type="button" class="btn quiet" data-sv-del="' + id + '" data-fk="del:' + id + '"' + dis + '>Supprimer</button>';
    return '<li class="sv-row" data-st>' +
      '<div class="sv-main">' +
        '<p class="sv-l1"><span class="sv-label">' + esc(b.label) + '</span><span class="bdg no">' + esc(SA.ORIGIN[b.origin]) + '</span>' +
          (red ? '<span class="bdg bad">' + SA.pl(red, 'motif à risque', 'motifs à risque') + '</span>' : '') +
          (orange ? '<span class="bdg tr">' + SA.pl(orange, 'avertissement', 'avertissements') + '</span>' : '') + '</p>' +
        '<p class="sv-meta mut">' + meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</p>' +
        (b.note ? '<p class="sv-note">' + esc(b.note) + '</p>' : '') +
        '<ul class="sv-items" aria-label="Skills de la sauvegarde">' + b.items.map(function (i) {
          return '<li><span class="mono">' + esc(i.name) + '</span>' + (i.verdict === 'rouge' || i.verdict === 'orange' ? '<span class="vh"> : ' + (i.verdict === 'rouge' ? 'motif à risque' : 'avertissement') + '</span>' : '') + '</li>';
        }).join('') + '</ul>' +
      '</div>' +
      '<div class="sv-act" role="group" aria-label="Actions pour ' + esc(b.label) + '">' + act + '</div>' +
    '</li>';
  }

  function render() {
    var s = st(), l = list(), n = l.length;
    return '<div class="sv">' +
      '<p class="eye" data-st>Gestion</p>' +
      SA.h1(n ? SA.pl(n, 'sauvegarde', 'sauvegardes') : 'Aucune sauvegarde') +
      '<p class="lede" data-st>Une sauvegarde garde une copie de skills tels qu’ils étaient. Restaurez-la à sa place, appliquez-la à d’autres agents, ou exportez-la vers une autre machine.</p>' +
      '<div class="sv-bar" data-st>' +
        '<button type="button" class="btn" data-sv-import data-fk="import"' + (s.busy ? ' disabled' : '') + '>Importer une sauvegarde</button>' +
        '<input type="file" id="sv-file" class="vh" accept=".tar.gz,.tgz,application/gzip" tabindex="-1" aria-hidden="true">' +
        '<button type="button" class="btn quiet" data-go-route="gestion">Sauvegarder depuis Mes skills</button>' +
      '</div>' +
      (s.busy ? '<p class="gs-msg" role="status">' + esc(s.busy) + '</p>'
        : s.msg ? '<p class="gs-msg" role="status" tabindex="-1" data-fk="msg">' + esc(s.msg) + '</p>' : '') +
      (s.err ? '<div class="note note-bad sv-err" role="alert" tabindex="-1" data-fk="err"><p class="note-t">L’opération n’a pas abouti</p><p class="sub">' + esc(s.err) + '</p></div>' : '') +
      (!s.busy && s.res && s.res.length ? resList(s.res) : '') +
      (s.warns.length ? warnsHTML(s.wt || 'À relire après l’import', s.warns) : '') +
      (n ? '<ul class="ledger sv-list">' + l.map(rowHTML).join('') + '</ul>'
        : '<div class="empty" data-st><p class="sub">Aucune sauvegarde pour l’instant. Désinstallez un skill avec « Garder une sauvegarde », ou sauvegardez-en depuis Mes skills.</p></div>') +
      '<section class="gs-why sv-why" data-st><h2 class="h2">Bon à savoir</h2>' +
        '<p class="sub"><strong>Restaurer</strong> remet chaque skill dans les dossiers d’où il vient. Si un skill du même nom y est déjà, Skill Advisor n’écrit rien.</p>' +
        '<p class="sub"><strong>Appliquer</strong> copie les skills choisis dans d’autres agents. Pour un skill présent mais différent, vous choisissez : le passer, ou le remplacer après une sauvegarde de la version présente.</p>' +
        '<p class="sub"><strong>Exporter</strong> crée une archive .tar.gz. <strong>Importer</strong> la lit sur une autre machine et contrôle de nouveau chaque skill.</p>' +
      '</section>' +
    '</div>';
  }

  function restoreFocus(root) {
    var s = st(), k = s.focus;
    if (!k) return;
    s.focus = '';
    focusKey(root, k);
  }

  function mount(root) {
    bindDoc();
    restoreFocus(root);
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null, b;
      if (!t) return;
      b = t.closest('button');
      if (!b || !root.contains(b) || b.disabled) return;
      if (b.hasAttribute('data-sv-import')) {
        if (!live()) { importFile({ name: '' }); return; }
        var f = root.querySelector('#sv-file');
        if (f && f.click) f.click();
        return;
      }
      if (b.hasAttribute('data-sv-restore')) { restore(b.getAttribute('data-sv-restore')); return; }
      if (b.hasAttribute('data-sv-apply')) { openApply(b.getAttribute('data-sv-apply')); return; }
      if (b.hasAttribute('data-sv-export')) { exportB(b.getAttribute('data-sv-export')); return; }
      if (b.hasAttribute('data-sv-del')) { askDelete(b.getAttribute('data-sv-del')); return; }
      if (b.hasAttribute('data-sv-del-ok')) { confirmDelete(); return; }
      if (b.hasAttribute('data-sv-del-no')) { cancelDelete(); return; }
      if (b.hasAttribute('data-sv-rg-ok')) { confirmRestore(); return; }
      if (b.hasAttribute('data-sv-rg-no')) cancelRestore();
    });
    root.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || t.id !== 'sv-file') return;
      var file = t.files && t.files[0];
      importFile(file).then(function () { try { t.value = ''; } catch (x) { /* champ déjà retiré */ } });
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && st().del) { e.preventDefault(); e.stopPropagation(); cancelDelete(); }
      else if (e.key === 'Escape' && st().rg != null) { e.preventDefault(); e.stopPropagation(); cancelRestore(); }
    });
  }

  SA.views.sauvegardes = {
    wide: true,
    render: render,
    mount: mount,
    actions: function () { return []; },
    keys: function () { return false; },
    /* Gestes sans DOM, pour les essais. */
    _do: {
      list: list, restore: restore, confirmRestore: confirmRestore, cancelRestore: cancelRestore, askDelete: askDelete, cancelDelete: cancelDelete, confirmDelete: confirmDelete,
      exportB: exportB, importFile: importFile, openApply: openApply, ap: ap, setItem: setItem, setAgent: setAgent,
      setForce: setForce, setConflict: setConflict, setQuery: setQuery, submitApply: submitApply, drawerHTML: drawerHTML
    }
  };
})();
