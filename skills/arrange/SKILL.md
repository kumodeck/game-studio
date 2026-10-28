---
name: arrange
description: Open a local visual editor next to a web game so the user can drag, rotate and scale objects (placement) and see, swap or add the assets the game uses (library), then apply the saved placement.json / library.json to the game's code. Works with three.js out of the box; for Phaser, PixiJS, plain canvas or DOM games, home-made engines and Godot web exports, you first write a small adapter for the game from the bundled examples. Use when the user wants to move, position, line up, rotate or resize things in their game ("put the tree a bit to the right", "fix the layout", "arrange the level", "/arrange"), or wants to see, swap or clean up the game's images, models and sounds ("what assets does my game use", "replace this texture", "/arrange library"). Also use it to fit the editor to one game ("snap to the grid", "only 90° turns", "keep things inside the field", "a tool to draw the course") or to change how the editor itself looks ("put the list on the left", "make it light", "bigger buttons", "fewer buttons"). Also covers requests the user sends from the editor ("ask your AI about this object", "name it", "ideas for your AI": fit, look, tool, publish, multiplayer, save data, 3D models) and telling the editor how your work is going. When the user says "look" (in any language) while the editor is open, read `.studio/requests/`. Also use it whenever the user asks for work the editor can do — "take the old motion off", "make the pillar spiral", "move / rename / duplicate it", "add a level" — and do it yourself with `--do` (in the open editor, or in placement.json), never as steps for the user to click.
---

# Arrange: placement editor and asset library

**The editor's link goes alone on the first line of every reply about the editor: when you open it, reopen it,
update it to a new version, restart it, or are asked where it is.** Copy it from the line the command prints right
after `studio: ready` (`studio: reply with this link alone on the first line of your answer, exactly as printed:
<url>`). The app's "open" card, "it's open next to the chat" or "the editor is ready" without the link is never
enough. The editor opens in the person's default browser by itself; the window next to the chat only when they ask
for it (§3).

