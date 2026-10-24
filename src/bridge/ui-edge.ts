// A moved UI keeps to the nearest edge of the screen — the line while it is dragged, and for the HTML UI the place it is
// measured from (studio-canvas-ui-3, 2026-10-24; the canvas UI plan's decision 5; CONTRACT.md §1.13 "Edges").
//
// The answer to the plan's Q2 (2026-10-24) was (a): a moved UI is measured from the nearest of 9 places of the
// screen (the corners, the middles of the edges, the middle) when it is let go, so "top right" stays top right on a
// phone and on a wide screen. Stage 1 did it for the UI drawn in the canvas (codeUi: the loader places it by `from` /
// `at`). This file brings the same to the HTML UI:
//   - while one is dragged: the same dotted place it was, the thin line from the place it is measured from, and the
//     words "20 px from the top centre" (paintEdgeLine, shared with code-ui.ts so both look the same — 02-same.md);
//   - after every gesture (and ⌘Z): where each HTML element is measured from now and its numbers from there, to the
//     shell (studio:ui/edges) — the file's `from` / `at` next to its offset `p`. The loader still places an HTML element
//     by `p` until Save (what the person saw); on Save the AI rewrites its CSS `left` / `right` / `top` / `bottom` by
//     `from` / `at` (SKILL.md), so the element keeps to that edge on every window size.
// The HTML UI's screen is the game page's window (the iframe): its CSS px, top-left 0, 0.
import type { BridgeToShell, UiEdgeInfo } from '../contract.ts';
import { uiAtOf, uiNearest } from '../loader/studio-placement.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---- words of the 9 places (the editor's own words, drawn in the game page; the glossary's)
const PLACE: Record<'ja' | 'en', Record<string, string>> = {
  ja: { 'top-left': '左上', top: '上の真ん中', 'top-right': '右上', left: '左の真ん中', center: '真ん中', right: '右の真ん中', 'bottom-left': '左下', bottom: '下の真ん中', 'bottom-right': '右下' },
  // The glossary's words ("20 px from the top centre", "16 px · 24 px from the top right").
  en: { 'top-left': 'the top left', top: 'the top centre', 'top-right': 'the top right', left: 'the left centre', center: 'the centre', right: 'the right centre', 'bottom-left': 'the bottom left', bottom: 'the bottom centre', 'bottom-right': 'the bottom right' },
};
/** "20 px from the top centre" / "16 px · 24 px from the top right" (and the same in Japanese): a middle row / column says only the other number when it is 0. */
export function placeWords(from: string, at: [number, number], lang: 'ja' | 'en'): string {
  const [x, y] = [Math.round(at[0]), Math.round(at[1])];
  // The top / bottom middle: x is across from the middle (0 = in the middle, said by the place alone); left / right
  // middle: the same for y. A corner always has both.
  const words = (from === 'top' || from === 'bottom') && x === 0 ? `${y} px`
    : (from === 'left' || from === 'right') && y === 0 ? `${x} px`
    : from === 'center' && x === 0 && y === 0 ? '0 px'
    : `${x} px · ${y} px`;
  const place = PLACE[lang][from] ?? from;
  return lang === 'ja' ? `${place}から ${words}` : `${words} from ${place}`;
}

const NS = 'http://www.w3.org/2000/svg';

/**
 * The line and the words while one UI is dragged, and where it was (dotted). `frame` = the screen it is measured on
 * (viewport px: a canvas's rect, or the window for the HTML UI); `box` = where it is now; `was` = where it was when the
 * drag began; `from` / `at` = the nearest place and the numbers from it (in the words' units). null = take it away.
 */
