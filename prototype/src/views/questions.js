/* Skill Advisor · view questions (step 2) · owner B */
(function () {
  'use strict';
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  var timer = 0;
  var cur = null;

  function goal() { return SA.data.goals[SA.state.goal || 'app']; }
  function qs() { return goal().qs; }
  function val(q) { return (SA.state.answers || {})[q.id]; }
  function has(q) {
    var v = val(q);
    return Array.isArray(v) ? v.length > 0 : (v != null && v !== '');
  }
  function firstOpen(list) {
    for (var i = 0; i < list.length; i++) if (!has(list[i])) return i;
    return -1;
  }
  function reachOf(list) {
    var f = firstOpen(list);
    return f === -1 ? list.length - 1 : f;
  }
  function complete() {
    var list = qs();
    for (var i = 0; i < list.length; i++) if (!has(list[i])) return false;
    return true;
  }
  function labelOf(q, v) {
    for (var i = 0; i < q.opts.length; i++) if (q.opts[i][0] === v) return q.opts[i][1];
    return String(v);
  }
  function answerText(q) {
    if (!has(q)) return '';
    var v = val(q);
    if (Array.isArray(v)) return v.map(function (x) { return labelOf(q, x); }).join(', ');
    return labelOf(q, v);
  }
  function selected(q, id) {
    var v = val(q);
    return Array.isArray(v) ? v.indexOf(id) > -1 : v === id;
  }
  function status(i, list, qi, reach) {
    if (i === qi) return 'active';
    if (has(list[i])) return 'done';
    if (i <= reach) return 'todo';
    return 'locked';
  }

  function item(q, i, st) {
    var open = st === 'active';
    var opts = q.opts.map(function (o, k) {
      return '<button type="button" class="opt" data-q="' + i + '" data-v="' + SA.esc(o[0]) + '" aria-pressed="' + selected(q, o[0]) + '">' +
        SA.esc(o[1]) + '<span class="kbd" aria-hidden="true">' + (k + 1) + '</span></button>';
    }).join('');
    return '<li class="qs-item is-' + st + '" data-i="' + i + '" data-st>' +
      '<button type="button" class="qs-head" id="qs-h-' + i + '" aria-expanded="' + open + '" aria-controls="qs-f-' + i + '"' + (st === 'locked' ? ' disabled' : '') + '>' +
        '<span class="qs-i mono">Q' + (i + 1) + '</span>' +
        '<span class="qs-q">' + SA.esc(q.q) + '</span>' +
        '<span class="qs-a mono">' + SA.esc(answerText(q)) + '</span>' +
        '<span class="qs-chev">' + SA.icon('chevron') + '</span>' +
      '</button>' +
      '<div class="fold' + (open ? ' open' : '') + '" id="qs-f-' + i + '" role="region" aria-labelledby="qs-h-' + i + '">' +
        '<div class="fold-in"' + (open ? '' : ' inert') + '>' +
          '<div class="qs-pad">' +
            '<div class="qs-opts" role="group" aria-label="' + SA.esc(q.q) + '">' + opts + '</div>' +
            (q.multi ? '<p class="qs-hint">Plusieurs réponses possibles.</p>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</li>';
  }

  // Patch every question in place from state. Never re-renders the view.
  function paint(root) {
    var list = qs();
    var s = SA.state;
    var reach = reachOf(list);
    var items = root.querySelectorAll('.qs-item');
    for (var n = 0; n < items.length; n++) {
      var li = items[n];
      var i = +li.getAttribute('data-i');
      var q = list[i];
      var st = status(i, list, s.qi, reach);
      ['active', 'done', 'todo', 'locked'].forEach(function (k) { li.classList.toggle('is-' + k, k === st); });
      var head = li.querySelector('.qs-head');
      head.disabled = st === 'locked';
      head.setAttribute('aria-expanded', String(st === 'active'));
      var fold = li.querySelector('.fold');
      fold.classList.toggle('open', st === 'active');
      fold.firstElementChild.inert = st !== 'active';
      var a = li.querySelector('.qs-a');
      var t = answerText(q);
      if (a.textContent !== t) {
        a.textContent = t;
        a.classList.remove('qs-new');
        void a.offsetWidth;
        if (t) a.classList.add('qs-new');
      }
      var opts = li.querySelectorAll('.opt');
      for (var k = 0; k < opts.length; k++) {
        opts[k].setAttribute('aria-pressed', String(selected(q, opts[k].getAttribute('data-v'))));
      }
    }
  }

  function focusAfter(root, fromIndex) {
    var ae = document.activeElement;
    var lost = !ae || ae === document.body || root.contains(ae);
    if (!lost) return;
    var s = SA.state;
    var target = null;
    if (s.qi >= 0) {
      var li = root.querySelector('.qs-item[data-i="' + s.qi + '"]');
      if (li) target = li.querySelector('.opt[aria-pressed="true"]') || li.querySelector('.opt');
    }
    if (!target) target = root.querySelector('#qs-h-' + fromIndex);
    if (!target) return;
    target.focus({ preventScroll: true });
    var r = target.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top < 0 || r.bottom > vh - 96) {
      target.scrollIntoView({ block: 'center', behavior: SA.rm ? 'auto' : 'smooth' });
    }
  }

  function choose(root, i, v) {
    var list = qs();
    var q = list[i];
    if (!q) return;
    var s = SA.state;
    s.answers = s.answers || {};
    if (q.multi) {
      var arr = Array.isArray(s.answers[q.id]) ? s.answers[q.id].slice() : [];
      var at = arr.indexOf(v);
      if (at > -1) arr.splice(at, 1); else arr.push(v);
      // Keep the options' order, whatever the click order was.
      s.answers[q.id] = q.opts.map(function (o) { return o[0]; }).filter(function (id) { return arr.indexOf(id) > -1; });
      paint(root);
      SA.sync();
      return;
    }
    s.answers[q.id] = v;
    s.qi = i;
    paint(root);
    SA.sync();
    clearTimeout(timer);
    timer = setTimeout(function () {
      timer = 0;
      if (!root.isConnected || !root.querySelector('.qs-list')) return;
      s.qi = firstOpen(list);
      paint(root);
      SA.sync();
      focusAfter(root, i);
    }, SA.rm ? 0 : 240);
  }

  function toggleHead(root, i) {
    var list = qs();
    var s = SA.state;
    var st = status(i, list, s.qi, reachOf(list));
    if (st === 'locked') return;
    clearTimeout(timer);
    timer = 0;
    if (st === 'active') {
      if (!has(list[i])) return;
      s.qi = -1;
    } else {
      s.qi = i;
    }
    paint(root);
    SA.sync();
  }

  SA.views.questions = {
    render: function () {
      var g = goal();
      var list = g.qs;
      // On entry: open the first unanswered question, or none when everything is answered.
      var qi = firstOpen(list);
      var reach = reachOf(list);
      return '<p class="eye" data-st>Étape 02 · ' + SA.esc(g.title) + '</p>' +
        SA.h('Parlez-nous de votre projet') +
        '<ul class="ledger qs-list">' +
          list.map(function (q, i) { return item(q, i, status(i, list, qi, reach)); }).join('') +
        '</ul>';
    },
    mount: function (root) {
      cur = root;
      clearTimeout(timer);
      timer = 0;
      SA.state.qi = firstOpen(qs());
      root.addEventListener('click', function (e) {
        var opt = e.target.closest('.opt[data-q]');
        if (opt && root.contains(opt)) {
          choose(root, +opt.getAttribute('data-q'), opt.getAttribute('data-v'));
          return;
        }
        var head = e.target.closest('.qs-head');
        if (head && root.contains(head) && !head.disabled) {
          toggleHead(root, +head.closest('.qs-item').getAttribute('data-i'));
        }
      });
    },
    actions: function () {
      var ok = complete();
      return [
        { label: 'Retour', kind: 'default', on: function () { SA.go(1, -1); } },
        { label: 'Voir les recommandations', kind: 'primary', kbd: '↵', disabled: !ok, on: function () { if (complete()) { SA.state.recoShown = 0; SA.go(3, 1); } } }
      ];
    },
    keys: function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (!/^[1-9]$/.test(e.key)) return false;
      if (!cur || !cur.isConnected) return false;
      var s = SA.state;
      /* A digit typed before the auto-advance answers the next question, not the same one again. */
      if (timer) {
        clearTimeout(timer);
        timer = 0;
        s.qi = firstOpen(qs());
        paint(cur);
        SA.sync();
      }
      var q = qs()[s.qi];
      if (!q) return false;
      var o = q.opts[+e.key - 1];
      if (!o) return false;
      choose(cur, s.qi, o[0]);
      return true;
    }
  };
})();
