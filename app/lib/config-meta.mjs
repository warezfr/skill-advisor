// meta.json d'une sauvegarde de toute la configuration (kind: "config") : lecture vérifiée et forme publique.
// Le dossier tient des parties : skills/ (sauvegarde de skills), mcp/ (sauvegarde de serveurs MCP),
// plugins.json (recette de réinstallation) et settings.json (réglages de Skill Advisor). meta.json n'en garde que le résumé.
import { AGENT_RE, NAME_RE } from './util.mjs';

export const CONFIG_KIND = 'config';
export const PARTS = ['settings', 'skills', 'mcp', 'plugins'];
const ORIGINS = ['manual', 'import'];
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);
const ids = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && AGENT_RE.test(x)))].slice(0, 500) : []);
const VAR_RE = /^[A-Za-z_]\w{0,127}$/;

// Résumé d'une partie, ou null si elle manque.
function part(name, p) {
  if (!isObj(p)) return null;
  if (name === 'skills') {
    return { count: count(p.count), names: Array.isArray(p.names) ? p.names.filter((n) => typeof n === 'string' && NAME_RE.test(n)).slice(0, 5000) : [], agents: ids(p.agents) };
  }
  if (name === 'mcp') {
    return { count: count(p.count), secrets: p.secrets === 'kept' ? 'kept' : 'vars', vars: Array.isArray(p.vars) ? p.vars.filter((v) => typeof v === 'string' && VAR_RE.test(v)).slice(0, 200) : [], agents: ids(p.agents) };
  }
  if (name === 'plugins') return { count: count(p.count), auto: count(p.auto), manual: count(p.manual), hooks: count(p.hooks), agents: ids(p.agents) };
  return { custom: count(p.custom), hidden: count(p.hidden), targets: count(p.targets), agents: ids(p.agents) };
}

// Rend la forme vérifiée, ou null si incohérente.
export function normalizeConfigMeta(raw, id) {
  if (!isObj(raw) || raw.kind !== CONFIG_KIND || raw.id !== id || !isObj(raw.parts)) return null;
  const parts = {};
  for (const n of PARTS) parts[n] = part(n, raw.parts[n]);
  if (!PARTS.some((n) => parts[n])) return null;
  const at = typeof raw.at === 'string' ? raw.at : '';
  const label = typeof raw.label === 'string' && raw.label.trim() && !/[\u0000-\u001f\u007f]/.test(raw.label) ? raw.label.trim().slice(0, 80) : configLabel(at);
  return {
    version: 2, kind: CONFIG_KIND, id, label, note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
    origin: ORIGINS.includes(raw.origin) ? raw.origin : 'manual', at,
    size: Number.isFinite(raw.size) && raw.size >= 0 ? raw.size : 0, parts,
  };
}

// Nom par défaut : « Configuration complète du 16/11/2026 ».
export function configLabel(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return 'Configuration complète';
  const p = (n) => String(n).padStart(2, '0');
  return 'Configuration complète du ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

// Forme publique (Backup) : pas d'items de skills, un résumé par partie.
export function pubConfig(m) {
  return { id: m.id, kind: CONFIG_KIND, label: m.label, note: m.note, origin: m.origin, at: m.at, size: m.size, parts: m.parts, items: [], name: m.label, src: '', agents: [] };
}
