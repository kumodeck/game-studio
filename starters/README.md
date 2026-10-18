# starters

Created: 2026-10-16
Purpose: the starters Game Studio can open for someone who has no game yet ("Start from a starter?"). Each one is a
small, finished-looking scene that opens in a few seconds and that you can rearrange in the editor right away.

| Folder | Engine | What it is |
|---|---|---|
| `lantern-cove/` | three.js 0.186.1 (CDN) | 3D. A quiet harbor at dusk: clear water with real reflections, a lighthouse, floating boats. Tap the water to sail. 15 objects. |
| `firefly-ruins/` | PixiJS 8.21.0 (CDN) | 2D. An old stone gate by a still pond at sunset, fireflies, wind, a bell. Tap to send a breeze. 14 objects. |

Each folder has the same three files the editor reads (the "starter" shape):

- `index.html`: opens as-is in a browser (from a web server: the files in `assets/` are fetched). No build step. The
  only things loaded from outside are the engine files from cdn.jsdelivr.net.
- `starter.json`: `{ "title", "dim": "3d" | "2d", "blurb", "thumb", "order" }`
- `thumb.png`: 640×400 picture of the starter

and also:

- `studio-placement.js`: the placement loader (copy of `skills/arrange/bin/studio-placement.js`), so what you save in
  the editor shows up when you press Play
- `js/`: the game code (every file starts with a comment on what it does and why)
- `firefly-ruins/.studio/adapter.js`: the PixiJS adapter (copy of `src/adapters/pixi/adapter.js`, one marked change)
- `assets/`: the files the game loads (see below)

## Where the art comes from

Nothing is downloaded except the engines. Most shapes, textures, colours and sounds are made by the code in this
folder when the page loads:

- Lantern Cove: terrain, rocks, boats, buildings and trees are built from three.js primitive shapes and noise
  (`js/terrain.js`, `js/props.js`, `js/decor.js`); the sky is a shader (`js/sky.js`); the water is a shader with a
  planar reflection (`js/water.js`).
- Firefly Ruins: most pictures are painted with the browser's Canvas 2D (`js/paint.js`, `js/backdrop.js`).

Since 2026-10-17 each starter also loads a few real files from `assets/`, so the editor's Assets panel has
something to list, show ("Used by: crate, pier, rowboat") and swap. They are made from code too, by
`scripts/make-starter-assets.mjs` (Canvas 2D, three.js, synthesized sound; see `scripts/starter-art/`), and each is
optional: when a file is missing the game falls back to its code version.

| Starter | File | Used by | Size |
|---|---|---|---|
| Lantern Cove | `assets/sail.jpg` | sailboat (both sails) | 38 KB |
| | `assets/planks.jpg` | crate, pier, rowboat (seats) | 25 KB |
| | `assets/barrel.glb` | barrel (glTF model) | 64 KB |
| | `assets/bell.mp3` | buoy (rings every 6–10 s, after the first tap) | 32 KB |
| | `assets/waves.mp3` | the sea (a 10 s loop, after the first tap) | 79 KB |
| | `assets/sail-tanbark.jpg` | nothing: a spare sail to try Replace with | 33 KB |
| Firefly Ruins | `assets/bell.png`, `assets/bell.mp3` | bell (picture; the sound of a tap on it) | 24 + 36 KB |
| | `assets/lantern.png` | lantern | 61 KB |
| | `assets/boat.png` | boat | 47 KB |
| | `assets/banner.png` | banner (the cloth's picture, laid on the moving cloth) | 48 KB |
| | `assets/boat-lacquer.png` | nothing: a spare boat to try Replace with | 46 KB |

Together 0.53 MB. No third-party images, models, fonts or sounds. All of it is MIT like the rest of this package.
The engines are MIT too (three.js, PixiJS).

## Size and speed (2026-10-16, measured headless)

| | Our files | Engine from the CDN | First picture | Frame rate |
|---|---|---|---|---|
| Lantern Cove | 0.38 MB | ≈ 0.9 MB (three + post-processing add-ons) | ≈ 0.4–0.65 s | 60 fps |
| Firefly Ruins | 0.36 MB | ≈ 0.8 MB (pixi.min.mjs) | ≈ 0.2–0.3 s | 60 fps |

Measured before `assets/` (2026-10-17) added 0.27 MB (Lantern Cove, plus three's GLTFLoader) and 0.26 MB (Firefly
Ruins), fetched first thing when the game code starts. Frame rates were measured on an Apple M5 Max GPU, which is
faster than a typical laptop. Lantern Cove checks its own speed in the first 2 seconds: below ~45 fps it turns off multisampling and renders at pixel ratio 1
(`setQuality` in `js/main.js`).
