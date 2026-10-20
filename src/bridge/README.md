# src/bridge

The edit script that runs inside the game page (`dist/studio-edit.js`).
Publishes `window.studio`, finds an adapter, runs the self-check, turns
pointer/touch input into adapter calls, draws the handles (DOM inside the game
page) and talks to the shell with `studio:*` messages. See CONTRACT.md §1–2.

- `main.ts` — entry: built-in probes + startBridge
- `bridge.ts` — global API, adapter discovery, message routing
- `editor.ts` — edit session: messages → adapter, draw loop, key/step runs
- `input.ts` — gestures (select, Shift/box selection, dragging the picked object, look around, pan, pinch, wheel), the tool strip's chosen tool (a button / M H T S chooses it, then a drag anywhere uses it; Option, right drag, Space or two fingers look around) and the outlines (cached `adapter.silhouette`)
- `handles.ts` — what is drawn on the game: the tool strip (the chosen tool stays pressed), the readout while a drag works, the first-time "how to look around" line, the orange outline and name tag of the selection, the violet marks of the AI's change, stand-ins, the box
- `rise.ts` — camera up / down: the ↑↓ buttons in the game's bottom-right corner (3D adapters with `view.rise`); input.ts does their click / hold / drag and the E / Q keys (with `view.fly`, E / Q fly up / down while held, with W A S D: input.ts's header has the rules)
- `snap.ts` — snap to surfaces (3D): the height drag's stop on the surface below (pull 30 px past it to go through), PgDn's stop, several objects (the first to touch), Ctrl / ⌥ to move without snapping; the adapter finds the surfaces (three: `adapters/three/surface.js`)
- `group.ts` — moving, turning and resizing several selected objects together
- `play-ask.ts` — ▶ Play only: ask your AI without stopping the game (` or the corner mark opens a field over the game, full screen too); sends the words with the moment (a picture of the canvases, the player's camera and what is near through the adapter, the console's errors and last lines) and shows the AI's progress in one line at the top (CONTRACT.md §3.5)
- `selfcheck.ts` — adapter self-check