**Do the editor's work yourself; never hand it to the person.** Whatever the person could do in the editor — take a
motion off an object, make a motion or put one on, change when it starts, move / turn / resize / rename / duplicate /
delete an object, put it on the ground, make / duplicate / rename / open a level, put a code motion or a code layout you
wrote in the editor and turn its numbers, add a keep-out area — you do with **`--do`** (§3.4): it
happens in the open editor, on screen (one ⌘Z undoes it, it counts on Save), or in `placement.json` when no editor is
open. Never answer with steps for them to click ("1. Select the blue pillar 2. Right-click the Motion row 3. …"), never
ask them to reload the editor or the game (it reloads the game by itself when files change; `--do editor.reload` when
you need it), and never ask them to save so that your change lands. Then reply: the editor's link alone on the first
line, then one line of what changed ("Took “Row” off the blue pillar; it only spirals now. ⌘Z in the editor brings it
back."). WHY (a request, 2026-10-24): "I asked Claude, and it asked me to do the Studio's hand work. That is the worst
experience."

**Reply in the language the person wrote in** — your reply, its one line, and every `--note` — whatever language this
file, the code and the editor's `studio:` lines are in. A request in Japanese gets a Japanese reply; an ask from the
editor is in the person's words too (its `text`, and `lang` on the request: `ja` / `en`). WHY (2026-10-24): asked in
Japanese ("I asked from the editor", in Japanese), the AI answered in English — the editor's lines it had just read
were English.

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
use the current directory: the editor finds the game's page in it by itself, **whatever it is called**
(`neon-orb.html`, `game.html`, `dist/index.html`, a single HTML file with all the code inside) and prints
`studio: entry <page> …` when it isn't `index.html`. Open **the person's own file**: never copy their game into a new
folder, rename it or make an `index.html` for it (saves would go to the copy, not their game). If the page it picked
is not the one they mean, start it again with `--entry <page>`. **Only if there is no game at all** (`studio:
no-game`: an empty folder, or only notes, config and pages that aren't games) offer a sample, below; do not write a
game yourself. Never tell the person what the file is called or isn't called: say the game is open.

## 0. A folder without a game: start from a sample

Someone trying the editor for the first time often has no game yet. The editor decides it: started without
`--starter`, it looks through the folder and its subfolders (not `node_modules`) for any page that runs a game, by
any name, and prints `studio: no-game …` (exit 4) only when there is none. A game page by another name is their game:
open it (above), never the sample. Then, for `no-game` only:

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
   are three.js (3D) and PixiJS (2D) with their adapter included, so skip §1 and §2. It opens in their default
   browser, in the Claude app too (§3).
3. The link first, then where it is (§3, "When you open it, say") and one line: "Here's a sample game in your folder. Click anything and drag it to move
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

You need the folder that the browser can run as-is and the game's page in it (any name; `--entry <page>` when the
editor's own pick, `studio: entry`, is not it). If the project needs a build step (Vite, webpack, a Godot export),
see the table below; the editor says `studio: build-first <page>` (exit 5) when the only game page needs its build. Node.js 22.13 or newer must be on the PATH
(`node --version`). Nothing else gets installed: the server is one file with no dependencies. On an older Node the
editor stops at once with one line (`Game Studio needs Node 22.13 or newer. You have 20.11.0. Install:
https://nodejs.org`): pass it on to the user as it is, and do not try to work around it.

Read the game's page, its main script and `package.json` (if any) and decide which row fits. A game in one HTML file
(the script inside the page) is the same: read the page; any adapter goes to `.studio/adapter.js` as usual (§2), and
marks (§5) go into that same file.

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
- **A UI drawn in the canvas** (a score, a health bar, a button, a minimap painted with `fillText` / `fillRect` /
  `drawImage` over the game — often in a second 2D canvas on top of a three.js one, and no `data-studio-key`; in Phaser
  a `this.add.text(…)` score or a `setScrollFactor(0)` HUD, in Pixi a HUD `Text` / container): make it
  editable the first time you look at the game, **without asking** — all of it at once — and say so in one line in
  the game's words ("I made the score, the health bar and the JUMP button movable in the editor; they look the same").
  How: "UI drawn in the canvas" (§4). Decided on 2026-10-24: do not ask — it is a rewrite of
  the drawing, but its picture stays the same to the pixel, and a UI the person cannot pick is a dead end in the
  editor. The one line is a report, never a how-to: no "press Save", no "open the UI layer", no editor steps.
  Until you do, the editor shows that UI with faint dotted frames "Not selectable yet" (`--do list` → `uiFound`: where
  it sees UI it cannot select — your checklist of what to deliver).
- `adapters/` is in the same folder as this `SKILL.md`. Each example is short and commented; you copy one and fit it
  to the game. Details in [`references/adapters.md`](references/adapters.md).
- If the game is built by a bundler, open the folder the bundler writes (`npm run build`; started on the project
  folder, the editor finds `dist/index.html` by itself and serves `dist/`), or the dev server's root if it serves
  plain files. Result files are written into the folder you open: when that is a build
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
   it, step 6's `--check-view` runs it and prints the same `studio: check …` line). Fix what it names and reload the editor page yourself with `--do editor.reload --editor` (§3.4; the server reads
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
node <this skill's folder>/bin/studio.mjs <game folder> --detach --entry neon-orb.html # a page other than the one it picked
node <this skill's folder>/bin/studio.mjs <game folder> --link                  # the running editor's link: paste it as it is
node <this skill's folder>/bin/studio.mjs <game folder> --open-in browser      # "open it in my browser / in Chrome" (remembered)
node <this skill's folder>/bin/studio.mjs <game folder> --open-in app          # "open it next to the chat" (remembered; then nothing opens by itself)
node <this skill's folder>/bin/studio.mjs <game folder> --stop                  # when the user is finished
```

**The link goes on the first line of every reply about the editor, and you never write it yourself: paste the
`studio: ready` URL or the output of `--link`, exactly as printed.** Not from a browser tab (the editor drops its
pass `?t=…` from the address once it opens, and a link without it only says "Missing pass"), not from
`.studio/server.json`, not rebuilt from the port.

`<game folder>` is always the folder's **absolute path** (not `.`). Use the same folder (and the same `--entry`, if
any) in every command for this game: start, `--watch`, `--status`, `--stop`.

- **Start it with `--detach`.** It starts the editor on its own, prints `studio: ready <url> pid <n>` and returns at
  once; the editor keeps running after the command and your turn end (its output goes to
  `<game folder>/.studio/studio.log`). Do not start it with `&`, `nohup` or a background shell instead: in Codex
  those end with your turn and the person gets a blank page. Running the same line again prints the running editor's
  URL instead of starting a second one. Don't add `--no-open` (only when the person asked that nothing opens).
- **Right after `studio: ready` come two lines; do what they say.** `studio: reply with this link alone on the first
  line of your answer, exactly as printed: <url>`: that URL is the first line of your reply (it carries a one-time
  passcode, so copy it, never rebuild it). Then where the editor went:
  - `studio: open browser - it opened in their default browser …`: it is open in their browser (Chrome, Safari…).
    Don't also open it next to the chat, and never start a browser yourself (`open -a Chrome …`).
  - `studio: open browser - already open …`: the same editor was already open there, so no second tab. If they
    can't find it: `--link --open`.
  - `studio: open none - …`: nothing could be opened (`--no-open`, SSH, no display). After the link: "Open this
    link in your browser."
  - `studio: open app - …`: this person chose the window next to the chat (below).
  The same goes for a reopen: a new version, a restart after `--stop`, an editor that had stopped. When they ask
  where the editor is, or for the link, run `--link`: its one line on stdout is the link, paste it first.
  Do not open the editor with your own browser tools unless the user asks you to check something.
- **Where it opens, when they say** (in any language): "open it in my browser / in Chrome": `--open-in browser`
  (opens it there now and remembers it for this game in `.studio/open.json`; it is also what happens when nothing
  is remembered). "Open it next to the chat" / "in the app": `--open-in app`; from then on nothing opens by itself
  and `--detach` prints `studio: open app`. Only then, in the Claude app (you have `mcp__Claude_Browser__preview_start`;
  load it with `tabs_context` and `tabs_select`): if a tab already shows this editor (`127.0.0.1:<port>/__studio/`,
  shown without the pass), `tabs_select` it; otherwise `preview_start` with the URL exactly as printed. If the pane
  is hidden after `tabs_context`, `tabs_select` the editor's tab; still hidden: "Press ⌘⇧B to see the editor
  (Ctrl+Shift+B on Windows), or open the link." on the second line. If `preview_start` fails, or you have no such
  tool: "Open this link in your browser." after the link. Narrow pane: "The ↗ button at the top right of the editor
  opens it in a large window." Only the `mcp__Claude_Browser__` tools count: `mcp__remote-devices__Claude_Browser__*`
  can't reach `127.0.0.1` on this computer.

- **When you open it, say** (every time you start or reopen the editor, or tell them where it is; in their
  language): **the link alone on the first line**, then where it is with the game's name, then what to do. Nothing
  before the link: not where it is, not ⌘⇧B, not the version. The link is the one from the `studio: reply with this
  link …` line (or `--link`) exactly as printed: it opens the editor on this computer only, and it is theirs, so give
  it every time (Claude app, terminal and Codex alike), with one short "don't share it":

  > <the link, the whole URL as printed>
  > NEON ORB is open in the editor in your browser (this link works on this computer only; don't share it).
  > Click anything and drag it to move it, type a change in the box at the bottom, and click Save when you like it.

  `studio: open app`: "…in the editor next to this chat." `studio: open none`: "Open this link in your browser."
  The game's name is its page's `<title>`, else the file name. Never answer with only the app's card or "it's
  open", never write "it's next to this chat" without the link, and never explain which file it opened or why.

  Everything else is the same in the Claude app, terminal and Codex, including the watch: the Claude app wakes you
  on its lines like Claude Code in a terminal (§3, "The watch").
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
| `studio: entry <page> …` | No `index.html`: the editor opened this page, the game's own file, as it is (other game pages, if any, are named) | Nothing to tell the person about it. Only if it is the wrong page: `--stop`, then start again with `--entry <page>` |
| `studio: build-first <page> …` | The only game page needs its build (exit 5) | Run the build (`npm run build`), then the same start line |
| `studio: ready` | The editor is up; the line has the URL | Read the next two lines |
| `studio: reply with this link …: <url>` | Right after every `ready` line | That URL alone on the first line of your reply, as printed (above, "When you open it, say") |
| `studio: open browser …` | It opened in their default browser (or was already open there) | Don't open it next to the chat. "…open in the editor in your browser" |
| `studio: open app …` | This person chose the window next to the chat (`--open-in app`); nothing opened | `preview_start` with the link (above), the link still first in the reply |
| `studio: open none …` | Nothing could be opened (`--no-open`, SSH, no display) | The link first, then "Open this link in your browser." |
| `studio: check ok` | The adapter works | Nothing; the user can start |
| `studio: check failed` | The adapter (or the built-in three.js one) does not work for this game | Read `.studio/check.md`, fix `.studio/adapter.js` (§2), then `--do editor.reload --editor` (§3.4) |
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
| `studio: did … - in the editor …` / `- in placement.json …` | Your `--do` (§3.4) did that op, there | The link first, then one line of what changed |
| `studio: do failed <op> - <why>` | That op was not done (the others were) | Fix what it says (a key, a motion's name: `--do list`) and run that op again |
| `studio: list {…}` | `--do list`: the objects (key, the name the person sees, their motions), the Library's motions, the levels | Find what their words mean ("the blue pillar") there |
| `studio: request play` | The person asked while **playing** the game in the editor (▶ Play; the game is still running): their words, then `while playing`, the picture of that moment and how many console errors came with it. `paused, chat .studio/chat/<id>.json` instead of `while playing`: they **paused** the game and ask you about that moment from the editor over it; `make this moment's values editable` after it: the ✦ under "This moment"; `let the game start from this moment` / `checkpoint "…" does not open`: ⚑'s ✦ / the checkpoint line's ✦ | §3.1 (`play`): fix it without stopping their game; paused: **answer** first (§3.1.1, "Paused"); `make this moment's values editable`: "This moment" (§4); checkpoints: "Checkpoints" (§4) |
| `studio: answer` | The person answered your `asking` question in the editor (a button or their own words; the question and the request it is about follow) | §3.1 (`answer`): go on with that answer |
| `studio: from the Game Studio editor …` | The plugin's hook woke you (below, "Woken by the editor"): the lines under it are requests, same words as above, each ending with the game folder in `[…]` | Handle them in order (§3.1), like watch lines |

- How to wait depends on your environment. The main path works everywhere; the watch is what makes it feel
  instant, so use it whenever your environment can wake you on a new output line:
  - **Main path (every environment):** start the server with `--detach` (above), take the URL from its
    `studio: ready` line. In Claude Code you say nothing about it (the hooks below bring their requests to you). Elsewhere
    tell the user once: "When the editor says your note is kept, type *look* here and I'll read it."
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
    editor says the fact (the request is kept as a note; the game doesn't change until you read it) and, beside its field,
    that you aren't watching, with **How to open** — so never leave a stale watch claiming you are there. It prints nothing while no request comes, and ends on its own after 29 minutes
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
    not. Use the main path; the editor then says, beside its field, "Codex reads it when you type *look*".
- Keep the server running while the user works; they can save several times. Each save (and each draft write in
  between) rewrites the whole file.
  Stop the server when the user says they are finished: `studio.mjs <game folder> --stop`, never by name.
- `.studio/` holds the adapter (keep it, commit it with the game) and hand-off notes (`check.md`, `next-step.md`,
  `view-check.md` and `view-check/`, `shot/`, `requests/`, `play/` (pictures of requests made while playing), `chat/` (talks over a paused game), `status.json`, `watch.json`, `server.json`, logs; not game data) and
  `undo/` (copies of the game's files from before each request, for **Undo AI change**; the newest 12 are kept). If
  the game has a `.gitignore`, add `.studio/*.md`, `.studio/*.log`, `.studio/view-check/`, `.studio/shot/`,
  `.studio/requests/`, `.studio/play/`, `.studio/chat/`, `.studio/status.json`, `.studio/watch.json`, `.studio/server.json` and `.studio/undo/` to it.

### 3.1 Requests from the editor, and telling the editor how it is going

Each request is one small JSON file in `.studio/requests/` (oldest first by name). List the waiting ones with

```sh
node <this skill's folder>/bin/studio.mjs <game folder> --requests      # one JSON per line, oldest first
```

| `kind` | What the user wants | What you do |
|---|---|---|
| `saved` | They pressed **Save** (`files`: `placement.json`, `library.json` or `.studio/data/<id>.json`) | §4, §6 or §8 |
| `ask` | `text` = their words about `objects` (key, name, the pose in the editor at that moment; it may not be saved yet, see `unsaved`). **No `objects` (or an empty list) = about the whole game** ("make it night", "add enemies"): they typed it with nothing picked. 3D: `view` = where their camera stood (`eye`) and looked (`target`), world units. Each object may have `files` = the asset files it is drawn with (its model, its picture). `assets` = files they picked in the Library (paths in the game folder): "this" in their words means those files (and the `objects`, if any). `motions` = motions they picked in the Library (`name`, `len`, `on`: the objects it is on and `when`): "this motion" — put it on the object yourself with `--do motion.attach … --when …` (§3.4); code (`playMotion(key, name)`) only for a moment the game decides (§4 Motion). `intent: "to-code"` = they pressed **✦ Turn into a rule** on these hand-placed objects or this motion (its points in `motions[].keys`): "Turn into a rule" in §4. `intent: "to-knob"` = they pressed **✦ Write into the rule** on a rule's offset: `places[0]` is the layout with `way`, its `offsets` and each object's `line` / `rank` / `offset` — "Code layouts" step 8. `intent: "ui-code"` = they pressed **✦ Ask … to make this UI editable** on a part of the game's UI the editor cannot select yet: `pressed` = where (game page CSS px), `found` = the dotted frames the editor showed (`box` [x, y, w, h], `from` `hud-canvas` / `left-out`), `shot` = a 240×160 picture round the place (**open it**) — "UI drawn in the canvas" in §4, **all of the game's canvas UI at once**. A file made with "Make with AI" has a line in `.studio/generated.json` (its kind and the words it was made from: "a coin pickup chime" tells you where the sound belongs) | Do what they asked in the game code. Find each object by its key (§5), and by its `files` when the key alone is not enough ("make this enemy the boss": that model is the boss). Put new things where `view` sees them (between `eye` and a little past `target`), unless they said where. **"Add this to the scene" with `assets`**: add a new object to the game made from each file (load the model / picture, give it a name mark, §5), put it where `view` looks, and say what you named it. If the words are unclear or it is a big change, ask first in your own window |
| `name` | Give these `objects` (no name, `path:` keys) a name. Each `label` is the name the editor shows for it, guessed from its shape, colour and place ("Black pillar by the road (left, 3rd)"): the words the user knows it by | Add a mark to each in the code (§5), choosing names from what they are (the `label` is a hint, not a name to copy: `roadside-pillar`, not `black-pillar-left-3rd`); say which names you chose |
| `next-step` | `step` = `fit` / `look` / `tool` (in this game, with their words in `text`) or a KUMODeck step | `fit`, `tool`: §8. `look`: §9. KUMODeck steps: §7 (`.studio/next-step.md`) |
| `answer` | Their answer to your `asking` question, given in the editor: `text` = the answer (one of your `--choice` words, or their own), `to` = the request the question was about, `question` = your question; `objects` = what it was `--about` | Go on with that answer, as if they had said it in your window: `working`, then `done` for **this** request id (`done --request <answer id>` also clears the request the question was about). If they answered in your window first, the editor's answer is the same answer: mark it `done` with no change |
| `play` | They asked **while playing** (▶ Play in the editor, often full screen) and are still playing. `text` = what they saw ("when I stop here the character vanishes": *here* is the moment below). `shot` = a picture of the game at that moment (`.studio/play/<id>.jpg`: **open it**). 3D: `view` = the player's own camera (`eye`, `target` 10 units ahead). `near` = what was near (3D: nearest in front of the camera, `d` in world units; 2D: on screen, nearest the middle; `screen` = where in the picture, 0–1 from the top left). `logs` = the game's console: errors and warnings (`level`), uncaught errors, the last lines, `ago` seconds before they asked. `fullscreen`, `size`. `paused: true` = they paused the game and ask you from the paused moment (the editor over the stopped frame): the first message has the moment above; the next ones have `chat` (the first one's id) and `history` (the talk so far) instead. `made: true` + `here` = "make it appear here": something the game made, put where it should appear | §3.1.1 |
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
| After applying a layout | "Moved 4 objects and added 2 duplicates. The editor shows them now." | "Your layout has been applied." / "Reload the game to see them." |
| After doing editor work yourself (§3.4) | "Took “Row” off the blue pillar. ⌘Z in the editor brings it back." | "To remove it: 1. Select the pillar 2. Right-click…" |
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

**Paused (`paused: true`, the line says `paused, chat …`).** They pressed P (or ❚❚ Pause to edit): the game is stopped
at the moment of the picture, and that moment is **the editor** — they can move things there by hand, and they ask you
from the editor's field at the foot ("Ask Claude about this moment…"), waiting for your reply on the line over it. It is
a conversation, not a bug report:

- **Answer in your `--note`**: `received`, then `--status done --request <id> --changed 0 --note "<your answer>"`. The
  note is the reply they read over the field (up to 300 characters, plain words, their language; no Markdown). Answer
  what they asked ("why did I fall here?" → the cause, from the code and the picture), and say what you could change.
- **Change code only when they ask for a change** ("make the jump higher", "fix it"); then as above (steps 3–5): the
  reply sits next to **Reload**. A question is answered, not acted on. Don't reload their game or tell them to: they
  are on a moment of their run (Resume goes on from it); Reload is theirs.
- **The talk so far**: `history` in the request (oldest first; `ai` turns are your earlier replies), and the whole talk
  in `.studio/chat/<chat>.json` (both sides, plus the moment from the first message: `shot`, `view`, `near`, `logs`).
  "This", "here" and "it" mean the paused moment. `objects` = what they had picked.
- **"Make it appear here" (`made: true`, with `here`).** They dragged something **the game made** (a boss, an enemy, a
  pickup — not there when Play started) to where it should appear, and pressed ✦. `here` = `{ key, label, at, to,
  time }`: the object, where it was when they paused (`at`), where they put it (`to`), and the game's time then
  (`time`, seconds since ▶ Play). Change **where the game makes it**, in the game's code (the spawn: `boss.position.set(0,
  2.6, -26)` → the `to` position; a lane, a spawn point, a random range — whatever the code uses, so it appears there
  from now on), keep everything else of how it moves. Then `--status done --changed <n> --note "<one line in their
  words: what changed>"` ("The boss now comes in on the left lane."): the editor puts **Reload** next to your line
  itself, and the next run makes it there. Your reply (the note and your own window) says only what changed — **not**
  "press Reload", "reload to check", "play again": the editor already offers it, and a how-to handed back is the worst
  experience (§3.6). Not `--do object.move`: what the game makes is not in the scene file; moving it in the editor was
  "just for this moment".
- What the game moves or made moved in a paused moment is "just for this moment" (their next start does not have it);
  what they **placed** and moved there is in their scene as in Edit (Save · N): handle it as any saved move.
- A choice to make: `--status asking --choice …` as usual; their pick comes back as the next message.
- **"Show this moment's numbers and let the game start from here" (`intent: "moment-connect"`, the line says `connect
  this moment to the game`).** The one ✦ of a paused moment whose game has no `codeMoment()` yet (under This moment and
  under ⚑ alike). Deliver **both** in one go — the values ("This moment", §4) **and** `save` / `load` ("Checkpoints",
  §4), `--check-moment` ok — then `--status done --changed 0 --note "<one line>"` ("Score, time left and health are in
  This moment now, and checkpoints keep the boss and its shots."). If the game already has one of them, write the
  other. Not "press Reload".
- **"Make this moment editable" (`intent: "moment-values"`, the line says `make this moment's values editable`).** The
  list's "This moment" had nothing to show: the game has no `codeMoment()` yet. Deliver it — "This moment" (§4) — then
  `--status done --changed 0 --note "<one line: which numbers>"` ("Score, time left and health are in This moment
  now."; no object changed: the editor sees the code did and offers Reload next to it). Not "press Reload".
- **"Let the game start from this moment" (`intent: "moment-save"`, the line says `let the game start from this moment`).**
  They pressed ⚑ (Make this a checkpoint) and the game cannot start from the middle: write `save` / `load` —
  "Checkpoints" (§4), `--check-moment` ok — then `--status done --changed 0 --note "<one line>"` ("Checkpoints keep the score, the time, the
  boss and its shots now."). `checkpoint.error` set = your `save()` threw: fix that.
- **A checkpoint that does not open (`intent: "moment-load"`, the line says `checkpoint "…" … does not open: <error>`).**
  The game changed since it was kept and `load()` threw on the old data (or is gone). `checkpoint` has its file
  (`.studio/checkpoints/<id>.json`: read its `moment`), `load`'s error and the console's lines. Make `load()` read it —
  "Checkpoints" (§4, old checkpoints; `--check-moment` ok) — never by editing the person's checkpoint file. `--status done --changed 0
  --note "<one line>"`; the editor offers "⚑ From <name>" next to Reload.
- **"5 seconds left, I want to see the end"** while paused, with a `codeMoment()` there: `--do moment.set --id timeLeft
  --v 5` (§3.4) — the value is set for this moment only and the game draws it; Resume goes on from there. Not a code
  change. "Start with 90 seconds" is (the code's first value).
- `--do` while they are paused works on the moment (CONTRACT.md §3.6): `list` has what the game made too, and the
  moment's values (`moment`).

### 3.2 Objects without a name: offer once, at the start

When the first `studio: unnamed` line appears (or `--requests` / the editor list shows `path:` keys), and the user
has not saved yet, **offer once** to name them first, in one short message, for example: "3 things in your game
have no name yet (the ground, a rock, …). Shall I name them in the code first? Then what you save keeps working
when the code changes." Name only the ones the user agrees to (§5) — the editor reloads the game by itself when the code changes —, and do
not ask again in this session (the line comes back on every reload; that is not a new question). WHY now: names added after
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
open pictures, do not stop at "not checked on the real game yet": tell the user in **one line** what to look at in
the editor (it already shows your change), for example "In the editor, the rock is now left of the house and the
second barrel is gone."

### 3.4 Do it in the editor yourself (`--do`)

Editor work is yours to do, with one command. With the editor open, it happens **in the editor**: the person sees it
change at once, one ⌘Z takes back the whole command, it counts on Save · n like their own edits, and a line over the
ask bar says "Claude took “Row” off Blue pillar · ⌘Z undoes it". With no editor open (not started, or no page has it
open) the same ops are written into `placement.json`, in the shape the editor writes, and the editor shows them when it
opens. Never edit `motions` / `motion` / `objects` in `placement.json` by hand while the editor is open: its draft
writes over the file on the person's next change. (If you must hand-edit the file then, for keys renamed in the code,
§5, run `--do editor.reload --editor` right after, so the editor reads your file.)

```sh
node <…>/bin/studio.mjs <game folder> --do list                                          # what is there: keys, names, motions
node <…>/bin/studio.mjs <game folder> --do motion.detach --key pillar-1 --name Row       # one op from flags
node <…>/bin/studio.mjs <game folder> --do '[{"do":"motion.detach","key":"pillar-1","all":true},
  {"do":"motion.make","name":"Spiral","len":4,"repeat":"loop","points":[[0,0,0],…],"key":"pillar-1"}]'   # several: ONE ⌘Z
```

It prints one line per op — `studio: did took "Row" off pillar-1 - in the editor (…)`, or `studio: do failed
motion.detach - pillar-1 has no motion "Hop" (its motions: "Row")` (exit 1; the other ops were done) — then, with the
editor running, the `studio: reply with this link …` line: that link goes first in your reply.

After you write a `codeMotion` / `codePlace` / `codeAvoid` into the game's code, send its `--do` at once: an editor page
that does not have the id yet reads the game again by itself first. `studio: do failed place.code - the game has no
codePlace('lamp') (it has: 'hex')` means your code did not run as you think (a typo in the id, an error, the import
missing): fix your code and send the same `--do` again — never ask the person to reload. With no editor open, `knobs`
and `hand` are refused (they need the game's numbers): change the number in the code itself instead.

| Op | Fields | Does |
|---|---|---|
| `list` | — | `studio: list {…}`: every object of the level on screen with its key, the name the person sees ("Blue pillar by the road (left, 3rd)"), `p` (where it stands in the editor now, saved or not) and its motions; the Library's motions and what they are on (a code motion with its `code` and `knobs`; a motion of points with its `keys.p`); the code layouts (`places`: id, name, its objects' keys, `knobs`, keep-out areas, `skipped`, `from`, `offsets` and `objects`: each object's `line` / `rank` / `offset`); the levels; the UI (`ui`: every element of the UI layer — HTML ones `html: true`, canvas ones with `code`, `kind`, `box` on screen, `codeAt` (the code's at() and scale now) and `write` (the `at` and `scale` to write on Save), each with `p` / `s` / `set` as the editor has them; a canvas one on
another screen has `screen`); `uiFound`: the game's UI the editor sees but cannot select yet (`box` [x, y, w, h] game
page CSS px, `from` `hud-canvas` / `left-out` — the dotted frames; "UI drawn in the canvas", §4); `moment`: the game's `codeMoment()` values read from the page now (`id`, `name`, `v`, `set`, `unit` / `min` / `max` / `step`; `null` = the page runs no `codeMoment()`) and `paused` (a paused moment is up: `moment.set` works then). Use it to find what "the blue pillar's old motion" or "the lamps' gap" means |
| `motion.make` | `name`, `points` or `keys`, `len` (s, default 2), `repeat` (once / loop / pingpong), `ease`, `key`, `when`, `until`, `replace` | A Library motion — on the timeline, played by the loader — and, with `key`, put on that object. `points` = positions it goes through, offsets from where it stands, spread evenly over `len` (linear between them); `keys` = the file's own keys (`p` / `r` / `s`) for turns and sizes. A taken name becomes "Spiral 2" unless `replace: true` (the same motion with new keys) |
| `motion.attach` | `key`, `name`, `when`, `until` | Put a Library motion on an object |
| `motion.detach` | `key`, `name` (or `all: true`) | Take a motion off that object (the "Remove from this object" of its card); the motion stays in the Library |
| `motion.delete` | `name` | Delete it from the Library and every object |
| `motion.rename` | `name`, `to` | Rename it everywhere |
| `motion.set` | `name`, `repeat`, `len` (stretches its keys), `key` + `when` / `until`, `knobs`, `key` + `off` | Change how it repeats, how long it takes, when it starts / stops (`key` = on that object; without it, on every object that has it). `knobs` (`{ "radius": 3 }`): a code motion's numbers, turned on screen (needs the editor open). `off: true` / `false`: switched off on that object (it stays there and does not play) / on again |
| `motion.code` | `code`, `name`, `key`, `when`, `until`, `replace` | Put the code motion you wrote (`codeMotion('<code>', …)` in the game's code, "Motion" below) on the timeline: a Library motion with the knobs, played by the loader, and on `key` (starting with the game unless `when` says). The same `code` already in the Library is that motion (the person may have renamed it). `replace: true`: the motion of points called `name` becomes this code motion (every object that has it keeps it); the line then ends with the editor's measure of how close it is (the largest gap over one round, and when) |
| `place.code` | `id`, `replace` (keys) or `fold` | Show the code layout you wrote (`codePlace('<id>', …)`, "Code layouts" below) in the editor: its objects, listed under the layout's name. `replace`: the hand-placed objects it takes the place of (`["lamp-1", …]`, in the layout's own order: its number 1 takes the first one's place) — hidden at once (one ⌘Z brings them back), gone from the code by you on Save; the line then ends with the editor's measure of how close it is (the largest gap, which object). `fold`: what of the layout's `places` entry you have just written into the code — `side` (or another way: that way's offsets), `offsets`, `pins`, `avoid`, `knobs`, `from`, or `all` (`"side,pins"` for two): the editor reads the game again, takes them out of `placement.json` (not a change of the person's: no ⌘Z, no Save count) and measures every object before and after — the line ends with "the look is the same", or the farthest off and where it stood ("Code layouts" step 5) |
| `place.set` | `id`, `knobs`, `pin`, `unpin`, `hand`, `offsets` | `knobs` (`{ "gap": 4 }`): the layout's numbers, on screen (needs the editor open). `pin` (`{ "key": "lamp-3", "p": [x, y, z] }`): just that one put by hand; `unpin`: that one back on the formula (`"*"`: every one placed by hand, the card's "All back to rule"). `hand: true`: every object placed by hand where it stands now (needs the editor open); `false`: back on the code. `offsets` (`[{ "way": "side", "how": "same", "v": 1 }]`, ≤ 8; `[]` takes them off): the whole rule shifted, as the person's drags do ("Code layouts" step 5); `{ "how": "jitter", "v": 0.3 }` = every object a little off by a fixed random amount (a `seed` is added) |
| `place.avoid` | `id`, `code` (+ `knobs`, `off`) or `box` (+ `name`), or `remove` | A keep-out area of that layout only: your `codeAvoid('<code>', …)` added, switched `off` / on, its `knobs` turned; or a box `{ "p": [x, y, z] (the middle of its bottom), "size": [w, h, d] }` (2D: `[x, y]` middle / `[w, h]` px); or `remove`: which one (its place in the list, 0 = the first, or its code id) |
| `object.move` / `object.turn` / `object.scale` | `key`, `to` or `by` (turn: radians, `deg: true` for degrees; scale `by` = times) | Move, turn, resize (its place; its motion comes along) |
| `object.rename` / `object.duplicate` / `object.delete` | `key` (+ `to`: the name; duplicate: the copy's place) | As Rename (F2), Duplicate (⌘D), Delete; the copy's key is in the line |
| `object.ground` | `key` | Drop to floor (needs the editor open) |
| `level.new` / `level.duplicate` / `level.rename` / `level.switch` | `name`; `id`; `id` + `to`; `id` | New (blank) level, Duplicate, rename, open one (`level` on any object op = do it on that level) |
| `save` | — | The person's Save. **Only when they say "save"** — otherwise Save stays theirs |
| `editor.reload` | `editor: true` = the editor page itself | Reload the game in the editor (or the page: after a change to `.studio/adapter.js`, `studio.json`, `tools.js`, `.studio/ui/`) |
| `ui.code` | `id` (`"score"`, or several: `"score,hp-bar,jump"`) | After you rewrote the drawing with `codeUi()` ("UI drawn in the canvas", §4): the editor reads the game again, lists them in its UI layer with the HTML UI, and **checks each box**: it moves it 40 px, draws one frame and looks whether the picture moved with it. `studio: do failed ui.code hp-bar - moving it 40 px changed nothing on screen: the drawing does not read codeUi('hp-bar').box()` / `- the box is smaller than what is drawn (232×34, drawn 260×36)` = your rewrite is off: fix it and send it again (the person sees nothing of it). With no editor open: nothing to do (the editor lists them when it opens) |
| `ui.theme` | `id` (`"--accent"`, or a codeTheme key `"accent"`), `v` or `clear` | A Theme row (a CSS variable of the page or a codeTheme of the canvas UI): `v` = what the row does (one ⌘Z, counted on Save); `clear` = after Save you wrote it into the code (the CSS, or `codeTheme()`): out of `theme` in placement.json, not a change of the person's. With no editor open: `clear` takes it out of the file |
| `moment.set` | `id` (a `codeMoment` value's id: `--do list` → `moment`), `v` (a number) | **Only while they are paused** ("This moment", §4): the game's `set(v)` — kept inside its `min` / `max`, on its `step` — and one frame drawn, so the HUD shows it; just for this moment (one ⌘Z, not counted on Save, gone at Resume). `studio: do failed moment.set - the game is not paused` otherwise (and with no editor open): the person is playing or in Edit — change the code's first value instead if that is what they asked |
| `ui.set` | `id` + `p` (`[dx, dy]` CSS px from where the game draws it; with `from`: the `at()` numbers from that place, `{"from":"top","p":[0,20]}`), `s`, `set` (the card's look: `text`, `fontSize`, `color`, `background`, `"@hover"` / `"@active"` / `"@disabled"`: `{ color, background }`); or `clear: true` alone | What the UI card does, on screen, one ⌘Z. `clear`: **after Save, once you wrote that entry into the code**: it leaves `placement.json` (not a change of the person's: no ⌘Z, no Save count) and the editor draws it where your code now puts it. With no editor open only `clear` works (change the code itself otherwise) |

`when`: `"start"`, `"click"`, `"touch"`, `"key:E"` (any `KeyboardEvent.code`: `"key:Space"`), `"time:2"`,
`"after:Hop"`, `"cue:chest-opened"`, `"say:<their words>"`, the file's object (`{"on":"enter","area":{…}}`), or a list
(any of them starts it). Without `when`, a motion you make starts with the game; one you put on with `motion.attach`
starts with the game, or after the object's last motion when one already does (the editor's own rule for a drop). `until`: `"times:3"`, `"cue:boss-down"`, `null` = never. Keys: from `--do list`, a request's `objects`,
or the marks in the code (§5).

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
- `motion` / `motions` (optional): objects the user made **move by themselves** in the editor, with keys on a timeline;
  the motions are Library assets (`motions`: "Open", "Row") and each object says which it uses and when it starts and
  stops (`motion`). A motion with `code` is one of your `codeMotion()`s, with the knobs the person turned. See "Motion
  (`motions`, `motion`)" after "The UI".
- `places` (optional): what the person changed of your **code layouts** (`codePlace()`): turned knobs, objects put by
  hand, keep-out areas. See "Code layouts and keep-out areas (`places`)" after "Motion".

**If the game already reads `placement.json`** (the samples do; or an earlier session added the loader: look for
`applyPlacement` / `studio-placement.js`), there is nothing to choose: the save is in the game the next time it
loads. Do not ask; look at the game (§3.3), set `done` and say so in one line ("Your layout is in. ▶ Play in the editor
plays it."). Copies and deletions (`added`, `removed`) still need you: the loader only shows them until the code has
them (a look-alike copy, a hidden deletion), see "Copies and deletions". **`places` (your code layouts) always need
you: the code is the truth** — write every change in it into your `codePlace` / `codeAvoid` on each Save and fold it
out of the file ("Code layouts" step 5); the file only holds them until you do.

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
4. When the numbers are computed (a loop, a formula, random), there is nothing to replace. Write that layout as a
   `codePlace` ("Code layouts" below): then the editor changes it as a formula — the person turns its gap or count and
   it stays a formula. Until you do, keep that key and use the loader for it, and tell the user which objects stayed
   that way.
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
- Until then the loader shows them: it puts a clone of `from` under the copy's key at its pose, and hides a removed
  object while it still stands at `was.p`. That is a stand-in only: the clone looks right but does not act (a copied
  boat does not float, a copied coin does not spin or count), and the hidden object still runs. A key the code already
  makes is left to the code. Put both into the **code**, then take `added` and `removed` out of `placement.json` (keep
  `objects` and `order` if the user uses the loader).

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

**Renamed objects (`names`).** The user renamed objects in the editor (Rename, F2): `"names": { "crate-2": "Hero crate" }`
(object key → the new name; with `levels`, each level has its own). The editor already shows the new name. Rename the
object in the code: its name / mark (three.js `object.name` or `userData.studioKey`, Pixi `label`, a `key:` field) to a
key made from the new name (`hero-crate`: lower case, `-` for spaces, Latin letters and digits; for a name without
Latin letters, keep the old key and add the name as a label or comment), and every reference to it. Then move its
entries in `placement.json` (`objects`, `motion`, `added` / `removed` / `order` keys) to the new key and take the
entry out of `names`. Say which keys you chose.

**Check after applying** (also when the user only says "saved"):

1. Run the game (or reload it in the editor). Every copy is there, every deleted object is gone, and the game starts
   without console errors.
2. Look in the editor yourself (it reloads the game by itself when your files change; `--do editor.reload` if not):
   `--do list` shows the copies as ordinary objects and the deleted ones gone, and Save shows no unsaved count. If a copy shows the **copy** tag again, its key in the code does not
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

**On Save, write it into the code and take it out of `ui`** ("the code is the truth", 2026-10-24: `placement.json` is
where the person's changes wait until Save, not where the game keeps its layout). Until you have, the loader shows it
(`applyPlacement(scene, …)` applies `ui` too, before the world, also to marked elements the game adds later; a game
with **no world** calls `await applyPlacement(document, './placement.json')`), so the game is right in the meantime.
Then, for each entry you wrote, **one `--do`** takes it out of the file without a change of the person's:
`--do '[{"do":"ui.set","id":"title-card","clear":true},{"do":"ui.set","id":"score","clear":true}]'` (the editor shows the
element where your CSS now puts it; no Save count comes back). An entry with `"code"` is a UI drawn in the canvas: see
"UI drawn in the canvas" below.

**Writing it into the code**, per key:

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
5. Take that key out of `ui` with `--do ui.set --id <key> --clear` (the editor open), or remove it from the file (no
   editor open; `uiView` too when `ui` is empty). The loader would otherwise apply the offset a second time on top of
   `left` / `top` numbers you changed.

**The nearest edge** (`from` / `at` on an entry that moved or grew, since 2026-10-24): where the person left it, measured
from the nearest of 9 places of the game's window — `top-left`, `top`, `top-right`, `left`, `center`, `right`,
`bottom-left`, `bottom`, `bottom-right` — and its CSS px from there (`at` = [x, y], inward; for a middle one x / y is
across from the middle). "Top right" must stay top right on a phone and on a wide screen, so when the element is
placed on the screen (`position: fixed` / `absolute` against the game's window), **write its CSS by `from`** instead of
adding the offset: `top-right` [16, 24] → `right: 16px; top: 24px;` (and `left: auto` when its rule had a `left`);
`top` [0, 20] → `left: 50%; top: 20px; translate: -50% 0;` (x ≠ 0: `translate: calc(-50% + <x>px) 0`); `center`
[0, 0] → `left: 50%; top: 50%; translate: -50% -50%;`; `bottom-left` [20, 24] → `left: 20px; bottom: 24px; top: auto`.
With a size (`s`), also `transform-origin` at that place (`top right`, `top center`, `center`, `bottom left`) so it
grows away from the edge it keeps to. An element laid out in the flow (a flex row, a grid cell) keeps the offset way
above. Then `ui.set --clear` as above. `--do list` → each HTML element's `edge` (`from` / `at` now) and `box`.

Check after applying: shoot the game **without the editor** (`--shot`, §3.3) and compare with what the user saw; the
editor reloads the game by itself, and Save then shows no unsaved count.

**Screens, looks and the theme** (`screen`, `set` / `setWas`, `theme`). The UI list's head picks a screen of the game
(Title, Playing, Paused, Game over…, the containers marked `data-studio-screen`, §5); the card changes an element's
text, the size and colour of that text, its fill, and a button's colours when hovered / pressed / disabled; "Theme"
under the list changes the game's CSS variables. Saved with the element (and at the top for the theme):

```json
"ui": {
  "result-card":  { "p": [0, 0], "screen": "over", "label": "The garden glows …",
                    "set": { "text": "Garden lit!", "color": "#ffd9a0", "fontSize": 48 },
                    "setWas": { "text": "The garden glows", "color": "#fff6d8", "fontSize": 40 } },
  "start-button": { "p": [0, 0], "screen": "title",
                    "set": { "@hover": { "background": "#ff8fb1" } }, "setWas": { "@hover": { "background": "#ffe08f" } } }
},
"theme": { "--glow": { "v": "#7fd1ff", "was": "#ffcf6e" } }
```

- `screen` = the `data-studio-screen` of the element's container: which screen to look in. Nothing to apply.
- `p: [0, 0]` = not moved (only its look changed). `setWas` = the values the code has now: search for them.
- `text` = the element's main words: its `data-studio-text`, else the first element in it with words of its own (the
  `<h1>` of a title card, a button itself). `fontSize` (CSS px) and `color` are that text's; `background` is the
  element's own box. `"@hover"` / `"@active"` / `"@disabled"` = the colours of its `:hover` / `:active` /
  `:disabled` look (a button).
- `theme`: a CSS variable on `:root` / `html`, by name; `was` = its value in the CSS now.

The loader (Way 1) shows all of it already (the text, the colours through one style sheet, the theme on `<html>`).
**Writing it into the code (Way 2):** change the words in the HTML (or in the code that writes them); the size and
colour in the CSS rule of that text (`font-size`, `color`), the fill in the element's rule (`background`), a state's
colours in its `:hover` / `:active` / `:disabled` rule (add one when there is none); a theme variable where `:root`
declares it. Prefer a theme variable when the colour is one (change `--glow`, not every rule that uses it). Then take
the entry out (`ui.set --clear`, as above) once its place and look are both in the code, and `theme` when it is
done. **Sample values** (the card's "999,999", "a long name") are never in the file: they are the user checking that
text fits. If they say a long one overflows, fix the CSS (a `max-width`, `text-overflow`, a smaller size) when asked.

### UI drawn in the canvas (`codeUi`, `ui.<id>.code`)

A score, a health bar, a button or a minimap the game **paints in a canvas** is part of the picture: the editor cannot
know where it is. You make it editable by rewriting the drawing **once** so it reads its place and look from the
loader's `codeUi()`; the editor then lists it in the UI layer with the HTML UI (one list, top of the screen first), with
the same frame, strip and card — the person sees no difference between the two (do not tell them "canvas" or "HTML").

**Deliver it** (the first time you look at a game with such a UI, without asking — §1 — or when asked "make this UI
editable": an `ask` with `intent: "ui-code"`, from the ✦ on the line "This UI can't be selected yet"):

1. **Find every one** the game draws fixed on the screen: `fillText` / `fillRect` / `arc` / `drawImage` of a score, a
   bar, a button, a minimap; in Phaser a HUD text (`this.add.text`, often `setScrollFactor(0)`), in Pixi a HUD `Text` or
   container — those are kept as objects: see "Phaser / Pixi" below. **All of them in one go**, never one per request — a `ui-code` ask names ONE place the
   person pressed (`pressed`, its picture `shot`), but they mean "this UI": deliver that one and every other part not
   delivered yet. Your clues: `found` in the ask / `uiFound` in `--do list` (the dotted frames: each is a part, or a few
   parts close together, of a 2D canvas over the game's or of what the engine's adapter leaves out as UI), the picture,
   and the code. When you are done, `--do list` has no `uiFound` left (a frame left over = a part you missed, or a
   `size` that does not cover its drawing).
2. **Shoot the game before** (`--shot`, §3.3) and keep `.studio/shot/game.png`.
3. Rewrite the drawing, one `codeUi()` per part. Import it from the loader (copy `bin/studio-placement.js` in first,
   Way 1, when the game does not have it):

   ```js
   import { codeUi } from './studio-placement.js';
   // Once, at the top: the numbers that were in the drawing move here (the drawing reads them back).
   const scoreUi = codeUi('score', { name: 'Score', kind: 'text', at: { from: 'top-left', x: 16, y: 12 }, size: [232, 40],
     look: { text: 'SCORE', fontSize: 24, color: '#ffffff', background: 'rgba(10, 6, 24, 0.55)' }, sample: '999,999' });
   const jumpUi = codeUi('jump', { name: 'Jump', kind: 'button', round: true, at: { from: 'bottom-right', x: 24, y: 24 },
     size: 72, look: { text: 'JUMP', fontSize: 18, color: '#0b0b1a', background: '#56e3f5' },
     states: { hover: { background: '#8af3ff' }, active: { background: '#2fb8d0' } } });
   // Every frame, where it drew with fixed numbers:
   let b = scoreUi.box(), L = scoreUi.look();
   ctx.fillStyle = L.background; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 8 * b.s); ctx.fill();
   ctx.font = `bold ${L.fontSize * b.s}px "Courier New", monospace`; ctx.fillStyle = L.color;
   ctx.fillText(`${L.text} ${scoreUi.value(score.toLocaleString())}`, b.x + 10 * b.s, b.y + 28 * b.s);
   b = jumpUi.box(); L = jumpUi.look(jumpUi.state() || (pressed ? 'active' : hover ? 'hover' : null));
   // …and the press test: if (jumpUi.hit(e.offsetX, e.offsetY)) jump();
   ```

   - `id`: lower case and `-` (`hp-bar`). `name`: the person's word for it, **in their language** (the list and the
     card show it). `kind`: `text` | `bar` | `button` | `image` | `box` — what it is (a bar's samples are full / half /
     empty).
   - `at: { from, x, y }`: measured from one of 9 places of the canvas — `top-left`, `top`, `top-right`, `left`,
     `center`, `right`, `bottom-left`, `bottom`, `bottom-right` — inward (+ = into the canvas; for `top` / `bottom` /
     `center` x is across from the middle, for `left` / `right` / `center` y is down from the middle). Pick the place
     the drawing is measured from now (`w - 24 - 36` → `bottom-right`, x 24 for a 72 px button).
   - `size`: `[w, h]` (one number = a square), or `() => [w, h]` for a text whose width changes (`ctx.measureText`). It
     must **cover the whole drawing** (the frame, the light around it and the press test use it).
   - `look`: only what the card may change (`text`, `fontSize`, `color`, `background`): each key you give is a row on
     the card, nothing else is. `states`: a button's hover / pressed / disabled looks. `sample`: the first sample value.
     `round: true`: a round button. `canvas`: the canvas it is in when the page has several and it is not the last
     one. `units: 'canvas'` when the game draws in the canvas's own pixels (no `ctx.scale(devicePixelRatio)`).
   - The drawing: every number of that part comes from `box()` (`x`, `y`, `w`, `h` in your units; `s` = its size: multiply
     inner offsets, radii and font sizes by it), its colours and words from `look()`, the game's value through
     `value(v)` (the editor's sample value while one is shown). **A bar's value is its fill from 0 to 1**:
     `const fill = hpUi.value(hp / maxHp)` (the editor's samples for a bar are 1, 0.5 and 0 — full, half, empty), then
     draw `Math.round(fill * cells)` cells; a bar needs no `sample`. A text's value is the words or number it shows. A button's press test: `hit(x, y)` — **a moved button
     must be pressed where it is drawn**. `state()` = the look the editor shows (mix it with the game's own hover /
     pressed as above).
   - The game draws from `requestAnimationFrame` (the editor draws ONE frame of it, with time stopped, after each
     change). A game that does not: `window.studio?.redraw?.(() => drawHud())` once.
   - **Screens**: a part shown on one screen only (the title, the game-over panel, a pause menu) gets `screen: 'title'`
     / `'play'` / `'over'` / `'pause'` (the same ids as HTML's `data-studio-screen`: a page with both is one screen
     each). With 2 or more screens the editor's UI list offers them ("Playing ⌄ 1 / 2"); the person picks "Game over"
     and the game must draw that screen's UI — and change nothing else (not the score, not the time, not the game's own
     state). So the drawing asks the editor first: `const screen = globalThis.studio?.screen?.() || state.screen;` then
     draws the parts of `screen`. Outside the editor `studio.screen()` is absent / null: the game decides as before.
   - **Phaser / Pixi — UI kept as objects** (a `Text` the engine draws by itself; nothing calls `box()` each frame). Give
     the object itself as `size` (the editor measures its `getBounds()` at its own scale 1, and the engine adapter
     leaves it out of the scene's objects: it is UI now), and move it in `onChange` — called once at once and again
     whenever the person moves, sizes or recolours it (the game's update does not run while the editor holds it):

     ```js
     import { applyPlacement as applyUi, codeTheme, codeUi } from './studio-placement.js'; // the editor's loader
     await applyUi(document, './placement.json'); // the file's UI and theme until Save (your world loader stays)
     // Phaser, in create(): its own pixels (Scale.FIT) → units: 'canvas'
     this.hudUi = codeUi('distance', { name: 'Distance', kind: 'text', at: { from: 'top-left', x: 16, y: 20 }, size: this.hud,
       units: 'canvas', look: { fontSize: 22, color: '#2b1d3a' }, sample: '9,999 m' });
     this.hudUi.onChange((b, L) => this.hud.setPosition(b.x, b.y).setScale(b.s).setFontSize(L.fontSize).setColor(L.color));
     // Pixi (autoDensity: CSS px, the default units):
     scoreUi.onChange((b, L) => { hud.position.set(b.x, b.y); hud.scale.set(b.s); hud.style.fill = L.color; });
     ```

     `b.x` / `b.y` is the box's top-left: for an origin / anchor other than 0, add `b.w * originX` (Phaser) or
     `b.w * anchor.x` (Pixi). The words stay the game's (`setText` / `text =` as before, through `value(v)` where it
     sets them); a text left empty while the game waits to start shows its `sample` in the editor (on the object
     itself), so give a text a `sample`. A container (a panel) works the same, its position offset from its bounds'
     top-left kept. Phaser: `units: 'canvas'`; Pixi with `autoDensity`: the default (`css`).
   - **The theme** — colours (and fonts) the UI shares (an ink, an accent): once, in the person's words for `label`,
     `const T = codeTheme({ ink: { v: '#2b1d3a', label: 'Ink' }, accent: { v: '#ffcf6e', label: 'Accent' } })`.
     The editor lists them under "Theme" with the page's CSS variables (`--ink`, `--accent`: the same name is one row).
     A part in that colour says so in its look — `look: { color: 'var(--ink)' }` — so it follows the theme until the
     person gives that one part a colour of its own; elsewhere read `T.ink` where you draw (a getter: the value now),
     and an object kept from frame to frame takes `T.onChange((v) => panel.setStrokeStyle(3, v.ink))`. Only colours
     the game really shares; a part's own colour stays in its look.
4. **The picture must not change by one pixel**: shoot again (`--shot`) and compare with step 2. Different → fix the
   drawing (a rounding, a missing `* b.s`) and shoot again.
5. `--do ui.code --id score,hp-bar,jump,minimap` (all of them). The editor checks each box (§3.4); `do failed` → fix and
   send again. Then **one line** in the game's words, no editor steps: "I made the score, the health bar and the JUMP
   button movable in the editor (they look the same)". Nothing about pressing Save, picking or dragging: the editor
   says that itself, and the person already knows Save is how they hand it to you. **The reply is the link and that
   one line** — no lists of what you checked, what you changed in which file, or what they can do now (a real run of
   2026-10-25 answered with three bullet points: the person reads one line). For a `ui-code` ask that line is the
   `--status done` note of that request (§3.1), the same words: "I made the minimap movable in the editor, and the
   score and the health bar too (they look the same)".

**Leave out** (say it in one line if asked): a name over a character's head and anything else that follows the world
(it is a scene object, not UI); a part whose place the game changes every frame (a bouncing score: deliver its resting
place and add the bounce on top of `box()`).

**What the file says until Save** — the same `ui` entry as an HTML element's, with `code`:

```json
"ui": {
  "hp-bar": { "code": "hp-bar", "p": [389, -40], "s": 1.4, "from": "top", "at": [0, 16], "label": "Health bar" },
  "jump":   { "code": "jump", "p": [0, 0],
              "set": { "@active": { "background": "#ff8fb1" } }, "setWas": { "@active": { "background": "#2fb8d0" } } }
}
```

- `from` / `at`: where it is measured from now — the nearest of the 9 places to where the person left it — and the
  `at()` numbers from there (your units). The loader places it by them, so a bar moved to the top middle stays there on
  any window size. `s` = its size over the code's `scale` (1.4 × `scale: 1` → write `scale: 1.4`). `p` = how far the
  editor moved it (only the editor uses it). `set` / `setWas` as for HTML (`setWas` = the code's `look` / `states` now).

**On Save** (a `saved` request with `ui` entries that have `code`) — the code is the truth:

1. In `codeUi('<id>', …)`: `at: { from: '<from>', x: <at[0]>, y: <at[1]> }` and `scale: <code scale × s>` (or take
   them from `--do list`: each canvas UI's `write` says exactly what to write), the `set` values into `look` and a
   state's into `states` (`"@active"` → `states.active`).
2. **One `--do`** reads the game again and takes the entries out of the file:
   `--do '[{"do":"ui.code","id":"hp-bar,jump"},{"do":"ui.set","id":"hp-bar","clear":true},{"do":"ui.set","id":"jump","clear":true}]'`.
   The editor shows them where your code now puts them (the same place: no jump, no Save count).
3. One line: "I wrote the health bar's place and size into the game".
4. **The theme** (`theme` in the file: `{ "--ink": { "v": "#3a2a55", "was": "#2b1d3a" } }`): a codeTheme's — write `v`
   into `codeTheme({ ink: { v: '#3a2a55', … } })`; a CSS variable's — where `:root` declares it. Then take it out of the
   file in the same `--do`: `{"do":"ui.theme","id":"--ink","clear":true}` (`--do list` → `theme` says which are which:
   a `label` = a codeTheme). Never `clear` one you did not write.

### This moment (`codeMoment`, `intent: "moment-connect"` / `"moment-values"`)

When the person pauses ▶ Play (P, ❚❚ Pause to edit), the list over the game starts with **This moment**: the game's own
numbers at that frame — the score, the time left, the health — each turned like a rule's knob (drag, or press and
type). A change is for that moment only: the editor calls your `set(v)` and makes the game draw one frame with time
stopped (the HUD shows it); Resume goes on from that value. The editor cannot see a `let score` in the game's JS, so you
name them **once**, in the game's code, with the loader's `codeMoment()` — and the list shows "Numbers like the score,
and starting from here, aren't ready for this game yet. ✦ Have Claude connect this moment to the game" until you do.

**When**: only when asked — a paused `play` request with `intent: "moment-connect"` (that ✦; an older editor's
`"moment-values"`), or their words ("show the score when I pause", "let me change the time left"). Not on your own:
unlike the canvas UI, nothing is missing on screen without it. **Whichever of the two was asked — the numbers or the
checkpoints — deliver both** (the values here and `save` / `load`, "Checkpoints" below) in the same change, and check
them with `--check-moment`: the person sees one ✦ for "this moment", and a second ask, wait and Reload for the other half
was the first-time walk's ✕2 (2026-10-28).

1. **Choose the numbers** — all of them in one go, never one per request: **what the HUD shows** (score, time left,
   health, lives, coins, ammo, the wave / level number) and **what decides the end of the game** (the time left, the
   player's health or lives, the boss's health, the goal count), even when the HUD does not show it. Not the game's
   inner parts (a speed, a timer of an animation, a position): those are the editor's objects or the code's. Six at
   most is a good moment; the list shows 12.
2. **Write it**, next to where those variables live (the module's top-level `let`s, or the object that holds them),
   after they exist. Import it from the loader (copy `bin/studio-placement.js` in first, Way 1, if the game has none):

   ```js
   import { codeMoment } from './studio-placement.js';
   codeMoment({ values: {
     score:    { name: 'Score', get: () => Math.floor(score), set: (v) => { score = v; }, round: 0 }, // as the HUD rounds it
     timeLeft: { name: 'Time left', unit: 's', min: 0, get: () => timeLeft, set: (v) => { timeLeft = v; } },
     hp:       { name: 'Health', min: 0, max: 5, step: 1, get: () => hp, set: (v) => { hp = v; } },
     wave:     { name: 'Wave', get: () => wave },               // no set: shown, not changed
   } });
   ```

   - `name`: **the person's word**, in their language (the request's `lang`; what the HUD or they call it: "Time left",
     "Lives" — in Japanese when they write Japanese) — not the variable's name.
   - `get()`: the value now, **rounded the way the HUD rounds it** (a HUD that prints `Math.floor(score)` →
     `get: () => Math.floor(score)`): This moment and the HUD must say the same number ("13100" beside "SCORE 13,099"
     read as two scores). A number gets a knob; anything else (a word, true / false) is shown, never changed.
   - `set(v)`: **write the variable the game reads every frame**, so the next frame runs and draws with it: the score
     the HUD prints, the time the countdown takes from, the health the hit test lowers. If the HUD text is only
     written when the value changes (an event, a `setText` on a hit), update it in `set` the same way. Leave `set` out
     for a value that must not be set by hand (a wave number the spawner derives).
   - `unit` (`'s'`, `'%'`, `'m'` … shown after the number), `min` / `max` / `step` from the game's own rules (health
     `0`–`maxHp`, step 1; time ≥ 0) — the editor keeps every change inside them. `round: 0` for a number shown whole
     (a score the game keeps as 12480.37).
   - Ids are the code's names (`timeLeft`, `hp`): `--do moment.set --id` uses them.
3. **Change nothing else**: not how the game looks, plays or starts, not the HUD. `codeMoment()` does nothing outside
   the editor (it only keeps the list; nothing calls your functions).
4. **Check**: the game still runs (§3.3). `--do list` → `moment` lists your ids and their values once the editor's page
   runs your new code: after the person's Reload, or — when the editor is in Edit, not paused — after
   `--do editor.reload`. While they are still paused on the old run, `moment` is `null`: that page has the old code;
   never reload it under them.
5. `--status done --request <id> --changed 0 --note "<which numbers, their words>"` ("Score, time left and health are
   in This moment now."; `--changed` counts objects: none moved). The editor sees the code changed and offers Reload
   next to it; don't tell them to press it.

**Afterwards**: "5 seconds left, I want to see the end" while paused → `--do moment.set --id timeLeft --v 5` (§3.4), not
a code change. "Start with 90 seconds" → the code's first value (the moment's change is never written anywhere).

#### The paused picture (`codeMoment({ draw })`, three.js)

The paused moment shows the game's own last frame, its light and look included. When the person changes the moment
(moves a thing, sets a value, Next frame, looks around), the editor draws it again **the game's way** when it can: a
three.js game that draws through an `EffectComposer` is drawn with that composer (`render(0)`: no time passes) — found
by itself, nothing to write. When the look comes from something the editor cannot find — a post-processing made by hand
(the scene into a render target, then a full-screen quad), two composers, a HUD scene drawn after the world — the
redrawn moment loses it (the glow, a tint, a grade are gone). Then give the editor the frame's **drawing, without its
update**, once:

```js
import { codeMoment } from './studio-placement.js';
// what the frame draws — and nothing it moves
codeMoment({ draw: () => {
  renderer.setRenderTarget(sceneTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCamera);
} });
```

- **When**: only when asked — the person says the paused picture looks different from the game ("the glow goes when I
  pause", "it turns flat when I move something"). A game with one `EffectComposer` needs nothing.
- `draw()` is exactly what the frame draws and **nothing it updates**: no `dt`, no physics step, no timers, no counters,
  no spawning, no camera move. Its time stays where the game stopped (the person's whole point: the boss at 0:42.3 stays
  at 0:42.3). If the frame already calls a function for its drawing (`drawFrame()`), give that function; a composer's
  `render()` gets `0`. Split the frame into update + draw when they are mixed.
- **The camera is the game's own**: draw with it as the frame does. While the person looks around the paused moment, the
  editor stands that camera where its view is for that one draw and puts it back exactly.
- One call with the values (`codeMoment({ values: {…}, draw })`) or a call of its own: each keeps the other. Change
  nothing else; outside the editor nothing calls it.
- **Check**: the game still runs (§3.3); `--status done --request <id> --changed 0 --note "The paused picture keeps the
  game's look now."`. The person's Reload brings the new code; pausing and moving something keeps the look.

### Checkpoints (`codeMoment` `save` / `load`, `intent: "moment-connect"` / `"moment-save"` / `"moment-load"`)

A paused moment can be **kept**: ⚑ (Make this a checkpoint) in the paused top bar → a name ("Before the boss") → the
editor asks the game for this moment and keeps it in `.studio/checkpoints/<name>.json` — the editor's folder, never the
game (nothing of it is published). Next time ▶ Play ⌄ "⚑ Play from Before the boss" opens the game there: a new page,
and before its **first frame** the editor hands your `load()` that moment, so the first picture is the kept one. The
editor cannot see a game's state (the score, each enemy, the random seed are your JS), and a checkpoint of where things
stand alone would be a lie (another moment's score and enemies) — so without your two functions ⚑ only says "This game
can't start from the middle yet. ✦ Have Claude connect this moment to the game" (the same ✦ as This moment's).

**When**: only when asked — a paused `play` request with `intent: "moment-connect"` (that ✦), `"moment-save"` (a
`save()` that threw: `checkpoint.error`; or an older editor's ✦), or their words ("let me start from the boss", "save
this moment"). `save` / `load` reach deep into the game: never on your own. **Whichever was asked, deliver the values
too** ("This moment" above) when the game has none: one ask connects the whole moment.

1. **`save()` — everything the next frame needs, as plain data** (JSON: numbers, words, lists, objects; no class
   instances, no functions, no DOM, no three.js objects — their numbers instead: `boss.position.toArray()`):
   - **the random seed / generator state** (a seeded `rand()`: its seed; `Math.random()` cannot be saved — say so in your
     note, or move the game to a seeded one if they want the same run every time);
   - **every enemy, bullet, pickup the game made**, with what makes each go on the same: where it is, its velocity,
     health, its timer to the next shot, its state ("diving");
   - **the game's own clocks as durations**: the time left, the seconds since the round began, each cooldown — never a
     `performance.now()` / `Date.now()` timestamp (the page that loads it has another clock: turn "started at t0" into
     "running for 12.4 s" when saving, back into `t0 = now − 12.4` when loading);
   - the player's state (position if the game moves it, velocity, health, power-ups), the score, the wave, flags (`over`).
   - **Not the placed things**: what the person placed (the scene, placement.json) comes from the scene as it is now —
     a gate they moved after keeping the checkpoint must stand where they moved it. Only what the game moves or makes.
   - Add a version: `{ v: 1, … }`.
2. **`load(m)` — put a saved moment back**, called once the game has built its world and asked for its first frame,
   before that frame runs: set the variables, make what the game makes the way the game makes it (your `spawnBoss()`,
   `fire()`), then put each one where `m` says. **Read what each of those functions returns before you use it**: a
   `fire()` that pushes the shot into `shots` and returns nothing is followed by `shots[shots.length - 1]`, not
   `fire().position` (the first real run did that: the person's first checkpoint could not open). It may return a
   promise (a level's files to fetch first).
   - **Old checkpoints keep opening**: read `m.v` and fill what an older version lacks with what a fresh run has
     (`m.shield ?? 0`). A person's checkpoint from before your change must still open after it — when you change what
     `save()` writes, change `load()` to read both. A `load()` that throws makes the editor say "The game changed, so this
     checkpoint can't open" and play from the start (the person's ✦ then sends you `intent: "moment-load"` with the error).
3. **Write it** in the same `codeMoment()` call as the values (or its own call — the hooks and the values are kept
   apart), next to the variables:

   ```js
   codeMoment({
     values: { … },
     save: () => ({ v: 1, seed, score, timeLeft, hp, t,
       boss: boss && { p: boss.position.toArray(), hp: boss.hp },
       shots: shots.map((s) => ({ p: s.position.toArray(), v: s.v })) }),
     load: (m) => {
       ({ seed, score, timeLeft, hp, t } = m);
       if (m.boss) { if (!boss) spawnBoss(); boss.position.fromArray(m.boss.p); boss.hp = m.boss.hp ?? BOSS_HP; }
       for (const s of m.shots) {
         fire();                                             // this game's fire() returns nothing: the new shot is the last
         shots[shots.length - 1].position.fromArray(s.p);
       }
     },
   });
   ```

   Both or neither: a `save` without a `load` cannot start from the middle. Outside the editor nothing calls them.
4. **Check — always, before you report**: `node <skill>/bin/studio.mjs <game folder> --check-moment [seconds]` plays the
   game in a private headless Chrome for that long (default 6 s; choose a time when what the game makes is there: the
   boss, the bullets), calls your `save()`, then opens the game fresh and calls your `load()` before its first frame —
   the editor's way. `studio: moment check ok …` and the two pictures `.studio/shot/moment-kept.png` /
   `moment-opened.png` (look at them: the same moment); `studio: moment check failed: load(m) threw "…" (game.js:212 …)`
   → fix it and run it again until it is ok. Exit 3 = no Chrome here: then say in your note that you could not check.
   Keeping and opening a checkpoint is the person's (⚑, ▶ Play ⌄): don't explain it to them. What they moved or set in
   that paused moment before ⚑ is in the moment your `save()` returns — that is theirs to keep (the field says so).
5. `--status done --request <id> --changed 0 --note "<one line>"` ("Checkpoints keep the score, the time, the boss and its
   shots now."). The editor offers Reload; don't tell them to press it, nor how to keep a checkpoint (⚑ says it).

**A checkpoint that does not open** (`intent: "moment-load"`): read the checkpoint's file (`.studio/checkpoints/<id>.json`,
its `moment`) and `checkpoint.error`; make `load()` read that form (default what it lacks) — do not edit or delete the
person's file. `--status done --changed 0 --note "<one line>"`: the editor shows "⚑ From <name>" next to Reload.

### Motion (`motions`, `motion`)

**When the person asks for a motion** ("make the blue pillar spiral", "make the door swing open when E is pressed",
"take the old motion off, only the spiral"), in this order:

1. **A motion said by places** (from here to there, a door that swings open, a hop, a patrol round these posts) is an
   editor motion of **points**, with `--do motion.make` (§3.4): a Library motion on the timeline, played by the loader.
   Work the points out as offsets from where the object stands, starting at `[0, 0, 0]`. `len` = seconds for one
   round, `repeat` = `loop`, `pingpong` (there and back) or `once`. A turn or a change of size is `keys` with `r` / `s`
   (below).
2. **A motion said by numbers** (a spiral, round and round, a wave, a bob, a circle, a figure eight) **or one that reacts
   to the game** (chases the player, runs away, faster as the score goes up) is a **code motion**: write it once in the
   game's code with `codeMotion()` (below), with **1–3 knobs** — only the numbers the person would say ("bigger",
   "faster": a radius, one turn's seconds, a height) — then put it on the object with `--do motion.code --code spiral
   --name Spiral --key pillar-1`. It is on the timeline under its name (no points: its shape is your code). When the
   person asks for "bigger" / "faster", turn its knob yourself (`--do motion.set --name Spiral --knobs '{"radius":2}'`):
   it changes on screen and stays a formula. Reply in one line, about the game, not the editor's buttons: "The pillar
   spirals now, 1.2 m round, 4 s a turn. Say "wider" or "faster" and I'll change it."
3. **When it starts**: `when` (the game starts — the default for a motion you make —, a key, a click, after another
   motion, walking into an area). One that needs the game — `touch`, a `cue`, words only the code can tell ("when the boss falls") — is still an editor motion:
   give it that `when` and add the one line in the code (`touch('door')`, `cue('boss-down')`, below).
4. **The object already moves** (`--do list` shows its motions): two motions that start with the game play at once
   (their moves add up). When their words say "instead" / "only the spiral" / "the old motion off", take the old one
   off in the same command (`motion.detach`; `all: true` for every one) — one ⌘Z takes back both. Otherwise keep it,
   and say in your line that it still has the old one too ("It still sways as well; say so and I'll take that off").
5. **Only the game's own code when neither can be it**: it follows physics (bounces off walls, is pushed), or the game
   has no loader you can use. Then say so in one line: "This one is in the game's code, so it doesn't show on the
   timeline." Never both on one object: the two fight.
6. Look at it (§3.3: `--shot`; or ▶ Play), then reply: the link first, then one line. Never "press Reload" or "open it
   again": the editor already shows it.
7. **On Save** (a `saved` request): a code motion in `motions` with `knobs` → find its `codeMotion('<code>')`, write
   each knob's `v` where its `was` is (`radius: { v: 2 …` → `v: 3`), and leave the file alone (the editor takes the knob
   out once the code says the same). A `codeMotion()` that no Library motion names any more (deleted, turned into
   points, the AI's add undone) → take it out of the code. A clip with `off: true` is switched off on purpose: leave it.

A spiral on a pillar — the code motion, then the one command (the loader is in the game, §4 Way 1; with a copy from
before code motions, copy `bin/studio-placement.js` in again — older copies have no `codeMotion`):

```js
import { applyPlacement, codeMotion } from './studio-placement.js';
// The pillar's spiral: radius and one turn are its knobs (on Save, write the person's numbers here).
codeMotion('spiral', {
  name: 'Spiral',                                       // in the person's words (their language)
  knobs: {
    radius: { v: 1.2, label: 'Radius', unit: 'm', min: 0.2, max: 6 },
    turn:   { v: 4,   label: 'One turn', unit: 's', min: 0.5, max: 20 },
  },
  round: (k) => 2 * k.turn,                             // one round (two turns, up and back): seconds
  at: (t, k) => {                                       // the offset after t seconds: { p, r, s } like a key's
    const a = (t / k.turn) * 2 * Math.PI, up = 1.5 - 1.5 * Math.cos(a / 2);
    return { p: [k.radius * Math.cos(a) - k.radius, up, k.radius * Math.sin(a)] };
  },
});
// …build the world, then applyPlacement(scene, './placement.json') as before.
```

```sh
node <…>/bin/studio.mjs <game folder> --do motion.code --code spiral --name Spiral --key pillar-1
```

`codeMotion(id, { name, knobs, round, note, game, drag, at })`: `id` = lower case, digits and `-` (the file's `code`).
`knobs`: 1–3, each `{ v, label, unit, min?, max?, step? }` — `label` one noun in the person's words, `unit` one of `m`
`px` `s` `deg` `%` `x` `m/s` `px/s` `''`. `at(t, k, g)` returns offsets added to where the object stands (`p`), to its
angles (`r`: `[x, y, z]`, or one number = a turn round the up axis) and multiplying its size (`s`); a shape depends on
`t` alone. `round` = seconds of one round (a number or `(k) => …`; none = it never ends). `game: true` = it reads the
game (`g.player`, the player's place; `g.dt`; `g.obj`, the object) and is played frame by frame. `note` = 20 characters
for what the knobs cannot say ("follows the player"). It moves only where the timeline puts it (`motion.code`), so a
motion that is not on the timeline does not move in the game either.

The editor has a **timeline** (like Unity's Animation window or Blender's Dope Sheet): the user moves the time line,
moves / turns / resizes an object, and a **key** is set at that moment; the object goes from key to key. A motion
("Open", "Bob", "Hop") is an **asset in the Library** (`motions`, at the top of the file — also with `levels`): one
motion can be on several objects. Each object says **which** motion it uses and **when** it starts and stops:

```json
"motions": [
  { "name": "Bob", "len": 2, "repeat": "pingpong", "keys": { "p": [{ "t": 0, "v": [0, 0, 0] }, { "t": 2, "v": [0, 0.4, 0] }] } },
  { "name": "Hop", "len": 0.6, "keys": { "p": [{ "t": 0, "v": [0, 0, 0] }, { "t": 0.3, "v": [0, 1, 0] }, { "t": 0.6, "v": [0, 0, 0] }] } }
],
"motion": {
  "buoy":  { "clips": [{ "use": "Bob", "when": { "on": "start" } }] },
  "crate": { "clips": [{ "use": "Hop", "when": { "on": "key", "key": "KeyE" }, "until": { "times": 3 } }] },
  "chest": { "clips": [{ "name": "Open", "use": "Hop", "when": { "on": "cue", "cue": "chest-opened" } }] },
  "door":  { "clips": [{ "use": "Hop", "when": { "on": "touch" } }] },
  "gate":  { "clips": [{ "use": "Hop", "when": { "on": "say", "say": "when the player has all three keys" } }] }
}
```

- Every key value is an **offset from the object's place** (its `p` / `r` / `s` in `objects`, or where the code puts
  it): `p` is added to the position (`[x, y, z]` m; 2D `[x, y]` px), `r` is added to the angles (`[x, y, z]` radians,
  y = turning round the up axis; 2D `[angle]`), `s` multiplies the size. A property with no keys is not touched.
- `t` = seconds, `len` = the motion's length. `repeat`: `once` (default: plays, then stays on its last pose), `loop`,
  `pingpong`. `ease` on a key: `ease` (default), `linear`, `step`. The position goes through its keys on a smooth curve.
- **When it starts** (`when.on`) and who makes it happen:

  | `when.on` | Means | Who |
  |---|---|---|
  | `start` | the game (this level) starts | the loader, no code |
  | `time` (`after`: s) | that long after the start | the loader |
  | `key` (`key`: a `KeyboardEvent.code`, `"KeyE"`, `"Space"`) | that key is pressed | the loader |
  | `click` | the object is clicked / tapped | the loader |
  | `after` (`use`, `key?`) | another motion ended (on `key`, else this object) | the loader |
  | `enter` (`area`: `{ p, size }` world, `who?`) | `who` walks into the box | the loader, when it finds `who` by its key — else **you**: `setPlayer(player)` |
  | `touch` | the player touches this object | **you**: `touch('door')` where the game sees the touch |
  | `cue` (`cue`: `"chest-opened"`) | a named moment of the game | **you**: `cue('chest-opened')` where it happens |
  | `say` (`say`: the user's words) | in the user's words | **you**: `playMotion('gate', 'Hop')` at that moment (no words: ask once) |

- **When it stops** (`until`, absent = never): `times` = after that many rounds; `cue` = when that cue comes (you call
  `cue('…')` there too); `then: "reset"` = back to its first pose (default: stays where it is).
- A clip with `name` beside `use` is called by that name (`playMotion('chest', 'Open')`). A file of the timeline's
  first shape (keys inside each clip, `start: true`, `when` as words) is still played; the editor rewrites it.
- **Several ways to start**: `when` may be a list (`[{ "on": "key", "key": "KeyE" }, { "on": "click" }]`) — **any one**
  of them starts it. Wire each one that needs you (a `cue` in the list still needs your `cue('…')`).
- **A scene motion** (`tracks` instead of `keys`: `{ "name": "Arrival", "len": 4, "tracks": { "rowboat": { "p": […] },
  "buoy": { … } } }`) moves several objects together, a cutscene. Each object in it is attached with the same `when`;
  the loader starts **all of them** when any one starts, and `playMotion('rowboat', 'Arrival')` (any of its objects)
  plays the whole scene.
- A position key may have `in` / `out`: the path's handles at that point (its shape, made in the editor; both
  `[0, 0, 0]` = a corner). Leave them as they are; never write them yourself.

**With the loader (Way 1)**:

1. `start` / `time` / `key` / `click` / `after` / `enter` need **no code**: `applyPlacement()` runs them from the game's
   own frames (keys and clicks included) and returns their keys in `report.motion`. Say so in one line ("The crate
   hops when you press E. Press Play to see it."). `report.motionWaits` lists the clips that wait for your code.
2. **The ones that need the game** — add one line where the moment happens:

   ```js
   import { applyPlacement, cue, touch, setPlayer, playMotion } from './studio-placement.js';
   cue('chest-opened');        // when: { on: 'cue' } (and until: { cue })
   touch('door');              // when: { on: 'touch' }: in the collision / overlap code
   setPlayer(player);          // when: { on: 'enter' } whose `who` is not a key the loader can find
   playMotion('gate', 'Hop');  // when: { on: 'say' }: read the words, find that moment
   ```

3. **Motions picked in the Library** (an `ask` with `motions`: "make this crate Hop when the player walks up"): put the
   motion on the object yourself — `--do motion.attach --key crate --name Hop --when …` (§3.4) — with the `when`
   their words say. Code only for a moment the game decides: attach it with that `when` (`"cue:near-crate"`) and add
   the one line (`cue('near-crate')`) where it happens; `playMotion(key, name)` plays any Library motion on any object
   from the code, attached or not. Change motions through `--do`, not by writing `motions` / `motion` in
   placement.json yourself (with the editor open its draft writes over yours; with none open `--do` writes the file).
4. **The code already sets that object's position or angle every frame** (its own update, a physics body, a tween):
   the two would fight. Use the motion in that code instead and take the key out of `motion`:

   ```js
   import { clipOf, clipAt } from './studio-placement.js';
   const open = clipOf('door', 'Open');               // after applyPlacement
   const a = clipAt(open, secondsSinceItStarted);      // { p, r, s, done }: offsets, null for a property without keys
   if (a.r) door.rotation.y = baseAngle + a.r[1];
   ```

   A moving platform the player rides needs its velocity too (move the player with it); a physics body moves with
   `setNextKinematicTranslation` (Rapier) or the engine's kinematic setter, not by setting the mesh.

**Writing it into the code (Way 2)** (the user asks for it, or there is no loader): copy the keys into an array in the
code and interpolate between the two keys around `t` (`ease`: `f = f * f * (3 - 2 * f)`; `step`: hold the earlier
key), adding the result to the object's place every frame, started and stopped where `when` / `until` say; the loader's
`trackAt(keys, t, smooth)` is that maths if you may import it. Then remove the key from `motion`.

Check: ▶ Play in the editor (it plays the saved file and the draft: the game starting, keys, timers, ends) — then do
what `when` says in the game (press E, walk into the area, open the chest) and watch it play. In the editor the user
can try every cue with the timeline's **Try** ▶ buttons.

### Code layouts and keep-out areas (`places`)

**When the person asks for a layout** ("ten street lamps along the left of the road, 6 m apart — I'll change the gap
later", "scatter crystals on the field", "not on the road", "not within 5 m of the player"), in this order:

1. **A layout said by places** ("a gate here", "these three over there") is objects at coordinates: `object.move` /
   `object.duplicate` (§3.4), as always.
2. **A layout said by numbers, spacing or a rule** (N of them, every 6 m, along both sides, in a ring, scattered) is a
   **code layout**: write it once with `codePlace()` (below), with **1–3 knobs** (only the numbers the person would say:
   a gap, a count, a radius, the distance from the road) and **a knob for each way the person is likely to drag one
   object** — along the row, away from it (the distance from the road), its height — named per way in `drag`
   (`drag: { along: 'gap', side: 'side', up: 'height' }`; a way with no knob still moves the whole rule when dragged —
   the editor keeps it as an **offset**, `places[id].offsets`, step 5). Things on both sides of a road go in **one**
   `codePlace` (`(i % 2 ? 1 : -1) * k.side`): when the person drags one lamp away from the road, both sides leave it.
   Then show it with `--do place.code --id lamp-row`. Its objects are named `lamp-row-1`,
   `lamp-row-2` … and the editor lists them under the layout's name. When the person asks for "closer" / "two more",
   turn the knob yourself (`--do place.set --id lamp-row --knobs '{"gap":4}'`): the row changes on screen and stays a
   formula. Reply in one line, about the game, not the editor's buttons: "Ten street lamps, 6 m apart on the left of the
   road. Say "closer" or "more" and I'll change it." Don't explain Save, knobs or what a drag does: the editor says that
   itself (a drag of one object turns the knobs or shifts the whole rule, and ⌥ moves just that one). "Move them all 1 m
   further from the road" with no knob for it: `--do place.set --id lamp-row --offsets '[{"way":"side","how":"same","v":1}]'`
   (the same as the person's drag; or add the knob, step 8).
3. **Where not to put them**, said as a rule ("not on the road", "not near the player") → write a `codeAvoid()` and add
   it with `--do place.avoid --id crystals --code near-player`; said as a place ("not around here") → `--do place.avoid
   --id crystals --box '{"p":[x,y,z],"size":[w,h,d]}'`. A keep-out area belongs to that one layout (another layout
   avoids it only when it is added there too), and never moves an object put by hand. An `ask` with `intent: "avoid"`
   (the card's **✦ Describe with text** under Keep-out areas) names the layout in `places` (`id`, its `avoid` now): the
   words are a keep-out area for THAT layout — write the `codeAvoid()` (a knob for the number they said; a `show` shape
   when it is one: `{ circle: { p, r } }`, `{ box: { p, size } }`, `{ poly: [[x, z], …] }`, so the editor puts a ◇ on it)
   and add it with `--do place.avoid` yourself; say in one line what you added. Never hand the person steps.
4. **Write new layouts this way from the start.** A game that places them in a loop of its own shows each object as a
   hand-placed one (the person moves one at a time, the loop is lost); rewrite that loop as a `codePlace` when they ask
   to change the layout as a whole ("closer together", "keep the formula").
5. **On Save** (a `saved` request) — **the code is the truth** (studio-writeback, 2026-10-24: "Is what the code says then
   hard-coded again by the JSON? The code has to be the truth"): `placement.json` only holds a layout's changes until
   you write them. Per layout in `places`, write **every** part into the game's code, then fold it out of the file. Read
   `--do list` first (`places[]`: `knobs`, `offsets`, `pins`, `avoid`, and `objects` — each object's `line` / `rank` /
   `offset`, what the offsets add now; never count ranks yourself).
   - `knobs` → each `v` where its `was` is, in that `codePlace` / `codeAvoid` (`gap: { v: 6 …` → `v: 4`). A knob leaves
     the file by itself once the code says its number.
   - `offsets` (the person's drags kept as a rule, `{ way, how, v, odd?, seed? }` over at()'s place) → into `at()`.
     `way`: along / side (a row's: along it, or away from the middle line of its two rows, so both sides of a road leave
     it — `objects[].line` says the row) / up / turn (°, mirrored on the second row: `(line ? -1 : 1) * 15`) / size (× a
     factor) / move (the ground `[x, z]`, a layout that is not a row). `how`: **same** (every object `v`) → the number for
     that way in `p`, e.g. the distance from the road `5.6` → `6.6` (the row stays a straight row); **zigzag** (the
     objects whose **rank** is odd when `odd`, else the even), **ramp** (`v × rank`; size `1 + (v − 1) * rank`) and
     **jitter** (`v × jitter(seed, i)`, `import { jitter } from './studio-placement.js'`: the same numbers the person saw;
     a move's z: `jitter(seed, i, 1)`) → **`by`** in at()'s answer, not `p`: `{ p: [side * k.side, 0, z], by: [side *
     (rank % 2 === 1 ? 1.5 : 0), 0, 0] }` — `p` stays the row's own place, so the editor still sees a row (its sideways,
     zigzag and ramp keep working after Save); turn and size into `r` / `s`. The rank is the object's place in its own
     row (`objects`; for `(i % 2 ? 1 : -1)` sides it is `Math.floor(i / 2)`). A number the person may turn again → a knob
     with that name in the game's words ("From the road", "Zigzag width", "Fan"; at most 3), named in `drag` for that way.
   - `pins` (one placed by hand) → **an exception of the rule** by its number (`lamp-row-5` is `i === 4`): at() answers
     `{ p: [-7.6, 0, -23], hand: true }` (and its `r` / `s`, if the pin has them) before the formula — `hand: true` keeps
     the keep-out areas and the row's offsets off it, as the pin did. **Its own object** in the code instead (a mark of
     its own, §5, at that place; the rule's count one less) only when it is plainly not one of the rule's any more (the
     person took it somewhere else entirely) and it is the rule's last number (no other key changes). `hand: true` on the
     entry (Convert to coordinates) → at() reads a list of the pins' places (`const SPOTS = [[x, y, z], …]; at: (i) =>
     ({ p: SPOTS[i], hand: true })`, the count its length).
   - `avoid` → a box drawn by hand becomes a `codeAvoid()` of that layout (`p` = the middle of its bottom, `size` = [w,
     h, d]: `test: (q) => Math.abs(q[0] - p[0]) <= w / 2 && q[1] >= p[1] && q[1] <= p[1] + h && Math.abs(q[2] - p[2]) <= d
     / 2`, `show: { box: { p, size } }` so the editor still paints it), named in the codePlace's `avoid`; a condition
     with `off: true` → out of the codePlace's `avoid`; a condition's knobs → its `v` in the codeAvoid.
   - `from` → take those hand-placed objects out of the code (the layout is in their place).
   Then one `--do` for all of them, one op per layout (`"level"` for a level's): `--do
   '[{"do":"place.code","id":"lamp-row","fold":"all"}]'` (or only the parts you wrote: `"fold":"offsets,pins"`). The
   editor reads the game again, takes them out of the file — no ⌘Z, no Save count — and measures every object against
   where it stood: `the look is the same`, or `the farthest off is lamp-row-3, 0.4 m (it stood at […], now […])` / `…
   is gone`: then your code is not what the file did — fix it and send `place.code --id lamp-row` (no `fold`: it
   measures against the same before) until the look is the same. Never `place.set --offsets []` / `--unpin` / `--hand
   false` for this: those are changes of the person's (Save counts them, and they move the rule until your code is
   read). No editor open: the same `fold` takes them out of `placement.json` (nothing to measure: look at the game,
   §3.3). The `done` note is one line in the game's words ("Wrote the lamps' new spacing into the game"); don't explain
   folding.
6. **No loader, or bodies that place themselves** (a physics engine owns the positions): keep the layout in the game's
   code and say in one line: "This layout is in the game's code, so the editor shows each object on its own."
7. **"Turn these into a rule"** (hand-placed objects → a code layout; a motion of points → a code motion): "Turn into a
   rule" below.
8. **✦ Write into the rule** (an `ask` with `intent: "to-knob"`; it was "Make this way a knob"): the person dragged a
   rule's object a way its rule had no knob for — the editor kept it as an offset — and wants it in the rule as a number
   of its own. `places[0]` is the layout with `way`, its `offsets` and each object's `line` / `rank` / `offset`; their
   words may name it ("as the distance from the road"). Add that knob to the `codePlace` (its number = the code's + that
   way's offset: 5.6 + 1.0 → "From the road 6.6 m"; a zigzag, ramp or jitter row is its own knob: "Zigzag width", "Fan",
   "Wobble") and name it in `drag` for that way (at most 3 knobs: take out the one least likely to be changed, or say in
   one line which one you dropped), then `--do place.code --id lamp-row --fold side` — that way only, the person's other
   changes stay in the file. The editor's line ends with its measure (the same look, or the farthest off: fix it as in
   step 5) and the knob lights on the card. Reply in one line in the game's words ("The lamps' distance from the road is
   part of the rule now (6.6 m)"). Never a `place.set --pin` for it: that takes the object out of its rule.

A row and a scatter, and two keep-out conditions (the loader is in the game, §4 Way 1; refresh an older copy):

```js
import { applyPlacement, codePlace, codeAvoid } from './studio-placement.js';
// Street lamps on both sides of the road: Count, Gap and From the road are its knobs (on Save, write the person's
// numbers here). A knob for each way a person drags one lamp: along the road turns the Gap, away from it From the road.
codePlace('lamp-row', {
  name: 'Street lamps',
  knobs: { n: { v: 10, label: 'Count', unit: '', min: 2, max: 30, step: 1 }, gap: { v: 6, label: 'Gap', unit: 'm', min: 2, max: 20 },
    side: { v: 4.5, label: 'From the road', unit: 'm', min: 1, max: 15 } },
  count: (k) => k.n,
  make: (i) => makeLamp(),                                        // number i's object; the loader names it lamp-row-<i+1>
  at: (i, k) => ({ p: [(i % 2 ? 1 : -1) * k.side, 0, -8 - Math.floor(i / 2) * k.gap] }), // { p, r?, s? }, the scene's space
  drag: { along: 'gap', side: 'side' },                            // along the road: Gap; away from it: From the road
});
// Crystals scattered on the field, never on the road nor near the player (rand: the same places every load).
codePlace('crystals', {
  name: 'Crystals',
  knobs: { n: { v: 12, label: 'Count', unit: '', min: 1, max: 60, step: 1 } },
  count: (k) => k.n,
  make: () => makeCrystal(),
  at: (i, k, g) => ({ p: [g.rand() * 40 - 20, 0, -g.rand() * 60], r: g.rand() * 6.28 }),
  avoid: ['road'],                                                 // on from the start (the person can switch it off)
});
codeAvoid('road', { name: 'On the road', test: (p) => Math.abs(p[0]) < 3.5 });
codeAvoid('near-player', {
  name: 'From the player', after: 'within',                        // the list says: From the player [5 m] within
  knobs: { r: { v: 5, label: 'Distance', unit: 'm', min: 1, max: 20 } },
  test: (p, k, g) => !!g.player && Math.hypot(p[0] - g.player[0], p[2] - g.player[2]) < k.r,
});
// …build the world, then: const report = await applyPlacement(scene, './placement.json'); report.places.crystals.keys
```

```sh
node <…>/bin/studio.mjs <game folder> --do '[{"do":"place.code","id":"crystals"},{"do":"place.avoid","id":"crystals","code":"near-player"}]'
```

- `codePlace(id, { name, knobs, count, make, at, drag, avoid })`: put in by `applyPlacement()` after the world is built,
  before the file's `objects` — with or without a `placement.json`. `drag`: the knob each way a drag of one object turns
  — `'gap'` (moving it), or `{ along, side, up, turn, size }` (Move along the row / away from it, Height, Turn, Size);
  the editor looks for the numbers that bring the object to the finger. A way without a knob moves every object of the
  rule (the editor's offset, `places[id].offsets`; only ⌥ moves one object by hand, as a pin). `make(i)` returns a new object (three.js: an
  Object3D; PixiJS: a display object); the loader names it `<id>-<i+1>` and adds it to the root you pass to
  `applyPlacement`. `at(i, k, g)`: `p` in the root's space (3D `[x, y, z]`, 2D `[x, y]` px), `r` (3D `[x, y, z]` or one
  number = the turn round the up axis; 2D the angle), `s`, `by` (a shift added after the editor reads the row from `p`:
  the person's zigzag / ramp / jitter written in on Save), `hand: true` (one the person placed by hand, written in on
  Save: keep-out areas and a row's offsets leave it where it is); `g.rand()` = a random number that is the same every
  load for the same id, number and try; `g.try` = how many places a keep-out area refused; `g.level` = the level being
  built. `jitter(seed, i, axis?)` (exported by the loader) = the editor's jitter number (−1 … 1).
  `count` at most 200. Physics bodies: make them after `applyPlacement`, from `report.places[id].keys`.
- `codeAvoid(id, { name, after, knobs, test, show })`: `test(p, k, g)` true = nothing goes at `p`; `g.player` = where
  the player is when the level starts (`setPlayer(player)` before `applyPlacement`, or an object keyed `player`, or
  `applyPlacement(scene, url, { player: [x, y, z] })`). A place refused is tried again (`g.try` + 1, up to 30 times); a
  layout that gives the same place again (a row) leaves that one out (`report.places[id].skipped`).
- In `placement.json` (each level its own, like `objects`):

  ```json
  "places": {
    "lamp-row": { "knobs": { "gap": { "v": 4, "was": 6 } }, "pins": { "lamp-row-3": { "p": [-3.1, 0, -19] } } },
    "crystals": { "avoid": [ { "name": "Box 1", "box": { "p": [-8.6, 0, -17], "size": [3.2, 2, 5] } },
                             { "code": "road", "off": true },
                             { "code": "near-player", "knobs": { "r": { "v": 6, "was": 5 } } } ] },
    "lamps": { "from": ["lamp-1", "lamp-2", "lamp-3"] },
    "street": { "offsets": [ { "way": "side", "how": "same", "v": 1 }, { "way": "side", "how": "zigzag", "v": 1.5, "odd": true },
                             { "way": "turn", "how": "jitter", "v": 10, "seed": 4242 } ] }
  }
  ```

  Only what the person changed since your code: `knobs` (`v` now, `was` = your number), `pins` (just that one by hand),
  `hand: true` (all by hand), `avoid` (in order: a box drawn by hand — `p` = the middle of its bottom, `size` = [w, h,
  d] —, or one of your conditions with its knobs; `off: true` = switched off), `from` (hand-placed objects it
  replaced), `offsets` (≤ 8: the rule shifted by the person's drags; `jitter` with its `seed` — step 5). Until Save:
  on Save you write them into the code and fold them out (step 5). Change them through `--do place.*`, never by hand
  while the editor is open.

### Turn into a rule (`intent: "to-code"`)

The person picked hand-placed objects (or a motion made of points) and pressed **✦ Turn into a rule**: an `ask` with
`intent: "to-code"` and their words (often just "Turn into a close rule"; "6 m apart" when they know) — `objects` with
where each stands now (`pose.p`), or `motions` with the points (`keys.p`, offsets from where the object stands). Or they
said it in your window ("turn the street lamps into a rule"): find them with `--do list` (each object's `p`, a motion's
`keys.p`). They want the same look as **a formula they can tune** (its knobs) instead of loose coordinates. Do it
yourself, in this order — never answer with steps for them:

1. **Pick the shape a person would name** and fit its knobs. Places: a row (a straight line, an even gap), a grid, a
   circle, a scatter. A motion: a wave (there and back), a bob (up and down), a circle, a spiral. 1–3 knobs, rounded to
   what a person would say (6 m, not 5.97 m); the row's start and direction from the points themselves (least squares).
2. **Too far: don't swap.** Work out the largest gap first — each object against the rule's object of the same number;
   a motion at 64 places of one round. Over **half the object's size** (its largest side: a 4 m lamp → 2 m), or for a
   motion over **a tenth of its path's size**, leave it as it is, write no rule, and say **one line** with the number and
   one other shape — not a list of every shape you tried: "The closest row is still 2.1 m off at the 4th lamp, so I left
   them placed by hand. Shall I scatter them instead?"
3. **Write the rule and swap it in**, one `--do`. Places: `codePlace('lamp-row', …)` (Code layouts above), then `--do
   place.code --id lamp-row --replace '["lamp-1","lamp-2",…]'` — the keys in the rule's own order (number 1 takes the
   first key's place); an id of its own (`lamp-row`, not `lamp`), so the rule's objects (`lamp-row-1` …) are never
   mistaken for the hand ones. A motion: `codeMotion('ship-wave', …)` (Motion above), then `--do motion.code --code
   ship-wave --name "<the motion's name>" --replace` — the same name, the same objects and "when", now the rule.
4. **One line, in their language, with the editor's number.** The `studio: did …` line ends with `the editor measured how
   close it is: the largest gap is lamp-3 ↔ lamp-row-3, 0.62 m …` (a motion: `… 0.12 m at 0.8 s of a 2 s round`).
   Quote that, not your own estimate. The link first (§3), then this one line in the words they asked in (a request in
   Japanese gets its line in Japanese), and nothing after it — no lists of what changed, what is left for Save or what
   you checked: "Turned the 6 street lamps into a row 6 m apart. The farthest off is the 3rd lamp, 0.6 m." The editor
   shows the original beside the rule (orange dots, "Max deviation") until Save, ⌘Z puts the hand's shape back, and Save
   is yours to tidy up after: don't explain any of them.
5. **On Save**: `from` → take those hand-placed objects out of the code, then `place.code --id lamp-row --fold from`
   (Code layouts, step 5). A motion needs nothing more: the file has `{ "name", "code" }` in place of its points now.

### Levels (`levels`)

A game with **several levels** (stages, worlds, rooms built one at a time) can show them all in the editor: the list's
head becomes the level's name, and the user switches between levels, copies one into a new level, renames, reorders
and deletes them. The editor only learns about levels from the game, with one call:

```js
const LEVELS = [{ id: 'meadow', label: 'Meadow' }, { id: 'cave', label: 'Cave' }]; // the code's levels, in order
const pick = window.studio?.levels?.(LEVELS);       // in the editor: { id, build }; anywhere else: null
const level = pick?.id ?? 'meadow';                 // the game's own choice when it is null
buildLevel(pick?.build ?? level);                   // build: a level the code has (a copy is built from its original)
await applyPlacement(scene, './placement.json', { level });
```

**Offer it** when the game has levels and the user asks about them ("let me edit level 2", "add a stage like this
one"), or once when you first open the editor on such a game. Add those lines where the game picks its level at start
(ids: letters, digits, `-`, `_`). A game whose levels are separate pages can call it on each page with the same list.
Don't add it to a game with one level: nothing would change.

`placement.json` then holds one entry per level, in the user's order; the top `objects` is `{}`:

```json
"levels": [
  { "id": "meadow", "label": "Meadow", "objects": { "rock-1": { "p": [2, 0, 1], "was": { "p": [0, 0, 1] } } } },
  { "id": "cave-2", "label": "Crystal Hall", "from": "cave", "added": [ … ] },
  { "id": "cave", "label": "Cave" },
  { "id": "summit", "label": "Top", "labelWas": "Summit" }
],
"levelsWas": ["meadow", "cave", "summit"]
```

- Each level's `objects` / `added` / `removed` / `order` / `motion` mean exactly what they mean at the top of a
  one-level file (above); apply them to **that level's** code (Way 1 or Way 2, per level). A level's `motion` moves
  that level's objects only (the top has no `motion` then).
- `from`: a level the user made in the editor. Add it to the code as a copy of level `from`, with this `id` and
  `label`, then apply its entries. Until you do, the editor and the loader build `from` and lay this level's entries
  over it. A level made with **New level** (a blank one) is written the same way, with `"blank": true`: `from` plus a
  `removed` list of every object the user saw go (the ground, sky and lights stay). Build it as a level of its own
  with only what is left — and none of what the game's code spawns or moves in `from` (obstacles, pickups, road
  pieces) — not as a copy that hides things. Remove `blank` with `from` when applied.
- `labelWas`: the user renamed the level. Change the name in the code from `labelWas` to `label`; keep the `id`.
- `levelsWas` (only when something differs): the code's order. Reorder the code's levels to the order of `levels`. An
  id in `levelsWas` that is not in `levels` was **deleted**: ask once before you delete a level's code ("Delete the
  Summit level from the code?"), since it cannot be seen again in the editor.
- `levelsWas: []`: the game had **no levels** in its code, and the user made Level 2 in the editor ("Level 1 ⌄ →
  New level" or "Duplicate"). The level without `from` (usually `level-1`) is the game as it is now. Give the game levels: add the
  `studio.levels(…)` lines above with every level of `levels` (ids and labels as written), build the game as it is for
  the first one, add each `from` level as a copy of it, pass `{ level }` to `applyPlacement`, and copy this skill's
  `bin/studio-placement.js` into the game again (an older copy reads such a file only with `{ level }`). Then apply
  each level's entries and remove `levelsWas`. Until you do, the loader applies the first level when it is called
  without `{ level }` (the shipped game keeps its layout), and the editor shows each level over the game as it is.
- When applied, remove `from`, `labelWas` and `levelsWas`, and the applied entries (as above). A file whose levels are
  all empty may be deleted.

With the loader, `applyPlacement(…, { level })` applies only that level; without `{ level }` it moves nothing in the
world (it warns), so a level's layout never lands on another level — except a file with `levelsWas: []` (above).

**The editor's two kinds of buttons.** In the editor a plain button acts at once and never writes in the chat box;
only a ✦ row ("Ask AI to …", violet) puts an editable request there, and nothing reaches you until the user sends it.
So a request from the editor is always one the user chose to send. What the user did with plain buttons (moves,
copies, renames, levels) reaches you only through `placement.json` on Save.

### Godot

Use **Way 2** on the Godot project, not on the web export: the values live in the scene files (`.tscn`) as
`position = Vector2(…)`, `rotation = …`, `scale = Vector2(…)` on the node whose name or `studio_key` metadata matches
the key. Change them there (or in the script that sets them), then export for Web again yourself when the project has an
export preset (`godot --headless --path <project> --export-release "<the Web preset's name>" <export folder>/index.html`);
only without a preset (or without Godot on this computer), say in one line what to export. Editing the exported `.pck`
does nothing useful.

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
`A–Z a–z 0–9 _ : # . - /`, up to 80 characters. If the user already saved with `path:` keys, add the marks and move
those entries in `placement.json` to the new keys yourself (`objects`, `motion`, `added` / `removed` / `order`, `names`);
with the editor open, run `--do editor.reload --editor` right after, so it reads the file with the new keys (§3.4).
Never ask the person to save again for it.

- Put the mark on the **top object the user should move** (the group or container, not each child).
- To keep something out of the editor (UI layers, helpers, the ground): three.js `userData.studio = false`, PixiJS
  `obj.studio = false`; in your own adapter simply do not list it.
- To tell the library exactly which file a 3D object comes from, set `userData.studioAsset = 'assets/tree.glb'`
  (PixiJS `obj.studioAsset`; your adapter's `assetsOf()`). Without it, models are matched by load order and shown as a
  guess.

### The UI's marks (`data-studio-key` on HTML)

(A UI the game **draws in a canvas** has no element to mark: it is named in the code with `codeUi()` instead — "UI
drawn in the canvas", §4.)


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

**Screens and values** (the UI list's screen menu, the card's sample values):

```html
<div data-studio-screen="title">…the title card, the Start button…</div>
<div data-studio-screen="play" hidden>…the hint, the Pause button…</div>
<div class="overlay" data-studio-screen="over" hidden>…</div>
<div class="score" data-studio-key="score"><span data-studio-text>Score</span> <b id="score" data-studio-value data-studio-sample="999,999">0</b></div>
```

- `data-studio-screen="<id>"` on the container of each screen (`title`, `play`, `pause`, `over`, or a name of the
  game's own; `data-studio-screen-label="Shop"` for the words). UI outside every container is "always on screen". The
  editor shows one screen at a time while editing (it takes `hidden` off it and hides the others) and puts them back
  for Play: the game's code is not run for it. A screen hidden with `hidden` but given `display: flex|grid` by a class
  needs `[data-studio-screen][hidden] { display: none; }` in the CSS, or it shows in the game too.
- `data-studio-value` on what the game writes (a score, a timer, a name): the card's sample values go there, and the
  Text row leaves it alone. `data-studio-sample="999,999"` = the first sample to offer. `data-studio-text` = the words
  the Text row changes when the element has more than one text.
- Colours and fonts: when the game's UI repeats the same colour in many rules, offer once to gather them into CSS
  variables on `:root` (`--accent: #ffcf6e`): the editor's Theme then changes them all at once.

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
`library.json` until the user places them. Its 3D models are light (about 5,000 triangles, a few MB); AI-made 3D
models from elsewhere are often 20–50 MB.

When an asset the user wants does not exist yet, they can drop a file into `assets/` (it shows up in the library on
the next open). Connecting KUMODeck (§7) adds AI-made 3D models; mention it once if it fits, never push it.

## 7. Connect KUMODeck (only when the user wants it)

Everything above works without an account. KUMODeck is an optional service for what a local editor cannot do:

- **Publish** the game to a private test URL, then to everyone.
- **Online multiplayer**: rooms, quick match, and invite links or QR codes.
- **Save data and leaderboards**: each player's saves, and the game's own server functions and database.
- **AI 3D models**: make a 3D model from a prompt and finish it in Blender, then drop it into the library.
  When you make one with KUMODeck's 3D tools, also ask for a game-sized model: `faceLimit` about 5000 (raise it
  only when the user says they need more detail).

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

Two files, both read when the editor page loads (reload it yourself after you change them: `--do editor.reload
--editor`, §3.4):

| File | For | Code? |
|---|---|---|
| `.studio/studio.json` | Grid and angle snap, an area objects must stay in, rules per kind of object (hide, lock, keep height, no turning, size range, default size) | No, plain settings |
| `.studio/tools.js` | Rules that need code (`constrain`: "stay on the road", "stack on the crate below") and **game tools**: new buttons that do something specific to this game | Yes, runs in the game page |

Steps:

1. Ask what the user wants in their words; read the game code to learn its units (metres, tiles of 32 px…), which
   objects are which (names, groups) and where the playable area is.
2. Prefer `studio.json`. Write `tools.js` only for what settings cannot express.
3. Use the game's own numbers: grid = the tile size the code uses; bounds = the arena the code uses.
4. Reload the editor yourself (`--do editor.reload --editor`); check that moving now snaps / stays inside (`--do
   object.move` there and `--do list`, or tell them in one line what now snaps). Rules apply to the handles, keys and
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
reload the editor yourself (`--do editor.reload --editor`, §3.4), adjust. **If something goes wrong:** open the editor with `&ui=off` added to its URL
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
| The page says the passcode is wrong, or "Missing pass" | An old URL, or one without its `?t=` (copied from a tab, or written by hand) | Run `--link` and paste its line |
| `studio: listen EPERM … your AI’s sandbox is blocking the editor’s local server` | The agent's sandbox does not let commands listen, even on `127.0.0.1` (Codex's default `workspace-write` sandbox does this) | Run the start line again outside the sandbox: if your environment can ask the user to approve a command outside the sandbox, ask for this one. Otherwise tell the user in one line: "Your AI's sandbox blocks the editor's local server. Start Codex with `codex -c sandbox_workspace_write.network_access=true` (this also lets its commands reach the internet), or allow full access, and ask again." The sample is already copied; the same start line opens it |
| The page is blank or "can't connect" a little after you gave the URL | The editor was started with `&` / `nohup` and ended with your turn | Start it with `--detach` (§3); it prints the URL again |
| You need to stop the editor | — | `studio.mjs <game folder> --stop`. Never `pkill` / `killall` / a `pgrep` match: they stop other editors too |
| The phone cannot open the page | Not on the same Wi-Fi, or started without `--lan` | Restart with `--lan` and scan the QR code |
| The editor looks broken after a UI change | A mistake in `.studio/ui/studio.css` or `shell.js` | Open the editor URL with `&ui=off`, fix or delete `.studio/ui/` (§9) |
| Snapping or a game tool does not appear | `.studio/studio.json` is not valid JSON, or `tools.js` threw | Check the browser console of the editor page; `studio.json` errors are logged there (§8) |
