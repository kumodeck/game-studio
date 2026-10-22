---
title: Motion
nav: Motion
order: 4
written-for: 0.1.18
description: Make things move with the timeline, choose when a motion starts and stops, and reuse motions from the Library.
---

# Motion

Make a boat sail, a door open, a coin spin. You set where a thing is at a few moments in time, and the editor fills in the movement between them. Motion works in 3D games.

## The timeline

Select something, then press **◆ Timeline** on its card (or find **Timeline** in <kbd>⌘</kbd><kbd>K</kbd>). The timeline opens at the bottom of the game (above the card on a phone).

![The timeline under the game, with the boat’s keys and its path](media/timeline.webp)

- The **ruler** is time. Drag on it to see that moment. <kbd>←</kbd> <kbd>→</kbd> move 0.1 s (<kbd>Shift</kbd> for 1 s).
- Set the motion’s **length** in seconds.
- **Play** and **Pause** preview it (or <kbd>Space</kbd>).
- Each object has a row. Open it to see **Position**, **Angle** and **Size** on their own rows.

## Keys

A **key** says “at this time, be here.”

1. Move the time line to a moment, like 2 s.
2. Move, turn or resize the object.

With **Auto key** on (it is, to start), that sets a key at the time line. The first one also sets a key at 0 s, where the object started. Press <kbd>K</kbd> to set a key without moving anything.

To change keys, click them (<kbd>Shift</kbd> or <kbd>⌘</kbd> adds more, or drag a box):

- Drag them along the ruler to change their time.
- <kbd>Delete</kbd> removes them. <kbd>⌘</kbd><kbd>C</kbd> and <kbd>⌘</kbd><kbd>V</kbd> copy them to the time line.
- Every change is one undo step.

**Auto key off**, or the timeline folded: moving the object moves its whole motion with it.

## The path

In 3D, the object’s way through its position keys is drawn in the scene, with a dot for each key and a dashed line down to the ground. Drag a dot to move that key across the ground. <kbd>Shift</kbd>-drag moves it up and down.

## How keys flow into each other

Select keys and choose how they go on to the next one:

- **Ease in-out**: starts slow, ends slow. The default.
- **Steady**: the same speed all the way.
- **Jump**: stays put, then jumps to the next key.

**Repeat** sets what happens at the end: **Once**, **Loop**, or **Back and forth**.

To start quickly, a new motion can begin from a template: **Back and forth**, **Round**, **Once** or **Spin**. Its keys are plain keys you can change.

## When it starts

**Starts** chooses when a motion begins.

![The timeline with Starts, Stops and Try: the rowboat starts when the player enters its area](media/motion-when.webp)

These play by themselves:

- **The game starts**
- **After some seconds**
- **A key is pressed**
- **This is clicked / tapped**
- **Another motion ends**
- **The player enters an area**: a box shows in the scene. Drag its white point to place it (<kbd>Shift</kbd>-drag for up and down).

These your AI connects in the game’s code:

- **The player touches this**
- **A cue**: a name your game sends, like “door-open”
- **In my words…**: describe it, and your AI makes it happen

**Stops** chooses when it ends: **Never**, **After some rounds**, or **A cue**. Then it **Stays there** or **Goes back**.

## Try it

**Try** shows one ▶ for each way a motion can start in this scene, like “Game starts” or “Click boat.” Press one to run the scene as if that just happened. **Stop** ends it.

## The motion Library

Every motion is in the Library, under **Motion**. Each tile draws the path and plays it when you point at it.

![Motions in the Library](media/motion-library.webp)

- **Attach to…** puts the same motion on another object. Change its keys once and every object that uses it changes.
- **Duplicate** makes a copy to change on its own.
- **Ask your AI…** puts the motion in the box at the bottom, so you can ask for something like “make it bob more.”

## Ask your AI for a motion

You don’t have to set keys yourself. Two ways to use your AI:

- **Use a motion you made.** Select it in the Library, press **Ask your AI…**, and say when it should play: “make the crate hop when the player walks up.” Your AI connects that moment in the game’s code.
- **Describe it.** Select something and ask in the box at the bottom: “make the boat rock gently.” Your AI writes the movement into the game’s code. It plays in **▶ Play** and in the game, but it isn’t on the timeline.

## In the game

Motions are saved in `placement.json` with the rest of your layout. When the game starts, the line that reads your layout plays them too. In **▶ Play**, you see them as they’ll be in the game.

Next: [Levels](levels.md).
