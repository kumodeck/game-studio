// ◎ Mark — pointing at the paused frame for the AI (pause-ask stage 2, 2026-11-02). The goal (decided 2026-11-02): "stop
// the scene, tell the AI; the AI is best when it can judge what is going on both from the code and from the picture on
// screen, and fix it". "Here" and "this area" could only be said by selecting an object
// (= where an object is); an empty spot ("bring it in from here") could not be said at all.
//
// How it works:
//   - ◎ Mark in the moment's field (key N — M is the Move tool's, keymap.ts) turns marking on. While on, a layer over
//     the game takes the pointer: a click / tap = a point ①, a drag = an area ②. WHY a button and not "always": a drag
//     on the paused frame already looks around (placement.help), so marking has to be asked for.
//   - Each mark is a numbered pin on the frame and a chip in the field ("① here", "② area") with ×; ⌘Z takes the last
//     one away (main.ts shortcut). Numbers close up after a delete (① ② ③ − ② = ① ②): the AI reads the numbers in the
//     words the person types next, and those are typed against what is on screen.
//   - Each mark asks the game page what is under it (studio:moment/mark-at → mark-is: the object, the ground point,
//     the objects inside an area). The request carries the marks (MomentMark) and the frame with them drawn on it
//     (`shotMarked`, drawMarks below) — the AI sees "here" with its own eyes and has the numbers for the code.
//   - Marks are on the FRAME, not in the world: they stay where they were put on screen. The camera can be turned while
//     paused (a drag looks around); then the pins no longer sit on what they marked — the picture the AI gets is the
//     paused one, which they DO match. Kept simple on purpose (stage 2); a pin that follows the world would need the
//     game page to project every frame.
//   - Sent (walk 2 △16, decided 2026-11-06): the marks FOLD. The chips "① here ×" stayed in the field after the
//     request, and a first-time person could not tell whether their next words would carry the same mark again. Now
//     they go (and so do their pins), and one small chip "+ same mark" takes their place: pressed, they come back for the
//     next words ("no, a bit more to the left" about the same spot); a new mark instead starts again at ①. The words
//     sent and the marked picture already went with the request, so nothing the AI got is lost.
// Pure parts: test/moment-marks.test.ts. The screen: test/studio-pause.browser.mjs (moment, momentphone).
import type { MomentMark } from '../contract.ts';
import { h } from './dom.ts';

/** More than a few marks is a drawing, not "here" (HANDOFF_LIMITS.maxMarks). */
export const MARKS_MAX = 9;
/** A press that moves less than this (px) is a point, not an area (a hand on a trackpad wobbles a few px). */
export const MARK_DRAG_PX = 8;

/** ① … ⑨ (the field's chips and the pins say the same number). */
export function markNumber(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : String(n);
}

/**
 * A press from (x0, y0) to (x1, y1) on a frame w × h px → a mark's kind and its place in the picture, 0–1. A short
 * move = a point where it was PRESSED (the person aimed there; the wobble comes after). An area is ordered (top-left
 * first) and kept inside the frame.
 */
export function markFromPress(x0: number, y0: number, x1: number, y1: number, w: number, h: number): Pick<MomentMark, 'kind' | 'screen'> | null {
  if (!(w > 0 && h > 0)) return null;
  const c = (v: number, s: number) => Math.round(Math.min(1, Math.max(0, v / s)) * 1000) / 1000;
  if (Math.hypot(x1 - x0, y1 - y0) < MARK_DRAG_PX) return { kind: 'point', screen: [c(x0, w), c(y0, h)] };
  return { kind: 'area', screen: [c(Math.min(x0, x1), w), c(Math.min(y0, y1), h), c(Math.max(x0, x1), w), c(Math.max(y0, y1), h)] };
}

/** Numbers 1, 2, 3… in order (after a delete the rest close up). */
export function renumber(marks: MomentMark[]): MomentMark[] {
  return marks.map((m, i) => (m.n === i + 1 ? m : { ...m, n: i + 1 }));
}

/** The chip's words: "① here" for a point, "② area" for an area (`here` / `area` from i18n). */
export function markChip(m: MomentMark, words: { here: string; area: string }): string {
  return `${markNumber(m.n)} ${m.kind === 'point' ? words.here : words.area}`;
}

