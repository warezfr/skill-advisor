# Skill Advisor local app: contract

This file fixes the interfaces between the parts of the local application, so that they can be built in parallel. Change it only with the agreement of every part.

## Running

```
node app/server.mjs [--port <n>] [--no-open] [--home <dir>]
npm start
```

- Listens on `127.0.0.1` only. Port: `--port`, else a free port chosen by the system.
- Creates a random session token (32 bytes, hex) at each start. The token never appears in a URL, in argv or in the output.
- Creates a one-time code (16 bytes, hex), valid 10 minutes and for one use.
- Prints exactly one line on standard output when ready: `Skill Advisor: http://127.0.0.1:<port>/?c=<code>`
- Opens that address in the default browser, unless `--no-open` (macOS `open`, Windows `rundll32 url.dll,FileProtocolHandler <url>`, Linux `xdg-open`; never through a shell).
- `--home <dir>`: used by tests only. The server never imports the `skills` package itself: see "Safety" below.

## Safety rules (all parts)

1. The `skills` package reads the home folder **once, when it is imported** (checked on 13/11/2026: `getSupportedAgents()` keeps the real home even after `process.env.HOME` changes). Therefore:
   - every module that imports `skills` is loaded in a **child process** started with `HOME` and `USERPROFILE` set to the target home (see `app/lib/worker.mjs`);
   - tests always use a throwaway home under the system temp folder, and **assert, before any write, that every agent folder returned by `getSupportedAgents()` is inside that throwaway home**. If not, the test aborts.
2. Never touch the real `~/.claude`, `~/.agents`, `~/.cursor` or any real agent folder during development or tests.
3. Skill names: `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. Agent ids: `^[a-z0-9][a-z0-9-]{0,63}$` (custom agents: `custom-<n>`). Any path built from a name is resolved and must stay inside its parent folder.
4. Install sources: `owner/repo` (`^[\w.-]+\/[\w.-]+$`, no segment starting with a dot) or `https://` URLs with a host name, 2000 characters at most.
5. No shell: child processes are started with `spawn(process.execPath, [file, ...args])` or `execFile`, arguments as an array, never `shell: true`.
6. Telemetry off: `telemetry: false` in library calls, `DISABLE_TELEMETRY=1` in child environments.

## Files under the user's home

- `~/.skill-advisor/settings.json`: `{ "version": 1, "custom": [{ "id": "custom-1", "name": "...", "dir": "/abs/path" }], "hidden": ["agent-id"], "targets": ["agent-id"] }`
- `~/.skill-advisor/backups/<YYYYMMDD-HHMMSS>-<name>/`: the main copy in `<name>/`, every other distinct real copy that was removed in `copies/<n>/<name>/`, and `meta.json` = `{ "id", "name", "src", "agents": [id], "at": ISO date, "size": bytes, "places": [{ "agent", "off", "copy" }], "skipped": [path], "lock" }`. Links inside the skill are followed; links leaving the skill, broken links and cycles are skipped and listed in `skipped`. Over 200 MB or 100000 entries: refused (`BACKUP_FAILED`). The backup `id` is the folder name (UTC time). Restore puts each copy back where it came from and refuses (`EXISTS`) when a destination exists.
- `~/.skill-advisor/disabled/<agentId>/<name>`: the skill folder or link moved out of the agent folder while disabled.

## Module interfaces (`app/lib/`)

All functions are `async`, take an options object, and use `opts.home` (default `os.homedir()`). They throw `Error` objects with a `code` property (`BAD_ARCHIVE`, `BAD_INPUT`, `BAD_NAME`, `BAD_SOURCE`, `NOT_FOUND`, `EXISTS`, `CLI_FAILED`, `GITHUB_LIMIT`, `BACKUP_FAILED`) and a French `message`.

