# Fit the editor to one game

Two optional files in the game folder make the editor behave the way this game needs, without changing the editor,
the adapter or the game code. Both are read when the editor page loads (reload the editor after changing them).

- `.studio/studio.json` — plain settings (no code). Start here.
- `.studio/tools.js` — code that runs in the game page: rules that need logic, and game-specific tools.

Rules apply to what the user does with handles, arrow keys and game tools. They never change undo/redo, and they
never rewrite a saved file: an object saved off-grid stays where it was saved until the user moves it again.

## `.studio/studio.json`

```json
{
  "version": 1,
  "snap": { "grid": 1, "angle": 90 },
  "bounds": { "min": [-10, 0, -10], "max": [10, 5, 10] },
  "rules": [
    { "match": "ground", "locked": true },
    { "match": "ui-*", "hidden": true },
    { "match": "crate*", "scale": { "default": 1.5, "min": 0.5, "max": 2 } },
    { "match": "tree*", "lockHeight": true, "rotate": false },
    { "match": "coin*", "snap": { "grid": 0.5 } }
  ]
}
```

| Field | Meaning |
|---|---|
| `snap.grid` | Move in steps of this size. 3D: one number snaps x and z (heights stay free); `[x, y, z]` sets each axis, `0` = free. 2D: one number snaps x and y; `[x, y]` per axis. Units are the game's (metres in 3D, scene px in 2D) |
| `snap.angle` | Turn in steps of this many degrees |
| `bounds` | Objects stay inside this box, in the object's parent space (2 or 3 numbers) |
| `rules[].match` | Glob (`*`, `?`) on the object's key, name or group. All matching rules apply in order; later wins |
| `hidden` | Leave the object out of the editor |
| `locked` | Listed but not movable (no handles) |
| `lockHeight` | 3D: no height handle, height stays |
| `rotate: false` / `scale: false` | Hide that handle |
| `scale: { default, min, max }` | Size range; `default` adds a "Default size" button for that kind |
| `snap` | Grid/angle for these objects only |

Use the game's own numbers: if the code places tiles every 32 px, `"grid": 32`; if the arena is ±20 m, use that.
Keys and names: see the object list in the editor, or §5 of the skill.

## `.studio/tools.js`

Loaded right after the adapter and before the game code. Call `studio.extend({...})` once (or several times).

```js
// Keep cars on the road: the road is the band |z| <= 3.
studio.extend({
  constrain(key, pose, item) {
    if (!key.startsWith('car')) return pose;
    return { ...pose, p: [pose.p[0], pose.p[1], Math.max(-3, Math.min(3, pose.p[2]))] };
  },
});
```

`constrain(key, pose, item)` gets the pose after grid and bounds and returns the pose to use. Keep it fast (it runs
on every pointer move) and pure (do not move other objects from it).

### Game tools

A game tool is a button in the editor that does something only this game needs: draw the race course, place coins
along a path, paint tiles, set spawn points. Its data is saved to `.studio/data/<id>.json` when the user presses
Save; the server prints `studio: saved .studio/data/<id>.json`, and you apply it to the game (ask the user once how,
like placement.json).

```js
// Draw the race course as a line of points (scene coordinates).
studio.extend({
  tools: [{
    id: 'course',                                   // /^[a-z0-9][a-z0-9-]{0,39}$/, also the file name
    label: { en: 'Draw course' },                  // add { ja: '...' } in the user's language too
    icon: '✎',
    hint: { en: 'Drag in the game to draw the course' },
    points: [],
    drawing: false,
    pointer(e, ctx) {                               // e.type: 'down' | 'move' | 'up', e.x / e.y in page px
      const p = ctx.toGround(e.x, e.y);             // 3D: [x, y, z] on the ground (y = 0); 2D: [x, y] in the scene
      if (!p) return false;                         // false = the editor handles this press (look around, select)
      if (e.type === 'down') { this.points = [p]; this.drawing = true; }
      else if (e.type === 'move' && this.drawing) this.points.push(p);
      else if (e.type === 'up') { this.drawing = false; ctx.changed(); }   // one unsaved change
      return true;
    },
    draw(ctx) {                                     // every frame while the tool is on
      const g = ctx.overlay;                        // a 2D canvas over the game, already cleared
      g.strokeStyle = '#ff5a36'; g.lineWidth = 6;
      g.beginPath();
      this.points.forEach((p, i) => { const s = ctx.toScreen(p); if (s) i ? g.lineTo(...s) : g.moveTo(...s); });
      g.stroke();
    },
    data() { return { points: this.points }; },     // saved to .studio/data/course.json
    restore(d) { if (d && d.points) this.points = d.points; },  // the saved data from last time
  }],
});
```

The tool context (`ctx`):

| Member | Does |
|---|---|
| `dim`, `lang` | `'2d'` / `'3d'`; `'en'` / `'ja'` |
| `items()`, `selected()`, `select(key)` | The editor's object list and selection |
| `setPose(key, pose, { hold })` | Move an object. Undoable: a run of `hold: true` calls then one without `hold` is one undo step |
| `pickNear(x, y)` | Keys of objects under a page point, best first |
| `toGround(x, y, groundY?)` | Page point → scene point (3D: on the plane y = `groundY`, default 0) |
| `toScreen(p)` | Scene point → page point, or null behind the camera |
| `overlay` | 2D canvas context over the game, cleared before each `draw` |
| `changed()` | Count one unsaved change for this tool and redraw |

Tool fields: `id`, `label`, `icon?`, `hint?`, `activate?(ctx)`, `deactivate?(ctx)`, `pointer?(e, ctx)`, `draw?(ctx)`,
`data?()`, `restore?(data)`, `dirty?()` + `saved?()` (only if you count changes yourself).

2D games: `toGround` / `toScreen` use the scene (stage) space. If your adapter's scene is not the canvas pixel space
(a scaled stage, a camera), add `sceneToScreen()` to the adapter (`references/adapters.md`).

### Applying a tool's data

Read `.studio/data/<id>.json` and do what the tool means for the game, the same two ways as placement.json:
a small loader the game calls at start (`fetch('.studio/data/course.json')` is fine for local play, but copy the
data into the game's own files before publishing: `.studio/` is not part of the game), or write the data into the
code (for example a `COURSE = [...]` array). Ask the user once which they prefer.
