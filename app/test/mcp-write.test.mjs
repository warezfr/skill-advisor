// Écriture des réglages MCP : une entrée posée ou retirée, le reste du fichier (commentaires compris) intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeHome, rmHome, listTree } from './helpers.mjs';
import { editEntry, parseStrict, writeEntry, readEntry, canon, copiesDir } from '../lib/mcp-write.mjs';

const eqParsed = (format, a, b, msg) => assert.deepEqual(canon(parseStrict(format, a)), canon(parseStrict(format, b)), msg);

// Retirer puis remettre l'entrée lue : le fichier analysé redevient exactement l'original.
function roundTrip(format, text, keyPath, name) {
  const entry = parseStrict(format, text);
  const raw = [...keyPath, name].reduce((o, k) => o[k], entry);
  const removed = editEntry(format, text, keyPath, name, undefined);
  assert.equal(removed.lossy, false, format + ' : retrait sans réécriture complète');
  const back = editEntry(format, removed.text, keyPath, name, raw);
  assert.equal(back.lossy, false, format + ' : remise sans réécriture complète');
  eqParsed(format, back.text, text, format + ' : aller-retour exact');
  return { removed: removed.text, back: back.text };
}

const CLAUDE = `{
  "numStartups": 12,
  "projects": { "/w/app": { "allowedTools": ["Bash"], "mcpServers": { "inner": { "command": "x" } } } },
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "T": "s3cr3t" } },
    "fetch": { "command": "uvx", "args": ["mcp-server-fetch"] }
  },
  "theme": "dark"
}
`;

test('JSON : retrait et remise exacts, autres clés intactes, clé imbriquée homonyme non touchée', () => {
  const { removed } = roundTrip('json', CLAUDE, ['mcpServers'], 'github');
  const r = parseStrict('json', removed);
  assert.deepEqual(Object.keys(r.mcpServers), ['fetch']);
  assert.equal(r.numStartups, 12);
  assert.equal(r.projects['/w/app'].mcpServers.inner.command, 'x');
});

test('JSONC : commentaires et virgule finale gardés', () => {
  const text = '{\n  // réglages OpenCode\n  "$schema": "https://opencode.ai/config.json",\n  "mcp": {\n    "a": { "type": "local", "command": ["npx", "a"] }, // premier\n    "b": { "type": "remote", "url": "https://h/mcp" },\n  },\n}\n';
  const { removed, back } = roundTrip('json', text, ['mcp'], 'a');
  assert.match(removed, /\/\/ réglages OpenCode/);
  assert.match(back, /\/\/ réglages OpenCode/);
});

test('JSON : indentation par tabulations et fins de ligne CRLF gardées', () => {
  const text = '{\r\n\t"mcpServers": {\r\n\t\t"a": { "command": "x" }\r\n\t}\r\n}\r\n';
  const out = editEntry('json', text, ['mcpServers'], 'b', { command: 'y' }).text;
  assert.ok(out.includes('\r\n') && !/[^\r]\n/.test(out), 'CRLF gardé');
  assert.match(out, /\n\t\t"b"/);
});

const CODEX = `# Réglages de Codex
model = "gpt-5"

[mcp_servers.fetch]
command = "uvx"
args = ["mcp-server-fetch"]

[mcp_servers.fetch.env]
TOKEN = "abc" # jeton

[mcp_servers."my server"]
command = "node"

# profil de travail
[profiles.work]
model = "o4"
`;

