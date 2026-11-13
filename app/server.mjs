// Serveur local de Skill Advisor : sert l'interface et l'API JSON, sur 127.0.0.1 seulement.
// Usage : node app/server.mjs [--port <n>] [--no-open] [--home <dir>]
// Ce fichier n'importe jamais le paquet "skills" : les modules de app/lib s'en chargent dans un processus enfant.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 1024 * 1024;
// Seule la route d'import accepte plus de 1 Mo.
const ARCHIVE_LIMIT = 200 * 1024 * 1024;
const ARCHIVE_TYPES = new Set(['application/gzip', 'application/octet-stream']);
const DRAIN_MAX = 16 * 1024 * 1024;
const CODE_TTL = 10 * 60 * 1000;
const GONE = 'Ce lien a déjà servi ou a expiré. Relancez Skill Advisor (npm start) et ouvrez la nouvelle adresse affichée.';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const BACKUP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

// Codes du lib et statut HTTP. Les autres codes deviennent 500.
const STATUS = { BAD_ARCHIVE: 400, BAD_INPUT: 400, BAD_NAME: 400, BAD_SOURCE: 400, NOT_FOUND: 404, EXISTS: 409, ROUGE: 409, GITHUB_LIMIT: 502, BACKUP_FAILED: 500 };
// Codes dont le message (en français, écrit par le lib) peut partir vers la page.
const KNOWN = new Set([...Object.keys(STATUS), 'CLI_FAILED', 'OUTSIDE_HOME']);

