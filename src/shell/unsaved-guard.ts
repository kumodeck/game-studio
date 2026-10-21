// "You have 3 unsaved changes": the one window before something the person changed would be lost (a try of the editor, 2026-10-21:
// "some people forget to press Save, so we have to make them notice — when edits are about to be lost, show a modal").
//
// WHAT is lost, and by what (the list made for this window):
// - placement / Library changes are written as a draft ~0.7 s after each one (main.ts keepNow), so a new game page
//   (Play, the AI's reload, Reload game, Undo AI change) never loses them (play-unsaved, 2026-10-21). What a closed or
//   reloaded EDITOR page loses is the Save itself: the next page opens the draft as if it were saved, "Save · N" never
//   comes back, and the local AI is never handed those changes. So leaving the page counts them — except in the web
//   demo (`offline`), where there is no AI to hand them to and the draft IS the save (the same key in this browser).
// - a game tool's data (.studio/data/<id>.json, CONTRACT.md §7) lives only in the game page until Save collects it:
//   any new game page loses it, and so does leaving.
// Nothing else asks: switching World / UI, the Library, the language, Play's own Reload (no tool is on while playing).
//
// The window: one sentence with the number, three buttons — Save and continue (the main one, focused: Enter), Don't
// save, Cancel (Esc, or a press outside). Tab stays inside. Closing the tab or reloading can only get the browser's
// own question (beforeunload: its words, not ours), and only while lostBy('leave') > 0.
// Pure part (lostBy) in test/unsaved-guard.test.ts; the window and each case in test/studio-unsaved-guard.browser.mjs.
//
// The same window, asked at ▶ Play (a try of the editor, 2026-10-21: "when 'this change isn't in the game yet', some
// people want to save and some want to try it without saving — let them choose with buttons"). Nothing is lost at
// Play (the draft goes along), so it is not a warning but a choice: "You have 3 unsaved changes" / "Save, and your
// AI puts them in the game's code." and Save and play (the main one: Enter) · Try without saving · Cancel. It replaced
// the strip over the game while playing ("This change isn't in the game yet [Save] ×"): the person already chose, so
// Play says nothing more (the orange Save beside Play stays). Asked by main.ts togglePlay; the pure "when" is
// playAsks() below, the screen in test/studio-play-choice.browser.mjs.
import { h } from './dom.ts';

type T = (k: string, vars?: Record<string, string | number>) => string;

/** 'leave' = this editor page goes (tab, reload, a link); 'reload' = a new page of the game inside it. */
export type GuardOp = 'leave' | 'reload';

export interface GuardState {
  /** No AI behind the host (the web demo): the draft is the save. */
  offline: boolean;
  /** Changes not saved that the draft keeps (placement, both layers, and the Library). */
  kept: number;
  /** Game tools' changes not saved (only in the game page). */
  tools: number;
}

/** How many unsaved changes `op` would lose (0 = go on without asking). */
export function lostBy(op: GuardOp, s: GuardState): number {
  const tools = Math.max(0, s.tools);
  if (op === 'reload') return tools;
  return (s.offline ? 0 : Math.max(0, s.kept)) + tools;
}

export type GuardAnswer = 'save' | 'discard' | 'cancel';

/**
 * Does ▶ Play ask first? Only with something not saved (n = main.ts dirtyCount: placement, both layers, the Library and
 * a game tool's data), and only going INTO Play — Edit from Play never asks (nothing is chosen there).
 */
export function playAsks(n: number, playing: boolean): boolean {
  return !playing && n > 0;
}

/**
 * What the window says. 'loss' = something would be lost (leave, a game tool's data at a reload); 'play' = the choice
 * at ▶ Play. `tools` (play only) = a game tool's changes among them, which live in the game page only: Try without
 * saving loses those (unsaved-guard's own rule), so the window says so in a third short line instead of promising
 * that every change stays.
 */
export interface GuardAsk {
  kind?: 'loss' | 'play';
  tools?: number;
}

