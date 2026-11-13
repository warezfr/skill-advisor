// Smoke test: render() and actions() of every view across goals, systems and states,
// plus the recommendation engine on every answer combination and a few logic checks.
// Run: node test/smoke.mjs   (no dependencies)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Same file list as the build: a file added there is tested here, with no second list to keep in step.
const buildSrc = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8');
const files = [...buildSrc.match(/const JS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const win = { matchMedia: null, console, setTimeout, clearTimeout };
win.window = win;
win.document = { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, documentElement: { getAttribute() { return null; } } };
const ctx = vm.createContext(win);
for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), ctx, { filename: f });
const SA = win.SA;

const BAD = /undefined|NaN|\[object Object\]|\bnull\b/;
// Author text (descriptions, audit summaries, file excerpts) is quoted as is, between markers: it is not ours to check.
const ours = (html) => html.replace(/<!--a-->[\s\S]*?<!--\/a-->/g, '');
let fails = 0, runs = 0;
function fail(msg) { fails++; console.error('FAIL', msg); }
function bad(label, html) {
  const h = ours(html), m = h.match(BAD);
  if (m) { const i = h.search(BAD); fail(label + ' contains "' + m[0] + '": …' + h.slice(Math.max(0, i - 80), i + 60).replace(/\n/g, ' ') + '…'); }
}

function check(label, view) {
  runs++;
  let html, acts;
  try { html = view.render(); } catch (e) { return fail(label + ' render threw: ' + e.stack); }
  if (typeof html !== 'string' || !html.length) return fail(label + ' render empty');
  bad(label + ' render', html);
  if (view.actions) {
    try { acts = view.actions(); } catch (e) { return fail(label + ' actions threw: ' + e.stack); }
    if (!Array.isArray(acts)) return fail(label + ' actions not array');
    acts.forEach((a, i) => {
      if (typeof a.label !== 'string' || !a.label || BAD.test(a.label)) fail(label + ' action ' + i + ' bad label: ' + a.label);
      if (typeof a.on !== 'function') fail(label + ' action ' + i + ' has no on()');
      if (a.kbd != null && BAD.test(a.kbd)) fail(label + ' action ' + i + ' bad kbd');
    });
  }
  try { bad(label + ' dossier', SA._dossier()); } catch (e) { fail(label + ' dossier threw: ' + e.stack); }
  return html;
}

const D = SA.data, V = SA.views;
const goals = Object.keys(D.goals);
const oses = Object.keys(D.osLabel);
const set = (over) => SA.initState(over);
function fullAnswers(g) {
  const a = {};
  D.goals[g].qs.forEach((q) => { a[q.id] = q.multi ? [q.opts[0][0], q.opts[1][0]] : q.opts[0][0]; });
  return a;
}
const top = (g, n) => SA.reco.rank(g, fullAnswers(g)).map((r) => r.id).filter((id) => !SA.mineRow(id)).slice(0, n);
const pv = (o) => Object.assign({ machine: 'pleine', net: 'on', agents: 'ok', install: 'ok' }, o);

// ---- names must not trip the BAD check by themselves
for (const it of SA.search.items) if (BAD.test(it[1] + ' ' + it[2])) fail('skill name trips the check: ' + it[0]);

// ---- every view is registered
for (const v of ['accueil', 'objectif', 'questions', 'resultats', 'confirmation', 'guide', 'gestion', 'recherche', 'agents']) {
  if (!V[v] || typeof V[v].render !== 'function') fail('view missing: ' + v);
}

// ---- start route: home when skills exist, wizard on an empty machine
set(); if (SA.state.route !== 'accueil') fail('start route with skills: ' + SA.state.route);
if (D.mine.length < 40) fail('example machine too small to test density: ' + D.mine.length);

// ---- accueil
set(); check('accueil/pleine', V.accueil);
set({ mine: [] }); check('accueil/vide', V.accueil);
set({ pv: pv({ net: 'off' }) }); check('accueil/hors-ligne', V.accueil);
set({ pv: pv({ agents: 'none' }) }); check('accueil/aucun-agent', V.accueil);

