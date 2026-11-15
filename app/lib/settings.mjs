// Réglages : ~/.skill-advisor/settings.json (agents ajoutés à la main, agents masqués, cibles, adresse du catalogue).
import fs from 'node:fs/promises';
import path from 'node:path';
import { call } from './worker.mjs';
import { AGENT_RE, NAME_RE, backupsDir, checkAgentId, disabledDir, fail, fsMessage, homeOf, isSkillEntry, lstatOrNull, readJson, realish, renameRetry, rmOpts, saDir, safeJoin, sharedDir, treeHash, within, writeJsonAtomic } from './util.mjs';

// Verrous passagers de Windows : la boucle d'essais vit dans util.mjs (un seul objet disk), reprise ici pour les anciens appels.
export { disk, renameRetry, rmOpts } from './util.mjs';

const file = (home) => path.join(saDir(home), 'settings.json');
const uniq = (a) => [...new Set(a)];
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const CUSTOM_RE = /^custom-\d{1,9}$/;
const numOf = (id) => Number(id.slice(7));

// --- Lecture et écriture ---

// Adresse du catalogue écrite dans les réglages : chaîne http ou https lisible. Le catalogue applique ses propres règles.
function validUrl(u) {
  if (typeof u !== 'string' || !u || u.length > 2000) return false;
  try { return ['https:', 'http:'].includes(new URL(u).protocol); } catch { return false; }
}

export async function readSettings(opts = {}) {
  const home = homeOf(opts);
  const got = await readJson(file(home), {});
  const raw = isObj(got) ? got : {};
  const ids = (a) => (Array.isArray(a) ? uniq(a.filter((x) => typeof x === 'string' && AGENT_RE.test(x))) : []);
  const custom = Array.isArray(raw.custom) ? raw.custom.filter((c) => c && CUSTOM_RE.test(c.id) && typeof c.name === 'string' && typeof c.dir === 'string' && path.isAbsolute(c.dir) && !roughlyBad(home, c.dir)) : [];
  // nextCustom : numéro du prochain agent ajouté à la main. Il ne redescend jamais.
  const top = custom.reduce((m, c) => Math.max(m, numOf(c.id)), 0);
  const nextCustom = Number.isSafeInteger(raw.nextCustom) && raw.nextCustom > top ? raw.nextCustom : top + 1;
  const out = { version: 1, custom: custom.map((c) => ({ id: c.id, name: c.name, dir: c.dir })), hidden: ids(raw.hidden), targets: ids(raw.targets), nextCustom };
  if (validUrl(raw.catalogUrl)) out.catalogUrl = raw.catalogUrl;
  return out;
}

// Dossiers du système, jamais un dossier d'agent.
const SYSTEM_POSIX = ['/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/dev', '/proc', '/sys', '/System', '/Library', '/Applications', '/private/etc', '/cores'];
const SYSTEM_WIN = ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'];
// Dossiers communs, refusés seulement tels quels (sous macOS, /tmp et /var/tmp ont pour chemin réel /private/...).
const COMMON_POSIX = ['/', '/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/opt', '/usr/local'];
const COMMON_WIN = ['C:\\', 'C:\\Users'];
const SYSTEM_WIN_ENV =['SystemRoot', 'windir', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'ALLUSERSPROFILE'];
// Dossiers d'identifiants du dossier personnel (clés SSH et GPG, comptes cloud, trousseaux).
const SECRET_DIRS = ['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.password-store', '.config/gh', '.config/gcloud', '.config/op', '.local/share/keyrings',
  'Library/Keychains', 'AppData/Roaming/gnupg', 'AppData/Roaming/GitHub CLI', 'AppData/Roaming/Microsoft/Credentials', 'AppData/Roaming/Microsoft/Protect', 'AppData/Local/Microsoft/Credentials'];

// Rend la raison (phrase) pour laquelle un dossier ne peut pas servir de dossier d'agent, ou null.
// Fonction pure : la plateforme et les variables sont passées, pour être testée sur chaque système. dir et home : chemins réels.
export function customDirProblem({ dir, home, platform = process.platform, env = process.env }) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  const fold = (s) => (platform === 'darwin' || platform === 'win32' ? s.toLowerCase() : s);
  const inside = (child, parent) => {
    const rel = P.relative(fold(P.resolve(parent)), fold(P.resolve(child)));
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + P.sep) && !P.isAbsolute(rel));
  };
  const touches = (a, b) => inside(a, b) || inside(b, a);
  // Dossiers communs à tout le système : refusés tels quels, leurs sous-dossiers passent (/opt/agent, /tmp/essai).
  const common = platform === 'win32' ? COMMON_WIN : COMMON_POSIX;
  if (common.some((d) => inside(dir, d) && inside(d, dir))) return 'Ce dossier sert à tout le système. Choisissez un sous-dossier à vous, par exemple ' + P.join(dir, 'mon-agent') + '.';
  if (inside(dir, home)) {
    // Dans le dossier personnel : tout est permis, sauf ce qui touche un dossier d'identifiants.
    for (const rel of SECRET_DIRS) {
      if (touches(dir, P.join(home, ...rel.split('/')))) return 'Ce dossier garde des clés ou des mots de passe. Choisissez un autre dossier.';
    }
    return null;
  }
  const system = platform === 'win32'
    ? [...SYSTEM_WIN, ...SYSTEM_WIN_ENV.map((k) => env[k]).filter((v) => typeof v === 'string' && P.isAbsolute(v))]
    : SYSTEM_POSIX;
  // Sous-dossier de /usr/local (outils posés par l'utilisateur) : la règle de /usr ne s'applique pas.
  const local = platform !== 'win32' && inside(dir, '/usr/local') && !inside('/usr/local', dir);
  for (const d of system) {
    if (local && d === '/usr') continue;
    if (touches(dir, d)) return 'Ce dossier appartient au système. Choisissez un dossier à vous, par exemple dans votre dossier personnel.';
  }
  return null;
}

