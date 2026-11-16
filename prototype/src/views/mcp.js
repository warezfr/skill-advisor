/* Skill Advisor · view mcp (route mcp) : serveurs MCP des agents.
   Liste des serveurs lus dans les réglages des agents (valeurs secrètes déjà masquées par le serveur local),
   recherche, filtres, désactiver, réactiver, sauvegarder (un, plusieurs), retirer avec sauvegarde au choix.
   Mode démo : la machine d'exemple, en mémoire. Mode réel : SA.live.call, qui remplace l'état, puis la vue se redessine. */
(function () {
  'use strict';
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  var FILTERS = [['tous', 'Tous'], ['actifs', 'Actifs'], ['off', 'Désactivés'], ['diff', 'Réglages différents']];
  var KIND = { stdio: 'Local', http: 'Distant · HTTP', sse: 'Distant · SSE' };

  /* ------------------------------------------------------------ état de l'écran */
  function st() {
    var s = SA.state;
    if (!s.mc || typeof s.mc !== 'object') s.mc = {};
    var m = s.mc;
    if (typeof m.q !== 'string') m.q = '';
    if (!FILTERS.some(function (f) { return f[0] === m.f; })) m.f = 'tous';
    if (!m.sel || typeof m.sel !== 'object') m.sel = {};
    return m;
  }
  function live() { return !!(SA.live && SA.live.on); }
  function data() { var d = (SA.data || {}).mcp; return d && Array.isArray(d.servers) ? d : { agents: [], servers: [] }; }
  function servers() { return data().servers; }
  function find(id) { return servers().filter(function (s) { return s.id === id; })[0] || null; }
  function entries(s) {
    var out = [];
    Object.keys(s.ag || {}).forEach(function (a) { (s.ag[a] || []).forEach(function (e) { out.push({ agent: a, e: e }); }); });
    return out;
  }
  function anyOn(s) { return entries(s).some(function (x) { return x.e.on; }); }
  function anyStash(s) { return entries(s).some(function (x) { return x.e.stash; }); }
  function agentName(id) {
    var a = (SA.agents ? SA.agents() : []).filter(function (x) { return x.id === id; })[0];
    if (a) return a.name;
    var m = (data().agents || []).filter(function (x) { return x.id === id; })[0];
    return m ? m.name : id;
  }
  function byName(a, b) { return a.localeCompare(b, 'fr', { sensitivity: 'base' }); }

  function keep(s) {
    var m = st(), q = m.q.trim().toLowerCase();
    if (m.f === 'actifs' && !anyOn(s)) return false;
    if (m.f === 'off' && anyOn(s)) return false;
    if (m.f === 'diff' && !s.differs) return false;
    if (!q) return true;
    var hay = [s.name, s.command || '', (s.args || []).join(' '), s.url || ''].concat(Object.keys(s.ag || {}).map(agentName)).join(' ').toLowerCase();
    return hay.indexOf(q) > -1;
  }
  function visible() { return servers().filter(keep); }
  function fcount(f) {
    var m = st(), was = m.f, q = m.q;
    m.f = f; m.q = '';
    var n = servers().filter(keep).length;
    m.f = was; m.q = q;
    return n;
  }
  function selected() { var sel = st().sel; return servers().filter(function (s) { return sel[s.id]; }); }

  /* ------------------------------------------------------------ catalogue */
  var VERDICT = { vert: 'Aucun motif connu', 'vert-remarques': 'Remarques', orange: 'À regarder', rouge: 'Motif à risque' };
  var PAGE = 30;
  /* Catalogue complet (mode réel, chargé à la demande) ou extrait embarqué (démo, et avant la réponse). */
  function catalog() {
    var m = st(), c = live() && m.catFull ? m.catFull : SA.mcpCatalog;
    return c && Array.isArray(c.servers) ? c : { servers: [], counts: {} };
  }
  function catLabel(id) {
    var c = ((SA.search || {}).cats || []).filter(function (x) { return x.id === id; })[0];
    return c ? c.label : id;
  }
  function shortName(e) { return String(e.id).split('/').pop(); }
  function installedNames() {
    var out = {};
    servers().forEach(function (s) { out[s.name] = true; });
    return out;
  }
  function catList() {
    var m = st(), q = (m.cq || '').trim().toLowerCase(), c = m.cc || '';
    return catalog().servers.filter(function (e) {
      if (c && (e.cats || []).indexOf(c) < 0) return false;
      if (!q) return true;
      return [e.id, e.title || '', e.description || ''].join(' ').toLowerCase().indexOf(q) > -1;
    }).sort(function (a, b) { return ((b.score || {}).total || 0) - ((a.score || {}).total || 0); });
  }
  function kfmt(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (Math.round(n / 1e5) / 10).toString().replace('.', ',') + ' M';
    if (n >= 1e3) return Math.round(n / 1e3) + ' k';
    return String(n);
  }
  function signals(e) {
    var out = [];
    if (e.stars) out.push(kfmt(e.stars) + ' étoiles');
    if (e.downloads) out.push(kfmt(e.downloads) + ' téléchargements par mois');
    if (e.docker) out.push('Catalogue Docker');
    if (e.verified === 'domain') out.push('Domaine de l’éditeur vérifié');
    return out.join(' · ');
  }
  function installLine(e) {
    var i = e.install || {};
    if (i.type === 'remote') return 'Distant : ' + (i.url || '');
    if (i.type === 'npm') return 'npx -y ' + i.id + '@' + i.version;
    if (i.type === 'pypi') return 'uvx ' + i.id + '@' + i.version;
    if (i.type === 'oci') return 'docker run ' + i.id + ':' + i.version;
    return '';
  }
  function needVars(e) {
    var i = e.install || {};
    return (i.env || []).concat(i.headers || []).filter(function (v) { return v && (v.required || v.secret); });
  }
  function risky(e) { return e.verdict === 'rouge' || (e.vulns || []).length > 0; }
  function targetAgents() {
    return (SA.agents ? SA.agents() : []).filter(function (a) { return live() ? (a.detected && !a.custom) : a.st !== 'no' && !a.custom; });
  }
  function instHTML(e) {
    var m = st(), p = m.inst, id = SA.esc(e.id), ags = targetAgents(), vars = needVars(e);
    var agentsBox = ags.length ? '<ul class="mc-cks">' + ags.map(function (a) {
      return '<li>' + box('data-mc-iag="' + SA.esc(a.id) + '"', !!p.agents[a.id], a.name, 'iag:' + a.id) + '</li>';
    }).join('') + '</ul>' : '<p class="mut">Aucun agent détecté.</p>';
    var varsBox = vars.length ? '<fieldset class="mc-vars"><legend>Variables</legend>' + vars.map(function (v) {
      var vid = 'mc-v-' + v.name.replace(/[^\w-]/g, '_');
      return '<p class="mc-var"><label for="' + vid + '"><span class="mono">' + SA.esc(v.name) + '</span>' + (v.description ? ' <span class="mut">' + SA.esc(v.description) + '</span>' : '') + '</label>' +
        '<input id="' + vid + '" class="fld" type="' + (v.secret ? 'password' : 'text') + '" autocomplete="off" spellcheck="false" data-mc-var="' + SA.esc(v.name) + '" value="' + SA.esc(p.values[v.name] || '') + '"></p>';
    }).join('') + '<p class="mut mc-hint">Laissez un champ vide : Skill Advisor écrit une référence (${NOM}) que vous définirez dans votre environnement. Une valeur saisie est écrite dans les réglages de l’agent, sur votre machine seulement.</p></fieldset>' : '';
    var hold = risky(e) ? '<div class="note note-warn"><p class="sub">' + (e.verdict === 'rouge' ? 'Le contrôle trouve un motif à risque dans sa description. ' : '') +
      ((e.vulns || []).length ? 'Faille connue pour cette version : ' + SA.esc(e.vulns.join(', ')) + '. ' : '') + 'Ne l’installez que si vous lui faites confiance.</p>' +
      '<p>' + box('data-mc-iforce', p.force, 'Installer malgré l’avertissement', 'iforce') + '</p></div>' : '';
    return '<div class="mc-inst" role="group" aria-label="Installer ' + SA.esc(shortName(e)) + '">' +
      '<p class="mc-gh">Agents</p>' + agentsBox + varsBox + hold +
      '<p>' + box('data-mc-irep', p.replace, 'Remplacer un serveur du même nom (sauvegardé d’abord)', 'irep') + '</p>' +
      '<p class="cfm-a"><button type="button" class="btn primary" data-mc-igo="' + id + '" data-fk="igo"' + (m.busy ? ' disabled' : '') + '>Installer</button>' +
      '<button type="button" class="btn quiet" data-mc-ino data-fk="ino">Annuler</button></p></div>';
  }
  function cardHTML(e, have) {
    var m = st(), id = SA.esc(e.id), sc = (e.score || {}).total, open = m.inst && m.inst.id === e.id;
    var sig = signals(e), v = VERDICT[e.verdict] || 'Contrôle non fait';
    return '<li class="mc-card" data-cid="' + id + '">' +
      '<p class="mc-l1"><span class="mc-n">' + SA.esc(e.title || shortName(e)) + '</span>' +
        '<span class="bdg mc-kind">' + ((e.install || {}).type === 'remote' ? 'Distant' : 'Local') + '</span>' +
        (sc != null ? '<span class="mc-score" aria-label="Note ' + sc + ' sur 100">' + sc + '<span class="mut">/100</span></span>' : '') +
        (have[shortName(e)] ? '<span class="bdg ok">Installé</span>' : '') + '</p>' +
      '<p class="mc-id mono">' + id + '</p>' +
      (e.description ? '<p class="mc-desc">' + SA.esc(e.description) + '</p>' : '') +
      (sig ? '<p class="mc-notes">' + SA.esc(sig) + '</p>' : '') +
      '<p class="mc-notes">Contrôle : ' + SA.esc(v) + ((e.vulns || []).length ? ' · faille connue' : '') + '</p>' +
      '<p class="mc-cmd mono">' + SA.esc(installLine(e)) + '</p>' +
      (open ? instHTML(e) : '<p><button type="button" class="btn" data-mc-inst="' + id + '" data-fk="inst:' + id + '">Installer…</button></p>') +
    '</li>';
  }
  function catHTML() {
    var m = st(), list = catList(), n = m.cn || PAGE, have = installedNames(), c = catalog();
    var cats = ((SA.search || {}).cats || []).map(function (x) { return '<option value="' + SA.esc(x.id) + '"' + (m.cc === x.id ? ' selected' : '') + '>' + SA.esc(x.label) + '</option>'; }).join('');
    var head = c.generatedAt ? 'Catalogue du ' + SA.esc(String(c.generatedAt).slice(0, 10).split('-').reverse().join('/')) + (c.sample ? ' · extrait des ' + c.servers.length + ' mieux notés' : ' · ' + c.servers.length + ' serveurs retenus sur ' + kfmt((c.counts || {}).registry) + ' du registre officiel') : 'Catalogue absent.';
    return '<p class="mc-notes" data-st>' + head + '. Note sur 100 : popularité 40, réputation 25, fraîcheur 15, sécurité 20. Une note verte veut dire « aucun motif connu », jamais « sans risque ».</p>' +
      (m.catLoading ? '<p class="mc-notes" role="status">Chargement du catalogue complet…</p>' : '') +
      '<div class="mc-tools" data-st>' +
        '<label class="vh" for="mc-cq">Chercher dans le catalogue</label>' +
        '<input id="mc-cq" class="fld mc-q" type="search" autocomplete="off" spellcheck="false" placeholder="Chercher un serveur : base de données, GitHub, navigateur…" data-fk="cq" value="' + SA.esc(m.cq || '') + '">' +
        '<label class="vh" for="mc-cc">Type de projet</label>' +
        '<select id="mc-cc" class="fld mc-cc" data-fk="cc"><option value="">Tous les types de projet</option>' + cats + '</select>' +
      '</div>' +
      '<div class="mc-cregion">' + (list.length ? '<ul class="mc-list">' + list.slice(0, n).map(function (e) { return cardHTML(e, have); }).join('') + '</ul>' +
        (list.length > n ? '<p><button type="button" class="btn quiet" data-mc-more data-fk="more">Afficher ' + Math.min(PAGE, list.length - n) + ' de plus</button></p>' : '')
        : '<p class="mc-empty">Aucun serveur ne correspond.</p>') + '</div>';
  }

  /* ------------------------------------------------------------ rendu */
  function launch(s) {
    if (s.kind !== 'stdio') return s.url || '';
    return [s.command || ''].concat(s.args || []).join(' ').trim();
  }
  function chips(s) {
    var list = Object.keys(s.ag || {}).map(function (a) {
      var es = s.ag[a] || [], on = es.some(function (e) { return e.on; }), stash = es.some(function (e) { return e.stash; });
      var state = on ? 'actif' : stash ? 'désactivé' : 'désactivé dans ses réglages';
      return { name: agentName(a), state: state, on: on };
    }).sort(function (x, y) { return byName(x.name, y.name); });
    return '<ul class="mc-ag" aria-label="Agents qui ont ce serveur">' + list.map(function (c) {
      return '<li class="mc-chip' + (c.on ? '' : ' is-off') + '"><span>' + SA.esc(c.name) + '</span><span class="mc-chip-s">' + SA.esc(c.state) + '</span></li>';
    }).join('') + '</ul>';
  }
  function notes(s) {
    var out = [];
    if (s.secrets) out.push(SA.pl(s.secrets, 'valeur secrète masquée', 'valeurs secrètes masquées'));
    if (s.differs) out.push('Réglages différents d’un agent à l’autre');
    return out.length ? '<p class="mc-notes">' + out.map(SA.esc).join(' · ') + '</p>' : '';
  }
  function box(attr, on, label, fk) {
    return '<label class="ckl"><button type="button" class="cb" role="checkbox" aria-checked="' + !!on + '" ' + attr + ' data-fk="' + fk + '">' + SA.icon('check') + '</button><span>' + SA.esc(label) + '</span></label>';
  }
  function menuHTML(s) {
    var id = SA.esc(s.id), m = st(), dis = m.busy ? ' disabled' : '';
    return '<div class="mc-menu" role="group" aria-label="Actions pour ' + SA.esc(s.name) + '">' +
      (anyOn(s) ? '<button type="button" class="btn quiet" data-mc-off="' + id + '" data-fk="off:' + id + '"' + dis + '>Désactiver</button>' : '') +
      (anyStash(s) ? '<button type="button" class="btn quiet" data-mc-on="' + id + '" data-fk="on:' + id + '"' + dis + '>Réactiver</button>' : '') +
      '<button type="button" class="btn quiet" data-mc-save="' + id + '" data-fk="save:' + id + '"' + dis + '>Sauvegarder</button>' +
      '<button type="button" class="btn quiet" data-mc-rm="' + id + '" data-fk="rm:' + id + '"' + dis + '>Retirer…</button>' +
    '</div>';
  }
  function confirmHTML(s, c) {
    var id = SA.esc(s.id), n = Object.keys(s.ag || {}).length;
    return '<div class="mc-cf cfm" role="group" aria-labelledby="mc-cf-t">' +
      '<p class="cfm-t" id="mc-cf-t">Retirer ' + SA.esc(s.name) + ' des réglages de ' + SA.pl(n, 'agent', 'agents') + ' ? Ils ne lanceront plus ce serveur.</p>' +
      '<p class="mc-cf-o">' + box('data-mc-keep', c.keep, 'Garder une sauvegarde', 'keep') + '</p>' +
      (c.keep ? '<p class="mc-cf-o">' + box('data-mc-secrets', c.secrets, 'Inclure les valeurs secrètes', 'secrets') + '</p>' +
        '<p class="cfm-w">' + (c.secrets ? 'La sauvegarde gardera les clés et jetons tels quels, dans un fichier lisible par vous seul.'
          : 'Les clés et jetons seront remplacés par des variables (${NOM}) : la sauvegarde ne contiendra aucun secret.') + '</p>' : '') +
      '<p class="cfm-a"><button type="button" class="btn danger" data-mc-ok="' + id + '" data-fk="ok">Retirer</button>' +
      '<button type="button" class="btn quiet" data-mc-no data-fk="no">Annuler</button></p></div>';
  }
  function rowHTML(s) {
    var m = st(), id = SA.esc(s.id), open = m.menu === s.id, c = m.confirm && m.confirm.id === s.id ? m.confirm : null;
    return '<li class="mc-row' + (anyOn(s) ? '' : ' is-off') + '" data-id="' + id + '">' +
      '<button type="button" class="cb" role="checkbox" aria-checked="' + !!m.sel[s.id] + '" aria-label="Choisir ' + SA.esc(s.name) + '" data-mc-sel="' + id + '" data-fk="sel:' + id + '">' + SA.icon('check') + '</button>' +
      '<div class="mc-main">' +
        '<p class="mc-l1"><span class="mc-n mono">' + SA.esc(s.name) + '</span><span class="bdg mc-kind">' + SA.esc(KIND[s.kind] || s.kind) + '</span>' +
          (s.scope === 'project' ? '<span class="bdg no">Projet</span>' : '') + (anyOn(s) ? '' : '<span class="bdg no">Désactivé</span>') + '</p>' +
        (launch(s) ? '<p class="mc-cmd mono">' + SA.esc(launch(s)) + '</p>' : '') +
        chips(s) + notes(s) +
      '</div>' +
      '<button type="button" class="btn quiet mc-more" data-mc-menu="' + id + '" data-fk="menu:' + id + '" aria-expanded="' + open + '" aria-label="Actions pour ' + SA.esc(s.name) + '">Actions</button>' +
      (open || c ? '<div class="mc-pane">' + (c ? confirmHTML(s, c) : menuHTML(s)) + '</div>' : '') +
    '</li>';
  }
  function listHTML() {
    var l = visible();
    if (!servers().length) return '<p class="mc-empty">Aucun serveur MCP dans les réglages de vos agents.</p>';
    if (!l.length) return '<p class="mc-empty">Aucun serveur ne correspond.</p>';
    return '<ul class="mc-list">' + l.map(rowHTML).join('') + '</ul>';
  }
  function bulkHTML() {
    var n = selected().length, m = st();
    if (!n) return '';
    return '<div class="mc-bulk" role="group" aria-label="Serveurs choisis">' +
      '<span class="mc-bulk-n">' + SA.esc(SA.pl(n, 'serveur choisi', 'serveurs choisis')) + '</span>' +
      box('data-mc-bsecrets', m.secrets, 'Inclure les valeurs secrètes', 'bsecrets') +
      '<button type="button" class="btn" data-mc-bsave data-fk="bsave"' + (m.busy ? ' disabled' : '') + '>Sauvegarder la sélection</button>' +
      '<button type="button" class="btn quiet" data-mc-bnone data-fk="bnone">Tout désélectionner</button></div>';
  }
  function render() {
    var m = st(), d = data();
    return '<div class="mc-mgr">' +
      '<p class="eye" data-st>Serveurs MCP</p>' +
      SA.h1('Serveurs MCP de vos agents') +
      '<p class="lede" data-st>Les serveurs que vos agents lancent, lus dans leurs réglages. Les clés et jetons restent sur votre machine et sont masqués ici.</p>' +
      (d.error ? '<div class="note note-bad" role="alert"><p class="sub">' + SA.esc(d.error) + '</p></div>' : '') +
      '<div class="seg mc-tabs" role="group" aria-label="Vue" data-st>' +
        '<button type="button" data-mc-tab="mine" data-fk="tab:mine" aria-pressed="' + (m.tab !== 'cat') + '">Installés <span class="mut">' + servers().length + '</span></button>' +
        '<button type="button" data-mc-tab="cat" data-fk="tab:cat" aria-pressed="' + (m.tab === 'cat') + '">Catalogue</button></div>' +
      '<p class="mc-msg" role="status">' + SA.esc(m.msg || '') + '</p>' +
      '<p class="mc-alert" role="alert">' + SA.esc(m.fail || '') + '</p>' +
      (m.tab === 'cat' ? catHTML() : '<div class="mc-tools" data-st>' +
        '<label class="vh" for="mc-q">Chercher un serveur par nom, commande ou agent</label>' +
        '<input id="mc-q" class="fld mc-q" type="search" autocomplete="off" spellcheck="false" placeholder="Chercher un serveur, une commande, un agent" data-fk="q" value="' + SA.esc(m.q) + '">' +
        '<div class="seg" role="group" aria-label="Filtrer">' + FILTERS.map(function (f) {
          return '<button type="button" data-mc-f="' + f[0] + '" data-fk="f:' + f[0] + '" aria-pressed="' + (m.f === f[0]) + '">' + f[1] + ' <span class="mut">' + fcount(f[0]) + '</span></button>';
        }).join('') + '</div>' +
      '</div>' +
      bulkHTML() +
      '<div class="mc-region">' + listHTML() + '</div>') +
    '</div>';
  }

  /* ------------------------------------------------------------ actions */
  function refresh(focus) {
    if (SA.state.route !== 'mcp') return;
    if (focus) st().focus = focus;
    if (SA.repaint) SA.repaint();
  }
  function say(msg, fail, focus) {
    var m = st();
    m.msg = fail ? '' : msg;
    m.fail = fail ? msg : '';
    refresh(focus);
    return Promise.resolve(!fail);
  }
  function call(path, body, ok, focus) {
    var m = st();
    if (m.busy) return Promise.resolve(false);
    if (!SA.live || typeof SA.live.call !== 'function') return say('Le serveur local ne répond pas. Rechargez la page.', true, focus);
    m.busy = true; m.msg = ''; m.fail = '';
    var p;
    try { p = SA.live.call('POST', path, body); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (res) {
      st().busy = false;
      return say(ok(res || {}), false, focus);
    }, function (e) {
      st().busy = false;
      return say((e && e.message) || 'L’action a échoué. Réessayez.', true, focus);
    });
  }
  function failText(list) {
    return (list || []).map(function (f) { return agentName(f.agent) + ' : ' + (f.message || 'échec'); }).join(' ; ');
  }
  function result(verb, res) {
    var done = (res.done || res.removed || []).length, f = res.failed || [];
    var t = done ? verb + ' chez ' + SA.pl(done, 'agent', 'agents') + '.' : 'Rien n’a changé.';
    return f.length ? t + ' Échec : ' + failText(f) + '.' : t;
  }
  function body(s) { return { name: s.name, scope: s.scope === 'project' ? 'project' : 'global' }; }

  /* Démo : les gestes changent la machine d'exemple en mémoire. */
  function demoSet(s, on) {
    Object.keys(s.ag || {}).forEach(function (a) {
      (s.ag[a] || []).forEach(function (e) {
        if (on && e.stash) { e.on = true; e.stash = false; }
        if (!on && e.on) { e.on = false; e.stash = true; }
      });
    });
    s.on = anyOn(s);
  }
  var demoN = 0;
  function demoBackup(list, secrets) {
    var b = { id: 'demo-mcp-' + (++demoN), kind: 'mcp', label: 'Serveurs MCP : ' + list.map(function (s) { return s.name; }).slice(0, 2).join(', '),
      note: '', origin: 'manual', at: new Date().toISOString(), size: 0, src: '', name: list[0].name, agents: Object.keys(list[0].ag || {}),
      items: list.map(function (s) { return { name: s.name, scope: s.scope, src: '', agents: Object.keys(s.ag || {}), verdict: null, secrets: secrets ? 'kept' : 'vars', vars: [] }; }) };
    SA.state.backups = [b].concat(SA.state.backups || []);
    return b;
  }

  function setOn(id, on) {
    var s = find(id);
    if (!s) return say('Serveur introuvable.', true);
    st().menu = null;
    if (!live()) { demoSet(s, on); return say(s.name + (on ? ' réactivé.' : ' désactivé.'), false, 'menu:' + s.id); }
    return call(on ? '/api/mcp/enable' : '/api/mcp/disable', body(s), function (res) {
      return s.name + ' : ' + result(on ? 'réactivé' : 'désactivé', res);
    }, 'menu:' + s.id);
  }
  function save(list, secrets) {
    if (!list.length) return say('Choisissez au moins un serveur.', true);
    st().menu = null;
    if (!live()) { demoBackup(list, secrets); return say('Sauvegarde créée : ' + SA.pl(list.length, 'serveur', 'serveurs') + '.', false); }
    return call('/api/mcp/backup', { servers: list.map(body), secrets: !!secrets }, function (res) {
      var f = res.failed || [];
      return (res.backup ? 'Sauvegarde créée : « ' + res.backup.label + ' ».' : 'Aucune sauvegarde créée.') +
        (f.length ? ' Non sauvegardés : ' + f.map(function (x) { return x.name; }).join(', ') + '.' : '') +
        (res.backup && !secrets ? ' Les clés et jetons sont remplacés par des variables.' : '');
    });
  }
  function askRemove(id) { var m = st(); m.menu = null; m.confirm = { id: id, keep: true, secrets: false }; refresh('ok'); }
  function cancel() { var m = st(), id = m.confirm && m.confirm.id; m.confirm = null; refresh(id ? 'menu:' + id : null); }
  function confirmRemove() {
    var m = st(), c = m.confirm, s = c && find(c.id);
    if (!s) { m.confirm = null; return say('Serveur introuvable.', true); }
    m.confirm = null;
    delete m.sel[s.id];
    if (!live()) {
      if (c.keep) demoBackup([s], c.secrets);
      SA.data.mcp.servers = servers().filter(function (x) { return x !== s; });
      return say(s.name + ' retiré.' + (c.keep ? ' Une sauvegarde est gardée.' : ''), false, 'q');
    }
    return call('/api/mcp/remove', Object.assign(body(s), { backup: !!c.keep, secrets: !!(c.keep && c.secrets) }), function (res) {
      return s.name + ' : ' + result('retiré', res) + ((res.backups || []).length ? ' Une sauvegarde est gardée.' : '');
    }, 'q');
  }

  function setTab(t) {
    var m = st();
    m.tab = t === 'cat' ? 'cat' : 'mine';
    if (m.tab === 'cat' && live() && !m.catFull && !m.catLoading && SA.live && typeof SA.live.call === 'function') {
      m.catLoading = true;
      Promise.resolve().then(function () { return SA.live.call('GET', '/api/mcp/catalog'); }).then(function (c) {
        var x = st();
        x.catLoading = false;
        if (c && Array.isArray(c.servers)) x.catFull = { generatedAt: c.generatedAt, counts: c.counts, servers: c.servers };
        refresh();
      }, function () { st().catLoading = false; refresh(); });
    }
    refresh('tab:' + m.tab);
  }
  function openInstall(id) {
    var m = st(), agents = {}, on = SA.state.agents || {};
    targetAgents().forEach(function (a) { if (on[a.id]) agents[a.id] = true; });
    m.inst = { id: id, agents: agents, values: {}, replace: false, force: false };
    refresh('igo');
  }
  function closeInstall() { var m = st(), id = m.inst && m.inst.id; m.inst = null; refresh(id ? 'inst:' + id : null); }
  function install() {
    var m = st(), p = m.inst, e = p && catalog().servers.filter(function (x) { return x.id === p.id; })[0];
    if (!e) return say('Serveur absent du catalogue.', true);
    var agents = Object.keys(p.agents).filter(function (k) { return p.agents[k]; });
    if (!agents.length) return say('Choisissez au moins un agent.', true, 'igo');
    if (risky(e) && !p.force) return say('Cochez « Installer malgré l’avertissement », ou choisissez un autre serveur.', true, 'iforce');
    var values = {};
    Object.keys(p.values).forEach(function (k) { if (p.values[k]) values[k] = p.values[k]; });
    var name = shortName(e).replace(/[^\w.-]+/g, '-');
    if (!live()) {
      var ag = {};
      agents.forEach(function (a) { ag[a] = [{ path: '', on: true, same: true }]; });
      var i = e.install || {};
      SA.data.mcp.servers = servers().filter(function (x) { return x.name !== name; }).concat([{ id: name, name: name, scope: 'global', kind: i.type === 'remote' ? 'http' : 'stdio',
        command: i.type === 'remote' ? null : (i.runtime || ''), args: [], url: i.url || null, env: {}, headers: {}, secrets: 0, ag: ag, on: true, differs: false }]);
      m.inst = null;
      return say(name + ' installé chez ' + SA.pl(agents.length, 'agent', 'agents') + ' (démonstration).', false, 'cq');
    }
    var body = { id: e.id, agents: agents, scope: SA.state.scope === 'projet' ? 'project' : 'global', values: values, replace: !!p.replace, force: !!p.force };
    return call('/api/mcp/install', body, function (res) {
      if (res.held) return 'Installation retenue : le contrôle demande votre accord.';
      st().inst = null;
      var n = (res.installed || []).length, sk = res.skipped || [], f = res.failed || [], w = res.warnings || [];
      return (res.name || name) + ' : ' + (n ? 'installé chez ' + SA.pl(n, 'agent', 'agents') + '.' : 'rien installé.') +
        (sk.length ? ' Passé : ' + sk.map(function (x) { return agentName(x.agent); }).join(', ') + ' (déjà présent).' : '') +
        (f.length ? ' Échec : ' + failText(f) + '.' : '') + (w.length ? ' ' + w.join(' ') : '');
    }, 'cq');
  }

  function restoreFocus(root) {
    var m = st(), k = m.focus;
    if (!k) return;
    m.focus = null;
    var el = null, all = root.querySelectorAll('[data-fk]');
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-fk') === k) { el = all[i]; break; }
    if (!el || el.disabled) el = root.querySelector('#mc-q');
    if (el) try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  SA.views.mcp = {
    render: render,
    mount: function (root) {
      restoreFocus(root);
      root.addEventListener('click', function (e) {
        var t = e.target, b, m = st();
        if (!t || !t.closest) return;
        if ((b = t.closest('[data-mc-tab]'))) { setTab(b.getAttribute('data-mc-tab')); return; }
        if ((b = t.closest('[data-mc-inst]'))) { openInstall(b.getAttribute('data-mc-inst')); return; }
        if (t.closest('[data-mc-ino]')) { closeInstall(); return; }
        if (t.closest('[data-mc-igo]')) { install(); return; }
        if ((b = t.closest('[data-mc-iag]')) && m.inst) { var ia = b.getAttribute('data-mc-iag'); m.inst.agents[ia] = !m.inst.agents[ia]; b.setAttribute('aria-checked', String(!!m.inst.agents[ia])); return; }
        if ((b = t.closest('[data-mc-irep]')) && m.inst) { m.inst.replace = !m.inst.replace; b.setAttribute('aria-checked', String(m.inst.replace)); return; }
        if ((b = t.closest('[data-mc-iforce]')) && m.inst) { m.inst.force = !m.inst.force; b.setAttribute('aria-checked', String(m.inst.force)); return; }
        if (t.closest('[data-mc-more]')) { m.cn = (m.cn || PAGE) + PAGE; refresh('more'); return; }
        if ((b = t.closest('[data-mc-f]'))) { m.f = b.getAttribute('data-mc-f'); refresh('f:' + m.f); return; }
        if ((b = t.closest('[data-mc-menu]'))) { var id = b.getAttribute('data-mc-menu'); m.confirm = null; m.menu = m.menu === id ? null : id; refresh('menu:' + id); return; }
        if ((b = t.closest('[data-mc-sel]'))) { var sid = b.getAttribute('data-mc-sel'); if (m.sel[sid]) delete m.sel[sid]; else m.sel[sid] = true; refresh('sel:' + sid); return; }
        if ((b = t.closest('[data-mc-off]'))) { setOn(b.getAttribute('data-mc-off'), false); return; }
        if ((b = t.closest('[data-mc-on]'))) { setOn(b.getAttribute('data-mc-on'), true); return; }
        if ((b = t.closest('[data-mc-save]'))) { var sv = find(b.getAttribute('data-mc-save')); save(sv ? [sv] : [], false); return; }
        if ((b = t.closest('[data-mc-rm]'))) { askRemove(b.getAttribute('data-mc-rm')); return; }
        if (t.closest('[data-mc-keep]') && m.confirm) { m.confirm.keep = !m.confirm.keep; if (!m.confirm.keep) m.confirm.secrets = false; refresh('keep'); return; }
        if (t.closest('[data-mc-secrets]') && m.confirm) { m.confirm.secrets = !m.confirm.secrets; refresh('secrets'); return; }
        if (t.closest('[data-mc-ok]')) { confirmRemove(); return; }
        if (t.closest('[data-mc-no]')) { cancel(); return; }
        if (t.closest('[data-mc-bsecrets]')) { m.secrets = !m.secrets; refresh('bsecrets'); return; }
        if (t.closest('[data-mc-bsave]')) { save(selected(), !!m.secrets); return; }
        if (t.closest('[data-mc-bnone]')) { m.sel = {}; refresh('q'); return; }
      });
      root.addEventListener('input', function (e) {
        var t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-mc-var') && st().inst) { st().inst.values[t.getAttribute('data-mc-var')] = t.value; return; }
        if (t && t.id === 'mc-cq') {
          st().cq = t.value; st().cn = PAGE;
          var cr = root.querySelector('.mc-cregion');
          if (cr) { var tmp = document.createElement('div'); tmp.innerHTML = catHTML(); var nr = tmp.querySelector('.mc-cregion'); if (nr) cr.innerHTML = nr.innerHTML; }
          return;
        }
        if (t && t.id === 'mc-q') {
          st().q = t.value;
          var r = root.querySelector('.mc-region');
          if (r) r.innerHTML = listHTML();
        }
      });
      root.addEventListener('change', function (e) {
        var t = e.target;
        if (t && t.id === 'mc-cc') { st().cc = t.value; st().cn = PAGE; refresh('cc'); }
      });
      root.addEventListener('keydown', function (e) {
        var m = st();
        if (e.key !== 'Escape') return;
        if (m.confirm) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
        if (m.inst) { e.preventDefault(); e.stopPropagation(); closeInstall(); return; }
        if (m.menu) { e.preventDefault(); e.stopPropagation(); var id = m.menu; m.menu = null; refresh('menu:' + id); }
      });
    },
    actions: function () { return []; },
    keys: function () { return false; },
    /* Actions sans DOM, pour les essais. */
    _do: {
      visible: visible, servers: servers, setQuery: function (q) { st().q = q; }, setFilter: function (f) { st().f = f; },
      setOn: setOn, save: save, askRemove: askRemove, cancel: cancel, confirm: confirmRemove,
      setKeep: function (v) { st().confirm.keep = !!v; }, setSecrets: function (v) { st().confirm.secrets = !!v; },
      select: function (id) { st().sel[id] = true; }, selected: selected,
      setTab: setTab, catList: catList, setCatQuery: function (q) { st().cq = q; }, setCat: function (c) { st().cc = c; },
      openInstall: openInstall, closeInstall: closeInstall, install: install, inst: function () { return st().inst; }
    }
  };
})();
