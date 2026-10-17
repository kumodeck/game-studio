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
- `group.ts` — moving, turning and resizing several selected objects together
- `selfcheck.ts` — adapter self-check
