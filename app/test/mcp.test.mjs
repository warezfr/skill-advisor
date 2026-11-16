// Serveurs MCP : chemins isolés dans le dossier jetable, inventaire en lecture seule, secrets masqués.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeHome, rmHome, listTree, assertInHome } from './helpers.mjs';
import { mcpPaths, mcpState, agentOf, MCP_TO_AGENT, MCP_ONLY } from '../lib/mcp.mjs';
import { describe, MASK } from '../lib/mcp-mask.mjs';

const SECRETS = ['ghp_SECRETSECRETSECRETSECRET1234', 'SECRETKEY123', 'SECRET-BEARER-XYZ', 'hunter2SECRET', 'SECRET-CODEX-TOKEN',
  'SECRET-GOOSE-VALUE', 'SECRET-PROJECT-ENV', 'pa55word-in-url'];

async function put(p, text) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text);
}

// Contenu de chaque fichier de l'arbre : sert à prouver qu'une lecture n'a rien changé.
async function snapshot(dir) {
  const out = {};
  for (const r of await listTree(dir)) if (!r.endsWith('/')) out[r] = await fs.readFile(path.join(dir, r), 'utf8');
  return out;
}

// Pose des réglages MCP réalistes aux chemins qu'add-mcp lit pour ce système, dans le dossier jetable.
async function fixture(home, project) {
  const paths = await mcpPaths({ home, cwd: project });
  const at = (id, k = 'global') => {
    const p = paths.find((x) => x.id === id)[k];
    assertInHome(home, p);
    return p;
  };
  await put(at('claude-code'), JSON.stringify({
    numStartups: 7, projects: { '/x': { allowedTools: [] } },
    mcpServers: {
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_SECRETSECRETSECRETSECRET1234' } },
      remote: { type: 'http', url: 'https://mcp.example.com/mcp?api_key=SECRETKEY123&region=eu', headers: { Authorization: 'Bearer SECRET-BEARER-XYZ' } },
      fetch: { command: 'uvx', args: ['mcp-server-fetch'], env: { MY_KEY: '${MY_KEY}' } },
    },
  }, null, 2));
  await put(at('cursor'), JSON.stringify({ mcpServers: {
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_SECRETSECRETSECRETSECRET1234' } },
    pg: { command: 'npx', args: ['-y', 'pg-mcp', '--password', 'hunter2SECRET', 'postgres://admin:pa55word-in-url@db.local/app'] },
  } }, null, 2));
  await put(at('codex'), '[mcp_servers.fetch]\ncommand = "uvx"\nargs = ["mcp-server-fetch", "--verbose"]\n\n[mcp_servers.fetch.env]\nTOKEN = "SECRET-CODEX-TOKEN"\n');
  await put(at('goose'), 'extensions:\n  files:\n    type: stdio\n    cmd: npx\n    args: ["-y", "@modelcontextprotocol/server-filesystem"]\n    envs:\n      KEY: SECRET-GOOSE-VALUE\n    enabled: false\n');
  await put(at('github-copilot-cli'), JSON.stringify({ mcpServers: { notes: { type: 'local', command: 'node', args: ['notes.js'] } } }, null, 2));
  await put(at('claude-code', 'local'), JSON.stringify({ mcpServers: { local: { command: 'node', args: ['srv.js'], env: { P: 'SECRET-PROJECT-ENV' } } } }, null, 2));
  return paths;
}

test('MCP : les chemins des 25 agents restent dans le dossier jetable et le projet', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const project = path.join(home, 'projet');
  await fs.mkdir(project);
  const paths = await mcpPaths({ home, cwd: project });
  assert.ok(paths.length >= 25, 'agents d’add-mcp : ' + paths.length);
  for (const p of paths) {
    assertInHome(home, p.global);
    if (p.local) assertInHome(project, p.local);
  }
  // Lire les chemins n'a rien créé.
  assert.deepEqual(await listTree(home), ['.claude/', '.cursor/', '.gemini/', 'projet/']);
});

