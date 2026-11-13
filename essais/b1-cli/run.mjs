// B1 : rejouer l'essai du CLI `skills` sur Windows et Linux.
// Question : ce qui est prouvé sur macOS (installer, lister, vérifier, mettre à jour, retirer, sans interaction)
// tient-il sur les autres systèmes ? Quelles différences (liens, chemins, lanceur, git absent) ?
//
// Usage : node run.mjs [--label <nom>] [--box <dossier>] [--espace] [--out <fichier>] [--stdout]
//   --label   nom de l'essai (défaut : système-architecture), sert au nom du fichier de résultat
//   --box     dossier parent du bac d'essai (défaut : sandbox/<label> à côté du script)
//   --out     fichier de résultat (défaut : resultat-<label>.json à côté du script) ; « - » = aucun fichier
//   --stdout  imprime aussi le résultat en base64 entre deux marqueurs (pour le rapatrier d'une machine virtuelle)
//
// Tout se passe dans <box>/b1-bac : un faux dossier personnel, un faux projet, un cache npm.
// Les journaux remplacent le chemin du bac et le dossier personnel réel par des marqueurs.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i > -1 ? argv[i + 1] : def; };
const WIN = process.platform === 'win32';
const LABEL = opt('label', process.platform + '-' + process.arch);
// --espace : le bac va dans un sous-dossier dont le nom porte une espace et un accent (compte « Zoé Martin »).
const BOX = path.join(path.resolve(opt('box', path.join(HERE, 'sandbox', LABEL))), ...(argv.includes('--espace') ? ['essai é b1'] : []), 'b1-bac');
const OUT = opt('out', path.join(HERE, 'resultat-' + LABEL + '.json'));
const CLI = 'skills@1.8.1';
const SRC = 'vercel-labs/agent-skills';
const SKILL = 'web-design-guidelines';
const REAL_HOME = os.homedir();
const USER = os.userInfo().username;

const HOME = path.join(BOX, 'perso');
const PROJ = path.join(BOX, 'projet');
const CACHE = path.join(BOX, 'npm-cache');
const PKG = path.join(BOX, 'paquet');

if (path.basename(BOX) !== 'b1-bac' || BOX.split(path.sep).length < 4) throw new Error('dossier d’essai inattendu');
fs.rmSync(BOX, { recursive: true, force: true });
for (const d of [HOME, PROJ, CACHE, PKG]) fs.mkdirSync(d, { recursive: true });

