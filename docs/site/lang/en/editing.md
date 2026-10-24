---
title: Editing
nav: Editing
order: 2
written-for: 0.1.49
description: Select, move, turn and resize things in your game, look around, use the Library, and save.
---

# Editing

Click something in your game and drag it. That’s most of it. This page covers the rest: the tools under a selected object, the camera, the menus, the Library and Save.

The editor has three parts: the column on the left (**Scene** and **Library**), the game in the middle, and one box at the bottom for your AI. Two colors mean one thing each: **orange is your hand** (what you selected), **violet is your AI’s hand** (what its last change touched). A third, a quiet **sand**, marks a thing you placed by hand outside its rule (see below).

## Select

- **Click** (or tap) an object to select it. Click the same spot again to select the one behind it.
- **Click nothing** (the sky, the sea, the ground) to deselect. Big things like the ground are selected from the Scene list instead, so you don’t grab them by accident.
- Selecting from the **Scene** list (or ⌘K, or **Show in game** in the Library) doesn’t move your camera when the object is already on screen. Only when it’s out of sight does the view slide to it, and never so far that it ends up tiny. Deselecting never moves the camera either.
- <kbd>Esc</kbd> steps back: it closes an open menu, then puts the tool down, then deselects.

![Lantern Cove with the lighthouse selected: an orange outline, its name, and the tool strip under it](media/selected.webp)

## Move, lift, turn and resize

Drag a selected object to move it. The strip under it has four tools. Press one, then drag anywhere (not just on the object):

| Tool | Key | Drag |
|---|---|---|
| Move | <kbd>M</kbd> or <kbd>1</kbd> | Moves it along the ground. |
| Height (3D) | <kbd>H</kbd> or <kbd>2</kbd> | Up and down. |
| Turn | <kbd>T</kbd> or <kbd>3</kbd> | Left and right turns it, in 15° steps. |
| Size | <kbd>S</kbd> or <kbd>4</kbd> | Right or up makes it bigger. |

The tool stays chosen until you press <kbd>Esc</kbd> or choose another. A readout next to the strip shows the numbers as you drag.

**Things your game moves, and tools that don’t work.** The four tools are always there, in the same places, with the same pictures. When there is something to know about what you picked, one small line shows right under (or over) the strip.

![A hexagon the game moves: the strip keeps the plain Move, and the line under it says Your game moves this while playing. Moving it here sets where it starts.](media/strip-game.webp)

- **Your game moves it** (a runner’s obstacles, a spinning coin): **Move** works as always. Where you put it is where it starts; when the game plays, it moves it on from there.
- If your game turns or resizes it, **Turn** or **Size** is dimmed and pressing it does nothing. To change that, ask AI in the box below.
- **A ground, road or sky** is locked so a stray drag can’t move it. The line under the tool strip says so, and its **Unlock** frees it.
- **Your game’s rules lock it**: the tools are dimmed, and the same line says why.

![The Turn tool chosen on the lighthouse](media/turn.webp)

**More ways to turn and resize.** The small ▾ in the corner of **Turn** and **Size** (or a long press on the button) opens the choices:

- In 3D, Turn has **Turn**, **Tilt forward** and **Tilt sideways**. <kbd>R</kbd> goes to the next one. It turns around the middle of the object, so it stays where it is.
- With several selected, **Together** turns or resizes them as one group (the gaps change too). **Each in place** keeps each one where it is.

**From the keyboard.** The arrow keys nudge (<kbd>Shift</kbd> for a smaller step). <kbd>Q</kbd> and <kbd>E</kbd> turn 15°. <kbd>Page Up</kbd> and <kbd>Page Down</kbd> raise and lower. <kbd>+</kbd> and <kbd>−</kbd> resize.

**Exact numbers.** The card at the top right shows **Position**, **Angle** and **Size**. Drag a number left or right to change it (hold <kbd>Shift</kbd> for finer steps), or click it and type. The card’s **–** folds it to one line.

## Snap into place

In 3D, things land on what’s under them:

- Dragging **Height** down stops on the first surface below. Keep pulling a little further to go through it.
- <kbd>End</kbd> drops the selected object to the floor (on a Mac laptop, <kbd>fn</kbd><kbd>→</kbd>). It’s in the right-click menu too.
- Hold <kbd>Ctrl</kbd> or <kbd>⌥</kbd> while you drag to move without snapping.

Want a grid, or only 90° turns? Ask your AI: “snap to a 1 m grid.” It sets that up for your game.

## Look around (3D)

