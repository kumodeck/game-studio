// Save, loud (a try of the editor, 2026-10-21, B and C), then ONE Save (a try of v0.1.9, same day: "why are there two
// buttons that do the same thing?" and "'Save to game' — I don't get what that means").
// History: the first answer to "people won't notice Save is needed" (save-clear) changed only the words on the black
// button in the game ("Save to game · 1"); a second look: "nobody will notice that". So C — KUMO's orange and one bounce
// — and B — a second orange "Save to game" beside ▶ Play plus a strip over the game while playing. The second button
// was a misreading of the brief: v0.1.9 showed the same Save twice (top right and bottom right of the game). Now:
//   - ONE Save, right beside ▶ Play in the top bar (main.ts topSave), in Edit and in Play, on every screen width:
//     orange, "Save · 3  ⌘S", one bounce when a change first appears. Its word is plain "Save" everywhere — "Save to
//     game" read as a different, second action. Where the change goes is said once, in its tooltip.
//   - The strip over the game while playing ("This change isn't in the game yet  [Save]  ×") went the same day: ▶ Play
//     with changes not saved asks first — Save and play / Try without saving (unsaved-guard.ts, main.ts togglePlay;
//     "let them choose with buttons") — so once playing, the person has chosen and nothing more is said over the game.
// What is shown where is decided here (no DOM), so test/save-loud.test.ts can read it without a browser; main.ts
// renderButtons draws it.

export interface SaveLoudIn {
  /** Changes not saved yet (main.ts dirtyCount). */
  n: number;
  playing: boolean;
}

export interface SaveLoudOut {
  /** The one Save beside ▶ Play in the top bar — in Edit and in Play, PC, side window and phone alike. */
  top: boolean;
}

export function saveLoud(s: SaveLoudIn): SaveLoudOut {
  return { top: s.n > 0 };
}

/**
 * The one bounce (C): only when a change appears after there was none — the moment Save goes from "nothing to save" to
 * "1". Not on the second, third… change (it would jump under every drag), not when coming back from Play (the change
 * is not new), never for a person who asked the system for less motion (shell.css also stops every animation then).
 */
export function bounces(prevN: number, n: number, playing: boolean, reducedMotion: boolean): boolean {
  return prevN === 0 && n > 0 && !playing && !reducedMotion;
}
