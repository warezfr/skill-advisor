// Agents screen: render and actions in demo mode and in live mode (fake SA.live, 78 agents + 1 custom).
// Same approach as smoke.mjs: the build files run in a vm, without a DOM. No network, no file written.
// Run: node test/agents.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildSrc = fs.readFileSync(path.join(root, 'build.mjs'), 'utf8');
const files = [...buildSrc.match(/const JS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const win = { matchMedia: null, console, setTimeout, clearTimeout };
win.window = win;
win.document = { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, documentElement: { getAttribute() { return null; } } };
const ctx = vm.createContext(win);
for (const f of files) {
  const p = path.join(root, 'src', f);
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
}
const SA = win.SA;
const V = SA.views.agents;
// Sans DOM, le rail et le dossier ne peuvent pas se redessiner : on les neutralise.
SA.sync = function () {};

const BAD = /undefined|NaN|\[object Object\]|\bnull\b|\u2014/;
let fails = 0, runs = 0;
function fail(msg) { fails++; console.error('FAIL', msg); }
function ok(cond, msg) { runs++; if (!cond) fail(msg); }
function eq(a, b, msg) { runs++; const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) fail(msg + '\n  attendu ' + y + '\n  obtenu  ' + x); }
function render(label) {
  runs++;
  let html;
  try { html = V.render(); } catch (e) { fail(label + ' render threw: ' + e.stack); return ''; }
  const m = html.match(BAD);
  if (m) { const i = html.search(BAD); fail(label + ' contient "' + m[0] + '": ' + html.slice(Math.max(0, i - 80), i + 60)); }
  if (V.actions) {
    const acts = V.actions();
    if (!Array.isArray(acts)) fail(label + ' actions not array');
    else acts.forEach((a) => { if (typeof a.label !== 'string' || BAD.test(a.label) || typeof a.on !== 'function') fail(label + ' bad action'); });
  }
  return html;
}

if (!V || !V._do) { console.error('FAIL la vue agents n’expose pas _do'); process.exit(1); }
const T = V._do;
const ids = (list) => list.map((a) => a.id);
const set = (over) => SA.initState(over);

const TOP = [
  ['claude-code', 'Claude Code'], ['cursor', 'Cursor'], ['codex', 'Codex'], ['github-copilot', 'GitHub Copilot'],
  ['gemini-cli', 'Gemini CLI'], ['windsurf', 'Windsurf'], ['cline', 'Cline'], ['roo', 'Roo Code'], ['kiro-cli', 'Kiro CLI'],
  ['zed', 'Zed'], ['opencode', 'OpenCode'], ['goose', 'Goose'], ['amp', 'Amp'], ['antigravity', 'Antigravity'],
  ['continue', 'Continue'], ['junie', 'Junie'], ['trae', 'Trae'], ['warp', 'Warp'], ['kilo', 'Kilo Code'],
  ['qwen-code', 'Qwen Code'], ['augment', 'Augment'], ['openhands', 'OpenHands'], ['devin', 'Devin for Terminal'], ['replit', 'Replit']
];

// ================================================================ demo mode
SA.live = undefined;
set({ route: 'agents' });
let html = render('demo');
ok(/Kiro CLI/.test(html) && /Replit/.test(html), 'demo : les 24 agents principaux sont listés');
ok(/data-os="win"/.test(html), 'demo : le choix du système reste affiché');
let L = T.list();
eq(L.top.map((a) => a.name), TOP.map((t) => t[1]), 'demo : ordre des agents principaux');
ok(L.top[0].id === 'claude', 'demo : Claude Code garde l’id de démonstration « claude »');
eq(L.others.length, 0, 'demo : pas d’autres agents');
ok(L.top.filter((a) => a.id === 'kiro-cli')[0].detected === false, 'demo : un agent ajouté à la liste est non détecté');
ok(/~\/\.cursor\/skills/.test(html), 'demo : chemin relatif au dossier personnel');

// cible
T.target('cursor', false);
ok(SA.state.agents.cursor === false, 'demo : désactiver la cible de Cursor');
T.target('cursor', true);
ok(SA.state.agents.cursor === true, 'demo : réactiver la cible de Cursor');
T.target('kiro-cli', true);
ok(!SA.state.agents['kiro-cli'], 'demo : un agent non détecté ne devient pas cible');

// recherche et filtres
T.setQuery('gem');
eq(ids(T.visible()), ['gemini'], 'demo : recherche « gem »');
T.setQuery('CODE');
ok(T.visible().some((a) => a.id === 'claude') && T.visible().some((a) => a.id === 'qwen-code'), 'demo : recherche insensible à la casse, par nom ou id');
T.setQuery('');
T.setFilter('detectes');
ok(T.visible().length > 0 && T.visible().every((a) => a.detected), 'demo : filtre Détectés');
T.setFilter('cibles');
ok(T.visible().length > 0 && T.visible().every((a) => a.target), 'demo : filtre Ciblés');
T.hide('cursor');
T.setFilter('masques');
eq(ids(T.visible()), ['cursor'], 'demo : filtre Masqués');
T.setFilter('tous');
ok(!T.visible().some((a) => a.id === 'cursor'), 'demo : un agent masqué sort de Tous');
render('demo/masque');
T.show('cursor');
ok(T.visible().some((a) => a.id === 'cursor'), 'demo : Afficher');

// vider un agent
const before = SA.state.mine.filter((r) => r.ag && r.ag.cursor).length;
ok(before > 0, 'demo : Cursor a des skills');
ok(T.list().top.filter((a) => a.id === 'cursor')[0].count === before, 'demo : nombre de skills de Cursor');
T.askEmpty('cursor');
html = render('demo/vider');
ok(/Garder une sauvegarde/.test(html) && /type="checkbox"[^>]*checked/.test(html), 'demo : case « Garder une sauvegarde » cochée par défaut');
T.confirm();
ok(SA.state.mine.filter((r) => r.ag && r.ag.cursor).length === 0, 'demo : Cursor vidé');
ok(SA.state.mine.every((r) => !SA.state.backups.some((b) => b.id === r.id)), 'demo : aucune sauvegarde d’une ligne encore installée');
render('demo/vide-fait');

// ajout d'un agent
T.add('', '');
ok(/nom/.test(SA.state.ag.err), 'demo : nom manquant');
T.add('Mon agent', '');
ok(/dossier/.test(SA.state.ag.err), 'demo : dossier manquant');
T.add('Mon agent', 'relatif/skills');
ok(/chemin complet/.test(SA.state.ag.err), 'demo : chemin relatif refusé');
T.add('Mon agent', '/opt/../etc/skills');
ok(/\.\./.test(SA.state.ag.err), 'demo : « .. » refusé');
T.add('Cursor', '/opt/cursor2/skills');
ok(/déjà/.test(SA.state.ag.err), 'demo : nom déjà pris');
html = render('demo/erreur');
ok(/role="alert"/.test(html), 'demo : erreur annoncée');
T.add('Mon agent', '/opt/mon-agent/skills');
eq(SA.state.custom.map((c) => c.id), ['c1'], 'demo : agent ajouté');
ok(SA.state.agents.c1 === true && !SA.state.ag.err, 'demo : agent ajouté ciblé');
T.add('Autre', '/opt/autre/skills');
T.removeCustom('c1');
T.add('Troisième', '/opt/trois/skills');
eq(SA.state.custom.map((c) => c.id), ['c2', 'c3'], 'demo : ids sans collision après retrait');
L = T.list();
eq(ids(L.custom), ['c2', 'c3'], 'demo : agents ajoutés à la fin');
T.askRemove('c2');
html = render('demo/retirer');
ok(/Retirer Autre de la liste \?/.test(html), 'demo : texte de confirmation du retrait');
T.confirm();
eq(SA.state.custom.map((c) => c.id), ['c3'], 'demo : Retirer l’agent');
T.add('x'.repeat(61), '/opt/x');
ok(/60/.test(SA.state.ag.err), 'demo : nom de plus de 60 caractères refusé');

// vider : sauvegarde seulement des lignes qui quittent la machine, et seulement si la case est cochée
for (const keepBackup of [false, true]) {
  set({ route: 'agents', backups: [], mine: [
    { id: 'a/seul', name: 'seul', ag: { cursor: 'ok' } },
    { id: 'a/deux', name: 'deux', ag: { cursor: 'ok', claude: 'ok' } }
  ] });
  T.askEmpty('cursor');
  T.setBackup(keepBackup);
  T.confirm();
  eq(SA.state.mine.map((r) => [r.id, Object.keys(r.ag)]), [['a/deux', ['claude']]], 'demo : vider Cursor, backup=' + keepBackup);
  eq(SA.state.backups.map((b) => b.id), keepBackup ? ['a/seul'] : [], 'demo : sauvegardes, backup=' + keepBackup);
  ok(SA.state.ag.msg === '2 skills retirés de Cursor.' + (keepBackup ? ' Une sauvegarde est gardée.' : ''), 'demo : message, backup=' + keepBackup);
}

// rendus du smoke test
for (const os of ['mac', 'win', 'linux']) for (const scope of ['global', 'projet']) {
  set({ route: 'agents', os, scope }); render(`demo/${os}/${scope}`);
  set({ route: 'agents', os, scope, scanned: { [os]: true } }); render(`demo/${os}/${scope}/trouves`);
}
set({ route: 'agents', pv: { machine: 'pleine', net: 'on', agents: 'none', install: 'ok' } }); render('demo/aucun');
set({ route: 'agents', agNew: true }); html = render('demo/formulaire');
ok(/id="ag-new-n"/.test(html) && /id="ag-new-p"/.test(html), 'demo : formulaire');
set({ route: 'agents', custom: [{ id: 'c1', name: 'Mon agent', st: 'ok', sig: ['man'], cmd: '', rel: '', abs: '/opt/mon-agent/skills', custom: true }], agents: { c1: true } });
html = render('demo/ajoute');
ok(/\/opt\/mon-agent\/skills/.test(html), 'demo : chemin absolu hors du dossier personnel');
ok(SA.agentsOn().length === 1, 'demo : agent ajouté compté par SA.agentsOn');

// ================================================================ live mode
const HOME = '/home/test';
const NAMES = ['Zencoder', 'Aider', 'Mux', 'Bolt', 'Crush', 'Pi', 'Droid', 'Tabnine', 'Qoder', 'Kode', 'Lovable', 'Firebender',
  'Neovate', 'Pochi', 'Mistral Vibe', 'iFlow CLI', 'CodeBuddy', 'Command Code', 'Cortex Code', 'Crush 2', 'Factory', 'Jules', 'Kimi CLI',
  'Mcpjam', 'Moltbot', 'OpenClaw', 'Plandex', 'Refact', 'Sweep', 'Tabby', 'Void', 'Aide', 'Codegen', 'Codeium', 'Copilot Workspace',
  'Devika', 'Double', 'Duo', 'Fig', 'GPT Engineer', 'Hal', 'Llama Coder', 'Magic', 'Melty', 'Ollama', 'Pear', 'Phind', 'Poolside',
  'Sourcegraph Cody', 'Supermaven', 'Taskade', 'Twinny', 'Windsurf Next', 'Xcode Assist'];
ok(NAMES.length === 54, 'jeu de test : 54 autres agents');
function agent(id, name, top, i) {
  const detected = i % 3 !== 2;
  return { id, name, detected, top, universal: false, globalDir: detected ? HOME + '/.' + id + '/skills' : null, custom: false, hidden: i === 7, target: detected && i % 2 === 0, count: detected ? i % 5 : 0 };
}
function liveAgents() {
  const top = TOP.map((t, i) => agent(t[0], t[1], true, i));
  const others = NAMES.map((n, i) => agent('other-' + (i + 1), n, false, i + 100));
  const all = top.concat(others);
  // ordre mélangé : la vue trie elle-même
  for (let i = all.length - 1; i > 0; i--) { const j = (i * 7919) % (i + 1); [all[i], all[j]] = [all[j], all[i]]; }
  all.push({ id: 'custom-1', name: 'Mon outil', detected: true, top: false, universal: false, globalDir: '/opt/outil/skills', custom: true, hidden: false, target: true, count: 2 });
  return all;
}
const calls = [];
let reject = null, rejectPath = null, nextCustom = 10;
// Faux serveur avec état : il modifie SA.data.agents comme le ferait live.js après la réponse,
// avec les règles de registry.mjs (liste de cibles vide = agents détectés, agent ajouté non ciblé).
function serve(method, p, body) {
  const ag = SA.data.agents;
  const byId = (id) => ag.filter((a) => a.id === id)[0];
  if (p === '/api/agents/targets') {
    ag.forEach((a) => { a.target = body.ids.length ? body.ids.includes(a.id) : (a.detected && !a.custom); });
    return {};
  }
  if (p === '/api/agents/hide' || p === '/api/agents/show') { byId(body.id).hidden = p.endsWith('hide'); return {}; }
  if (p === '/api/agents/empty') {
    const a = byId(body.id), n = a.count || 0;
    a.count = 0;
    return { removed: Array.from({ length: n }, (_, i) => 'skill-' + i), backups: [], failed: [] };
  }
  if (method === 'POST' && p === '/api/agents/custom') {
    const a = { id: 'custom-' + (++nextCustom), name: body.name, detected: true, top: false, universal: false, globalDir: body.dir, custom: true, hidden: false, target: false, count: 0 };
    ag.push(a);
    return { agent: { id: a.id, name: a.name, dir: body.dir } };
  }
  if (method === 'DELETE') { const id = decodeURIComponent(p.split('/').pop()); SA.data.agents = ag.filter((a) => a.id !== id); return {}; }
  return {};
}
function fakeLive(os) {
  SA.live = {
    on: true,
    state: { mode: 'live', os, home: os === 'win' ? 'C:\\Users\\test' : HOME },
    call(method, p, body) {
      calls.push({ method, path: p, body });
      if (reject && (!rejectPath || p === rejectPath)) { const e = new Error(reject); return Promise.reject(e); }
      return Promise.resolve(Object.assign(serve(method, p, body), { state: {} }));
    }
  };
}
function liveSet(os = 'linux', over = {}) {
  SA.data.agents = liveAgents();
  fakeLive(os);
  set(Object.assign({ route: 'agents', os, home: SA.live.state.home }, over));
  calls.length = 0;
  reject = null;
}
const last = () => calls[calls.length - 1];
const sorted = (a) => a.slice().sort();

const demoAgents = SA.data.agents;
liveSet();
L = T.list();
eq(ids(L.top), TOP.map((t) => t[0]), 'live : agents principaux dans l’ordre TOP_AGENTS');
eq(L.others.map((a) => a.name), NAMES.slice().sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })), 'live : autres agents par nom');
eq(ids(L.custom), ['custom-1'], 'live : agent ajouté à la fin');
html = render('live');
ok(/Autres agents \(54\)/.test(html), 'live : groupe « Autres agents (54) »');
ok(!/Zencoder/.test(html), 'live : groupe replié par défaut');
ok(!/data-os=/.test(html) && /Linux/.test(html), 'live : système réel, sans aperçu');
ok(/~\/\.claude-code\/skills/.test(html), 'live : chemin relatif au dossier personnel');
ok(/\/opt\/outil\/skills/.test(html), 'live : chemin absolu hors du dossier personnel');
ok(!/ag-status[^>]*is-busy/.test(html), 'live : pas d’animation de recherche');
T.toggleOthers();
html = render('live/ouvert');
ok(/Zencoder/.test(html), 'live : groupe déplié');
T.toggleOthers();