const PAGE_CSP = (hashes) => [
  "default-src 'self'",
  "script-src 'self' " + hashes.map((h) => "'sha256-" + h + "'").join(' '),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (code, message) => new HttpError(400, code, message);
const short = (v) => String(v).slice(0, 60);
const CONTROL = /[\u0000-\u001f\u007f]/;
// Message selon le type de nom contrôlé.
const what = (re) => (re === AGENT ? 'Identifiant d\'agent invalide : ' : re === BACKUP ? 'Identifiant de sauvegarde invalide : ' : 'Nom de skill invalide : ');

// ---------- Contrôle des entrées ----------
// Le lib refait ces contrôles : le serveur refuse tôt et répond proprement.

function obj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function list(body, field, re, code, { optional = false } = {}) {
  const v = body[field];
  if (v === undefined && optional) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw bad('BAD_INPUT', 'Le champ ' + field + ' doit être une liste de textes.');
  for (const x of v) if (!re.test(x)) throw bad(code, what(re) + short(x) + '.');
  return v.slice();
}

function one(body, field, re, code) {
  const v = body[field];
  if (typeof v !== 'string') throw bad('BAD_INPUT', 'Le champ ' + field + ' doit être un texte.');
  if (!re.test(v)) throw bad(code, what(re) + short(v) + '.');
  return v;
}

function flag(body, field) {
  const v = body[field];
  if (v === undefined) return false;
  if (typeof v !== 'boolean') throw bad('BAD_INPUT', 'Le champ ' + field + ' doit valoir true ou false.');
  return v;
}

function text(body, field, max) {
  const v = body[field];
  if (typeof v !== 'string' || !v.trim() || v.length > max || CONTROL.test(v)) throw bad('BAD_INPUT', 'Le champ ' + field + ' doit être un texte de 1 à ' + max + ' caractères, sans caractère de contrôle.');
  return v;
}

function source(v) {
  if (typeof v !== 'string') throw bad('BAD_INPUT', 'Chaque élément doit avoir une source.');
  // owner/repo : aucun segment ne commence par un point.
  if (REPO.test(v) && !v.split('/').some((x) => x.startsWith('.'))) return v;
  if (v.length <= 2000 && /^https:\/\/\S+$/.test(v)) {
    try { if (new URL(v).hostname) return v; } catch {}
  }
  throw bad('BAD_SOURCE', 'Source invalide. Utilisez owner/repo ou une adresse https.');
}

function items(body) {
  const v = body.items;
  if (!Array.isArray(v) || !v.length) throw bad('BAD_INPUT', 'Le champ items doit être une liste non vide.');
  return v.map((i) => {
    if (!obj(i)) throw bad('BAD_INPUT', 'Chaque élément doit être un objet { source, skill }.');
    const skill = i.skill;
    if (typeof skill !== 'string') throw bad('BAD_INPUT', 'Chaque élément doit avoir un nom de skill.');
    if (!NAME.test(skill)) throw bad('BAD_NAME', what(NAME) + short(skill) + '.');
    return { source: source(i.source), skill };
  });
}

// Texte facultatif borné. La note admet les retours à la ligne et les tabulations.
const LABEL_BAD = /[\u0000-\u001f\u007f]/;
const NOTE_BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function optText(body, field, max, banned) {
  const v = body[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length > max || banned.test(v)) throw bad('BAD_INPUT', 'Le champ ' + field + ' doit être un texte de ' + max + ' caractères au plus, sans caractère de contrôle.');
  return v;
}

function nonEmpty(v, field) {
  if (v !== undefined && !v.length) throw bad('BAD_INPUT', 'Le champ ' + field + ' doit être une liste non vide.');
  return v;
}

function createBody(b) {
  return {
    names: nonEmpty(list(b, 'names', NAME, 'BAD_NAME'), 'names'),
    label: optText(b, 'label', 80, LABEL_BAD),
    note: optText(b, 'note', 500, NOTE_BAD)
  };
}

// Corps de apply. Le serveur contrôle le format ; le lib refuse un agent inconnu (NOT_FOUND) avant toute écriture.
function applyBody(b) {
  const id = one(b, 'id', BACKUP, 'BAD_NAME');
  const names = nonEmpty(list(b, 'names', NAME, 'BAD_NAME', { optional: true }), 'names');
  const agents = nonEmpty(list(b, 'agents', AGENT, 'BAD_NAME'), 'agents');
  if (b.conflict !== 'skip' && b.conflict !== 'replace') throw bad('BAD_INPUT', 'Le champ conflict vaut skip ou replace.');
  const force = list(b, 'force', NAME, 'BAD_NAME', { optional: true });
  if (force && names) {
    const out = force.find((n) => !names.includes(n));
    if (out !== undefined) throw bad('BAD_INPUT', 'Le skill ' + short(out) + ' est dans force mais pas dans names.');
  }
  return { id, names, agents, conflict: b.conflict, force };
}

// Envoie l'archive d'une sauvegarde : Buffer ou flux rendu par le lib (le paquet tar rend un flux Minipass, pas un Readable).
async function sendArchive(res, id, data) {
  const isBuf = data instanceof Uint8Array;
  const isStream = !!data && typeof data.pipe === 'function' && typeof data.on === 'function';
  if (!isBuf && !isStream) throw new Error('exportBackup doit rendre un Buffer ou un flux.');
  common(res);
  res.statusCode = 200;
  res.setHeader('Content-Security-Policy', API_CSP);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', 'attachment; filename="skill-advisor-' + id + '.tar.gz"');
  if (isBuf) {
    res.setHeader('Content-Length', data.length);
    res.end(data);
    return;
  }
  // En-têtes déjà partis : une erreur de lecture coupe la connexion.
  try { await pipeline(data, res); } catch (e) {
    console.error('[serveur] export interrompu :', e && e.message);
    res.destroy();
  }
}

const SENT = Symbol('sent');

function scope(body) {
  const v = body.scope === undefined ? 'global' : body.scope;
  if (v !== 'global' && v !== 'project') throw bad('BAD_INPUT', 'Le champ scope vaut global ou project.');
  return v;
}

// ---------- Routes ----------

// Chaque route : [méthode, chemin, file d'attente ?, (corps, lib, params, ctx) => réponse, corps attendu].
// ctx = { query, res }. Corps : 'json' (défaut pour POST) ou 'archive' (Buffer, 200 Mo au plus).
const ROUTES = [
  ['GET', '/api/state', false, (b, lib) => lib.state()],
  ['GET', '/api/catalog', false, (b, lib) => lib.catalog()],
  ['POST', '/api/skills/install', true, async (b, lib) => withState(lib, await lib.install({ items: items(b), agents: list(b, 'agents', AGENT, 'BAD_NAME'), scope: scope(b) }))],
  ['POST', '/api/skills/remove', true, async (b, lib) => withState(lib, await lib.remove({ names: list(b, 'names', NAME, 'BAD_NAME'), agents: list(b, 'agents', AGENT, 'BAD_NAME', { optional: true }), backup: flag(b, 'backup') }))],
  ['POST', '/api/skills/update', true, async (b, lib) => withState(lib, await lib.update({ names: list(b, 'names', NAME, 'BAD_NAME', { optional: true }), force: list(b, 'force', NAME, 'BAD_NAME', { optional: true }) }))],
  ['GET', '/api/skills/check', true, (b, lib) => lib.check()],
  ['POST', '/api/skills/disable', true, async (b, lib) => withState(lib, await lib.disable({ names: list(b, 'names', NAME, 'BAD_NAME'), agents: list(b, 'agents', AGENT, 'BAD_NAME', { optional: true }) }))],
  ['POST', '/api/skills/enable', true, async (b, lib) => withState(lib, await lib.enable({ names: list(b, 'names', NAME, 'BAD_NAME'), agents: list(b, 'agents', AGENT, 'BAD_NAME', { optional: true }) }))],
  ['POST', '/api/backups/restore', true, async (b, lib) => {
    const id = one(b, 'id', BACKUP, 'BAD_NAME');
    const force = list(b, 'force', NAME, 'BAD_NAME', { optional: true });
    await lib.restoreBackup(force ? { id, force } : { id });
    return withState(lib);
  }],
  ['POST', '/api/backups/delete', true, async (b, lib) => { await lib.deleteBackup({ id: one(b, 'id', BACKUP, 'BAD_NAME') }); return withState(lib); }],
  ['POST', '/api/backups/create', true, async (b, lib) => withState(lib, await lib.createManualBackup(createBody(b)))],
  ['POST', '/api/backups/apply', true, async (b, lib) => withState(lib, await lib.applyBackup(applyBody(b)))],
  // Dans la file : l'export lit un dossier que delete et restore modifient.
  ['GET', '/api/backups/export', true, async (b, lib, m, ctx) => {
    const id = ctx.query.get('id');
    if (!id) throw bad('BAD_NAME', 'Identifiant de sauvegarde absent.');
    if (!BACKUP.test(id)) throw bad('BAD_NAME', what(BACKUP) + short(id) + '.');
    const data = await lib.exportBackup({ id });
    await sendArchive(ctx.res, id, data);
    return SENT;
  }],
  ['POST', '/api/backups/import', true, async (b, lib) => withState(lib, await lib.importBackup({ data: b })), 'archive'],
  ['POST', '/api/agents/custom', true, async (b, lib) => {
    const agent = await lib.addCustomAgent({ name: text(b, 'name', 64), dir: text(b, 'dir', 1024) });
    return withState(lib, { agent });
  }],
  ['DELETE', /^\/api\/agents\/custom\/([^/]+)$/, true, async (b, lib, m) => {
    let id;
    try { id = decodeURIComponent(m[1]); } catch { throw bad('BAD_NAME', 'Identifiant d\'agent invalide.'); }
    if (!AGENT.test(id)) throw bad('BAD_NAME', what(AGENT) + short(id) + '.');
    await lib.removeCustomAgent({ id });
    return withState(lib);
  }],
  ['POST', '/api/agents/hide', true, async (b, lib) => { await lib.hideAgent({ id: one(b, 'id', AGENT, 'BAD_NAME') }); return withState(lib); }],
  ['POST', '/api/agents/show', true, async (b, lib) => { await lib.showAgent({ id: one(b, 'id', AGENT, 'BAD_NAME') }); return withState(lib); }],
  ['POST', '/api/agents/targets', true, async (b, lib) => { await lib.setTargets({ ids: list(b, 'ids', AGENT, 'BAD_NAME') }); return withState(lib); }],
  ['POST', '/api/agents/empty', true, async (b, lib) => withState(lib, await lib.removeAgentSkills({ agent: one(b, 'id', AGENT, 'BAD_NAME'), backup: flag(b, 'backup') }))]
];

// Ajoute l'état à jour au résultat d'une action.
async function withState(lib, result) {
  const base = obj(result) ? result : {};
  return { ...base, state: await lib.state() };
}

function match(method, pathname) {
  for (const [m, p, queued, fn, kind = 'json'] of ROUTES) {
    if (m !== method) continue;
    if (typeof p === 'string') { if (p === pathname) return { queued, fn, kind, params: null }; }
    else { const r = p.exec(pathname); if (r) return { queued, fn, kind, params: r }; }
  }
  return null;
}

// ---------- Réponses ----------

function common(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, data) {
  if (res.headersSent) return;
  const s = JSON.stringify(data);
  common(res);
  res.statusCode = status;
  res.setHeader('Content-Security-Policy', API_CSP);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(s));
  res.end(s);
}

