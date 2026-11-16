// Serveurs MCP des agents : inventaire (add-mcp, dans un processus enfant, worker 'mcp') et gestes
// désactiver, réactiver, retirer (mcp-write.mjs : une entrée à la fois, sous garde).
// add-mcp a ses propres identifiants d'agents (25) ; MCP_TO_AGENT les ramène à ceux du paquet skills (écran Agents).
// Désactiver = mettre l'entrée brute de côté dans ~/.skill-advisor/disabled-mcp (0600), puis la retirer du fichier.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { call } from './worker.mjs';
import { describe } from './mcp-mask.mjs';
import { codexEnvVars } from './mcp-convert.mjs';
import { keyPathOf, readEntry, writeEntry } from './mcp-write.mjs';
import { fail, homeOf, readJson, saDir, writePrivate } from './util.mjs';

// Identifiant add-mcp → identifiant skills, quand ils diffèrent. Deux fichiers peuvent viser le même agent
// (extension VS Code et CLI de Cline ; Copilot dans VS Code et Copilot CLI).
export const MCP_TO_AGENT = {
  'cline-cli': 'cline',
  'factory-droid': 'droid',
  'github-copilot-cli': 'github-copilot',
  vscode: 'github-copilot',
  'grok-build': 'grok',
  hermes: 'hermes-agent',
  'kilo-code': 'kilo',
  'kimi-code': 'kimi-code-cli',
};
// Agents d'add-mcp sans équivalent dans le paquet skills : montrés à part, avec leur propre identifiant.
export const MCP_ONLY = new Set(['claude-desktop', 'mastracode', 'mcporter']);

export const agentOf = (mcpId) => MCP_TO_AGENT[mcpId] || mcpId;

export const MCP_MESSAGE = 'La lecture des réglages MCP a échoué. Le détail est dans le terminal de Skill Advisor.';
const MCP_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