// recherche dans le groupe replié
T.setQuery('zenc');
eq(ids(T.visible()), ['other-1'], 'live : recherche par nom');
html = render('live/recherche');
ok(/Zencoder/.test(html), 'live : un résultat du groupe replié est affiché');
T.setQuery('OTHER-54');
eq(ids(T.visible()), ['other-54'], 'live : recherche par id');
T.setQuery('zzzz-rien');
html = render('live/recherche-vide');
ok(/Aucun agent/.test(html), 'live : recherche sans résultat');
T.setQuery('');

// filtres
const all = SA.data.agents;
for (const f of ['tous', 'detectes', 'cibles', 'masques']) {
  T.setFilter(f);
  const v = T.visible();
  const exp = all.filter((a) => (f === 'masques' ? a.hidden : !a.hidden) && (f !== 'detectes' || a.detected) && (f !== 'cibles' || a.target));
  eq(sorted(ids(v)), sorted(ids(exp)), 'live : filtre ' + f);
  render('live/filtre-' + f);
}
T.setFilter('tous');

// cible : la liste complète, même pendant une recherche
const targets0 = all.filter((a) => a.target).map((a) => a.id);
const off = all.filter((a) => a.detected && !a.target && !a.hidden)[0];
T.setQuery(off.name);
await T.target(off.id, true);
eq(last().method + ' ' + last().path, 'POST /api/agents/targets', 'live : route des cibles');
eq(sorted(last().body.ids), sorted(targets0.concat(off.id)), 'live : cibles = toutes les cibles + la nouvelle');
eq(sorted(Object.keys(SA.state.agents)), sorted(all.filter((a) => a.target && a.detected || a.target && a.custom).map((a) => a.id)), 'live : SA.state.agents suit les cibles du serveur');
ok(T.list().top.concat(T.list().others).filter((a) => a.id === off.id)[0].target === true, 'live : l’interrupteur suit l’état du serveur');
T.setQuery('');
await T.target('custom-1', false);
eq(sorted(last().body.ids), sorted(targets0.concat(off.id).filter((id) => id !== 'custom-1')), 'live : retirer une cible');
ok(!SA.state.agents['custom-1'], 'live : SA.state.agents sans la cible retirée');
const nd = all.filter((a) => !a.detected && !a.custom)[0];
const n0 = calls.length;
await T.target(nd.id, true);
eq(calls.length, n0, 'live : pas d’appel pour un agent non détecté');

