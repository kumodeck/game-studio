# scripts

- `build.mjs` — builds dist/ with nothing but Node
- `bundle.mjs` — the tiny ES module bundler build.mjs uses
- `build-web-demo.mjs` — builds the browser-only web demo into one static folder (`--out <dir>`): the editor with `src/hosts/browser`, the three-crates and pixi-garden samples, and copies of the three.js / PixiJS modules they import (no CDN at run time)
