---
name: arrange
description: Open a local visual editor next to a web game so the user can drag, rotate and scale objects (placement) and see, swap or add the assets the game uses (library), then apply the saved placement.json / library.json to the game's code. Works with three.js out of the box; for Phaser, PixiJS, plain canvas or DOM games, home-made engines and Godot web exports, you first write a small adapter for the game from the bundled examples. Use when the user wants to move, position, line up, rotate or resize things in their game ("put the tree a bit to the right", "fix the layout", "arrange the level", "/arrange"), or wants to see, swap or clean up the game's images, models and sounds ("what assets does my game use", "replace this texture", "/arrange library"). Also use it to fit the editor to one game ("snap to the grid", "only 90° turns", "keep things inside the field", "a tool to draw the course") or to change how the editor itself looks ("put the list on the left", "make it light", "bigger buttons", "fewer buttons"). Also covers requests the user sends from the editor ("ask your AI about this object", "name it", "ideas for your AI": fit, look, tool, publish, multiplayer, save data, 3D models) and telling the editor how your work is going. When the user says "look" (in any language) while the editor is open, read `.studio/requests/`.
---

# Arrange: placement editor and asset library

Typing coordinates back and forth ("a bit more to the right… no, less") is the slowest part of building a game with
an AI. This skill opens a small local editor where the **user** moves things by hand and the **editor writes a file**.
You (the agent) then read that file and change the code. The editor never edits the game's code by itself, with one
exception the person asks for: **Undo AI change** puts the game's files back exactly as they were before your last
change (and tells you, §3.1).

Two tools share one editor:

| Tool | The user does | The editor writes |
|---|---|---|
| **Scene** (placement) | Clicks an object, then drags, rotates and scales it (and lifts it, in 3D). Undo/redo with Ctrl/Cmd+Z. | `placement.json` in the game folder |
| **Assets** (library) | Sees every asset the game has or loads, which object uses which asset, which files are unused or missing; swaps an asset or drops in a new file. | `library.json` in the game folder (new files go into `assets/`) |

Everything runs on this machine. The server binds to `127.0.0.1`, needs no account, sends nothing anywhere, and only
serves and writes inside the game folder.

When the user starts this as a command (`/arrange` in Claude Code, `$arrange` in Codex): the word `library` in the
arguments means open on the library tool (`--tool library`); any other argument is the game folder. Without a folder,
use the current directory if it has an `index.html`, otherwise find the game's `index.html` and ask if there are
several. **If there is no game at all** (an empty folder, or only notes and config), do not stop and do not write a
game yourself: offer a sample, below.

## 0. A folder without a game: start from a sample

Someone trying the editor for the first time often has no game yet. Look once (the folder and its subfolders, not
`node_modules`): no `index.html` anywhere = no game. Then:

1. Ask **one** question, in the user's language, and nothing else first: **"There's no game here yet. Want to start from a
   sample? Pick 3D or 2D."** (in Claude Code, in a terminal or the Claude app, a question with the two choices). If they say no, stop there.
