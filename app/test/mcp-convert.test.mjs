// Conversion des entrées MCP : secrets remplacés par des variables, syntaxe de chaque agent, forme commune.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub, toCanonical, refName, renderRef, knowsVars, varOf, codexEnvVars } from '../lib/mcp-convert.mjs';

test('références de variables : lecture de toutes les formes, écriture dans la forme de l’agent', () => {
  for (const [v, n] of [['${A}', 'A'], ['${env:B}', 'B'], ['{env:C}', 'C'], ['$D', 'D'], ['%E%', 'E'], ['${F:-x}', 'F']]) assert.equal(refName(v), n, v);
  assert.equal(refName('plain'), null);
  assert.equal(renderRef('claude-code', 'K'), '${K}');
  assert.equal(renderRef('cursor', 'K'), '${env:K}');
  assert.equal(renderRef('opencode', 'K'), '{env:K}');
  assert.equal(renderRef('codex', 'K'), '${K}');
  assert.equal(knowsVars('codex'), false);
  assert.equal(varOf('--api-key'), 'API_KEY');
});

test('scrub : env, en-têtes, arguments et adresse ; références gardées ; copie, original intact', () => {
  const entry = {
    command: 'npx',
    args: ['-y', 'srv', '--api-key', 'abc', '--token=xyz', 'ghp_abcdefghijklmnopqrstuvwx', '--port', '3000', '--key', '${KEEP}', 'postgres://u:p4ss@db/app?sslmode=require&password=q'],
    env: { GITHUB_TOKEN: 'ghp_x', HOME_DIR: '/home/a', REF: '${REF}' },
    headers: { Authorization: 'Bearer s3cr3t', 'X-Api-Key': 'k', 'Content-Type': 'application/json' },
    url: 'https://h.example/mcp?api_key=zz&region=eu',
  };
  const before = structuredClone(entry);
  const { entry: out, vars } = scrub(entry, 'cursor');
  assert.deepEqual(entry, before, 'original intact');
  assert.deepEqual(out.args, ['-y', 'srv', '--api-key', '${env:API_KEY}', '--token=${env:TOKEN}', '${env:MCP_TOKEN}', '--port', '3000', '--key', '${KEEP}',
    'postgres://u:${env:MCP_PASSWORD}@db/app?sslmode=require&password=${env:PASSWORD}']);
  assert.deepEqual(out.env, { GITHUB_TOKEN: '${env:GITHUB_TOKEN}', HOME_DIR: '${env:HOME_DIR}', REF: '${REF}' });
  assert.deepEqual(out.headers, { Authorization: 'Bearer ${env:MCP_TOKEN}', 'X-Api-Key': '${env:X_API_KEY}', 'Content-Type': 'application/json' });
  assert.equal(out.url, 'https://h.example/mcp?api_key=${env:API_KEY}&region=eu');
  assert.deepEqual(vars, ['API_KEY', 'GITHUB_TOKEN', 'HOME_DIR', 'MCP_PASSWORD', 'MCP_TOKEN', 'PASSWORD', 'TOKEN', 'X_API_KEY']);
  const json = JSON.stringify(out);
  for (const s of ['abc', 'xyz', 'ghp_', 'p4ss', 's3cr3t', '"k"', 'zz', '=q']) assert.ok(!json.includes(s), 'secret retiré : ' + s);
});

test('toCanonical : stdio et distant, formes d’agents variées, variables déplacées vers la syntaxe visée', () => {
  const a = toCanonical({ command: 'npx', args: ['-y', 'srv'], env: { T: '${env:T}' } }, 'claude-code');
  assert.deepEqual(a.config, { command: 'npx', args: ['-y', 'srv'], env: { T: '${T}' } });
  assert.deepEqual(a.vars, ['T']);
  assert.deepEqual(a.warnings, []);
  const b = toCanonical({ type: 'local', command: ['bun', 'x', 'srv'], environment: { K: '{env:K}' } }, 'cursor');
  assert.deepEqual(b.config, { command: 'bun', args: ['x', 'srv'], env: { K: '${env:K}' } });
  const c = toCanonical({ cmd: 'uvx', args: ['f'], envs: { A: '1' } }, 'opencode');
  assert.deepEqual(c.config, { command: 'uvx', args: ['f'], env: { A: '1' } });
  const d = toCanonical({ serverUrl: 'https://h/mcp', headers: { Authorization: 'Bearer ${TOK}' } }, 'vscode');
  assert.deepEqual(d.config, { type: 'http', url: 'https://h/mcp', headers: { Authorization: 'Bearer ${env:TOK}' } });
  const e = toCanonical({ url: 'https://h/sse', type: 'sse' }, 'claude-code');
  assert.equal(e.config.type, 'sse');
  const f = toCanonical({ httpUrl: 'https://h/mcp' }, 'codex');
  assert.deepEqual(f.config, { type: 'http', url: 'https://h/mcp' });
  const g = toCanonical({ command: 'x', env: { K: '${OTHER}' } }, 'codex');
  assert.match(g.warnings[0], /pas documentée/);
  const h = toCanonical({ description: 'rien' }, 'cursor');
  assert.equal(h.config, null);
});

test('Codex : les variables de même nom passent dans env_vars, sans avertissement', () => {
  const e = codexEnvVars({ command: 'npx', env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', OTHER: '${X}', PLAIN: 'v' } });
  assert.deepEqual(e, { command: 'npx', env: { OTHER: '${X}', PLAIN: 'v' }, env_vars: ['GITHUB_TOKEN'] });
  assert.deepEqual(codexEnvVars({ command: 'x', env: { A: '${A}' } }), { command: 'x', env_vars: ['A'] });
  const c = toCanonical({ command: 'npx', env: { GITHUB_TOKEN: '${env:GITHUB_TOKEN}' } }, 'codex');
  assert.deepEqual(c.warnings, [], 'variable de même nom : rien à vérifier');
  assert.equal(toCanonical({ command: 'npx', env: { A: '${B}' } }, 'codex').warnings.length, 1);
});
