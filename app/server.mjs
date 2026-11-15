// Serveur local de Skill Advisor : sert l'interface et l'API JSON, sur 127.0.0.1 seulement.
// Usage : node app/server.mjs [--port <n>] [--no-open] [--project <dossier>] [--home <dossier>] [--version] [--help]
// Ce fichier n'importe jamais le paquet "skills" : les modules de app/lib s'en chargent dans un processus enfant.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openAddress } from './lib/open.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 1024 * 1024;
// Seule la route d'import accepte plus de 1 Mo.
const ARCHIVE_LIMIT = 200 * 1024 * 1024;
const ARCHIVE_TYPES = new Set(['application/gzip', 'application/octet-stream']);
const DRAIN_MAX = 16 * 1024 * 1024;
const CODE_TTL = 10 * 60 * 1000;
// Clé de lancement donnée au navigateur (/start?k=…) : 16 caractères hexadécimaux, un seul usage, 2 minutes.
const KEY_TTL = 2 * 60 * 1000;
const KEY = /^[0-9a-f]{16}$/;

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const BACKUP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

// Codes du lib et statut HTTP. Les autres codes deviennent 500.
const STATUS = { BAD_ARCHIVE: 400, BAD_INPUT: 400, BAD_NAME: 400, BAD_SOURCE: 400, NOT_FOUND: 404, SOURCE_NOT_FOUND: 404, EXISTS: 409, ROUGE: 409, SHARED: 409,
  GITHUB_LIMIT: 502, NETWORK: 502, BACKUP_FAILED: 500 };
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

// Corps de install. Chaque élément est contrôlé seul : un élément refusé va dans failed, les autres continuent.
// Seul un corps mal formé (liste absente, élément sans nom) refuse toute la requête.
const BY_HAND = ' Installez ce skill à la main.';
function installBody(b) {
  const v = b.items;
  if (!Array.isArray(v) || !v.length) throw bad('BAD_INPUT', 'Le champ items doit être une liste non vide.');
  const args = { items: [], agents: list(b, 'agents', AGENT, 'BAD_NAME'), scope: scope(b) };
  // Champs facultatifs : absents du corps, absents de l'appel.
  for (const f of ['replace', 'force']) {
    const names = list(b, f, NAME, 'BAD_NAME', { optional: true });
    if (names) args[f] = names;
  }
  const failed = [];
  for (const i of v) {
    if (!obj(i) || typeof i.skill !== 'string') throw bad('BAD_INPUT', 'Chaque élément doit être un objet { source, skill }.');
    let src = null;
    try { src = source(i.source); } catch (e) { if (!(e instanceof HttpError)) throw e; }
    if (!NAME.test(i.skill)) failed.push({ name: i.skill.slice(0, 200), message: 'Skill Advisor ne sait pas installer un skill qui porte ce nom.' + BY_HAND });
    else if (src === null) failed.push({ name: i.skill, message: 'Skill Advisor ne sait pas installer depuis cette source.' + BY_HAND });
    else args.items.push({ source: src, skill: i.skill });
  }
  return { args, failed };
}

const arr = (v) => (Array.isArray(v) ? v : []);

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
    // Téléchargement annulé par le client : rien à dire.
    if (!aborted(e)) console.error('[serveur] export interrompu :', e && e.message);
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

