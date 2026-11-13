// B3 : restaurer une installation depuis un fichier.
// Question : une suite de `skills add`, rejouée sur une machine vide, redonne-t-elle la même installation ?
// Usage : node essais/b3-restauration/run.mjs   → écrit essais/b3-restauration/resultat.json
// Tout se passe dans essais/b3-restauration/sandbox/ (ignoré par git) : deux faux dossiers personnels, A et B.
// Les dossiers réels de l'utilisateur ne sont ni lus en détail ni modifiés ; une empreinte avant/après le prouve.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOX = path.join(HERE, 'sandbox');
const CLI = 'skills@1.8.1';
const AGENTS = ['claude-code', 'cursor'];
const WANT = [
  { source: 'vercel-labs/agent-skills', skill: 'web-design-guidelines' },
  { source: 'vercel-labs/agent-skills', skill: 'vercel-react-best-practices' },
  { source: 'anthropics/skills', skill: 'frontend-design' },
];

if (!BOX.endsWith(path.join('essais', 'b3-restauration', 'sandbox'))) throw new Error('dossier d’essai inattendu');
fs.rmSync(BOX, { recursive: true, force: true });
const CACHE = path.join(BOX, 'npm-cache');
fs.mkdirSync(CACHE, { recursive: true });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// Empreinte des dossiers réels : noms et dates seulement, jamais écrits dans le résultat.
function realPrint() {
  return ['.agents/skills', '.claude/skills', '.cursor/skills'].map((rel) => {
    const p = path.join(os.homedir(), rel);
    if (!fs.existsSync(p)) return rel + ':absent';
    return rel + ':' + sha(fs.readdirSync(p).sort().map((n) => n + '@' + fs.lstatSync(path.join(p, n)).mtimeMs).join('|'));
  }).join(' ');
}

function env(home) {
  const e = {
    ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex'),
    DISABLE_TELEMETRY: '1', npm_config_cache: CACHE,
  };
  for (const k of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'npm_config_cache']) {
    if (!e[k].startsWith(BOX)) throw new Error('variable non confinée : ' + k);
  }
  return e;
}

function cli(home, args) {
  const r = spawnSync('npx', ['-y', CLI, ...args], { cwd: home, env: env(home), encoding: 'utf8', timeout: 180000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// Arbre d'un faux dossier personnel : fichiers (empreinte du contenu) et liens (cible relative).
function tree(home) {
  const out = {};
  (function walk(dir) {
    for (const n of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, n), rel = path.relative(home, p), st = fs.lstatSync(p);
      if (st.isSymbolicLink()) {
        const t = fs.readlinkSync(p);
        out[rel] = 'lien → ' + (path.isAbsolute(t) ? path.relative(home, t) : path.relative(home, path.resolve(dir, t)));
      } else if (st.isDirectory()) walk(p);
      else out[rel] = sha(fs.readFileSync(p));
    }
  })(home);
  return out;
}

function install(home, list) {
  fs.mkdirSync(home, { recursive: true });
  const steps = [];
  const bySource = {};
  for (const w of list) (bySource[w.source] = bySource[w.source] || []).push(w.skill);
  for (const [source, skills] of Object.entries(bySource)) {
    const args = ['add', source, ...skills.flatMap((s) => ['--skill', s]), '-g', ...AGENTS.flatMap((a) => ['-a', a]), '-y'];
    const r = cli(home, args);
    steps.push({ commande: 'npx -y ' + CLI + ' ' + args.join(' '), code: r.code });
  }
  return steps;
}

function listJson(home) {
  const r = cli(home, ['list', '-g', '--json']);
  const m = r.out.match(/\[[\s\S]*\]/);
  const rows = m ? JSON.parse(m[0]) : null;
  // Les chemins absolus changent d'une machine à l'autre : on les rend relatifs au dossier personnel.
  return rows && rows.map((x) => ({ ...x, path: x.path ? path.relative(home, x.path) : x.path })).sort((a, b) => a.name.localeCompare(b.name));
}

function lock(home) {
  const p = path.join(home, '.agents', '.skill-lock.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const before = realPrint();
const A = path.join(BOX, 'A'), B = path.join(BOX, 'B');

// 1. Machine A : installation de départ.
const stepsA = install(A, WANT);
const listA = listJson(A), lockA = lock(A);

// 2. Le « fichier d'installation » : ce que Skill Advisor exporterait, tiré de `list --json` seul.
const fichier = (listA || []).filter((x) => x.source).map((x) => ({ source: x.source, skill: x.name }));

// 3. Machine B, vide : on rejoue le fichier.
const stepsB = install(B, fichier);
const listB = listJson(B), lockB = lock(B);

// 4. Comparaison.
const tA = tree(A), tB = tree(B);
const skillsOnly = (t) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith('.npm') && !k.includes('.skill-lock.json') && !k.startsWith('.config')));
const sA = skillsOnly(tA), sB = skillsOnly(tB);
const keys = [...new Set([...Object.keys(sA), ...Object.keys(sB)])].sort();
const diff = keys.filter((k) => sA[k] !== sB[k]).map((k) => ({ chemin: k, A: sA[k] ?? 'absent', B: sB[k] ?? 'absent' }));

// Verrou : mêmes entrées ? quels champs diffèrent ?
function lockDiff(a, b) {
  if (!a || !b) return { lisible: false };
  const sa = a.skills || {}, sb = b.skills || {};
  const names = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].sort();
  const champs = new Set();
  for (const n of names) for (const f of new Set([...Object.keys(sa[n] || {}), ...Object.keys(sb[n] || {})])) {
    if (JSON.stringify((sa[n] || {})[f]) !== JSON.stringify((sb[n] || {})[f])) champs.add(f);
  }
  return { lisible: true, entrees: names, champsDifferents: [...champs].sort(), champsDuVerrou: Object.keys(sa[names[0]] || {}) };
}

const after = realPrint();
const res = {
  date: new Date().toISOString(),
  cli: CLI, systeme: process.platform + ' ' + os.release() + ' ' + process.arch, node: process.version,
  agents: AGENTS,
  demande: WANT,
  machineA: { etapes: stepsA, skills: (listA || []).map((x) => ({ name: x.name, source: x.source, status: x.status, agents: x.agents, path: x.path })) },
  fichierInstallation: fichier,
  machineB: { etapes: stepsB, skills: (listB || []).map((x) => ({ name: x.name, source: x.source, status: x.status, agents: x.agents, path: x.path })) },
  comparaison: {
    listeIdentique: JSON.stringify(listA) === JSON.stringify(listB),
    fichiersCompares: keys.length,
    fichiersDifferents: diff,
    verrou: lockDiff(lockA, lockB),
  },
  arbreA: sA,
  dossiersReelsIntacts: before === after,
};
fs.writeFileSync(path.join(HERE, 'resultat.json'), JSON.stringify(res, null, 2) + '\n');
console.log('liste identique :', res.comparaison.listeIdentique, '· fichiers comparés :', keys.length, '· différents :', diff.length,
  '· champs du verrou qui diffèrent :', (res.comparaison.verrou.champsDifferents || []).join(', ') || 'aucun',
  '· dossiers réels intacts :', res.dossiersReelsIntacts);
