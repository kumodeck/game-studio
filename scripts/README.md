# scripts

- `build.mjs` — builds dist/ with nothing but Node
- `bundle.mjs` — the tiny ES module bundler build.mjs uses
- `build-web-demo.mjs` — builds the browser-only web demo into one static folder (`--out <dir>`): the editor with `src/hosts/browser`, the two starters (`starters/`) as the samples, KUMODeck's tab icon (`web-demo-icon/`), and copies of the three.js / PixiJS modules they import (no CDN at run time)
- `build-docs.mjs` — builds the public docs (`docs/site/`) into static pages: English at the top, Japanese in `ja/`. `build-web-demo.mjs` calls it for the demo's `/docs/`; `--out <dir>` builds the docs alone to look at
- `docs-md.mjs` — the small Markdown → HTML converter `build-docs.mjs` uses (no dependencies; the part of Markdown it reads is in its header)
- `make-starter-assets.mjs` — makes the starters' asset files (`starters/<id>/assets/`) from code: pictures and the glTF in a headless browser (`starter-art/<id>.js`), sounds in Node (`starter-art/sounds.mjs`, MP3 via ffmpeg). Seeded, so a re-run writes the same files; `--check` only compares (exit 1 when a file would change)
- `starter-art/` — the painters and synths behind those files (see its README)
- `web-demo-icon/` — the web demo's tab icon (see its README)
