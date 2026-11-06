// After the AI fixed something asked from a paused moment: try it from the SAME moment (pause-ask stage 3, 2026-11-02;
// README pictures pc-3-fixed-try.png and pc-4-before-after.png; CONTRACT.md §3.5.1 `back`).
//
// WHY: the request was "pause the scene, ask the AI, and the AI fixes it from both the code and the picture". Asking
// was stages 1–2. Seeing the fix still meant Reload = leave the moment and play the whole way back to it (40 s for a boss
// later in the level), and the second run is never the same run. So the reply of a paused ask is:
//   - one line (what the AI did; small under it, the files it touched — `--files`) and three buttons:
//   - ▶ Try from 0:05.02: the game again with the NEW code, opened at the ask's moment (`back`: load(moment) before its
//     first frame) and held there, paused — the field, the talk and the marks stay. A game without codeMoment save /
//     load: a new run held at the same second, and the flash says so ("New code, played from the start to …"; walk 2 △7);
//   - Before / After: the frame the person asked from (with its marks) beside the same moment with the new code (the
//     frame Try paused on; Try runs first when it has not yet);
//   - ↶ Undo: the game's files back to before the AI's change, right here (no reload: the moment stays as it is; Try
//     shows the old code then).
// The editor never reloads by itself after the AI's change (the person may be in the middle of Save · N): Try is
// theirs to press.
// This file holds the pure rules (test/moment-try.test.ts) and the Before / After panel; main.ts wires them.
import { h } from './dom.ts';
import { icon } from './icons.ts';

export type ReplyAction = 'try' | 'compare' | 'undo' | 'reload';

export interface ReplyState {
  /** The game is paused and the reply is to an ask of this pause (or of a Try of it). */
  paused: boolean;
  /** The host kept the ask's moment (`back`): Try / Before / After can open it. */
  back: boolean;
  /** The game's code changed since this page loaded (or the AI said it changed things). */
  changed: boolean;
  /** The host can put the files back (a snapshot was kept for the ask). */
  canUndo: boolean;
}

/**
 * The buttons on a paused ask's finished reply, in order (pure). With the moment kept: Try, Before / After, Undo. A host
 * that keeps no moment (an older host): the old Reload (leave the moment, play again from the start). Nothing changed
 * in the code: nothing to try (the reply was an answer).
 */
export function replyActions(s: ReplyState): ReplyAction[] {
  if (!s.paused || !s.changed) return [];
  const out: ReplyAction[] = s.back ? ['try', 'compare'] : ['reload'];
  if (s.canUndo) out.push('undo');
  return out;
}

/**
 * The reply's small second row: the files the AI touched (≤ 2 named, then "+N"), else what the row said before.
 * Paths are shown as the AI gave them (inside the game folder).
 */
export function filesRow(files: string[] | undefined, fallback: string): string {
  if (!files?.length) return fallback;
  const shown = files.slice(0, 2).join(' · ');
  return files.length > 2 ? `${shown} +${files.length - 2}` : shown;
}

/**
 * Is this pause the Try's? The page was opened for a Try and paused within a frame or so of the ask's second (a person
 * who pressed P earlier, before a new run got there, made their own pause: not the Try's picture).
 */
export function isTryPause(at: number, wanted: number): boolean {
  return Number.isFinite(at) && Number.isFinite(wanted) && Math.abs(at - wanted) <= 0.25;
}

/**
 * Decide on this pause now, or wait for the game's exact held second (pure; fixed 2026-11-06).
 * `shot.exact` false = the editor's own estimate (the clock it last heard, run on to now). WHY wait: the game page
 * takes the paused picture first and tells the held second right after (bridge play-ask.ts pauseNow → tellTime), so
 * on a busy machine the estimate ran on by the picture's time — 0.5 s at 20× slower, where the Try's own pause read as
 * "someone else's" and the Before / After panel, closed by the Try's reload, never came back. An estimate only runs
 * late (the clock is run on, never back), so a match on it is a match; no match waits for the exact second.
 */
export function tryPauseVerdict(shot: { time: number; exact: boolean }, wanted: number): 'try' | 'not' | 'wait' {
  if (isTryPause(shot.time, wanted)) return 'try';
  return shot.exact ? 'not' : 'wait';
}

export interface TryWords {
  /** The flash when the Try paused. */
  flash: 'try.sameRun' | 'try.sameRunBehind' | 'try.sameRunAhead' | 'try.openedOut' | 'try.openedStay';
  /** The line under Before / After's After (with ▶ Resume to see it after cmp.out / cmp.stay). */
  note?: 'cmp.out' | 'cmp.stay' | 'cmp.behind' | 'cmp.ahead';
  /** What was already out ({name}), when someone knows. */
  name?: string;
  /** How far off the new run's game clock may be ({s}, seconds, one decimal). */
  s?: string;
}

/** A new run whose game clock may be this far (s) from the ask's is said (fix △7): under it, a frame or two's wobble. */
export const DRIFT_SAY_S = 0.3;

/**
 * What the Try says about what was already out (pause-ask fix ✕2, decided 2026-11-02: plan A of the first walk — say it
 * there, with ▶ Resume to see it). WHY: a saved moment (`exact`) brings back what was on screen AS IT WAS; a fix to
 * "where the boss comes in" shows from the next boss, so Before / After were the same picture and read as "the AI did
 * nothing" or "Try is broken". A new run (no save / load) makes everything again with the new code: nothing to say.
 * The name: the AI's own `--already` ("the boss") first — it knows what its change is about — else the object the game
 * made that the ask was about (`made`); neither = the general sentence.
 */
