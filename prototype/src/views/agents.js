/* Skill Advisor · view agents (route agents) : gestion des agents.
   Liste complète (agents principaux, autres agents repliés, agents ajoutés à la main), recherche, filtres,
   cible des installations, masquer, vider, ajouter, retirer. Mode démo : la machine d'exemple, en mémoire.
   Mode réel (SA.live.on) : chaque action passe par SA.live.call, qui remplace l'état, puis la vue se redessine. */
(function () {
  'use strict';
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  /* Ordre d'affichage des agents principaux (TOP_AGENTS du contrat). */
  var TOP = [
    ['claude-code', 'Claude Code'], ['cursor', 'Cursor'], ['codex', 'Codex'], ['github-copilot', 'GitHub Copilot'],
    ['gemini-cli', 'Gemini CLI'], ['windsurf', 'Windsurf'], ['cline', 'Cline'], ['roo', 'Roo Code'], ['kiro-cli', 'Kiro CLI'],
    ['zed', 'Zed'], ['opencode', 'OpenCode'], ['goose', 'Goose'], ['amp', 'Amp'], ['antigravity', 'Antigravity'],
    ['continue', 'Continue'], ['junie', 'Junie'], ['trae', 'Trae'], ['warp', 'Warp'], ['kilo', 'Kilo Code'],
    ['qwen-code', 'Qwen Code'], ['augment', 'Augment'], ['openhands', 'OpenHands'], ['devin', 'Devin for Terminal'], ['replit', 'Replit']
  ];
  var RANK = {};
  TOP.forEach(function (t, i) { RANK[t[0]] = i; });
  /* Ids de la machine d'exemple qui diffèrent des ids de la CLI. */
  var ALIAS = { claude: 'claude-code', gemini: 'gemini-cli', copilot: 'github-copilot' };
  var ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

  var OSES = [['mac', 'macOS'], ['win', 'Windows'], ['linux', 'Linux']];
  var FILTERS = [['tous', 'Tous'], ['detectes', 'Détectés'], ['cibles', 'Ciblés'], ['masques', 'Masqués']];
  var BADGE = { ok: ['ok', 'Installé'], tr: ['tr', 'Traces seulement'], no: ['no', 'Non détecté'] };
  var STEP = 130;
  var LEAD = 420;
  var scan = { token: 0, timers: [] };

  /* ------------------------------------------------------------ état de l'écran */
  function st() {
    var s = SA.state;
    if (!s.ag || typeof s.ag !== 'object') s.ag = {};
    var a = s.ag;
    if (typeof a.q !== 'string') a.q = '';
    if (!a.f) a.f = 'tous';
    if (!a.hidden) a.hidden = {};
    return a;
  }
  function live() { return !!(SA.live && SA.live.on); }
  function lstate() { return (SA.live && SA.live.state) || {}; }
  function curOs() {
    var o = live() ? (lstate().os || SA.state.os) : SA.state.os;
    return o === 'win' || o === 'linux' ? o : 'mac';
  }
  function sep() { return curOs() === 'win' ? '\\' : '/'; }
  function home() {
    if (live()) return String(lstate().home || SA.state.home || '');
    return String(((SA.data || {}).home || {})[curOs()] || '');
  }
  function osLabel() { return ((SA.data || {}).osLabel || {})[curOs()] || 'macOS'; }

  /* Chemin affiché : relatif au dossier personnel (~) quand il s'y trouve, sinon complet. */
  function shortPath(abs) {
    abs = String(abs || '');
    var h = home();
    if (!abs || !h) return abs;
    var win = curOs() === 'win';
    var a = win ? abs.toLowerCase() : abs, b = win ? h.toLowerCase() : h;
    if (a === b) return '~';
    if (a.indexOf(b + sep()) === 0 || a.indexOf(b + '/') === 0) return '~' + abs.slice(h.length);
    return abs;
  }

  /* ------------------------------------------------------------ liste normalisée */
  function demoCount(id) {
    return (SA.state.mine || []).filter(function (r) { return r.ag && r.ag[id]; }).length;
  }
  function fromDemo(a, top) {
    var s = SA.state, det = a.st !== 'no';
    return {
      id: a.id, name: a.name, st: a.st || 'no', sig: a.sig || [], cmd: a.cmd || '',
      detected: det || !!a.custom, top: top, custom: !!a.custom, hidden: !!st().hidden[a.id],
      target: (det || !!a.custom) && !!(s.agents || {})[a.id], dir: SA.agentPath(a) || '', count: demoCount(a.id)
    };
  }
  function fromLive(a) {
    var n = Number(a.count);
    return {
      id: String(a.id), name: String(a.name || a.id), st: a.detected ? 'ok' : 'no', sig: [], cmd: '',
      detected: !!a.detected, top: !!a.top && !a.custom, custom: !!a.custom, hidden: !!a.hidden,
      universal: !!a.universal && !a.custom,
      target: !!a.target, dir: a.globalDir ? String(a.globalDir) : '', count: isFinite(n) && a.count != null ? n : null
    };
  }
  /* Dossier partagé lu par les agents universels (~/.agents/skills). */
  function sharedPath() { return '~' + sep() + '.agents' + sep() + 'skills'; }
  function byName(a, b) { return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }); }

  function list() {
    var top = [], others = [], custom = [];
    if (live()) {
      ((SA.data || {}).agents || []).forEach(function (raw) {
        if (!raw || !raw.id) return;
        var a = fromLive(raw);
        (a.custom ? custom : a.top ? top : others).push(a);
      });
      top.sort(function (a, b) {
        var x = a.id in RANK ? RANK[a.id] : 999, y = b.id in RANK ? RANK[b.id] : 999;
        return x - y;
      });
      others.sort(byName);
      return { top: top, others: others, custom: custom };
    }
    var known = {};
    SA.agents().forEach(function (raw) {
      if (raw.custom) { custom.push(fromDemo(raw, false)); return; }
      var key = ALIAS[raw.id] || raw.id;
      if (key in RANK) known[key] = raw;
      else others.push(fromDemo(raw, false));
    });
    TOP.forEach(function (t) {
      if (known[t[0]]) top.push(fromDemo(known[t[0]], true));
      else top.push({ id: t[0], name: t[1], st: 'no', sig: [], cmd: '', detected: false, top: true, custom: false,
        hidden: !!st().hidden[t[0]], target: false, dir: '', count: 0 });
    });
    others.sort(byName);
    return { top: top, others: others, custom: custom };
  }
  function all() { var l = list(); return l.top.concat(l.others, l.custom); }
  function find(id) { return all().filter(function (a) { return a.id === id; })[0] || null; }

  function filtering() { var a = st(); return !!a.q.trim() || a.f !== 'tous'; }
  function keep(a) {
    var f = st().f, q = st().q.trim().toLowerCase();
    if (f === 'masques' ? !a.hidden : a.hidden) return false;
    if (f === 'detectes' && !a.detected) return false;
    if (f === 'cibles' && !a.target) return false;
    if (q && a.name.toLowerCase().indexOf(q) < 0 && a.id.toLowerCase().indexOf(q) < 0) return false;
    return true;
  }
  function visible() { return all().filter(keep); }
  function fcount(f) {
    return all().filter(function (a) {
      if (f === 'masques') return a.hidden;
      if (a.hidden) return false;
      return f === 'detectes' ? a.detected : f === 'cibles' ? a.target : true;
    }).length;
  }

  /* ------------------------------------------------------------ recherche des agents (démo) */
  function stopScan() {
    scan.token++;
    scan.timers.forEach(clearTimeout);
    scan.timers = [];
  }
  function scanned() {
    if (live()) return true;
    SA.state.scanned = SA.state.scanned || {};
    return !!SA.state.scanned[SA.state.os];
  }

  function summary() {
    var l = all(), t;
    if (live()) {
      var d = l.filter(function (a) { return a.detected; }).length;
      var c = l.filter(function (a) { return a.target; }).length;
      var h = l.filter(function (a) { return a.hidden; }).length;
      return SA.pl(d, 'agent détecté', 'agents détectés') + ' sur ' + l.length + ' · ' + SA.pl(c, 'cible', 'cibles') + ' · ' + SA.pl(h, 'masqué', 'masqués');
    }
    var n = { ok: 0, tr: 0, no: 0 };
    l.forEach(function (a) { var k = a.custom ? 'ok' : a.st; n[k] = (n[k] || 0) + 1; });
    t = n.ok + (n.ok > 1 ? ' installés' : ' installé') +
      ' · ' + n.tr + ' avec traces' +
      ' · ' + n.no + (n.no > 1 ? ' non détectés' : ' non détecté');
    if (SA.state.os === 'win') t += ' · 1 instance WSL';
    return t;
  }

  function sigText(a) {
    if (a.custom) return 'ajouté à la main';
    if (live()) return !a.detected ? 'aucun signal' : a.universal ? 'lit le dossier partagé ' + sharedPath() : '';
    if (!a.sig || !a.sig.length) return 'aucun signal';
    var os = SA.state.os;
    return a.sig.map(function (k) {
      if (k === 'cmd') return 'commande ' + a.cmd;
      if (k === 'cfg') return 'dossier de configuration';
      if (k === 'app') return os === 'win' ? 'programme installé' : os === 'linux' ? 'paquet installé' : 'application';
      if (k === 'ext') return 'extension VS Code';
      return k;
    }).join(' · ');
  }
  function countText(a) {
    if (a.count == null) return 'nombre de skills inconnu';
    return a.count ? SA.pl(a.count, 'skill', 'skills') : 'aucun skill';
  }
  function badge(a) {
    if (a.custom) return ['no', 'Ajouté à la main'];
    if (live()) return a.detected ? ['ok', 'Détecté'] : ['no', 'Non détecté'];
    return BADGE[a.st] || BADGE.no;
  }

  /* ------------------------------------------------------------ rendu */
  function segHTML(label, items, current, attr) {
    return '<div class="seg" role="group" aria-label="' + label + '">' +
      items.map(function (it) {
        return '<button type="button" ' + attr + '="' + it[0] + '" data-fk="' + attr + ':' + it[0] + '" aria-pressed="' + (it[0] === current) + '">' + it[1] + '</button>';
      }).join('') +
    '</div>';
  }

  function menuHTML(a) {
    var id = SA.esc(a.id), name = SA.esc(a.name);
    return '<div class="ag-menu" id="ag-m-' + id + '" role="group" aria-label="Actions pour ' + name + '">' +
      (a.hidden
        ? '<button type="button" class="btn quiet" data-ag-show="' + id + '" data-fk="show:' + id + '">Afficher</button>'
        : '<button type="button" class="btn quiet" data-ag-hide="' + id + '" data-fk="hide:' + id + '">Masquer</button>') +
      '<button type="button" class="btn quiet" data-ag-empty="' + id + '" data-fk="empty:' + id + '"' + (a.count ? '' : ' disabled') + '>Retirer tous ses skills</button>' +
      (a.custom ? '<button type="button" class="btn quiet" data-ag-remove="' + id + '" data-fk="remove:' + id + '">Retirer l’agent</button>' : '') +
    '</div>';
  }

  function confirmHTML(a, c) {
    var id = SA.esc(a.id), name = SA.esc(a.name);
    if (c.kind === 'empty') {
      return '<div class="ag-cf" role="group" aria-labelledby="ag-cf-t-' + id + '">' +
        '<p class="ag-cf-t" id="ag-cf-t-' + id + '">' + (a.count === 1 ? 'Retirer le skill de ' + name + ' ? L’agent ne le lira plus.'
          : 'Retirer ' + (a.count ? 'les ' + a.count + ' skills' : 'les skills') + ' de ' + name + ' ? L’agent ne les lira plus.') + '</p>' +
        (a.universal ? '<p class="ag-cf-w">Ces skills sont dans le dossier partagé <span class="mono">' + SA.esc(sharedPath()) + '</span>. Les autres agents qui lisent ce dossier ne les liront plus non plus.</p>' : '') +
        '<label class="ag-cb"><input type="checkbox" data-ag-backup data-fk="backup:' + id + '"' + (c.backup !== false ? ' checked' : '') + '><span>Garder une sauvegarde</span></label>' +
        '<p class="ag-cf-a"><button type="button" class="btn danger" data-ag-ok data-fk="ok:' + id + '">Retirer les skills</button>' +
        '<button type="button" class="btn quiet" data-ag-no data-fk="no:' + id + '">Annuler</button></p></div>';
    }
    return '<div class="ag-cf" role="group" aria-labelledby="ag-cf-t-' + id + '">' +
      '<p class="ag-cf-t" id="ag-cf-t-' + id + '">Retirer ' + name + ' de la liste ? Skill Advisor n’installera plus rien dans son dossier.</p>' +
      '<p class="ag-cf-a"><button type="button" class="btn danger" data-ag-ok data-fk="ok:' + id + '">Retirer l’agent</button>' +
      '<button type="button" class="btn quiet" data-ag-no data-fk="no:' + id + '">Annuler</button></p></div>';
  }

  function rowHTML(a, pending) {
    var ag = st(), id = SA.esc(a.id), name = SA.esc(a.name);
    var b = badge(a), skl = pending ? ' skl' : '';
    var can = a.detected || a.custom;
    var open = ag.menu === a.id, c = ag.confirm && ag.confirm.id === a.id ? ag.confirm : null;
    var p = a.dir ? shortPath(a.dir) : 'Aucun dossier';
    var sig = sigText(a);
    return '<li class="ag-row ag-' + (a.custom ? 'ok' : a.st) + (a.hidden ? ' is-hidden' : '') + '" data-id="' + id + '" data-st>' +
      '<button type="button" class="sw" role="switch" aria-checked="' + (can && a.target) + '" aria-label="Recevoir les installations : ' + name + '" title="Recevoir les installations" data-fk="sw:' + id + '"' + (can ? '' : ' disabled') + '></button>' +
      '<p class="ag-l1"><span class="ag-n">' + name + '</span>' + (sig ? '<span class="ag-sig">' + SA.esc(sig) + '</span>' : '') + '</p>' +
      '<span class="bdg ' + b[0] + skl + '">' + b[1] + '</span>' +
      '<p class="ag-path' + (a.dir ? '' : ' mut') + skl + '"><span class="mono">' + SA.esc(p) + '</span><span class="ag-cnt">' + SA.esc(countText(a)) + '</span></p>' +
      '<button type="button" class="btn quiet ag-more" data-ag-menu="' + id + '" data-fk="menu:' + id + '" aria-expanded="' + open + '"' + (open ? ' aria-controls="ag-m-' + id + '"' : '') + ' aria-label="Actions pour ' + name + '">Actions</button>' +
      (open || c ? '<div class="ag-pane">' + (c ? confirmHTML(a, c) : menuHTML(a)) + '</div>' : '') +
    '</li>';
  }

  function wslHTML(pending) {
    var skl = pending ? ' skl' : '';
    return '<li class="ag-row ag-wsl" data-id="wsl" data-st>' +
      '<button type="button" class="sw" role="switch" aria-checked="false" aria-label="Recevoir les installations : Claude Code, instance WSL Ubuntu" disabled></button>' +
      '<p class="ag-l1"><span class="ag-n">Claude Code · WSL Ubuntu</span><span class="ag-sig">Lancez Skill Advisor dans WSL pour y écrire.</span></p>' +
      '<span class="bdg wsl' + skl + '">Instance WSL</span>' +
      '<p class="ag-path' + skl + '"><span class="mono">/home/alex/.claude/skills</span></p>' +
    '</li>';
  }

  function rows(items, pending) {
    return items.map(function (a) { return rowHTML(a, pending); }).join('');
  }

  function listHTML() {
    var pending = !scanned(), l = list(), f = filtering(), ag = st(), out = '';
    var top = l.top.filter(keep), others = l.others.filter(keep), custom = l.custom.filter(keep);
    if (!top.length && !others.length && !custom.length) {
      return '<p class="sub ag-empty" data-st>Aucun agent ne correspond. Modifiez la recherche ou le filtre.</p>';
    }
    if (top.length || (!live() && SA.state.os === 'win' && !f)) {
      out += '<ul class="ledger ag-list" aria-label="Agents principaux">' + rows(top, pending) +
        (!live() && SA.state.os === 'win' && !f ? wslHTML(pending) : '') + '</ul>';
    }
    if (others.length) {
      var open = f || !!ag.open;
      out += '<section class="ag-grp" aria-labelledby="ag-grp-o">' +
        (f
          ? '<h2 class="ag-grp-h" id="ag-grp-o">Autres agents (' + others.length + ')</h2>'
          : '<h2 class="ag-grp-h" id="ag-grp-o"><button type="button" class="ag-grp-b" data-ag-others data-fk="others" aria-expanded="' + open + '"' + (open ? ' aria-controls="ag-grp-l"' : '') + '>' +
            SA.icon('chevron') + '<span>Autres agents (' + others.length + ')</span></button></h2>') +
        (open ? '<ul class="ledger ag-list" id="ag-grp-l" aria-label="Autres agents">' + rows(others, pending) + '</ul>' : '') +
      '</section>';
    }
    if (custom.length) {
      out += '<section class="ag-grp" aria-labelledby="ag-grp-c"><h2 class="ag-grp-h" id="ag-grp-c">Ajoutés à la main (' + custom.length + ')</h2>' +
        '<ul class="ledger ag-list" aria-label="Agents ajoutés à la main">' + rows(custom, pending) + '</ul></section>';
    }
    return out;
  }

  function noneHTML() {
    if (all().some(function (a) { return a.detected && !a.custom; })) return '';
    if (live()) {
      return '<div class="note note-warn" data-st><p class="note-t">Aucun agent trouvé sur cette machine</p>' +
        '<p class="sub">Si un agent est installé dans un dossier inhabituel, ajoutez-le à la main ci-dessous.</p></div>';
    }
    return '<div class="note note-warn" data-st><p class="note-t">Aucun agent trouvé sur cette machine</p>' +
      '<p class="sub">Aucun des quatre signaux n’a répondu. Si un agent est installé dans un dossier inhabituel, ajoutez-le à la main ci-dessous. Sinon, installez un agent puis relancez la recherche.</p>' +
      '<p class="note-a"><button type="button" class="btn" data-ag-rescan>Relancer la recherche</button></p></div>';
  }

  function example() {
    var h = home(), s = sep();
    if (!h) return curOs() === 'win' ? 'C:\\outils\\mon-agent\\skills' : '/opt/mon-agent/skills';
    return h + s + '.mon-agent' + s + 'skills';
  }

  function formHTML() {
    var s = SA.state, ag = st();
    if (!s.agNew) {
      return '<p class="sub">Indiquez son nom et le dossier où il lit ses skills : il recevra les installations comme les autres.</p>' +
        '<p class="ag-new-a"><button type="button" class="btn" data-ag-new data-fk="new">Ajouter un agent</button></p>';
    }
    return '<div class="ag-form"><label class="ag-fl" for="ag-new-n">Nom de l’agent</label>' +
      '<input id="ag-new-n" class="fld" type="text" autocomplete="off" maxlength="60" placeholder="Mon agent" data-fk="n" value="' + SA.esc(ag.nv || '') + '"' + (ag.err && ag.errAt === 'n' ? ' aria-invalid="true" aria-describedby="ag-new-err"' : '') + '>' +
      '<label class="ag-fl" for="ag-new-p">Dossier où il lit ses skills, en chemin complet</label>' +
      '<input id="ag-new-p" class="fld mono" type="text" autocomplete="off" spellcheck="false" placeholder="' + SA.esc(example()) + '" data-fk="p" value="' + SA.esc(ag.dv || '') + '"' + (ag.err && ag.errAt === 'p' ? ' aria-invalid="true" aria-describedby="ag-new-err"' : '') + '>' +
      '<p class="ag-new-err" id="ag-new-err" role="alert">' + SA.esc(ag.err || '') + '</p>' +
      '<p class="ag-new-a"><button type="button" class="btn primary" data-ag-add data-fk="add"' + (ag.busy ? ' disabled' : '') + '>Ajouter cet agent</button><button type="button" class="btn quiet" data-ag-cancel>Annuler</button></p></div>';
  }

  /* ------------------------------------------------------------ actions */
  function refresh(focus) {
    if (SA.state.route !== 'agents') return;
    if (focus) st().focus = focus;
    if (SA.repaint) SA.repaint();
  }

  /* Mode réel : les autres écrans lisent les cibles dans SA.state.agents (SA.agentsOn). */
  function syncTargets() {
    if (!live()) return;
    var map = {};
    all().forEach(function (a) { if (a.target && (a.detected || a.custom)) map[a.id] = true; });
    SA.state.agents = map;
  }

  /* Appel au serveur local : rien n'est changé avant sa réponse. */
  function run(method, path, body, o) {
    o = o || {};
    var ag = st();
    if (ag.busy) return Promise.resolve(false);
    if (!SA.live || typeof SA.live.call !== 'function') return refuse('Le serveur local ne répond pas. Rechargez la page.', o.focus);
    ag.busy = true;
    ag.fail = '';
    ag.msg = '';
    var p;
    try { p = body === undefined ? SA.live.call(method, path) : SA.live.call(method, path, body); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (res) {
      var a = st();
      a.busy = false;
      syncTargets();
      if (o.ok) o.ok(res || {});
      refresh(o.focus);
      return res || true;
    }, function (e) {
      var a = st(), m = (e && e.message) || 'L’action a échoué. Réessayez.';
      a.busy = false;
      if (o.ko) o.ko(m); else a.fail = m;
      refresh(o.koFocus || o.focus);
      return false;
    });
  }
  /* Refus avant tout appel : message d'erreur, rien n'est changé. */
  function refuse(msg, focus) {
    var ag = st();
    ag.msg = '';
    ag.fail = msg;
    refresh(focus);
    return Promise.resolve(false);
  }
  function okId(id) { return ID_RE.test(String(id)); }
  var BAD_ID = 'Identifiant d’agent non valide.';
  function done(msg, focus) {
    var ag = st();
    ag.fail = '';
    ag.msg = msg;
    if (SA.sync) SA.sync();
    refresh(focus);
    return Promise.resolve(true);
  }

  /* Mode réel : envoie la liste complète des cibles. Une liste vide vaut « tous les agents détectés »
     côté serveur (registry.mjs) : la dernière cible ne peut donc pas être retirée. */
  function sendTargets(id, on, o) {
    var ids = all().filter(function (x) { return x.target && x.id !== id; }).map(function (x) { return x.id; });
    if (on) ids.push(id);
    if (!ids.length) return refuse('Gardez au moins un agent qui reçoit les installations.', o.focus);
    if (!ids.every(okId)) return refuse(BAD_ID, o.focus);
    return run('POST', '/api/agents/targets', { ids: ids }, { focus: o.focus, ok: function () { st().msg = o.msg; }, ko: o.ko });
  }

  function target(id, on) {
    var a = find(id);
    if (!a || !(a.detected || a.custom)) return Promise.resolve(false);
    on = !!on;
    var msg = a.name + (on ? ' recevra les installations.' : ' ne recevra plus les installations.');
    if (live()) return sendTargets(id, on, { focus: 'sw:' + id, msg: msg });
    SA.state.agents = SA.state.agents || {};
    SA.state.agents[id] = on;
    return done(msg, 'sw:' + id);
  }

  function setHidden(id, hide) {
    var a = find(id), ag = st();
    if (!a) return Promise.resolve(false);
    ag.menu = null;
    var msg = hide ? a.name + ' est masqué. Le filtre Masqués le montre.' : a.name + ' est de nouveau affiché.';
    if (live()) {
      if (!okId(id)) return refuse(BAD_ID, 'menu:' + id);
      return run('POST', '/api/agents/' + (hide ? 'hide' : 'show'), { id: id }, {
        focus: 'menu:' + id, ok: function () { st().msg = msg; }
      });
    }
    if (hide) ag.hidden[id] = true; else delete ag.hidden[id];
    return done(msg, 'menu:' + id);
  }

  function askEmpty(id) {
    var a = find(id), ag = st();
    if (!a) return;
    ag.menu = null;
    ag.confirm = { id: id, kind: 'empty', backup: true };
    refresh('ok:' + id);
  }
  function askRemove(id) {
    var a = find(id), ag = st();
    if (!a) return;
    ag.menu = null;
    ag.confirm = { id: id, kind: 'remove' };
    refresh('ok:' + id);
  }
  function setBackup(on) {
    var c = st().confirm;
    if (c) c.backup = !!on;
  }
  function cancel() {
    var ag = st(), c = ag.confirm;
    ag.confirm = null;
    refresh(c ? 'menu:' + c.id : null);
  }

  function emptyDemo(a, backup) {
    var s = SA.state, gone = {}, n = 0;
    (s.mine || []).forEach(function (r) {
      if (!r.ag || !r.ag[a.id]) return;
      n++;
      delete r.ag[a.id];
      if (!Object.keys(r.ag).length) gone[r.id] = r;
    });
    /* Une ligne sans agent quitte la machine ; sa sauvegarde va en bas de Mes skills. */
    s.mine = (s.mine || []).filter(function (r) { return !gone[r.id]; });
    Object.keys(gone).forEach(function (k) { if (backup) s.backups.unshift(gone[k]); });
    s.lastInstall = (s.lastInstall || []).filter(function (k) { return !gone[k]; });
    return n;
  }

  function removedText(n, name) {
    return (n ? SA.pl(n, 'skill retiré', 'skills retirés') : 'Aucun skill retiré') + ' de ' + name + '.';
  }

  function confirm() {
    var ag = st(), c = ag.confirm;
    if (!c) return Promise.resolve(false);
    ag.confirm = null;
    var a = find(c.id);
    if (!a) { refresh(); return Promise.resolve(false); }
    if (c.kind === 'empty') {
      var backup = c.backup !== false;
      if (live()) {
        if (!okId(a.id)) return refuse(BAD_ID, 'menu:' + a.id);
        return run('POST', '/api/agents/empty', { id: a.id, backup: backup }, {
          focus: 'menu:' + a.id,
          ok: function (res) {
            var n = (res.removed || []).length, f = (res.failed || []).length;
            st().msg = removedText(n, a.name) +
              (n && backup ? ' Une sauvegarde est gardée.' : '') + (f ? ' ' + SA.pl(f, 'échec', 'échecs') + '.' : '');
          }
        });
      }
      var n = emptyDemo(a, backup);
      return done(removedText(n, a.name) + (n && backup ? ' Une sauvegarde est gardée.' : ''), 'menu:' + a.id);
    }
    if (c.kind === 'remove') {
      if (!a.custom) { refresh('menu:' + a.id); return Promise.resolve(false); }
      if (live()) {
        if (!okId(a.id)) return refuse(BAD_ID, 'menu:' + a.id);
        return run('DELETE', '/api/agents/custom/' + encodeURIComponent(a.id), undefined, {
          focus: 'q', ok: function () { st().msg = a.name + ' est retiré de la liste.'; }
        });
      }
      var s = SA.state;
      s.custom = (s.custom || []).filter(function (x) { return x.id !== a.id; });
      if (s.agents) delete s.agents[a.id];
      delete ag.hidden[a.id];
      return done(a.name + ' est retiré de la liste.', 'q');
    }
    refresh();
    return Promise.resolve(false);
  }

  function absolute(dir) {
    if (curOs() === 'win') return /^[A-Za-z]:[\\/]/.test(dir) || /^\\\\[^\\]/.test(dir);
    return dir.charAt(0) === '/';
  }
  /* Retourne le message d'erreur et le champ concerné, ou null. */
  function validate(name, dir) {
    if (!name) return ['Indiquez le nom de l’agent.', 'n'];
    if (name.length > 60) return ['Le nom doit faire 60 caractères au plus.', 'n'];
    if (/[\u0000-\u001f\u007f<>]/.test(name)) return ['Le nom contient un caractère non permis.', 'n'];
    var low = name.toLowerCase();
    if (all().some(function (a) { return a.name.toLowerCase() === low; })) return ['Un agent porte déjà ce nom. Choisissez-en un autre.', 'n'];
    if (!dir) return ['Indiquez le dossier où l’agent lit ses skills.', 'p'];
    if (/[\u0000-\u001f\u007f]/.test(dir)) return ['Le dossier contient un caractère non permis.', 'p'];
    if (!absolute(dir)) return ['Indiquez un chemin complet, par exemple ' + example() + '.', 'p'];
    if (dir.split(/[\\/]+/).indexOf('..') > -1) return ['Le chemin ne doit pas contenir « .. ».', 'p'];
    return null;
  }

  function add(name, dir) {
    var s = SA.state, ag = st();
    name = String(name == null ? '' : name).trim();
    dir = String(dir == null ? '' : dir).trim();
    s.agNew = true;
    ag.nv = name;
    ag.dv = dir;
    var bad = validate(name, dir);
    if (bad) {
      ag.err = bad[0];
      ag.errAt = bad[1];
      refresh(bad[1]);
      return Promise.resolve(false);
    }
    ag.err = '';
    ag.errAt = '';
    var msg = name + ' est ajouté. Il recevra les installations.';
    function closeForm() {
      var a = st();
      SA.state.agNew = false;
      a.nv = a.dv = a.err = a.errAt = '';
      a.msg = msg;
    }
    if (live()) {
      return run('POST', '/api/agents/custom', { name: name, dir: dir }, {
        focus: 'new', koFocus: 'p', ok: closeForm,
        ko: function (m) { var a = st(); a.err = m; a.errAt = 'p'; }
      }).then(function (res) {
        /* Le serveur n'ajoute pas l'agent aux cibles : on le fait ici, comme le promet le formulaire. */
        var id = res && res.agent ? String(res.agent.id || '') : '', a = id ? find(id) : null;
        if (!a || a.target) return res;
        return sendTargets(id, true, {
          focus: 'new', msg: msg,
          ko: function (m) { st().fail = name + ' est ajouté, mais ne reçoit pas encore les installations. ' + m; }
        }).then(function () { return res; });
      });
    }
    var max = 0;
    (s.custom || []).forEach(function (c) { var m = /^c(\d+)$/.exec(c.id); if (m) max = Math.max(max, +m[1]); });
    var id = 'c' + (max + 1);
    s.custom = s.custom || [];
    s.custom.push({ id: id, name: name, st: 'ok', sig: ['man'], cmd: '', rel: '', abs: dir, custom: true });
    s.agents = s.agents || {};
    s.agents[id] = true;
    closeForm();
    if (SA.sync) SA.sync();
    refresh('new');
    return Promise.resolve(true);
  }

  function setQuery(q) { st().q = String(q == null ? '' : q); }
  function setFilter(f) {
    if (!FILTERS.some(function (x) { return x[0] === f; })) return;
    st().f = f;
    st().menu = null;
    refresh('data-ag-f:' + f);
  }
  function toggleOthers() {
    st().open = !st().open;
    refresh('others');
  }
  function toggleMenu(id) {
    var ag = st();
    ag.confirm = null;
    ag.menu = ag.menu === id ? null : id;
    if (ag.menu) {
      var a = find(id);
      refresh(a && a.hidden ? 'show:' + id : 'hide:' + id);
    } else refresh('menu:' + id);
  }

  /* ------------------------------------------------------------ démo : système et recherche animée */
  function resolveRow(r) {
    var els = r.querySelectorAll('.skl');
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove('skl');
      els[i].classList.add('ag-in');
    }
  }
  function setPressed(group, attr, value) {
    if (!group) return;
    var bs = group.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', String(bs[i].getAttribute(attr) === value));
  }
  function setStatus(root) {
    var status = root.querySelector('.ag-status');
    if (!status) return;
    status.textContent = scanned() ? summary() : 'Recherche des agents…';
    status.classList.toggle('is-busy', !scanned());
  }

  function runScan(root) {
    stopScan();
    var tok = scan.token;
    var os = SA.state.os;
    var status = root.querySelector('.ag-status');
    var rs = [].slice.call(root.querySelectorAll('.ag-list .ag-row'));
    if (scanned()) {
      rs.forEach(resolveRow);
      setStatus(root);
      return;
    }
    if (status) { status.textContent = 'Recherche des agents…'; status.classList.add('is-busy'); }
    function finish() {
      SA.state.scanned[os] = true;
      setStatus(root);
      SA.sync();
    }
    if (SA.rm) {
      rs.forEach(resolveRow);
      finish();
      return;
    }
    rs.forEach(function (r, i) {
      scan.timers.push(setTimeout(function () {
        if (tok !== scan.token || !r.isConnected) return;
        resolveRow(r);
      }, LEAD + i * STEP));
    });
    scan.timers.push(setTimeout(function () {
      if (tok !== scan.token || !root.isConnected || SA.state.os !== os || !(status && status.isConnected)) return;
      finish();
    }, LEAD + rs.length * STEP + 80));
  }

  function setOs(root, os) {
    if (live() || !SA.data.home[os] || SA.state.os === os) return;
    stopScan();
    SA.state.os = os;
    setPressed(root.querySelector('.ag-os'), 'data-os', os);
    setStatus(root);
    var pp = root.querySelector('.ag-proj-p');
    if (pp) pp.textContent = SA.projRoot();
    SA.sync();
    SA.swap(root.querySelector('.ag-region'), listHTML(), function () {
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

  /* Remet le focus là où il était avant le nouveau rendu. */
  function restoreFocus(root) {
    var ag = st(), k = ag.focus;
    if (!k) return;
    ag.focus = null;
    var el = null, all_ = root.querySelectorAll('[data-fk]');
    for (var i = 0; i < all_.length; i++) if (all_[i].getAttribute('data-fk') === k) { el = all_[i]; break; }
    if (!el || el.disabled) el = root.querySelector('#ag-q');
    if (el) try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  function updateRegion(root) {
    var region = root.querySelector('.ag-region');
    if (region) { region.innerHTML = listHTML(); runScan(root); }
  }

  function moveInMenu(e) {
    var menu = e.target.closest('.ag-menu');
    if (!menu) return false;
    var bs = [].slice.call(menu.querySelectorAll('button:not(:disabled)'));
    var i = bs.indexOf(e.target);
    if (i < 0 || !bs.length) return false;
    var j = e.key === 'ArrowDown' ? (i + 1) % bs.length : e.key === 'ArrowUp' ? (i - 1 + bs.length) % bs.length : e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : -1;
    if (j < 0) return false;
    bs[j].focus();
    return true;
  }

  /* ------------------------------------------------------------ vue */
  SA.views.agents = {
    render: function () {
      var s = SA.state, ag = st(), lv = live();
      var projet = s.scope === 'projet';
      var pending = !scanned();
      return '<div class="ag-mgr">' +
        '<p class="eye" data-st>Cette machine</p>' +
        SA.h1(lv ? 'Agents de cette machine' : 'Agents trouvés sur cette machine') +
        '<p class="lede" data-st>' + (lv
          ? 'Skill Advisor connaît ' + SA.pl(all().length, 'agent', 'agents') + '. Activez « Recevoir les installations » pour ceux qui doivent recevoir les skills.'
          : 'Quatre signaux sont examinés : dossier de configuration, commande, application installée, extension d’éditeur. Activez « Recevoir les installations » pour les agents qui doivent recevoir les skills.') + '</p>' +
        noneHTML() +
        '<div class="ag-tools" data-st>' +
          (lv
            ? '<p class="ag-sys"><span class="ag-lbl">Système</span><span class="mono">' + SA.esc(osLabel()) + '</span></p>'
            : '<span class="ag-lbl" aria-hidden="true">Aperçu du système</span><div class="ag-os">' + segHTML('Aperçu du système', OSES, s.os, 'data-os') + '</div>') +
        '</div>' +
        '<div class="ag-find" data-st>' +
          '<label class="vh" for="ag-q">Chercher un agent par nom ou identifiant</label>' +
          '<input id="ag-q" class="fld ag-q" type="search" autocomplete="off" spellcheck="false" placeholder="Chercher un agent" data-fk="q" value="' + SA.esc(ag.q) + '">' +
          '<div class="ag-f">' + segHTML('Filtrer les agents', FILTERS.map(function (f) { return [f[0], f[1] + ' <span class="ag-fn">' + fcount(f[0]) + '</span>']; }), ag.f, 'data-ag-f') + '</div>' +
        '</div>' +
        '<p class="ag-status mono' + (pending ? ' is-busy' : '') + '" role="status" data-st>' + (pending ? 'Recherche des agents…' : SA.esc(summary())) + '</p>' +
        '<p class="ag-msg" role="status">' + SA.esc(ag.msg || '') + '</p>' +
        '<p class="ag-alert" role="alert">' + SA.esc(ag.fail || '') + '</p>' +
        '<div class="ag-region">' + listHTML() + '</div>' +
        '<dl class="ag-legend" data-st>' + (lv
          ? '<div><dt>Détecté</dt><dd>L’agent est présent sur cette machine.</dd></div>' +
            '<div><dt>Non détecté</dt><dd>Aucun signal trouvé, rien ne sera écrit pour cet agent.</dd></div>' +
            '<div><dt>Masqué</dt><dd>L’agent ne figure plus dans la liste. Le filtre Masqués le montre.</dd></div>'
          : '<div><dt>Installé</dt><dd>L’agent est présent et son dossier de skills peut recevoir des fichiers.</dd></div>' +
            '<div><dt>Traces seulement</dt><dd>Un dossier de configuration subsiste, mais l’agent ne semble plus installé.</dd></div>' +
            '<div><dt>Non détecté</dt><dd>Aucun signal trouvé, rien ne sera écrit pour cet agent.</dd></div>') +
        '</dl>' +
        '<section class="ag-new" data-st aria-labelledby="ag-new-t">' +
          '<h2 class="h2" id="ag-new-t">Un agent manque ?</h2>' + formHTML() +
        '</section>' +
        '<section class="ag-scope" aria-labelledby="ag-scope-t" data-st>' +
          '<h2 class="h2" id="ag-scope-t">Portée de l’installation</h2>' +
          '<div class="ag-scope-seg">' + segHTML('Portée de l’installation', [['global', 'Tous les projets'], ['projet', 'Ce projet seulement']], s.scope, 'data-scope') + '</div>' +
          '<div class="fold ag-proj-fold' + (projet ? ' open' : '') + '">' +
            '<div class="fold-in"' + (projet ? '' : ' inert') + '>' +
              '<p class="ag-proj"><span class="ag-proj-l">Projet</span><span class="ag-proj-p mono">' + SA.esc(SA.projRoot()) + '</span></p>' +
            '</div>' +
          '</div>' +
        '</section>' +
      '</div>';
    },
    mount: function (root) {
      runScan(root);
      restoreFocus(root);
      root.addEventListener('click', function (e) {
        var t = e.target, b;
        if (!t || !t.closest) return;
        var os = t.closest('[data-os]');
        if (os && root.contains(os)) { setOs(root, os.getAttribute('data-os')); return; }
        var sc = t.closest('[data-scope]');
        if (sc && root.contains(sc)) { setScope(root, sc.getAttribute('data-scope')); return; }
        if ((b = t.closest('[data-ag-f]'))) { setFilter(b.getAttribute('data-ag-f')); return; }
        var sw = t.closest('.ag-row .sw');
        if (sw && root.contains(sw)) {
          if (sw.disabled) return;
          var li = sw.closest('.ag-row');
          target(li.getAttribute('data-id'), sw.getAttribute('aria-checked') !== 'true');
          return;
        }
        if ((b = t.closest('[data-ag-menu]'))) { toggleMenu(b.getAttribute('data-ag-menu')); return; }
        if ((b = t.closest('[data-ag-hide]'))) { setHidden(b.getAttribute('data-ag-hide'), true); return; }
        if ((b = t.closest('[data-ag-show]'))) { setHidden(b.getAttribute('data-ag-show'), false); return; }
        if ((b = t.closest('[data-ag-empty]'))) { if (!b.disabled) askEmpty(b.getAttribute('data-ag-empty')); return; }
        if ((b = t.closest('[data-ag-remove]'))) { askRemove(b.getAttribute('data-ag-remove')); return; }
        if (t.closest('[data-ag-ok]')) { confirm(); return; }
        if (t.closest('[data-ag-no]')) { cancel(); return; }
        if (t.closest('[data-ag-others]')) { toggleOthers(); return; }
        if (t.closest('[data-ag-new]')) { SA.state.agNew = true; refresh('n'); return; }
        if (t.closest('[data-ag-cancel]')) { var ag = st(); SA.state.agNew = false; ag.err = ag.errAt = ag.nv = ag.dv = ''; refresh('new'); return; }
        if (t.closest('[data-ag-add]')) { submit(); return; }
        if (t.closest('[data-ag-rescan]')) { stopScan(); SA.state.scanned = {}; SA.repaint(); }
      });
      function submit() {
        var n = root.querySelector('#ag-new-n'), p = root.querySelector('#ag-new-p');
        add(n ? n.value : '', p ? p.value : '');
      }
      root.addEventListener('input', function (e) {
        var t = e.target;
        if (t && t.id === 'ag-q') { setQuery(t.value); updateRegion(root); return; }
        if (t && t.id === 'ag-new-n') st().nv = t.value;
        if (t && t.id === 'ag-new-p') st().dv = t.value;
      });
      root.addEventListener('change', function (e) {
        var t = e.target;
        if (t && t.hasAttribute && t.hasAttribute('data-ag-backup')) setBackup(t.checked);
      });
      root.addEventListener('keydown', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (e.key === 'Enter' && (t.id === 'ag-new-n' || t.id === 'ag-new-p')) { e.preventDefault(); submit(); return; }
        if (e.key === 'Escape') {
          var ag = st();
          if (ag.confirm) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
          if (ag.menu) { e.preventDefault(); e.stopPropagation(); toggleMenu(ag.menu); return; }
        }
        if (/^(ArrowDown|ArrowUp|Home|End)$/.test(e.key) && moveInMenu(e)) e.preventDefault();
      });
    },
    actions: function () {
      var n = SA.cart.count();
      if (!n) return [];
      return [{ label: 'Installer ' + SA.pl(n, 'skill', 'skills'), kind: 'primary', kbd: '↵', disabled: SA.agentsOn().length === 0, on: function () { SA.go(4, 1); } }];
    },
    keys: function () { return false; },
    /* Actions sans DOM, pour les essais et pour les autres écrans. */
    _do: {
      list: list, visible: visible, setQuery: setQuery, setFilter: setFilter, toggleOthers: toggleOthers,
      target: target, hide: function (id) { return setHidden(id, true); }, show: function (id) { return setHidden(id, false); },
      askEmpty: askEmpty, askRemove: askRemove, setBackup: setBackup, confirm: confirm, cancel: cancel,
      add: add, removeCustom: function (id) { askRemove(id); return confirm(); }, validate: validate
    }
  };
})();
