// Pont vers le paquet skills : chaque appel, ou chaque session en deux temps, tourne dans un processus enfant
// lancé avec HOME et USERPROFILE égaux au dossier visé (le paquet fige HOME à l'import).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NAME_RE, childEnv, fail, homeOf } from './util.mjs';

const WORKER = fileURLToPath(new URL('./skills-worker.mjs', import.meta.url));
const MCP_WORKER = fileURLToPath(new URL('./mcp-worker.mjs', import.meta.url));
const OURS = new Set(['BAD_NAME', 'BAD_SOURCE', 'BAD_INPUT', 'NOT_FOUND', 'CLI_FAILED', 'GITHUB_LIMIT', 'NETWORK', 'SOURCE_NOT_FOUND', 'OUTSIDE_HOME',
  // Écritures MCP (mcp-worker.mjs).
  'EXISTS', 'UNSUPPORTED', 'WRITE_FAILED', 'BROKEN_CONFIG', 'CONFLICT']);

export const GITHUB_MESSAGE = 'GitHub limite les téléchargements anonymes. Réessayez dans une heure, ou installez git pour passer par lui.';
export const NETWORK_MESSAGE = 'Pas de connexion à la source. Vérifiez le réseau, puis réessayez.';
export const NOT_FOUND_MESSAGE = 'Dépôt introuvable ou privé. Il a peut-être été renommé ou retiré.';
export const CLI_MESSAGE = 'L’outil skills a échoué. Le détail est dans le terminal de Skill Advisor.';

const LIMIT_RE = /API rate limit exceeded|rate.?limit|\b429\b|secondary rate/i;
const NETWORK_RE = /Could not resolve host|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|Network is unreachable|Failed to connect|Connection (timed out|refused|reset)|Operation timed out|fetch failed|getaddrinfo|socket hang up|SSL_ERROR|SSL certificate problem|Could not connect/i;
// Signes forts d'une source absente ou privée (jamais « No such file » : un fichier local manquant n'est pas un dépôt absent).
const MISSING_RE = /Repository not found|repository '[^']*' not found|does not appear to be a git repository|Authentication failed|could not read Username|not found in upstream|couldn't find remote ref|returned error: 404|HTTP(?: error)? 404|status 404|No matching skills|No valid skills|No skills found/i;
const MISSING_CODES = new Set(['SKILLS_GIT_AUTH_FAILED', 'SKILLS_GIT_SAML_SSO_BLOCKED', 'SKILLS_NO_MATCHING_SKILLS', 'SKILLS_NO_VALID_SKILLS',
  'SKILLS_LOCAL_PATH_NOT_FOUND', 'SKILLS_WELLKNOWN_INDEX_NOT_FOUND', 'SKILLS_WELLKNOWN_SCOPE_NOT_FOUND', 'SKILLS_USE_NO_MATCHING_SKILL']);

// Traduit une erreur du paquet ou de la CLI en erreur du socle, par cause : limite GitHub, réseau, source introuvable, autre.
// Le texte brut reste dans detail (terminal du serveur), jamais dans message (page).
export function mapError(code, message, extra = {}) {
  const msg = String(message || '');
  const detail = msg.slice(0, 2000);
  const more = { detail, ...(code ? { skillsCode: code } : {}) };
  if (code === 'GITHUB_LIMIT' || ((/\b403\b/.test(msg) && /github|rate/i.test(msg)) || LIMIT_RE.test(msg))) return fail('GITHUB_LIMIT', GITHUB_MESSAGE, more);
  if (code === 'NETWORK' || code === 'SKILLS_GIT_CLONE_TIMEOUT' || code === 'SKILLS_NOTION_API_TIMEOUT') {
    return fail('NETWORK', code === 'NETWORK' && msg ? msg : 'La source n’a pas répondu à temps. Réessayez.', more);
  }
  if (code === 'SOURCE_NOT_FOUND') return fail('SOURCE_NOT_FOUND', msg || NOT_FOUND_MESSAGE, more);
  if (MISSING_CODES.has(code) || (code === 'SKILLS_DOWNLOAD_HTTP_ERROR' && /\b404\b/.test(msg)) || MISSING_RE.test(msg)) {
    return fail('SOURCE_NOT_FOUND', extra.notFound || NOT_FOUND_MESSAGE, more);
  }
  if (NETWORK_RE.test(msg)) return fail('NETWORK', NETWORK_MESSAGE, more);
  if (/timed out|Délai dépassé/i.test(msg)) return fail('NETWORK', 'La source n’a pas répondu à temps. Réessayez.', more);
  // Nos propres codes (validation dans l'enfant) : message déjà en français.
  if (OURS.has(code) && code !== 'CLI_FAILED') return fail(code, msg, more);
  return fail('CLI_FAILED', CLI_MESSAGE, more);
}

