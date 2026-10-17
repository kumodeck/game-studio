# Writing a 2D adapter for a game (guide for AI agents)

Draft. This is the 2D part of the "read the game, then write its adapter"
steps. It is written for the AI agent that sets up KUMODeck Game Studio for a
user's game; the skill links here.

The editor never depends on a game library. It talks to one small port,
`Port2D` (`src/contract.ts`). Your job is to write `.studio/adapter.js` in the
game folder: a plain script that answers that port with a few lines of the
game's own engine calls. Start from the closest example and change only what
the game does differently.

| The game uses | Start from | Change in the game itself |
|---|---|---|
| PixiJS v8 | `pixi/adapter.js` | nothing (Pixi announces itself) |
| Phaser 3.60+ / 4 from a `<script>` tag | `phaser/adapter.js` | nothing |
| Phaser bundled as a module | `phaser/adapter.js` | one line: `window.__gameStudio?.attach({ phaserGame: game })` |
| Its own `<canvas>` drawing | `canvas/adapter.js` | one line handing over its objects and `draw()` |
| HTML elements moved with CSS | `dom/adapter.js` | one line handing over its state, `render()` and the board element |
| Godot 4 (Web export) | `godot/adapter.js` + `godot/studio_bridge.gd` | add the GDScript file as an Autoload |
| Anything else (p5.js, a home-made engine) | `canvas/adapter.js` | one line, like a canvas game |

Each example has a game next to it in `examples/<engine>-*` that the browser
test drives end to end (list, select, move, rotate, scale, undo/redo, edit
view, save, reload).

## 1. Read the game first

Find, and write down in a comment at the top of the adapter:

1. **Where the objects live.** Engine tree (`app.stage`, `scene.children`), or
   an array in the game's code (`things`, `entities`, `pieces`).
2. **Which of them a person would want to move.** Level pieces, props,
   characters, UI panels. Not: the background, particles, bullets created
   every second, the score text. Leave those out with `studio = false` or a
   filter in `objects()`.
3. **What a pose is in this game.** Position (`x`, `y` in the parent's
   pixels), angle (radians, clockwise on screen), uniform scale. If the game
   stores degrees, convert in `get`/`set`.
4. **How world pixels map to the screen.** Engine camera, a scale-to-fit
   transform, `devicePixelRatio`, letterboxing. This becomes
   `parentToScreen()`.
5. **How to draw one frame without running the game.** `app.render()`,
   Phaser's render-only steps, the game's `draw()`. Never call `update()`:
   the studio freezes time so nothing moves while the person edits.

## 2. Keys: give things names

Every movable object needs a key that is the same every time the game starts,
because `placement.json` is keyed by it. The examples use this order:

1. the game's own marker (`studioKey`) — add it when names are not enough
2. the object's name (`label` in Pixi, `name` in Phaser, `name` field in plain JS)
3. its position in the tree (`path:0/3/1`) — flagged `unstable`, because adding
   an object earlier in the scene changes it

Repeated names get `#2`, `#3` in tree order, counted over every named object
(not only movable ones), so a loader in the game can rebuild the same keys.
If many objects are unnamed, name the important ones in the game code; it is a
one-word change per object and makes every saved placement reliable.

## 3. The port, method by method

- `objects()` — the list from step 1/2: `{ key, label?, kinds?, group?, unstable? }`.
  `group` = same art (texture key / file), shown once in the list as "×N".
- `get(key)` / `set(key, pose)` — read/write `{ p: [x, y], r, s }` in parent
  space. If a physics engine keeps its own copy of the position, sync it in
  `set` (Phaser Arcade: `refreshBody()` / `body.reset()`).
- `parentToScreen(key)` — `[a, b, c, d, e, f]` mapping the object's PARENT
  space to CSS pixels of the page. Compose: parent chain -> camera -> canvas
  pixels -> `canvas.getBoundingClientRect()`. The studio inverts it to turn a
  finger move into a parent-space move, so a move follows the finger exactly.
- `bounds(key)` — the object's box on screen in CSS pixels (for picking and
  handles). Map the four corners of its local box and take min/max.
- `render()` — draw one frame now, without game logic.
- `order(key)` / `setOrder(key, index)` (optional) — the draw order
  ("layers"): `{ parent, index }` = which list the object is drawn in and its
  place there (0 = back, every child counts); `setOrder` removes it and
  inserts it at `index` (Pixi `setChildIndex`, `Array.splice`, Phaser
  `moveTo`). Keep each object's key for the whole session (a `WeakMap`), since
  reordering changes tree-path and `#2` keys. Details per engine:
  `skills/arrange/references/layer-order.md`.
