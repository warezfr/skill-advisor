// Sauvegardes de serveurs MCP : création (secrets en variables ou gardés), retrait avec sauvegarde, restauration,
// application à d'autres agents (conversion par add-mcp), conflits, export et import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeHome, rmHome, assertInHome } from './helpers.mjs';
import { mcpPaths, mcpState, mcpDisable } from '../lib/mcp.mjs';
import { createMcpBackup, removeMcp, loadMcpBackup } from '../lib/mcp-backups.mjs';
import { listBackups, restoreBackup, deleteBackup } from '../lib/backups.mjs';
import { applyBackup } from '../lib/actions.mjs';
import { exportBackup, importBackup } from '../lib/archive.mjs';
import { parseStrict, canon } from '../lib/mcp-write.mjs';

const TOKEN = 'ghp_SECRETSECRETSECRETSECRET1234';
const GH = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: TOKEN } };

async function put(p, text) { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, text); }

async function setup(t) {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const paths = await mcpPaths({ home });
  const at = (id) => { const p = paths.find((x) => x.id === id); assertInHome(home, p.global); return p.global; };
  await put(at('claude-code'), JSON.stringify({ numStartups: 3, mcpServers: { github: GH, fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } }, null, 2));
  await put(at('cursor'), JSON.stringify({ mcpServers: { github: GH } }, null, 2));
  await fs.mkdir(path.join(home, '.codex'), { recursive: true });
  await put(at('codex'), '# Codex\nmodel = "m"\n');
  return { home, at };
}
const read = async (file, fmt = 'json') => canon(parseStrict(fmt, await fs.readFile(file, 'utf8')));

test('sauvegarde MCP à la demande : listée avec les skills, secrets remplacés par des variables, fichier privé', async (t) => {
  const { home } = await setup(t);
  const r = await createMcpBackup({ home, servers: [{ name: 'github' }, { name: 'absent' }] });
  assert.deepEqual(r.failed.map((f) => f.name), ['absent']);
  assert.equal(r.backup.kind, 'mcp');
  assert.deepEqual(r.backup.items[0].vars, ['GITHUB_PERSONAL_ACCESS_TOKEN']);
  assert.deepEqual(r.backup.items[0].agents.sort(), ['claude-code', 'cursor']);
  const list = await listBackups({ home });
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'mcp');
  assert.match(list[0].label, /^Serveurs MCP : github/);
  const { dir, items } = await loadMcpBackup(home, r.backup.id);
  const raw = await fs.readFile(path.join(dir, 'servers.json'), 'utf8');
  assert.ok(!raw.includes(TOKEN), 'aucun secret dans la sauvegarde');
  const byAgent = Object.fromEntries(items[0].places.map((p) => [p.agent, p.entry.env.GITHUB_PERSONAL_ACCESS_TOKEN]));
  assert.deepEqual(byAgent, { 'claude-code': '${GITHUB_PERSONAL_ACCESS_TOKEN}', cursor: '${env:GITHUB_PERSONAL_ACCESS_TOKEN}' }, 'syntaxe de chaque agent');
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(dir, 'servers.json'))).mode & 0o777, 0o600);
  await deleteBackup({ home, id: r.backup.id });
  assert.deepEqual(await listBackups({ home }), []);
});

test('retirer avec sauvegarde (valeurs gardées), puis restaurer : entrées rendues à l’identique chez leurs agents', async (t) => {
  const { home, at } = await setup(t);
  const claude0 = await read(at('claude-code'));
  const cursor0 = await read(at('cursor'));
  const r = await removeMcp({ home, name: 'github', backup: true, secrets: true });
  assert.deepEqual(r.failed, []);
  assert.equal(r.backups.length, 1);
  assert.ok(!('github' in (await read(at('claude-code'))).mcpServers));
  const back = await restoreBackup({ home, id: r.backups[0].id });
  assert.deepEqual(back.failed, []);
  assert.equal(back.applied.length, 2);
  assert.deepEqual(back.warnings, [], 'valeurs gardées : rien à définir');
  assert.deepEqual(await read(at('claude-code')), claude0);
  assert.deepEqual(await read(at('cursor')), cursor0);
  // Deuxième restauration : le serveur existe déjà, il est passé.
  const again = await restoreBackup({ home, id: r.backups[0].id });
  assert.equal(again.applied.length, 0);
  assert.equal(again.skipped.length, 2);
});

