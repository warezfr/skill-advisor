/* Skill Advisor prototype: view "accueil" (route accueil) — « Ma machine ».
   Premier écran quand des skills sont déjà présents : l'état, ce qui demande attention, trois gestes. */
(function () {
  window.SA = window.SA || {};
  var SA = window.SA;
  SA.views = SA.views || {};

  var esc = function (s) { return SA.esc(s); };
  function mine() { return SA.state.mine || []; }
  /* Non contrôlé : sans note d'avertissement, ou, en mode réel, sans résultat du contrôle (scan: null). */
  function unscanned(r) { return r.warn == null || (!!(SA.live && SA.live.on) && !r.scan); }
  function riskyDiff(r) { return !!(r.diff && r.diff.scan && r.diff.scan.level === 2); }
  function agentName(id) {
    var out = id;
    SA.agents().forEach(function (a) { if (a.id === id) out = a.name; });
    return out;
  }

  function stats() {
    var m = mine(), c = { total: m.length, maj: 0, review: 0, off: 0, chars: 0 };
    m.forEach(function (r) {
      if (r.st === 'maj') c.maj++;
      if (r.warn === 2 || r.warn === 1) c.review++;
      if (r.on === false) c.off++; else c.chars += r.chars || 0;
    });
    return c;
  }

  /* Ce qui demande attention, du plus grave au moins grave. Chaque ligne mène quelque part. */
  function issues() {
    var m = mine(), out = [];
    m.filter(function (r) { return r.warn === 2 && !r.real; }).forEach(function (r) {
      out.push({ lvl: 'bad', t: r.name + ' : motifs à risque dans un skill ' + (r.kind === 'manuel' ? 'copié à la main' : 'installé'), d: (r.local || []).map(function (f) { return f.label; }).join(' · '), a: 'Voir le contrôle', attr: 'data-local="' + esc(r.id) + '"' });
    });
    var risky = m.filter(function (r) { return r.st === 'maj' && riskyDiff(r); });
    risky.forEach(function (r) {
      out.push({ lvl: 'bad', t: r.name + ' : la mise à jour ajoute un motif à risque', d: r.diff.scan.text, a: 'Voir ce qui change', attr: 'data-hm-diff="' + esc(r.id) + '"' });
    });
    var real2 = m.filter(function (r) { return r.real && r.warn === 2; });
    if (real2.length) out.push({ lvl: 'tr', t: SA.pl(real2.length, 'skill installé porte', 'skills installés portent') + ' un avertissement élevé', d: real2.map(function (r) { return r.name; }).join(', '), a: 'Les relire', attr: 'data-hm-f="relire"' });
    m.forEach(function (r) {
      Object.keys(r.ag || {}).forEach(function (id) {
        if (r.ag[id] === 'ko') out.push({ lvl: 'tr', t: r.name + ' : lien cassé dans ' + agentName(id), d: 'L’agent ne voit plus ce skill.', a: 'Voir la grille', attr: 'data-hm-v="grille"' });
        if (r.ag[id] === 'div') out.push({ lvl: 'tr', t: r.name + ' : copie différente dans ' + agentName(id), d: 'Cet agent lit une autre version que les autres.', a: 'Voir la grille', attr: 'data-hm-v="grille"' });
      });
    });
    m.filter(function (r) { return r.dup; }).forEach(function (r) {
      out.push({ lvl: 'tr', t: r.name + ' existe deux fois', d: 'Une copie manuelle porte le nom d’un skill géré.', a: 'Voir', attr: 'data-local="' + esc(r.id) + '"' });
    });
    var maj = m.filter(function (r) { return r.st === 'maj'; }).length - risky.length;
    if (maj > 0) out.push({ lvl: 'up', t: SA.pl(maj, 'mise à jour disponible', 'mises à jour disponibles') + ' sans motif nouveau', d: 'Chaque mise à jour montre ce qui change avant d’écrire.', a: 'Voir les mises à jour', attr: 'data-hm-f="maj"' });
    var long = m.filter(function (r) { return r.on !== false && r.chars > SA.detail.CUT; });
    if (long.length) out.push({ lvl: 'no', t: SA.pl(long.length, 'description dépasse', 'descriptions dépassent') + ' ' + SA.nb(SA.detail.CUT) + ' caractères', d: long.map(function (r) { return r.name; }).join(', ') + ' : Claude Code la coupe dans sa liste.', a: 'Voir le coût en contexte', attr: 'data-hm-s="ctx"' });
    return out;
  }
  var LVL = { bad: 'À traiter', tr: 'À regarder', up: 'Mise à jour', no: 'Pour information' };

  function gesture(n, title, hint, attr) {
    return '<li class="hm-g" data-st><button type="button" class="hm-row" ' + attr + '>' +
      '<span class="hm-i mono">0' + n + '</span>' +
      '<span class="hm-txt"><span class="hm-t">' + title + '</span><span class="hm-hint">' + hint + '</span></span>' +
      '<span class="kbd" aria-hidden="true">' + n + '</span><span class="hm-arw">' + SA.icon('arrow') + '</span></button></li>';
  }

  function stat(n, label, attr, sub) {
    return '<button type="button" class="hm-stat" ' + attr + '><span class="num hm-n" data-count="' + n + '">' + n + '</span>' +
      '<span class="hm-sl">' + label + '</span>' + (sub ? '<span class="hm-ss mut">' + sub + '</span>' : '') + '</button>';
  }

  function openDiff(id) { if (SA.views.gestion && SA.views.gestion.openDiff) SA.views.gestion.openDiff(id); }

  function toGestion(set) {
    var g = SA.state.g;
    g.f = 'tous'; g.q = ''; g.view = 'liste'; g.sort = 'nom';
    set(g);
    SA.setRoute('gestion');
  }

  SA.views.accueil = {
    render: function () {
      var c = stats(), n = SA.agentsOn().length, found = SA.agents().filter(function (a) { return a.st !== 'no'; }).length;
      if (!c.total) {
        return '<p class="eye" data-st>Ma machine</p>' + SA.h('Aucun skill sur cette machine') +
          '<p class="lede" data-st>' + (found ? SA.pl(found, 'agent trouvé', 'agents trouvés') + ', aucun skill installé. ' : '') + 'Commencez par un conseil : quelques questions, puis les skills les mieux notés pour votre projet.</p>' +
          '<div class="empty" data-st><p class="empty-a"><button type="button" class="btn primary" data-go-step="1">Obtenir un conseil</button>' +
          '<button type="button" class="btn" data-go-route="recherche">Ouvrir la recherche</button></p></div>';
      }
      var iss = issues();
      var tok = Math.round(c.chars / 4 / 100) * 100;
      var ok = mine().filter(function (r) { return r.warn === 0 && !unscanned(r); }).length;
      var un = mine().filter(unscanned).length;
      return '<p class="eye" data-st>Ma machine</p>' +
        SA.h(SA.pl(c.total, 'skill', 'skills') + ' dans ' + SA.pl(n, 'agent', 'agents')) +
        '<p class="lede" data-st>Ce que vos agents ont sous la main, et ce qui demande votre attention.</p>' +
        (!found ? '<div class="note note-warn" data-st><p class="note-t">Aucun agent trouvé sur cette machine</p><p class="sub">Les skills ci-dessous sont sur le disque, mais aucun agent détecté ne les lit.</p><p class="note-a"><button type="button" class="btn" data-go-route="agents">Voir la détection</button></p></div>' : '') +
        (SA.offline() ? '<div class="note note-warn" data-st><p class="note-t">Hors ligne</p><p class="sub">La recherche de mises à jour est suspendue. L’état affiché est le dernier connu.</p></div>' : '') +
        '<div class="hm-stats" data-st>' +
          stat(c.total, c.total > 1 ? 'installés' : 'installé', 'data-hm-f="tous"', c.off ? c.off + (c.off > 1 ? ' désactivés' : ' désactivé') : '') +
          stat(c.maj, c.maj > 1 ? 'mises à jour' : 'mise à jour', 'data-hm-f="maj"') +
          stat(c.review, 'à relire', 'data-hm-f="relire"', 'contrôle de sécurité') +
          stat(tok, 'jetons de contexte', 'data-hm-s="ctx"', 'environ, skills actifs') +
        '</div>' +
        '<section class="hm-sec" aria-labelledby="hm-t1"><h2 class="h2" id="hm-t1" data-st>Ce qui demande votre attention</h2>' +
          (iss.length
            ? '<ul class="ledger hm-iss">' + iss.map(function (x) {
                return '<li class="hm-is" data-st><span class="bdg ' + x.lvl + '">' + LVL[x.lvl] + '</span>' +
                  '<div class="hm-is-t"><p class="hm-is-l">' + esc(x.t) + '</p><p class="hm-is-d sub">' + esc(x.d) + '</p></div>' +
                  '<button type="button" class="lnk" ' + x.attr + '>' + x.a + '</button></li>';
              }).join('') + '</ul>'
            : '<p class="sub" data-st>Rien à signaler.</p>') +
        '</section>' +
        '<section class="hm-sec" aria-labelledby="hm-t2"><h2 class="h2" id="hm-t2" data-st>Que voulez-vous faire ?</h2>' +
          '<ul class="ledger hm-gs">' +
            gesture(1, 'Conseiller un projet', 'Quelques questions, puis les skills les mieux notés pour ce projet.', 'data-go-step="1"') +
            gesture(2, 'Contrôler ce qui est installé', 'Tout l’inventaire, avec le contrôle de sécurité et la présence par agent.', 'data-hm-f="tous"') +
            gesture(3, 'Mettre à jour', c.maj ? SA.pl(c.maj, 'mise à jour attend', 'mises à jour attendent') + ' : voyez ce qui change avant d’écrire.' : 'Tout est à jour.', 'data-hm-f="maj"') +
          '</ul>' +
          '<p class="hm-search mut" data-st>Ou cherchez dans la base : touche <span class="kbd">/</span></p>' +
        '</section>' +
        '<section class="hm-sec" aria-labelledby="hm-t3" data-st><h2 class="h2" id="hm-t3">Contrôle de sécurité</h2>' +
          '<p class="sub">' + SA.pl(c.total - un, 'skill lu', 'skills lus') + ' sur cette machine : ' + ok + ' sans motif connu, ' + c.review + ' à relire' + (un ? ', ' + un + (un > 1 ? ' non contrôlés' : ' non contrôlé') : '') + '.</p>' +
          '<p class="mut hm-note">Le contrôle lit le texte des fichiers et signale des motifs, pas une intention. Il ne retire jamais rien de lui-même.</p></section>';
    },

    mount: function (root) {
      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-hm-f], [data-hm-v], [data-hm-s], [data-hm-diff]');
        if (!b || !root.contains(b)) return;
        if (b.hasAttribute('data-hm-diff')) { openDiff(b.getAttribute('data-hm-diff')); return; }
        toGestion(function (g) {
          if (b.hasAttribute('data-hm-f')) g.f = b.getAttribute('data-hm-f');
          if (b.hasAttribute('data-hm-v')) g.view = b.getAttribute('data-hm-v');
          if (b.hasAttribute('data-hm-s')) g.sort = b.getAttribute('data-hm-s');
        });
      });
    },

    actions: function () { return []; },

    keys: function (e) {
      if (!mine().length) return false;
      if (e.key === '1') { SA.go(1, 1); return true; }
      if (e.key === '2') { toGestion(function () {}); return true; }
      if (e.key === '3') { toGestion(function (g) { g.f = 'maj'; }); return true; }
      return false;
    }
  };
})();
