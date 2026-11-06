# starters

Created: 2026-10-16
Purpose: the starters Game Studio can open for someone who has no game yet ("Start from a starter?"). Each one is a
small, finished-looking scene that opens in a few seconds and that you can rearrange in the editor right away.

| Folder | Engine | What it is |
|---|---|---|
| `big-swell/` | three.js 0.187.0 (CDN) | 3D. A rough sea at sunset: ducks, buoys, a raft and crates ride the waves, a big swell lifts them all every 6 s. No asset files. 11 objects. First on the shelf (`order` 0). |
| `lantern-cove/` | three.js 0.187.0 (CDN) | 3D. A quiet harbor at dusk: clear water with real reflections, a lighthouse, floating boats. Tap the water to sail. 15 objects. |
| `firefly-ruins/` | PixiJS 8.21.0 (CDN) | 2D. An old stone gate by a still pond at sunset, fireflies, wind, a bell. Tap to send a breeze. 14 objects. |
| `neon-run/` | three.js (CDN) | 3D. Only a `starter.json` that says `"from": "examples/three-neon-boss"`: the game is read from there (one copy of it, not two). A neon runner where a boss comes 4 s in. |
| `domino-spiral/` | three.js 0.187.0 (CDN) | 3D. About 400 glowing dominoes in a spiral on a dark mirror floor; a ball knocks the first one over. Drag the head and the whole line follows. 3 objects (head, bend, center). |
| `marble-rain/` | Phaser 3.80.1 + Matter (CDN) | 2D. Hundreds of glowing marbles pour through a triangle of pins into bins. Move a pin and they fall another way. 76 objects. No files: all drawn by code. |

Each folder has the same three files the editor reads (the "starter" shape):

- `index.html`: opens as-is in a browser (from a web server: the files in `assets/` are fetched). No build step. The
  only things loaded from outside are the engine files from cdn.jsdelivr.net.
- `starter.json`: `{ "title", "dim": "3d" | "2d", "blurb", "thumb", "order", "try" }`. `order` is the place on the
  shelf (0 first). `try` (decided 2026-11-06) is the sample's "Try": `{ "move": <the name of a thing that is fun to
  drag>, "pauseAt": <seconds into Play to pause at>, "ask": { "en" } }` — the words to ask from that paused
  moment. The stand-in AI for tests and clips (`test/ai-feel/fake-agent.mjs`, `SHELF_FIXES`) has one answer for each
  sample's ask
- `strings.json`: the starter's words in other languages, `{ "ja": { "blurb", "try": { "ask", "move" } } }` (the
  package keeps non-English text in translation files only). `blurb` is the shelf card's line, `try.ask` the words to
  ask, `try.move` what to call the thing to move (in starter.json `move` is its placement name). Like `starter.json`, it
  is not copied into a game. For a `from` starter the example's `strings.json` is read, then the starter's own over it
- `thumb.png`: 640×400 picture of the starter

The editor shows them on its **shelf** (decided 2026-11-06): in a folder without a game, `/arrange` opens the editor on
a page of these samples in `order`, each playing when pointed at; the one opened is copied into the folder. The AI asks
nothing. `starter.json` may also say what to try in the sample (shown on the shelf and in the guide after it opens):

```json
"try": { "move": "duck", "pauseAt": 7.6, "ask": { "en": "Make the waves twice as tall." } }
```

`move` = the placement name of a thing worth dragging (the guide shows it readable: `lighthouse_1` → "lighthouse"),
`pauseAt` = the second to pause at on the game's own clock (the guide shows the editor's top-bar second: about 0.6 s
earlier, whole seconds), `ask` = one change to ask the AI for
(one number in the code, so Before / After differ at a glance). All optional. A starter can stand for a game kept in
`examples/` with `"from": "examples/<id>"` (only there), plus any field to change (`order`).

and also:

- `studio-placement.js`: the placement loader (copy of `skills/arrange/bin/studio-placement.js`), so what you save in
  the editor shows up when you press Play
- `js/`: the game code (every file starts with a comment on what it does and why)
- `firefly-ruins/.studio/adapter.js`: the PixiJS adapter (copy of `src/adapters/pixi/adapter.js`, one marked change)
- `assets/`: the files the game loads (see below)

## Where the art comes from

Nothing is downloaded except the engines. Domino Spiral has no `assets/` at all: everything in it is code. Most shapes, textures, colours and sounds are made by the code in this
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

Big Swell (2026-11-06, measured headless with `test/studio-shelf-swell.browser.mjs --part game`): our files 0.09 MB
(0.06 MB of it the placement loader), plus three.js and its Sky add-on from the CDN (no post-processing). 59–60 fps on a PC
(1280×720, the GPU); on a phone-sized page (390×844, pixel ratio 2) 53 fps with the CPU 4× slower (stays sharp), and
10 fps with the CPU 20× slower, where it drops to pixel ratio 1 (`setQuality` in `game.js`, the same rule as Lantern
Cove).

## In the web demo

`scripts/build-web-demo.mjs` lists every folder here as a sample, in the same order (3D first, then `order`), so Big
Swell is the demo's first sample with no extra option. A sample that lives in `examples/` is added with `--also`, for
example the paused moment's Neon Run:

```bash
node scripts/build-web-demo.mjs --out <dir> --also examples/three-neon-boss
```

Each sample's Japanese line is in `src/hosts/browser/strings.js` (by its id).
