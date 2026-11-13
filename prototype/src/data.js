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
