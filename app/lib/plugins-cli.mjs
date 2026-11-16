// Gestes sur les plugins par le CLI officiel de chaque agent : Skill Advisor n'écrit jamais lui-même
// les listes d'activation des agents. Programme cherché dans PATH, lancé sans interpréteur de commandes,
// arguments en tableau, noms contrôlés. Sous Windows, un lanceur .cmd ou .bat passe par cmd.exe
// seulement avec des arguments sans caractère spécial.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { childEnv, fail, homeOf } from './util.mjs';
import { pluginState, PLUGIN_AGENTS } from './plugins.mjs';

// Commandes par agent et par geste. scope : 'global' ou 'project' (Claude Code seulement).
const CLAUDE_SCOPE = { global: 'user', project: 'project' };
export const COMMANDS = {
  'claude-code': {
    bin: 'claude',
    enable: (id, scope) => ['plugin', 'enable', id, '--scope', CLAUDE_SCOPE[scope]],
    disable: (id, scope) => ['plugin', 'disable', id, '--scope', CLAUDE_SCOPE[scope]],
    uninstall: (id, scope) => ['plugin', 'uninstall', id, '--scope', CLAUDE_SCOPE[scope]],
    update: (id, scope) => ['plugin', 'update', id, '--scope', CLAUDE_SCOPE[scope]],
  },
  codex: { bin: 'codex', uninstall: (id) => ['plugin', 'remove', id] },
  'gemini-cli': {
    bin: 'gemini',
    enable: (id) => ['extensions', 'enable', id, '--scope', 'user'],
    disable: (id) => ['extensions', 'disable', id, '--scope', 'user'],
    uninstall: (id) => ['extensions', 'uninstall', id],
    update: (id) => ['extensions', 'update', id],
  },
  'github-copilot': {
    bin: 'copilot',
    enable: (id) => ['plugin', 'enable', id], disable: (id) => ['plugin', 'disable', id],
    uninstall: (id) => ['plugin', 'uninstall', id], update: (id) => ['plugin', 'update', id],
  },
  antigravity: { bin: 'agy', enable: (id) => ['plugin', 'enable', id], disable: (id) => ['plugin', 'disable', id], uninstall: (id) => ['plugin', 'uninstall', id] },
};
export const VERBS = ['enable', 'disable', 'uninstall', 'update'];
const ID_RE = /^[A-Za-z0-9][\w.@:/+-]{0,199}$/;
const VERB_TEXT = { enable: 'activer', disable: 'désactiver', uninstall: 'désinstaller', update: 'mettre à jour' };

// Gestes possibles pour un agent (la page n'offre que ceux-là).
export const verbsOf = (agent) => VERBS.filter((v) => COMMANDS[agent] && COMMANDS[agent][v]);

// Programme dans PATH (avec PATHEXT sous Windows), sinon null.
export function findBin(name, env = process.env, platform = process.platform) {
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, name + e.toLowerCase());
      const q = path.join(d, name + e);
      for (const f of [p, q]) {
        try { if (fs.statSync(f).isFile()) return f; } catch { /* suivant */ }
      }
    }
  }
  return null;
}

// Commande d'un geste : { bin, args, cwd }. Lève UNSUPPORTED ou BAD_NAME.
export function commandFor(agent, verb, id, scope, project) {
  const c = COMMANDS[agent];
  if (!c || !c[verb]) throw fail('UNSUPPORTED', (PLUGIN_AGENTS[agent] || agent) + ' ne permet pas de ' + (VERB_TEXT[verb] || verb) + ' un plugin depuis sa ligne de commande.');
  if (typeof id !== 'string' || !ID_RE.test(id)) throw fail('BAD_NAME', 'Nom de plugin invalide.');
  if (scope === 'project' && agent !== 'claude-code') throw fail('UNSUPPORTED', 'Ce geste ne vise que les plugins du dossier personnel pour cet agent.');
  return { bin: c.bin, args: c[verb](id, scope === 'project' ? 'project' : 'global'), cwd: scope === 'project' ? project : null };
}

