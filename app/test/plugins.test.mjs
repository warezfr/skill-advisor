// Plugins des agents : inventaire en lecture seule (Claude Code, Codex, Gemini CLI, Copilot CLI, Antigravity),
// contenu de chaque plugin, état, portée, chemins hors du dossier personnel ignorés.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeHome, rmHome, listTree } from './helpers.mjs';
import { pluginState, contents } from '../lib/plugins.mjs';

async function put(p, text) { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, text); }
const J = (o) => JSON.stringify(o, null, 2);

async function plugin(dir, { skills = [], commands = [], agents = [], hooks = null, mcp = null, manifest = {} } = {}) {
  await put(path.join(dir, '.claude-plugin', 'plugin.json'), J({ name: path.basename(dir), version: '1.2.0', description: 'Un plugin d’essai.', author: { name: 'Acme' }, ...manifest }));
  for (const s of skills) await put(path.join(dir, 'skills', s, 'SKILL.md'), '---\nname: ' + s + '\ndescription: x\n---\n');
  for (const c of commands) await put(path.join(dir, 'commands', c + '.md'), '# ' + c);
  for (const a of agents) await put(path.join(dir, 'agents', a + '.md'), '# ' + a);
  if (hooks) await put(path.join(dir, 'hooks', 'hooks.json'), J({ hooks }));
  if (mcp) await put(path.join(dir, '.mcp.json'), J({ mcpServers: mcp }));
}

test('plugins : cinq agents lus, regroupés par nom, état et portée, contenu compté, rien écrit', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const project = path.join(home, 'projet');
  await fs.mkdir(project);
  const cc = path.join(home, '.claude', 'plugins', 'cache');
  await plugin(path.join(cc, 'acme', 'helper', '1.2.0'), { skills: ['a', 'b'], commands: ['go'], agents: ['rev'], hooks: { PreToolUse: [], SessionStart: [] }, mcp: { db: { command: 'x', env: { K: 'SECRET-PLUGIN' } } } });
  await plugin(path.join(cc, 'acme', 'proj-only', '0.1.0'), { skills: ['c'] });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sa-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await plugin(outside, { skills: ['z'] });
  await put(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), J({ version: 2, plugins: {
    'helper@acme': [{ scope: 'user', installPath: path.join(cc, 'acme', 'helper', '1.2.0'), version: '1.2.0' }],
    'proj-only@acme': [{ scope: 'project', projectPath: path.join(home, 'autre'), installPath: path.join(cc, 'acme', 'proj-only', '0.1.0'), version: '0.1.0' }],
    'here@acme': [{ scope: 'project', projectPath: project, installPath: outside, version: '9.9.9' }],
  } }));
  await put(path.join(home, '.claude', 'settings.json'), J({ enabledPlugins: { 'helper@acme': false } }));
  await put(path.join(project, '.claude', 'settings.local.json'), J({ enabledPlugins: { 'here@acme': true } }));

  await plugin(path.join(home, '.codex', 'plugins', 'cache', 'mkt', 'helper', '1.0.0'), { skills: ['a'] });
  await plugin(path.join(home, '.codex', 'plugins', 'cache', 'mkt', 'helper', '1.1.0'), { skills: ['a'] });
  await put(path.join(home, '.codex', 'config.toml'), '# Codex\n[plugins."helper@mkt"]\nenabled = true\n\n[plugins."ghost@mkt"]\nenabled = false\n');

  await put(path.join(home, '.gemini', 'extensions', 'conductor', 'gemini-extension.json'), J({ name: 'conductor', version: '0.4.1', mcpServers: { c: {} } }));
  await put(path.join(home, '.gemini', 'extensions', 'quiet', 'gemini-extension.json'), J({ name: 'quiet', version: '1.0.0' }));
  await put(path.join(home, '.gemini', 'extensions', 'extension-enablement.json'), J({ quiet: { overrides: ['/a/*', '!' + home + '/*'] } }));
  await fs.mkdir(path.join(home, '.copilot', 'installed-plugins', 'mkt', 'helper'), { recursive: true });
  await fs.mkdir(path.join(home, '.copilot', 'installed-plugins', '_direct', 'raw-src'), { recursive: true });
  await plugin(path.join(home, '.gemini', 'config', 'plugins', 'helper'), { skills: ['a'] });

  const before = await listTree(home);
  const st = await pluginState({ home, project });
  assert.deepEqual(await listTree(home), before, 'rien créé');
  assert.deepEqual(st.agents.map((a) => a.id), ['claude-code', 'codex', 'gemini-cli', 'github-copilot', 'antigravity']);
  const by = (n) => st.plugins.find((p) => p.name === n);

  const h = by('helper');
  assert.deepEqual(Object.keys(h.ag).sort(), ['antigravity', 'claude-code', 'codex', 'github-copilot'], 'helper regroupé chez quatre agents');
  assert.equal(h.ag['claude-code'][0].on, false, 'désactivé dans enabledPlugins');
  assert.equal(h.ag['claude-code'][0].pluginId, 'helper@acme');
  assert.equal(h.ag.codex[0].version, '1.1.0', 'Codex : dernière version du cache');
  assert.equal(h.ag.codex[0].on, true);
  assert.equal(h.ag['github-copilot'][0].on, null, 'Copilot : état non documenté');
  assert.equal(h.contents.skills, 2);
  assert.equal(h.contents.commands, 1);
  assert.equal(h.contents.agents, 1);
  assert.deepEqual(h.contents.hooks, ['PreToolUse', 'SessionStart']);
  assert.deepEqual(h.contents.mcp, ['db']);
  assert.equal(h.contents.author, 'Acme');
  assert.ok(!JSON.stringify(st).includes('SECRET-PLUGIN'), 'valeurs des serveurs du plugin jamais lues dans l’état');

  const po = by('proj-only');
  assert.equal(po.ag['claude-code'][0].other, true, 'autre projet signalé');
  assert.equal(po.otherOnly, true);
  const here = by('here');
  assert.equal(here.ag['claude-code'][0].other, false, 'projet ouvert');
  assert.equal(here.ag['claude-code'][0].on, true, 'activé dans settings.local.json du projet');
  assert.equal(here.ag['claude-code'][0].read, false, 'dossier hors du dossier personnel : pas lu');
  assert.equal(here.contents, null);

  assert.ok(by('ghost') && by('ghost').ag.codex[0].on === false, 'Codex : plugin seulement dans config.toml');
  assert.equal(by('conductor').ag['gemini-cli'][0].on, true);
  assert.equal(by('quiet').ag['gemini-cli'][0].on, false, 'Gemini : dernière règle « ! » désactive');
  assert.ok(by('raw-src'), 'Copilot : installation directe');
  assert.equal(st.agents.find((a) => a.id === 'claude-code').count, 2, 'Claude Code : plugins du dossier personnel et du projet ouvert');
});

test('plugins : rien d’installé, fichier illisible', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  assert.deepEqual(await pluginState({ home }), { agents: [], plugins: [] });
  await put(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), '{ "plugins": ');
  const st = await pluginState({ home });
  assert.equal(st.agents[0].error, 'Fichier des plugins illisible.');
  const c = await contents(path.join(home, 'absent'));
  assert.equal(c.skills, 0);
});
