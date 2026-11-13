/* Skill Advisor · view objectif (step 1) · owner B */
(function () {
  'use strict';
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  var ORDER = ['site', 'app', 'data'];
  var busy = false;

  function row(id, i) {
    var g = SA.data.goals[id];
    var cur = SA.state.goal === id;
    var n = String(i + 1);
    return '<li class="ob-item" data-st>' +
      '<button type="button" class="ob-row" data-goal="' + id + '"' + (cur ? ' aria-current="true"' : '') + '>' +
        '<span class="ob-i mono">0' + n + '</span>' +
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
      var rows = root.querySelectorAll('.ob-row');
      for (var i = 0; i < rows.length; i++) {
        var on = rows[i].getAttribute('data-goal') === id;
        if (on) rows[i].setAttribute('aria-current', 'true');
        else rows[i].removeAttribute('aria-current');
        rows[i].classList.toggle('is-go', on);
      }
    }
    SA.go(2, 1);
  }

  var cur = null;

  SA.views.objectif = {
    render: function () {
      return '<p class="eye" data-st>Étape 01 · Objectif</p>' +
        SA.h('Que voulez-vous construire ?') +
        '<p class="lede" data-st>Quelques questions, puis les skills les mieux notés pour votre projet, installés dans vos agents.</p>' +
        '<ul class="ledger ob-list">' + ORDER.map(row).join('') + '</ul>' +
        '<p class="ob-foot" data-st>Skill Advisor tourne sur votre machine. Rien n’est écrit sans votre confirmation.</p>' +
        '<p class="ob-alt" data-st>Vous savez déjà ce que vous cherchez ? <button type="button" class="lnk" data-go-route="recherche">Ouvrir la recherche</button><span class="kbd" aria-hidden="true">/</span></p>';
    },
    mount: function (root) {
      cur = root;
      root.addEventListener('click', function (e) {
        var b = e.target.closest('.ob-row');
        if (!b || !root.contains(b)) return;
        pick(b.getAttribute('data-goal'), root);
      });
    },
    actions: function () { return []; },
    keys: function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      var i = ['1', '2', '3'].indexOf(e.key);
      if (i < 0) return false;
      pick(ORDER[i], cur && cur.isConnected ? cur : null);
      return true;
    }
  };
})();
