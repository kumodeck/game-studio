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
export const nativeCancelRaf: (id: number) => void =
  typeof window !== 'undefined' ? window.cancelAnimationFrame.bind(window) : (id) => clearTimeout(id);
