// Pilote Chrome sans dépendance : protocole DevTools sur WebSocket (global depuis Node 22).
// Trouve Chrome ou Chromium (ou Edge) sur macOS, Linux et Windows, ou prend CHROME_PATH.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Attend qu'une fonction rende une valeur vraie ; échoue avec un message clair après `ms`.
export async function until(fn, what, ms = 15000, every = 100) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try { last = await fn(); } catch (e) { last = e; }
    if (last && !(last instanceof Error)) return last;
    if (Date.now() - t0 > ms) {
      throw new Error('Délai dépassé (' + ms + ' ms) : ' + what + (last instanceof Error ? ' (' + last.message + ')' : ''));
    }
    await sleep(every);
  }
}

// Cherche un exécutable dans PATH, sans shell.
function inPath(names) {
  const dirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* absent */ }
    }
  }
  return null;
}

// Chemin du navigateur, ou null. CHROME_PATH passe avant tout.
export function findChrome() {
  if (process.env.CHROME_PATH) return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  let list = [];
  if (process.platform === 'darwin') {
    list = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium',
      'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      .flatMap((a) => ['/Applications/' + a, path.join(process.env.HOME || '', 'Applications', a)]);
  } else if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
    list = roots.flatMap((r) => [path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(r, 'Chromium', 'Application', 'chrome.exe'), path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]);
    const p = inPath(['chrome.exe', 'msedge.exe']);
    if (p) list.push(p);
  } else {
    const p = inPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge']);
    if (p) list.push(p);
    list.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium');
  }
  return list.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// Lance le navigateur sans fenêtre. profile et downloads : dossiers jetables sous os.tmpdir().
export async function launch({ chrome, profile, downloads, width = 1440, height = 900 }) {
  fs.mkdirSync(profile, { recursive: true });
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--window-size=' + width + ',' + height, '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-extensions',
    '--mute-audio', '--password-store=basic', '--use-mock-keychain', '--hide-scrollbars', 'about:blank'];
  // Les machines Linux d'intégration continue refusent le bac à sable de Chrome.
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  const portFile = path.join(profile, 'DevToolsActivePort');
  let ws;
  try {
    const lines = await until(() => {
      if (proc.exitCode !== null) throw new Error('Chrome s\'est arrêté : ' + err.slice(-400));
      const t = fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
      return t && t.length >= 2 && t;
    }, 'démarrage de Chrome', 30000);
    ws = new WebSocket('ws://127.0.0.1:' + lines[0] + lines[1]);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket DevTools refusé')); });
  } catch (e) {
    // Chrome ne reste jamais derrière un démarrage manqué (sinon le job de CI attend jusqu'à son délai).
    proc.kill('SIGKILL');
    throw e;
  }

  let id = 0;
  const wait = new Map();
  const listeners = new Set();
  ws.onmessage = (m) => {
    const d = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString('utf8'));
    if (d.id && wait.has(d.id)) {
      const [r, j, method] = wait.get(d.id);
      wait.delete(d.id);
      if (d.error) j(new Error(method + ' : ' + d.error.message)); else r(d.result);
      return;
    }
    for (const l of listeners) l(d);
  };
  const send = (method, params = {}, sessionId) => new Promise((r, j) => {
    const i = ++id;
    wait.set(i, [r, j, method]);
    ws.send(JSON.stringify(sessionId ? { id: i, method, params, sessionId } : { id: i, method, params }));
  });

  if (downloads) {
    fs.mkdirSync(downloads, { recursive: true });
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  }

  // Ouvre un onglet et rend son pilote.
  async function tab(url = 'about:blank') {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    const errors = [];
    let loaded = 0;
    listeners.add((d) => {
      if (d.sessionId !== sessionId) return;
      if (d.method === 'Page.loadEventFired') loaded++;
      if (d.method === 'Runtime.exceptionThrown') errors.push('exception : ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300));
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console : ' + d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push('journal : ' + d.params.entry.text.slice(0, 300));
    });
    await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable'); await s('DOM.enable');
    // Compte les requêtes en cours de la page : « au repos » quand il n'y en a plus.
    await s('Page.addScriptToEvaluateOnNewDocument', { source:
      '(function(){var f=window.fetch;window.__saPending=0;window.fetch=function(){window.__saPending++;' +
      'return f.apply(this,arguments).finally(function(){window.__saPending--;});};})();' });
    const t = {
      targetId, errors, send: s,
      async js(expr) {
        const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('Script de test : ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
      },
      async size(w, h) { await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
      async goto(u) {
        const before = loaded;
        await s('Page.navigate', { url: u });
        await until(() => loaded > before, 'chargement de ' + u.replace(/c=[0-9a-f]+/, 'c=…'));
      },
      async reload() {
        const before = loaded;
        await s('Page.reload', {});
        await until(() => loaded > before, 'rechargement');
      },
      // Attend la fin des requêtes de la page, puis un court repos (rendu).
      async idle(ms = 20000) {
        await until(() => t.js('window.__saPending === 0'), 'fin des requêtes de la page', ms);
        await sleep(120);
        await until(() => t.js('window.__saPending === 0'), 'fin des requêtes de la page', ms);
      },
      // Vrai clic souris au centre de l'élément (le focus suit, comme pour une personne).
      async click(sel) {
        const c = await until(() => t.js(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
          if (!e || e.disabled) return null; e.scrollIntoView({ block: 'center', inline: 'nearest' });
          const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null;
          const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
          /* Un autre élément au-dessus (volet, voile) : une personne ne pourrait pas cliquer. */
          if (!hit || !(hit === e || e.contains(hit) || (hit.closest && hit.closest('label') && hit.closest('label').contains(e)))) return null;
          return { x, y }; })()`), 'élément cliquable et non recouvert ' + sel, 10000);
        const base = { x: c.x, y: c.y, button: 'left', clickCount: 1 };
        await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
        await s('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
        await s('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
      },
      // Vraie frappe clavier sur l'élément qui a le focus.
      async key(key, code, vk) {
        await s('Input.dispatchKeyEvent', { type: 'keyDown', key, code: code || key, windowsVirtualKeyCode: vk || 0, text: key.length === 1 ? key : undefined });
        await s('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code || key, windowsVirtualKeyCode: vk || 0 });
      },
      async type(text) { await s('Input.insertText', { text }); },
      // Donne des fichiers à un <input type=file> (comme le sélecteur de fichiers).
      async setFiles(sel, files) {
        const { root } = await s('DOM.getDocument', { depth: 0 });
        const { nodeId } = await s('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
        if (!nodeId) throw new Error('Champ de fichier introuvable : ' + sel);
        await s('DOM.setFileInputFiles', { nodeId, files });
      },
      async close() { try { await send('Target.closeTarget', { targetId }); } catch { /* déjà fermé */ } },
    };
    if (url !== 'about:blank') await t.goto(url);
    return t;
  }

  return {
    tab,
    async close() {
      try { await Promise.race([send('Browser.close'), sleep(2000)]); } catch { /* déjà fermé */ }
      try { ws.close(); } catch { /* rien */ }
      if (proc.exitCode === null) {
        await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(3000)]);
        if (proc.exitCode === null) proc.kill('SIGKILL');
      }
    },
  };
}
