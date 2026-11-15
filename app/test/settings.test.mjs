// Tests des réglages : agents ajoutés à la main (identifiants, dossiers refusés, retrait), renommage retenté.
// Dossiers personnels jetables sous os.tmpdir() ; aucun réseau.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as settings from '../lib/settings.mjs';
import { agentMap, listAgents } from '../lib/registry.mjs';
import { makeHome, assertSafeHome, assertInHome, rmHome, lexists, skillMd } from './helpers.mjs';

const { readSettings, addCustomAgent, removeCustomAgent, hideAgent, showAgent, setTargets } = settings;
const homes = [];
async function home() { const h = await makeHome(); await assertSafeHome(h); homes.push(h); return h; }
after(async () => { for (const h of homes) await rmHome(h); });

const codeOf = (code) => (e) => e.code === code && typeof e.message === 'string' && e.message.length > 0;
const file = (h) => path.join(h, '.skill-advisor', 'settings.json');
const raw = async (h) => JSON.parse(await fs.readFile(file(h), 'utf8'));

// Dossier d'agent dans le dossier jetable.
async function agentDir(h, ...parts) {
  const d = path.join(h, ...parts);
  assertInHome(h, d);
  await fs.mkdir(d, { recursive: true });
  return d;
}

// Pose un skill dans un dossier (dossier d'agent ou dossier des désactivés).
async function putSkill(h, dir, name, desc) {
  const d = path.join(dir, name);
  assertInHome(h, d);
  await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(d, 'SKILL.md'), skillMd(name, desc || 'Skill de test.'));
  return d;
}

// --- Identifiants (constat 34) ---

test('identifiant jamais réutilisé : compteur nextCustom gardé dans settings.json', async () => {
  const h = await home();
  const un = await addCustomAgent({ home: h, name: 'Agent un', dir: await agentDir(h, 'agent-un', 'skills') });
  assert.equal(un.id, 'custom-1');
  assert.equal((await raw(h)).nextCustom, 2);
  await removeCustomAgent({ home: h, id: un.id });
  // Rien ne reste de l'agent : ni dossier désactivé, ni sauvegarde. L'identifiant ne revient pas.
  assert.equal(await lexists(path.join(h, '.skill-advisor', 'disabled')), false);
  const deux = await addCustomAgent({ home: h, name: 'Agent deux', dir: await agentDir(h, 'agent-deux', 'skills') });
  assert.equal(deux.id, 'custom-2');
  assert.equal((await raw(h)).nextCustom, 3);
  // Masquer, montrer, cibler : le compteur reste.
  await hideAgent({ home: h, id: 'codex' });
  await showAgent({ home: h, id: 'codex' });
  await setTargets({ home: h, ids: ['codex'] });
  await removeCustomAgent({ home: h, id: deux.id });
  assert.equal((await raw(h)).nextCustom, 3);
  assert.equal((await readSettings({ home: h })).nextCustom, 3);
  const trois = await addCustomAgent({ home: h, name: 'Agent trois', dir: await agentDir(h, 'agent-trois', 'skills') });
  assert.equal(trois.id, 'custom-3');
});

test('compteur absent (réglages d’une ancienne version) : repris des agents, des désactivés et des sauvegardes', async () => {
  const h = await home();
  const sa = path.join(h, '.skill-advisor');
  assertInHome(h, sa);
  // Une sauvegarde cite custom-4, un dossier de skills désactivés cite custom-6.
  const b = path.join(sa, 'backups', '20261113-100000-prive');
  await fs.mkdir(path.join(b, 'prive'), { recursive: true });
  await fs.writeFile(path.join(b, 'prive', 'SKILL.md'), skillMd('prive', 'Privé.'));
  await fs.writeFile(path.join(b, 'meta.json'), JSON.stringify({ version: 2, id: '20261113-100000-prive', label: '', note: '', origin: 'remove', at: '2026-11-13T10:00:00.000Z', size: 1,
    items: [{ name: 'prive', src: '', agents: ['custom-4'], places: [{ agent: 'custom-4', off: false, copy: 'prive' }], lock: null, skipped: [], copy: 'prive', verdict: 'vert' }] }));
  let a = await addCustomAgent({ home: h, name: 'Après sauvegarde', dir: await agentDir(h, 'a', 'skills') });
  assert.equal(a.id, 'custom-5');
  await removeCustomAgent({ home: h, id: a.id });
  await fs.mkdir(path.join(sa, 'disabled', 'custom-6'), { recursive: true });
  // Réglages réécrits à la main, sans compteur.
  await fs.writeFile(file(h), JSON.stringify({ version: 1, custom: [], hidden: [], targets: [] }));
  a = await addCustomAgent({ home: h, name: 'Après désactivés', dir: await agentDir(h, 'b', 'skills') });
  assert.equal(a.id, 'custom-7');
});

