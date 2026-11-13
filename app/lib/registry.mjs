// Registre des agents : ceux du paquet skills, les réglages et les agents personnalisés.
import fs from 'node:fs/promises';
import path from 'node:path';
import { call } from './worker.mjs';
import { readSettings } from './settings.mjs';
import { homeOf, sharedDir } from './util.mjs';

export const TOP_AGENTS = ['claude-code', 'cursor', 'codex', 'github-copilot', 'gemini-cli', 'windsurf', 'cline', 'roo', 'kiro-cli', 'zed',
  'opencode', 'goose', 'amp', 'antigravity', 'continue', 'junie', 'trae', 'warp', 'kilo', 'qwen-code', 'augment', 'openhands', 'devin', 'replit'];

// skills 1.8.1 : agents « universels » qui ne lisent pas ~/.agents/skills en global (globalReadsCanonical: false, non exporté).
const OWN_GLOBAL_DIR = new Set(['antigravity', 'antigravity-cli']);

// Vrai quand l'agent lit directement le dossier partagé ~/.agents/skills.
export function readsShared(info) {
  return !!(info && info.universal && info.globalSkillsDir && !OWN_GLOBAL_DIR.has(info.id));
}

// Nombre de skills (dossier ou lien vers un dossier, avec SKILL.md) dans un dossier.
export async function countSkills(dir) {
  if (!dir) return 0;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  let n = 0;
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    try { if ((await fs.stat(path.join(dir, e.name, 'SKILL.md'))).isFile()) n++; } catch { /* lien cassé ou pas de SKILL.md */ }
  }
  return n;
}

// Agents connus et détectés, en un seul processus enfant si rien n'est fourni.
export async function agentData(opts = {}) {
  if (opts.supported && opts.detected) return { supported: opts.supported, detected: opts.detected };
  const home = homeOf(opts);
  const snap = await call('snapshot', [{ cwd: home, scope: 'global' }], { home });
  return { supported: snap.supported, detected: snap.detected };
}

// Carte id → { dir propre (null pour un lecteur du dossier partagé), shared, custom, detected }.
export async function agentMap(opts = {}) {
  const home = homeOf(opts);
  const [{ supported, detected }, settings] = await Promise.all([agentData({ home }), readSettings({ home })]);
  const det = new Set(detected);
  const map = {};
  for (const a of supported) {
    if (a.id === 'universal') continue;
    const shared = readsShared(a);
    map[a.id] = { id: a.id, dir: shared ? null : a.globalSkillsDir || null, shared, custom: false, detected: det.has(a.id) };
  }
  for (const c of settings.custom) map[c.id] = { id: c.id, dir: c.dir, shared: false, custom: true, detected: true };
  return map;
}

export async function listAgents(opts = {}) {
  const home = homeOf(opts);
  const settings = opts.settings || await readSettings({ home });
  const { supported, detected } = await agentData(opts);
  const det = new Set(detected);
  const hidden = new Set(settings.hidden);
  const targets = new Set(settings.targets);
  const isTarget = (id, d) => (targets.size ? targets.has(id) : d);
  const shared = await countSkills(sharedDir(home));
  const known = supported.filter((a) => a.id !== 'universal');
  const out = [];
  for (const a of known) {
    const d = det.has(a.id);
    const universal = readsShared(a);
    out.push({
      id: a.id, name: a.name, detected: d, top: TOP_AGENTS.includes(a.id), universal, globalDir: a.globalSkillsDir || null,
      custom: false, hidden: hidden.has(a.id), target: isTarget(a.id, d),
      count: universal ? (d ? shared : 0) : await countSkills(a.globalSkillsDir),
    });
  }
  const rank = (a) => (a.top ? TOP_AGENTS.indexOf(a.id) : TOP_AGENTS.length);
  out.sort((x, y) => rank(x) - rank(y) || (x.top ? 0 : x.name.localeCompare(y.name)));
  for (const c of settings.custom) {
    let d = false;
    try { d = (await fs.stat(c.dir)).isDirectory(); } catch { /* dossier disparu */ }
    out.push({ id: c.id, name: c.name, detected: d, top: false, universal: false, globalDir: c.dir, custom: true, hidden: hidden.has(c.id), target: isTarget(c.id, false), count: await countSkills(c.dir) });
  }
  return out;
}