| Module | Exports |
|---|---|
| `worker.mjs` | `call(fn, args, { home })`: runs `app/lib/skills-worker.mjs` in a child process with `HOME`/`USERPROFILE` = `home`, sends `{ fn, args }` on stdin, returns the parsed JSON result. `skills-worker.mjs` imports `skills` and exposes `getSupportedAgents`, `detectAgents`, `listSkills`, `installSkills`, `removeSkills`, and `cli(args)` (runs `node_modules/skills/bin/cli.mjs` with `process.execPath`, returns `{ code, stdout, stderr }`). |
| `registry.mjs` | `TOP_AGENTS` (array of ids, in display order); `listAgents({ home, settings })` → `Agent[]` (78 known agents, top ones first, then the others by name, then custom agents). |
| `settings.mjs` | `readSettings({ home })`, `addCustomAgent({ home, name, dir })` → agent, `removeCustomAgent({ home, id })`, `hideAgent({ home, id })`, `showAgent({ home, id })`, `setTargets({ home, ids })`. |
| `backups.mjs` | `listBackups({ home })` → `Backup[]` (newest first), `createBackup({ home, name, src, agents, from })` → `Backup`, `restoreBackup({ home, id })`, `deleteBackup({ home, id })`. |
| `inventory.mjs` | `getState({ home, cwd })` → `State` (see below). Reads agents, installed skills (`listSkills` global and project), the lock file, the disabled folder, runs `tools/skill-scan.mjs` on each skill folder, counts characters of `SKILL.md` front matter description. |
| `actions.mjs` | `install({ home, cwd, items, agents, scope })`, `remove({ home, names, agents, backup })`, `update({ home, names, force })`, `check({ home })`, `disable({ home, names, agents })`, `enable({ home, names, agents })`, `removeAgentSkills({ home, agent, backup })`. Each returns the result object of the matching route below, without `state`. |
| `catalog.mjs` | `getCatalog({ url, bundledPath, timeoutMs })` → catalogue object plus `source: "online" \| "bundled"`. URL from `CATALOG_URL`; no URL or failure → `catalog/catalog.json`. |

## Shapes

```
Agent  = { id, name, detected: bool, top: bool, universal: bool, globalDir: string|null, custom: bool, hidden: bool, target: bool, count: number }
Row    = { id, name, src, real: bool, st: "ok"|"maj"|"ng", on: bool, ag: { [agentId]: "ok"|"div"|"ko" }, chars: number|null, warn: 0|1|2, note: number|null,
           scan: { verdict, findings: [{ rule, sev, label, file, line, excerpt }] } | null, path: string, scope: "global"|"project", diff?: { from, to, scan: { level: 0|2, text } } }
Backup = { id, label, note, origin: "remove"|"manual"|"import"|"replace", at, size, items: [{ name, src, agents: [id], verdict }], name, src, agents: [id] }
State  = { mode: "live", os: "mac"|"win"|"linux", home, cwd, agents: Agent[], mine: Row[], backups: Backup[], settings }
```

- `Row.id` = `<src>/<name>` when the source is known (same id as the catalogue), else `local/<name>`. `real` = the id exists in the catalogue.
- `Row.warn`: 2 if the static check says `rouge`, 1 if `orange`, else 0.
- `Row.st`: `maj` when `check` reports an update, `ng` when the skill is not in the lock file (copied by hand), else `ok`.
- `Row.on`: false when the skill sits in the disabled folder.
- `Row.ag[agentId]`: `ok` when the agent folder holds the skill (or the agent is universal and reads `~/.agents/skills`), `ko` when a link is broken, `div` when the agent holds a copy whose content differs from the shared folder.

## Backups, step 1 (13/11/2026)

