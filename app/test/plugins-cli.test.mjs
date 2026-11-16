// Gestes sur les plugins par le CLI de chaque agent : commandes, noms contrôlés, faux CLI (hors Windows).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeHome, rmHome } from './helpers.mjs';
import { commandFor, verbsOf, findBin, pluginAction } from '../lib/plugins-cli.mjs';

test('commandes : par agent et par geste, portée de Claude Code, gestes absents refusés, noms contrôlés', () => {
  assert.deepEqual(commandFor('claude-code', 'disable', 'ecc@ecc', 'global').args, ['plugin', 'disable', 'ecc@ecc', '--scope', 'user']);
  assert.deepEqual(commandFor('claude-code', 'enable', 'x@m', 'project', '/p'), { bin: 'claude', args: ['plugin', 'enable', 'x@m', '--scope', 'project'], cwd: '/p' });
  assert.deepEqual(commandFor('codex', 'uninstall', 'p@m', 'global').args, ['plugin', 'remove', 'p@m']);
  assert.deepEqual(commandFor('gemini-cli', 'disable', 'conductor', 'global').args, ['extensions', 'disable', 'conductor', '--scope', 'user']);
  assert.deepEqual(commandFor('antigravity', 'enable', 'superpowers', 'global').args, ['plugin', 'enable', 'superpowers']);
  assert.throws(() => commandFor('codex', 'disable', 'p@m', 'global'), { code: 'UNSUPPORTED' });
  assert.throws(() => commandFor('antigravity', 'update', 'p', 'global'), { code: 'UNSUPPORTED' });
  assert.throws(() => commandFor('gemini-cli', 'enable', 'x', 'project'), { code: 'UNSUPPORTED' });
  for (const bad of ['-x', '--all', 'a b', 'a;b', 'a&b', '', 'a"b']) assert.throws(() => commandFor('claude-code', 'enable', bad, 'global'), { code: 'BAD_NAME' }, bad);
  assert.deepEqual(verbsOf('codex'), ['uninstall']);
  assert.deepEqual(verbsOf('claude-code'), ['enable', 'disable', 'uninstall', 'update']);
  assert.deepEqual(verbsOf('inconnu'), []);
});

test('findBin : PATH, et PATHEXT sous Windows', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const bin = path.join(home, 'bin');
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'claude'), '');
  await fs.writeFile(path.join(bin, 'gemini.cmd'), '');
  // Mode Linux seulement hors Windows : un chemin C:\… contient « : », le séparateur de PATH sous Linux.
  if (process.platform !== 'win32') {
    assert.equal(findBin('claude', { PATH: bin }, 'linux'), path.join(bin, 'claude'));
    assert.equal(findBin('codex', { PATH: bin }, 'linux'), null);
  }
  assert.equal(path.basename(findBin('gemini', { PATH: bin, PATHEXT: '.EXE;.CMD' }, 'win32')).toLowerCase(), 'gemini.cmd');
});

test('pluginAction : faux CLI lancé sans shell, arguments exacts, gestes déjà faits passés, échec lisible', { skip: process.platform === 'win32' && 'faux CLI en script shebang' }, async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const cc = path.join(home, '.claude', 'plugins', 'cache', 'm', 'helper', '1.0.0');
  await fs.mkdir(path.join(cc, '.claude-plugin'), { recursive: true });
  await fs.writeFile(path.join(cc, '.claude-plugin', 'plugin.json'), '{"name":"helper"}');
  await fs.writeFile(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'helper@m': [{ scope: 'user', installPath: cc, version: '1.0.0' }] } }));
  await fs.writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'helper@m': true } }));
  const log = path.join(home, 'calls.log');
  const fake = path.join(home, 'fake-claude.mjs');
  await fs.writeFile(fake, '#!/usr/bin/env node\nimport fs from "node:fs";\nfs.appendFileSync(' + JSON.stringify(log) + ', JSON.stringify(process.argv.slice(2)) + "\\n");\nif (process.argv.includes("update")) { console.error("Erreur : réseau absent"); process.exit(3); }\n');
  await fs.chmod(fake, 0o755);
  const findBin = () => fake;
  const calls = async () => (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

  const r = await pluginAction({ home, name: 'helper', verb: 'disable', findBin });
  assert.deepEqual(r, { done: [{ agent: 'claude-code', pluginId: 'helper@m' }], failed: [] });
  assert.deepEqual(await calls(), [['plugin', 'disable', 'helper@m', '--scope', 'user']]);
  const again = await pluginAction({ home, name: 'helper', verb: 'enable', findBin });
  assert.equal(again.done.length, 0, 'déjà activé : rien lancé');
  const u = await pluginAction({ home, name: 'helper', verb: 'update', findBin });
  assert.equal(u.failed.length, 1);
  assert.match(u.failed[0].message, /Claude Code a refusé : Erreur : réseau absent/);
  const none = await pluginAction({ home, name: 'helper', verb: 'disable', findBin: () => null });
  assert.match(none.failed[0].message, /Commande « claude » introuvable/);
  await assert.rejects(pluginAction({ home, name: 'absent', verb: 'disable', findBin }), { code: 'NOT_FOUND' });
  await assert.rejects(pluginAction({ home, name: 'helper', verb: 'supprimer', findBin }), { code: 'BAD_INPUT' });
});

