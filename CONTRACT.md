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
   the AI to add a name and save again.

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

The edit script is inert unless the page URL has `?studio=edit` and runs in a
frame: then it freezes time after the first frame and talks to
`window.parent` at the origin given by `studioParent` (default: own origin).

Global API: `studio.ready()`, `studio.attach({ scene, renderer, camera })`
(engines without hooks), `studio.registerAdapter(probe)`,
`studio.register2D(port)`, `studio.core`. Game code calls it as
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

---

## 2. Messages (bridge ⇄ shell)

`window.postMessage` with `{ type: 'studio:<tool>/<verb>', … }`. Receivers check
`event.source` **and** `event.origin`; senders always pass an explicit target
origin, never `'*'`. Full payload types: `ShellToBridge`, `BridgeToShell`.

| Direction | Type | Payload / meaning |
|---|---|---|
| bridge → shell | `core/hello` | Edit script loaded (`contract`) |
| | `core/wait` | Waiting: `no-adapter`, `no-frame`, `no-objects` |
| | `core/check` | Self-check result |
| | `core/ready` | Adapter `kind`, `dim`, `version`, `editing` |
| | `core/view-state` | Opaque edit-camera state (the shell keeps it across reloads) |
| | `core/key` | Key pressed while the game frame has focus |
| | `core/error` | Adapter threw |
| | `core/game-error` | `{ message, where? }`: the game's own page threw (edit and Play, first 3 per load); the shell says what to do |
| | `placement/items` | `Item[]` |
| | `placement/selected` | `{ key, item? }` |
| | `placement/moved` | `{ key, pose, end?, from?, press?, hold? }` |
| | `placement/thumb` | `{ key, src }` (`data:image/png;base64,…` or null), one per key asked for by `placement/thumbs` |
| | `placement/tool` | `{ tool }`: the strip's chosen tool changed in the game (a strip button, M / H / T / S, Escape) |
| | `placement/menu` | `{ open }`: the strip's choices (the ▾ on turn / size) opened or closed in the game |
| | `placement/context` | `{ key, x, y, touch }`: a right-click (Mac: also Control-click) or a long press on the game: the editor page opens the menu for that place. `key` = the object under it (null = nothing / only the ground); an object not picked yet was picked first, without moving the camera |
| | `placement/moved-group` | `{ poses: [{ key, pose, from? }], end?, press?, hold? }` (§1.8) |
| | `placement/added` | `{ items: [{ key, from, pose, ghost? }], failed }` (§1.8) |
| | `library/assets` | `{ loads: LoadEntry[], uses: { key: AssetRef[] } }` |
| | `library/previewed` | `{ url, ok }` |
| shell → bridge | `core/edit` | `{ on, viewState? }` |
| | `core/view` | `frameAll`, `home`, `focus`, `zoom`, `orbit`, `pan`, `rise` (camera up / down by `by` × the game's height; 3D adapters with `view.rise(dy)`, which `core/ready` reports as `rise: true`; adapters with `view.fly(right, up, fwd)` — and `view.look(dx, dy)` — report `fly: true`, and the editor page then sends the fly keys held there as `core/fly { keys, fast }`), `restore` (adapters may also have `view.home({ glide? })` — the opening view, the game camera in three.js — and `view.settle(key)` — the first pick from it glides to an editing angle; the bridge uses them itself. `home` (⌘K "Back to the opening view", ⇧F) calls `view.home({ glide: true })`, or `frameAll()` when the adapter has no `home`) |
| | `core/lang` | UI language for handle labels |
| | `placement/list` · `select` · `pose` · `step` | see types (`select` and `step` take `keys` for several, §1.8) |
| | `placement/thumbs` | `{ keys, size }`: draw these list pictures. One queue in the bridge, drawn one at a time; a new request's keys go to the **front** (the shell asks for the rows in view each time the list scrolls, so with hundreds of objects what you see is drawn next) |
| | `placement/multi` · `copy` · `remove` · `restore` | §1.8 |
| | `placement/axis` | `{ axis }`: the 3D turn axis (`y` / `x` / `z`, or `next` for the R key) |
| | `placement/marks` | `{ keys, label? }`: what the AI's last change touched (after "Reload the game"), outlined in the AI's colour with one tag |
| | `placement/tool` | `{ tool: 'move' \| 'lift' \| 'rotate' \| 'scale' \| null }`: choose the strip's tool (the keys and ⌘K when the editor page has focus) |
| | `placement/look` | `{ on }`: Space is held in the editor page — a drag in the game looks around even with a tool chosen |
| | `placement/menu` | `{ open: false }`: close the strip's choices (a press or Escape in the editor page while they are open) |
| | `core/ui` | `{ handlePx, inset?, theme? }`: strip button size; `inset` = px the shell's floating plates cover on each side (`rightTo`: how far down the right one reaches); the strip and "bring into view" keep clear of them. When an inset grows (a phone's list sheet opens) the bridge slides the view — pan only, the least move — so the picked object and its strip sit in the part still seen |
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
| Height (3D) | Height tool: drag up or down (the object follows the pointer's height) / PageUp, PageDown | The same |
| Scale | Size tool: drag right or up = bigger, left or down = smaller (×2 per ~140 px) / +, − | The same |
| The old way | A drag that starts **on** a strip button still works as before (turn round the object, size from its middle, …) | The same |
| Look around (3D) / pan (2D) | With no tool chosen (or nothing picked): drag anywhere else, **including on objects that are not picked**, and on very large picked ones (their on-screen part 60 % of the window or more: a ground). **With a tool chosen**: ⌥ Option-drag (orbit), right / middle drag (pan), or hold Space and drag | Two fingers (pan and pinch); one finger only when no tool is chosen |
| Pan | Middle drag, right drag, Shift+drag starting on an object, two-finger trackpad scroll | Two-finger drag |
| Zoom | Wheel / trackpad pinch (towards the pointer) | Pinch |
| Fly (3D) | **W / S** forward / back along the line of sight, **A / D** left / right, **E / Q** up / down, **Shift** ×3 — smooth while held, stops on release, at a speed taken from the scene's size (`view.fly`; a small room and Lantern Cove feel the same). With **nothing picked**: the keys alone. With **something picked**: only while the **right button** is held (S stays the Size tool, E / Q still turn it), as in Unity / Unreal / Godot; a right-drag then turns the view where the camera stands (`view.look`) instead of panning, and its release opens no menu. Not while typing in a field; never by itself. `?` sheet: "Fly the camera  WASD" with that rule under it; ⌘K "Fly the camera" (WASD / Right button+WASD) | — |
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
| `GET /__studio/studio-edit.js` | — | Edit script |
| `GET /__studio/game-adapter.js` | — | `<game>/.studio/adapter.js` (plain file only), or an empty script |
| `GET /__studio/api/open` | — | `{ gameUrl, origin, lanUrl }`; the shell adds `?studio=edit` |
| `GET /__studio/api/files/:tool` | — | `{ value }` (null when missing or invalid, with `error`) |
| `PUT /__studio/api/files/:tool` | result JSON | `{ ok, path, request, at, undo, watching, seen? }`; validated by `src/schema`; 422 with `details` if invalid; also keeps a `saved` request (§3.4) and prints `studio: saved …` |
| `PUT /__studio/api/files/:tool?handoff=0` | result JSON | `{ ok, path }`: the same file, written as a draft (no request, no stdout line). The editor writes every change this way as it goes; Save is the PUT without it |
| `GET /__studio/api/assets` | — | `{ assets: AssetFile[], missing: [{ ref, in }], truncated }` |
| `POST /__studio/api/assets?name=<file name>` | raw bytes | 201 `{ path }` under `assets/`, free name chosen (`-2`, `-3` …) |
| `POST /__studio/api/next-step` | `{ id }`, or `{ id: "delete-files", files: [paths] }` (existing plain files in the folder, ≤ 200) | `{ ok, path, request }`; writes `.studio/next-step.md` (kept for older shells; the shell now uses `request`) |
| `POST /__studio/api/request` | `StudioRequestInput` (`step: "delete-files"` also takes `files`, same check as above) | `{ ok, id, at, path, undo, watching, seen? }`; keeps `.studio/requests/<id>.json` (§3.4) after a snapshot of the game's files (`undo: true`); 422 with `details` if invalid |
| `GET /__studio/api/status` | — | `{ status, time, watching, seen?, code }`: `.studio/status.json` normalised (null when missing or not valid), `time` = when it was written (ms); `watching` / `seen` from `.studio/watch.json`; `code` = signature of the game's files (§3.4) |
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
`studio: ready …`, `studio: saved placement.json (<summary>)`,
`studio: added <path>`, `studio: next-step <id> <path>`,
`studio: request <kind>[ <step>] .studio/requests/<id>.json "<words>" (<object names>)`,
`studio: check ok (<kind>)`, `studio: check failed: <ids> (see .studio/check.md)`,
`studio: unnamed <n> objects without a name: <keys>`,
`studio: undone .studio/requests/<id>.json "<what happened>"`.
`studio.mjs <folder> --watch` prints the same request lines (from the files,
after `studio: watching <n> waiting`).

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
  `objects` (`key`, `label`, the `pose` in the editor at that moment — it may
  be unsaved —, `unstable`, and `files`: the asset files it is drawn with, when
  the editor knows them), `assets` (`ask`: files picked in the Library that the
  words are about — "Add this to the scene" asks for a new object made from
  them; plain folder paths, ≤ 50), `step`, `lang`, `dim`, `unsaved` (changes not
  saved yet), `view` (`ask`, 3D: the camera's `eye` and `target` when they
  asked, so new things land in sight), `files` (what it is about: `placement.json`,
  `.studio/next-step.md`, …; for `delete-files`, `.studio/next-step.md` then
  the files to delete). The id is time-sortable and is also the file
  name: `20261016-153012-482-ask-9f3c` (UTC). The host makes the id and the
  time; nothing from the browser decides a file name.
- **Status** (AI → editor). The agent keeps one status: `StudioStatus` with
  `state` (`received` | `working` | `asking` | `done` | `failed`; `asking` =
  the agent waits for the person's answer in its own window, `note` holds the
  question), and optionally
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
- The shell's line (`src/shell/ai-flow.ts`) above the input: `sent` (a watch
  runs) → `seen` (it printed the request) → `received` / `working` (the
  agent's note) → `updating` → `done` (the note, what was asked, "3 things
  changed", **Undo AI change**) or `failed`; `away` at once when no watch
  runs (what to do: type "look", or `/arrange` in this folder; the request is
  kept and moving / Save work without the AI). Hosts that cannot tell
  (`watching` left out) keep "waiting" → after 20 s "type look". A violet light
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
line); `studio.mjs <folder> --status received|working|done|failed [--request
<id>] [--changed <n>] [--note <text>]` writes the status, and `done` /
`failed` move the requests up to `<id>` into `done/`.

The shell reaches all of this only through `StudioHost` (`request`, `save`,
`status`); it never assumes local files or the server's stdout.

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
Library go to the ask box's chip; a file's "Add to scene" / "Ask your AI…" draft a request there — "use the Library",
2026-10-18), `switchTool`, `changed`, `phone`). The shell
owns the game frame, selection, undo/redo for placement, keeping and handing
over the results (the draft, Save) and the ⌘K list with the next steps. Tools render with `textContent` only for anything that
came from the game or the folder (names, file names); SVG only through
`<img>`; thumbnails only as `data:image/png;base64,`.

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

