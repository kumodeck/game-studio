# server

The local studio server, bundled into `skills/arrange/bin/studio.mjs` (one file, Node only, no
dependencies). It is the local implementation of the host interface (contract 3).

    node skills/arrange/bin/studio.mjs <game folder> [--lan] [--no-open] [--port n] [--entry file] [--ui folder] [--check-view]
    node skills/arrange/bin/studio.mjs <game folder> --detach               # start it on its own (outlives the agent's turn): "studio: ready <url> pid <n>"
    node skills/arrange/bin/studio.mjs <game folder> --stop                 # stop this folder's editor (its stop secret, else pid: .studio/server.json) + watch (pid: watch.json)
    node skills/arrange/bin/studio.mjs <game folder> --requests | --status <state> [--request id] [--changed n] [--note text]
    node skills/arrange/bin/studio.mjs <game folder> --watch                 # the agent's watch (Monitor): a line per request, .studio/watch.json while it runs
    node skills/arrange/bin/studio.mjs <empty folder> --starter 3d|2d|<id>   # copy a sample game in, then open it (refused when any game page is there)
    node skills/arrange/bin/studio.mjs --starters                            # list the samples (JSON lines)

- `node-check.mjs` - first code in studio.mjs: on Node older than 22.13, one line ("Game Studio needs Node 22.13 or newer. You have X. Install: https://nodejs.org") and exit 1
- `starters.mjs` - sample games for a folder without one (`starters/<id>/` with `starter.json`; falls back to examples/three-crates and pixi-garden); `studio: no-game` (exit 4) and `--starter`
- `find-game.mjs` - no `index.html` (and no `--entry`): finds the person's game page by any name (`neon-orb.html`, `game.html`, `dist/index.html`) by what it runs (engine, canvas, loop; readme/about/test pages never), prints `studio: entry <page>`, serves that page's folder; `studio: build-first` (exit 5) when only a Vite source is there (2026-10-21)
- `cli.mjs` - arguments, browser opening, stdout lines (`studio: ready|saved|added|next-step|request|stopped`), the EPERM line for sandboxes, and `--requests` / `--status` for the agent (hand-offs, CONTRACT.md §3.4)
- `lifecycle.mjs` - `--detach` (a new session, so Codex ending its turn does not end the editor), `.studio/server.json` (this folder's editors: pid, address, stop secret) and `--stop` (POST /__studio/stop with the secret — works in Codex's sandbox — else by pid, never by name; agent-solid pass 2026-10-17)
- `server.mjs` - HTTP: pass + cookie, Host check, routes, API
- `ai-watch.mjs` - `--watch` (one line per request, the heartbeat `.studio/watch.json`) and reading it back as "is an AI watching" (AI feel, 2026-10-16)
- `ai-undo.mjs` - the game files' signature (the editor reloads the game when it changes) and the snapshots in `.studio/undo/` behind "Undo AI change"
- `files.mjs` - what may be served or written (inside the folder only, no dot-files, no overwrites)
- `assets.mjs` - asset list with `refsInCode` and names in code that match no file
- `next-steps.mjs` - text written to `.studio/next-step.md` for the "next step" menu
- `view-check.mjs` - `--check-view`: headless Chrome shoots the game in the editor and played normally, compares; writes `.studio/view-check.md`
- `kumo.mjs` - optional KUMODeck sign-in: reads the CLI's `~/.kumo/credentials.json`, makes AI pictures / 3D models through KUMODeck and adds them to `assets/` (the key never leaves this process)
- `qr.mjs` - QR encoder for `--lan` (terminal and SVG)
- `local-host.client.js` - the browser side of the host interface, served at `/__studio/host.js`
- `fallback.html` - page shown at `/__studio/` when no built editor UI is next to studio.mjs
- `embedded.mjs` - reads the browser files from disk; replaced by string constants in the bundle
- `build.mjs` - `node src/server/build.mjs` writes `skills/arrange/bin/studio.mjs` and `studio-placement.js`
- `*.test.mjs` - `node --test src/server/server.test.mjs src/server/ai-feel.test.mjs src/server/qr.test.mjs src/server/kumo.test.mjs`

## API (all under the session cookie, same origin only for writes)

| Method and path | Does |
|---|---|
| `GET /__studio/?t=<pass>` | trades the pass for an HttpOnly SameSite=Strict cookie, redirects to `/__studio/` |
| `GET /__studio/api/open` | `{ gameUrl, origin, lanUrl, title }` (title = page `<title>` or folder name) |
| `GET /__studio/api/files/placement` (or `library`) | `{ value }` (null when missing or invalid, with `error`) |
| `PUT /__studio/api/files/placement` (or `library`) | validates, writes atomically, keeps a `saved` request; 422 with `details` when invalid |
| `GET /__studio/api/assets` | `{ assets: [{ path, size, type, refsInCode }], missing: [{ ref, in }], truncated }` |
| `POST /__studio/api/assets?name=<file name>` | raw body; adds `assets/<safe name>` (never overwrites; `-2`, `-3` ...) |
| `POST /__studio/api/next-step` | `{ "id": "publish" \| "multiplayer" \| "save-data" \| "ai-assets" }`; writes `.studio/next-step.md` |
| `POST /__studio/api/request` | a request for the AI (`ask` / `name` / `next-step`); keeps `.studio/requests/<id>.json`, prints `studio: request …` (or the `next-step` line for KUMODeck steps) |
| `GET /__studio/api/status` | `{ status, time, watching, seen?, code }`: the AI's `.studio/status.json` (lenient: broken = null), whether its `--watch` runs, and the game files' signature |
| `POST /__studio/api/undo` | `{ "to": "<request id>", "redo"?: true }`: puts the game's files back as they were at that request (the files before become the `redo` snapshot); keeps an `undone` request, prints `studio: undone …` |
| `GET /__studio/api/kumo/status` | `{ signedIn, loginCommand, email?, balanceCents?, project?, projects?, jobs?, topUpUrl? }` (never the key) |
| `POST /__studio/api/kumo/project` | `{ "projectId" }` when the folder has no kumo.json |
| `POST /__studio/api/kumo/image` | `{ prompt, width?, height?, quality?, tiling?, format?, name?, acceptTerms? }` → `{ path, costUsdMicros, balanceCents }`; refusals are 422 `{ error, code }` (`signed_out`, `needs_terms`, `not_enough`, `not_open`, ...) |
| `POST /__studio/api/kumo/model3d` | `{ prompt, texture?, acceptTerms? }` → the job; `GET /__studio/api/kumo/model3d/<id>` until it has `path` |
| `GET /__studio/api/lan-qr.svg` | with `--lan` only: QR code of the editor link |
| `GET /<path>` | game files; HTML gets `<script src="/__studio/studio-edit.js">` first in `<head>` |