/** Where a pin / an area sits on the frame, in % of it (the layer is the game frame's size: they follow a resize). */
export function markBox(m: MomentMark): { left: number; top: number; width?: number; height?: number } {
  const p = (v: number) => Math.round(v * 10000) / 100;
  const [a = 0, b = 0, c = 0, d = 0] = m.screen;
  return m.kind === 'point' ? { left: p(a), top: p(b) } : { left: p(a), top: p(b), width: p(c - a), height: p(d - b) };
}

/**
 * The marks in the field and the ones folded by a send (walk 2 △16): `live` go with the next words (chips, pins),
 * `folded` wait behind "+ same mark". Pure, for the unit tests; createMomentMarks keeps one of these.
 */
export interface MarkSet {
  live: MomentMark[];
  folded: MomentMark[];
}
/** Sent: the live marks fold (an empty send keeps what was folded before). */
export function foldOnSend(m: MarkSet): MarkSet {
  return m.live.length ? { live: [], folded: m.live } : m;
}
/** "+ same mark": the folded marks back for the next words. */
export function unfoldMarks(m: MarkSet): MarkSet {
  return m.folded.length ? { live: m.folded, folded: [] } : m;
}
/** A new mark: the folded ones were the last words' — it starts again at ①. */
export function markAdded(m: MarkSet, mark: Pick<MomentMark, 'kind' | 'screen'>): MarkSet {
  return { live: [...m.live, { n: m.live.length + 1, ...mark }], folded: [] };
}

/** The marks' colour on the frame and in the marked picture: the pick's orange (the mock's pins; README pc-1). */
const MARK_COLOR = '#ff6a1a';

/**
 * Draw the marks on a 2D canvas of the frame (w × h): an area as a rounded dashed box, a point as a pin whose tip is
 * on the spot, each with its number. Used for `shotMarked` (the AI's copy) — the same look as the pins on screen.
 */