test('le même dossier réel ne s’ajoute pas deux fois (EXISTS), un dossier imbriqué non plus', async () => {
  const h = await home();
  const dir = await agentDir(h, 'mon-agent', 'skills');
  await addCustomAgent({ home: h, name: 'Mon agent', dir });
  const same = (e) => codeOf('EXISTS')(e) && /Mon agent/.test(e.message) && !/custom-/.test(e.message);
  await assert.rejects(addCustomAgent({ home: h, name: 'Mon agent bis', dir }), same);
  // Par un lien, puis par une autre casse sur mac et Windows.
  const via = path.join(h, 'raccourci');
  await fs.symlink(dir, via, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(addCustomAgent({ home: h, name: 'Par lien', dir: via }), same);
  if (process.platform === 'darwin' || process.platform === 'win32') {
    await assert.rejects(addCustomAgent({ home: h, name: 'Casse', dir: path.join(h, 'Mon-Agent', 'Skills') }), same);
  }
  // Parent ou enfant du dossier d'un autre agent ajouté à la main : refusé aussi.
  await assert.rejects(addCustomAgent({ home: h, name: 'Parent', dir: path.join(h, 'mon-agent') }), codeOf('BAD_INPUT'));
  await assert.rejects(addCustomAgent({ home: h, name: 'Enfant', dir: await agentDir(h, 'mon-agent', 'skills', 'sous') }), codeOf('BAD_INPUT'));
  assert.deepEqual((await readSettings({ home: h })).custom.map((c) => c.id), ['custom-1']);
  // Un autre dossier passe.
  const autre = await addCustomAgent({ home: h, name: 'Autre', dir: await agentDir(h, 'autre-agent', 'skills') });
  assert.equal(autre.id, 'custom-2');
});

// --- Retrait d'un agent : ses skills désactivés reviennent dans son dossier ---

test('retirer un agent remet ses skills désactivés dans son dossier', async () => {
  const h = await home();
  const dir = await agentDir(h, 'mon-agent', 'skills');
  const ag = await addCustomAgent({ home: h, name: 'Mon agent', dir });
  await putSkill(h, dir, 'actif');
  const off = path.join(h, '.skill-advisor', 'disabled', ag.id);
  await putSkill(h, off, 'prive', 'Désactivé.');
  await fs.mkdir(path.join(off, 'prive', 'docs'));
  await fs.writeFile(path.join(off, 'prive', 'docs', 'a.md'), 'doc');
  await removeCustomAgent({ home: h, id: ag.id });
  assert.equal(await fs.readFile(path.join(dir, 'prive', 'docs', 'a.md'), 'utf8'), 'doc');
  assert.match(await fs.readFile(path.join(dir, 'prive', 'SKILL.md'), 'utf8'), /Désactivé/);
  assert.ok(await lexists(path.join(dir, 'actif', 'SKILL.md')));
  assert.equal(await lexists(path.join(off, 'prive')), false);
  assert.deepEqual((await readSettings({ home: h })).custom, []);
});

test('retirer un agent : conflit de nom, rien ne change ; copie identique, la copie désactivée part', async () => {
  const h = await home();
  const dir = await agentDir(h, 'mon-agent', 'skills');
  const ag = await addCustomAgent({ home: h, name: 'Mon agent', dir });
  await setTargets({ home: h, ids: [ag.id] });
  const off = path.join(h, '.skill-advisor', 'disabled', ag.id);
  await putSkill(h, off, 'libre', 'Seulement désactivé.');
  await putSkill(h, off, 'double', 'Version désactivée.');
  await putSkill(h, dir, 'double', 'Version active.');
  await assert.rejects(removeCustomAgent({ home: h, id: ag.id }), (e) => codeOf('EXISTS')(e) && /double/.test(e.message) && !/custom-/.test(e.message));
  // Rien n'a bougé : l'agent reste, les deux copies aussi, et le skill libre n'a pas été déplacé seul.
  assert.deepEqual((await readSettings({ home: h })).custom.map((c) => c.id), [ag.id]);
  assert.deepEqual((await readSettings({ home: h })).targets, [ag.id]);
  assert.match(await fs.readFile(path.join(off, 'double', 'SKILL.md'), 'utf8'), /Version désactivée/);
  assert.match(await fs.readFile(path.join(dir, 'double', 'SKILL.md'), 'utf8'), /Version active/);
  assert.ok(await lexists(path.join(off, 'libre', 'SKILL.md')));
  assert.equal(await lexists(path.join(dir, 'libre')), false);
  // Même contenu des deux côtés : la copie désactivée est en trop.
  await fs.writeFile(path.join(off, 'double', 'SKILL.md'), await fs.readFile(path.join(dir, 'double', 'SKILL.md')));
  await removeCustomAgent({ home: h, id: ag.id });
  assert.match(await fs.readFile(path.join(dir, 'double', 'SKILL.md'), 'utf8'), /Version active/);
  assert.ok(await lexists(path.join(dir, 'libre', 'SKILL.md')));
  assert.equal(await lexists(path.join(off, 'double')), false);
  assert.equal(await lexists(path.join(off, 'libre')), false);
  const s = await readSettings({ home: h });
  assert.deepEqual(s.custom, []);
  assert.deepEqual(s.targets, []);
});

test('retirer un agent dont le dossier a disparu : le dossier est recréé pour ses skills désactivés', async () => {
  const h = await home();
  const dir = await agentDir(h, 'parti', 'skills');
  const ag = await addCustomAgent({ home: h, name: 'Parti', dir });
  await putSkill(h, path.join(h, '.skill-advisor', 'disabled', ag.id), 'prive');
  await fs.rm(path.join(h, 'parti'), { recursive: true });
  await removeCustomAgent({ home: h, id: ag.id });
  assert.ok(await lexists(path.join(dir, 'prive', 'SKILL.md')));
  // Agent inconnu : message sans identifiant interne, avec le terme de l'interface.
  await assert.rejects(removeCustomAgent({ home: h, id: 'custom-9' }), (e) => codeOf('NOT_FOUND')(e) && /ajouté à la main/.test(e.message) && !/custom-9|personnalisé/.test(e.message));
});

// --- Dossiers refusés (constat 88) ---

test('dossiers du système et dossiers d’identifiants : refusés sur chaque système (fonction pure)', () => {
  const { customDirProblem } = settings;
  assert.equal(typeof customDirProblem, 'function');
  const posix = (dir, platform = 'linux') => customDirProblem({ dir, home: '/home/léa', platform, env: {} });
  for (const d of ['/etc', '/etc/ssh', '/usr', '/usr/share/agent', '/usr/localx/agent', '/bin', '/sbin', '/lib', '/boot', '/dev', '/proc/1', '/sys', '/private']) assert.ok(posix(d), d);
  for (const d of ['/System', '/System/Library', '/Library', '/Library/Application Support/x', '/Applications', '/private/etc', '/ETC', '/library']) assert.ok(posix(d, 'darwin'), d);
  for (const d of ['.ssh', '.ssh/cles', '.gnupg', '.aws', '.config/gh', '.config', '.kube', '.docker', '.password-store', '.local/share/keyrings']) assert.ok(posix('/home/léa/' + d), d);
  assert.ok(customDirProblem({ dir: '/Users/léa/Library/Keychains', home: '/Users/léa', platform: 'darwin', env: {} }));
  // Dossiers ordinaires : acceptés, même sur un autre disque ou avec espaces et accents.
  for (const d of ['/home/léa/agents/skills', '/home/léa/.mon-agent/skills', '/home/léa/.config/mon agent/skills', '/home/léa/Documents/été/skills', '/opt/agent/skills', '/srv/agents', '/mnt/disque/agent',
    '/var/folders/ab/T/x', '/tmp/x', '/home/autre/skills']) assert.equal(posix(d), null, d);
  for (const d of ['/Volumes/SSD/agent/skills', '/Users/léa/Library/Application Support/Agent/skills', '/Users/léa/mes agents/skills']) {
    assert.equal(customDirProblem({ dir: d, home: '/Users/léa', platform: 'darwin', env: {} }), null, d);
  }
  // Sous Linux, la casse compte : /ETC n'est pas /etc.
  assert.equal(posix('/ETC/agent'), null);
  // Dossier personnel placé sous un dossier du système (dossier jetable des tests, /usr/home) : ses sous-dossiers passent.
  assert.equal(customDirProblem({ dir: '/usr/home/léa/agent/skills', home: '/usr/home/léa', platform: 'freebsd', env: {} }), null);
  assert.ok(customDirProblem({ dir: '/usr/home/léa/.ssh', home: '/usr/home/léa', platform: 'freebsd', env: {} }));
  // Windows : variables du système, casse ignorée, lecteur du système autre que C:.
  const env = { SystemRoot: 'D:\\Windows', ProgramFiles: 'D:\\Program Files', 'ProgramFiles(x86)': 'D:\\Program Files (x86)', ProgramData: 'D:\\ProgramData' };
  const win = (dir, e = env) => customDirProblem({ dir, home: 'C:\\Users\\Léa', platform: 'win32', env: e });
  for (const d of ['C:\\Windows', 'c:\\windows\\System32', 'C:\\Program Files\\Outil', 'C:\\Program Files (x86)\\Outil', 'C:\\ProgramData\\x', 'D:\\Windows\\Temp', 'D:\\Program Files\\x', 'd:\\programdata',
    'C:\\Users\\Léa\\.ssh', 'C:\\Users\\Léa\\.SSH\\cles', 'C:\\Users\\Léa\\.aws', 'C:\\Users\\Léa\\AppData\\Roaming\\gnupg', 'C:\\Users\\Léa\\AppData\\Roaming', 'C:\\Users\\Léa\\.config\\gh']) assert.ok(win(d), d);
  for (const d of ['C:\\Users\\Léa\\mon agent\\skills', 'C:\\Users\\Léa\\AppData\\Roaming\\MonAgent\\skills', 'E:\\agents\\skills', 'C:\\outils\\agent']) assert.equal(win(d), null, d);
  assert.ok(win('C:\\Windows', {}), 'valeurs par défaut sans variables');
  // Le message est une phrase en français, sans chemin interne.
  assert.match(posix('/etc'), /système/);
  assert.match(posix('/home/léa/.ssh'), /clés|mots de passe/);
});

// Constat 88 (suite) : les dossiers communs à tout le système sont refusés tels quels ; leurs sous-dossiers passent.
test('dossiers communs refusés seulement tels quels : /, /tmp, /var/tmp, /opt, /usr/local, C:\\, C:\\Users (fonction pure)', () => {
  const { customDirProblem } = settings;
  const posix = (dir, platform = 'linux') => customDirProblem({ dir, home: '/home/léa', platform, env: {} });
  for (const d of ['/', '/tmp', '/tmp/', '/var/tmp', '/opt', '/opt/', '/usr/local']) assert.match(posix(d) || '', /sous-dossier/, d);
  for (const d of ['/private/tmp', '/private/var/tmp', '/tmp', '/opt', '/OPT', '/Private/Tmp']) assert.ok(customDirProblem({ dir: d, home: '/Users/léa', platform: 'darwin', env: {} }), d);
  for (const d of ['/tmp/agent', '/var/tmp/x/skills', '/opt/agent/skills', '/opt/outils']) assert.equal(posix(d), null, d);
  for (const d of ['/private/tmp/agent', '/private/var/tmp/x', '/opt/agent']) assert.equal(customDirProblem({ dir: d, home: '/Users/léa', platform: 'darwin', env: {} }), null, d);
  // /var lui-même n'est pas visé. Sous /usr/local, les sous-dossiers passent ; le reste de /usr reste refusé.
  assert.equal(posix('/var/lib/agent'), null);
  for (const d of ['/usr/local/share/agent', '/usr/local/mon-agent']) {
    assert.equal(posix(d), null, d);
    assert.equal(customDirProblem({ dir: d, home: '/Users/léa', platform: 'darwin', env: {} }), null, d);
  }
  for (const d of ['/usr', '/usr/bin', '/usr/share/x']) assert.match(posix(d), /système/, d);
  // Le dossier proposé par le message passe lui-même.
  for (const d of ['/tmp', '/opt', '/usr/local']) assert.equal(posix(/par exemple (\S+)\.$/.exec(posix(d))[1]), null, d);
  const win = (dir) => customDirProblem({ dir, home: 'C:\\Users\\Léa', platform: 'win32', env: {} });
  for (const d of ['C:\\', 'c:\\', 'C:\\Users', 'c:\\users', 'C:\\Users\\']) assert.match(win(d) || '', /sous-dossier/, d);
  for (const d of ['C:\\Users\\Public\\agent', 'C:\\Users\\Autre\\skills', 'C:\\outils\\agent']) assert.equal(win(d), null, d);
  // Phrase en français, vous, sans tiret long.
  assert.doesNotMatch(posix('/tmp'), /\u2014/);
});

test('ajout refusé pour un dossier d’identifiants ou du système ; un dossier ordinaire passe', async () => {
  const h = await home();
  for (const rel of [['.ssh'], ['.gnupg'], ['.aws'], ['.config', 'gh'], ['.config']]) {
    const d = await agentDir(h, ...rel);
    await assert.rejects(addCustomAgent({ home: h, name: 'X', dir: d }), (e) => codeOf('BAD_INPUT')(e) && /clés|mots de passe/.test(e.message), d);
  }
  // Dossier du système : lu seulement (chemin réel), jamais modifié.
  const sys = process.platform === 'win32' ? (process.env.SystemRoot || 'C:\\Windows') : '/etc';
  await assert.rejects(addCustomAgent({ home: h, name: 'X', dir: sys }), (e) => codeOf('BAD_INPUT')(e) && /système/.test(e.message));
  assert.equal(await lexists(file(h)), false, 'aucun réglage écrit');
  const ok = await addCustomAgent({ home: h, name: 'Mon agent', dir: await agentDir(h, '.config', 'mon agent', 'skills') });
  assert.equal(ok.id, 'custom-1');
  // Réglages modifiés à la main : un dossier refusé est ignoré à la lecture.
  const s = await raw(h);
  s.custom.push({ id: 'custom-7', name: 'Clés', dir: path.join(h, '.ssh') }, { id: 'custom-8', name: 'Système', dir: sys });
  await fs.writeFile(file(h), JSON.stringify(s));
  assert.deepEqual((await readSettings({ home: h })).custom.map((c) => c.id), ['custom-1']);
  assert.deepEqual((await listAgents({ home: h })).filter((a) => a.custom).map((a) => a.id), ['custom-1']);
});

// --- Chemin collé (constat 83) ---

test('chemin entre guillemets, ou qui commence par ~ ou %USERPROFILE% : compris', async () => {
  const h = await home();
  const un = await agentDir(h, 'mon agent', 'skills');
  const a = await addCustomAgent({ home: h, name: 'Guillemets', dir: '"' + un + '"' });
  assert.equal(a.dir, un);
  const deux = await agentDir(h, 'été', 'skills');
  const b = await addCustomAgent({ home: h, name: 'Tilde', dir: '~' + path.sep + path.join('été', 'skills') });
  assert.equal(b.dir, deux);
  const trois = await agentDir(h, 'trois', 'skills');
  const c = await addCustomAgent({ home: h, name: 'Variable', dir: ' %USERPROFILE%' + path.sep + path.join('trois', 'skills') + ' ' });
  assert.equal(c.dir, trois);
  // Un chemin relatif reste refusé ; ~ seul désigne le dossier personnel, refusé lui aussi.
  await assert.rejects(addCustomAgent({ home: h, name: 'X', dir: '"relatif/skills"' }), codeOf('BAD_NAME'));
  await assert.rejects(addCustomAgent({ home: h, name: 'X', dir: '~' }), codeOf('BAD_INPUT'));
  await assert.rejects(addCustomAgent({ home: h, name: 'X', dir: '~autre/skills' }), codeOf('BAD_NAME'));
});

// --- Réglages gardés, noms des agents ---

test('catalogUrl et les clés inconnues survivent aux écritures ; une adresse invalide est ignorée', async () => {
  const h = await home();
  await fs.mkdir(path.dirname(file(h)), { recursive: true });
  await fs.writeFile(file(h), JSON.stringify({ version: 1, custom: [], hidden: [], targets: [], catalogUrl: 'https://catalogue.example.org', futur: { a: 1 } }));
  assert.equal((await readSettings({ home: h })).catalogUrl, 'https://catalogue.example.org');
  await hideAgent({ home: h, id: 'codex' });
  await addCustomAgent({ home: h, name: 'Mon agent', dir: await agentDir(h, 'mon-agent', 'skills') });
  const s = await raw(h);
  assert.equal(s.catalogUrl, 'https://catalogue.example.org');
  assert.deepEqual(s.futur, { a: 1 });
  assert.deepEqual(s.hidden, ['codex']);
  for (const bad of [3, '', 'ftp://x', 'javascript:alert(1)', 'https://' + 'x'.repeat(2100), 'https://a b']) {
    await fs.writeFile(file(h), JSON.stringify({ version: 1, catalogUrl: bad }));
    assert.equal((await readSettings({ home: h })).catalogUrl, undefined, String(bad).slice(0, 30));
  }
  // Fichier illisible ou d'une autre forme : réglages vides, sans erreur.
  for (const text of ['[1,2]', '"x"', '{pas du json', 'null']) {
    await fs.writeFile(file(h), text);
    const r = await readSettings({ home: h });
    assert.deepEqual([r.custom, r.hidden, r.targets, r.nextCustom], [[], [], [], 1]);
  }
});

test('agentMap donne le nom affiché de chaque agent', async () => {
  const h = await home();
  await addCustomAgent({ home: h, name: 'Mon agent', dir: await agentDir(h, 'mon-agent', 'skills') });
  const map = await agentMap({ home: h });
  assert.equal(map['claude-code'].name, 'Claude Code');
  assert.equal(map['custom-1'].name, 'Mon agent');
  for (const a of Object.values(map)) assert.ok(typeof a.name === 'string' && a.name.length > 0, a.id);
});

// --- Verrous passagers de Windows (constat 82) ---

test('renommage retenté sous Windows sur EPERM, EBUSY, EACCES ; jamais ailleurs', async () => {
  const { disk, renameRetry } = settings;
  assert.ok(disk && typeof renameRetry === 'function');
  const h = await home();
  const a = path.join(h, 'a.txt'), b = path.join(h, 'b.txt');
  await fs.writeFile(a, 'x');
  const old = { ...disk };
  const busy = (code) => Object.assign(new Error(code), { code });
  try {
    disk.delays = [1, 1, 1, 1];
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      let calls = 0;
      disk.platform = 'win32';
      disk.rename = async (x, y) => { if (++calls < 3) throw busy(code); return old.rename(x, y); };
      await renameRetry(a, b);
      assert.equal(calls, 3, code);
      assert.equal(await fs.readFile(b, 'utf8'), 'x');
      await fs.rename(b, a);
    }
    // Verrou qui dure : 1 essai puis un par attente, puis l'erreur d'origine.
    let calls = 0;
    disk.rename = async () => { calls++; throw busy('EBUSY'); };
    await assert.rejects(renameRetry(a, b), (e) => e.code === 'EBUSY');
    assert.equal(calls, 5);
    // Autre erreur : aucun nouvel essai.
    calls = 0;
    disk.rename = async () => { calls++; throw busy('ENOENT'); };
    await assert.rejects(renameRetry(a, b), (e) => e.code === 'ENOENT');
    assert.equal(calls, 1);
    // Arrêt demandé par l'appelant (la destination existe) : pas d'attente inutile.
    calls = 0;
    disk.rename = async () => { calls++; throw busy('EPERM'); };
    await assert.rejects(renameRetry(a, b, { stop: async () => true }), (e) => e.code === 'EPERM');
    assert.equal(calls, 1);
    // mac et Linux : EPERM est un vrai refus, un seul essai.
    for (const platform of ['darwin', 'linux']) {
      calls = 0;
      disk.platform = platform;
      await assert.rejects(renameRetry(a, b), (e) => e.code === 'EPERM');
      assert.equal(calls, 1, platform);
    }
    // Effacement : essais répétés sous Windows seulement.
    disk.platform = 'win32';
    assert.equal(settings.rmOpts().maxRetries, 5);
    assert.equal(settings.rmOpts().recursive, true);
    disk.platform = 'linux';
    assert.equal(settings.rmOpts().maxRetries, undefined);
  } finally { Object.assign(disk, old); }
});

