// Conversion des entrées de serveurs MCP d'un agent à l'autre, et retrait des secrets pour les sauvegardes.
// Chaque agent écrit ses références de variables à sa façon : ${NOM} (Claude Code), ${env:NOM} (Cursor, VS Code),
// {env:NOM} (OpenCode, Kilo). Pour les autres, la forme n'est pas documentée : ${NOM}, avec un avertissement.
import { isRef } from './mcp-mask.mjs';

// Syntaxe documentée des références de variables, par identifiant add-mcp.
const SYNTAX = {
  'claude-code': 'dollar', 'github-copilot-cli': 'dollar', 'gemini-cli': 'dollar', 'kiro-cli': 'dollar',
  cursor: 'env', vscode: 'env', windsurf: 'env',
  opencode: 'brace', 'kilo-code': 'brace',
};
const RENDER = { dollar: (n) => '${' + n + '}', env: (n) => '${env:' + n + '}', brace: (n) => '{env:' + n + '}' };

// Agent dont la forme des variables est connue.
export const knowsVars = (mcpId) => Object.hasOwn(SYNTAX, mcpId);
export const renderRef = (mcpId, name) => RENDER[SYNTAX[mcpId] || 'dollar'](name);

// Nom de la variable d'une référence (${NOM}, ${env:NOM}, {env:NOM}, $NOM, %NOM%, ${NOM:-défaut}), sinon null.
export function refName(v) {
  if (!isRef(v)) return null;
  const m = /^\$\{(?:env:)?([A-Za-z_]\w*)(?::-[^}]*)?\}$|^\{env:([A-Za-z_]\w*)\}$|^\$([A-Za-z_]\w*)$|^%([A-Za-z_]\w*)%$/.exec(v.trim());
  return m ? m[1] || m[2] || m[3] || m[4] : null;
}

// Nom de variable tiré d'un nom de clé (en-tête, drapeau, paramètre) : MAJUSCULES, chiffres et _.
export const varOf = (k) => String(k).replace(/^-+/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'SECRET';

const SECRET_KEY = /(key|token|secret|passw|pwd|auth|bearer|credential|cookie|session|private|signature)|^(pat|dsn|sig)$/i;
const TOKEN_LIKE = /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|sk-[\w-]{16,}|xox[abpr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+)$/;
const ENV_KEYS = ['env', 'envs', 'environment', 'env_vars'];
const HEADER_KEYS = ['headers', 'http_headers'];
const URL_KEYS = ['url', 'httpUrl', 'serverUrl', 'uri'];
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

// Remplace chaque valeur secrète d'une entrée native par une référence de variable, dans la syntaxe de l'agent.
// Rend { entry, vars } : entry est une copie, vars les noms de variables à définir.
export function scrub(entry, mcpId) {
  const out = structuredClone(entry);
  const vars = new Set();
  const ref = (n) => { vars.add(n); return renderRef(mcpId, n); };
  const swap = (v, n) => (typeof v !== 'string' || !v || isRef(v) ? v : ref(n));
  for (const k of ENV_KEYS) {
    const o = asObj(out[k]);
    if (o) for (const [n, v] of Object.entries(o)) o[n] = swap(v, varOf(n));
  }
  for (const k of HEADER_KEYS) {
    const o = asObj(out[k]);
    if (!o) continue;
    for (const [n, v] of Object.entries(o)) {
      if (/^(content-type|accept|user-agent)$/i.test(n) || typeof v !== 'string' || isRef(v)) continue;
      const m = /^(Bearer|Basic|Token)\s+(.+)$/i.exec(v);
      o[n] = m && !isRef(m[2]) ? m[1] + ' ' + ref(varOf(n === 'Authorization' ? 'MCP_TOKEN' : n)) : ref(varOf(n));
    }
  }
  if (Array.isArray(out.args)) out.args = scrubArgs(out.args, ref);
  if (Array.isArray(out.command)) out.command = scrubArgs(out.command, ref);
  for (const k of URL_KEYS) if (typeof out[k] === 'string') out[k] = scrubUrl(out[k], ref);
  return { entry: out, vars: [...vars].sort() };
}

function scrubArgs(args, ref) {
  const res = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    const m = /^(--?[\w.-]+|[A-Za-z_]\w*)=(.*)$/s.exec(a);
    if (m && SECRET_KEY.test(m[1].replace(/^-+/, '')) && !isRef(m[2])) { res.push(m[1] + '=' + ref(varOf(m[1]))); continue; }
    if (TOKEN_LIKE.test(a)) { res.push(ref('MCP_TOKEN')); continue; }
    if (/^[a-z][\w+.-]*:\/\/\S+$/i.test(a)) { res.push(scrubUrl(a, ref)); continue; }
    res.push(a);
    if (/^--?[\w.-]+$/.test(a) && SECRET_KEY.test(a.replace(/^-+/, '')) && i + 1 < args.length && !String(args[i + 1]).startsWith('-') && !isRef(String(args[i + 1]))) {
      res.push(ref(varOf(a))); i++;
    }
  }
  return res;
}

