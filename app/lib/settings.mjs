// Réglages : ~/.skill-advisor/settings.json (agents personnalisés, masqués, cibles).
import fs from 'node:fs/promises';
import path from 'node:path';
import { call } from './worker.mjs';
import { AGENT_RE, checkAgentId, disabledDir, fail, homeOf, readJson, realish, saDir, sharedDir, within, writeJsonAtomic } from './util.mjs';

const file = (home) => path.join(saDir(home), 'settings.json');
const uniq = (a) => [...new Set(a)];
const CUSTOM_RE = /^custom-\d{1,9}$/;

export async function readSettings(opts = {}) {
  const raw = await readJson(file(homeOf(opts)), {});
  const ids = (a) => (Array.isArray(a) ? uniq(a.filter((x) => typeof x === 'string' && AGENT_RE.test(x))) : []);
  const home = homeOf(opts);
  const custom = Array.isArray(raw.custom) ? raw.custom.filter((c) => c && CUSTOM_RE.test(c.id) && typeof c.name === 'string' && typeof c.dir === 'string' && path.isAbsolute(c.dir) && !roughlyBad(home, c.dir)) : [];
  return { version: 1, custom: custom.map((c) => ({ id: c.id, name: c.name, dir: c.dir })), hidden: ids(raw.hidden), targets: ids(raw.targets) };
}

// Contrôle rapide, sans disque, des réglages modifiés à la main.
function roughlyBad(home, dir) {
  const d = path.resolve(dir);
  return path.parse(d).root === d || within(home, d) || within(d, saDir(home)) || within(d, sharedDir(home)) || within(sharedDir(home), d);
}

// Refuse un dossier où supprimer ou déplacer toucherait autre chose que les skills de cet agent.
async function checkCustomDir(home, real) {
  const bad = (m) => fail('BAD_INPUT', m);
  if (path.parse(real).root === real) throw bad('La racine du disque ne peut pas servir de dossier d’agent.');
  if (within(await realish(home), real)) throw bad('Le dossier personnel et ses dossiers parents ne peuvent pas servir de dossier d’agent.');
  if (within(real, await realish(saDir(home)))) throw bad('Les dossiers de Skill Advisor ne peuvent pas servir de dossier d’agent.');
  const shared = await realish(sharedDir(home));
  if (within(real, shared) || within(shared, real)) throw bad('Ce dossier touche le dossier partagé ~/.agents/skills. Choisissez un autre dossier.');
  const agents = await call('getSupportedAgents', [], { home });
  for (const a of agents) {
    if (!a.globalSkillsDir) continue;
    const d = await realish(a.globalSkillsDir);
    if (within(real, d) || within(d, real)) throw bad('Ce dossier touche celui de l’agent ' + (a.name || a.id) + ' : ' + a.globalSkillsDir + '. Choisissez un autre dossier.');
  }
}

async function save(home, s) {
  await writeJsonAtomic(file(home), s);
  return s;
}

export async function addCustomAgent(opts = {}) {
  const home = homeOf(opts);
  const name = typeof opts.name === 'string' ? opts.name.trim() : '';
  if (name.length < 1 || name.length > 60) throw fail('BAD_NAME', 'Le nom de l’agent doit compter de 1 à 60 caractères.');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw fail('BAD_NAME', 'Le nom de l’agent contient un caractère de contrôle.');
  const dir = opts.dir;
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw fail('BAD_NAME', 'Indiquez un chemin complet pour le dossier de l’agent.');
  let st, real;
  try { real = await fs.realpath(dir); st = await fs.stat(real); } catch { throw fail('NOT_FOUND', 'Le dossier n’existe pas : ' + dir + '.'); }
  if (!st.isDirectory()) throw fail('NOT_FOUND', 'Ce chemin n’est pas un dossier : ' + dir + '.');
  // Chemin réel : un lien ne peut pas masquer un dossier protégé.
  await checkCustomDir(home, real);
  const s = await readSettings({ home });
  // Jamais un id déjà vu : un ancien agent peut avoir laissé des skills désactivés.
  let left = [];
  try { left = await fs.readdir(disabledDir(home)); } catch { /* aucun */ }
  const n = [...s.custom.map((c) => c.id), ...left].filter((id) => CUSTOM_RE.test(id)).reduce((m, id) => Math.max(m, Number(id.slice(7))), 0) + 1;
  const agent = { id: 'custom-' + n, name, dir: real };
  s.custom.push(agent);
  await save(home, s);
  return agent;
}

export async function removeCustomAgent(opts = {}) {
  const home = homeOf(opts);
  const id = checkAgentId(opts.id);
  const s = await readSettings({ home });
  if (!s.custom.some((c) => c.id === id)) throw fail('NOT_FOUND', 'Agent personnalisé introuvable : ' + id + '.');
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
