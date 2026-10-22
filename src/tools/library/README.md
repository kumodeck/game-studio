# src/tools/library

The Library tool: the files a game uses, thumbnails, unused / code-only /
missing badges, object ⇄ asset links, replace and add. Writes library.json.

It never edits game code. "Replace" is a note for the user's AI (plus an
in-game image preview that is not saved); "add" writes a NEW file under
`assets/` through the host (never an overwrite).

## Files

- `index.ts` — `libraryTool` (the `ShellTool` the shell mounts),
  `renderFilesOfObject()` for the placement panel ("files of this object"),
  `filesOfObjects()` (every object's files at once, for the objects' tiles),
  `libraryParts()` (the open panel's filters and head, which the shell places) and
  `libraryRedraw()` (the shell's pick changed).
- `panel.ts` — the panel UI. Talks only through `LibraryDeps`, so the same code
  runs in the shell, the dev harness and later the cloud shell. With `objects`
  (the shell's `ShellContext.objects`, "one Library" 2026-10-18) it is the whole
  Library: objects and assets in one grid, one row of filters (All / 3D / 2D /
  Sound / Other — the game's objects under its 3D or 2D, files by type; a review
  2026-10-18), one search, one count, one detail at a time. Without it (the dev
  harness) it lists files only. Its filters are one element (`filtersEl`) the
  shell moves into its left column on PC; a file's card says "Used by 3", and its
  detail names the objects with "Show just these objects" and "Show in game →". With the shell's `files`
  (`LibraryFileUse`, "use the Library" 2026-10-18) a file's detail also has "Add to scene" and "Ask your AI…",
  Shift / Multi-select picks several files, the pick goes to the ask box's chip, and a file's tile can be dragged
  onto the Scene row (`DRAG_FILE`). On a phone the bar's buttons (Multi-select, Add files, Make with AI) fold into one
  "+" next to the search (the shell's phone CSS shows it), so the Library's head is two rows; tiles carry no
  Object / Asset tag (the second design review, 2026-10-19).
- `ai-make.ts` — "Make with AI", the place to make things (generate-ui, 2026-10-22): five kinds (image, 3D,
  sound effect, music, voice line) through the optional KUMODeck sign-in, example words, the price and balance
  before Make, the wait with a clock, a "Just made" card (▶ / the image, "Add to scene", "Ask your AI…") and
  "Made here" from `.studio/generated.json` with Again / Change (nothing is sent until Make).
  `gen-kinds.ts` — the kinds as data (price, usual wait, examples, history line → form); `gen-made.ts` — the
  card and the history.
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

Unit tests: `node --experimental-strip-types --test test/library-data.test.ts test/generate.test.ts`.
