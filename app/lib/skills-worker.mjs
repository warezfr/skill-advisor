// Processus enfant : importe le paquet skills avec HOME déjà fixé par le parent.
// Lit une requête { fn, args } par ligne sur l'entrée standard, écrit une ligne JSON par réponse sur la sortie standard.
// Une session garde une source résolue (resolve, stage, install) jusqu'à la fin de l'entrée.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// Le paquet ne doit rien écrire sur la sortie réservée aux réponses.
const out = process.stdout.write.bind(process.stdout);
console.log = console.info = console.warn = console.debug = (...a) => process.stderr.write(a.join(' ') + '\n');

const CLI = fileURLToPath(import.meta.resolve('skills/bin/cli.mjs'));
let grandchild = null;
let handle = null;

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

// Texte d'une erreur du paquet, avec celui de sa cause (sortie de git, par exemple).
function errText(e) {
  const parts = [String((e && e.message) || e)];
  for (let c = e && e.cause, n = 0; c && n < 3; c = c.cause, n++) if (c.message && !parts.includes(c.message)) parts.push(String(c.message));
  return parts.join('\n');
}
const brief = (e) => ({ code: e && e.code, message: errText(e) });

let s = null;
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
  // Session : résout la source une fois (dossier temporaire du paquet), sans rien installer.
  // Skills internes compris ; recherche profonde quand un nom demandé manque.
  resolve: async (source, o = {}) => {
    if (handle) { await handle.dispose(); handle = null; }
    const want = Array.isArray(o.names) ? o.names : [];
    const opt = { includeInternal: true, ...(o.ref ? { ref: o.ref } : {}) };
    handle = await s.resolveSource(source, opt);
    const has = (n) => handle.skills.some((k) => k.name === n || k.name.toLowerCase() === n.toLowerCase());
    if (want.some((n) => !has(n))) {
      const deep = await s.resolveSource(source, { ...opt, fullDepth: true }).catch(() => null);
      if (deep && deep.skills.length >= handle.skills.length) { await handle.dispose(); handle = deep; } else if (deep) await deep.dispose();
    }
    return { source: handle.source, skills: handle.skills.map((k) => ({ name: k.name, description: k.description, path: k.path || null })) };
  },
  // Pose chaque skill demandé, en copie, dans <dir>/.agents/skills : contenu exact que le paquet installerait.
  stage: async (o = {}) => {
    const res = [];
    for (const name of o.names || []) {
      try {
        const r = await s.installSkills(handle, { skills: [name], scope: 'project', cwd: o.dir, agents: ['universal'], mode: 'copy', lockfile: false, telemetry: false });
        const t = r.installed[0];
        if (t) res.push({ name, skill: t.skill, path: t.path });
        else res.push({ name, error: r.failed[0] ? { code: r.failed[0].code, message: r.failed[0].message } : { code: 'CLI_FAILED', message: 'stage vide' } });
      } catch (e) { res.push({ name, error: brief(e) }); }
    }
    return res;
  },
  // Installe depuis la source déjà résolue (aucun nouveau téléchargement).
  install: (o = {}) => s.installSkills(handle, { ...o, telemetry: false }),
  dispose: async () => { if (handle) { await handle.dispose(); handle = null; } return null; },
};

const send = (obj) => new Promise((resolve) => out(JSON.stringify(obj) + '\n', resolve));

async function main() {
  s = await import('skills');
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let req;
    try { req = JSON.parse(line); } catch { await send({ ok: false, error: { code: 'CLI_FAILED', message: 'Requête illisible.' } }); continue; }
    const { fn, args = [] } = req;
    try {
      if (!Object.hasOwn(fns, fn)) throw Object.assign(new Error('Fonction inconnue : ' + fn), { code: 'CLI_FAILED' });
      const result = await fns[fn](...args);
      await send({ ok: true, result: result === undefined ? null : result });
    } catch (e) {
      await send({ ok: false, error: brief(e) });
    }
  }
  if (handle) await handle.dispose().catch(() => {});
}

main().then(() => process.exit(0), async (e) => { await send({ ok: false, error: brief(e) }); process.exit(0); });