test('MCP : inventaire en lecture seule, regroupé par nom, identifiants ramenés à ceux des skills', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const project = path.join(home, 'projet');
  await fs.mkdir(project);
  await fixture(home, project);
  const before = await snapshot(home);
  const st = await mcpState({ home, project });
  assert.deepEqual(await snapshot(home), before, 'aucun fichier modifié ni créé');

  const byName = (n, scope = 'global') => st.servers.find((s) => s.name === n && s.scope === scope);
  const gh = byName('github');
  assert.ok(gh && gh.ag['claude-code'] && gh.ag.cursor, 'github vu chez Claude Code et Cursor');
  assert.equal(gh.differs, false);
  assert.equal(gh.kind, 'stdio');
  assert.equal(gh.command, 'npx');
  assert.equal(gh.env.GITHUB_PERSONAL_ACCESS_TOKEN, MASK);
  assert.equal(gh.secrets, 1);

  const fetch = byName('fetch');
  assert.ok(fetch.ag['claude-code'] && fetch.ag.codex, 'fetch chez Claude Code et Codex (TOML)');
  assert.equal(fetch.differs, true, 'arguments différents d’un agent à l’autre');

  const remote = byName('remote');
  assert.equal(remote.kind, 'http');
  assert.match(remote.url, /api_key=/);
  assert.equal(remote.headers.Authorization, MASK);

  const files = byName('files');
  assert.ok(files && files.ag.goose, 'Goose (YAML) lu');
  assert.equal(files.on, false, 'enabled: false lu comme désactivé');

  const notes = byName('notes');
  assert.ok(notes && notes.ag['github-copilot'] && notes.ag['github-copilot'][0].mcpId === 'github-copilot-cli', 'Copilot CLI ramené à github-copilot');

  const local = byName('local', 'project');
  assert.ok(local && local.ag['claude-code'], 'serveur du projet (.mcp.json)');
  assert.equal(local.id, 'project:local');

  const json = JSON.stringify(st);
  for (const s of SECRETS) assert.ok(!json.includes(s), 'secret absent de l’état : ' + s);
  assert.ok(st.agents.some((a) => a.id === 'github-copilot' && a.mcpId === 'github-copilot-cli' && a.count === 1));
});

test('MCP : fichier de réglages mal formé (lu par un analyseur tolérant), signalé sans son contenu', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const paths = await mcpPaths({ home });
  const cursor = paths.find((x) => x.id === 'cursor').global;
  await put(cursor, '{ "mcpServers": { "x": { "env": { "K": "SECRET-BROKEN-FILE" ');
  const st = await mcpState({ home });
  const a = st.agents.find((x) => x.mcpId === 'cursor');
  assert.ok(!JSON.stringify(st).includes('SECRET-BROKEN-FILE'));
  assert.ok(a, 'Cursor détecté');
  assert.match(a.error, /mal formé/);
});

test('MCP : correspondance des identifiants', () => {
  assert.equal(agentOf('github-copilot-cli'), 'github-copilot');
  assert.equal(agentOf('vscode'), 'github-copilot');
  assert.equal(agentOf('cline-cli'), 'cline');
  assert.equal(agentOf('claude-code'), 'claude-code');
  assert.ok(MCP_ONLY.has('claude-desktop'));
  for (const v of Object.values(MCP_TO_AGENT)) assert.match(v, /^[a-z][a-z0-9-]*$/);
});

test('MCP : masquage (env, en-têtes, arguments, adresse) et références de variables gardées', () => {
  const d = describe({
    command: 'npx',
    args: ['-y', 'srv', '--api-key', 'abc123', '--token=xyz', 'API_KEY=val', 'ghp_abcdefghijklmnopqrstuvwx', '--port', '3000', '--key', '${KEY}'],
    env: { A: 'plain', B: '${B}', C: '{env:C}', D: '$D', E: '%E%', F: '${F:-x}' },
  });
  assert.deepEqual(d.args, ['-y', 'srv', '--api-key', MASK, '--token=' + MASK, 'API_KEY=' + MASK, MASK, '--port', '3000', '--key', '${KEY}']);
  assert.deepEqual(d.env, { A: MASK, B: '${B}', C: '{env:C}', D: '$D', E: '%E%', F: '${F:-x}' });
  assert.equal(d.secrets, 5);
  const r = describe({ url: 'https://u:p@h.example/mcp?token=t1&x=1', headers: { 'Content-Type': 'application/json', 'X-Key': 'k' } });
  assert.equal(r.kind, 'http');
  assert.ok(!/u:p|t1/.test(r.url) && r.url.includes(MASK) && /x=1/.test(r.url), r.url);
  assert.deepEqual(r.headers, { 'Content-Type': 'application/json', 'X-Key': MASK });
  assert.equal(describe({ url: 'https://h/sse', type: 'sse' }).kind, 'sse');
  assert.equal(describe({ command: ['bun', 'x', 'srv'], environment: { K: 'v' } }).command, 'bun');
  assert.equal(describe({ bearer_token_env_var: 'GH' }).headers.Authorization, 'Bearer ${GH}');
  assert.equal(describe({ url: 'not a url' }).url, MASK);
});