// Contrôle rapide, sans disque, des réglages modifiés à la main.
function roughlyBad(home, dir) {
  const d = path.resolve(dir);
  return path.parse(d).root === d || within(home, d) || within(d, saDir(home)) || within(d, sharedDir(home)) || within(sharedDir(home), d)
    || !!customDirProblem({ dir: d, home: path.resolve(home) });
}

// Refuse un dossier où supprimer ou déplacer toucherait autre chose que les skills de cet agent.
async function checkCustomDir(home, real, others) {
  const bad = (m) => fail('BAD_INPUT', m);
  if (path.parse(real).root === real) throw bad('La racine du disque ne peut pas servir de dossier d’agent.');
  const realHome = await realish(home);
  if (within(realHome, real)) throw bad('Le dossier personnel et ses dossiers parents ne peuvent pas servir de dossier d’agent.');
  if (within(real, await realish(saDir(home)))) throw bad('Les dossiers de Skill Advisor ne peuvent pas servir de dossier d’agent.');
  const shared = await realish(sharedDir(home));
  if (within(real, shared) || within(shared, real)) throw bad('Ce dossier touche le dossier partagé. Choisissez un autre dossier.');
  const why = customDirProblem({ dir: real, home: realHome });
  if (why) throw bad(why);
  // Autres agents ajoutés à la main : le même dossier compterait chaque skill deux fois, et vider l'un viderait l'autre.
  for (const c of others) {
    const d = await realish(c.dir);
    if (within(real, d) && within(d, real)) throw fail('EXISTS', 'Ce dossier est déjà celui de l’agent ' + c.name + '. Choisissez un autre dossier.');
    if (within(real, d) || within(d, real)) throw bad('Ce dossier touche celui de l’agent ' + c.name + '. Choisissez un autre dossier.');
  }
  const agents = await call('getSupportedAgents', [], { home });
  for (const a of agents) {
    if (!a.globalSkillsDir) continue;
    const d = await realish(a.globalSkillsDir);
    if (within(real, d) || within(d, real)) throw bad('Ce dossier touche celui de l’agent ' + (a.name || a.id) + ' : ' + a.globalSkillsDir + '. Choisissez un autre dossier.');
  }
}

// Écrit les réglages. Les clés que cette version ne connaît pas restent dans le fichier.
async function save(home, s) {
  const got = await readJson(file(home), {});
  await writeJsonAtomic(file(home), { ...(isObj(got) ? got : {}), ...s });
  return s;
}

// Chemin collé depuis l'Explorateur ou un terminal : guillemets autour, ~ ou %USERPROFILE% au début.
function cleanDir(home, dir) {
  let d = dir.trim();
  if (d.length > 1 && ((d.startsWith('"') && d.endsWith('"')) || (d.startsWith('\'') && d.endsWith('\'')))) d = d.slice(1, -1).trim();
  const m = /^(~|%USERPROFILE%)(?=$|[\\/])/i.exec(d);
  return m ? path.join(home, d.slice(m[0].length)) : d;
}

// Plus grand numéro custom-<n> déjà vu : dossiers de skills désactivés et sauvegardes.
// Un identifiant repris enverrait une ancienne sauvegarde dans le dossier d'un autre agent.
async function seenCustom(home) {
  let max = 0;
  for (const id of await fs.readdir(disabledDir(home)).catch(() => [])) if (CUSTOM_RE.test(id)) max = Math.max(max, numOf(id));
  const root = backupsDir(home);
  for (const b of await fs.readdir(root).catch(() => [])) {
    const text = await fs.readFile(path.join(root, b, 'meta.json'), 'utf8').catch(() => '');
    for (const m of text.matchAll(/"custom-(\d{1,9})"/g)) max = Math.max(max, Number(m[1]));
  }
  return max;
}

