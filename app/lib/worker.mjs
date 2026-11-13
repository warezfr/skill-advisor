// Pont vers le paquet skills : chaque appel tourne dans un processus enfant
// lancé avec HOME et USERPROFILE égaux au dossier visé (le paquet fige HOME à l'import).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NAME_RE, childEnv, fail, homeOf } from './util.mjs';

const WORKER = fileURLToPath(new URL('./skills-worker.mjs', import.meta.url));
const OURS = new Set(['BAD_NAME', 'BAD_SOURCE', 'NOT_FOUND', 'CLI_FAILED', 'GITHUB_LIMIT', 'OUTSIDE_HOME']);

export const GITHUB_MESSAGE = 'GitHub limite les téléchargements anonymes. Réessayez plus tard, ou installez git : le téléchargement passe alors par git et évite cette limite.';

// Traduit une erreur du paquet ou de la CLI en erreur du socle.
export function mapError(code, message) {
  const msg = String(message || '');
  if (code === 'SKILLS_GIT_CLONE_FAILED' || msg.includes('[SKILLS_GIT_CLONE_FAILED]') || msg.includes('SKILLS_GIT_CLONE_FAILED')
    || (/\b(403|429)\b/.test(msg) && /github|rate.?limit/i.test(msg)) || /API rate limit exceeded/i.test(msg)) {
    return fail('GITHUB_LIMIT', GITHUB_MESSAGE, { detail: msg.slice(0, 2000) });
  }
  if (OURS.has(code)) return fail(code, msg);
  return fail('CLI_FAILED', 'L’outil skills a échoué : ' + msg.slice(0, 500), { detail: msg.slice(0, 2000), skillsCode: code });
}

// Noms valides signalés par « skills check » (« ↑ <nom> has an update »).
export function parseOutdated(text) {
  const clean = String(text || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  const names = [];
  for (const m of clean.matchAll(/↑\s+(\S+)\s+has an update/g)) if (NAME_RE.test(m[1]) && !names.includes(m[1])) names.push(m[1]);
  return names;
}

// Lance une fonction du paquet dans un enfant et rend son résultat JSON.
export function call(fn, args = [], opts = {}) {
  const home = homeOf(opts);
  const timeoutMs = opts.timeoutMs || 120000;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER], { cwd: opts.cwd || home, env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* fini */ } }, 2000).unref();
      finish(fail('CLI_FAILED', 'Délai dépassé (' + Math.round(timeoutMs / 1000) + ' s) pour ' + fn + '.'));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 1e6) stderr = stderr.slice(-5e5); });
    child.on('error', (e) => finish(fail('CLI_FAILED', 'Impossible de lancer Node : ' + e.message)));
    child.on('close', (code) => {
      const line = stdout.trim().split('\n').pop();
      let msg;
      try { msg = JSON.parse(line); } catch {
        return finish(fail('CLI_FAILED', 'Réponse illisible de l’outil skills (code ' + code + ').', { detail: stderr.slice(-2000) }));
      }
      if (msg.ok) return finish(null, msg.result);
      finish(mapError(msg.error && msg.error.code, msg.error && msg.error.message));
    });
    child.stdin.on('error', () => { /* enfant déjà fini */ });
    child.stdin.end(JSON.stringify({ fn, args }));
  });
}

// Lance la CLI du paquet (commandes update et check, absentes de l'API).
export async function cli(args, opts = {}) {
  const timeoutMs = opts.timeoutMs || 120000;
  return call('cli', [args, { cwd: opts.cwd || homeOf(opts), timeoutMs: Math.max(1000, timeoutMs - 5000) }], { ...opts, timeoutMs });
}
