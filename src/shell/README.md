# src/shell

The studio page around the game ("one list, one card, one input", 2026-10-16).
PC: a top bar (▣ Studio / game / place, "Saved", the AI's dot, Play), the left
column (the Scene / Assets rows — linked both ways: the card's "Assets:
tree.png", the file detail's "In the scene: 2" —, the object list, "name
them" and "⌘K all actions" at its foot), the game edge to edge, the picked
object's card floating over the game's top right corner, and the bar at the
bottom of the game: news (the AI line, toasts, the first hint), the ⌘K list
(`palette.ts`: ask the AI, actions, ideas, objects; opens on ⌘K with a search
field of its own — what is typed there never touches the ask field (design review wave 1,
W1-4) — and while typing in the ask field only for a word that names an action
or object) and the ask field.
`ai-flow.ts` decides what the AI line says (sent → has it → working → done,
or "isn't watching" at once) and when the game reloads by itself after the
AI's change (in a second frame behind the old one, view and selection kept);
"Undo AI change" / "Redo" call `host.undoAi` (CONTRACT.md §3.4).
`sheet-fold.ts`: the bottom (list sheet, card, AI line) folded to the ask bar on a phone / in the side window — kept in this browser, the grip and ▾ fold, ▴ opens (2026-10-21)
`line-fade.ts`: the finished line (done / undone / redone, and "fixed" over the game)
goes by itself after 5–10 s, never while the pointer or keyboard is in it; "● AI"
in the top bar and ⌘K bring it back with its Undo (2026-10-20). A question, a
failure and every "on it" phase stay.
`play-ask.ts` is the one line over the game while playing (asked with ` in
▶ Play: looking → fixing → fixed with Reload, never reloaded by itself;
CONTRACT.md §3.5; the game page draws it, `bridge/play-ask.ts`). Phone:
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

Narrow screens (a phone, or the side window next to a chat; narrow pass
2026-10-17): the list sheet's head is one row — a Scene | Assets switch with
their counts, "Multi-select", and "…" for All actions (the ⌘K list) — so the
sheet is the list. Its foot padding is what the bar and the card really cover
(`--studio-cover`, measured in `sendInset`; a 2D card keeps its Layer row:
draw order is a main 2D move). PC is unchanged. `test/studio-narrow.browser.mjs` counts the readable rows.

2D draw order (layers): `layers.ts` (pure helpers: button/drag targets, the
front-first list) — the card's Layer row and the list's grips in
`placement-panel.ts`, one undo step per change in `main.ts`, the `order`
entries of placement.json in `placement-model.ts`.

Copy, delete, several at once (CONTRACT.md §1.8): `edit-ops.ts` (pure
helpers: copy keys, group draw-order moves, "all of this kind"); the card's
action row, "Select" (picking several) and group headings in `placement-panel.ts`;
compound undo entries in `undo.ts` and `main.ts`; `added` / `removed` of
placement.json in `placement-model.ts`. `pose-compare.ts`: the file's rounding and "the same pose" (shared with
the game page's Play code, `bridge/play-arrange.ts`).

Play without Save (a try of the editor, 2026-10-21): ▶ Play shows the arrangement as the editor has it, saved or
not (the bridge puts the draft on the page), and a new page of the game (back from Play, the AI's reload) gets back
what it does not show (`placement-model.ts` notShown, pushed in `main.ts`). (Said first by "Playing · unsaved
changes" in the top bar, then a strip over the game; now ▶ Play asks before, below.)
After an AI change (play-after-ai, 2026-10-21): an object the new code puts somewhere new gets that pose as its `was`
(so the draft Play reads still finds it); if the person had moved it, the person's pose wins and goes back to the page.
The violet "AI moved" mark is only for objects at neither the old code's pose nor the person's.

Before unsaved changes are lost (a try of the editor, 2026-10-21: "people forget Save — show a window when edits would be
lost"): `unsaved-guard.ts`. One window — "You have 3 unsaved changes", Save and continue (Enter) / Don't save / Cancel (Esc)
— only where something really goes: a game tool's data on a new game page (Play, Reload game, the AI's reload, Undo AI
change), and the Save itself when this page goes (a link of the page; the local studio only: in the web demo the draft is
the save). Closing the tab or reloading gets the browser's own question, only then. World ↔ UI, the Library and the
language ask nothing. `test/unsaved-guard.test.ts`, `test/studio-unsaved-guard.browser.mjs`.

▶ Play with changes not saved asks first (a try of the editor, 2026-10-21: "some people want to save, some want to try
it without saving — let them choose with buttons"): the same window (`unsaved-guard.ts` kind 'play', `main.ts`
togglePlay) — "You have 3 unsaved changes" / "Save, and your AI puts the changes in the game's code." — with **Save
and play** (orange, Enter), **Try without saving** and Cancel (Esc, a press outside). Save and play = Save as always
("Check before you save" first for big changes, obeyed), then Play; Try without saving = Play as before (the changes
stay, and Save · N); a game tool's data, which Try loses, gets one more line. The button, P and the ⌘K list alike; no
window without changes, none from Play back to Edit. Narrow: one button per row, the main one on top.
`test/studio-play-choice.browser.mjs`.

No first-run tips: the four-step intro over the ask bar (`intro.ts`, "1/4
Click an object…") was removed on 2026-10-17 after a try of the web demo — the
editor opens on the game alone. An old `intro` in `.studio/ui/prefs.json` is
ignored.

Entries: `local.ts` (studio-shell.js, the local server with `host-local.ts`)
and `src/hosts/browser/main.ts` (the browser-only web demo). Both call
`start(host)` from `main.ts`; a host with `offline: true` (no AI behind it)
gets no "say 'look'" nudge and keeps the whole request text in the AI line; since
design review wave 1 (W1-6) it shows no ask field and no "● AI" at all, and since 2026-10-18 nothing
in the ask field's place either (the demo's top line says it isn't connected to an AI).

Names in the list and on the card (`names.ts`, polish pass 2026-10-16): an object without a name is called
by its picture / model file, else by a name guessed from what it looks like (`Item.look`, a hands-on try,
2026-10-19: "Black pillar by the road (left, 3rd)", the road "Road", the sky "Sky"),
else by its kind ("Unnamed shape"), never by its tree path or "group"; the second "tree" reads "tree 2". The keys
themselves do not change. A guessed name shows on two lines on the card (what it is / which one) and as only "which
one" under its group heading; the ask chip keeps it short ("Black pillar", several: "×4"). A mouse over a row, the card or
the chip lights the object in the game (`placement/hover`). `thumb-tone.ts` gives near-white list pictures a mid-grey tile.
`thumb-fit.ts` crops every picture the game sends to the object itself with a 4 px margin at 32 px (W1-11:
the lighthouse was an "i"). Ideas and Editor view flow down inside the list's own column (W1-3; they used to
widen it to ~950 px) and close with Esc.

One Library (decided after a try of the editor, 2026-10-18; it replaced plan 1's two shelves of the same morning): the left
column has two rows, **Scene** (the game, with its object list under "In this scene") and **Library** (every object
and every asset, counted). The Library takes the game's place (PC) or is a sheet (phone): one search, one count, ONE
grid — the objects first (a tile per kind, "pine ×3"), then the files — each tile tagged "Object" / "Asset" in grey,
and one detail at a time on the right. Its filters fill the left column (PC) or one sideways row of chips (phone):
All / 3D / 2D / Sound / Other and nothing else (a review of the editor, 2026-10-18: four headed groups — Show, Made from, Asset type,
Use — were too many to tell apart). A 3D game's objects count under 3D, a 2D game's under 2D; files go by their type
(models 3D; images and sprite sheets 2D; sounds Sound; fonts, JSON… Other); a shelf with nothing on it is hidden. A press on an object's tile picks it and shows its detail (its file "planks.jpg →", where it is,
Show in game →, Duplicate, Delete) — the Library stays; the game's echo of that pick no longer switches to the Scene.
Only "Show in game →" or the Scene row go to the game. A file's detail names the objects that use it, "Show just these
objects" narrows the Library to them, a name opens that object's detail; opening a file drops the objects' pick (one
thing open at a time). Keys that move the pick do nothing while the Library hides the game. Orange is only the pick:
"Used by 3", an object's file and the "planks.jpg used by 3 ×" band are grey. `library-objects.ts` is the objects'
part (`ShellContext.objects`, contract.ts `LibraryObjects`); the page is the Library tool (`tools/library/panel.ts`).
`test/studio-library.browser.mjs` checks it all and takes the pictures.

Save in the game (a try of the editor, 2026-10-20 → 21; replaced by the one Save beside ▶ Play, below): only while
something is not saved, "Save · 3  ⌘S" at the game's bottom right — PC on the ask bar's row (the bar keeps room for
it on both sides, so it never moves), phone / side window just over the bar, card or list sheet with the camera ↑↓
above it — in the solid (Play's fill), not a new colour; the only Save (the top bar keeps "✓ Saved"). Pressed: "✓
Saved" in the same place for a moment, then gone. The picked object's card has a minimize button at its head's right
end: one line (picture and name), kept across picks and reloads in this browser (`placement-panel.ts`).
`test/studio-save-fab.browser.mjs`.

Save, loud (a try of the editor, 2026-10-21, a second look: the black "Save to game · 1" was not noticed; `save-loud.ts`):
KUMO's orange (`--you`, white words — the one place orange is a fill; a pick is only ever an outline, tint or dot) and
one bounce when a change first appears (not on later changes, not back from Play, not with reduced motion); while
playing, a strip over the top of the game said "This change isn't in the game yet" with an orange "Save" and × (it
replaced the grey "· unsaved changes" after "Playing"; gone the same day, when ▶ Play began to ask first, above).

One Save (a try of v0.1.9, 2026-10-21: "why are there two buttons that do the same thing?" / "'Save to game' — I don't
get what that means"): the Save in the game's corner above is gone, and so is the word "Save to game". There is ONE
Save, right beside ▶ Play in the top bar (`main.ts` topSave, `data-action="save"`), in Edit and in Play, on a PC, in
the side window and on a phone: "Save · 3  ⌘S" (no key on a phone), orange, the one bounce. Its tooltip is one
sentence: "Save, and your AI puts it in the game's code (the game outside the editor changes too)". Pressed: "✓ Saved"
in its place for a moment, then gone, and the quiet "✓ Saved" left of Undo takes over. Narrow top bars: the game's
title gives way (it ends in "…"); Save and Play keep their size (checked down to a 320 px phone). `test/save-loud.test.ts`, `test/save-loud.browser.mjs`, `test/studio-save-fab.browser.mjs`.

Basic actions with a button AND a shortcut (basics pass, 2026-10-18; from a try of the editor: "undo, redo…
keyboard shortcuts and buttons"): Undo / Redo always in the top bar (dimmed when there is nothing to undo; "✓ Saved" left of them so they
never move), ⌘C / ⌘V (paste = duplicates of what was copied), 1–4 for the strip's tools, and `?` for the sheet of
every shortcut. `keymap.ts` is the one table of keys that the tooltips, the ⌘K rows and the sheet (`shortcuts.ts`)
print; `tooltip.ts` is the buttons' own tooltip (name, then the key in grey). While typing in a field only ⌘S and
⌘K reach the editor. `test/keymap.test.ts`, `test/studio-basics.browser.mjs`.

The place's menu (context menu, 2026-10-18; a request after a try of the editor: "right-click in each place should bring up the menu for it — in
the scene, duplicate, delete, that kind of thing"): a right-click (Mac: also Control-click), a finger held still for
450 ms on a phone, or the menu key opens a small menu for what is under it. `context-rows.ts` says what each place lists
(an object in the game or its list row: Ask your AI · Rename / name it · Duplicate · Copy · Paste · Delete · 2D draw
order · Undo · Redo; nothing in the game: Paste · Select all · Deselect · Show all · Back to the opening view · Undo ·
Redo; a Library object: Details · Show in game · Duplicate · Delete; a Library file: Details · Show just these objects ·
Replace…), with the names and keys of `keymap.ts`; rows that cannot act are dimmed, not removed; no "Ask your AI" in
the web demo. `context-menu.ts` draws it (glass, nesting corners, grey highlight — orange stays the pick), places it at
the pointer (above a finger), runs ↑ ↓ Enter Esc, and puts a clear layer over everything so the press outside only
closes it. What is pressed is picked first unless it already is (the camera never moves); the game frame reports its
own right-clicks and long presses (`placement/context`, bridge/input.ts), away from the strip's buttons and their own
long press. The browser's menu stays out of the editor except in text fields. `test/context-rows.test.ts`,
`test/studio-context-menu.browser.mjs`.

Using the Library ("use the Library", 2026-10-18; a request after a try of the editor: "I can look at things in the Library,
but it doesn't do anything yet — I want to add from it to the scene, and point at an enemy there and ask the AI to make it
the boss at the climax", and "when I pick something in the game, take me straight to its page in the Library"):
- **Add to scene** on an object (its detail, its tile's menu, or its tile dragged onto the Scene row) puts one copy of each
  picked kind in the middle of what the camera sees (`placement/copy` with `at: 'view'`: on the ground under the view in
  3D), then shows the Scene with the copy picked; the camera stays; one undo step, like Duplicate.
- **Add to scene** on a file is the AI's job (a new object is code): the ask box gets "Add this to the scene" with the
  file's chip and Enter sends it (`assets` in the request). The web demo dims the button and says why in one line.
- A pick in the Library — objects, files, or both with Shift / Multi-select — fills the ask box's chip, the same box
  as in the Scene ("pier", "barrel.glb", "2 files", "3 picked"); **Ask your AI…** puts the cursor there. Requests name
  each object's files (`objects[].files`) and the picked files (`assets`).
- From the Scene: the card's **Show in Library →**, the object's menu (**Show in Library**, **Show its asset in Library**)
  and ⌘K open the Library on that object's detail (its file one press further); the camera never moves.
`test/studio-library-use.browser.mjs`.

The timeline (studio-timeline, 2026-10-22: "make motion like Unity or Blender"; CONTRACT.md §1.9; it replaced motion-gui's card menu the same day): `timeline-panel.ts` draws the
plate (▶ / ❚❚, the time, ● Auto key, the motion's menus, the ruler, a row per object with its keys) and reports presses;
`timeline-wire.ts` holds its state and decides what a move, a typed number, a dragged path point or a key press does
(auto key on: a key at the time line; off or folded: the place moves), sends `timeline/pose` / `timeline/path` to the
game page, and gives the card its Motion row (the object's motions and "◆ Timeline"); `timeline-model.ts` is the pure
part (keys set / moved / deleted / copied, ease, templates, the older shape read as a clip, the pose at a time with the
loader's `clipAt`); `motion-model.ts` what is remembered (each object's motion now and at the last save, inside the
world's `PlacementModel`, written rounded). 3D only in stage 1.

The UI's screens, looks and theme (UI stages 2–3, studio-ui-edit-2, 2026-10-22; CONTRACT.md §1.11): `ui-wire.ts` ties
them to the bridge, undo and Save (main.ts only calls in). `ui-screens.ts` is the UI list's head in a game with screens
("Title ⌄  1 of 4", the same button and menu as the levels' head); `ui-card.ts` the card's look rows under the offset
and size (State for a button, Text with its px size, Color, Fill, Sample — the sample is never saved); `ui-theme.ts`
the Theme fold under the UI list (the game's CSS variables on `:root`); `ui-style-model.ts` the pure store (now, saved,
the game's own; `set` / `setWas` / `theme` of placement.json; the validator's rules before a value is taken), with
`ui-layer.ts` withLooks / withUi writing the file. `test/ui-edit-2.test.ts`, `test/studio-ui-edit-2.browser.mjs`.
