// Vue commune et masquée d'une entrée de serveur MCP, quelle que soit la forme propre à l'agent.
// Les valeurs secrètes (env, en-têtes, arguments et paramètres d'adresse sensibles) sont remplacées par MASK
// dans le processus enfant, avant de le quitter : ni la page, ni le terminal, ni les journaux ne les voient.

export const MASK = '••••';
const SECRET_KEY = /(key|token|secret|passw|pwd|auth|bearer|credential|cookie|session|private|signature)|^(pat|dsn|sig)$/i;
// Une référence à une variable (${NOM}, ${env:NOM}, {env:NOM}, $NOM, %NOM%, ${{ secrets.X }}) n'est pas un secret : on la garde.
const VAR_REF = /^(\$\{(env:)?[A-Za-z_]\w*(:-[^}]*)?\}|\{env:[A-Za-z_]\w*\}|\$[A-Za-z_]\w*|%[A-Za-z_]\w*%|\$\{\{\s*secrets\.[\w.]+\s*\}\})$/;
// Jetons reconnaissables à leur forme, même sans nom qui les annonce.
const TOKEN_LIKE = /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|sk-[\w-]{16,}|xox[abpr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+)$/;

export const isRef = (v) => typeof v === 'string' && VAR_REF.test(v.trim());

// Masque une valeur, sauf une référence de variable ; compte ce qui a été masqué.
function maskValue(v, n) {
  if (v === undefined || v === null || v === '') return v;
  if (isRef(String(v))) return v;
  n.count++;
  return MASK;
}

// Arguments : valeur après un drapeau sensible (--api-key xxx), forme --token=xxx ou KEY=xxx, jeton évident.
function maskArgs(args, n) {
  if (!Array.isArray(args)) return [];
  const res = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    const m = /^(--?[\w.-]+|[A-Za-z_]\w*)=(.*)$/s.exec(a);
    if (m && SECRET_KEY.test(m[1].replace(/^-+/, ''))) { res.push(m[1] + '=' + maskValue(m[2], n)); continue; }
    if (TOKEN_LIKE.test(a)) { n.count++; res.push(MASK); continue; }
    // Adresse en argument (base de données, service) : identifiants et paramètres sensibles masqués.
    if (/^[a-z][\w+.-]*:\/\/\S+$/i.test(a)) { res.push(maskUrl(a, n)); continue; }
    res.push(a);
    if (/^--?[\w.-]+$/.test(a) && SECRET_KEY.test(a.replace(/^-+/, '')) && i + 1 < args.length && !String(args[i + 1]).startsWith('-')) {
      res.push(maskValue(String(args[++i]), n));
    }
  }
  return res;
}

// Adresse : identifiants (user:pass@) et paramètres sensibles masqués. Une adresse illisible n'est pas montrée.
function maskUrl(u, n) {
  if (typeof u !== 'string' || !u) return null;
  let url;
  try { url = new URL(u); } catch { n.count++; return MASK; }
  const cred = !!(url.username || url.password);
  if (cred) { url.username = ''; url.password = ''; n.count++; }
  for (const [k, v] of [...url.searchParams]) {
    if (SECRET_KEY.test(k) || TOKEN_LIKE.test(v)) url.searchParams.set(k, maskValue(v, n));
  }
  const s = url.toString();
  return cred ? s.replace('://', '://' + MASK + '@') : s;
}

// Identité d'add-mcp : nom de paquet, commande ou adresse brute du serveur distant (masquée comme une adresse).
// Les jetons reconnaissables et les formes clé=valeur sensibles sont masqués aussi.
export function maskIdentity(id) {
  const s = String(id || '').slice(0, 300);
  const n = { count: 0 };
  if (/^[a-z][\w+.-]*:\/\//i.test(s)) return maskUrl(s, n);
  return s.split(/(\s+)/).map((w) => (/\s/.test(w) ? w : maskArgs([w], n)[0])).join('');
}

const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

// Ramène une entrée native à une vue commune, masquée.
// Clés lues : command/cmd (chaîne ou tableau), args, env/envs/environment/env_vars, url/httpUrl/serverUrl/uri,
// headers/http_headers/env_http_headers, type/transport, disabled/enabled, bearer_token_env_var.
export function describe(config) {
  const c = asObj(config);
  const n = { count: 0 };
  let command = c.command ?? c.cmd ?? null;
  let args = Array.isArray(c.args) ? c.args : [];
  if (Array.isArray(command)) { args = command.slice(1).concat(args); command = command[0] ?? null; }
  if (command && typeof command === 'object') command = command.path ?? null;
  const url = c.url ?? c.httpUrl ?? c.serverUrl ?? c.uri ?? null;
  const env = { ...asObj(c.env), ...asObj(c.envs), ...asObj(c.environment), ...asObj(c.env_vars) };
  const headers = { ...asObj(c.headers), ...asObj(c.http_headers), ...asObj(c.env_http_headers) };
  const rawType = String(c.type ?? c.transport ?? '').toLowerCase();
  const kind = url ? (/sse/.test(rawType) ? 'sse' : 'http') : 'stdio';
  const maskedEnv = {};
  for (const [k, v] of Object.entries(env)) maskedEnv[k] = maskValue(text(v), n);
  const maskedHeaders = {};
  for (const [k, v] of Object.entries(headers)) maskedHeaders[k] = /^(content-type|accept|user-agent)$/i.test(k) ? text(v) : maskValue(text(v), n);
  const bearer = c.bearer_token_env_var || c.bearerTokenEnv;
  if (typeof bearer === 'string' && /^[A-Za-z_]\w*$/.test(bearer)) maskedHeaders.Authorization = 'Bearer ${' + bearer + '}';
  return {
    kind,
    command: typeof command === 'string' ? command : null,
    args: maskArgs(args, n).slice(0, 60),
    url: maskUrl(url, n),
    env: maskedEnv,
    headers: maskedHeaders,
    secrets: n.count,
    off: c.disabled === true || c.enabled === false,
  };
}