// Chaque route : [méthode, chemin, mode, (corps, lib, params, ctx) => réponse, corps attendu].
// Mode : W = écriture, une à la fois ; R = lecture de l'état, après l'écriture en cours ; F = libre, sans attente.
// ctx = { query, res }. Corps : 'json' (défaut pour POST) ou 'archive' (Buffer, 200 Mo au plus).
const W = 'write', R = 'read', F = 'free';
const ROUTES = [
  ['GET', '/api/state', R, (b, lib) => lib.state()],
  ['GET', '/api/catalog', F, (b, lib) => lib.catalog()],
  ['GET', '/api/search-data', F, (b, lib) => lib.searchData()],
  ['POST', '/api/project', W, async (b, lib) => {
    if (b.dir !== null && typeof b.dir !== 'string') throw bad('BAD_INPUT', 'Le champ dir doit être le chemin complet d\'un dossier, ou null.');
    await lib.setProject({ dir: b.dir === null ? null : text(b, 'dir', 1024) });
    return withState(lib);
  }],
  ['POST', '/api/skills/install', W, async (b, lib) => {
    const { args, failed } = installBody(b);
    if (args.scope === 'project' && !(await lib.getProject())) throw bad('BAD_INPUT', 'Choisissez d\'abord le dossier du projet.');
    // Aucun élément valable : le lib n'est pas appelé.
    const r = args.items.length ? await lib.install(args) : {};
    const base = obj(r) ? r : {};
    return withState(lib, { ...base, installed: arr(base.installed), held: arr(base.held), conflicts: arr(base.conflicts), skipped: arr(base.skipped), failed: [...failed, ...arr(base.failed)] });
  }],
  ['POST', '/api/skills/remove', W, async (b, lib) => withState(lib, await lib.remove({ names: list(b, 'names', NAME, 'BAD_NAME'), agents: list(b, 'agents', AGENT, 'BAD_NAME', { optional: true }), backup: flag(b, 'backup') }))],
  ['POST', '/api/skills/update', W, async (b, lib) => withState(lib, await lib.update({ names: list(b, 'names', NAME, 'BAD_NAME', { optional: true }), force: list(b, 'force', NAME, 'BAD_NAME', { optional: true }) }))],
  // Hors de la file : une vérification lente (réseau) ne retient aucune action.
  // check.json est écrit ensuite, dans la file des écritures, et seulement si aucune écriture n'a eu lieu pendant la
  // vérification (un résultat d'avant une mise à jour ou une désinstallation serait faux). La réponse n'attend pas cette écriture.
  ['GET', '/api/skills/check', F, async (b, lib, m, ctx) => {
    const seen = ctx.lock.writes();
    const r = await lib.check({ save: false });
    const outdated = arr(obj(r) ? r.outdated : null).map((o) => (obj(o) ? o.name : null)).filter((n) => typeof n === 'string');
    ctx.lock.write(async () => { if (ctx.lock.writes() === seen) await lib.saveCheck({ outdated }); }, { quiet: true })
      .catch((e) => console.error('[serveur] check.json non écrit :', e && e.message));
    return r;
  }],
  ['GET', '/api/skills/preview', F, (b, lib, m, ctx) => {
    const name = ctx.query.get('name');
    if (!name) throw bad('BAD_NAME', 'Nom de skill absent.');
    if (!NAME.test(name)) throw bad('BAD_NAME', what(NAME) + short(name) + '.');
    return lib.preview({ name });
  }],
  ['POST', '/api/skills/disable', W, async (b, lib) => withState(lib, await lib.disable({ names: list(b, 'names', NAME, 'BAD_NAME'), agents: list(b, 'agents', AGENT, 'BAD_NAME', { optional: true }) }))],
  ['POST', '/api/skills/enable', W, async (b, lib) => withState(lib, await lib.enable({ names: list(b, 'names', NAME, 'BAD_NAME'), agents: list(b, 'agents', AGENT, 'BAD_NAME', { optional: true }) }))],
  ['POST', '/api/backups/restore', W, async (b, lib) => {
    const id = one(b, 'id', BACKUP, 'BAD_NAME');
    const force = list(b, 'force', NAME, 'BAD_NAME', { optional: true });
    await lib.restoreBackup(force ? { id, force } : { id });
    return withState(lib);
  }],
  ['POST', '/api/backups/delete', W, async (b, lib) => { await lib.deleteBackup({ id: one(b, 'id', BACKUP, 'BAD_NAME') }); return withState(lib); }],
  ['POST', '/api/backups/create', W, async (b, lib) => withState(lib, await lib.createManualBackup(createBody(b)))],
  ['POST', '/api/backups/apply', W, async (b, lib) => withState(lib, await lib.applyBackup(applyBody(b)))],
  // Dans la file : l'export lit un dossier que delete et restore modifient.
  ['GET', '/api/backups/export', W, async (b, lib, m, ctx) => {
    const id = ctx.query.get('id');
    if (!id) throw bad('BAD_NAME', 'Identifiant de sauvegarde absent.');
    if (!BACKUP.test(id)) throw bad('BAD_NAME', what(BACKUP) + short(id) + '.');
    const data = await lib.exportBackup({ id });
    await sendArchive(ctx.res, id, data);
    return SENT;
  }],
  ['POST', '/api/backups/import', W, async (b, lib) => withState(lib, await lib.importBackup({ data: b })), 'archive'],
  ['POST', '/api/agents/custom', W, async (b, lib) => {
    const agent = await lib.addCustomAgent({ name: text(b, 'name', 64), dir: text(b, 'dir', 1024) });
    return withState(lib, { agent });
  }],
  ['DELETE', /^\/api\/agents\/custom\/([^/]+)$/, W, async (b, lib, m) => {
    let id;
    try { id = decodeURIComponent(m[1]); } catch { throw bad('BAD_NAME', 'Identifiant d\'agent invalide.'); }
    if (!AGENT.test(id)) throw bad('BAD_NAME', what(AGENT) + short(id) + '.');
    await lib.removeCustomAgent({ id });
    return withState(lib);
  }],
  ['POST', '/api/agents/hide', W, async (b, lib) => { await lib.hideAgent({ id: one(b, 'id', AGENT, 'BAD_NAME') }); return withState(lib); }],
  ['POST', '/api/agents/show', W, async (b, lib) => { await lib.showAgent({ id: one(b, 'id', AGENT, 'BAD_NAME') }); return withState(lib); }],
  ['POST', '/api/agents/targets', W, async (b, lib) => { await lib.setTargets({ ids: list(b, 'ids', AGENT, 'BAD_NAME') }); return withState(lib); }],
  ['POST', '/api/agents/empty', W, async (b, lib) => withState(lib, await lib.removeAgentSkills({ agent: one(b, 'id', AGENT, 'BAD_NAME'), backup: flag(b, 'backup') }))]
];

