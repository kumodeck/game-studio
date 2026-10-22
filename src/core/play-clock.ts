// The game's clock while playing inside the editor, so a pause takes no time (pause, 2026-10-22).
//
// WHY: freezing the frames (time.ts) is not enough. Engines measure the time between frames from performance.now()
// (three.js Timer / Clock) or from the timestamp requestAnimationFrame hands them (Pixi's Ticker, Phaser, a hand-made
// `t / 600`). After a one-minute pause the first frame would see a 60 s step: the boat jumps across the cove, a timer
// runs out, a physics step explodes. Here the time spent paused is taken out of both, so the game's next frame sees
// one ordinary frame's step.
//
// Only in ▶ Play inside the editor (bridge.ts installs it before any game code, so the game's first look at
// performance.now already goes through it).
//
// The game's timers and Date.now() stop with it too (polish-1022, 2026-10-22; play-timers.ts). Until then Date.now was
// left alone as wall time ("saves, last played") and setTimeout / setInterval were not held: a countdown or an enemy
// spawner on a timer ran on through a pause and through Edit. Date.now now leaves out the stopped time as well (a save's
// time is off by the minutes paused, which no game we know minds; `new Date()` stays the wall clock). CONTRACT.md §3.5.1
// lists what a pause still does not stop.

import { nativeClearTimeout, nativeDateNow, nativeSetTimeout } from './native.ts';
import { installTimerHold, type TimerHold } from './play-timers.ts';

export interface PlayClock {
  /** Stop the clock: performance.now() stays where it is until go(). */
  stop(): void;
  go(): void;
  readonly stopped: boolean;
  /** A real timestamp (rAF, performance.now's timeline) as the game sees it: the paused time taken out. */
  at(t: number): number;
  /** The browser's own performance.now(), for the studio's own timers (a line's fade must not wait for the game). */
  realNow(): number;
  /** ms taken out so far (tests). */
  readonly skipped: number;
  /** The game's timers (null: the page would not let them be replaced, they run as before). */
  readonly timers: TimerHold | null;
}

/** The pure part (test/pause.test.ts): real time in, game time out. */
export function makeClock(real: () => number) {
  let skipped = 0;
  let stoppedAt: number | null = null;
  return {
    stop() {
      if (stoppedAt === null) stoppedAt = real();
    },
    go() {
      if (stoppedAt === null) return;
      skipped += Math.max(0, real() - stoppedAt);
      stoppedAt = null;
    },
    get stopped() {
      return stoppedAt !== null;
    },
    get skipped() {
      return skipped;
    },
    /** While stopped every time reads as the moment it stopped; never earlier than that. */
    at(t: number) {
      if (stoppedAt !== null) return Math.min(t, stoppedAt) - skipped;
      return t - skipped;
    },
  };
}

export function installPlayClock(win: Window & typeof globalThis): PlayClock {
  const perf = win.performance;
  const realNow = perf.now.bind(perf);
  const c = makeClock(realNow);
  try {
    // An own property on the instance: Performance.prototype.now stays the browser's (other frames, workers).
    Object.defineProperty(perf, 'now', { value: function now() { return c.at(realNow()); }, configurable: true, writable: true });
  } catch {
    /* a locked-down page: the rAF timestamps are still shifted (time.ts) */
  }
  // The browser's own timers: captured by core/native.ts before anything wrapped them (the edit script's first import);
  // another window (tests) uses its own.
  const own = typeof window !== 'undefined' && win === window;
  const timers = installTimerHold(win, {
    setTimeout: own ? nativeSetTimeout : win.setTimeout.bind(win),
    clearTimeout: own ? nativeClearTimeout : win.clearTimeout.bind(win),
    now: realNow,
    dateNow: own ? nativeDateNow : win.Date.now.bind(win.Date),
  }, () => c.at(realNow()));
  return {
    // The timers stop and go with the clock: in a pause (play-pause.ts) and, in the edit page, with every hold of the
    // game (time.ts `clock`), so Edit holds a timer-driven game as it holds a frame-driven one.
    stop() {
      c.stop();
      timers?.stop();
    },
    go() {
      c.go();
      timers?.go();
    },
    timers,
    get stopped() {
      return c.stopped;
    },
    get skipped() {
      return c.skipped;
    },
    at: c.at,
    realNow,
  };
}
