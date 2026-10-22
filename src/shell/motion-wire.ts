// The shell's side of motions (motion-gui, 2026-10-22): between the card's Motion row (motion-row.ts), the model
// (motion-model.ts, inside the world's PlacementModel), undo, and the game page (bridge/motion.ts).
//
// WHY its own file: main.ts is 3,800 lines and four members change it the same week; this keeps main.ts to a few
// calls (the card's deps, the bridge's two messages, one undo branch, the pick). Everything about motions that needs
// the shell's state is here.
//
// What goes to the game page:
//   motion/show  — the picked object's path (dots to drag), sent only when the pick or its motion changed (`sync`);
//   motion/play  — the card's ▶ (one object, in the frozen scene) and its stop.
// What comes back:
//   motion/changed — a dragged point (live, then `end` = one undo step from the motion before the drag) or the first
//                    points of a new path (`seed`: they replace the stand-in points of the step just recorded);
//   motion/played  — the ▶ stopped by itself.
import type { BridgeToShell, Dim, Motion, ShellToBridge } from '../contract.ts';
import type { MotionStore } from './motion-model.ts';
import { fallbackPath, kindOf, sameMotion } from './motion-model.ts';
import type { MotionRowDeps } from './motion-row.ts';
import type { Change, UndoStack } from './undo.ts';

export interface MotionWireDeps {
  /** The world's motions (worldModel.motion: the UI layer has none). */
  store: MotionStore;
  undo: UndoStack;
  send(m: ShellToBridge): void;
  dim(): Dim;
  /** The picked object, when exactly one is picked on the world layer while editing (else null: no path drawn). */
  picked(): string | null;
  /** Something changed: draw the card again and the Save count. */
  changed(): void;
}

export interface MotionWire {
  /** The card's deps (placement-panel `motion`). */
  row: Omit<MotionRowDeps, 't' | 'dim'>;
  /** Send the picked object's path to the game when it differs from what the game shows (the pick, undo, a reload). */
  sync(force?: boolean): void;
  /** A bridge message; true when it was a motion one. */
  onMessage(m: BridgeToShell): boolean;
  /** Undo / redo of a `motion` change. */
  apply(c: Extract<Change, { kind: 'motion' }>, dir: 'undo' | 'redo'): void;
  /** The game page is gone (reload, Play): nothing plays, nothing is shown. */
  reset(): void;
}

export function createMotionWire(d: MotionWireDeps): MotionWire {
  let playing: string | null = null;
  // What the game page shows now ("key\nmotion json"), so sync() sends only changes.
  let shown = '';
  // A point drag in progress: the motion before it (the undo step goes from here).
  let dragFrom: { key: string; m: Motion | null } | null = null;

  const sync = (force = false, seed = false) => {
    const key = d.picked();
    const m = key ? d.store.get(key) : null;
    const sig = `${key}\n${JSON.stringify(m)}`;
    if (!force && !seed && sig === shown) return;
    shown = sig;
    d.send({ type: 'studio:motion/show', key: m ? key : null, motion: m, ...(seed ? { seed: true } : {}) });
    if (playing && playing !== key) stop();
  };
  const stop = () => {
    if (!playing) return;
    playing = null;
    d.send({ type: 'studio:motion/play', key: null });
  };
  const play = (key: string | null) => {
    if (!key) return void (stop(), d.changed());
    const m = d.store.get(key);
    if (!m || kindOf(m) === 'none' || (m.path && !m.path.length)) return;
    playing = key;
    d.send({ type: 'studio:motion/play', key, motion: m });
    d.changed();
  };
  /** One change from the card (or a drag's end): the store, one undo step, the game. */
  const set = (key: string, m: Motion | null, opts: { live?: boolean; from?: Motion | null; seed?: boolean } = {}) => {
    const before = d.store.get(key);
    // No game to pick points in sight yet (the seed comes later or never): stand-in points so the motion is real now.
    const next = m && m.path && !m.path.length ? { ...m, path: fallbackPath(kindOf(m), d.dim()) } : m;
    d.store.set(key, next);
    if (!opts.live) d.undo.push({ changes: [{ kind: 'motion', key, from: opts.from !== undefined ? opts.from : before, to: next }] });
    sync(false, !!opts.seed);
    // A new kind or speed while ▶ is on: play the new one from the start (the preview always shows what is set).
    if (playing === key) {
      if (next && kindOf(next) !== 'none') d.send({ type: 'studio:motion/play', key, motion: next });
      else stop();
    }
    if (!opts.live) d.changed();
  };

  return {
    row: {
      motion: (k) => d.store.get(k),
      setMotion: set,
      playing: () => playing,
      play,
    },
    sync: (force) => sync(force),
    onMessage(m) {
      if (m.type === 'studio:motion/played') {
        if (playing && (m.key === null || m.key === playing)) {
          playing = null;
          d.changed();
        }
        return true;
      }
      if (m.type !== 'studio:motion/changed') return false;
      const cur = d.store.get(m.key);
      if (m.seed) {
        // The first points picked in sight replace the stand-in ones of the step just recorded (one step, not two).
        if (!cur?.path) return true;
        const top = d.undo.peekUndo();
        const c = top?.changes.length === 1 ? top.changes[0] : undefined;
        if (c?.kind === 'motion' && c.key === m.key) c.to = structuredClone(m.motion);
        d.store.set(m.key, m.motion);
        shown = `${m.key}\n${JSON.stringify(d.store.get(m.key))}`;
        d.changed();
        return true;
      }
      if (!dragFrom || dragFrom.key !== m.key) dragFrom = { key: m.key, m: cur };
      d.store.set(m.key, m.motion);
      // The game drew the dot where the finger is: what it shows is this motion already.
      shown = `${m.key}\n${JSON.stringify(d.store.get(m.key))}`;
      if (playing === m.key) d.send({ type: 'studio:motion/play', key: m.key, motion: m.motion });
      if (m.end) {
        const from = dragFrom.m;
        dragFrom = null;
        if (!sameMotion(from, m.motion)) d.undo.push({ changes: [{ kind: 'motion', key: m.key, from, to: m.motion }] });
        else d.store.set(m.key, from);
        d.changed();
      }
      return true;
    },
    apply(c, dir) {
      d.store.set(c.key, dir === 'undo' ? c.from : c.to);
      if (playing === c.key) stop();
      sync();
      d.changed();
    },
    reset() {
      playing = null;
      shown = '';
      dragFrom = null;
    },
  };
}