// Ajoute l'état à jour au résultat d'une action.
async function withState(lib, result) {
  const base = obj(result) ? { ...result } : {};
  // Le détail brut d'un échec (texte de la CLI) reste dans le terminal.
  if (Array.isArray(base.failed)) {
    base.failed = base.failed.map((f) => {
      if (!obj(f) || f.detail === undefined) return f;
      const { detail, ...rest } = f;
      console.error('[serveur] ' + short(f.name) + ' : ' + String(detail).slice(0, 2000));
      return rest;
    });
  }
  return { ...base, state: await lib.state() };
}

function match(method, pathname) {
  for (const [m, p, mode, fn, kind = 'json'] of ROUTES) {
    if (m !== method) continue;
    if (typeof p === 'string') { if (p === pathname) return { mode, fn, kind, params: null }; }
    else { const r = p.exec(pathname); if (r) return { mode, fn, kind, params: r }; }
  }
  return null;
}

// Verrou des actions. Écritures : une à la fois, dans l'ordre d'arrivée ; une écriture attend la fin des lectures en cours.
// Lecture de l'état : libre quand aucune écriture ne tourne ni n'attend. Sinon elle attend la fin de la prochaine
// écriture, puis passe avant celle d'après. Une lecture ne voit donc jamais un état à moitié écrit, n'attend jamais
// toute la file, et un flot continu de lectures ne retient pas une écriture en attente.
// writes() : nombre d'écritures terminées (sauf celles marquées quiet), pour savoir si une écriture a eu lieu entre deux instants.
function gate() {
  let writing = false, loud = false, reading = 0, readers = [], done = 0;
  const writers = [];
  const startWriter = () => { if (!writing && reading === 0 && writers.length) writers.shift()(); };
  // Fin d'une écriture : les lectures qui l'attendaient passent, puis l'écriture suivante attend leur fin.
  const afterWrite = () => {
    writing = false;
    const waiting = readers;
    readers = [];
    for (const go of waiting) go();
    startWriter();
  };
  const write = (fn, { quiet = false } = {}) => new Promise((resolve, reject) => {
    writers.push(() => {
      writing = true;
      loud = !quiet;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { if (loud) done++; loud = false; afterWrite(); });
    });
    startWriter();
  });
  const read = (fn) => new Promise((resolve, reject) => {
    const go = () => {
      reading++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { reading--; startWriter(); });
    };
    if (writing || writers.length) readers.push(go); else go();
  });
  // Une écriture en cours compte à moitié : commencée avant un instant et finie après, elle change le compte.
  return { write, read, writes: () => done * 2 + (loud ? 1 : 0) };
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

