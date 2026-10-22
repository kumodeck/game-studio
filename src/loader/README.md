# loader

`studio-placement.js`: `applyPlacement(root, url)` applies `placement.json` to a three.js Scene or a
PixiJS stage when the game starts: moves (`objects`), draw orders (`order`), and since 2026-10-16 the
editor's copies (`added`, cloned from `from`) and deletions (`removed`, hidden), and since 2026-10-22 the motions
made on the editor's timeline (`motion` clips: `start` ones play at once, the others on `playMotion(key, name)`; the
older path / spin too). Inside the editor's page it moves nothing, until ▶ Play turns that page into Play: then the
editor starts the draft's motions through its play hook (`Symbol.for('game-studio.play')`, studio-no-reload,
2026-10-22) and stops them back in Edit. The build copies it,
comments stripped (under 6 KB), to
`skills/arrange/bin/studio-placement.js`; the agent copies that file into a game when the user
chooses "add the loader" instead of rewriting numbers in code.

- `studio-placement.test.mjs` - `node --test src/loader/studio-placement.test.mjs` (source and built copy)
- `fixtures/` - two tiny games (three.js, PixiJS) for the headless end-to-end check
