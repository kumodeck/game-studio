// A Library motion picked up and dropped on an object in the game = attached (studio-motion-flow, 2026-10-22).
//
// A hands-on try of v0.1.18 (2026-10-22): "I couldn't tell how to make a motion and then put it on objects." Attaching was a
// menu in the card ("Attach from the Library") or a menu in the motion's detail: neither said "this goes ON a thing".
// Now the motion's tile is held like an asset's: pick it up, the Library steps aside so the game shows, the object
// under the pointer lights and says "Attach “Hop” to barrel", let go = attached (then main.ts shows the Scene with
// "When does it move?" open). A phone: hold the tile (long press) to pick it up; the sheet slides away the same.
//
// WHY pointer events and not HTML drag-and-drop (the asset tiles' DRAG_FILE): the game is another page (an iframe).
// With drag-and-drop the editor page sees nothing while the pointer is over it, so it cannot ask "which object is
// here?". With pointer events the iframe is set to `pointer-events: none` while a motion is held (shell.css
// [data-drag="motion"]), the editor page keeps every move, and asks the game (studio:placement/at → at-is: the same
// test as a tap, bridge/input.ts keyAt). A touch hold works the same way, which drag-and-drop does not on phones.
//
// WHY the Library fades instead of closing: let go anywhere that is not an object (or Esc) = nothing changes, and the
// Library is there again exactly as it was (its scroll, its pick). Closing it would lose that for a cancelled drag.
import type { ShellToBridge } from '../contract.ts';
import { h } from './dom.ts';

export interface MotionDragDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  /** The editor's root (.shell): `data-drag="motion"` on it while a motion is held. */
  app: HTMLElement;
  /** The game's frame (null before it is up). */
  frame(): HTMLIFrameElement | null;
  send(m: ShellToBridge): void;
  /** An object a motion can go on (a world object of a 3D game, not the ground / sky): its name, else null. */
  target(key: string): string | null;
  /** Let go on `key`: attach `name` to it (main.ts then shows it with "When does it move?"). */
  drop(key: string, name: string): void;
  /** A motion can be held now (editing, the world, not playing). */
  can(): boolean;
}

/** A press that travels this far (mouse / pen) picks the tile up; less is a click (it opens the detail, as before). */
const LIFT_PX = 6;
/** A finger held this long without moving picks the tile up (a phone's long press; UI.longPressMs is the game's). */
const HOLD_MS = 420;
/** A finger that moves this far before HOLD_MS is scrolling the sheet: no pick up. */
const SCROLL_PX = 10;

