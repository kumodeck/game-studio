---
title: Editing
nav: Editing
order: 2
written-for: 0.1.18
description: Select, move, turn and resize things in your game, look around, use the Library, and save.
---

# Editing

Click something in your game and drag it. That’s most of it. This page covers the rest: the tools under a selected object, the camera, the menus, the Library and Save.

The editor has three parts: the column on the left (**Scene** and **Library**), the game in the middle, and one box at the bottom for your AI. Two colors mean one thing each: **orange is your hand** (what you selected), **violet is your AI’s hand** (what its last change touched).

## Select

- **Click** (or tap) an object to select it. Click the same spot again to select the one behind it.
- **Click nothing** (the sky, the sea, the ground) to deselect. Big things like the ground are selected from the Scene list instead, so you don’t grab them by accident.
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

- **On an object:** Ask your AI…, Rename…, Duplicate, Delete, Drop to floor, Show in Library. In 2D: Bring to front and Send to back.
- **On an empty spot:** ask your AI to change the game, Paste, Select all, Deselect, Show all.

![The right-click menu on the lighthouse](media/right-click.webp)

## Select several

- <kbd>Shift</kbd>-click to add or take away one.
- <kbd>Shift</kbd>-drag from an empty spot to draw a box.
- On a phone, use **Multi-select** in the list, then **Done**.
- The right-click menu has **Select all like this**: every object of the same kind.

Several selected move, turn and resize together.

## Every action, and every key

- <kbd>⌘</kbd><kbd>K</kbd> (<kbd>Ctrl</kbd><kbd>K</kbd>) opens the list of every action. Type a word to find one, like “library” or “play.” A sentence goes to your AI.
- <kbd>?</kbd> shows every keyboard shortcut.

## The Library

Switch from **Scene** to **Library** on the left to see everything your game is made of: its objects, and every image, model and sound it uses. The filters on the left narrow it: **All**, **3D**, **2D**, **Sound**, **Motion**, **Other**.

![The Library: one grid of the game’s objects, then its files](media/library.webp)

Click a tile to see its detail: which objects use a file, which files are unused or missing.

- **Add to scene** on an object puts a duplicate where you’re looking. On a file, it asks your AI to add it to the game.
- **Replace…** swaps a file for another. **Add files** brings new ones in.
- **Show in game** goes back to the Scene with it selected.
- Select a tile and type in the box at the bottom to ask your AI about it.

![An object’s detail in the Library](media/library-object.webp)

## Ask your AI

The box at the bottom is for your AI. Type what you want and press <kbd>Enter</kbd>:

- About what’s selected: “add 3 more in a row,” “make it glow.”
- About the whole game: “add three lighthouses around the island.”

You see at once that your AI has it. A violet light runs round the box while it works, and its one-line reply shows above. When it’s done, the game updates by itself, with your camera and selection kept, and only what changed glows violet. Don’t like it? **Undo AI change** puts it back in one press.

## Save

When you change something, **Save · 1** shows up in the top bar, beside **▶ Play**. The number is how many changes aren’t saved yet.

![Save · 1 in the top bar after one move](media/save.webp)

Click **Save** (or <kbd>⌘</kbd><kbd>S</kbd>) and go back to your AI.

### What Save does

Your game is code, and the editor never changes your code. Instead:

1. **Save writes down what you changed** in a small file in your game folder, `placement.json`. Think of it as a list: “the lighthouse is now here, turned this much, this big.” For each change, it also notes where the thing was before, so your AI can find it in the code.
2. **Your AI reads that list** and puts it into the game. The first time, it adds one line to your game that reads `placement.json` when the game starts. From then on, every Save shows up in the game. Prefer the numbers written straight into the code? Tell your AI.

Files you swapped or added in the Library go in a second list, `library.json`, the same way. More in [How it works](how-it-works.md).

### You won’t lose work

- Until you click Save, your changes are kept as a draft. Closing the tab loses nothing.
- A big change, like the ground moved or something 25 m away, asks first: **Check before you save**. You can **Put back and save** or **Save anyway**.

Next: [Play](play.md).