export function paintEdgeLine(win: Window, holder: { el: SVGSVGElement | null }, o: { frame: Box; box: Box; was: Box; from: string; at: [number, number]; lang: 'ja' | 'en' } | null): void {
  const doc = win.document;
  if (!o) {
    holder.el?.remove();
    holder.el = null;
    return;
  }
  let line = holder.el;
  if (!line || !line.isConnected) {
    line = holder.el = doc.createElementNS(NS, 'svg') as SVGSVGElement;
    line.setAttribute('data-studio-ui-line', '');
    line.setAttribute('aria-hidden', 'true');
    line.setAttribute('style', 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;overflow:visible');
    (doc.body || doc.documentElement).appendChild(line);
  }
  const { frame: r, box: bb, was, from } = o;
  // The point of the screen it is measured from, and the box's point facing it.
  const [hz, v] = from === 'center' ? ['m', 'm'] : from === 'left' ? ['l', 'm'] : from === 'right' ? ['r', 'm'] : from === 'top' ? ['m', 't'] : from === 'bottom' ? ['m', 'b'] : [from.endsWith('left') ? 'l' : 'r', from.startsWith('top') ? 't' : 'b'];
  const ax = hz === 'l' ? r.x : hz === 'r' ? r.x + r.w : r.x + r.w / 2, ay = v === 't' ? r.y : v === 'b' ? r.y + r.h : r.y + r.h / 2;
  const bx = hz === 'l' ? bb.x : hz === 'r' ? bb.x + bb.w : bb.x + bb.w / 2, by = v === 't' ? bb.y : v === 'b' ? bb.y + bb.h : bb.y + bb.h / 2;
  const words = placeWords(from, o.at, o.lang);
  const accent = '#ff8a3d';
  const tw = Math.max(60, words.length * (o.lang === 'ja' ? 12 : 6.6) + 16);
  // Left of the box when there is room (the editor's card floats over the right of the game), else right of it; on the
  // box's middle line, under the line's end.
  const lx = bb.x - tw - 10 >= 4 ? bb.x - tw - 10 : Math.min(win.innerWidth - tw - 4, bb.x + bb.w + 10);
  const ly = Math.min(win.innerHeight - 24, Math.max(4, bb.y + bb.h / 2 - 10));
  line.innerHTML = `<rect x="${was.x}" y="${was.y}" width="${was.w}" height="${was.h}" rx="4" fill="none" stroke="${accent}" stroke-width="1.5" stroke-dasharray="5 4" opacity=".75"/>`
    + `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${accent}" stroke-width="1" stroke-dasharray="3 3"/>`
    + `<circle cx="${ax}" cy="${ay}" r="3" fill="${accent}"/>`
    + `<g transform="translate(${lx},${ly})"><rect width="${tw}" height="20" rx="5" fill="rgba(20,20,24,.92)" stroke="${accent}" stroke-width="1"/>`
    + `<text x="8" y="14" font-family="system-ui,-apple-system,'Hiragino Sans',sans-serif" font-size="11" fill="#ffd2b0"></text></g>`;
  line.querySelector('text')!.textContent = words;
  line.setAttribute('data-from', from);
  line.setAttribute('data-words', words);
}

/** Where a box on the HTML UI's screen (the window) is measured from now, and its numbers from there (CSS px, 0.1). */
export function edgeOf(box: Box, W: number, H: number): { from: string; at: [number, number] } {
  const from = uiNearest(box.x, box.y, box.w, box.h, W, H) as string;
  const at = uiAtOf(from, box.x, box.y, box.w, box.h, W, H) as [number, number];
  return { from, at: [Math.round(at[0] * 10) / 10, Math.round(at[1] * 10) / 10] };
}

export interface UiEdgesDeps {
  win: Window;
  post(msg: BridgeToShell): void;
  lang(): 'ja' | 'en';
  /** The HTML UI's keys listed now (not the canvas UI's: code-ui.ts measures those on their canvas). */
  keys(): string[];
  /** A key's box on screen (viewport px), or null. */
  box(key: string): Box | null;
}

/** The HTML UI's edges: the line while one is dragged, and the list for the shell after each gesture. */
export function createUiEdges(d: UiEdgesDeps) {
  const holder: { el: SVGSVGElement | null } = { el: null };
  const start = new Map<string, Box>();
  const last = new Map<string, Box>();
  let sig = '';
  // Measured right after a drag is let go, else every 30th frame (⌘Z, a resize): the list reads every element's box.
  let tick = 0;
  let held = false;
  const list = (): UiEdgeInfo[] => {
    const W = d.win.innerWidth, H = d.win.innerHeight;
    const out: UiEdgeInfo[] = [];
    for (const key of d.keys()) {
      const b = d.box(key);
      if (!b || !(b.w > 0 && b.h > 0)) continue;
      out.push({ key, ...edgeOf(b, W, H), box: [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.w * 10) / 10, Math.round(b.h * 10) / 10], frame: [W, H] });
    }
    return out;
  };
  return {
    /**
     * Every editor frame on the UI layer: the line for the one HTML element in hand; with none in hand, the list for
     * the shell when it changed (a drag let go, ⌘Z, the window resized).
     */
    frame(o: { on: boolean; inHand: string[] }) {
      const keys = o.on ? d.keys() : [];
      const hand = o.inHand.filter((k) => keys.includes(k));
      if (o.inHand.length) held = true;
      if (hand.length === 1) {
        const k = hand[0]!;
        const b = d.box(k);
        if (!start.has(k)) start.set(k, last.get(k) ?? b ?? { x: 0, y: 0, w: 0, h: 0 });
        if (b) paintEdgeLine(d.win, holder, { frame: { x: 0, y: 0, w: d.win.innerWidth, h: d.win.innerHeight }, box: b, was: start.get(k)!, ...edgeOf(b, d.win.innerWidth, d.win.innerHeight), lang: d.lang() });
        return;
      }
      paintEdgeLine(d.win, holder, null);
      start.clear();
      if (!o.on || o.inHand.length) return;
      if (!held && ++tick % 30 !== 1) return;
      held = false;
      const l = list();
      for (const e of l) last.set(e.key, { x: e.box[0], y: e.box[1], w: e.box[2], h: e.box[3] });
      const s = JSON.stringify(l);
      if (s === sig) return;
      sig = s;
      d.post({ type: 'studio:ui/edges', list: l });
    },
    /** Editing ended: the line goes; the list is said again when editing starts. */
    end() {
      paintEdgeLine(d.win, holder, null);
      start.clear();
      sig = '';
      tick = 0;
    },
  };
}
