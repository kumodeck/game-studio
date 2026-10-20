// The built-in DOM UI port (UI stage 1, 2026-10-19): the game's HTML UI — a title card, a score, a button — as a
// Port2D, so the editor's UI layer moves and resizes it with the same handles, finger maths and undo as a 2D game.
//
// Only elements the game marked with data-studio-key="title-logo" are listed (never "every div": a page has
// hundreds, and the AI must find each one again in the code by that key). Left out: data-studio="false" (on the
// element or a parent), elements not drawn (display: none, not in the page), and elements the game itself gives an
// inline translate / scale (it moves them; the editor would fight it — the AI wraps them in a box, SKILL.md §5).
//
// Position and size go through the CSS `translate` / `scale` properties, never left / top / transform: a title
// centred with transform: translate(-50%, -50%) (Lantern Cove's .hint does this) stays centred, the game's layout is
// untouched, and taking the values away puts the element back exactly. The maths lives in the loader (placeUi):
// the editor and the game place the element the same way, to the pixel.
//
// Pose: p = [dx, dy] CSS px from where the game's CSS puts it, s = scale (1 = as drawn), r is always 0 (no turning
// UI in stage 1: rotatable false). parentToScreen maps that offset space to the screen: origin = where the middle
// of the element would be at offset 0, one offset px = k screen px (k = the zoom of the parent, e.g. a HUD scaled to
// fit the window).
import { placeUi, uiOffset } from '../../loader/studio-placement.js';

const KEY = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;
/** Scale bounds of a UI element: the same as placement.json `ui` (src/schema LIMITS.minUiScale / maxUiScale). */
const MIN_S = 0.1, MAX_S = 10;

/**
 * @param {Window} win the game page
 * @param {{ skip?: () => Set<string> }} [opts] keys another layer owns (the world's list: a DOM board game's pieces
 *   carry data-studio-key too, and they stay world objects)
 */
export function createUiPort(win, opts = {}) {
  const doc = win.document;
  const told = new Set();
  const all = (key) => Array.from(doc.querySelectorAll('[data-studio-key]')).filter((el) => el.dataset.studioKey === key);
  const first = (key) => all(key).find((el) => el.getClientRects().length) || null;
  const usable = (el) => {
    const key = el.dataset.studioKey;
    if (!KEY.test(key) || el.closest('[data-studio="false"]')) return false;
    if (!el.getClientRects().length) return false;
    // The game writes its own inline translate / scale here (and placeUi never touched it): leave it to the game.
    if ((el.style.translate || el.style.scale) && !placedBefore(el)) {
      if (!told.has(key)) {
        told.add(key);
        console.info(`[studio] UI "${key}" is moved by the game itself (inline translate / scale): not listed. Wrap it in a box and mark the box.`);
      }
      return false;
    }
    return true;
  };
  const placedBefore = (el) => el[Symbol.for('game-studio.ui')] !== undefined;
  const label = (el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return (t || el.getAttribute('aria-label') || el.getAttribute('alt') || el.dataset.studioKey).slice(0, 40);
  };
  const kind = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || el.getAttribute('role') === 'button' || (tag === 'input' && /^(button|submit|reset)$/.test(el.type))) return 'button';
    if (tag === 'img' || tag === 'svg' || tag === 'picture' || tag === 'canvas' || tag === 'video') return 'image';
    return 'text';
  };
  // CSS animations (a blinking "Press start") keep running while the game's frames are held: paused while editing,
  // played again at the end (only the ones this paused).
  let paused = [];

  return {
    name: 'dom-ui',
    objects() {
      const skip = opts.skip ? opts.skip() : null;
      const seen = new Set();
      const out = [];
      for (const el of Array.from(doc.querySelectorAll('[data-studio-key]'))) {
        const key = el.dataset.studioKey;
        if (seen.has(key) || (skip && skip.has(key)) || !usable(el)) continue;
        seen.add(key);
        out.push({ key, label: label(el), kinds: ['ui', kind(el)], rotatable: false });
      }
      return out;
    },
    get(key) {
      const el = first(key);
      if (!el) return null;
      const o = uiOffset(el);
      return { p: o.p, r: 0, s: o.s };
    },
    set(key, pose) {
      const raw = Array.isArray(pose.s) ? pose.s[0] : pose.s;
      const s = Math.min(MAX_S, Math.max(MIN_S, typeof raw === 'number' && Number.isFinite(raw) ? raw : uiOffset(first(key) || doc.body).s));
      const p = [Number(pose.p[0]) || 0, Number(pose.p[1]) || 0];
      for (const el of all(key)) placeUi(el, p, s);
    },
    parentToScreen(key) {
      const el = first(key);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const par = el.offsetParent || el.parentElement;
      let k = 1;
      if (par && par.offsetWidth) {
        const pr = par.getBoundingClientRect();
        k = pr.width / par.offsetWidth;
      }
      if (!Number.isFinite(k) || k <= 0) k = 1;
      const o = uiOffset(el);
      return [k, 0, 0, k, r.left + r.width / 2 - k * o.p[0], r.top + r.height / 2 - k * o.p[1]];
    },
    bounds(key) {
      const el = first(key);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    // The page draws a DOM change itself.
    render() {},
    // No canvas: the 2D base's canvas crop is skipped (the list shows a kind icon, not a thumbnail).
    canvas: () => null,
    capture: async () => null,
    pause() {
      try {
        paused = doc.getAnimations().filter((a) => a.playState === 'running');
        for (const a of paused) a.pause();
      } catch {
        paused = [];
      }
    },
    resume() {
      for (const a of paused) {
        try {
          a.play();
        } catch {
          /* gone with its element */
        }
      }
      paused = [];
    },
  };
}
