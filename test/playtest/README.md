# playtest

Created: 2026-10-16
Purpose: play the first five minutes of Game Studio from a clean start, the way a newcomer would, and keep pictures,
one video per screen size, how long each wait was, console errors and every English text seen, in one `report.md`.
It finds and records; it never fixes anything and never stops at the first problem.

## Run

```sh
node oss/game-studio/test/playtest/playtest.mjs                       # this checkout, three-crates + pixi-garden, PC + phone
node oss/game-studio/test/playtest/playtest.mjs --worktree ../other-checkout --sample starters/harbor
node oss/game-studio/test/playtest/playtest.mjs --only phone three-crates
```

With a real AI (Claude Code and/or Codex, this checkout's plugin, an empty folder; about $1-3 and up to 15 minutes
per agent): `node oss/game-studio/test/playtest/realagent.mjs [--agent claude|codex]` — see the top of `realagent.mjs`.

| Option | Meaning |
|---|---|
| `--worktree <path>` | Another checkout (its root, or the game-studio folder in it). Only read: its `skills/arrange/bin/studio.mjs` and samples run from a temporary copy. Every output goes into **this** checkout. |
| `--sample <id\|path>` (repeatable, or bare words) | `three-crates`, `starters/<id>`, `examples/<id>` or a folder. A bare id is looked up in `starters/` first, then `examples/`. Default: `three-crates pixi-garden`. |
| `--only pc\|phone` | One screen size (PC 1280×800 with a mouse, phone 390×844 with touch). |
| `--out <dir>` | The folder for this run. Default: `<out-base>/<date>-<time>-<branch>/`. |
| `--out-base <dir>` | Where dated run folders go. Default `./playtest-results`. A repository can keep a one-line launcher that passes its own place. |
| `--no-empty` | Skip starting the editor in an empty folder. |
| `--cdn-cache <dir>` | Answer `cdn.jsdelivr.net/npm/...` from local copies (no network). Default: the network, as a real person has. |

Needs Node 22+, a headless Chrome (the same lookup as `../adapters-2d/cdp.mjs`, or `STUDIO_CHROME`) and, for the
video, `ffmpeg` with libx264 (`STUDIO_FFMPEG`). Nothing is installed. A 4-run play test takes about 4 minutes and
writes about 6 MB.

## What one run does

1. Empty folder: starts the editor with no game and records what it says (the first five minutes start there).
2. For each sample and screen size: a new temporary copy, a new `HOME` for the editor (no sign-in, no settings), a
   new browser profile in `en-US`. Starts the editor as the skill does (`studio.mjs <folder> --no-open`, URL from the
   `studio: ready` line), then: open → press an object → drag it → Turn (strip button, then drag) → Size → Copy (the
   card's button) → type one English sentence in the box at the bottom and press Enter (checks the request file in
   `.studio/requests/`) → Save (checks the `studio: saved` line and `placement.json`) → wait up to 25 s with no AI
   connected → Play.
3. `report.md`: timing table, stumbles the script noticed (heaviest first), each step with its picture, the video,
   console errors, the editor's output, and every text seen on screen. The `Reviewer notes` heading at the top is for
   the person who watched the videos.

## Files

- `playtest.mjs` - command line, empty-folder probe, temporary copies, output folder
- `user.mjs` - the newcomer's steps in one browser (and starting the editor)
- `recorder.mjs` - screencast frames → mp4, screenshots, the wait clock
- `report.mjs` - report.md
- `realagent.mjs` - the same first minutes with a real Claude Code / Codex: `/arrange` → 3D → ask in English → Save →
  Undo AI change, timed, with the whole conversation (`transcript.md`)
- `agents.mjs` - runs Claude Code (one stream-json conversation, so its watch can wake it) and Codex (`exec` /
  `exec resume`), in a newcomer's environment, and the newcomer's answers to their questions
- `realreport.mjs` - report.md and transcript.md for one real-agent run
