/* Skill Advisor — vue « confirmation » (étape 4 : installation).
   Où installer : le dossier partagé (~/.agents/skills, lu ensemble par plusieurs agents) et un interrupteur par agent
   qui a son propre dossier. Le résumé dit ce qui sera écrit : dossier partagé et liens, ou une copie par agent.
   États dessinés : rien à installer, aucun agent, hors ligne, en cours, décision attendue (skill retenu par le contrôle,
   même nom déjà présent), échec d'un skill, annulation, terminé. */
(function () {
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  /* Identifiants d'agents du CLI skills (src/agents.ts du dépôt vercel-labs/skills), relus le 12/11/2026. */
  var CLI = { claude: 'claude-code', gemini: 'gemini-cli', copilot: 'github-copilot' };
  var LABEL = {
    wait: 'en attente', copy: 'copie…', link: 'liens…', done: 'installé', have: 'déjà installé', fail: 'échec',
    skip: 'non commencé', held: 'retenu', conflict: 'même nom', kept: 'existant gardé', nw: 'non écrit'
  };
  /* Verdicts du contrôle, dans les mots de l'écran (jamais l'identifiant interne). */
  var VERDICT = { vert: 'Aucun motif connu', 'vert-remarques': 'Remarques', orange: 'À regarder', rouge: 'Motif à risque' };
  /* Raisons d'un skill non écrit. Une raison inconnue garde un texte général. */
  var SKIP = {
    'missing-agent-directory': 'Non écrit : le dossier de l’agent n’existe pas dans ce projet.',
    exists: 'Non écrit : un skill du même nom est déjà là.'
  };
  var HAVE = { identical: 1, 'already-installed': 1, same: 1 };
  /* Statuts qui attendent une décision, et statuts d'échec. */
  var ASK = { held: 1, conflict: 1 }, BAD = { fail: 1, nw: 1 };

  function has(o, k) { return k != null && Object.prototype.hasOwnProperty.call(o, k); }
  function live() { return !!(SA.live && SA.live.on); }
  /* En mode réel, SA.data.agents porte déjà les identifiants du CLI : pas de seconde traduction. */
  function cliId(id) { return live() ? id : CLI[id] || id; }
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
  function countIn(set) { var i = inst(); return i.ids.filter(function (id) { return set[i.st[id]]; }).length; }

  /* ---------- cibles ---------- */
  /* Lecteurs du dossier partagé : agents détectés qui lisent ~/.agents/skills. Démo : l'agent dont le dossier est celui-là. */
  function reads(a) { return live() ? !!a.universal : a.rel === '.agents/skills'; }
  function readers() { return SA.agents().filter(function (a) { return a.st !== 'no' && reads(a); }); }
  /* Agents à dossier propre. Mode réel : un agent masqué dans « Agents » n'est pas proposé, sauf s'il est coché. */
  function owners() {
    var on = SA.state.agents || {};
    return SA.agents().filter(function (a) { return a.st !== 'no' && !reads(a) && !(live() && a.hidden && !on[a.id]); });
  }
  function proj() { return SA.state.scope === 'projet'; }
  /* Un agent ajouté à la main ne reçoit que des installations globales. */
  function usable(a) { return !(proj() && a.custom); }
  function sharedOn() { var on = SA.state.agents || {}; return readers().some(function (a) { return on[a.id]; }); }
  /* Le dossier partagé est lu par tous ses lecteurs ensemble : ils sont cochés ou décochés ensemble. */
  function setShared(v) { readers().forEach(function (a) { SA.state.agents[a.id] = v; }); }
  function align() { if (sharedOn()) setShared(true); }
  function ownOn() { var on = SA.state.agents || {}; return owners().filter(function (a) { return on[a.id] && usable(a); }); }
  /* Agents qui liront les skills : tous les lecteurs si le dossier partagé est écrit, plus les agents à dossier propre cochés. */
  function readCount() { return (sharedOn() ? readers().length : 0) + ownOn().length; }
  function targets() { return (sharedOn() ? ['shared'] : []).concat(ownOn().map(function (a) { return a.id; })); }
  /* Plan lu par le volet de droite (Résumé) : les mêmes règles que cet écran. */
  SA.installPlan = function () { return { shared: sharedOn(), readers: readers(), own: ownOn(), reach: readCount() }; };
  /* Dossier du projet : celui que le serveur connaît (mode réel, null quand aucun n'est choisi), sinon le dossier d'exemple. */
  function projectDir() { return SA.projRoot(); }
  function needProject() { return proj() && !projectDir(); }
  function ready() { return !SA.offline() && !needProject() && readCount() > 0; }

  /* ---------- chemins ---------- */
  function join(a, b) { var sep = SA.sep(); return String(a).replace(/[\\\/]+$/, '') + sep + String(b).replace(/\//g, sep); }
  function sharedDir() { return proj() ? join(projectDir() || '…', '.agents/skills') : SA.path('.agents/skills'); }
  /* Dossier d'un agent. Projet en mode réel : seul un dossier de projet connu (Agent.projectDir) est affiché. */
  function agentDir(a) {
    if (!proj()) return a.abs ? a.abs : SA.path(a.rel);
    if (live()) return a.projectDir && projectDir() ? join(projectDir(), a.projectDir) : null;
    return SA.target(a.rel);
  }
  function names(list) { return list.map(function (a) { return a.name; }).join(', '); }

  /* ---------- lignes ---------- */
  function heldBlock(id) {
    var i = inst(), h = (i.held || {})[id] || {}, fd = Array.isArray(h.findings) ? h.findings : [];
    return '<div class="cf-ask"><p class="cf-ask-t"><span class="bdg bad">' + SA.esc(has(VERDICT, h.verdict) ? VERDICT[h.verdict] : VERDICT.rouge) + '</span> ' +
        'Le contrôle a retenu ce skill : rien n’a été écrit pour lui.</p>' +
      (fd.length ? '<ul class="cf-fd">' + fd.slice(0, 20).map(function (f) {
        return '<li><p class="cf-fd-l">' + SA.esc(f.label || 'Motif à risque') + '</p>' +
          (f.file ? '<p class="cf-fd-f mono mut">' + SA.esc(f.file) + (f.line != null && f.line !== '' ? ' · ligne ' + SA.esc(f.line) : '') + '</p>' : '') +
          (f.excerpt ? '<pre class="code cf-fd-x"><code>' + SA.au(f.excerpt) + '</code></pre>' : '') + '</li>';
      }).join('') + '</ul>' : '') +
      '<p class="cf-ask-a"><button type="button" class="btn" data-cf-force="' + SA.esc(id) + '">Installer malgré l’avertissement</button></p></div>';
  }
  function conflictBlock(id) {
    var c = (inst().conf || {})[id] || {};
    var why = c.kind === 'manual' ? 'copie faite à la main' : 'autre source' + (c.src ? ' : ' + c.src : '');
    return '<div class="cf-ask"><p class="cf-ask-t">Un skill du même nom existe déjà (' + SA.esc(why) + '). Rien n’a été écrit pour ce skill.</p>' +
      '<p class="cf-ask-a"><button type="button" class="btn" data-cf-replace="' + SA.esc(id) + '">Remplacer (une sauvegarde est faite)</button>' +
      '<button type="button" class="btn quiet" data-cf-keep="' + SA.esc(id) + '">Garder l’existant</button></p></div>';
  }
  function row(id) {
    var it = SA.item(id), i = inst(), st = i.st[id] || 'wait', idle = i.phase === 'idle';
    if (!it) return '';
    var rm = idle || (i.phase === 'fail' && BAD[st] && SA.cart.has(id));
    return '<li class="cf-row cf-' + st + '" data-id="' + SA.esc(id) + '">' +
      '<div class="cf-id"><button type="button" class="cf-name mono" data-detail="' + SA.esc(id) + '">' + SA.esc(it[1]) + '</button>' +
        '<p class="cf-src mono mut">' + SA.esc(it[2]) + '</p>' +
        (st === 'fail' ? '<p class="cf-err">' + SA.esc((i.errs && i.errs[id]) || i.err || 'Échec de l’installation.') + '</p>' : '') +
        (st === 'nw' ? '<p class="cf-err">' + SA.esc((i.why && i.why[id]) || 'Non écrit : le serveur n’a rien écrit pour ce skill.') + '</p>' : '') +
        (st === 'held' ? heldBlock(id) : '') +
        (st === 'conflict' ? conflictBlock(id) : '') + '</div>' +
      '<p class="cf-tot mono"><span class="num">' + (it[6] == null ? '–' : it[6]) + '</span> <span class="mut">sur 100</span></p>' +
      (idle ? '<p class="cf-warn">' + SA.detail.badge(it[7], id) + '</p>' : '') +
      '<p class="cf-st mono' + (st === 'done' ? ' cf-done' : '') + '">' + (st === 'done' ? SA.icon('check') : '') + '<span>' + (LABEL[st] || st) + '</span></p>' +
      (rm ? '<button type="button" class="ct-rm" data-cart-rm="' + SA.esc(id) + '" aria-label="Retirer ' + SA.esc(it[1]) + ' de la sélection">' + SA.icon('close') + '</button>' : '') +
    '</li>';
  }

  function sw(on, label, attr, off) {
    return '<button type="button" class="sw" role="switch" aria-checked="' + on + '" aria-label="' + SA.esc(label) + '" ' + attr + (off ? ' disabled' : '') + '></button>';
  }
  function sharedRow(list) {
    return '<li class="cf-ag cf-shared">' + sw(sharedOn(), 'Installer dans le dossier partagé', 'data-cf-shared', false) +
      '<p class="cf-ag-n">Dossier partagé</p>' +
      '<p class="cf-ag-p mono mut">' + SA.esc(sharedDir()) + '</p>' +
      '<p class="cf-ag-r sub">Lu par ' + SA.esc(names(list)) + (list.length > 1 ? ' : ils le lisent ensemble.' : '.') + '</p></li>';
  }
  function agentRow(a) {
    var on = !!SA.state.agents[a.id], off = !usable(a), dir = agentDir(a);
    return '<li class="cf-ag">' + sw(on && !off, 'Installer dans ' + a.name, 'data-cf-agent="' + SA.esc(a.id) + '"', off) +
      '<p class="cf-ag-n">' + SA.esc(a.name) + (a.st === 'tr' ? ' <span class="bdg tr">Traces seulement</span>' : a.custom ? ' <span class="bdg no">Ajouté à la main</span>' : '') + '</p>' +
      '<p class="cf-ag-p mono mut">' + SA.esc(dir || 'Son dossier dans le projet') + '</p>' +
      (off ? '<p class="cf-ag-r sub">Installations globales seulement : choisissez « Tous les projets ».</p>' : '') + '</li>';
  }

  /* Dossier du projet : mode réel, choisi ici ou sur l'écran Agents, gardé par le serveur (POST /api/project).
     k : préfixe des identifiants et des attributs ('cf' ici, 'ag' sur l'écran Agents). Brouillon et erreur sont partagés (SA.state). */
  SA.projectField = function (k) {
    var s = SA.state, e = SA.esc;
    k = k === 'ag' ? 'ag' : 'cf';
    if (!live()) return '<p class="mono mut cf-proj">' + e(SA.projRoot()) + '</p>';
    var p = SA.projRoot();
    if (p && !s.projEdit) {
      return '<div class="cf-projset"><p class="cf-proj mono">' + e(p) + '</p>' +
        '<button type="button" class="lnk" data-' + k + '-proj-edit data-fk="proj-edit">Changer de dossier</button></div>';
    }
    var v = s.projDraft != null ? s.projDraft : p || '';
    return '<div class="cf-projf"><label class="cf-proj-l" for="' + k + '-proj-dir">Dossier du projet</label>' +
      '<div class="cf-proj-row"><input id="' + k + '-proj-dir" class="fld mono" type="text" data-fk="proj-dir" value="' + e(v) + '" placeholder="' + e(SA.path('code/mon-projet')) + '" spellcheck="false" autocomplete="off"' + (s.projErr ? ' aria-invalid="true" aria-describedby="' + k + '-proj-e"' : '') + '>' +
        '<button type="button" class="btn" data-' + k + '-proj-set data-fk="proj-set"' + (s.projBusy ? ' disabled' : '') + '>Choisir ce dossier</button>' +
        (p ? '<button type="button" class="lnk" data-' + k + '-proj-cancel data-fk="proj-cancel">Annuler</button>' : '') + '</div>' +
      (s.projErr ? '<p class="cf-err" id="' + k + '-proj-e" role="alert">' + e(s.projErr) + '</p>'
        : '<p class="sub cf-proj-h">Chemin complet du dossier, sur cette machine. Les skills iront dans ses dossiers d’agents.</p>') + '</div>';
  };
  /* Gestes du champ : rend true quand la cible en était un. */
  SA.projectClick = function (t, k) {
    var s = SA.state;
    if (t.closest('[data-' + k + '-proj-set]')) { SA.setProject(); return true; }
    if (t.closest('[data-' + k + '-proj-edit]')) { s.projEdit = true; s.projDraft = SA.projRoot() || ''; s.projErr = ''; SA.repaint(); return true; }
    if (t.closest('[data-' + k + '-proj-cancel]')) { s.projEdit = false; s.projDraft = null; s.projErr = ''; SA.repaint(); return true; }
    return false;
  };
  function projectBlock() { return proj() ? SA.projectField('cf') : ''; }

  function agentsBlock() {
    var s = SA.state, rd = readers(), own = owners();
    align();
    if (!rd.length && !own.length) {
      return '<section class="cf-sec" data-st aria-labelledby="cf-t2"><h2 class="h2" id="cf-t2">Agents</h2>' +
        '<div class="note note-warn"><p class="note-t">Aucun agent trouvé sur cette machine</p>' +
        (live()
          ? '<p class="sub">Skill Advisor n’a trouvé le dossier d’aucun agent connu. Sans agent, rien ne peut être installé.</p>'
          : '<p class="sub">Quatre signaux ont été examinés : dossier de configuration, commande, application installée, extension d’éditeur. Sans agent, rien ne peut être installé.</p>') +
        '<p class="note-a"><button type="button" class="btn" data-go-route="agents">Ajouter un agent à la main</button></p></div></section>';
    }
    var n = readCount();
    return '<section class="cf-sec" data-st aria-labelledby="cf-t2"><div class="cf-sech"><h2 class="h2" id="cf-t2">Agents</h2>' +
        '<button type="button" class="lnk" data-go-route="agents">Voir la détection</button></div>' +
      '<p class="sub cf-hint">' + (rd.length ? 'Le dossier partagé sert à plusieurs agents à la fois. ' : '') +
        (n ? pl(n, 'agent lira', 'agents liront') + ' ces skills.' : 'Aucun agent coché.') + '</p>' +
      '<ul class="ledger cf-ags">' + (rd.length ? sharedRow(rd) : '') + own.map(agentRow).join('') + '</ul>' +
      '<div class="cf-scope"><p class="cf-scope-l" id="cf-scope-l">Portée</p><div class="seg" role="group" aria-labelledby="cf-scope-l">' +
        [['global', 'Tous les projets'], ['projet', 'Ce projet seulement']].map(function (o) {
          return '<button type="button" data-scope="' + o[0] + '" aria-pressed="' + (s.scope === o[0]) + '">' + o[1] + '</button>';
        }).join('') + '</div>' + projectBlock() + '</div></section>';
  }

  /* Ce qui sera écrit : chemins exacts, puis la commande équivalente du moteur (l'interrupteur de télémétrie la change en démo). */
  function plan() {
    var s = SA.state, list = ids().map(SA.item).filter(Boolean), out = [];
    var rd = readers(), own = ownOn(), sh = sharedOn();
    if (needProject()) return '<span class="dim"># choisissez d’abord le dossier du projet</span>';
    if (!sh && !own.length) return '<span class="dim"># aucun agent coché : rien ne sera écrit</span>';
    function paths(a) {
      var d = agentDir(a);
      return d ? list.map(function (it) { return SA.esc(join(d, it[1])); }) : null;
    }
    function agentLines() {
      var unknown = [];
      own.forEach(function (a) { var p = paths(a); if (p) out.push.apply(out, p); else unknown.push(a); });
      if (unknown.length) out.push('<span class="dim"># ' + SA.esc(names(unknown)) + ' : dans le dossier de projet de l’agent</span>');
    }
    if (sh) {
      out.push('<span class="dim"># dossier partagé, lu par ' + SA.esc(names(rd)) + '</span>');
      list.forEach(function (it) { out.push(SA.esc(join(sharedDir(), it[1]))); });
      if (own.length) {
        out.push('');
        out.push('<span class="dim"># ' + (own.length * list.length > 1 ? 'liens' : 'lien') + ' vers le dossier partagé</span>');
        agentLines();
      }
    } else {
      out.push('<span class="dim"># ' + (own.length > 1 ? 'une copie par agent' : 'une copie') + '. Rien n’est écrit dans le dossier partagé.</span>');
      agentLines();
    }
    /* Commande équivalente du moteur : mêmes agents, --copy quand rien ne va dans le dossier partagé. Mode réel : télémétrie toujours coupée. */
    out.push('');
    out.push('<span class="dim"># commande équivalente du moteur (CLI skills)</span>');
    var bySrc = {};
    list.forEach(function (it) { (bySrc[it[2]] = bySrc[it[2]] || []).push(it[1]); });
    var cli = SA.agents().filter(function (a) { return !a.custom && ((sh && rd.indexOf(a) > -1) || own.indexOf(a) > -1); });
    var ag = cli.map(function (a) { return '-a ' + cliId(a.id); }).join(' ');
    Object.keys(bySrc).forEach(function (src) {
      out.push(SA.esc((s.telemetryOff || live() ? 'DISABLE_TELEMETRY=1 ' : '') + 'npx -y skills add ' + src + ' ' +
        bySrc[src].map(function (n) { return '--skill ' + n; }).join(' ') + (proj() ? ' ' : ' -g ') + ag + (sh ? '' : ' --copy') + ' -y'));
    });
    var hand = own.filter(function (a) { return a.custom; });
    if (hand.length) out.push('<span class="dim"># ' + SA.esc(names(hand)) + ' : ' + (sh ? 'lien ajouté' : 'copie ajoutée') + ' ensuite par Skill Advisor</span>');
    return out.join('\n');
  }

  /* ---------- agents qui ont les skills, d'après l'état rendu par le serveur ---------- */
  function holders(list) {
    var rows = list.map(SA.mineRow).filter(Boolean);
    return rows.length ? SA.detail.holders(rows).length : 0;
  }
  function doneAgents() {
    var i = inst(), got = i.ids.filter(function (id) { return i.st[id] === 'done' || i.st[id] === 'have'; });
    return holders(got) || (i.req && i.req.n) || readCount();
  }

  /* ---------- en-tête selon l'état ---------- */
  function head() {
    var i = inst(), m = readCount(), d = count('done'), f = countIn(BAD), k = count('skip');
    var eye = '<p class="eye" data-st>Étape 04 · Installation</p>';
    if (i.phase === 'done') {
      var have = count('have');
      return eye + SA.h('Installation terminée') +
        '<p class="lede" role="status" tabindex="-1" data-st>' + pl(d, 'skill installé', 'skills installés') + ' dans ' + pl(doneAgents(), 'agent', 'agents') + '.' +
        (have ? ' ' + pl(have, 'skill était déjà installé', 'skills étaient déjà installés') + '.' : '') +
        (count('kept') ? ' ' + pl(count('kept'), 'skill existant est gardé', 'skills existants sont gardés') + '.' : '') + '</p>';
    }
    if (i.phase === 'ask') {
      var a = countIn(ASK);
      return eye + SA.h('Votre décision est attendue') +
        '<div class="note note-warn" role="status" tabindex="-1" data-st><p class="note-t">' + pl(a, 'skill attend votre décision', 'skills attendent votre décision') + '</p>' +
        '<p class="sub">' + pl(d, 'skill est installé', 'skills sont installés') + '. Pour chaque skill retenu, lisez la raison sous son nom, puis choisissez.</p></div>';
    }
    if (i.phase === 'fail') {
      return eye + SA.h('Installation incomplète') +
        '<div class="note note-bad" role="alert" tabindex="-1" data-st><p class="note-t">' + pl(f, 'skill n’a pas pu être installé', 'skills n’ont pas pu être installés') + '</p>' +
        '<p class="sub">' + pl(d, 'skill est installé', 'skills sont installés') + '. ' +
        (live() ? 'La raison de chaque échec est indiquée sous le skill.' : 'Rien n’est resté à moitié écrit : la copie du skill en échec a été retirée.') + '</p></div>';
    }
    if (i.phase === 'cancel') {
      return eye + SA.h('Installation interrompue') +
        '<div class="note note-warn" role="status" data-st><p class="note-t">Vous avez annulé</p>' +
        '<p class="sub">' + pl(d, 'skill est installé', 'skills sont installés') + ', ' + k + (k > 1 ? ' n’ont pas été commencés' : ' n’a pas été commencé') + '. Vous pouvez reprendre, ou retirer ce qui vient d’être installé.</p></div>';
    }
    if (i.phase === 'run') {
      return eye + SA.h('Installation en cours') +
        '<p class="lede" role="status" data-st>Écriture pour ' + pl(m, 'agent', 'agents') + '. ' +
        (live() ? 'Skill Advisor télécharge chaque skill, le contrôle, puis l’écrit. Un skill avec un motif à risque est retenu : vous déciderez. Gardez cette page ouverte.'
          : 'Vous pouvez annuler : le skill en cours ira au bout, les suivants ne seront pas commencés.') + '</p>';
    }
    return eye + SA.h('Vérifiez avant d’écrire') +
      '<p class="lede" data-st>Voici exactement ce qui sera créé sur votre machine. Rien n’a encore été écrit.' +
        (live() ? ' Skill Advisor télécharge chaque skill et le contrôle avant de l’écrire.' : '') + '</p>' +
      (SA.offline() ? '<div class="note note-warn" role="status" data-st><p class="note-t">Hors ligne</p><p class="sub">Les fichiers des skills se téléchargent au moment de l’installation. Elle reprendra quand le réseau reviendra ; votre sélection est gardée.</p></div>' : '');
  }

  /* ---------- installation simulée (démo) ---------- */
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
    SA.agentsOn().filter(usable).forEach(function (a) { ag[a.id] = 'ok'; });
    if (!SA.mineRow(id)) s.mine.unshift({ id: id, name: it[1], src: it[2], real: true, st: 'ok', on: true, ag: ag, chars: f ? f.dl : null, warn: it[7], note: it[6], fresh: true });
    SA.cart.remove(id);
    if (s.lastInstall.indexOf(id) < 0) s.lastInstall.push(id);
  }

  function goGuide() { if (here() && inst().phase === 'done') SA.go(5, 1); }

  function finish(phase) {
    var s = SA.state, i = inst();
    clearTimers();
    s.installing = false;
    stop = false;
    i.phase = phase;
    i.ids.forEach(function (id) { if (!/^(done|have|fail)$/.test(i.st[id] || '')) i.st[id] = 'skip'; });
    SA.repaint();
    /* Laisser lire le résultat, puis passer au guide. */
    if (phase === 'done') later(goGuide, SA.rm ? 0 : 1600);
  }

  function run() {
    var s = SA.state, i = inst(), root = curRoot;
    var list = SA.cart.list().slice();
    if (s.installing || !root || !list.length || !ready()) return;
    i.ids = list.slice(); i.st = {};
    i.req = { agents: targets(), scope: proj() ? 'project' : 'global', n: readCount() };
    if (live()) return send(list, {});
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

  /* ---------- mode réel ---------- */
  /* Une demande au serveur pour la liste, avec les cibles et la portée de la première demande.
     extra : { force: [nom] } ou { replace: [nom] }. L'état de la machine revient avec la réponse. */
  function send(list, extra) {
    var s = SA.state, i = inst(), byName = {};
    var items = list.map(SA.item).filter(Boolean);
    items.forEach(function (it) { byName[it[1]] = it[0]; });
    ['errs', 'why', 'held', 'conf'].forEach(function (k) { i[k] = i[k] || {}; });
    i.err = '';
    list.forEach(function (id) { ['errs', 'why', 'held', 'conf'].forEach(function (k) { delete i[k][id]; }); i.st[id] = 'copy'; });
    i.phase = 'run';
    s.installing = true;
    SA.repaint();
    say('Installation de ' + pl(items.length, 'skill', 'skills') + ' en cours.');
    function ok(id, st) {
      i.st[id] = st;
      SA.cart.remove(id);
      if (s.lastInstall.indexOf(id) < 0) s.lastInstall.push(id);
    }
    var body = { items: items.map(function (it) { return { source: it[2], skill: it[1] }; }), agents: i.req.agents.slice(), scope: i.req.scope };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return SA.live.call('POST', '/api/skills/install', body).then(function (res) {
      (res.installed || []).forEach(function (n) { if (byName[n]) ok(byName[n], 'done'); });
      (res.held || []).forEach(function (h) {
        var id = byName[h && h.name];
        if (id) { i.st[id] = 'held'; i.held[id] = h; }
      });
      (res.conflicts || []).forEach(function (c) {
        var id = byName[c && c.name];
        if (id) { i.st[id] = 'conflict'; i.conf[id] = c; }
      });
      (res.skipped || []).forEach(function (x) {
        var n = typeof x === 'string' ? x : x && x.name, why = x && typeof x === 'object' ? x.reason : null, id = byName[n];
        /* Écrit pour un autre agent : le skill reste installé. Une ligne « skipped » arrive par agent. */
        if (!id || i.st[id] === 'done') return;
        if (has(HAVE, why)) { ok(id, 'have'); return; }
        i.st[id] = 'nw';
        i.why[id] = has(SKIP, why) ? SKIP[why] : 'Non écrit : le serveur n’a rien écrit pour ce skill.';
      });
      (res.failed || []).forEach(function (f) {
        var id = byName[f && f.name];
        if (id) { i.st[id] = 'fail'; i.errs[id] = f.message || 'Échec de l’installation.'; }
      });
      list.forEach(function (id) {
        if (i.st[id] === 'copy') { i.st[id] = 'fail'; i.errs[id] = 'Le serveur n’a pas donné de résultat pour ce skill. Ouvrez Mes skills pour vérifier.'; }
      });
    }, function (e) {
      list.forEach(function (id) { i.st[id] = 'fail'; i.errs[id] = e && e.message ? e.message : 'Le serveur local n’a pas répondu.'; });
    }).then(settle);
  }

  /* Phase d'après les statuts : une décision attendue, un échec, ou terminé. */
  function settle() {
    var s = SA.state, i = inst();
    s.installing = false;
    clearTimers();
    i.phase = countIn(ASK) ? 'ask' : countIn(BAD) ? 'fail' : 'done';
    if (i.phase === 'done') s.lastAgents = doneAgents();
    SA.repaint();
    if (i.phase === 'done') later(goGuide, SA.rm ? 0 : 1600);
  }

  /* Réessayer : les skills en échec encore dans la sélection. Ceux qu'on en a retirés quittent la liste. */
  function retry() {
    var i = inst();
    i.ids = i.ids.filter(function (id) { return !BAD[i.st[id]] || SA.cart.has(id); });
    var list = i.ids.filter(function (id) { return BAD[i.st[id]]; });
    if (!list.length || SA.state.installing) return;
    if (live()) return send(list, {});
    SA.state.inst = null;
    run();
  }

  /* Continuer sans les skills restants : ils quittent la sélection. Sans rien d'installé, retour au conseil ou à la recherche. */
  function without() {
    var s = SA.state, i = inst();
    i.ids.forEach(function (id) { if (ASK[i.st[id]] || BAD[i.st[id]]) SA.cart.remove(id); });
    s.inst = null;
    if (s.lastInstall.length) SA.go(5, 1);
    else if (s.goal && SA.answered()) SA.go(3, -1);
    else SA.setRoute('recherche');
  }

  SA.setProject = setProject;
  function setProject() {
    var s = SA.state, v = String(s.projDraft != null ? s.projDraft : '').trim();
    if (s.projBusy) return;
    if (!v) { s.projErr = 'Indiquez le chemin complet du dossier du projet.'; SA.repaint(); return; }
    if (!/^(\/|[A-Za-z]:[\\\/]|\\\\)/.test(v)) { s.projErr = 'Indiquez un chemin complet, depuis la racine du disque.'; SA.repaint(); return; }
    s.projBusy = true;
    s.projErr = '';
    return SA.live.call('POST', '/api/project', { dir: v }).then(function () {
      s.projEdit = false; s.projDraft = null;
    }, function (e) {
      s.projErr = e && e.message ? e.message : 'Le serveur local a refusé ce dossier.';
    }).then(function () { s.projBusy = false; SA.repaint(); });
  }

  function onClick(e) {
    if (!here()) return;
    var s = SA.state, i = inst(), t = e.target, b;
    if (s.installing) return;
    if ((b = t.closest('[data-cf-shared]'))) { setShared(!sharedOn()); SA.repaint(); return; }
    if ((b = t.closest('[data-cf-agent]'))) {
      var id = b.getAttribute('data-cf-agent'), a = SA.agents().filter(function (x) { return x.id === id; })[0];
      if (!a || !usable(a) || b.disabled) return;
      s.agents[id] = !s.agents[id];
      SA.repaint();
      return;
    }
    if ((b = t.closest('[data-scope]'))) { s.scope = b.getAttribute('data-scope'); s.projErr = ''; SA.repaint(); return; }
    if (SA.projectClick(t, 'cf')) return;
    if ((b = t.closest('[data-cf-force]'))) {
      var f = b.getAttribute('data-cf-force'), fi = SA.item(f);
      if (fi && i.st[f] === 'held') send([f], { force: [fi[1]] });
      return;
    }
    if ((b = t.closest('[data-cf-replace]'))) {
      var r = b.getAttribute('data-cf-replace'), ri = SA.item(r);
      if (ri && i.st[r] === 'conflict') send([r], { replace: [ri[1]] });
      return;
    }
    if ((b = t.closest('[data-cf-keep]'))) {
      var k = b.getAttribute('data-cf-keep');
      if (i.st[k] === 'conflict') { i.st[k] = 'kept'; SA.cart.remove(k); settle(); }
      return;
    }
    var tel = t.closest('.cf-tel .sw');
    if (tel) { if (!live()) { s.telemetryOff = !s.telemetryOff; SA.repaint(); } return; }
    /* Retirer un skill ici passe par l'écoute commune (data-cart-rm), puis la liste se redessine. */
    if (t.closest('[data-cart-rm]')) setTimeout(function () { if (here()) SA.repaint(); }, 0);
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
      var idle = i.phase === 'idle', open = idle || i.phase === 'run';
      return head() +
        '<section class="cf-sec" data-st aria-labelledby="cf-t1">' +
          '<h2 class="h2" id="cf-t1">Skills</h2>' +
          '<div class="cf-list">' +
            '<div class="cf-prog" aria-hidden="true"><i' + (idle ? '' : ' style="transform:scaleX(' + ((i.ids.length - count('wait') - count('copy') - count('link')) / Math.max(1, i.ids.length)) + ')"') + '></i></div>' +
            '<ul class="ledger" id="inst">' + list.map(row).join('') + '</ul>' +
          '</div>' +
          '<p class="cf-sr vh" aria-live="polite"></p>' +
        '</section>' +
        (open ? agentsBlock() : '') +
        (open
          ? '<section class="cf-sec" data-st aria-labelledby="cf-t3"><h2 class="h2" id="cf-t3">Ce qui sera écrit</h2>' +
              '<pre class="code" tabindex="0"><code>' + plan() + '</code></pre></section>' +
            '<section class="cf-sec cf-tel" data-st aria-labelledby="cf-t4"><h2 class="h2" id="cf-t4">Télémétrie</h2>' +
              '<div class="cf-tel-row"><div class="cf-tel-t">' +
                '<p class="cf-tel-l">Couper la télémétrie du moteur d’installation</p>' +
                (live()
                  ? '<p class="cf-tel-d sub">Toujours coupée : Skill Advisor lance le moteur (CLI skills) avec <span class="mono">DISABLE_TELEMETRY=1</span>. Ni compteur d’installation, ni requêtes d’audit. Skill Advisor n’envoie rien de son côté.</p>'
                  : '<p class="cf-tel-d sub">Le moteur (CLI skills) envoie un compteur d’installation anonyme. Le couper ajoute <span class="mono">DISABLE_TELEMETRY=1</span> à la commande ci-dessus, et coupe aussi ses requêtes d’audit. Skill Advisor n’envoie rien de son côté.</p>') +
              '</div><button type="button" class="sw" role="switch" aria-checked="' + !!(st.telemetryOff || live()) + '" aria-label="Couper la télémétrie du moteur d’installation"' + (st.installing || live() ? ' disabled' : '') + '></button></div></section>'
          : '');
    },

    mount: function (root) {
      curRoot = root;
      var s = SA.state;
      /* Revenir sur l'écran après une installation terminée repart d'une sélection propre. */
      if (!s.installing && inst().phase === 'run') s.inst = null;
      root.addEventListener('click', onClick);
      /* Le chemin tapé est gardé sans redessiner : le champ garde le focus. Entrée le valide. */
      root.addEventListener('input', function (e) { if (e.target && e.target.id === 'cf-proj-dir') SA.state.projDraft = e.target.value; });
      root.addEventListener('keydown', function (e) {
        if (e.target && e.target.id === 'cf-proj-dir' && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setProject(); }
      });
    },

    actions: function () {
      var st = SA.state, i = inst(), m = readCount(), n = SA.cart.count();
      var rest = function (set) { return i.ids.filter(function (id) { return set[i.st[id]]; }).length; };
      if (i.phase === 'run') {
        /* Mode réel : une demande en cours ne s'interrompt pas. */
        if (live()) return [{ label: 'Installation…', kind: 'primary', disabled: true, on: function () {} }];
        return [
          { label: stop ? 'Arrêt après ce skill…' : 'Annuler', kind: 'default', disabled: stop, on: function () { stop = true; SA.sync(); } },
          { label: 'Installation…', kind: 'primary', disabled: true, on: function () {} }
        ];
      }
      if (i.phase === 'done') return [{ label: 'Voir le guide', kind: 'primary', kbd: '↵', on: function () { SA.go(5, 1); } }];
      if (i.phase === 'ask') {
        var a = rest(ASK);
        return [{ label: 'Continuer sans ' + (a > 1 ? 'eux' : 'lui'), kind: 'default', on: without }];
      }
      if (i.phase === 'fail') {
        var f = rest(BAD), again = i.ids.filter(function (id) { return BAD[i.st[id]] && SA.cart.has(id); }).length;
        return [
          { label: 'Continuer sans ' + (f > 1 ? 'eux' : 'lui'), kind: 'default', on: without },
          { label: 'Réessayer', kind: 'primary', kbd: '↵', disabled: !again, on: retry }
        ];
      }
      if (i.phase === 'cancel') {
        return [
          { label: 'Retirer ce qui vient d’être installé', kind: 'default', disabled: !count('done'), on: undo },
          { label: 'Reprendre', kind: 'primary', kbd: '↵', disabled: !n, on: function () { st.inst = null; SA.repaint(); } }
        ];
      }
      if (!n) return [];
      var label = SA.offline() ? 'Hors ligne : installation impossible' : needProject() ? 'Choisissez d’abord le dossier du projet' : !m ? 'Aucun agent coché' :
        'Installer ' + pl(n, 'skill', 'skills') + ' dans ' + pl(m, 'agent', 'agents');
      return [
        { label: 'Retour', kind: 'default', on: function () { if (st.goal && SA.answered()) SA.go(3, -1); else SA.setRoute('recherche'); } },
        { label: label, kind: 'primary', kbd: '↵', disabled: !ready(), on: function () { return run(); } }
      ];
    }
    /* Enter is owned by core (it clicks the primary action), so this view has no keys(). */
  };

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
})();
