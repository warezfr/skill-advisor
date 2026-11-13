<#
Skill Advisor: installation script for Windows.
It downloads Skill Advisor into a folder of your user profile, checks it, and opens it in your browser.
It installs no system software and asks for no administrator rights.

Usage:  powershell -ExecutionPolicy Bypass -File install.ps1 [-Lang fr|en] [-Dir <folder>] [-NoGit] [-NoOpen]
  -Lang    language of the messages, fr or en (asked when absent)
  -Dir     installation folder (default: skill-advisor in your user profile)
  -NoGit   download the archive even when git is installed
  -NoOpen  do not open the browser at the end
#>
param(
  [string]$Lang = $env:SA_LANG,
  [string]$Dir = $env:SA_DIR,
  [switch]$NoGit,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'https://github.com/warezfr/skill-advisor'
if (-not $Dir) { $Dir = Join-Path $HOME 'skill-advisor' }

# French texts use \u escapes so that this file stays plain ASCII:
# Windows PowerShell 5.1 misreads accented letters in a script saved without a byte-order mark.
function T([string]$fr, [string]$en) { if ($Lang -eq 'fr') { [regex]::Unescape($fr) } else { $en } }
function Say([string]$fr, [string]$en) { Write-Host (T $fr $en) }
function Step([int]$n, [string]$fr, [string]$en) { Write-Host ''; Write-Host ("[$n/4] " + (T $fr $en)) }
function Fail([string]$fr, [string]$en) { throw (New-Object System.InvalidOperationException (T $fr $en)) }
function Have([string]$name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

try {
  # --- Language ---------------------------------------------------------------
  if ($Lang -and ($Lang -ne 'fr') -and ($Lang -ne 'en')) {
    $bad = $Lang; $Lang = 'en'
    Fail "langue inconnue : $bad (fr, en)" "unknown language: $bad (fr, en)"
  }
  if (-not $Lang) {
    $canAsk = $false
    try { $canAsk = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected } catch { $canAsk = $false }
    if ($canAsk) {
      Write-Host ''
      Write-Host 'Langue / Language'
      Write-Host ([regex]::Unescape('  1) Fran\u00e7ais'))
      Write-Host '  2) English'
      while (-not $Lang) {
        $answer = (Read-Host 'Choix / Choice [1-2]').Trim().ToLower()
        if ($answer -eq '1' -or $answer -eq 'fr' -or $answer -eq 'f') { $Lang = 'fr' }
        elseif ($answer -eq '2' -or $answer -eq 'en' -or $answer -eq 'e') { $Lang = 'en' }
      }
    }
    elseif ((Get-Culture).Name -like 'fr*') { $Lang = 'fr' }
    else { $Lang = 'en' }
  }

  Write-Host ''
  Write-Host 'Skill Advisor'
  Write-Host ((T 'Installation dans : ' 'Installing into: ') + $Dir)

  # --- 1. Tools -----------------------------------------------------------------
  Step 1 'V\u00e9rification des outils' 'Checking the tools'
  $git = (-not $NoGit) -and (Have 'git')
  $node = $false
  $nodeV = ''
  if (Have 'node') {
    $nodeV = [string](& node -v)
    if ($nodeV -match '^v(\d+)\.') { $node = ([int]$Matches[1] -ge 22) }
  }
  if ($git) { Say '  git : pr\u00e9sent' '  git: found' }
  else { Say "  git : absent ou non utilis\u00e9, l'archive sera t\u00e9l\u00e9charg\u00e9e" '  git: missing or not used, the archive will be downloaded' }
  if ($node) { Write-Host ((T '  Node.js : ' '  Node.js: ') + $nodeV) }
  elseif ($nodeV) { Write-Host ((T '  Node.js : ' '  Node.js: ') + $nodeV + (T ', trop ancien (22 ou plus r\u00e9cent requis pour les commandes)' ', too old (22 or later needed for the commands)')) }
  else { Say '  Node.js : absent. La d\u00e9monstration marche sans lui. Pour les commandes : https://nodejs.org' '  Node.js: missing. The demonstration works without it. For the commands: https://nodejs.org' }

  # --- 2. Download --------------------------------------------------------------
  # A stalled connection is dropped after 30 seconds. git never asks for a password here.
  Step 2 'T\u00e9l\u00e9chargement' 'Download'
  $env:GIT_TERMINAL_PROMPT = '0'
  $page = Join-Path $Dir 'prototype\dist\preview.html'
  if ($git -and (Test-Path (Join-Path $Dir '.git'))) {
    Say '  Dossier d\u00e9j\u00e0 install\u00e9 avec git : mise \u00e0 jour.' '  Folder already installed with git: updating.'
    & git -C $Dir -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 pull --ff-only | Out-Host
    if ($LASTEXITCODE -ne 0) { Say '  Mise \u00e0 jour impossible : la version d\u00e9j\u00e0 pr\u00e9sente est gard\u00e9e.' '  Update failed: the version already there is kept.' }
  }
  elseif (Test-Path $page) {
    Say '  Skill Advisor est d\u00e9j\u00e0 dans ce dossier : il est gard\u00e9 tel quel.' '  Skill Advisor is already in this folder: it is kept as it is.'
  }
  elseif ((Test-Path $Dir) -and (Get-ChildItem -Force -LiteralPath $Dir | Select-Object -First 1)) {
    Fail 'le dossier d\u2019installation existe et contient autre chose. Choisissez un autre dossier avec -Dir.' 'the installation folder exists and holds something else. Choose another folder with -Dir.'
  }
  elseif ($git) {
    & git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 clone --depth 1 "$Repo.git" $Dir | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail 'git clone a \u00e9chou\u00e9. V\u00e9rifiez la connexion \u00e0 Internet.' 'git clone failed. Check the internet connection.' }
  }
  else {
    # The archive is unpacked next to the final folder, then moved: an interrupted download leaves nothing half-installed.
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
    $parent = Split-Path -Parent $Dir
    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    $tmp = $Dir.TrimEnd('\', '/') + '.partial-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
      $zip = Join-Path $tmp 'main.zip'
      try { Invoke-WebRequest -Uri "$Repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing -TimeoutSec 120 }
      catch { Fail 'le t\u00e9l\u00e9chargement a \u00e9chou\u00e9. V\u00e9rifiez la connexion \u00e0 Internet.' 'the download failed. Check the internet connection.' }
      Expand-Archive -LiteralPath $zip -DestinationPath $tmp
      $src = Join-Path $tmp 'skill-advisor-main'
      if (-not (Test-Path (Join-Path $src 'prototype\dist\preview.html'))) {
        Fail 'l\u2019archive t\u00e9l\u00e9charg\u00e9e est incompl\u00e8te. Relancez le script.' 'the downloaded archive is incomplete. Run the script again.'
      }
      if (Test-Path $Dir) { Remove-Item -LiteralPath $Dir }
      Move-Item -LiteralPath $src -Destination $Dir
    }
    finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
  if (-not (Test-Path $page)) { Fail 'la page de la d\u00e9monstration est introuvable apr\u00e8s le t\u00e9l\u00e9chargement.' 'the demonstration page is missing after the download.' }
  Write-Host ((T '  Pr\u00eat dans ' '  Ready in ') + $Dir)

  # --- 3. Check -----------------------------------------------------------------
  Step 3 'Contr\u00f4le' 'Check'
  if ($node) {
    Push-Location $Dir
    try { $out = & node prototype/test/smoke.mjs; $passed = ($LASTEXITCODE -eq 0) }
    finally { Pop-Location }
    if ($passed) { Write-Host ((T '  Test de l\u2019interface : r\u00e9ussi (' '  Interface test: passed (') + [string]($out | Select-Object -Last 1) + ')') }
    else { Say '  Test de l\u2019interface : \u00e9chec. La d\u00e9monstration est quand m\u00eame ouverte.' '  Interface test: failed. The demonstration is opened anyway.' }
  }
  else { Say '  Test de l\u2019interface saut\u00e9 : il demande Node.js 22 ou plus r\u00e9cent.' '  Interface test skipped: it needs Node.js 22 or later.' }

  # --- 4. Launch ----------------------------------------------------------------
  Step 4 'Lancement' 'Launch'
  $opened = $false
  if (-not $NoOpen) { try { Start-Process -FilePath $page; $opened = $true } catch { $opened = $false } }
  if ($opened) { Say '  Skill Advisor est ouvert dans votre navigateur.' '  Skill Advisor is open in your browser.' }
  else { Say '  Ouvrez ce fichier dans votre navigateur :' '  Open this file in your browser:'; Write-Host ('  ' + $page) }

  Write-Host ''
  Say 'Termin\u00e9. L\u2019interface montre une machine d\u2019exemple : rien n\u2019est \u00e9crit sur votre disque.' 'Done. The interface shows an example machine: nothing is written to your disk.'
  Write-Host ((T 'Manuel : ' 'Manual: ') + $Repo + (T '/blob/main/docs/install/INSTALL.fr.md' '/blob/main/docs/install/INSTALL.md'))
  Write-Host ((T 'Pour tout retirer : supprimez le dossier ' 'To remove everything: delete the folder ') + $Dir)
}
catch {
  Write-Host ''
  Write-Host ((T 'Erreur : ' 'Error: ') + $_.Exception.Message)
  if ($PSCommandPath) { exit 1 }
}
