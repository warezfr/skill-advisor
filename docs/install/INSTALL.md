# Installation manual

**English** · [Français](INSTALL.fr.md) · [Español](INSTALL.es.md) · [العربية](INSTALL.ar.md)

This manual takes you from nothing to a checked skill installed in your agent. Each step has one action and one expected result. Stop at any step: steps 1 to 4 need only a web browser.

> [!IMPORTANT]
> Skill Advisor is a prototype. The installation script now starts the real local application: it reads and changes the real skills of your agents. The demonstration shows an example machine and writes nothing to your disk. It stays available with `--demo` (`-Demo` on Windows). Steps 7 and 8 use real commands that write real files, and step 9 writes them with the local application. Each of those steps says so. The screenshots in this manual still show the demonstration.

## Contents

| Step | What you do | Time | Needs |
|---|---|---|---|
| 1 | Check what you need | 2 min | - |
| 2 | Download Skill Advisor | 1 min | Browser or git |
| 3 | Open the demonstration | 1 min | Browser |
| 4 | Walk through the journey | 5 min | Browser |
| 5 | Build and test (optional) | 1 min | Node.js |
| 6 | Check a skill | 2 min | Node.js |
| 7 | Try a real skill in a test folder | 3 min | Node.js, internet |
| 8 | Install a skill for all your projects | 2 min | Node.js, internet |
| 9 | Back up a skill and apply it to another agent | 5 min | Local application |

---

## Fast path · The installation script

The script does steps 1 to 3 for you: it checks your tools, downloads Skill Advisor, installs its one dependency and starts the local application. Without Node.js 22.20 or later and npm, or with `--demo`, it opens the demonstration instead. It asks for your language, French or English. It installs no system software and needs no administrator rights. Read it before you run it: [install.sh](../../install.sh), [install.ps1](../../install.ps1).

macOS and Linux:

```bash
curl -fsSLO https://raw.githubusercontent.com/warezfr/skill-advisor/main/install.sh
bash install.sh
```

Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/warezfr/skill-advisor/main/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

The option `-ExecutionPolicy Bypass` applies to this one run. It does not change the settings of your system.

**Expected result:** five numbered steps in the terminal, then the line `Skill Advisor: http://127.0.0.1:<port>/?c=<code>` and the screen "Ma machine" (My machine) in your browser.

![The installation script](../assets/screenshots/15-terminal-install-en.png)

*This screenshot shows an earlier version of the script, with four steps, which opened the demonstration.*

| macOS, Linux | Windows | Effect |
|---|---|---|
| `--lang fr`, `--lang en` | `-Lang fr`, `-Lang en` | Choose the language without the question |
| `--dir <folder>` | `-Dir <folder>` | Install into another folder. The default is `skill-advisor` in your home folder |
| `--no-git` | `-NoGit` | Download the archive even when git is installed |
| `--no-open` | `-NoOpen` | Do not open the browser. The application still prints its address |
| `--demo` | `-Demo` | Open the demonstration only. Nothing is installed and the application does not start |
| `--no-start` | `-NoStart` | Install the application but do not start it |

What the script does:

1. It checks whether git, Node.js and npm are present. None is required: without Node.js 22.20 or later and npm, you get the demonstration.
2. It downloads Skill Advisor with git, or as an archive when git is absent.
3. It installs the one dependency, the `skills` package, in the folder `node_modules`, with `npm ci --omit=dev --no-audit --no-fund`.
4. It runs the interface test when Node.js 22 or later is present.
5. It starts the local application with `node app/server.mjs`. Without the application, it opens `prototype/dist/preview.html` in your browser.

The script was tested on macOS, Debian 12 and Windows 11, in its earlier version that opened the demonstration. Run it again to update a copy installed with git. A copy downloaded as an archive, without git, is not updated by the script: delete its folder, or choose another folder with `--dir` (`-Dir` on Windows). Then continue at step 4. Step 4 describes the demonstration: to follow it without writing anything, run the script with `--demo`. In the local application, your own skills replace the examples.

---

## The local application · Start, use, stop

> [!WARNING]
> The local application works on your real machine. What you install, remove or disable in it changes the skill folders of your agents, for example `~/.claude/skills`.

The application runs in the terminal until you press Ctrl+C. To start it again later, go to the installation folder and run `npm start`.

macOS and Linux:

```bash
cd ~/skill-advisor
npm start
```

Windows, in PowerShell:

```powershell
cd $HOME\skill-advisor
npm start
```

