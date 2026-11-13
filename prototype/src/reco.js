/* Skill Advisor prototype: moteur de recommandation sur la base réelle (SA.search).
   Fonction pure : SA.reco.rank(objectif, réponses) renvoie la liste classée, avec la raison de chaque proposition.
   Une réponse « compte » pour un skill si un de ses mots-clés est dans le nom (3 points), dans la description
   de l'auteur (2 points), ou si le skill est dans une catégorie liée à la réponse (2 points).
   Les mots-clés sont comparés mot entier : « ios » ne correspond pas à « axios ».
   Un mot-clé précédé de « = » n'est cherché que dans le nom : il est trop courant pour une description. */
(function () {
  window.SA = window.SA || {};
  var SA = window.SA;

  var MAP = {
    site: {
      base: ['site-design', 'frontend', 'ux', 'marketing'],
      type: {
        vitrine: { cats: ['site-design'] },
        boutique: { cats: ['ecommerce'], kw: ['shopify', 'ecommerce', 'e-commerce', 'stripe', 'woocommerce', '=checkout'] },
        blog: { kw: ['blog', 'copywriting', '=content', '=writing'] },
        landing: { kw: ['landing', 'conversion', 'cro'] },
        webapp: { cats: ['frontend'] }
      },
      tech: {
        next: { kw: ['next.js', 'nextjs', '=next'] },
        astro: { kw: ['astro'] },
        wordpress: { kw: ['wordpress', 'woocommerce', 'php', '=wp'] },
        html: { kw: ['html', 'css', 'tailwind'] }
      },
      host: {
        vercel: { kw: ['vercel'] },
        cloudflare: { kw: ['cloudflare', 'wrangler', '=workers'] },
        mutu: { kw: ['php', 'wordpress'] }
      },
      needs: {
        design: { cats: ['site-design', 'ux'] },
        seo: { kw: ['seo', 'schema.org', '=schema'] },
        perf: { kw: ['performance', 'vitals', 'lighthouse', '=perf'] },
        a11y: { kw: ['accessibility', 'a11y', 'wcag'] },
        contenu: { kw: ['copywriting', '=content', '=writing', '=copy'] }
      }
    },
    app: {
      base: ['tests', 'methode'],
      type: {
        mobile: { cats: ['mobile'] },
        bureau: { cats: ['desktop-jeu'] },
        web: { cats: ['frontend'] },
        cli: { kw: ['cli', 'terminal', '=shell', '=bash'] },
        api: { cats: ['backend'], kw: ['api', 'graphql'] }
      },
      os: {
        ios: { kw: ['ios', 'swift', 'swiftui', 'xcode', 'apple'] },
        android: { kw: ['android', 'kotlin', 'jetpack'] },
        windows: { kw: ['dotnet', 'winui', 'wpf', 'csharp', '=windows'] },
        macos: { kw: ['swiftui', 'appkit', 'swift', '=macos'] },
        linux: { kw: ['=linux', 'gtk'] },
        multi: { kw: ['cross-platform', 'multiplatform', 'flutter', 'react-native', 'expo', 'electron', 'tauri'] }
      },
      tech: {
        swiftui: { kw: ['swiftui', 'swift'] },
        rn: { kw: ['react-native', 'react native', 'expo'] },
        flutter: { kw: ['flutter', 'dart'] },
        kotlin: { kw: ['kotlin', 'jetpack'] },
        electron: { kw: ['electron'] }
      },
      needs: {
        ui: { cats: ['ux', 'site-design'] },
        tests: { cats: ['tests'], kw: ['tdd', 'e2e', 'playwright', '=test', '=testing', '=tests'] },
        archi: { kw: ['architecture', '=architect', '=patterns'] },
        secu: { cats: ['securite'], kw: ['=security', '=secure', '=auth'] },
        ci: { cats: ['devops'], kw: ['ci', 'deploy', 'deployment', 'release', '=pipeline'] }
      }
    },
    data: {
      base: ['data', 'database', 'documents'],
      source: {
        csv: { kw: ['csv', 'excel', 'xlsx', 'spreadsheet'] },
        sql: { cats: ['database'], kw: ['sql', 'postgres', 'postgresql', 'mysql', 'sqlite'] },
        api: { kw: ['api'] },
        pdf: { kw: ['pdf'] }
      },
      tool: {
        python: { kw: ['python', 'pandas', 'jupyter', 'notebook'] },
        sql: { kw: ['sql', 'postgres', 'postgresql'] },
        r: { kw: ['rstats', 'tidyverse', 'ggplot', '=r'] },
        tableur: { kw: ['xlsx', 'excel', 'spreadsheet', 'sheets'] }
      },
      out: {
        dash: { kw: ['dashboard', 'dashboards'] },
        rapport: { kw: ['docx', 'pptx', 'pdf', '=report', '=reports'] },
        graph: { kw: ['chart', 'charts', 'visualization', 'dataviz', 'd3', '=plot'] },
        modele: { kw: ['machine-learning', 'ml', 'forecast', 'prediction', 'scikit'] }
      },
      needs: {
        clean: { kw: ['cleaning', 'etl', 'data-cleaning'] },
        viz: { kw: ['visualization', 'chart', 'charts', 'dataviz', 'dashboard'] },
        stats: { kw: ['statistics', 'statistical', 'analytics', '=analysis'] },
        auto: { kw: ['automation', 'automate', '=pipeline', '=scheduled'] }
      }
    }
  };

  function db() { return SA.search || { items: [], cats: [], details: {} }; }

  var reCache = {};
  function re(kw) {
    if (!reCache[kw]) {
      var body = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-\s]/g, '[-\\s]?');
      reCache[kw] = new RegExp('(^|[^a-z0-9])' + body + '($|[^a-z0-9])');
    }
    return reCache[kw];
  }

  var idx = null, catIx = null;
  function build() {
    if (idx) return;
    idx = {}; catIx = {};
    var d = db();
    d.cats.forEach(function (c, i) { catIx[c.id] = i; });
    d.items.forEach(function (it) { idx[it[0]] = it; });
  }

  /* Points d'une réponse pour un skill : 3 nom, 2 description ou catégorie, 0 sinon. */
  function points(rule, it, name, desc) {
    var best = 0, i;
    var kw = rule.kw || [];
    for (i = 0; i < kw.length && best < 3; i++) {
      var only = kw[i].charAt(0) === '=', k = only ? kw[i].slice(1) : kw[i];
      if (re(k).test(name)) best = 3;
      else if (!only && best < 2 && desc && re(k).test(desc)) best = 2;
    }
    if (best < 2) {
      var cats = rule.cats || [];
      for (i = 0; i < cats.length; i++) if (it[4].indexOf(catIx[cats[i]]) > -1) { best = 2; break; }
    }
    return best;
  }

  function optLabel(goal, qid, v) {
    var g = (SA.data && SA.data.goals || {})[goal], out = String(v);
    ((g && g.qs) || []).forEach(function (q) {
      if (q.id !== qid) return;
      q.opts.forEach(function (o) { if (o[0] === v) out = o[1]; });
    });
    return out;
  }

  SA.reco = {
    map: MAP,
    item: function (id) { build(); return idx[id] || null; },

    /* → [{ id, it, rel, why: [libellés des réponses reconnues], base: libellé de catégorie ou '' }] */
    rank: function (goal, answers) {
      build();
      var m = MAP[goal];
      if (!m) return [];
      var d = db(), out = [];
      answers = answers || {};
      var baseIx = m.base.map(function (c) { return catIx[c]; });
      d.items.forEach(function (it) {
        var k = d.details[it[0]];
        /* Le conseil ne propose que des skills notés ET contrôlés (fiche complète) : note, description, contrôle, audits.
           Les autres restent visibles dans la Recherche. */
        if (it[6] == null || !k) return;
        var name = (it[1] + ' ' + it[2]).toLowerCase();
        var desc = k && k.d ? k.d.toLowerCase() : '';
        var rel = 0, why = [], base = '';
        Object.keys(m).forEach(function (qid) {
          if (qid === 'base') return;
          var a = answers[qid];
          if (a == null || a === '') return;
          (Array.isArray(a) ? a : [a]).forEach(function (v) {
            var rule = m[qid][v];
            if (!rule) return;
            var p = points(rule, it, name, desc);
            if (p) { rel += p; why.push(optLabel(goal, qid, v)); }
          });
        });
        for (var i = 0; i < baseIx.length; i++) {
          if (it[4].indexOf(baseIx[i]) > -1) { rel += 1; base = d.cats[baseIx[i]].label; break; }
        }
        if (!rel) return;
        out.push({ id: it[0], it: it, rel: rel, why: why, base: base });
      });
      /* Une réponse reconnue de plus pèse environ 30 points de note. */
      out.sort(function (a, b) {
        return (b.rel * 12 + b.it[6]) - (a.rel * 12 + a.it[6]) || b.it[3] - a.it[3];
      });
      return out;
    }
  };
})();