test('TOML : tables et sous-tables retirées au texte, commentaires et autres tables gardés', () => {
  const { removed, back } = roundTrip('toml', CODEX, ['mcp_servers'], 'fetch');
  assert.match(removed, /# Réglages de Codex/);
  assert.match(removed, /# profil de travail/);
  assert.ok(!/fetch|TOKEN/.test(removed), 'plus de trace de fetch');
  assert.deepEqual(Object.keys(parseStrict('toml', removed).mcp_servers), ['my server']);
  assert.match(back, /# profil de travail/);
  roundTrip('toml', CODEX, ['mcp_servers'], 'my server');
});

test('TOML : pose dans un fichier vide et dans un fichier sans table mcp_servers', () => {
  const a = editEntry('toml', '', ['mcp_servers'], 'x', { command: 'npx', args: ['-y', 'x'], env: { K: '${K}' } });
  assert.equal(a.lossy, false);
  assert.deepEqual(parseStrict('toml', a.text), { mcp_servers: { x: { command: 'npx', args: ['-y', 'x'], env: { K: '${K}' } } } });
  const b = editEntry('toml', 'model = "m" # garde\n', ['mcp_servers'], 'x', { command: 'npx' });
  assert.match(b.text, /# garde/);
  assert.equal(parseStrict('toml', b.text).model, 'm');
});

const GOOSE = `# Goose
GOOSE_PROVIDER: openai
extensions:
  # outil de fichiers
  files:
    type: stdio
    cmd: npx
    args: [-y, "@modelcontextprotocol/server-filesystem"]
    enabled: true
  web:
    type: streamable_http
    uri: https://h/mcp
`;

test('YAML : retrait et remise exacts, commentaires gardés (1.2 et 1.1)', () => {
  const { removed } = roundTrip('yaml', GOOSE, ['extensions'], 'files');
  assert.match(removed, /# Goose/);
  assert.equal(parseStrict('yaml', removed).GOOSE_PROVIDER, 'openai');
  roundTrip('yaml-1.1', 'mcp_servers:\n  a:\n    command: x\n    enabled: on\n', ['mcp_servers'], 'a');
});

test('édition : entrée absente, entrée existante, fichier mal formé', () => {
  assert.throws(() => editEntry('json', CLAUDE, ['mcpServers'], 'absent', undefined), { code: 'NOT_FOUND' });
  assert.throws(() => editEntry('json', CLAUDE, ['mcpServers'], 'fetch', { command: 'z' }), { code: 'EXISTS' });
  assert.equal(parseStrict('json', editEntry('json', CLAUDE, ['mcpServers'], 'fetch', { command: 'z' }, { replace: true }).text).mcpServers.fetch.command, 'z');
  assert.throws(() => editEntry('json', '{ "mcpServers": { ', ['mcpServers'], 'x', { command: 'y' }), { code: 'BROKEN_CONFIG' });
  assert.throws(() => editEntry('toml', '[mcp_servers\n', ['mcp_servers'], 'x', { command: 'y' }), { code: 'BROKEN_CONFIG' });
  assert.throws(() => editEntry('yaml', 'a: [\n', ['extensions'], 'x', { cmd: 'y' }), { code: 'BROKEN_CONFIG' });
  assert.throws(() => editEntry('json', '[]', ['mcpServers'], 'x', { command: 'y' }), { code: 'BROKEN_CONFIG' });
});

test('clé à la racine (configKey vide) et clé pointée', () => {
  const a = editEntry('json', '{ "x": { "command": "a" } }', [], 'y', { command: 'b' });
  assert.deepEqual(Object.keys(parseStrict('json', a.text)), ['x', 'y']);
  const b = editEntry('json', '{}', ['mcp', 'servers'], 'y', { command: 'b' });
  assert.equal(parseStrict('json', b.text).mcp.servers.y.command, 'b');
});

test('écriture : copie préalable privée, fichier remplacé, lien suivi jusqu’à sa cible', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const file = path.join(home, '.cursor', 'mcp.json');
  await fs.writeFile(file, CLAUDE);
  const r = await writeEntry({ home, file, format: 'json', keyPath: ['mcpServers'], name: 'github', value: undefined });
  assert.equal(r.path, await fs.realpath(file));
  assert.deepEqual(Object.keys(parseStrict('json', await fs.readFile(file, 'utf8')).mcpServers), ['fetch']);
  assert.equal(await fs.readFile(r.copy, 'utf8'), CLAUDE, 'copie de l’état d’avant');
  if (process.platform !== 'win32') assert.equal((await fs.stat(r.copy)).mode & 0o777, 0o600);
  assert.ok((await listTree(path.dirname(file))).every((f) => !f.endsWith('.tmp')), 'aucun fichier temporaire');
  assert.deepEqual(await readEntry(file, 'json', ['mcpServers'], 'fetch'), { command: 'uvx', args: ['mcp-server-fetch'] });

  if (process.platform !== 'win32') {
    const real = path.join(home, 'dotfiles', 'claude.json');
    await fs.mkdir(path.dirname(real));
    await fs.writeFile(real, CLAUDE);
    const link = path.join(home, '.claude.json');
    await fs.symlink(real, link);
    await writeEntry({ home, file: link, format: 'json', keyPath: ['mcpServers'], name: 'fetch', value: undefined });
    assert.ok((await fs.lstat(link)).isSymbolicLink(), 'le lien reste un lien');
    assert.deepEqual(Object.keys(parseStrict('json', await fs.readFile(real, 'utf8')).mcpServers), ['github']);
  }
});

test('écriture : fichier changé pendant l’opération, rien n’est remplacé (CONFLICT)', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const file = path.join(home, '.claude.json');
  await fs.writeFile(file, CLAUDE);
  const other = CLAUDE.replace('"theme": "dark"', '"theme": "light"');
  await assert.rejects(writeEntry({ home, file, format: 'json', keyPath: ['mcpServers'], name: 'github', value: undefined,
    beforeCommit: (p) => fs.writeFile(p, other) }), { code: 'CONFLICT' });
  assert.equal(await fs.readFile(file, 'utf8'), other, 'l’écriture de l’agent est gardée');
  assert.ok((await listTree(home)).every((f) => !f.endsWith('.tmp')));
});

test('écriture : fichier mal formé jamais touché, copie non créée', async (t) => {
  const home = await makeHome();
  t.after(() => rmHome(home));
  const file = path.join(home, '.cursor', 'mcp.json');
  const broken = '{ "mcpServers": { "x": { "command": "y" ';
  await fs.writeFile(file, broken);
  await assert.rejects(writeEntry({ home, file, format: 'json', keyPath: ['mcpServers'], name: 'x', value: undefined }), { code: 'BROKEN_CONFIG' });
  assert.equal(await fs.readFile(file, 'utf8'), broken);
  await assert.rejects(fs.stat(copiesDir(home)));
});

test('TOML : entrée en table en ligne, réécriture complète signalée (lossy) et vérifiée', () => {
  const text = '# haut\n[mcp_servers]\nfetch = { command = "uvx", args = ["a"] }\nother = { command = "x" }\n';
  const r = editEntry('toml', text, ['mcp_servers'], 'fetch', undefined);
  assert.equal(r.lossy, true);
  assert.deepEqual(parseStrict('toml', r.text), { mcp_servers: { other: { command: 'x' } } });
});
