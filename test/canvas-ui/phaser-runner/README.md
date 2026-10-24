# test/canvas-ui/phaser-runner

Created: 2026-10-24 (studio-canvas-ui-3, stage 3)
Purpose: the "after" form of `examples/phaser-runner` for the screen test `test/studio-canvas-ui.browser.mjs --only phaser`:
the same game with its distance text delivered through `codeUi()` as an object (`size: this.hud`, `onChange` moves,
sizes and colours it; Phaser's own pixels, `units: 'canvas'`) and its ink colour in `codeTheme()` — what the AI writes
when asked "make this UI editable" (SKILL.md "UI drawn in the canvas"). The picture is the example's.

## Contents

- game.js - the example's game.js with the distance through codeUi / codeTheme (the test copies the example folder, then this file over its game.js, and the loader `studio-placement.js` next to it)
