// The right-click / long-press menu (context menu, 2026-10-18). context-rows.ts decides WHAT it lists per place;
// this file only draws it, places it at the pointer and runs the keyboard. main.ts opens it from three ways in:
// a right-click in the editor page (the list's rows, the Library's tiles), a long press there on a phone, and
// `placement/context` from the game frame (a right-click / long press on the game, bridge/input.ts).
//
// Look (the design review's measure: the tools quieter than the game): one small plate of
// the glass every floating thing is made of (shell.css rule 1), corners that nest (plate = row + padding, rule 3), PC
// rows 28 high in the text size, phone rows 44 (a finger). No colour: the row under the pointer or the keys is the grey
// of a hovered ⌘K row; orange stays "what you picked" — the picked object's outline in the game says what the menu is
// about. The key at the right end in the third grey, as Mac menus print it (keymap.ts, the same text as the tooltips
// and the ? sheet); phones show no keys (no keyboard).
//
// Behaviour (what menus on Mac / Windows do, so nothing has to be learnt):
// - Opens at the pointer, moved in so it never leaves the window (it opens up / to the left near an edge). From a
//   finger it opens ABOVE the finger, so the finger does not cover the first row.
// - A clear layer over the whole editor (the game frame included) catches the next press outside: that press only
//   closes the menu, it does not also pick or move anything (the game frame cannot tell the editor page about its own
//   presses, so without the layer a press on the game would leave the menu standing).
// - Esc, Tab, a resize or leaving the window close it. A scroll by the person cannot happen under it (the layer takes the
//   wheel and the finger, and closes); a scroll the page makes itself (the Library keeping the pressed tile in place
//   while a detail opens above it) leaves it open — closing on any scroll shut the menu as it opened (2026-10-18). ↑ ↓ move the highlight (wrapping), Home / End,
//   Enter / Space run it; any other key closes it and goes on to the editor (⌘Z still undoes).
// - Dimmed rows stay in place and cannot be chosen (context-rows.ts says why).
// - The camera never moves for it, and nothing it does sends what the floating panels cover (the strip stays put).
import { h } from './dom.ts';

export interface MenuItem {
  id: string;
  label: string;
  /** The key at the right end ("⌘D"), already spelled for this system; '' = none. */
  key?: string;
  disabled?: boolean;
  run(): void;
}
export type MenuEntry = MenuItem | { sep: true };

export interface ContextMenuDeps {
  /** Phone layout: 44 px rows, no keys. */
  phone(): boolean;
  /** Opened / closed (main.ts marks the page, for tests and .studio/ui/ CSS). */
  changed?(open: boolean, place: string | null): void;
}

export interface OpenOptions {
  /** data-place on the menu (object / scene / libObject / libFile), for tests and CSS. */
  place: string;
  /** Opened by a finger: the menu goes above the point. */
  touch?: boolean;
  /** Opened from the keyboard (Shift+F10, the menu key): the first row is highlighted at once. */
  keyboard?: boolean;
  /** What it is about, read aloud ("Menu for crate-4"). */
  label?: string;
}

/** Where a menu of size w × h opens for a point, inside a window of vw × vh with an 8 px margin (pure; tested). */
export function placeMenu(x: number, y: number, w: number, hgt: number, vw: number, vh: number, touch = false): { left: number; top: number } {
  const m = 8;
  // A mouse: the corner 2 px off the pointer (a release right after the press must not land on a row). A finger:
  // above it with room for the fingertip, centred on it.
  let left = touch ? x - w / 2 : x + 2;
  let top = touch ? y - hgt - 16 : y + 2;
  if (!touch && left + w > vw - m) left = x - w - 2;
  if (!touch && top + hgt > vh - m) top = y - hgt - 2;
  if (touch && top < m) top = y + 24;
  left = Math.max(m, Math.min(left, vw - m - w));
  top = Math.max(m, Math.min(top, vh - m - hgt));
  return { left: Math.round(left), top: Math.round(top) };
}

