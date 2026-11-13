/* Skill Advisor prototype: questions du conseil, agents et machine d'exemple.
   Les skills proposés viennent de la base réelle (search-data.js) ; la machine d'exemple est dans machine-data.js. */
(function () {
  window.SA = window.SA || {};
  var SA = window.SA;

  SA.data = {};

  SA.data.steps = ['Objectif', 'Questions', 'Recommandations', 'Installation', 'Guide'];

  SA.data.weights = [
    { label: 'Popularité', max: 40 },
    { label: 'Réputation de la source', max: 25 },
    { label: 'Fraîcheur', max: 15 },
    { label: 'Sécurité', max: 20 }
  ];

  SA.data.goals = {
    site: {
      title: 'Créer un site',
      short: 'Site',
      hint: 'Vitrine, boutique, blog ou page d’atterrissage.',
      tag: 'site',
      qs: [
        { id: 'type', q: 'Quel type de site ?', opts: [
          ['vitrine', 'Site vitrine'],
          ['boutique', 'Boutique en ligne'],
          ['blog', 'Blog'],
          ['landing', 'Page d’atterrissage'],
          ['webapp', 'Application web']
        ] },
        { id: 'tech', q: 'Avec quelle technologie ?', opts: [
          ['next', 'Next.js'],
          ['astro', 'Astro'],
          ['wordpress', 'WordPress'],
          ['html', 'HTML simple'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'host', q: 'Où sera-t-il hébergé ?', opts: [
          ['vercel', 'Vercel'],
          ['cloudflare', 'Cloudflare'],
          ['mutu', 'Hébergement mutualisé'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['design', 'Design'],
          ['seo', 'Référencement'],
          ['perf', 'Performance'],
          ['a11y', 'Accessibilité'],
          ['contenu', 'Contenu']
        ] }
      ]
    },
    app: {
      title: 'Développer une application',
      short: 'Application',
      hint: 'Mobile, bureau, web, ligne de commande ou API.',
      tag: 'app',
      qs: [
        { id: 'type', q: 'Quel type d’application ?', opts: [
          ['mobile', 'Mobile'],
          ['bureau', 'Bureau'],
          ['web', 'Web'],
          ['cli', 'Ligne de commande'],
          ['api', 'API']
        ] },
        { id: 'os', q: 'Pour quelle plateforme ?', opts: [
          ['ios', 'iOS'],
          ['android', 'Android'],
          ['windows', 'Windows'],
          ['macos', 'macOS'],
          ['linux', 'Linux'],
          ['multi', 'Plusieurs']
        ] },
        { id: 'tech', q: 'Avec quelle technologie ?', opts: [
          ['swiftui', 'SwiftUI'],
          ['rn', 'React Native'],
          ['flutter', 'Flutter'],
          ['kotlin', 'Kotlin'],
          ['electron', 'Electron'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['ui', 'Interface'],
          ['tests', 'Tests'],
          ['archi', 'Architecture'],
          ['secu', 'Sécurité'],
          ['ci', 'Livraison continue']
        ] }
      ]
    },
    data: {
      title: 'Analyser des données',
      short: 'Données',
      hint: 'Tableaux, bases, API ou PDF, jusqu’au rapport.',
      tag: 'données',
      qs: [
        { id: 'source', q: 'D’où viennent vos données ?', opts: [
          ['csv', 'Excel ou CSV'],
          ['sql', 'Base SQL'],
          ['api', 'API'],
          ['pdf', 'PDF']
        ] },
        { id: 'tool', q: 'Avec quel outil ?', opts: [
          ['python', 'Python'],
          ['sql', 'SQL'],
          ['r', 'R'],
          ['tableur', 'Tableur'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'out', q: 'Que voulez-vous obtenir ?', opts: [
          ['dash', 'Tableau de bord'],
          ['rapport', 'Rapport'],
          ['graph', 'Graphiques'],
          ['modele', 'Modèle prédictif']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['clean', 'Nettoyage'],
          ['viz', 'Visualisation'],
          ['stats', 'Statistiques'],
          ['auto', 'Automatisation']
        ] }
      ]
    },
    /* Un objectif par autre catégorie du catalogue (search-data.js), dans le même ordre. */
    frontend: {
      title: 'Construire une interface web',
      short: 'Front',
      hint: 'React, Next.js, Vue et TypeScript.',
      tag: 'front',
      qs: [
        { id: 'fw', q: 'Avec quel framework ?', opts: [
          ['react', 'React'],
          ['next', 'Next.js'],
          ['vue', 'Vue'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'host', q: 'Où sera-t-elle déployée ?', opts: [
          ['vercel', 'Vercel'],
          ['cloudflare', 'Cloudflare'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['perf', 'Performance'],
          ['anim', 'Animations'],
          ['types', 'Typage'],
          ['auth', 'Connexion des utilisateurs'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    mobile: {
      title: 'Créer une application mobile',
      short: 'Mobile',
      hint: 'iOS, Android, React Native, Expo ou Flutter.',
      tag: 'mobile',
      qs: [
        { id: 'os', q: 'Pour quelle plateforme ?', opts: [
          ['ios', 'iOS'],
          ['android', 'Android'],
          ['multi', 'Les deux'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'tech', q: 'Avec quelle technologie ?', opts: [
          ['swift', 'Swift ou SwiftUI'],
          ['rn', 'React Native ou Expo'],
          ['flutter', 'Flutter'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['design', 'Design des écrans'],
          ['anim', 'Animations'],
          ['tests', 'Tests'],
          ['archi', 'Architecture'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    backend: {
      title: 'Construire un backend ou une API',
      short: 'Backend',
      hint: 'Node.js, Go, Rust, Python ou Java.',
      tag: 'backend',
      qs: [
        { id: 'lang', q: 'En quel langage ?', opts: [
          ['node', 'Node.js'],
          ['go', 'Go'],
          ['rust', 'Rust'],
          ['python', 'Python'],
          ['java', 'Java'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'api', q: 'Quel style d’API ?', opts: [
          ['rest', 'REST'],
          ['graphql', 'GraphQL'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['archi', 'Architecture'],
          ['tests', 'Tests'],
          ['secu', 'Sécurité'],
          ['db', 'Base de données'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    database: {
      title: 'Gérer une base de données',
      short: 'Base de données',
      hint: 'Postgres, Supabase, Prisma ou Neon.',
      tag: 'base',
      qs: [
        { id: 'engine', q: 'Quel moteur ?', opts: [
          ['postgres', 'PostgreSQL'],
          ['mongo', 'MongoDB'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'tool', q: 'Avec quel outil ?', opts: [
          ['prisma', 'Prisma'],
          ['supabase', 'Supabase'],
          ['neon', 'Neon'],
          ['sql', 'SQL direct'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['schema', 'Conception du schéma'],
          ['perf', 'Requêtes rapides'],
          ['migr', 'Migrations'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    ia: {
      title: 'Construire avec l’IA',
      short: 'IA',
      hint: 'Agents, serveurs MCP, prompts et API de modèles.',
      tag: 'ia',
      qs: [
        { id: 'type', q: 'Que voulez-vous construire ?', opts: [
          ['agent', 'Un agent'],
          ['mcp', 'Un serveur MCP'],
          ['app', 'Une application avec un modèle'],
          ['rag', 'Une recherche dans vos documents'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'sdk', q: 'Avec quel outil ?', opts: [
          ['claude', 'API Claude'],
          ['aisdk', 'AI SDK de Vercel'],
          ['adk', 'Google ADK'],
          ['cloudflare', 'Cloudflare Agents'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['prompt', 'Prompts'],
          ['eval', 'Évaluation'],
          ['browser', 'Navigation web'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    tests: {
      title: 'Tester et relire du code',
      short: 'Tests',
      hint: 'Tests, revue de code et débogage.',
      tag: 'tests',
      qs: [
        { id: 'type', q: 'Que voulez-vous faire ?', opts: [
          ['tdd', 'Écrire les tests d’abord'],
          ['review', 'Relire du code'],
          ['debug', 'Trouver un bogue'],
          ['e2e', 'Tester dans le navigateur'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'code', q: 'Sur quel code ?', opts: [
          ['web', 'Application web'],
          ['go', 'Go'],
          ['rust', 'Rust'],
          ['mobile', 'Mobile'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['qa', 'Suivi des bogues'],
          ['ab', 'Tests A/B'],
          ['secu', 'Sécurité'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    devops: {
      title: 'Déployer et exploiter',
      short: 'DevOps',
      hint: 'Docker, Kubernetes, CI et cloud.',
      tag: 'devops',
      qs: [
        { id: 'cloud', q: 'Sur quel cloud ?', opts: [
          ['azure', 'Azure'],
          ['aws', 'AWS'],
          ['cloudflare', 'Cloudflare'],
          ['vercel', 'Vercel'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'tool', q: 'Avec quel outil ?', opts: [
          ['docker', 'Docker'],
          ['k8s', 'Kubernetes'],
          ['ci', 'GitHub Actions'],
          ['serverless', 'Sans serveur'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['deploy', 'Déploiement'],
          ['monitor', 'Diagnostic'],
          ['secu', 'Sécurité'],
          ['infra', 'Infrastructure en code'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    securite: {
      title: 'Sécuriser une application',
      short: 'Sécurité',
      hint: 'Audit, connexion des utilisateurs et menaces.',
      tag: 'sécurité',
      qs: [
        { id: 'type', q: 'Que voulez-vous faire ?', opts: [
          ['audit', 'Auditer le code'],
          ['auth', 'Ajouter une connexion'],
          ['threat', 'Analyser les menaces'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'stack', q: 'Avec quelle plateforme ?', opts: [
          ['firebase', 'Firebase'],
          ['convex', 'Convex'],
          ['betterauth', 'Better Auth'],
          ['gcloud', 'Google Cloud'],
          ['azure', 'Azure'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['access', 'Droits d’accès'],
          ['sessions', 'Sessions et secrets'],
          ['web', 'Protection contre les injections'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    marketing: {
      title: 'Faire connaître un produit',
      short: 'Marketing',
      hint: 'Référencement, contenu, e-mail et marque.',
      tag: 'marketing',
      qs: [
        { id: 'goal', q: 'Quel est votre but ?', opts: [
          ['seo', 'Être mieux référencé'],
          ['content', 'Écrire du contenu'],
          ['email', 'Envoyer des e-mails'],
          ['brand', 'Soigner la marque'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'channel', q: 'Où voulez-vous être vu ?', opts: [
          ['web', 'Moteurs de recherche'],
          ['ai', 'Réponses des IA'],
          ['mail', 'Boîtes mail'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['ideas', 'Idées de croissance'],
          ['audit', 'Audit'],
          ['scale', 'Pages en série'],
          ['edit', 'Relecture'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    documents: {
      title: 'Produire des documents',
      short: 'Documents',
      hint: 'Word, PowerPoint, Excel, PDF et présentations.',
      tag: 'documents',
      qs: [
        { id: 'format', q: 'Quel format ?', opts: [
          ['docx', 'Word'],
          ['pptx', 'Présentation'],
          ['xlsx', 'Excel'],
          ['pdf', 'PDF'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'act', q: 'Que voulez-vous faire ?', opts: [
          ['create', 'Créer'],
          ['read', 'Lire ou extraire'],
          ['convert', 'Convertir'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['gws', 'Google Workspace'],
          ['html', 'Présentation en HTML'],
          ['ocr', 'Reconnaissance de texte'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    ux: {
      title: 'Soigner le design',
      short: 'Design',
      hint: 'Design system, animation, typographie et accessibilité.',
      tag: 'design',
      qs: [
        { id: 'type', q: 'Sur quoi voulez-vous travailler ?', opts: [
          ['system', 'Design system'],
          ['anim', 'Animation'],
          ['a11y', 'Accessibilité'],
          ['type', 'Typographie'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'tech', q: 'Avec quelle technologie ?', opts: [
          ['css', 'CSS ou Tailwind'],
          ['react', 'React'],
          ['rn', 'React Native'],
          ['three', 'Three.js'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['review', 'Revue de l’existant'],
          ['perf', 'Fluidité'],
          ['tokens', 'Jetons de design'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    ecommerce: {
      title: 'Vendre en ligne',
      short: 'E-commerce',
      hint: 'Paiement, boutique Shopify ou WordPress.',
      tag: 'e-commerce',
      qs: [
        { id: 'platform', q: 'Sur quelle plateforme ?', opts: [
          ['shopify', 'Shopify'],
          ['stripe', 'Stripe'],
          ['wordpress', 'WordPress'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'pay', q: 'Quel paiement ?', opts: [
          ['card', 'Carte bancaire'],
          ['sub', 'Abonnements'],
          ['agent', 'Paiement par un agent'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['shop', 'Gestion de la boutique'],
          ['intl', 'Vente à l’étranger'],
          ['upgrade', 'Mise à jour'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    methode: {
      title: 'Mieux organiser le travail',
      short: 'Méthode',
      hint: 'Plans, git, documentation et passage de relais.',
      tag: 'méthode',
      qs: [
        { id: 'type', q: 'Que voulez-vous améliorer ?', opts: [
          ['plan', 'Préparer un plan'],
          ['git', 'Git et commits'],
          ['docs', 'Documentation'],
          ['handoff', 'Passer le relais'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['skills', 'Trouver ou écrire des skills'],
          ['archi', 'Architecture'],
          ['research', 'Recherche'],
          ['meeting', 'Comptes rendus'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    },
    'desktop-jeu': {
      title: 'Créer un jeu ou de la 3D',
      short: 'Jeu et 3D',
      hint: 'Three.js, Godot, Unity et jeux dans le navigateur.',
      tag: 'jeu',
      qs: [
        { id: 'engine', q: 'Avec quel moteur ?', opts: [
          ['three', 'Three.js'],
          ['godot', 'Godot'],
          ['unity', 'Unity'],
          ['web', 'Navigateur'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'type', q: 'Que voulez-vous faire ?', opts: [
          ['scene', 'Une scène 3D'],
          ['game', 'Un jeu jouable'],
          ['anim', 'Des animations'],
          ['nsp', 'Je ne sais pas']
        ] },
        { id: 'needs', multi: true, q: 'De quoi avez-vous besoin ?', opts: [
          ['ui', 'Menus et interface'],
          ['feel', 'Sensations de jeu'],
          ['fx', 'Effets visuels'],
          ['assets', 'Ressources graphiques'],
          ['nsp', 'Je ne sais pas']
        ] }
      ]
    }
  };

  SA.data.agents = [
    { id: 'claude', name: 'Claude Code', st: 'ok', sig: ['cmd', 'cfg'], cmd: 'claude', rel: '.claude/skills' },
    { id: 'gemini', name: 'Gemini CLI', st: 'ok', sig: ['cmd', 'cfg'], cmd: 'gemini', rel: '.gemini/skills' },
    { id: 'antigravity', name: 'Antigravity', st: 'ok', sig: ['app', 'cfg'], cmd: '', rel: '.gemini/config/skills' },
    { id: 'cursor', name: 'Cursor', st: 'ok', sig: ['app', 'cfg'], cmd: '', rel: '.cursor/skills' },
    { id: 'cline', name: 'Cline', st: 'ok', sig: ['ext'], cmd: '', rel: '.agents/skills' },
    { id: 'windsurf', name: 'Windsurf', st: 'tr', sig: ['cfg'], cmd: '', rel: '.codeium/windsurf/skills' },
    { id: 'codex', name: 'Codex', st: 'no', sig: [], cmd: '', rel: '' },
    { id: 'copilot', name: 'GitHub Copilot', st: 'no', sig: [], cmd: '', rel: '' }
  ];

  SA.data.home = { mac: '/Users/alex', win: 'C:\\Users\\alex', linux: '/home/alex' };

  SA.data.osLabel = { mac: 'macOS', win: 'Windows', linux: 'Linux' };

})();