// masquer, afficher
await T.hide('cursor');
eq(last(), { method: 'POST', path: '/api/agents/hide', body: { id: 'cursor' } }, 'live : masquer');
ok(!T.visible().some((a) => a.id === 'cursor'), 'live : un agent masqué sort de Tous');
ok(/Cursor est masqué/.test(render('live/masque')), 'live : message après masquage');
await T.show('cursor');
eq(last(), { method: 'POST', path: '/api/agents/show', body: { id: 'cursor' } }, 'live : afficher');
ok(T.visible().some((a) => a.id === 'cursor'), 'live : agent de nouveau affiché');

// vider
all.filter((a) => a.id === 'cursor')[0].count = 5;
const cnt0 = 5;
T.askEmpty('cursor');
html = render('live/vider');
ok(/Garder une sauvegarde/.test(html) && /type="checkbox"[^>]*checked/.test(html), 'live : sauvegarde cochée par défaut');
ok(html.includes('Retirer les ' + cnt0 + ' skills de Cursor'), 'live : nombre de skills dans la confirmation');
ok(!/dossier partagé/.test(html), 'live : pas d’avertissement de dossier partagé pour un agent non universel');
await T.confirm();
eq(last(), { method: 'POST', path: '/api/agents/empty', body: { id: 'cursor', backup: true } }, 'live : vider avec sauvegarde');
html = render('live/vide-fait');
ok(html.includes(cnt0 + ' skills retirés de Cursor. Une sauvegarde est gardée.'), 'live : message après vidage');
ok(/aucun skill/.test(html.slice(html.indexOf('data-id="cursor"'), html.indexOf('</li>', html.indexOf('data-id="cursor"')))), 'live : Cursor affiché sans skill après la réponse');
all.filter((a) => a.id === 'cursor')[0].count = 3;
T.askEmpty('cursor');
T.setBackup(false);
html = render('live/vider-sans');
ok(!/type="checkbox"[^>]*checked/.test(html), 'live : case décochée');
await T.confirm();
eq(last(), { method: 'POST', path: '/api/agents/empty', body: { id: 'cursor', backup: false } }, 'live : vider sans sauvegarde');
ok(!SA.state.ag.confirm, 'live : confirmation refermée');
ok(/3 skills retirés de Cursor\.<\/p>/.test(render('live/vide-sans')), 'live : pas de sauvegarde annoncée');

