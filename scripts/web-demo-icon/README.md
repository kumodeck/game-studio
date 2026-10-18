# scripts/web-demo-icon

Created: 2026-10-17
Purpose: the web demo's tab icon. `scripts/build-web-demo.mjs` copies these to the demo's root, writes
`favicon.ico` (the 32-px PNG in an ICO wrapper) and links them from the sample list and the editor page.

WHY: the hosted demo answered `/favicon.ico` with a 404 (a console error for every visitor, and a blank tab).

- `favicon.svg` — KUMODeck's icon (orange rounded square, the white cloud with two eyes)
- `favicon-32.png` — the same at 32×32 (inside favicon.ico)
- `apple-touch-icon.png` — 180×180, for the iPhone home screen

They are copies of KUMODeck's current site icon, kept here so the package builds on its own. When the KUMODeck
icon changes, copy the new files over these.
