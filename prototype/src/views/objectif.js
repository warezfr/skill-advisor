/* Skill Advisor · view objectif (step 1) · owner B */
(function () {
  'use strict';
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  // Les trois objectifs historiques en grandes lignes, les autres en grille compacte, dans l'ordre de data.js.
  var TOP = ['site', 'app', 'data'];
  var busy = false;

  function more() {
    return Object.keys(SA.data.goals).filter(function (id) { return TOP.indexOf(id) < 0; });
  }
  function order() {
    return TOP.filter(function (id) { return SA.data.goals[id]; }).concat(more());
  }
  function num(i) { return (i < 9 ? '0' : '') + (i + 1); }

  function row(id, i) {
    var g = SA.data.goals[id];
    var cur = SA.state.goal === id;
    var n = String(i + 1);
    return '<li class="ob-item" data-st>' +
      '<button type="button" class="ob-row" data-goal="' + SA.esc(id) + '"' + (cur ? ' aria-current="true"' : '') + '>' +
        '<span class="ob-i mono">' + num(i) + '</span>' +
        '<span class="ob-txt">' +
          '<span class="ob-t">' + SA.esc(g.title) +
            (cur ? '<span class="tag ob-tag">Choisi</span>' : '') +
          '</span>' +
          '<span class="ob-hint">' + SA.esc(g.hint) + '</span>' +
        '</span>' +
        '<span class="kbd ob-kbd" aria-hidden="true">' + n + '</span>' +
        '<span class="ob-arw">' + SA.icon('arrow') + '</span>' +
      '</button>' +
    '</li>';
  }

  function cell(id, i) {
    var g = SA.data.goals[id];
    var cur = SA.state.goal === id;
    return '<li class="ob-cell-li">' +
      '<button type="button" class="ob-cell" data-goal="' + SA.esc(id) + '"' + (cur ? ' aria-current="true"' : '') + '>' +
        '<span class="ob-ci mono">' + num(i) + '</span>' +
        (i < 9 ? '<span class="kbd ob-ck" aria-hidden="true">' + (i + 1) + '</span>' : '') +
        '<span class="ob-ct">' + SA.esc(g.title) + (cur ? '<span class="tag ob-tag">Choisi</span>' : '') + '</span>' +
        '<span class="ob-ch">' + SA.esc(g.hint) + '</span>' +
      '</button>' +
    '</li>';
  }

  function pick(id, root) {
    if (busy || !SA.data.goals[id]) return;
    busy = true;
    setTimeout(function () { busy = false; }, 700);
    var s = SA.state;
    // Changing the goal resets everything derived from it; re-choosing the same goal keeps the answers.
    if (s.goal !== id) {
      s.answers = {};
      s.recoShown = 0;
    }
    s.goal = id;
    s.qi = 0;
    if (root) {
      var rows = root.querySelectorAll('[data-goal]');
      for (var i = 0; i < rows.length; i++) {
        var on = rows[i].getAttribute('data-goal') === id;
        if (on) rows[i].setAttribute('aria-current', 'true');
        else rows[i].removeAttribute('aria-current');
        rows[i].classList.toggle('is-go', on);
      }
    }
    SA.go(2, 1);
  }

  /* Flèches : haut et bas dans les lignes, les quatre sens dans la grille. */
  function arrow(root, e) {
    var b = e.target.closest && e.target.closest('[data-goal]');
    if (!b || !root.contains(b)) return;
    var all = Array.prototype.slice.call(root.querySelectorAll('[data-goal]'));
    var cells = Array.prototype.slice.call(root.querySelectorAll('.ob-cell'));
    var i = all.indexOf(b), c = cells.indexOf(b), next = null;
    var cols = 1;
    if (cells.length) {
      var top0 = cells[0].offsetTop;
      while (cols < cells.length && cells[cols].offsetTop === top0) cols++;
    }
    // Vers le bas depuis l'avant-dernière rangée incomplète : la dernière case.
    var lastRow = Math.floor((cells.length - 1) / cols);
    if (e.key === 'ArrowDown') next = c < 0 ? all[i + 1] : (Math.floor(c / cols) < lastRow ? cells[Math.min(c + cols, cells.length - 1)] : null);
    else if (e.key === 'ArrowUp') next = c < 0 ? all[i - 1] : (c >= cols ? cells[c - cols] : all[all.length - cells.length - 1]);
    else if (e.key === 'ArrowRight') next = c < 0 ? null : cells[c + 1];
    else if (e.key === 'ArrowLeft') next = c < 0 ? null : cells[c - 1];
    else return;
    e.preventDefault();
    if (next) next.focus();
  }

  var cur = null;

  SA.views.objectif = {
    order: order,
    render: function () {
      var list = order(), top = list.slice(0, TOP.length), rest = list.slice(TOP.length);
      return '<p class="eye" data-st>Étape 01 · Objectif</p>' +
        SA.h('Que voulez-vous construire ?') +
        '<p class="lede" data-st>Quelques questions, puis les skills les mieux notés pour votre projet, installés dans vos agents.</p>' +
        '<ul class="ledger ob-list">' + top.map(row).join('') + '</ul>' +
        (rest.length
          ? '<section class="ob-more" aria-labelledby="ob-more-h" data-st>' +
              '<h2 class="ob-more-h" id="ob-more-h">Autres projets</h2>' +
              '<ul class="ob-grid">' + rest.map(function (id, k) { return cell(id, k + top.length); }).join('') + '</ul>' +
            '</section>'
          : '') +
        '<p class="ob-foot" data-st>Skill Advisor tourne sur votre machine. Rien n’est écrit sans votre confirmation.</p>' +
        '<p class="ob-alt" data-st>Vous savez déjà ce que vous cherchez ? <button type="button" class="lnk" data-go-route="recherche">Ouvrir la recherche</button><span class="kbd" aria-hidden="true">/</span></p>';
    },
    mount: function (root) {
      cur = root;
      root.addEventListener('click', function (e) {
        var b = e.target.closest('[data-goal]');
        if (!b || !root.contains(b)) return;
        pick(b.getAttribute('data-goal'), root);
      });
      root.addEventListener('keydown', function (e) {
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        arrow(root, e);
      });
    },
    actions: function () { return []; },
    keys: function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (!/^[1-9]$/.test(e.key)) return false;
      var id = order()[+e.key - 1];
      if (!id) return false;
      pick(id, cur && cur.isConnected ? cur : null);
      return true;
    }
  };
})();