// Client parti (onglet fermé, envoi annulé) : la connexion n'existe plus.
function left(res) {
  return res.destroyed || !res.socket || res.socket.destroyed;
}
// Erreurs d'une connexion coupée par le client.
const ABORTS = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ERR_STREAM_PREMATURE_CLOSE']);
function aborted(e) {
  return !!e && (e.message === 'aborted' || ABORTS.has(e.code));
}

function sendJson(res, status, data) {
  if (res.headersSent || left(res)) return;
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

function sendError(res, e) {
  // Onglet fermé ou envoi annulé : ni trace, ni réponse. Une erreur du lib, client présent, suit le cas général.
  if (left(res) && aborted(e)) return;
  if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, message: e.message });
  const code = e && typeof e.code === 'string' ? e.code : null;
  if (code && KNOWN.has(code)) {
    const message = typeof e.message === 'string' && e.message ? e.message : 'L\'opération a échoué.';
    const out = { error: code, message };
    // Refus ROUGE : la page a besoin des noms pour redemander avec force.
    if (code === 'ROUGE' && Array.isArray(e.names)) out.names = e.names.filter((n) => typeof n === 'string' && NAME.test(n));
    // Refus SHARED : la page a besoin des agents qui lisent le dossier partagé.
    if (code === 'SHARED' && Array.isArray(e.readers)) out.readers = e.readers.filter((n) => typeof n === 'string' && AGENT.test(n));
    // Texte brut de la CLI : dans le terminal, jamais dans la page.
    if (typeof e.detail === 'string' && e.detail) console.error('[serveur] ' + code + ' : ' + e.detail.slice(0, 2000));
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
  // Fin cherchée sur le texte d'origine : une minuscule peut changer de longueur (« İ »).
  const close = /<\/script/gi;
  let m;
  while ((m = open.exec(html))) {
    const start = m.index + m[0].length;
    close.lastIndex = start;
    const c = close.exec(html);
    if (!c) break;
    const end = c.index;
    if (!/\ssrc\s*=/i.test(m[1] || '')) out.push(crypto.createHash('sha256').update(html.slice(start, end), 'utf8').digest('base64'));
    open.lastIndex = end;
  }
  return out;
}

