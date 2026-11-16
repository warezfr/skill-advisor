/* Skill Advisor — vue « résultats » (étape 3 : recommandations).
   Les propositions viennent de la base réelle, classées par SA.reco.rank d'après les réponses. */
(function () {
  var SA = window.SA = window.SA || {};
  SA.views = SA.views || {};

  var PAGE = 12;
  var timer = 0;

  function here() { return SA.viewId() === 'resultats'; }
  function ranked() { return SA.reco.rank(SA.state.goal, SA.state.answers); }
  function shown() { var s = SA.state; s.recoShown = s.recoShown || PAGE; return s.recoShown; }

  function whyText(r) {
    return r.why.length ? 'Correspond à vos réponses : ' + r.why.join(', ') + '.' : 'Bien noté dans la catégorie « ' + r.base + ' ».';
  }

  /* Pré-sélection : les trois premiers qui répondent à une réponse précise, sans avertissement élevé, ni liés à une autre option, ni à installer à la main,
     une fois par jeu de réponses. De nouvelles réponses retirent d'abord les ajouts automatiques restés tels quels ;
     ensuite, rien n'est ajouté si la sélection n'est pas vide. Une sélection vidée exprès n'est pas remplie de nouveau. */
  function eligible(r) { return r.why.length > 0 && r.it[7] !== 2 && !(r.off && r.off.length) && !SA.mineRow(r.id) && !SA.reco.manual(r.id); }
  function ensurePreselect(list) {
    var st = SA.state, key = st.goal + ':' + JSON.stringify(st.answers);
    if (st.preselected[key]) return;
    st.preselected[key] = true;
    if (SA.cart.dropAuto) SA.cart.dropAuto();
    if (SA.cart.count()) return;
    list.filter(eligible).slice(0, 3).forEach(function (r) { (SA.cart.addAuto || SA.cart.add)(r.id); });
  }
  /* Nouveau projet ou autre objectif : la présélection de l'ancien part, les choix faits à la main restent. */
  function resetAuto() {
    if (SA.cart.dropAuto) SA.cart.dropAuto();
    SA.state.preselected = {};
  }

  function row(r) {
    var it = r.it, id = r.id, k = SA.det(id), inst = !!SA.mineRow(id), man = !inst && SA.reco.manual(id), on = !inst && !man && SA.cart.has(id);
    var why = r.why.length
      ? r.why.map(function (w) { return '<span class="tag rs-chip">' + SA.esc(w) + '</span>'; }).join('')
      : '<span class="rs-base sub">Bien noté dans « ' + SA.esc(r.base) + ' »</span>';
    var cb = inst
      ? '<button type="button" class="cb rs-cb" role="checkbox" aria-checked="false" disabled aria-label="' + SA.esc(it[1]) + ' : déjà installé">' + SA.icon('check') + '</button>'
      : man
        ? '<button type="button" class="cb rs-cb" role="checkbox" aria-checked="false" disabled aria-label="' + SA.esc(it[1]) + ' : installation à la main">' + SA.icon('check') + '</button>'
        : '<button type="button" class="cb rs-cb" role="checkbox" aria-checked="' + on + '" data-cart-add="' + SA.esc(id) + '" aria-label="Sélectionner ' + SA.esc(it[1]) + '">' + SA.icon('check') + '</button>';
    return '<li class="rs-row' + (on ? ' is-on' : '') + (inst ? ' rs-inst' : '') + (man ? ' rs-man' : '') + (r.off && r.off.length ? ' rs-off' : '') + '" data-row data-id="' + SA.esc(id) + '" data-st>' +
      cb +
      '<div class="rs-main">' +
        '<div class="rs-head"><span class="rs-name mono">' + SA.esc(it[1]) + '</span>' + (inst ? '<span class="bdg ok">Installé</span>' : man ? '<span class="bdg no">Installation à la main</span>' : '') + '</div>' +
        '<p class="rs-src mono mut">' + SA.esc(it[2]) + (it[5] ? ' · officielle' : '') + '</p>' +
        (man ? '<p class="rs-man-t sub">' + SA.esc(man) + ' <a class="lnk" href="https://skills.sh/' + SA.esc(id) + '" target="_blank" rel="noopener">Ouvrir skills.sh</a></p>' : '') +
        (k && k.d ? '<p class="rs-desc sub" lang="en">' + SA.au(k.d) + '</p>' : '') +
        '<p class="rs-why"><span class="rs-why-l">Pourquoi pour vous</span>' + why + '</p>' +
        (r.off && r.off.length ? '<p class="rs-offt sub">Concerne plutôt : ' + SA.esc(r.off.join(', ')) + '. Il passe donc après les autres.</p>' : '') +
        '<div class="rs-meta"><span class="mono"><span class="num">' + SA.short(it[3]) + '</span> <span class="mut">installations</span></span>' + SA.detail.badge(it[7], id) + '</div>' +
      '</div>' +
      '<div class="rs-score">' +
        '<p class="rs-total"><span class="num" data-count="' + it[6] + '">' + it[6] + '</span><span class="rs-of mut">sur 100</span></p>' +
        (k ? SA.scoreBar(k.sc) : '') +
        '<button type="button" class="lnk rs-more" data-rs-detail="' + SA.esc(id) + '">Voir le détail</button>' +
      '</div>' +
    '</li>';
  }

  function skeleton() {
    var one = '<li class="rs-row rs-skl" aria-hidden="true"><span class="rs-skl-cb skl"></span><div class="rs-main"><p class="skl rs-skl-a">nom</p><p class="skl rs-skl-b">description</p><p class="skl rs-skl-c">raison</p></div><div class="rs-score"><p class="skl rs-skl-d">00</p></div></li>';
    return '<p class="eye" data-st>Étape 03 · Recommandations</p>' +
      SA.h('Lecture de la base') +
      '<p class="lede" role="status" data-st>' + SA.nb(Object.keys((SA.search || {}).details || {}).length) + ' skills notés. Classement d’après vos réponses…</p>' +
      '<ul class="ledger rs-list">' + one + one + one + one + '</ul>';
  }

  function banner() {
    if (!SA.offline()) return '';
    return '<div class="note note-warn" role="status" data-st><p class="note-t">Hors ligne</p>' +
      '<p class="sub">Pas de réseau. Ces propositions viennent de la base déjà chargée : ' + SA.esc(SA.baseLabel()) + '. L’installation demandera le réseau.</p></div>';
  }

  function onClick(e) {
    var po = e.target && e.target.closest ? e.target.closest('[data-plug-open]') : null;
    if (po) {
      var s0 = SA.state;
      s0.pl = s0.pl || {};
      s0.pl.tab = 'cat';
      s0.pl.cq = String(po.getAttribute('data-plug-open'));
      if (SA.setRoute) SA.setRoute('plugins');
      return;
    }
    var mo = e.target && e.target.closest ? e.target.closest('[data-mcp-open]') : null;
    if (mo) {
      var s = SA.state;
      s.mc = s.mc || {};
      s.mc.tab = 'cat';
      s.mc.cq = String(mo.getAttribute('data-mcp-open')).split('/').pop();
      if (SA.setRoute) SA.setRoute('mcp');
      return;
    }
    if (!here()) return;
    var d = e.target.closest('[data-rs-detail]');
    if (d) {
      var id = d.getAttribute('data-rs-detail'), why = '';
      ranked().some(function (r) { if (r.id === id) { why = whyText(r); return true; } return false; });
      SA.detail.open(id, why);
      return;
    }
    if (e.target.closest('#rs-more')) { SA.state.recoShown = shown() + PAGE; SA.repaint(); return; }
    /* The whole row is the toggle target; buttons and links inside keep their own action. */
    var r = e.target.closest('.rs-row');
    if (r && !r.classList.contains('rs-inst') && !r.classList.contains('rs-man') && !e.target.closest('button, a')) {
      var sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length) return;
      SA.cart.toggle(r.getAttribute('data-id'));
      SA.sync();
    }
  }

  /* Serveurs MCP conseillés pour le même objectif : les six premiers, avec un lien vers le catalogue MCP. */
  function mcpHTML() {
    var st = SA.state, l = SA.reco.mcp ? SA.reco.mcp(st.goal, st.answers).slice(0, 6) : [];
    if (!l.length) return '';
    return '<section class="rs-mcp" data-st aria-labelledby="rs-mcp-t"><h2 class="h2" id="rs-mcp-t">Serveurs MCP conseillés</h2>' +
      '<p class="sub">Un serveur MCP donne à vos agents un outil de plus (une base, un service, un navigateur). Installez-le depuis l’écran Serveurs MCP.</p>' +
      '<ul class="ledger rs-list">' + l.map(function (r) {
        var e = r.e, nm = e.title || String(e.id).split('/').pop(), sc = (e.score || {}).total;
        return '<li class="rs-mcp-i"><p class="rs-mcp-n"><span>' + SA.esc(nm) + '</span>' + (sc != null ? ' <span class="mut">' + sc + '/100</span>' : '') + '</p>' +
          (e.description ? '<p class="sub">' + SA.esc(e.description) + '</p>' : '') +
          (r.why.length ? '<p class="mut rs-why">Pour : ' + SA.esc(r.why.join(', ')) + '</p>' : '') +
          '<p><button type="button" class="btn quiet" data-mcp-open="' + SA.esc(e.id) + '">Voir dans le catalogue MCP</button></p></li>';
      }).join('') + '</ul></section>' + plugHTML();
  }
  /* Plugins conseillés (Claude Code, Copilot CLI) : les quatre premiers, avec un lien vers le catalogue des plugins. */
  function plugHTML() {
    var st = SA.state, l = SA.reco.plugins ? SA.reco.plugins(st.goal, st.answers).slice(0, 4) : [];
    if (!l.length) return '';
    return '<section class="rs-mcp" data-st aria-labelledby="rs-pl-t"><h2 class="h2" id="rs-pl-t">Plugins conseillés</h2>' +
      '<p class="sub">Un plugin regroupe des skills, des commandes et des serveurs MCP pour un agent. Installez-le depuis l’écran Plugins.</p>' +
      '<ul class="ledger rs-list">' + l.map(function (r) {
        var e = r.e, sc = (e.score || {}).total;
        return '<li class="rs-mcp-i"><p class="rs-mcp-n"><span>' + SA.esc(e.title || e.name) + '</span>' + (sc != null ? ' <span class="mut">' + sc + '/100</span>' : '') + '</p>' +
          (e.description ? '<p class="sub">' + SA.esc(e.description) + '</p>' : '') +
          '<p><button type="button" class="btn quiet" data-plug-open="' + SA.esc(e.name) + '">Voir dans le catalogue des plugins</button></p></li>';
      }).join('') + '</ul></section>';
  }

  SA.views.resultats = {
    resetAuto: resetAuto,
    render: function () {
      var st = SA.state;
      if (!st.goal || !SA.answered()) {
        return '<p class="eye" data-st>Étape 03 · Recommandations</p>' + SA.h('Il manque vos réponses') +
          '<div class="empty" data-st><p class="sub">Les recommandations se calculent d’après votre objectif et vos réponses.</p>' +
          '<p class="empty-a"><button type="button" class="btn primary" data-go-step="' + (st.goal ? 2 : 1) + '">Répondre aux questions</button>' +
          '<button type="button" class="btn" data-go-route="recherche">Chercher sans questionnaire</button></p></div>';
      }
      if (!st.dbReady) return skeleton();
      var list = ranked();
      ensurePreselect(list);
      var n = Math.min(list.length, shown());
      var rest = list.length - n;
      return '<p class="eye" data-st>Étape 03 · Recommandations</p>' +
        SA.h(SA.pl(n, 'skill', 'skills') + ' pour votre projet') +
        '<p class="lede" data-st>' + SA.nb(list.length) + ' skills notés correspondent. Ils sont classés d’après vos réponses, puis par note. Ouvrez un skill pour lire le détail de sa note et de ses contrôles.</p>' +
        banner() +
        '<ul class="ledger rs-list">' + list.slice(0, n).map(row).join('') + '</ul>' +
        '<p class="rs-foot" data-st>' +
          (rest > 0 ? '<button type="button" class="btn" id="rs-more">Afficher ' + Math.min(PAGE, rest) + ' de plus</button>' : '') +
          '<button type="button" class="lnk" data-go-route="recherche">Chercher dans toute la base</button></p>' +
        mcpHTML();
    },

    mount: function (root) {
      clearTimeout(timer);
      if (SA.countUp) SA.countUp(root);
      root.addEventListener('click', onClick);
      if (!SA.state.dbReady && SA.state.goal && SA.answered()) {
        timer = setTimeout(function () {
          SA.state.dbReady = true;
          if (root.isConnected && here()) SA.repaint();
        }, SA.rm ? 0 : 700);
      }
    },

    actions: function () {
      var n = SA.cart.count();
      return [
        { label: 'Retour', kind: 'default', on: function () { SA.go(2, -1); } },
        {
          label: n ? 'Installer ' + SA.pl(n, 'skill', 'skills') : 'Choisissez au moins un skill',
          kind: 'primary', kbd: '↵', disabled: n === 0,
          on: function () { if (SA.cart.count()) SA.go(4, 1); }
        }
      ];
    }
    /* Enter is owned by core (it clicks the primary action), so this view has no keys(). */
  };
})();