/** The window: in the middle of the editor, the glass of "Check before you save" (safe-save.ts); one at a time. */
export function createUnsavedGuard(deps: { mount: HTMLElement; t: T }) {
  const { t } = deps;
  // The layer under the window takes the presses meant for the editor behind it (a press there = Cancel).
  const scrim = h('div', { class: 'guard-scrim', hidden: true, dataset: { part: 'unsaved-scrim' } });
  const el = h('div', { class: 'safe-save unsaved-guard', role: 'alertdialog', 'aria-modal': 'true', tabindex: '-1', hidden: true, dataset: { part: 'unsaved-guard' } });
  deps.mount.append(scrim, el);
  let done: ((a: GuardAnswer) => void) | null = null;
  let back: HTMLElement | null = null;
  const close = (a: GuardAnswer) => {
    el.hidden = true;
    scrim.hidden = true;
    el.replaceChildren();
    const d = done;
    done = null;
    // Focus goes back where it was (the Play button, the link…), so the keyboard carries on from there.
    if (back?.isConnected) back.focus({ preventScroll: true });
    back = null;
    d?.(a);
  };
  scrim.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    close('cancel');
  });
  el.addEventListener('keydown', (e) => {
    // Nothing typed here reaches the editor's keys (P would press Play again, ⌘Z would undo behind the window).
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close('cancel');
    } else if (e.key === 'Tab') {
      const bs = [...el.querySelectorAll<HTMLButtonElement>('button')];
      const i = bs.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      bs[(i + (e.shiftKey ? bs.length - 1 : 1) + bs.length) % bs.length]?.focus();
    }
    // Enter presses the focused button (the browser's own); the main one has the focus when the window opens, and
    // Enter with the focus anywhere else in the window (after a press on its text) is the main one too.
    else if (e.key === 'Enter' && !(document.activeElement instanceof HTMLButtonElement && el.contains(document.activeElement))) {
      e.preventDefault();
      close('save');
    }
  });
  return {
    get open() {
      return !el.hidden;
    },
    /** The kind it was opened for ('loss' / 'play'; null while closed), for the screen tests. */
    get kind() {
      return el.hidden ? null : el.dataset.kind || null;
    },
    ask(n: number, how: GuardAsk = {}): Promise<GuardAnswer> {
      if (done) close('cancel');
      back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const play = how.kind === 'play';
      el.dataset.kind = play ? 'play' : 'loss';
      const title = h('h2', { class: 'safe-title', id: 'unsaved-guard-title', text: t('guard.title', { n }) });
      el.setAttribute('aria-labelledby', 'unsaved-guard-title');
      // Play: the second line says what Save does (one short sentence; the web demo says "kept in this browser",
      // hosts/browser/text.ts), and — only when a game tool's data is among them — what Try loses.
      const lines = !play ? [] : [
        h('p', { class: 'safe-lead', id: 'unsaved-guard-why', dataset: { part: 'unsaved-guard-why' }, text: t('guard.playWhy') }),
        ...((how.tools ?? 0) > 0 ? [h('p', { class: 'safe-lead', dataset: { part: 'unsaved-guard-tools' }, text: t('guard.playTools', { n: how.tools ?? 0 }) })] : []),
      ];
      if (play) el.setAttribute('aria-describedby', 'unsaved-guard-why');
      else el.removeAttribute('aria-describedby');
      const save = h('button', { type: 'button', class: 'primary', dataset: { action: 'guard-save' }, text: t(play ? 'guard.playSave' : 'guard.save'), onclick: () => close('save') });
      const skip = h('button', { type: 'button', dataset: { action: 'guard-discard' }, text: t(play ? 'guard.playTry' : 'guard.discard'), onclick: () => close('discard') });
      const no = h('button', { type: 'button', dataset: { action: 'guard-cancel' }, text: t('guard.cancel'), onclick: () => close('cancel') });
      // Cancel · Don't save · Save and continue: the main one at the end, as in "Check before you save" (narrow: one
      // per row, the main one on top — shell.css .unsaved-guard). Play's window has the same three places.
      el.replaceChildren(title, ...lines, h('div', { class: 'safe-actions' }, no, skip, save));
      scrim.hidden = false;
      el.hidden = false;
      save.focus({ preventScroll: true });
      return new Promise((r) => (done = r));
    },
  };
}