export function drawMarks(ctx: CanvasRenderingContext2D, w: number, h: number, marks: MomentMark[]): void {
  const s = Math.max(1, Math.min(w, h) / 500);
  ctx.save();
  ctx.lineWidth = 3 * s;
  for (const m of marks) {
    let px: number, py: number;
    if (m.kind === 'area') {
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = m.screen;
      ctx.strokeStyle = MARK_COLOR;
      ctx.setLineDash([8 * s, 5 * s]);
      ctx.strokeRect(x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
      ctx.setLineDash([]);
      px = x0 * w;
      py = y0 * h;
    } else {
      px = (m.screen[0] ?? 0) * w;
      py = (m.screen[1] ?? 0) * h;
      ctx.fillStyle = MARK_COLOR;
      ctx.beginPath();
      ctx.arc(px, py, 4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // The number in a disc just above-left of the spot (the area's corner), white on orange with a dark ring.
    const r = 11 * s;
    const cx = px;
    const cy = py - (m.kind === 'area' ? 0 : r + 6 * s);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = MARK_COLOR;
    ctx.fill();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.round(13 * s)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(m.n), cx, cy + 0.5 * s);
    ctx.lineWidth = 3 * s;
  }
  ctx.restore();
}

/** The frame (a data: URL) with the marks drawn on, as a JPEG data URL; null when it can't be made. Browser only. */
export async function markedShot(shot: string | undefined, marks: MomentMark[]): Promise<string | null> {
  if (!shot || !marks.length) return null;
  try {
    const img = new Image();
    img.src = shot;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx || !c.width || !c.height) return null;
    ctx.drawImage(img, 0, 0);
    drawMarks(ctx, c.width, c.height, marks);
    return c.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

export interface MarkProbe {
  key: string | null;
  world?: number[];
  keys?: string[];
}

export interface MomentMarksDeps {
  /** Ask the game page what is under a mark (px of the game page); resolves null when it doesn't answer in time. */
  probe(x: number, y: number, box?: [number, number, number, number]): Promise<MarkProbe | null>;
  /** The marks changed (render the field's chips, the button). */
  changed(): void;
  t(key: string, vars?: Record<string, string | number>): string;
}

export interface MomentMarks {
  /** The layer over the game (goes in the stage, over the frame, under the dock). */
  layer: HTMLElement;
  /** ◎ Mark, for the field. */
  button: HTMLButtonElement;
  /** The chips "① here ×", for the field (after the picture). */
  chips: HTMLElement;
  on(): boolean;
  set(on: boolean): void;
  list(): MomentMark[];
  /** Take the last mark away (⌘Z): true when there was one. */
  undo(): boolean;
  remove(n: number): void;
  /** All gone (the moment ended). */
  clear(): void;
  /**
   * The marks back on a frame that is the same moment (pause-ask stage 3: ▶ Try from 0:05.02 opened it again with the new
   * code — the person's ① still points where it did, so the next "no, here" can build on it). Mark mode stays off.
   */
  restore(list: MomentMark[], folded?: MomentMark[]): void;
  /** Sent (walk 2 △16): the marks fold to "+ same mark" — not on the frame, not in the next words, until pressed. */
  fold(): void;
  /** "+ same mark" pressed: the folded marks back, for the next words. */
  unfold(): void;
  /** The folded marks (for ▶ Try's reload, which keeps them folded). */
  folded(): MomentMark[];
  /** Words changed (a language switch): the button's and chips' text again. */
  render(): void;
}

export function createMomentMarks(d: MomentMarksDeps): MomentMarks {
  let marks: MomentMark[] = [];
  /** Folded by a send (walk 2 △16): "+ same mark" brings them back. Empty once marks are back or a new one is made. */
  let kept: MomentMark[] = [];
  let on = false;
  const hint = h('div', { class: 'mark-hint', dataset: { part: 'mark-hint' }, hidden: true });
  const pins = h('div', { class: 'mark-pins' });
  // While a drag is drawn: the area as it grows.
  const live = h('div', { class: 'mark-area live', hidden: true });
  const layer = h('div', { class: 'mark-layer', dataset: { part: 'mark-layer' }, hidden: true }, pins, live, hint);
  const button = h('button', { type: 'button', class: 'ask-mark', dataset: { action: 'moment-mark' }, 'aria-pressed': 'false' }) as HTMLButtonElement;
  const chips = h('span', { class: 'mark-chips', dataset: { part: 'mark-chips' }, hidden: true });
  button.addEventListener('click', () => api.set(!on));
  // A press on the button must not take the cursor out of the field the words go in.
  button.addEventListener('pointerdown', (e) => e.preventDefault());

  let press: { x: number; y: number; id: number } | null = null;
  const local = (e: PointerEvent) => {
    const r = layer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };
  layer.addEventListener('pointerdown', (e) => {
    if (!on || e.button > 0) return;
    e.preventDefault();
    const p = local(e);
    press = { x: p.x, y: p.y, id: e.pointerId };
    try {
      layer.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
  });
  layer.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = local(e);
    const m = markFromPress(press.x, press.y, p.x, p.y, p.w, p.h);
    live.hidden = !m || m.kind !== 'area';
    if (m && m.kind === 'area') Object.assign(live.style, pct(markBox({ n: 0, ...m })));
  });
  const end = (e: PointerEvent, keep: boolean) => {
    if (!press || e.pointerId !== press.id) return;
    const p = local(e);
    const from = press;
    press = null;
    live.hidden = true;
    if (!keep) return;
    const m = markFromPress(from.x, from.y, p.x, p.y, p.w, p.h);
    if (m) add(m, p.w, p.h);
  };
  layer.addEventListener('pointerup', (e) => end(e, true));
  layer.addEventListener('pointercancel', (e) => end(e, false));

  function add(m: Pick<MomentMark, 'kind' | 'screen'>, w: number, hgt: number) {
    if (marks.length >= MARKS_MAX) return;
    // A new mark after a send starts again at ①: the folded ones were the last words' (walk 2 △16).
    const next = markAdded({ live: marks, folded: kept }, m);
    const mark = next.live[next.live.length - 1]!;
    marks = next.live;
    kept = next.folded;
    render();
    d.changed();
    // What is under it: asked once, filled in when it comes (the request waits for nothing: a mark without it is fine).
    const s = m.screen;
    const x = (s[0] ?? 0) * w;
    const y = (s[1] ?? 0) * hgt;
    const box = m.kind === 'area' ? ([x, y, (s[2] ?? 0) * w, (s[3] ?? 0) * hgt] as [number, number, number, number]) : undefined;
    const cx = box ? (box[0] + box[2]) / 2 : x;
    const cy = box ? (box[1] + box[3]) / 2 : y;
    void d.probe(cx, cy, box).then((r) => {
      if (!r || !marks.includes(mark)) return;
      const i = marks.indexOf(mark);
      const next: MomentMark = { ...marks[i]! };
      if (r.key && m.kind === 'point') next.key = r.key;
      if (r.world && m.kind === 'point') next.world = r.world;
      if (r.keys?.length) next.keys = r.keys;
      marks = marks.map((x2, j) => (j === i ? next : x2));
    });
  }

  const pct = (b: { left: number; top: number; width?: number; height?: number }) => ({
    left: `${b.left}%`, top: `${b.top}%`, width: b.width === undefined ? '' : `${b.width}%`, height: b.height === undefined ? '' : `${b.height}%`,
  });
  const words = () => ({ here: d.t('mark.here'), area: d.t('mark.area') });

  function render() {
    // The layer shows while there are pins or marking is on; it takes the pointer only while marking (shell.css).
    layer.hidden = !on && !marks.length;
    layer.dataset.marking = on ? 'on' : 'off';
    hint.hidden = !on;
    hint.textContent = d.t(matchMedia?.('(pointer: coarse)').matches ? 'mark.hintTouch' : 'mark.hint');
    pins.replaceChildren(...marks.map((m) => {
      const el = h('div', { class: m.kind === 'area' ? 'mark-area' : 'mark-pin', dataset: { n: String(m.n) } }, h('b', { class: 'mark-n', text: String(m.n) }));
      Object.assign(el.style, pct(markBox(m)));
      return el;
    }));
    button.setAttribute('aria-pressed', String(on));
    button.title = d.t('mark.tip');
    button.setAttribute('aria-label', d.t('mark.tip'));
    button.replaceChildren(h('span', { class: 'ask-mark-ring', 'aria-hidden': 'true' }), h('span', { class: 'ask-mark-word', text: d.t('mark.btn') }));
    chips.hidden = !marks.length && !kept.length;
    if (!marks.length && kept.length) {
      chips.replaceChildren(h('button', { type: 'button', class: 'mark-again', dataset: { action: 'mark-again', part: 'mark-again' }, title: d.t('mark.againTip'),
        onpointerdown: (e: Event) => e.preventDefault(), onclick: () => api.unfold() }, d.t('mark.again', { n: kept.length })));
      return;
    }
    chips.replaceChildren(...marks.map((m) => h('span', { class: 'mark-chip', dataset: { part: 'mark-chip', n: String(m.n) } },
      h('span', { class: 'mark-chip-n', text: markNumber(m.n) }), h('span', { text: ` ${m.kind === 'point' ? words().here : words().area}` }),
      h('button', { type: 'button', class: 'mark-chip-x', dataset: { action: 'mark-remove' }, title: d.t('mark.remove'), 'aria-label': `${d.t('mark.remove')} ${markChip(m, words())}`,
        onpointerdown: (e: Event) => e.preventDefault(), onclick: () => api.remove(m.n) }, '×'))));
  }

  const api: MomentMarks = {
    layer, button, chips,
    on: () => on,
    set(v) {
      if (v === on) return;
      on = v;
      render();
      d.changed();
    },
    list: () => marks.slice(),
    undo() {
      if (!marks.length) return false;
      marks = marks.slice(0, -1);
      render();
      d.changed();
      return true;
    },
    remove(n) {
      const next = renumber(marks.filter((m) => m.n !== n));
      if (next.length === marks.length) return;
      marks = next;
      render();
      d.changed();
    },
    restore(list, folded = []) {
      marks = renumber(list.slice(0, MARKS_MAX).map((m) => ({ ...m })));
      kept = marks.length ? [] : renumber(folded.slice(0, MARKS_MAX).map((m) => ({ ...m })));
      render();
      d.changed();
    },
    fold() {
      on = false;
      ({ live: marks, folded: kept } = foldOnSend({ live: marks, folded: kept }));
      render();
      d.changed();
    },
    folded: () => kept.slice(),
    unfold() {
      if (!kept.length) return;
      ({ live: marks, folded: kept } = unfoldMarks({ live: marks, folded: kept }));
      render();
      d.changed();
    },
    clear() {
      if (!marks.length && !on && !kept.length) return;
      kept = [];
      marks = [];
      on = false;
      press = null;
      live.hidden = true;
      render();
      d.changed();
    },
    render,
  };
  render();
  return api;
}
