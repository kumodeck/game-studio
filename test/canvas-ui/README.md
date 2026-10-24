# test/canvas-ui

Created: 2026-10-24 (studio-canvas-ui, stage 1)
Purpose: the "after" form of `examples/three-canvas-hud` for the screen test `test/studio-canvas-ui.browser.mjs`: the
same game with its HUD drawn through `codeUi()` (score, health bar, round JUMP button, minimap), as the AI writes it
when asked "make this UI editable" (SKILL.md "UI drawn in the canvas"). The picture is the same to the pixel as the
example's plain drawing (the test compares them).

## Contents

- game.js - the example's game.js with drawHud() rewritten through codeUi() (the test copies the example folder, then this file over its game.js)
- screens/ - a one-canvas game with two screens of canvas UI ('play', 'over') for the stage 2 screen test (studio-canvas-ui-2, 2026-10-24)
- phaser-runner/ - examples/phaser-runner after the rewrite: the distance a codeUi kept as an object (onChange), its ink a codeTheme (stage 3, studio-canvas-ui-3, 2026-10-24)
- pixi-bubbles/ - examples/pixi-bubbles after the rewrite: the score and the note as objects, their colours a codeTheme (stage 3)
