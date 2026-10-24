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

Since studio-offsets (2026-10-24) a code layout's `places[id].offsets` shift the whole rule (`offsetFrame`: one row
or two parallel rows — a road's two sides — ranks per row, side away from their middle line; `offsetAt`: same / zigzag
/ ramp / jitter), after `at()` and before the keep-out areas and the pins (`test/offsets.test.mjs`). Since
studio-writeback (2026-10-24, "the code is the truth") an at() answer with `hand: true` (a pin the AI wrote into the
rule) is out of the keep-out areas' reach and of the row's frame, `by` in an answer is added after the frame is read (a
saved zigzag / ramp / jitter keeps the row a row), and `jitter(seed, i, axis)` is exported so the game's
code gives the same jitter numbers the editor showed.

Since studio-canvas-ui (2026-10-24) `codeUi(id, def)` names a UI the game draws in a canvas (a score, a health bar, a
button): its handle answers `box()` (measured from one of 9 places of the canvas, in CSS px or the canvas's own px),
`look(state?)`, `value(v)`, `hit(x, y)` and `state()` every frame — from the editor's live values while it edits, from the
file's `ui.<id>` (`code`, `from`, `at`, read at draw time) before Save, else from the code. `uiBoxAt` / `uiAtOf` /
`uiNearest` are the 9 places' maths, shared with the editor (`test/code-ui.test.ts`).
Stage 3 (studio-canvas-ui-3, 2026-10-24): `onChange(fn)` for engines that keep their UI as objects (Phaser, Pixi: called
once and on every change of the box or the look), `size` as that object (its `getBounds()` at its own scale 1), a sample
shown on a Text object while the editor holds the game, and `codeTheme({ accent: { v, label } })` — the canvas UI's theme
(getters, `onChange`, a look's `var(--accent)`), read from the file's `theme` before Save (`test/code-ui-3.test.ts`).

- `studio-placement.test.mjs` - `node --test src/loader/studio-placement.test.mjs` (source and built copy)
- `fixtures/` - two tiny games (three.js, PixiJS) for the headless end-to-end check
