#!/usr/bin/env node
// Contrôle des catalogues avant publication sur la branche catalog-data : forme, taille minimale, étoiles présentes.
// Un catalogue anormalement petit (source en panne, quota GitHub épuisé) arrête la publication : la version en ligne reste.
// Usage : node tools/check-catalogs.mjs <mcp.json> <plugins.json>
import fs from 'node:fs';

export const MIN = { mcpServers: 500, mcpWithStars: 300, plugins: 300 };

// Rend la liste des problèmes (vide si tout va bien).
export function check(mcp, plugins) {
  const bad = [];
  if (!mcp || mcp.kind !== 'mcp' || !Array.isArray(mcp.servers)) bad.push('mcp.json : forme inattendue');
  else {
    if (mcp.servers.length < MIN.mcpServers) bad.push('mcp.json : ' + mcp.servers.length + ' serveurs, moins de ' + MIN.mcpServers);
    const stars = mcp.servers.filter((s) => s.stars).length;
    if (stars < MIN.mcpWithStars) bad.push('mcp.json : ' + stars + ' serveurs avec des étoiles GitHub, moins de ' + MIN.mcpWithStars + ' (jeton ou quota GitHub ?)');
    if (mcp.servers.some((s) => !s.install || !s.score || typeof s.score.total !== 'number')) bad.push('mcp.json : serveur sans installation ou sans note');
  }
  if (!plugins || plugins.kind !== 'plugin' || !Array.isArray(plugins.plugins)) bad.push('plugins.json : forme inattendue');
  else if (plugins.plugins.length < MIN.plugins) bad.push('plugins.json : ' + plugins.plugins.length + ' plugins, moins de ' + MIN.plugins);
  return bad;
}

if (process.argv[1] && process.argv[1].endsWith('check-catalogs.mjs')) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const bad = check(read(process.argv[2]), read(process.argv[3]));
  if (bad.length) { console.error('Catalogues refusés :\n- ' + bad.join('\n- ')); process.exit(1); }
  console.error('Catalogues valables.');
}