export function tryWords(exact: boolean, already?: string, made?: string, drift = 0): TryWords {
  // A new run (fix △7, decided 2026-11-02): the clocks are the editor's; a game that cuts long frames counts less when a
  // run loads slowly (a phone, right after the reload). `drift` = how much later the Try's run is than the ask's run by
  // that count (PlayClock.late); said when it is more than a frame or two, because then the boss may not be out yet.
  if (!exact) {
    if (Math.abs(drift) < DRIFT_SAY_S) return { flash: 'try.sameRun' };
    const s = (Math.round(Math.abs(drift) * 10) / 10).toFixed(1);
    return drift > 0 ? { flash: 'try.sameRunBehind', note: 'cmp.behind', s } : { flash: 'try.sameRunAhead', note: 'cmp.ahead', s };
  }
  const name = already?.trim() || made?.trim() || '';
  return name ? { flash: 'try.openedOut', note: 'cmp.out', name } : { flash: 'try.openedStay', note: 'cmp.stay' };
}

export interface CompareSide {
  /** The picture (a data URL), or null while the new moment is being opened. */
  src: string | null;
  label: string;
  sub: string;
}

export interface CompareOpen {
  title: string;
  before: CompareSide;
  after: CompareSide;
  /** What was asked (the person's words), quoted at the foot. */
  asked: string;
  /** The words while `after.src` is null. */
  opening: string;
  /** Under the After (fix ✕2): "Already out at this moment: the boss…" and its ▶ Resume to see it. */
  note?: { text: string; resume?: { label: string; run(): void } };
  undo?: { label: string; run(): void };
  /** ● Clip Before / After (● Clip stage 2, 2026-11-05): the video of this fix, when the After is there. */
  clip?: { label: string; tip: string; run(): void };
  keep: { label: string; run(): void };
  close: string;
}

export interface MomentCompare {
  el: HTMLElement;
  open(o: CompareOpen): void;
  /** The new moment's picture came (Try paused): shown in place of "Opening…". */
  after(src: string, sub?: string): void;
  close(): void;
  isOpen(): boolean;
}

/** The Before / After panel over the game (README picture pc-4): two frames side by side, the words, Undo / Keep · Resume. */
export function createMomentCompare(): MomentCompare {
  const el = h('div', { class: 'moment-compare', role: 'dialog', hidden: true, dataset: { part: 'moment-compare' } });
  let afterBox: HTMLElement | null = null;
  let afterSub: HTMLElement | null = null;
  const side = (s: CompareSide, which: 'before' | 'after', opening: string) => {
    const sub = h('span', { class: 'moment-compare-sub', text: s.sub });
    const pic = h('div', { class: 'moment-compare-pic', dataset: { part: `compare-${which}` } },
      s.src ? h('img', { src: s.src, alt: `${s.label} · ${s.sub}` }) : h('span', { class: 'moment-compare-wait', text: opening }));
    if (which === 'after') {
      afterBox = pic;
      afterSub = sub;
    }
    const fig = h('figure', { class: `moment-compare-side ${which}` }, h('figcaption', {}, h('b', { text: s.label }), sub), pic);
    const n = which === 'after' ? note : undefined;
    if (n) {
      const r = n.resume;
      fig.append(h('div', { class: 'moment-compare-note', dataset: { part: 'compare-note' } }, h('span', { text: n.text }),
        r ? h('button', { type: 'button', class: 'btn', dataset: { action: 'compare-resume' }, onclick: () => r.run() }, icon('play'), h('span', { text: r.label })) : null));
    }
    return fig;
  };
  let note: CompareOpen['note'];
  const api: MomentCompare = {
    el,
    open(o) {
      note = o.note;
      const foot = h('div', { class: 'moment-compare-foot' }, h('q', { class: 'moment-compare-asked', text: o.asked }));
      if (o.undo) {
        const u = o.undo;
        foot.append(h('button', { type: 'button', class: 'btn', dataset: { action: 'compare-undo' }, onclick: () => u.run() }, icon('undo'), h('span', { text: u.label })));
      }
      if (o.clip) {
        const c = o.clip;
        foot.append(h('button', { type: 'button', class: 'btn clip-ba', dataset: { action: 'compare-clip' }, title: c.tip, onclick: () => c.run() },
          h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), h('span', { text: c.label })));
      }
      foot.append(h('button', { type: 'button', class: 'btn primary', dataset: { action: 'compare-keep' }, onclick: () => o.keep.run() }, h('span', { text: o.keep.label })));
      el.replaceChildren(
        h('div', { class: 'moment-compare-head' }, h('span', { text: o.title }),
          h('button', { type: 'button', class: 'icon-btn', dataset: { action: 'compare-close' }, title: o.close, 'aria-label': o.close, onclick: () => api.close() }, icon('close'))),
        h('div', { class: 'moment-compare-pair' }, side(o.before, 'before', o.opening), side(o.after, 'after', o.opening)),
        foot);
      el.setAttribute('aria-label', o.title);
      el.hidden = false;
    },
    after(src, sub) {
      if (!afterBox || el.hidden) return;
      afterBox.replaceChildren(h('img', { src, alt: sub ?? '' }));
      if (sub && afterSub) afterSub.textContent = sub;
    },
    close() {
      el.hidden = true;
      afterBox = afterSub = null;
    },
    isOpen: () => !el.hidden,
  };
  return api;
}