// --- Journaux sans données personnelles -------------------------------------------------------------------------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function clean(s) {
  if (s == null) return s;
  let t = String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
  for (const [a, b] of [[BOX, '<BAC>'], [REAL_HOME, '<DOSSIER-PERSONNEL>']]) {
    for (const v of new Set([a, a.replace(/\\/g, '/'), a.replace(/\\/g, '\\\\')])) t = t.replace(new RegExp(esc(v), WIN ? 'gi' : 'g'), b);
  }
  // Le nom du compte seulement quand il est un segment de chemin (« node » est aussi un nom de compte).
  if (USER) t = t.replace(new RegExp('([\\\\/])' + esc(USER) + '(?=[\\\\/]|$)', 'gm'), '$1<COMPTE>');
  return t;
}
const tail = (s, n) => (s.length > n ? '[…] ' + s.slice(-n) : s);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// --- Environnement confiné --------------------------------------------------------------------------------------
function env(extra = {}) {
  const e = { ...process.env };
  // Variables qui déplaceraient un dossier d'agent hors du bac : retirées, quelle que soit leur casse.
  for (const k of Object.keys(e)) {
    if (['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'].includes(k.toUpperCase())) delete e[k];
  }
  Object.assign(e, { HOME, USERPROFILE: HOME, DISABLE_TELEMETRY: '1', npm_config_cache: CACHE, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' }, extra);
  for (const k of ['HOME', 'USERPROFILE', 'npm_config_cache']) if (!e[k].startsWith(BOX)) throw new Error('variable non confinée : ' + k);
  return e;
}

// --- Lancer une commande et garder son journal ------------------------------------------------------------------
const steps = [];
function run(id, titre, cmd, args, o = {}) {
  const t0 = Date.now();
  // Sous Windows, npx, npm et git passent par l'interpréteur : npx et npm sont des fichiers .cmd.
  const shell = o.shell !== undefined ? o.shell : WIN;
  // Avec l'interpréteur, Node colle les arguments sans les protéger : un chemin à espace doit être mis entre guillemets.
  const sent = shell ? args.map((a) => (/[\s&()^]/.test(a) ? '"' + a + '"' : a)) : args;
  const r = spawnSync(cmd, sent, { cwd: o.cwd || HOME, env: o.env || env(), encoding: 'utf8', timeout: o.timeout || 300000, shell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const brut = (r.stdout || '') + (r.stderr || '');
  const step = {
    id, titre, commande: clean([cmd, ...args].join(' ')) + (o.note ? '   (' + o.note + ')' : ''),
    code: r.status, signal: r.signal || undefined,
    erreurLancement: r.error ? clean((r.error.code || '') + ' ' + r.error.message) : undefined,
    dureeMs: Date.now() - t0, sortie: tail(clean(brut).trim(), 3000),
  };
  steps.push(step);
  Object.defineProperty(step, 'brut', { value: brut, enumerable: false });
  return step;
}
function note(id, titre, ok, constat, extra = {}) {
  const step = { id, titre, ok, constat: clean(constat), ...extra };
  steps.push(step);
  return step;
}
const skills = (...args) => ['-y', CLI, ...args];
const started = (s) => !s.erreurLancement && s.code === 0;

// --- Lire le disque ---------------------------------------------------------------------------------------------
function count(dir) {
  let n = 0;
  for (const x of fs.readdirSync(dir)) { const p = path.join(dir, x); n += fs.lstatSync(p).isDirectory() ? count(p) : 1; }
  return n;
}
// Nature d'une entrée : absente, dossier (copie), lien symbolique, jonction (Windows).
function kind(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return { type: 'absent' }; }
  if (st.isSymbolicLink()) {
    let cible = null, type = 'lien symbolique';
    try { cible = fs.readlinkSync(p); } catch { /* cible illisible */ }
    if (WIN) {
      const d = spawnSync('cmd', ['/d', '/c', 'dir', '/AL', path.dirname(p)], { encoding: 'utf8', windowsHide: true });
      const line = (d.stdout || '').split(/\r?\n/).find((l) => l.includes(path.basename(p))) || '';
      if (line.includes('<JUNCTION>')) type = 'jonction';
    }
    return { type, cible: clean(cible), relatif: cible ? !path.isAbsolute(cible) : null, cibleValide: fs.existsSync(p) };
  }
  if (st.isDirectory()) return { type: 'dossier', fichiers: count(p) };
  return { type: 'fichier' };
}
const say = (k) => (k.type === 'absent' ? 'absent' : k.type === 'dossier' ? 'dossier de ' + k.fichiers + ' fichier(s)' : k.type + ' vers ' + k.cible + (k.cibleValide ? '' : ' (cible introuvable)'));
function json(step) {
  const m = step.brut.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').match(/\[[\s\S]*\]/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}
const rows = (list) => (list || []).map((x) => ({ name: x.name, scope: x.scope, agents: x.agents, source: x.source, status: x.status, path: clean(x.path) }));

// --- Le système ---------------------------------------------------------------------------------------------------
function system() {
  const s = { plateforme: process.platform, architecture: process.arch, noyau: os.release(), node: process.version };
  if (WIN) {
    const g = spawnSync('whoami', ['/groups'], { encoding: 'utf8', windowsHide: true }).stdout || '';
    s.niveauIntegrite = g.includes('S-1-16-16384') ? 'système' : g.includes('S-1-16-12288') ? 'élevé (administrateur)' : g.includes('S-1-16-8192') ? 'moyen (utilisateur ordinaire)' : 'inconnu';
    const dev = spawnSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock', '/v', 'AllowDevelopmentWithoutDevLicense'], { encoding: 'utf8', windowsHide: true }).stdout || '';
    s.modeDeveloppeur = /0x1\b/.test(dev) ? 'activé' : 'désactivé';
    const v = spawnSync('cmd', ['/d', '/c', 'ver'], { encoding: 'utf8', windowsHide: true }).stdout || '';
    s.version = v.trim();
  } else {
    s.uid = process.getuid();
    try { s.version = (fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)/m) || [])[1]; } catch { /* macOS */ }
  }
  return s;
}

// Sonde : ce compte a-t-il le droit de créer des liens ? Indépendant du CLI.
function probe() {
  const d = path.join(BOX, 'sonde');
  fs.mkdirSync(path.join(d, 'cible'), { recursive: true });
  fs.writeFileSync(path.join(d, 'f.txt'), 'x');
  const out = {};
  for (const [nom, type, cible] of [['lienDeDossier', 'dir', 'cible'], ['jonction', 'junction', 'cible'], ['lienDeFichier', 'file', 'f.txt']]) {
    try { fs.symlinkSync(path.join(d, cible), path.join(d, nom), type); out[nom] = 'possible'; } catch (e) { out[nom] = 'refusé (' + e.code + ')'; }
  }
  return out;
}

// Empreinte des dossiers réels : rien de leur contenu ne sort, seulement « identique avant et après ».
function realPrint() {
  return ['.agents/skills', '.agents/.skill-lock.json', '.claude/skills', '.cursor/skills', '.gemini/skills'].map((rel) => {
    const p = path.join(REAL_HOME, rel);
    if (!fs.existsSync(p)) return rel + ':absent';
    const st = fs.lstatSync(p);
    return rel + ':' + sha(st.isDirectory() ? fs.readdirSync(p).sort().map((n) => n + '@' + fs.lstatSync(path.join(p, n)).mtimeMs).join('|') : String(st.mtimeMs));
  }).join(' ');
}
const KNOWN = ['.agents', '.claude', '.cursor', '.gemini', '.codex', '.config', '.npm', '.cache', 'npm', 'npm-cache'];
function topNames() {
  const dirs = [REAL_HOME, process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean);
  const o = {};
  for (const d of dirs) { try { o[d] = fs.readdirSync(d); } catch { o[d] = []; } }
  return o;
}

// =================================================================================================================
const before = realPrint(), namesBefore = topNames();
const sys = system();
const sonde = probe();

// 0. Versions.
const npmV = run('0b', 'Version de npm', 'npm', ['-v']);
npmV.ok = started(npmV); npmV.constat = npmV.ok ? 'npm ' + npmV.brut.trim() : 'npm ne se lance pas';
const gitV = run('0c', 'Présence de git', 'git', ['--version']);
const GIT = started(gitV);
gitV.ok = null; gitV.constat = GIT ? gitV.brut.trim() : 'git absent de cette machine';

// 1. Le lanceur.
const v = run('1a', 'Lancer le CLI par npx', 'npx', skills('--version'));
v.ok = started(v) && v.brut.includes('1.8.1');
v.constat = v.ok ? 'skills 1.8.1 se lance par npx' : 'le CLI ne se lance pas par npx';
if (WIN) {
  // Ce que le produit rencontrerait s'il lançait npx sans interpréteur.
  const a = run('1c', 'npx sans interpréteur', 'npx', ['--version'], { shell: false });
  a.ok = null; a.constat = started(a) ? 'se lance' : 'ne se lance pas : ' + (a.erreurLancement || 'code ' + a.code);
  const b = run('1d', 'npx.cmd sans interpréteur', 'npx.cmd', ['--version'], { shell: false });
  b.ok = null; b.constat = started(b) ? 'se lance' : 'ne se lance pas : ' + (b.erreurLancement || 'code ' + b.code);
}

// 2. Trois agents simulés.
for (const d of ['.claude', '.gemini', '.cursor']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
note('2', 'Simuler trois agents', true, 'dossiers .claude, .gemini et .cursor créés dans le faux dossier personnel');

const canon = path.join(HOME, '.agents', 'skills', SKILL);
const inClaude = path.join(HOME, '.claude', 'skills', SKILL);
const inCursor = path.join(HOME, '.cursor', 'skills', SKILL);
const lockFile = path.join(HOME, '.agents', '.skill-lock.json');

// 3. Installer pour tout le compte.
const add = run('3', 'Installer (portée compte)', 'npx', skills('add', SRC, '--skill', SKILL, '-g', '-a', 'claude-code', '-a', 'cursor', '-y'));
{
  const kc = kind(canon), kl = kind(inClaude), kr = kind(inCursor);
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { /* pas de verrou */ }
  add.ok = started(add) && kc.type === 'dossier' && fs.existsSync(path.join(canon, 'SKILL.md')) && kl.type !== 'absent' && kl.cibleValide !== false;
  add.disque = { dossierCommun: kc, dansClaude: kl, dansCursor: kr, verrou: lock ? { version: lock.version, champs: Object.keys((lock.skills || {})[SKILL] || {}) } : null };
  add.constat = 'dossier commun : ' + say(kc) + ' · chez Claude Code : ' + say(kl) + ' · chez Cursor : ' + say(kr) + ' · verrou : ' + (lock ? 'présent' : 'absent');
}

// 4. Lister.
const ls = run('4', 'Lister (portée compte, JSON)', 'npx', skills('list', '-g', '--json'));
{
  const l = json(ls), me = (l || []).find((x) => x.name === SKILL);
  ls.liste = rows(l);
  ls.ok = started(ls) && !!me && me.status === 'tracked';
  ls.constat = me ? 'suivi : ' + me.status + ' · agents : ' + (me.agents || []).join(', ') : 'le skill installé n’apparaît pas dans la liste';
}

// 5. Vérifier.
const c1 = run('5a', 'Vérifier (portée projet, projet vide)', 'npx', skills('check'), { cwd: PROJ });
c1.ok = started(c1); c1.constat = 'code ' + c1.code;
const c2 = run('5b', 'Vérifier (portée compte)', 'npx', skills('check', '-g'));
c2.ok = started(c2); c2.constat = 'code ' + c2.code + (add.ok ? '' : ' (rien d’installé : résultat sans portée)');

// 6. Mettre à jour.
const up = run('6', 'Mettre à jour (portée compte)', 'npx', skills('update', '-g', '-y'));
up.ok = started(up); up.constat = 'code ' + up.code;

// 7. Retirer : d'abord chez un seul agent, puis partout.
const r1 = run('7a', 'Retirer chez Claude Code seulement', 'npx', skills('remove', '--skill', SKILL, '-g', '-a', 'claude-code', '-y'));
{
  const kl = kind(inClaude), kc = kind(canon);
  r1.ok = started(r1) && kl.type === 'absent' && kc.type === 'dossier';
  r1.constat = 'chez Claude Code : ' + say(kl) + ' · dossier commun : ' + say(kc);
}
const r2 = run('7b', 'Retirer partout', 'npx', skills('remove', '--skill', SKILL, '-g', '-y'));
{
  const kc = kind(canon);
  r2.ok = started(r2) && kc.type === 'absent';
  r2.constat = 'dossier commun : ' + say(kc);
}

// 8. Portée projet.
const pa = run('8a', 'Installer (portée projet)', 'npx', skills('add', SRC, '--skill', SKILL, '-a', 'claude-code', '-a', 'cursor', '-y'), { cwd: PROJ });
{
  const kc = kind(path.join(PROJ, '.agents', 'skills', SKILL)), kl = kind(path.join(PROJ, '.claude', 'skills', SKILL));
  const lock = fs.existsSync(path.join(PROJ, 'skills-lock.json'));
  pa.ok = started(pa) && kc.type === 'dossier' && kl.type !== 'absent' && kl.cibleValide !== false && lock;
  pa.disque = { dossierCommun: kc, dansClaude: kl, verrouProjet: lock };
  pa.constat = 'dossier commun du projet : ' + say(kc) + ' · chez Claude Code : ' + say(kl) + ' · skills-lock.json : ' + (lock ? 'présent' : 'absent');
}
const pl = run('8b', 'Lister (portée projet, JSON)', 'npx', skills('list', '--json'), { cwd: PROJ });
{
  const l = json(pl), me = (l || []).find((x) => x.name === SKILL);
  pl.liste = rows(l);
  pl.ok = started(pl) && !!me && me.scope === 'project';
  pl.constat = me ? 'portée : ' + me.scope + ' · suivi : ' + me.status : 'le skill du projet n’apparaît pas dans la liste';
}

// 9. Détecter les agents par le module Node du paquet.
const inst = run('9a', 'Installer le paquet skills pour lire son module', 'npm', ['install', CLI, '--prefix', PKG, '--no-audit', '--no-fund', '--loglevel', 'error'], { cwd: PKG });
inst.ok = started(inst); inst.constat = 'code ' + inst.code;
{
  const helper = path.join(BOX, 'detecter.mjs');
  const idx = path.join(PKG, 'node_modules', 'skills', 'dist', 'index.mjs');
  fs.writeFileSync(helper, 'const m = await import(' + JSON.stringify(pathToFileURL(idx).href) + ');\nconst d = m.detectAgents ? await m.detectAgents() : null;\nconsole.log(JSON.stringify({ exporte: Object.keys(m).sort(), detectes: d }));\n');
  const det = run('9b', 'detectAgents() du module', process.execPath, [helper], { shell: false, note: 'node detecter.mjs' });
  let out = null;
  try { out = JSON.parse(det.brut.trim().split(/\r?\n/).pop()); } catch { /* sortie illisible */ }
  const list = out && out.detectes && Array.isArray(out.detectes.agents) ? out.detectes.agents : [];
  const found = list.map((x) => x.id);
  det.detectes = list.map((x) => ({ id: x.id, dossierCompte: clean(x.globalSkillsDir), universel: x.universal }));
  det.ok = started(det) && ['claude-code', 'cursor', 'gemini-cli'].every((a) => found.includes(a));
  det.constat = found.length ? 'détectés : ' + found.join(', ') : 'aucun agent détecté';
}

// 10. Dossier de Claude Code déplacé par variable d'environnement.
const moved = path.join(HOME, 'autre-claude');
const mv = run('10', 'Installer avec CLAUDE_CONFIG_DIR déplacé', 'npx', skills('add', SRC, '--skill', SKILL, '-g', '-a', 'claude-code', '-y'), { env: env({ CLAUDE_CONFIG_DIR: moved }), note: 'CLAUDE_CONFIG_DIR=<BAC>/perso/autre-claude' });
{
  const km = kind(path.join(moved, 'skills', SKILL)), kd = kind(inClaude);
  mv.ok = started(mv) && km.type !== 'absent' && km.cibleValide !== false && kd.type === 'absent';
  mv.disque = { dansLeDossierDeplace: km, dansLeDossierParDefaut: kd };
  mv.constat = 'dossier déplacé : ' + say(km) + ' · dossier par défaut : ' + say(kd);
}

// 11. Un skill posé à la main : vu, et épargné par « tout retirer ».
const manual = path.join(HOME, '.claude', 'skills', 'manuel');
fs.mkdirSync(manual, { recursive: true });
fs.writeFileSync(path.join(manual, 'SKILL.md'), '---\nname: manuel\ndescription: Skill posé à la main pour l’essai.\n---\n\nRien.\n');
const ml = run('11a', 'Lister avec un skill posé à la main', 'npx', skills('list', '-g', '--json'));
{
  const l = json(ml), me = (l || []).find((x) => x.name === 'manuel');
  ml.liste = rows(l);
  ml.ok = started(ml) && !!me && me.status === 'untracked';
  ml.constat = me ? 'manuel : ' + me.status + ', source ' + me.source : 'le skill posé à la main n’apparaît pas';
}
const ra = run('11b', 'Tout retirer (portée compte)', 'npx', skills('remove', '--all', '-g', '-y'));
{
  const km = kind(manual), kc = kind(canon);
  ra.ok = started(ra) && km.type === 'dossier' && kc.type === 'absent';
  ra.constat = 'skill posé à la main : ' + say(km) + ' · dossier commun du skill suivi : ' + say(kc);
}

// =================================================================================================================
const after = realPrint(), namesAfter = topNames();
const added = [];
for (const d of Object.keys(namesAfter)) for (const n of namesAfter[d]) if (!namesBefore[d].includes(n)) added.push(n);

const judged = steps.filter((s) => s.ok === true || s.ok === false);
const res = {
  essai: 'B1', label: LABEL, date: new Date().toISOString(), cli: CLI, cheminAvecEspaceEtAccent: argv.includes('--espace'),
  systeme: sys, git: GIT ? gitV.brut.trim() : 'absent', sondeDesLiens: sonde,
  bilan: { juges: judged.length, reussis: judged.filter((s) => s.ok).length, echoues: judged.filter((s) => !s.ok).map((s) => s.id) },
  etapes: steps,
  horsDuBac: { dossiersReelsIntacts: before === after, entreesAjoutees: added.length, dontConnues: added.filter((n) => KNOWN.includes(n)) },
};
const text = JSON.stringify(res, null, 2) + '\n';
if (OUT !== '-') fs.writeFileSync(OUT, text);
if (argv.includes('--stdout')) console.log('===B1-DEBUT===\n' + Buffer.from(text).toString('base64') + '\n===B1-FIN===');
console.error(LABEL + ' · git : ' + (GIT ? 'présent' : 'absent') + ' · réussis : ' + res.bilan.reussis + '/' + res.bilan.juges
  + (res.bilan.echoues.length ? ' · échoués : ' + res.bilan.echoues.join(', ') : '') + ' · dossiers réels intacts : ' + res.horsDuBac.dossiersReelsIntacts);
