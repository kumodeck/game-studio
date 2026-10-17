# src/tools/library/dev

Test doubles and sample games for trying the library tool in a browser
before the real shell (`src/shell`) and local server (`src/server`) are
joined. Nothing here is shipped or bundled into the plugin.

## Files

- `make-samples.mjs` — writes two sample games with generated assets (PNG,
  GLB, WAV, a sprite atlas): `three-garden` (three.js) and `pixi-pond`
  (PixiJS v8). Each shows every badge: used, only in code, unused, missing,
  and a file whose name is built at runtime.
- `serve.mjs` — stand-in for the local server: the library's routes of the
  local HTTP API (CONTRACT.md §3.2), folder-only serving, add-only uploads,
  validation through the shared schema. No token: own machine only.
- `stand-in.ts` — stand-in for the edit script inside the game: finds the
  engine roots through the public hooks, answers `studio:library/assets`
  and applies `studio:library/preview` with `../in-game.ts`.
- `harness.html` / `harness.ts` — stand-in for the shell: game frame, the real
  `libraryTool` through a fake `ShellContext`, a Save button, and a stub of
  the placement panel showing "files of this object".

## Try it

```sh
node src/tools/library/dev/make-samples.mjs /tmp/samples
node --experimental-strip-types src/tools/library/dev/serve.mjs /tmp/samples/three-garden \
  [--schema <path to the shared validator module>]
# open the printed http://127.0.0.1:<port>/__studio/harness (add ?lang=ja for Japanese)
```

The samples load three.js / PixiJS from a CDN, so the browser needs network
access.