// Nom de serveur : texte de 1 à 200 caractères, sans caractère de contrôle.
export function checkServerName(name) {
  if (typeof name !== 'string' || !name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw fail('BAD_NAME', 'Nom de serveur MCP invalide.');
  return name;
}

// Chemins de réglages des 25 agents d'add-mcp (global et projet).
export async function mcpPaths(opts = {}) {
  const home = homeOf(opts);
  return call('paths', [{ cwd: opts.cwd || home }], { home, cwd: opts.cwd || home, worker: 'mcp', timeoutMs: 30000 });
}

// --- Mise de côté (serveurs désactivés) ---

export const stashDir = (home) => path.join(saDir(home), 'disabled-mcp');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const scopeTag = (scope, project) => (scope === 'project' ? 'p-' + sha(path.resolve(project)).slice(0, 12) : 'global');
export const stashFile = (home, mcpId, scope, project, name) => path.join(stashDir(home), mcpId, scopeTag(scope, project), sha(name).slice(0, 16) + '.json');

// Entrées mises de côté, pour le dossier personnel et le projet ouvert (celles d'un autre projet sont ignorées).
async function readStash(home, project) {
  const out = [];
  const root = stashDir(home);
  for (const id of await fs.readdir(root).catch(() => [])) {
    if (!MCP_ID_RE.test(id)) continue;
    for (const tag of await fs.readdir(path.join(root, id)).catch(() => [])) {
      for (const f of await fs.readdir(path.join(root, id, tag)).catch(() => [])) {
        if (!/^[0-9a-f]{16}\.json$/.test(f)) continue;
        const file = path.join(root, id, tag, f);
        const d = await readJson(file, null);
        if (!d || d.v !== 1 || d.mcpId !== id || typeof d.name !== 'string' || typeof d.path !== 'string' || typeof d.format !== 'string') continue;
        if (d.scope === 'project' ? !project || path.resolve(d.project || '') !== path.resolve(project) : d.scope !== 'global') continue;
        if (file !== stashFile(home, id, d.scope, d.project, d.name)) continue;
        out.push({ file, ...d });
      }
    }
  }
  return out;
}

// Même serveur vu de deux agents : même commande, mêmes arguments, même adresse, mêmes noms de variables.
const shape = (s) => JSON.stringify([s.kind, s.command, s.args, s.url, Object.keys(s.env).sort(), Object.keys(s.headers).sort()]);

// État MCP de la machine :
// agents : un par fichier de réglages lu (id = identifiant skills, mcpId = celui d'add-mcp) ;
// servers : un par nom et portée, avec ag[idSkills] = [{ mcpId, path, key, format, on, same, stash? }].
// Un serveur désactivé par Skill Advisor (mis de côté) a une entrée on: false, stash: true.
export async function mcpState(opts = {}) {
  const home = homeOf(opts);
  const project = opts.project || null;
  let inv;
  try {
    inv = await call('inventory', [{ project }], { home, cwd: project || home, worker: 'mcp', timeoutMs: 30000 });
  } catch (e) {
    throw fail('CLI_FAILED', MCP_MESSAGE, { detail: e.detail || e.message });
  }
  const agents = [];
  const rows = new Map();
  const add = (scope, name, view, entry) => {
    const k = scope + '\u0000' + name;
    let r = rows.get(k);
    if (!r) {
      r = { id: (scope === 'project' ? 'project:' : '') + name, name, scope, identity: view.identity || '', kind: view.kind, command: view.command, args: view.args, url: view.url,
        env: view.env, headers: view.headers, secrets: view.secrets, ag: {}, _shape: shape(view) };
      rows.set(k, r);
    }
    const id = agentOf(entry.mcpId);
    (r.ag[id] = r.ag[id] || []).push({ ...entry, same: shape(view) === r._shape });
  };
  for (const x of inv.agents) {
    agents.push({ id: agentOf(x.id), mcpId: x.id, name: x.name, scope: x.scope, path: x.path, error: x.error, mcpOnly: MCP_ONLY.has(x.id), count: x.servers.length });
    for (const s of x.servers) add(x.scope, s.name, s, { mcpId: x.id, path: x.path, key: s.key, format: x.format, on: !s.off });
  }
  for (const d of await readStash(home, project)) {
    add(d.scope, d.name, { identity: '', ...describe(d.entry) }, { mcpId: d.mcpId, path: d.path, key: d.key, format: d.format, on: false, stash: true });
  }
  const servers = [...rows.values()].map((r) => {
    delete r._shape;
    r.on = Object.values(r.ag).some((l) => l.some((e) => e.on));
    r.differs = Object.values(r.ag).some((l) => l.some((e) => !e.same));
    return r;
  }).sort((p, q) => p.name.localeCompare(q.name) || p.scope.localeCompare(q.scope));
  return { detected: [...new Set(inv.detected.map(agentOf))], detectedMcp: inv.detected, agents, servers };
}

// --- Pose d'un serveur chez un agent (installation, application d'une sauvegarde) ---

// Fichiers où Skill Advisor n'écrit pas de nouveau serveur : emplacement ancien ou non vérifié.
// Retirer, désactiver ou réactiver un serveur déjà présent y reste possible (édition sur place).
export const INSTALL_BLOCKED = {
  cline: 'Ancien emplacement de Cline (extension VS Code) : Skill Advisor écrit dans ~/.cline, lu aussi par l’extension.',
  windsurf: 'Windsurf est devenu Devin Desktop et ses réglages MCP ont changé de place : Skill Advisor ne les modifie pas encore.',
};

// Identifiants add-mcp d'un agent de skills, parmi ceux détectés ; à défaut, le premier connu.
export function mcpIdsFor(agent, detectedMcp = []) {
  const all = Object.keys(MCP_TO_AGENT).filter((k) => MCP_TO_AGENT[k] === agent);
  if (!MCP_TO_AGENT[agent] && !all.includes(agent)) all.unshift(agent);
  const usable = all.filter((k) => !INSTALL_BLOCKED[k]);
  const det = usable.filter((k) => detectedMcp.includes(k));
  return det.length ? det : usable.slice(0, 1);
}

// Pose (ou remplace) un serveur chez un agent add-mcp : entrée préparée dans le processus enfant (forme de l'agent),
// écrite ici sous garde (commentaires gardés, relecture, contrôle de changement). config : forme commune d'add-mcp.
// Rend { path, copy, lossy }. Lève EXISTS sans opts.replace.
export async function mcpUpsert(opts = {}) {
  const home = homeOf(opts);
  const name = checkServerName(opts.name);
  if (!MCP_ID_RE.test(opts.mcpId || '')) throw fail('BAD_INPUT', 'Agent MCP inconnu.');
  if (INSTALL_BLOCKED[opts.mcpId]) throw fail('UNSUPPORTED', INSTALL_BLOCKED[opts.mcpId]);
  const local = opts.scope === 'project';
  if (local && !opts.project) throw fail('BAD_INPUT', 'Aucun projet ouvert.');
  const cwd = local ? opts.project : home;
  const p = await call('prepare', [{ mcpId: opts.mcpId, name, config: opts.config, local, cwd }], { home, cwd, worker: 'mcp', timeoutMs: 30000 });
  const entry = opts.mcpId === 'codex' ? codexEnvVars(p.entry) : p.entry;
  return writeEntry({ home, file: p.file, format: p.format, keyPath: keyPathOf(p.key), name, value: entry, replace: !!opts.replace, newMode: p.mode || undefined });
}

// --- Gestes ---

// Entrées visées : serveur de ce nom et de cette portée, chez les agents demandés (tous sans liste).
async function targets(opts) {
  const home = homeOf(opts);
  const name = checkServerName(opts.name);
  const scope = opts.scope === 'project' ? 'project' : 'global';
  if (scope === 'project' && !opts.project) throw fail('BAD_INPUT', 'Aucun projet ouvert.');
  const st = await mcpState({ home, project: opts.project });
  const row = st.servers.find((s) => s.name === name && s.scope === scope);
  if (!row) throw fail('NOT_FOUND', 'Serveur MCP introuvable : ' + name + '.');
  const want = Array.isArray(opts.agents) && opts.agents.length ? new Set(opts.agents) : null;
  const list = [];
  for (const [agent, entries] of Object.entries(row.ag)) {
    if (want && !want.has(agent)) continue;
    for (const e of entries) list.push({ agent, ...e });
  }
  if (!list.length) throw fail('NOT_FOUND', 'Aucun des agents choisis n’a ce serveur.');
  return { home, name, scope, project: scope === 'project' ? opts.project : null, row, list };
}

const failure = (t, e) => ({ agent: t.agent, mcpId: t.mcpId, code: e.code || 'WRITE_FAILED', message: e.code ? e.message : 'Écriture impossible.' });

// Désactive : met l'entrée brute de côté (0600), puis la retire du fichier. Un échec de retrait efface la mise de côté.
export async function mcpDisable(opts = {}) {
  const t = await targets(opts);
  const done = [], failed = [];
  for (const e of t.list.filter((x) => x.on && !x.stash)) {
    try {
      const keyPath = keyPathOf(e.key);
      const raw = await readEntry(e.path, e.format, keyPath, t.name);
      if (raw === undefined) throw fail('NOT_FOUND', 'Serveur absent du fichier de réglages.');
      const file = stashFile(t.home, e.mcpId, t.scope, t.project, t.name);
      if (await fs.stat(file).then(() => true, () => false)) throw fail('EXISTS', 'Une copie désactivée de ce serveur existe déjà pour cet agent.');
      await writePrivate(file, JSON.stringify({ v: 1, name: t.name, mcpId: e.mcpId, scope: t.scope, project: t.project, path: e.path, key: e.key, format: e.format, entry: raw, at: new Date().toISOString() }) + '\n');
      try {
        const w = await writeEntry({ home: t.home, file: e.path, format: e.format, keyPath, name: t.name, value: undefined });
        done.push({ agent: e.agent, mcpId: e.mcpId, lossy: w.lossy });
      } catch (err) {
        await fs.rm(file, { force: true });
        throw err;
      }
    } catch (err) { failed.push(failure(e, err)); }
  }
  return { done, failed };
}

// Réactive : remet l'entrée mise de côté dans son fichier, telle quelle, puis efface la mise de côté.
export async function mcpEnable(opts = {}) {
  const t = await targets(opts);
  const done = [], failed = [];
  for (const e of t.list.filter((x) => x.stash)) {
    const file = stashFile(t.home, e.mcpId, t.scope, t.project, t.name);
    try {
      const d = await readJson(file, null);
      if (!d || d.entry === undefined) throw fail('NOT_FOUND', 'Copie désactivée introuvable.');
      const w = await writeEntry({ home: t.home, file: d.path, format: d.format, keyPath: keyPathOf(d.key), name: t.name, value: d.entry })
        .catch((err) => { throw err.code === 'EXISTS' ? fail('EXISTS', 'Un serveur de ce nom a été ajouté entre-temps dans les réglages de cet agent.') : err; });
      await fs.rm(file, { force: true });
      done.push({ agent: e.agent, mcpId: e.mcpId, lossy: w.lossy });
    } catch (err) { failed.push(failure(e, err)); }
  }
  return { done, failed };
}

// Retire le serveur des agents choisis : entrées des fichiers et copies désactivées.
// opts.keep(t) : appelé avant toute écriture avec les entrées brutes ({ agent, mcpId, scope, entry }), pour la sauvegarde.
export async function mcpRemove(opts = {}) {
  const t = await targets(opts);
  const raws = [];
  for (const e of t.list) {
    const raw = e.stash ? ((await readJson(stashFile(t.home, e.mcpId, t.scope, t.project, t.name), null)) || {}).entry
      : await readEntry(e.path, e.format, keyPathOf(e.key), t.name).catch(() => undefined);
    if (raw !== undefined) raws.push({ agent: e.agent, mcpId: e.mcpId, scope: t.scope, off: !!e.stash, entry: raw });
  }
  const kept = opts.keep ? await opts.keep({ name: t.name, scope: t.scope, items: raws }) : null;
  const done = [], failed = [];
  for (const e of t.list) {
    try {
      if (e.stash) await fs.rm(stashFile(t.home, e.mcpId, t.scope, t.project, t.name), { force: true });
      else await writeEntry({ home: t.home, file: e.path, format: e.format, keyPath: keyPathOf(e.key), name: t.name, value: undefined });
      done.push({ agent: e.agent, mcpId: e.mcpId });
    } catch (err) { failed.push(failure(e, err)); }
  }
  return { done, failed, backup: kept };
}
