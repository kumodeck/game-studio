# Writing an adapter for a game

Read this when the game is not three.js (or when the built-in three.js adapter cannot find the scene). It explains the
port the editor talks to, how to fit an example adapter to a game, and how to read the self-check.

## The port

An adapter is a file at `.studio/adapter.js` in the game folder. The editor loads it only while editing: right after
its own edit script and **before any game code**, so it can set up hooks before the engine starts. It calls one
function on the editor's small global API (`window.studio`, also available as `window.__gameStudio` in case the game
already uses the name `studio`):

```js
// .studio/adapter.js
window.studio.register2D(() => {
  const game = findTheGame();          // EDIT HERE: return null until the game and its objects exist
  if (!game) return null;              // the editor asks again after the first frame / studio.ready()
  return {
    name: 'phaser',                    // free text, shown in the editor footer
    objects() { /* [{ key, label?, unstable? }, …] — only what the user may move */ },
    get(key)  { /* { p: [x, y], r: radians clockwise, s: scale } in the PARENT's space */ },
    set(key, pose) { /* write the pose back; the editor calls render() afterwards */ },
    parentToScreen(key) { /* [a, b, c, d, e, f]: parent space → CSS px in the page */ },
    bounds(key) { /* { x, y, w, h } on screen, CSS px */ },
    render() { /* draw one frame now; the game's own loop is paused */ },
    // optional: setView({ x, y, zoom }), pause(), resume(), capture(key, size), assetsOf(key), canvas(),
    //           sceneToScreen() — only for game tools (fit-game.md) when the scene is not the canvas pixel space
  };
});
```

The editor builds everything else from these few methods: picking (nearest and smallest first, press again to reach
the object behind), the handles, drag maths, undo/redo, the edit view, thumbnails. You never write UI code.

Rules that keep the port honest:

- **Parent space.** `get()` and `set()` use exactly the numbers the game code would assign (`sprite.x`, `node.position`).
  That is what lands in `placement.json` and what you search for later.
- **Clockwise radians.** Convert if the game stores degrees (`angle` in Phaser, `rotation_degrees` in Godot).
- **`parentToScreen` includes everything between the parent and the page:** the parent's own transform, the camera,
  the canvas offset (`canvas.getBoundingClientRect()`) and CSS scaling (`rect.width / canvas.width`). In the
  `[a, b, c, d, e, f]` order of `DOMMatrix` / `setTransform`: `screenX = a*x + c*y + e`, `screenY = b*x + d*y + f`.
- **`render()` must draw from the state you just wrote.** If the game draws from a separate copy (a physics body, a
  render list built once per update), write there too, or call the game's own update for zero time before drawing.
- **The view.** `setView` is optional. Without it, the user cannot pan or zoom; that is fine for small screens. With
  it, change only how the world is shown (camera scroll/zoom, a transform on the root container) and restore the
  game's view when called with `{ x: 0, y: 0, zoom: 1 }`. Never move objects to fake a camera.
- **Do not change the game while listing.** `objects()`, `get()` and `bounds()` must be side-effect free; the editor
  calls them often.