// vider un agent universel : le dossier partagé est touché, la confirmation le dit
const uni = all.filter((a) => a.id === 'codex')[0];
Object.assign(uni, { universal: true, detected: true, count: 4, hidden: false });
T.askEmpty('codex');
html = render('live/vider-universel');
ok(/dossier partagé/.test(html) && html.includes('~/.agents/skills') && /autres agents/.test(html), 'live : vider un agent universel avertit pour le dossier partagé');
T.cancel();
ok(/lit le dossier partagé/.test(render('live/universel')), 'live : la ligne d’un agent universel le signale');

// ajouter
const n1 = calls.length;
await T.add('Nouvel outil', '~/outil/skills');
ok(calls.length === n1 && /chemin complet/.test(SA.state.ag.err), 'live : ~ refusé, pas d’appel');
await T.add('Mon outil', '/opt/autre');
ok(calls.length === n1 && /déjà/.test(SA.state.ag.err), 'live : nom en double refusé');
await T.add('x'.repeat(61), '/opt/x');
ok(calls.length === n1 && /60/.test(SA.state.ag.err) && SA.state.ag.errAt === 'n', 'live : nom de plus de 60 caractères refusé (limite de settings.mjs)');
const tg1 = SA.data.agents.filter((a) => a.target).map((a) => a.id);
await T.add('  Nouvel outil ', ' /opt/nouvel/skills ');
eq(calls[n1], { method: 'POST', path: '/api/agents/custom', body: { name: 'Nouvel outil', dir: '/opt/nouvel/skills' } }, 'live : ajout');
const added = SA.data.agents.filter((a) => a.name === 'Nouvel outil')[0];
eq(last().path, '/api/agents/targets', 'live : l’agent ajouté est ensuite mis dans les cibles');
eq(sorted(last().body.ids), sorted(tg1.concat(added.id)), 'live : cibles = cibles actuelles + l’agent ajouté');
ok(added.target === true && SA.state.agents[added.id] === true, 'live : l’agent ajouté reçoit les installations');
ok(!SA.state.ag.err && !SA.state.agNew, 'live : formulaire refermé après ajout');
ok(/Nouvel outil est ajouté\. Il recevra les installations\./.test(render('live/ajoute')), 'live : message après ajout');

