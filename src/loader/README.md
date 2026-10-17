# loader

`studio-placement.js`: `applyPlacement(root, url)` applies `placement.json` to a three.js Scene or a
PixiJS stage when the game starts: moves (`objects`), draw orders (`order`), and since 2026-10-16 the
editor's copies (`added`, cloned from `from`) and deletions (`removed`, hidden). The build copies it,
comments stripped (under 6 KB), to
`skills/arrange/bin/studio-placement.js`; the agent copies that file into a game when the user
chooses "add the loader" instead of rewriting numbers in code.

- `studio-placement.test.mjs` - `node --test src/loader/studio-placement.test.mjs` (source and built copy)
- `fixtures/` - two tiny games (three.js, PixiJS) for the headless end-to-end check
