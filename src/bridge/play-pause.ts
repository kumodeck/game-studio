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
import type { TimeControl } from '../contract.ts';
import type { PlayClock } from '../core/play-clock.ts';

export interface PauseParts {
  time: Pick<TimeControl, 'freeze' | 'thaw' | 'frozen'>;
  clock: Pick<PlayClock, 'stop' | 'go' | 'stopped'>;
}

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
}

export function createPauseHold(win: Window & typeof globalThis, parts: PauseParts): PauseHold {
  const doc = win.document;
  const contexts = watchAudio(win);
  let paused = false;
  // What the pause itself stopped, so Resume brings back only that.
  let quieted: AudioLike[] = [];
  let stilled: HTMLMediaElement[] = [];
  let wasFrozen = false;

  return {
    get paused() {
      return paused;
    },
    pause() {
      if (paused) return false;
      paused = true;
      // Frozen already (the editor's own hold, a game still loading): leave it frozen on Resume too.
      wasFrozen = parts.time.frozen;
      parts.time.freeze();
      parts.clock.stop();
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
      // A first-person game holds the mouse: let go, so the person can use the chat.
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
      for (const c of quieted) c.resume().catch(() => {});
      for (const m of stilled) m.play().catch(() => {});
      quieted = [];
      stilled = [];
      return true;
    },
  };
}
