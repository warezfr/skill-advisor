// Lance les suites de tests, sans shell (npm passe par cmd.exe sous Windows : pas de chaîne &&).
// Usage : node test/run-all.mjs            tout, sans réseau
//         node test/run-all.mjs --e2e      bout à bout dans Chrome sans fenêtre (test/e2e)
//         node test/run-all.mjs --net      tests réseau (SA_NET=1)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_TEST = path.join('app', 'test', 'dist.test.mjs');
// Suites d'interface : scripts autonomes, dans cet ordre.
const UI = ['smoke', 'live', 'agents', 'backups-ui', 'conseil', 'shell'].map((n) => path.join('prototype', 'test', n + '.mjs'));

// Fichiers *.test.mjs d'un dossier, triés : chemins explicites, valables sous Node 22 comme 26.
function testFiles(dir, pattern = /\.test\.mjs$/) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => pattern.test(f)).sort().map((f) => path.join(dir, f));
}

// Environnement des tests : ni réseau ni catalogue en ligne, sauf demande explicite.
function env(net) {
  const e = { ...process.env };
  delete e.SA_NET;
  delete e.CATALOG_URL;
  if (net) e.SA_NET = '1';
  return e;
}

const steps = [];
function run(label, args, net = false) {
  const t0 = Date.now();
  console.log('\n=== ' + label + ' ===');
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: env(net) });
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = r.status === 0;
  steps.push({ label, ok, s, why: r.error ? r.error.message : r.signal ? 'signal ' + r.signal : 'code ' + r.status });
  return ok;
}

const mode = process.argv[2] || '';
if (mode && !['--e2e', '--net'].includes(mode)) {
  console.error('Usage : node test/run-all.mjs [--e2e | --net]');
  process.exit(2);
}

if (mode === '--e2e') {
  run('bout à bout (test/e2e)', ['test/e2e/run.mjs']);
} else if (mode === '--net') {
  run('tests réseau (SA_NET=1)', ['--test', ...testFiles('app/test'), ...testFiles('tools/test')], true);
} else {
  const unit = [...testFiles('app/test'), ...testFiles('tools/test')].filter((f) => f !== DIST_TEST);
  run('node --test app/test tools/test', ['--test', ...unit]);
  for (const f of UI) run(f.split(path.sep).join('/'), [f]);
  run('prototype/dist à jour', ['--test', DIST_TEST]);
}

console.log('\n=== Bilan ===');
for (const s of steps) console.log((s.ok ? 'réussi ' : 'ÉCHEC  ') + s.label + ' (' + s.s + ' s' + (s.ok ? '' : ', ' + s.why) + ')');
process.exit(steps.every((s) => s.ok) ? 0 : 1);
