// Pause while playing (2026-10-22: "pause where something bothers you and chat with the AI"): what stops the
// game, and what puts it back exactly where it was. The chat over the paused game is play-chat.ts; the key, the
// corner button and the messages are wired in play-ask.ts. CONTRACT.md §3.5.1.
//
// What a pause holds:
// - the frames: core time's freeze() (the same hold the editor uses in Edit), so every engine that draws through
//   requestAnimationFrame stops — three.js setAnimationLoop, Pixi's Ticker, Phaser, hand-made loops;
// - the clock: core/play-clock.ts takes the paused time out of performance.now() and the frame timestamps, so the first
//   frame after Resume steps one frame, not the whole pause; with it the game's setTimeout / setInterval wait and
//   Date.now() stops (core/play-timers.ts, polish-1022), so a game stepped by a timer stops too;
// - the sound: the game's AudioContexts are suspended and its playing <audio> / <video> paused; Resume brings back
//   only what was playing (a context the game had suspended itself stays suspended);
// - the input: no key press and no pointer reaches the game (the veil over it takes the pointer; play-ask.ts's first
//   listener on the window drops the keys). Key RELEASES still reach it: a key held when P was pressed and let go
//   during the pause would otherwise stay "down" in the game, and the hero would run on by itself after Resume.
//
// Not held (CONTRACT.md §3.5.1): new Date(), promises and microtasks, requestIdleCallback, a Worker's own timers.
// Until polish-1022 (2026-10-22) a game stepped only by setTimeout / setInterval or Date.now() was not held either.
//
// Speed and "Next frame" (pause-edit, 2026-10-28; decision 10): the hold also slows the game (the clock at r × and the
// frames on 1 of every 1 / r: time.ts setRate, play-clock.ts setRate — a game that moves by time and one that moves by
// frame both run at r) and, while paused, steps it one frame (the clock 1/60 s on, the game's frame once: time.ts
// step). The sound is quiet while slow too: an AudioContext's speed cannot be changed from outside, and sound at full
// speed over a quarter-speed picture is out of step with it. Back at 1×, it plays again.
import type { TimeControlImpl } from '../core/time.ts';
import type { PlayClock } from '../core/play-clock.ts';

export interface PauseParts {
  time: Pick<TimeControlImpl, 'freeze' | 'thaw' | 'frozen' | 'step' | 'setRate' | 'rate'>;
  clock: Pick<PlayClock, 'stop' | 'go' | 'stopped' | 'setRate' | 'rate' | 'advance' | 'at' | 'realNow'>;
}

/** One step of "Next frame": a 60-frames-a-second frame of the game's time (decision 10). */
export const STEP_MS = 1000 / 60;
/** The speeds of the top bar's menu (02-find.md): 1× · ½× · ¼×. */
export const SPEEDS = [1, 0.5, 0.25] as const;

/** Is this key press "pause / resume"? P with no modifier, never while the game's own text field (or ours) has focus. */
export function isPauseKey(e: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean }, typing: boolean): boolean {
  if (typing || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
  // By the character (p / P with Shift), or the physical key when a layout or an IME gives another character for it
  // (a Japanese keyboard in kana input gives a kana for the P key).
  return e.key === 'p' || e.key === 'P' || e.code === 'KeyP';
}

interface AudioLike {
  state: string;
  suspend(): Promise<void>;
  resume(): Promise<void>;
}

/**
 * Keep every AudioContext the game makes (the constructor is wrapped before any game code), so a pause can quiet it.
 * Weak: a context the game drops is not kept alive by this list.
 */
function watchAudio(win: Window & typeof globalThis): () => AudioLike[] {
  const made: Array<WeakRef<AudioLike>> = [];
  const g = win as unknown as Record<string, unknown>;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Orig = g[name] as (new (...a: unknown[]) => AudioLike) | undefined;
    if (typeof Orig !== 'function' || (Orig as { __studioPause?: boolean }).__studioPause) continue;
    // A subclass, not a function: `new AudioContext()` and `instanceof AudioContext` both keep working, and an engine
    // that subclasses it (rare) still gets a real context.
    const Kept = class extends (Orig as new (...a: unknown[]) => object) {
      constructor(...a: unknown[]) {
        super(...a);
        if (typeof WeakRef === 'function') made.push(new WeakRef(this as unknown as AudioLike));
      }
    };
    Object.defineProperty(Kept, 'name', { value: Orig.name });
    (Kept as unknown as { __studioPause: boolean }).__studioPause = true;
    try {
      g[name] = Kept;
    } catch {
      /* read-only global: sound keeps playing in a pause, nothing else changes */
    }
  }
  return () => made.map((r) => r.deref()).filter((c): c is AudioLike => !!c);
}