export function createContextMenu(d: ContextMenuDeps) {
  const el = h('div', { class: 'ctx-menu', role: 'menu', tabindex: '-1', hidden: true, dataset: { part: 'context-menu' } });
  // The clear layer that takes the next press outside the menu (see the header). Under the menu, over everything else.
  const catcher = h('div', { class: 'ctx-catch', hidden: true, 'aria-hidden': 'true' });
  let items: Array<{ item: MenuItem; btn: HTMLButtonElement }> = [];
  let at = -1;
  let open = false;
  let back: HTMLElement | null = null;
  // Opened at this time (performance.now): a long press opens it before the finger lifts, and the browser may then
  // fire a click / contextmenu for the same press on what is under the finger.
  let openedAt = 0;

  const enabled = () => items.map((x, i) => (x.item.disabled ? -1 : i)).filter((i) => i >= 0);
  const highlight = (i: number) => {
    at = i;
    items.forEach((x, j) => x.btn.classList.toggle('on', j === i));
    if (i >= 0) items[i]!.btn.focus({ preventScroll: true });
    else el.focus({ preventScroll: true });
  };
  const move = (dir: 1 | -1) => {
    const list = enabled();
    if (!list.length) return;
    const pos = list.indexOf(at);
    highlight(pos < 0 ? (dir > 0 ? list[0]! : list[list.length - 1]!) : list[(pos + dir + list.length) % list.length]!);
  };

  function show(entries: MenuEntry[], x: number, y: number, o: OpenOptions) {
    if (open) hide(false);
    back = document.activeElement instanceof HTMLElement && !el.contains(document.activeElement) ? document.activeElement : null;
    items = [];
    at = -1;
    el.replaceChildren();
    const phone = d.phone();
    for (const e of entries) {
      if ('sep' in e) {
        el.append(h('div', { class: 'ctx-sep', role: 'separator' }));
        continue;
      }
      const btn = h('button', { type: 'button', class: 'ctx-row', role: 'menuitem', tabindex: '-1', dataset: { action: `ctx-${e.id}` }, disabled: !!e.disabled, 'aria-disabled': e.disabled ? 'true' : undefined },
        h('span', { class: 'ctx-label', text: e.label }),
        !phone && e.key ? h('kbd', { class: 'ctx-key', text: e.key }) : null);
      const i = items.length;
      btn.addEventListener('pointerenter', (ev) => {
        if ((ev as PointerEvent).pointerType === 'mouse' && !e.disabled) highlight(i);
      });
      btn.addEventListener('click', () => {
        if (e.disabled) return;
        hide(false);
        e.run();
      });
      items.push({ item: e, btn });
      el.append(btn);
    }
    el.dataset.place = o.place;
    if (o.label) el.setAttribute('aria-label', o.label);
    else el.removeAttribute('aria-label');
    el.classList.toggle('touch', !!o.touch);
    // Measured hidden-but-laid-out, then placed: the menu's size depends on its words (two languages, two layouts).
    el.style.visibility = 'hidden';
    el.hidden = false;
    catcher.hidden = false;
    const r = el.getBoundingClientRect();
    const p = placeMenu(x, y, r.width, r.height, window.innerWidth, window.innerHeight, o.touch);
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    // It grows from the corner nearest the point (a menu that opened to the left grows to the left).
    el.style.transformOrigin = `${x < p.left + r.width / 2 ? 'left' : 'right'} ${y < p.top + r.height / 2 ? 'top' : 'bottom'}`;
    el.style.visibility = '';
    open = true;
    openedAt = performance.now();
    if (o.keyboard) move(1);
    else highlight(-1);
    d.changed?.(true, o.place);
  }

  /** Close. `restore`: give the focus back to where it was (Esc, Tab); a row's action decides the focus itself. */
  function hide(restore = true) {
    if (!open) return;
    open = false;
    el.hidden = true;
    catcher.hidden = true;
    items = [];
    at = -1;
    d.changed?.(false, null);
    if (restore && back?.isConnected) back.focus({ preventScroll: true });
    back = null;
  }

  // The keys go to the menu wherever the focus is while it is open (capture, on the page): the focus can be elsewhere —
  // a press on a row of the list put it there, or the test of 2026-10-18 found Esc with the focus on the page left the
  // menu standing and dropped the pick behind it instead.
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    // A modifier key alone is not an answer to the menu (⌘ before Z): wait for the key that comes with it.
    if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt') return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') move(k === 'ArrowDown' ? 1 : -1);
    else if (k === 'Home' || k === 'End') {
      const list = enabled();
      if (list.length) highlight(k === 'Home' ? list[0]! : list[list.length - 1]!);
    } else if (k === 'Enter' || k === ' ') {
      const x = items[at];
      if (x && !x.item.disabled) {
        hide(false);
        x.item.run();
      }
    } else if (k === 'Escape' || k === 'Tab') hide(true);
    else {
      // Any other key: the menu goes, the key goes on to the editor (window keydown in main.ts).
      hide(true);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // The press outside: close, and nothing else (no pick, no look-around: the layer is over the game frame too).
  const outside = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    hide(true);
  };
  catcher.addEventListener('pointerdown', outside);
  catcher.addEventListener('contextmenu', outside);
  catcher.addEventListener('wheel', outside, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', () => hide(false));
  window.addEventListener('blur', () => {
    // The focus going INTO the menu from the game frame blurs nothing here; leaving the window (another app) does.
    if (open && !document.hasFocus()) hide(false);
  });

  return {
    el,
    catcher,
    show,
    hide,
    isOpen: () => open,
    /** Opened less than `ms` ago (a long press: the same press's own click / contextmenu that follows). */
    justOpened: (ms = 700) => open && performance.now() - openedAt < ms,
  };
}
