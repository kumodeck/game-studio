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
    ask(n: number): Promise<GuardAnswer> {
      if (done) close('cancel');
      back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const title = h('h2', { class: 'safe-title', id: 'unsaved-guard-title', text: t('guard.title', { n }) });
      el.setAttribute('aria-labelledby', 'unsaved-guard-title');
      const save = h('button', { type: 'button', class: 'primary', dataset: { action: 'guard-save' }, text: t('guard.save'), onclick: () => close('save') });
      const skip = h('button', { type: 'button', dataset: { action: 'guard-discard' }, text: t('guard.discard'), onclick: () => close('discard') });
      const no = h('button', { type: 'button', dataset: { action: 'guard-cancel' }, text: t('guard.cancel'), onclick: () => close('cancel') });
      // Cancel · Don't save · Save and continue: the main one at the end, as in "Check before you save".
      el.replaceChildren(title, h('div', { class: 'safe-actions' }, no, skip, save));
      scrim.hidden = false;
      el.hidden = false;
      save.focus({ preventScroll: true });
      return new Promise((r) => (done = r));
    },
  };
}
