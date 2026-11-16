// Installation depuis le catalogue MCP : commande construite ici (version épinglée), variables saisies ou en référence,
// serveur à risque retenu, conflit passé ou remplacé avec sauvegarde, formes de Claude Code, Cursor et Codex.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeHome, rmHome } from './helpers.mjs';
import { mcpPaths } from '../lib/mcp.mjs';
import { installMcp, configFor, localName } from '../lib/mcp-install.mjs';
import { parseStrict } from '../lib/mcp-write.mjs';

const CAT = {
  generatedAt: '2026-11-16T00:00:00Z',
  servers: [
    { id: 'io.github.acme/github-mcp', verdict: 'vert', vulns: [], install: { type: 'npm', id: '@acme/github-mcp', version: '2.1.0', runtime: 'npx',
      env: [{ name: 'GITHUB_TOKEN', secret: true, required: true }, { name: 'LOG_LEVEL', secret: false, required: false }], args: ['--stdio'] } },
    { id: 'com.vendor/remote', verdict: 'vert', vulns: [], install: { type: 'remote', url: 'https://mcp.vendor.com/mcp', transport: 'http', headers: [{ name: 'Authorization', secret: true, required: true }] } },
    { id: 'io.github.x/risky', verdict: 'rouge', vulns: [], install: { type: 'npm', id: 'risky', version: '1.0.0', env: [] } },
    { id: 'io.github.x/vuln', verdict: 'vert', vulns: ['GHSA-1'], install: { type: 'pypi', id: 'vuln-mcp', version: '0.2.0', env: [] } },
    { id: 'io.github.x/img', verdict: 'vert', vulns: [], install: { type: 'oci', id: 'docker.io/mcp/img', version: '1.4', env: [{ name: 'API_KEY', secret: true, required: true }] } },
  ],
};

async function setup(t) {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const file = path.join(home, 'catalogue.json');
  await fs.writeFile(file, JSON.stringify(CAT));
  await fs.mkdir(path.join(home, '.codex'), { recursive: true });
  const paths = await mcpPaths({ home });
  const at = (id) => paths.find((x) => x.id === id).global;
  return { home, file, at };
}
const read = async (f, fmt = 'json') => parseStrict(fmt, await fs.readFile(f, 'utf8'));

test('configFor : npm, PyPI, Docker et distant ; version épinglée ; variables saisies ou en référence', () => {
  const s = CAT.servers;
  assert.deepEqual(configFor(s[0], 'claude-code', {}), { command: 'npx', args: ['-y', '@acme/github-mcp@2.1.0', '--stdio'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } });
  assert.deepEqual(configFor(s[0], 'cursor', { GITHUB_TOKEN: 'ghp_x', LOG_LEVEL: 'debug' }).env, { GITHUB_TOKEN: 'ghp_x', LOG_LEVEL: 'debug' });
  assert.deepEqual(configFor(s[1], 'opencode', {}), { type: 'http', url: 'https://mcp.vendor.com/mcp', headers: { Authorization: '{env:Authorization}' } });
  assert.deepEqual(configFor(s[3], 'claude-code', {}), { command: 'uvx', args: ['vuln-mcp@0.2.0'] });
  assert.deepEqual(configFor(s[4], 'claude-code', {}), { command: 'docker', args: ['run', '-i', '--rm', '-e', 'API_KEY', 'docker.io/mcp/img:1.4'], env: { API_KEY: '${API_KEY}' } });
  assert.throws(() => configFor({ install: { type: 'npm', id: 'x', version: 'latest' } }, 'cursor'), { code: 'BAD_INPUT' });
  assert.throws(() => configFor({ install: { type: 'npm', id: 'x; rm -rf /', version: '1' } }, 'cursor'), { code: 'BAD_INPUT' });
  assert.throws(() => configFor({ install: { type: 'remote', url: 'http://x' } }, 'cursor'), { code: 'BAD_INPUT' });
  assert.equal(localName(s[0]), 'github-mcp');
});

