# KUMODeck Game Studio — Contract

Contract version: **1** (`CONTRACT_VERSION` in `src/contract.ts`).

This file is the prose half of the contract; `src/contract.ts` holds the
same promises as TypeScript types and constants. Every part of the studio is
built against these two files. If you need to change a promise, talk to the
integrator first, then change both files in one commit.

```
┌──────────── shell page (src/shell) ─────────────┐
│ tool switch [Placement | Library] · list · undo │
│ redo · save · next steps        uses StudioHost │──── Promise 3 ──── host (local server / cloud)
│         ▲  postMessage  studio:<tool>/<verb>    │
│         ▼                     Promise 2         │
│ ┌─ iframe: the game, code unchanged ──────────┐ │
│ │ studio-edit.js (src/bridge + src/core)       │ │
│ │   input, handles, self-check                 │ │
│ │   ── Promise 1: the port ──                  │ │
│ │   built-in three.js adapter                  │ │
│ │   or .studio/adapter.js (Port2D, AI-written) │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
results: placement.json / library.json (Promise 4) → read by the user's AI
```

Principles that shape every promise:

- **The editor never edits game code.** It writes result files; the user's
  AI agent reads them and changes the code. The only file the studio creates
  in the game folder besides results is a new asset added from the library
  (never an overwrite) and studio notes under `.studio/`.
- **The editor depends on no game library.** It talks to one fixed port.
  three.js support ships built in; every other engine gets a small adapter
  that the user's AI writes for that game from the shipped examples.
- **Nothing leaves the machine** in local mode. No account, no network.

---

## 1. The port (game page)

### 1.1 Two levels

| Port | Who writes it | Size | Used for |
|---|---|---|---|
| `Port2D` | The user's AI, per game (PixiJS, Phaser, plain canvas, home-made engines), starting from example adapters | ~1 page | All 2D games |
| `StudioAdapter` | Built in for three.js (`src/adapters/three/`; `index.ts` fits its NDC-based core to this port); advanced users for other 3D engines | Large | What the bridge drives |

`adapterFromPort2D()` (`src/core/port2d.ts`) turns a `Port2D` into a full
`StudioAdapter`: picking with a finger radius, keeping the finger offset while
dragging, rotating, scaling, the 2D edit view (pan/zoom/frame/focus) and
thumbnails cropped from the canvas. A 2D adapter therefore only needs direct
engine calls:

| Port2D method | Meaning |
|---|---|
| `objects()` | Movable objects `{ key, label?, kinds?, group?, unstable?, rotatable?, scalable? }`. Leave out UI layers, particles, backgrounds. |
| `get(key)` / `set(key, pose)` | Read/write the pose in the object's parent space. |
| `parentToScreen(key)` | `[a, b, c, d, e, f]` mapping the parent's space to viewport CSS px (`x' = a·x + c·y + e`, `y' = b·x + d·y + f`), including canvas position and CSS scaling. |
| `bounds(key)` | Object rectangle in viewport CSS px. |
| `render()` | Draw one frame now. |
| `setView?({x, y, zoom})` | Optional edit camera: shift by (x, y) px and zoom around the canvas centre **without changing any object pose**. Called with `{0, 0, 1}` to restore. |
| `pause?()` / `resume?()` | Only for clocks not driven by `requestAnimationFrame`. |
| `capture?(key, size)` | Optional thumbnail; default crops `bounds()` from the canvas. |
| `silhouette?(keys)` | Optional: the objects' shape on screen, `{ x, y, w, h, mask }` (viewport CSS px; `mask` a canvas whose alpha is their coverage), for the outline round the selection. Without it the outline is a rounded box. The Pixi example draws the objects alone on black and on white through the edit view. |
| `assetsOf?(key)` | Optional: URLs (or `AssetRef`) of files the object uses. |
| `player?()` | Optional, 3D: where the player's own camera stands (`eye`) and looks (`target`, 10 units ahead) during ▶ Play, and optionally `near` (keys nearest the player, world distances, where in the picture). Sent with a request made while playing (§3.5). Built in for three.js. |
| `canvas?()` | Optional: the canvas the game draws into (default: the largest). |
| `order?(key)` / `setOrder?(key, index)` | Optional draw order (layers): `{ parent, index }` = the list the object is drawn in (`stage`, a container's key…) and its place there, 0 = back, every child counted; `setOrder` removes it and inserts it at `index`. Both or neither (§1.7). |

The full `StudioAdapter` is documented field by field in `src/contract.ts`.
Key points:

- Screen coordinates are **viewport CSS px** (like `PointerEvent.clientX/Y`),
  never NDC: only the adapter knows which canvas is used and how it is scaled.
- `rotate(key, d)`: `d` is measured as the finger circles on screen, clockwise
  positive. 2D adds it to the angle; 3D turns the object so it follows the
  finger as seen by the edit camera.
- `capture()` must not run the game's per-object render hooks (they can move
  or hide objects).
- `silhouette?(keys)` (optional, three.js built in): the same shape as the
  `Port2D` method. It may draw extra frames but must leave the normal frame
  on screen when it returns; the bridge calls it only when the selection or
  the view changed (at most every 40 ms).
- `begin()` must not change poses; `end()` restores the game's camera/view.
  `begin({ moment: true })` (pause-edit fix 1, 2026-10-28): the editor wakes over a paused moment of ▶ Play
  (§3.5.1) — what the adapter hides of the game's own page while editing (three.js: the HTML next to the canvas)
  stays seen, taking no pointer. An adapter that hides nothing ignores it.

**The UI seat (UI stage 1, 2026-10-19).** Next to the one world adapter the
bridge may hold one adapter for the game's **UI** — what is drawn over the
world: a title card, a score, buttons. The editor edits one of the two at a
time (the shell's World | UI switch, `core/layer`); input, handles and undo
are the same. A UI adapter is any `Port2D` through `adapterFromPort2D()`,
with `p` = **CSS px offsets on screen** and no turning (`rotatable: false`):

| UI seat | Who writes it | Answers when |
|---|---|---|
| `studio.registerUI(port)` | The AI, per game (later stages: a Phaser HUD scene, a Pixi UI container, a three.js orthographic HUD) | Asked first; the first that answers wins |
| DOM UI (`src/adapters/ui/`, built in) | — | The page has an element marked `data-studio-key` that the world does not already list |
| UI drawn in the canvas (`codeUi()`, §1.13; `src/bridge/code-ui.ts`, built in) | The AI, in the game's code (the loader's `codeUi`) | The page registered a `codeUi` that no HTML element's key already names |

**One list** (studio-canvas-ui, 2026-10-24): the DOM UI and the `codeUi`s are one UI seat — one `Port2D`
(`mergeUiPorts`), listed top of the screen first (then left first); each key goes to the port that lists it. A
`codeUi` id that an element's `data-studio-key` also uses is not listed (the HTML one is; said once in the console and
to the AI's `ui.code`). A game with HTML UI only keeps its page order and everything as before.

The DOM UI adapter lists only elements marked `data-studio-key="title-logo"`
(never "every element"); leaves out `data-studio="false"` (on it or a parent),
elements not drawn, and elements whose inline `translate` / `scale` the game
writes itself. It moves and sizes them with the CSS **`translate` / `scale`
properties only** — never `left`, `top` or `transform` — added to any
translate / scale the game's stylesheet gives; a size keeps the element's
middle where it is (the correction is worked out from the box at the time,
never saved). The maths is the loader's `placeUi()`, shared with the game.
A game whose world IS the DOM (a port named `dom`, `examples/dom-board`) gets
no UI adapter: its pieces carry `data-studio-key` as world objects.

**A game with no `data-studio-key` (and no `registerUI`, no `codeUi`) has no UI seat**: no
`layers` in `core/ready`, no switch, no `ui` in `placement.json` — the editor
and the saved bytes are exactly what they were before UI stage 1.

### 1.2 Poses

One shape everywhere (messages, undo, files): `{ p, r?, s? }` in the
object's **parent** space.