// Une seule boucle d'essais, dans util : réglages, sauvegardes, verrou et actions passent par elle (constat 82).
test('écriture atomique et remplacement de skill retentés sous Windows ; jamais ailleurs', async () => {
  const util = await import('../lib/util.mjs');
  const { disk } = settings;
  assert.equal(util.disk, disk, 'un seul objet disk, partagé par util et settings');
  assert.equal(util.renameRetry, settings.renameRetry);
  const h = await home();
  const target = path.join(h, '.skill-advisor', 'essai.json');
  const old = { ...disk };
  const busy = (code) => Object.assign(new Error(code), { code });
  try {
    disk.delays = [1, 1, 1, 1];
    disk.platform = 'win32';
    // writeJsonAtomic : le renommage du fichier temporaire échoue deux fois (antivirus), puis passe.
    let calls = 0;
    disk.rename = async (x, y) => { if (++calls < 3) throw busy('EPERM'); return old.rename(x, y); };
    await util.writeJsonAtomic(target, { a: 1 });
    assert.equal(calls, 3);
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { a: 1 });
    // Verrou qui dure : l'erreur d'origine, et aucun fichier temporaire laissé.
    calls = 0;
    disk.rename = async () => { calls++; throw busy('EBUSY'); };
    await assert.rejects(util.writeJsonAtomic(target, { a: 2 }), (e) => e.code === 'EBUSY');
    assert.equal(calls, 5);
    assert.deepEqual((await fs.readdir(path.dirname(target))).filter((f) => f.endsWith('.tmp')), []);
    // Ailleurs que sous Windows : un seul essai.
    calls = 0;
    disk.platform = 'linux';
    await assert.rejects(util.writeJsonAtomic(target, { a: 3 }), (e) => e.code === 'EBUSY');
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), { a: 1 });
    // Remplacement d'un skill (swapIn) : copie vers un agent personnalisé, chaque renommage échoue une fois.
    Object.assign(disk, old);
    const dir = path.join(h, 'agent-essai', 'skills');
    await fs.mkdir(dir, { recursive: true });
    const ag = await addCustomAgent({ home: h, name: 'Agent essai', dir });
    const src = path.join(h, '.agents', 'skills', 'essai-skill');
    assertInHome(h, src);
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'SKILL.md'), skillMd('essai-skill', 'Essai.'));
    const { createManualBackup } = await import('../lib/backups.mjs');
    const { applyBackup } = await import('../lib/actions.mjs');
    const { backup: b } = await createManualBackup({ home: h, names: ['essai-skill'] });
    disk.platform = 'win32';
    disk.delays = [1, 1, 1, 1];
    const seen = new Set();
    let fails = 0;
    disk.rename = async (x, y) => { if (!seen.has(x)) { seen.add(x); fails++; throw busy('EACCES'); } return old.rename(x, y); };
    const r = await applyBackup({ home: h, id: b.id, agents: [ag.id], conflict: 'skip' });
    assert.deepEqual(r.failed, []);
    assert.deepEqual(r.applied, [{ name: 'essai-skill', agent: ag.id }]);
    assert.ok(fails >= 1);
    assert.ok(await lexists(path.join(dir, 'essai-skill', 'SKILL.md')));
    assert.deepEqual((await fs.readdir(dir)).filter((f) => f.startsWith('.sa-')), [], 'aucun dossier caché laissé');
  } finally { Object.assign(disk, old); }
});