- A backup holds one or more skills. `name`, `src` and `agents` repeat the first item, so the old single-skill shape still works. Backups made before this step (one skill, no `items` in `meta.json`) are read as one item.
- `meta.json` version 2: `{ "version": 2, "id", "label", "note", "origin", "at", "size", "items": [{ "name", "src", "agents", "places", "lock", "skipped", "copy" }] }`. Each item's main copy sits in `<id>/<name>/`, its other copies in `<id>/copies/<n>/<name>/` as today. `label` is at most 80 characters, `note` at most 500.
- `origin`: `remove` (made by an uninstall), `manual` (made on demand), `import` (from an archive), `replace` (made before a skill was replaced by an apply).
- `verdict` of an item: the static check (`vert`, `vert-remarques`, `orange`, `rouge`) of its main copy at backup time.
- Export: one `.tar.gz` holding `skill-advisor-backup.json` (`{ "format": "skill-advisor/backup/1", "meta": … }`) and the backup folder content. Regular files and folders only.
- Import: refused (`BAD_ARCHIVE`) when an entry is not a regular file or folder, has an absolute path or `..`, the total is over 200 MB or 100000 entries, the manifest is missing or wrong, or an item name is invalid. Every item is checked again (static check) and stored as a new backup with `origin: "import"`.
- Apply: copy chosen items of a backup to chosen agents (any known agent or custom agent, not only the original ones). For each item and agent: same content already there → `skipped` with reason `identical`; different content → `conflict: "skip"` leaves it (`skipped`, reason `exists`) and `conflict: "replace"` first makes a backup of what is there (`origin: "replace"`), then replaces it. An item whose verdict is `rouge` is applied only when its name is in `force`. The skill goes to `~/.agents/skills/<name>` and is linked (junction on Windows) from agents with their own folder; a custom agent gets a copy. The lock entry saved in the backup is written back when the source is known.
- Apply results: `skipped[].reason` is `identical`, `exists` or `rouge` (rouge item without `force`). A `failed` entry has `agent: null` when the name is not in the backup or when writing the lock file failed. Apply fails for an agent whose copy of the skill is disabled, and for the shared folder when `~/.skill-advisor/disabled/universal/<name>` exists.
- `replace` on an agent that reads, or links to, `~/.agents/skills` replaces the shared folder: every agent that reads it gets the new content.
- Import keeps a lock entry only when every field is checked (GitHub or GitLab source, matching `sourceUrl`, relative `skillPath`, safe `ref`); otherwise the entry is dropped with a warning and the skill is not tracked by updates. Import accepts `application/gzip` or `application/octet-stream`; an empty body gives `BAD_ARCHIVE`.
- Restore: copies saved as disabled go back to `~/.skill-advisor/disabled/<agent>/<name>`, never active. An item whose saved verdict or rescan is rouge needs `force`. A copy saved from a link (`link: true`) comes back as a real folder; the link target is never stored.
- Apply: when the shared folder is replaced and the backup has no usable lock entry, the existing entry is removed and a warning says so. Lock sources kept or written: `owner/repo`, or `https://github.com/…` / `https://gitlab.com/…` with no user, port or IP.
- Stage folders under `~/.skill-advisor/tmp` older than one hour are swept at server start and before each export or import.
- Library returns: `createManualBackup` → `{ backup, failed }`, `exportBackup` → Buffer, `importBackup` → `{ backup, warnings }`, `applyBackup` → `{ applied, skipped, failed, backups, warnings }`.

## HTTP API (`app/server.mjs`)

All requests to `/api/*` need the header `X-SA-Token: <token>`, a `Host` header equal to `127.0.0.1:<port>` or `localhost:<port>`, and, when an `Origin` header is present, an origin equal to `http://127.0.0.1:<port>` or `http://localhost:<port>`. Otherwise: `403 { "error": "forbidden" }`. Bodies: JSON, at most 1 MB. Errors: `{ "error": "<code>", "message": "<French text>" }`: 400 (`BAD_ARCHIVE`, `BAD_INPUT`, `BAD_JSON`, `BAD_NAME`, `BAD_SOURCE`), 403 (`forbidden`), 404 (`NOT_FOUND`), 409 (`EXISTS`, `ROUGE`), 413 (`TOO_LARGE`), 415 (`UNSUPPORTED_TYPE`), 500 (`INTERNAL`, `CLI_FAILED`, `BACKUP_FAILED`), 502 (`GITHUB_LIMIT`).

