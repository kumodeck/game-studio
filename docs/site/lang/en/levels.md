---
title: Levels
nav: Levels
order: 5
written-for: 0.1.19
description: Switch between your game's levels, make new ones from a copy, rename, reorder and delete them.
---

# Levels

If your game has levels, the level you’re on is part of the path at the top of the editor: **Studio / Three Isles / Meadow ⌄ / Scene**. Switch between levels, copy one to start a new level, rename them and put them in order.

## Switch levels

Press the level’s name in the path at the top (**Meadow ⌄**) to open the levels menu, and pick another. The game opens on that level. Hover over the name to see where it is in the list, like “Level 1 of 3.”

![The path at the top, Studio / Three Isles / Meadow, with the levels menu open under Meadow: three levels, and New level, Rename, Move up, Move down, Delete level](media/levels.webp)

With a keyboard, <kbd>]</kbd> goes to the next level and <kbd>[</kbd> to the one before. The menu shows these keys next to those levels, and **All actions** (<kbd>⌘K</kbd>) lists **Levels…**, **Previous level** and **Next level**.

Each level keeps its own layout, its own motions and its own undo. A move you made on one level still counts on **Save · N** while you’re on another.

## Make, rename, reorder

The menu has:

- **New level from Meadow**: a copy of the level you’re on, named “Meadow 2.” It opens right away.
- **Rename…**: type the new name in place. <kbd>Enter</kbd> keeps it, <kbd>Esc</kbd> cancels.
- **Move up** and **Move down**: change the order.
- **Delete level**: you go to the level next to it. If the level is in your game’s code, your AI asks you once before it takes it out.
- **✦ Ask AI for a different kind of level…**: puts a request in the box at the bottom for you to finish (“How it should differ from this one: …”). Nothing is sent until you press <kbd>Enter</kbd>.

Each of these counts as one change on **Save · N**. When you save, your AI adds the new levels, names and order to the game.

## Play a level

**▶ Play** plays the level on screen, so you can test the one you’re working on. While you play, the path shows the level’s name without the ⌄: switch levels after you go back to editing.

## Add levels to a game without them

A game without levels shows **Levels ⌄** in the path at the top (**Studio / Neon Orb / Levels ⌄ / Scene**). Press it to open its menu. Nothing happens until you choose:

- **Make Level 2 — a copy of this one**: what’s on screen becomes Level 1, and Level 2 opens right away as a copy of it. A line at the top says what happened: “Level 2 made — a copy of Level 1. Change things here to make it different. Save, and your AI adds Level 2 to your game’s code.” Changed your mind? Press **Undo** on that line, or <kbd>⌘</kbd><kbd>Z</kbd>.
- **✦ Ask AI for a different kind of level…**: puts a request in the box at the bottom for you to finish. Nothing is sent until you press <kbd>Enter</kbd>.

When you save, your AI adds the few lines that let your game switch levels. Until then your game outside the editor plays Level 1, as before.

On a phone there’s no room for **Levels ⌄** at the top: open **…** (All actions) and choose **Levels…**.

![A game without levels: Levels ⌄ in the path at the top, with its menu open](media/levels-add.webp)

## No levels showing?

The editor needs your game to tell it which levels it has. Press **Levels ⌄** and make Level 2, or ask your AI: “show my levels in Game Studio.” It adds a few lines where your game picks its level.

Next: [UI editing](ui.md).
