#!/usr/bin/env bash
# Skill Advisor: installation script for macOS and Linux.
# It downloads Skill Advisor into a folder of your home directory, checks it, and starts the local application.
# Without Node.js 22.20 or later, it opens the demonstration in your browser instead.
# It installs no system software and asks for no administrator rights.
set -eu

REPO="https://github.com/warezfr/skill-advisor"
L="${SA_LANG:-}"
DIR="${SA_DIR:-$HOME/skill-advisor}"
USE_GIT=1
OPEN=1
DEMO=0
START=1
SRC_DIR=""

usage() {
  cat <<'EOF'
Skill Advisor: installation script for macOS and Linux.

Usage:  bash install.sh [--lang fr|en] [--dir <folder>] [--no-git] [--no-open] [--demo] [--no-start]
  --lang      language of the messages, fr or en (asked when absent)
  --dir       installation folder (default: ~/skill-advisor)
  --no-git    download the archive even when git is installed
  --no-open   do not open the browser
  --demo      open the demonstration only: no dependency, no application
  --no-start  install the application but do not start it
  --source-dir <folder>  for tests only: copy Skill Advisor from this folder instead of downloading it
EOF
}

# An option that takes a value stops the script with a clear message when the value is missing.
need() { if [ $# -lt 2 ] || [ -z "$2" ]; then echo "Missing value / Valeur manquante: $1" >&2; exit 2; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --lang) need "$@"; L="$2"; shift 2 ;;
    --lang=*) L="${1#--lang=}"; shift ;;
    --dir) need "$@"; DIR="$2"; shift 2 ;;
    --dir=*) DIR="${1#--dir=}"; shift ;;
    --no-git) USE_GIT=0; shift ;;
    --no-open) OPEN=0; shift ;;
    --demo) DEMO=1; shift ;;
    --no-start) START=0; shift ;;
    --source-dir) need "$@"; SRC_DIR="$2"; shift 2 ;;
    --source-dir=*) SRC_DIR="${1#--source-dir=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option / Option inconnue: $1" >&2; exit 2 ;;
  esac
done

# --- Language -----------------------------------------------------------------
case "$L" in
  fr|en|"") ;;
  *) echo "Unknown language / Langue inconnue: $L (fr, en)" >&2; exit 2 ;;
esac
if [ -z "$L" ]; then
  TTY=""
  if [ -t 0 ]; then TTY=/dev/stdin
  elif (: < /dev/tty) 2>/dev/null; then TTY=/dev/tty
  fi
  if [ -n "$TTY" ]; then
    printf '\nLangue / Language\n  1) Français\n  2) English\n'
    while [ -z "$L" ]; do
      printf 'Choix / Choice [1-2]: '
      if ! read -r answer < "$TTY"; then answer=2; fi
      case "$answer" in
        1|fr|FR|f|F) L=fr ;;
        2|en|EN|e|E) L=en ;;
      esac
    done
  else
    case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in
      fr*) L=fr ;;
      *) L=en ;;
    esac
  fi
fi

