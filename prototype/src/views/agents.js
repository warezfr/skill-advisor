/* Skill Advisor · view agents (route agents) : détection, ajout à la main, portée.
   Dans le conseil, les agents se choisissent à l'étape Installation ; cet écran montre la détection complète. */
(function () {
  'use strict';
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  var OSES = [['mac', 'macOS'], ['win', 'Windows'], ['linux', 'Linux']];
  var BADGE = { ok: ['ok', 'Installé'], tr: ['tr', 'Traces seulement'], no: ['no', 'Non détecté'] };
  var STEP = 130;
  var LEAD = 420;
  var scan = { token: 0, timers: [] };

  function stopScan() {
    scan.token++;
    scan.timers.forEach(clearTimeout);
    scan.timers = [];
  }
  function scanned() {
    SA.state.scanned = SA.state.scanned || {};
    return !!SA.state.scanned[SA.state.os];
  }
  function onCount() {
    return SA.agentsOn().length;
  }

  function sigText(a) {
    var os = SA.state.os;
    if (a.custom) return 'ajouté à la main';
    if (!a.sig || !a.sig.length) return 'aucun signal';
    return a.sig.map(function (k) {
      if (k === 'cmd') return 'commande ' + a.cmd;
      if (k === 'cfg') return 'dossier de configuration';
      if (k === 'app') return os === 'win' ? 'programme installé' : os === 'linux' ? 'paquet installé' : 'application';
      if (k === 'ext') return 'extension VS Code';
      return k;
    }).join(' · ');
  }

  function summary() {
    var n = { ok: 0, tr: 0, no: 0 };
    SA.agents().forEach(function (a) { n[a.st] = (n[a.st] || 0) + 1; });
    var t = n.ok + (n.ok > 1 ? ' installés' : ' installé') +
      ' · ' + n.tr + ' avec traces' +
      ' · ' + n.no + (n.no > 1 ? ' non détectés' : ' non détecté');
    if (SA.state.os === 'win') t += ' · 1 instance WSL';
    return t;
  }

  function rowHTML(a, pending) {
    var b = BADGE[a.st] || BADGE.no;
    var on = a.st !== 'no' && !!SA.state.agents[a.id];
    var p = SA.agentPath(a) || 'Aucun dossier';
    var skl = pending ? ' skl' : '';
    return '<li class="ag-row ag-' + a.st + '" data-id="' + SA.esc(a.id) + '" data-st>' +
      '<button type="button" class="sw" role="switch" aria-checked="' + on + '" aria-label="Installer les skills dans ' + SA.esc(a.name) + '"' + (a.st === 'no' ? ' disabled' : '') + '></button>' +
      '<p class="ag-l1"><span class="ag-n">' + SA.esc(a.name) + '</span><span class="ag-sig">' + SA.esc(sigText(a)) + '</span></p>' +
      '<span class="bdg ' + (a.custom ? 'no' : b[0]) + skl + '">' + (a.custom ? 'Ajouté à la main' : b[1]) + '</span>' +
      '<p class="ag-path mono' + (SA.agentPath(a) ? '' : ' mut') + skl + '">' + SA.esc(p) + '</p>' +
    '</li>';
  }

  function wslHTML(pending) {
    var skl = pending ? ' skl' : '';
    return '<li class="ag-row ag-wsl" data-id="wsl" data-st>' +
      '<button type="button" class="sw" role="switch" aria-checked="false" aria-label="Installer les skills dans Claude Code, instance WSL Ubuntu" disabled></button>' +
      '<p class="ag-l1"><span class="ag-n">Claude Code · WSL Ubuntu</span><span class="ag-sig">Lancez Skill Advisor dans WSL pour y écrire.</span></p>' +
      '<span class="bdg wsl' + skl + '">Instance WSL</span>' +
      '<p class="ag-path mono' + skl + '">/home/alex/.claude/skills</p>' +
    '</li>';
  }

  function listHTML() {
    var pending = !scanned();
    var rows = SA.agents().map(function (a) { return rowHTML(a, pending); }).join('');
    if (SA.state.os === 'win') rows += wslHTML(pending);
    return '<ul class="ledger ag-list" aria-label="Agents">' + rows + '</ul>';
  }

  function projPath() {
    return SA.projRoot();
  }

  function segHTML(label, items, current, attr) {
    return '<div class="seg" role="group" aria-label="' + label + '">' +
      items.map(function (it) {
        return '<button type="button" ' + attr + '="' + it[0] + '" aria-pressed="' + (it[0] === current) + '">' + it[1] + '</button>';
      }).join('') +
    '</div>';
  }

  function setPressed(group, attr, value) {
    var bs = group.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', String(bs[i].getAttribute(attr) === value));
  }

  function resolveRow(r) {
    var els = r.querySelectorAll('.skl');
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove('skl');
      els[i].classList.add('ag-in');
    }
  }

  function runScan(root) {
    stopScan();
    var tok = scan.token;
    var os = SA.state.os;
    var status = root.querySelector('.ag-status');
    var rows = [].slice.call(root.querySelectorAll('.ag-list .ag-row'));
    if (scanned()) {
      rows.forEach(resolveRow);
      if (status) { status.textContent = summary(); status.classList.remove('is-busy'); }
      return;
    }
    if (status) { status.textContent = 'Recherche des agents…'; status.classList.add('is-busy'); }
    function finish() {
      SA.state.scanned[os] = true;
      if (status) { status.textContent = summary(); status.classList.remove('is-busy'); }
      SA.sync();
    }
    if (SA.rm) {
      rows.forEach(resolveRow);
      finish();
      return;
    }
    rows.forEach(function (r, i) {
      scan.timers.push(setTimeout(function () {
        if (tok !== scan.token || !r.isConnected) return;
        resolveRow(r);
      }, LEAD + i * STEP));
    });
    scan.timers.push(setTimeout(function () {
      if (tok !== scan.token || !root.isConnected || SA.state.os !== os || !(status && status.isConnected)) return;
      finish();
    }, LEAD + rows.length * STEP + 80));
  }

  function setOs(root, os) {
    if (!SA.data.home[os] || SA.state.os === os) return;
    stopScan();
    SA.state.os = os;
    setPressed(root.querySelector('.ag-os'), 'data-os', os);
    var status = root.querySelector('.ag-status');
    if (status) {
      status.textContent = scanned() ? summary() : 'Recherche des agents…';
      status.classList.toggle('is-busy', !scanned());
    }
    var pp = root.querySelector('.ag-proj-p');
    if (pp) pp.textContent = projPath();
    SA.sync();
    var region = root.querySelector('.ag-region');
    SA.swap(region, listHTML(), function () {
      if (root.isConnected && SA.state.os === os) runScan(root);
    });
  }

  function setScope(root, scope) {
    if (scope !== 'global' && scope !== 'projet') return;
    SA.state.scope = scope;
    setPressed(root.querySelector('.ag-scope-seg'), 'data-scope', scope);
    var fold = root.querySelector('.ag-proj-fold');
    if (fold) {
      fold.classList.toggle('open', scope === 'projet');
      fold.firstElementChild.inert = scope !== 'projet';
    }
    SA.sync();
  }

  function toggleAgent(sw) {
    if (sw.disabled) return;
    var li = sw.closest('.ag-row');
    var id = li && li.getAttribute('data-id');
    var a = SA.agents().filter(function (x) { return x.id === id; })[0];
    if (!a || a.st === 'no') return;
    var on = sw.getAttribute('aria-checked') !== 'true';
    SA.state.agents[id] = on;
    sw.setAttribute('aria-checked', String(on));
    SA.sync();
  }

  function noneHTML() {
    if (SA.agents().some(function (a) { return a.st !== 'no'; })) return '';
    return '<div class="note note-warn" data-st><p class="note-t">Aucun agent trouvé sur cette machine</p>' +
      '<p class="sub">Aucun des quatre signaux n’a répondu. Si un agent est installé dans un dossier inhabituel, ajoutez-le à la main ci-dessous. Sinon, installez un agent puis relancez la recherche.</p>' +
      '<p class="note-a"><button type="button" class="btn" data-ag-rescan>Relancer la recherche</button></p></div>';
  }

  function addAgent(root) {
    var n = root.querySelector('#ag-new-n'), p = root.querySelector('#ag-new-p'), err = root.querySelector('.ag-new-err');
    var name = n.value.trim(), dir = p.value.trim();
    if (!name || !dir) { err.textContent = 'Indiquez un nom et un dossier.'; (name ? p : n).focus(); return; }
    var s = SA.state, id = 'c' + (s.custom.length + 1);
    s.custom.push({ id: id, name: name, st: 'ok', sig: ['man'], cmd: '', rel: '', abs: dir, custom: true });
    s.agents[id] = true;
    s.agNew = false;
    SA.repaint();
  }

  SA.views.agents = {
    render: function () {
      var s = SA.state;
      var projet = s.scope === 'projet';
      var pending = !scanned();
      return '<p class="eye" data-st>Cette machine</p>' +
        SA.h1('Agents trouvés sur cette machine') +
        '<p class="lede" data-st>Quatre signaux sont examinés : dossier de configuration, commande, application installée, extension d’éditeur. Les agents cochés reçoivent les skills.</p>' +
        noneHTML() +
        '<div class="ag-tools" data-st>' +
          '<span class="ag-lbl" aria-hidden="true">Aperçu du système</span>' +
          '<div class="ag-os">' + segHTML('Aperçu du système', OSES, s.os, 'data-os') + '</div>' +
        '</div>' +
        '<p class="ag-status mono' + (pending ? ' is-busy' : '') + '" role="status" data-st>' + (pending ? 'Recherche des agents…' : SA.esc(summary())) + '</p>' +
        '<div class="ag-region">' + listHTML() + '</div>' +
        '<dl class="ag-legend" data-st>' +
          '<div><dt>Installé</dt><dd>L’agent est présent et son dossier de skills peut recevoir des fichiers.</dd></div>' +
          '<div><dt>Traces seulement</dt><dd>Un dossier de configuration subsiste, mais l’agent ne semble plus installé.</dd></div>' +
          '<div><dt>Non détecté</dt><dd>Aucun signal trouvé, rien ne sera écrit pour cet agent.</dd></div>' +
        '</dl>' +
        '<section class="ag-new" data-st aria-labelledby="ag-new-t">' +
          '<h2 class="h2" id="ag-new-t">Un agent manque ?</h2>' +
          (s.agNew
            ? '<div class="ag-form"><label class="ag-fl" for="ag-new-n">Nom de l’agent</label><input id="ag-new-n" class="fld" type="text" autocomplete="off" placeholder="Mon agent">' +
              '<label class="ag-fl" for="ag-new-p">Dossier où il lit ses skills</label><input id="ag-new-p" class="fld mono" type="text" autocomplete="off" spellcheck="false" placeholder="' + SA.esc(SA.path('.mon-agent/skills')) + '">' +
              '<p class="ag-new-err" role="alert"></p>' +
              '<p class="ag-new-a"><button type="button" class="btn primary" data-ag-add>Ajouter cet agent</button><button type="button" class="btn quiet" data-ag-cancel>Annuler</button></p></div>'
            : '<p class="sub">Indiquez son nom et le dossier où il lit ses skills : il recevra les installations comme les autres.</p>' +
              '<p class="ag-new-a"><button type="button" class="btn" data-ag-new>Ajouter un agent à la main</button></p>') +
        '</section>' +
        '<section class="ag-scope" aria-labelledby="ag-scope-t" data-st>' +
          '<h2 class="h2" id="ag-scope-t">Portée de l’installation</h2>' +
          '<div class="ag-scope-seg">' + segHTML('Portée de l’installation', [['global', 'Tous les projets'], ['projet', 'Ce projet seulement']], s.scope, 'data-scope') + '</div>' +
          '<div class="fold ag-proj-fold' + (projet ? ' open' : '') + '">' +
            '<div class="fold-in"' + (projet ? '' : ' inert') + '>' +
              '<p class="ag-proj"><span class="ag-proj-l">Projet</span><span class="ag-proj-p mono">' + SA.esc(projPath()) + '</span></p>' +
            '</div>' +
          '</div>' +
        '</section>';
    },
    mount: function (root) {
      runScan(root);
      root.addEventListener('click', function (e) {
        var t = e.target;
        var os = t.closest('[data-os]');
        if (os && root.contains(os)) { setOs(root, os.getAttribute('data-os')); return; }
        var sc = t.closest('[data-scope]');
        if (sc && root.contains(sc)) { setScope(root, sc.getAttribute('data-scope')); return; }
        var sw = t.closest('.ag-row .sw');
        if (sw && root.contains(sw)) { toggleAgent(sw); return; }
        if (t.closest('[data-ag-new]')) { SA.state.agNew = true; SA.repaint(); var n = document.getElementById('ag-new-n'); if (n) n.focus(); return; }
        if (t.closest('[data-ag-cancel]')) { SA.state.agNew = false; SA.repaint(); return; }
        if (t.closest('[data-ag-add]')) { addAgent(root); return; }
        if (t.closest('[data-ag-rescan]')) { stopScan(); SA.state.scanned = {}; SA.repaint(); }
      });
    },
    actions: function () {
      var n = SA.cart.count();
      if (!n) return [];
      return [{ label: 'Installer ' + SA.pl(n, 'skill', 'skills'), kind: 'primary', kbd: '↵', disabled: onCount() === 0, on: function () { SA.go(4, 1); } }];
    },
    keys: function () { return false; }
  };
})();