| To | Do this |
|---|---|
| Look around | Drag where nothing is selected. With a tool chosen: <kbd>⌥</kbd>-drag, right-drag, or two fingers. |
| Zoom | Scroll, or pinch. |
| Fly | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> with nothing selected. With something selected, hold the right mouse button too. <kbd>Shift</kbd> goes faster. |
| Go up and down | <kbd>E</kbd> and <kbd>Q</kbd> (nothing selected), or the ↑ ↓ buttons in the game’s corner. |
| See everything | <kbd>F</kbd> |
| Back to where you started | <kbd>Shift</kbd><kbd>F</kbd> |

<kbd>W</kbd> and <kbd>S</kbd> stay level: looking down, you glide over the scene at the same height.

## Undo, duplicate, delete

| | Mac | Windows |
|---|---|---|
| Undo | <kbd>⌘</kbd><kbd>Z</kbd> | <kbd>Ctrl</kbd><kbd>Z</kbd> |
| Redo | <kbd>⇧</kbd><kbd>⌘</kbd><kbd>Z</kbd> | <kbd>Ctrl</kbd><kbd>Y</kbd> |
| Duplicate | <kbd>⌘</kbd><kbd>D</kbd> | <kbd>Ctrl</kbd><kbd>D</kbd> |
| Delete | <kbd>⌫</kbd> | <kbd>Delete</kbd> |
| Select all | <kbd>⌘</kbd><kbd>A</kbd> | <kbd>Ctrl</kbd><kbd>A</kbd> |

**Undo** and **Redo** are also in the top bar. **Duplicate** puts the copy next to the original; press it again for another at the same spacing.

## Right-click menu

Right-click anything (long-press on a phone) to see what you can do with it right there.

- **On an object:** Rename, Duplicate, Delete, Put on the ground, Show in Library. In 2D: Bring to front and Send to back. Then **✦ Ask Claude to change the lighthouse…** (your AI’s name).
- **On an empty spot:** Paste, Select all, Deselect, Show all. Then **✦ Ask Claude to change the game…**.

The menus have two kinds of rows, and you can tell them apart before you press:

- **Plain rows** happen right away in the editor. <kbd>⌘</kbd><kbd>Z</kbd> undoes them. They never type anything in the box at the bottom.
- **✦ rows** (violet, “Ask Claude to …”) only put a request in the box at the bottom, with the cursor there, for you to change or finish. Nothing is sent until you press <kbd>Enter</kbd>.

**Rename** (or <kbd>F2</kbd>) turns the name on the object’s card into a text field. <kbd>Enter</kbd> keeps the new name, <kbd>Esc</kbd> cancels. The new name shows everywhere at once, and when you save, your AI renames the object in the code too. An object without a name in the code has **✦ Ask Claude to name it…** instead.

![The right-click menu on the lighthouse](media/right-click.webp)

## Select several

- <kbd>Shift</kbd>-click to add or take away one.
- <kbd>Shift</kbd>-drag from an empty spot to draw a box.
- On a phone, use **Multi-select** in the list (in the Library, under **+**), then **Done**. A computer has no such button: <kbd>Shift</kbd> does it.
- The card’s **⋯** has **Select all like this**: every object of the same kind (and **Show in Library**).

Several selected move, turn and resize together.

## Every action, and every key

- <kbd>⌘</kbd><kbd>K</kbd> (<kbd>Ctrl</kbd><kbd>K</kbd>) opens the list of every action. Type a word to find one, like “library” or “play.” A sentence goes to your AI.
- <kbd>?</kbd> shows every keyboard shortcut.
- <kbd>P</kbd> plays the game. While you play, <kbd>P</kbd> pauses and resumes; the **Edit** button takes you back. More in [Play](play.md).

## The Library

Switch from **Scene** to **Library** on the left to see everything your game is made of: its objects, its motions, and every image, model and sound it uses. Each kind has its own heading with its count: **Objects · 15**, **Motions · 2**, **Assets · 7**. An object counts once per copy (pine ×3 is 3), and the number next to **Library**, **All** and the headings always add up the same way. The filters on the left narrow it: **All**, **3D**, **2D**, **Sound**, **Motion**, **Other** (only the ones your game has).

![The Library: the game’s objects, then its motions and assets, each under its heading](media/library.webp)

A game with no assets yet shows **Assets · 0** and one place to drop files on.

Click a tile to see its detail: which objects use a file, which files are unused or missing.

- **Put in the scene** on an object puts a duplicate where you’re looking. A file needs new code to become an object, so its button is **✦ Ask Claude to put it in the scene…**: the request goes in the box at the bottom, and nothing is sent until you press <kbd>Enter</kbd>.
- **Replace…** swaps a file for another. **Add assets** brings new ones in.
- **Show in the scene** goes back to the Scene with it selected.
- **✦ Ask Claude…** (your AI’s name) puts the cursor in the box at the bottom, with the tile named in it.
- A locked object (a ground, road or sky) says **Locked so it isn’t nudged** under its name.

![An object’s detail in the Library](media/library-object.webp)

## Ask your AI

