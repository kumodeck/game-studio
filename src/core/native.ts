// The browser's own requestAnimationFrame, captured before anything else in
// the edit script wraps it.
//
// WHY: engine helpers that load early (the three.js boot script) wrap rAF to
// hold the game's frames. The studio's own loop (handles, selection outline,
// repaint after a resize) must keep running while the game is held, so it
// uses these, never window.requestAnimationFrame. src/bridge/main.ts imports
// this module first so the capture happens before any other wrapper.
export const nativeRaf: (cb: FrameRequestCallback) => number =
  typeof window !== 'undefined' ? window.requestAnimationFrame.bind(window) : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
/**
 * The browser's own clock, captured before ▶ Play's game clock (play-clock.ts) takes the paused time out of
 * performance.now(). The editor's own timing (the outline's redraw gap, glides, holds) uses it: woken in a paused game
 * (bridge/play-move.ts, 2026-10-22) it read the game's stopped clock, so the outline never redrew after a drag
 * ("40 ms since the last one" never came).
 */
export const nativeNow: () => number =
  typeof performance !== 'undefined' ? performance.now.bind(performance) : () => Date.now();
export const nativeCancelRaf: (id: number) => void =
  typeof window !== 'undefined' ? window.cancelAnimationFrame.bind(window) : (id) => clearTimeout(id);
/**
 * The browser's own timers and wall clock, captured before ▶ Play's game clock (play-clock.ts → play-timers.ts) makes
 * the window's setTimeout / setInterval / Date.now stop with the game (polish-1022, 2026-10-22: a game that steps from
 * a timer or Date.now kept running through a pause and through Edit). Every timer of the studio itself in the game page
 * (the line's fade, the long press, the self-check's waits, the three.js boot script's safety nets) uses these: on the
 * window's ones it would wait for the game to go on, and a paused game never goes on by itself.
 */
export const nativeSetTimeout: (fn: (...a: never[]) => void, ms?: number) => number =
  typeof window !== 'undefined' ? (window.setTimeout.bind(window) as (fn: (...a: never[]) => void, ms?: number) => number) : (fn, ms) => setTimeout(fn, ms) as unknown as number;
export const nativeClearTimeout: (id: number | undefined) => void =
  typeof window !== 'undefined' ? window.clearTimeout.bind(window) : (id) => clearTimeout(id as unknown as Parameters<typeof clearTimeout>[0]);
export const nativeDateNow: () => number = Date.now.bind(Date);