msg() { if [ "$L" = fr ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi; }
step() { printf '\n'; if [ "$L" = fr ]; then printf '[%s/5] %s\n' "$1" "$2"; else printf '[%s/5] %s\n' "$1" "$3"; fi; }
fail() { printf '\n'; if [ "$L" = fr ]; then printf 'Erreur : %s\n' "$1" >&2; else printf 'Error: %s\n' "$2" >&2; fi; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ -z "$DIR" ]; then fail "le dossier d'installation est vide." "the installation folder is empty."; fi
if [ -n "$SRC_DIR" ]; then
  if [ ! -f "$SRC_DIR/prototype/dist/preview.html" ]; then
    fail "le dossier source $SRC_DIR ne contient pas Skill Advisor." "the source folder $SRC_DIR does not hold Skill Advisor."
  fi
  SRC_DIR="$(cd "$SRC_DIR" && pwd)"
fi

printf '\nSkill Advisor\n'
msg "Installation dans : $DIR" "Installing into: $DIR"

# --- 1. Tools -------------------------------------------------------------------
step 1 "Vérification des outils" "Checking the tools"
GIT=0
if [ "$USE_GIT" = 1 ] && have git; then GIT=1; fi
# NODE: Node.js 22 or later, enough for the interface test.
# APP: Node.js 22.20.0 or later and npm, needed by the local application.
NODE=0
APP=0
NODE_V=""
if have node; then
  NODE_V="$(node -v 2>/dev/null || true)"
  major="$(printf '%s' "$NODE_V" | sed 's/^v//; s/\..*//')"
  minor="$(printf '%s' "$NODE_V" | sed 's/^v[0-9]*\.//; s/\..*//')"
  case "$major" in
    ''|*[!0-9]*) ;;
    *)
      if [ "$major" -ge 22 ]; then NODE=1; fi
      case "$minor" in
        ''|*[!0-9]*) ;;
        *) if [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 20 ]; }; then APP=1; fi ;;
      esac
      ;;
  esac
fi
NPM=0
if have npm; then NPM=1; fi
if [ "$GIT" = 1 ]; then
  msg "  git : présent" "  git: found"
else
  msg "  git : absent ou non utilisé, l'archive sera téléchargée" "  git: missing or not used, the archive will be downloaded"
fi
if [ "$APP" = 1 ]; then
  msg "  Node.js : $NODE_V" "  Node.js: $NODE_V"
elif [ -n "$NODE_V" ]; then
  msg "  Node.js : $NODE_V, trop ancien (22.20 ou plus récent requis pour l'application)" "  Node.js: $NODE_V, too old (22.20 or later needed for the application)"
else
  msg "  Node.js : absent. La démonstration marche sans lui. Pour l'application : https://nodejs.org" "  Node.js: missing. The demonstration works without it. For the application: https://nodejs.org"
fi
if [ -n "$NODE_V" ]; then
  if [ "$NPM" = 1 ]; then
    msg "  npm : présent" "  npm: found"
  else
    msg "  npm : absent. L'application en a besoin. Il est fourni avec Node.js : https://nodejs.org" "  npm: missing. The application needs it. It comes with Node.js: https://nodejs.org"
  fi
fi
if [ "$NPM" = 0 ]; then APP=0; fi

# --- 2. Download ----------------------------------------------------------------
# A stalled connection is dropped after 30 seconds instead of waiting forever. git never asks for a password here.
export GIT_TERMINAL_PROMPT=0
step 2 "Téléchargement" "Download"
PAGE="$DIR/prototype/dist/preview.html"
ARCHIVE="$REPO/archive/refs/heads/main.tar.gz"
if [ -d "$DIR/.git" ] && [ "$GIT" = 1 ]; then
  msg "  Dossier déjà installé avec git : mise à jour." "  Folder already installed with git: updating."
  if ! git -C "$DIR" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 pull --ff-only; then
    msg "  Mise à jour impossible : la version déjà présente est gardée." "  Update failed: the version already there is kept."
  fi
elif [ -f "$PAGE" ]; then
  msg "  Skill Advisor est déjà dans ce dossier : il est gardé tel quel." "  Skill Advisor is already in this folder: it is kept as it is."
  # Copie sans git et sans app/server.mjs : ancienne version, le script ne la met pas à jour.
  if [ ! -f "$DIR/app/server.mjs" ]; then
    msg "  Ce dossier contient une ancienne version, sans l'application. Le script ne la met pas à jour." "  This folder holds an older version, without the application. The script does not update it."
    msg "  Pour une nouvelle installation, supprimez ce dossier ou choisissez-en un autre avec --dir." "  Delete this folder, or choose another one with --dir for a fresh installation."
  fi
elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
  fail "le dossier $DIR existe et contient autre chose. Choisissez un autre dossier avec --dir." "the folder $DIR exists and holds something else. Choose another folder with --dir."
