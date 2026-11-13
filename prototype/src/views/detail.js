/* Skill Advisor prototype: détail d'un skill, commun à tous les écrans (conseil, recherche, sélection, Mes skills).
   Tout ce qui est affiché vient de la base réelle (search-data.js) et des extraits de fichiers (file-data.js).
   Les textes d'auteur sont entourés de marqueurs <!--a--> : ils ne sont ni traduits ni contrôlés par le test de rendu. */
(function () {
  window.SA = window.SA || {};
  var SA = window.SA;

  var LEVEL = { eleve: 'Élevé', moyen: 'Moyen', info: 'Information' };
  var STATUS = { pass: 'réussi', warn: 'avertissement', fail: 'échec' };
  var VERD = {
    vert: 'Aucun motif connu trouvé.',
    'vert-remarques': 'Aucun motif à risque. Des remarques mineures : installation demandée ou fichier .env cité.',
    orange: 'Des motifs demandent votre confirmation.',
    rouge: 'Des motifs à risque ont été trouvés.'
  };
  var RISK = { SAFE: 'aucun', NONE: 'aucun', LOW: 'faible', MEDIUM: 'moyen', HIGH: 'élevé', CRITICAL: 'critique' };
  var STBADGE = { pass: ['ok', 'Réussi'], warn: ['tr', 'Avertissement'], fail: ['bad', 'Échec'] };
  var WEIGHTS = [{ label: 'Popularité', max: 40 }, { label: 'Réputation de la source', max: 25 }, { label: 'Fraîcheur', max: 15 }, { label: 'Sécurité', max: 20 }];
  var CUT = 1536;     // Claude Code coupe la description à cette longueur dans sa liste de skills (documentation)
  var curId = null, pop = null, bound = false;

  var esc = function (s) { return SA.esc(s); };
  SA.au = function (s) { return '<!--a-->' + SA.esc(s) + '<!--/a-->'; };

  function files() { return SA.files || {}; }
  function plF(k) { return k.f ? ' ' + k.f + (k.f > 1 ? ' fichiers lus' : ' fichier lu') + ', dont ' + k.sx + (k.sx > 1 ? ' scripts.' : ' script.') : ''; }

  /* ---------- badges d'avertissement ---------- */
  function badge(w, id) {
    var has = id && SA.det(id);
    if ((w === 2 || w === 1) && has) {
      return '<button type="button" class="bdg ' + (w === 2 ? 'bad' : 'tr') + ' wbtn" data-warnpop="' + esc(id) + '" aria-haspopup="dialog">' +
        (w === 2 ? 'Avertissement élevé' : 'Avertissement') + '<span class="wmore">Voir le rapport</span></button>';
    }
    if (w === 2) return '<span class="bdg bad">Avertissement élevé</span>';
    if (w === 1) return '<span class="bdg tr">Avertissement</span>';
    if (w === 0) return '<span class="bdg ok">Aucun avertissement</span>';
    return '<span class="bdg no">Non contrôlé</span>';
  }

  /* ---------- coût en contexte ---------- */
  function ctxText(chars) {
    if (chars == null) return 'non mesuré';
    return SA.nb(chars) + ' car.';
  }
  function ctxSection(chars) {
    if (chars == null) {
      return '<section class="dt-sec"><h3 class="h2">Coût en contexte</h3><p class="sub">Non mesuré : le fichier de ce skill n’a pas été lu.</p></section>';
    }
    var tok = Math.round(chars / 4 / 10) * 10 || 10;
    return '<section class="dt-sec"><h3 class="h2">Coût en contexte</h3>' +
      '<p class="dt-big"><span class="num">' + SA.nb(chars) + '</span><span class="mut"> caractères, soit environ ' + SA.nb(tok) + ' jetons</span></p>' +
      '<p class="sub">C’est la longueur du nom et de la description. Dans Claude Code, ce texte reste en contexte tant que le skill est actif ; le reste du fichier n’est lu que lorsque le skill sert.</p>' +
      (chars > CUT ? '<p class="dt-flag"><span class="bdg tr">Description coupée</span><span>Au-delà de ' + SA.nb(CUT) + ' caractères, Claude Code coupe la description dans sa liste.</span></p>' : '') +
      '<p class="mut dt-note">Estimation à 4 caractères par jeton. Pour les autres agents, le comportement reste à établir.</p></section>';
  }

  /* ---------- le fichier ---------- */
  function fileSection(id, k) {
    var f = files()[id];
    if (!f) {
      return '<section class="dt-sec"><h3 class="h2">Le fichier</h3><p class="sub">Extrait non repris dans ce prototype : licence non permissive, ou fichier introuvable dans le dépôt. Le produit affichera le fichier tel qu’il sera écrit sur votre machine.</p>' +
        '<p><a class="lnk" href="https://skills.sh/' + esc(id) + '" target="_blank" rel="noopener">Lire le fichier sur skills.sh</a></p></section>';
    }
    /* Les lignes relevées sont retrouvées par leur texte, pas par leur numéro : le dépôt a pu changer depuis le contrôle. */
    var marks = ((k && k.fd) || []).filter(function (x) { return x[4] !== 'low' && /SKILL\.md$/i.test(x[1]); }).map(function (x) { return x[3].trim().slice(0, 60); });
    var hit = 0;
    var body = f.x.split('\n').map(function (l) {
      var on = marks.some(function (m) { return m && l.indexOf(m) > -1; });
      if (on) hit++;
      return on ? '<mark class="dt-mark">' + esc(l) + '</mark>' : esc(l);
    }).join('\n');
    var repo = id.split('/').slice(0, 2).join('/');
    return '<section class="dt-sec"><h3 class="h2">Le fichier</h3>' +
      '<p class="mono mut dt-path">' + esc(f.p) + ' · ' + SA.nb(f.n) + (f.n > 1 ? ' lignes' : ' ligne') + (k && k.l ? ' · licence ' + esc(k.l) : '') + '</p>' +
      '<pre class="code dt-file" tabindex="0" aria-label="Début du fichier SKILL.md"><code><!--a-->' + body + '<!--/a--></code></pre>' +
      '<p class="mut dt-note">' + (f.cut ? 'Début du fichier, lu dans le dépôt ' + esc(repo) + '. ' : 'Fichier entier, lu dans le dépôt ' + esc(repo) + '. ') +
      (hit ? SA.pl(hit, 'ligne relevée par notre contrôle est surlignée', 'lignes relevées par notre contrôle sont surlignées') + '. ' : '') +
      'Texte de l’auteur, non traduit.</p>' +
      '<p><a class="lnk" href="https://github.com/' + esc(repo) + '/blob/HEAD/' + esc(f.p) + '" target="_blank" rel="noopener">Lire le fichier entier dans le dépôt</a></p></section>';
  }

  /* ---------- constats de notre contrôle ---------- */
  function findings(list) {
    return '<ul class="ledger dt-fd">' + list.map(function (f) {
      return '<li><p class="dt-fd-l">' + esc(f[0]) + '</p><p class="mono mut dt-fd-f">' + esc(f[1]) + ' · ligne ' + f[2] + '</p>' +
        '<pre class="code dt-fd-x"><code>' + SA.au(f[3]) + '</code></pre></li>';
    }).join('') + '</ul>';
  }
  function scanSection(k) {
    var fd = (k.fd || []).filter(function (f) { return f[4] !== 'low'; });
    return '<section class="dt-sec"><h3 class="h2">Notre contrôle</h3><p class="sub">' + (k.v ? VERD[k.v] : 'Contenu non contrôlé : fichiers indisponibles.') + plF(k) + '</p>' +
      (fd.length ? findings(fd) : '') +
      '<p class="mut dt-note">Lecture du texte des fichiers : le contrôle signale des motifs, pas une intention. « Aucun motif connu » ne veut pas dire « sans risque ».</p></section>';
  }

  /* ---------- détail d'un skill de la base ---------- */
  function repBtn(w, k) {
    var key = null;
    if (w[2] === 'AUDIT_FAIL' || w[2] === 'AUDIT_WARN') {
      (k.a || []).forEach(function (a, i) { if (key === null && w[1].indexOf(a[0]) >= 0) key = String(i); });
    }
    return key === null ? '' : '<button type="button" class="lnk" data-rep="' + key + '">Voir le rapport</button>';
  }

  function detailHtml(id, why) {
    var it = SA.item(id), k = SA.det(id), f = files()[id], row = SA.mineRow(id);
    var h = '<div class="dt"><p class="eye">Skill</p><p class="dt-name mono">' + esc(it[1]) + '</p>' +
      '<p class="dt-src mono mut">' + esc(it[2]) + (it[5] ? ' · source officielle' : '') + '</p>';
    if (k) h += '<p class="dt-desc sub" lang="en">' + (k.d ? SA.au(k.d) : 'Pas de description fournie par l’auteur.') + '</p>';
    else h += '<p class="dt-desc sub">Ce skill figure au classement avec ' + SA.nb(it[3]) + ' installations. ' +
      (it[6] == null ? 'Il n’est pas encore noté ni contrôlé : il le sera dès qu’il entrera dans une catégorie du catalogue.'
        : 'Sa note est de ' + it[6] + ' sur 100. Le détail de la note, la description, le contrôle et les audits ne sont pas dans cette copie de la base : lisez sa fiche sur skills.sh avant de l’installer.') + '</p>';
    if (why) h += '<p class="dt-why"><span class="dt-why-l">Pourquoi pour vous</span><span>' + esc(why) + '</span></p>';
    h += '<p class="dt-cta">' + SA.addBtn(id, true) + (row ? '<button type="button" class="btn" data-go-route="gestion">Voir dans Mes skills</button>' : '') + '</p>';
    if (k) {
      h += '<section class="dt-sec"><h3 class="h2">Score Skill Advisor</h3><p class="dt-big"><span class="num">' + it[6] + '</span><span class="mut"> sur 100</span></p>' +
        SA.scoreBar(k.sc) +
        '<ul class="ledger dt-parts">' + WEIGHTS.map(function (w, i) { return '<li><span>' + esc(w.label) + '</span><span class="mono"><span class="num">' + k.sc[i] + '</span> sur ' + w.max + '</span></li>'; }).join('') + '</ul>' +
        '<p class="dt-note mut">' + SA.nb(it[3]) + ' installations' + (k.st != null ? ' · ' + SA.nb(k.st) + ' étoiles sur le dépôt entier' : '') + (k.p ? ' · dernier changement le ' + SA.day(k.p) : '') + '</p></section>';
      h += '<section class="dt-sec"><h3 class="h2">Avertissements</h3>' + (k.w.length
        ? '<ul class="ledger dt-warn">' + k.w.map(function (w) { return '<li><span class="bdg ' + (w[0] === 'eleve' ? 'bad' : w[0] === 'moyen' ? 'tr' : 'no') + '">' + LEVEL[w[0]] + '</span><span>' + SA.au(w[1]) + '</span>' + repBtn(w, k) + '</li>'; }).join('') + '</ul>' +
          '<p class="dt-note mut">Un avertissement n’empêche pas l’installation. Vous décidez.</p>'
        : '<p class="sub">Aucun avertissement.</p>') + '</section>';
      h += scanSection(k);
      h += '<section class="dt-sec"><h3 class="h2">Audits publiés</h3>' + (k.a.length
        ? '<ul class="ledger dt-aud">' + k.a.map(function (a, i) { return '<li><span>' + esc(a[0]) + '</span><span class="mono">' + esc(STATUS[a[1]] || a[1]) + '</span><button type="button" class="lnk" data-rep="' + i + '" aria-label="Voir le rapport de ' + esc(a[0]) + '">Voir le rapport</button></li>'; }).join('') + '</ul>'
        : '<p class="sub">Aucun audit publié pour ce skill.</p>') + '</section>';
      h += fileSection(id, k);
      h += ctxSection(f ? f.dl : null);
    }
    h += '<p class="dt-foot"><a class="lnk" href="https://skills.sh/' + esc(id) + '" target="_blank" rel="noopener">Voir la fiche sur skills.sh</a></p></div>';
    return h;
  }

  function open(id, why) {
    if (!SA.item(id)) { var r = SA.mineRow(id); if (r) openLocal(r); return; }
    curId = id;
    bind();
    SA.openDrawer(detailHtml(id, why), 'Détail du skill', 'detail');
  }

  /* ---------- détail d'un skill présent sur la machine mais absent de la base ---------- */
  var AG = { ok: ['ok', 'Lien en place'], div: ['tr', 'Copie différente'], ko: ['bad', 'Lien cassé'] };
  function presence(row) {
    return '<ul class="ledger dt-aud">' + SA.agents().filter(function (a) { return a.st !== 'no'; }).map(function (a) {
      var v = (row.ag || {})[a.id], b = AG[v];
      return '<li><span>' + esc(a.name) + '</span>' + (b ? '<span class="bdg ' + b[0] + '">' + b[1] + '</span>' : '<span class="mut">Absent</span>') + '</li>';
    }).join('') + '</ul>';
  }
  function openLocal(row) {
    bind();
    var origin = row.kind === 'plugin' ? 'Livré par le plugin ' + row.plugin + ' : c’est lui qui l’installe et le met à jour.'
      : row.kind === 'manuel' ? (row.dup ? 'Copié à la main. Même nom qu’un skill déjà géré : l’agent peut charger l’un ou l’autre.' : row.match ? 'Copié à la main. Source retrouvée par son empreinte : ' + row.match + '.' : 'Copié à la main. Aucune source retrouvée.')
      : 'Installé depuis ' + row.src + '.';
    var h = '<div class="dt"><p class="eye">Sur cette machine</p><p class="dt-name mono">' + esc(row.name) + '</p>' +
      '<p class="dt-src mono mut">' + esc(row.src) + '</p>' +
      '<p class="dt-desc sub">' + esc(row.desc || '') + '</p>' +
      '<section class="dt-sec"><h3 class="h2">Origine</h3><p class="sub">' + esc(origin) + '</p></section>' +
      '<section class="dt-sec"><h3 class="h2">Présence par agent</h3>' + presence(row) + '</section>' +
      '<section class="dt-sec"><h3 class="h2">Contrôle local</h3>' + ((row.local || []).length
        ? '<p class="sub">Des motifs à risque ont été trouvés dans les fichiers présents sur cette machine.</p>' +
          findings(row.local.map(function (f) { return [f.label, f.file, f.line, f.excerpt]; }))
        : '<p class="sub">Aucun motif connu trouvé dans les fichiers présents sur cette machine.</p>') +
      (SA.live && SA.live.on ? '' : '<p class="mut dt-note">Skill fictif de la machine d’exemple : ces constats illustrent le contrôle local.</p>') + '</section>' +
      ctxSection(row.chars) + '</div>';
    SA.openDrawer(h, 'Détail du skill', 'detail');
  }

  /* ---------- guide d'usage (étape Guide et Mes skills) ---------- */
  function guideHtml(name, desc, real) {
    var on = SA.agentsOn();
    var isClaude = function (a) { return a.id === 'claude' || a.id === 'claude-code'; };
    var claude = on.filter(isClaude);
    var others = on.filter(function (a) { return !isClaude(a); });
    var lines = '';
    if (claude.length) {
      lines += '<li class="gd-ag" data-copy-scope><div><p class="gd-ag-n">Claude Code</p>' +
        '<p class="gd-ag-t sub">Tapez <span class="mono gd-cmd" data-copy-text>/' + esc(name) + '</span>, ou décrivez la tâche : l’agent le charge d’après sa description.</p></div>' +
        '<button type="button" class="btn quiet" data-gd-copy="/' + esc(name) + '" aria-label="Copier la commande">Copier</button></li>';
    }
    if (others.length) {
      lines += '<li class="gd-ag"><div><p class="gd-ag-n">' + esc(others.map(function (a) { return a.name; }).join(', ')) + '</p>' +
        '<p class="gd-ag-t sub">Décrivez la tâche. L’agent choisit le skill d’après sa description. La commande directe, quand elle existe, varie d’un agent à l’autre.</p></div></li>';
    }
    return '<section class="gd-sec" data-st><h2 class="h2">Quand votre agent s’en sert</h2>' +
        (desc
          ? '<p class="gd-when"' + (real ? ' lang="en"' : '') + '>' + (real ? SA.au(desc) : esc(desc)) + '</p>' +
            '<p class="mut dt-note">C’est la description écrite par l’auteur' + (real ? ', non traduite' : '') + '. L’agent la lit pour décider de charger le skill.</p>'
          : '<p class="gd-when">L’agent décide de charger un skill d’après la description écrite par son auteur.</p>' +
            '<p class="mut dt-note">Cette description n’est pas dans la copie de la base ; elle se lit dans le fichier du skill.</p>') + '</section>' +
      '<section class="gd-sec" data-st><h2 class="h2">Comment l’appeler</h2>' +
        (lines ? '<ul class="ledger gd-ags">' + lines + '</ul>' : '<p class="mut">Aucun agent n’est activé.</p>') + '</section>' +
      '<section class="gd-sec" data-st data-copy-scope><h2 class="h2">Pour essayer</h2>' +
        '<div class="gd-try"><p class="gd-q" data-copy-text>Utilise le skill ' + esc(name) + ' pour cette tâche.</p>' +
        '<button type="button" class="btn quiet" data-gd-copy="Utilise le skill ' + esc(name) + ' pour cette tâche." aria-label="Copier la phrase">Copier</button></div></section>';
  }
  function guide(id) {
    var row = SA.mineRow(id), it = SA.item(id), k = SA.det(id);
    var name = it ? it[1] : row ? row.name : id;
    var desc = k && k.d ? k.d : row ? row.desc : '';
    bind();
    SA.openDrawer('<div class="dt"><p class="eye">Guide</p><p class="dt-name mono">' + esc(name) + '</p>' + guideHtml(name, desc, !!(k && k.d)) + '</div>', 'Guide d’usage', 'guide');
  }

  /* ---------- fenêtres de rapport ---------- */
  function ensurePop() {
    if (pop && pop.isConnected) return pop;
    pop = document.createElement('dialog');
    pop.className = 'sr-pop';
    pop.setAttribute('aria-labelledby', 'sr-pop-t');
    pop.addEventListener('click', function (e) {
      var more = e.target.closest ? e.target.closest('[data-pop-detail]') : null;
      if (more) { pop.close(); open(more.getAttribute('data-pop-detail')); return; }
      if (e.target === pop || (e.target.closest && e.target.closest('[data-pop-close]'))) pop.close();
    });
    document.body.appendChild(pop);
    return pop;
  }
  function show(h) {
    var p = ensurePop();
    p.innerHTML = h;
    if (p.showModal) { if (!p.open) p.showModal(); } else p.setAttribute('open', '');
  }

  function openReport(key) {
    var k = SA.det(curId);
    if (!k) return;
    var a = (k.a || [])[Number(key)];
    if (!a) return;
    var sb = STBADGE[a[1]] || ['no', a[1]];
    show('<p class="eye">Audit tiers</p><h2 class="h2" id="sr-pop-t">Rapport de ' + esc(a[0]) + '</h2>' +
      '<dl class="sr-pop-dl">' +
      '<div><dt>Statut</dt><dd><span class="bdg ' + sb[0] + '">' + esc(sb[1]) + '</span></dd></div>' +
      '<div><dt>Niveau de risque</dt><dd class="mono">' + esc(a[2] ? (RISK[a[2]] || a[2]) : 'non précisé') + '</dd></div>' +
      '<div><dt>Date de l’audit</dt><dd class="mono">' + esc(a[3] ? SA.day(a[3]) : 'non précisée') + '</dd></div>' +
      (a[6] && a[6].length ? '<div><dt>Points examinés</dt><dd class="mono sr-pop-cats">' + SA.au(a[6].join(', ').toLowerCase().replace(/_/g, ' ')) + '</dd></div>' : '') +
      '</dl>' +
      (a[4]
        ? '<h3 class="sr-pop-h">Résumé de l’auditeur</h3><p class="sub sr-pop-s" lang="en">' + SA.au(a[4]) + '</p><p class="mut sr-pop-n">Texte d’origine de l’auditeur, non traduit.</p>'
        : '<p class="sub">Le résumé de ce rapport n’est pas dans cette copie de la base.</p>') +
      '<p class="sr-pop-foot"><a class="btn primary" href="' + esc('https://skills.sh/' + curId + (a[5] ? '/security/' + a[5] : '')) + '" target="_blank" rel="noopener">Ouvrir le rapport complet sur skills.sh</a>' +
      '<button type="button" class="btn quiet" data-pop-close>Fermer</button></p>');
  }

  /* Un rapport d'auditeur, en bloc : statut, risque, date, résumé, lien vers le rapport complet. */
  function auditHtml(a, id) {
    var sb = STBADGE[a[1]] || ['no', a[1]];
    var url = 'https://skills.sh/' + id + (a[5] ? '/security/' + a[5] : '');
    return '<section class="sr-pop-sec"><h3 class="sr-pop-h">' + esc(a[0]) + '<span class="bdg ' + sb[0] + '">' + esc(sb[1]) + '</span></h3>' +
      '<p class="mono mut sr-pop-f">Niveau de risque : ' + esc(a[2] ? (RISK[a[2]] || a[2]) : 'non précisé') + (a[3] ? ' · audit du ' + SA.day(a[3]) : '') + '</p>' +
      (a[4] ? '<p class="sub sr-pop-s" lang="en">' + SA.au(a[4]) + '</p>' : '<p class="sub sr-pop-s">Le résumé de ce rapport n’est pas dans cette copie de la base.</p>') +
      '<p class="sr-pop-lk"><a class="lnk" href="' + esc(url) + '" target="_blank" rel="noopener">Ouvrir ce rapport sur skills.sh</a></p></section>';
  }

  /* Depuis une ligne de liste : tous les rapports qui motivent l'avertissement, dans une seule fenêtre. */
  function warnings(id) {
    var k = SA.det(id), it = SA.item(id);
    if (!k || !it) return;
    curId = id;
    bind();
    var bad = (k.a || []).filter(function (a) { return a[1] !== 'pass'; });
    var fd = (k.fd || []).filter(function (f) { return f[4] !== 'low'; });
    var scanWarn = k.w.some(function (w) { return /^SCAN_/.test(w[2] || ''); });
    var others = k.w.filter(function (w) { return w[0] !== 'info' && !/^(AUDIT_|SCAN_)/.test(w[2] || ''); });
    var h = '<p class="eye">Avertissements</p><h2 class="h2" id="sr-pop-t">' + esc(it[1]) + '</h2><p class="mono mut sr-pop-f">' + esc(it[2]) + '</p>';
    h += bad.map(function (a) { return auditHtml(a, id); }).join('');
    if (scanWarn) {
      h += '<section class="sr-pop-sec"><h3 class="sr-pop-h">Notre contrôle</h3>' +
        (fd.length ? findings(fd) : '<p class="sub sr-pop-s">' + esc(VERD[k.v] || '') + '</p>') + '</section>';
    }
    if (others.length) {
      h += '<section class="sr-pop-sec"><h3 class="sr-pop-h">Autres points</h3>' + others.map(function (w) { return '<p class="sub sr-pop-s">' + SA.au(w[1]) + '</p>'; }).join('') + '</section>';
    }
    h += '<p class="mut sr-pop-n">Un avertissement n’empêche pas l’installation. Vous décidez.</p>' +
      '<p class="sr-pop-foot"><button type="button" class="btn primary" data-pop-detail="' + esc(id) + '">Voir le détail complet</button>' +
      '<button type="button" class="btn quiet" data-pop-close>Fermer</button></p>';
    show(h);
  }

  /* Les boutons du tiroir vivent hors des vues : une seule écoute, au document. */
  function bind() {
    if (bound || !document.addEventListener) return;
    bound = true;
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      var b = t.closest('[data-rep]');
      if (b) { openReport(b.getAttribute('data-rep')); return; }
      var c = t.closest('[data-gd-copy]');
      if (c) { SA.copy(c.getAttribute('data-gd-copy'), c); return; }
      var g = t.closest('[data-guide]');
      if (g) { guide(g.getAttribute('data-guide')); return; }
      var l = t.closest('[data-local]');
      if (l) { var r = SA.mineRow(l.getAttribute('data-local')); if (r) openLocal(r); }
    });
  }

  SA.detail = {
    open: open, warnings: warnings, guide: guide, guideHtml: guideHtml, badge: badge, ctxText: ctxText,
    html: detailHtml, bind: bind, CUT: CUT,
    local: function (id) { var r = SA.mineRow(id); if (r) openLocal(r); }
  };
  bind();
})();