function sendText(res, status, s) {
  if (res.headersSent) return;
  common(res);
  res.statusCode = status;
  res.setHeader('Content-Security-Policy', API_CSP);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(s);
}

// Page HTML courte, sans script.
function sendHtml(res, status, message) {
  if (res.headersSent) return;
  const s = '<!doctype html>\n<html lang="fr">\n<head><meta charset="utf-8"><title>Skill Advisor</title></head>\n<body><p>' + message + '</p></body>\n</html>\n';
  common(res);
  res.statusCode = status;
  res.setHeader('Content-Security-Policy', API_CSP);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(s));
  res.end(s);
}

function sendError(res, e) {
  if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, message: e.message });
  const code = e && typeof e.code === 'string' ? e.code : null;
  if (code && KNOWN.has(code)) {
    const message = typeof e.message === 'string' && e.message ? e.message : 'L\'opération a échoué.';
    const out = { error: code, message };
    // Refus ROUGE : la page a besoin des noms pour redemander avec force.
    if (code === 'ROUGE' && Array.isArray(e.names)) out.names = e.names.filter((n) => typeof n === 'string' && NAME.test(n));
    return sendJson(res, STATUS[code] || 500, out);
  }
  // Erreur imprévue : le détail reste dans le terminal.
  console.error('[serveur]', e && e.stack ? e.stack : e);
  return sendJson(res, 500, { error: 'INTERNAL', message: 'Erreur interne. Le détail est dans le terminal du serveur.' });
}