elif [ -z "$SRC_DIR" ] && [ "$GIT" = 1 ]; then
  if ! git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 clone --depth 1 "$REPO.git" "$DIR"; then
    fail "git clone a échoué. Vérifiez la connexion à Internet." "git clone failed. Check the internet connection."
  fi
else
  if ! have tar; then fail "la commande tar est absente." "the tar command is missing."; fi
  if [ -z "$SRC_DIR" ] && ! have curl && ! have wget; then fail "il faut git, curl ou wget pour télécharger." "git, curl or wget is needed to download."; fi
  # The archive is unpacked next to the final folder, then moved: an interrupted download leaves nothing half-installed.
  mkdir -p "$(dirname "$DIR")"
  TMP="$(mktemp -d "${DIR%/}.partial.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  if [ -n "$SRC_DIR" ]; then
    # Tests only: copy of a local folder, without its git history and its dependencies.
    if ! (cd "$SRC_DIR" && tar -cf - --exclude=.git --exclude=node_modules .) | tar -xf - -C "$TMP"; then
      fail "la copie depuis $SRC_DIR a échoué." "the copy from $SRC_DIR failed."
    fi
  elif have curl; then
    if ! curl -fsSL --connect-timeout 20 --speed-limit 1000 --speed-time 30 "$ARCHIVE" | tar -xzf - --strip-components=1 -C "$TMP"; then
      fail "le téléchargement a échoué. Vérifiez la connexion à Internet." "the download failed. Check the internet connection."
    fi
  elif ! wget -qO- "$ARCHIVE" | tar -xzf - --strip-components=1 -C "$TMP"; then
    fail "le téléchargement a échoué. Vérifiez la connexion à Internet." "the download failed. Check the internet connection."
  fi
  if [ ! -f "$TMP/prototype/dist/preview.html" ]; then
    fail "l'archive téléchargée est incomplète. Relancez le script." "the downloaded archive is incomplete. Run the script again."
  fi
  if [ -d "$DIR" ]; then rmdir "$DIR"; fi
  mv "$TMP" "$DIR"
  trap - EXIT
fi
if [ ! -f "$PAGE" ]; then
  fail "le fichier $PAGE est introuvable après le téléchargement." "the file $PAGE is missing after the download."
fi
msg "  Prêt dans $DIR" "  Ready in $DIR"

# --- 3. Dependencies ------------------------------------------------------------
# READY=1: the application can start (Node.js, npm, app/server.mjs and its dependency are there).
step 3 "Dépendances" "Dependencies"
READY=0
if [ "$DEMO" = 1 ]; then
  msg "  Mode démonstration (--demo) : rien à installer." "  Demonstration mode (--demo): nothing to install."
elif [ "$APP" = 0 ]; then
  msg "  Sautées : l'application demande Node.js 22.20 ou plus récent et npm." "  Skipped: the application needs Node.js 22.20 or later and npm."
elif [ ! -f "$DIR/app/server.mjs" ]; then
  msg "  Sautées : cette copie de Skill Advisor ne contient pas encore l'application." "  Skipped: this copy of Skill Advisor does not hold the application yet."
else
  if [ -f "$DIR/package-lock.json" ]; then
    NPM_CMD=ci
  else
    NPM_CMD=install
  fi
  if (cd "$DIR" && npm "$NPM_CMD" --omit=dev --no-audit --no-fund); then
    if [ -d "$DIR/node_modules/skills" ]; then
      READY=1
      msg "  Dépendances installées dans $DIR/node_modules" "  Dependencies installed in $DIR/node_modules"
    else
      msg "  Le paquet skills est absent après npm. La démonstration sera ouverte à la place." "  The skills package is missing after npm. The demonstration will open instead."
    fi
  else
    msg "  npm a échoué. Vérifiez la connexion à Internet. La démonstration sera ouverte à la place." "  npm failed. Check the internet connection. The demonstration will open instead."
  fi
fi

