// Bout à bout : vrai serveur, dossier personnel jetable, Chrome sans fenêtre, vrais clics et vraies frappes.
// Sans réseau : les skills d'exemple (examples/skills) sont copiés à la main dans le dossier jetable.
// Usage : node test/e2e/run.mjs (ou npm run test:e2e). Chrome introuvable : essais sautés, sauf en CI (échec).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome, launch, until, sleep } from './cdp.mjs';
import { makeHome, startServer, tempDir, removeDir } from './env.mjs';

const T0 = Date.now();
const WIN = process.platform === 'win32';
const CHROME = findChrome();
const ABSENT = 'Chrome ou Chromium introuvable : installez-le, ou indiquez son chemin dans CHROME_PATH.';
const SKIP = CHROME ? false : ABSENT;
// Constat 38 : sous Windows, la page dit « npm.cmd start » (Chrome y annonce Win32).
const EXPIRED = 'Relancez Skill Advisor (' + (WIN ? 'npm.cmd start' : 'npm start') + '), puis ouvrez la nouvelle adresse.';

let home, work, srv, br, page, token;
const ctx = { realSa: fs.existsSync(path.join(os.homedir(), '.skill-advisor')) };

// --- aides ---------------------------------------------------------------------------------
const at = (...p) => path.join(home, ...p);
const exists = (...p) => fs.existsSync(at(...p));
const list = (...p) => (exists(...p) ? fs.readdirSync(at(...p)).sort() : []);
const backups = () => list('.skill-advisor', 'backups').filter((n) => fs.statSync(at('.skill-advisor', 'backups', n)).isDirectory());
// Jeton de l'onglet : lu par le premier essai avant toute assertion. Sans lui, chaque essai qui en dépend échoue tout de suite.
const NO_TOKEN = 'jeton absent : le démarrage a échoué';
const need = () => assert.ok(/^[0-9a-f]{64}$/.test(token || ''), NO_TOKEN);
const api = async (method, p, body) => {
  need();
  const r = await fetch(srv.base + p, { method, headers: { 'X-SA-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const js = (e) => page.js(e);
// Messages visibles de l'écran (statut, erreur) : joints au message d'échec d'une attente.
const said = () => js(`[...document.querySelectorAll('#view [role=status], #view [role=alert], .gs-msg, .gs-err, .sv-msg, .sv-err, .dt [role=status], .dt [role=alert]')]
  .map((e) => e.textContent.trim()).filter(Boolean).slice(0, 4).join(' | ')`).catch(() => '');
async function wait(fn, what, extra) {
  try { return await until(fn, what); } catch (e) {
    const more = extra ? await extra().catch(() => '') : '';
    throw new Error(e.message + ' ; écran : « ' + (await said()) + ' »' + (more ? ' ; ' + more : ''));
  }
}
const route = async (name) => {
  await js(`SA.setRoute(${JSON.stringify(name)})`);
  await until(() => js(`SA.state.route === ${JSON.stringify(name)} && !!document.querySelector('#view')`), 'écran ' + name);
  await page.idle();
};
const mine = () => js('SA.state.mine.map((r) => r.name).sort()');
const rowId = (name) => js(`(SA.state.mine.find((r) => r.name === ${JSON.stringify(name)}) || {}).id || null`);
// Le focus n'est jamais sur <body> après un geste (contrat : il revient au contrôle utilisé ou au message).
async function focusKept(gesture) {
  await sleep(150);
  const f = await js(`(() => { const a = document.activeElement; if (!a || a === document.body || a === document.documentElement) return 'body';
    return a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (a.className && typeof a.className === 'string' ? '.' + a.className.split(' ')[0] : ''); })()`);
  assert.notEqual(f, 'body', 'focus sur <body> après : ' + gesture);
}
// Un bouton est visible : dans la fenêtre, dans son conteneur, et c'est bien lui sous son centre.
async function visible(sel, boxSel) {
  return js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'absent';
    const r = e.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    if (!r.width || !r.height) return 'taille nulle';
    if (r.left < 0 || r.top < 0 || r.right > W + 0.5 || r.bottom > H + 0.5) return 'hors de la fenêtre ' + JSON.stringify([r.left, r.top, r.right, r.bottom, W, H]);
    const box = e.closest(${JSON.stringify(boxSel)});
    if (!box) return 'hors de ' + ${JSON.stringify(boxSel)};
    { const b = box.getBoundingClientRect(); if (r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) return 'hors du tableau'; }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === e || e.contains(hit))) return 'recouvert par ' + (hit ? hit.tagName + '.' + hit.className : 'rien');
    return 'ok'; })()`);
}

// --- mise en place ---------------------------------------------------------------------------
before(async () => {
  if (!CHROME) return;
  home = makeHome();
  work = tempDir('sa-e2e-work-');
  srv = await startServer(home);
  br = await launch({ chrome: CHROME, profile: path.join(work, 'profil'), downloads: path.join(work, 'telechargements') });
  page = await br.tab();
  await page.size(1440, 900);
});

after(async () => {
  if (br) await br.close();
  if (srv) await srv.stop();
  if (srv && srv.stderr().trim()) console.log('--- terminal du serveur ---\n' + srv.stderr().slice(-1500));
  await removeDir(home);
  await removeDir(work);
  console.log('Durée des essais bout à bout : ' + ((Date.now() - T0) / 1000).toFixed(1) + ' s');
});

// En intégration continue, un navigateur absent est une erreur : sinon le job serait vert sans rien tester.
if (!CHROME && process.env.CI) test('navigateur présent (CI)', () => assert.fail(ABSENT));

// --- scénarios -------------------------------------------------------------------------------
test('démarrage : adresse à usage unique, titre, ~/.skill-advisor privé', { skip: SKIP }, async () => {
  const prepared = exists('.skill-advisor');
  await page.goto(srv.url);
  // live.js range le jeton dès son chargement : lu ici, avant toute assertion, pour les essais suivants.
  token = await js('sessionStorage.getItem("sa-token")').catch(() => null);
  assert.match(token || '', /^[0-9a-f]{64}$/, 'jeton gardé par l\'onglet');
  await until(() => js('!!(window.SA && SA._started)'), 'démarrage de l\'interface');
  await page.idle();
  // Constat 52 : le titre suit l'écran ; la machine a des skills, l'écran de départ est « Ma machine ».
  assert.equal(await js('document.title'), 'Ma machine · Skill Advisor');
  assert.equal(await js('location.search'), '', 'le code est retiré de la barre d\'adresse');
  // Sans jeton, l'API refuse ; l'adresse déjà servie ne donne plus de jeton.
  assert.equal((await fetch(srv.base + '/api/state')).status, 403);
  const again = await (await fetch(srv.url)).text();
  assert.match(again, /window\.SA_LIVE=\{token:null\}/);
  assert.deepEqual(page.errors, [], 'erreurs dans la page');
  // Constat 89 : le dossier est créé au démarrage, avant toute action, lisible par l'utilisateur seul.
  assert.ok(prepared, '~/.skill-advisor doit exister dès la ligne « Skill Advisor: »');
  if (!WIN) assert.equal(fs.statSync(at('.skill-advisor')).mode & 0o777, 0o700, '~/.skill-advisor en 0700');
});

test('adresse réutilisée dans un autre onglet : écran « Session expirée »', { skip: SKIP }, async () => {
  const other = await br.tab();
  try {
    await other.goto(srv.url);
    const h1 = await until(() => other.js(`(() => { const h = document.querySelector('#view h1'); return h && h.textContent.trim() === 'Session expirée' && h.textContent; })()`), 'écran de session expirée');
    assert.equal(h1.trim(), 'Session expirée');
    const text = await other.js(`document.querySelector('#view').textContent`);
    assert.ok(text.includes(EXPIRED), 'message : ' + text);
    assert.ok(!/recharg/i.test(text), 'aucun conseil de rechargement');
  } finally { await other.close(); }
});

test('état affiché : les deux skills copiés à la main, verdicts en mots', { skip: SKIP }, async () => {
  need();
  await route('gestion');
  assert.deepEqual(await mine(), ['risky-installer', 'safe-notes']);
  const rows = await wait(async () => { const r = await js(`[...document.querySelectorAll('#view tr.gs-r')].map((r) => r.textContent)`); return r.length === 2 && r; },
    'deux lignes dans Mes skills', async () => 'vue : ' + (await js(`SA.state.route + ' ' + document.querySelectorAll('#view tr').length + ' tr'`)));
  const risky = rows.find((t) => t.includes('risky-installer'));
  assert.ok(risky.includes('Motif à risque'), 'verdict en mots : ' + risky);
  assert.ok(!/\b(rouge|orange|vert)\b/.test(await js(`document.querySelector('#view').textContent`)), 'aucun identifiant interne de verdict');
});

test('confirmation d\'une ligne visible à 1180x760 et 1440x900', { skip: SKIP }, async () => {
  need();
  for (const [w, h] of [[1180, 760], [1440, 900]]) {
    await page.size(w, h);
    await route('gestion');
    const id = await rowId('safe-notes');
    await page.click(`[data-gs-un="${id}"]`);
    await until(() => js(`!!document.querySelector('[data-gs-un-ok="${id}"]')`), 'confirmation ouverte');
    await sleep(200);
    for (const sel of [`[data-gs-un-ok="${id}"]`, `[data-gs-un-no="${id}"]`]) {
      assert.equal(await visible(sel, '.gs-tablewrap'), 'ok', w + 'x' + h + ' ' + sel);
    }
    await focusKept('ouverture de la confirmation ' + w + 'x' + h);
    await page.click(`[data-gs-un-no="${id}"]`);
    await until(() => js(`!document.querySelector('[data-gs-un-ok="${id}"]')`), 'confirmation fermée');
    await focusKept('Annuler ' + w + 'x' + h);
  }
  await page.size(1440, 900);
});

test('désinstaller un skill à risque sans sauvegarde : absent du disque, même après rechargement', { skip: SKIP }, async () => {
  need();
  await route('gestion');
  const id = await rowId('risky-installer');
  await page.click(`[data-gs-un="${id}"]`);
  await until(() => js(`!!document.querySelector('[data-gs-keep]')`), 'case « Garder une sauvegarde »');
  assert.equal(await js(`document.querySelector('[data-gs-keep]').getAttribute('aria-checked')`), 'true', 'cochée par défaut');
  await page.click('[data-gs-keep]');
  await until(() => js(`document.querySelector('[data-gs-keep]').getAttribute('aria-checked') === 'false'`), 'case décochée');
  await focusKept('case « Garder une sauvegarde »');
  await page.click(`[data-gs-un-ok="${id}"]`);
  await until(() => !exists('.claude', 'skills', 'risky-installer'), 'risky-installer retiré du disque');
  await page.idle();
  await until(async () => (await mine()).join() === 'safe-notes', 'ligne retirée');
  assert.deepEqual(backups(), [], 'aucune sauvegarde');
  await focusKept('Confirmer la désinstallation');
  await page.reload();
  await until(() => js('!!(window.SA && SA._started)'), 'interface rechargée');
  await page.idle();
  assert.deepEqual(await mine(), ['safe-notes']);
  assert.ok(!exists('.claude', 'skills', 'risky-installer'));
});

let kept;
test('désinstaller avec sauvegarde, puis restaurer', { skip: SKIP }, async () => {
  need();
  await route('gestion');
  const id = await rowId('safe-notes');
  await page.click(`[data-gs-un="${id}"]`);
  await until(() => js(`document.querySelector('[data-gs-keep]') && document.querySelector('[data-gs-keep]').getAttribute('aria-checked') === 'true'`), 'case cochée');
  await page.click(`[data-gs-un-ok="${id}"]`);
  await until(() => !exists('.claude', 'skills', 'safe-notes') && backups().length === 1, 'safe-notes retiré et sauvegardé');
  await page.idle();
  await focusKept('Confirmer la désinstallation avec sauvegarde');
  const b = (await api('GET', '/api/state')).json.backups;
  assert.equal(b.length, 1);
  assert.equal(b[0].label, 'safe-notes', 'nom par défaut : le nom du skill');
  kept = b[0].id;
  await route('sauvegardes');
  await page.click(`[data-sv-restore="${kept}"]`);
  await until(() => exists('.claude', 'skills', 'safe-notes', 'SKILL.md'), 'safe-notes remis en place');
  await page.idle();
  await focusKept('Restaurer');
  assert.deepEqual(await mine(), ['safe-notes']);
});

test('sauvegarder à la demande, sans rien désinstaller', { skip: SKIP }, async () => {
  need();
  await route('gestion');
  await page.click('[data-gs-sel="all"]');
  await page.click('[data-gs-bulk="save"]');
  await until(() => js(`!!document.querySelector('#gs-save-l')`), 'formulaire de sauvegarde');
  await page.click('#gs-save-l');
  await page.type('Essai bout à bout');
  await page.click('[data-gs-save-ok]');
  await until(() => backups().length === 2, 'deuxième sauvegarde sur le disque');
  await page.idle();
  await focusKept('Sauvegarder');
  assert.ok(exists('.claude', 'skills', 'safe-notes', 'SKILL.md'), 'le skill reste en place');
  const labels = (await api('GET', '/api/state')).json.backups.map((x) => x.label);
  assert.ok(labels.includes('Essai bout à bout'), 'nom donné : ' + labels.join(', '));
});

test('appliquer une sauvegarde à un autre agent (Windsurf)', { skip: SKIP }, async () => {
  need();
  const ws = (await api('GET', '/api/state')).json.agents.find((a) => a.id === 'windsurf');
  assert.ok(ws && ws.detected && ws.globalDir, 'Windsurf détecté');
  assert.ok(!fs.existsSync(path.join(ws.globalDir, 'safe-notes')));
  await route('sauvegardes');
  await page.click(`[data-sv-apply="${kept}"]`);
  await until(() => js(`!!document.querySelector('[data-sv-ap-go]')`), 'volet « Appliquer »');
  // Seul Windsurf est coché, le dossier partagé non.
  for (const sel of await js(`[...document.querySelectorAll('[data-sv-ap-agent], [data-sv-ap-shared]')].map((b) => {
      const want = b.getAttribute('data-sv-ap-agent') === 'windsurf';
      return (b.getAttribute('aria-checked') === 'true') !== want ? (b.hasAttribute('data-sv-ap-shared') ? '[data-sv-ap-shared]' : '[data-sv-ap-agent="' + b.getAttribute('data-sv-ap-agent') + '"]') : null;
    }).filter(Boolean)`)) {
    await page.click(sel);
    await sleep(100);
  }
  assert.equal(await js(`document.querySelector('[data-sv-ap-agent="windsurf"]').getAttribute('aria-checked')`), 'true');
  assert.deepEqual(await js(`[...document.querySelectorAll('[data-sv-ap-agent][aria-checked="true"], [data-sv-ap-shared][aria-checked="true"]')]
    .map((b) => b.getAttribute('data-sv-ap-agent') || 'shared')`), ['windsurf'], 'seul Windsurf est coché');
  await page.click('[data-sv-ap-go]');
  await until(() => fs.existsSync(path.join(ws.globalDir, 'safe-notes', 'SKILL.md')), 'safe-notes dans le dossier de Windsurf');
  await page.idle();
  await focusKept('Appliquer');
  assert.match(await said(), /safe-notes : 1 application faite, 0 passée, 0 échec/);
  assert.ok(exists('.claude', 'skills', 'safe-notes', 'SKILL.md'), 'Claude Code garde sa copie');
  // Le volet se ferme ; le focus revient sur l'écran.
  await page.click('[data-sv-ap-close]');
  await until(() => js(`!document.querySelector('[data-sv-ap-go]')`), 'volet fermé');
  await focusKept('fermeture du volet « Appliquer »');
});

test('exporter puis importer une sauvegarde', { skip: SKIP }, async () => {
  need();
  const dl = path.join(work, 'telechargements');
  await route('sauvegardes');
  await page.click(`[data-sv-export="${kept}"]`);
  const file = await wait(() => {
    const f = fs.existsSync(dl) && fs.readdirSync(dl).find((n) => /\.tar\.gz$/.test(n));
    return f && fs.statSync(path.join(dl, f)).size > 0 && path.join(dl, f);
  }, 'archive .tar.gz téléchargée', async () => 'téléchargements : ' + JSON.stringify(fs.existsSync(dl) ? fs.readdirSync(dl) : 'absent'));
  await page.idle();
  await focusKept('Exporter');
  const before = (await api('GET', '/api/state')).json.backups.length;
  await page.setFiles('#sv-file', [file]);
  await until(async () => (await api('GET', '/api/state')).json.backups.length === before + 1, 'sauvegarde importée');
  await page.idle();
  const b = (await api('GET', '/api/state')).json.backups;
  assert.ok(b.some((x) => x.origin === 'import'), 'origine « import » : ' + b.map((x) => x.origin).join(', '));
  await until(() => js(`SA.state.backups.length === ${before + 1}`), 'écran Sauvegardes à jour');
});

test('désactiver puis réactiver un skill', { skip: SKIP }, async () => {
  need();
  await route('gestion');
  const id = await rowId('safe-notes');
  const sw = `[data-gs-on="${id}"]`;
  await page.click(sw);
  await wait(() => !exists('.claude', 'skills', 'safe-notes') && exists('.skill-advisor', 'disabled', 'claude-code', 'safe-notes'), 'skill rangé dans le dossier de réserve',
    async () => 'disque : ' + JSON.stringify({ claude: list('.claude', 'skills'), disabled: list('.skill-advisor', 'disabled'), cc: list('.skill-advisor', 'disabled', 'claude-code') }));
  await page.idle();
  await until(() => js(`document.querySelector('${sw}') && document.querySelector('${sw}').getAttribute('aria-checked') === 'false'`), 'interrupteur éteint');
  await focusKept('Désactiver');
  await page.click(sw);
  await until(() => exists('.claude', 'skills', 'safe-notes', 'SKILL.md') && !exists('.skill-advisor', 'disabled', 'claude-code', 'safe-notes'), 'skill remis en place');
  await page.idle();
  assert.equal(await js(`document.querySelector('${sw}').getAttribute('aria-checked')`), 'true');
  await focusKept('Activer');
});

test('écran Agents : les 78 agents connus', { skip: SKIP }, async () => {
  need();
  await route('agents');
  await until(() => js(`!!document.querySelector('[data-ag-f="tous"]')`), 'filtres');
  assert.match(await js(`document.querySelector('[data-ag-f="tous"]').textContent`), /\b78\b/, 'compte du filtre « Tous »');
  if (await js(`document.querySelector('[data-ag-f="tous"]').getAttribute('aria-pressed') !== 'true'`)) await page.click('[data-ag-f="tous"]');
  if (await js(`!!document.querySelector('[data-ag-others][aria-expanded="false"]')`)) await page.click('[data-ag-others]');
  const n = await until(async () => {
    const c = await js(`document.querySelectorAll('#view .ag-list:not(.ag-shared) .ag-row:not(.ag-wsl)').length`);
    return c >= 78 && c;
  }, '78 lignes d\'agents', 15000);
  assert.equal(n, 78);
});

test('ajouter un agent à la main, retrouvé après rechargement', { skip: SKIP }, async () => {
  need();
  const dir = at('mon-agent', 'skills');
  fs.mkdirSync(dir, { recursive: true });
  await route('agents');
  await page.click('[data-ag-new]');
  await until(() => js(`!!document.querySelector('#ag-new-n')`), 'formulaire d\'ajout');
  await page.click('#ag-new-n');
  await page.type('Mon agent');
  await page.click('#ag-new-p');
  await page.type(dir);
  await page.click('[data-ag-add]');
  await until(async () => ((await api('GET', '/api/state')).json.agents || []).some((a) => a.custom && a.name === 'Mon agent'), 'agent ajouté');
  await page.idle();
  await focusKept('Ajouter cet agent');
  const s = JSON.parse(fs.readFileSync(at('.skill-advisor', 'settings.json'), 'utf8'));
  assert.equal(s.custom.length, 1);
  // realpath natif : sous Windows, il développe les noms courts (RUNNER~1) comme le serveur.
  const real = (p) => (WIN ? fs.realpathSync.native(p).toLowerCase() : fs.realpathSync.native(p));
  assert.equal(real(s.custom[0].dir), real(dir));
  await page.reload();
  await until(() => js('!!(window.SA && SA._started)'), 'interface rechargée');
  await route('agents');
  await until(() => js(`[...document.querySelectorAll('#view .ag-row')].some((r) => r.textContent.includes('Mon agent'))`), 'ligne « Mon agent » après rechargement');
});

test('fin : aucune erreur dans la page, vrai dossier personnel inchangé', { skip: SKIP }, () => {
  assert.deepEqual(page.errors, [], 'erreurs dans la page');
  assert.equal(fs.existsSync(path.join(os.homedir(), '.skill-advisor')), ctx.realSa, 'vrai ~/.skill-advisor inchangé');
  assert.ok(Date.now() - T0 < 180000, 'moins de 3 minutes');
});