export function createMotionDrag(d: MotionDragDeps) {
  // A press on a tile that may become a pick up.
  let press: { id: number; touch: boolean; x: number; y: number; tile: HTMLElement; name: string; timer: number } | null = null;
  // The motion in the hand.
  let held: { id: number; tile: HTMLElement; name: string; ghost: HTMLElement; tag: HTMLElement; line: HTMLElement; x: number; y: number } | null = null;
  // The last question to the game and its answer: `asked` = the id waited for, `want` = a point to ask next.
  let seq = 0;
  let asked = 0;
  let want: { x: number; y: number } | null = null;
  let target: string | null = null;
  let answered: (() => void) | null = null;
  // The click that ends a pick up must not open the tile's detail too.
  let eatClick = false;

  /** Ask the game which object is at this editor-page point (one question at a time: the newest point wins). */
  function ask(x: number, y: number) {
    const f = d.frame();
    const r = f?.getBoundingClientRect();
    if (!f || !r || x < r.left || y < r.top || x > r.right || y > r.bottom) {
      want = null;
      return setTarget(null);
    }
    if (asked) {
      want = { x, y };
      return;
    }
    asked = ++seq;
    d.send({ type: 'studio:placement/at', id: asked, x: x - r.left, y: y - r.top });
  }
  function setTarget(key: string | null) {
    const ok = key && d.target(key) !== null ? key : null;
    if (ok === target) return;
    target = ok;
    d.send({ type: 'studio:placement/hover', keys: ok ? [ok] : [] });
    if (!held) return;
    held.tag.hidden = !ok;
    held.tag.textContent = ok ? d.t('motion.drag.onto', { name: held.name, target: d.target(ok)! }) : '';
    held.ghost.classList.toggle('on', !!ok);
  }

  function lift(p: { id: number; tile: HTMLElement; name: string }, x: number, y: number) {
    const pic = p.tile.querySelector('svg')?.cloneNode(true) as SVGElement | undefined;
    const ghost = h('div', { class: 'motion-held', 'aria-hidden': 'true' }, ...(pic ? [pic] : []));
    const tag = h('div', { class: 'motion-held-tag', hidden: true, dataset: { part: 'motion-drag-tag' } });
    const line = h('div', { class: 'motion-held-line', role: 'status', dataset: { part: 'motion-drag-line' } },
      d.t('motion.drag.line', { name: p.name }), h('span', { class: 'muted', text: ` · ${d.t(press?.touch ? 'motion.drag.cancelTouch' : 'motion.drag.cancel')}` }));
    d.app.append(ghost, tag, line);
    held = { id: p.id, tile: p.tile, name: p.name, ghost, tag, line, x, y };
    d.app.dataset.drag = 'motion';
    try {
      p.tile.setPointerCapture(p.id);
    } catch {
      /* a pointer already gone: the window listeners still see the moves */
    }
    if (press?.touch) navigator.vibrate?.(8);
    press = null;
    move(x, y);
  }
  function move(x: number, y: number) {
    if (!held) return;
    held.x = x;
    held.y = y;
    held.ghost.style.transform = `translate(${x + 10}px, ${y + 10}px) rotate(-4deg)`;
    held.tag.style.transform = `translate(${x + 10}px, ${y - 40}px)`;
    ask(x, y);
  }
  function end(dropIt: boolean) {
    if (press) (clearTimeout(press.timer), (press = null));
    if (!held) return;
    const h0 = held;
    const finish = () => {
      const key = dropIt ? target : null;
      held = null;
      h0.ghost.remove();
      h0.tag.remove();
      h0.line.remove();
      delete d.app.dataset.drag;
      setTarget(null);
      asked = 0;
      want = null;
      answered = null;
      if (key) d.drop(key, h0.name);
    };
    // Let go while the game's answer for the last point is on its way: wait for it (a few frames at most).
    if (dropIt && asked) {
      answered = finish;
      window.setTimeout(() => answered === finish && finish(), 250);
    } else finish();
  }

  // Window listeners: they see a press's moves wherever the pointer goes (the tile is re-drawn under it sometimes).
  window.addEventListener('pointermove', (e) => {
    if (held && e.pointerId === held.id) return move(e.clientX, e.clientY);
    if (!press || e.pointerId !== press.id) return;
    const dist = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (press.touch) {
      if (dist > SCROLL_PX) (clearTimeout(press.timer), (press = null));
    } else if (dist > LIFT_PX) lift(press, e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', (e) => {
    if (held && e.pointerId === held.id) {
      eatClick = true;
      window.setTimeout(() => (eatClick = false), 0);
      end(true);
    } else if (press && e.pointerId === press.id) (clearTimeout(press.timer), (press = null));
  });
  window.addEventListener('pointercancel', (e) => {
    if ((held && e.pointerId === held.id) || (press && e.pointerId === press.id)) end(false);
  });
  window.addEventListener('keydown', (e) => {
    if (held && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      end(false);
    }
  }, true);
  // A finger holding a motion moves it; the sheet must not scroll under it (the first move after the long press is still
  // cancelable: nothing has scrolled yet).
  document.addEventListener('touchmove', (e) => {
    if (held) e.preventDefault();
  }, { passive: false });

  return {
    /** Make a Library motion's tile one that can be picked up. */
    bind(tile: HTMLElement, name: string) {
      tile.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || held || !d.can()) return;
        const touch = e.pointerType === 'touch';
        press = { id: e.pointerId, touch, x: e.clientX, y: e.clientY, tile, name, timer: 0 };
        if (touch) {
          const p = press;
          p.timer = window.setTimeout(() => press === p && lift(p, p.x, p.y), HOLD_MS);
        }
      });
      // A long press on a phone also asks for the page's own menu (copy image…): not over a motion.
      tile.addEventListener('contextmenu', (e) => {
        if (press?.touch || held) e.preventDefault();
      });
      tile.addEventListener('click', (e) => {
        if (!eatClick) return;
        e.stopImmediatePropagation();
        e.preventDefault();
      }, true);
    },
    /** The game's answer to placement/at. */
    answer(id: number, key: string | null) {
      if (id !== asked) return;
      asked = 0;
      setTarget(key);
      if (answered) return answered();
      if (want && held) {
        const w = want;
        want = null;
        ask(w.x, w.y);
      }
    },
    held: () => !!held,
    /** Tests: what is in the hand and what it is over. */
    state: () => ({ held: held?.name ?? null, target }),
  };
}

export type MotionDrag = ReturnType<typeof createMotionDrag>;
