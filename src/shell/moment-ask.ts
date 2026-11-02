// The way in to "ask from the paused moment" (pause-ask stage 1, 2026-11-02). Reported in a hands-on try on 2026-11-02:
// "there is no UI to tell the AI something from the stopped scene — stop the scene, tell the AI" — the field
// WAS there (moment-talk.ts, "Ask Claude about this moment…"), but nothing on screen said that the frame the game
// stopped on goes with the words, the cursor was not in it, and the web demo had no field at all. Stage 1 adds, on the
// SAME one field (decision 7 of pause-edit: one place to talk to the AI, never a second field):
//   1. left in the field, the paused frame small with its time ("0:05.02") — "this picture goes with what you type";
//   2. the cursor in the field as the moment comes up (PC only, and only when nothing else has the keys: momentFocusOk);
//   3. a thin violet line round the game while paused (shell.css .stage::after) — the AI's colour, "this frame is what
//      the AI sees". Edit has no line round the game, so the two read apart;
//   4. the web demo shows the field too (decided 2026-11-02) and sends nothing: one line says it isn't connected.
// What goes to the AI is unchanged in this stage (the `play` request with `paused`, main.ts momentRequest); stage 2
// adds marks and the code's places.
//
// Pure parts are tested in test/moment-ask.test.ts; the screen in test/studio-pause.browser.mjs (moment, momentdemo).
import { h } from './dom.ts';
import { clockText } from './moment.ts';

/**
 * Is the moment's field on screen? Always while paused (the demo too, Q1); outside a moment, only with an AI behind
 * the host — the demo's Edit keeps its empty foot (2026-10-18: a box that did nothing was the loudest thing on screen,
 * main.ts renderAll). The demo's paused field is different: there it shows WHAT can be done, and says plainly on send
 * that the demo can't (momentAskOffline).
 */
export function askFieldShown(s: { offline: boolean; moment: boolean }): boolean {
  return !s.offline || s.moment;
}

/** What a send from the field does: to the AI, or (the web demo, paused) nothing but the one line. */
export function momentAskOffline(s: { offline: boolean; moment: boolean }): boolean {
  return s.offline && s.moment;
}

/**
 * Put the cursor in the field as the moment comes up? Only when it takes nothing from the person:
 * - not on a phone / the side window (`touch`): a focused field brings up the keyboard over half of the frame that
 *   was just stopped to be looked at (and iOS ignores a focus that no tap asked for anyway);
 * - not while something else has the keys: another field (a rename, a number on the card, ⌘K's search, ⚑'s name), or
 *   an open sheet / menu (`overlay`). Then the person was in the middle of something.
 * The game frame or a button having the focus is fine: that is where the P / ❚❚ that paused came from.
 * WHY the cursor at all (README §1): the first second after a pause should say "you can say something about THIS".
 * The cost: P / N / M typed while the cursor is in it are letters (a message may start with "p"); a click on the game
 * or Esc leaves the field, and P resumes again (test/studio-pause.browser.mjs glow: "P in the field is a letter").
 */
export function momentFocusOk(s: { touch: boolean; overlay: boolean; active: { tag: string; editable?: boolean; askField?: boolean } | null }): boolean {
  if (s.touch || s.overlay) return false;
  const a = s.active;
  if (!a) return true;
  if (a.askField) return true;
  if (a.editable) return false;
  return !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tag);
}

/**
 * The paused frame's time for the field's picture. The game page says play/paused first and its play/time (the held
 * clock, exact) just after; until then the editor's estimate of the running clock stands in. A Next frame afterwards
 * moves the top bar's clock but NOT this one: the picture is the one taken at the pause (bridge/play-ask.ts pauseNow),
 * so its time stays the pause's — the picture and its time never disagree.
 */
export function shotTimeOnClock(shot: { time: number; exact: boolean } | null, clock: { t: number; running: boolean }): { time: number; exact: boolean } | null {
  if (!shot || shot.exact || clock.running) return shot;
  return { time: clock.t, exact: true };
}

export interface MomentShot {
  /** The small picture + its time, first in the field (a <span>: the field's form puts it before the chips). */
  el: HTMLElement;
  /** Show `src` (the moment's picture, a data: URL) at `time` (seconds since ▶ Play); `tip` = its tooltip / label. */
  show(src: string | undefined, time: number, tip: string): void;
  hide(): void;
}

export function createMomentShot(): MomentShot {
  const img = h('img', { class: 'moment-shot-img', alt: '', draggable: 'false' }) as HTMLImageElement;
  const time = h('span', { class: 'moment-shot-time mono' });
  // role=img + aria-label: read aloud as one thing ("Paused at 0:05.02 …"); not a button in this stage (pressing it to
  // see "what Claude gets" is the README's picture 2, a later stage).
  const el = h('span', { class: 'moment-shot', role: 'img', dataset: { part: 'moment-shot' }, hidden: true }, img, time);
  let src = '';
  return {
    el,
    show(s, t, tip) {
      // No picture (the game page could not take one: a tainted canvas, say): the time alone still says "this moment".
      const next = s ?? '';
      if (next !== src) {
        src = next;
        if (next) img.src = next;
        else img.removeAttribute('src');
      }
      img.hidden = !next;
      time.textContent = clockText(t, 2);
      el.title = tip;
      el.setAttribute('aria-label', tip);
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
      // Let the big data: URL go (a pause's picture is the game's whole frame as a JPEG).
      if (src) {
        src = '';
        img.removeAttribute('src');
      }
    },
  };
}

/**
 * pause-ask stage 2, fix 1 (2026-11-02; the leader's call after trying stage 1): P → P must go on playing. Stage 1 put
 * the cursor in the field as the moment came up, so the second P typed a "p" and the game stayed stopped — the most
 * common thing a person does after a pause (look, then go on) broke. Now: while the cursor got there BY ITSELF (`auto`:
 * nobody clicked the field) and the field is still empty, the game's and the editor's keys work as before — P resumes,
 * . steps, Esc leaves, N marks, ? shows the keys. The first letter the editor does not take is typed (and from then on
 * everything is a letter: `auto` ends at the first `input`), and a click in the field ends it at once.
 * Not passed even then: keys that would act on the scene where an empty field means "nothing" — Backspace / Delete
 * (they delete the selection in the editor), Enter (send), Tab (move on), Space (look around: a message may start
 * with a space no more than with a "p", but Space held is a drag mode and must never start from a field).
 * With ⌘ / Ctrl the field already passes what it does not use (main.ts keydown), so those are not this function's.
 */
export function momentKeyPasses(s: { auto: boolean; empty: boolean; key: string; mod: boolean }): boolean {
  if (!s.auto || !s.empty || s.mod) return false;
  if (s.key.length === 1) return s.key !== ' ';
  return /^(Escape|Arrow(Up|Down|Left|Right)|PageUp|PageDown|End|F2)$/.test(s.key);
}

/**
 * pause-ask stage 2, fix 2: the placeholder on a narrow field. "Ask Claude about this moment…" was cut to "Ask Claude
 * about this mor…" on a phone (390 px: the picture, the ◎ and the send button leave ~170 px for words). A cut word reads
 * as a mistake; a short whole one does not. Short when the phone / side-window layout is on, or when the field is
 * measured narrower than the long words need (`room` px vs `need` px; 0 = not measured yet → the layout decides).
 */
export function askPhShort(s: { phone: boolean; room: number; need: number }): boolean {
  if (s.phone) return true;
  return s.room > 0 && s.need > s.room;
}
