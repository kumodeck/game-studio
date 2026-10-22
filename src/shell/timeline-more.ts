// The timeline's "⋯" (studio-motion-panel, 2026-10-22): the strip's sometimes-used settings, out of the one line.
//
// A review of 2026-10-22, on the strip of three rows (▶ · time · Auto key · Motion · Once · Ease ⌄ / Starts [In my words…]
// [When? (for your AI)] Stops / Try ▶ ▶): "very cluttered, not organised". Everything on it was sorted by how often a
// hand needs it: every time stays on the line (▶, the time, Auto key, the motion, when it starts, Ask AI, fold); the
// sometimes ones come here — Repeat, Stops (times / cue / then), the other ways it starts ("or"), every cue to Try,
// and the "used by N objects" note. Nothing was taken away: only its place moved.
//
// WHY a popover on the page and not inside the plate: the plate clips (overflow hidden, for its round corners and the
// rows' scroll), and a plate of one row is ~60 px tall — less than the four rows here. Fixed on the shell, it opens
// above the "⋯" (the plate sits at the bottom of the game) and stays inside the window on a phone.
// WHY drawn anew on each render, like the head: its menus show the clip's values, which every edit changes; the panel
// keeps only "open or not" (a press outside, Esc or ⋯ again closes it).
import { h } from './dom.ts';

export interface MorePop {
  /** The panel to fill (the plate's render puts its rows in). */
  readonly el: HTMLElement;
  readonly open: boolean;
  /** Open (fill first) / close. `back`: the keyboard goes back to the ⋯ button (Esc). */
  show(anchor: HTMLElement): void;
  hide(back?: boolean): void;
  /** Place it again over its button (the head was drawn anew: a new button in the same spot). */
  place(anchor: HTMLElement): void;
}

/**
 * `opts` (studio-motion-focus: the "+ Link an object" list uses the same popover): `left` = its left edge on the
 * button's left edge (the button is at the plate's left end; ⋯ is at the right), `width` (420 by default), `part`.
 */
export function createMorePop(host: () => HTMLElement, label: string, onHide: () => void, opts: { left?: boolean; width?: number; part?: string } = {}): MorePop {
  const el = h('div', { class: 'tl-more', role: 'dialog', 'aria-label': label, dataset: { part: opts.part ?? 'tl-more' } });
  let open = false;
  let anchor: HTMLElement | null = null;
  const place = (a: HTMLElement) => {
    anchor = a;
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth;
    const w = Math.min(opts.width ?? 420, vw - 16);
    el.style.width = `${w}px`;
    // Right edge on the button's right edge (or left on left), kept 8 px inside the window; above it (the plate is at the bottom).
    el.style.left = `${Math.max(8, Math.min(vw - w - 8, opts.left ? r.left : r.right - w))}px`;
    el.style.bottom = `${Math.max(8, window.innerHeight - r.top + 6)}px`;
  };
  const outside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!el.contains(t) && !anchor?.contains(t)) hide();
  };
  function hide(back = false) {
    if (!open) return;
    open = false;
    el.remove();
    document.removeEventListener('pointerdown', outside, true);
    if (back) anchor?.focus({ preventScroll: true });
    onHide();
  }
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    hide(true);
  });
  return {
    el,
    get open() {
      return open;
    },
    show(a) {
      if (!open) {
        open = true;
        host().append(el);
        document.addEventListener('pointerdown', outside, true);
      }
      place(a);
    },
    hide,
    place,
  };
}