test('MCP : identité masquée (adresse, jeton, clé=valeur)', async () => {
  const { maskIdentity } = await import('../lib/mcp-mask.mjs');
  assert.equal(maskIdentity('https://h.example/mcp?api_key=S1&x=1'), 'https://h.example/mcp?api_key=' + encodeURIComponent(MASK) + '&x=1');
  assert.equal(maskIdentity('@scope/pkg'), '@scope/pkg');
  assert.equal(maskIdentity('npx srv ghp_abcdefghijklmnopqrstuvwx TOKEN=abc'), 'npx srv ' + MASK + ' TOKEN=' + MASK);
});

// --- Gestes : désactiver, réactiver, retirer ---
import { mcpDisable, mcpEnable, mcpRemove, stashDir } from '../lib/mcp.mjs';
import { parseStrict, canon } from '../lib/mcp-write.mjs';

const fileOf = (paths, id, k = 'global') => paths.find((x) => x.id === id)[k];
const parsed = async (paths, id, fmt = 'json', k = 'global') => canon(parseStrict(fmt, await fs.readFile(fileOf(paths, id, k), 'utf8')));

test('MCP : désactiver chez un seul agent, puis réactiver : fichier rendu à l’identique, l’autre agent jamais touché', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const project = path.join(home, 'projet');
  await fs.mkdir(project);
  const paths = await fixture(home, project);
  const cursor0 = await parsed(paths, 'cursor');
  const claudeBytes = await fs.readFile(fileOf(paths, 'claude-code'), 'utf8');

  const d = await mcpDisable({ home, project, name: 'github', agents: ['cursor'] });
  assert.deepEqual(d.failed, []);
  assert.deepEqual(d.done.map((x) => x.agent), ['cursor']);
  assert.ok(!('github' in (await parsed(paths, 'cursor')).mcpServers), 'github retiré du fichier de Cursor');
  assert.equal(await fs.readFile(fileOf(paths, 'claude-code'), 'utf8'), claudeBytes, 'Claude Code intact');
  const st = await mcpState({ home, project });
  const gh = st.servers.find((s) => s.name === 'github' && s.scope === 'global');
  assert.equal(gh.ag.cursor[0].on, false);
  assert.equal(gh.ag.cursor[0].stash, true);
  assert.equal(gh.ag['claude-code'][0].on, true);
  assert.equal(gh.on, true);
  assert.ok(!JSON.stringify(st).includes('ghp_SECRET'), 'mise de côté masquée dans l’état');
  if (process.platform !== 'win32') {
    const tree = await listTree(stashDir(home));
    const f = tree.find((x) => x.endsWith('.json'));
    assert.equal((await fs.stat(path.join(stashDir(home), f))).mode & 0o777, 0o600);
  }
  assert.ok(!JSON.stringify(d).includes('ghp_SECRET'));

  const e = await mcpEnable({ home, project, name: 'github', agents: ['cursor'] });
  assert.deepEqual(e.failed, []);
  assert.deepEqual(await parsed(paths, 'cursor'), cursor0, 'Cursor rendu à l’identique');
  assert.deepEqual(await listTree(stashDir(home)), ['cursor/', 'cursor/global/'], 'plus de mise de côté');
});