// Adresse : mot de passe et paramètres sensibles remplacés par des variables (le reste de l'adresse est gardé tel quel).
function scrubUrl(u, ref) {
  let url;
  try { url = new URL(u); } catch { return u; }
  let s = u;
  if (url.password) s = s.replace(/^([a-z][\w+.-]*:\/\/[^:@/?#]*:)[^@/?#]*@/i, (_, head) => head + ref('MCP_PASSWORD') + '@');
  for (const [k, v] of url.searchParams) {
    if ((SECRET_KEY.test(k) || TOKEN_LIKE.test(v)) && !isRef(v)) {
      const raw = new RegExp('([?&]' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=)[^&#]*');
      s = s.replace(raw, '$1' + ref(varOf(k)));
    }
  }
  return s;
}

// Change la syntaxe des références de variables d'une valeur, d'un agent à l'autre.
function moveRefs(v, to, vars) {
  if (typeof v !== 'string') return v;
  return v.replace(/\$\{env:([A-Za-z_]\w*)\}|\$\{([A-Za-z_]\w*)(?::-[^}]*)?\}|\{env:([A-Za-z_]\w*)\}/g, (_, a, b, c) => {
    const n = a || b || c;
    vars.add(n);
    return renderRef(to, n);
  });
}

// Codex ne remplace pas les variables dans env : env_vars = ["NOM"] reprend la variable NOM de l'environnement.
// Chaque valeur qui est la référence à sa propre variable (NOM = "${NOM}") passe dans env_vars. Rend une copie.
export function codexEnvVars(entry) {
  const e = asObj(entry) ? structuredClone(entry) : entry;
  const env = asObj(e && e.env);
  if (!env) return e;
  const moved = [];
  for (const [k, v] of Object.entries(env)) if (refName(typeof v === 'string' ? v : '') === k) { moved.push(k); delete env[k]; }
  if (!moved.length) return e;
  e.env_vars = [...new Set([...(Array.isArray(e.env_vars) ? e.env_vars : []), ...moved])];
  if (!Object.keys(env).length) delete e.env;
  return e;
}

// Entrée native (forme de n'importe quel agent) → forme commune d'add-mcp (McpServerConfig), pour l'agent visé.
// Rend { config, vars, warnings }.
export function toCanonical(entry, to) {
  const e = asObj(entry) || {};
  const vars = new Set();
  const warnings = [];
  const mv = (v) => moveRefs(v, to, vars);
  let command = e.command ?? e.cmd ?? null;
  let args = Array.isArray(e.args) ? e.args.map(String) : [];
  if (Array.isArray(command)) { args = command.slice(1).map(String).concat(args); command = command[0] ?? null; }
  const url = URL_KEYS.map((k) => e[k]).find((v) => typeof v === 'string' && v) || null;
  const config = {};
  if (url) {
    const t = String(e.type ?? e.transport ?? '').toLowerCase();
    config.type = /sse/.test(t) ? 'sse' : 'http';
    config.url = mv(url);
    const h = Object.assign({}, ...HEADER_KEYS.map((k) => asObj(e[k]) || {}));
    if (Object.keys(h).length) config.headers = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, mv(String(v))]));
  } else if (typeof command === 'string' && command) {
    config.command = mv(command);
    if (args.length) config.args = args.map(mv);
    const env = Object.assign({}, ...ENV_KEYS.map((k) => asObj(e[k]) || {}));
    if (Object.keys(env).length) config.env = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, mv(typeof v === 'string' ? v : JSON.stringify(v))]));
  } else {
    return { config: null, vars: [], warnings: ['Serveur sans commande ni adresse : impossible à transférer.'] };
  }
  // Codex : les variables d'env de même nom passent par env_vars (codexEnvVars), seules les autres restent à vérifier.
  if (to === 'codex' && config.env) {
    for (const [k, v] of Object.entries(config.env)) if (refName(v) === k && !JSON.stringify([config.args, config.url, config.headers, config.command]).includes(k)) vars.delete(k);
  }
  if (vars.size && !knowsVars(to)) warnings.push('La forme des variables de cet agent n’est pas documentée : vérifiez ' + [...vars].sort().join(', ') + ' dans ses réglages.');
  return { config, vars: [...vars].sort(), warnings };
}