// ---- objectif, questions
set({ route: 'wizard' }); check('objectif/none', V.objectif);
for (const g of goals) {
  const qs = D.goals[g].qs;
  set({ route: 'wizard', goal: g, answers: fullAnswers(g) }); check(`objectif/${g}`, V.objectif);
  for (let qi = -1; qi < qs.length; qi++) {
    set({ route: 'wizard', goal: g, step: 2, qi }); check(`questions/${g}/empty/qi${qi}`, V.questions);
    const part = {}; qs.slice(0, 2).forEach((q) => { part[q.id] = q.multi ? [q.opts[0][0]] : q.opts[0][0]; });
    set({ route: 'wizard', goal: g, step: 2, qi, answers: part }); check(`questions/${g}/partial/qi${qi}`, V.questions);
    set({ route: 'wizard', goal: g, step: 2, qi, answers: fullAnswers(g) }); check(`questions/${g}/full/qi${qi}`, V.questions);
  }
}

// ---- recommendation engine: ten or more for every combination of answers, « je ne sais pas » included
function* combos(qs, i = 0, acc = {}) {
  if (i === qs.length) { yield { ...acc }; return; }
  const q = qs[i];
  if (q.multi) {
    for (const o of q.opts) yield* combos(qs, i + 1, { ...acc, [q.id]: [o[0]] });
    yield* combos(qs, i + 1, { ...acc, [q.id]: q.opts.map((o) => o[0]) });
  } else for (const o of q.opts) yield* combos(qs, i + 1, { ...acc, [q.id]: o[0] });
}
const recoStats = {};
for (const g of goals) {
  let n = 0, min = Infinity, thin = 0;
  for (const a of combos(D.goals[g].qs)) {
    const r = SA.reco.rank(g, a); n++;
    min = Math.min(min, r.length);
    if (r.length < 10) fail(`reco/${g} fewer than 10 for ${JSON.stringify(a)}: ${r.length}`);
    if (r.slice(0, 12).filter((x) => x.why.length).length < 6) thin++;
    for (const x of r.slice(0, 12)) if (x.it[6] == null) fail(`reco/${g} proposes an unrated skill: ${x.id}`);
  }
  recoStats[g] = `${n} combinaisons, minimum ${min} propositions, ${thin} où moins de 6 des 12 premières répondent à une réponse précise`;
}
if (SA.reco.rank('app', { os: 'ios' }).some((r) => /axios/.test(r.it[1]) && r.why.includes('iOS'))) fail('reco: "ios" matched inside "axios"');

