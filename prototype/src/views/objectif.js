/* Skill Advisor · view objectif (step 1) · owner B */
(function () {
  'use strict';
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  // Les 17 objectifs en une seule grille de cases identiques, rangées sous les titres de SA.data.goalGroups.
  // Touches : 1 à 9, puis A à H, dans l'ordre affiché.
  var KEYS = '123456789ABCDEFGH';
  var busy = false;

  /* Groupes dans l'ordre affiché. Un objectif oublié par les groupes va dans le dernier : chacun reste visible. */
  function groups() {
    var all = Object.keys(SA.data.goals), seen = {};
    var out = (SA.data.goalGroups || []).map(function (g) {
      var ids = g.ids.filter(function (id) { return SA.data.goals[id] && !seen[id] && (seen[id] = true); });
      return { t: g.t, ids: ids };
    }).filter(function (g) { return g.ids.length; });
    var rest = all.filter(function (id) { return !seen[id]; });
    if (rest.length) {
      if (out.length) out[out.length - 1].ids = out[out.length - 1].ids.concat(rest);
      else out.push({ t: 'Objectifs', ids: rest });
    }
    return out;
  }
  function order() {
    return groups().reduce(function (a, g) { return a.concat(g.ids); }, []);
  }
  function num(i) { return (i < 9 ? '0' : '') + (i + 1); }

  function cell(id, i) {
    var g = SA.data.goals[id];
    var cur = SA.state.goal === id;
    return '<li class="ob-cell-li">' +
      '<button type="button" class="ob-cell" data-goal="' + SA.esc(id) + '"' + (cur ? ' aria-current="true"' : '') + (KEYS[i] ? ' aria-keyshortcuts="' + KEYS[i] + '"' : '') + '>' +
        '<span class="ob-ci mono">' + num(i) + '</span>' +
        (KEYS[i] ? '<span class="kbd ob-ck" aria-hidden="true">' + KEYS[i] + '</span>' : '') +
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
    // La présélection automatique de l'ancien objectif part aussi ; les skills choisis à la main restent.
    if (s.goal !== id) {
      s.answers = {};
      s.recoShown = 0;
      if (SA.views.resultats && SA.views.resultats.resetAuto) SA.views.resultats.resetAuto();
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

  /* Flèches : les quatre sens dans la grille. Les cases de toutes les grilles forment une seule suite. */
  function arrow(root, e) {
    var b = e.target.closest && e.target.closest('[data-goal]');
    if (!b || !root.contains(b)) return;
    var cells = Array.prototype.slice.call(root.querySelectorAll('.ob-cell'));
    var c = cells.indexOf(b), next = null;
    if (c < 0) return;
    // Colonnes : les cases de la même rangée que la case courante, dans sa grille.
    var grid = b.closest('.ob-grid'), mates = grid ? Array.prototype.slice.call(grid.querySelectorAll('.ob-cell')) : cells;
    var cols = 1, top0 = mates[0].offsetTop;
    while (cols < mates.length && mates[cols].offsetTop === top0) cols++;
    var k = mates.indexOf(b);
    if (e.key === 'ArrowRight') next = cells[c + 1];
    else if (e.key === 'ArrowLeft') next = cells[c - 1];
    else if (e.key === 'ArrowDown') next = k + cols < mates.length ? mates[k + cols] : cells[c - k + mates.length] || null;
    else if (e.key === 'ArrowUp') next = k - cols >= 0 ? mates[k - cols] : cells[c - k - 1] || null;
    else return;
    e.preventDefault();
    if (next) next.focus();
  }

  var cur = null;

  SA.views.objectif = {
    order: order,
    render: function () {
      var i = 0, n = order().length;
      return '<p class="eye" data-st>Étape 01 · Objectif</p>' +
        SA.h1('Que voulez-vous construire ?') +
        '<p class="lede" data-st>' + n + ' objectifs. Choisissez le plus proche : quelques questions suivent, puis les skills les mieux notés pour votre projet.</p>' +
        groups().map(function (g, gi) {
          return '<section class="ob-grp' + (gi === 0 ? ' ob-grp-top' : '') + '" aria-labelledby="ob-gh-' + gi + '" data-st>' +
            '<h2 class="ob-gh" id="ob-gh-' + gi + '">' + SA.esc(g.t) + '</h2>' +
            '<ul class="ob-grid">' + g.ids.map(function (id) { return cell(id, i++); }).join('') + '</ul>' +
          '</section>';
        }).join('') +
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
      var k = String(e.key || '');
      if (k.length !== 1) return false;
      var at = KEYS.indexOf(k.toUpperCase());
      var id = at > -1 ? order()[at] : null;
      if (!id) return false;
      pick(id, cur && cur.isConnected ? cur : null);
      return true;
    }
  };
})();
