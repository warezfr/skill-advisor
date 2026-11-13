<#
Skill Advisor: installation script for Windows.
It downloads Skill Advisor into a folder of your user profile, checks it, and starts the local application.
Without Node.js 22.20 or later, it opens the demonstration in your browser instead.
It installs no system software and asks for no administrator rights.

Usage:  powershell -ExecutionPolicy Bypass -File install.ps1 [-Lang fr|en] [-Dir <folder>] [-NoGit] [-NoOpen] [-Demo] [-NoStart]
  -Lang     language of the messages, fr or en (asked when absent)
  -Dir      installation folder (default: skill-advisor in your user profile)
  -NoGit    download the archive even when git is installed
  -NoOpen   do not open the browser
  -Demo     open the demonstration only: no dependency, no application
  -NoStart  install the application but do not start it
  -SourceDir <folder>  for tests only: copy Skill Advisor from this folder instead of downloading it
#>
param(
  [string]$Lang = $env:SA_LANG,
  [string]$Dir = $env:SA_DIR,
  [switch]$NoGit,
  [switch]$NoOpen,
  [switch]$Demo,
  [switch]$NoStart,
  [string]$SourceDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'https://github.com/warezfr/skill-advisor'
if (-not $Dir) { $Dir = Join-Path $HOME 'skill-advisor' }

# French texts use \u escapes so that this file stays plain ASCII:
# Windows PowerShell 5.1 misreads accented letters in a script saved without a byte-order mark.
function T([string]$fr, [string]$en) { if ($Lang -eq 'fr') { [regex]::Unescape($fr) } else { $en } }
function Say([string]$fr, [string]$en) { Write-Host (T $fr $en) }
function Step([int]$n, [string]$fr, [string]$en) { Write-Host ''; Write-Host ("[$n/5] " + (T $fr $en)) }
function Fail([string]$fr, [string]$en) { throw (New-Object System.InvalidOperationException (T $fr $en)) }
function Have([string]$name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

try {
  # --- Language ---------------------------------------------------------------
  if ($Lang -and ($Lang -ne 'fr') -and ($Lang -ne 'en')) {
    # The value stays out of T: [regex]::Unescape would fail on a backslash in it.
    $bad = $Lang; $Lang = 'en'
    throw (New-Object System.InvalidOperationException ("Unknown language / Langue inconnue: $bad (fr, en)"))
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

  # Tests only: a local folder replaces the download.
  if ($SourceDir) {
    if (-not (Test-Path (Join-Path $SourceDir 'prototype\dist\preview.html'))) {
      Fail 'le dossier source ne contient pas Skill Advisor.' 'the source folder does not hold Skill Advisor.'
    }
    $SourceDir = (Resolve-Path -LiteralPath $SourceDir).Path
  }

  Write-Host ''
  Write-Host 'Skill Advisor'
  Write-Host ((T 'Installation dans : ' 'Installing into: ') + $Dir)

  # --- 1. Tools -----------------------------------------------------------------
  # $node: Node.js 22 or later, enough for the interface test.
  # $app: Node.js 22.20.0 or later and npm, needed by the local application.
  Step 1 'V\u00e9rification des outils' 'Checking the tools'
  $git = (-not $NoGit) -and (Have 'git')
  $node = $false
  $app = $false
  $nodeV = ''
  if (Have 'node') {
    $nodeV = [string](& node -v)
    if ($nodeV -match '^v(\d+)\.(\d+)') {
      $major = [int]$Matches[1]
      $minor = [int]$Matches[2]
      $node = ($major -ge 22)
      $app = ($major -gt 22) -or (($major -eq 22) -and ($minor -ge 20))
    }
  }
  $npm = Have 'npm'
  # npm.cmd avoids the npm.ps1 wrapper, which some execution policies block.
  $npmExe = 'npm'
  if (Have 'npm.cmd') { $npmExe = 'npm.cmd' }
  if ($git) { Say '  git : pr\u00e9sent' '  git: found' }
  else { Say "  git : absent ou non utilis\u00e9, l'archive sera t\u00e9l\u00e9charg\u00e9e" '  git: missing or not used, the archive will be downloaded' }
  if ($app) { Write-Host ((T '  Node.js : ' '  Node.js: ') + $nodeV) }
  elseif ($nodeV) { Write-Host ((T '  Node.js : ' '  Node.js: ') + $nodeV + (T ', trop ancien (22.20 ou plus r\u00e9cent requis pour l\u2019application)' ', too old (22.20 or later needed for the application)')) }
  else { Say '  Node.js : absent. La d\u00e9monstration marche sans lui. Pour l\u2019application : https://nodejs.org' '  Node.js: missing. The demonstration works without it. For the application: https://nodejs.org' }
  if ($nodeV) {
    if ($npm) { Say '  npm : pr\u00e9sent' '  npm: found' }
    else { Say '  npm : absent. L\u2019application en a besoin. Il est fourni avec Node.js : https://nodejs.org' '  npm: missing. The application needs it. It comes with Node.js: https://nodejs.org' }
  }
  if (-not $npm) { $app = $false }

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
    # Copie sans git et sans app\server.mjs : ancienne version, le script ne la met pas a jour.
    if (-not (Test-Path (Join-Path $Dir 'app\server.mjs'))) {
      Say '  Ce dossier contient une ancienne version, sans l\u2019application. Le script ne la met pas \u00e0 jour.' '  This folder holds an older version, without the application. The script does not update it.'
      Say '  Pour une nouvelle installation, supprimez ce dossier ou choisissez-en un autre avec -Dir.' '  Delete this folder, or choose another one with -Dir for a fresh installation.'
    }
  }
  elseif ((Test-Path $Dir) -and (Get-ChildItem -Force -LiteralPath $Dir | Select-Object -First 1)) {
    Fail 'le dossier d\u2019installation existe et contient autre chose. Choisissez un autre dossier avec -Dir.' 'the installation folder exists and holds something else. Choose another folder with -Dir.'
  }
  elseif ($git -and -not $SourceDir) {
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
      if ($SourceDir) {
        # Tests only: copy of a local folder, without its git history and its dependencies.
        $src = Join-Path $tmp 'skill-advisor'
        New-Item -ItemType Directory -Path $src | Out-Null
        Get-ChildItem -Force -LiteralPath $SourceDir | Where-Object { ($_.Name -ne '.git') -and ($_.Name -ne 'node_modules') } | Copy-Item -Destination $src -Recurse -Force
      }
      else {
        $zip = Join-Path $tmp 'main.zip'
        try { Invoke-WebRequest -Uri "$Repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing -TimeoutSec 120 }
        catch { Fail 'le t\u00e9l\u00e9chargement a \u00e9chou\u00e9. V\u00e9rifiez la connexion \u00e0 Internet.' 'the download failed. Check the internet connection.' }
        Expand-Archive -LiteralPath $zip -DestinationPath $tmp
        $src = Join-Path $tmp 'skill-advisor-main'
      }
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

  # --- 3. Dependencies ----------------------------------------------------------
  # $ready: the application can start (Node.js, npm, app\server.mjs and its dependency are there).
  Step 3 'D\u00e9pendances' 'Dependencies'
  $ready = $false
  if ($Demo) { Say '  Mode d\u00e9monstration (-Demo) : rien \u00e0 installer.' '  Demonstration mode (-Demo): nothing to install.' }
  elseif (-not $app) { Say '  Saut\u00e9es : l\u2019application demande Node.js 22.20 ou plus r\u00e9cent et npm.' '  Skipped: the application needs Node.js 22.20 or later and npm.' }
  elseif (-not (Test-Path (Join-Path $Dir 'app\server.mjs'))) { Say '  Saut\u00e9es : cette copie de Skill Advisor ne contient pas encore l\u2019application.' '  Skipped: this copy of Skill Advisor does not hold the application yet.' }
  else {
    $npmCmd = 'install'
    if (Test-Path (Join-Path $Dir 'package-lock.json')) { $npmCmd = 'ci' }
    $npmOk = $false
    Push-Location $Dir
    try {
      & $npmExe $npmCmd --omit=dev --no-audit --no-fund | Out-Host
      $npmOk = ($LASTEXITCODE -eq 0)
    }
    catch { $npmOk = $false }
    finally { Pop-Location }
    if (-not $npmOk) { Say '  npm a \u00e9chou\u00e9. V\u00e9rifiez la connexion \u00e0 Internet. La d\u00e9monstration sera ouverte \u00e0 la place.' '  npm failed. Check the internet connection. The demonstration will open instead.' }
    elseif (-not (Test-Path (Join-Path $Dir 'node_modules\skills'))) { Say '  Le paquet skills est absent apr\u00e8s npm. La d\u00e9monstration sera ouverte \u00e0 la place.' '  The skills package is missing after npm. The demonstration will open instead.' }
    else {
      $ready = $true
      Write-Host ((T '  D\u00e9pendances install\u00e9es dans ' '  Dependencies installed in ') + (Join-Path $Dir 'node_modules'))
    }
  }

  # --- 4. Check -----------------------------------------------------------------
  Step 4 'Contr\u00f4le' 'Check'
  if ($node) {
    Push-Location $Dir
    try { $out = & node prototype/test/smoke.mjs; $passed = ($LASTEXITCODE -eq 0) }
    finally { Pop-Location }
    if ($passed) { Write-Host ((T '  Test de l\u2019interface : r\u00e9ussi (' '  Interface test: passed (') + [string]($out | Select-Object -Last 1) + ')') }
    else { Say '  Test de l\u2019interface : \u00e9chec. L\u2019installation continue.' '  Interface test: failed. The installation goes on.' }
  }
  else { Say '  Test de l\u2019interface saut\u00e9 : il demande Node.js 22 ou plus r\u00e9cent.' '  Interface test skipped: it needs Node.js 22 or later.' }

  # --- 5. Launch ----------------------------------------------------------------
  Step 5 'Lancement' 'Launch'
  if ($ready) {
    # The application runs in the foreground: everything is said before it starts.
    if (-not $NoStart) {
      Say '  D\u00e9marrage de l\u2019application locale. Elle affiche son adresse et ouvre votre navigateur.' '  Starting the local application. It prints its address and opens your browser.'
      if ($NoOpen) { Say '  Le navigateur n\u2019est pas ouvert (-NoOpen) : ouvrez l\u2019adresse affich\u00e9e ci-dessous.' '  The browser is not opened (-NoOpen): open the address printed below.' }
    }
    else { Say '  D\u00e9marrage saut\u00e9 (-NoStart).' '  Start skipped (-NoStart).' }
    Write-Host ''
    Say 'Skill Advisor lit et modifie les vrais skills de vos agents.' 'Skill Advisor reads and changes the real skills of your agents.'
    Write-Host ((T 'Pour la d\u00e9monstration seule, sans rien \u00e9crire : ' 'For the demonstration only, with nothing written: ') + 'powershell -ExecutionPolicy Bypass -File install.ps1 -Demo')
    Say 'Pour lancer l\u2019application plus tard :' 'To start the application again later:'
    Write-Host ('  cd "' + $Dir + '"')
    Write-Host '  npm start'
    Write-Host ((T 'Manuel : ' 'Manual: ') + $Repo + (T '/blob/main/docs/install/INSTALL.fr.md' '/blob/main/docs/install/INSTALL.md'))
    Write-Host ((T 'Pour tout retirer : r\u00e9activez vos skills d\u00e9sactiv\u00e9s, puis supprimez le dossier ' 'To remove everything: enable your disabled skills, then delete the folder ') + $Dir + (T ' et le dossier ' ' and the folder ') + (Join-Path $HOME '.skill-advisor'))
    if (-not $NoStart) {
      Write-Host ''
      Say 'L\u2019application tourne jusqu\u2019\u00e0 ce que vous appuyiez sur Ctrl+C.' 'The application runs until you press Ctrl+C.'
      $serverArgs = @('app/server.mjs')
      if ($NoOpen) { $serverArgs += '--no-open' }
      Push-Location $Dir
      $code = 0
      try { & node @serverArgs; $code = $LASTEXITCODE }
      finally { Pop-Location }
      # Code non nul : le serveur n'a pas pu tourner. Ctrl+C (130, 0xC000013A) compte comme une sortie normale.
      if (($code -ne 0) -and ($code -ne 130) -and ($code -ne -1073741510)) {
        Write-Host ''
        Write-Host ((T 'Erreur : l\u2019application s\u2019est arr\u00eat\u00e9e avec le code ' 'Error: the application stopped with code ') + $code + (T '. Lisez le message ci-dessus.' '. Read the message above.'))
        if ($PSCommandPath) { exit $code }
      }
    }
  }
  else {
    $opened = $false
    if (-not $NoOpen) { try { Start-Process -FilePath $page; $opened = $true } catch { $opened = $false } }
    if ($opened) { Say '  La d\u00e9monstration est ouverte dans votre navigateur.' '  The demonstration is open in your browser.' }
    else { Say '  Ouvrez ce fichier dans votre navigateur :' '  Open this file in your browser:'; Write-Host ('  ' + $page) }
    if ((-not $Demo) -and (-not $app)) { Say '  L\u2019application r\u00e9elle demande Node.js 22.20 ou plus r\u00e9cent, avec npm : https://nodejs.org' '  The real application needs Node.js 22.20 or later, with npm: https://nodejs.org' }

    Write-Host ''
    Say 'Termin\u00e9. La d\u00e9monstration montre une machine d\u2019exemple : rien n\u2019est \u00e9crit sur votre disque.' 'Done. The demonstration shows an example machine: nothing is written to your disk.'
    Write-Host ((T 'Manuel : ' 'Manual: ') + $Repo + (T '/blob/main/docs/install/INSTALL.fr.md' '/blob/main/docs/install/INSTALL.md'))
    Write-Host ((T 'Pour tout retirer : supprimez le dossier ' 'To remove everything: delete the folder ') + $Dir)
  }
}
catch {
  Write-Host ''
  Write-Host ((T 'Erreur : ' 'Error: ') + $_.Exception.Message)
  if ($PSCommandPath) { exit 1 }
}