test('MCP : TOML (Codex) et YAML (Goose) : désactiver puis réactiver, commentaires gardés', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const paths = await fixture(home, null);
  await fs.writeFile(fileOf(paths, 'codex'), '# mes réglages\nmodel = "m"\n\n' + await fs.readFile(fileOf(paths, 'codex'), 'utf8'));
  const codex0 = await parsed(paths, 'codex', 'toml');
  const goose0 = await parsed(paths, 'goose', 'yaml');
  assert.deepEqual((await mcpDisable({ home, name: 'fetch', agents: ['codex'] })).failed, []);
  assert.match(await fs.readFile(fileOf(paths, 'codex'), 'utf8'), /# mes réglages/);
  assert.deepEqual((await mcpEnable({ home, name: 'fetch', agents: ['codex'] })).failed, []);
  assert.deepEqual(await parsed(paths, 'codex', 'toml'), codex0);
  // Goose : le serveur est déjà « enabled: false » dans son fichier, il n'est pas mis de côté une deuxième fois.
  const g = await mcpDisable({ home, name: 'files', agents: ['goose'] });
  assert.deepEqual(g.done, []);
  assert.deepEqual(await parsed(paths, 'goose', 'yaml'), goose0);
});

test('MCP : retirer de tous les agents, entrées des fichiers et copie désactivée comprises', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const paths = await fixture(home, null);
  await mcpDisable({ home, name: 'github', agents: ['cursor'] });
  let seen = null;
  const r = await mcpRemove({ home, name: 'github', keep: async (x) => { seen = x; return 'sauvegarde-test'; } });
  assert.deepEqual(r.failed, []);
  assert.equal(r.backup, 'sauvegarde-test');
  assert.deepEqual(seen.items.map((i) => [i.agent, i.off]).sort(), [['claude-code', false], ['cursor', true]]);
  assert.equal(seen.items[0].entry.env.GITHUB_PERSONAL_ACCESS_TOKEN, 'ghp_SECRETSECRETSECRETSECRET1234', 'entrée brute transmise à la sauvegarde');
  assert.ok(!('github' in (await parsed(paths, 'claude-code')).mcpServers));
  assert.ok(!('github' in (await parsed(paths, 'cursor')).mcpServers));
  assert.equal((await parsed(paths, 'claude-code')).numStartups, 7, 'autres clés de ~/.claude.json gardées');
  const st = await mcpState({ home });
  assert.ok(!st.servers.some((s) => s.name === 'github'));
  assert.ok((await listTree(stashDir(home))).every((f) => f.endsWith('/')), 'copie désactivée effacée');
  await assert.rejects(mcpRemove({ home, name: 'github' }), { code: 'NOT_FOUND' });
});

test('MCP : portée projet, et fichier mal formé jamais touché (les autres agents continuent)', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const project = path.join(home, 'projet');
  await fs.mkdir(project);
  const paths = await fixture(home, project);
  await assert.rejects(mcpDisable({ home, name: 'local', scope: 'project' }), { code: 'BAD_INPUT' });
  const d = await mcpDisable({ home, project, name: 'local', scope: 'project' });
  assert.deepEqual(d.done.map((x) => x.agent), ['claude-code']);
  assert.deepEqual((await parsed(paths, 'claude-code', 'json', 'local')).mcpServers, {});
  // Une autre ouverture sans ce projet ne voit pas sa copie désactivée.
  assert.ok(!(await mcpState({ home })).servers.some((s) => s.name === 'local'));
  assert.deepEqual((await mcpEnable({ home, project, name: 'local', scope: 'project' })).failed, []);
  assert.ok('local' in (await parsed(paths, 'claude-code', 'json', 'local')).mcpServers);

  const cursorFile = fileOf(paths, 'cursor');
  const broken = (await fs.readFile(cursorFile, 'utf8')).replace(/\}\s*$/, '');
  await fs.writeFile(cursorFile, broken);
  const r = await mcpDisable({ home, project, name: 'github' });
  assert.deepEqual(r.done.map((x) => x.agent), ['claude-code']);
  assert.deepEqual(r.failed.map((x) => [x.agent, x.code]), [['cursor', 'BROKEN_CONFIG']]);
  assert.equal(await fs.readFile(cursorFile, 'utf8'), broken, 'fichier mal formé intact');
  await assert.rejects(mcpDisable({ home, name: 'a\u0000b' }), { code: 'BAD_NAME' });
});