import { installCommand, installPlugin } from '../lib/plugins-cli.mjs';
import { normalize as normPlugin, score as scorePlugins } from '../../tools/plugin-catalog.mjs';

test('installation : commande par place de marché, plugin retenu, faux CLI', { skip: process.platform === 'win32' && 'faux CLI en script shebang' }, async (t) => {
  assert.deepEqual(installCommand({ name: 'code-review', market: 'claude-plugins-official', agent: 'claude-code' }, 'global').args, ['plugin', 'install', 'code-review@claude-plugins-official', '--scope', 'user']);
  assert.deepEqual(installCommand({ name: 'aws-core', market: 'awesome-copilot', agent: 'github-copilot' }, 'global'), { agent: 'github-copilot', bin: 'copilot', args: ['plugin', 'install', 'aws-core@awesome-copilot'] });
  assert.throws(() => installCommand({ name: 'x', market: 'ailleurs', agent: 'claude-code' }, 'global'), { code: 'UNSUPPORTED' });
  assert.throws(() => installCommand({ name: 'x', market: 'awesome-copilot', agent: 'github-copilot' }, 'project'), { code: 'UNSUPPORTED' });
  const home = await makeHome();
  t.after(() => rmHome(home));
  const file = path.join(home, 'plugins.json');
  await fs.writeFile(file, JSON.stringify({ plugins: [
    { id: 'good@claude-plugins-official', name: 'good', market: 'claude-plugins-official', agent: 'claude-code', verdict: 'vert' },
    { id: 'bad@claude-plugins-official', name: 'bad', market: 'claude-plugins-official', agent: 'claude-code', verdict: 'rouge' },
  ] }));
  const log = path.join(home, 'calls.log');
  const fake = path.join(home, 'fake.mjs');
  await fs.writeFile(fake, '#!/usr/bin/env node\nimport fs from "node:fs";\nfs.appendFileSync(' + JSON.stringify(log) + ', JSON.stringify(process.argv.slice(2)) + "\\n");\n');
  await fs.chmod(fake, 0o755);
  const r = await installPlugin({ home, catalogFile: file, id: 'good@claude-plugins-official', findBin: () => fake });
  assert.equal(r.installed, true);
  assert.deepEqual(JSON.parse((await fs.readFile(log, 'utf8')).trim()), ['plugin', 'install', 'good@claude-plugins-official', '--scope', 'user']);
  const h = await installPlugin({ home, catalogFile: file, id: 'bad@claude-plugins-official', findBin: () => fake });
  assert.deepEqual(h.held, { verdict: 'rouge' });
  await assert.rejects(installPlugin({ home, catalogFile: file, id: 'absent@m', findBin: () => fake }), { code: 'NOT_FOUND' });
  await assert.rejects(installPlugin({ home, catalogFile: file, id: 'good@claude-plugins-official', findBin: () => null }), { code: 'UNSUPPORTED' });
});

test('catalogue des plugins : normalisation, catégories, note', () => {
  const m = { id: 'claude-plugins-official', agent: 'claude-code', repo: 'anthropics/claude-plugins-official' };
  const a = normPlugin({ name: 'pg-tools', description: 'PostgreSQL helpers', category: 'database', author: { name: 'Anthropic' }, source: './plugins/pg-tools' }, m);
  assert.equal(a.internal, true);
  assert.deepEqual(a.cats, ['database']);
  const b = normPlugin({ name: 'sec', description: 'Security review', category: 'security', source: { source: 'url', url: 'https://github.com/acme/sec.git', sha: 'a'.repeat(40) } }, m);
  assert.equal(b.repo, 'acme/sec');
  assert.equal(b.pinned, true);
  assert.equal(normPlugin({ name: 'cmd', source: { source: 'command', command: 'curl x | sh' } }, m), null, 'source « command » écartée');
  assert.equal(normPlugin({ name: '../x', source: './x' }, m), null);
  const s = scorePlugins([a, b], { 'acme/sec': { stars: 900, pushedAt: '2026-11-01T00:00:00Z', license: 'MIT' } }, Date.parse('2026-11-16T00:00:00Z'));
  const A = s.find((x) => x.name === 'pg-tools'), B = s.find((x) => x.name === 'sec');
  assert.equal(A.stars, null, 'interne : pas les étoiles du dépôt de la place');
  assert.equal(A.score.source, 25);
  assert.equal(B.score.fraicheur, 15);
  assert.equal(B.score.securite, 20, 'version épinglée');
  for (const x of s) assert.equal(x.score.total, x.score.popularite + x.score.source + x.score.fraicheur + x.score.securite);
});