export async function addCustomAgent(opts = {}) {
  const home = homeOf(opts);
  const name = typeof opts.name === 'string' ? opts.name.trim() : '';
  if (name.length < 1 || name.length > 60) throw fail('BAD_NAME', 'Le nom de l’agent doit compter de 1 à 60 caractères.');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw fail('BAD_NAME', 'Le nom de l’agent contient un caractère de contrôle.');
  const dir = typeof opts.dir === 'string' ? cleanDir(home, opts.dir) : '';
  if (!dir || !path.isAbsolute(dir)) throw fail('BAD_NAME', 'Indiquez un chemin complet pour le dossier de l’agent.');
  let st, real;
  try { real = await fs.realpath(dir); st = await fs.stat(real); } catch { throw fail('NOT_FOUND', 'Le dossier n’existe pas : ' + dir + '.'); }
  if (!st.isDirectory()) throw fail('NOT_FOUND', 'Ce chemin n’est pas un dossier : ' + dir + '.');
  const s = await readSettings({ home });
  // Chemin réel : un lien ne peut pas masquer un dossier protégé.
  await checkCustomDir(home, real, s.custom);
  // Jamais un identifiant déjà vu : compteur des réglages, ou traces laissées par un ancien agent.
  const n = Math.max(s.nextCustom, (await seenCustom(home)) + 1);
  const agent = { id: 'custom-' + n, name, dir: real };
  s.custom.push(agent);
  s.nextCustom = n + 1;
  await save(home, s);
  return agent;
}

// Déplace un dossier de skill, même vers un autre disque (copie voisine cachée, renommage, puis effacement de la source).
async function moveDir(src, dest) {
  try { await renameRetry(src, dest); return; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  const tmp = path.join(path.dirname(dest), '.sa-move-' + process.pid + '-' + Date.now() + '-' + path.basename(dest));
  try {
    await fs.cp(src, tmp, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    await renameRetry(tmp, dest);
  } catch (e) {
    await fs.rm(tmp, rmOpts()).catch(() => {});
    throw e;
  }
  await fs.rm(src, rmOpts());
}

// Remet dans le dossier de l'agent ses skills désactivés : sans cela, ils resteraient cachés sous ~/.skill-advisor/disabled.
// Tout est vérifié avant le premier déplacement ; un échec défait les déplacements déjà faits.
async function putBackDisabled(home, agent) {
  const from = safeJoin(disabledDir(home), agent.id);
  const moves = [], extra = [];
  for (const n of await fs.readdir(from).catch(() => [])) {
    const src = path.join(from, n);
    if (!NAME_RE.test(n) || !(await isSkillEntry(src))) continue;
    const dest = safeJoin(agent.dir, n);
    const there = await lstatOrNull(dest);
    if (!there) { moves.push({ src, dest }); continue; }
    // Même contenu déjà en place : la copie désactivée est en trop.
    const same = there.isDirectory() && (await treeHash(src).catch(() => 1)) === (await treeHash(dest).catch(() => 2));
    if (!same) {
      throw fail('EXISTS', 'Un skill nommé ' + n + ' est à la fois désactivé et présent dans le dossier de cet agent. Désinstallez l’un des deux, puis retirez l’agent.');
    }
    extra.push(src);
  }
  const done = [];
  try {
    if (moves.length) await fs.mkdir(agent.dir, { recursive: true });
    for (const m of moves) { await moveDir(m.src, m.dest); done.push(m); }
  } catch (e) {
    for (const m of done.reverse()) await moveDir(m.dest, m.src).catch(() => {});
    throw fail('BACKUP_FAILED', 'Skill Advisor n’a pas pu remettre les skills désactivés de cet agent : ' + fsMessage(e) + '. L’agent reste dans la liste.');
  }
  // Le dossier disabled/<id> reste, même vide : il garde la trace de l'identifiant.
  for (const p of extra) await fs.rm(p, rmOpts()).catch(() => {});
}

export async function removeCustomAgent(opts = {}) {
  const home = homeOf(opts);
  const id = checkAgentId(opts.id);
  const s = await readSettings({ home });
  const agent = s.custom.find((c) => c.id === id);
  if (!agent) throw fail('NOT_FOUND', 'Cet agent ajouté à la main est introuvable.');
  await putBackDisabled(home, agent);
  s.custom = s.custom.filter((c) => c.id !== id);
  s.hidden = s.hidden.filter((x) => x !== id);
  s.targets = s.targets.filter((x) => x !== id);
  return save(home, s);
}

export async function hideAgent(opts = {}) {
  const home = homeOf(opts);
  const id = checkAgentId(opts.id);
  const s = await readSettings({ home });
  s.hidden = uniq([...s.hidden, id]);
  return save(home, s);
}

export async function showAgent(opts = {}) {
  const home = homeOf(opts);
  const id = checkAgentId(opts.id);
  const s = await readSettings({ home });
  s.hidden = s.hidden.filter((x) => x !== id);
  return save(home, s);
}

export async function setTargets(opts = {}) {
  const home = homeOf(opts);
  if (!Array.isArray(opts.ids)) throw fail('BAD_NAME', 'Liste d’agents attendue.');
  const ids = uniq(opts.ids.map(checkAgentId));
  const s = await readSettings({ home });
  s.targets = ids;
  return save(home, s);
}