**Expected result:** the line `Skill Advisor: http://127.0.0.1:<port>/?c=<code>`, then the interface in your browser. If the browser does not open, copy that address into it within 10 minutes.

What the application does:

- **Install** skills from the catalogue, for all your projects or for one project, in the agents you choose.
- **Remove** skills. Before it removes, it can keep a backup in `~/.skill-advisor/backups`. You can restore or delete each backup.
- **Update** skills. An update whose new version gets the verdict `rouge` is held back until you force it.
- **Disable and enable** skills. A disabled skill moves to `~/.skill-advisor/disabled` and comes back when you enable it.
- **Manage 78 agents.** Add an agent by hand with its skills folder, hide an agent, empty an agent of its skills, and choose which agents receive the installations.

Safety:

- The application listens on `127.0.0.1` only. Other machines cannot reach it.
- The address it prints holds a one-time code, valid 10 minutes. Once used, it no longer opens the interface: to open it again, stop the application with Ctrl+C and run `npm start` again. Do not share that address.
- Nothing is sent elsewhere, except the downloads of skills from GitHub and of the catalogue. The telemetry of the `skills` tool is off. The page loads its fonts from the internet.
- Your settings are kept in `~/.skill-advisor/settings.json`.

To stop the application, press Ctrl+C in its terminal.

---

## Step 1 · Check what you need

