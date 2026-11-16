/* Skill Advisor prototype: moteur de recommandation sur la base réelle (SA.search).
   Fonction pure : SA.reco.rank(objectif, réponses) renvoie la liste classée, avec la raison de chaque proposition.
   Une réponse « compte » pour un skill si un de ses mots-clés est dans le nom (3 points), dans la description
   de l'auteur (2 points), ou si le skill est dans une catégorie liée à la réponse (2 points).
   Les mots-clés sont comparés mot entier : « ios » ne correspond pas à « axios ».
   Un mot-clé précédé de « = » n'est cherché que dans le nom : il est trop courant pour une description.
   Options qui s'excluent (EXCL) : un skill nommé d'après une autre option que celle choisie passe après tous les autres. */
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
    },
    /* Objectifs par catégorie. Le nom comparé inclut la source (« vercel-labs/agent-skills ») :
       pas de mot-clé « agent », « skills », « ai », « web », « docs », « ui » seul, ils touchent des sources entières. */
    frontend: {
      base: ['frontend', 'ux'],
      fw: {
        react: { kw: ['react'] },
        next: { kw: ['next.js', 'nextjs', '=next'] },
        vue: { kw: ['vue', 'vue.js', 'vuejs', 'nuxt'] }
      },
      host: {
        vercel: { kw: ['vercel-react', 'vercel/next.js', 'deploy-to-vercel'] },
        cloudflare: { kw: ['cloudflare workers', 'nextjs-on-cloudflare', 'wrangler', '=workers'] }
      },
      needs: {
        perf: { kw: ['performance', 'turbopack', '=cache', 'caching'] },
        anim: { kw: ['gsap', 'animation', 'animations', 'view transition'] },
        types: { kw: ['typescript'] },
        auth: { kw: ['clerk', '=auth', 'authentication'] }
      }
    },
    mobile: {
      base: ['mobile', 'ux'],
      os: {
        ios: { kw: ['ios', 'swift', 'swiftui', 'iphone', 'testflight', 'xcode'] },
        android: { kw: ['android', 'kotlin'] },
        multi: { kw: ['react-native', 'expo', 'flutter', 'cross-platform'] }
      },
      tech: {
        swift: { kw: ['swift', 'swiftui', 'uikit'] },
        rn: { kw: ['react-native', 'expo'] },
        flutter: { kw: ['flutter', 'dart'] }
      },
      needs: {
        design: { kw: ['design-mobile-apps', 'ios-design', 'screens', 'layout', 'nativewind'] },
        anim: { kw: ['animation', 'animations', 'animate', '=motion'] },
        tests: { kw: ['=test', 'e2e', 'widgettester', 'testflight'] },
        archi: { kw: ['architecture', '=architect', 'expo modules', '=module'] }
      }
    },
    backend: {
      base: ['backend', 'database'],
      lang: {
        node: { kw: ['node.js', 'nodejs', 'nestjs', 'express', 'fastify'] },
        go: { kw: ['golang', '=go'] },
        rust: { kw: ['rust', 'tokio'] },
        python: { kw: ['python', 'django', 'fastapi', 'flask'] },
        java: { kw: ['java', 'spring boot', 'springboot'] }
      },
      api: {
        rest: { kw: ['rest', 'restful', 'api-design'] },
        graphql: { kw: ['graphql'] }
      },
      needs: {
        archi: { kw: ['architecture', '=patterns', 'api design'] },
        tests: { kw: ['=testing', 'tdd', 'test-driven', 'unit tests', 'integration tests'] },
        secu: { cats: ['securite'], kw: ['=security'] },
        db: { cats: ['database'] }
      }
    },
    database: {
      base: ['database', 'backend'],
      engine: {
        postgres: { kw: ['postgres', 'postgresql', 'supabase', 'neon'] },
        mongo: { kw: ['mongodb', 'mongo'] }
      },
      tool: {
        prisma: { kw: ['prisma'] },
        supabase: { kw: ['supabase'] },
        neon: { kw: ['neon', 'neondatabase'] },
        sql: { kw: ['sql', '=query', 'queries'] }
      },
      needs: {
        schema: { kw: ['table-design', 'schema design', 'data types', '=schema'] },
        perf: { kw: ['sql-optimization', 'query optimization', 'indexing', 'database performance'] },
        migr: { kw: ['database-migration', 'zero-downtime', 'prisma-upgrade', 'mongodb-upgrade', 'schema migrations', 'migration guide'] }
      }
    },
    ia: {
      base: ['ia'],
      type: {
        agent: { kw: ['agents sdk', 'subagent', 'adk', 'agents-cli', 'autonomous', 'create an agent'] },
        mcp: { kw: ['mcp', 'model context protocol'] },
        app: { kw: ['ai sdk', 'llm', 'llms', 'claude api', 'anthropic sdk', 'ai-powered'] },
        rag: { kw: ['rag', 'retrieval', 'vector', 'semantic search'] }
      },
      sdk: {
        claude: { kw: ['claude api', 'anthropic sdk'] },
        aisdk: { kw: ['ai sdk', 'vercel/ai'] },
        adk: { kw: ['adk', 'agents-cli'] },
        cloudflare: { kw: ['agents sdk', 'cloudflare agents'] }
      },
      needs: {
        prompt: { kw: ['prompt', 'prompts'] },
        eval: { kw: ['eval', 'evals', 'evaluation', 'evaluate my agent'] },
        browser: { kw: ['browser', 'navigating', 'scraping'] }
      }
    },
    tests: {
      base: ['tests'],
      type: {
        tdd: { kw: ['tdd', 'test-driven', 'red-green'] },
        review: { kw: ['review', 'code-review'] },
        debug: { kw: ['=debug', 'debugging', 'traceback', 'root cause'] },
        e2e: { kw: ['playwright', 'e2e', 'webapp-testing', 'browser'] }
      },
      code: {
        web: { kw: ['webapp', 'web pages', 'web applications', 'playwright'] },
        go: { kw: ['golang-testing'] },
        rust: { kw: ['rust-testing'] },
        mobile: { kw: ['mobile e2e', 'widgettester'] }
      },
      needs: {
        qa: { kw: ['qa', 'github issues'] },
        ab: { kw: ['a/b', 'ab-testing', 'experiment'] },
        secu: { cats: ['securite'], kw: ['=security'] }
      }
    },
    devops: {
      base: ['devops'],
      cloud: {
        azure: { kw: ['azure'] },
        aws: { kw: ['aws', 'lambda', 'eks'] },
        cloudflare: { kw: ['wrangler', 'cloudflare workers', '=workers'] },
        vercel: { kw: ['deploy-to-vercel', 'vercel cli', 'vercel deployment'] }
      },
      tool: {
        docker: { kw: ['docker', 'dockerfile', 'containerized', 'docker compose'] },
        k8s: { kw: ['kubernetes', 'eks', 'k8s'] },
        ci: { kw: ['github actions', 'github-actions', '=ci', 'ci/cd'] },
        serverless: { kw: ['serverless', 'lambda', '=workers', '=functions'] }
      },
      needs: {
        deploy: { kw: ['deploy', 'deployment', 'deployments'] },
        monitor: { kw: ['diagnostics', 'troubleshoot', 'telemetry', 'monitoring', 'log analytics'] },
        secu: { cats: ['securite'], kw: ['=security'] },
        infra: { kw: ['terraform', 'bicep', 'infrastructure as code', 'iac'] }
      }
    },
    securite: {
      base: ['securite'],
      type: {
        audit: { kw: ['security-audit', 'auditor', 'vulnerability', 'vulnerabilities', 'hardening'] },
        auth: { kw: ['auth', 'authentication', 'oauth', 'passkeys', 'sign-in'] },
        threat: { kw: ['threat', 'threats', 'mitigation', 'mitigations'] }
      },
      stack: {
        firebase: { kw: ['firebase'] },
        convex: { kw: ['convex'] },
        betterauth: { kw: ['better-auth'] },
        gcloud: { kw: ['google-cloud'] },
        azure: { kw: ['azure-compliance', 'key vault'] }
      },
      needs: {
        access: { kw: ['rbac', 'authorization', 'iam', 'privilege', 'security rules'] },
        sessions: { kw: ['session management', 'secure sessions', 'sessions', 'secrets'] },
        web: { kw: ['csrf', 'xss', 'injection', 'waf'] }
      }
    },
    marketing: {
      base: ['marketing'],
      goal: {
        seo: { kw: ['seo'] },
        content: { kw: ['copywriting', 'content-strategy', '=copy', '=content'] },
        email: { kw: ['email', 'cold-email', 'outbound'] },
        brand: { kw: ['brand', 'branding'] }
      },
      channel: {
        web: { kw: ['seo', 'search engine', '=schema'] },
        ai: { kw: ['ai-seo', 'geo', 'chatgpt', 'perplexity'] },
        mail: { kw: ['email', 'inbox', 'deliverability', 'subscribers'] }
      },
      needs: {
        ideas: { kw: ['marketing-ideas', 'growth', 'psychology'] },
        audit: { kw: ['seo-audit', 'diagnose'] },
        scale: { kw: ['programmatic', 'at scale'] },
        edit: { kw: ['copy-editing', 'proofread', 'tighten'] }
      }
    },
    documents: {
      base: ['documents', 'data'],
      format: {
        docx: { kw: ['docx', 'word'] },
        pptx: { kw: ['pptx', 'slides', 'presentation', 'presentations', 'powerpoint'] },
        xlsx: { kw: ['xlsx', 'excel', 'spreadsheet'] },
        pdf: { kw: ['pdf'] }
      },
      act: {
        create: { kw: ['=create', 'from scratch', 'create, read', 'create and edit', 'create strategic'] },
        read: { kw: ['extracting', 'extract text', 'reading', 'ocr', 'view-pdf'] },
        convert: { kw: ['convert', 'converting', 'convert-documents'] }
      },
      needs: {
        gws: { kw: ['gws', 'google slides', 'google workspace'] },
        html: { kw: ['html presentations', 'html-slides'] },
        ocr: { kw: ['ocr', 'redact'] }
      }
    },
    ux: {
      base: ['ux', 'site-design'],
      type: {
        system: { kw: ['design-system', 'design tokens'] },
        anim: { kw: ['animation', 'animations', 'animate', 'motion'] },
        a11y: { kw: ['accessibility', 'a11y', 'aria', 'wcag'] },
        type: { kw: ['typography', 'type scale', '=font', '=fonts'] }
      },
      tech: {
        css: { kw: ['css', 'tailwind'] },
        react: { kw: ['react'] },
        rn: { kw: ['react-native', 'expo'] },
        three: { kw: ['three.js', 'threejs', 'webgl'] }
      },
      needs: {
        review: { kw: ['reviews', '=improve', 'review-animations'] },
        perf: { kw: ['animation-performance', 'frame budget', 'main thread', '=perf'] },
        tokens: { kw: ['design tokens', 'token architecture', 'token files'] }
      }
    },
    ecommerce: {
      base: ['ecommerce'],
      platform: {
        shopify: { kw: ['shopify'] },
        stripe: { kw: ['stripe'] },
        wordpress: { kw: ['wordpress', 'woocommerce', '=wp'] }
      },
      pay: {
        card: { kw: ['card', 'cards', 'checkout', 'payment', 'payments'] },
        sub: { kw: ['checkout, subscriptions', 'recurring'] },
        agent: { kw: ['x402', 'agent payments', 'agent-payment', 'a2a-pay'] }
      },
      needs: {
        shop: { kw: ['storefront', 'cart', '=admin', 'customer'] },
        intl: { kw: ['cross-border', 'international', 'markets'] },
        upgrade: { kw: ['upgrade-stripe', 'api versions'] }
      }
    },
    methode: {
      base: ['methode', 'tests'],
      type: {
        plan: { kw: ['writing-plans', 'executing-plans', '=plan', 'spec', 'implementation plan', 'sharpen a plan'] },
        git: { kw: ['git', 'commit', 'commits', 'worktrees'] },
        docs: { kw: ['adr', 'grill-with-docs', 'documentation', 'markdown file'] },
        handoff: { kw: ['handoff', 'hand off', 'summary'] }
      },
      needs: {
        skills: { kw: ['find-skills', 'writing-skills', 'discover and install'] },
        archi: { kw: ['architecture', '=architect'] },
        research: { kw: ['research', 'investigate', 'primary sources'] },
        meeting: { kw: ['meeting', 'standup'] }
      }
    },
    'desktop-jeu': {
      base: ['desktop-jeu'],
      engine: {
        three: { kw: ['three.js', 'threejs', 'webgl', '=three'] },
        godot: { kw: ['godot', 'gdscript'] },
        unity: { kw: ['unity'] },
        web: { kw: ['html5', 'canvas', 'browser games', 'browser game'] }
      },
      type: {
        scene: { kw: ['scene', 'scenes', 'geometry', 'materials', 'camera'] },
        game: { kw: ['game', 'games', 'playable', 'gamedev'] },
        anim: { kw: ['threejs-animation', 'godot-animation', 'animationplayer', 'skeletal', 'keyframe', 'tween'] }
      },
      needs: {
        ui: { kw: ['hud', 'huds', 'menus', 'game-ui'] },
        feel: { kw: ['game-feel', 'juice', 'screen shake', 'hit-stop'] },
        fx: { kw: ['shaders', 'shader', 'postprocessing', 'post-processing', 'effects'] },
        assets: { kw: ['sprites', 'textures', '3d assets'] }
      }
    }
  };

  /* Questions à choix unique dont les options s'excluent : goal → { question: { opts: [options rivales], ok: { option: [options compatibles] } } }.
     Une option absente de opts (« Je ne sais pas », « Plusieurs », « HTML simple ») n'écarte rien. */
  var EXCL = {
    site: { tech: { opts: ['next', 'astro', 'wordpress'] } },
    app: {
      os: { opts: ['ios', 'android', 'windows', 'macos', 'linux'], ok: { ios: ['macos'], macos: ['ios'] } },
      tech: { opts: ['swiftui', 'rn', 'flutter', 'kotlin', 'electron'] }
    },
    data: { tool: { opts: ['python', 'r'] } },
    frontend: { fw: { opts: ['react', 'next', 'vue'], ok: { next: ['react'] } } },
    mobile: { os: { opts: ['ios', 'android'] }, tech: { opts: ['swift', 'rn', 'flutter'] } },
    backend: { lang: { opts: ['node', 'go', 'rust', 'python', 'java'] } },
    database: { engine: { opts: ['postgres', 'mongo'] } },
    ia: { sdk: { opts: ['claude', 'aisdk', 'adk', 'cloudflare'] } },
    tests: { code: { opts: ['go', 'rust'] } },
    devops: { cloud: { opts: ['azure', 'aws', 'cloudflare', 'vercel'] } },
    securite: { stack: { opts: ['firebase', 'convex', 'betterauth', 'gcloud', 'azure'] } },
    documents: { format: { opts: ['docx', 'pptx', 'xlsx', 'pdf'] } },
    ux: { tech: { opts: ['react', 'rn', 'three'] } },
    ecommerce: { platform: { opts: ['shopify', 'stripe', 'wordpress'] } },
    'desktop-jeu': { engine: { opts: ['three', 'godot', 'unity', 'web'], ok: { three: ['web'], web: ['three'] } } }
  };

  /* Ce que l'application sait installer (contrat, règles 3 et 4) : le reste s'installe à la main. */
  var NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  var SRC_RE = /^[\w.-]+\/[\w.-]+$/;
  function sourceOk(src) {
    src = String(src || '');
    if (SRC_RE.test(src)) return !src.split('/').some(function (s) { return s.charAt(0) === '.'; });
    return src.length <= 2000 && /^https:\/\/[^\/\s?#@:]+/i.test(src);
  }

  function db() { return SA.search || { items: [], cats: [], details: {} }; }

  var reCache = {};
  function re(kw) {
    if (!reCache[kw]) {
      var body = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-\s]/g, '[-\\s]?');
      reCache[kw] = new RegExp('(^|[^a-z0-9])' + body + '($|[^a-z0-9])');
    }
    return reCache[kw];
  }

  var idx = null, catIx = null, builtFor = null;
  function build() {
    /* La base peut être remplacée par la version en ligne : l'index suit. */
    if (idx && builtFor === db()) return;
    builtFor = db();
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

  function bare(k) { return k.charAt(0) === '=' ? k.slice(1) : k; }
  /* Mots-clés d'une règle trouvés dans le nom seul du skill (sans la source : « vercel-labs » ne dit rien du sujet). */
  function nameHits(rule, nm) {
    return (rule.kw || []).map(bare).filter(function (k) { return re(k).test(nm); });
  }

  /* Options rivales qui nomment le skill : libellés des options, vide si le skill répond à la réponse choisie.
     Un mot-clé déjà porté par une autre réponse choisie (SQL en source et en outil) n'écarte rien. */
  function offOf(goal, m, answers, it) {
    var ex = EXCL[goal], out = [];
    if (!ex) return out;
    var nm = String(it[1]).toLowerCase();
    var chosenKw = Object.create(null);
    Object.keys(m).forEach(function (qid) {
      if (qid === 'base') return;
      var a = answers[qid];
      (Array.isArray(a) ? a : a == null ? [] : [a]).forEach(function (v) {
        ((m[qid][v] || {}).kw || []).forEach(function (k) { chosenKw[bare(k)] = qid; });
      });
    });
    Object.keys(ex).forEach(function (qid) {
      var v = answers[qid], q = ex[qid];
      if (typeof v !== 'string' || q.opts.indexOf(v) < 0 || !m[qid] || !m[qid][v]) return;
      /* Le nom répond à la réponse choisie : le skill reste à sa place, même s'il cite aussi une autre option. */
      if (nameHits(m[qid][v], nm).length) return;
      var ok = (q.ok || {})[v] || [];
      q.opts.forEach(function (w) {
        if (w === v || ok.indexOf(w) > -1 || !m[qid][w]) return;
        var hits = nameHits(m[qid][w], nm).filter(function (k) { return !(k in chosenKw); });
        if (hits.length) out.push(optLabel(goal, qid, w));
      });
    });
    return out;
  }

  /* Raison en une phrase quand l'application ne sait pas installer cette entrée, sinon ''. */
  function manual(id) {
    build();
    var it = idx[id];
    if (!it) return '';
    if (!sourceOk(it[2])) return 'Sa source n’est pas un dépôt GitHub : installez-le depuis sa page skills.sh.';
    if (!NAME_RE.test(String(it[1]))) return 'Son nom contient des caractères refusés : installez-le depuis sa page skills.sh.';
    return '';
  }

  SA.reco = {
    map: MAP,
    /* goal → questions dont les options s'excluent */
    excl: Object.keys(EXCL).reduce(function (o, g) { o[g] = Object.keys(EXCL[g]); return o; }, {}),
    manual: manual,
    item: function (id) { build(); return idx[id] || null; },

    /* Serveurs MCP conseillés : catalogue MCP (SA.mcpCatalog, ou le catalogue complet passé en list), classés par
       catégories de l'objectif et des réponses, puis par mots-clés des réponses, puis par note. → [{ e, rel, why }] */
    mcp: function (goal, answers, list) {
      var m = MAP[goal];
      if (!m) return [];
      list = list || ((SA.mcpCatalog || {}).servers || []);
      answers = answers || {};
      var cats = {}, kws = [], why = {};
      (m.base || []).forEach(function (c) { cats[c] = cats[c] || 1; });
      Object.keys(m).forEach(function (qid) {
        if (qid === 'base') return;
        var a = answers[qid];
        if (a == null || a === '') return;
        (Array.isArray(a) ? a : [a]).forEach(function (v) {
          var rule = m[qid][v];
          if (!rule) return;
          (rule.cats || []).forEach(function (c) { cats[c] = 2; why[c] = optLabel(goal, qid, v); });
          (rule.kw || []).forEach(function (k) { k = String(k).replace(/^=/, '').toLowerCase(); if (k.length > 2) { kws.push(k); why['kw:' + k] = optLabel(goal, qid, v); } });
        });
      });
      var out = [];
      list.forEach(function (e) {
        var rel = 0, w = [];
        (e.cats || []).forEach(function (c) { if (cats[c]) { rel += cats[c]; if (why[c] && w.indexOf(why[c]) < 0) w.push(why[c]); } });
        var text = (String(e.id).split('/').pop() + ' ' + (e.title || '') + ' ' + (e.description || '')).toLowerCase();
        kws.forEach(function (k) { if (text.indexOf(k) > -1) { rel += 3; if (w.indexOf(why['kw:' + k]) < 0) w.push(why['kw:' + k]); } });
        if (!rel || e.verdict === 'rouge') return;
        out.push({ e: e, rel: rel, why: w });
      });
      out.sort(function (a, b) { return (b.rel * 10 + ((b.e.score || {}).total || 0)) - (a.rel * 10 + ((a.e.score || {}).total || 0)); });
      return out;
    },

    /* Plugins conseillés : même règle que les serveurs MCP, sur le catalogue des plugins (champ plugins). */
    plugins: function (goal, answers, list) {
      return SA.reco.mcp(goal, answers, list || ((SA.pluginCatalog || {}).plugins || []));
    },

    /* → [{ id, it, rel, why: [libellés des réponses reconnues], base: libellé de catégorie ou '', off: [libellés d'options rivales] }] */
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
        out.push({ id: it[0], it: it, rel: rel, why: why, base: base, off: offOf(goal, m, answers, it) });
      });
      /* Les skills d'une autre option passent après tous les autres.
         Ensuite, une réponse reconnue de plus pèse environ 30 points de note. */
      out.sort(function (a, b) {
        return (a.off.length ? 1 : 0) - (b.off.length ? 1 : 0) ||
          (b.rel * 12 + b.it[6]) - (a.rel * 12 + a.it[6]) || b.it[3] - a.it[3];
      });
      return out;
    }
  };
})();
