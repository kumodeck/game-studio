# three-canvas-hud

Created: 2026-10-24 (studio-canvas-ui, stage 1)
Purpose: sample three.js (r186) runner whose HUD is drawn **in a 2D canvas** over the world — a score, a health bar, a
round JUMP button and a minimap, no HTML UI at all. For the editor's "UI drawn in the canvas" (CONTRACT.md §1.13,
a request of 2026-10-24: "I want to edit the UI drawn inside the canvas, not only the HTML UI, as UI").

It is kept in the shape **before** the AI's rewrite: `drawHud()` in `game.js` is plain canvas code with its numbers in
the drawing (`fillText(…, 26, 40)`, `arc(w - 24 - 36, …)`), as an AI usually writes it first. The editor cannot know
where the score is, so the UI layer has nothing to pick yet: it shows the four parts as faint dotted frames "Not
selectable yet", and a press on one says why with "✦ Ask … to make this UI editable" (stage 2). Ask your AI "make this UI editable": it rewrites the drawing
with `codeUi()` (SKILL.md "UI drawn in the canvas"; the picture stays the same to the pixel), sends `--do ui.code`, and
the score, the bar, the button and the minimap are picked, moved, resized and recoloured like HTML UI.

- `index.html` — two canvases: the world (three.js, prepended by `game.js`) and `#hud` over it (z-index 1).
- `game.js` — the world (a neon road, a city, the player `player`, six hexagons `hex-1`…`hex-6` that the game moves
  itself) and the HUD. Seeded (the same world every load) and started mid-run (score 12,480, 7 of 10 health), so the
  first frame — the one the editor holds — shows real numbers, and a picture before / after the rewrite can be compared.
- `studio-placement.js` — the placement loader (kept up to date by the build); the AI's rewrite imports `codeUi` from it.

Try: `node skills/arrange/bin/studio.mjs examples/three-canvas-hud` (from `oss/game-studio`), ask the AI "make this UI editable",
then press **U** (or **Scene | UI** in the top bar) and pick the score.

Tests: `test/studio-canvas-ui.browser.mjs` (with the rewritten form in `test/canvas-ui/`), `test/ai-feel/real-ai.mjs`
(the real AI makes the rewrite).