test('restaurer une sauvegarde à variables : avertissement, et serveur désactivé rendu désactivé', async (t) => {
  const { home, at } = await setup(t);
  await mcpDisable({ home, name: 'github', agents: ['cursor'] });
  const r = await removeMcp({ home, name: 'github', backup: true });
  const back = await restoreBackup({ home, id: r.backups[0].id });
  assert.deepEqual(back.failed, []);
  assert.match(back.warnings[0], /GITHUB_PERSONAL_ACCESS_TOKEN/);
  assert.equal((await read(at('claude-code'))).mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN, '${GITHUB_PERSONAL_ACCESS_TOKEN}');
  const gh = (await mcpState({ home })).servers.find((s) => s.name === 'github');
  assert.equal(gh.ag.cursor[0].stash, true, 'Cursor : rendu désactivé');
  assert.ok(!('github' in (await read(at('cursor'))).mcpServers));
});

test('appliquer à d’autres agents : OpenCode (JSONC) et Codex (TOML) par add-mcp, conflit passé, remplacement sauvegardé', async (t) => {
  const { home, at } = await setup(t);
  const { backup } = await createMcpBackup({ home, servers: [{ name: 'github' }, { name: 'fetch' }] });
  const r = await applyBackup({ home, id: backup.id, agents: ['opencode', 'codex'], conflict: 'skip' });
  assert.deepEqual(r.failed, []);
  assert.equal(r.applied.length, 4);
  const oc = await read(at('opencode'));
  const ocGh = (oc.mcp || {}).github;
  assert.ok(ocGh, 'OpenCode : github posé');
  assert.ok(JSON.stringify(ocGh).includes('{env:GITHUB_PERSONAL_ACCESS_TOKEN}'), 'OpenCode : variable dans sa syntaxe ' + JSON.stringify(ocGh));
  const codexText = await fs.readFile(at('codex'), 'utf8');
  assert.match(codexText, /# Codex/, 'commentaire de Codex gardé');
  const cx = await read(at('codex'), 'toml');
  assert.equal(cx.model, 'm');
  assert.equal(cx.mcp_servers.fetch.command, 'uvx');
  assert.deepEqual(cx.mcp_servers.github.env_vars, ['GITHUB_PERSONAL_ACCESS_TOKEN'], 'Codex : variable reprise de l’environnement (env_vars)');
  assert.equal(cx.mcp_servers.github.env, undefined);
  assert.ok(!(await fs.readFile(at('opencode'), 'utf8')).includes(TOKEN));

  const again = await applyBackup({ home, id: backup.id, agents: ['codex'], conflict: 'skip' });
  assert.equal(again.applied.length, 0);
  assert.equal(again.skipped.length, 2);
  const rep = await applyBackup({ home, id: backup.id, names: ['fetch'], agents: ['codex'], conflict: 'replace' });
  assert.equal(rep.applied.length, 1);
  assert.equal(rep.backups.length, 1, 'version présente sauvegardée avant remplacement');
  assert.equal(rep.backups[0].origin, 'replace');
  await assert.rejects(applyBackup({ home, id: backup.id, agents: [] }), { code: 'BAD_INPUT' });
});

test('export puis import : nouvelle sauvegarde MCP, état des secrets gardé, avertissement sur la commande lancée', async (t) => {
  const { home } = await setup(t);
  const { backup } = await createMcpBackup({ home, servers: [{ name: 'github' }] });
  const data = await exportBackup({ home, id: backup.id });
  const buf = Buffer.isBuffer(data) ? data : Buffer.concat(await (async () => { const c = []; for await (const x of data) c.push(x); return c; })());
  assert.ok(!buf.includes(TOKEN));
  const imp = await importBackup({ home, data: buf });
  assert.equal(imp.backup.kind, 'mcp');
  assert.notEqual(imp.backup.id, backup.id);
  assert.equal(imp.backup.origin, 'import');
  assert.deepEqual(imp.backup.items[0].vars, ['GITHUB_PERSONAL_ACCESS_TOKEN']);
  assert.match(imp.warnings[0], /lance : npx -y @modelcontextprotocol\/server-github/);
  assert.equal((await listBackups({ home })).length, 2);
});