// La page, avec le jeton (code d'ouverture valable) ou sans (token: null).
function page(root, token) {
  // Fins de ligne en LF, avant le calcul des empreintes et l'envoi : le navigateur fait la même chose avant de
  // calculer la sienne. Sans cela, un checkout en CRLF (Git pour Windows) bloque tous les scripts.
  const html = fs.readFileSync(path.join(root, 'prototype', 'dist', 'preview.html'), 'utf8').replace(/\r\n?/g, '\n');
  const tag = '<script>window.SA_LIVE={token:' + (token ? '"' + token + '"' : 'null') + '}</script>';
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

export function createServer({ lib, token, port = 0, root = ROOT, now = Date.now, archiveLimit = ARCHIVE_LIMIT } = {}) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('Jeton absent ou trop court.');
  // Codes d'ouverture à usage unique : code -> heure d'expiration.
  const codes = new Map();
  // Clés de lancement : clé -> { code, exp }.
  const keys = new Map();
  const codeOk = (c) => {
    if (typeof c !== 'string' || !codes.has(c)) return false;
    const ok = now() < codes.get(c);
    if (!ok) codes.delete(c);
    return ok;
  };
  const lock = gate();

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

      if (pathname === '/start' && req.method === 'GET') {
        req.resume();
        // Clé de lancement : consommée au premier usage, valable ou non. Seul ce renvoi porte le code.
        const k = url.searchParams.get('k');
        const entry = typeof k === 'string' && KEY.test(k) ? keys.get(k) : undefined;
        if (entry) keys.delete(k);
        const ok = !!entry && now() < entry.exp;
        common(res);
        res.statusCode = 302;
        res.setHeader('Content-Security-Policy', API_CSP);
        // Clé usée, expirée ou inconnue : la page sans jeton, qui dit de relancer Skill Advisor.
        res.setHeader('Location', ok ? '/?c=' + entry.code : '/');
        res.setHeader('Content-Length', 0);
        res.end();
        return;
      }

      if (pathname === '/' && req.method === 'GET') {
        req.resume();
        // Code neuf : la page porte le jeton. Sinon la même page sans jeton : elle ne contient aucun secret.
        // Aucun cookie : un cookie irait à tous les ports de 127.0.0.1.
        const code = url.searchParams.get('c');
        const fresh = codeOk(code);
        let built;
        try { built = page(root, fresh ? token : null); } catch (e) {
          console.error('[serveur] interface introuvable :', e.message);
          return sendText(res, 500, 'Interface introuvable. Lancez npm run build.');
        }
        // Page prête : le code est consommé seulement maintenant.
        if (fresh) codes.delete(code);
        common(res);
        res.statusCode = 200;
        res.setHeader('Content-Security-Policy', built.csp);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(built.html));
        res.end(built.html);
        if (fresh) server.emit('codeUsed', code);
        return;
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

      const run = () => route.fn(body, lib, route.params, { query: url.searchParams, res, lock });
      const data = route.mode === W ? await lock.write(run) : route.mode === R ? await lock.read(run) : await run();
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
  // Nouvelle clé de lancement pour un code : un seul usage, 2 minutes. Elle seule passe dans les arguments du navigateur.
  server.newLaunchKey = (code) => {
    if (typeof code !== 'string' || !codes.has(code)) throw new Error('Code d’ouverture inconnu.');
    const t = now();
    for (const [k, v] of keys) if (t >= v.exp) keys.delete(k);
    const k = crypto.randomBytes(8).toString('hex');
    keys.set(k, { code, exp: t + KEY_TTL });
    return k;
  };
  server.listen(port, '127.0.0.1');
  return server;
}

// ---------- Programme ----------

// Dossier de projet : chemin complet d'un dossier qui existe ; rend son chemin réel.
// Refus : racine du disque, dossier personnel et ses parents, dossiers de Skill Advisor.
async function projectDir(home, dir) {
  if (typeof dir !== 'string' || !dir.trim() || dir.length > 1024 || CONTROL.test(dir) || !path.isAbsolute(dir)) {
    throw bad('BAD_INPUT', 'Indiquez le chemin complet du dossier du projet.');
  }
  let real;
  try {
    real = await fs.promises.realpath(dir);
    if (!(await fs.promises.stat(real)).isDirectory()) throw new Error('pas un dossier');
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Ce dossier n’existe pas. Vérifiez le chemin du projet.');
  }
  const u = await import('./lib/util.mjs');
  if (path.parse(real).root === real) throw bad('BAD_INPUT', 'La racine du disque ne peut pas servir de dossier de projet.');
  if (u.within(await u.realish(home), real)) throw bad('BAD_INPUT', 'Le dossier personnel et ses dossiers parents ne peuvent pas servir de dossier de projet.');
  if (u.within(real, await u.realish(u.saDir(home)))) throw bad('BAD_INPUT', 'Les dossiers de Skill Advisor ne peuvent pas servir de dossier de projet.');
  return real;
}