- **Leave the game as you found it.** Anything the adapter changes on a game object or the renderer to make a
  thumbnail, measure an object or show a selection (visibility, alpha, parent, z-order, a render group, a camera, a
  render target, a cached transform) must be put back right after, in a `finally` block. Otherwise the editor shows a
  different game from the one the user plays, and the self-check does not notice. See
  [Leave the game as you found it](#leave-the-game-as-you-found-it) and run the [view check](#the-view-check).
- **Plain JavaScript, no imports.** The file runs as a classic script before the game. If the engine is only reachable
  as a module export, expose it from the game with one guarded line (`if (window.studio) window.studio.game = …`).

## Pick the example

The examples are in `adapters/` next to `SKILL.md`. Each one is short and every place you must change is marked
`EDIT HERE`.

| Example | Start from it when | Where objects usually live |
|---|---|---|
| `phaser.js` | Phaser 3 or 4 | `game.scene.getScenes(true)[i].children.list`; skip the UI scene and `setScrollFactor(0)` objects |
| `pixi.js` | PixiJS v8 | `app.stage` and its containers; `label` is the name |
| `canvas.js` | The game draws with `getContext('2d')` (or p5.js, or a small engine) | An array of plain objects (`{ x, y, angle, … }`) the draw loop walks |
| `dom.js` | Objects are DOM elements | Elements with a class or `data-` attribute, positioned with `left/top` or `transform` |
| `godot/` | Godot 4, exported for Web | Nodes in the running scene tree; a GDScript autoload exposes them to JavaScript |

Then, in this order:

1. **Find the game.** How does the example get hold of the engine (a hook the engine calls, a global, the line you add
   to the game)? Make it return `null` until the objects exist.
2. **List the objects.** Walk the place where this game keeps them. Leave out the background, UI, particles, bullets,
   anything created and destroyed every few seconds. Prefer objects the level is built from.
3. **Keys.** Use the game's mark (`studioKey`), then a name, then the index in the list with `unstable: true`. Keys
   must match `/^[A-Za-z0-9_:#.\-\/]{1,80}$/` and be unique. If a name has other characters, replace them and keep
   the original as `label`.
4. **Pose and screen maths.** Copy the example's maths and change only the field names and the camera.
5. **One frame.** Find the function the game calls to draw (Phaser and PixiJS: the example already does it; canvas:
   the game's `draw()`; DOM: nothing, the browser draws).
6. **Assets (optional).** `assetsOf(key)` returns the files an object shows (`sprite.texture.key` → the loader's URL in
   Phaser, `texture.source.label` in PixiJS, the `src` of the image the canvas game draws). It makes the library's
   "used by" column exact.

### Godot

A Godot web export is a WebAssembly program; JavaScript cannot see its nodes. The example has two halves:

- `godot/studio_bridge.gd`: add it to the **Godot project** as an autoload. In a web build it uses
  `JavaScriptBridge` to publish four functions on `window` (list the nodes in the group `studio`, read a pose, write a
  pose, report the canvas transform). Outside a web build it does nothing. Ask the user before adding it, and tell
  them a new web export is needed.
- `godot/adapter.js`: copy it to `.studio/adapter.js` in the **export folder**. It waits for those functions and turns
  them into the port.

Put the nodes the user may move in the group `studio` (or adapt the bridge's query), and give them a
`studio_key` metadata value or a unique name. Only 2D (`Node2D`) is supported for now. Results are applied to the
`.tscn` files of the project, then exported again (`SKILL.md` §4 "Godot").

## The self-check

As soon as an adapter is found (yours, or the built-in three.js one), the editor tests it on one object and leaves no
trace: it moves the object, checks, and puts it back. The server prints one line, `studio: check ok <name>` or
`studio: check failed: <ids>`, and writes the details to `.studio/check.md`. The shell also shows the failures to the
user, so fix them before you hand over the URL.

| Check | Passes when | Usual fix |
|---|---|---|
| `adapter-found` | Some adapter returned a port | `.studio/adapter.js` is missing, threw (see the browser console line copied into `check.md`), or `findTheGame()` never returned non-null. For three.js: see "When the three.js adapter cannot find the scene" below |
| `has-objects` | `objects()` returned at least one object | Looking in the wrong place, or the world is built later: call `window.studio?.ready()` from the game when the world exists |
| `keys-valid` | Every key matches the pattern above and is unique | Replace bad characters, number duplicates (`tree#2`) |
| `pose-roundtrip` | `set()` then `get()` returns the new pose | `get()` reads a different field than `set()` writes, or degrees vs radians |
| `screen-changes` | Moving the object changes the canvas pixels after `render()` | The game draws from another copy (a physics body, a cached list), or `render()` does not draw. Write the pose where drawing reads it |
| `anchor-follows` | `bounds()` / `parentToScreen` follow the move on screen | Missing camera or canvas offset/scale in the maths, or `bounds()` reads stale values |
| `restored` | Putting the old pose back gives exactly the old pose | Rounding in `set()` (keep full precision), or `set()` changes more than the pose |

Reload the editor page after each fix; the server serves the current `.studio/adapter.js` on every load.

## The view check

The self-check proves the adapter can move an object. It cannot see an adapter that changes how the game is
**drawn**: objects that vanish, jump or change order in the editor while the game played normally is fine. You
cannot see the user's screen, so run this once after the self-check passes, and again after every change to
`.studio/adapter.js` (2D adapters; the built-in three.js adapter is skipped):

```sh
node <this skill's folder>/bin/studio.mjs <game folder> --check-view
```

It opens a private headless Chrome (its own throwaway profile; never the user's browser), shoots the game frame in the
editor after the self-check and the library thumbnails, shoots the same page without the editor (no edit script, no
adapter) at the same size, and compares them. Small differences (a game that keeps moving) are allowed. It prints one
line and exits:

| Line | Exit | What you do |
|---|---|---|
| `studio: check-view ok (…% of the picture differs)` | 0 | Nothing |
| `studio: check-view failed: the game looks different in the editor …` | 1 | Read `.studio/view-check.md`, look at `.studio/view-check/editor.png` and `game.png`, fix the adapter (below), run it again |
| `studio: check-view skipped: …` | 3 | No Chrome found (set `STUDIO_CHROME` to its path), the editor listed no objects (fix the self-check first), or a three.js game |

Add `.studio/view-check*` to the game's `.gitignore` with the other notes.

## Leave the game as you found it

A failed view check means the adapter changes a game object or the renderer and does not put it back. Missing,
moved or reordered objects in `editor.png` point at what was touched. Known traps:

- **PixiJS v8 `extract`.** `renderer.extract.canvas({ target })` (and `extract.image`, `extract.texture`) renders the
  target on its own by turning it into a **render group**, and leaves it one. A render group is no longer drawn with
  its parent's transform and order: in the editor the object jumps or disappears. Undo it right after, and report a
  blank result as "no thumbnail" (`null`); the editor then crops the object from the screen instead:

  ```js
  async capture(key, size) {
    const o = find(key);
    const wasGroup = !!o.isRenderGroup;
    let src;
    try {
      src = app.renderer.extract.canvas({ target: o });
    } finally {
      if (!wasGroup && o.isRenderGroup && o.disableRenderGroup) o.disableRenderGroup();
    }
    if (!src || !src.width || !src.height) return null; // also null when every pixel is transparent
    // … scale src into a size × size canvas and return it
  },
  ```

- **Phaser and every other engine.** The same rule holds for any trick used for a thumbnail or a selection: hiding
  the other objects, drawing into a render texture, moving the camera, `setDepth` / `bringToTop`, changing `alpha`,
  `visible`, `tint` or the parent. Save what you change, restore it in `finally`, and prefer read-only ways (crop the
  object's `bounds()` from the screen) when the engine has no clean one. Return `null` from `capture()` when unsure;
  the editor's own crop is a fine thumbnail.
- **The view.** `setView({ x: 0, y: 0, zoom: 1 })` must give back exactly the game's own camera; the view check uses
  it before shooting.

## When the three.js adapter cannot find the scene

The built-in adapter is told about scenes and renderers by three.js itself (the developer-tools hook that recent
versions call when a `Scene` or `WebGLRenderer` is created). If the game uses a very old three.js, a fork, or builds
its scene in a way the hook does not see, hand the parts over from the game with one line after they exist:

```js
window.studio?.attach({ scene, renderer, camera });
```

The `?.` keeps the line harmless when the game runs without the editor.

## Keep it, change it rarely

`.studio/adapter.js` belongs to the game: commit it with the game. It is only loaded by the editor. Change it when the
self-check fails after the game changed (objects moved to another list, a new camera, a new engine version), not on
every edit. When you change it, keep the key rules the same so earlier `placement.json` files still match.

## Draw order (layers, 2D)

A 2D adapter can also report and change what is drawn in front: two optional methods, `order(key)` →
`{ parent, index }` and `setOrder(key, index)`. With them the editor shows a "Layer" row (to back, backward, forward,
to front) and lists objects front-first, reorderable by dragging. The Pixi and canvas examples have them. What to
write for other engines, and how to apply the saved `order` to the code:
[`layer-order.md`](layer-order.md#the-adapter-part-port2d).

## Copy and delete (optional)

The editor can copy (⌘D / Copy) and delete (Delete key / button) objects with **every** adapter. Without extra code
it shows stand-ins: a see-through picture of the original for a copy, and a deleted object shrunk out of sight. To
show real objects instead, add three optional methods to the port (all three or none):

| Method | Does |
|---|---|
| `clone(key, newKey)` | Make a copy of the object in the same parent, at the same pose, drawn right after the original, and list it under `newKey` from now on (set its `studioKey`, or the `key` field your `objects()` reads). Return `false` when this object cannot be copied (the editor then shows a stand-in). |
| `remove(key)` | Hide it and leave it out of `objects()`, but keep it where it is (draw order and the keys of the others must not change). Return `true`. |
| `putBack(key)` | Undo `remove()`: show and list it again, exactly as before. |

The Pixi example copies display objects of the same class (sprites share the texture, `Graphics` share the drawing)
and hides deleted ones with `visible = false`; the canvas example copies the entry in the game's list and splices it
out and back in. Whatever the adapter does, the copies and deletions are saved to `placement.json` (`added`,
`removed`) and you put them into the game's code afterwards (SKILL.md §4).
