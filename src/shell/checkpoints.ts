// Checkpoints, the editor page's side (pause-edit stage 3, 2026-10-28; CONTRACT.md §1.14 "Checkpoints").
//
// The request (2026-10-28): "pause in the middle of a scene and give instructions, by hand or to the AI";
// stage 3 answers the plan's need 5 — to try a fix of the boss, a person played 40 s to get back to the boss every
// time. Decision 14 and the plan's Q2 answered (a) ("in the editor only"):
//   - ⚑ in the paused moment's top bar (moment.ts) → the name field under it, "0:42" at first (the game's time) → Enter
//     keeps it: the game page's save() (bridge/moment-load.ts), the host's .studio/checkpoints/<name>.json;
//   - ▶ Play ⌄ lists "⚑ Play from Before the boss", newest first, this level's only, each row with ⋯ (Rename, Delete);
//     ⌘K too. Opening one is a new Play page that loads the moment before its first frame; placed things stand where
//     the scene has them NOW (a checkpoint is the game's moment, the layout is always the scene's);
//   - a game that cannot start from the middle (no save / load): ⚑ says so in one line, "This game can't start from
//     the middle yet." with ✦ Have {ai} let the game start from here (the web demo: the line alone). A checkpoint of
//     the position of things only is never made: the score and the enemies would be another moment's — a lie;
//   - a checkpoint that does not open (load threw, or the game has no load any more): Play from the start, and one line
//     at the top "The game changed, so this checkpoint can't open" with ✦ (the error and the console's lines go along).
// This file holds the pure rules (test/checkpoint.test.ts) and the two small pieces drawn for it — the floating field
// under ⚑ (also the one line there) and the line at the top; main.ts wires them to the game page, the host and the
// field at the foot.
import type { CheckpointInfo } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { clockText } from './moment.ts';

/** ▶ Play ⌄ and ⌘K list this many (the newest): a longer list is a save folder, not a menu. */
export const CHECKPOINTS_LISTED = 12;

/** This level's checkpoints, newest first (the menu's order). `level` null = a game without levels. */
export function checkpointsOf(list: CheckpointInfo[], level: string | null): CheckpointInfo[] {
  return list.filter((c) => (c.level ?? null) === (level ?? null)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}

/** The name field's first words: the game's time as the top bar writes it while playing on a phone ("0:42"). */
export function defaultCheckpointName(seconds: number): string {
  return clockText(seconds, 0);
}

/** A name as the field gives it: one line, trimmed, ≤ 40 characters ('' = none: Enter does nothing). */
export function checkpointName(v: string): string {
  return v.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
}

/**
 * The checkpoint "⚑ From …" beside Reload opens (the brief's 5): the one this Play opened from while it is still kept,
 * else the newest of this level, else none.
 */
export function reloadCheckpoint(list: CheckpointInfo[], level: string | null, playedFrom: string | null): CheckpointInfo | null {
  const mine = checkpointsOf(list, level);
  return (playedFrom ? mine.find((c) => c.id === playedFrom) : undefined) ?? mine[0] ?? null;
}

/**
 * The moment's picture made small for the file (≤ `w` px wide, JPEG): the menu has room for a name, not a picture, and
 * a checkpoint is kept for its moment — 240 px is enough to tell two apart in the folder. Undefined when it cannot.
 */
export function smallShot(dataUrl: string | undefined, w = 240): Promise<string | undefined> {
  if (!dataUrl || typeof Image === 'undefined') return Promise.resolve(undefined);
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, w / (img.naturalWidth || w));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.naturalWidth || w) * k));
        c.height = Math.max(1, Math.round((img.naturalHeight || w * 0.6) * k));
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', 0.72));
      } catch {
        done(undefined);
      }
    };
    img.onerror = () => done(undefined);
    img.src = dataUrl;
  });
}

export interface CheckpointPopDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  aiVars(): Record<string, string>;
  /** Opened / closed (main.ts: Esc, the keys). */
  changed?(open: boolean): void;
}

/** The floating plate under ⚑ (or under ▶ Play ⌄ for a rename): a name field, or one line with ✦. */
export interface CheckpointPop {
  el: HTMLElement;
  isOpen(): boolean;
  /**
   * The name field under `at`: `name` first (selected, so typing replaces it), Enter → `keep(name)`; Esc / a press
   * outside closes. `keep` answers an error to show under the field, null (done: it closes) or undefined (the plate is
   * something else now — the one line: left as it is).
   */
  name(at: HTMLElement, o: { name: string; label: string; button: string; keep(name: string): Promise<string | null | undefined> }): void;
  /** One line under `at`, and ✦ when `ask` is given (the web demo: none). */
  line(at: HTMLElement, text: string, ask?: { label: string; run(): void }): void;
  close(): void;
}