- `clone(key, newKey)` / `remove(key)` / `putBack(key)` (optional, all three
  or none) — real copies and deletions in the editor. `clone` copies the
  object into the same parent right after it and lists it as `newKey`;
  `remove` hides it (out of `objects()`, keys of the others unchanged);
  `putBack` undoes that. Without them the studio shows stand-ins. Details:
  `skills/arrange/references/adapters.md#copy-and-delete-optional`.
- `setView({ x, y, zoom })` (optional) — the edit camera. Show the world
  shifted by `x, y` CSS px and zoomed around the canvas centre **without
  changing any object or the game's stage**. `{0, 0, 1}` means "exactly as
  the game draws it". Examples: Pixi renders with an extra `transform`; Phaser
  changes the main camera and restores it; DOM transforms a wrapper element.
  Without `setView` the studio moves the canvas picture with a CSS transform
  (works everywhere, but blurs when zoomed and cannot show what is outside
  the canvas).
- `pause()` / `resume()` (optional) — stop clocks that are not driven by
  `requestAnimationFrame` (Pixi ticker, Phaser loop, Godot's SceneTree).
- `capture(key, size)` (optional) — a thumbnail; default is a crop of the canvas.
- `silhouette(keys)` (optional) — the objects' shape on screen for the selection outline: `{ x, y, w, h, mask }`
  (viewport CSS px; `mask` a canvas whose alpha is their coverage). Draw them alone through the edit view on black and
  on white and take the difference (see the Pixi example), then draw the normal frame again. Without it the outline
  is a rounded box.
- `assetsOf(key)` (optional) — the files the object draws, as loaded
  (Pixi: texture source label; Phaser: record the loader's URLs; DOM: `img.src`).
- `canvas()` (optional) — the canvas the game draws into.
- `sceneToScreen()` (optional) — `[a, b, c, d, e, f]` from scene (stage) space to page px, edit view included. Only game tools (`.studio/tools.js`) use it; without it the scene is taken to be the canvas pixel space.

## 4. Applying a saved placement.json

Two routes; ask the user once which one they want:

1. **Rewrite the code.** For each key, find the literal numbers from `was` in
   the code and replace them with the new `p`, `r`, `s`. Delete the entry
   from `placement.json` when done. Best for hand-placed levels.
2. **Keep a loader.** Add a small function that reads `placement.json` at
   start-up and applies it by key, after the scene is built and before the
   first update (and before physics bodies copy positions). The examples have
   one per engine (`examples/*/placement.js` or `applyPlacement` in
   `game.js`). It must build keys with exactly the adapter's rules.

## 5. Check it

The studio runs a self-check after the adapter is found and tells you what
failed (no objects, invalid keys, a pose that does not read back, the picture
not changing after a move, the box not following the move). Fix the adapter
until the check passes, then ask the user to try moving something.

Common mistakes seen while writing the examples:

- **Empty list.** The game builds its scene after loading textures; the
  adapter is asked too early. Return objects as soon as they exist; the
  studio waits.
- **Pixi default labels.** Pixi v8 sets `label` to the class name
  (`"Sprite"`, `"Graphics"`) when the game gives none. Treat those as unnamed.
- **Stale world matrices.** Right after `set()`, engine caches may still hold
  the old transform. Build matrices from local transforms (Pixi) or refresh
  them in `render()` (Phaser camera).
- **Handles off screen.** On a phone the object can sit at the edge; the
  studio keeps handles inside the screen, but `bounds()` must be accurate.
- **Thumbnails that change the game.** Pixi v8 `renderer.extract` turns the
  target into a render group and leaves it so; the object is then no longer
  drawn with its parent (it vanished from the editor's picture in a trial on
  2026-10-16). Call `disableRenderGroup()` afterwards when it was not one, and
  return `null` for a blank thumbnail. Any engine: restore whatever a
  thumbnail or selection step changes. `studio.mjs <game> --check-view`
  catches this (it compares the editor's picture with the game played
  normally); the self-check cannot.
- **Physics overwrite.** A body that copies its position from the engine every
  step will undo an edit or a loaded placement unless the body is synced.