// ---------- Page ----------

// Empreintes SHA-256 des scripts en ligne, pour la politique de sécurité du contenu.
function inlineHashes(html) {
  const out = [];
  const open = /<script(\s[^>]*)?>/gi;
  let m;
  while ((m = open.exec(html))) {
    const start = m.index + m[0].length;
    const end = html.toLowerCase().indexOf('</script', start);
    if (end < 0) break;
    if (!/\ssrc\s*=/i.test(m[1] || '')) out.push(crypto.createHash('sha256').update(html.slice(start, end), 'utf8').digest('base64'));
    open.lastIndex = end;
  }
  return out;
}

function page(root, token) {
  const html = fs.readFileSync(path.join(root, 'prototype', 'dist', 'preview.html'), 'utf8');
  const tag = '<script>window.SA_LIVE={token:"' + token + '"}</script>';
  const head = /<head(\s[^>]*)?>/i.exec(html);
  const out = head ? html.slice(0, head.index + head[0].length) + '\n' + tag + html.slice(head.index + head[0].length) : tag + html;
  return { html: out, csp: PAGE_CSP(inlineHashes(out)) };
}

// ---------- Corps ----------

// Lit au plus 1 Mo. Au-delà, le reste est lu puis jeté (16 Mo au plus) pour que le client reçoive la réponse 413.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new HttpError(413, 'TOO_LARGE', 'Requête trop volumineuse : 1 Mo au plus.');
    let size = 0, over = false;
    const chunks = [];
    // Pas de « Connection: close » : Node couperait la connexion pendant l'envoi et le client perdrait la réponse.
    const drain = () => {
      over = true;
      chunks.length = 0;
      req.on('data', (c) => { size += c.length; if (size > DRAIN_MAX) req.destroy(); });
      reject(tooLarge());
    };
    if (Number(req.headers['content-length']) > LIMIT) { drain(); req.resume(); return; }
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > LIMIT) drain(); else chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', (e) => { if (!over) reject(e); });
  });
}

const typeOf = (req) => String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

async function jsonBody(req) {
  const type = typeOf(req);
  if (type !== 'application/json') {
    req.resume();
    throw new HttpError(415, 'UNSUPPORTED_TYPE', 'Envoyez du JSON, avec Content-Type: application/json.');
  }
  const s = await readBody(req);
  let v;
  try { v = JSON.parse(s); } catch { throw bad('BAD_JSON', 'Le corps de la requête n\'est pas un JSON valide.'); }
  if (!obj(v)) throw bad('BAD_JSON', 'Le corps de la requête doit être un objet JSON.');
  return v;
}

