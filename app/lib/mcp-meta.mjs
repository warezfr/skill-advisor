// meta.json d'une sauvegarde de serveurs MCP (kind: "mcp") : lecture vérifiée et forme publique.
// Les entrées elles-mêmes sont dans servers.json, à côté (0600), jamais dans meta.json ni dans l'état.
import { AGENT_RE } from './util.mjs';

export const MCP_KIND = 'mcp';
const ORIGINS = ['remove', 'manual', 'import', 'replace'];
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
export const validServerName = (n) => typeof n === 'string' && n.length > 0 && n.length <= 200 && !/[\u0000-\u001f\u007f]/.test(n);
const VAR_RE = /^[A-Za-z_]\w{0,127}$/;

// Rend la forme vérifiée, ou null si incohérente.
export function normalizeMcpMeta(raw, id) {
  if (!isObj(raw) || raw.kind !== MCP_KIND || raw.id !== id || !Array.isArray(raw.items) || !raw.items.length) return null;
  const items = [], seen = new Set();
  for (const it of raw.items) {
    if (!isObj(it) || !validServerName(it.name)) return null;
    const scope = it.scope === 'project' ? 'project' : 'global';
    const k = scope + '\u0000' + it.name;
    if (seen.has(k)) return null;
    seen.add(k);
    items.push({
      name: it.name, scope,
      agents: Array.isArray(it.agents) ? it.agents.filter((a) => typeof a === 'string' && AGENT_RE.test(a)) : [],
      secrets: it.secrets === 'kept' ? 'kept' : 'vars',
      vars: Array.isArray(it.vars) ? it.vars.filter((v) => typeof v === 'string' && VAR_RE.test(v)).slice(0, 100) : [],
    });
  }
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 80) : mcpLabel(items.map((i) => i.name));
  return {
    version: 2, kind: MCP_KIND, id, label, note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
    origin: ORIGINS.includes(raw.origin) ? raw.origin : 'manual', at: typeof raw.at === 'string' ? raw.at : '',
    size: Number.isFinite(raw.size) && raw.size >= 0 ? raw.size : 0, items,
  };
}

// Nom par défaut : « Serveurs MCP : github, fetch et 2 autres ».
export function mcpLabel(names) {
  const head = names.slice(0, 2).join(', ');
  const rest = names.length - 2;
  return ('Serveurs MCP : ' + head + (rest > 0 ? ' et ' + rest + (rest > 1 ? ' autres' : ' autre') : '')).slice(0, 80);
}

// Forme publique (Backup), comme celle des skills, avec kind: "mcp".
export function pubMcp(m) {
  const items = m.items.map((i) => ({ name: i.name, scope: i.scope, src: '', agents: i.agents, verdict: null, secrets: i.secrets, vars: i.vars }));
  return { id: m.id, kind: MCP_KIND, label: m.label, note: m.note, origin: m.origin, at: m.at, size: m.size, items, name: items[0].name, src: '', agents: items[0].agents };
}
