/* Skill Advisor — vue « guide » (étape 5). Le même contenu s'ouvre depuis Mes skills (SA.detail.guide). */
(function () {
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  function here() { return SA.viewId() === 'guide'; }
  function list() { return (SA.state.lastInstall || []).map(SA.item).filter(Boolean); }
  function cur(l) {
    l = l || list();
    return Math.max(0, Math.min(SA.state.guideTab || 0, l.length - 1));
  }

  function tab(it, i, sel) {
    return '<button type="button" class="gd-tab" role="tab" id="gd-tab-' + i + '" data-i="' + i + '"' +
      ' aria-selected="' + (i === sel) + '" aria-controls="gd-panel" tabindex="' + (i === sel ? '0' : '-1') + '">' +
      '<span class="gd-tab-n mono">' + SA.esc(it[1]) + '</span>' +
      '<span class="gd-tab-s mut">Installé' + (it[6] == null ? '' : ' · note ' + it[6]) + '</span>' +
    '</button>';
  }

  function panel(it) {
    var k = SA.det(it[0]);
    return '<div class="gd-pin" data-st>' +
        '<p class="gd-name mono">' + SA.esc(it[1]) + '</p>' +
        '<p class="gd-desc mono mut">' + SA.esc(it[2]) + '</p>' +
      '</div>' +
      SA.detail.guideHtml(it[1], k && k.d ? k.d : '', !!(k && k.d)) +
      '<p class="gd-more" data-st><button type="button" class="lnk" data-detail="' + SA.esc(it[0]) + '">Voir le fichier et les contrôles</button></p>';
  }

  function place(root, instant) {
    var tabs = root.querySelector('.gd-tabs');
    if (!tabs) return;
    var t = tabs.querySelector('.gd-tab[aria-selected="true"]');
    var ind = tabs.querySelector('.gd-ind');
    if (!t || !ind) return;
    if (instant) ind.classList.remove('gd-ind-live');
    ind.style.height = t.offsetHeight + 'px';
    ind.style.transform = 'translateY(' + t.offsetTop + 'px)';
    if (instant) {
      void ind.offsetWidth;
      ind.classList.add('gd-ind-live');
    }
  }

  var resizeBound = false;
  function bindResize() {
    if (resizeBound) return;
    resizeBound = true;
    var raf = 0;
    window.addEventListener('resize', function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        var v = document.querySelector('.gd-grid');
        if (v) place(v, true);
      });
    });
  }

  function select(root, i, focus) {
    var l = list();
    if (!l.length) return;
    i = (i + l.length) % l.length;
    if (i === cur(l) && !focus) return;
    var changed = i !== cur(l);
    SA.state.guideTab = i;
    Array.prototype.forEach.call(root.querySelectorAll('.gd-tab'), function (b) {
      var on = Number(b.getAttribute('data-i')) === i;
      b.setAttribute('aria-selected', String(on));
      b.setAttribute('tabindex', on ? '0' : '-1');
      if (on && focus) b.focus();
    });
    var p = root.querySelector('#gd-panel');
    if (p) p.setAttribute('aria-labelledby', 'gd-tab-' + i);
    place(root, false);
    if (changed && p) SA.swap(p, panel(l[i]), function () {});
    SA.sync();
  }

  function onClick(e) {
    if (!here()) return;
    var t = e.target.closest('.gd-tab');
    if (t) select(e.currentTarget, Number(t.getAttribute('data-i')), false);
  }

  function onKey(e) {
    if (!here() || !e.target.closest || !e.target.closest('.gd-tab')) return;
    var root = e.currentTarget, i = cur(), to = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = i + 1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = i - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list().length - 1;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    select(root, to, true);
  }

  SA.views.guide = {
    render: function () {
      var l = list(), m = SA.agentsOn().length;
      if (!l.length) {
        return '<p class="eye" data-st>Étape 05 · Guide</p>' +
          SA.h('Rien n’est encore installé') +
          '<div class="empty" data-st>' +
            '<p class="sub">Le guide s’affiche après une installation. Celui des skills déjà présents se trouve dans Mes skills.</p>' +
            '<p class="empty-a"><button type="button" class="btn primary" data-go-step="' + (SA.cart.count() ? 4 : 1) + '">' + (SA.cart.count() ? 'Installer la sélection' : 'Obtenir un conseil') + '</button>' +
            '<button type="button" class="btn" data-go-route="gestion">Ouvrir Mes skills</button></p>' +
          '</div>';
      }
      var sel = cur(l);
      return '<p class="eye" data-st>Étape 05 · Guide</p>' +
        SA.h(SA.pl(l.length, 'skill installé', 'skills installés') + ' dans ' + SA.pl(m, 'agent', 'agents')) +
        '<p class="lede" data-st>Voici comment vous en servir. Chaque guide reste disponible dans Mes skills, sur la ligne du skill.</p>' +
        '<div class="gd-grid">' +
          '<div class="gd-tabs" role="tablist" aria-orientation="vertical" aria-label="Skills installés" data-st>' +
            '<span class="gd-ind" aria-hidden="true"></span>' +
            l.map(function (it, i) { return tab(it, i, sel); }).join('') +
          '</div>' +
          '<div class="gd-panel" id="gd-panel" role="tabpanel" aria-labelledby="gd-tab-' + sel + '">' +
            panel(l[sel]) +
          '</div>' +
        '</div>';
    },

    mount: function (root) {
      bindResize();
      var grid = root.querySelector('.gd-grid');
      if (grid) {
        place(grid, true);
        /* Les polices peuvent changer la hauteur des onglets après le premier rendu. */
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () { if (grid.isConnected) place(grid, true); });
        }
      }
      root.addEventListener('click', onClick);
      root.addEventListener('keydown', onKey);
    },

    actions: function () {
      if (!list().length) return [];
      return [
        {
          label: 'Nouveau projet', kind: 'default', on: function () {
            var st = SA.state;
            st.goal = null; st.answers = {}; st.qi = 0; st.guideTab = 0; st.recoShown = 0; st.inst = null;
            SA.go(1, -1);
          }
        },
        { label: 'Ouvrir Mes skills', kind: 'primary', kbd: '↵', on: function () { SA.setRoute('gestion'); } }
      ];
    }
    /* Enter is owned by core (it clicks the primary action), so this view has no keys(). */
  };
})();