The box at the bottom is for your AI. Type what you want and press <kbd>Enter</kbd>:

- About what’s selected: “add 3 more in a row,” “make it glow.”
- About the whole game: “add three lighthouses around the island.”

Before you type, the right end of the box says whether your AI is there (in the side window and on a phone, only its dot: press it for the words):

- **● Claude is watching**: what you send reaches it within seconds. **● Claude is working**: it’s on a request.
- **Not sure Claude is open** or **Claude isn’t watching**: you can still write. It’s kept as a note, and nothing in the game changes until Claude reads it. **How to open** says what to do.
- With Codex: **Codex reads it when you type “look”**.

The name is your own AI, or “your AI” when the editor can’t tell. Press the words for one line on what they mean.

![The box at the bottom: “Claude is watching” at its right end](media/ask-watching.webp)

When your AI is there, the line above the box says **Claude is on it**, then its own words, then its reply.
When it isn’t, the line says what happened: **Kept as a note for Claude. Nothing in the game changes until Claude reads it.**

![Sent while Claude wasn’t open: kept as a note, with “How to open” beside the box](media/ask-kept.webp)

 A violet light runs round the box while it works, and its one-line reply shows above. When it’s done, the game updates by itself, with your camera and selection kept, and only what changed glows violet. Don’t like it? **Undo AI change** puts it back in one press.

## Things laid out by a rule

When your AI lays things out by a rule (“four hexagons in a row, 6 m apart”, “scatter crystals on the field”), the list shows them under one name with the tag **Rule**, and a press on one shows the card’s **Rule** where its position was: **Line · 4** (or **Scatter · 12**), with the rule’s numbers as knobs, like **Count** and **Gap**. Things you placed yourself stay as they are: their numbers are their place.

- **Turn a knob** (drag it left or right, or press it and type), **or just drag one of them** in the game: the rule’s number changes, the others follow and they stay a rule. While you drag, a small label says it: **Gap 4 → 2.5 m**. Violet rings show where the rule puts each one (point at one in the game to see them before you press), and the line under the tool strip says what a drag will do.
- **They stay a rule, however you move them.** A way the rule has no number for doesn’t move: drag a street lamp away from the road when the rule only has **Gap**, or lift it, or turn it, and it stays where it is while a small label says why — **Sideways position is set by the rule · ⌥ for just this one**. When you let go, the line above the chat box says it again, with **✦ Ask Claude: “Let me move Street lamps sideways too”**: your AI gives the rule a number for that way. (A rule with a number for each way — along the road, away from it, up — changes it for all of them, whichever way you drag.)
- **Hold <kbd>⌥</kbd> while you drag** to move just that one: its ring turns from violet to sand, and the line says **Placed Street lamps 3 by hand (the rest stay on the rule) · Back to rule · ⌘Z**. The rest stays on the rule. Nothing else takes one out of its rule: arrow keys, or moving several together, leave a rule’s things where it puts them.
- **What you placed by hand shows before you press anything**: a small hand tag over each one in the game. Select (or point at) any of that rule’s things and each one placed by hand gets a sand ring, the tag **By hand**, and a violet hollow ring where the rule would put it, with a thin dotted line between — that is where **Back to rule** takes it. Its card says **By hand · Outside the Street lamps rule** with **Back to rule**; its numbers stay white like any number, and its rule’s knobs are under them.
- **Put them all back at once**: the rule’s part of the card says **✋ 2 placed by hand · All back to rule** (point at the count to light them in the game, press it to select them). One <kbd>⌘</kbd><kbd>Z</kbd> brings them back. In the list, the rule’s heading shows **✋ 2**, and each one **By hand**.
- **Convert to coordinates** turns the rule into coordinates: every one of them becomes an ordinary thing at its own position, which you move one by one.

![A lamp of the row dragged away from the road: it stays, and the line says “Street lamps: sideways position is set by the rule · ⌥-drag to move just this one · ✦ Ask Claude”](media/rule-held.webp)

![⌥ and a drag up: just that lamp, placed by hand — its card and the list say so, with “Back to rule”](media/rule-hand.webp)

Each change is one <kbd>⌘</kbd><kbd>Z</kbd> and counts on **Save**; after Save, your AI writes the new numbers into the game’s code (**Saved: hex Gap → 4 m**).

![A hexagon of a row dragged toward the camera: violet rings, “Gap 4 → 2.5 m”, and the card’s Rule with Count and Gap](media/rule-layout.webp)

### Turn things you placed into a rule

Put a row of street lamps down one by one, and now you would rather tune it as a row? Select them (several things you placed yourself) and press **✦ Turn into a rule** on their card. The chat box at the bottom gets the words **Turn into a close rule** — add “6 m apart” if you know it — and you send them. Your AI writes the nearest rule (a row, a grid, a circle, a scatter) and puts it in their place: the ones you placed are hidden, the rule’s stand there, lit violet, with their knobs on the card.

