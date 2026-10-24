# schema

The one validator for the two result files (contract 4): `placement.json` and `library.json`.

- `studio-files.mjs` - `validateStudioFile(input, { tool })` returns the normalized value and its
  canonical JSON text, or a list of errors. Also `canonicalJSON`, `isSafeRelativePath`, `LIMITS`,
  `KEY_RE`. No imports: the same file runs in Node, in the browser and inside the bundled CLI.
- `handoff.mjs` - the hand-offs to the AI (contract 3.4): `normalizeRequestInput`, `normalizeStatus`, `requestId`,
  `statusCovers`. Shared by the shell, the local server and a hosted server. Tests: `test/handoff.test.mjs`
- `hands.mjs` - the AI's editor work (`--do`, CONTRACT.md §3.6, 2026-10-24): `readHandsInput` (the ops, read loudly),
  `handsMotion` (a Library motion from points or keys, checked with the validator), `handsPose`, `handsClip`,
  `handsDefaultWhen`, `handsSaid` (the `studio: did …` words), and `applyHandsToFile` (the same ops on placement.json
  when no editor is open). Shared by the CLI (src/server/hands-cli.mjs) and the editor (src/shell/ai-hands.ts).
  Tests: `test/ai-hands.test.mjs`
- `studio-files.test.mjs` - `node --test src/schema/studio-files.test.mjs`

Everything that accepts or writes these files uses this module (editor shell, local server, any
hosted server), so they all agree byte for byte on what a valid file is.
