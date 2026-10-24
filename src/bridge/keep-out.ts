// A rule layout's keep-out areas on the ground of the game page (studio-code-keepout, 2026-10-24; the plan's step 3,
// its pictures n4-box / n4-code). For the picked object's layout
// (studio:place/avoid from the shell, keep-out-wire.ts):
//
//   paint      every area that is on, in red hatching — the same for both kinds, told apart by the edge only: a box drawn
//              by hand has an orange edge, four corners to drag (size; Shift: height) and a middle to drag (place); a
//              code condition (codeAvoid) has a violet dashed edge — its `show` shape, else the ground tried with its own
//              `test` (keep-out-paint.ts) — and a ◇ on that edge when it has a knob and a shape (drag: the number that
//              brings the edge to the finger; studio:place/avoid-knob). A box that is off: its edge only, grey, dashed.
//   ×          where an object of the layout would go but has no place (skipped: every try was in an area) — on the row's
//              line, in red (the card says "1 of 12 has no place to go").
//   draw       "+ Draw a box" on: the next drag on the ground draws a box. While it grows, the layout is laid out again
//              with it (code-place.ts preview: the loader's own re-pick, so what the editor shows is what the game
//              will do) — the objects step out of it, where they stood before dashed with an arrow. Its end is one
//              studio:place/avoid-box with `out` (how many moved); Esc stops (studio:place/avoid-draw, or `cancel`).
//   inside     the layout's objects put by hand ("just this one") that stand in one of its areas: the card says so
//              (studio:place/avoid-inside) — never moved: the hand wins (the plan's decision 12).
// WHY its own listeners, made before input.ts attaches (editor.ts): a press on a corner, the middle, the ◇ — or any press
// while drawing — must not pick or drag what is under it (the same reason as timeline-path.ts / code-motion.ts).
// WHY a finger draws with ONE finger: two fingers stay the camera's (the plan's step 3, item 8). A second finger while
// drawing stops the box (Esc's way) and the gesture goes on to the camera.
// Space: the layout's root is taken to be the scene (as timeline-path.ts takes an object's parent): a layout inside a
// moved group draws its areas off by the group's offset.
import type { BridgeToShell, Lang, PlacementPlace, ShellToBridge, StudioAdapter } from '../contract.ts';
import { codeSpot, findByKey, knobValues } from '../loader/studio-placement.js';
import { addBox, inBox, nextBoxName, rowsOf, setBox, type AvoidRow, type Box } from '../shell/keep-out-model.ts';
import { findKnob, knobRange, knobText, unitText, type CodePlaceView } from './code-place.ts';
import { B, boundsOf, boxCorners, clipBounds, edgesOf, nearestOn, outlineOf, runsOf, sampleGrid, shapeOf, type Bounds, type Grid, type Shape } from './keep-out-paint.ts';

const YOU = '#ff6b1a';
const VIOLET = '#a78bfa';
// A little see-through: the hatching is drawn over the game (an overlay), so what stands in an area stays readable.
const RED = 'rgba(255, 69, 90, .5)';

type Win = Window & typeof globalThis;
type KnobDef = { v: number; label: string; unit: string; min?: number; max?: number; step?: number };
/** A layout as the loader keeps it (Symbol.for('game-studio.codePlaces')): plain fields only are read. */
interface Layout {
  id: string;
  knobs: Record<string, KnobDef>;
  avoid: string[];
  keys: string[];
  skipped: string[];
  spots?: Array<number[] | null>;
  home?: { root?: unknown; three?: boolean; opts?: { player?: unknown; level?: string | null } };
}
/** A keep-out condition as the loader keeps it (Symbol.for('game-studio.codeAvoids')). */
interface Cond {
  id: string;
  name: string;
  knobs: Record<string, KnobDef>;
  test: (p: number[], k: Record<string, number>, g: Record<string, unknown>) => unknown;
  show?: (k: Record<string, number>, g: Record<string, unknown>) => unknown;
}

// "Box 1" is the shell's place.boxName too (i18n.ts): the box being drawn is named here before the shell names it.
const WORDS: Record<Lang, { draw: string; drawTouch: string; corner: string; middle: string; knob: (l: string) => string; box: (n: number) => string }> = {
  en: { box: (n) => `Box ${n}`, draw: 'Drag on the ground to draw a box (Esc to stop)', drawTouch: 'Drag on the ground with one finger to draw a box',
    corner: 'Corner: drag to resize (the opposite corner stays) · Shift: height', middle: 'Drag to move the box', knob: (l) => `${l}: drag to change` },
  ja: { box: (n) => `四角 ${n}`, draw: '地面をドラッグして四角を描く（Esc でやめる）', drawTouch: '地面を 1 本指でドラッグして四角を描く',
    corner: '角：引いて大きさを変える（反対の角はそのまま）・Shift で高さ', middle: '引いて四角を動かす', knob: (l) => `${l}：引いて変える` },
};

const CSS = `
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483644; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.hit { pointer-events: auto; cursor: grab; fill: transparent; touch-action: none; }
.hit.on { cursor: grabbing; }
text { font: 700 11px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; fill: #fff; }
`;

export interface KeepOutViewDeps {
  win: Win;
  adapter(): StudioAdapter;
  post(m: BridgeToShell): void;
  lang(): Lang;
  markDirty(): void;
  /** The layouts' own view: laid out again with a box being drawn (its preview), its draft entries. */
  places: Pick<CodePlaceView, 'preview' | 'previewEnd'>;
}