// Noms valides signalés par « skills check » (« ↑ <nom> has an update »).
export function parseOutdated(text) {
  const clean = String(text || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  const names = [];
  for (const m of clean.matchAll(/↑\s+(\S+)\s+has an update/g)) if (NAME_RE.test(m[1]) && !names.includes(m[1])) names.push(m[1]);
  return names;
}

// Ouvre un processus enfant qui garde le paquet chargé : une requête { fn, args } par ligne, une réponse par ligne.
// Rend { request(fn, args, { timeoutMs }), close() }. Un délai dépassé tue l'enfant et fait échouer la session.
export function session(opts = {}) {
  const home = homeOf(opts);
  // opts.worker === 'mcp' : processus enfant d'add-mcp (serveurs MCP) au lieu du paquet skills.
  const child = spawn(process.execPath, [opts.worker === 'mcp' ? MCP_WORKER : WORKER], { cwd: opts.cwd || home, env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', stderr = '', dead = null;
  // Décodage UTF-8 d'un seul tenant : un caractère accentué peut tomber entre deux morceaux.
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const waiting = [];
  const settle = (err, val) => { const w = waiting.shift(); if (!w) return; clearTimeout(w.timer); err ? w.reject(err) : w.resolve(val); };
  const die = (err) => { if (dead) return; dead = err; while (waiting.length) settle(err); };
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { settle(fail('CLI_FAILED', CLI_MESSAGE, { detail: line.slice(0, 2000) })); continue; }
      if (msg.ok) settle(null, msg.result);
      else settle(mapError(msg.error && msg.error.code, msg.error && msg.error.message));
    }
  });
  child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 1e6) stderr = stderr.slice(-5e5); });
  child.on('error', () => die(fail('CLI_FAILED', 'Impossible de lancer Node pour l’outil skills.')));
  child.on('close', (code) => die(fail('CLI_FAILED', CLI_MESSAGE, { detail: ('Fin du processus (code ' + code + ') ' + stderr).slice(-2000) })));
  child.stdin.on('error', () => { /* enfant déjà fini */ });
  const kill = () => {
    try { child.kill('SIGTERM'); } catch { /* fini */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* fini */ } }, 2000).unref();
  };
  return {
    request(fn, args = [], o = {}) {
      if (dead) return Promise.reject(dead);
      const timeoutMs = o.timeoutMs || opts.timeoutMs || 120000;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const e = fail('NETWORK', 'La source n’a pas répondu en ' + Math.round(timeoutMs / 1000) + ' s. Réessayez.', { detail: 'délai dépassé : ' + fn });
          die(e);
          kill();
        }, timeoutMs);
        waiting.push({ resolve, reject, timer });
        child.stdin.write(JSON.stringify({ fn, args }) + '\n');
      });
    },
    // Ferme l'entrée : l'enfant libère la source résolue puis s'arrête.
    close() {
      return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const t = setTimeout(() => { kill(); resolve(); }, 15000);
        child.once('close', () => { clearTimeout(t); resolve(); });
        child.stdin.end();
      });
    },
  };
}

// Lance une fonction du paquet dans un enfant et rend son résultat JSON.
export async function call(fn, args = [], opts = {}) {
  const timeoutMs = opts.timeoutMs || 120000;
  const s = session(opts);
  try {
    return await s.request(fn, args, { timeoutMs });
  } catch (e) {
    // Délai dépassé d'un appel local : pas une affaire de réseau.
    if (e.code === 'NETWORK' && /^délai dépassé/.test(e.detail || '') && fn !== 'cli') {
      throw fail('CLI_FAILED', 'Délai dépassé (' + Math.round(timeoutMs / 1000) + ' s) pour ' + fn + '.');
    }
    throw e;
  } finally {
    await s.close();
  }
}

// Lance la CLI du paquet (commande check, absente de l'API).
export async function cli(args, opts = {}) {
  const timeoutMs = opts.timeoutMs || 120000;
  return call('cli', [args, { cwd: opts.cwd || homeOf(opts), timeoutMs: Math.max(1000, timeoutMs - 5000) }], { ...opts, timeoutMs });
}