// Câblage du lib réel : fonction du serveur -> [module de app/lib, fonction exportée, contexte].
// Contexte 'all' : { home, cwd, project } ; 'home' : { home } seul (catalogue).
export const WIRING = {
  state: ['inventory', 'getState', 'all'],
  catalog: ['catalog', 'getCatalog', 'home'],
  searchData: ['catalog', 'getSearchData', 'home'],
  install: ['actions', 'install', 'all'],
  remove: ['actions', 'remove', 'all'],
  update: ['actions', 'update', 'all'],
  preview: ['actions', 'preview', 'all'],
  check: ['actions', 'check', 'all'],
  saveCheck: ['actions', 'saveCheck', 'all'],
  disable: ['actions', 'disable', 'all'],
  enable: ['actions', 'enable', 'all'],
  removeAgentSkills: ['actions', 'removeAgentSkills', 'all'],
  applyBackup: ['actions', 'applyBackup', 'all'],
  restoreBackup: ['backups', 'restoreBackup', 'all'],
  deleteBackup: ['backups', 'deleteBackup', 'all'],
  createManualBackup: ['backups', 'createManualBackup', 'all'],
  exportBackup: ['archive', 'exportBackup', 'all'],
  importBackup: ['archive', 'importBackup', 'all'],
  addCustomAgent: ['settings', 'addCustomAgent', 'all'],
  removeCustomAgent: ['settings', 'removeCustomAgent', 'all'],
  hideAgent: ['settings', 'hideAgent', 'all'],
  showAgent: ['settings', 'showAgent', 'all'],
  setTargets: ['settings', 'setTargets', 'all']
};

// Lib réel : modules de app/lib chargés à la demande, avec le dossier personnel et le projet choisis.
// Le lib ne reçoit jamais le dossier de lancement du serveur : cwd vaut le projet, sinon le dossier personnel.
export function liveLib({ home, project = null }) {
  const load = (name) => import(new URL('./lib/' + name + '.mjs', import.meta.url).href);
  let current = project;
  // Lu à chaque appel : le projet peut changer en cours de route.
  const ctx = (kind) => (kind === 'home' ? { home } : { home, cwd: current || home, project: current });
  const lib = {
    getProject: () => current,
    setProject: async ({ dir }) => { current = dir === null ? null : await projectDir(home, dir); }
  };
  for (const [key, [mod, fn, kind]] of Object.entries(WIRING)) {
    // Le contexte passe après les arguments : une requête ne peut pas changer de dossier personnel.
    lib[key] = async (args = {}) => (await load(mod))[fn]({ ...args, ...ctx(kind) });
  }
  return lib;
}

// Erreur de démarrage : message en français et code de sortie.
export class StartError extends Error {
  constructor(exit, message) { super(message); this.exit = exit; }
}

const USAGE = 'Usage : node app/server.mjs [--port <n>] [--no-open] [--project <dossier>] [--home <dossier>]';

// Aide de --help, en français.
export const HELP = [
  USAGE + ' [--version] [--help]',
  '',
  'Lance Skill Advisor sur votre machine, à l’adresse 127.0.0.1, et ouvre le navigateur.',
  '',
  '  --port <n>            Port d’écoute. Sans cette option, le système choisit un port libre.',
  '  --no-open             N’ouvre pas le navigateur. Ouvrez vous-même l’adresse affichée.',
  '  --project <dossier>   Montre aussi les skills de ce dossier de projet.',
  '  --home <dossier>      Dossier personnel à utiliser. Réservé aux tests.',
  '  --version             Affiche la version, puis s’arrête.',
  '  --help                Affiche cette aide, puis s’arrête.',
  ''
].join('\n');

// Version de package.json.
export function version() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

