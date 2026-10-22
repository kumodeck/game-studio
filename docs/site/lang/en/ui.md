---
title: UI editing
nav: UI editing
order: 6
written-for: 0.1.18
description: Move and resize the title, score and buttons that sit over your game.
---

# UI editing

Many games have a layer of text and buttons over the world: a title, a score, a Start button. You can move and resize those too.

This is the first stage of UI editing. It works on UI made with HTML. Read [what it can’t do yet](#what-it-cant-do-yet).

## World and UI

If your game has UI the editor can edit, the top bar shows **World | UI**. Press **UI** (or <kbd>U</kbd>) to edit the UI. The world dims, and the list shows what’s **On screen**.

![The UI layer: the title card selected and moved, the world dimmed behind it](media/ui-layer.webp)

- Click a piece of UI to select it, and drag it to move it.
- The strip under it has **Move** and **Size**. <kbd>+</kbd> and <kbd>−</kbd> resize too, or type a number in **Size** on the card. Its middle stays where it is.
- Undo and Redo work across both layers.

Press **World** (or <kbd>U</kbd>) to go back. While you edit the world, the game’s UI is hidden so it isn’t in your way. The eye next to the switch (or <kbd>Shift</kbd><kbd>U</kbd>) shows it faded. Clicks still go through to the world.

On a phone, the switch is two icons at the top of the game.

## No World | UI switch?

The editor only shows UI your game has marked. Ask your AI: “let me edit the UI in Game Studio.” It marks each piece (the title, the score) in your game’s HTML.

## Save

Save writes where you moved each piece and how big it is. Your game reads it when it starts, like the rest of your layout, so the title is where you put it, with or without the editor.

## What it can’t do yet

- Only HTML UI. A HUD drawn inside the game (in Phaser, PixiJS or three.js) comes in a later stage.
- Move and resize only: no turning, duplicating or deleting.
- Pieces whose position the game changes itself (an animated score, say) aren’t listed.

Next: [Make with AI](make-with-ai.md).
