# test/canvas-ui/screens

Created: 2026-10-24 (studio-canvas-ui stage 2)
Purpose: a game whose whole UI is drawn in one canvas through `codeUi()`, on two screens ('play': a score whose box
follows its text and a health bar; 'over': GAME OVER and RETRY). Its drawing asks the editor which screen to draw
(`studio.screen()`, else its own `game.screen`). For `test/studio-canvas-ui.browser.mjs --only screens`.

## Contents

- index.html - one full-window canvas `#hud`
- game.js - the game (imports `codeUi` from the `studio-placement.js` the test copies in)