// Lance un programme ; rend { code, out } (sortie bornée, pour le terminal du serveur).
export function run(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const win = (opts.platform || process.platform) === 'win32' && /\.(cmd|bat)$/i.test(file);
    if (win && args.some((a) => !/^[\w.@:/=+-]+$/.test(a))) return reject(fail('BAD_NAME', 'Argument refusé pour un lanceur Windows.'));
    const child = win
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + ['"' + file + '"', ...args].join(' ') + '"'], { cwd: opts.cwd, env: opts.env, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(file, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (d) => { out += d; if (out.length > 20000) out = out.slice(-10000); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* fini */ } }, opts.timeoutMs || 120000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

// Geste sur un plugin chez les agents qui l'ont (ou ceux demandés). opts = { name, verb, agents? }.
// Rend { done: [{ agent, pluginId }], failed: [{ agent, pluginId, message }] }.
export async function pluginAction(opts = {}) {
  const home = homeOf(opts);
  if (!VERBS.includes(opts.verb)) throw fail('BAD_INPUT', 'Geste inconnu.');
  const st = await pluginState({ home, project: opts.project });
  const row = st.plugins.find((p) => p.name === opts.name);
  if (!row) throw fail('NOT_FOUND', 'Plugin introuvable : ' + String(opts.name).slice(0, 80) + '.');
  const want = Array.isArray(opts.agents) && opts.agents.length ? new Set(opts.agents) : null;
  const env = childEnv(home);
  const done = [], failed = [];
  for (const [agent, entries] of Object.entries(row.ag)) {
    if (want && !want.has(agent)) continue;
    for (const e of entries) {
      if (e.other) continue;
      if (opts.verb === 'enable' && e.on === true) continue;
      if (opts.verb === 'disable' && e.on === false) continue;
      try {
        const cmd = commandFor(agent, opts.verb, e.pluginId, e.scope, opts.project);
        const bin = (opts.findBin || findBin)(cmd.bin, env);
        if (!bin) throw fail('UNSUPPORTED', 'Commande « ' + cmd.bin + ' » introuvable : installez ' + PLUGIN_AGENTS[agent] + ', ou faites ce geste dans l’agent.');
        const r = await run(bin, cmd.args, { cwd: cmd.cwd || home, env });
        if (r.code !== 0) {
          const line = r.out.split('\n').map((l) => l.trim()).filter(Boolean).pop() || 'code ' + r.code;
          console.error('[plugins] ' + cmd.bin + ' ' + cmd.args.join(' ') + ' : ' + r.out.slice(-2000));
          throw fail('CLI_FAILED', PLUGIN_AGENTS[agent] + ' a refusé : ' + line.slice(0, 200));
        }
        done.push({ agent, pluginId: e.pluginId });
      } catch (err) {
        failed.push({ agent, pluginId: e.pluginId, message: err.code ? err.message : 'Commande impossible à lancer.' });
      }
    }
  }
  return { done, failed };
}

// --- Installation depuis le catalogue (catalog/plugins.json) ---

const CATALOG = fileURLToPath(new URL('../../catalog/plugins.json', import.meta.url));
let catalogP = null;
// Catalogue des plugins fourni, lu une fois. Rend { generatedAt, plugins: [] } même s'il manque.
export function pluginCatalog(opts = {}) {
  if (opts.file) return fsp.readFile(opts.file, 'utf8').then((t) => JSON.parse(t));
  if (!catalogP) catalogP = fsp.readFile(CATALOG, 'utf8').then((t) => JSON.parse(t), () => ({ generatedAt: null, plugins: [] }));
  return catalogP;
}

// Commande d'installation d'un plugin du catalogue : seulement les places de marché que l'agent connaît par défaut.
export function installCommand(entry, scope) {
  const id = entry.name + '@' + entry.market;
  if (!ID_RE.test(id)) throw fail('BAD_NAME', 'Nom de plugin invalide.');
  if (entry.agent === 'claude-code' && entry.market === 'claude-plugins-official') return { agent: 'claude-code', bin: 'claude', args: ['plugin', 'install', id, '--scope', CLAUDE_SCOPE[scope === 'project' ? 'project' : 'global']] };
  if (entry.agent === 'github-copilot' && (entry.market === 'awesome-copilot' || entry.market === 'copilot-plugins')) {
    if (scope === 'project') throw fail('UNSUPPORTED', 'Copilot CLI installe ses plugins pour tous les projets.');
    return { agent: 'github-copilot', bin: 'copilot', args: ['plugin', 'install', id] };
  }
  throw fail('UNSUPPORTED', 'Skill Advisor ne sait pas installer ce plugin.');
}

// Installe un plugin du catalogue par le CLI de son agent. opts = { id, scope, force }.
// Un plugin au contrôle « Motif à risque » est retenu (held) sauf force. Rend { installed, held, message }.
export async function installPlugin(opts = {}) {
  const home = homeOf(opts);
  const cat = await pluginCatalog(opts.catalogFile ? { file: opts.catalogFile } : {});
  const entry = (cat.plugins || []).find((p) => p.id === opts.id);
  if (!entry) throw fail('NOT_FOUND', 'Plugin absent du catalogue.');
  if (entry.verdict === 'rouge' && !opts.force) return { installed: false, held: { verdict: 'rouge' }, id: entry.id };
  const scope = opts.scope === 'project' ? 'project' : 'global';
  if (scope === 'project' && !opts.project) throw fail('BAD_INPUT', 'Aucun projet ouvert.');
  const cmd = installCommand(entry, scope);
  const env = childEnv(home);
  const bin = (opts.findBin || findBin)(cmd.bin, env);
  if (!bin) throw fail('UNSUPPORTED', 'Commande « ' + cmd.bin + ' » introuvable : installez ' + PLUGIN_AGENTS[cmd.agent] + ' d’abord.');
  const r = await run(bin, cmd.args, { cwd: scope === 'project' ? opts.project : home, env, timeoutMs: 300000 });
  if (r.code !== 0) {
    console.error('[plugins] ' + cmd.bin + ' ' + cmd.args.join(' ') + ' : ' + r.out.slice(-2000));
    const line = r.out.split('\n').map((l) => l.trim()).filter(Boolean).pop() || 'code ' + r.code;
    throw fail('CLI_FAILED', PLUGIN_AGENTS[cmd.agent] + ' a refusé l’installation : ' + line.slice(0, 200));
  }
  return { installed: true, held: null, id: entry.id, agent: cmd.agent };
}
