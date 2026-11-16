# Changelog

All notable changes to Skill Advisor are listed in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MCP servers of 25 agents, read through `add-mcp` 2.6.1 in a child process. Secret values are masked before they leave it; a strictly unreadable settings file is reported and never written.
- Screen « Serveurs MCP »: installed servers per agent, disable, enable, back up (one, several), remove with an optional backup; and a catalogue of the best servers from the official MCP registry, scored out of 100 like skills, installed with a pinned version into the chosen agents, with each agent's own format and variable syntax.
- Every write to an agent's settings changes one server entry only, keeps comments (JSON, JSONC, YAML, TOML), is checked by reading the file again, keeps a copy of the old file, and is refused if the agent rewrote the file meanwhile.
- MCP backups on the Sauvegardes screen: secrets replaced by variables by default, restore to the original agents, apply to other agents with format conversion, export and import.
- Screen « Plugins »: plugins of Claude Code, Codex, Gemini CLI, Copilot CLI and Antigravity, what each brings, hooks named, enable, disable, update and uninstall through each agent's own command; and a catalogue of 555 plugins from the open marketplaces of Claude Code and Copilot CLI.
- The advice results also suggest MCP servers and plugins for the project. The Agents screen lists the MCP servers and plugins of each agent.
- `tools/mcp-catalog.mjs` and `tools/plugin-catalog.mjs` build `catalog/mcp.json` and `catalog/plugins.json` from public sources.

## [1.0.0] - 2026-11-15

The first finished version: a local application that works on the real skills of your agents.

### Added

- Local application (`app/`), started with `npm start` or by the installation scripts. It listens on `127.0.0.1` only and prints a one-time address, valid 10 minutes for one use. The browser tab keeps the session, without a cookie; a reused address shows "Session expirée" (Session expired). The browser receives a launch key, valid 2 minutes for one use (`/start?k=`), never the address itself.
- Installation scripts for macOS, Linux (`install.sh`) and Windows (`install.ps1`), in French or English. They download Skill Advisor, install its dependencies, run `npm test` (the test of the interface alone when the dependencies are missing) and start the application. A copy without git, or a git copy run without git, is kept: the script says it is not updated and how to get the new version. The demonstration on an example machine stays available with `--demo` (`-Demo` on Windows).
- Demonstration video on YouTube, linked from the README.
- Advice with 17 goals, a few questions per goal, and ranked recommendations from the rated catalogue.
- Installation from the interface, for all projects or for one project. Each skill is downloaded into a temporary folder and checked before anything is written. A skill with a high-risk pattern is held until you confirm it. A skill of the same name from a hand copy or another source is a conflict: keep it, or replace it after an automatic backup.
- Shared folder `~/.agents/skills`, shown as one target with the agents that read it. The other chosen agents get a link to it; without the shared folder, each agent gets its own copy.
- Updates with the drawer "Ce qui change" (What changes): added, removed and changed files, and the check of the new version. An update with a high-risk pattern is held until you force it. After an update, the same agents see the skill.
- Disable and enable skills. A disabled skill moves to `~/.skill-advisor/disabled`.
- Uninstall with an optional backup, ticked by default.
- Backups: on demand with a label and a note, at uninstall, restore, delete, export and import as `.tar.gz`, and apply to other agents with "Passer" (Skip) or "Remplacer" (Replace). Imported archives are checked: regular files and folders only, 200 MB and 100,000 entries at most, valid manifest and skill names.
- Agents screen: 78 known agents, targets for the installations, agents added by hand, hidden agents, and emptying an agent with an optional backup.
- Project folder, given with `--project <folder>` or in the field "Dossier du projet" (Project folder).
- Search among the 1,551 most installed skills, with the date and the source of the base on screen.
- Start options `--port`, `--no-open`, `--project` and `--home` (tests only), and `--version` and `--help`.
- Uninstall from the shared folder only ("Retirer du dossier partagé pour tous ces agents"): the shared copy and the links to it go, the own copies of agents stay.
- The browser tab title names the screen, for example "Mes skills · Skill Advisor".
- `npm test` runs every suite through `test/run-all.mjs` and ends with a "Bilan" (Summary) block. `npm run test:e2e` runs the end-to-end tests in headless Chrome or Chromium.
- Continuous integration on macOS, Ubuntu and Windows with Node.js 22.20.0 and 26: all tests without network, end-to-end tests in headless Chrome on all three systems, checks of both installation scripts.
- This changelog.

### Changed

- The security check also reports null bytes in text files, very large files and links that leave the skill.
- From 0.1.0: run the new installation script. A 0.1.0 folder installed with git is updated. A 0.1.0 folder installed without git is not: delete it first, or install into another folder with `--dir` (`-Dir` on Windows).
- On Windows, the installation script and the manuals give `npm.cmd start` to start the application again: the default execution policy of PowerShell can refuse `npm start`, because it blocks `npm.ps1`.
- README and installation manual rewritten for version 1.0, in English, French, Spanish and Arabic, with screenshots of the real application.

## [0.1.0] - 2026-11-13

### Added

- Interactive demonstration of the interface (`prototype/`) on an example machine. It writes nothing to the disk.
- Catalogue of 242 rated skills in 16 project types, from a snapshot of skills.sh dated 12 November 2026.
- Static security check `tools/skill-scan.mjs` with 11 rules.
- Installation manual with the `skills` command-line tool, replayed on macOS, Debian 12 and Windows 11 (arm64).
- README in English, French, Spanish and Arabic, with a demonstration animation and a video attached to the release.

[1.0.0]: https://github.com/warezfr/skill-advisor/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/warezfr/skill-advisor/releases/tag/v0.1.0