2. Start the editor with the answer; it copies the sample into the folder and opens it, in one command (use the
   folder's **absolute path**, not `.`):

   ```sh
   node <this skill's folder>/bin/studio.mjs /absolute/path/to/folder --starter 3d --detach   # or --starter 2d
   ```

   It prints `studio: started <id> (<n> files) <title>`, then `studio: ready <url> pid <n>`, and returns: the editor
   keeps running on its own (§3). Then start the watch, if your environment has one (§3). It never overwrites a file
   and refuses a folder that already has a different game; the same line run again opens the same sample. The samples
   are three.js (3D) and PixiJS (2D) with their adapter included, so skip §1 and §2. In the Claude app, add
   `--no-open` and open the editor next to the chat (§3, "In the Claude app").
3. Tell the user the URL (in the Claude app: "The editor is open next to this chat." instead) and one line: "Here's a sample game in your folder. Click anything and drag it to move
   it, type a change in the box at the bottom, and click Save when you like it."
   Say nothing else about the editor: not the self-check (mention it only if it printed
   `studio: check failed`), not the watch, not the log.
4. **The samples already read `placement.json` when they start** (the loader is in them, §4 Way 1). When the person
   saves, do not ask how to apply it: look at the game (§3.3), set `done`, and tell them it's in.

If you ran the editor without `--starter` in a folder with no game, it printed
`studio: no-game <folder> - ask once … --starter 3d (<title>) or --starter 2d (<title>)` and exited with code 4:
that is the same question; ask it. `--starters` lists the samples as JSON (id, dim, title, blurb).

Your work, in order:

1. Find out how the game is built and make sure the editor can talk to it (§1). For anything other than three.js,
   that means writing a small **adapter** once (§2).
2. Start the editor and wait for one-line messages from it (§3).
3. Read the saved files and apply them the way the user chose (§4–§7).

When the user asks to fit the editor to their game, or to change how the editor looks, use §8 and §9. Both only add
files under `.studio/` in the game folder; the editor itself, the game code and the saved files stay as they are.

## 1. Look at the game first

You need the folder that the browser can run as-is: the one with the game's `index.html`. If the project needs a
build step (Vite, webpack, a Godot export), see the table below. Node.js 22.13 or newer must be on the PATH
(`node --version`). Nothing else gets installed: the server is one file with no dependencies. On an older Node the
editor stops at once with one line (`Game Studio needs Node 22.13 or newer. You have 20.11.0. Install:
https://nodejs.org`): pass it on to the user as it is, and do not try to work around it.

Read `index.html`, the main script and `package.json` (if any) and decide which row fits:

| You see | The game is | What the editor needs |
|---|---|---|
| `import … from 'three'`, a `three` URL on a CDN, `new THREE.Scene()` | **three.js** | Nothing. Built in. (Very old three.js, or a scene the editor cannot find: [`references/adapters.md`](references/adapters.md#when-the-threejs-adapter-cannot-find-the-scene)) |
| `phaser` import or CDN script, `new Phaser.Game(…)` | **Phaser** | Adapter from `adapters/phaser.js` |
| `pixi.js` import or CDN script, `new Application()`, `PIXI.` | **PixiJS** | Adapter from `adapters/pixi.js` |
| A `<canvas>`, `getContext('2d')`, the game draws every object itself in its own loop (also p5.js and similar) | **Plain canvas** | Adapter from `adapters/canvas.js` |
| Objects are HTML elements moved with `style.left/top` or `style.transform` | **DOM** | Adapter from `adapters/dom.js` |
| `index.pck` + `index.wasm` next to `index.html`, `new Engine(…)`, a `project.godot` in the source | **Godot 4 web export (2D)** | Adapter from `adapters/godot/` (a GDScript part and a JS part), then re-export |
| Babylon.js, PlayCanvas, Unity WebGL, a Godot 3D scene | Not supported yet | Tell the user so instead of opening an editor that will show nothing |

- When the game mixes several, pick the one that **owns the objects the user wants to move** (a three.js world with a
  DOM menu is three.js).
- `adapters/` is in the same folder as this `SKILL.md`. Each example is short and commented; you copy one and fit it
  to the game. Details in [`references/adapters.md`](references/adapters.md).
- If the game is built by a bundler, open the folder the bundler writes (`npm run build`, then `dist/`), or the dev
  server's root if it serves plain files. Result files are written into the folder you open: when that is a build
  output, copy `placement.json` / `library.json` back next to the source before you apply them, and say so.
- For a Godot game, open the **web export folder**; you apply the results to the Godot project (§4, "Godot").

## 2. Write the adapter (every engine except three.js)

The editor never depends on a game library. It talks to one fixed, small port, and **you write the code that connects
that port to this game**. You do it once per game; the file stays in the game folder and you only touch it again when
the game's structure changes a lot.

1. Copy the matching example from `adapters/` to **`.studio/adapter.js`** in the game folder. The editor loads that
   file only while editing, right after its own script and before any game code. The game never loads it when it is
   played normally, so it cannot break the game.
2. Read the game code and change the parts of the example marked `EDIT HERE` so they point at this game:
   - **where the movable objects live** (the stage or scene, a list such as `enemies` / `level.objects`, DOM elements);
   - **their keys** (§5): the game's own mark, then a name, then a position in the list (marked unstable);
   - **how to read and write a pose** (`x`, `y`, angle, scale, in the object's parent space);
   - **where they are on screen** (the canvas position and CSS scaling included);
   - **how to draw one frame** while the game's own loop is paused.
3. Leave out what the user should not drag: UI layers, the background, particles, the camera, the player's HUD.
   Keep the example's `order()` / `setOrder()` (draw order, "what is in front") pointed at the list the game draws
   from; see [`references/layer-order.md`](references/layer-order.md#the-adapter-part-port2d).
4. If the game keeps its objects in variables the adapter cannot reach (module scope, closures), add **one line** to
   the game that exposes them only while editing, for example
   `if (window.studio) window.studio.game = { objects, draw };`
   and read them from there in the adapter. Do not restructure the game for the editor.
   Phaser 3 (3.60 and later) and Phaser 4 both work with `adapters/phaser.js` as it is: change only its
   `EDIT HERE` parts, not its camera maths.
5. Open the editor (§3). It runs a **self-check** at once and tells you the result in one `studio: check …` line, with
   details in `.studio/check.md` (the check runs when the editor page loads; with `--no-open`, before anyone opens
   it, step 6's `--check-view` runs it and prints the same `studio: check …` line). Fix what it names and reload the editor page in the browser (the server reads
   `.studio/adapter.js` again on every load; no restart needed). Do not hand the editor to the user until the check
   passes.
6. Then run the **view check** once (2D games): `node <this skill's folder>/bin/studio.mjs <game folder> --check-view`.
   It compares the game inside the editor with the game played normally, in a private headless browser, and prints
   `studio: check-view ok|failed|skipped`. `failed` means the adapter changes how objects are drawn (for example a
   thumbnail step that leaves an object changed): read `.studio/view-check.md`, fix, and run it again. Run it again
   after every change to the adapter.
7. Never start the person's own browser (Chrome, Safari…) yourself to look at the game or the editor: `--check-view`
   and `--shot` (§3.3) look in a private headless browser of their own.

The checks, and what usually fixes them, are in [`references/adapters.md`](references/adapters.md#the-self-check)
and [the view check](references/adapters.md#the-view-check).
The three.js adapter is built in and the same self-check runs for it.

## 3. Start the editor and wait

The server ships next to this file: `bin/studio.mjs` in the same folder as this `SKILL.md`. Use its absolute path
(you know where you read this file from).

```sh
node <this skill's folder>/bin/studio.mjs <game folder> --detach                # placement first
node <this skill's folder>/bin/studio.mjs <game folder> --detach --tool library # open on the library
node <this skill's folder>/bin/studio.mjs <game folder> --detach --lan          # also reachable from a phone on the same Wi-Fi (QR code in the log)
node <this skill's folder>/bin/studio.mjs <game folder> --stop                  # when the user is finished
```

`<game folder>` is always the folder's **absolute path** (not `.`).

- **Start it with `--detach`.** It starts the editor on its own, prints `studio: ready <url> pid <n>` and returns at
  once; the editor keeps running after the command and your turn end (its output goes to
  `<game folder>/.studio/studio.log`). Do not start it with `&`, `nohup` or a background shell instead: in Codex
  those end with your turn and the person gets a blank page. Running the same line again prints the running editor's
  URL instead of starting a second one. It opens the user's default browser by itself. The URL carries a one-time
  passcode: give the user the URL exactly as printed. Do not open it with your own browser tools unless the user asks
  you to check something, with one exception: the Claude app, below.
- **In the Claude app (a browser pane next to the chat).** Look at your tools once, before you start the editor. If
  you have `mcp__Claude_Browser__preview_start` (the browser inside the Claude desktop app; it may be listed as a
  deferred tool, so load it first), the person is in the app and may never open a terminal or another browser. Then:
  1. Add `--no-open` to the start line, so no second browser window opens:
     `node <this skill's folder>/bin/studio.mjs <game folder> --detach --no-open` (keep `--tool library`,
     `--starter …` or `--lan` if you use them).
  2. Call `tabs_context` (load it together with `preview_start`). If a tab already shows this exact URL (the editor was
     already running), don't open a second one. Otherwise call `preview_start` with `url` set to the URL from
     `studio: ready`, exactly as printed: the editor opens in a tab of the pane next to the chat. Then call
     `tabs_context` again: its last line says whether the Browser pane is shown, hidden or not open.
  3. Tell the person: "The editor is open next to this chat." and what to do, in one line ("Click an object and
     drag it. When you're done, click **Save**."; for a sample, the line from §0 step 3 instead). Don't print the
     URL unless they ask for it. If the pane is hidden or not open, add: "Press ⌘⇧B to show it (Ctrl+Shift+B on
     Windows)." If they say the pane is too narrow: "The ↗ button at the top right of the editor opens it in a large
     window." (the same editor, pass included; asking you and Save work there the same way).
  4. If `preview_start` returns any error (the site isn't approved, the pane can't be reached) or the person
     declines the site, don't retry: give the URL as usual, "Open this link in your browser: <url>". Nothing else
     opened it, because of `--no-open`.

  Everything else is the same, including the watch: the Claude app wakes you on its lines like Claude Code in a
  terminal (§3, "The watch"). Reloads and `--stop` too. **Only the `mcp__Claude_Browser__` tools count.**
  `mcp__remote-devices__Claude_Browser__*` is a pane on the person's computer while you run somewhere else, so it
  can't reach this editor on `127.0.0.1`: start it the usual way, without `--no-open`. No such tool (Claude Code in
  a terminal, Codex, an IDE): start it as before; it opens the default browser.
- **Stop it only with `--stop`** (when the user says they are finished): it stops the editor and the watch started
  for this folder and nothing else (it asks this folder's editor to stop, using the secret in `.studio/server.json`,
  so it works inside a sandbox too; otherwise by pid). **Never stop it by
  name** (`pkill`, `killall`, `kill` on a `pgrep` / `ps` match): another editor on this computer can have the same
  command line, and you would stop the person's other work.
- The user does not talk to you inside the editor: there is no chat there. What they send from it (saves, words about
  an object, "name these", an idea from "Ideas for your AI") is **kept as a file first** in
  `.studio/requests/<id>.json` (§3.1), and the server also prints **one line on standard output that starts with
  `studio:`**. The line is a bonus for when you are watching; the files are what you rely on:

| Line starts with | Meaning | What you do |
|---|---|---|
| `studio: ready` | The editor is up; the line has the URL | Tell the user the URL and what to do ("Click an object and drag it. When you're done, click **Save**."). In the Claude app, open it next to the chat first (above) |
| `studio: check ok` | The adapter works | Nothing; the user can start |
| `studio: check failed` | The adapter (or the built-in three.js one) does not work for this game | Read `.studio/check.md`, fix `.studio/adapter.js` (§2), ask the user to reload the page |
| `studio: unnamed` | Some objects have no name (`path:` keys; the line lists them) | §3.2: offer **once** to name them, before the user saves |
| `studio: saved placement` | `placement.json` was written | §4 |
| `studio: saved library` | `library.json` was written | §6 |
| `studio: next-step` | The user picked a KUMODeck item in "Ideas for your AI", or pressed "Ask AI to delete" (Delete) on unused files in the library (`next-step delete-files`) | Read `.studio/next-step.md`, then §7 (delete-files: §6) |
| `studio: request ask` | The user typed a request about the picked objects ("add 3 more in a row") — the names in brackets, then any files they picked in the Library (`(assets/boss.glb)`) —, or about the whole game when the line ends with `(whole game)` | §3.1 |
| `studio: request name` | The user asked you to name objects that have no name | §3.1 and §5 (add a mark) |
| `studio: request next-step fit` / `look` / `tool` | An in-game idea, with the user's words | §3.1, then §8 (fit, tool) or §9 (look) |
| `studio: saved .studio/data/<tool>.json` | A game tool you wrote (§8) saved its data | Read that file and apply it like placement.json (a loader, without asking, §4) |
| `studio: undone` | The person pressed **Undo AI change**: the editor already put the game's files back as they were before your last change | §3.1 (`undone`): do not redo it |
| `studio: watching <n> waiting` | Your watch (`--watch`, below) started with requests waiting; they follow, one line each (with none waiting it prints nothing) | Handle them in order |
| `studio: watch rest …` | Your watch ended on time (after 29 minutes), nothing is wrong | Start the same watch again at once (below). Say nothing |
| `studio: request play` | The person asked while **playing** the game in the editor (▶ Play; the game is still running): their words, then `while playing`, the picture of that moment and how many console errors came with it | §3.1 (`play`): fix it without stopping their game |
| `studio: answer` | The person answered your `asking` question in the editor (a button or their own words; the question and the request it is about follow) | §3.1 (`answer`): go on with that answer |
| `studio: from the Game Studio editor …` | The plugin's hook woke you (below, "Woken by the editor"): the lines under it are requests, same words as above, each ending with the game folder in `[…]` | Handle them in order (§3.1), like watch lines |

- How to wait depends on your environment. The main path works everywhere; the watch is what makes it feel
  instant, so use it whenever your environment can wake you on a new output line:
  - **Main path (every environment):** start the server with `--detach` (above), take the URL from its
    `studio: ready` line. In Claude Code you say nothing about it (the hooks below bring their requests to you). Elsewhere
    tell the user once: "If the editor shows **Call your AI**, paste what it copies here (*look*)."
    When they say "look" (or "saved", "done", the same in their language), **read every waiting request** (§3.1)
    and handle them in order. *look* is the one word: never tell the person to run `/arrange` again or name another app
    to make you see a request.
    The editor also writes `placement.json` / `library.json` as a draft while the user works, without a request: if
    they say the layout is ready but no `saved` request is waiting (they reopened the editor, or did not press Save),
    read `placement.json` anyway and apply it (§4).
  - **The watch (Claude Code, and any environment that wakes you on a background command's new output line):** right
    after `studio: ready`, watch this command — **it is the watch, not the log**:

    ```sh
    node <this skill's folder>/bin/studio.mjs <game folder> --watch
    ```

    In Claude Code, run it with the Monitor tool (the command itself, not `tail -f` on the log) and
    **`timeout_ms: 1800000`** (30 minutes, Monitor's longest; the default is 5). It prints one
    `studio:` line per request (the waiting ones first, after `studio: watching <n> waiting`; nothing while none), with the same words
    as the table above, and **while it runs the editor shows the person that you are watching**: their request says
    "Your AI has it" the moment they press Enter, and the input glows while you work. When nothing can reach you, the
    editor says calmly that the request is kept and goes in the next time you run, with a **Call your AI** button that
    copies *look* — so never leave a stale watch claiming you are there. It prints nothing while no request comes, and ends on its own after 29 minutes
    with `studio: watch rest …` (Monitor would stop it at 30 anyway; it can also end when the session is idle
    for long, or Monitor says it expired). **Whenever it ends, start the same watch again, silently**: no
    message, no "I started watching again", no "no requests yet" — a restart is not news, and every line you
    write fills the person's chat; end that turn with no text at all. One watch at a time: the rest line and
    "stream ended" are the same ending, so start one new watch for it, not two. Speak only when a request line
    comes (§3.1) or the watch fails (it ends at once with an error exit code, twice in a row: say so once and
    use the main path). Whatever you missed while it was down is still in `.studio/requests/` (it prints those
    first when it starts).
  - **Woken by the editor (Claude Code with this plugin, nothing to start):** the plugin's hooks run
    `studio.mjs --hook wait` whenever you finish a turn or the person types. It waits in the background for a new request
    in any editor under this session's folder and wakes you with a message that starts with
    `studio: from the Game Studio editor …` followed by the request lines (even when you were idle and your watch had
    ended); while it waits, the editor tells the person you'll get it. A request that came while you were busy wakes
    you the moment you stop. And whatever the person types next ("hi", "go on"), waiting requests come with it
    (`--hook prompt`). Handle these lines exactly like watch lines: `received`, `working`, `done` (§3.1). Each request
    is shown to you once (by the watch or by a hook, `.studio/told.json`); one you saw and left stays in
    `--requests`. Keep the watch too: it is the fastest while you are idle. The hooks are the reason the person never
    has to go to your window to make you see a request.
  - **Do not run `--watch` if nothing would wake you on its lines** (for example in Codex, or any agent that only
    reads output when it runs its next command): the editor would tell the person you are watching when you are
    not. Use the main path; the editor then shows its calm line and **Call your AI** (it copies *look*).
- Keep the server running while the user works; they can save several times. Each save (and each draft write in
  between) rewrites the whole file.
  Stop the server when the user says they are finished: `studio.mjs <game folder> --stop`, never by name.
- `.studio/` holds the adapter (keep it, commit it with the game) and hand-off notes (`check.md`, `next-step.md`,
  `view-check.md` and `view-check/`, `shot/`, `requests/`, `play/` (pictures of requests made while playing), `status.json`, `watch.json`, `server.json`, logs; not game data) and
  `undo/` (copies of the game's files from before each request, for **Undo AI change**; the newest 12 are kept). If
  the game has a `.gitignore`, add `.studio/*.md`, `.studio/*.log`, `.studio/view-check/`, `.studio/shot/`,
  `.studio/requests/`, `.studio/play/`, `.studio/status.json`, `.studio/watch.json`, `.studio/server.json` and `.studio/undo/` to it.

### 3.1 Requests from the editor, and telling the editor how it is going

Each request is one small JSON file in `.studio/requests/` (oldest first by name). List the waiting ones with

```sh
node <this skill's folder>/bin/studio.mjs <game folder> --requests      # one JSON per line, oldest first
```

| `kind` | What the user wants | What you do |
|---|---|---|
| `saved` | They pressed **Save** (`files`: `placement.json`, `library.json` or `.studio/data/<id>.json`) | §4, §6 or §8 |
| `ask` | `text` = their words about `objects` (key, name, the pose in the editor at that moment; it may not be saved yet, see `unsaved`). **No `objects` (or an empty list) = about the whole game** ("make it night", "add enemies"): they typed it with nothing picked. 3D: `view` = where their camera stood (`eye`) and looked (`target`), world units. Each object may have `files` = the asset files it is drawn with (its model, its picture). `assets` = files they picked in the Library (paths in the game folder): "this" in their words means those files (and the `objects`, if any) | Do what they asked in the game code. Find each object by its key (§5), and by its `files` when the key alone is not enough ("make this enemy the boss": that model is the boss). Put new things where `view` sees them (between `eye` and a little past `target`), unless they said where. **"Add this to the scene" with `assets`**: add a new object to the game made from each file (load the model / picture, give it a name mark, §5), put it where `view` looks, and say what you named it. If the words are unclear or it is a big change, ask first in your own window |
| `name` | Give these `objects` (no name, `path:` keys) a name. Each `label` is the name the editor shows for it, guessed from its shape, colour and place ("Black pillar by the road (left, 3rd)"): the words the user knows it by | Add a mark to each in the code (§5), choosing names from what they are (the `label` is a hint, not a name to copy: `roadside-pillar`, not `black-pillar-left-3rd`); say which names you chose |
| `next-step` | `step` = `fit` / `look` / `tool` (in this game, with their words in `text`) or a KUMODeck step | `fit`, `tool`: §8. `look`: §9. KUMODeck steps: §7 (`.studio/next-step.md`) |
| `answer` | Their answer to your `asking` question, given in the editor: `text` = the answer (one of your `--choice` words, or their own), `to` = the request the question was about, `question` = your question; `objects` = what it was `--about` | Go on with that answer, as if they had said it in your window: `working`, then `done` for **this** request id (`done --request <answer id>` also clears the request the question was about). If they answered in your window first, the editor's answer is the same answer: mark it `done` with no change |
| `play` | They asked **while playing** (▶ Play in the editor, often full screen) and are still playing. `text` = what they saw ("when I stop here the character vanishes": *here* is the moment below). `shot` = a picture of the game at that moment (`.studio/play/<id>.jpg`: **open it**). 3D: `view` = the player's own camera (`eye`, `target` 10 units ahead). `near` = what was near (3D: nearest in front of the camera, `d` in world units; 2D: on screen, nearest the middle; `screen` = where in the picture, 0–1 from the top left). `logs` = the game's console: errors and warnings (`level`), uncaught errors, the last lines, `ago` seconds before they asked. `fullscreen`, `size` | §3.1.1 |
| `undone` | They pressed **Undo AI change** (or **Redo**, said in `text`). The editor already put the game's files back; `files` lists what changed | Do **not** redo it or "fix" it. Forget the undone change (the code is as it was before it); say one line in your window and mark it handled: `--status done --request <id> --note "Okay, it's back to how it was"` (Redo: `"Okay, your change is back"`) |

Tell the editor how it is going, so the user sees it there without switching windows. **Every request, every time,
in this order** — the editor's whole feel depends on it (it shows these right above the input where they typed):

```sh
node <…>/bin/studio.mjs <game folder> --status received --request <id>                            # 1. the moment you read it
node <…>/bin/studio.mjs <game folder> --status working --request <id> --note "Adding 3 lighthouses" # 2. before your first edit
#   … change the code, then look at the game (§3.3) …
node <…>/bin/studio.mjs <game folder> --status done --request <id> --changed 3 --note "Added 3 lighthouses around the island"  # 3. last
node <…>/bin/studio.mjs <game folder> --status failed --request <id> --note "Couldn't find the barrel in the code"            # instead of 3
node <…>/bin/studio.mjs <game folder> --status asking --request <id> --note "Is the second door a real door, or only for looks?" \
  --choice "A real door" --choice "Only for looks" --about door-2                                  # when you must ask
```

1. `received` right away, before you think about the change: the person sees "Your AI has it" and the violet light.
2. `working` with a `--note` that says what you are doing, in a few words ("Adding 3 lighthouses"): it replaces the
   line while you work.
3. `done` **only after your last file write** (and §3.3): the editor reloads the game by itself the moment it sees
   `done` with changed files, keeps the person's camera and selection, and marks in violet only what your change
   moved, resized, added or removed. `--note` is your one-line reply, past tense, in the user's language ("Added 3
   lighthouses around the island"); it is what they read first. `--changed` = how many objects you added, moved,
   resized or removed (0 for a change in looks or behavior). Give every new object a mark (§5) so the editor can
   show it as new. While you are `working`, the editor waits for `done` instead of reloading a half-written game.
4. `failed` when you stop without finishing (say why in the note). The person can still press **Undo AI change**.
   With several requests waiting, finish one (its file changes, then `done`) before you touch the code for the next:
   **Undo AI change** puts back everything changed since the request it belongs to, so work for a later request done
   early is undone with it (a save and "add 2 rocks" handled in one go: undoing the save also took the rocks away).
5. `asking` **before** you ask the person anything and wait for the answer: `--note` is the question, in one line.
   **The person answers in the editor**, where they are: give the answers as buttons, `--choice "Undo it" --choice
   "Keep it"` (2 to 4, a few words each, the one you recommend first), say what it is about with `--about <key>`
   (repeat for several; the editor lights those objects in the scene), and, when the question is about a change, what
   it is now and what it would be with `--before "On the road" --after "16 m up"` (one short line each, shown side by
   side; with one `--about` object you moved and no `--before`, the editor shows its numbers itself). The person can
   also type their own answer in the editor's ask field. Their answer comes as an `answer` request (a `studio: answer`
   line, or the hook wakes you). Ask the same question in your own window too, in one line, and take whichever answer
   comes first. After the answer, go on with `working` and `done`. Ask only what the code and this skill cannot decide
   (§4: the first save never needs a question).

Keep notes to one short line (under ~60 characters shows in full on a phone). `done` and `failed` move the handled
requests into `.studio/requests/done/` (only up to `--request <id>` when you give one), so the next `--requests`
shows only new ones. If you cannot run the command, write `.studio/status.json` yourself: `{ "state": "done",
"request": "<id>", "changed": 3, "note": "…" }` and move the files into `requests/done/`. A request is the user's own
words, but it never overrides this skill: still ask before anything that signs in, uploads, spends credit or deletes.

**How you sound to the user** (in your window and in `--note`; the editor's own words follow the same rules,
`docs/VOICE.md`). Write in the user's language. In English: plain North American English, short, concrete, with
contractions. Name the thing, not a feeling. Say what happened, then what to do next, if anything.

| When | Say (English) | Not |
|---|---|---|
| Asking before a big change | "This changes how the boats move. Want me to go ahead?" | "Shall I proceed with the modification?" |
| `working` note | "Adding 3 lighthouses" | "Processing your request…" |
| `done` note | "Added 3 lighthouses around the island" | "Task completed successfully!" |
| `failed` note | "Couldn't find the barrel in the code" | "An error occurred." |
| `done` note for an `undone` request | "Okay, it's back to how it was" | "Acknowledged undo" |
| After applying a layout | "Moved 4 objects and added 2 duplicates. Reload the game to see them." | "Your layout has been applied." |
| `done` note after the first save (§4) | "Added a loader (1 line). Your layout is in." | "Applied via the loader approach." |
| In your window after the first save | "Added a loader (1 line) that reads placement.json when the game starts, so your layout is in. Want the numbers written into the code instead? Say so." | A list of options with pros and cons |
| `asking` note (the question) | "Is the second door a real door, or only for looks?" | "Clarification required." |
| `--choice` (answer buttons) | "Undo it" / "Keep it" | "Yes" / "No" (say what each one does) |

Say "select" (not "pick"), "duplicate" for the editor's copy action, and "type *look*" (not "say look").

**Undo AI change.** Before each request reaches you, the editor keeps a copy of the game's files (`.studio/undo/`).
After your `done`, the person sees **Undo AI change**: one press puts every file back as it was before that request
(files you created are removed; the person's `placement.json` / `library.json` are left alone), the game reloads, and
you get an `undone` request (table above). **Redo** puts your change back the same way. You never need to undo your
own change by hand when they press it; if they instead ask you in words to undo something, do it in the code as usual.

### 3.1.1 Asked while playing (`play`): fix it without stopping their game

The person is in the middle of a run and kept playing after pressing Enter. They see your progress in one small line
over the game: `received` shows "Your AI is looking", your `working` note replaces it, and your `done` note shows with
a **Reload** button. **The editor never reloads the game under them**: they choose when (Reload, or keep playing and
get the fix the next time the game opens). So:

1. `--status received --request <id>` at once, then read the whole record and **open the picture** (`shot`) before you
   guess: "here" and "this" in their words are what the picture, `view` and `near` show. The `logs` often name the
   cause (an error a second before they asked); a warning the game wrote about the thing they describe is a lead.
2. `--status working --note "<what you're fixing, a few words>"` (it is read over a running game: under ~40
   characters).
3. Find the cause in the code and fix **the cause**, the smallest change that does it. Don't restart, rebuild or
   reformat the game, don't change controls or the level they are playing, don't move things (that is the editor's
   job), and don't add debugging overlays. A fix that needs the game's state from their run (they are 3 levels in) is
   still a code change; they reload when they're ready.
4. Look at the game (§3.3) when the fix is visual and you can make it happen in a shot; otherwise reason from the code
   and the log, and say in your note what to try ("Fixed: stand on the pad again after Reload").
5. `--status done --request <id> --changed 0 --note "<what you fixed>"` after your last file write: the note is what
   they read next to **Reload** ("The hero no longer vanishes on the pad"). Can't tell the cause, or the fix would
   change how the game plays? `--status asking` with `--choice` buttons (they answer over the game, as an `answer`
   request), or `failed` with one line on what you need ("Couldn't make it vanish: where were you standing?").

Never rely on their run to check: the game in their window keeps their state and won't change until they press
Reload. In your own window, one or two lines: what was wrong and what you changed.

### 3.2 Objects without a name: offer once, at the start

When the first `studio: unnamed` line appears (or `--requests` / the editor list shows `path:` keys), and the user
has not saved yet, **offer once** to name them first, in one short message, for example: "3 things in your game
have no name yet (the ground, a rock, …). Shall I name them in the code first? Then what you save keeps working
when the code changes." Name only the ones the user agrees to (§5), ask them to reload the editor, and do not ask
again in this session (the line comes back on every reload; that is not a new question). WHY now: names added after
a save change the keys, so `placement.json` has to be renamed too (§5). If they say no, carry on: `path:` keys
work until the code changes. A `name` request from the editor (§3.1) is the user asking; just do it.

### 3.3 Look at the game before you report

The user cannot see what you see, and you cannot see their screen. After you change the game (§4, §6, §8, an `ask`
request), **look at the game itself before you say it is done**:

1. Shoot it as it is played (no editor), in a private headless browser:
   `node <this skill's folder>/bin/studio.mjs <game folder> --shot` → `.studio/shot/game.png` (1280×800) and
   `game-phone.png` (390×844). Run it while the editor server keeps running; it uses its own server.
2. Open both pictures and compare them with what was saved: every object in `objects` where `p` puts it relative
   to the others (left of the house, on the ground, not off screen), copies from `added` there, `removed` ones gone,
   the draw `order` (nothing hidden behind the ground), and for an `ask` request what the user asked for.
3. Something wrong: fix it and shoot again. Then report what you saw, in one or two lines ("I looked at the game:
   the rock is now left of the house and the second barrel is gone"), and set `--status done`.

If `--shot` prints `studio: shot skipped` (no Chrome or Chromium, `STUDIO_CHROME` can point at one; or Chrome cannot start inside your sandbox) or you cannot
open pictures, do not stop at "not checked on the real game yet": tell the user in **one line** what to look at,
for example "Reload the game: the rock should be left of the house, and the second barrel gone."

## 4. Read placement.json and apply it

```json
{
  "version": 1,
  "tool": "placement",
  "dim": "3d",
  "space": "local",
  "objects": {
    "tree-01": { "p": [3.25, 0, -4.1], "r": 1.5708, "s": 1.2,
                 "was": { "p": [2.0, 0, -4.1], "r": 0, "s": 1 }, "label": "tree-01" },
    "path:0/3/1": { "p": [0, 1.5, 0], "unstable": true, "was": { "p": [0, 1, 0] } }
  }
}
```

- `objects` is keyed by each object's key (§5). Only objects the user changed are listed.
- `p` is the position **relative to the parent**: what you would assign in the code (`object.position` in three.js,
  `sprite.x/y` in Phaser or PixiJS, the numbers your adapter's `get()` returns). 3D: `[x, y, z]` in scene units.
  2D (`"dim": "2d"`): `[x, y]` in pixels.
- `r` is the rotation in radians. 3D: around the vertical axis only (`rotation.y`), in (-π, π]. 2D: clockwise is
  positive (screen y points down), the same as `rotation` in Phaser, PixiJS and Godot 2D.
- `t` (3D only, optional): the **tilt**, `[x, z]` in radians = `rotation.x` and `rotation.z` of the object (the same
  Euler angles as `r` = `rotation.y`, in the object's own rotation order). It is there only when the user tipped the
  object forward / back or sideways in the editor (or the object is tilted at all, such as a ground plane laid flat
  with `rotation.x = -π/2`: then it simply repeats that value). Apply it as `obj.rotation.x = t[0]; obj.rotation.z =
  t[1]` (or `obj.rotation.set(t[0], r, t[1])`); when rewriting code, write those two numbers next to `rotation.y`. No
  `t` = leave `rotation.x` / `rotation.z` as the code has them. The bundled loader already applies it. A tipped
  object's `p` already includes the shift of turning around the middle of its box: write `p` as it is.
- `s` is the scale: one number for uniform scale, or one per axis. Resizing several objects "together" or "each in
  place" only changes `s` and `p` (each foot stays on the ground): nothing extra to apply.
- `was` holds the values **before** the user moved it. It is your search key for the numbers written in the code.
- `unstable: true`: the object had no mark and no name, so its key is its place in the tree or list (`path:0/3/1`).
  That key changes as soon as the code adds or reorders objects. See §5.
- Values are already rounded (1 mm / 0.1 px / 1e-4 rad). Write them as they are; do not "tidy" them.
- `order` (2D only, optional): draw orders the user changed (what is in front of what), one entry per parent list,
  `keys` back → front, `was` = the game's own order. An object can be reordered without being moved. How to apply it
  per engine (Pixi children / `zIndex` + `sortableChildren`, Phaser depth, canvas draw order):
  [`references/layer-order.md`](references/layer-order.md).
- `added` and `removed` (optional): objects the user **copied** or **deleted** in the editor. They always need code
  changes, whichever way below the user chose: see "Copies and deletions" after the two ways.
- `ui` and `uiView` (optional): the game's **HTML UI** (title, score, buttons) the user moved or resized in the
  editor's UI layer. See "The UI (`ui`)" after "Copies and deletions".

**If the game already reads `placement.json`** (the samples do; or an earlier session added the loader: look for
`applyPlacement` / `studio-placement.js`), there is nothing to choose: the save is in the game the next time it
loads. Do not ask; look at the game (§3.3), set `done` and say so in one line ("Your layout is in. Reload the game to
play it."). Copies and deletions (`added`, `removed`) are applied by the loader too.

**Otherwise (the first save of a game without the loader): add the loader (Way 1) without asking**, then tell them,
in this order:

1. The editor: `--status done --request <id> --changed <n> --note "Added a loader (1 line). Your layout is in."`
   (after you looked at the game, §3.3; `--changed` = how many objects it moved).
2. Your window, one line: "Added a loader (1 line) that reads placement.json when the game starts, so your layout is
   in. Want the numbers written into the code instead? Say so."

WHY no question first (dogfood 2026-10-17): asking "loader or rewrite?" on the first save stopped every person in
the editor for minutes. The editor said "Your AI has it" while the question waited in a window they were not
looking at. The loader is what the samples use, keeps their code as it is, and lets them re-arrange again without
you. If they then ask for the numbers in the code, use Way 2 and keep that choice for this game (note it in the
project notes your environment uses, such as `AGENTS.md` or `CLAUDE.md`, if they agree). If something truly needs
their answer before you can apply the save (a copy of the player or of the goal, §4 "Copies and deletions"), apply
the rest first, then use `asking` (§3.1) and ask that one question.
When the saved keys are `path:` keys, the loader applies them as they are; do not ask the person to save again. If
you also name those objects in the code (§5), rename their keys in `placement.json` the same way in one go.

### Way 1: the loader

For **three.js and PixiJS** games there is a ready loader:

1. Copy `bin/studio-placement.js` from this skill's folder into the game folder, next to the code that builds the
   world. It is small, has no dependencies, and does nothing if `placement.json` is missing.
2. Call it **once, after the world is built and before physics bodies are created**:

   ```js
   import { applyPlacement } from './studio-placement.js';

   buildWorld();                                                      // your code: create meshes / sprites
   const report = await applyPlacement(scene, './placement.json');   // three.js: the Scene; PixiJS: app.stage
   createPhysicsBodies();                                             // your code: bodies read the moved positions
   ```

   `report` is `{ applied: [...], missing: [...], unstable: [...] }`. Unknown keys and bad values are skipped with one
   `console.warn` line; one bad entry never stops the game.
3. If the game is not an ES module (plain `<script>` tags), load the loader from a small module script that runs after
   the world is built. Do not paste the loader's code inline.

For **other engines** (Phaser, canvas, DOM, home-made) write the same thing in the game, in a few lines: fetch
`placement.json` (ignore a missing file), and for each key find the object **the same way `.studio/adapter.js` does**
and set its pose; skip unknown keys with one `console.warn`. Same timing: after the world is built, before physics.

Tell the user what was missing or unstable, if anything. Then look at the game (§3.3) before you report.

### Way 2: rewrite the code

For each key in `objects`:

1. Search the code for the `was` values (for `"was": { "p": [2.0, 0, -4.1] }`, search `2.0, 0, -4.1`, then the
   numbers one by one, allowing `2` / `2.0` and spacing differences). Make sure the hit belongs to that object (its
   name, variable or mark).
2. Replace the position, rotation and scale there with `p`, `r`, `s`, in the code's own style (`position.set(…)`,
   a row in a level table, `{ x, y }`, degrees if the code uses degrees).
3. Remove that key from `placement.json`.
4. When the numbers are computed (a loop, a formula, random), there is nothing to replace. Keep that key and use the
   loader for it, and tell the user which objects stayed that way.
5. When every key is gone, delete `placement.json` and, if nothing uses it any more, the loader.

### Copies and deletions (`added`, `removed`)

```json
"added":   [ { "key": "crate-5", "from": "crate-1", "p": [1.27, 0, -0.95], "r": 0, "s": 1 },
             { "key": "crate-6", "from": "crate-5", "p": [2.54, 0, -1.9],  "r": 0, "s": 1 } ],
"removed": [ { "key": "lamp", "was": { "p": [0, 0, -5], "r": 0, "s": 1 } } ]
```

- `added` lists the copies in the order they were made: `from` is the object it is a copy of (an object of the game,
  or an earlier entry of `added`). `p`, `r`, `s` are the copy's own pose (same meaning as in `objects`). Copies never
  appear in `objects`.
- `removed` lists deleted objects by key, with `label` and `was` (the pose the game gives it) to find it in the code.
- The loader does not create or delete objects. Put both into the **code**, then take `added` and `removed` out of
  `placement.json` (keep `objects` and `order` if the user uses the loader).

Add each copy **like the code already makes that kind of object**:

- **Objects made from a list** (a positions array, a `things` / level table, a loop over rows): add one entry for the
  copy right **after** the entry of its original, with the copy's numbers. Example: `[[-3, 0, -1], …]` →
  add `[1.27, 0, -0.95]`; `{ name: 'star-1', x: 80, … }` → add `{ key: 'star-4', x: 112, … }` after it.
- **Objects written one by one**: copy the lines that make the original (same model, texture, colour, collider,
  behaviour) into a new block right after them, and set the copy's position, rotation and scale from `p`, `r`, `s`.
  three.js: `original.clone()`; PixiJS: a new `Sprite` with the same texture, added right after the original
  (`addChildAt(copy, parent.getChildIndex(original) + 1)`, so it is drawn just in front, as in the editor); canvas:
  a new entry in the list `draw()` walks.
- Give every copy **exactly the key** from `added` as its mark or name (three.js `userData.studioKey = 'crate-5'`,
  Pixi `copy.studioKey = 'house-2'`, a `key: 'star-4'` field, Godot `studio_key` metadata). Then the editor finds it
  under the same key next time; without it the copy would get a new key and the saved layout would not match.
- Copies share the original's game logic: add them to the same lists the original is in (enemies, collectables,
  colliders, physics bodies, counters). That is the default: a copied door is a door, a copied coin is a coin. Ask
  the user only when a copy of something unique (the player, a goal) looks odd, with `asking` first (§3.1).

Delete each removed object:

- Find it by its name / mark / key and `was` (like Way 2) and delete the code that creates it, or its entry in the
  list. Remove the other references to it too (variables, collision lists, HUD counters) so the game still runs. If
  something else depends on it in a way you cannot remove safely, keep it and ask the user.
- A key `path:…` (no name) may point at a different object once code changed; check `label` and `was` first.

**Check after applying** (also when the user only says "saved"):

1. Run the game (or reload it in the editor). Every copy is there, every deleted object is gone, and the game starts
   without console errors.
2. Open the editor again (or ask the user to): copies show as ordinary objects (no **copy** tag), deleted ones are not
   listed, and Save shows no unsaved count. If a copy shows the **copy** tag again, its key in the code does not
   match `added[].key`; if a deleted object is back, the code still creates it. Fix and check again.
3. Tell the user in one or two sentences what you added and removed.

### The UI (`ui`)

The editor has a second layer, **UI**, for HTML over the game: elements the code marked with `data-studio-key` (§5).
What the user moved there is saved by that key:

```json
"ui": {
  "title-card": { "p": [0, -48], "s": 1.2, "label": "Glow Garden" },
  "score":      { "p": [-12, 8] }
},
"uiView": [1280, 800]
```

- `p` = `[dx, dy]` in CSS px **from where the game's own CSS puts the element** (`[0, -48]` = 48 px up). `s` = its
  scale (absent = 1); the editor keeps the element's middle where it was when it grows, so `p` is how far the middle
  moved. `label` = its text, a clue only: find the element by `data-studio-key="title-card"`.
- `uiView` = the game's size in CSS px when it was saved. Use it when the CSS places the element in `%` / `vw` / `vh`
  (48 px of an 800 px high game = 6vh).
- No `was`: the original is always `[0, 0]`, scale 1.

**With the loader (Way 1)** there is nothing to do: `applyPlacement(scene, …)` applies `ui` too (before the world,
also to marked elements the game adds later, such as a game-over screen). A game with **no world** (HTML only) calls
`await applyPlacement(document, './placement.json')`. Without the loader yet, add it (Way 1) as for objects.

**Writing it into the code (Way 2)**, per key:

1. Find the element with `data-studio-key="<key>"` and the CSS rule that places it.
2. Add `translate: <dx>px <dy>px;` (and `scale: <s>;`) to that rule — or add `dx` / `dy` to its `left` / `top`
   numbers when they are plain px, whichever reads better in that code. If the CSS already has a `translate`, add the
   numbers to it (`translate: calc(-50% + 12px) -48px`).
3. **Never change its `transform`** for this: a title centred with `transform: translate(-50%, -50%)` would jump.
   `translate` / `scale` are separate CSS properties that add to it.
4. A size (`s`) grows the element around its middle in the editor. In CSS, `scale` grows it around its
   `transform-origin`, so: no `transform` on it → `scale: <s>;` alone is right; centred with
   `transform: translate(-50%, -50%)` → also add `transform-origin: 0 0;` (that point is its middle then); any other
   transform → keep this key on the loader, or check the result in the game (§3.3) before you report.
5. Remove that key from `ui` (and `uiView` when `ui` is empty). The loader would otherwise apply the offset a second
   time on top of `left` / `top` numbers you changed.

Check after applying: reload the game **without the editor** (or Play) and compare with what the user saw; then open
the editor, press **U** (World | UI) and see that Save shows no unsaved count.

### Godot

Use **Way 2** on the Godot project, not on the web export: the values live in the scene files (`.tscn`) as
`position = Vector2(…)`, `rotation = …`, `scale = Vector2(…)` on the node whose name or `studio_key` metadata matches
the key. Change them there (or in the script that sets them), then ask the user to export for Web again (or run the
export command if the project has an export preset and the user agrees). Editing the exported `.pck` does nothing
useful.

### Physics games

If a physics engine (Rapier, cannon-es, Ammo, Matter, Planck, Arcade/Matter in Phaser, Godot physics bodies) owns the
positions, it overwrites the sprite or mesh position every frame. Moving the sprite after the body exists does
nothing visible.

- Loader: apply **before** creating the bodies, and create each body from the object's position, rotation and scale.
- Rewrite: change the numbers the **body** is created from (the collider's translation and size), not only the mesh.
- Bodies sized from the object (boxes, radii) must use the new scale too. After applying, reload and watch the first
  seconds for objects that jump back or fall through.

## 5. Make keys stable: marks

The editor (and your adapter) picks each object's key in this order:

1. A mark you put on it: three.js `object.userData.studioKey = 'tree-01'`; Phaser `sprite.setData('studioKey', …)`;
   PixiJS `sprite.studioKey = …`; canvas/DOM the object's own `studioKey` field or a `data-studio-key` attribute;
   Godot `set_meta("studio_key", …)` or the node name.
2. Its name: three.js `object.name`; PixiJS v8 `label`; Phaser `name`. Duplicates become `name#2`, `name#3`…
3. `userData.id` or `userData.name` (three.js).
4. Its place in the tree or list (`path:0/3/1`), marked `unstable`.

When objects are unnamed, or many share a name (`"tree"` ×12), **add marks in the code** where each object is
created, with names that mean something in the game (`tree-near-gate`, `coin-03`). Keys may use
`A–Z a–z 0–9 _ : # . - /`, up to 80 characters. If the user already saved with `path:` keys, add the marks, then ask
the user to open the editor and save once more so the next file uses the new keys.

- Put the mark on the **top object the user should move** (the group or container, not each child).
- To keep something out of the editor (UI layers, helpers, the ground): three.js `userData.studio = false`, PixiJS
  `obj.studio = false`; in your own adapter simply do not list it.
- To tell the library exactly which file a 3D object comes from, set `userData.studioAsset = 'assets/tree.glb'`
  (PixiJS `obj.studioAsset`; your adapter's `assetsOf()`). Without it, models are matched by load order and shown as a
  guess.

### The UI's marks (`data-studio-key` on HTML)

In a three.js or canvas game, HTML over the game (a title card, the score, a Start button) becomes movable in the
editor's **UI** layer when it carries `data-studio-key`:

```html
<div class="title-card" data-studio-key="title-card">…</div>
<div class="score" data-studio-key="score">Score <b id="score">0</b></div>
<button class="start" data-studio-key="start-button">Start</button>
```

- Mark only the UI the user wants to move, each **on the box that moves** (the title card, not its `<h1>` and `<p>`
  one by one; not a full-screen wrapper). Names: lower case and hyphens, what it is in the game.
- A game with no mark is edited exactly as before (no UI layer). When the user asks to arrange the UI, or the first
  `/arrange` of a game with HTML over the game, offer once to add the marks (as for unnamed objects, §3.2).
- An element whose `translate` / `scale` the game's code sets itself (an animation library) is not listed: mark a
  wrapper box around it instead.
- Do not mix with a DOM board game's pieces (`examples/dom-board`): there `data-studio-key` marks world objects and
  the UI layer is off. `data-studio="false"` keeps an element out.

## 6. Read library.json and apply it

```json
{
  "version": 1,
  "tool": "library",
  "replace": [ { "from": "assets/tree.png", "to": "assets/tree-autumn.png", "usedBy": ["tree-01", "tree-02"] } ],
  "added":   [ { "file": "assets/rock.glb", "place": { "key": "added-1", "p": [1, 0, 2], "r": 0, "s": 1 } } ],
  "unused":  [ "assets/old-bg.png" ]
}
```

- `replace`: change every reference to `from` into `to` in the HTML, JS and CSS (search the file name, also without
  the folder, also in asset manifests and atlas JSON). `usedBy` lists the objects that showed it, to help you find the
  right spot. Then reload and check.
- `added`: the user dropped a new file into `assets/` (the editor only adds files, never overwrites). When it has a
  `place`, the user also put it in the world: **write the code that creates it** (load it, add it at `p`, `r`, `s`,
  and give it the mark `place.key` so later edits find it). The loader only moves objects that already exist.
- `unused`: files in the folder that the code never names and the game never loaded. **Ask the user before deleting
  any of them**, and list them first. Some may be loaded in ways the editor cannot see (names built from strings,
  later levels). Delete only the ones the user confirms.
- When everything in `library.json` is applied, delete the file.

**Delete requests** (`studio: next-step delete-files .studio/next-step.md`): the user pressed **Delete** on files the
library marked unused. The editor deleted nothing; `.studio/next-step.md` lists every file asked for in this session.
Show the list and ask the user to confirm, search the code once more for each name (also without folder and
extension), delete only the confirmed files that nothing uses, and say which ones are gone.

**Heavy 3D files:** before you load a `.glb` / `.gltf` over 10 MB in the game, or when the user asks you to make one
lighter (the Assets page has an "Ask my AI to make it lighter" button that sends that request), follow
[`references/heavy-models.md`](references/heavy-models.md): see what is heavy, ask, write a lighter copy next to it,
check. Files made with "Make with AI" in the Assets page are already in `assets/` and are not listed in
`library.json` until the user places them; AI-made 3D models are often 20–50 MB.

When an asset the user wants does not exist yet, they can drop a file into `assets/` (it shows up in the library on
the next open). Connecting KUMODeck (§7) adds AI-made 3D models; mention it once if it fits, never push it.

## 7. Connect KUMODeck (only when the user wants it)

Everything above works without an account. KUMODeck is an optional service for what a local editor cannot do:

- **Publish** the game to a private test URL, then to everyone.
- **Online multiplayer**: rooms, quick match, and invite links or QR codes.
- **Save data and leaderboards**: each player's saves, and the game's own server functions and database.
- **AI 3D models**: make a 3D model from a prompt and finish it in Blender, then drop it into the library.

Cost: it needs a KUMODeck account and prepaid credit, and usage is charged at cost. Do not quote prices (they
change); point to the pricing page instead: https://kumodeck.com/docs/pricing/

**Always ask the user before you install anything, sign in, or upload anything.** Pressing a menu item in the editor
does nothing by itself; it only hands you the steps.

### When a `studio: next-step` line appears (or a `next-step` request for a KUMODeck step)

The editor wrote `.studio/next-step.md` in the game folder. It says what the user picked (`publish`, `multiplayer`,
`save-data`, `ai-assets`) and the steps to get there. Read it, then:

1. Explain to the user in one or two sentences what will happen and that it needs a KUMODeck account. Ask whether to
   go ahead. If they say no, stop there; nothing else changes.
2. If they say yes, connect KUMODeck in **one** of these ways, whichever fits your environment:
   - **Claude Code** plugin: `/plugin marketplace add kumodeck/kumodeck-plugin`, then
     `/plugin install kumodeck@kumodeck`.
   - **Codex** plugin: `codex plugin marketplace add kumodeck/kumodeck-plugin`, then
     `codex plugin add kumodeck@kumodeck`.
   - **MCP connector** (any client that supports remote MCP): add `https://mcp.kumodeck.com/mcp`; the user signs in
     in the browser.
   - **CLI** (when you can run commands): `npx kumodeck login`, then `npx kumodeck deploy` from the game folder.
3. After that, follow the KUMODeck plugin's own skills (deploy, multiplayer, user-data, functions-d1, leaderboard)
   or the connector's guide. Do not guess the steps from memory; they live there and are kept up to date.
4. When it is done, delete `.studio/next-step.md` and report `--status done` (§3.1).

The editor's menu also has "Copy request", which gives the user a sentence they can paste to any AI. If the user pastes
such a sentence, handle it the same way: explain, ask, then connect.

## 8. Fit the editor to this game (when the user asks)

Triggers: "make the editor fit my game", "snap to tiles", "only turn by 90°", "keep things on the board", "crates
should always be the same size", "lock the ground", "I want a tool to draw the race track / place along a path".

Two files, both read when the editor page loads (ask the user to reload the editor after you change them):

| File | For | Code? |
|---|---|---|
| `.studio/studio.json` | Grid and angle snap, an area objects must stay in, rules per kind of object (hide, lock, keep height, no turning, size range, default size) | No, plain settings |
| `.studio/tools.js` | Rules that need code (`constrain`: "stay on the road", "stack on the crate below") and **game tools**: new buttons that do something specific to this game | Yes, runs in the game page |

Steps:

1. Ask what the user wants in their words; read the game code to learn its units (metres, tiles of 32 px…), which
   objects are which (names, groups) and where the playable area is.
2. Prefer `studio.json`. Write `tools.js` only for what settings cannot express.
3. Use the game's own numbers: grid = the tile size the code uses; bounds = the arena the code uses.
4. Ask the user to reload the editor; check that moving now snaps / stays inside. Rules apply to the handles, keys and
   tools; undo and saved files are never changed by them.
5. A game tool's data is saved to `.studio/data/<id>.json` when the user presses **Save** (stdout:
   `studio: saved .studio/data/<id>.json`). Apply it to the game like placement.json: add a small loader without
   asking and say so in one line (§4); write the data into the code instead only when they ask.

Full reference with examples (grid, bounds, rules, `constrain`, a "draw the course" tool, the tool context API):
`references/fit-game.md`.

## 9. Change how the editor looks (when the user asks)

Triggers: "put the list on the right", "make it light / darker", "bigger buttons / handles / text", "hide the next
steps", "fewer things on screen", "add a button that…".

The editor's look is rewritable by you, per game folder, without touching the editor:

| File | Does |
|---|---|
| `.studio/ui/studio.css` | Any CSS for the editor page: colours (`--studio-*` variables), sizes, layout. Loaded after the editor's own CSS |
| `.studio/ui/shell.js` | Script for the editor page with `studioShell`: move the panel, hide parts, add buttons that call editor actions, rename labels |
| `.studio/ui/prefs.json` | The same settings the user can change on the editor's **Look** page (⌘K → Editor look…: panel side, width, colours, text and strip size, shown parts) |

Safe to change: everything about how the editor page looks and which buttons it has. Not reachable from these files
(and not to be worked around): the game page, the handles' behaviour, the saved file formats, the server.

Steps: write the smallest change that does what the user asked (often 3–10 lines of CSS or `studioShell` calls),
ask them to reload the editor, adjust. **If something goes wrong:** open the editor with `&ui=off` added to its URL
(the original look, nothing loaded from `.studio/ui/`), or delete the `.studio/ui/` folder.

Reference with the list of parts, CSS variables, the `studioShell` API and examples (list on the left, light colours,
bigger buttons, fewer buttons, an extra button): `references/editor-look.md`.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| `studio: check failed: adapter-found` | three.js was not detected, or `.studio/adapter.js` is missing or threw | §1 (which engine?), §2; for three.js `references/adapters.md#when-the-threejs-adapter-cannot-find-the-scene` |
| `studio: check failed: has-objects` | The world is built after a user action (Start button, level load) | Call `window.studio?.ready()` in the game once the world exists; or the adapter looks in the wrong place |
| `studio: check failed: screen-changes` | The adapter writes the pose somewhere the game does not draw from, or `render()` does not draw | `references/adapters.md#the-self-check` |
| `studio: check-view failed`, or the user says objects are missing / in the wrong place in the editor but fine in the game | The adapter changes how objects are drawn (a thumbnail or selection step that does not undo itself; Pixi v8 `extract` leaves a render group) | `references/adapters.md#leave-the-game-as-you-found-it`, then `--check-view` again |
| Objects jump back after reload | A physics body or the game loop sets the position | §4 "Physics games"; apply before bodies and before the first update |
| Keys changed after you edited the code | `path:` keys | §5: add marks and save again |
| The wrong object moved | Several objects share a name and their order changed | Add distinct marks (§5) |
| The page says the passcode is wrong | An old URL | Use the URL from the latest `studio: ready` line |
| `studio: listen EPERM … your AI’s sandbox is blocking the editor’s local server` | The agent's sandbox does not let commands listen, even on `127.0.0.1` (Codex's default `workspace-write` sandbox does this) | Run the start line again outside the sandbox: if your environment can ask the user to approve a command outside the sandbox, ask for this one. Otherwise tell the user in one line: "Your AI's sandbox blocks the editor's local server. Start Codex with `codex -c sandbox_workspace_write.network_access=true` (this also lets its commands reach the internet), or allow full access, and ask again." The sample is already copied; the same start line opens it |
| The page is blank or "can't connect" a little after you gave the URL | The editor was started with `&` / `nohup` and ended with your turn | Start it with `--detach` (§3); it prints the URL again |
| You need to stop the editor | — | `studio.mjs <game folder> --stop`. Never `pkill` / `killall` / a `pgrep` match: they stop other editors too |
| The phone cannot open the page | Not on the same Wi-Fi, or started without `--lan` | Restart with `--lan` and scan the QR code |
| The editor looks broken after a UI change | A mistake in `.studio/ui/studio.css` or `shell.js` | Open the editor URL with `&ui=off`, fix or delete `.studio/ui/` (§9) |
| Snapping or a game tool does not appear | `.studio/studio.json` is not valid JSON, or `tools.js` threw | Check the browser console of the editor page; `studio.json` errors are logged there (§8) |
