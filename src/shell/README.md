# src/shell

The studio page around the game ("one list, one card, one input", 2026-10-16).
PC: a top bar (▣ Studio / game / place, "Saved", the AI's dot, Play), the left
column (the Scene / Assets rows — linked both ways: the card's "Assets:
tree.png", the file detail's "In the scene: 2" —, the object list, "name
them" and "⌘K all actions" at its foot), the game edge to edge, the picked
object's card floating over the game's top right corner, and the bar at the
bottom of the game: news (the AI line, toasts, the first hint), the ⌘K list
(`palette.ts`: ask the AI, actions, ideas, objects; opens on ⌘K, and while
typing only for a word that names an action or object) and the ask field.
`ai-flow.ts` decides what the AI line says (sent → has it → working → done,
or "isn't watching" at once) and when the game reloads by itself after the
AI's change (in a second frame behind the old one, view and selection kept);
"Undo AI change" / "Redo" call `host.undoAi` (CONTRACT.md §3.4). Phone:
top bar, game, the 56 px card and the ask bar at the bottom, the list and
Assets as sheets. Selection, undo/redo (200 steps), a draft of every change as
you go and Save (§3.4), English/Japanese, dark and light (the device's
setting unless the Look page says otherwise).
`icons.ts` draws the line icons (one 20×20 grid, `currentColor`).

The look (the "finish" pass, same day; places, order and presses unchanged)
is written as six rules at the head of `shell.css`: two surfaces (the desk —
top bar and column, no lines — and one frosted glass for everything that
floats over the game, the strip inside the game included), no colour of its
own besides orange = you and violet = the AI, corners that nest (plate 18 /
part 10, phone 22 / 14), two type sizes with tabular figures, the PC game as
a plate on the desk, and one motion curve. The kind headings of the list
stay at the top while their rows scroll; the phone sheet grows by what the
picked object's card covers.

2D draw order (layers): `layers.ts` (pure helpers: button/drag targets, the
front-first list) — the card's Layer row and the list's grips in
`placement-panel.ts`, one undo step per change in `main.ts`, the `order`
entries of placement.json in `placement-model.ts`.

Copy, delete, several at once (CONTRACT.md §1.8): `edit-ops.ts` (pure
helpers: copy keys, group draw-order moves, "all of this kind"); the card's
action row, "Select" (picking several) and group headings in `placement-panel.ts`;
compound undo entries in `undo.ts` and `main.ts`; `added` / `removed` of
placement.json in `placement-model.ts`.

No first-run tips: the four-step intro over the ask bar (`intro.ts`, "1/4
Click an object…") was removed on 2026-10-17 after a try of the web demo — the
editor opens on the game alone. An old `intro` in `.studio/ui/prefs.json` is
ignored.

Entries: `local.ts` (studio-shell.js, the local server with `host-local.ts`)
and `src/hosts/browser/main.ts` (the browser-only web demo). Both call
`start(host)` from `main.ts`; a host with `offline: true` (no AI behind it)
gets no "say 'look'" nudge and keeps the whole request text in the AI line.

Names in the list and on the card (`names.ts`, polish pass 2026-10-16): an object without a name is called
by its picture / model file or its kind ("Unnamed shape"), never by its tree path; the second "tree" reads
"tree 2". The keys themselves do not change. `thumb-tone.ts` gives near-white list pictures a mid-grey tile.