# --- 4. Check -------------------------------------------------------------------
step 4 "Contrôle" "Check"
if [ "$NODE" = 1 ]; then
  if out="$(cd "$DIR" && node prototype/test/smoke.mjs 2>&1)"; then
    last="$(printf '%s\n' "$out" | tail -n 1)"
    msg "  Test de l'interface : réussi ($last)" "  Interface test: passed ($last)"
  else
    msg "  Test de l'interface : échec. L'installation continue." "  Interface test: failed. The installation goes on."
  fi
else
  msg "  Test de l'interface sauté : il demande Node.js 22 ou plus récent." "  Interface test skipped: it needs Node.js 22 or later."
fi

# --- 5. Launch ------------------------------------------------------------------
step 5 "Lancement" "Launch"
if [ "$READY" = 1 ]; then
  # The application runs in the foreground: everything is said before it starts.
  if [ "$START" = 1 ]; then
    msg "  Démarrage de l'application locale. Elle affiche son adresse et ouvre votre navigateur." "  Starting the local application. It prints its address and opens your browser."
    if [ "$OPEN" = 0 ]; then
      msg "  Le navigateur n'est pas ouvert (--no-open) : ouvrez l'adresse affichée ci-dessous." "  The browser is not opened (--no-open): open the address printed below."
    fi
  else
    msg "  Démarrage sauté (--no-start)." "  Start skipped (--no-start)."
  fi
  printf '\n'
  msg "Skill Advisor lit et modifie les vrais skills de vos agents." "Skill Advisor reads and changes the real skills of your agents."
  msg "Pour la démonstration seule, sans rien écrire : bash install.sh --demo" "For the demonstration only, with nothing written: bash install.sh --demo"
  msg "Pour lancer l'application plus tard :" "To start the application again later:"
  printf '  cd %s\n  npm start\n' "$DIR"
  msg "Manuel : $REPO/blob/main/docs/install/INSTALL.fr.md" "Manual: $REPO/blob/main/docs/install/INSTALL.md"
  msg "Pour tout retirer : réactivez vos skills désactivés, puis supprimez le dossier $DIR et le dossier ~/.skill-advisor" "To remove everything: enable your disabled skills, then delete the folder $DIR and the folder ~/.skill-advisor"
  if [ "$START" = 1 ]; then
    printf '\n'
    msg "L'application tourne jusqu'à ce que vous appuyiez sur Ctrl+C." "The application runs until you press Ctrl+C."
    cd "$DIR"
    if [ "$OPEN" = 1 ]; then
      exec node app/server.mjs
    else
      exec node app/server.mjs --no-open
    fi
  fi
  exit 0
fi

OPENED=0
if [ "$OPEN" = 1 ]; then
  if [ "$(uname -s)" = Darwin ]; then
    if open "$PAGE"; then OPENED=1; fi
  elif have xdg-open && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    if xdg-open "$PAGE" >/dev/null 2>&1; then OPENED=1; fi
  fi
fi
if [ "$OPENED" = 1 ]; then
  msg "  La démonstration est ouverte dans votre navigateur." "  The demonstration is open in your browser."
else
  msg "  Ouvrez ce fichier dans votre navigateur :" "  Open this file in your browser:"
  printf '  %s\n' "$PAGE"
fi
if [ "$DEMO" = 0 ] && [ "$APP" = 0 ]; then
  msg "  L'application réelle demande Node.js 22.20 ou plus récent, avec npm : https://nodejs.org" "  The real application needs Node.js 22.20 or later, with npm: https://nodejs.org"
fi

printf '\n'
msg "Terminé. La démonstration montre une machine d'exemple : rien n'est écrit sur votre disque." "Done. The demonstration shows an example machine: nothing is written to your disk."
msg "Manuel : $REPO/blob/main/docs/install/INSTALL.fr.md" "Manual: $REPO/blob/main/docs/install/INSTALL.md"
msg "Pour tout retirer : supprimez le dossier $DIR" "To remove everything: delete the folder $DIR"