- 3D: `p = [x, y, z]` metres, `r` = `rotation.y` radians in (-π, π], `s` = uniform scale.
- 2D: `p = [x, y]` px, `r` = radians clockwise (Pixi's `rotation` sign), `s` = scale,
  `z` = optional draw order (§1.7).
- `s` may be three numbers for objects the game scaled non-uniformly; the editor only multiplies.

### 1.3 Keys

Order of preference (first that exists):

1. Author marker: three `userData.studioKey` / 2D `obj.studioKey`. Most stable:
   a deliberate marker means "this is the thing I want to move".
2. Name: three `object.name` / Pixi v8 `obj.label`. Duplicates get `#2`, `#3`
   in traversal order.
3. `userData.id` / `userData.name`.
4. Tree path `path:0/3/1` — **unstable** (`unstable: true`): it changes when the
   code changes. Shown with a warning; saving still works, and the skill tells
   the AI to add a name and save again. Such an object is shown by a name the
   editor guesses from `Item.look` (its world box, middle, main colour, drawn
   from inside), which the three.js adapter reports: "Black pillar by the road
   (left, 3rd)", "Road", "Sky" (`src/shell/names.ts`; never "Unnamed group").

Keys must match `KEY_RE` (`/^[A-Za-z0-9_:#.\-\/]{1,80}$/`). Other characters are
mapped; the original name stays in `label`. `studio: false` (three
`userData.studio`, 2D `obj.studio`) hides an object and its subtree.

### 1.4 Loading and discovery

The host injects, as the **first children of `<head>`** of every HTML page it
serves for the game:

```html
<script src="/__studio/studio-edit.js"></script>
<script src="/__studio/game-adapter.js"></script>  <!-- <game>/.studio/adapter.js, or empty -->
<script src="/__studio/game-tools.js"></script>    <!-- <game>/.studio/tools.js, or empty (§7) -->
```

1. `studio-edit.js` wraps `requestAnimationFrame` (time control) and records
   loads, installs built-in probes (three.js: `window.__THREE_DEVTOOLS__`), then
   publishes `window.studio` (always also `window.__gameStudio`).
2. `.studio/adapter.js` (written by the AI) calls
   `studio.register2D(port | () => port)` or `studio.registerAdapter(probe)`.
   Use the function form when the engine objects only exist after the game
   starts; it is called again until it returns a port.
3. After the game's first frame (or `studio.ready()`), game-folder probes are
   asked first, then built-ins. First adapter wins.
4. UI stage 1 (`findUi`, after the world's): the game's `studio.registerUI()`
   ports, then the built-in DOM UI (§1.1, the UI seat). The world's choice
   above is unchanged by it; the two are asked in separate lists, so a UI never
   takes the world's slot.

The edit script is inert unless the page URL has `?studio=edit` and runs in a
frame: then it freezes time after the first frame and talks to
`window.parent` at the origin given by `studioParent` (default: own origin).

Global API: `studio.ready()`, `studio.attach({ scene, renderer, camera })`
(engines without hooks), `studio.registerAdapter(probe)`,
`studio.register2D(port)`, `studio.registerUI(port)` (§1.1), `studio.core`. Game code calls it as
`window.studio?.ready()` so shipped builds without the studio are unaffected.

### 1.5 Self-check

When editing starts (after `begin()`, so 3D adapters have their edit camera)
the bridge tests the adapter on one visible object,
puts the object back exactly, and reports `SelfCheckResult`:

| Check | Fails when |
|---|---|
| `adapter-found` | No adapter answered |
| `has-objects` | `list()` is empty |
| `keys-valid` | A key is malformed or duplicated |
| `pose-roundtrip` | `setPose` then `list()` does not read back the pose |
| `screen-changes` | The canvas looks the same after moving (skipped when pixels are unreadable, e.g. WebGL without `preserveDrawingBuffer`) |
| `anchor-follows` | `anchor()`/`bounds()` did not move with the object |
| `restored` | The object did not return to its original pose |

The shell shows failures; the host passes the result to the AI either way
(local: stdout `studio: check ok (<kind>)`, or `studio: check failed: <ids>`
plus `.studio/check.md`). The result also carries `unnamed` (keys of listed
objects with no mark and no name, first 50) and `unnamedCount`; the local
host then prints `studio: unnamed <n> objects without a name: <keys>` so the
agent can offer once, at the first `/arrange`, to name them before a save.

The self-check cannot see an adapter that changes how the game is *drawn*
(e.g. a thumbnail step that leaves a Pixi v8 object as a render group). The
local host has a separate view check for that, run by the AI:
`studio.mjs <game> --check-view` shoots the game frame in the editor (after
the self-check and the thumbnails, edit view reset to `{ x: 0, y: 0, zoom: 1 }`)
and the same page served without the edit script, in a private headless
Chrome, and compares them on a coarse grid. stdout:
`studio: check-view ok|failed|skipped …` (exit 0 / 1 / 3), details in
`.studio/view-check.md` and `.studio/view-check/{editor,game}.png`. 2D only.

`studio.mjs <game> --shot` shoots the game as it is played (no edit
script, 2D and 3D) at 1280×800 and 390×844 into `.studio/shot/game.png` and
`game-phone.png` (exit 0, or 3 without Chrome). The AI looks at them after
changing the game, before it reports (skill §3.3).

### 1.6 Time

The studio's own loop (handles, outline, repaint after a resize) uses the
browser's `requestAnimationFrame` captured before any other script wraps it
(`src/core/native.ts`), so engine helpers that hold the game's frames (the
three.js boot script) never stop the editor.

Freezing: after the first frame the bridge looks for an adapter with at least
one object; until there is one it lets the game run (async loading) and looks
again, for up to ~8 s. `studio.ready()` skips the wait.

The wait is the world's alone: a title shown before the 3D models load does not
stop it early. A game with no world adapter but a UI (HTML only) stops after
~1 s. Holding `requestAnimationFrame` does not stop CSS animations (a blinking
"Press start"): the UI adapter pauses the running `document.getAnimations()`
while editing and plays them again at the end (`Port2D.pause` / `resume`).
The built-in three.js adapter hides the game's own DOM next to its canvas while
editing (it would cover objects) — except elements marked `data-studio-key` and
boxes holding them, which are the UI layer.


`src/core/time.ts` holds back the game's `requestAnimationFrame` callbacks
while editing. Edit mode always ends with a **reload** of the game (resuming
frozen time makes elapsed-time maths jump). Engines ticking from timers need
`pause()`/`resume()` in their adapter.

### 1.7 Draw order (2D layers)

Optional, added in contract 1 without changing anything else: adapters
without it work as before, and the shell shows no layer controls for them
(three.js never has them).

- `Item.layer` = the list the object is drawn in (Port2D `order().parent`);
  present only when the adapter can reorder.
- `Pose.z` = the object's place among the **listed** objects of that layer,
  0 = back. `setPose` with another `z` moves it there; the others keep their
  relative order, so undo is `setPose` with the old `z`. `adapterFromPort2D`
  turns ranks into engine indices (moving to the index of the listed object
  now at that rank), so unlisted children such as a background keep their
  place.
- The shell only sends a `z` that another listed sibling has (rules can hide
  siblings, so ranks may have gaps). A move from a handle carries no `z`.
- After a `placement/pose` that changed `z`, the bridge sends
  `placement/items` again (the siblings' `z` changed too).
- Shell: a Layer row (to back / backward / forward / to front; Cmd/Ctrl+]
  and Cmd/Ctrl+[, with Shift = to front / to back) and the object list in
  draw order, front on top, reorderable by dragging a grip (mouse or finger).
  One change = one undo step; one changed list = one unsaved change.
- Ground and background stay at the back. `adapterFromPort2D` marks
  `Item.backdrop` on the unbroken run of objects at the very back of a list
  whose name says so (ground, floor, background, sky, and the same words in Japanese) or that are
  at least 90 % as wide as the game, never the whole list. They get no
  layer controls, and "to back", "backward", a drag or a group move stop just
  in front of them (play test 2026-10-16: a rock sent "to back" went
  behind the ground and vanished).
- Saved as `order` in placement.json (§4.1), never per object.

### 1.7.1 What the editor holds still (2026-10-19)

A hands-on try lifted a game's road 16 m with one stray Height drag and saved it, and moved pillars that the game
itself slides along the road every frame (the new place could never last). Since then:

- **3D grounds.** The three.js adapter also sets `Item.backdrop` (no `layer`) on a ground, road, sea or sky: a name
  that says so, or a box more than 20× a typical object's (more than 6× when flat) — `adapters/three/ground.js`. The
  editor holds it (`Item.held: 'ground'`): no tool works on it until the person presses **Make movable** on its card
  or its menu (shell → bridge `studio:placement/unhold { keys }`, for this session).
- **What the game moves.** Right after the edit view is up, the editor lets the game's own frames run for 0.6 s
  (its draws stay off the screen; an adapter whose engine holds frames itself implements the optional
  `StudioAdapter.watch(on)`), compares every pose and puts what moved back where the first frame had it. Those
  objects get `Item.held: 'game'` and `Item.driven` (`move` = place across the ground, `lift` = height, `turn`,
  `size`): only what the game changes is off, the rest stays editable, and the card says so.
- Both are refused in the editor's own adapter layer (`bridge/hold.ts`: grab / drag / nudgeY / rotate / scale), so
  keys, the ⌘K list and game tools cannot get round it. `setPose` (undo, redo, loading a save) is not held.
- **Where it starts** (studio-tool-clear, then studio-move-plain, 2026-10-23). On an object the game moves (`driven`
  has `move` or `lift`) Move and Height always work, and the item carries `Item.startSpot: true`: where it is put is
  where the loader places it before the first frame, and the game moves it on from there (a game that sets the place
  outright every frame still wins; the card says what a move does now). Turn and size the game sets stay held — a
  start angle or size would not show. (Until studio-move-plain the person first chose "Set where it starts" from a
  menu on a dimmed, slashed Move, which read as a second Motion button.)
- **The strip never loses a tool** (studio-tool-clear). Every object has the same tools in the same places (move ·
  height in 3D · turn · size); one that does not work on it is dimmed (`aria-disabled`), its tooltip one line of why
  and what can be done (`bridge/handles.ts OFF_LINES`, `bridge/hold.ts offWhy`: `game` / `ground` / `locked` /
  `none`). It keeps its own icon (no slash). A press on it, its key or ⌘K does nothing; the why is one small line
  right by the strip (`bridge/handles.ts` `.note`, `gameNote` for what the game moves: "Your game moves this while
  playing. Moving it here sets where it starts."), never a menu and never an "Ask AI" row — the ask box is where the
  AI is asked (studio-move-plain, 2026-10-23; before, a menu opened at the button, `placement/tool-off`). Before
  studio-tool-clear, the button was hidden and nothing said why ("the strip lost Move").
- **Check before saving.** A changed ground (any visible change), or any 3D object moved 5 m up / down, 25 m across or
  resized 3×, is listed in words before Save hands the file to the AI ("Raised the road 16 m"), with **Put back and
  save** and **Save anyway** (`shell/safe-save.ts`).

### 1.8 Copy, delete, several at once

Optional for adapters, added in contract 1 without changing anything else:
the editor offers all three with every adapter.

- **Copy** (⌘/Ctrl+D, the card's Copy button): the shell picks a new key
  (`crate-1` → `crate-5`, `tree` → `tree-2`: readable, never used before in
  the session) and sends `placement/copy`. The bridge makes the copy and puts
  it a little to the side (the width of what was copied, on screen), or —
  for a copy of a copy — at the same spacing again, so pressing Copy again
  lays out an even row. It answers `placement/added` and selects the copies.
  `at: 'view'` (the Library's **Add to scene**, 2026-10-18) puts the copies in
  the middle of what the camera sees instead (the free part of the frame, on
  the original's ground in 3D); the shell then shows the Scene with them picked.
- **Delete** (Delete / Backspace, the card's Delete button):
  `placement/remove`; undo sends `placement/restore`.
- Adapters MAY implement `clone(key, newKey)`, `remove(key)` and
  `putBack(key)` (`StudioAdapter`, `Port2D`; all three or none). Then copies
  are real engine objects (listed under `newKey`, same parent, same pose,
  2D: drawn right after the original) and deleted objects are hidden but
  kept, so no other key changes (tree paths, `#2`). The built-in three.js
  adapter and the Pixi and canvas examples have them.
- Without them, `src/core/edits.ts` shows stand-ins: a copy is listed with
  `ghost: true` and drawn by the bridge as a see-through picture of the
  original (every operation on it is done on the original put at the copy's
  pose for a moment and put back exactly); a deleted object is scaled to
  1e-4 and left out of the list. Items made by a copy carry `copyOf`.
- **Several at once**: Shift+click (mouse) or the list's "Select" mode
  (`placement/multi`, taps add / take out) toggles objects; Shift+drag from an
  empty spot, or a mouse drag from an empty spot in that mode, draws a box
  (objects whose pivot is inside join). A "name ×N" heading in the list, a
  list heading (2D layers) and ⌘/Ctrl+A select groups. `placement/select`
  then carries `keys` (all) and `key` (the one the card shows). The handles
  sit under the whole group: move (2D: the same screen distance for each;
  3D: the first member follows the handle, the others the same metres),
  rotate around the group's middle (2D: on screen; 3D: around the vertical
  axis through the middle of the members on the ground), resize from the
  middle (3D heights from the lowest member). Keyboard steps work the same.
  The bridge reports with `placement/moved-group` (one undo step per `end`).
  2D layer buttons and shortcuts move the selection as one block.
- Locked objects (game rules) are left out of copy, delete and group moves.
- Undo/redo: one entry per action, whatever it holds (several poses, copies,
  deletions). One copy or deletion = one unsaved change.
- Saved as `added` / `removed` in placement.json (§4.1). Reopening before
  the AI has changed the code makes the same copies and deletions again
  (a `removed` key is deleted again only if its label and pose still match,
  since a tree-path key may now name another object); after the AI has done
  it, a copy is an ordinary game object under the same key.
- ▶ Play shows them too (2026-10-16): the bridge, outside edit mode, makes
  the saved copies with `clone` + `setPose` and hides the deletions (same
  rules as reopening) once the game has objects; the loader
  (`studio-placement.js`) does the same for games run on their own. A copy
  made this way looks like its original but does not act like it until the
  AI adds it to the code.

### 1.9 Motion — the timeline (2026-10-22, studio-timeline; motion-gui before it)

How an object moves by itself, made with keys on a time line (3D in stage 1), as in Unity's Animation window or
Blender's Dope Sheet with auto key. Saved as `motion` with `clips` (§4.1); the loader plays it in the game.
(motion-gui, the same morning, had a card menu of kinds — back and forth, loop, once, spin — and a ▶ for one object;
they became templates that set keys, and studio-no-presets (2026-10-23) took them off every screen: see §1.9.3. Its
file shape is still read, and a clip that repeats back and forth plays as it did.)

- The plate (`shell/timeline-panel.ts`, state in `shell/timeline-wire.ts`, maths in `shell/timeline-model.ts`): at the
  foot of the game (PC), in the dock above the card (phone, side window). ▶ / ❚❚, the time, ● Auto key, the picked
  object's motion (clip) menu with `+ Make a motion` and `New: Scene — several objects` (§1.9.3), Rename, Delete, its repeat and "plays at start / on a cue" (+ the
  "when" words for the AI), the picked keys' ease, ⌄ folds. One row per object with a motion (and the picked one),
  ▸ opens position / angle / size. Opened by the card's "◆ Timeline" (the Motion row) or ⌘K.
- **Auto key** (on by default while the plate is open): moving / turning / resizing an object — the strip, ↑↓, a group,
  a typed or dragged number on the card — sets a key at the time line for what changed; the object's place does not
  move. An object without a motion, moved after 0 s, gets its first clip with a key at 0 s of how it stood. Off, or
  the plate folded: the place moves and the motion comes along (offsets). Decided in the shell
  (`timeline.moved` / `movedGroup` / `card` before the model sees a `placement/moved`); the bridge's drag code is
  unchanged. A `placement/moved` with `set: true` is the bridge's echo of the shell's own `placement/pose` (undo, a
  typed number), never a gesture.
- Keys on the plate: press (Shift / ⌘ adds), drag a box, drag to move in time (0.05 s steps, Alt free), Delete,
  ⌘C / ⌘V at the time line, K = a key now, Space = ▶, ← → steps the time. Those keys go to the plate only after it was
  pressed (a press in the game gives them back to the scene). Every change is one undo step (`Change` kind `motion`,
  the whole motion before / after) and one Save count per object.
- `studio:timeline/pose { poses }` (shell → bridge): each moving object at its place + its clip at the time line,
  worked out in the shell (the loader's `clipAt`), set through the copy/delete layer and reported to nobody. Folding
  sends the places. An object a drag of the strip's tools holds right now is left alone (the drag is newer; the pose
  after the drag ends puts it exactly) — studio-motion-move, 2026-10-23.
- `studio:timeline/recording { on }` (shell → bridge): a move / turn / resize is a point of a motion now (the timeline
  on screen, ● on, no Try running). While on, a thing the game moves (`held: 'game'`) takes every tool as a point
  (`Item.meets`, no `startSpot`), and the line under the strip says the game's motion and this one add up when played.
- `studio:timeline/path { key, base, keys, now, sel, making? }`: the picked object's position keys, drawn in 3D — the curve the
  object follows (the loader's `trackAt`), its shadow at the place's height, a dashed drop from each key, a dot per key
  (picked: orange), its time, a ring at the time line. A dot dragged moves on the ground at its height (`toGround`), or
  up / down with Shift (px → m measured at the dot); `studio:timeline/point { key, i, v, end }` back, one undo step.
  `making`: the motion is being made step by step — a press on the dot where the object stands now goes to the object
  (the next step), not to the dot.
- Positions are the parent's space and the screen maths the scene's: right for objects at the top of the scene; a path
  inside a moved group is drawn off by the group's offset (stage 2).
- ▶ Play: the page's loader plays the draft's start clips (and older motions); for the keys it does not (no loader, an
  older one) the bridge does (`play-arrange.ts` `moveInPlay`). The loader lists what it moves in a global set
  (`Symbol.for('game-studio.motion')`) so nothing moves twice. Inside the editor (`studio=edit`) the loader runs none.

#### 1.9.1 When a motion plays, and motions as Library assets (2026-10-22, studio-motion-triggers)

Asked for: "a motion starts when an event happens, stops, or runs the whole game" / "treat a motion as one of the assets".

- A motion (len / repeat / keys) is a **Library asset**: `motions` at the top of placement.json (§4.1), the editor's
  `shell/motion-library.ts` (one for the file, across levels). An object's clip is an **attachment**: which motion
  (`use`), when it starts (`when`) and stops (`until`). Editing keys on the timeline edits the Library motion — every
  object that uses it changes (the head says "on 2"). A file of the first timeline shape (keys inside each clip) is read
  into the Library when it opens (the same name and keys = one motion; other keys = "Open 2"), not counted as a change.
- The timeline head's second row: **Starts** ▾ (two groups — plays by itself: the game starts / after N s / a key /
  this is clicked / another motion ends / the player enters an area; ✦ your AI connects it: touches this / a named cue /
  in my words) with its field, **Stops** ▾ (never / after N rounds / a cue) and **then** (stays / goes back), and **Try**:
  one ▶ per cue in the scene. Try runs the scene with the loader's `motionRunner` (the same rules as the game) and
  shows the poses (`timeline/pose`); ■ stops it. The rows' names say when each starts (`⌨ E · 2×`, purple ✦ = the AI's).
- An area is drawn in the game: `studio:timeline/area { key, area: { p, size }, label }` (shell → bridge, null = none);
  its middle point dragged (ground / Shift up and down) comes back as `studio:timeline/area-moved { key, p, end }`, one
  undo step.
- The Library's **Motion** filter (`shell/library-motions.ts`, `ShellContext.motions`): a tile per motion (its path
  from above, a dot running along it), its detail (what it is on and when, Attach to…, Ask your AI…, Rename,
  Duplicate, Delete — each one undo step: `Change` kinds `motion-lib` / `motion-rename` beside `motion`). The card's
  Motion menu: this object's motions, "Attach from the Library", "Take … off". A picked motion goes to the ask box's chip
  and into the request (`motions`, §3).
- Save: one count per object whose clips changed and one per Library motion that changed.

#### 1.9.2 The path's shape, several ways to start, scene motions (2026-10-22, studio-timeline-2)

Asked for: the second stage of the timeline — the path's shape by hand, a key put on the path, "E or a click", a cutscene.

- **Handles**: a position key may carry `in` / `out` (offsets from its point, the units of `v`): the path's Bézier
  handles there. Absent = smooth (the Catmull-Rom curve through the points, as before — a span changes only where a
  handle was bent); both 0 = a corner. The loader's `trackAt` draws a span as Bézier when either end has its handle,
  taking the smooth handle (`handlesOf`: a sixth of the way between the neighbours) for the side without one; the
  editor's `shell/path-edit.ts` bends (the other side lines up, Alt: alone), makes corners and puts keys on the path.
- In the game (bridge → shell): `studio:timeline/handle { key, i, side: 'in' | 'out', h, alone, end }` (a handle of a
  picked point dragged; live, one undo step), `studio:timeline/insert { key, t }` (the path's line clicked: a position
  key at `t`, the shape kept — a bent span is cut in two with de Casteljau), `studio:timeline/corner { key, i }` (a point
  double-clicked). The head shows **Point ▾** (smooth / corner) while a path point is picked.
- **Several ways to start**: a clip's `when` may be a list of 2–4 (`whensOf` in the loader); any one starts it. The
  timeline's second row: the first with its field, then "or" + each other one with its field and ×, then "+ or". The
  area of an `enter` (wherever it is in the list) is drawn; its four floor corners resize it from the opposite corner
  (Shift: its height): `studio:timeline/area-moved { key, p, size, end }`.
- **Scene motions**: a Library motion with `tracks` (object key → keys, 1–16) instead of `keys`, and optionally `order`
  (the tracks' keys, each once: the rows' order on the timeline as the person arranged them — studio-ui-lead2, 2026-10-23;
  an array because the file sorts object keys; absent = the keys as written; the loader ignores it). Each object in it has
  the usual attachment (`use`); the editor writes the same `when` / `until` / len / repeat to all of them (the head acts
  on the scene). The loader's `resolveClip(c, lib, key)` gives each object its track (`scene: true`), and the runner
  starts the scene's other objects at the same moment when one starts. On the timeline: the clip menu's "New: Scene —
  several objects"; × on a linked row takes an object out (its track goes; undo brings it back). A scene motion dropped
  on an object from the Library puts that object in the scene. Shell side: `shell/scene-motion.ts`.
- **The rows are the picked object's** (studio-motion-focus, 2026-10-23): the picked object first (several picked:
  those), then the objects linked to it (its scene's), in the list's order; another object picked closes the scene.
  "+ Link an object" under the rows puts another object in the shown motion — from its list, or a click in the game
  while the list is open (the pick stays: `timeline.linkPick`). An ordinary motion that gets its first link becomes a
  scene motion (`tracks`, the picked object's keys as its track); one shared with other objects is copied first
  ("Hop 2"); the last link taken off makes it ordinary again (`keys`), so link + unlink leaves the file as it was. Each
  is one undo step (the Library change in it). ⋯'s "Show every motion in the scene" shows every moving object's row.

#### 1.9.3 No presets: a motion is made by showing it (2026-10-23, studio-no-presets)

Asked for (a review, on "Back and forth / Round / Once / Spin" in the menus): "what is this? presets?" — and to
keeping only the two ways in: "we don't need them".

- **No kinds anywhere**: the strip's Motion menu, the card, the timeline's clip menu, ⌘K and the Library offer two
  ways in only — **Make a motion** and **Use a saved motion** (the second only when the Library has one). The clip
  menu keeps `New: Scene — several objects` (it starts empty; not a kind). `timeline-model.ts` has `blankClip` /
  `sceneClip`; `fromTemplate`, `TEMPLATES` and the `tl.tpl.*` kind words are gone. **Repeat** in ⋯ (once / repeats /
  back and forth) stays: it is a setting of a motion the person made. Files are unchanged (`repeat: 'pingpong'`, the
  older path / spin shape still play).
- **Make a motion** (`timeline.make(key)`, every way in): the plate opens with the time line at 1 s, ● Auto key on;
  where the object stands is 0 s; the line says "Drag {name} to where it should move (Esc to cancel)". Nothing is
  made until a move (a thing that moves already shows none of its motions until then; the move starts a new one,
  waiting `{ on: 'say' }` when another starts with the game). The end of the first move / turn / resize makes the 0 s
  and 1 s keys and plays from 0 s; each next gesture adds keys one second after the last key (a property that had none
  holds still until the previous last key) and plays that second. Esc (the editor or the game page) or **Done** ends
  it — before the first move nothing was made; after, the motion stays (each gesture is one undo step). Moving the time
  line by hand, folding the plate or showing another object ends it too.
- **When** ▾ (Gemini's words, the wording asked of Gemini): "Trigger" — On Game Start, On Tap /
  Click, When Near, On Key Press, After Delay, After Previous Move (only with another motion to follow) — then "Ask AI
  to Set Up": Custom with AI… (On Collision (AI) / On Signal (AI) when a file already has one). `WHEN_TRIGGERS` in
  `timeline-panel.ts`.

#### 1.9.4 Code motions (2026-10-24, studio-code-base)

Asked for: "sometimes a motion is made by maths, not points — what then?", and the same day's user needs: "tune a
formula motion by hand, but keep it a formula". A spiral, a wave, a chase is written once in the game's code with the
loader's `codeMotion(id, { name, knobs, round, note, game, drag, at })` and put on the timeline by the AI (`--do
motion.code`, §3.6): a **Library motion whose shape is code** — `motions: [{ name, code: id, knobs? }]`, attached like
any motion (`{ use: name, when, until }`), so detach, delete, rename, `when` / `until` and ⌘Z work as for points.

- `at(t, k, g)` answers the offsets after `t` seconds in `clipAt`'s shape (`p` added, `r` added — `[x, y, z]`, or one
  number = the turn round the up axis —, `s` multiplying), added to the object's place like a motion of points. `k` =
  the knobs' numbers: the file's `v` when the person turned one, else the code's. `g` = `{ key, obj, dt, player }`.
  `game: true` = it reads the game: played frame by frame (`g.dt`), never scrubbed. `round` = seconds of one round (a
  number or `(k) => …`; none = never ends: `until.times` never comes).
- **Only what the file attaches plays** (`motionRunner`): a `codeMotion()` the timeline does not have does not move in
  the game either. A clip may be switched off (`off: true`): it stays on the object and does not play.
- **Knobs**: 1–3 per motion (`{ v, label, unit, min?, max?, step? }`; `unit` one of `m px s deg % x m/s px/s ''`). The
  file keeps only the ones the person turned, `{ v, was }` (`was` = the code's number). On Save the AI writes `v` into
  the code where `was` is; the editor takes a knob out of the file without a count once the game's page says the same
  number (`MotionLibrary.settle`).
- The loader keeps the list on `globalThis[Symbol.for('game-studio.codeMotions')]`; the bridge sends it with every
  world list (`studio:code-motions { list: [{ code, name, knobs, round, note?, game? }] }`, `src/bridge/code-lists.ts`).
  In the editor (stage 1) a code motion is its row and its name — the strip one round wide (4 s until the page says),
  no points; ▶ Play plays it (the play hook runs the draft's `motions`). Its knobs on the row, the ◇ on the path and
  "Turn into points" come in stage 2.
- **A rule motion stays a rule** (studio-to-coords, 2026-10-24; a request that day: "a rule's thing should stay a rule however it
  is moved — to make it your own shape, a button converts the rule to coordinates"): its knobs and the ◇ change its
  numbers; moving the object moves where it goes round; K / ⌘V on the timeline add no point to it (the line says so).
  **Convert to coordinates** (the strip's button, it was "Make editable points") makes it a motion of points, 16 a
  round, one ⌘Z — and the points are **relative**: offsets from where the object stands (`at()`'s offsets, as every
  motion's keys are), so moving the object moves the path with it.

### 1.10 Levels (2026-10-22)

Optional, added in contract 1 without changing anything else. A game with
several levels says which ones its code has, and builds the one the editor
asks for:

```js
const pick = window.studio?.levels?.([{ id: 'meadow', label: 'Meadow' }, 'cave']); // ids or { id, label }
buildLevel(pick?.build ?? 'meadow');                                                  // null outside the editor
await applyPlacement(scene, './placement.json', { level: pick?.id ?? 'meadow' });
```

- `studio.levels(list)` returns `{ id, build }` inside the editor's frame
  (edit and ▶ Play), `null` anywhere else (the game picks its own level).
  `id` = the level shown (it may be one the person made in the editor);
  `build` = a level the code has (for an editor-made level, the one it was
  copied from). It also sends `core/levels` (once per page).
- The shell puts the level on the game URL: `studioLevel=<id>` and
  `studioBuild=<code id>` (`LOCAL_PATHS.levelParam` / `buildParam`); none =
  the list's first level. Ids match `KEY_RE`.
- The shell keeps one placement model per level shown; ⌘Z starts empty on a
  new level. Motions (§1.9) are a level's own, like its poses (integrate3). Copy, rename, reorder and delete are list changes (one Save
  count each) written to `placement.json` (§4.1); the code changes are the
  AI's.
- A game with one level (or that never calls it): nothing changes — no
  switch, no `levels` in the file — until the person adds a level: the bar's
  "Levels ⌄" opens a menu (studio-uniforms, 2026-10-23; never an action at
  once): "Make Level 2 — a copy of this one" (made and opened here, one Save
  count; ⌘Z or the line's Undo takes it back until the next change, a level
  change or Save) and ✦ "Ask AI for a different kind of level…" (a draft in
  the ask box). In a game that never calls `studio.levels()` the file then
  says `levelsWas: []` (§4.1). A game with levels gets the same ✦ row at the
  end of its level menu.

### 1.11 The UI's screens, looks and theme (2026-10-22, UI stages 2–3)

The built-in DOM UI (§1.1, the UI seat) does more than move and size, all of it
in the game page by the bridge (`src/bridge/ui-extras.ts`), none of it in the
game's code:

- **Screens.** Containers marked `data-studio-screen="<id>"` (KEY_RE: `title`,
  `play`, `pause`, `over` or the game's own; `data-studio-screen-label` for
  words). `ui/screens` lists them in page order with the one drawn now;
  `ui/screen { id }` shows that one: the others get `display: none
  !important`, it loses `hidden` and, when its CSS still hides it, gets the
  display its own rules give it (else `block`). The old attribute and inline
  values are kept and put back when editing ends (Play, §3.5.3). The UI's
  list is then that screen's elements plus those outside every container
  ("always on screen"); `Item.screen` says which.
- **Looks.** `ui/set { key, name, value, state? }`: `text` (the element's
  main words: `data-studio-text`, else the first element in it with words of
  its own; none when that element mixes words with a value), `fontSize` and
  `color` (of that text), `background` (the element); `state` = `hover` /
  `active` / `disabled` for that look's `color` / `background`. `null` = the
  game's own. Colours go in one style sheet (`#studio-ui-edit`; a state's
  with `!important`), inline only when the game's normal rule is more
  specific; they stay for Play (the layout), like a moved element.
- **A button's look shown.** `ui/state { key, state }`: the page's `:hover` /
  `:active` / `:disabled` rules that touch the element, copied onto
  `[data-studio-state~="<state>"]`, and that attribute on it. Never the real
  `disabled` (it would take no pointer). No transitions on marked elements
  while the sheet is up.
- **Sample values.** `ui/sample { key, text }`: the words shown in the
  element's `data-studio-value` (else its main text) until `null` or the end
  of editing. Never saved.
- **Theme.** `ui/theme` lists the CSS variables declared on `:root` / `html`
  whose value is a colour, or whose name says font; `ui/theme-set { name,
  value }` sets one on `<html>` (`null` = the game's own). Stays for Play.
- A game without these marks / variables gets none of the messages: the
  editor is what it was (no screen head, no Theme, no look rows beyond what
  the element has).

---

### 1.12 Code layouts and keep-out areas (2026-10-24, studio-code-base)

The same day's user needs: "objects placed by a formula or procedurally — I want to adjust them by hand, but keep them a
formula" and "when placing procedurally, I want to say where not to place them, as coordinates or as code". The
answers of the same day: dragging one object of a layout changes the formula's number (⌥: that one alone, stage 2); a
keep-out area belongs to the layout it is drawn for, not to the whole level.

- **Code layout**: `codePlace(id, { name, knobs, count, make, at, drag, avoid })` in the game's code. `applyPlacement()`
  puts it in after the world is built and before the file's `objects`, **with or without a file** (it is the game's
  own): `count` objects (≤ 200) from `make(i)`, named `<id>-<i+1>` (three: `name` + `userData.studioKey`; Pixi: `label`
  + `studioKey`) under the root, at `at(i, k, g)` = `{ p, r?, s?, by?, hand? }` in the root's space; `g` = `{ try, rand,
  level }`, `rand()` seeded by id, number and try (the same places every load). `by` (studio-writeback): a shift added
  after the offsets' frame is read from `p` (the person's zigzag / ramp / jitter written into the rule on Save — in `p`
  it would be no straight row, and the editor would lose the row's sideways, zigzag and ramp). `hand: true`: one
  placed by hand, written into the rule on Save — no keep-out area moves it and it is not in a row's frame (an offset
  that needs a row passes it by), as its pin did. A second `applyPlacement()` takes the layout's earlier objects out
  first. `report.places = { id: { keys, skipped } }`.
- **Keep-out conditions**: `codeAvoid(id, { name, after, knobs, test, show })`; `test(p, k, g)` true = nothing goes at
  `p`, `g` = `{ player, level }` (the player where the level starts: `setPlayer`, `applyPlacement(…, { player })`, or a
  `player` key). A layout's place inside any of its keep-out areas (its code's `avoid` ids unless the file switches them
  off, the file's conditions and boxes) is tried again (`g.try` + 1, ≤ 30); a layout that gives the same place again (a
  row) leaves that number out (`skipped`). Objects put by hand (`pins`, `hand`) are never moved by them.
- **The file's `places`** (§4.1): only what the person changed — knobs `{ v, was }`, `pins` (that one by hand),
  `hand: true` (all by hand), `avoid` (boxes and conditions, `off`), `from` (hand-placed objects the layout replaced:
  the loader hides them — only objects it did not make itself — until the AI takes them out of the code). Each level
  its own.
- The loader's lists are on `globalThis[Symbol.for('game-studio.codePlaces')]` / `'codeAvoids'`; the bridge sends
  `studio:code-places { list: [{ id, name, keys, skipped, knobs, drag?, avoid }], avoids: [{ code, name, after?, knobs,
  show? }] }` with every world list and names a layout's objects by it ("Street lamps 3" for `lamp-row-3`, where the
  adapter knew only the key). The shell keeps `places` per level (`src/shell/code-places.ts`): each layout changed is
  one Save count and one undo change (`kind: 'code-place'`); a change makes the game read the draft again (stage 1: a
  soft reload — stage 2 moves the objects in place); a knob the code has caught up with leaves the file without a count.
- Stage 1 shows a layout by its name (the shelf, the card's title, `--do list`); its knobs on the card, dragging one
  object to turn a knob, ⌥ "just this one", the purple path and the keep-out list on the ground are stages 2–3.
- **A rule's object stays in its rule** (studio-to-coords, 2026-10-24; a request that day: "however it is moved", and the CRYSTAL
  FIELD try of that day — a lamp dragged away from the road did nothing and said nothing; lifted, it silently became a
  pin). `drag` names the knob each way a person drags one of its objects turns: `'gap'` (Move, as before) or
  `{ along, side, up, turn, size }` — Move turns `along` and `side` together (the numbers that bring the object nearest
  the finger), Height `up`, Turn `turn`, Size `size`. A way with no knob is taken by the editor's **offsets** (below,
  studio-offsets; before them it did not move and `studio:place/held { id, key, way }` said why — now only the AI's
  `object.move` is refused). Only ⌥ (Ctrl) puts one object by hand (`placement/moved` `alone: true` → its pin), told "Placed Street lamps 3 by hand ·
  ⌘Z · Reset to rule" and marked **Hand-placed** on the card and in the list. A key step, a game's tool, a group drag or
  the AI's `object.move` never take one out of its rule (put back / left out / refused with the `place.set` ways).
  **Convert to coordinates** (the card's button, it was "Place individually") turns the whole layout into coordinates
  (`hand: true`, every object's pin; one ⌘Z) — where each stands now, as before.
- **Offsets** (studio-offsets, 2026-10-24; the CRYSTAL FIELD try that day: "a lamp dragged away from the road
  did nothing and said nothing" — and the answer "a rule's objects stay a rule however they are moved"). A drag of one
  object of a rule a way its code has no knob for moves EVERY object of the rule with it, from the first step (the chip
  "Sideways +1.0 m · all"): the layout's `places[id].offsets` (§4.1) gets a row `{ way, how, v }`, laid out over
  `at()` — **at(i, k) → offsets → keep-out areas (tested where the offsets put it) → pins** (a hand still wins; Reset to
  rule goes back to the place with the offsets). The loader's frame (`offsetFrame`) comes from the rule's places before
  any offset: one straight row, or two parallel rows (a road's two sides as ONE codePlace, `i % 2` the side) — `along`
  the rows (the same for both), `side` away from the middle line of the two rows (so both sides leave the road; one
  row: away from the root's origin), `up`, `turn` (°, mirrored on the second row), `size` (× a factor). The **rank** of
  an object is its place in its own row counted from the end of number 1's row (never the number: with `i % 2` sides
  every other number is a whole side). `how`: `same` (v for all), `zigzag` (every other one: the odd ranks with
  `odd: true`, else the even — never ±: the neighbour would move toward the road), `ramp` (v × rank, size 1 + (v − 1) ×
  rank: "a little more each one"; a count turned up keeps the slope). Not a row (a scatter — at() read its random —, a
  ring, a grid, fewer than 3 places): `move` ([x, z]; 2D [x, y]) and `up` / `turn` / `size` with `same` only; the other
  rows wait in the file until it is a row again. On release the line over the ask field offers the **four**: All the
  same (or the code knob's name when the way has one: "Change Gap") · Zigzag · Ramp · Just this one (a pin, as ⌥) —
  dot pictures, keys 1–4, a pointer over one shows that shape in place, a press swaps it **in the same ⌘Z**, Esc or the
  next action closes them; Ramp is dim when the nearest one was dragged ("ramps start from the nearest"); a layout that
  is not a row has All the same and Just this one only — and **✦ Write into the rule** (below; shown when the choice
  left an offset that way). The card lists each row under the code's knobs (its dot picture, "Sideways · Zigzag
  width", a number box, ✦, ⋯ Remove; violet as the knobs, lit once when new); the same way and how are one row (a
  second "All the same" sideways adds to it), ≤ 8 (a drag that would need a ninth says "Up to 8 offsets · ✦ to fold them
  into the rule" and moves nothing); the next drag that way turns the row chosen last when it moves the dragged one (a
  zigzag of its parity, a ramp past the nearest), else All the same. A key step of one rule's object is its rule's
  offset too (the four open after it). Several picked: Move / Height (a drag or the keys) move a rule's objects with
  the rest as its `move` / `up` offset (the lead's step on the ground and up; one ⌘Z with the others' moves); a group's
  turn / size / End still leaves them where the rule puts them, with why (`studio:place/held` `group`: round the
  group's middle, or each to its own floor, is no offset of a rule). "Convert to coordinates" writes where each stands
  with its offsets and drops them. Bridge → shell: `studio:place/offsets { id, key,
  offsets, end }` (live, then one undo step, as place/knob) and `studio:place/dragged { id, key, way, d, rank, row, did,
  knob?, pose, skipped? }` (what the four need). `--do place.set --offsets '[…]'` replaces a rule's offsets (`[]` takes
  them off); `--do list` gives each layout's `offsets` and each object's `line` / `rank` / `offset`.
  **Jitter** (studio-writeback; the third pattern asked for that day, "a little, by a fixed random amount"): `how: 'jitter'` with
  a `seed` (0–999999) — v × a number from −1 to 1 per object, the same every load for the seed and the object's number
  (size: 1 + (v − 1) × it; `move`: x and z each their own; works without a row for up / turn / size / move). Never made
  by a drag (a drag never turns it): the card's ⋯ **Add jitter (Sideways / Position, Turn, Size)** and a row's ⋯ **Add
  jitter** add one (0.3 m / 10 px, 10°, ×1.1, the ground ±0.5 m / ±12 px; one ⌘Z), a jitter row's ⋯ **Shuffle** gives
  it a new seed. The loader exports `jitter(seed, i, axis = 0)`, the same number, for the game's code.
- **Written into the code** (studio-writeback, 2026-10-24; a request that day: "Is what the code says then hard-coded
  again by the JSON? The code has to be the truth"). A layout's `places` entry only holds the person's changes until the
  AI writes them into its `codePlace` / `codeAvoid` on Save (SKILL.md "Code layouts" step 5): knobs into their numbers,
  offsets into `at()` (same into `p`; zigzag / ramp by rank and jitter with `jitter(seed, i)` into `by`), a pin as an exception of the rule (`{ p,
  hand: true }` for its number; its own object only when it left the rule and is the last number), `hand: true` as a
  list of coordinates, boxes as `codeAvoid()`s (with `show`), `from` out of the code. Then `--do place.code --id <id>
  --fold <parts>` (§3.6): the editor notes where every object of the layout stands, takes those parts out of the level's
  `places` — **in what is saved too, so it is no change of the person's: no Save count, not on ⌘Z** (the undo history
  loses them as well, `UndoStack.rebase`: an offset back in the file on top of the code's would shift the rule twice) —,
  writes the draft, reads the game again and measures every object against where it stood (`src/shell/write-back.ts`: 1 cm / 1 px, 0.5°, 1 % of the size; one that
  left the layout but stands where it stood as another object is not gone). The AI's line ends with "the look is the
  same" or the farthest off with where it stood and stands (then the AI fixes its rule and sends `place.code` again,
  measured against the same before); the person's line says who wrote it ("Claude wrote your changes to “Street lamps”
  into its rule"), and a gap only when there is one ("· Farthest off: Street lamps 3 (0.4 m)"). **Undo AI change**
  puts the folded parts back into the file with the old code (and knobs the code had caught up with: they leave the
  file the same way, `PlaceStore.settle`); Redo folds them again.
- **✦ Write into the rule** (studio-writeback; it was "✦ Make this way a knob" — the person who asked did not know what a "knob"
  was: the screen never says it). The four choices' ✦ and an offset row's ✦ put a draft in the chat box ("Write the
  Sideways offset of Street lamps into the rule") with the chips "Street lamps (rule)" "Sideways · All the same 1 m";
  while the same object stays picked the request has `intent: "to-knob"` and `places: [{ id, name, n, knobs, avoid, way,
  offsets, objects }]` (each object's `line` / `rank` / `offset`, §3.4). The AI adds a knob for that way in the game's
  words ("From the road 6.6 m" = the code's 5.6 + the offset), names it in `drag`, and sends `place.code --fold <way>`:
  the offset row leaves the card and the new knob lights there once.
- **✦ Turn into a rule** (studio-code-torule, 2026-10-24; the other way round: hand → rule). Several hand-placed objects
  picked: the card's "✦ Turn into a rule"; a motion of points: its row's ⋯ / right-click "✦ Turn into a rule…". Either
  puts the draft "Turn into a close rule" in the chat box (nothing is sent; the request then has `intent: "to-code"`,
  §3.4). The AI writes the rule and swaps it in (`--do place.code --replace` / `motion.code --replace`, §3.6); the
  editor reads where the hand's shape was just before and **measures** how close the rule came (`src/shell/to-rule.ts`:
  each object against the rule's object of the same number, the whole distance; a motion at 64 places of one round, its
  own repeat included). Until Save (Save clears it; ⌘Z of the swap hides it, ⌘⇧Z shows it again): the layout's card has
  "◉ Compare with original" and "Max deviation: lamp-3 (0.6 m)", its guide (`studio:place/guide` `compare`: `was` and
  `names` per rule number) draws an orange dot where each stood, a thin line to the rule's object and the chip
  "lamp-3 · 0.6 m" over the farthest; a rule motion's strip glows with orange marks at the old points' times, the
  timeline's line says "Compare with original · Max deviation 0.1 m (at 0.8 s)", and its path (`studio:timeline/path`
  `code.was`: `pts`, `keys`) is drawn with the old path in orange beside it (short of room, the line keeps "◉ Max
  deviation 0.1 m" and the rest goes to its tooltip). The rule's objects are lit violet (the AI's marks), and the
  hand-placed ones it replaced are left out of the list while `from` names them. One switch for both.
- **Keep-out areas in the editor** (studio-code-keepout, stage 3): the card's **Keep-out areas** under a layout's knobs
  (boxes first, then conditions; a switch, × for what the file holds, a condition's knobs, ⋯ "Also for" another layout,
  **+ Draw a box**, **✦ Describe with text**) and, in the game, the picked layout's areas painted (`studio:place/avoid
  { id, entry, draw }` → bridge `keep-out.ts`): red hatching; a box's edge orange with four corners (size; Shift:
  height) and its middle (place) to drag; a condition's edge violet and dashed — its `show(k, g)` shape (`{ circle: { p,
  r } }`, `{ box: { p, size } }`, `{ poly: [[x, z], …] }`, 2D `[[x, y], …]`) with a ◇ for its first knob, else the ground
  tried with its own `test` every 0.5 m (2D 8 px) near the layout and on screen; a red × where a skipped object would
  go. Back: `studio:place/avoid-box { id, i, p, size, end, out?, cancel? }` (i = -1: drawn now; the page lays the layout
  out again meanwhile, its objects stepping out), `studio:place/avoid-knob { id, code, knob, v, end }`,
  `studio:place/avoid-inside { id, keys }` (objects put by hand that stand in an area: the card says so, they never
  move), `studio:place/avoid-draw { id, on: false }` (Esc in the game). Each change: one undo step, one Save count.

### 1.13 The UI drawn in the canvas (2026-10-24, studio-canvas-ui stage 1)

A request that day: "I want to edit the UI drawn INSIDE the canvas, not only the HTML UI, as UI." A score, a health
bar, a button painted with `fillText` / `fillRect` is part of the game's picture: the editor cannot know where it is,
and does not guess (a "UI-looking" area that is picked but does not move would be worse than none). So the AI names it
**once in the game's code** with the loader's `codeUi()` — the same split as `codePlace` (§1.12): the AI writes the
code, the editor is the hands — and the editor lists it in the UI seat with the HTML UI (§1.1, one list).

```js
const scoreUi = codeUi('score', { name: 'Score', kind: 'text', at: { from: 'top-left', x: 16, y: 12 }, size: [232, 40],
  look: { text: 'SCORE', fontSize: 24, color: '#ffffff' }, sample: '999,999' });
const b = scoreUi.box(), L = scoreUi.look();   // every frame, where it is drawn
```

- **The definition**: `name` (the person's word), `kind` (`text` | `bar` | `button` | `image` | `box`: the list's icon,
  the samples), `screen`, `at: { from, x, y }` (from one of 9 places of the canvas — `top-left` `top` `top-right` `left`
  `center` `right` `bottom-left` `bottom` `bottom-right` — inward; the middle ones' x / y across / down from the
  middle), `size` (`[w, h]`, a number, or `() => [w, h]`), `scale`, `look` (`text` · `fontSize` · `color` ·
  `background`: only these keys are the card's rows), `states` (`hover` / `active` / `disabled`: `{ color, background }`),
  `sample`, `round`, `canvas` (default: the page's last canvas), `units` (`css` default — the game draws after
  `ctx.scale(devicePixelRatio)` — or `canvas`). The list is `globalThis[Symbol.for('game-studio.codeUis')]`, shared by
  the game's copy of the loader and the editor's.
- **The handle**: `box()` → `{ x, y, w, h, s }` in its units, from the canvas's size now; `look(state?)` → the look
  (the editor's state shown when none is asked); `value(v)` → the editor's sample (a bar's: 1 / 0.5 / 0) else `v`;
  `hit(x, y)` → inside the box (a circle for `round`) — the game's press test, so **a moved button is pressed where it
  is drawn**; `state()` → `'hover' | 'active' | 'disabled'` shown by the editor, null in the game. Without the editor
  the same functions answer from `placement.json` (`ui.<id>` with `code`), so the game draws the person's layout
  before Save, as for HTML UI.
- **In the editor** (`src/bridge/code-ui.ts`): a `Port2D` (`p` = CSS px offset from where the code put it when editing
  began, `s` = the size over the code's `scale`, no turning), merged with the DOM UI's. **Its picture is the game's**:
  every change makes the game draw ONE frame with time stopped (`core.time.step()`: the game's waiting
  `requestAnimationFrame` callbacks run once with the stopped clock; or the game's `studio.redraw(fn)`), so the card's
  change is seen at once and the game's own state does not move. The card's rows are `look`'s keys only (the HTML UI's
  rows, `ui-card.ts`); a `button` with `states` gets the State row; a `bar` gets the samples full / half / empty.
  **The world darker around the boxes only**: a board (SVG, `data-studio-ui-board`) right over the UI's canvas with a
  hole the shape of each box (a circle for `round`) — the UI is drawn in the world's canvas or in one over it, so no
  layer can go between them; the canvases under the board are not dimmed twice. On the world layer a canvas that holds
  `codeUi`s over another canvas (a HUD canvas) is hidden like the HTML UI (`data-studio-ui-layer`, faded with the eye;
  the three.js adapter no longer hides it as an overlay). **While one is dragged**: where it was (dotted) and how far
  it is from the nearest of the 9 places, "20 px from the top centre" (in the person's language; `data-studio-ui-line`).
- **Measured for the AI** (decision 8): `ui.code` moves each box 40 px right, draws one frame, reads the canvas and puts
  it back (no ⌘Z, no Save count): the picture not following → `the drawing does not read codeUi('x').box()`; the
  changed pixels wider / taller than the box → `the box is smaller than what is drawn (232×34, drawn 260×36)`. Only to
  the AI (`do failed`); the person sees nothing. Waits for the editor's first moments (time runs while it watches the game).
- **The file** (§4.1): `ui.<id>` with `code: <id>`, and when it moved or grew `from` (the nearest of the 9 places to where
  it was left — Q2 = a, 2026-10-24) and `at` (the at() numbers from there): the loader places it by `from` / `at`, so
  it keeps to that place on any window size. **On Save** the AI writes `at` / `scale` / `look` / `states` into the
  `codeUi()` and sends `[ui.code, ui.set --clear]` in one `--do` (§3.6): the entry leaves the file (no Save count), the
  editor draws it where the code now puts it. HTML UI the same way: the AI writes the CSS and clears the entry.
- **Not delivered yet** (stage 2, 2026-10-24; `src/bridge/ui-found.ts`, `src/shell/ui-missing.ts`; the plan's decisions
  9–12). Where the editor KNOWS there is UI it cannot select — never a guess — it shows it on the UI layer as a faint
  dotted frame with the tag "Not selectable yet" (above the frame; right of it when there is no room above), not in the
  list: (a) **a 2D canvas laid over the game's canvas** (a higher z-index, or the same and later in the page): the lumps
  of its non-transparent pixels outside every UI box (`from: 'hud-canvas'`); (b) **what the world adapter leaves out as
  UI** — `Port2D.leftOut()` / `StudioAdapter.leftOut()`, viewport CSS px boxes (the Phaser example: `scrollFactor 0`;
  Pixi: `studio = false` layers, a container's parts one by one; `from: 'left-out'`). A lump or box over half the screen
  is not a UI part (a backdrop) and is left out. **One canvas with everything in it gives nothing**: no frames and,
  with nothing else, no UI layer (as before). A HUD canvas is marked `data-studio-ui-layer` before editing starts (so
  the three.js adapter does not hide it as an overlay; the layer style hides it on the world, the eye shows it), and a
  game page resized while held draws ONE frame of its own (a resize handler that sets a canvas's width clears it).
  With nothing selectable but such UI seen, the UI layer is there with an empty list: **Scene | UI** shows, the list
  says "No selectable UI yet". A press on the UI layer outside every UI box (a game with canvas UI: frames or codeUis)
  draws a cross there and the shell's one line over the ask field: "This UI can't be selected yet" ("This game draws its
  UI inside the picture" when nothing is selectable) · **✦ Ask {ai} to make this UI editable** — the reason is said in
  that one place only. The next press in the game, Esc, another layer or a pick takes it away. ✦ only puts a draft in
  the box below, "Make this UI editable", with the chip "Here (bottom left)" (the nearest of the 9 places) and a small
  picture of the place (240 × 160 CSS px round the press, play-shot.ts's painter); the person sends it: an `ask` with
  `intent: 'ui-code'`, `pressed` (game page CSS px), `found` (the frames) and `shot` (kept as `.studio/play/<id>.jpg`,
  §3.1), `layer: 'ui'`. The AI delivers **all** of the game's canvas UI at once (SKILL.md "UI drawn in the canvas");
  `--do list` gives the frames as `uiFound`. The first time the AI looks at a game with such UI it delivers it without
  asking and says so in one line (decided on 2026-10-24: do not ask first).
- **Screens** (stage 2): `codeUi`s with a `screen` on 2 or more screens put the screens' menu at the head of the UI
  list ("Playing ⌄ 1 / 2"), merged with the HTML UI's screens (§1.11; the same id is one screen). The list shows the
  screen shown (and every `codeUi` without a screen); choosing one only chooses what the game draws:
  `studio.screen()` answers it while editing (null otherwise) and the game draws that screen's UI —
  `const screen = globalThis.studio?.screen?.() || state.screen` — with its own state (score, time) untouched, so ▶ Play
  starts from its own first screen. Editing starts on the HTML UI's screen shown, else `play`, else the first one.
  `ui.code` measures a box on another screen on its own screen. The card's States (a `button` with `states`) and the
  samples (a bar's full / half / empty; a text whose `size` is a function: its frame follows the sample) are stage 1's.
- **UI kept as objects — Phaser / Pixi** (stage 3, studio-canvas-ui-3, 2026-10-24). An engine that keeps its HUD as
  objects (a Phaser text, a Pixi `Text`) does not call `box()` each frame, and its update does not run while the editor
  holds it (the adapter sleeps Phaser's loop, stops Pixi's ticker). So: `size` may be the object itself (its
  `getBounds()` with its own scale taken out: it grows by `box().s` through onChange, and a size read at that scale
  would grow it again), and `onChange(fn)` → `fn(box, look)` once at once and again whenever either changes (told by
  the loader when the file comes, on a window resize, after the game's `value()`; by the editor before it draws a
  frame). A codeUi's object is UI: the Phaser / Pixi adapters leave it out of the world's list and of `leftOut()`
  (`globalThis[Symbol.for('game-studio.codeUiObjects')]`, a WeakSet). One frame is drawn by the world adapter's
  `render()` when it holds the engine's loop (`StudioAdapter.holdsLoop`: a Port2D with `pause()`), since no frame
  callback waits for `time.step()` then. A text the game leaves empty while it waits to start shows its `sample`
  while editing (on the object: `setText` / `text =`, its own words back after), so its frame has a size; `ui.code`'s
  check reads a WebGL canvas through a 2D copy made right after the frame is drawn, and says `its box is 0×24 now
  (nothing is drawn there yet …)` for a box still empty. On the UI layer a 2D world shows the identity view (what Play
  shows), not "everything in frame": the UI drawn in the world's canvas is drawn through the world's view.
- **Theme** (stage 3). The canvas UI's shared colours and fonts in the code, once:
  `const T = codeTheme({ accent: { v: '#ffcf6e', label: 'Accent' } })` — `T.accent` reads the value now (the editor's,
  else the file's `theme`, else the code's), `T.onChange(fn)` for objects; a look's colour may be `var(--accent)`
  (`var(--accent, #fff)`): the codeTheme's value, else the page's CSS variable, else the fallback — the part follows the
  theme until the person gives it a colour of its own (the card's colour back to the code's = following again). The
  editor lists them in the Theme fold under the UI list as `--accent` rows (`UiThemeVar.label` = the code's word shown
  in place of the name), one list with the CSS variables (§1.11; the same name is one row, both change); the same
  undo, Save count and file (`theme: { "--accent": { v, was } }`). On Save the AI writes `v` into `codeTheme()` (a CSS
  variable: into `:root`) and sends `ui.theme --id --accent --clear` (§3.6). Lists:
  `globalThis[Symbol.for('game-studio.codeThemes')]` (and `…codeThemeFile`, `…codeThemeSubs`).
- **Edges — the HTML UI too** (stage 3; Q2 = a). An HTML element that moved or grew is measured from the nearest of the
  9 places of the game's window when let go (`src/bridge/ui-edge.ts`): while dragged, the same dotted place it was,
  line and words as a codeUi's ("16 px · 24 px from the top right"); after every gesture (and ⌘Z) the bridge says
  each element's `from` / `at` (CSS px) to the shell (`ui/edges`), and the file's `ui.<key>` has them beside `p`. The
  loader still places an HTML element by `p` until Save; on Save the AI writes its CSS `left` / `right` / `top` /
  `bottom` by `from` / `at` (SKILL.md) and clears the entry, so it keeps to that edge on every window size.
- Tests: `test/code-ui.test.ts`, `test/code-ui-3.test.ts`, `test/ui-found.test.ts`, `test/studio-canvas-ui.browser.mjs`
  (`--only one|missing|screens|phaser|pixi|theme|edges`).

## 2. Messages (bridge ⇄ shell)

`window.postMessage` with `{ type: 'studio:<tool>/<verb>', … }`. Receivers check
`event.source` **and** `event.origin`; senders always pass an explicit target
origin, never `'*'`. Full payload types: `ShellToBridge`, `BridgeToShell`.

| Direction | Type | Payload / meaning |
|---|---|---|
| bridge → shell | `core/hello` | Edit script loaded (`contract`) |
| | `core/wait` | Waiting: `no-adapter`, `no-frame`, `no-objects` |
| | `core/check` | Self-check result |
| | `core/ready` | Adapter `kind`, `dim`, `version`, `editing`; UI stage 1: `layers?: ['world', 'ui']` (only for a game with a UI seat — absent, no switch is shown) and `layer` (the one edited now; `kind` / `dim` / `rise` / `fly` are that layer's adapter's: the UI is `dom-ui`, `2d`); `motionHere: true` when the game's loader can run the draft's motions in this page (§3.5.3, studio-no-reload) |
| | `core/view-state` | Opaque edit-camera state (the shell keeps it across reloads) |
| | `core/plate-fold` | `{ key }`: a pick from the list is under the open timeline plate (`inset.plate: 'open'`) — the shell folds the plate to its one line and answers with view `reveal` for `key`; while the plate is up the view only slides (adapter `view.slide`), never pulls back (studio-fix-0143) |
| | `core/key` | Key pressed while the game frame has focus |
| | `core/error` | Adapter threw |
| | `core/game-error` | `{ message, where? }`: the game's own page threw (edit and Play, first 3 per load); the shell says what to do |
| | `core/levels` | `{ levels: LevelInfo[], current }`: the game called `studio.levels()` (§1.10); `current` = the level this page shows |
| | `placement/items` | `Item[]`; `layer?` whose list it is (UI stage 1; absent = the world). When editing starts in a game with a UI, the UI's list is sent once too, so its saved places are kept and shown |
| | `ui/found` · `ui/missing` | studio-canvas-ui stage 2 (§1.13): the UI seen but not selectable yet (`UiFound[]`: `box`, `from`), when editing starts and when it changes; a press on the UI layer beside every UI box (`at`, `place` = one of the 9, `none` = nothing selectable, `shot` = the picture round it) or `at: null` = the cross went (the next press in the game) |
| | `ui/screens` · `ui/props` · `ui/theme` | UI stages 2–3 (§1.11): the screens and the one shown (`forced` = the editor chose it), when editing starts and after `ui/screen` (only for a game with screens); the picked UI element's props (`text`, `fontSize`, `color`, `background`, `button`, `state`, `was` = the game's own, `sample`), after a UI pick and each `ui/*` change of it; the theme's variables (`name`, `type` color / font, `value`, `was`, `label` = a codeTheme's word, §1.13), when editing starts and after `ui/theme-set` (only when there are some) |
| | `ui/edges` | studio-canvas-ui-3 (§1.13): the HTML UI's edges — per element `key`, `from` (the nearest of the 9 places of the window), `at` (CSS px from there), `box`, `frame` — after every gesture, ⌘Z or resize that changed them |
| | `placement/selected` | `{ key, item? }` |
| | `placement/moved` | `{ key, pose, end?, from?, press?, hold?, alone? }` (`alone`: ⌥ held — a rule's object put by hand, §1.12) |
| | `placement/thumb` | `{ key, src }` (`data:image/png;base64,…` or null), one per key asked for by `placement/thumbs` |
| | `placement/tool` | `{ tool }`: the strip's chosen tool changed in the game (a strip button, M / H / T / S, Escape) |
| | `placement/menu` | `{ open }`: the strip's choices (the ▾ on turn / size) opened or closed in the game |
| | `placement/context` | `{ key, x, y, touch }`: a right-click (Mac: also Control-click) or a long press on the game: the editor page opens the menu for that place. `key` = the object under it (null = nothing / only the ground); an object not picked yet was picked first, without moving the camera |
| | `placement/at-is` | `{ id, key }`: the answer to `placement/at` (the same test as a tap; `key` null = nothing there) |
| | `placement/motion-press` | `{ key, x, y, w, h, touch, keyboard }`: the strip's Motion button pressed (or A / 5 with the game page focused; studio-motion-tool). The editor opens the pick's motion on the timeline, or — none yet — its small menu at the button (`x y w h`, the game page's px; 0 × 0 for a key): "No motion yet", **Make a motion** (the timeline at 1 s, where it stands being 0 s; §1.9.3) and **Use a saved motion** (the Library's; studio-tool-clear, 2026-10-23 — no list of kinds) |
| | `placement/moved-group` | `{ poses: [{ key, pose, from? }], end?, press?, hold?, alone? }` (§1.8; without `alone` a rule's objects are left out, §1.12) |
| | `placement/added` | `{ items: [{ key, from, pose, ghost? }], failed }` (§1.8) |
| | `library/assets` | `{ loads: LoadEntry[], uses: { key: AssetRef[] } }` |
| | `library/previewed` | `{ url, ok }` |
| shell → bridge | `core/edit` | `{ on, viewState? }` |
| | `core/play` | `{ on, motion?, motions?, viewState? }` (§3.5.3, 2026-10-22): ▶ Play and back to Edit in the page on screen. `on`: the editor puts its tools away and the game goes on from the edit layout (`motion` = the draft's motions, played from their start, every `when` through the game's loader; `motions` = the Library's); the page then says `play/hello` as a Play page. Off: the game held, every object back where Play found it (three.js: also what the game added held out of the scene and what it took away put back, both handed back to the game at the next `on`; adapter `watch(on, whole)`), the editor up again on `viewState` (`core/ready` with `editing: true`, the list). Only to a page whose editor is up |
| | `ui/missing-clear` | studio-canvas-ui stage 2 (§1.13): the line "This UI can't be selected yet" went by the shell's hand (Esc, ✦, a pick): the cross goes too |
| | `ui/screen` · `ui/sample` · `ui/set` · `ui/state` · `ui/theme-set` · `ui/props-get` | UI stages 2–3 (§1.11; only after `core/ready` listed `layers`): show a screen (`id` null = as the game shows it); a sample text (`null` = its own); one look field (`name`, `value`, `state?`; `null` = the game's own; `quiet` = no `ui/props` back, for the values the file holds, given again when a page opens); a button's look; a theme variable; ask for an element's props |
| | `core/layer` | `{ layer: 'world' \| 'ui' }` (UI stage 1, only after `core/ready` listed `layers`): drop the pick, put the input on that layer's adapter, answer `core/ready` + its `placement/items`. The world's edit camera goes to the game's own view while the UI is edited and back after; `core/view-state` is only sent for the world |
| | `core/view` | `frameAll`, `home`, `focus`, `zoom`, `orbit`, `pan`, `rise` (camera up / down by `by` × the game's height; 3D adapters with `view.rise(dy)`, which `core/ready` reports as `rise: true`; adapters with `view.fly(right, up, fwd)` — and `view.look(dx, dy)` — report `fly: true`, and the editor page then sends the fly keys held there as `core/fly { keys, fast }`), `restore` (adapters may also have `view.home({ glide? })` — the opening view, the game camera in three.js — and `view.settle(key)` — the first pick from it glides to an editing angle; the bridge uses them itself. `home` (⌘K "Back to the opening view", ⇧F) calls `view.home({ glide: true })`, or `frameAll()` when the adapter has no `home`) |
| | `core/lang` | UI language for handle labels |
| | `placement/list` · `select` · `pose` · `step` | see types (`select` and `step` take `keys` for several, §1.8; `pose` takes `layer?` to set it on the layer not being edited — the UI's saved places when editing starts) |
| | `placement/thumbs` | `{ keys, size }`: draw these list pictures. One queue in the bridge, drawn one at a time; a new request's keys go to the **front** (the shell asks for the rows in view each time the list scrolls, so with hundreds of objects what you see is drawn next) |
| | `placement/multi` · `copy` · `remove` · `restore` | §1.8 |
| | `placement/axis` | `{ axis }`: the 3D turn axis (`y` / `x` / `z`, or `next` for the R key) |
| | `placement/marks` | `{ keys, label? }`: what the AI's last change touched (after "Reload the game"), outlined in the AI's colour with one tag |
| | `placement/hover` | `{ keys }`: the mouse is over these objects' row in the list, the card or the ask chip — lit in your colour, softer than the pick (`[]` = none) |
| | `placement/at` | `{ id, x, y }`: which object is at this point of the game page (its own px)? A Library motion is held over the game (studio-motion-flow). Answered at once by `placement/at-is`; nothing is picked |
| | `placement/tool` | `{ tool: 'move' \| 'lift' \| 'rotate' \| 'scale' \| null }`: choose the strip's tool (the keys and ⌘K when the editor page has focus) |
| | `placement/motion` | `{ show, has, label, open?, press? }`: the strip's Motion button after the four tools (studio-motion-tool, 2026-10-22). `show` = the pick can have a motion (one world object in 3D); `has` = it has one (a dot on the button); `label` = its tooltip, in the editor's words; `open` = its menu is open in the editor page (pressed look); `press` = A / 5 or ⌘K in the editor page — answered by `placement/motion-press` with the button's place |
| | `placement/look` | `{ on }`: Space is held in the editor page — a drag in the game looks around even with a tool chosen |
| | `placement/menu` | `{ open: false }`: close the strip's choices (a press or Escape in the editor page while they are open) |
| | `core/ui` | `{ handlePx, inset?, theme? }`: strip button size; `inset` = px the shell's floating plates cover on each side (`rightTo`: how far down the right one reaches; `plate`: the timeline plate is up, `'open'` or `'slim'` = folded to its one line); the strip and "bring into view" keep clear of them. When an inset grows (a phone's list sheet opens) the bridge slides the view — pan only, the least move — so the picked object and its strip sit in the part still seen |
| | `library/assets` · `library/preview` | see types |

**One move = one undo step.** A gesture (press → release on a handle, or a
run of held key/button repeats) sends many `moved`; only the last has
`end: true` and `from` (pose before the gesture). The shell records one undo
step per `end`, and none when `from` equals the final pose. `pose` from the
shell (undo/redo) is answered with `moved` **without** `end`.

Input rules the bridge implements (shared by every adapter):

| Action | Mouse | Touch |
|---|---|---|
| Select | Click (on release, no movement) on the object itself, or within 12 px of its shape (not of its box) | Tap (28 px) |
| Deselect | Click on nothing: the sky, the water, a ground / background (`Item.backdrop`, or an object covering 60 % of the view or more: `adapter.coverage` in 3D), the margin round the game, the empty part of the list. Escape. A drag from there looks around and keeps the pick | Tap on nothing |
| Add / take out of the selection | Shift+click, or click in "Select" mode | Tap in "Select" mode |
| Box selection | Shift+drag from an empty spot (or drag from an empty spot in "Select" mode) | — |
| Copy / delete the selection | ⌘/Ctrl+D / Delete, Backspace (or the card's buttons) | The card's buttons |
| Pick the object behind | Click the same spot again | Tap again |
| Choose a tool | A click on a strip button (move · height · turn · size), or **M · H · T · S**, or ⌘K. The button stays pressed until another tool is chosen; a click on the pressed move / height button puts it down; Escape puts any tool down (a second Escape drops the pick) | A tap on a strip button |
| Use the chosen tool | **Drag anywhere** on the game (on the object, beside it, on the sky): it acts on what is picked. A readout next to the strip says by how much ("Turn 32°", "Size ×1.40") | One-finger drag anywhere |
| Move | Move tool: the object follows the drag. With no tool chosen: drag the **picked** object. Arrow keys | The same with a finger |
| Rotate | Turn tool: drag sideways (0.57° per px, 15° steps within ±3° of the drag's total, Shift = free) / Q, E. 3D: around the middle of the object's box, on the chosen axis — choosing the turn tool (and a click on it when chosen, or R) shows Turn (y) / Tip forward (x) / Tip sideways (z) (`adapter.turn`, `Pose.t`) | The same |
| Turn several | Turn tool; its ▾ (or a long press) shows the axes (3D: Turn / Tilt forward / Tilt sideways, R = next) and, under them, Together (the whole arrangement turns round the middle of the selection: of the objects' boxes in 3D, `adapter.middle`) / Each in place (each turns on its own spot, round the middle of its box in 3D). 2D has one axis, so only Together / Each in place | The same |
| Resize several | Size tool; choosing it with several picked (and a click on it when chosen) shows Together (the gaps grow too) / Each in place. Both keep each object's foot (the bottom middle of its box: `adapter.foot` in 3D, the screen box in 2D) on the ground | The same |
| Height (3D) | Height tool: drag up or down (the object follows the pointer's height) / PageUp, PageDown. **Going down it stops once** with its bottom (the bottom of its box) on the first surface below — the ground, the water, a pier's planks, a crate's lid; pulling on 30 px past it lets it through, and the next surface down stops it again. A PageDown step that would cross a surface ends on it; the next step goes through | The same (44 px past it) |
| Snap to surfaces (3D) | A move (the Move tool, a drag of the picked object, arrow keys) keeps an object that **stands** on something (its bottom on or in a surface) standing on what is under its foot: up the shore, onto the pier, onto a crate. The ray from the camera through the foot's place on screen picks the surface, as in Unreal / Blender; a wall sends it to the floor at the wall's foot; the sky keeps it flat. On the surface it stood on it keeps its depth (a post 15 cm deep, a barrel floating low); on another one its bottom sits exactly on it. Things in the air (a lamp hung up, a gull) move flat at their height as before. **Hold Ctrl or ⌥ during the drag** to move without snapping (Blender's Ctrl; pressed before the drag, ⌥ still looks around). Surfaces = every visible mesh but the moving ones (the selection), light effects (additive / no depth write) and skinned / instanced meshes; a ground the editor holds still is still a floor. `adapter.rest` / `setSnap` | The same with a finger (no free key) |
| Drop to floor (3D) | **End** (a Mac laptop: fn →), ⌘K "Drop to floor", the object's right-click menu: the bottom set on the surface under it, as Unreal's End. Several picked: each onto its own floor. `adapter.drop` | The object's menu (long press) |
| Scale | Size tool: drag right or up = bigger, left or down = smaller (×2 per ~140 px) / +, − | The same |
| The old way | A drag that starts **on** a strip button still works as before (turn round the object, size from its middle, …) | The same |
| Look around (3D) / pan (2D) | With no tool chosen (or nothing picked): drag anywhere else, **including on objects that are not picked**, and on very large picked ones (their on-screen part 60 % of the window or more: a ground). **With a tool chosen**: ⌥ Option-drag (orbit), right / middle drag (pan), or hold Space and drag | Two fingers (pan and pinch); one finger only when no tool is chosen |
| Pan | Middle drag, right drag, Shift+drag starting on an object, two-finger trackpad scroll | Two-finger drag |
| Zoom | Wheel / trackpad pinch (towards the pointer) | Pinch |
| Fly (3D) | **W / S** forward / back **level** (along the ground the way the camera faces: looking down, the height stays — the line of sight before 2026-10-19), **A / D** left / right, **E / Q** up / down, **Shift** ×3 — smooth while held, stops on release, at a speed taken from the scene's size (`view.fly`; a small room and Lantern Cove feel the same). With **nothing picked**: the keys alone. With **something picked**: only while the **right button** is held (S stays the Size tool, E / Q still turn it), as in Unity / Unreal / Godot; a right-drag then turns the view where the camera stands (`view.look`) instead of panning, and its release opens no menu. Not while typing in a field; never by itself. `?` sheet: "Fly the camera  WASD" with that rule under it; ⌘K "Fly the camera" (WASD / Right button+WASD) | — |
| Camera up / down (3D) | The ↑↓ buttons in the game's bottom-right corner: click = one step (a tenth of the game's height), hold = keeps going, drag up / down on them = follows the drag. **E / Q** with nothing picked, or with Space held / during a right, middle or ⌥ drag (with something picked and no look-around, Q / E still turn it). ⌘K "Camera up" / "Camera down". The camera goes straight up or down and keeps looking the same way (`view.rise`); never by itself | The same buttons: tap, hold, or drag a finger up / down on them |

WHY camera up / down (play test 2026-10-18: "I can't raise the camera; it's
needed"): orbit turns round a point, pan slides over the ground at the same
height and zoom moves along the line of sight, so there was no way to just go
up over a wall or down to the water. Buttons on the game, because a key is
found only by people who already know it and a phone has none; E / Q because
3D tools (Unity, Unreal, Godot) fly up / down with them while the right
button is held — and Q / E already turn a picked object here, so they are the
camera's only when nothing is picked or while looking around. Not two
fingers: two fingers already pan and pinch, and a vertical two-finger drag
is panning forward. 2D views only pan and zoom: no buttons there.

WHY tools are chosen, not held (play test, 2026-10-16): the strip
used to work as four handles — press a button and drag while holding it —
except move, which "drag the object" also did. Holding a 28 px button while
moving the mouse was the unnatural part. Choosing a tool and then dragging
anywhere is how design and 3D tools work, and it makes the four the same.
The key letters are the English names' initials (none of them was taken:
Q / E are turn steps, R the turn axis, F frame, P play). Looking around
with a tool chosen follows Mac 3D tools (Option-drag orbits, right-drag
pans, Space = the hand); on touch, two fingers always look. The first
time a tool is chosen, one line at the bottom of the game says this
(`localStorage` `gameStudio.toolHint.v1` in the game page: once per
computer).

WHY only the picked object moves when dragged: when dragging any object
moved it (before 2026-10-16), a finger meant to select or look around nudged
things, and a large ground mesh could be grabbed by accident. A pick first,
and "large = look around", keep that impossible while letting the thing
itself be dragged, as in every other editor.

The strip (move · height · turn · size) is DOM inside the game page, under
the object (above it when there is no room), buttons of `UI.handlePx` (28 px;
at least `UI.handlePxPhone`, 44 px, on phones) or the size the person set on
the Look page. The selection is outlined in **orange** (`#ff6b1a`, the shape
from `silhouette` when the adapter has it, else a rounded box; drawn on a faint
dark halo so it reads on orange or sand-coloured games too) with a name
tag; what the AI changed in **violet** (`#8b7cff`). These two colours mean
nothing else anywhere in the editor. The shell's own plates (the picked
object's card, the ask bar) float over the game and tell the bridge what they
cover (`core/ui` `inset`). Losing focus (the shell moving focus after a
selection) must not drop an active pointer.

---

## 3. Host (where the game lives)

### 3.1 Interface

`StudioHost` in `src/contract.ts`: `open`, `load`, `save`, `listAssets`,
`assetUrl`, `addAsset` (add only, never overwrite), `nextStep` (hand a
KUMODeck step to the AI; never contacts any service; `delete-files` with
`{ files }` hands the Library's "Delete" on unused files to the AI, which
asks the creator before deleting: the editor deletes nothing), `request` /
`status` (hand-offs to the AI, §3.4), `reportCheck`, `loadConfig`,
`loadData` / `saveData` (§7), `loadUi` / `saveUi` / `customUi` (§8), and
the optional `offline` flag: `true` when no AI is behind the host (the
browser-only web demo in `src/hosts/browser/`, which keeps everything in the
browser). Requests are still kept, but the shell says that nothing picks
them up instead of waiting for the AI. Such a host shows no ask field and no
AI status: one line in the ask field's place says what the AI does in Claude
Code, with a link to the optional `getUrl` (where to get Game Studio).

`open()` also returns `title`: the game's name for the editor's title line
(the page `<title>`, or the folder name when the title is empty or generic
such as "Vite App").

### 3.2 Local HTTP API (src/server ⇄ shell)

The local server (`skills/arrange/bin/studio.mjs`) listens on `127.0.0.1` (or
the LAN with `--lan`) on a free port and prints a link with a one-time pass:
`http://127.0.0.1:<port>/__studio/?t=<pass>`. Opening it trades the pass for an
HttpOnly, SameSite=Strict cookie and redirects to a clean URL, so the shell
never sees the secret. Every request needs the cookie; writes must also be
same-origin (`Origin` / `Sec-Fetch-Site`). The server checks the `Host` header
(DNS rebinding) and serves only files inside the game folder (no dot-files,
except `.studio/adapter.js` through its own route).

| Method & path | Body | Response |
|---|---|---|
| `GET /__studio/` | — | Shell page (built UI in `skills/arrange/bin/studio-ui/`) |
| `POST /__studio/stop` | — (header `x-studio-stop: <secret from .studio/server.json>`, no cookie) | `{ok:true}`, then the editor stops. Used by `studio.mjs <folder> --stop`; a wrong or missing secret is 403 |
| `POST /__studio/hands` | `{ ops, by? }` (header `x-studio-agent: <the same secret>`, no cookie) | The AI's `--do` (§3.6): `{ editor: false }` when no page is open; else the newest page does the ops and its answer comes back, `{ editor: true, results }`; 504 when the page did not answer in 20 s; 422 with `details` when the ops do not read |
| `GET /__studio/api/hands` | — | The editor page's event stream (`text/event-stream`): one `job` event `{ id, ops, by? }` per `--do` (§3.6) |
| `POST /__studio/api/hands/:id` | `{ results }` | The page's answer to job `id`; 410 when no `--do` waits for it any more |
| `GET /__studio/studio-edit.js` | — | Edit script |
| `GET /__studio/game-adapter.js` | — | `<game>/.studio/adapter.js` (plain file only), or an empty script |
| `GET /__studio/api/open` | — | `{ gameUrl, origin, lanUrl }`; the shell adds `?studio=edit` |
| `GET /__studio/api/files/:tool` | — | `{ value }` (null when missing or invalid, with `error`) |
| `PUT /__studio/api/files/:tool` | result JSON | `{ ok, path, request, at, undo, watching, seen? }`; validated by `src/schema`; 422 with `details` if invalid; also keeps a `saved` request (§3.4) and prints `studio: saved …` |
| `PUT /__studio/api/files/:tool?handoff=0` | result JSON | `{ ok, path }`: the same file, written as a draft (no request, no stdout line). The editor writes every change this way as it goes; Save is the PUT without it |
| `GET /__studio/api/assets` | — | `{ assets: AssetFile[], missing: [{ ref, in }], truncated }` |
| `POST /__studio/api/assets?name=<file name>` | raw bytes | 201 `{ path }` under `assets/`, free name chosen (`-2`, `-3` …) |
| `POST /__studio/api/next-step` | `{ id }`, or `{ id: "delete-files", files: [paths] }` (existing plain files in the folder, ≤ 200) | `{ ok, path, request }`; writes `.studio/next-step.md` (kept for older shells; the shell now uses `request`) |
| `POST /__studio/api/request` | `StudioRequestInput` (`step: "delete-files"` also takes `files`, same check as above; `kind: "play"` may carry a `shot` data URL, written to `.studio/play/<id>.jpg`, §3.5) | `{ ok, id, at, path, undo, watching, seen? }`; keeps `.studio/requests/<id>.json` (§3.4) after a snapshot of the game's files (`undo: true`); 422 with `details` if invalid |
| `GET /__studio/api/status` | — | `{ status, time, watching, seen?, code, agent? }`: `.studio/status.json` normalised (null when missing or not valid), `time` = when it was written (ms); `watching` / `seen` from `.studio/watch.json`; `code` = signature of the game's files (§3.4); `agent` = `"claude"` or `"codex"` when the editor can tell which AI is behind it (the plugin's wake hook, or the environment it was started in: `src/server/which-ai.mjs`), left out otherwise — the AI line's "More in Claude" |
| `POST /__studio/api/undo` | `{ to: <request id>, redo?: true }` | `{ ok, restored, removed, redo, id, at }`: the game's files put back as snapshot `to` has them; `redo` = the snapshot of the files just before (undo `{ to: redo, redo: true }` to put the change back); keeps an `undone` request and prints `studio: undone …`; 404 when there is no such snapshot |
| `POST /__studio/api/check` | `SelfCheckResult` | 204; failures go to `.studio/check.md` |
| `GET /__studio/api/lan-qr.svg` | — | With `--lan`: QR code of the editor link |
| `GET /__studio/game-tools.js` | — | `<game>/.studio/tools.js`, or an empty script (§7) |
| `GET /__studio/api/config` | — | `{ value }` from `.studio/studio.json` (read only; `error` when not JSON) (§7) |
| `GET/PUT /__studio/api/data/:id` | tool data JSON | `.studio/data/<id>.json` (`id` = `TOOL_ID_RE`, ≤ 256 KB); PUT prints `studio: saved .studio/data/<id>.json` (§7) |
| `GET/PUT /__studio/api/ui` | UI prefs JSON | `.studio/ui/prefs.json` (≤ 16 KB) (§8) |
| `GET /__studio/game-ui.css`, `/__studio/game-ui.js` | — | `.studio/ui/studio.css`, `.studio/ui/shell.js`, or empty (§8) |
| `GET /<path>` | — | Game files; HTML gets the two script tags of §1.4 first in `<head>` |

`src/shell/host-local.ts` maps these to `StudioHost`. `assetUrl(path)` is
`/<path>`. Lines the server prints for the agent (one per event):
`studio: ready …` (then `studio: reply with this link alone on the first line of your answer, exactly as printed:
<url>` and `studio: open browser|app|none - …`, where it opened: the default browser unless the person chose the
pane next to the chat with `--open-in app`; `src/server/open-in.mjs`), `studio: saved placement.json (<summary>)`,
`studio: added <path>`, `studio: next-step <id> <path>`,
`studio: request <kind>[ <step>] .studio/requests/<id>.json "<words>" (<object names>)`,
`studio: request play .studio/requests/<id>.json "<words>" (while playing, picture .studio/play/<id>.jpg, <n> errors)` (§3.5),
`studio: check ok (<kind>)`, `studio: check failed: <ids> (see .studio/check.md)`,
`studio: unnamed <n> objects without a name: <keys>`,
`studio: undone .studio/requests/<id>.json "<what happened>"`.
`studio.mjs <folder> --watch` prints the same request lines (from the files,
after `studio: watching <n> waiting`, which goes to stderr when n is 0), nothing
else while nobody asks, and ends on its own after 29 minutes (`--for <min>`,
0 = never) with `studio: watch rest …` (quiet watch, 2026-10-19).

### 3.3 Cloud (later)

Same interface, different implementation: edit ticket (Promise 5, name
reserved), saves through the owner's authenticated API. Not part of phase 1.

**What a cloud host must do** (so the editor can run on a KUMODeck server
next to a cloud Claude Code session, with no change to the shell):

- Implement every `StudioHost` method over the owner's authenticated API. The
  shell runs unchanged; nothing in it may assume a local folder, a local
  server or stdout.
- Keep requests and the status with the same shapes as §3.4, normalised with
  `src/schema/handoff.mjs`, and validate result files with `src/schema`
  (byte-for-byte the same as the local server).
- Make them readable and writable by the agent through the KUMODeck API and
  MCP tools: list the waiting requests (oldest first), read one, mark
  requests handled, and write the status (`state`, `request`, `changed`,
  `note`). These are the cloud versions of `--requests` / `--status`.
- Keep a `play` request's picture (§3.5) as a file the agent can open, and put
  its path in the record's `shot` in place of the data URL.
- Keep `saved` requests for saves and `.studio/next-step.md`-equivalent steps
  for KUMODeck next steps, exactly as the local host does.
- `status()` returns `time` from the host's clock (when the status was
  written); request ids and `at` also come from the host's clock.
- Never run anything because of a request by itself: a request is words for
  the agent, who checks with the person as the skill says.

### 3.4 Hand-offs to the AI (requests and status)

The person talks to their AI in the AI's own window (a terminal, Claude Code,
a cloud session), never inside the editor: there is no chat in the editor.
Editor → AI is one-way and must not depend on the AI watching at that moment.
So every hand-off is **kept as a record first**, and a line on stdout is only
a bonus that wakes an agent that happens to be watching.

- **Requests** (editor → AI). `host.request(StudioRequestInput)` for
  `ask` (the person's words about the picked objects, or about the whole game
  when no object is picked: `objects` empty or left out; from the ask box in the
  strip under the game), `name` (give these unnamed objects a name) and
  `next-step` (an item of "Ideas for your AI": `fit`, `look`, `tool`, or a
  KUMODeck step; also `delete-files` with `files`, the Library's "Ask my AI
  to delete it" on unused files — the host checks every path is a plain file
  in the folder, writes `.studio/next-step.md` and the
  `studio: next-step delete-files` line, and deletes nothing). Shell tools
  send through `ShellContext.ask`, so the AI line follows their requests too.
  Every successful Save (the person pressed **Save**, ⌘S) is also kept as a
  `saved` request. The editor also writes the result files as a draft while
  the person works (`save(…, { handoff: false })`, never shown on screen, so
  closing the tab loses nothing): those keep no request and print nothing, so
  a watching AI is not woken by every drag and starts only on Save.
  A stored request (`StudioRequest`) has `version: 1`, `id`, `kind`, `at`
  (ISO, the host's clock), `text` (one line, ≤ 500 characters), and as fitting
  `objects` (`key`, `label` — for an `unstable` object the name the editor
  shows, guessed from `Item.look` ("Black pillar by the road (left, 3rd)") —, the `pose` in the editor at that moment — it may
  be unsaved —, `unstable`, and `files`: the asset files it is drawn with, when
  the editor knows them), `assets` (`ask`: files picked in the Library that the
  words are about — "Add this to the scene" asks for a new object made from
  them; plain folder paths, ≤ 50), `motions` (`ask`, studio-motion-triggers: Library motions picked with the words,
  ≤ 20, each `{ name, len, repeat?, on: [{ key, when?, until? }], keys? }` — a hint, bad entries dropped; `keys.p` = its
  points, with `intent` only), `places` (`ask`, studio-code-keepout: the rule layouts the words are about, ≤ 8, each
  `{ id, name, n, knobs?, avoid: [box | { code, name?, knobs?, off? }] }` — a hint), `intent` (`ask`: `"avoid"` = the
  words are a keep-out area for `places` (the card's ✦ Describe with text); `"to-code"` (studio-code-torule) = the words
  came from ✦ Turn into a rule — the AI fits the nearest rule to these hand-placed `objects` or this motion's points and
  swaps it in with `--do place.code --replace` / `motion.code --replace` (§3.6), or, when none comes within half the
  object's size / a tenth of the path's, replaces nothing and says so; `"to-knob"` (studio-writeback) = ✦ Write into the
  rule: `places[0]` also has `way`, its `offsets` and `objects` (`{ key, line?, rank?, offset? }`, ≤ 200) — the AI
  writes that way into the rule as a knob and sends `place.code --fold <way>`, §1.12; `"ui-code"` (studio-canvas-ui stage
  2) = ✦ Ask … to make this UI editable: `pressed` = the place pressed `[x, y]` (game page CSS px), `found` = the dotted
  frames (≤ 24 `{ box, from }`), `shot` = the picture round the place (a data URL in; the host keeps it as
  `.studio/play/<id>.jpg` and names that) — the AI makes all of the game's canvas UI selectable, §1.13), `step`, `lang`, `dim`, `unsaved` (changes not
  saved yet), `view` (`ask`, 3D: the camera's `eye` and `target` when they
  asked, so new things land in sight), `files` (what it is about: `placement.json`,
  `.studio/next-step.md`, …; for `delete-files`, `.studio/next-step.md` then
  the files to delete). The id is time-sortable and is also the file
  name: `20261016-153012-482-ask-9f3c` (UTC). The host makes the id and the
  time; nothing from the browser decides a file name.
- **Status** (AI → editor). The agent keeps one status: `StudioStatus` with
  `state` (`received` | `working` | `asking` | `done` | `failed`; `asking` =
  the agent waits for the person's answer, `note` holds the question; with
  `asking` only, `choices` (≤ 4 answer buttons, ≤ 40 characters each),
  `about` (≤ 10 object keys the question is about) and `before` / `after`
  (one line each, both or neither); the person answers in the editor with an
  `answer` request: `text`, `to` = the request asked about, `question`), and optionally
  `request` (latest id it handled), `handled` (ids), `changed` (how many
  things it changed in the game), `note` (one line for the person, in their
  language), `at`. The shell polls `host.status()` (every 3 s while something
  waits, else 10 s) and shows one line: "handed over, waiting" → (after 20 s
  with no pick-up) "say 'look' in your AI's window" → "got it" / "working" →
  "done (3)" with a button that reloads the game.
- A status answers a request when it names it (`request`, `handled`), names a
  later id, or was written at or after the request's time.
- **Is an AI watching?** (AI feel, 2026-10-16.) The agent's watch is one
  process, `studio.mjs <folder> --watch`: it prints a `studio:` line for every
  request file (the waiting ones first) and, while it runs, rewrites
  `.studio/watch.json` (`{ version, pid, at, seen }`, `seen` = the last request
  it printed) every 1.5 s, removing it when it stops. The host reads it as
  `watching` (written < 5 s ago by a live pid) and `seen`, returns both with
  every kept request (so the editor knows the moment Enter is pressed) and with
  the status. An agent runs the watch only when its environment wakes it on a
  new output line (Claude Code: Monitor); otherwise it uses "look".
- **The editor wakes the AI** (push to the AI, 2026-10-19; `src/server/ai-wake.mjs`).
  The Claude Code plugin's hooks run `studio.mjs --hook wait` (Stop and
  UserPromptSubmit, `async` + `asyncRewake`): it waits for a request the AI has
  not been shown in an editor under the session's folder (running editors list
  themselves in `<tmp>/game-studio-<uid>/editors/`), keeps `.studio/wake.json`
  fresh meanwhile (read as `watching` too), and exits 2 with the request lines,
  which wakes the AI. `--hook prompt` (UserPromptSubmit) adds waiting requests
  to whatever the person types. `.studio/told.json` (`{ seen }`) = the last
  request any watch or hook printed: each request wakes the AI once, and the
  host returns it as `seen`.
- The shell's line (`src/shell/ai-flow.ts`) above the input: `sent` (a watch
  runs) → `seen` (it printed the request) → `received` / `working` (the
  agent's note) → `updating` → `done` (the note, what was asked, "3 things
  changed", **Undo AI change**) or `failed`; `away` at once when nothing can
  reach the AI: the fact in one line ("Kept as a note for Claude. Nothing in
  the game changes until Claude reads it.", the request quoted under it),
  never a promise, a warning or a command to run. `sent` that no watch or
  hook has shown to the AI after 15 s says the same. While the AI has it with
  no words of its own: "Claude is on it"; quiet for 2 minutes: "Still working
  · N min". Hosts that cannot tell (`watching` left out) keep "waiting" →
  after 20 s the same line.
- **Is the AI there, before typing** (`src/shell/ai-presence.ts`, 2026-10-23;
  it replaced the top bar's "● AI"): words beside the ask field (above it on a
  narrow bar), named after `agent` (Claude / Codex / "your AI"):
  `watching` ("● Claude is watching": `watching` true), `working` ("● Claude
  is working": the AI holds a request of this page or wrote its status in the
  last 20 s), `look` (Codex without a watch: "Codex reads it when you type
  “look”"), `away` ("Claude isn't watching · How to open": Claude was
  watching in this page and has not been for 60 s while the page was
  visible), `unsure` ("Not sure Claude is open · How to open": everything
  else). A green dot only for the first two. Pressing the words opens one line
  of what to do. The whole-game placeholder follows: "Ask Claude to change the
  game…" / "Write a note for Claude…". `asking`: the AI's question
  with its `choices` as buttons, its `about` objects lit in the scene and
  `before` → `after` side by side; a button or the ask field sends an
  `answer` request (`text`, `to`, `question`). A violet light
  runs round the input while the AI has the request. Polled every 0.7 s while
  busy, 1.5 s while waiting, 3 s otherwise.
- **The game reloads by itself.** The status carries `code`, a signature of
  the game's files (path, size, mtime; not `.studio/`, dot files,
  `node_modules`, or `placement.json` / `library.json` at the top). When it
  differs from the code the game in the frame was opened from, the shell
  reloads: at once when the AI is `done` / `failed`; while it is `received` /
  `working` only after 8 s of no change (it may write several files); with
  nobody working, after one quiet poll (the person's own code editor). The new
  game loads in a second frame under the old one, which stays until the new
  game has listed and drawn its objects (no flash); the view (`view-state`,
  now also sent after the first frame-all) and the selection carry over, and
  what moved, resized, appeared or went is marked violet (`placement/marks`).
- **Undo AI change.** Before a request is kept (`ask`, `name`, `next-step`,
  `saved`), the host snapshots the game's files (the same set as `code`, each
  ≤ 8 MB; none for a folder of more than 4000 files) into `.studio/undo/`
  (`<id>.json` manifest + content-addressed `blobs/`, newest 12 kept). After the
  AI's change is shown, **Undo AI change** restores the snapshot of the first
  request since the last change shown (`host.undoAi(to)`), removing files the
  AI created; the files before the undo become a new snapshot, so **Redo** is
  the same call the other way. Symlinks and dot files are never written. The
  agent gets an `undone` request (host-written, like `saved`) and must not redo
  the change. Local: `POST /api/undo`.
- One module normalises both shapes for every side: `src/schema/handoff.mjs`
  (`normalizeRequestInput`, `normalizeStatus`, `requestId`, `statusCovers`).
  The status is written by an AI, so it is read leniently: unknown fields are
  dropped and a broken file reads as "no status".

Local host: requests are `.studio/requests/<id>.json`; the agent moves the
ones it handled into `.studio/requests/done/`; the status is
`.studio/status.json`. The agent can use the CLI instead of writing JSON:
`studio.mjs <folder> --requests` prints the waiting requests (one JSON per
line); `studio.mjs <folder> --status received|working|asking|done|failed [--request
<id>] [--changed <n>] [--note <text>]` (asking: `[--choice <text>]… [--about
<key>]… [--before <text> --after <text>]`) writes the status, and `done` /
`failed` move the requests up to `<id>` into `done/`.

The shell reaches all of this only through `StudioHost` (`request`, `save`,
`status`); it never assumes local files or the server's stdout.

### 3.5 Ask while playing (2026-10-20)

In ▶ Play the person can ask their AI without stopping the game: **`` ` ``** (the
backquote, by its character: left of 1 on a US keyboard, Shift+@ on a Japanese
one; never with ⌘ / Ctrl / Alt or while the game's own text field has focus)
or a tap on the small mark in the game's bottom-right corner opens one field
over the game; Enter sends and closes it; Esc closes it. WHY that key: it is
the "console" key of PC games, the key players already press to talk to the
game's makers, and games almost never use it for play; WASD, arrows, Space,
Enter, Shift, E / R / Q, Tab, Esc, the numbers and "/" (chat) all are taken.

- **In the game page, not the editor page** (`src/bridge/play-ask.ts`), so it
  works in full screen: a game that goes full screen shows only its own page.
  The overlay is a popover (the browser's top layer, shown again on every
  full-screen change) in a shadow root (the game's CSS cannot reach it). It is
  the first key listener on the window (installed before the game's code), so
  the game never sees the keys typed in the field; a press on the overlay stops
  where it leaves it. A pointer-locked game lets go of the mouse when the field
  opens. The game keeps running the whole time.
- **The moment comes with the words.** A `play` request (`StudioRequestInput`):
  `text`, `shot` (a screenshot of the game as the player sees it — its visible
  canvases and the HTML UI over them, painted in the page's order by
  `src/bridge/play-shot.ts` without the editor's own parts; not drawn: CSS
  gradients, shadows, background images, SVG, pictures from another site;
  ≤ 1024 px wide, JPEG; in Play the edit script asks WebGL for `preserveDrawingBuffer` so
  the last frame can be read), `view` (3D: the player's camera, adapter
  `player()`: `eye`, `target` 10 units ahead), `near` (≤ 12: 3D nearest in front
  of the camera or within 3 units, world distances `d`, ground / sea / sky left
  out; 2D: on screen, nearest the middle; `screen` = where in the picture, 0–1),
  `logs` (≤ 30, oldest first: every console error / warning there is room for,
  uncaught errors and rejections, plus the last 10 lines of any kind, each with
  `ago` seconds), `fullscreen`, `size`. Each part is a hint and is dropped when
  odd (`normalizeRequestInput`), except a `shot` that is not a JPEG / PNG data
  URL (≤ 1.5 MB), which is refused. The host keeps the picture as a file and
  names it in the record (local: `.studio/play/<id>.jpg`, newest 24 kept), and
  prints `studio: request play .studio/requests/<id>.json "<words>" (while
  playing, picture .studio/play/<id>.jpg, 2 errors)`.
- **The AI's progress over the game.** One small line at the top
  (`src/shell/play-ask.ts`, `studio:play/state`): "Your AI is looking" → its
  `working` note → its `done` note with **Reload**, or its `asking` question
  with its choices as buttons (an `answer` request, as in §3.4), or "Your AI
  gets it on its next run" when nothing can reach it. Violet dot, the AI's
  colour; it pulses while the AI has it. **The game is never reloaded under the
  player**: `reloadDecision` says no while playing; Reload (or `` ` `` then Enter
  on the empty field) opens the game again from its new code, still in Play;
  × keeps playing as it is. The fix is also in the next time Play or Edit opens.
- Messages: bridge → shell `studio:play/hello` (the game page can take a
  request), `play/ask`, `play/answer`, `play/reload`; shell → bridge
  `studio:play/on` (`lang`, the overlay's `words`: the bridge has no strings),
  `play/state`, `play/sent`. Nothing is shown until `play/on`, which the shell
  sends only when an AI is behind the host: **the offline web demo shows no
  field and no mark** (a field that cannot send is a promise the demo can't keep).
- **What each engine gives.** The words, the picture and the console come from
  the page and work for every game with a canvas (three.js, Phaser, Pixi,
  plain canvas, Godot web; a game drawn only in HTML sends no picture). Where
  the player is and what is near depend on the adapter: three.js (built in)
  gives the player's camera and what is near it in world units; 2D adapters
  (Phaser, Pixi, canvas, Godot through a 2D port) give what is on screen
  through `anchor()`, nearest the middle; an adapter of your own can add
  `player()` for a 3D engine. A canvas that holds pictures from another site
  without CORS cannot be read: then no picture, the rest still goes.

#### 3.5.1 Pause to edit: the paused moment (2026-10-22; the moment is the editor since pause-edit, 2026-10-28)

A request of 2026-10-28: "pause in the middle of a scene and give instructions, by hand or to the AI" — the paused
moment is the editor. Until then a pause opened a chat panel over the game ("Pause and talk",
2026-10-22) with "✥ Move" in it (stage 2, the old §3.5.2); both are gone.

- **The way in**: **P** in the game (by the character or the key, never with a modifier or while typing), the editor's
  top-bar **❚❚ Pause to edit P** (left of Edit, every width — `studio:play/pause`), or in the game's own full screen
  the corner's ❚❚ (the top bar is not seen there; the corner shows nothing out of full screen). The first ▶ Play of a
  person shows one line under ❚❚, "Pause anytime to edit that very moment" (gone at the first pause or after 8 s, once
  per person: `prefs.seen` `pause-tip`). The offline web demo pauses too (`play/on` `ai: false`: no ✦ field there).
- **The hold** (`src/bridge/play-pause.ts`): the frames freeze (core time, as in Edit), the game's clock stops
  (`src/core/play-clock.ts`: the paused time is taken out of `performance.now()` and the frame timestamps, so Resume
  steps one frame, not the whole pause), its `setTimeout` / `setInterval` wait and fire after the time they had left
  and `Date.now()` leaves out the paused time (`src/core/play-timers.ts`), its AudioContexts are suspended and its
  playing `<audio>` / `<video>` paused. No key press or pointer reaches the game; key releases do (a key held at the
  pause does not stay down). The studio's own timers use the browser's (`src/core/native.ts`). Not held: `new Date()`,
  promises and microtasks, `requestIdleCallback`, a Worker's own timers. A pointer-locked game lets go of the mouse.
- **The moment** (`src/bridge/play-ask.ts` pauseNow): the picture of the frame it stopped on is taken (with the camera,
  what was near, the console: `play/paused` `ask`, the first request of the pause carries it), full screen is left (one
  frame drawn again with time stopped), and the editor wakes over the frame **without putting anything back**
  (`src/bridge/play-move.ts` MomentHost): an edit page that became Play wakes its own editor (`core/edit { on: true,
  moment: true }`, play-switch.ts `momentHost`), a page opened for Play (Play from the start, the AI's Reload) makes a
  paused editor whose messages go to the editor page (not `core/view-state`). Either way the editor is
  `EditorDeps.paused`: the player's view kept (no saved edit camera, no "everything in frame"), the game never let run
  (no watch), no self-check, key releases passed on, the game's screen and looks untouched; its `core/ready` says
  `moment: true`. The editor page shows Edit's tools on it: the list floating over the game's top left (the game keeps
  its size: the frame does not move; ‹ folds it), the card, the strip, the field at the foot, Undo / Redo, Save. No
  timeline, no Library, no Motion row on the card. The game's HTML UI (a score, the time left, a banner, a title) stays
  **seen as it was and takes no pointer** (pause-edit fix 1, 2026-10-28; it was hidden as in Edit, and the moment read
  as "the score is gone"): `begin({ moment: true })`, and the editor's layer style takes the pointer only. It is not
  edited there (no UI layer: the UI is edited in Edit). No line by the strip about what the game moves ("a move here
  sets where it starts"): the card's "Just for this moment" is the one place.
- **What each object is** (`momentWhy`, sent as `play/paused` `why`): **placed** (absent) — moved as in Edit:
  `studio:placement/moved` into the scene, Save · N, ⌘Z, the list's dot; it stays after Resume and is there back in
  Edit. **The game moves it** (`game`: moved by itself since Play started, or since the person last left it), **a
  motion moves it** (`motion`), **the game made it** (`new`: not there when Play started — a boss, a bullet): **just
  for this moment** — only the game page's object moves (never the scene: no Save · N); the card says so, with Revert
  (back to where it was at the pause) and no Copy / Delete (the game's code would still hold it). The list puts what
  the game made under "**Made by the game**" with how many on its right (one row per name, "drone" with 2), and what
the game moves has a small ↻ on its row ("Moved by the game"). On a phone / the side window, while the card is folded
away, one line right over the field says "Just for this moment" (and ✦, below). On what the game made, once moved,
  the card's **✦ Have {ai} make it appear here** puts the draft "Make boss appear here" and the chip "boss · here" in
  the field; sent, the request carries `made: true` and `here: { key, label, at, to, time }` (where it was at the
  pause, where it was put, the game's time since ▶ Play), and the AI changes where the game makes it (SKILL.md
  "Paused"). The reply on the line: no "N objects changed" for a `made` request (the AI's count is of the code it
  changed); when the game's code changed (`--changed` > 0, or the files say so), **Reload** on the line — a new page
  of the game from its new code, still in Play (Save · N stays); back in Edit a finished reply of the moment leaves the
  line.
- **⌘Z**: every step in the moment undoes while paused (the moment's own are `{ kind: 'moment' }` changes: the game
  page's pose only). **▶ Resume** takes those out of the history (`UndoStack.dropMoment`: that moment is gone); the
  placed things' steps stay, as in Edit.
- **The field** (the editor's one field at the foot, "Ask {ai} about this moment…"): each message is a `play` request
  with `paused: true`; the first carries the moment (`shot`, `view`, `near`, `logs`, `size`), the next ones `chat` (the
  first one's id) and `history` (≤ 12 turns). The AI's replies are its status notes, on the line over the field as in
  Edit; the earlier turns of the pause under "▴ Earlier · N". The host keeps the talk as `.studio/chat/<first id>.json`
  (`{ version, id, at, paused, shot, view, near, logs, size, turns: [{ who: "you" | "ai", text, at, request, state?,
  changed?, choices? }] }`). The line reads `studio: request play <path> "<words>" (paused, chat .studio/chat/<id>.json,
  picture …)`. Words typed in the ✦ field over the game when it paused go on in the field.
- **The ways out**: **▶ Resume** (P, the top bar) — the editor is put away, the game goes on from that frame with
  what was moved where it was left (the score, the timers, everything the game made as they were); "Resumed from
  0:42.3" at the game's foot. **Edit** — the scene before Play (§3.5.3), with the placed things moved in a moment.
  **Play from the start** (⌘K) — a new page. Escape does not resume (it drops the tool, then the pick, as in Edit).
- **Speed and Next frame** (pause-edit decision 10): the top bar's **1× ⌄** (1× · ½× · ¼×, `studio:play/speed`) while
  playing and paused: the game's clock runs at r × (play-clock.ts `setRate`: each change starts a piece from where the
  game's time is, so it never jumps), its frames run on 1 of every 1 / r browser frames (`core/time.ts` `frameGate`),
  its timers wait 1 / r as long — a game that moves by the time between frames and one that moves a fixed step each
  frame are both r × as fast (the picture steps at 15 frames a second at ¼×). Slower than 1×, the sound is quiet (an
  AudioContext's speed cannot be set from outside; `<audio>` started meanwhile waits too). Every ▶ Play starts at 1×.
  **▶| Next frame** (the top bar, the `.` key, ⌘K; paused only — `studio:play/step { on }`): the stopped clock 1/60 s
  on (its timers too: what falls due runs), the game's frame once (`time.step()`); held, on at the speed. No step back
  (Studio keeps no earlier moment).
- **The clock in the top bar**: "● Playing 0:41.8" / "❚❚ Paused 0:42.30" — the game's own time since ▶ Play
  (`studio:play/time { t, rate, running }`, sent at Play, pause, resume, a speed, a step; the editor page moves it on
  in between). Paused it has two places (one Next frame shows); a phone while playing whole seconds. ▶ Play from Edit
  in the same page (the same game going on) goes on from the last Play's time; a new page starts at 0:00. The first
  pause of a person hangs "Next frame ." under ▶| once (`prefs.seen` `step-tip`).
- **The AI's hands in a paused moment** (§3.6): done on the moment, not back in Edit first.
- Messages: shell → bridge `studio:play/pause { on? }`, `studio:play/speed { rate }`, `studio:play/step { on }`,
  `studio:play/on { …, ai? }`, `studio:core/edit { on, moment }`; bridge → shell `studio:play/paused { on, edit, why,
  ask, draft }`, `studio:play/time`, `studio:core/ready { moment }`; `play/ask` carries `paused`, `chat`, `history`;
  `play/sent` carries the kept request's `id`. Tests: `test/pause.test.ts`, `test/studio-pause.browser.mjs` (`moment`
  on `examples/three-neon-boss`).

#### 3.5.2 (Move things while paused — since pause-edit, 2026-10-28, part of §3.5.1)

The paused panel's "✥ Move", M, "Put in layout" and "Only in this play" are gone: in the paused moment a placed thing
moves as in Edit (the call made 2026-10-28), and what the game moves or made is "Just for this moment" (§3.5.1).

#### 3.5.3 Play and Edit in the same page (2026-10-22, fast switch)

- ▶ **Play** no longer opens the game page again: the edit page itself becomes
  Play (`studio:core/play { on: true }`, `src/bridge/play-switch.ts`). The
  editor puts its tools away (as `core/edit` off: the game's own camera and HUD,
  no handles), the draft's motions start, the game's frames, clock and sound go
  on, and the page says `studio:play/hello` — ask, pause and move work as on a
  Play page. **Edit** (`on: false`) holds the game as a pause does, puts every
  object back where Play found it and brings the editor back on the same
  camera, pick, timeline and level, with no loading.
- **Where Play starts**: from the edit layout (unsaved changes included). What
  the game moved while playing (the player, an enemy, the camera) is not kept:
  Edit always shows the layout. What does not go back is the game's own state
  that is not an object's pose (a score, a timer, health, things it made or
  removed); **Play from the start** (⌘K, Play's ▾) opens a new Play page as
  Play always did.
- The edit page's game clock stops with every hold of the game
  (`core/time.ts` `clock`), so the first frame of Play steps one frame, not the
  time spent editing.
- **The third shape, `moment`** (pause-edit, 2026-10-28; §3.5.1): a pause while this page plays wakes its editor over
  the paused game with `core/edit { on: true, moment: true }` (play-switch.ts `momentHost`) — Edit's tools, but nothing
  goes back to where Play found it, the camera stays the player's, the game is held by the pause. Resume puts the
  editor away (`core/edit { on: false }`) and the game goes on; Edit (`core/play { on: false }`) ends the moment first
  (play-ask sleeps: the editor away, `play/paused { on: false }`), then everything goes back as above — a placed thing
  moved in the moment is the editor page's change (Save · N) and comes back with it. Every ▶ Play starts at 1× speed.
- **Motions** (studio-no-reload, 2026-10-22): the draft's motions play in the
  same page, every `when` included (a key, a click, an area, another motion's
  end, a cue, the game's `playMotion()` / `cue()` / `touch()`). The game's own
  copy of the loader runs them through its play hook: `studio-placement.js`
  adds `{ has, start({ motion, motions }), stop() }` to the global set
  `Symbol.for('game-studio.play')`, and the copy that placed a world (the
  game's) answers `has()`; the editor page says so in `core/ready`
  (`motionHere: true`). `core/play` carries `motions` (the Library's, for the
  clips' `use`). Edit stops them before every object goes back. What the loader
  does not move (a game without it, a copy the editor made) the editor's own
  runner moves (`play-arrange.ts` moveInPlay: the start, a time, a key, another
  clip's end).
- **The game's copy of the loader** (integrate 1023, 2026-10-23): a game keeps
  the copy it was given, and an older one has no play hook. The local server
  (`src/server/loader-copy.mjs`) answers a request for the game's copy with
  its own loader (the one its editor was built with), so the edit page and
  every Play page it opens run the current loader. The file on disk is never
  changed (outside the editor the game runs its copy). A file is taken for a
  copy when all three hold: its name is `studio-placement.js` (any folder of
  the game, at most 512 KB); its first line starts with one of the loader's
  headers — `// KUMODeck Game Studio placement loader` (the built file, every
  version) or `// studio-placement.js: apply placement.json` (the source in
  `src/loader`); and it has `export async function applyPlacement(`. Anything
  else with that name goes out as it is. Every export of an older copy is in
  the current loader (exports are only ever added), so the game's imports keep
  working.
- A new Play page is still opened when the page's editor is not up (loading, no
  adapter, a soft reload under way), and when a clip waits for what only the
  game's loader sees (a click, an area, a touch, a cue, the game's code) while
  the page's loader has no play hook (`motionHere` absent;
  `src/shell/play-here.ts`): a host that serves the game's own older copy as it
  is (the local server no longer does, above). `studio:play/reload` (the AI's fix) and
  **Play from the start** open a new Play page; Edit after a new Play page opens
  a new edit page, as before (a Play page has no editor: the bridge starts one
  only in a page opened with `studio=edit`).
- Screen tests: `__gameStudio._debug` is absent while the page plays (as on a
  Play page), and `_play.playing()` says whether it plays.

### 3.6 The AI's hands: editor work done by the AI (`--do`, 2026-10-24)

A request (2026-10-24): "I asked Claude, and it asked me to do the Studio's hand work. That is the worst experience." The
AI had answered "take the motion off" with four steps for the person to click, and made a spiral by writing it into the
game's code (not on the timeline, fighting the editor's motion, "press Reload"). Now the AI does editor work itself:

    node studio.mjs <game folder> --do <op> [--<field> <value> …]        one op (numbers and lists as JSON)
    node studio.mjs <game folder> --do '<op JSON>' | '[<op JSON>, …]'    one or several (one ⌘Z for all)

- **An editor page open** (the server running and a page connected to `GET /__studio/api/hands`): the CLI posts the ops
  to `POST /__studio/hands` with the folder's secret; the newest page does them with its own edits (`src/shell/ai-hands.ts`:
  the timeline's attach / detach / delete / make, the card's pose, Rename, Duplicate, Delete, Drop to floor, the
  levels' New / Duplicate / rename / switch, Save) — on screen at once, ONE undo step for the job (`UndoStack.begin` /
  `end`, the entry's `ai` = its words for the Undo tooltip), counted on Save · n, its draft written as for any edit,
  and one line over the ask bar with the AI's name: "Claude took “Row” off Blue pillar · ⌘Z undoes it" (`by` = the
  CLI's environment, `src/server/which-ai.mjs`). A page that is playing goes back to Edit first — but not a paused
  moment (§3.5.1, pause-edit 2026-10-28): there the ops work on the moment, as the person's hand does (`list` lists the
  moment's objects, what the game made too; `object.move` of a placed thing goes in the scene, of what the game moves
  or made just for this moment, one ⌘Z step either way). The UI layer goes to the world — except a job of `ui.*` ops
  (with `list` / `save`), done on the UI layer. Jobs run one at a time, in order. A page whose stream just dropped (a reload) is waited for 6 s.
- **No page open** (not started, or started with no page): the CLI applies the same ops to `placement.json`
  (`src/schema/hands.mjs` applyHandsToFile), checks the result with the file's validator, and writes it (nothing when
  it would not be valid). What only the game knows is refused with the reason (Drop to floor, a blank New level,
  switching the level, `by` amounts for an object the file has no pose for).
- **A page open that does not answer** in 20 s: nothing is written (the page may still do it); the CLI says so (exit 1).

stdout, one line per op: `studio: did <what it did> - in the editor (on screen now; ⌘Z there undoes it)` or
`- in placement.json (…)`; `studio: do failed <op> - <why>` (the other ops are still done); `studio: list {…}` for
`list`; then, with the editor running, the reply line (`studio: reply with this link …: <url>`). Exit 0 = every op done,
1 = one or more failed, 2 = the ops did not read.

| Op | Fields | Editor | No editor (placement.json) |
|---|---|---|---|
| `list` | — | Every object of the level on screen: `key`, `name` (what the person sees, `names.ts`), `p` (where it stands in the editor now, saved or not: cm / whole px; studio-code-torule), `motions`, `unstable`, `ground`; the Library's motions with `on` (a motion of points: its `keys.p`; a code motion: `code`, `knobs` with `v` now and the code's, `round`, `note`, `game`, or `missing`); the code layouts (`places`: `id`, `name`, `keys`, `knobs`, `drag`, `pins`, `hand`, `avoid`, `skipped`, `from`; a layout the file changes but the game lacks: `missing`); the levels; the UI (`ui`: each element of the UI layer with `p`, `s`, `set`; a codeUi with `code`, `kind`, `box`, `codeAt` and `write`: the `at` / `scale` to write on Save; `uiClash`) | The objects the file has entries for, the Library (code motions with `code` / `knobs`), the layouts the file has `places` for, the levels, the file's `ui` |
| `motion.make` | `name`, `points` \| `keys`, `len` (default 2), `repeat`, `ease` (default linear for points), `key`, `when`, `until`, `replace` | A Library motion (`hands.mjs` handsMotion: points spread evenly over `len`, checked with the validator) and, with `key`, the object's clip (`timeline-wire` handsMake); one undo step | `motions` + `motion.<key>.clips` |
| `motion.attach` | `key`, `name`, `when`, `until` | `timeline.attach` (+ when / until) | a clip `{ use, when }` |
| `motion.detach` | `key`, `name` \| `all` | `timeline.detach` ("Remove from this object") | the clip out |
| `motion.delete` | `name` | `timeline.deleteLib` | out of `motions` and every `motion` |
| `motion.rename` | `name`, `to` | `timeline.renameLib` | `motions[].name`, every `use`, every `after` |
| `motion.set` | `name`, `repeat`, `len` (stretches the keys), `key`, `when`, `until`, `knobs` (a code motion's: `{ "radius": 3 }`), `off` (with `key`) | `handsClipSet` / `handsLibSet`; knobs → `{ v, was = the code's }` (one back on the code's number leaves the file) | the same fields; `knobs` refused ("change the number in the codeMotion() directly"); a code motion's `len` / `repeat` refused |
| `motion.code` | `code`, `name`, `key`, `when`, `until`, `replace` | The page's code motions (`studio:code-motions`); an id it lacks → the game is read again first, still lacking → `the game has no codeMotion('wave') (it has: 'spiral')`. A Library motion `{ name, code }` (the same code already there = that motion), on `key` starting with the game; `replace` = the motion of points called `name` becomes it — ✦ Turn into a rule (studio-code-torule): its points kept to compare until Save, and the rule measured against them over one round at 64 places (`studio:timeline/code-points`): the line ends `; the editor measured how close it is: the largest gap is 0.12 m at 0.8 s of a 2 s round (…)` | `motions` `{ name, code }` + the clip |
| `place.code` | `id`, `replace` (keys) \| `fold` (`side` … `move`, `offsets`, `pins`, `avoid`, `knobs`, `from`, `all`; a list or `"side,pins"`) | The page's layouts (`studio:code-places`, read again when missing: `the game has no codePlace('lamp') (it has: 'hex')`). `replace` → `places[id].from` (the hand-placed ones hidden; one undo step); without it nothing changes (the line names the layout; no ⌘Z). ✦ Turn into a rule (studio-code-torule): where each replaced object stood is read before the game is read again, and compared with the rule's object of the same number (`replace[i]` ↔ `<id>-<i+1>`, the whole distance): the line ends `; the editor measured how close it is: the largest gap is lamp-3 ↔ lamp-row-3, 0.62 m (6 of 6 compared)`, the person's says "Max deviation: lamp-3 (0.6 m)". `fold` (studio-writeback, §1.12 "Written into the code"): those parts out of `places[id]` and of what is saved (no Save count, no ⌘Z, out of the undo history), the game read again, every object measured against where it stood: `; the editor measured every object before and after: all within 1 cm — the look is the same` or `…: the farthest off is lamp-row-3, 0.4 m (it stood at […], now […]) — fix codePlace('lamp-row') …`; a later `place.code` without `fold` measures against the same before until it matches. A knob the AI added lights on the card | `fold`: those parts out of the file (nothing measured); `from`, and those keys out of `objects` / `added` for `replace`; without either nothing |
| `place.set` | `id`, `knobs`, `pin` (`{ key, p, r?, s? }`), `unpin` (a key, or `"*"` = every one placed by hand), `hand`, `offsets` (≤ 8; a jitter row gets a `seed` when it has none) | `places[id]` (knobs `{ v, was }`, a pin of one of its objects, `unpin: "*"` = all its pins off — the card's "All back to rule", `hand: true` = every object's place now as pins, `false` = back to code); one undo step, the game reads the draft again | `pin` / `unpin`; `knobs` / `hand` refused (they need the game) |
| `place.avoid` | `id`, `code` (+ `knobs`, `off`) \| `box` (+ `name`) \| `remove` (index or code id) | `places[id].avoid` (a condition the page must have: `codeAvoid`; a box named "Box n" when unnamed; one of the code's own conditions back on with nothing changed leaves no entry) | the same; `knobs` refused |
| `object.move` / `turn` / `scale` | `key`, `to` \| `by` (`deg`) | as the card's numbers (one pose change). A rule layout's object (not by hand) is refused: `lamp-row-3 is placed by codePlace('lamp-row') (its rule) and stays in it: …` with the `place.set` ways (studio-to-coords) | `objects.<key>` (`by` needs its pose in the file) |
| `object.rename` | `key`, `to` | Rename (F2) | `names` |
| `object.duplicate` | `key`, `to` \| `by` | ⌘D (the game page makes the copy) | `added` |
| `object.delete` | `key` | Delete | `removed` |
| `object.ground` | `key` | Drop to floor (End); a rule layout's object refused as `object.move` | refused |
| `level.new` / `level.duplicate` | `name`; `id` | New level / Duplicate, opened | duplicate: a level with `from`; new: refused |
| `level.rename` / `level.switch` | `id`, `to`; `id` | the levels' menu | rename: `label` / `labelWas`; switch: refused |
| `save` | — | the person's Save (only when they ask the AI for it) | nothing to do |
| `editor.reload` | `editor` | the game page (`softReload`), or the editor page itself | refused |
| `ui.code` | `id` (`"a"` or `"a,b,c"`: codeUi ids) | The game read again (always: the code changed), the UI layer shown, each id in the page's `studio:ui/codes` (`the game has no codeUi('x') (it has: …)`; an id an HTML key takes: said so), then each box measured (§1.13): `do failed ui.code hp-bar - moving it 40 px changed nothing on screen: …`. No undo step | nothing (said in the line) |
| `ui.set` | `id` (a UI key), `p` (CSS px offset; with `from`: the at() numbers from that place — a codeUi's units, an HTML element's CSS px of the window, stage 3), `s`, `set` (the card's look); or `clear` alone | the UI layer: the pose (one undo step on the UI layer) and each look path as the card's row; `clear` = the entry out of the file and of what is saved (`PlacementModel.settle`, `UiStyleModel.forget`: no Save count, no ⌘Z), the page drawing it as its code does (`studio:ui/code-clear`) | `clear`: the entry out of `ui` (`uiView` too when empty); anything else refused |
| `ui.theme` | `id` (`--accent`, or a codeTheme key `accent`), `v`; or `clear` alone | a Theme row (a CSS variable of the page or a codeTheme, §1.13): `v` as the row (one undo step, counted); `clear` = out of the file's `theme` and of what is saved (`UiStyleModel.forgetTheme`: no Save count, no ⌘Z) — the AI wrote it into the code | `clear`: out of `theme`; `v` refused |

A motion `motion.make` puts on an object starts with the game unless `when` says otherwise (`HANDS_MAKE_WHEN`: the
person asked for it to move now; the editor's attach rule, "after its last motion", never comes after a motion that
loops). `motion.attach` without `when` follows the editor's attach rule. `when` takes the file's object (or a list), or a short word: `start`, `click`, `touch`, `key:E` (`KeyE`), `time:2`,
`after:Hop`, `cue:<name>`, `say:<words>`. `until`: `{ times }` / `{ cue }` / `times:3` / `cue:<name>` / `null`. An unknown
op or field is an error (an AI's typo fails loudly). At most 50 ops a call. Tests: `test/ai-hands.test.mjs` (ops, the
file, the relay, the CLI), `test/ai-hands-shell.test.ts` (the editor's runner, one undo step),
`test/studio-ai-hands.browser.mjs` (a real editor: the card loses the motion, ⌘Z brings it back, a spiral from points;
`--only code`: a code layout and a code motion in Neon Run — studio-code-base, 2026-10-24).

---

## 4. Result files

Validated by one module, `src/schema` (`validatePlacement`, `validateLibrary`,
`stringifyResult`), used by the server, the shell and later the cloud.

### 4.1 placement.json

```json
{
  "version": 1,
  "tool": "placement",
  "dim": "3d",
  "space": "local",
  "objects": {
    "tree-01": { "p": [3.25, 0, -4.1], "r": 1.5708, "s": 1.2,
                 "was": { "p": [2, 0, -4.1], "r": 0, "s": 1 }, "label": "tree-01" },
    "path:0/3/1": { "p": [0, 1.5, 0], "unstable": true, "was": { "p": [0, 1, 0] } }
  }
}
```

- 3D, optional: `"t": [x, z]` on an object (and in `was` / `added`): the tilt,
  `rotation.x` / `rotation.z` in radians (2026-10-16, "tip forward / sideways").
  Reported whenever the object is tilted at all; absent = leave the game's own
  x / z rotation as it is, so files and games without tilt read and apply
  exactly as before. Refused for 2D (one angle, `r`).
- 2D, optional: `"order": [{ "in": "stage", "keys": [...], "was": [...] }]`
  — draw orders the person changed, `keys` back → front, `was` the game's
  own order; only lists that differ from `was`; entries sorted by `in`, key
  lists kept in their order (§1.7). Refused for 3D.
- Optional (§1.8): `"added": [{ "key": "crate-5", "from": "crate-1", "p": […], "r", "s", "label"? }]`
  — copies, in the order they were made (a copy of a copy after its
  original; never also in `objects`) — and `"removed": [{ "key", "label"?,
  "was"?, "unstable"? }]` — deleted objects, sorted by key. The AI adds and
  removes them in the code. Until then the loader makes each copy from its
  `from` object (skipped when the game already has `key`) and hides each
  deleted object still standing at `was.p` (2026-10-16).
- Only moved objects are written. `was` = pose before the first edit: the AI
  searches the code for those literal numbers to find the line to change.
- Limits (`LIMITS`): ≤ 500 objects; |value| ≤ 10 000 (3D) / 100 000 px (2D);
  rounded to 1 mm / 0.1 px / 1e-4 rad; keys sorted (same content = same
  bytes); `__proto__`/`constructor`/`prototype` keys rejected; ≤ 64 KB.
- Optional (UI stage 1, 2026-10-19): the game's UI moved in the editor's UI
  layer (§1.1), by `data-studio-key`:

  ```json
  "ui": {
    "title-card": { "p": [0, -48], "s": 1.2, "label": "Glow Garden" },
    "score":      { "p": [-12, 8] }
  },
  "uiView": [1280, 800]
  ```

  `p` = `[dx, dy]` CSS px from where the game's own CSS puts the element (the
  CSS `translate` it gets: `[0, -48]` = 48 px up); `s` = CSS `scale`, absent
  = 1; `label` = its text (first 40 characters), a clue for the AI. No `was`:
  the original is always `p [0, 0]`, `s 1`, and the key finds the element.
  `uiView` = the game's size in CSS px at the save (for turning px into `%` /
  `vw`); only with a `ui`. `dim` stays the world's (`"2d"` with `objects: {}`
  for an HTML-only game). Limits: ≤ 200 elements, |p| ≤ 10 000 px, `s`
  0.1–10, 0.1 px / 1e-4. Both fields are absent when nothing in the UI moved
  — always for a game without `data-studio-key` — so such files are byte for
  byte what they were. `studio-placement.js` applies `ui` before `objects`,
  whatever the world's `dim`, also to marked elements the game adds later
  (`applyPlacement(document, url)` = the UI only); `report.ui = { applied,
  missing }`.
- Optional (studio-canvas-ui, 2026-10-24; §1.13): a UI drawn in the canvas has `code` (its codeUi id = the entry's key)
  and, when it moved or grew, `from` (one of the 9 places) with `at` (2 numbers, the code's units, ±10 000): the loader
  places it by them (`p` = the editor's offset, read by the editor only). `"hp-bar": { "code": "hp-bar", "p": [389,
  -40], "s": 1.4, "from": "top", "at": [0, 16] }`. Since studio-canvas-ui-3 an HTML element that moved or grew has
  `from` / `at` too (no `code`): the nearest place of the game's window and its CSS px from there — the loader still
  places it by `p`; the AI writes its CSS by them on Save (`"pause-button": { "p": [-900, 0], "from": "top-left", "at":
  [20, 14] }`). A file written before has neither: the same bytes.
- Optional (UI stages 2–3, 2026-10-22; §1.11): per `ui` entry, `screen` (the
  element's `data-studio-screen`), `set` (what the card changed: `text` ≤ 200
  characters, `fontSize` 1–500 px, `color`, `background`, and per state
  `"@hover"` / `"@active"` / `"@disabled"`: `{ color?, background? }`) and
  `setWas` (the game's own values of the same fields; only with `set`). An
  element whose look changed but which did not move has `p: [0, 0]`. At the
  top, `theme`: `{ "--glow": { "v": "#7fd1ff", "was": "#ffcf6e" } }` (≤ 100,
  names `--[A-Za-z0-9_-]`, values ≤ 200 characters without `; { } < >`).
  Colours are `#rgb`…`#rrggbbaa`, `rgb()` / `hsl()` with numbers, or a colour
  word (≤ 64). All absent when nothing changed: older files keep their bytes.
  `studio-placement.js` applies them: the theme on `<html>`, the text and its
  size / colour on the text, the fills and a state's colours in one style
  sheet (`#studio-ui-set`). Sample values are never written.

- Optional (§1.9; motion-gui, then the timeline, 2026-10-22): objects that move by themselves, by key (a game object
  or an `added` copy; never a `removed` key), each with its named motions (`clips`):

  ```json
  "motion": {
    "rowboat": { "clips": [ { "name": "Row", "len": 4, "repeat": "pingpong", "start": true, "keys": {
      "p": [{ "t": 0, "v": [0, 0, 0] }, { "t": 2, "v": [-3.1, 0.8, -1.2] }, { "t": 4, "v": [-6, 0, 0], "ease": "linear" }] } } ] },
    "door": { "clips": [ { "name": "Open", "len": 1, "when": "when the player walks up to it", "keys": {
      "r": [{ "t": 0, "v": [0, 0, 0] }, { "t": 1, "v": [0, 1.5708, 0] }] } } ] }
  }
  ```

  `clips` = 1–16, names unique (≤ 40 characters). `len` = seconds (0.1–600): where a `loop` starts again, a
  `pingpong` turns, a `once` (the default) ends and stays. `start: true` = plays as the game starts (one per object);
  without it the clip waits for a cue (`playMotion`), `when` = the person's words for the AI (≤ 200). `keys.p` / `r` /
  `s` = 1–256 keys each, in time order, one per moment, `t` ≤ `len`: `p` added to the position (3D [x, y, z] m, 2D
  [x, y] px), `r` added to the angles (3D [x, y, z] rad — y the card's Angle, x / z its tilt; 2D [angle]; |v| ≤ 1000),
  `s` multiplying the size. `ease` = how the key goes on to the next: `linear`, `ease` (default: slow in and out),
  `step` (holds, then jumps). The position goes through its keys on a curve (Catmull-Rom); a `step` key breaks it.
  Rounded like poses (1 mm / 0.1 px, 1e-4 rad and size, 1 ms). A property without keys is left as the game puts it.
  Absent when nothing moves: older files are byte for byte the same.
  The older shape (motion-gui, v0.1.13) is still valid and played: `path` (1–32 offsets), `speed`, `repeat`, `spin`
  (rad/s); never next to `clips`. The editor reads it as one clip "Motion" (`start`) and writes clips at the next Save.
  The loader plays both from the game's frames, reports `report.motion` (keys) and exports `clipAt(clip, t)`,
  `trackAt`, `motionAt` (the older shape), `playMotion(key, name)`, `clipOf(key, name)` and `stopMotion(key?)`.
- Optional (§1.9.1, studio-motion-triggers, 2026-10-22): **`motions`** — the Library's motions, at the top (also with
  `levels`), 0–64, each `{ name, len, repeat?, keys }` (a clip without "when"; names unique). Since then the editor
  writes every object clip as an attachment:

  ```json
  "motions": [{ "name": "Hop", "len": 0.6, "keys": { "p": [{ "t": 0, "v": [0, 0, 0] }, { "t": 0.3, "v": [0, 1, 0] }] } }],
  "motion": {
    "crate": { "clips": [{ "use": "Hop", "when": { "on": "key", "key": "KeyE" }, "until": { "times": 3 } }] },
    "chest": { "clips": [{ "name": "Open", "use": "Hop", "when": { "on": "cue", "cue": "chest-opened" }, "until": { "cue": "chest-closed", "then": "reset" } }] }
  }
  ```

  A clip with `use` has only `name?` (when it differs: `playMotion(key, name)`), `use` (a name in `motions`), `when`,
  `until`. `when.on`: `start` · `time` (`after` s, ≤ 600) · `key` (`key` = KeyboardEvent.code) · `click` · `after`
  (`use`, `key?`: another clip ended) · `enter` (`area: { p, size }` in world units, `who?` = the key of who walks in) ·
  `touch` · `cue` (`cue` = `^[a-z0-9][a-z0-9-]{0,39}$`) · `say` (`say?` = words for the AI, ≤ 200). Absent on a `use`
  clip = `start`. `until`: `times` (1–1000 rounds: a loop's len, a pingpong's there and back), `cue`, `then: 'reset'`
  (back to its first pose; default stays). The first shape (keys inside, `start: true`, `when` as words) is still valid
  and played. The loader runs start / time / key / click / after / enter by itself (`motionRunner`, shared with the
  editor's Try) and exports `cue(name)`, `touch(key)`, `setPlayer(obj)` for the rest; `report.motionWaits` lists the
  clips that wait for the game's code.
  Since studio-timeline-2 (§1.9.2): `when` may be a list of 2–4 (any one starts it); a position key may have `in` /
  `out` (its path handles, the units of `v`; both 0 = a corner); a Library motion may have `tracks` (object key → keys,
  1–16) instead of `keys` — a scene motion, whose objects all start together.
  Since studio-code-base (§1.9.4, 2026-10-24): a Library motion may be a **code motion** `{ name, code, knobs? }` —
  `code` = a `codeMotion()` id (`^[a-z0-9][a-z0-9-]{0,39}$`), no `len` / `repeat` / `keys` / `tracks` (an entry with
  both is refused), `knobs` = 1–3 `{ "<name>": { v, was? } }` (name `^[A-Za-z][A-Za-z0-9_]{0,23}$`, |v| ≤ 10,000,
  rounded to 1e-4). A clip may have `off: true` (switched off: it stays and does not play).
- Optional (levels, 2026-10-22, §1.10): a game with several levels.

  ```json
  "objects": {},
  "levels": [
    { "id": "meadow", "label": "Meadow", "objects": { "rock-1": { "p": [2, 0, 1], "was": { "p": [0, 0, 1] } } } },
    { "id": "cave-2", "label": "Crystal Hall", "from": "cave" },
    { "id": "summit", "label": "Top", "labelWas": "Summit" }
  ],
  "levelsWas": ["meadow", "cave", "summit"]
  ```

  `levels` in the person's order; each has its own `objects` / `added` /
  `removed` / `order` / `motion` (same rules as the top; `objects` left out
  when empty), and the top `objects` is `{}` with no `added` / `removed` /
  `order` / `motion` (a motion's keys are that level's objects; integrate3,
  2026-10-22).
  `from` = made in the editor, built from that code level (must be one of
  the code's). `blank: true` (only with `from`; studio-blank-level,
  2026-10-23) = made with New level: an empty level, only the ground, sky
  and lights stay; while the code does not build it the editor hides every
  other object the game lists on its page, wherever the game moves it and
  whatever it makes later (`removed` lists what was seen go).
  `labelWas` = the code's name after a rename. `levelsWas` =
  the code's ids in its order, written only when the list differs from it
  (an id missing from `levels` = deleted). `ui` stays at the top (shared by
  every level). ≤ 100 levels. The loader applies a level only when given
  `{ level }`; `placementForLevel(file, id)` gives one level's view. Absent
  for a game with one level: its file keeps its bytes.
  `levelsWas: []` (studio-uniforms, 2026-10-23) = the code has **no** levels
  yet: the person made Level 2 in a game without them ("Levels ⌄ → Make Level
  2"). Its levels without `from` (`level-1`) are the game as it is, and a
  `from` may name one of them. The loader called without `{ level }` then
  applies the URL's `studioLevel` inside the editor's frame and the first
  level without `from` anywhere else (the shipped game keeps its layout until
  the AI adds `studio.levels()`).
- Optional (studio-uniforms, 2026-10-23): `"names": { "crate-2": "Hero
  crate" }` — names the person gave objects in the editor (Rename, F2; done
  in place, not asked of the AI), object key → name (≤ 120 characters,
  control characters dropped). The editor shows them everywhere at once; the
  AI renames each object in the code and takes its entry out. With `levels`,
  each level has its own `names` and the top has none. Absent = nothing
  renamed (the file keeps its bytes).
- Optional (studio-code-base, 2026-10-24, §1.12): **`places`** — what the person changed of the game's code layouts,
  by `codePlace` id (`^[a-z0-9][a-z0-9-]{0,39}$`), ≤ 64. With `levels`, each level has its own and the top has none.

  ```json
  "places": {
    "hex":     { "knobs": { "gap": { "v": 4, "was": 6 } }, "pins": { "hex-3": { "p": [-3.1, 0.95, -19] } } },
    "crystal": { "avoid": [ { "name": "Box 1", "box": { "p": [-8.6, 0, -17], "size": [3.2, 2, 5] } },
                            { "code": "road", "off": true },
                            { "code": "near-player", "knobs": { "r": { "v": 6, "was": 5 } } } ] },
    "lamp":    { "from": ["lamp-1", "lamp-2", "lamp-3"] },
    "lamp-row": { "knobs": { "gap": { "v": 4.6, "was": 6 } },
                  "offsets": [ { "way": "side", "how": "same", "v": 1 }, { "way": "side", "how": "zigzag", "v": 1.5, "odd": true } ] },
    "crystals": { "offsets": [ { "way": "move", "how": "same", "v": [1.2, -0.5] } ] }
  }
  ```

  Every field optional; a layout with none is not written. `knobs` as a code motion's (≤ 3). `pins`: the layout's own
  keys (`<id>-<n>`) → a pose `{ p, r?, s?, t? }` (rounded like `objects`), ≤ 500 across all layouts. `hand`: `true` only.
  `avoid`: ≤ 16, in order; each a `box` (3D `p` = the middle of its bottom, `size` = [w, h, d] ≥ 0; 2D `p` = its
  middle, `size` = [w, h] px; `name?` ≤ 40) or a `code` (a `codeAvoid` id, once each, `knobs?`), either with `off:
  true`. `from`: object keys, each once (the hand-placed objects it replaced; they may have the layout's own keys).
  `offsets` (studio-offsets, §1.12): ≤ 8, in order (the order does not change the result); each `{ way, how, v, odd?,
  seed? }` — `way` along · side · up · turn · size · move, `how` same · zigzag · ramp · jitter (`move`: same or jitter,
  `v` = [x, z] / 2D [x, y]), `v` a number (m / px; ° for turn, ±3600; a factor for size, 0.0001–10000), rounded to
  1e-4; `odd: true` only on a zigzag; `seed` (0–999999) on a jitter only, and always there. Which way, how and how much
  only — never a place per object. **The whole entry lasts only until Save** (studio-writeback, §1.12 "Written into the
  code"): the AI writes it into its codePlace / codeAvoid and folds it out (`place.code --fold`); the file never keeps
  what the code can say.
  Absent = nothing changed (the file keeps its bytes).

### 4.2 library.json

```json
{
  "version": 1,
  "tool": "library",
  "replace": [ { "from": "assets/tree.png", "to": "assets/tree-autumn.png", "usedBy": ["tree-01"] } ],
  "added":   [ { "file": "assets/rock.glb", "place": { "key": "added-1", "p": [1, 0, 2], "r": 0, "s": 1 } } ],
  "unused":  [ "assets/old-bg.png" ]
}
```

Paths are folder-relative with forward slashes, no `..`.

---

## 5. Shell tools

A tool plugs into the shell with `ShellTool` (`mount`, `unmount`, `dirty`,
`result`, `saved`, `restore`) and gets a `ShellContext` (host, language,
messages, items, `selectObject`, the optional `selectObjects` for several at
once, the optional `objects` (`LibraryObjects`: the objects' tiles, filters and detail, so the Library shows
objects and assets in one grid — "one Library", 2026-10-18), the older optional `showObjects` (plan 1's Objects
shelf; a shell that gives `objects` leaves it out), the optional `files` (`LibraryFileUse`: the files picked in the
Library go to the ask box's chip; a file's ✦ "Ask AI to add it to the scene…" / "Ask AI about it…" draft a request
there — "use the Library", 2026-10-18; ✦ since studio-uniforms), `switchTool`, `changed`, `phone`). The shell
owns the game frame, selection, undo/redo for placement, keeping and handing
over the results (the draft, Save) and the ⌘K list with the next steps. Tools render with `textContent` only for anything that
came from the game or the folder (names, file names); SVG only through
`<img>`; thumbnails only as `data:image/png;base64,`.

**Two uniforms** (studio-uniforms, 2026-10-23). Every button and menu row wears one of two: a **plain** one acts in the
editor at once (⌘Z undoes) and never writes in the ask box; a **✦** one
("Ask AI to …", the AI's violet: `MenuItem.ai`, `CtxRow.ai`, `.ai` on a
button) only puts an editable draft in the ask box and the cursor there —
nothing is sent until the person sends. ✦ rows go last in a menu, after a
line. A file's "Add to scene" in the Library is a ✦ ("Ask AI to add it to the
scene…": a new object is code), and a file's tile no longer drags onto the
Scene row. Rename (F2) is in place (`names`, §4.1).

---

## 6. Build

`node scripts/build.mjs` (Node ≥ 22.13, no dependencies). Source rules: erasable
TypeScript only, relative imports with explicit `.ts` extension, `import type`
for types, named exports only, no cycles. See `scripts/bundle.mjs`.

Tests: `node --experimental-strip-types --test test/<file>`.

---

## 7. Fitting the editor to one game

The AI can make the editor behave the way one game needs without changing
the editor, the adapter or the game code. Two optional files in the game
folder (full guide with examples: `skills/arrange/references/fit-game.md`):

- `.studio/studio.json` — `GameConfig`: `snap { grid, angle }`, `bounds { min,
  max }`, `rules[]` (`match` glob on key/label/group; `hidden`, `locked`,
  `lockHeight`, `rotate`, `scale` or `{ default, min, max }`, `snap`). The
  shell reads it through the host and sends it to the bridge
  (`core/config`).
- `.studio/tools.js` — loaded after the adapter, before the game. Calls
  `studio.extend({ constrain?, tools? })` (`GameExtension`).

`src/core/rules.ts` applies both as one more `StudioAdapter` around the found
adapter, so they work the same with every engine:

- Grid, bounds and `constrain()` apply to edits made with handles, keys and
  game tools (`drag`, `rotate`, `scale`, `nudgeY`). The angle snap
  accumulates the unsnapped angle, so small finger moves add up.
- `setPose` (undo/redo, loading saved files) is never constrained: saved
  poses come back exactly.
- `Item.movable`, `Item.liftable` and `Item.defaultScale` carry the rules to
  the handles and the shell.

Game tools (`GameTool`) get a narrow context (`GameToolContext`): the object
list and selection, `setPose` (undoable; `hold` runs make one step),
`pickNear`, `toGround` / `toScreen` (optional adapter methods; Port2D may add
`sceneToScreen()`), an overlay canvas, and `changed()`. While a tool is on,
pointer presses go to it after the handles; whatever it returns `false` for
is handled as usual. Messages: `tool/list`, `tool/state`, `tool/data` (bridge
→ shell) and `tool/activate`, `tool/restore`, `tool/collect`, `tool/saved`
(shell → bridge). Data is saved with the other results to
`.studio/data/<id>.json`.

## 8. The editor's look, rewritable by the AI

The shell's look and layout belong to the person, and the AI may rewrite them
per game folder (guide with examples:
`skills/arrange/references/editor-look.md`):

| File | Loaded by | Does |
|---|---|---|
| `.studio/ui/prefs.json` | shell (host `loadUi` / `saveUi`) | `UiPrefs`: panel side/size, theme, text and strip size, shown parts, language. Also written by the Look page (⌘K → Editor look…). Normalised on read (`src/shell/ui-prefs.ts`) |
| `.studio/ui/studio.css` | shell, after its own CSS | Any CSS. Colours are `--studio-*` variables per `data-theme`; parts carry `data-part`, buttons `data-action` |
| `.studio/ui/shell.js` | shell, after start | Script with `window.studioShell` (`StudioShellApi`) |

Rewritable: everything in the shell page. Protected: the bridge and the game
page (no `send()` in the API), handles, the save formats and validation, the
server routes. `?ui=off` on the shell URL opens the original look: no prefs,
no `.studio/ui/` files, nothing written. Deleting `.studio/ui/` has the same
effect permanently.

