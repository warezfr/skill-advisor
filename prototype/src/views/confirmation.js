/* Skill Advisor — vue « confirmation » (étape 4 : installation).
   Les agents se choisissent ici, déjà cochés d'après la détection. États dessinés :
   rien à installer, aucun agent, hors ligne, en cours, échec d'un skill, annulation, terminé. */
(function () {
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  /* Identifiants d'agents du CLI skills (src/agents.ts du dépôt vercel-labs/skills), relus le 12/11/2026. */
  var CLI = { claude: 'claude-code', gemini: 'gemini-cli', copilot: 'github-copilot' };
  var LABEL = { wait: 'en attente', copy: 'copie…', link: 'liens…', done: 'installé', fail: 'échec', skip: 'non commencé' };
  var timers = [];
  var curRoot = null;
  var stop = false;

  var pl = function (n, a, b) { return SA.pl(n, a, b); };
  function here() { return SA.viewId() === 'confirmation'; }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function inst() { var s = SA.state; s.inst = s.inst || { phase: 'idle', ids: [], st: {} }; return s.inst; }
  function ids() { var i = inst(); return i.phase === 'idle' ? SA.cart.list().slice() : i.ids; }
  function count(st) { var i = inst(); return i.ids.filter(function (id) { return i.st[id] === st; }).length; }

  /* ---------- lignes ---------- */
  function row(id) {
    var it = SA.item(id), i = inst(), st = i.st[id] || 'wait', idle = i.phase === 'idle';
    if (!it) return '';
    return '<li class="cf-row cf-' + st + '" data-id="' + SA.esc(id) + '">' +
      '<div class="cf-id"><button type="button" class="cf-name mono" data-detail="' + SA.esc(id) + '">' + SA.esc(it[1]) + '</button>' +
        '<p class="cf-src mono mut">' + SA.esc(it[2]) + '</p>' +
        (st === 'fail' ? '<p class="cf-err">' + SA.esc(i.err || '') + '</p>' : '') + '</div>' +
      '<p class="cf-tot mono"><span class="num">' + (it[6] == null ? '–' : it[6]) + '</span> <span class="mut">sur 100</span></p>' +
      (idle ? '<p class="cf-warn">' + SA.detail.badge(it[7], id) + '</p>' : '') +
      '<p class="cf-st mono' + (st === 'done' ? ' cf-done' : '') + '">' + (st === 'done' ? SA.icon('check') : '') + '<span>' + LABEL[st] + '</span></p>' +
      (idle ? '<button type="button" class="ct-rm" data-cart-rm="' + SA.esc(id) + '" aria-label="Retirer ' + SA.esc(it[1]) + ' de la sélection">' + SA.icon('close') + '</button>' : '') +
    '</li>';
  }

  function agentRow(a) {
    var on = !!SA.state.agents[a.id];
    return '<li class="cf-ag" data-id="' + SA.esc(a.id) + '">' +
      '<button type="button" class="sw" role="switch" aria-checked="' + on + '" aria-label="Installer dans ' + SA.esc(a.name) + '"></button>' +
      '<p class="cf-ag-n">' + SA.esc(a.name) + (a.st === 'tr' ? ' <span class="bdg tr">Traces seulement</span>' : a.custom ? ' <span class="bdg no">Ajouté à la main</span>' : '') + '</p>' +
      '<p class="cf-ag-p mono mut">' + SA.esc(a.abs ? a.abs : SA.target(a.rel)) + '</p></li>';
  }

  function agentsBlock() {
    var s = SA.state, list = SA.agents().filter(function (a) { return a.st !== 'no'; });
    if (!list.length) {
      return '<section class="cf-sec" data-st aria-labelledby="cf-t2"><h2 class="h2" id="cf-t2">Agents</h2>' +
        '<div class="note note-warn"><p class="note-t">Aucun agent trouvé sur cette machine</p>' +
        '<p class="sub">Quatre signaux ont été examinés : dossier de configuration, commande, application installée, extension d’éditeur. Sans agent, rien ne peut être installé.</p>' +
        '<p class="note-a"><button type="button" class="btn" data-go-route="agents">Ajouter un agent à la main</button></p></div></section>';
    }
    var n = SA.agentsOn().length;
    return '<section class="cf-sec" data-st aria-labelledby="cf-t2"><div class="cf-sech"><h2 class="h2" id="cf-t2">Agents</h2>' +
        '<button type="button" class="lnk" data-go-route="agents">Voir la détection</button></div>' +
      '<p class="sub cf-hint">' + pl(list.length, 'agent trouvé', 'agents trouvés') + ' sur cette machine, ' + (n === list.length ? 'tous cochés' : n + (n > 1 ? ' cochés' : ' coché')) + '. Décochez ceux qui ne doivent pas recevoir ces skills.</p>' +
      '<ul class="ledger cf-ags">' + list.map(agentRow).join('') + '</ul>' +
      '<div class="cf-scope"><p class="cf-scope-l" id="cf-scope-l">Portée</p><div class="seg" role="group" aria-labelledby="cf-scope-l">' +
        [['global', 'Tous les projets'], ['projet', 'Ce projet seulement']].map(function (o) {
          return '<button type="button" data-scope="' + o[0] + '" aria-pressed="' + (s.scope === o[0]) + '">' + o[1] + '</button>';
        }).join('') + '</div>' +
        (s.scope === 'projet' ? '<p class="mono mut cf-proj">' + SA.esc(SA.projRoot()) + '</p>' : '') + '</div></section>';
  }

  /* Ce qui sera écrit : chemins exacts, puis commandes du moteur. L'interrupteur de télémétrie change la commande. */
  function plan() {
    var s = SA.state, list = ids().map(SA.item).filter(Boolean), on = SA.agentsOn(), out = [];
    list.forEach(function (it) { out.push(SA.esc(SA.target('.agents/skills/' + it[1]))); });
    out.push('');
    out.push('<span class="dim"># liens depuis</span>');
    var cline = false;
    on.forEach(function (a) {
      if (a.id === 'cline') { cline = true; return; }
      out.push(SA.esc(a.abs ? a.abs : SA.target(a.rel)));
    });
    if (cline) out.push('<span class="dim"># Cline lit le dossier commun</span>');
    out.push('');
    out.push('<span class="dim"># commandes du moteur (CLI skills)</span>');
    var bySrc = {};
    list.forEach(function (it) { (bySrc[it[2]] = bySrc[it[2]] || []).push(it[1]); });
    var ag = on.filter(function (a) { return !a.custom; }).map(function (a) { return '-a ' + (CLI[a.id] || a.id); }).join(' ');
    Object.keys(bySrc).forEach(function (src) {
      out.push(SA.esc((s.telemetryOff ? 'DISABLE_TELEMETRY=1 ' : '') + 'npx -y skills add ' + src + ' ' +
        bySrc[src].map(function (n) { return '--skill ' + n; }).join(' ') + (s.scope === 'global' ? ' -g ' : ' ') + ag + ' -y'));
    });
    return out.join('\n');
  }

  /* ---------- en-tête selon l'état ---------- */
  function head() {
    var i = inst(), m = SA.agentsOn().length, d = count('done'), f = count('fail'), k = count('skip');
    var eye = '<p class="eye" data-st>Étape 04 · Installation</p>';
    if (i.phase === 'done') {
      return eye + SA.h('Installation terminée') +
        '<p class="lede" role="status" data-st>' + pl(d, 'skill installé', 'skills installés') + ' dans ' + pl(m, 'agent', 'agents') + '.</p>';
    }
    if (i.phase === 'fail') {
      return eye + SA.h('Installation incomplète') +
        '<div class="note note-bad" role="alert" data-st><p class="note-t">' + pl(f, 'skill n’a pas pu être installé', 'skills n’ont pas pu être installés') + '</p>' +
        '<p class="sub">' + pl(d, 'skill est installé', 'skills sont installés') + '. Rien n’est resté à moitié écrit : la copie du skill en échec a été retirée.</p></div>';
    }
    if (i.phase === 'cancel') {
      return eye + SA.h('Installation interrompue') +
        '<div class="note note-warn" role="status" data-st><p class="note-t">Vous avez annulé</p>' +
        '<p class="sub">' + pl(d, 'skill est installé', 'skills sont installés') + ', ' + k + (k > 1 ? ' n’ont pas été commencés' : ' n’a pas été commencé') + '. Vous pouvez reprendre, ou retirer ce qui vient d’être installé.</p></div>';
    }
    if (i.phase === 'run') {
      return eye + SA.h('Installation en cours') +
        '<p class="lede" role="status" data-st>Écriture dans ' + pl(m, 'agent', 'agents') + '. Vous pouvez annuler : le skill en cours ira au bout, les suivants ne seront pas commencés.</p>';
    }
    return eye + SA.h('Vérifiez avant d’écrire') +
      '<p class="lede" data-st>Voici exactement ce qui sera créé sur votre machine. Rien n’a encore été écrit.</p>' +
      (SA.offline() ? '<div class="note note-warn" role="status" data-st><p class="note-t">Hors ligne</p><p class="sub">Les fichiers des skills se téléchargent au moment de l’installation. Elle reprendra quand le réseau reviendra ; votre sélection est gardée.</p></div>' : '');
  }

  /* ---------- installation simulée ---------- */
  function setStatus(id, st) {
    var i = inst();
    i.st[id] = st;
    var r = curRoot && curRoot.querySelector('.cf-row[data-id="' + id.replace(/"/g, '') + '"]');
    if (!r) return;
    var c = r.querySelector('.cf-st');
    r.className = 'cf-row cf-' + st;
    c.innerHTML = (st === 'done' ? SA.icon('check') : '') + '<span>' + LABEL[st] + '</span>';
    c.classList.toggle('cf-done', st === 'done');
    c.classList.remove('cf-tick');
    void c.offsetWidth;
    c.classList.add('cf-tick');
  }
  function say(txt) {
    var l = curRoot && curRoot.querySelector('.cf-sr');
    if (l) l.textContent = txt;
  }

  function commit(id) {
    var s = SA.state, it = SA.item(id), f = (SA.files || {})[id], ag = {};
    SA.agentsOn().forEach(function (a) { ag[a.id] = 'ok'; });
    if (!SA.mineRow(id)) s.mine.unshift({ id: id, name: it[1], src: it[2], real: true, st: 'ok', on: true, ag: ag, chars: f ? f.dl : null, warn: it[7], note: it[6], fresh: true });
    SA.cart.remove(id);
    if (s.lastInstall.indexOf(id) < 0) s.lastInstall.push(id);
  }

  function finish(phase) {
    var s = SA.state, i = inst();
    clearTimers();
    s.installing = false;
    stop = false;
    i.phase = phase;
    i.ids.forEach(function (id) { if (i.st[id] !== 'done' && i.st[id] !== 'fail') i.st[id] = 'skip'; });
    SA.repaint();
    if (phase === 'done') {
      /* Laisser lire le résultat, puis passer au guide. */
      later(function () { if (here() && inst().phase === 'done') SA.go(5, 1); }, SA.rm ? 0 : 1600);
    }
  }

  function run(only) {
    var s = SA.state, i = inst(), root = curRoot;
    var list = only || SA.cart.list().slice();
    if (s.installing || !root || !list.length || !SA.agentsOn().length || SA.offline()) return;
    if (!only) { i.ids = list.slice(); i.st = {}; }
    list.forEach(function (id) { i.st[id] = 'wait'; });
    i.phase = 'run';
    s.installing = true;
    stop = false;
    SA.repaint();
    root = curRoot;

    var fails = s.pv.install === 'fail', n = 0;
    var failAt = fails ? Math.min(1, list.length - 1) : -1;
    var prog = root.querySelector('.cf-prog i');

    function end() {
      if (stop && n < list.length) return finish('cancel');
      finish(count('fail') ? 'fail' : 'done');
    }
    function step() {
      if (!here()) { clearTimers(); s.installing = false; return; }
      if (stop || n >= list.length) { end(); return; }
      var id = list[n], it = SA.item(id);
      setStatus(id, 'copy');
      say(it[1] + ' : copie.');
      later(function () {
        setStatus(id, 'link');
        later(function () {
          if (n === failAt) {
            var a = SA.agentsOn()[0];
            i.err = 'Écriture refusée dans ' + (a.abs ? a.abs : SA.target(a.rel)) + '. Vérifiez les droits de ce dossier.';
            setStatus(id, 'fail');
            say(it[1] + ' : échec.');
          } else {
            commit(id);
            setStatus(id, 'done');
            say(it[1] + ' installé.');
          }
          n++;
          if (prog) prog.style.transform = 'scaleX(' + (n / list.length) + ')';
          SA.sync();
          later(step, SA.rm ? 0 : 160);
        }, SA.rm ? 0 : 420);
      }, SA.rm ? 0 : 420);
    }
    step();
  }

  function undo() {
    var s = SA.state, i = inst();
    i.ids.forEach(function (id) {
      if (i.st[id] !== 'done') return;
      s.mine = s.mine.filter(function (m) { return m.id !== id; });
      s.lastInstall = s.lastInstall.filter(function (x) { return x !== id; });
      SA.cart.add(id);
    });
    s.inst = null;
    SA.repaint();
  }

  function onClick(e) {
    if (!here()) return;
    var s = SA.state;
    if (s.installing) return;
    var sw = e.target.closest('.cf-ag .sw');
    if (sw) {
      var id = sw.closest('.cf-ag').getAttribute('data-id');
      s.agents[id] = !s.agents[id];
      SA.repaint();
      return;
    }
    var sc = e.target.closest('[data-scope]');
    if (sc) { s.scope = sc.getAttribute('data-scope'); SA.repaint(); return; }
    var tel = e.target.closest('.cf-tel .sw');
    if (tel) { s.telemetryOff = !s.telemetryOff; SA.repaint(); return; }
    /* Retirer un skill ici passe par l'écoute commune (data-cart-rm), puis la liste se redessine. */
    if (e.target.closest('[data-cart-rm]')) setTimeout(function () { if (here()) SA.repaint(); }, 0);
  }

  SA.views.confirmation = {
    render: function () {
      var st = SA.state;
      /* Une installation terminée, puis une nouvelle sélection : on repart d'un écran neuf. */
      if (inst().phase === 'done' && SA.cart.count()) st.inst = null;
      var i = inst(), list = ids();
      if (i.phase === 'idle' && !list.length) {
        return '<p class="eye" data-st>Étape 04 · Installation</p>' + SA.h('Rien à installer') +
          '<div class="empty" data-st><p class="sub">Votre sélection est vide. Ajoutez des skills depuis le conseil ou la recherche.</p>' +
          '<p class="empty-a"><button type="button" class="btn primary" data-go-step="' + (st.goal && SA.answered() ? 3 : 1) + '">Obtenir un conseil</button>' +
          '<button type="button" class="btn" data-go-route="recherche">Ouvrir la recherche</button>' +
          (st.lastInstall.length ? '<button type="button" class="btn" data-go-step="5">Voir le guide</button>' : '') + '</p></div>';
      }
      var idle = i.phase === 'idle';
      return head() +
        '<section class="cf-sec" data-st aria-labelledby="cf-t1">' +
          '<h2 class="h2" id="cf-t1">Skills</h2>' +
          '<div class="cf-list">' +
            '<div class="cf-prog" aria-hidden="true"><i' + (idle ? '' : ' style="transform:scaleX(' + ((count('done') + count('fail')) / Math.max(1, i.ids.length)) + ')"') + '></i></div>' +
            '<ul class="ledger" id="inst">' + list.map(row).join('') + '</ul>' +
          '</div>' +
          '<p class="cf-sr vh" aria-live="polite"></p>' +
        '</section>' +
        (idle || i.phase === 'run' ? agentsBlock() : '') +
        (idle || i.phase === 'run'
          ? '<section class="cf-sec" data-st aria-labelledby="cf-t3"><h2 class="h2" id="cf-t3">Ce qui sera écrit</h2>' +
              '<pre class="code" tabindex="0"><code>' + plan() + '</code></pre></section>' +
            '<section class="cf-sec cf-tel" data-st aria-labelledby="cf-t4"><h2 class="h2" id="cf-t4">Télémétrie</h2>' +
              '<div class="cf-tel-row"><div class="cf-tel-t">' +
                '<p class="cf-tel-l">Couper la télémétrie du moteur d’installation</p>' +
                '<p class="cf-tel-d sub">Le moteur (CLI skills) envoie un compteur d’installation anonyme. Le couper ajoute <span class="mono">DISABLE_TELEMETRY=1</span> à la commande ci-dessus, et coupe aussi ses requêtes d’audit. Skill Advisor n’envoie rien de son côté.</p>' +
              '</div><button type="button" class="sw" role="switch" aria-checked="' + !!st.telemetryOff + '" aria-label="Couper la télémétrie du moteur d’installation"' + (st.installing ? ' disabled' : '') + '></button></div></section>'
          : '');
    },

    mount: function (root) {
      curRoot = root;
      var s = SA.state;
      /* Revenir sur l'écran après une installation terminée repart d'une sélection propre. */
      if (!s.installing && inst().phase === 'run') s.inst = null;
      root.addEventListener('click', onClick);
    },

    actions: function () {
      var st = SA.state, i = inst(), m = SA.agentsOn().length, n = SA.cart.count();
      if (i.phase === 'run') {
        return [
          { label: stop ? 'Arrêt après ce skill…' : 'Annuler', kind: 'default', disabled: stop, on: function () { stop = true; SA.sync(); } },
          { label: 'Installation…', kind: 'primary', disabled: true, on: function () {} }
        ];
      }
      if (i.phase === 'done') return [{ label: 'Voir le guide', kind: 'primary', kbd: '↵', on: function () { SA.go(5, 1); } }];
      if (i.phase === 'fail') {
        var failed = i.ids.filter(function (id) { return i.st[id] === 'fail'; });
        return [
          { label: 'Continuer sans ' + (failed.length > 1 ? 'eux' : 'lui'), kind: 'default', disabled: !st.lastInstall.length, on: function () { st.inst = null; SA.go(5, 1); } },
          { label: 'Réessayer', kind: 'primary', kbd: '↵', on: function () { run(failed); } }
        ];
      }
      if (i.phase === 'cancel') {
        return [
          { label: 'Retirer ce qui vient d’être installé', kind: 'default', disabled: !count('done'), on: undo },
          { label: 'Reprendre', kind: 'primary', kbd: '↵', disabled: !n, on: function () { st.inst = null; SA.repaint(); } }
        ];
      }
      if (!n) return [];
      var label = SA.offline() ? 'Hors ligne : installation impossible' : !m ? 'Aucun agent coché' :
        'Installer ' + pl(n, 'skill', 'skills') + ' dans ' + pl(m, 'agent', 'agents');
      return [
        { label: 'Retour', kind: 'default', on: function () { if (st.goal && SA.answered()) SA.go(3, -1); else SA.setRoute('recherche'); } },
        { label: label, kind: 'primary', kbd: '↵', disabled: SA.offline() || m === 0, on: function () { run(); } }
      ];
    }
    /* Enter is owned by core (it clicks the primary action), so this view has no keys(). */
  };
})();