// retirer un agent ajouté
T.askRemove('custom-1');
html = render('live/retirer');
ok(/Retirer Mon outil de la liste \?/.test(html), 'live : texte de confirmation du retrait');
await T.confirm();
eq(last(), { method: 'DELETE', path: '/api/agents/custom/custom-1', body: undefined }, 'live : retirer l’agent');
ok(!T.list().custom.some((a) => a.id === 'custom-1'), 'live : agent retiré de la liste');
const n2 = calls.length;
T.askRemove('cursor');
await T.confirm();
eq(calls.length, n2, 'live : un agent connu ne se retire pas');

// échec d'un appel : message affiché, rien d'inversé
reject = 'Écriture refusée dans ce dossier.';
const t0 = all.filter((a) => a.id === 'cursor')[0].target;
await T.target('cursor', !t0);
html = render('live/echec');
ok(/role="alert"[^>]*>[^<]*Écriture refusée dans ce dossier\./.test(html), 'live : message d’erreur affiché');
ok(all.filter((a) => a.id === 'cursor')[0].target === t0, 'live : la cible n’est pas inversée');
reject = 'Ce dossier est introuvable.';
const n3 = calls.length;
await T.add('Outil refusé', '/opt/refuse/skills');
ok(calls.length === n3 + 1 && SA.state.agNew === true, 'live : ajout refusé, formulaire ouvert');
eq(SA.state.ag.err, 'Ce dossier est introuvable.', 'live : message du serveur dans le formulaire');
eq(SA.state.ag.focus, 'p', 'live : focus sur le champ dossier après un refus');
html = render('live/ajout-refuse');
ok(/value="Outil refusé"/.test(html) && /value="\/opt\/refuse\/skills"/.test(html), 'live : saisie conservée après un refus');
// ajout accepté, cibles refusées : l'agent est là, le message le dit
reject = 'Écriture refusée.';
rejectPath = '/api/agents/targets';
await T.add('Outil à moitié', '/opt/moitie/skills');
ok(SA.data.agents.some((a) => a.name === 'Outil à moitié') && !SA.state.agNew, 'live : agent ajouté malgré le refus des cibles');
eq(SA.state.ag.fail, 'Outil à moitié est ajouté, mais ne reçoit pas encore les installations. Écriture refusée.', 'live : message quand les cibles sont refusées');
reject = null;
rejectPath = null;