| Tool | Needed for | How to check | Where to get it |
|---|---|---|---|
| A web browser | Steps 3 and 4 | - | Already on your machine |
| Node.js 22 or later | Steps 5 to 9. The local application, used in step 9, needs 22.20 or later, with npm | `node -v` | [nodejs.org](https://nodejs.org) |
| git | Step 2 (option B). Recommended for steps 7 and 8 | `git --version` | [git-scm.com](https://git-scm.com) |

Open a terminal (Terminal on macOS and Linux, PowerShell on Windows) and run:

```bash
node -v
git --version
```

**Expected result:** two version numbers. The Node.js number starts with 22 or more. The commands in this manual were tested with Node.js 26. The commands of steps 5 to 7 were replayed on macOS. The installation commands of step 8 were tested on Windows 11, Linux and macOS.

Why git is recommended: without git, an installation stops when GitHub limits anonymous downloads (60 requests per hour for one public address). With git, the installation continues.

## Step 2 · Download Skill Advisor

Choose one option.

**Option A, without git.** Download the ZIP file and unpack it:

<https://github.com/warezfr/skill-advisor/archive/refs/heads/main.zip>

The unpacked folder is named `skill-advisor-main`. Rename it to `skill-advisor`.

**Option B, with git.**

```bash
git clone https://github.com/warezfr/skill-advisor.git
```

Then enter the folder:

```bash
cd skill-advisor
```

**Expected result:** a folder `skill-advisor` that contains `prototype`, `catalog`, `tools` and `README.md`.

## Step 3 · Open the demonstration

Open the file `prototype/dist/preview.html` in your browser. Double-click it, or use the command for your system.

macOS:

```bash
open prototype/dist/preview.html
```

Windows:

```powershell
start prototype\dist\preview.html
```

Linux:

```bash
xdg-open prototype/dist/preview.html
```

**Expected result:** the screen "Ma machine" (My machine). The bottom-left corner says "machine d'exemple" (example machine): the 50 skills shown are examples, not yours.

![The screen My machine](../assets/screenshots/01-ma-machine.png)

Notes:

- The page needs no server and no account. It loads its fonts from the internet.
- The interface is in French for now. Step 4 gives the English name of each screen.

## Step 4 · Walk through the journey

**4.1 Choose a goal.** Click "Conseil" (Advice) in the left menu, then "Créer un site" (Create a website).

![Choose a goal](../assets/screenshots/02-objectif.png)

**4.2 Answer four questions.** Type of site, technology, hosting, needs. The panel on the right fills in as you answer. Click "Voir les recommandations" (See the recommendations).

![Four questions](../assets/screenshots/03-questions.png)

**4.3 Read the recommendations.** Each skill has a score out of 100 and a line "Pourquoi pour vous" (Why for you). Tick the skills you want. Skills that are already installed are marked "Installé".

![Recommendations](../assets/screenshots/04-recommandations.png)

**4.4 Open the detail of a skill.** Click "Voir le détail" (See the detail). You see how the score is built: popularity 40, reputation of the source 25, freshness 15, security 20.

![Detail of a skill](../assets/screenshots/05-detail.png)

**4.5 Verify before writing.** Click "Installer 3 skills". The screen "Vérifiez avant d'écrire" (Verify before writing) lists the skills, the agents that will receive them and the scope: all projects or this project only.

![Verify before writing](../assets/screenshots/06-installation.png)

**4.6 Read the guide.** Confirm. In the demonstration nothing is written to disk. In the local application, this confirmation writes real files into the folders of your agents. The guide explains when the agent uses each skill and how to call it.

![Guide](../assets/screenshots/07-guide.png)

**4.7 Manage.** "Mes skills" (My skills) lists what is installed, with updates, warnings and the cost in context. "Agents" shows the agents found on the machine and where each one keeps its skills.

![My skills](../assets/screenshots/08-mes-skills.png)

![Agents](../assets/screenshots/09-agents.png)

**4.8 Search.** "Recherche" (Search) looks in the whole base, with filters by project type, installs and warnings.

![Search](../assets/screenshots/10-recherche.png)

**4.9 Try the other states.** The button "Aperçu" (Preview), bottom left, shows the same screens in other states, for example on an empty machine. The moon icon switches to the dark theme.

![Dark theme](../assets/screenshots/11-theme-sombre.png)

**Expected result:** you have seen the full journey, from a goal to an installed and managed skill.

## Step 5 · Build and test (optional)

The file `preview.html` is already built. Do this step only if you change the files in `prototype/src/`.

```bash
npm run build
npm test
```

**Expected result:** the build prints the size of two files, and the test ends with a line of the form `<n> render checks, 0 failure(s)`.

![Build and test](../assets/screenshots/12-terminal-build-test.png)

These two commands install nothing. The build and the test use no dependency.

## Step 6 · Check a skill

The check reads the files of a skill as text and looks for 11 risky patterns. It never runs the skill. The folder `examples/skills` holds two example skills: one safe, one written to fail.

```bash
node tools/skill-scan.mjs examples/skills
```

**Expected result:** one red line for `risky-installer`, and a total of 2 skills: 1 `vert`, 1 `rouge`.

![Result of the check](../assets/screenshots/14-terminal-scan.png)

| Verdict | Meaning | What to do |
|---|---|---|
| `vert` (green) | No known pattern found | Read the skill, then decide |
| `vert-remarques` (green with notes) | Low-severity findings only | Read the notes |
| `orange` | At least one medium-severity finding | Read each finding before you install |
| `rouge` (red) | A high-severity finding | Do not install unless you understand every line |

To see every finding with its file and line number, add `--json`:

```bash
node tools/skill-scan.mjs examples/skills --json
```

To check your own skills, give the folder that contains one sub-folder per skill. Skills installed with the `skills` tool are stored in `.agents/skills` in your home folder:

```bash
node tools/skill-scan.mjs ~/.agents/skills
```

On Windows PowerShell, write `$HOME\.agents\skills` in place of `~/.agents/skills`.

The check skips linked folders. Give it the folder that holds the real files.

> [!WARNING]
> A green verdict means "no known pattern found". It does not mean "safe". The check finds known patterns only.

## Step 7 · Try a real skill in a test folder

This step writes files, but only inside a test folder that you can delete. It uses [`skills`](https://skills.sh), the open-source command-line tool that Skill Advisor relies on to install.

Create a test folder next to `skill-advisor` and enter it:

```bash
mkdir ../try
cd ../try
```

Install one skill for this folder only, then check it:

```bash
npx -y skills@1.8.1 add vercel-labs/agent-skills --skill web-design-guidelines -a claude-code -y
node ../skill-advisor/tools/skill-scan.mjs .claude/skills
```

**Expected result:** the skill is copied to `.claude/skills/web-design-guidelines` inside the test folder, and the check prints `Total 1 · vert 1`.

![Install in a test folder, then check](../assets/screenshots/13-terminal-try-a-skill.png)

What the options mean:

| Option | Meaning |
|---|---|
| `vercel-labs/agent-skills` | The GitHub repository that holds the skill |
| `--skill web-design-guidelines` | The skill to install from that repository |
| `-a claude-code` | The agent that receives it. Other values: `cursor`, `gemini-cli` |
| `-y` | Do not ask for confirmation |

To find the repository and the name of a skill, open [catalog/CATALOGUE.md](../../catalog/CATALOGUE.md): each line gives the skill and its source.

To remove everything from this step, delete the folder `try`.

## Step 8 · Install a skill for all your projects

> [!WARNING]
> This step writes to your real agent folders, for example `~/.claude/skills`. Do it only for a skill that you have checked in step 7.

Add `-g` (global) to install for all your projects:

```bash
npx -y skills@1.8.1 add vercel-labs/agent-skills --skill web-design-guidelines -g -a claude-code -y
```

The four commands you need afterwards:

| Action | Command |
|---|---|
| List what is installed | `npx -y skills@1.8.1 list -g` |
| Check for updates | `npx -y skills@1.8.1 check -g` |
| Update everything | `npx -y skills@1.8.1 update -g -y` |
| Remove one skill | `npx -y skills@1.8.1 remove --skill web-design-guidelines -g -y` |

**Expected result:** `list -g` shows `web-design-guidelines`. Restart your agent so that it reads its skills folder again.

Where the files go: the skill is stored once in `~/.agents/skills/`, and your agent folder points to it. On macOS and Linux the pointer is a symbolic link. On Windows it is a junction.

## Step 9 · Back up a skill and apply it to another agent

> [!WARNING]
> This step uses the local application on your real machine. Applying a backup writes to your real agent folders.

Start the local application, as described in "The local application" above. Backups are kept in `~/.skill-advisor/backups`.

**9.1 Make a backup.** Choose one or more skills installed for all your projects and make a backup. Add a label and a note if you want: 80 and 500 characters at most. The backup holds a copy of each skill, the agents that used it and the verdict of its security check.

**9.2 Export it.** Export the backup. You get one file named `skill-advisor-<id>.tar.gz`. Copy it to the other machine, for example on a USB key.

**9.3 Import it.** On the other machine, start Skill Advisor and import that file. Skill Advisor checks every skill again and stores them as a new backup. Nothing is installed yet. The import refuses a file that holds anything other than files and folders, a path that leaves the backup, more than 200 MB or more than 100,000 entries. It also refuses a file without a valid Skill Advisor manifest or with an invalid skill name.

**9.4 Apply it to another agent.** Choose skills of the backup and the agents that receive them. Any known agent works, and so does an agent you added by hand, not only the agents of the backup. Then choose what happens when an agent already holds the skill:

| What the agent holds | Skip | Replace |
|---|---|---|
| Nothing | The skill is copied | The skill is copied |
| The same content | Nothing changes | Nothing changes |
| A different version | It stays in place | It is backed up, then replaced |

A skill whose verdict is `rouge` is applied only after you confirm it.

Where the files go: the skill is copied to `~/.agents/skills/<name>`. Agents with their own folder point to it with a link, a junction on Windows. An agent that you added by hand gets its own copy. When the source of the skill is known, Skill Advisor also writes its entry back into the lock file of the `skills` tool.

**Expected result:** the skill appears in the chosen agent in "Mes skills" (My skills). Each replaced version has its own new backup. Restart the agent so that it reads its skills folder again.

---

## If something goes wrong

| What you see | Cause | What to do |
|---|---|---|
| `node: command not found` | Node.js is not installed | Install it from [nodejs.org](https://nodejs.org), then open a new terminal |
| `[SKILLS_GIT_CLONE_FAILED] ... spawn git ENOENT` | GitHub limited anonymous downloads and git is not installed | Install git, or wait one hour and try again |
| `skill-scan.mjs` prints `ENOENT ... scandir` | The folder you gave does not exist | Give a folder that contains one sub-folder per skill |
| On Windows, the installer says "symlinked" | The tool uses one word for both kinds of link | Nothing to do: it created a junction, which works without administrator rights |
| `npm failed` in step 3 of the script | npm cannot reach its registry | Check the internet connection and run the script again. Until then, the script opens the demonstration |
| `too old (22.20 or later needed for the application)` | Node.js is older than 22.20 | Install a newer Node.js from [nodejs.org](https://nodejs.org), then run the script again |
| The terminal prints nothing more after the address | The application is running | This is expected. Press Ctrl+C to stop it |

## Remove Skill Advisor

Skill Advisor installs nothing on your system. Delete the folder `skill-advisor` and the folder `~/.skill-advisor`, which holds the settings, the backups and the disabled skills of the local application. Enable your disabled skills first, or they are deleted with that folder. Export the backups that you want to keep (step 9). Skills installed in step 8 or with the application stay in place: remove them with the `remove` command of step 8 or in the application.

---

[Back to the README](../../README.md) · Website: [span.observer](https://span.observer)
