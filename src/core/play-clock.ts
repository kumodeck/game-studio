// The game's clock while playing inside the editor, so a pause takes no time (pause, 2026-10-22).
//
// WHY: freezing the frames (time.ts) is not enough. Engines measure the time between frames from performance.now()
// (three.js Timer / Clock) or from the timestamp requestAnimationFrame hands them (Pixi's Ticker, Phaser, a hand-made
// `t / 600`). After a one-minute pause the first frame would see a 60 s step: the boat jumps across the cove, a timer
// runs out, a physics step explodes. Here the time spent paused is taken out of both, so the game's next frame sees
// one ordinary frame's step.
//
// Only in ▶ Play inside the editor (bridge.ts installs it before any game code, so the game's first look at
// performance.now already goes through it). Date.now() is left alone: it is wall time (saves, "last played"), and a
// game that steps with it is rare (CONTRACT.md §3.5.1 lists what a pause does not stop).

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
  return {
    stop: c.stop,
    go: c.go,
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
