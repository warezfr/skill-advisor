#!/usr/bin/env node
// Contrôle statique d'un skill avant installation.
// Il lit les fichiers comme du texte et ne les exécute jamais.
// Usage : node tools/skill-scan.mjs <dossier> [--json]
//   <dossier> contient un sous-dossier par skill (SKILL.md, scripts…).
// Ce contrôle repère des motifs connus. Il ne prouve pas qu'un skill est sûr :
// un verdict vert veut dire « aucun motif connu trouvé », pas « sans risque ».

import fs from 'node:fs';
import path from 'node:path';

const SEV = { high: 3, medium: 2, low: 1 };

// À augmenter à chaque changement de règle : la collecte recontrôle alors tous les skills.
export const SCAN_VERSION = 4;

// applies : 'all' = tout fichier, 'script' = fichiers de code seulement, 'doc' = Markdown et texte
export const RULES = [
  { id: 'DL_EXEC', sev: 'high', applies: 'all', label: 'Télécharge un programme et l’exécute aussitôt',
    soften: /never\s+run|do\s+not\s+run|don['’]t\s+run|data,?\s+not\s+instructions|example\.(com|org)|<[a-z][a-z-]*>/i,
    softLabel: 'Cite une commande de téléchargement-exécution sans la demander',
    re: [/\b(curl|wget)\b[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z|da)?sh\b(?!\s+[\w.\/-]+\.(sh|bash)\b)/i, /\b(ba|z)?sh\s+<\(\s*(curl|wget)\b/i, /\b(irm|iwr|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]{0,200}\|\s*(iex|Invoke-Expression)\b/i, /\b(iex|Invoke-Expression)\s*\(?\s*\(?\s*(irm|iwr|New-Object\s+Net\.WebClient)/i] },
  { id: 'OBFUSCATION', sev: 'high', applies: 'all', label: 'Code masqué puis exécuté',
    re: [/base64\s+(-d|-D|--decode)\b[^\n]{0,80}\|\s*(ba|z)?sh\b/i, /\beval\s*\(\s*atob\s*\(/i, /\bexec\s*\(\s*base64\.b64decode/i, /\beval\s+["']?\$\([^)\n]{0,120}(curl|wget|base64)/i] },
  { id: 'PROMPT_INJECTION', sev: 'high', applies: 'all', label: 'Consigne qui cherche à contourner l’utilisateur ou les règles de l’agent',
    // Un skill qui cite la phrase pour s'en défendre n'est pas une attaque : le constat reste affiché, en simple remarque.
    soften: /context,?\s+not\s+commands|avoid\s+[^.]{0,80}language|override-style|data,?\s+not\s+instructions|flag\s+it|as\s+(inert|untrusted)|if\s+a\s+(file|page|document|comment|source|tool)\s+(tries|says|tells|contains)|prompt[- ]injection|never\s+follow|do\s+not\s+follow/i,
    softLabel: 'Cite une phrase d’injection pour s’en défendre',
    re: [/ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts)/i, /do\s+not\s+(tell|inform|notify)\s+the\s+user\s+(about\s+(this|these|the)|that\s+(you|this|we)|what\s+you)|do\s+not\s+(mention|reveal)\s+(this|these|it)\s+to\s+the\s+user/i, /without\s+(asking|telling|informing|notifying)\s+the\s+user/i, /(hide|conceal)\s+(this|these|it|that)\s+from\s+the\s+user/i, /disregard\s+(your|the|all)\s+(system|safety|previous)/i, /you\s+are\s+now\s+(in\s+)?(developer|dan|jailbreak|unrestricted)\s+mode/i] },
  { id: 'HIDDEN_TEXT', sev: 'high', applies: 'all', label: 'Caractères invisibles ou commentaire caché contenant des consignes',
    re: [/[‪-‮⁦-⁩]/, /[​‌⁠-⁤]{2,}/, /([​‌⁠-⁤][^​‌⁠-⁤]*){4,}/, /<!--[^>]{0,400}?(ignore\s+(previous|all)|system\s+prompt|do\s+not\s+tell|secretly)[^>]{0,200}?-->/i] },
  { id: 'SECRET_FILES', sev: 'medium', applies: 'all', label: 'Mentionne des fichiers d’identifiants',
    re: [/~\/\.ssh\b|\bid_(rsa|ed25519|ecdsa)\b/, /\.aws\/credentials|\.netrc\b|\.npmrc\b|\.docker\/config\.json/, /security\s+find-(generic|internet)-password/, /\bkeychain\b[^\n]{0,60}(dump|export|password)/i] },
  { id: 'EXFILTRATION', sev: 'medium', applies: 'all', label: 'Envoie des données vers l’extérieur',
    re: [/\bcurl\s[^\n]{0,240}\s(-d|--data|--data-binary|--data-raw|-F|--form|-T|--upload-file)\s/i, /\b(nc|ncat|netcat)\s+(-[a-z]+\s+)*[\w.-]+\s+\d{2,5}\b/i, /(webhook\.site|requestbin|pipedream\.net|\.ngrok\.(io|app)|discord(app)?\.com\/api\/webhooks|pastebin\.com|transfer\.sh)/i] },
  { id: 'PRIVILEGE', sev: 'medium', applies: 'all', label: 'Commande à privilèges ou destructrice',
    re: [/(^|[\s;&|`(])sudo\s+\S/m, /chmod\s+(-R\s+)?0?777\b/, /rm\s+-(rf|fr)\s+(\/|~|\$HOME)(\s|\/?\*|$)/m, /git\s+push\s+[^\n]{0,40}(--force\b|-f\b)/, /--dangerously-skip-permissions|--allow-dangerously/] },
  { id: 'SUSPECT_URL', sev: 'medium', applies: 'all', label: 'Adresse raccourcie ou adresse IP brute',
    re: [/https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy)\//i, /https?:\/\/(?!127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|\b)/] },
  { id: 'SCRIPT_NETWORK', sev: 'low', applies: 'script', label: 'Un script du skill appelle le réseau',
    re: [/\b(fetch|axios|XMLHttpRequest)\s*\(|\brequests\.(get|post|put)\s*\(|\burllib\.request\b|\bhttp\.client\b|\bhttpx\.|\b(curl|wget)\s+-?\S/] },
  { id: 'INSTALLS', sev: 'low', applies: 'all', label: 'Demande d’installer un programme',
    re: [/\b(npm|pnpm|yarn|bun)\s+(i|install|add)\s+(-g|--global)\b/, /\bpip3?\s+install\b/, /\bbrew\s+install\b/, /\bnpx\s+(-y\s+|--yes\s+)?[@a-z]/, /\b(uvx|pipx)\s+\S|\buv\s+(tool\s+install|pip\s+install)\b/, /\bcargo\s+install\b|\bgo\s+install\b|\bapt(-get)?\s+install\b/] },
  { id: 'ENV_FILE', sev: 'low', applies: 'all', label: 'Mentionne un fichier .env ou des clés d’API',
    re: [/(^|[\s"'`/(])\.env(\.local|\.production)?\b(?!\.example)/m, /\b[A-Z][A-Z0-9_]{2,}_(API_KEY|SECRET|TOKEN)\b/] },
];

const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|ps1|pl|php)(\.txt)?$/i;
const TEXT_EXT = /\.(md|markdown|txt)$/i;
// Morceaux de ligne : le chevauchement (CHUNK - STEP) dépasse la plus longue portée d'un motif (environ 650).
const CHUNK = 4000;
const STEP = 3000;
// Taille lue au début et à la fin d'un fichier trop gros.
const MAX_BYTES = 400000;

export function scanText(text, file) {
  const isScript = SCRIPT_EXT.test(file);
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const rule of RULES) {
    if (rule.applies === 'script' && !isScript) continue;
    if (rule.applies === 'doc' && isScript) continue;
    let hits = 0;
    const push = (part, i, shown) => {
      const soft = rule.soften && rule.soften.test(part);
      out.push({ rule: soft ? rule.id + '_QUOTED' : rule.id, sev: soft ? 'low' : rule.sev, label: soft ? rule.softLabel : rule.label, file, line: i + 1, excerpt: shown.trim().replace(/[​-‏‪-‮⁠-⁤]/g, '␣').slice(0, 160) });
      hits++;
    };
    for (let i = 0; i < lines.length && hits < 3; i++) {
      let line = i === 0 ? lines[i].replace(/^﻿/, '') : lines[i];
      // Ligne longue : les suites d'espaces sont réduites, sinon elles écartent un motif au-delà du chevauchement.
      if (line.length > CHUNK) line = line.replace(/\s{2,}/g, ' ');
      if (line.length <= CHUNK) {
        if (rule.re.some((re) => re.test(line))) push(line, i, line);
        continue;
      }
      // Ligne très longue (minifiée ou gonflée) : morceaux qui se chevauchent, une constatation au plus par ligne.
      for (let s = 0; s < line.length; s += STEP) {
        const part = line.slice(s, s + CHUNK);
        let m = null;
        for (const re of rule.re) if ((m = re.exec(part))) break;
        if (m) { push(part, i, part.slice(Math.max(0, m.index - 40))); break; }
        if (s + CHUNK >= line.length) break;
      }
    }
  }
  return out;
}

export function verdict(findings) {
  const ids = new Set(findings.map((f) => f.rule));
  const high = findings.some((f) => f.sev === 'high');
  const medium = findings.some((f) => f.sev === 'medium');
  if (high || (ids.has('SECRET_FILES') && ids.has('EXFILTRATION'))) return 'rouge';
  if (medium) return 'orange';
  if (findings.length) return 'vert-remarques';
  return 'vert';
}

// Lit tout le fichier, ou son début et sa fin s'il dépasse deux fois MAX_BYTES.
function readParts(p, size) {
  if (size <= 2 * MAX_BYTES) return [fs.readFileSync(p).toString('utf8')];
  const fd = fs.openSync(p, 'r');
  try {
    const head = Buffer.alloc(MAX_BYTES), tail = Buffer.alloc(MAX_BYTES);
    const h = fs.readSync(fd, head, 0, MAX_BYTES, 0);
    const t = fs.readSync(fd, tail, 0, MAX_BYTES, size - MAX_BYTES);
    return [head.subarray(0, h).toString('utf8'), tail.subarray(0, t).toString('utf8')]; // lignes de la fin : numérotées depuis le début du morceau
  } finally { fs.closeSync(fd); }
}

export function scanSkillDir(dir) {
  const rootReal = fs.realpathSync(dir);
  const inside = (real) => {
    const r = path.relative(rootReal, real);
    return r === '' || (r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r));
  };
  const files = [];
  const findings = [];
  const seen = new Set([rootReal]); // évite les boucles et les doublons de liens
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      let real, st;
      try { real = fs.realpathSync(p); st = fs.statSync(real); } catch { continue; } // lien cassé
      if (e.isSymbolicLink() && !inside(real)) {
        let target = '';
        try { target = fs.readlinkSync(p); } catch {}
        findings.push({ rule: 'LINK_OUTSIDE', sev: 'medium', label: 'Lien vers un fichier hors du skill', file: path.relative(dir, p), line: 1, excerpt: target.slice(0, 160) });
        continue;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) files.push({ p, size: st.size });
    }
  };
  walk(dir);
  for (const { p, size } of files) {
    const rel = path.relative(dir, p);
    let parts;
    try { parts = readParts(p, size); } catch { continue; }
    const nulAt = parts.findIndex((t) => t.includes('\u0000'));
    // Binaire (image, police, archive…) : ni lu ni signalé, même gros. Un agent ne le lit pas comme consigne.
    if (nulAt >= 0 && !TEXT_EXT.test(rel) && !SCRIPT_EXT.test(rel)) continue;
    if (size > MAX_BYTES) findings.push({ rule: 'OVERSIZE', sev: 'medium', label: 'Fichier très gros, contrôlé en partie', file: rel, line: 1, excerpt: '' });
    if (nulAt >= 0) {
      const t = parts[nulAt];
      const line = t.slice(0, t.indexOf('\u0000')).split('\n').length;
      findings.push({ rule: 'BINARY_TEXT', sev: 'high', label: 'Fichier texte qui contient des octets nuls', file: rel, line, excerpt: '' });
      parts = parts.map((x) => x.replace(/\u0000/g, ''));
    }
    for (const t of parts) findings.push(...scanText(t, rel));
  }
  findings.sort((a, b) => SEV[b.sev] - SEV[a.sev]);
  return { files: files.length, verdict: verdict(findings), findings };
}

if (process.argv[1] && process.argv[1].endsWith('skill-scan.mjs')) {
  const root = process.argv[2];
  if (!root) { console.error('Usage : node tools/skill-scan.mjs <dossier> [--json]'); process.exit(2); }
  const res = {};
  for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) res[e.name] = scanSkillDir(path.join(root, e.name));
  if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else {
    const n = { vert: 0, 'vert-remarques': 0, orange: 0, rouge: 0 };
    for (const [name, r] of Object.entries(res)) { n[r.verdict]++; if (r.verdict === 'rouge' || r.verdict === 'orange') console.log(r.verdict.toUpperCase().padEnd(7), name, '·', [...new Set(r.findings.filter((f) => f.sev !== 'low').map((f) => f.rule))].join(', ')); }
    console.log('\nTotal', Object.keys(res).length, '·', Object.entries(n).map(([k, v]) => k + ' ' + v).join(' · '));
  }
}