// Windows
liveSet('win');
SA.data.agents.forEach((a) => { if (a.globalDir) a.globalDir = 'C:\\Users\\test\\.' + a.id + '\\skills'; });
html = render('live/win');
ok(/~\\\.claude-code\\skills/.test(html) && /Windows/.test(html), 'live win : chemin relatif et système');
await T.add('Outil', '/opt/x');
ok(/chemin complet/.test(SA.state.ag.err), 'live win : chemin Unix refusé');
const n5 = calls.length;
await T.add('Outil', 'C:\\Outils\\skills');
eq(calls[n5].body, { name: 'Outil', dir: 'C:\\Outils\\skills' }, 'live win : chemin Windows accepté');
await T.target('codex', true);
T.askEmpty('codex');
SA.data.agents.filter((a) => a.id === 'codex')[0].universal = true;
ok(render('live/win-universel').includes('~\\.agents\\skills'), 'live win : dossier partagé avec le séparateur Windows');
T.cancel();

// dernière cible : une liste vide reviendrait aux agents détectés (registry.mjs), donc refus sans appel
liveSet();
SA.data.agents.forEach((a) => { a.target = a.id === 'cursor'; });
const n4 = calls.length;
await T.target('cursor', false);
eq(calls.length, n4, 'live : pas d’appel pour retirer la dernière cible');
ok(/au moins un agent/.test(SA.state.ag.fail), 'live : message quand on retire la dernière cible');
ok(SA.data.agents.filter((a) => a.id === 'cursor')[0].target === true, 'live : la dernière cible reste');
await T.target('claude-code', true);
eq(sorted(last().body.ids), ['claude-code', 'cursor'], 'live : ajouter une cible après un refus');
ok(!SA.state.ag.fail, 'live : message d’erreur effacé après une action réussie');

// chemin inconnu, nombre absent : texte français
liveSet('mac', { agNew: true });
SA.data.agents[0].count = undefined;
SA.data.agents[0].globalDir = null;
html = render('live/donnees-partielles');
const row0 = html.slice(html.indexOf('data-id="' + SA.data.agents[0].id + '"'));
ok(/nombre de skills inconnu/.test(row0.slice(0, row0.indexOf('</li>'))) && /Aucun dossier/.test(row0.slice(0, row0.indexOf('</li>'))), 'live : dossier et nombre inconnus');

SA.data.agents = demoAgents;
SA.live = undefined;
console.log(`${runs} vérifications, ${fails} échec(s)`);
process.exit(fails ? 1 : 0);
