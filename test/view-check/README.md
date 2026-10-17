# test/view-check

Created: 2026-10-16
Purpose: fixtures for `test/view-check.browser.mjs` (the `studio.mjs --check-view` test).

- `pixi-garden-adapter-before-cc4bd6e5.js` - the pixi-garden `.studio/adapter.js` as it was before
  commit cc4bd6e5. Its `capture()` leaves objects as Pixi v8 render groups, so after the library
  thumbnails the trees, house, rocks and flowers vanish from the editor's picture (a trial on
  2026-10-16). Kept unchanged on purpose: the view check must fail on it.
