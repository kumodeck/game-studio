// Save, loud (a try of the editor, 2026-10-21, B and C). The first answer to "people won't notice Save is needed" (save-clear,
// same day) changed only the words on the black button ("Save to game · 1"); a second look at it: "nobody will
// notice that". So:
//   C  the Save in the game is filled with KUMO's orange (shell.css .save-fab — the one exception to "orange = your
//      pick"), and it gives one small bounce when a change first appears;
//   B  while something is not saved, the top bar has "Save to game" right beside ▶ Play (short "Save" on a phone and
//      in the side window), and Play shows a strip over the game — "This change isn't in the game yet  [Save to game]  ×".
//      × hides the strip for this round of Play only; the Save beside Play stays. Saving takes all of them away.
// What is shown where is decided here (no DOM), so test/save-loud.test.ts can read it without a browser; main.ts
// renderButtons draws it.

export interface SaveLoudIn {
  /** Changes not saved yet (main.ts dirtyCount). */
  n: number;
  playing: boolean;
  /** The person pressed × on the strip during this round of Play. */
  stripHidden: boolean;
  /** Phone or the chat app's side window: the top bar has no room for "Save to game". */
  narrow: boolean;
}

export interface SaveLoudOut {
  /** The Save in the game, bottom right (Edit only: while playing the game is the whole screen and the strip speaks). */
  fab: boolean;
  /** "Save to game" / "Save" beside ▶ Play in the top bar — in Edit and in Play. */
  top: 'long' | 'short' | null;
  /** The strip over the game while playing. */
  strip: boolean;
}

export function saveLoud(s: SaveLoudIn): SaveLoudOut {
  const any = s.n > 0;
  return {
    fab: any && !s.playing,
    top: any ? (s.narrow ? 'short' : 'long') : null,
    strip: any && s.playing && !s.stripHidden,
  };
}

/**
 * The one bounce (C): only when a change appears after there was none — the moment Save goes from "nothing to save" to
 * "1". Not on the second, third… change (it would jump under every drag), not when coming back from Play (the change
 * is not new), never for a person who asked the system for less motion (shell.css also stops every animation then).
 */
export function bounces(prevN: number, n: number, playing: boolean, reducedMotion: boolean): boolean {
  return prevN === 0 && n > 0 && !playing && !reducedMotion;
}