export interface KeepOutView {
  handle(msg: ShellToBridge): void;
  /** Every editor frame: the areas follow the camera. */
  frame(): void;
  /** Draw nothing (editing ended, the layer switched). */
  clear(): void;
}

type Drag =
  | { kind: 'new'; id: number; a: number[]; box: Box | null; floor: number; height: number; x0: number; y0: number }
  | { kind: 'corner'; id: number; i: number; corner: number; start: Box; box: Box; up: boolean; y0: number; mpp: number }
  | { kind: 'middle'; id: number; i: number; start: Box; box: Box; grab: number[] }
  | { kind: 'knob'; id: number; code: string; knob: string; from: number; v: number; y: number };

export function createKeepOutView(d: KeepOutViewDeps): KeepOutView {
  const { win } = d;
  const doc = win.document;
  const host = doc.createElement('div');
  host.setAttribute('data-studio-ui', '');
  host.setAttribute('data-studio-keep-out', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const root = doc.createElement('div');
  root.className = 'root';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg') as SVGSVGElement;
  root.append(svg);
  shadow.append(style, root);
  let mounted = false;

  // The shell's: the layout shown, its draft entry, "+ Draw a box" on.
  let shown: { id: string; entry: PlacementPlace | null; draw: boolean } | null = null;
  let drag: Drag | null = null;
  // The shell's last message while a drag went on (applied when it ends: a ◇ dragged on a phone that the browser took
  // for a pan once left the picture stuck on the old areas).
  let pending: Extract<ShellToBridge, { type: 'studio:place/avoid' }> | null = null;
  // The mouse over the game while drawing (the hint follows it).
  let hover: [number, number] | null = null;
  let drawn = '';
  let insideSig = '';
  // A condition's tried ground, kept while its knobs and the part of the ground tried stay the same.
  const grids = new Map<string, Grid>();

  const layouts = (): Map<string, Layout> => {
    const m = (win as unknown as Record<symbol, unknown>)[Symbol.for('game-studio.codePlaces')];
    return m instanceof Map ? (m as Map<string, Layout>) : new Map();
  };
  const conds = (): Map<string, Cond> => {
    const m = (win as unknown as Record<symbol, unknown>)[Symbol.for('game-studio.codeAvoids')];
    return m instanceof Map ? (m as Map<string, Cond>) : new Map();
  };
  const dim = (): 2 | 3 => (d.adapter().dim === '3d' ? 3 : 2);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const r1 = (v: number) => Math.round(v * 10) / 10;

  /** g of a condition (the loader's: the player where the level starts, the level). */
  function gOf(p: Layout): Record<string, unknown> {
    const opts = p.home?.opts;
    let player: number[] | null = null;
    try {
      const o = opts?.player as { position?: { x: number; y: number; z?: number } } | number[] | undefined;
      if (Array.isArray(o) && o.every((v) => typeof v === 'number')) player = o.slice();
      else {
        const obj = (o && !Array.isArray(o) && o.position ? o : p.home?.root ? findByKey(p.home.root, 'player', !!p.home.three) : null) as { position?: { x: number; y: number; z?: number } } | null;
        if (obj?.position) player = p.home?.three ? [obj.position.x, obj.position.y, obj.position.z ?? 0] : [obj.position.x, obj.position.y];
      }
    } catch {
      player = null;
    }
    return { player, level: opts?.level ?? null };
  }

  /**
   * The ground under the layout (3D), where a box is drawn and a condition painted: the highest surface under its objects
   * (the lowest of those: adapter.rest), else the adapter's own ground (y 0, toGround's) — or their feet when they stand
   * below it. Worked out once per layout out (rest() casts rays: not every frame). 2D: none (0).
   * WHY not the objects' feet: things that float (crystals at 1.1 m) would get a box drawn in the air, off the road.
   */
  const floors = new Map<string, { sig: string; y: number }>();
  function floorOf(p: Layout): number {
    if (dim() === 2) return 0;
    const sig = JSON.stringify(p.spots ?? null);
    const known = floors.get(p.id);
    if (known && known.sig === sig) return known.y;
    const a = d.adapter();
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const below = p.keys.map((k) => a.rest?.(k, p.keys)?.below).filter(num);
    const feet = p.keys.map((k) => a.foot?.(k)?.[1]).filter(num);
    const y = below.length ? Math.min(...below) : feet.length && Math.min(...feet) < 0 ? Math.min(...feet) : 0;
    floors.set(p.id, { sig, y });
    return y;
  }
  /** A new box's height: up past the layout's highest object (at least 2 m), so it holds what it is drawn round. */
  function heightOf(p: Layout, floor: number): number {
    const ys = (p.spots ?? []).filter((q): q is number[] => !!q).map((q) => q[1]!);
    return Math.max(2, Math.ceil((ys.length ? Math.max(...ys) : floor) - floor + 1));
  }
  /** The height a condition is tried at: about where the layout's objects stand (a test may read y). */
  function spotY(p: Layout, floor: number): number {
    const ys = (p.spots ?? []).filter((q): q is number[] => !!q).map((q) => q[1]!);
    return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : floor;
  }

  /** The entry as drawn now: the shell's, with the box being drawn / dragged in it. */
  function entryNow(): PlacementPlace | null {
    if (!shown) return null;
    if (drag?.kind === 'new' && drag.box) return addBox(shown.entry, drag.box, nextBoxName(shown.entry, (WORDS[d.lang()] ?? WORDS.en).box));
    if ((drag?.kind === 'corner' || drag?.kind === 'middle')) return setBox(shown.entry, drag.i, drag.box);
    return shown.entry;
  }
  /** A condition's knob values: the file's over the code's, and the ◇'s while it is dragged. */
  function knobsOf(c: Cond, row: Extract<AvoidRow, { kind: 'code' }>): Record<string, number> {
    const k = knobValues(c.knobs, row.knobs) as Record<string, number>;
    return drag?.kind === 'knob' && drag.code === c.id ? { ...k, [drag.knob]: drag.v } : k;
  }
  function shapeFor(c: Cond, k: Record<string, number>, p: Layout): Shape | null {
    if (typeof c.show !== 'function') return null;
    try {
      return shapeOf(c.show(k, gOf(p)), dim());
    } catch {
      return null;
    }
  }

  /** The part of the ground on screen (3D: tried at nine points of the view; sky: none), or null. */
  function visible(floor: number): Bounds | null {
    const a = d.adapter();
    if (!a.toGround) return null;
    const pts: number[][] = [];
    for (const fx of [0, 0.5, 1]) for (const fy of [0.12, 0.5, 1]) {
      const q = a.toGround(fx * win.innerWidth, fy * win.innerHeight, floor);
      if (q) pts.push(q);
    }
    return pts.length >= 2 ? boundsOf(pts, dim(), 0) : null;
  }

  /** A condition without a shape: the ground near the layout and on screen, tried with its test (kept while the same). */
  function gridFor(c: Cond, k: Record<string, number>, p: Layout, floor: number): Grid | null {
    const n = dim();
    const spots = [...(p.spots ?? []).filter((q): q is number[] => !!q)];
    const near = boundsOf(spots, n, 0);
    if (!near) return null;
    const span = Math.max(near.a1 - near.a0, near.b1 - near.b0);
    const extra = n === 3 ? Math.max(8, span * 0.3) : Math.max(160, span * 0.3);
    const around = { a0: near.a0 - extra, a1: near.a1 + extra, b0: near.b0 - extra, b1: near.b1 + extra };
    const b = clipBounds(around, visible(floor));
    if (!b) return null;
    // Rounded outwards to whole steps of 2 m (2D 32 px): a camera that moves a little keeps the same grid.
    const q = n === 3 ? 2 : 32;
    const rb = { a0: Math.floor(b.a0 / q) * q, a1: Math.ceil(b.a1 / q) * q, b0: Math.floor(b.b0 / q) * q, b1: Math.ceil(b.b1 / q) * q };
    const y = spotY(p, floor);
    const sig = JSON.stringify([c.id, k, rb, r3(y)]);
    const known = grids.get(sig);
    if (known) return known;
    const g = gOf(p);
    const grid = sampleGrid((pt) => !!c.test(pt, k, g), rb, n === 3 ? 0.5 : 8, y, n);
    if (grids.size > 24) grids.clear();
    grids.set(sig, grid);
    return grid;
  }

  type Part =
    | { kind: 'fill'; pts: Array<[number, number]> }
    | { kind: 'edge'; pts: Array<[number, number]>; color: 'box' | 'code' | 'off'; close: boolean }
    | { kind: 'corner'; at: [number, number]; i: number; c: number; on: boolean }
    | { kind: 'middle'; at: [number, number]; i: number; on: boolean }
    | { kind: 'knob'; at: [number, number]; code: string; label: string; on: boolean }
    | { kind: 'tag'; at: [number, number]; text: string; color: 'box' | 'code' | 'hint' }
    | { kind: 'cross'; at: [number, number] };

  function parts(): Part[] {
    const a = d.adapter();
    const p = shown ? layouts().get(shown.id) : null;
    if (!shown || !p || !a.toScreen) return [];
    const n = dim();
    const scr = (w: number[]) => a.toScreen!(w);
    const floor = floorOf(p);
    const entry = entryNow();
    const out: Part[] = [];
    const fill = (w: number[][]) => {
      const s = w.map(scr);
      if (s.every(Boolean)) out.push({ kind: 'fill', pts: s as Array<[number, number]> });
      return s;
    };
    const rows = rowsOf(p.avoid, entry);
    for (const row of rows) {
      if (row.kind === 'box') {
        const box = n === 3 ? { p: [row.box.p[0]!, row.box.p[1] ?? floor, row.box.p[2]!], size: row.box.size } : row.box;
        const c = boxCorners(box, n);
        if (row.off) {
          const s = c.map(scr);
          if (s.every(Boolean)) out.push({ kind: 'edge', pts: s as Array<[number, number]>, color: 'off', close: true });
          continue;
        }
        const s = fill(c);
        if (!s.every(Boolean)) continue;
        out.push({ kind: 'edge', pts: s as Array<[number, number]>, color: 'box', close: true });
        const busy = drag && drag.kind !== 'knob' && drag.kind !== 'new' && drag.i === row.i;
        s.forEach((q, ci) => out.push({ kind: 'corner', at: q!, i: row.i, c: ci, on: !!busy && drag!.kind === 'corner' && (drag as { corner: number }).corner === ci }));
        const mid = scr(n === 3 ? [box.p[0]!, box.p[1]!, box.p[2]!] : box.p);
        if (mid) out.push({ kind: 'middle', at: mid, i: row.i, on: !!busy && drag!.kind === 'middle' });
        // Its name over its farthest corner (the plan's picture: "Box 1" in orange).
        const top = (s as Array<[number, number]>).reduce((m, q) => (q[1] < m[1] ? q : m));
        out.push({ kind: 'tag', at: [top[0], top[1] - 14], text: row.name ?? (WORDS[d.lang()] ?? WORDS.en).box(row.n), color: 'box' });
        continue;
      }
      if (row.off) continue;
      const c = conds().get(row.code);
      if (!c) continue;
      const k = knobsOf(c, row);
      const shape = shapeFor(c, k, p);
      if (shape) {
        const pts = outlineOf(shape, n, floor);
        const s = pts.map(scr);
        // A circle partly behind the camera: what is on screen, in pieces (a fill needs it whole).
        if (s.every(Boolean)) fill(pts);
        out.push({ kind: 'edge', pts: s.filter(Boolean) as Array<[number, number]>, color: 'code', close: s.every(Boolean) });
        const name = Object.keys(c.knobs)[0];
        // The ◇ at the right-most point of the edge that is on screen (a hand reaches it without crossing the area). WHY on
        // screen: a phone's camera close to an object showed the circle's right end past the window, and the ◇ with it.
        const m = 16;
        const vis = s.map((q, i) => [q, i] as const).filter(([q]) => q && q[0] > m && q[0] < win.innerWidth - m && q[1] > m && q[1] < win.innerHeight - m);
        if (name && vis.length) {
          const j = vis.reduce((b, x) => (x[0]![0] > b[0]![0] ? x : b))[1];
          const def = c.knobs[name]!;
          const u = unitText(d.lang(), def.unit);
          const dk = drag?.kind === 'knob' && drag.code === c.id ? drag : null;
          const label = dk ? `${def.label} ${knobText(dk.from, def.step)} → ${knobText(dk.v, def.step)}${u}` : `${def.label} ${knobText(k[name]!, def.step)}${u}`;
          out.push({ kind: 'knob', at: s[j]!, code: c.id, label, on: !!dk });
        }
        continue;
      }
      const grid = gridFor(c, k, p, floor);
      if (!grid) continue;
      const at = (A: number, Bv: number) => (n === 3 ? [A, floor, Bv] : [A, Bv]);
      const runs = runsOf(grid);
      for (const [iz, i0, i1] of runs) {
        const A0 = grid.a0 + i0 * grid.step, A1 = grid.a0 + i1 * grid.step, B0 = grid.b0 + iz * grid.step, B1 = B0 + grid.step;
        fill([at(A0, B0), at(A1, B0), at(A1, B1), at(A0, B1)]);
      }
      for (const [u, v] of edgesOf(grid)) {
        const s0 = scr(at(u[0], u[1])), s1 = scr(at(v[0], v[1]));
        if (s0 && s1) out.push({ kind: 'edge', pts: [s0, s1], color: 'code', close: false });
      }
      // Its name in the middle of what it paints (the plan's picture: "On the road" on the road).
      const mid = runs[Math.floor(runs.length / 2)];
      if (mid) {
        const [iz, i0, i1] = mid;
        const s = scr(at(grid.a0 + ((i0 + i1) / 2) * grid.step, grid.b0 + (iz + 0.5) * grid.step));
        if (s) out.push({ kind: 'tag', at: s, text: c.name, color: 'code' });
      }
    }
    // Where an object would go but has no place: a red × (its first try's place).
    const k = knobValues(p.knobs, entry?.knobs) as Record<string, number>;
    for (const key of p.skipped ?? []) {
      const i = Number(key.slice(p.id.length + 1)) - 1;
      const q = Number.isInteger(i) && i >= 0 ? (codeSpot(p.id, i, k) as number[] | null) : null;
      const s = q ? scr(n === 3 ? [q[0]!, floor, q[2]!] : q) : null;
      if (s) out.push({ kind: 'cross', at: s });
    }
    if (shown.draw && !drag) {
      const coarse = !!win.matchMedia?.('(pointer: coarse)').matches;
      const w = WORDS[d.lang()] ?? WORDS.en;
      out.push({ kind: 'tag', at: hover && !coarse ? [hover[0] + 14, hover[1] + 22] : [win.innerWidth / 2 - 120, 28], text: coarse ? w.drawTouch : w.draw, color: 'hint' });
    }
    return out;
  }

  function draw() {
    const ps = parts();
    const sig = JSON.stringify(ps);
    if (sig === drawn) return;
    drawn = sig;
    if (!ps.length) {
      svg.replaceChildren();
      return;
    }
    if (!mounted && doc.body) (doc.body.append(host), (mounted = true));
    svg.replaceChildren(defs());
    const coarse = !!win.matchMedia?.('(pointer: coarse)').matches;
    const w = WORDS[d.lang()] ?? WORDS.en;
    const path = (pts: Array<[number, number]>, close: boolean, stroke: string, width: number, dash?: string, fillWith = 'none') => {
      const el = doc.createElementNS(NS, 'path');
      el.setAttribute('d', pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('') + (close ? 'Z' : ''));
      el.setAttribute('fill', fillWith);
      el.setAttribute('stroke', stroke);
      el.setAttribute('stroke-width', String(width));
      el.setAttribute('stroke-linejoin', 'round');
      if (dash) el.setAttribute('stroke-dasharray', dash);
      svg.append(el);
      return el;
    };
    const hit = (at: [number, number], r: number, attr: string, val: string, tip: string, on: boolean) => {
      const c = doc.createElementNS(NS, 'circle');
      c.setAttribute('cx', at[0].toFixed(1));
      c.setAttribute('cy', at[1].toFixed(1));
      c.setAttribute('r', String(r));
      c.setAttribute('class', `hit${on ? ' on' : ''}`);
      c.setAttribute(attr, val);
      c.setAttribute('data-part', attr.replace('data-', ''));
      c.setAttribute('aria-label', tip);
      const t = doc.createElementNS(NS, 'title');
      t.textContent = tip;
      c.append(t);
      svg.append(c);
    };
    // Fills first (under every edge), then edges, then what is grabbed, then words.
    for (const x of ps) if (x.kind === 'fill') path(x.pts, true, 'none', 0, undefined, 'url(#ko-hatch)');
    for (const x of ps) {
      if (x.kind !== 'edge') continue;
      path(x.pts, x.close, 'rgba(0,0,0,.35)', 4);
      if (x.color === 'box') path(x.pts, x.close, YOU, 2);
      else if (x.color === 'code') path(x.pts, x.close, VIOLET, 1.8, '6 5');
      else path(x.pts, x.close, 'rgba(255,255,255,.55)', 1.4, '4 4');
    }
    for (const x of ps) {
      if (x.kind === 'cross') {
        const [cx, cy] = x.at;
        const d1: Array<[number, number]> = [[cx - 6, cy - 6], [cx + 6, cy + 6]], d2: Array<[number, number]> = [[cx + 6, cy - 6], [cx - 6, cy + 6]];
        for (const dd of [d1, d2]) (path(dd, false, 'rgba(0,0,0,.45)', 5), path(dd, false, '#ff453a', 2.4));
      } else if (x.kind === 'corner') {
        const s = x.on ? 6 : 5;
        const q = doc.createElementNS(NS, 'rect');
        q.setAttribute('x', (x.at[0] - s).toFixed(1));
        q.setAttribute('y', (x.at[1] - s).toFixed(1));
        q.setAttribute('width', String(2 * s));
        q.setAttribute('height', String(2 * s));
        q.setAttribute('rx', '1.5');
        q.setAttribute('fill', x.on ? YOU : '#fff');
        q.setAttribute('stroke', x.on ? '#fff' : YOU);
        q.setAttribute('stroke-width', '2');
        svg.append(q);
        hit(x.at, coarse ? 22 : 12, 'data-ko-corner', `${x.i}:${x.c}`, w.corner, x.on);
      } else if (x.kind === 'middle') {
        const c = doc.createElementNS(NS, 'circle');
        c.setAttribute('cx', x.at[0].toFixed(1));
        c.setAttribute('cy', x.at[1].toFixed(1));
        c.setAttribute('r', x.on ? '7.5' : '6.5');
        c.setAttribute('fill', x.on ? YOU : '#fff');
        c.setAttribute('stroke', x.on ? '#fff' : YOU);
        c.setAttribute('stroke-width', '2.5');
        svg.append(c);
        hit(x.at, coarse ? 22 : 14, 'data-ko-mid', String(x.i), w.middle, x.on);
      } else if (x.kind === 'knob') {
        const r = x.on ? 8 : 7;
        const dm = doc.createElementNS(NS, 'rect');
        dm.setAttribute('x', (x.at[0] - r).toFixed(1));
        dm.setAttribute('y', (x.at[1] - r).toFixed(1));
        dm.setAttribute('width', String(2 * r));
        dm.setAttribute('height', String(2 * r));
        dm.setAttribute('rx', '1.5');
        dm.setAttribute('transform', `rotate(45 ${x.at[0].toFixed(1)} ${x.at[1].toFixed(1)})`);
        dm.setAttribute('fill', x.on ? YOU : '#fff');
        dm.setAttribute('stroke', x.on ? '#fff' : VIOLET);
        dm.setAttribute('stroke-width', '2.5');
        svg.append(dm);
        tag([x.at[0] + 14, x.at[1] - 12], x.label, x.on ? YOU : 'rgba(20,20,26,.82)');
        hit(x.at, coarse ? 22 : 14, 'data-ko-knob', x.code, w.knob(x.label), x.on);
      }
    }
    for (const x of ps) if (x.kind === 'tag' && x.text) tag(x.at, x.text, x.color === 'box' ? YOU : x.color === 'hint' ? 'rgba(20,20,26,.88)' : 'rgba(20,20,26,.72)');
  }
  /** A small label: white words on a rounded tag (`at` = its left end, middle). */
  function tag(at: [number, number], text: string, bg: string) {
    const wd = 12 + [...text].reduce((s, ch) => s + (ch.charCodeAt(0) > 0x2e80 ? 11 : 6.4), 0);
    const r = doc.createElementNS(NS, 'rect');
    r.setAttribute('x', at[0].toFixed(1));
    r.setAttribute('y', (at[1] - 9).toFixed(1));
    r.setAttribute('width', wd.toFixed(1));
    r.setAttribute('height', '18');
    r.setAttribute('rx', '5');
    r.setAttribute('fill', bg);
    const tx = doc.createElementNS(NS, 'text');
    tx.setAttribute('x', (at[0] + 6).toFixed(1));
    tx.setAttribute('y', (at[1] + 4).toFixed(1));
    tx.textContent = text;
    svg.append(r, tx);
  }
  /** The red hatching (screen space, as the plan's pictures: the same for both kinds). */
  function defs() {
    const df = doc.createElementNS(NS, 'defs');
    const pt = doc.createElementNS(NS, 'pattern');
    pt.setAttribute('id', 'ko-hatch');
    pt.setAttribute('width', '8');
    pt.setAttribute('height', '8');
    pt.setAttribute('patternUnits', 'userSpaceOnUse');
    pt.setAttribute('patternTransform', 'rotate(45)');
    const bg = doc.createElementNS(NS, 'rect');
    bg.setAttribute('width', '8');
    bg.setAttribute('height', '8');
    bg.setAttribute('fill', 'rgba(255, 69, 90, .1)');
    const ln = doc.createElementNS(NS, 'line');
    ln.setAttribute('x1', '0');
    ln.setAttribute('y1', '0');
    ln.setAttribute('x2', '0');
    ln.setAttribute('y2', '8');
    ln.setAttribute('stroke', RED);
    ln.setAttribute('stroke-width', '2');
    pt.append(bg, ln);
    df.append(pt);
    return df;
  }

  /** The layout's objects put by hand that stand in one of its areas (on): to the shell when that changes. */
  function checkInside() {
    const p = shown ? layouts().get(shown.id) : null;
    const pins = shown?.entry?.pins ?? {};
    const keys: string[] = [];
    if (p && shown) {
      const n = dim();
      const g = gOf(p);
      const rows = rowsOf(p.avoid, shown.entry).filter((r) => !r.off);
      for (const [key, pin] of Object.entries(pins)) {
        if (!Array.isArray(pin.p) || !p.keys.includes(key)) continue;
        const q = pin.p;
        const hit = rows.some((r) => {
          if (r.kind === 'box') return inBox(q, r.box, n);
          const c = conds().get(r.code);
          if (!c) return false;
          try {
            return !!c.test(q, knobValues(c.knobs, r.knobs) as Record<string, number>, g);
          } catch {
            return false;
          }
        });
        if (hit) keys.push(key);
      }
    }
    const sig = shown ? JSON.stringify([shown.id, keys]) : '';
    if (sig === insideSig) return;
    insideSig = sig;
    if (shown) d.post({ type: 'studio:place/avoid-inside', id: shown.id, keys });
  }

  // ----- presses: draw a box, drag a corner / the middle / a ◇ -----
  const opts = { capture: true, passive: false } as AddEventListenerOptions;
  const take = (e: Event) => {
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  const ground = (e: PointerEvent, y: number) => d.adapter().toGround?.(e.clientX, e.clientY, y) ?? null;
  /** What a press is on: one of our corners, a box's middle, a ◇ — or nothing of ours. */
  const targetOf = (e: Event): { corner?: [number, number]; mid?: number; knob?: string } | null => {
    for (const t of e.composedPath()) {
      if (!(t instanceof Element) || !svg.contains(t)) continue;
      const c = t.getAttribute('data-ko-corner');
      if (c !== null) return { corner: [Number(c.split(':')[0]), Number(c.split(':')[1])] };
      const m = t.getAttribute('data-ko-mid');
      if (m !== null) return { mid: Number(m) };
      const k = t.getAttribute('data-ko-knob');
      if (k !== null) return { knob: k };
    }
    return null;
  };
  /** A press on the editor's own parts in the page (the strip, a path's point): not the ground. */
  const onEditorUi = (e: Event) => e.composedPath().some((t) => t instanceof Element && t !== host && t.hasAttribute('data-studio-ui'));

  const boxRow = (i: number) => {
    const a = shown?.entry?.avoid?.[i];
    return a && 'box' in a ? a.box : null;
  };

  const onDown = (e: PointerEvent) => {
    if (!shown || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // A second finger while drawing: the box stops, the camera takes the gesture (two fingers stay the camera's).
    if (drag && e.pointerId !== drag.id) {
      if (e.pointerType === 'touch') cancel();
      return;
    }
    const p = layouts().get(shown.id);
    if (!p) return;
    const n = dim();
    const tg = targetOf(e);
    if (tg?.corner) {
      const b = boxRow(tg.corner[0]);
      if (!b) return;
      take(e);
      const mid = n === 3 ? [b.p[0]!, b.p[1]!, b.p[2]!] : b.p;
      const s0 = d.adapter().toScreen?.(mid), s1 = n === 3 ? d.adapter().toScreen?.([mid[0]!, mid[1]! + 1, mid[2]!]) : null;
      const px = s0 && s1 ? Math.abs(s1[1] - s0[1]) : 0;
      drag = { kind: 'corner', id: e.pointerId, i: tg.corner[0], corner: tg.corner[1], start: structuredClone(b), box: structuredClone(b), up: false, y0: e.clientY, mpp: px > 0.5 ? 1 / px : 0.02 };
    } else if (tg?.mid !== undefined) {
      const b = boxRow(tg.mid);
      const at = b ? ground(e, n === 3 ? b.p[1]! : 0) : null;
      if (!b || !at) return;
      take(e);
      drag = { kind: 'middle', id: e.pointerId, i: tg.mid, start: structuredClone(b), box: structuredClone(b), grab: at };
    } else if (tg?.knob) {
      const c = conds().get(tg.knob);
      const name = c ? Object.keys(c.knobs)[0] : undefined;
      const row = rowsOf(p.avoid, shown.entry).find((r) => r.kind === 'code' && r.code === tg.knob) as Extract<AvoidRow, { kind: 'code' }> | undefined;
      if (!c || !name || !row) return;
      take(e);
      const v = (knobValues(c.knobs, row.knobs) as Record<string, number>)[name]!;
      drag = { kind: 'knob', id: e.pointerId, code: c.id, knob: name, from: v, v, y: floorOf(p) };
    } else if (shown.draw && !onEditorUi(e)) {
      const floor = floorOf(p);
      const at = ground(e, floor);
      if (!at) return;
      take(e);
      drag = { kind: 'new', id: e.pointerId, a: at, box: null, floor, height: heightOf(p, floor), x0: e.clientX, y0: e.clientY };
    } else return;
    // The pointer held by the host, which is never drawn again. WHY: a finger is tied to what it pressed (the browser's
    // implicit capture), and the corner / ◇ pressed is redrawn by the next frame — a removed element's moves and its
    // release reach no one, and on a phone the ◇ never turned and the drag never ended (found by the phone run, 10/24).
    try {
      host.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (the pointer already gone): the window's listeners still see the mouse */
    }
    drawn = '';
    d.markDirty();
  };

  /** The box from where the drag began to the finger (3D on the layout's ground; 2D in the stage's px). */
  function newBox(dr: Extract<Drag, { kind: 'new' }>, b: number[]): Box {
    if (dim() === 3) {
      const w = Math.max(0.2, Math.abs(b[0]! - dr.a[0]!)), dd = Math.max(0.2, Math.abs(b[2]! - dr.a[2]!));
      return { p: [r3((b[0]! + dr.a[0]!) / 2), r3(dr.floor), r3((b[2]! + dr.a[2]!) / 2)], size: [r3(w), dr.height, r3(dd)] };
    }
    return { p: [r1((b[0]! + dr.a[0]!) / 2), r1((b[1]! + dr.a[1]!) / 2)], size: [r1(Math.max(4, Math.abs(b[0]! - dr.a[0]!))), r1(Math.max(4, Math.abs(b[1]! - dr.a[1]!)))] };
  }

  function step(e: PointerEvent, end: boolean) {
    const dr = drag;
    if (!dr || !shown) return;
    const id = shown.id;
    const n = dim();
    if (dr.kind === 'knob') {
      const p = layouts().get(id), c = conds().get(dr.code);
      const want = ground(e, dr.y);
      if (p && c && want) {
        const def = c.knobs[dr.knob]!;
        const row = rowsOf(p.avoid, shown.entry).find((r) => r.kind === 'code' && r.code === dr.code) as Extract<AvoidRow, { kind: 'code' }> | undefined;
        const k0 = knobValues(c.knobs, row?.knobs) as Record<string, number>;
        const [lo, hi] = knobRange({ v: dr.from, min: def.min, max: def.max });
        const near = (x: number) => {
          const s = shapeFor(c, { ...k0, [dr.knob]: x }, p);
          return s ? nearestOn(outlineOf(s, n, dr.y), want, n) : null;
        };
        const v = findKnob(near, want, lo, hi, !!def.step && def.step >= 1);
        if (v !== null) {
          const q = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, (hi - lo) / 100))));
          dr.v = def.step && def.step >= 1 ? v : Math.round(v / q) * q;
        }
      }
      d.post({ type: 'studio:place/avoid-knob', id, code: dr.code, knob: dr.knob, v: dr.v, end });
      if (end) (drag = null), applyPending();
      drawn = '';
      d.markDirty();
      return;
    }
    if (dr.kind === 'new') {
      const b = ground(e, dr.floor);
      const far = Math.hypot(e.clientX - dr.x0, e.clientY - dr.y0) > 4;
      if (b && (far || dr.box)) dr.box = newBox(dr, b);
      // A press without a drag draws nothing (the button stays on: the next drag draws).
      if (!dr.box) {
        if (end) drag = null;
        return;
      }
    } else if (dr.kind === 'corner') {
      const start = dr.start;
      if (n === 3 && (dr.up || e.shiftKey)) {
        if (!dr.up) (dr.up = true), (dr.y0 = e.clientY);
        dr.box = { p: dr.box.p.slice(), size: [dr.box.size[0]!, Math.max(0.2, r3(start.size[1]! + (dr.y0 - e.clientY) * dr.mpp)), dr.box.size[2]!] };
      } else {
        const hit = ground(e, n === 3 ? start.p[1]! : 0);
        const opp = boxCorners(dr.box, n)[(dr.corner + 2) % 4]!;
        if (hit) {
          const bA = B(n);
          const min = n === 3 ? 0.2 : 4, rr = n === 3 ? r3 : r1;
          const w = Math.max(min, Math.abs(hit[0]! - opp[0]!)), dd = Math.max(min, Math.abs(hit[bA]! - opp[bA]!));
          const sx = Math.sign(hit[0]! - opp[0]!) || 1, sz = Math.sign(hit[bA]! - opp[bA]!) || 1;
          const mx = rr(opp[0]! + (sx * w) / 2), mz = rr(opp[bA]! + (sz * dd) / 2);
          dr.box = n === 3 ? { p: [mx, start.p[1]!, mz], size: [rr(w), dr.box.size[1]!, rr(dd)] } : { p: [mx, mz], size: [rr(w), rr(dd)] };
          // The corner now under the finger is the one held (a drag across the opposite corner flips the box).
          const cs = boxCorners(dr.box, n);
          dr.corner = cs.reduce((bi, q, i) => (Math.hypot(q[0]! - hit[0]!, q[bA]! - hit[bA]!) < Math.hypot(cs[bi]![0]! - hit[0]!, cs[bi]![bA]! - hit[bA]!) ? i : bi), 0);
        }
      }
    } else if (dr.kind === 'middle') {
      const hit = ground(e, n === 3 ? dr.start.p[1]! : 0);
      if (hit) {
        const rr = n === 3 ? r3 : r1;
        const p = dr.start.p.slice();
        p[0] = rr(p[0]! + hit[0]! - dr.grab[0]!);
        p[B(n)] = rr(p[B(n)]! + hit[B(n)]! - dr.grab[B(n)]!);
        dr.box = { p, size: dr.start.size.slice() };
      }
    }
    const box = dr.kind === 'new' ? dr.box! : dr.box;
    const i = dr.kind === 'new' ? -1 : dr.i;
    // The layout laid out again with the box as it is now: its objects step out (and back in when it shrinks).
    d.places.preview(id, entryNow());
    if (!end) d.post({ type: 'studio:place/avoid-box', id, i, p: box.p, size: box.size, end: false });
    else {
      const out = d.places.previewEnd();
      const next = entryNow();
      drag = null;
      shown = { ...shown, entry: next, draw: dr.kind === 'new' ? false : shown.draw };
      d.post({ type: 'studio:place/avoid-box', id, i, p: box.p, size: box.size, end: true, out });
      // What the shell said during the drag is older than this box: its answer to the end comes next.
      pending = null;
      checkInside();
    }
    drawn = '';
    d.markDirty();
  }

  /** Esc / a second finger / pointercancel: the drag is undone (the layout back as it was), nothing kept. */
  function cancel() {
    const dr = drag;
    if (!dr || !shown) return;
    drag = null;
    if (dr.kind === 'knob') d.post({ type: 'studio:place/avoid-knob', id: shown.id, code: dr.code, knob: dr.knob, v: dr.from, end: true });
    else {
      d.places.preview(shown.id, shown.entry);
      d.places.previewEnd();
      if (dr.kind !== 'new' || dr.box) {
        const b = dr.kind === 'new' ? dr.box! : dr.start;
        d.post({ type: 'studio:place/avoid-box', id: shown.id, i: dr.kind === 'new' ? -1 : dr.i, p: b.p, size: b.size, end: true, cancel: true });
      }
    }
    applyPending();
    drawn = '';
    d.markDirty();
  }

  /** The shell's message: what to show (the layout, its entry, "+ Draw a box"). */
  function apply(msg: Extract<ShellToBridge, { type: 'studio:place/avoid' }>) {
    shown = msg.id ? { id: msg.id, entry: msg.entry ? structuredClone(msg.entry) : null, draw: !!msg.draw } : null;
    if (!shown?.draw) hover = null;
    checkInside();
    drawn = '';
    d.markDirty();
  }
  function applyPending() {
    const m = pending;
    pending = null;
    if (m) apply(m);
  }

  const onMove = (e: PointerEvent) => {
    if (!drag) {
      if (shown?.draw && e.pointerType === 'mouse') {
        hover = [e.clientX, e.clientY];
        d.markDirty();
      }
      return;
    }
    if (e.pointerId !== drag.id) return;
    take(e);
    step(e, false);
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    take(e);
    if (e.type === 'pointercancel') cancel();
    else step(e, true);
  };
  // The drag's pointer taken away (the browser's own gesture, the page losing it): as Esc.
  const onLost = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) cancel();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !shown) return;
    if (drag) {
      take(e);
      cancel();
    } else if (shown.draw) {
      take(e);
      shown = { ...shown, draw: false };
      d.post({ type: 'studio:place/avoid-draw', id: shown.id, on: false });
      drawn = '';
      d.markDirty();
    }
  };
  win.addEventListener('pointerdown', onDown, opts);
  win.addEventListener('pointermove', onMove, opts);
  win.addEventListener('pointerup', onUp, opts);
  win.addEventListener('pointercancel', onUp, opts);
  win.addEventListener('lostpointercapture', onLost, opts);
  win.addEventListener('keydown', onKey, { capture: true });

  return {
    handle(msg) {
      if (msg.type !== 'studio:place/avoid') return;
      // While a box or a ◇ is dragged, ours is newer: kept for the drag's end (a box's end drops it: the shell answers).
      if (drag) return void (pending = msg);
      apply(msg);
    },
    frame: draw,
    clear() {
      if (drag) cancel();
      shown = null;
      hover = null;
      insideSig = '';
      draw();
    },
  };
}