export function createCheckpointPop(d: CheckpointPopDeps): CheckpointPop {
  const el = h('div', { class: 'cp-pop', role: 'dialog', hidden: true, dataset: { part: 'checkpoint-pop' } });
  let open = false;
  let busy = false;

  const place = (at: HTMLElement) => {
    el.hidden = false;
    el.style.visibility = 'hidden';
    const r = at.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    // Under the button, its left edge on the button's (the plan's find.png), kept inside the window.
    el.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - m.width - 8)))}px`;
    el.style.top = `${Math.round(r.bottom + 6)}px`;
    el.style.visibility = '';
    if (!open) {
      open = true;
      d.changed?.(true);
    }
  };
  const close = () => {
    if (!open) return;
    open = false;
    busy = false;
    el.hidden = true;
    el.replaceChildren();
    d.changed?.(false);
  };
  // A press outside closes it (the field's own presses and ⚑'s, which opens it again, do not).
  document.addEventListener('pointerdown', (e) => {
    if (open && !el.contains(e.target as Node) && !(e.target as Element | null)?.closest?.('[data-part=checkpoint]')) close();
  }, true);

  return {
    el,
    isOpen: () => open,
    name(at, o) {
      const input = h('input', { type: 'text', class: 'cp-name', maxlength: '40', value: o.name, 'aria-label': o.label, dataset: { part: 'checkpoint-name' }, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
      const err = h('p', { class: 'cp-err', role: 'alert', hidden: true, dataset: { part: 'checkpoint-error' } });
      const keep = h('button', { type: 'button', class: 'cp-keep', dataset: { action: 'checkpoint-keep', part: 'checkpoint-keep' }, text: o.button }) as HTMLButtonElement;
      const go = async () => {
        const n = checkpointName(input.value);
        if (!n || busy) return;
        busy = true;
        keep.disabled = true;
        const e = await o.keep(n);
        busy = false;
        keep.disabled = false;
        if (!open || e === undefined) return;
        if (e === null) return close();
        err.textContent = e;
        err.hidden = false;
      };
      input.addEventListener('keydown', (e) => {
        // The editor's own keys (P, ., ⌘Z) are not for a field being typed in; Enter keeps, Esc closes.
        e.stopPropagation();
        if (e.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          void go();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close();
          at.focus({ preventScroll: true });
        }
      });
      keep.addEventListener('click', () => void go());
      el.dataset.mode = 'name';
      el.setAttribute('aria-label', o.label);
      el.replaceChildren(h('label', { class: 'cp-label', text: o.label }), h('div', { class: 'cp-row' }, input, keep), err);
      place(at);
      input.focus({ preventScroll: true });
      input.select();
    },
    line(at, text, ask) {
      el.dataset.mode = 'line';
      el.setAttribute('aria-label', text);
      const b = ask
        ? h('button', { type: 'button', class: 'link-btn mv-ask ai', dataset: { action: 'checkpoint-ask', part: 'checkpoint-ask' }, title: ask.label, onclick: () => (close(), ask.run()) },
          h('span', { class: 'ai-spark', 'aria-hidden': 'true' }, icon('spark')), h('span', { class: 'label', text: ask.label }))
        : null;
      el.replaceChildren(h('p', { class: 'cp-line', dataset: { part: 'checkpoint-none' }, text }), ...(b ? [b] : []));
      place(at);
      (b ?? el).focus?.({ preventScroll: true });
    },
    close,
  };
}

export interface CheckpointNoteDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  aiVars(): Record<string, string>;
}

/**
 * The line at the top of the game when a checkpoint did not open (decision 14): "The game changed, so this checkpoint
 * can't open" · ✦ Have {ai} fix it · ×. Stays until × or the end of this Play (a line that goes by itself was missed
 * in walk 1's tests of the first-Play line).
 */
export interface CheckpointNote {
  el: HTMLElement;
  show(o: { ask?: () => void }): void;
  hide(): void;
  readonly shown: boolean;
}

export function createCheckpointNote(d: CheckpointNoteDeps): CheckpointNote {
  const el = h('div', { class: 'cp-note', role: 'status', hidden: true, dataset: { part: 'checkpoint-note' } });
  return {
    el,
    show(o) {
      const close = h('button', { type: 'button', class: 'cp-note-x', dataset: { action: 'checkpoint-note-close' }, 'aria-label': d.t('checkpoint.close'), title: d.t('checkpoint.close'),
        onclick: () => (el.hidden = true) }, icon('close'));
      const ask = o.ask
        ? h('button', { type: 'button', class: 'link-btn mv-ask ai', dataset: { action: 'checkpoint-fix', part: 'checkpoint-fix' }, title: d.t('checkpoint.fixAsk', d.aiVars()), onclick: () => o.ask!() },
          h('span', { class: 'ai-spark', 'aria-hidden': 'true' }, icon('spark')), h('span', { class: 'label', text: d.t('checkpoint.fixAsk', d.aiVars()) }))
        : null;
      el.replaceChildren(icon('flag'), h('span', { class: 'cp-note-text', text: d.t('checkpoint.cantOpen') }), ...(ask ? [ask] : []), close);
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
    get shown() {
      return !el.hidden;
    },
  };
}