// Archive d'import : Buffer de `limit` octets au plus. Au-delà, rien n'est plus gardé.
// Refus : la suite est lue et jetée, 1 Mo au plus, pour que le client reçoive la réponse. Au-delà, ou si
// l'envoi traîne plus d'une seconde après la réponse, la connexion est coupée.
// Pas de « Connection: close » : Node fermerait la connexion pendant l'envoi et le client perdrait la réponse.
// Sauf quand la taille annoncée dépasse la limite : le corps ne sera jamais lu en entier, la connexion ne peut pas resservir.
const REFUSED_DRAIN = 1024 * 1024;
function archiveBody(req, res, limit) {
  const stop = (status, code, message, close = false) => {
    if (close) res.setHeader('Connection', 'close');
    let drained = 0;
    req.removeAllListeners('data');
    req.on('data', (c) => { drained += c.length; if (drained > REFUSED_DRAIN) req.destroy(); });
    req.resume();
    res.once('finish', () => { if (!req.complete) setTimeout(() => { if (!req.complete) req.destroy(); }, 1000).unref(); });
    return new HttpError(status, code, message);
  };
  if (!ARCHIVE_TYPES.has(typeOf(req))) return Promise.reject(stop(415, 'UNSUPPORTED_TYPE', 'Envoyez l\'archive avec Content-Type: application/gzip.'));
  const tooLarge = (close) => stop(413, 'TOO_LARGE', 'Archive trop volumineuse : 200 Mo au plus.', close);
  if (Number(req.headers['content-length']) > limit) return Promise.reject(tooLarge(true));
  return new Promise((resolve, reject) => {
    let size = 0, over = false;
    const chunks = [];
    const onData = (c) => {
      size += c.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(tooLarge());
        return;
      }
      chunks.push(c);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (over) return;
      if (!size) return reject(bad('BAD_ARCHIVE', 'Archive vide.'));
      resolve(Buffer.concat(chunks, size));
    });
    req.on('error', (e) => { if (!over) reject(e); });
  });
}

// ---------- Serveur ----------

function sameToken(given, token) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given, 'utf8'), b = Buffer.from(token, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Le cookie "sa" porte-t-il le jeton ? Le navigateur peut en envoyer plusieurs (autres ports, ancien lancement).
function cookieOk(header, token) {
  if (typeof header !== 'string') return false;
  return header.split(';').some((part) => {
    const i = part.indexOf('=');
    return i > 0 && part.slice(0, i).trim() === 'sa' && sameToken(part.slice(i + 1).trim(), token);
  });
}

export function createServer({ lib, token, port = 0, root = ROOT, now = Date.now, archiveLimit = ARCHIVE_LIMIT } = {}) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('Jeton absent ou trop court.');
  // Codes d'ouverture à usage unique : code -> heure d'expiration.
  const codes = new Map();
  const codeOk = (c) => {
    if (typeof c !== 'string' || !codes.has(c)) return false;
    const ok = now() < codes.get(c);
    if (!ok) codes.delete(c);
    return ok;
  };
  // Une seule action à la fois : chaîne de promesses.
  let chain = Promise.resolve();
  const enqueue = (fn) => {
    const p = chain.then(fn);
    chain = p.then(() => {}, () => {});
    return p;
  };

  const server = http.createServer(async (req, res) => {
    const forbidden = () => { req.resume(); sendJson(res, 403, { error: 'forbidden' }); };
    try {
      const p = server.address().port;
      const hosts = ['127.0.0.1:' + p, 'localhost:' + p];
      if (!hosts.includes(req.headers.host)) return forbidden();
      const origin = req.headers.origin;
      if (origin !== undefined && !hosts.some((h) => origin === 'http://' + h)) return forbidden();

      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = url.pathname;

      if (pathname === '/' && req.method === 'GET') {
        req.resume();
        // Code neuf d'abord (il pose le cookie), sinon cookie valide (rechargement).
        const code = url.searchParams.get('c');
        const fresh = codeOk(code);
        if (!fresh && !cookieOk(req.headers.cookie, token)) return sendHtml(res, 403, GONE);
        let built;
        try { built = page(root, token); } catch (e) {
          console.error('[serveur] interface introuvable :', e.message);
          return sendText(res, 500, 'Interface introuvable. Lancez npm run build.');
        }
        // Page prête : le code est consommé seulement maintenant.
        if (fresh) codes.delete(code);
        common(res);
        res.statusCode = 200;
        if (fresh) res.setHeader('Set-Cookie', 'sa=' + token + '; HttpOnly; SameSite=Strict; Path=/');
        res.setHeader('Content-Security-Policy', built.csp);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(built.html));
        return res.end(built.html);
      }

      if (!pathname.startsWith('/api/')) { req.resume(); return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Adresse inconnue.' }); }
      if (!sameToken(req.headers['x-sa-token'], token)) return forbidden();

      const route = match(req.method, pathname);
      if (!route) { req.resume(); return sendJson(res, 404, { error: 'NOT_FOUND', message: 'Adresse inconnue.' }); }

      // Corps lu hors de la file : un envoi lent ne bloque pas les autres actions.
      let body = {};
      if (route.kind === 'archive') body = await archiveBody(req, res, archiveLimit);
      else if (req.method === 'POST') body = await jsonBody(req);
      else req.resume();

      const run = () => route.fn(body, lib, route.params, { query: url.searchParams, res });
      const data = route.queued ? await enqueue(run) : await run();
      if (data === SENT) return;
      sendJson(res, 200, data === undefined ? {} : data);
    } catch (e) {
      sendError(res, e);
    }
  });
  // Nouveau code d'ouverture, valable 10 minutes et une fois.
  server.newCode = () => {
    const t = now();
    for (const [c, exp] of codes) if (t >= exp) codes.delete(c);
    const c = crypto.randomBytes(16).toString('hex');
    codes.set(c, t + CODE_TTL);
    return c;
  };
  server.listen(port, '127.0.0.1');
  return server;
}