// Lit les options de la ligne de commande.
export function readOptions(argv) {
  let v;
  try {
    v = parseArgs({ args: argv, options: { port: { type: 'string' }, 'no-open': { type: 'boolean' }, home: { type: 'string' }, project: { type: 'string' },
      version: { type: 'boolean' }, help: { type: 'boolean' } }, strict: true }).values;
  } catch {
    throw new StartError(2, 'Option invalide. ' + USAGE);
  }
  // --help et --version : rien d'autre n'est lu ni écrit.
  if (v.help) return { help: true };
  if (v.version) return { version: true };
  let port = 0;
  if (v.port !== undefined) {
    port = Number(v.port);
    if (!/^\d+$/.test(v.port) || port > 65535) throw new StartError(2, 'Port invalide : ' + v.port);
  }
  if (v.project !== undefined && !v.project.trim()) throw new StartError(2, 'Option --project : indiquez le dossier du projet.');
  return { port, open: !v['no-open'], home: v.home ? path.resolve(v.home) : os.homedir(), project: v.project === undefined ? null : path.resolve(v.project) };
}

// Lance le serveur. Rend { server, url, opener }. deps (tests) : out, warn, opener { platform, env, run }.
export async function start({ port = 0, open = true, home, project = null } = {}, deps = {}) {
  if (typeof home !== 'string' || !home) throw new Error('Dossier personnel absent.');
  const out = deps.out || ((s) => process.stdout.write(s));
  const warn = deps.warn || ((s) => console.error(s));
  let real = null;
  if (project !== null) {
    try { real = await projectDir(home, project); } catch (e) {
      if (e instanceof HttpError) throw new StartError(2, 'Option --project : ' + e.message);
      throw e;
    }
  }
  // Télémétrie coupée : les processus enfants héritent de cette variable.
  process.env.DISABLE_TELEMETRY = '1';
  // Restes d'un arrêt brutal : retirés sans attendre ni rien écrire.
  import('./lib/util.mjs').then((u) => u.sweepTmp({ home })).catch(() => {});
  const token = crypto.randomBytes(32).toString('hex');
  const server = createServer({ lib: liveLib({ home, project: real }), token, port, root: ROOT });
  try {
    if (!server.listening) await once(server, 'listening');
  } catch (e) {
    if (e.code === 'EADDRINUSE') throw new StartError(1, 'Le port ' + port + ' est déjà pris. Choisissez-en un autre avec --port.');
    if (e.code === 'EACCES') throw new StartError(1, 'Le port ' + port + ' est réservé au système. Choisissez un port au-dessus de 1024 avec --port.');
    throw new StartError(1, 'Démarrage impossible : ' + e.message);
  }
  server.on('error', (e) => warn('[serveur] ' + (e && e.message)));
  // Le jeton reste interne : l'adresse porte un code d'ouverture à usage unique.
  const base = 'http://127.0.0.1:' + server.address().port;
  const code = server.newCode();
  const url = base + '/?c=' + code;
  out('Skill Advisor: ' + url + '\n');
  let opener = null;
  if (open) {
    // Le navigateur reçoit /start?k=<clé>, jamais le code : la clé sert une fois, puis ne vaut plus rien.
    opener = await openAddress({ url: base + '/start?k=' + server.newLaunchKey(code), warn, ...(deps.opener || {}) });
  }
  return { server, url, opener };
}

async function main() {
  let run;
  try {
    const opts = readOptions(process.argv.slice(2));
    // Constat 71 : --help et --version répondent avant toute écriture, puis le programme s'arrête (code 0).
    if (opts.help) { process.stdout.write(HELP); return; }
    if (opts.version) { process.stdout.write(version() + '\n'); return; }
    // Constat 89 : ~/.skill-advisor existe dès le démarrage, dossier lisible par l'utilisateur seul (0700).
    await (await import('./lib/util.mjs')).prepareSaDir(opts.home);
    run = await start(opts);
  } catch (e) {
    if (!(e instanceof StartError)) throw e;
    console.error(e.message);
    process.exit(e.exit);
  }
  // Arrêt demandé (Ctrl+C) : sortie propre, code 0.
  const stop = () => { run.server.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
}

if (isMain()) main();