- **How close it came is measured by the editor**, not said by the AI: the card says **Max deviation: lamp-3 (0.6 m)**, and in the game an orange dot marks where each one stood, with a thin line to the rule’s one and **lamp-3 · 0.6 m** over the farthest. **Compare with original** turns those marks off and on.
- One <kbd>⌘</kbd><kbd>Z</kbd> brings back the ones you placed. When no rule comes close (things scattered by hand), your AI leaves them as they are and tells you in a line.
- The comparison stays until **Save**; after Save, your AI takes the ones you placed out of the game’s code (the rule is in their place).

![Six street lamps turned into a row: the rule’s lamps lit violet, orange dots where the hand-placed ones stood, “lamp-3 · 0.6 m”, and the card’s “Compare with original” with “Max deviation: lamp-3 (0.6 m)”](media/to-rule-place.webp)

### Keep-out areas

Under a layout's knobs, **Keep-out areas** lists where that layout puts nothing. The game shows each one on the ground in red hatching: a box you drew (**Drawn by hand**) has an orange edge, an area your game's rule decides (“On the road”, **Rule**) a violet dashed one.

- **+ Draw a box**, then drag on the ground (one finger on a phone; <kbd>Esc</kbd> stops). The things of that layout step out of the box while you draw, and the line says how many moved. Drag its corners to resize it (<kbd>Shift</kbd>: its height), its middle to move it.
- **✦ Describe with text** puts the layout and **Keep-out areas** in the box for your AI: say it in your words, “not within 5 m of the player”. Your AI turns it into a rule in the game and adds it to the list (the new row glows violet). A number in it, like **5 m**, is a knob: in the list, or the ◇ on its edge in the game.
- The switch turns one off (it stays in the list); **×** removes a box or an area your AI added. **⋯ Also for** adds the same area to another layout: an area only ever acts on the layout it is listed under.
- What you placed yourself is never moved by an area: its card says **Inside a keep-out area** under **By hand** when it stands in one. When an area leaves no room, the list says **1 of 12 has no place to go**, and a red × shows where it would have gone.

![Crystals scattered by a rule: a box drawn by hand (orange), “On the road” and “From the player 6 m within” (violet), and the card’s Keep-out areas](media/keep-out.webp)

## The side window and phones

In the pane next to the chat in the Claude app, and on a phone, everything at the bottom is **one sheet** under the game:

- The tabs at its top show one thing at a time: **Scene** (the list), **the object you picked** (its card), and **Motion** when that object has one.
- The box for your AI is always the sheet’s last row. Whether your AI is there is the dot inside it (green: watching). Press the dot for the words.
- Your AI’s reply shows over the top of the game and goes after a few seconds. Click the box to see it again.
- Click the bar at the sheet’s top (or ▾ at the box’s left) to fold the sheet to the box alone. ▴ opens it again.

![The side window with the gate picked: the Scene and gate tabs, the gate’s card, and the box with its dot](media/side-sheet.webp)

## Save

When you change something, **Save · 1** shows up in the top bar, beside **▶ Play**. The number is how many changes aren’t saved yet.

![Save · 1 in the top bar after one move](media/save.webp)

Click **Save** (or <kbd>⌘</kbd><kbd>S</kbd>). The line over the ask box says what you saved, by name, and then when it’s in the game:

![After Save: Saved: moved hex-1 · moved ring · moved orb · 2 more, and Claude is putting it in the code](media/save-receipt.webp)

- **Saved: moved gate · gate’s motion · …** with **Claude is putting it in the code…** under it. More than three things: the first three and **2 more**.
- **✓ Saved: moved gate · … · In the game** when your AI is done (the same names as when you pressed it), with **▶ Play** to try it and **Undo AI change**.
- If your AI isn’t open: **Saved. Claude puts it in the code when it opens**. Nothing is lost; the words under the ask box say how to open it.

### What Save does

Your game is code, and the editor never changes your code. Instead:

1. **Save writes down what you changed** in a small file in your game folder, `placement.json`. Think of it as a list: “the lighthouse is now here, turned this much, this big.” For each change, it also notes where the thing was before, so your AI can find it in the code.
2. **Your AI reads that list** and puts it into the game. The first time, it adds one line to your game that reads `placement.json` when the game starts. From then on, every Save shows up in the game. Prefer the numbers written straight into the code? Tell your AI.

Files you swapped or added in the Library go in a second list, `library.json`, the same way. More in [How it works](how-it-works.md).

### You won’t lose work

- Until you click Save, your changes are kept as a draft. Closing the tab loses nothing.
- A big change, like the ground moved or something 25 m away, asks first: **Check before you save**. You can **Put back and save** or **Save anyway**.

Next: [Play](play.md).
