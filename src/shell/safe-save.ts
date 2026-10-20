// "Check before saving": big changes to big things are said in words before Save hands them to the AI.
//
// WHY (a hands-on try of 2026-10-19, item 4): "just trying things out, the road (the ground) ended up 16 m up,
// and I could save it like that. When something big is moved a lot, show what changed before saving — 'Raised the
// road 16 m' — so it is easy to see." The road is now held from the start (bridge/hold.ts); this is the second net,
// for a ground the person made movable and for any object flung far by accident.
//
// What counts (bigChanges):
// - a ground / road / sea / sky (Item.backdrop: 3D adapters/three/ground.js, 2D core/port2d.ts): any change you can
//   see (5 cm / 1 px, 1°, 1 % of its size) — moving the ground at all is rare and changes the whole game;
// - any other 3D object: 5 m up or down, or 25 m sideways, or 3× its size — a slip of the Height tool on a far
//   object, not a placement (a crate moved across a yard is 2–10 m).
// The sheet lists one line per change ("Raised the road 16 m") with two ways on: put those back (and save the rest),
// or save anyway. × / Escape go back to editing with nothing saved. Pure parts (bigChanges) are unit-tested in
// test/safe-save.test.ts; the sheet is shown by test/fb-safe-shots.browser.mjs.
import type { Dim, Item, Pose } from '../contract.ts';
import { h } from './dom.ts';

export interface BigChange {
  key: string;
  text: string;
}

type T = (k: string, vars?: Record<string, string | number>) => string;

const DEG = 180 / Math.PI;
const sizeOf = (p: Pose) => (Array.isArray(p.s) ? Math.max(...p.s) : (p.s ?? 1));
const angleGap = (a: number, b: number) => {
  const d = Math.abs((((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  return Math.min(d, 2 * Math.PI - d);
};
/** "16", "2.5", "0.3": whole numbers from 10 up, one decimal below. */
const num = (v: number) => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));

/** The big changes among `keys` (changed since the last save), one line each, in list order. */
export function bigChanges(items: Item[], keys: Set<string>, before: (k: string) => Pose | undefined, now: (k: string) => Pose | undefined, dim: Dim, t: T, name: (it: Item) => string): BigChange[] {
  const out: BigChange[] = [];
  for (const it of items) {
    if (!keys.has(it.key)) continue;
    const a = before(it.key), b = now(it.key);
    if (!a || !b) continue;
    const ground = !!it.backdrop;
    if (!ground && dim !== '3d') continue;
    const n = name(it);
    const unit = dim === '3d' ? 'm' : 'px';
    // Height: 3D y. 2D has no height: its y is part of the move.
    const dy = dim === '3d' ? (b.p[1] ?? 0) - (a.p[1] ?? 0) : 0;
    const side = dim === '3d' ? Math.hypot((b.p[0] ?? 0) - (a.p[0] ?? 0), (b.p[2] ?? 0) - (a.p[2] ?? 0)) : Math.hypot((b.p[0] ?? 0) - (a.p[0] ?? 0), (b.p[1] ?? 0) - (a.p[1] ?? 0));
    const turn = angleGap(b.r ?? 0, a.r ?? 0) * DEG;
    const grow = sizeOf(b) / (sizeOf(a) || 1);
    const big = ground
      ? { lift: dim === '3d' ? 0.05 : Infinity, side: dim === '3d' ? 0.05 : 1, turn: 1, grow: 1.01 }
      : { lift: 5, side: 25, turn: Infinity, grow: 3 };
    if (Math.abs(dy) >= big.lift) out.push({ key: it.key, text: t(dy > 0 ? 'safe.raised' : 'safe.lowered', { name: n, n: num(Math.abs(dy)), unit }) });
    if (side >= big.side) out.push({ key: it.key, text: t('safe.moved', { name: n, n: num(side), unit }) });
    if (turn >= big.turn) out.push({ key: it.key, text: t('safe.turned', { name: n, n: Math.round(turn) }) });
    if (grow >= big.grow || 1 / grow >= big.grow) out.push({ key: it.key, text: t('safe.resized', { name: n, n: num(grow) }) });
  }
  return out;
}

export type SafeAnswer = 'save' | 'putBack' | 'cancel';

/** The sheet: over the game, in the middle; one at a time. */
export function createSafeSave(deps: { mount: HTMLElement; t: T }) {
  const { t } = deps;
  const el = h('div', { class: 'safe-save', role: 'dialog', 'aria-modal': 'true', hidden: true, dataset: { part: 'safe-save' } });
  deps.mount.append(el);
  let done: ((a: SafeAnswer) => void) | null = null;
  const close = (a: SafeAnswer) => {
    el.hidden = true;
    el.replaceChildren();
    const d = done;
    done = null;
    d?.(a);
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close('cancel');
    }
  });
  return {
    get open() {
      return !el.hidden;
    },
    ask(changes: BigChange[]): Promise<SafeAnswer> {
      if (done) close('cancel');
      const title = h('h2', { class: 'safe-title', id: 'safe-save-title', text: t('safe.title') });
      el.setAttribute('aria-labelledby', 'safe-save-title');
      const list = h('ul', { class: 'safe-list' }, ...changes.map((c) => h('li', { text: c.text })));
      const save = h('button', { type: 'button', class: 'primary', dataset: { action: 'safe-save' }, text: t('safe.save'), onclick: () => close('save') });
      const back = h('button', { type: 'button', dataset: { action: 'safe-put-back' }, text: t('safe.putBack'), onclick: () => close('putBack') });
      const x = h('button', { type: 'button', class: 'icon-btn safe-x', dataset: { action: 'safe-cancel' }, 'aria-label': t('btn.close'), title: t('btn.close'), text: '×', onclick: () => close('cancel') });
      el.replaceChildren(h('div', { class: 'safe-head' }, title, x), h('p', { class: 'muted safe-lead', text: t('safe.lead') }), list, h('div', { class: 'safe-actions' }, back, save));
      el.hidden = false;
      // The safe choice under the keyboard first: Enter puts the change back.
      back.focus();
      return new Promise((r) => (done = r));
    },
  };
}
