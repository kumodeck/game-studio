# test/canvas-ui/pixi-bubbles

Created: 2026-10-24 (studio-canvas-ui-3, stage 3)
Purpose: the "after" form of `examples/pixi-bubbles` for the screen test `test/studio-canvas-ui.browser.mjs --only pixi`:
the same game with its score and the note under it delivered through `codeUi()` as objects (`size: hud`, `onChange`
moves, sizes and colours each Text; CSS px, Pixi's autoDensity) and their colours in `codeTheme()` — what the AI writes
when asked "make this UI editable" (SKILL.md "UI drawn in the canvas"). The picture is the example's.

## Contents

- game.js - the example's game.js with the score and the note through codeUi / codeTheme (the test copies the example folder, then this file over its game.js, and the loader `studio-placement.js` next to it)
