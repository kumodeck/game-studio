# test/play-ask

Created: 2026-10-20
Purpose: a tiny three.js game for `test/studio-play-ask.browser.mjs` (ask your AI while playing, CONTRACT.md §3.5).

## Contents

- `vanish/index.html`, `vanish/game.js` — a hero that walks (WASD / arrows) with a camera behind it, three crates and
  a glowing pad. F toggles full screen. The bug on purpose: standing still on the pad for a second hides the hero
  (and logs a warning). `window.__game` lets the test put the hero on the pad. The test's stand-in agent fixes it by
  removing the line marked `BUG`. Its HTML UI (2026-10-20): a magenta "Score 120" top right (`data-studio-key="score"`),
  a Pause button and a name field holding "my secret name" — the request's picture must show the score, and the field's
  words must never go with the request.