// ---------- Programme ----------

// Lib réel : modules de app/lib chargés à la demande, avec le dossier personnel choisi.
function liveLib({ home, cwd }) {
  const load = (name) => import(new URL('./lib/' + name + '.mjs', import.meta.url).href);
  const ctx = { home, cwd };
  const call = (mod, fn) => async (args = {}) => (await load(mod))[fn]({ ...args, ...ctx });
  return {
    state: call('inventory', 'getState'),
    catalog: async () => (await load('catalog')).getCatalog({}),
    install: call('actions', 'install'),
    remove: call('actions', 'remove'),
    update: call('actions', 'update'),
    check: call('actions', 'check'),
    disable: call('actions', 'disable'),
    enable: call('actions', 'enable'),
    removeAgentSkills: call('actions', 'removeAgentSkills'),
    applyBackup: call('actions', 'applyBackup'),
    restoreBackup: call('backups', 'restoreBackup'),
    deleteBackup: call('backups', 'deleteBackup'),
    createManualBackup: call('backups', 'createManualBackup'),
    exportBackup: call('archive', 'exportBackup'),
    importBackup: call('archive', 'importBackup'),
    addCustomAgent: call('settings', 'addCustomAgent'),
    removeCustomAgent: call('settings', 'removeCustomAgent'),
    hideAgent: call('settings', 'hideAgent'),
    showAgent: call('settings', 'showAgent'),
    setTargets: call('settings', 'setTargets')
  };
}

// Commande qui ouvre l'adresse dans le navigateur par défaut. Windows : rundll32, pour éviter cmd.exe (un shell).
export function browserCommand(url, platform = process.platform) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

function openBrowser(url) {
  const [cmd, args] = browserCommand(url);
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', () => console.error('Ouvrez cette adresse dans votre navigateur : ' + url));
    p.unref();
  } catch {
    console.error('Ouvrez cette adresse dans votre navigateur : ' + url);
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs({ options: { port: { type: 'string' }, 'no-open': { type: 'boolean' }, home: { type: 'string' } }, strict: true }).values;
  } catch {
    console.error('Option invalide. Usage : node app/server.mjs [--port <n>] [--no-open] [--home <dir>]');
    process.exit(2);
  }
  let port = 0;
  if (opts.port !== undefined) {
    port = Number(opts.port);
    if (!/^\d+$/.test(opts.port) || port > 65535) { console.error('Port invalide : ' + opts.port); process.exit(2); }
  }
  const home = opts.home ? path.resolve(opts.home) : os.homedir();
  // Télémétrie coupée : les processus enfants héritent de cette variable.
  process.env.DISABLE_TELEMETRY = '1';
  // Dossiers de travail oubliés par un arrêt brutal : retirés sans attendre ni rien écrire.
  import('./lib/util.mjs').then((u) => u.sweepTmp({ home })).catch(() => {});
  const token = crypto.randomBytes(32).toString('hex');
  const server = createServer({ lib: liveLib({ home, cwd: process.cwd() }), token, port, root: ROOT });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? 'Le port ' + port + ' est déjà pris. Choisissez-en un autre avec --port.' : 'Démarrage impossible : ' + e.message);
    process.exit(1);
  });
  server.on('listening', () => {
    // Le jeton reste interne : l'adresse porte un code d'ouverture à usage unique.
    const url = 'http://127.0.0.1:' + server.address().port + '/?c=' + server.newCode();
    process.stdout.write('Skill Advisor: ' + url + '\n');
    if (!opts['no-open']) openBrowser(url);
  });
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}

if (isMain()) main();
