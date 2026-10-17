# Draw order (layers) in 2D games

In a 2D game, which object is in front decides whether the house stands behind the tree or in front of it. The editor
lets the person change that order ("To back", "Backward", "Forward", "To front", Cmd/Ctrl+] and Cmd/Ctrl+[, or by
dragging objects in the list, which shows the front-most object on top). This page covers what the editor saves,
how to apply it to each engine, and what an adapter needs for it.

3D games (three.js) have no draw order in the editor: depth decides what is in front.

## What placement.json holds

```json
{
  "version": 1, "tool": "placement", "dim": "2d", "space": "local",
  "objects": { "house": { "p": [300, 380], "was": { "p": [620, 380] } } },
  "order": [
    { "in": "stage", "keys": ["path:1", "house", "tree", "tree#2", "fence"], "was": ["path:1", "tree", "tree#2", "house", "fence"] }
  ]
}
```

- `order` is optional and only lists the lists whose order the person changed.
- `in` is the list the objects are drawn in: usually their parent (`stage` for top-level pieces, a container's key
  such as `fence`, `things` for a plain canvas game). It is whatever the adapter's `order()` returns as `parent`.
- `keys` is **back → front**: the first key is drawn first (furthest back), the last is drawn on top.
- `was` is the order the game itself draws. Compare it with `keys` to see what moved; search the code for the lines
  that add or draw these objects in the `was` order.
- Only objects the editor lists appear in `keys`. Others in the same parent (a background marked `studio = false`, a
  HUD) keep their place: put the listed objects in the new order **in the places they already take**.
- Order changes are never written per object (`objects` has no `z`). An object can appear in `order` without being in
  `objects` (reordered but not moved).

## Applying it

Ask once (loader or rewrite) as in SKILL.md §4; the same choice covers the order.

### Loader

- **PixiJS:** `bin/studio-placement.js` already applies `order` (it reorders the parent's children). Nothing to add.
- **Plain canvas** (the game draws an array in order): after the objects are built, put the listed things back in the
  `keys` order in the slots they occupy. The canvas example does it in a few lines
  (`examples/canvas-stars/game.js`, `applyPlacement`).
- **Phaser:** for each entry, give the objects increasing depth in `keys` order, keeping them between their
  neighbours, or reorder the display list: `scene.children.moveTo(obj, index)` (a `Container`: `container.moveTo`).
  Use whatever the game already uses: if it calls `setDepth` anywhere, use depth; if not, the display list.
- **Godot (web export):** use Way 2 on the project (below).

Keys made from a position (`path:…`) or a repeat number (`tree#2`) depend on the order of the children. The loaders
above first resolve every key, then write it on the object as its mark (`studioKey`, or `key` in the canvas example),
then reorder. Do the same in a hand-written loader, or the editor will find different objects under those keys the
next time it opens.

### Rewrite the code

Change the code so the game draws the objects in `keys` order, then remove that entry from `order` (delete
`placement.json` when it is empty, as in SKILL.md §4).

| Engine | What decides the order | How to rewrite |
|---|---|---|
| PixiJS | The order of `addChild` calls (later = in front), or `zIndex` when the parent has `sortableChildren = true` | Reorder the `addChild(...)` calls (or the arguments of one call) to match `keys`. If the game sets `zIndex`, give the objects increasing `zIndex` in `keys` order instead and keep `sortableChildren` on |
| Phaser | `setDepth()` (higher = in front); without depth, the order objects were added to the scene or container | Change the `setDepth` numbers so they increase in `keys` order, or reorder the `this.add.*` calls |
| Plain canvas | The order of the draw calls / the array `draw()` walks | Reorder the array literal or the draw calls |
| DOM | CSS `z-index`, else the element order | Set increasing `z-index` in `keys` order, or reorder the elements |
| Godot 2D | Node order under the parent (later = in front), or `z_index` | Reorder the child nodes in the `.tscn` (or set `z_index`), then export for Web again |

Avoid a mixed state: if some objects in a parent use `zIndex` / depth and others do not, set it on all listed
objects of that parent.

Unnamed objects (`unstable: true`, `path:` keys) are the ones most likely to change keys when the code is reordered.
Give them a name or a mark (SKILL.md §5) while you are rewriting.

## The adapter part (Port2D)

Two optional methods turn the layer controls on. Without them the editor simply does not show them.

```js
// Which list the object is drawn in, and its place there (0 = drawn first, every child counts).
order(key) {
  const e = find(key);
  if (!e || !e.o.parent) return null;
  return { parent: parentId(e.o), index: e.o.parent.getChildIndex(e.o) };
},
// Remove the object, then insert it at `index` in the same list.
setOrder(key, index) {
  const e = find(key);
  e.o.parent.setChildIndex(e.o, index);
},
```

- `parent` must be a key-like id (`stage`, the parent object's key, `things`). Objects with the same `parent` are
  reordered together.
- `index` counts every child the engine draws, listed or not. The editor only ever asks to move an object to the
  index of another listed object of the same parent, so a background at index 0 stays at the back.
- Keep each object's key for the whole edit session (remember it the first time you see the object, e.g. in a
  `WeakMap`). Otherwise moving the rock to the back renames every unnamed object after it while the person is
  editing. The Pixi and canvas examples do this.
- Engine notes:
  - **PixiJS:** `getChildIndex` / `setChildIndex`. With `sortableChildren`, also give the object the `zIndex` of its
    new neighbour (the example adapter does it), or the next sort undoes the move.
  - **Phaser:** `obj.parentContainer || scene.children` for the list; `getIndex(obj)` / `moveTo(obj, index)`. If the
    game uses `setDepth`, report the display-list index but set the depth between the new neighbours in `setOrder`.
  - **Plain canvas:** `things.indexOf(t)`; `splice` it out and back in. The list must be the array `draw()` walks.
  - **DOM:** the element's index among its siblings; `insertBefore` to move it (or `z-index`, if the game uses it).

After adding them, open the editor: a "Layer" row appears on the selected object and the list shows the draw order.
Try "To front" on an object that overlaps another and check that the picture changes.