// ---- résultats
set({ route: 'wizard', step: 3 }); check('resultats/sans-reponses', V.resultats);
for (const g of goals) {
  const common = { route: 'wizard', step: 3, goal: g, answers: fullAnswers(g) };
  set(common); check(`resultats/${g}/lecture`, V.resultats);
  set({ ...common, dbReady: true });
  const html = check(`resultats/${g}/pret`, V.resultats);
  if (html && (html.match(/class="rs-row/g) || []).length < 10) fail(`resultats/${g} shows fewer than 10 rows`);
  if (SA.cart.count() !== 3) fail(`resultats/${g} preselects ${SA.cart.count()} skills, expected 3`);
  if (html && !/Pourquoi pour vous/.test(html)) fail(`resultats/${g} has no "pourquoi pour vous"`);
  set({ ...common, dbReady: true, cart: top(g, 5), recoShown: 36 }); check(`resultats/${g}/plus`, V.resultats);
  set({ ...common, dbReady: true, pv: pv({ net: 'off' }) }); check(`resultats/${g}/hors-ligne`, V.resultats);
  set({ ...common, dbReady: true, mine: [] }); check(`resultats/${g}/machine-vide`, V.resultats);
}

// ---- confirmation
set({ route: 'wizard', step: 4 }); check('confirmation/vide', V.confirmation);
for (const g of goals) for (const os of oses) for (const scope of ['global', 'projet']) {
  set();
  const cart = top(g, 3);
  const base = { route: 'wizard', step: 4, goal: g, answers: fullAnswers(g), os, scope, cart };
  set({ ...base, cart: cart.slice() });
  const off = check(`confirmation/${g}/${os}/${scope}`, V.confirmation);
  if (off && /DISABLE_TELEMETRY/.test(off.replace(/<span class="mono">DISABLE_TELEMETRY=1<\/span>/g, ''))) fail('telemetry switch off, but the command carries DISABLE_TELEMETRY');
  set({ ...base, cart: cart.slice(), telemetryOff: true });
  const on = check(`confirmation/${g}/${os}/${scope}/telemetrie`, V.confirmation);
  if (on && !/DISABLE_TELEMETRY=1 npx/.test(on)) fail('telemetry switch on, but the command is unchanged');
  set({ ...base, cart: cart.slice(), pv: pv({ agents: 'none' }) }); check(`confirmation/${g}/${os}/aucun-agent`, V.confirmation);
  set({ ...base, cart: cart.slice(), pv: pv({ net: 'off' }) }); check(`confirmation/${g}/${os}/hors-ligne`, V.confirmation);
  set({ ...base, cart: cart.slice(), agents: {} }); check(`confirmation/${g}/${os}/rien-coche`, V.confirmation);
  const st = (a, b, c) => ({ [cart[0]]: a, [cart[1]]: b, [cart[2]]: c });
  set({ ...base, cart: cart.slice(), installing: true, inst: { phase: 'run', ids: cart, st: st('done', 'copy', 'wait') } }); check(`confirmation/${g}/${os}/en-cours`, V.confirmation);
  set({ ...base, cart: [], lastInstall: cart, inst: { phase: 'done', ids: cart, st: st('done', 'done', 'done') } }); check(`confirmation/${g}/${os}/termine`, V.confirmation);
  set({ ...base, cart: [cart[1]], lastInstall: [cart[0], cart[2]], inst: { phase: 'fail', ids: cart, st: st('done', 'fail', 'done'), err: 'Écriture refusée.' } }); check(`confirmation/${g}/${os}/echec`, V.confirmation);
  set({ ...base, cart: [cart[1], cart[2]], lastInstall: [cart[0]], inst: { phase: 'cancel', ids: cart, st: st('done', 'skip', 'skip') } }); check(`confirmation/${g}/${os}/annule`, V.confirmation);
}

// ---- guide
set({ route: 'wizard', step: 5 }); check('guide/vide', V.guide);
for (const g of goals) {
  set();
  const ids = top(g, 3);
  for (let t = 0; t < 3; t++) { set({ route: 'wizard', step: 5, goal: g, lastInstall: ids, guideTab: t }); check(`guide/${g}/tab${t}`, V.guide); }
  set({ route: 'wizard', step: 5, lastInstall: ids, agents: {} }); check(`guide/${g}/sans-agent`, V.guide);
}

// ---- gestion
const G = (o) => Object.assign({ f: 'tous', q: '', sort: 'nom', view: 'liste', sel: {} }, o);
for (const f of ['tous', 'maj', 'relire', 'off', 'ng']) for (const view of ['liste', 'grille']) for (const os of oses) {
  set({ route: 'gestion', os, g: G({ f, view }) }); check(`gestion/${f}/${view}/${os}`, V.gestion);
}
for (const sort of ['nom', 'etat', 'ctx', 'note']) { set({ route: 'gestion', g: G({ sort }) }); check(`gestion/tri-${sort}`, V.gestion); }
set({ route: 'gestion', g: G({ q: 'zzzz-rien' }) }); check('gestion/recherche-vide', V.gestion);
set({ route: 'gestion', g: G({ view: 'grille', gapsOnly: true }) }); check('gestion/ecarts', V.gestion);
set({ route: 'gestion', g: G({ sel: Object.fromEntries(D.mine.slice(0, 4).map((r) => [r.id, true])) }) }); check('gestion/selection', V.gestion);
set({ route: 'gestion', mine: [] }); check('gestion/vide', V.gestion);
set({ route: 'gestion', backups: [Object.assign({}, D.mine[0])] }); check('gestion/sauvegarde', V.gestion);
set({ route: 'gestion', mine: [], backups: [Object.assign({}, D.mine[0])] }); check('gestion/vide-avec-sauvegarde', V.gestion);
set({ route: 'gestion', pv: pv({ net: 'off' }) }); check('gestion/hors-ligne', V.gestion);
set({ route: 'gestion', pv: pv({ agents: 'none' }) }); check('gestion/aucun-agent', V.gestion);

// ---- recherche
set({ route: 'recherche' }); check('recherche/lecture', V.recherche);
set({ route: 'recherche', dbReady: true }); check('recherche/defaut', V.recherche);
for (const f of [{ q: 'react' }, { q: 'conversion audit' }, { cat: 'backend' }, { min: 1000000 }, { off: true }, { warn: 'aucun' }, { warn: 'sans-eleve', sort: 'installs' }, { sort: 'tendance' }, { q: 'zzzz-aucun-resultat' }]) {
  set({ route: 'recherche', dbReady: true, search: Object.assign({ q: '', cat: '', min: 0, off: false, warn: 'tous', sort: 'note', shown: 30 }, f) }); check('recherche/' + JSON.stringify(f), V.recherche);
}
set();
set({ route: 'recherche', dbReady: true, pv: pv({ net: 'off' }), cart: top('app', 2) }); check('recherche/hors-ligne', V.recherche);

// ---- agents
for (const os of oses) for (const scope of ['global', 'projet']) {
  set({ route: 'agents', os, scope }); check(`agents/${os}/${scope}`, V.agents);
  set({ route: 'agents', os, scope, scanned: { [os]: true }, cart: top('app', 2) }); check(`agents/${os}/${scope}/trouves`, V.agents);
}
set({ route: 'agents', pv: pv({ agents: 'none' }) }); check('agents/aucun', V.agents);
set({ route: 'agents', agNew: true }); check('agents/formulaire', V.agents);
set({ route: 'agents', custom: [{ id: 'c1', name: 'Mon agent', st: 'ok', sig: ['man'], cmd: '', rel: '', abs: '/opt/mon-agent/skills', custom: true }], agents: { c1: true } }); check('agents/ajoute', V.agents);
if (SA.agentsOn().length !== 1) fail('custom agent not counted');

// ---- détail de chaque skill noté, guide
set({ route: 'recherche', dbReady: true });
for (const id of Object.keys(SA.search.details)) {
  runs++;
  try { bad('detail/' + id, SA.detail.html(id, 'Correspond à vos réponses : Tests.')); } catch (e) { fail('detail/' + id + ' threw: ' + e.stack); }
}
runs++; bad('guide html', SA.detail.guideHtml('pdf', 'Une description.', true));
// a rated skill without a detail sheet must not be described as unrated, and must never be recommended
const bare = SA.search.items.find((it) => it[6] != null && !SA.search.details[it[0]]);
if (bare) {
  runs++;
  const h = SA.detail.html(bare[0]);
  bad('detail/noté-sans-fiche', h);
  if (/pas encore noté/.test(h)) fail('a rated skill is described as unrated: ' + bare[0]);
  for (const g of goals) if (SA.reco.rank(g, fullAnswers(g)).some((r) => !SA.search.details[r.id])) fail(`reco/${g} proposes a skill without a detail sheet`);
}

// ---- selection logic
set({ route: 'recherche' });
const free = top('site', 1)[0], owned = SA.state.mine.find((r) => r.real).id;
if (!SA.cart.add(free) || !SA.cart.has(free)) fail('cart: cannot add a catalogue skill');
if (SA.cart.add(free)) fail('cart: added the same skill twice');
if (SA.cart.add(owned)) fail('cart: added a skill that is already installed');
if (SA.cart.add('nexiste/pas/du-tout')) fail('cart: added an unknown id');
if (!SA.cart.remove(free) || SA.cart.count()) fail('cart: remove');
if (SA.reach() !== 1) fail('reach on a fresh state: ' + SA.reach());
SA.cart.add(free); if (SA.reach() !== 4) fail('reach with a selection: ' + SA.reach());
// coming from the search opens the install step, not the questionnaire
if (!SA.canStep(4) || SA.canStep(2) || SA.canStep(3) || SA.canStep(5)) fail('steps open without what they need: ' + [1, 2, 3, 4, 5].map(SA.canStep).join(','));
set({ route: 'wizard', goal: 'app' }); if (!SA.canStep(2) || SA.canStep(3)) fail('canStep with a goal and no answers');
set({ route: 'wizard', goal: 'app', answers: fullAnswers('app') }); if (!SA.canStep(3) || SA.canStep(4)) fail('canStep with answers and no selection');

// ---- static guards: no step number left over from the six-step flow
for (const f of files.filter((x) => x.startsWith('views/'))) {
  const src = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  for (const m of src.matchAll(/SA\.go\((\d+)/g)) if (+m[1] > 5) fail(`${f}: SA.go(${m[1]}) points past the last step`);
  if (/\.step\s*[!=]==?\s*\d/.test(src)) fail(`${f}: compares state.step to a number; use SA.viewId()`);
  if (/SA\.(skills|picked|skill)\(/.test(src) || /state\.picks|st\.picks|s\.picks/.test(src)) fail(`${f}: still uses the sample-data selection`);
}

// ---- core helper sanity
set({ goal: 'app', os: 'win' });
if (SA.path('.claude/skills') !== 'C:\\Users\\alex\\.claude\\skills') fail('SA.path win: ' + SA.path('.claude/skills'));
if (SA.total([1, 2, 3, 4]) !== 10) fail('SA.total');
if (!/^<h1 class="d" data-st tabindex="-1">/.test(SA.h('Un titre'))) fail('SA.h');
if (!/role="img"/.test(SA.scoreBar([34, 20, 10, 15]))) fail('SA.scoreBar');

for (const g of goals) console.log(`reco ${g} : ${recoStats[g]}`);
console.log(`${runs} render checks, ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