test('installer chez Claude Code, Cursor et Codex : forme propre à chacun, secret saisi écrit, autres réglages gardés', async (t) => {
  const { home, file, at } = await setup(t);
  await fs.writeFile(at('claude-code'), JSON.stringify({ numStartups: 2, mcpServers: {} }, null, 2));
  await fs.writeFile(at('codex'), '# Codex\nmodel = "m"\n');
  const r = await installMcp({ home, catalogFile: file, id: 'io.github.acme/github-mcp', agents: ['claude-code', 'cursor', 'codex'], values: {} });
  assert.deepEqual(r.failed, []);
  assert.equal(r.installed.length, 3);
  assert.equal(r.name, 'github-mcp');
  assert.match(r.warnings.join(' '), /GITHUB_TOKEN/);
  const cl = await read(at('claude-code'));
  assert.equal(cl.numStartups, 2);
  assert.deepEqual(cl.mcpServers['github-mcp'].args, ['-y', '@acme/github-mcp@2.1.0', '--stdio']);
  assert.equal(cl.mcpServers['github-mcp'].env.GITHUB_TOKEN, '${GITHUB_TOKEN}');
  assert.equal((await read(at('cursor'))).mcpServers['github-mcp'].env.GITHUB_TOKEN, '${env:GITHUB_TOKEN}');
  const cxText = await fs.readFile(at('codex'), 'utf8');
  assert.match(cxText, /# Codex/);
  assert.deepEqual((await read(at('codex'), 'toml')).mcp_servers['github-mcp'].env_vars, ['GITHUB_TOKEN']);

  const again = await installMcp({ home, catalogFile: file, id: 'io.github.acme/github-mcp', agents: ['cursor'], values: { GITHUB_TOKEN: 'ghp_saisi' } });
  assert.equal(again.installed.length, 0);
  assert.equal(again.skipped.length, 1, 'déjà présent : passé');
  const rep = await installMcp({ home, catalogFile: file, id: 'io.github.acme/github-mcp', agents: ['cursor'], values: { GITHUB_TOKEN: 'ghp_saisi' }, replace: true });
  assert.equal(rep.installed.length, 1);
  assert.equal(rep.backups.length, 1, 'version présente sauvegardée');
  assert.equal((await read(at('cursor'))).mcpServers['github-mcp'].env.GITHUB_TOKEN, 'ghp_saisi');
  assert.deepEqual(rep.warnings, [], 'secret saisi : rien à définir');
});

test('serveur retenu (motif à risque, faille connue) sauf force ; valeurs et entrées refusées', async (t) => {
  const { home, file, at } = await setup(t);
  const h = await installMcp({ home, catalogFile: file, id: 'io.github.x/risky', agents: ['cursor'] });
  assert.deepEqual(h.held, { verdict: 'rouge', vulns: [] });
  await assert.rejects(fs.stat(at('cursor')), 'rien écrit');
  const v = await installMcp({ home, catalogFile: file, id: 'io.github.x/vuln', agents: ['cursor'] });
  assert.deepEqual(v.held.vulns, ['GHSA-1']);
  const f = await installMcp({ home, catalogFile: file, id: 'io.github.x/vuln', agents: ['cursor'], force: true });
  assert.equal(f.installed.length, 1);
  await assert.rejects(installMcp({ home, catalogFile: file, id: 'absent', agents: ['cursor'] }), { code: 'NOT_FOUND' });
  await assert.rejects(installMcp({ home, catalogFile: file, id: 'com.vendor/remote', agents: [] }), { code: 'BAD_INPUT' });
  await assert.rejects(installMcp({ home, catalogFile: file, id: 'com.vendor/remote', agents: ['cursor'], values: { 'bad name': 'x' } }), { code: 'BAD_INPUT' });
  await assert.rejects(installMcp({ home, catalogFile: file, id: 'com.vendor/remote', agents: ['cursor'], values: { K: 'a\u0000b' } }), { code: 'BAD_INPUT' });
});
