#!/usr/bin/env bash
# Skill Advisor: installation script for macOS and Linux.
# It downloads Skill Advisor into a folder of your home directory, checks it, and opens it in your browser.
# It installs no system software and asks for no administrator rights.
set -eu

REPO="https://github.com/warezfr/skill-advisor"
L="${SA_LANG:-}"
DIR="${SA_DIR:-$HOME/skill-advisor}"
USE_GIT=1
OPEN=1

usage() {
  cat <<'EOF'
Skill Advisor: installation script for macOS and Linux.

Usage:  bash install.sh [--lang fr|en] [--dir <folder>] [--no-git] [--no-open]
  --lang     language of the messages, fr or en (asked when absent)
  --dir      installation folder (default: ~/skill-advisor)
  --no-git   download the archive even when git is installed
  --no-open  do not open the browser at the end
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --lang) L="${2:-}"; shift 2 ;;
    --lang=*) L="${1#--lang=}"; shift ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --dir=*) DIR="${1#--dir=}"; shift ;;
    --no-git) USE_GIT=0; shift ;;
    --no-open) OPEN=0; shift ;;
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
step() { printf '\n'; if [ "$L" = fr ]; then printf '[%s/4] %s\n' "$1" "$2"; else printf '[%s/4] %s\n' "$1" "$3"; fi; }
fail() { printf '\n'; if [ "$L" = fr ]; then printf 'Erreur : %s\n' "$1" >&2; else printf 'Error: %s\n' "$2" >&2; fi; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ -z "$DIR" ]; then fail "le dossier d'installation est vide." "the installation folder is empty."; fi

printf '\nSkill Advisor\n'
msg "Installation dans : $DIR" "Installing into: $DIR"

# --- 1. Tools -------------------------------------------------------------------
step 1 "Vérification des outils" "Checking the tools"
GIT=0
if [ "$USE_GIT" = 1 ] && have git; then GIT=1; fi
NODE=0
NODE_V=""
if have node; then
  NODE_V="$(node -v 2>/dev/null || true)"
  major="$(printf '%s' "$NODE_V" | sed 's/^v//; s/\..*//')"
  case "$major" in
    ''|*[!0-9]*) ;;
    *) if [ "$major" -ge 22 ]; then NODE=1; fi ;;
  esac
fi
if [ "$GIT" = 1 ]; then
  msg "  git : présent" "  git: found"
else
  msg "  git : absent ou non utilisé, l'archive sera téléchargée" "  git: missing or not used, the archive will be downloaded"
fi
if [ "$NODE" = 1 ]; then
  msg "  Node.js : $NODE_V" "  Node.js: $NODE_V"
elif [ -n "$NODE_V" ]; then
  msg "  Node.js : $NODE_V, trop ancien (22 ou plus récent requis pour les commandes)" "  Node.js: $NODE_V, too old (22 or later needed for the commands)"
else
  msg "  Node.js : absent. La démonstration marche sans lui. Pour les commandes : https://nodejs.org" "  Node.js: missing. The demonstration works without it. For the commands: https://nodejs.org"
fi

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
elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
  fail "le dossier $DIR existe et contient autre chose. Choisissez un autre dossier avec --dir." "the folder $DIR exists and holds something else. Choose another folder with --dir."
elif [ "$GIT" = 1 ]; then
  if ! git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 clone --depth 1 "$REPO.git" "$DIR"; then
    fail "git clone a échoué. Vérifiez la connexion à Internet." "git clone failed. Check the internet connection."
  fi
else
  if ! have tar; then fail "la commande tar est absente." "the tar command is missing."; fi
  if ! have curl && ! have wget; then fail "il faut git, curl ou wget pour télécharger." "git, curl or wget is needed to download."; fi
  # The archive is unpacked next to the final folder, then moved: an interrupted download leaves nothing half-installed.
  mkdir -p "$(dirname "$DIR")"
  TMP="$(mktemp -d "${DIR%/}.partial.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  if have curl; then
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

# --- 3. Check -------------------------------------------------------------------
step 3 "Contrôle" "Check"
if [ "$NODE" = 1 ]; then
  if out="$(cd "$DIR" && node prototype/test/smoke.mjs 2>&1)"; then
    last="$(printf '%s\n' "$out" | tail -n 1)"
    msg "  Test de l'interface : réussi ($last)" "  Interface test: passed ($last)"
  else
    msg "  Test de l'interface : échec. La démonstration est quand même ouverte." "  Interface test: failed. The demonstration is opened anyway."
  fi
else
  msg "  Test de l'interface sauté : il demande Node.js 22 ou plus récent." "  Interface test skipped: it needs Node.js 22 or later."
fi

# --- 4. Launch ------------------------------------------------------------------
step 4 "Lancement" "Launch"
OPENED=0
if [ "$OPEN" = 1 ]; then
  if [ "$(uname -s)" = Darwin ]; then
    if open "$PAGE"; then OPENED=1; fi
  elif have xdg-open && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    if xdg-open "$PAGE" >/dev/null 2>&1; then OPENED=1; fi
  fi
fi
if [ "$OPENED" = 1 ]; then
  msg "  Skill Advisor est ouvert dans votre navigateur." "  Skill Advisor is open in your browser."
else
  msg "  Ouvrez ce fichier dans votre navigateur :" "  Open this file in your browser:"
  printf '  %s\n' "$PAGE"
fi

printf '\n'
msg "Terminé. L'interface montre une machine d'exemple : rien n'est écrit sur votre disque." "Done. The interface shows an example machine: nothing is written to your disk."
msg "Manuel : $REPO/blob/main/docs/install/INSTALL.fr.md" "Manual: $REPO/blob/main/docs/install/INSTALL.md"
msg "Pour tout retirer : supprimez le dossier $DIR" "To remove everything: delete the folder $DIR"