| Method, path | Body | Response |
|---|---|---|
| `GET /` | – | the interface (`prototype/dist/preview.html`) with `<script>window.SA_LIVE={token:"…"}</script>` injected right after `<head>`. Accepted with `?c=<code>` (valid, unused: the code is consumed and the reply sets the cookie `sa=<token>; HttpOnly; SameSite=Strict; Path=/`) or with a valid `sa` cookie (reloads). Otherwise 403 with a short French page. The cookie never authorises an `/api` call. |
| `GET /api/state` | – | `State` |
| `GET /api/catalog` | – | catalogue + `source` |
| `POST /api/skills/install` | `{ items: [{ source, skill }], agents: [id], scope: "global"\|"project" }` | `{ installed: [name], skipped: [name], failed: [{ name, message }], state }` |
| `POST /api/skills/remove` | `{ names: [name], agents?: [id], backup: bool }` | `{ removed: [name], backups: [Backup], failed, state }` |
| `POST /api/skills/update` | `{ names?: [name], force?: [name] }` | `{ updated: [name], held: [name], failed, state }` |
| `GET /api/skills/check` | – | `{ outdated: [{ name, scanNew: null }] }` (the new content is checked during `update`, which holds a `rouge` version back) |
| `POST /api/skills/disable` | `{ names: [name], agents?: [id] }` | `{ done: [name], failed, state }` |
| `POST /api/skills/enable` | `{ names: [name], agents?: [id] }` | `{ done: [name], failed, state }` |
| `POST /api/backups/restore` | `{ id, force?: [name] }` | `{ state }`; `409 { error: "ROUGE", message, names }` when an item is rouge and not in `force` |
| `POST /api/backups/delete` | `{ id }` | `{ state }` |
| `POST /api/backups/create` | `{ names: [name], label?, note? }` | `{ backup, failed, state }` |
| `POST /api/backups/apply` | `{ id, names?: [name], agents: [id], conflict: "skip"\|"replace", force?: [name] }` | `{ applied: [{ name, agent }], skipped: [{ name, agent, reason }], failed: [{ name, agent, message }], backups: [Backup], warnings: [text], state }` |
| `GET /api/backups/export?id=<id>` | – | the archive, `Content-Type: application/gzip`, `Content-Disposition: attachment; filename="skill-advisor-<id>.tar.gz"` |
| `POST /api/backups/import` | the archive itself, `Content-Type: application/gzip`, at most 200 MB (the only route with a limit above 1 MB) | `{ backup, warnings: [text], state }` |
| `POST /api/agents/custom` | `{ name, dir }` | `{ agent, state }` |
| `DELETE /api/agents/custom/<id>` | – | `{ state }` |
| `POST /api/agents/hide` | `{ id }` | `{ state }` |
| `POST /api/agents/show` | `{ id }` | `{ state }` |
| `POST /api/agents/targets` | `{ ids: [id] }` | `{ state }` |
| `POST /api/agents/empty` | `{ id, backup: bool }` | `{ removed: [name], backups, failed, state }` |

`update` holds back (does not apply) a skill whose new version gets a `rouge` verdict, unless its name is also listed in `force`.

Notes:
- `names` and `force` are on-disk folder names (last segment of `Row.path`), not front-matter names.
- Write routes act on global skills only. The interface disables them for rows with `scope: "project"`.
- `POST /api/agents/targets` with an empty list falls back to the detected agents.
- A custom agent `dir` is stored as its real path. Refused (`BAD_INPUT`): the file-system root, the home folder and its ancestors, anything inside `~/.skill-advisor`, and any folder equal to, inside or containing `~/.agents/skills` or a known agent's skills folder.
- `disable`, `remove` and `empty` act only on real skill entries (a link, or a folder holding `SKILL.md`).

## Interface (`prototype/src/live.js`)

- Live mode is on when `window.SA_LIVE` exists. `live.js` removes the query string with `history.replaceState` at load. Then `live.js` fetches `/api/state` before `SA.start()`, replaces `SA.data.mine`, `SA.data.agents` and `SA.state.backups`, and exposes `SA.live.call(method, path, body)` → Promise, which sends the token header and, on success, replaces the state with the returned `state`.
- Without `window.SA_LIVE`, nothing changes: `prototype/dist/preview.html` stays the example machine.
- Agent ids in live mode are the CLI ids (`claude-code`, `gemini-cli`, …).
- `SA.live.upload(path, data, type)` posts a file as the request body with the token header; `SA.live.download(path)` gets a file with the token header and returns `{ blob, name }`.
