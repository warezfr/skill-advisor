/* Skill Advisor · sauvegarde de toute la configuration (écran Sauvegardes) : skills, serveurs MCP, plugins, réglages.
   Deux tiroirs : « Sauvegarder toute la configuration » (parties, valeurs secrètes) et « Restaurer la configuration »
   (aperçu de ce qui sera fait, parties, Passer ou Remplacer, puis réinstallation des plugins un par un).
   Mode démo : en mémoire. Mode réel : routes /api/config/*. Toute valeur venue de la machine est échappée. */
(function () {
  'use strict';
  var SA = window.SA = window.SA || {};
  var esc = function (s) { return SA.esc(s); };
  var PARTS = [
    { id: 'skills', t: 'Skills', d: 'Copie de chaque skill, à chacune de ses places, désactivés compris.' },
    { id: 'mcp', t: 'Serveurs MCP', d: 'Réglages de chaque serveur, agent par agent.' },
    { id: 'plugins', t: 'Plugins', d: 'Une recette pour les réinstaller : place de marché, source, état. Pas leurs fichiers.' },
    { id: 'settings', t: 'Réglages de Skill Advisor', d: 'Agents ajoutés à la main, agents masqués, agents qui reçoivent les installations.' }
  ];
  var AGENT_NAME = { 'claude-code': 'Claude Code', codex: 'Codex', 'gemini-cli': 'Gemini CLI', 'github-copilot': 'GitHub Copilot CLI', antigravity: 'Antigravity' };
  var LOCAL = 'Cette action demande l’application locale : lancez Skill Advisor sur votre machine. La machine d’exemple ne lit ni n’écrit aucun fichier.';

  function live() { return !!(SA.live && SA.live.on); }
  function cs() {
    var s = SA.state;
    if (!s.cfg || typeof s.cfg !== 'object') s.cfg = { mode: '', id: null, parts: {}, secrets: false, conflict: 'skip', force: {}, pre: null, res: null, plug: {}, busy: '', err: '' };
    return s.cfg;
  }
  function errText(e) { return e && e.code && e.message ? e.message : 'Le serveur local n’a pas répondu.'; }
  function box(attr, value, on, text) {
    return '<label class="ckl"><button type="button" class="cb" role="checkbox" aria-checked="' + !!on + '" ' + attr + '="' + esc(value) + '">' + SA.icon('check') + '</button>' + text + '</label>';
  }
  function find(id) {
    var l = (SA.state.backups || []).map(SA.normBackup).filter(function (b) { return b.id === id; });
    return l[0] || null;
  }
  function count(o, k) { return o && typeof o[k] === 'number' ? o[k] : 0; }

  /* Résumé d'une sauvegarde complète, pour sa ligne : « 12 skills · 3 serveurs MCP · 5 plugins · réglages ». */
  function summary(b) {
    var p = b.parts || {}, out = [];
    if (p.skills) out.push(SA.pl(count(p.skills, 'count'), 'skill', 'skills'));
    if (p.mcp) out.push(SA.pl(count(p.mcp, 'count'), 'serveur MCP', 'serveurs MCP'));
    if (p.plugins) out.push(SA.pl(count(p.plugins, 'count'), 'plugin', 'plugins') + (count(p.plugins, 'manual') ? ', dont ' + count(p.plugins, 'manual') + ' à réinstaller à la main' : ''));
    if (p.settings) out.push('réglages de Skill Advisor');
    return out;
  }

  /* ------------------------------------------------------------ sauvegarder */
  function openCreate() {
    var c = cs();
    if (c.busy) return;
    c.mode = 'create'; c.id = null; c.err = ''; c.res = null; c.secrets = false;
    c.parts = { skills: true, mcp: true, plugins: true, settings: true };
    paint();
  }
  function createHTML() {
    var c = cs();
    return '<div class="dt sv-ap cfg"><p class="sub">Une seule sauvegarde de tout ce que vos agents utilisent dans votre dossier personnel. Exportez-la pour la restaurer sur une autre machine.</p>' +
      '<section class="dt-sec"><h3 class="h2">Parties</h3><ul class="sv-cks">' + PARTS.map(function (p) {
        return '<li>' + box('data-cfg-part', p.id, c.parts[p.id] === true, '<span>' + esc(p.t) + '</span>') + '<p class="mut sv-hint">' + esc(p.d) + '</p></li>';
      }).join('') + '</ul></section>' +
      '<section class="dt-sec"><h3 class="h2">Valeurs secrètes</h3>' +
        box('data-cfg-secrets', '1', c.secrets, '<span>Inclure les valeurs secrètes des serveurs MCP</span>') +
        '<p class="mut sv-hint">Sans cette case, les clés et jetons deviennent des variables (${NOM}) : la sauvegarde peut circuler sans les dévoiler. Vous les redéfinirez après la restauration.</p></section>' +
      (c.err ? '<div class="note note-bad" role="alert" id="cfg-err" tabindex="-1"><p class="sub">' + esc(c.err) + '</p></div>' : '') +
      '<p class="dt-cta"><button type="button" class="btn primary" data-cfg-create-go' + (c.busy ? ' disabled' : '') + '>' + (c.busy ? 'Sauvegarde en cours…' : 'Sauvegarder') + '</button>' +
      '<button type="button" class="btn" data-cfg-close' + (c.busy ? ' disabled' : '') + '>Annuler</button></p></div>';
  }
  function demoCreate(parts) {
    var mine = SA.state.mine || [], mcp = (SA.data && SA.data.mcp && SA.data.mcp.servers) || [], pl = (SA.data && SA.data.plugins && SA.data.plugins.plugins) || [];
    var d = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    var sk = mine.filter(function (r) { return r.kind !== 'plugin'; });
    var b = { id: stamp + '-configuration', kind: 'config', label: 'Configuration complète du ' + p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear(),
      note: '', origin: 'manual', at: d.toISOString(), size: sk.length * 6000 + 4000, items: [], parts: {} };
    if (parts.skills) b.parts.skills = { count: sk.length, names: sk.map(function (r) { return r.name; }) };
    if (parts.mcp) b.parts.mcp = { count: mcp.filter(function (s) { return s.scope !== 'project'; }).length, secrets: 'vars', vars: [] };
    if (parts.plugins) b.parts.plugins = { count: pl.length, auto: pl.length, manual: 0, hooks: 0 };
    if (parts.settings) b.parts.settings = { custom: 0, hidden: 0, targets: 0 };
    SA.state.backups = [b].concat(SA.state.backups || []);
    return { backup: b, failed: [] };
  }
  function submitCreate() {
    var c = cs(), parts = PARTS.map(function (p) { return p.id; }).filter(function (k) { return c.parts[k] === true; });
    if (c.busy) return Promise.resolve(false);
    if (!parts.length) { c.err = 'Choisissez au moins une partie.'; paint('cfg-err'); return Promise.resolve(false); }
    c.busy = 'create'; c.err = ''; paint();
    var go = live() ? SA.live.call('POST', '/api/config/create', { parts: parts, secrets: !!c.secrets })
      : Promise.resolve(demoCreate(c.parts));
    return go.then(function (res) {
      c.busy = '';
      var b = res && res.backup ? SA.normBackup(res.backup) : null;
      var f = Array.isArray(res && res.failed) ? res.failed : [];
      c.mode = ''; SA.closeDrawer();
      if (SA.backup && SA.backup.say) SA.backup.say('Sauvegarde créée' + (b ? ' : ' + b.label + ' (' + summary(b).join(', ') + ')' : '') + '.' +
        (f.length ? ' ' + SA.pl(f.length, 'élément n’a', 'éléments n’ont') + ' pas pu être lu : ' + f.map(function (x) { return x.name; }).join(', ') + '.' : ''));
      return true;
    }, function (e) { c.busy = ''; c.err = errText(e); paint('cfg-err'); return false; });
  }

  /* ------------------------------------------------------------ restaurer */
  function openRestore(id) {
    var c = cs(), b = find(id);
    if (!b || c.busy) return Promise.resolve(false);
    c.mode = 'restore'; c.id = b.id; c.err = ''; c.res = null; c.pre = null; c.plug = {}; c.conflict = 'skip'; c.force = {};
    c.parts = {};
    PARTS.forEach(function (p) { if (b.parts && b.parts[p.id]) c.parts[p.id] = true; });
    c.busy = 'preview';
    paint();
    var go = live() ? SA.live.call('POST', '/api/config/preview', { id: b.id }) : Promise.resolve(demoPreview(b));
    return go.then(function (pre) { c.busy = ''; c.pre = pre || {}; paint(); return true; }, function (e) { c.busy = ''; c.err = errText(e); paint('cfg-err'); return false; });
  }
  function demoPreview(b) {
    var p = b.parts || {};
    return {
      skills: p.skills ? (p.skills.names || []).map(function (n) { return { name: n, verdict: null, status: 'exists' }; }) : null,
      mcp: p.mcp ? { items: [], secrets: 'vars', vars: [] } : null,
      plugins: p.plugins ? [] : null,
      settings: p.settings ? { custom: [], hidden: 0, targets: 0 } : null
    };
  }
  function tally(l, k) { var o = {}; (l || []).forEach(function (x) { o[x[k]] = (o[x[k]] || 0) + 1; }); return o; }
  function partLine(id) {
    var pre = cs().pre || {};
    if (id === 'skills' && pre.skills) {
      var t = tally(pre.skills, 'status');
      return [t.new ? SA.pl(t.new, 'nouveau', 'nouveaux') : '', t.exists ? SA.pl(t.exists, 'déjà présent', 'déjà présents') : '', t.absent ? SA.pl(t.absent, 'sans agent', 'sans agent') + ' sur cette machine' : ''].filter(Boolean).join(' · ') || 'Aucun skill.';
    }
    if (id === 'mcp' && pre.mcp) {
      var m = tally(pre.mcp.items, 'status');
      return [m.new ? SA.pl(m.new, 'réglage à écrire', 'réglages à écrire') : '', m.exists ? SA.pl(m.exists, 'réglage déjà présent', 'réglages déjà présents') : '', m.absent ? SA.pl(m.absent, 'agent absent', 'agents absents') + ' de cette machine' : ''].filter(Boolean).join(' · ') || 'Aucun serveur.';
    }
    if (id === 'plugins' && pre.plugins) {
      var q = tally(pre.plugins, 'status');
      return [q.auto ? q.auto + ' à réinstaller' : '', q.installed ? SA.pl(q.installed, 'déjà installé', 'déjà installés') : '', q.manual ? q.manual + ' à faire à la main' : '', q['no-cli'] ? q['no-cli'] + ' sans la commande de leur agent' : ''].filter(Boolean).join(' · ') || 'Aucun plugin.';
    }
    if (id === 'settings' && pre.settings) {
      var s = pre.settings;
      return [s.custom.length ? SA.pl(s.custom.length, 'agent ajouté à la main', 'agents ajoutés à la main') : '', s.hidden ? SA.pl(s.hidden, 'agent masqué', 'agents masqués') : '', s.targets ? SA.pl(s.targets, 'agent cible', 'agents cibles') : ''].filter(Boolean).join(' · ') || 'Réglages par défaut.';
    }
    return '';
  }
  function restoreFormHTML(b) {
    var c = cs(), pre = c.pre || {};
    var red = (pre.skills || []).filter(function (x) { return x.verdict === 'rouge'; });
    var srcs = (pre.plugins || []).filter(function (x) { return x.status === 'auto' && x.repo; });
    var hooks = (pre.plugins || []).filter(function (x) { return x.hooks && x.hooks.length; });
    /* Tout ce qui sera écrit : réglages nouveaux, et ceux qu'un remplacement écraserait. */
    var runs = pre.mcp ? pre.mcp.items.filter(function (x) { return x.status === 'new' || x.status === 'exists'; }) : [];
    var custom = pre.settings && Array.isArray(pre.settings.custom) ? pre.settings.custom : [];
    var vars = pre.mcp && pre.mcp.secrets === 'vars' ? pre.mcp.vars || [] : [];
    return '<section class="dt-sec"><h3 class="h2">Ce qui sera restauré</h3><ul class="sv-cks">' + PARTS.filter(function (p) { return b.parts && b.parts[p.id]; }).map(function (p) {
        return '<li>' + box('data-cfg-part', p.id, c.parts[p.id] === true, '<span>' + esc(p.t) + '</span>') + '<p class="mut sv-hint">' + esc(partLine(p.id)) + '</p></li>';
      }).join('') + '</ul>' +
      '<p class="mut sv-hint">Les emplacements sont ceux de cette machine. Un agent absent est passé et signalé ; aucun dossier n’est créé pour lui.</p></section>' +
      (red.length ? '<section class="dt-sec"><h3 class="h2">Skills avec un motif à risque</h3><ul class="sv-cks">' + red.map(function (x) {
        return '<li>' + box('data-cfg-force', x.name, c.force[x.name] === true, '<span class="mono">' + esc(x.name) + '</span> : restaurer malgré l’avertissement') + '</li>';
      }).join('') + '</ul></section>' : '') +
      (runs.length || srcs.length || hooks.length || custom.length ? '<div class="note note-warn sv-warns"><p class="note-t">À vérifier avant de restaurer</p><ul class="sv-wl">' +
        runs.map(function (x) {
          return '<li><span class="mono">' + esc(x.name) + '</span> (' + esc(AGENT_NAME[x.agent] || x.agent) + (x.status === 'exists' ? ', remplace le réglage présent si vous choisissez Remplacer' : '') + ') lancera <span class="mono">' + esc(x.runs) + '</span>' +
            (x.long ? ' <strong>… commande coupée : plus de 2 000 caractères, regardez-la dans l’archive</strong>' : '') +
            (x.env && x.env.length ? ' ; variables et en-têtes : <span class="mono">' + esc(x.env.join(', ')) + '</span>' : '') + '</li>';
        }).join('') +
        srcs.map(function (x) { return '<li>Plugin <span class="mono">' + esc(x.name) + '</span> : ' + (x.market ? 'place de marché <span class="mono">' + esc(x.market) + '</span> prise sur ' : 'source ') + 'github.com/' + esc(x.repo) + '</li>'; }).join('') +
        custom.filter(function (x) { return x.status === 'new'; }).map(function (x) { return '<li>Agent ajouté à la main <strong>' + esc(x.name) + '</strong> : dossier <span class="mono">' + esc(x.dir) + '</span></li>'; }).join('') +
        hooks.map(function (x) { return '<li>Plugin <span class="mono">' + esc(x.name) + '</span> : hooks ' + esc(x.hooks.join(', ')) + ', des commandes lancées sans que vous les appeliez</li>'; }).join('') +
        '</ul></div>' : '') +
      (vars.length ? '<p class="mut sv-hint">Variables à définir après la restauration : <span class="mono">' + esc(vars.join(', ')) + '</span>.</p>' : '') +
      '<section class="dt-sec"><h3 class="h2" id="cfg-cf-t">Si un élément existe déjà</h3>' +
        '<div class="seg sv-seg" role="group" aria-labelledby="cfg-cf-t">' +
          '<button type="button" data-cfg-conflict="skip" aria-pressed="' + (c.conflict === 'skip') + '">Passer</button>' +
          '<button type="button" data-cfg-conflict="replace" aria-pressed="' + (c.conflict === 'replace') + '">Remplacer</button></div>' +
        '<p class="mut sv-hint">Passer : la version présente reste. Remplacer : Skill Advisor sauvegarde d’abord ce qu’il remplace (une sauvegarde par partie).</p></section>' +
      (c.err ? '<div class="note note-bad" role="alert" id="cfg-err" tabindex="-1"><p class="sub">' + esc(c.err) + '</p></div>' : '') +
      '<p class="dt-cta"><button type="button" class="btn primary" data-cfg-restore-go' + (c.busy ? ' disabled' : '') + '>' + (c.busy === 'restore' ? 'Restauration en cours…' : 'Restaurer') + '</button>' +
      '<button type="button" class="btn" data-cfg-close' + (c.busy ? ' disabled' : '') + '>Annuler</button></p>';
  }
  function submitRestore() {
    var c = cs(), b = find(c.id);
    if (!b || c.busy) return Promise.resolve(false);
    var parts = PARTS.map(function (p) { return p.id; }).filter(function (k) { return c.parts[k] === true; });
    if (!parts.length) { c.err = 'Choisissez au moins une partie.'; paint('cfg-err'); return Promise.resolve(false); }
    var force = Object.keys(c.force).filter(function (k) { return c.force[k] === true; });
    c.busy = 'restore'; c.err = ''; paint();
    var body = { id: b.id, parts: parts, conflict: c.conflict };
    if (force.length) body.force = force;
    var go = live() ? SA.live.call('POST', '/api/config/restore', body) : Promise.resolve(demoRestore(c.pre, parts));
    return go.then(function (res) { c.busy = ''; c.res = res || {}; paint('cfg-res'); return true; }, function (e) { c.busy = ''; c.err = errText(e); paint('cfg-err'); return false; });
  }
  function demoRestore(pre, parts) {
    var has = function (k) { return parts.indexOf(k) > -1; };
    return {
      settings: has('settings') ? { added: [], same: [], skipped: [], hidden: 0, targets: 0 } : null,
      skills: has('skills') ? { restored: [], skipped: (pre.skills || []).map(function (x) { return { name: x.name, reason: 'Déjà installé sur cette machine.' }; }), held: [], failed: [] } : null,
      mcp: has('mcp') ? { applied: [], skipped: [], failed: [] } : null,
      plugins: has('plugins') ? pre.plugins || [] : null, backups: [], warnings: []
    };
  }
  function li(l) { return '<ul class="ledger sv-res">' + l.join('') + '</ul>'; }
  function line(name, k, t) {
    var mark = { ok: '<span class="bdg ok">Restauré</span>', no: '<span class="bdg no">Passé</span>', bad: '<span class="bdg bad">Échec</span>', held: '<span class="bdg bad">Retenu</span>' }[k];
    return '<li><span class="mono">' + esc(name) + '</span>' + mark + (t ? '<span class="mut"> ' + esc(t) + '</span>' : '') + '</li>';
  }
  function plugHTML(p) {
    var c = cs(), done = c.plug[p.index], who = AGENT_NAME[p.agent] || p.agent || '';
    var right;
    if (done && done.busy) right = '<span class="mut">Réinstallation…</span>';
    else if (done && done.status === 'installed') right = '<span class="bdg ok">Réinstallé</span>' + (done.message ? '<span class="mut"> ' + esc(done.message) + '</span>' : '');
    else if (done && done.err) right = '<span class="bdg bad">Échec</span><span class="mut"> ' + esc(done.err) + '</span>';
    else if (done && done.message) right = '<span class="bdg no">Passé</span><span class="mut"> ' + esc(done.message) + '</span>';
    else if (p.status === 'installed') right = '<span class="bdg no">Déjà installé</span>';
    else if (p.status === 'auto') right = '<button type="button" class="btn quiet" data-cfg-plug="' + Number(p.index) + '"' + (c.busy ? ' disabled' : '') + '>Réinstaller</button>';
    else if (p.status === 'no-cli') right = '<span class="bdg tr">Commande de l’agent introuvable</span>';
    else right = '<span class="bdg tr">À faire à la main</span>' + (p.why ? '<span class="mut"> ' + esc(p.why) + '</span>' : '');
    return '<li><span class="mono">' + esc(p.name || '?') + '</span><span class="mut">' + esc(who) + (p.repo ? ' · github.com/' + esc(p.repo) : '') + '</span><span class="cfg-st">' + right + '</span></li>';
  }
  function resultHTML() {
    var c = cs(), r = c.res, out = [];
    if (r.settings) {
      var s = r.settings, l = [];
      (s.added || []).forEach(function (n) { l.push(line(n, 'ok', 'agent ajouté à la main')); });
      (s.same || []).forEach(function (n) { l.push(line(n, 'no', 'déjà présent')); });
      (s.skipped || []).forEach(function (x) { l.push(line(x.name, 'bad', x.reason)); });
      var more = [s.hidden ? SA.pl(s.hidden, 'agent masqué ajouté', 'agents masqués ajoutés') : '', s.targets ? SA.pl(s.targets, 'agent cible repris', 'agents cibles repris') : ''].filter(Boolean);
      out.push('<h4 class="sv-gh">Réglages</h4>' + (l.length ? li(l) : '') + '<p class="sub">' + (more.length ? more.join(', ') + '.' : l.length ? '' : 'Rien à changer.') + '</p>');
    }
    if (r.skills) {
      var k = r.skills, ls = [];
      k.restored.forEach(function (n) { ls.push(line(n, 'ok', '')); });
      k.held.forEach(function (n) { ls.push(line(n, 'held', 'motif à risque, non forcé')); });
      k.skipped.forEach(function (x) { ls.push(line(x.name, 'no', x.reason)); });
      k.failed.forEach(function (x) { ls.push(line(x.name, 'bad', x.message)); });
      out.push('<h4 class="sv-gh">Skills</h4><p class="sub">' + SA.pl(k.restored.length, 'skill restauré', 'skills restaurés') + ', ' + SA.pl(k.skipped.length, 'passé', 'passés') + ', ' + SA.pl(k.failed.length + k.held.length, 'non restauré', 'non restaurés') + '.</p>' + (ls.length ? li(ls) : ''));
    }
    if (r.mcp) {
      var m = r.mcp, lm = [];
      var an = function (id) { return AGENT_NAME[id] || (SA.agents ? ((SA.agents().filter(function (a) { return a.id === id; })[0] || {}).name || id) : id); };
      m.applied.forEach(function (x) { lm.push(line(x.name, 'ok', an(x.agent) + (x.off ? ', désactivé' : ''))); });
      m.skipped.forEach(function (x) { lm.push(line(x.name, 'no', (x.agent ? an(x.agent) + ' : ' : '') + x.reason)); });
      m.failed.forEach(function (x) { lm.push(line(x.name, 'bad', (x.agent ? an(x.agent) + ' : ' : '') + x.message)); });
      out.push('<h4 class="sv-gh">Serveurs MCP</h4>' + (lm.length ? li(lm) : '<p class="sub">Aucun serveur.</p>'));
    }
    if (r.plugins) {
      /* Un clic par plugin : chaque clic vaut accord pour la source affichée (Gemini CLI ne redemande pas). */
      out.push('<h4 class="sv-gh">Plugins</h4>' + (r.plugins.length ? '<p class="sub">Chaque plugin se réinstalle par la commande de son agent, depuis la source indiquée, avec ses hooks. Cliquez « Réinstaller » seulement pour une source en laquelle vous avez confiance : l’agent ne vous redemandera pas.</p>' + li(r.plugins.map(plugHTML)) : '<p class="sub">Aucun plugin.</p>'));
    }
    var warns = (r.warnings || []).filter(function (w) { return typeof w === 'string' && w; });
    if (warns.length) out.push('<div class="note note-warn sv-warns"><p class="note-t">À relire</p><ul class="sv-wl">' + warns.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>');
    var nb = (r.backups || []).length;
    if (nb) out.push('<p class="sub">Skill Advisor a sauvegardé ce qu’il a remplacé : ' + SA.pl(nb, 'sauvegarde', 'sauvegardes') + ' « avant remplacement » dans la liste.</p>');
    return '<section class="dt-sec"><h3 class="h2" id="cfg-res" tabindex="-1">Résultat</h3>' + out.join('') + '</section>' +
      '<p class="dt-cta"><button type="button" class="btn primary" data-cfg-close' + (c.busy ? ' disabled' : '') + '>Fermer</button></p>';
  }
  function reinstall(index) {
    var c = cs(), b = find(c.id);
    if (!b || c.busy) return Promise.resolve(false);
    if (!live()) { c.plug[index] = { err: LOCAL }; paint(); return Promise.resolve(false); }
    c.busy = 'plugin'; c.plug[index] = { busy: true }; paint();
    return SA.live.call('POST', '/api/config/plugin', { id: b.id, index: index }).then(function (res) {
      c.busy = ''; c.plug[index] = { status: res && res.status, message: res && typeof res.message === 'string' ? res.message : '' }; paint(); return true;
    }, function (e) { c.busy = ''; c.plug[index] = { err: errText(e) }; paint(); return false; });
  }

  /* ------------------------------------------------------------ tiroir */
  function drawerHTML() {
    var c = cs();
    if (c.mode === 'create') return createHTML();
    var b = find(c.id);
    if (!b) return '<p class="sub">Cette sauvegarde n’existe plus.</p>';
    return '<div class="dt sv-ap cfg"><p class="eye">Sauvegarde</p><p class="dt-name">' + esc(b.label) + '</p>' +
      '<p class="dt-src mut">' + esc(summary(b).join(' · ')) + '</p>' +
      (c.res ? resultHTML() : c.busy === 'preview' ? '<p class="sub" role="status">Lecture de ce que la restauration fera…</p>' : c.pre ? restoreFormHTML(b)
        : (c.err ? '<div class="note note-bad" role="alert" id="cfg-err" tabindex="-1"><p class="sub">' + esc(c.err) + '</p></div>' : '')) + '</div>';
  }
  function paint(focusId) {
    var c = cs();
    if (!c.mode || !SA.openDrawer) return;
    /* Même tiroir redessiné (plugin réinstallé, case cochée) : le défilement reste où il était. */
    var body = !focusId && SA.drawerOpen && document.getElementById ? document.getElementById('drawer-body') : null, top = body ? body.scrollTop : 0;
    SA.openDrawer(drawerHTML(), c.mode === 'create' ? 'Sauvegarder toute la configuration' : 'Restaurer la configuration', 'cfg');
    if (body && top) body.scrollTop = top;
    var el = focusId && document.getElementById ? document.getElementById(focusId) : null;
    if (el && el.focus) try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }
  function reset() { var c = cs(); c.mode = ''; c.id = null; c.pre = null; c.res = null; c.plug = {}; }
  function close() {
    var c = cs();
    if (c.busy) return;
    var had = c.res;
    reset();
    SA.closeDrawer();
    if (had && SA.repaint) SA.repaint();
  }

  var bound = false;
  function bind() {
    if (bound || !document.addEventListener) return;
    bound = true;
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null, b;
      if (!t) return;
      if ((b = t.closest('[data-cfg-open]')) && !b.disabled) { openCreate(); return; }
      if ((b = t.closest('[data-cfg-restore]')) && !b.disabled) { openRestore(b.getAttribute('data-cfg-restore')); return; }
      var c = cs();
      if (!c.mode) return;
      if (t.closest('#drawer-close') || t.closest('#scrim')) { if (!c.busy) reset(); return; }
      if (c.busy) return;
      if (t.closest('[data-cfg-close]')) { close(); return; }
      if (t.closest('[data-cfg-create-go]')) { submitCreate(); return; }
      if (t.closest('[data-cfg-restore-go]')) { submitRestore(); return; }
      if ((b = t.closest('[data-cfg-plug]'))) { reinstall(Number(b.getAttribute('data-cfg-plug'))); return; }
      if ((b = t.closest('[data-cfg-part]'))) { var on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(on)); c.parts[b.getAttribute('data-cfg-part')] = on; return; }
      if ((b = t.closest('[data-cfg-secrets]'))) { c.secrets = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(c.secrets)); return; }
      if ((b = t.closest('[data-cfg-force]'))) { var f = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(f)); c.force[b.getAttribute('data-cfg-force')] = f; return; }
      if ((b = t.closest('[data-cfg-conflict]'))) {
        c.conflict = b.getAttribute('data-cfg-conflict') === 'replace' ? 'replace' : 'skip';
        var g = b.closest('.seg'), bs = g && g.querySelectorAll ? g.querySelectorAll('[data-cfg-conflict]') : [];
        for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', String(bs[i] === b));
      }
    });
  }
  bind();

  SA.cfg = {
    summary: summary,
    /* Gestes sans DOM, pour les essais. */
    _do: { cs: cs, openCreate: openCreate, submitCreate: submitCreate, openRestore: openRestore, submitRestore: submitRestore, reinstall: reinstall, drawerHTML: drawerHTML, close: close }
  };
})();
