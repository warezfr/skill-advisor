// Processus enfant : importe le paquet skills avec HOME déjà fixé par le parent.
// Lit { fn, args } sur l'entrée standard, écrit une ligne JSON de résultat sur la sortie standard.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Le paquet ne doit rien écrire sur la sortie réservée au résultat.
const out = process.stdout.write.bind(process.stdout);
console.log = console.info = console.warn = console.debug = (...a) => process.stderr.write(a.join(' ') + '\n');

const CLI = fileURLToPath(import.meta.resolve('skills/bin/cli.mjs'));
let grandchild = null;

process.on('SIGTERM', () => {
  if (grandchild) try { grandchild.kill('SIGKILL'); } catch { /* déjà fini */ }
  process.exit(143);
});

// Lance la CLI du paquet, sans shell, avec l'environnement déjà filtré par le parent.
function cli(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: opts.cwd || process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    grandchild = child;
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Object.assign(new Error('Délai dépassé pour la commande skills ' + args[0] + '.'), { code: 'CLI_FAILED' })); }, opts.timeoutMs || 110000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); grandchild = null; resolve({ code, stdout, stderr }); });
  });
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { fn, args = [] } = JSON.parse(input);
  const s = await import('skills');
  const fns = {
    getSupportedAgents: () => s.getSupportedAgents(),
    detectAgents: (o = {}) => s.detectAgents(o),
    listSkills: (o = {}) => s.listSkills(o),
    installSkills: (source, o = {}) => s.installSkills(source, { ...o, telemetry: false }),
    removeSkills: (names, o = {}) => s.removeSkills(names, { ...o, telemetry: false }),
    cli,
    // Un seul processus pour l'inventaire : agents connus, détectés et skills installés.
    snapshot: async (o = {}) => ({
      supported: s.getSupportedAgents(),
      detected: (await s.detectAgents({ cwd: o.cwd })).agents.map((a) => a.id),
      skills: (await s.listSkills({ cwd: o.cwd, scope: o.scope || 'global' })).skills,
    }),
  };
  if (!Object.hasOwn(fns, fn)) throw Object.assign(new Error('Fonction inconnue : ' + fn), { code: 'CLI_FAILED' });
  return fns[fn](...args);
}

main().then(
  (result) => out(JSON.stringify({ ok: true, result: result === undefined ? null : result }) + '\n', () => process.exit(0)),
  (e) => out(JSON.stringify({ ok: false, error: { code: e && e.code, message: String((e && e.message) || e) } }) + '\n', () => process.exit(0)),
);
