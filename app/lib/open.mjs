// Ouverture du navigateur, sans le code d'ouverture dans les arguments d'un processus.
// Le navigateur reçoit http://127.0.0.1:<port>/start?k=<clé> : une clé de lancement à usage unique, valable 2 minutes.
// Le serveur répond par un renvoi (302) vers l'adresse à usage unique. Une clé lue dans la liste des processus
// ne vaut plus rien après son premier usage, et le code n'apparaît jamais dans un argument.
// Aucun fichier : un navigateur en snap (Firefox sous Ubuntu, Chromium) ne lit pas les dossiers cachés du dossier
// personnel, et un fichier .html peut ouvrir un éditeur sur un poste de développeur.
import { spawn } from 'node:child_process';

// Seule adresse admise : la page de lancement du serveur, avec sa clé.
const ADDRESS = /^http:\/\/127\.0\.0\.1:\d{1,5}\/start\?k=[0-9a-f]{16}$/;

export const MANUAL = 'Le navigateur ne s’est pas ouvert. Ouvrez l’adresse ci-dessus dans votre navigateur.';

// Un écran est-il là ? Linux sans DISPLAY ni WAYLAND_DISPLAY (SSH, serveur) : non.
export function hasScreen(platform = process.platform, env = process.env) {
  if (platform === 'darwin' || platform === 'win32') return true;
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY);
}

// Marche à suivre sur une machine sans écran.
export function headlessHelp(url) {
  const port = new URL(url).port;
  return [
    'Aucun écran détecté : le navigateur ne s’ouvre pas tout seul.',
    'Sur cette machine, ouvrez l’adresse ci-dessus dans un navigateur.',
    'Depuis un autre poste, lancez d’abord : ssh -L ' + port + ':127.0.0.1:' + port + ' <cette machine>',
    'Ouvrez ensuite la même adresse sur cet autre poste.'
  ].join('\n');
}

// Commande qui ouvre une adresse avec le navigateur par défaut. Jamais de shell.
// Windows : rundll32, pour éviter cmd.exe (un shell).
export function openerCommand(url, platform = process.platform) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

function launch(cmd, args) {
  return spawn(cmd, args, { stdio: 'ignore', detached: true });
}

// Ouvre la page de lancement dans le navigateur par défaut. Rend { opened }.
// run(cmd, args) lance la commande ; warn(texte) écrit une aide sur la sortie d'erreur.
export async function openAddress({ url, platform = process.platform, env = process.env, run = launch, warn = () => {} } = {}) {
  if (typeof url !== 'string' || !ADDRESS.test(url)) { warn(MANUAL); return { opened: false }; }
  if (!hasScreen(platform, env)) { warn(headlessHelp(url)); return { opened: false }; }
  let told = false;
  const fail = () => { if (!told) { told = true; warn(MANUAL); } };
  const [cmd, args] = openerCommand(url, platform);
  try {
    const p = run(cmd, args);
    p.on('error', fail);
    // Windows : le code de sortie de rundll32 ne dit rien.
    if (platform !== 'win32') p.on('exit', (code) => { if (code) fail(); });
    if (typeof p.unref === 'function') p.unref();
  } catch { fail(); return { opened: false }; }
  return { opened: true };
}
