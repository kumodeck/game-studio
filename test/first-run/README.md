# test/first-run

Created: 2026-10-16
Purpose: fake starters for the "first 5 minutes" tests (`first-run.test.mjs`, `studio-first5.browser.mjs`), used
instead of the real `starters/` so the tests do not depend on them.

## Contents

- `starters/fake-3d/` - a tiny three.js scene (3 named boxes, three from the CDN) with `starter.json`, a `thumb.png`,
  a `README.md` and a `.studio/requests/` note that must **not** be copied into the game
- `starters/fake-2d/`, `starters/fake-2d-late/` - two 2D starters (order 1 and 2: `--starter 2d` takes order 1)
- `starters/broken/` - an `index.html` with a broken `starter.json`: skipped, never offered
