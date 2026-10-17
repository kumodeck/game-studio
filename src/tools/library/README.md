# src/tools/library

The Library tool: the files a game uses, thumbnails, unused / code-only /
missing badges, object ⇄ asset links, replace and add. Writes library.json.

It never edits game code. "Replace" is a note for the user's AI (plus an
in-game image preview that is not saved); "add" writes a NEW file under
`assets/` through the host (never an overwrite).

## Files

- `index.ts` — `libraryTool` (the `ShellTool` the shell mounts) and
  `renderFilesOfObject()` for the placement panel ("files of this object").
- `panel.ts` — the panel UI. Talks only through `LibraryDeps`, so the same code
  runs in the shell, the dev harness and later the cloud shell.
- `refs.ts` — names of asset files found in HTML/JS/CSS text, matched against
  the folder (`buildAssetList()` builds the contract's `listAssets()` answer).
- `marks.ts` — one row per file from the three sources (folder, code, loads +
  `assetsOf`) with exactly one badge; filters; `normalizeList()` accepts the
  contract shape and the early local-server shape.
- `result.ts` — the creator's decisions and the library.json built from them
  (validation is done by `src/schema`).
- `in-game.ts` — runs inside the game iframe: object → files from engine
  textures (three.js, PixiJS) and the image preview (`previewImage()`).
- `thumbs.ts` — glb/gltf thumbnails rendered with the shell's own three.js
  (CDN, separate from the game's copy), atlas and font previews.
- `strings.ts` — English / Japanese UI text. `styles.ts` — panel CSS (`gsl-`).
- `dev/` — test doubles and samples for trying the tool before the real shell
  and server are joined (see `dev/README.md`).

Unit tests: `node --experimental-strip-types --test test/library-data.test.ts`.