export interface PauseHold {
  readonly paused: boolean;
  /** true = it paused now (false: already paused). */
  pause(): boolean;
  /** true = it resumed now. */
  resume(): boolean;
  /** The speed (1, ½, ¼). */
  readonly rate: number;
  /** A new speed: the game's time and frames at `r` (paused: from Resume), the sound quiet below 1×. */
  speed(r: number): void;
  /** "Next frame" while paused: the game's time one frame on, its frame drawn once. false = not paused / nothing to draw. */
  step(): boolean;
  /** The game's own time now (ms on its performance.now timeline): the top bar's 0:42.3 is measured with it. */
  now(): number;
}

export function createPauseHold(win: Window & typeof globalThis, parts: PauseParts): PauseHold {
  const doc = win.document;
  const contexts = watchAudio(win);
  let paused = false;
  // The sound is quiet while paused or slower than 1× (`quiet`); what the hold itself stopped, so it brings back only that.
  let quiet = false;
  let quieted: AudioLike[] = [];
  let stilled: HTMLMediaElement[] = [];
  let wasFrozen = false;

  // Slowed (not paused): a sound the game starts on an <audio> / <video> meanwhile waits too (an AudioContext's own
  // sounds are quiet with the context). Media events do not bubble; the capture phase still sees them on the document.
  doc.addEventListener('play', (e) => {
    if (!quiet) return;
    const m = e.target as HTMLMediaElement | null;
    if (!m || typeof m.pause !== 'function') return;
    try {
      m.pause();
      if (!stilled.includes(m)) stilled.push(m);
    } catch {
      /* fine */
    }
  }, true);

  const hush = () => {
    if (quiet) return;
    quiet = true;
    quieted = contexts().filter((c) => c.state === 'running');
    for (const c of quieted) c.suspend().catch(() => {});
    stilled = [...doc.querySelectorAll('audio, video')].filter((m): m is HTMLMediaElement => {
      const e = m as HTMLMediaElement;
      return !e.paused && !e.ended;
    });
    for (const m of stilled) {
      try {
        m.pause();
      } catch {
        /* fine */
      }
    }
  };
  const sound = () => {
    if (!quiet) return;
    quiet = false;
    for (const c of quieted) c.resume().catch(() => {});
    for (const m of stilled) m.play().catch(() => {});
    quieted = [];
    stilled = [];
  };

  return {
    get paused() {
      return paused;
    },
    get rate() {
      return parts.time.rate;
    },
    pause() {
      if (paused) return false;
      paused = true;
      // Frozen already (the editor's own hold, a game still loading): leave it frozen on Resume too.
      wasFrozen = parts.time.frozen;
      parts.time.freeze();
      parts.clock.stop();
      hush();
      // A first-person game holds the mouse: let go, so the person can use the editor's tools.
      try {
        if (doc.pointerLockElement) doc.exitPointerLock();
      } catch {
        /* nothing locked */
      }
      return true;
    },
    resume() {
      if (!paused) return false;
      paused = false;
      parts.clock.go();
      if (!wasFrozen) parts.time.thaw();
      if (parts.time.rate >= 1) sound();
      return true;
    },
    speed(r) {
      const next = (SPEEDS as readonly number[]).includes(r) ? r : 1;
      parts.time.setRate(next);
      parts.clock.setRate(next);
      if (paused) return;
      if (next < 1) hush();
      else sound();
    },
    step() {
      if (!paused) return false;
      parts.clock.advance(STEP_MS);
      return parts.time.step();
    },
    now() {
      return parts.clock.at(parts.clock.realNow());
    },
  };
}
