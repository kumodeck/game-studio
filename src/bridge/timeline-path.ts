// The timeline in the game page (studio-timeline, 2026-10-22; CONTRACT.md §1.9): the poses the shell works out for the time line, and the picked object's
// path in 3D — Blender's motion path, Unity's trajectory.
//
// timeline/pose: each object put where the shell says (its place + its clip at the time line), through the copy/delete
//   layer (no game rules, no snapping: a grid snap would make a motion jump) and reported to nobody: a preview is not
//   an edit (input.ts still reads the object where it shows, so a drag starts from what the person sees).
// timeline/path: the curve through the position keys — the same curve the object follows (the loader's trackAt, with
//   the keys' eases), sampled and projected every frame, so it is a line in the 3D scene, not on the screen. Under it:
//   a faint copy of the curve at the object's resting height, and from each key a dashed line straight down to it (a
//   small shadow where it lands), so how high a point is reads from any side. A white dot with an orange ring on each
//   key (a picked one is filled orange), its time beside it, a small orange ring where the time line is.
// Dragging a dot: across the ground at its own height (adapter.toGround), or with Shift up and down (the ↑↓ tool's
//   job, here on the dot: px → metres measured at the dot). Live to the shell (timeline/point), one undo step there.
//
// WHY DOM in a shadow root, as handles.ts: the same look and hit in every engine, out of reach of the game's CSS.
// WHY the press is taken here before input.ts sees it: this file's window listeners are added when the editor is made,
// before input.ts attaches its own (capture listeners on one target run in the order they were added), so a press on
// a dot never selects or drags what is under it; any other press goes on to input.ts untouched.
// (This replaces motion.ts of motion-gui, the same day: its flat dotted path on the ground and its ▶ for one object.)
//
// studio-timeline-2 (2026-10-22): the path's shape by hand.
//   - A picked point shows its two handles (a small square on a thin line; handlesOf = the loader's own, so a handle
//     never seen before sits where the smooth curve already goes). Drag = timeline/handle (the other side lines up,
//     Alt: only this one; Shift: up / down). Only picked points: handles on every point would bury the path.
//   - A corner point (both handles 0) is drawn as a diamond; a double-click on a point makes / unmakes one
//     (timeline/corner).
//   - Over the path's line a dashed "+" follows the pointer with its time; a click there = timeline/insert (a key at
//     that moment). The line's hit is a wide transparent stroke under the dots, so the dots still win.
//   - The area's four floor corners are handles too: drag = its size from the opposite corner (Shift: its height).
// Positions: the place and the keys are the object's PARENT space; toScreen / toGround speak the scene's. They agree
// for objects at the top of the scene (every starter's); an object inside a moved group draws its path off by the
// group's offset (stage 2).
import type { BridgeToShell, Lang, MotionArea, MotionKey, Pose, ShellToBridge, StudioAdapter } from '../contract.ts';
import { handlesOf, trackAt } from '../loader/studio-placement.js';

const YOU = '#ff6b1a';
const WORDS: Record<Lang, { point: (t: string) => string; area: string; handle: string; corner: string; line: (t: string) => string }> = {
  en: { point: (t) => `Key at ${t} s: drag to move it, Shift+drag for up and down · double-click: corner`, area: 'The area: drag to move it, Shift+drag for up and down',
    handle: 'Handle: drag to bend the path · Alt: this side only · Shift: up / down', corner: 'Corner: drag to resize (the opposite corner stays) · Shift: height',
    line: (t) => `Click to add a key at ${t} s` },
  ja: { point: (t) => `${t} 秒のキー：引いて動かす・Shift で上下・ダブルクリックで角`, area: '範囲：引いて動かす・Shift で上下',
    handle: '取っ手：引いて道を曲げる・Alt で片側だけ・Shift で上下', corner: '隅：引いて大きさを変える（反対の隅はそのまま）・Shift で高さ',
    line: (t) => `押すと ${t} 秒にキー` },
};

const CSS = `
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.hit { pointer-events: auto; cursor: grab; fill: transparent; }
.hit.on { cursor: grabbing; }
.line { pointer-events: stroke; cursor: copy; fill: none; stroke: transparent; }
text { font: 600 11px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; fill: #fff; paint-order: stroke; stroke: rgba(0,0,0,.5); stroke-width: 3px; }
`;

export interface TimelineViewDeps {
  win: Window & typeof globalThis;
  /** The current layer's adapter as the editor drives it (toScreen / toGround). */
  adapter(): StudioAdapter;
  /** The copy/delete layer of that adapter (the poses go through it: no game rules, no snapping). */
  poser(): StudioAdapter;
  post(m: BridgeToShell): void;
  lang(): Lang;
  markDirty(): void;
}

export interface TimelineView {
  handle(msg: ShellToBridge): void;
  /** Every editor frame: the path follows the camera. */
  frame(): void;
  /** Draw nothing (editing ended, the layer switched). */
  clear(): void;
}

type Shown = { key: string; base: number[]; keys: MotionKey[]; now: number[] | null; sel: number[] };

export function createTimelineView(d: TimelineViewDeps): TimelineView {
  const { win } = d;
  const doc = win.document;
  const host = doc.createElement('div');
  host.setAttribute('data-studio-ui', '');
  host.setAttribute('data-studio-timeline', '');
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
  const mount = () => {
    if (!mounted && doc.body) (doc.body.append(host), (mounted = true));
  };

  let shown: Shown | null = null;
  // The picked clip's area (studio-motion-triggers): a box in world space; its middle is a dot to drag (i = -1).
  let area: { key: string; a: MotionArea; label: string } | null = null;
  // A drag: a point (i ≥ 0), the area's middle (i = -1), a handle (`side`), an area corner (`corner` 0–3), or a press on
  // the line (`line`: a key there if it ends without moving). `moved` = past 3 px (a press that never moved posts nothing).
  let drag: { i: number; id: number; h: number; up: boolean; y0: number; mpp: number; start: number[]; side?: 'in' | 'out'; corner?: number; line?: number;
    x0: number; yy0: number; moved: boolean; floor?: number; size0?: number[] } | null = null;
  let drawn = '';
  // The "+" on the line under the pointer (its screen point and the clip's time there), and the line's samples.
  let ghost: { p: [number, number]; t: number } | null = null;
  let samples: Array<{ p: [number, number] | null; t: number }> = [];
  // The last press released on a point without moving (a second one soon after on the same point = a double-click).
  let lastUp: { i: number; at: number } | null = null;

  /** The curve's points in the scene: `samples` per span between keys (the loader's own maths). */
  const curve = (s: Shown, n = 20): Array<{ w: number[]; t: number }> => {
    const ks = s.keys;
    if (ks.length < 2) return ks.map((k) => ({ w: k.v.map((v, i) => v + (s.base[i] ?? 0)), t: k.t }));
    const out: Array<{ w: number[]; t: number }> = [];
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i]!.t, b = ks[i + 1]!.t;
      for (let j = 0; j < n; j++) {
        const t = a + ((b - a) * j) / n;
        const v = trackAt(ks, t, true) as number[] | null;
        if (v) out.push({ w: v.map((x, k) => x + (s.base[k] ?? 0)), t });
      }
    }
    const last = ks[ks.length - 1]!;
    out.push({ w: last.v.map((v, k) => v + (s.base[k] ?? 0)), t: last.t });
    return out;
  };
  /** A key's point in the scene, and its handle `side` (null at an end). */
  const keyW = (s: Shown, i: number) => s.keys[i]!.v.map((v, j) => v + (s.base[j] ?? 0));
  const handleW = (s: Shown, i: number, side: 'in' | 'out') => {
    const h = (handlesOf(s.keys, i) as { in: number[] | null; out: number[] | null })[side];
    return h ? keyW(s, i).map((v, j) => v + (h[j] ?? 0)) : null;
  };
  const isCorner = (k: MotionKey) => !!(k.in || k.out) && [k.in, k.out].every((h) => !h || Math.hypot(...h) < 1e-9);

  const draw = () => {
    const a = d.adapter();
    const s = shown;
    const hasPath = !!s && !!s.keys.length && !!a.toScreen && s.base.length === 3;
    const hasArea = !!area && !!a.toScreen && area.a.p.length === 3;
    if (!hasPath && !hasArea) {
      if (svg.firstChild) svg.replaceChildren();
      drawn = '';
      return;
    }
    const scr = (w: number[]) => a.toScreen!(w);
    if (!hasPath) {
      const sig = JSON.stringify([areaSig(scr), drag?.i ?? 0]);
      if (sig === drawn) return;
      drawn = sig;
      mount();
      svg.replaceChildren();
      drawArea(scr);
      return;
    }
    if (!s) return;
    const pts = curve(s);
    const ground = (w: number[]) => [w[0]!, s.base[1]!, w[2]!];
    const line = pts.map((q) => scr(q.w));
    samples = pts.map((q, i) => ({ p: line[i]!, t: q.t }));
    const shadowLine = pts.map((q) => scr(ground(q.w)));
    const keysW = s.keys.map((k) => k.v.map((v, i) => v + (s.base[i] ?? 0)));
    const keysS = keysW.map(scr);
    const dropS = keysW.map((w) => scr(ground(w)));
    const nowS = s.now ? scr(s.now.map((v, i) => v + (s.base[i] ?? 0))) : null;
    const hand = s.sel.flatMap((i) => (['in', 'out'] as const).map((side) => {
      const w = s.keys[i] ? handleW(s, i, side) : null;
      return w ? { i, side, p: scr(w) } : null;
    })).filter((x): x is { i: number; side: 'in' | 'out'; p: [number, number] | null } => !!x);
    const sig = JSON.stringify([line, keysS, nowS, s.sel, drag?.i ?? -1, drag?.side ?? '', drag?.corner ?? -1, d.lang(), hasArea ? areaSig(scr) : null, hand, ghost, s.keys.map(isCorner)]);
    if (sig === drawn) return;
    drawn = sig;
    mount();
    svg.replaceChildren();
    const pathD = (ps: Array<[number, number] | null>) => {
      let out = '';
      let pen = false;
      for (const p of ps) {
        if (!p) {
          pen = false;
          continue;
        }
        out += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
        pen = true;
      }
      return out;
    };
    const stroke = (dd: string, color: string, width: number, dash?: string) => {
      const el = doc.createElementNS(NS, 'path');
      el.setAttribute('d', dd);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(width));
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      if (dash) el.setAttribute('stroke-dasharray', dash);
      svg.append(el);
    };
    const circle = (p: [number, number], r: number, fill: string, ring?: string, width = 2.5) => {
      const c = doc.createElementNS(NS, 'circle');
      c.setAttribute('cx', p[0].toFixed(1));
      c.setAttribute('cy', p[1].toFixed(1));
      c.setAttribute('r', String(r));
      c.setAttribute('fill', fill);
      if (ring) (c.setAttribute('stroke', ring), c.setAttribute('stroke-width', String(width)));
      svg.append(c);
      return c;
    };
    // Underneath: the curve's shadow at the resting height, and each key's drop to it.
    stroke(pathD(shadowLine), 'rgba(0,0,0,.3)', 1.6, '2 5');
    keysS.forEach((p, i) => {
      const g = dropS[i];
      if (!p || !g || Math.hypot(p[0] - g[0], p[1] - g[1]) < 2) return;
      stroke(`M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${g[0].toFixed(1)} ${g[1].toFixed(1)}`, 'rgba(255,255,255,.8)', 1.2, '3 3');
      const e = doc.createElementNS(NS, 'ellipse');
      e.setAttribute('cx', g[0].toFixed(1));
      e.setAttribute('cy', g[1].toFixed(1));
      e.setAttribute('rx', '6');
      e.setAttribute('ry', '2.5');
      e.setAttribute('fill', 'rgba(0,0,0,.3)');
      svg.append(e);
    });
    // The path: a dark halo under an orange line (readable on any colour, as the outline's halo is).
    const dd = pathD(line);
    stroke(dd, 'rgba(0,0,0,.28)', 6);
    stroke(dd, YOU, 2.5);
    const coarse = win.matchMedia?.('(pointer: coarse)').matches;
    // The line's own hit (under the dots): a press here puts a key at that moment (studio-timeline-2).
    if (s.keys.length > 1) {
      const lh = doc.createElementNS(NS, 'path');
      lh.setAttribute('d', dd);
      lh.setAttribute('class', 'line');
      lh.setAttribute('stroke-width', coarse ? '24' : '14');
      lh.setAttribute('data-line', '');
      svg.append(lh);
    }
    if (ghost && !drag) {
      const g = circle(ghost.p, 7, 'rgba(255,255,255,.55)', '#fff', 2);
      g.setAttribute('stroke-dasharray', '3 2');
      g.setAttribute('pointer-events', 'none');
      const plus = doc.createElementNS(NS, 'text');
      plus.setAttribute('x', (ghost.p[0] - 3.5).toFixed(1));
      plus.setAttribute('y', (ghost.p[1] + 4).toFixed(1));
      plus.textContent = '+';
      const tl = doc.createElementNS(NS, 'text');
      tl.setAttribute('x', (ghost.p[0] + 12).toFixed(1));
      tl.setAttribute('y', (ghost.p[1] + 16).toFixed(1));
      tl.textContent = `+ ${ghost.t.toFixed(1)}s`;
      svg.append(plus, tl);
    }
    keysS.forEach((p, i) => {
      if (!p) return;
      const on = s.sel.includes(i) || drag?.i === i;
      // A corner (both handles 0): a diamond, so its shape reads from the mark itself.
      if (isCorner(s.keys[i]!)) {
        const r = on ? 7.5 : 6.5;
        const dm = doc.createElementNS(NS, 'rect');
        dm.setAttribute('x', (p[0] - r).toFixed(1));
        dm.setAttribute('y', (p[1] - r).toFixed(1));
        dm.setAttribute('width', String(2 * r));
        dm.setAttribute('height', String(2 * r));
        dm.setAttribute('rx', '1.5');
        dm.setAttribute('transform', `rotate(45 ${p[0].toFixed(1)} ${p[1].toFixed(1)})`);
        dm.setAttribute('fill', on ? YOU : '#fff');
        dm.setAttribute('stroke', on ? '#fff' : YOU);
        dm.setAttribute('stroke-width', '2.5');
        dm.setAttribute('data-corner-point', String(i));
        svg.append(dm);
      } else circle(p, on ? 8.5 : 7, on ? YOU : '#fff', on ? '#fff' : YOU);
      const t = s.keys[i]!.t;
      const label = doc.createElementNS(NS, 'text');
      label.setAttribute('x', (p[0] + 12).toFixed(1));
      label.setAttribute('y', (p[1] - 9).toFixed(1));
      label.textContent = `${t.toFixed(1)}s`;
      svg.append(label);
      // The hit area is bigger than the dot: 32 px across with a mouse, 44 with a finger.
      const hit = circle(p, coarse ? 22 : 16, 'transparent');
      hit.setAttribute('class', `hit${drag?.i === i ? ' on' : ''}`);
      hit.setAttribute('data-point', String(i));
      hit.setAttribute('role', 'button');
      hit.setAttribute('aria-label', WORDS[d.lang()].point(t.toFixed(1)));
      const tip = doc.createElementNS(NS, 'title');
      tip.textContent = WORDS[d.lang()].point(t.toFixed(1));
      hit.append(tip);
    });
    if (nowS) circle(nowS, 5, 'none', YOU, 2);
    // The picked points' handles, on top of everything (they are what a press there means).
    for (const x of hand) {
      const k = keysS[x.i];
      // A handle on its point (a corner's, or one seen end-on) is not drawn: it would cover the point's own press
      // (a double-click there makes the corner smooth again; Point ▾ does too).
      if (!x.p || !k || Math.hypot(x.p[0] - k[0], x.p[1] - k[1]) < 10) continue;
      stroke(`M${k[0].toFixed(1)} ${k[1].toFixed(1)}L${x.p[0].toFixed(1)} ${x.p[1].toFixed(1)}`, 'rgba(255,255,255,.95)', 1.4);
      const on = drag?.i === x.i && drag.side === x.side;
      square(x.p, on ? 6 : 5, on ? YOU : '#fff', on ? '#fff' : YOU);
      const hit = circle(x.p, coarse ? 22 : 12, 'transparent');
      hit.setAttribute('class', `hit${on ? ' on' : ''}`);
      hit.setAttribute('data-handle', `${x.i}:${x.side}`);
      hit.setAttribute('data-part', 'tl-handle');
      hit.setAttribute('aria-label', WORDS[d.lang()].handle);
      const tip = doc.createElementNS(NS, 'title');
      tip.textContent = WORDS[d.lang()].handle;
      hit.append(tip);
    }
    if (hasArea) drawArea(scr);
  };
  /** A small square (a handle, an area corner): `r` = half its side. */
  function square(p: [number, number], r: number, fill: string, ring: string) {
    const q = doc.createElementNS(NS, 'rect');
    q.setAttribute('x', (p[0] - r).toFixed(1));
    q.setAttribute('y', (p[1] - r).toFixed(1));
    q.setAttribute('width', String(2 * r));
    q.setAttribute('height', String(2 * r));
    q.setAttribute('rx', '1.5');
    q.setAttribute('fill', fill);
    q.setAttribute('stroke', ring);
    q.setAttribute('stroke-width', '2');
    svg.append(q);
    return q;
  }

  /** The area's 8 corners in the scene (bottom 4, then top 4). */
  const corners = (b: MotionArea) => {
    const [x, y, z] = b.p as [number, number, number];
    const [w, h, dd] = b.size.map((v) => v / 2) as [number, number, number];
    return [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]].map(([i, j, k]) => [x + i! * w, y + j! * h, z + k! * dd]);
  };
  const areaSig = (scr: (w: number[]) => [number, number] | null) => (area ? [corners(area.a).map(scr), scr(area.a.p), area.label] : null);
  /** The box: dashed white edges, an orange floor, a white dot with an orange ring in its middle (dragged like a key's dot). */
  function drawArea(scr: (w: number[]) => [number, number] | null) {
    if (!area) return;
    const c = corners(area.a).map(scr);
    const NSs = NS;
    const poly = (ix: number[], fill: string) => {
      const ps = ix.map((i) => c[i]);
      if (ps.some((p) => !p)) return;
      const el = doc.createElementNS(NSs, 'polygon');
      el.setAttribute('points', ps.map((p) => `${p![0].toFixed(1)},${p![1].toFixed(1)}`).join(' '));
      el.setAttribute('fill', fill);
      svg.append(el);
    };
    poly([0, 1, 2, 3], 'rgba(255,107,26,.18)');
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as Array<[number, number]>) {
      const p = c[i], q = c[j];
      if (!p || !q) continue;
      const el = doc.createElementNS(NSs, 'path');
      el.setAttribute('d', `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`);
      el.setAttribute('stroke', 'rgba(255,255,255,.92)');
      el.setAttribute('stroke-width', '1.5');
      el.setAttribute('stroke-dasharray', '5 4');
      el.setAttribute('fill', 'none');
      svg.append(el);
    }
    const m = scr(area.a.p);
    if (!m) return;
    const dot = doc.createElementNS(NSs, 'circle');
    dot.setAttribute('cx', m[0].toFixed(1));
    dot.setAttribute('cy', m[1].toFixed(1));
    dot.setAttribute('r', drag?.i === -1 ? '8.5' : '7.5');
    dot.setAttribute('fill', drag?.i === -1 ? YOU : '#fff');
    dot.setAttribute('stroke', drag?.i === -1 ? '#fff' : YOU);
    dot.setAttribute('stroke-width', '2.5');
    svg.append(dot);
    const top = c[6];
    if (top && area.label) {
      const t = doc.createElementNS(NSs, 'text');
      t.setAttribute('x', (top[0] + 8).toFixed(1));
      t.setAttribute('y', (top[1] - 6).toFixed(1));
      t.textContent = area.label;
      svg.append(t);
    }
    // The four floor corners (studio-timeline-2): drag = the size from the opposite corner, Shift = the height.
    const coarse = win.matchMedia?.('(pointer: coarse)').matches;
    for (let ci = 0; ci < 4; ci++) {
      const p = c[ci];
      if (!p) continue;
      const on = drag?.corner === ci;
      square(p, on ? 6 : 5, on ? YOU : '#fff', on ? '#fff' : YOU);
      const ch = doc.createElementNS(NSs, 'circle');
      ch.setAttribute('cx', p[0].toFixed(1));
      ch.setAttribute('cy', p[1].toFixed(1));
      ch.setAttribute('r', coarse ? '22' : '12');
      ch.setAttribute('class', `hit${on ? ' on' : ''}`);
      ch.setAttribute('data-corner', String(ci));
      ch.setAttribute('data-part', 'tl-area-corner');
      ch.setAttribute('aria-label', WORDS[d.lang()].corner);
      const tip = doc.createElementNS(NSs, 'title');
      tip.textContent = WORDS[d.lang()].corner;
      ch.append(tip);
      svg.append(ch);
    }
    const hit = doc.createElementNS(NSs, 'circle');
    hit.setAttribute('cx', m[0].toFixed(1));
    hit.setAttribute('cy', m[1].toFixed(1));
    hit.setAttribute('r', coarse ? '22' : '16');
    hit.setAttribute('class', `hit${drag?.i === -1 ? ' on' : ''}`);
    hit.setAttribute('data-point', '-1');
    hit.setAttribute('data-part', 'tl-area');
    hit.setAttribute('aria-label', WORDS[d.lang()].area);
    const tip = doc.createElementNS(NSs, 'title');
    tip.textContent = WORDS[d.lang()].area;
    hit.append(tip);
    svg.append(hit);
  }

  // ----- dragging a key's dot, a handle, the area or one of its corners; a press on the line -----
  /** What a press is on: a point (≥ 0) / the area's middle (-1), a handle, an area corner, the line — or nothing of ours. */
  const targetOf = (e: Event): { point?: number; handle?: [number, 'in' | 'out']; corner?: number; line?: boolean } | null => {
    for (const t of e.composedPath()) {
      if (!(t instanceof Element) || !svg.contains(t)) continue;
      const hd = t.getAttribute('data-handle');
      if (hd !== null) return { handle: [Number(hd.split(':')[0]), hd.split(':')[1] as 'in' | 'out'] };
      const cn = t.getAttribute('data-corner');
      if (cn !== null) return { corner: Number(cn) };
      const pt = t.getAttribute('data-point');
      if (pt !== null) return { point: Number(pt) };
      if (t.hasAttribute('data-line')) return { line: true };
    }
    return null;
  };
  const opts = { capture: true, passive: false } as AddEventListenerOptions;
  const take = (e: Event) => {
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  /** Metres per screen px at world point `w`, measured one metre up (Shift: up / down). */
  const mppAt = (w: number[]) => {
    const a = d.adapter();
    const p0 = a.toScreen?.(w), p1 = a.toScreen?.([w[0]!, w[1]! + 1, w[2]!]);
    const px = p0 && p1 ? Math.abs(p1[1] - p0[1]) : 0;
    return px > 0.5 ? 1 / px : 0.02;
  };
  /** The line's sample nearest to the pointer (screen px), with its time; null farther than `max` px. */
  const nearest = (x: number, y: number, max: number) => {
    let best: { p: [number, number]; t: number } | null = null, bd = max;
    for (let j = 0; j < samples.length - 1; j++) {
      const a = samples[j]!, b = samples[j + 1]!;
      if (!a.p || !b.p) continue;
      // The closest point on the segment a–b (the samples are 20 per span: fine enough to read a time off).
      const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1];
      const f = Math.max(0, Math.min(1, ((x - a.p[0]) * dx + (y - a.p[1]) * dy) / (dx * dx + dy * dy || 1)));
      const px = a.p[0] + dx * f, py = a.p[1] + dy * f;
      const dd = Math.hypot(px - x, py - y);
      if (dd < bd) (bd = dd), (best = { p: [px, py], t: Math.round((a.t + (b.t - a.t) * f) * 20) / 20 });
    }
    return best;
  };
  const moveTo = (e: PointerEvent, end: boolean) => {
    if (!drag) return;
    if (drag.corner !== undefined && area) {
      // An area corner: the opposite floor corner stays; Shift = the height (the floor stays).
      const b = area.a;
      let p = b.p.slice(), size = b.size.slice();
      if (drag.up || e.shiftKey) {
        if (!drag.up) (drag.up = true), (drag.y0 = e.clientY), (drag.size0 = b.size.slice());
        const hh = Math.max(0.2, r3((drag.size0![1] ?? 0) + (drag.y0 - e.clientY) * drag.mpp));
        size[1] = hh;
        p[1] = r3(drag.floor! + hh / 2);
      } else {
        const hit = d.adapter().toGround?.(e.clientX, e.clientY, drag.floor);
        const opp = corners(b)[(drag.corner + 2) % 4]!;
        if (hit) {
          const w = Math.max(0.2, Math.abs(hit[0]! - opp[0]!)), dz = Math.max(0.2, Math.abs(hit[2]! - opp[2]!));
          const sx = Math.sign(hit[0]! - opp[0]!) || 1, sz = Math.sign(hit[2]! - opp[2]!) || 1;
          p = [r3(opp[0]! + (sx * w) / 2), b.p[1]!, r3(opp[2]! + (sz * dz) / 2)];
          size = [r3(w), b.size[1]!, r3(dz)];
        }
      }
      area = { ...area, a: { p, size } };
      d.post({ type: 'studio:timeline/area-moved', key: area.key, p, size, end });
      d.markDirty();
      return;
    }
    if (drag.i === -1 && area) {
      const b = area.a;
      let p = b.p.slice();
      if (drag.up || e.shiftKey) {
        if (!drag.up) (drag.up = true), (drag.y0 = e.clientY), (drag.start = b.p.slice());
        p = drag.start.slice();
        p[1] = r3((drag.start[1] ?? 0) + (drag.y0 - e.clientY) * drag.mpp);
      } else {
        const hit = d.adapter().toGround?.(e.clientX, e.clientY, drag.h);
        if (hit) p = [r3(hit[0]!), b.p[1] ?? 0, r3(hit[2]!)];
      }
      area = { ...area, a: { ...b, p } };
      d.post({ type: 'studio:timeline/area-moved', key: area.key, p, end });
      d.markDirty();
      return;
    }
    if (!shown) return;
    const s = shown;
    const k = s.keys[drag.i];
    if (!k) return;
    if (drag.side) {
      // A handle: across the ground at its own height, or (Shift) up / down; an offset from its point.
      const pt = keyW(s, drag.i);
      let h = drag.start.slice();
      if (drag.up || e.shiftKey) {
        if (!drag.up) (drag.up = true), (drag.y0 = e.clientY), (drag.start = h.slice());
        h[1] = r3((drag.start[1] ?? 0) + (drag.y0 - e.clientY) * drag.mpp);
      } else {
        const hit = d.adapter().toGround?.(e.clientX, e.clientY, drag.h);
        if (hit) h = [r3(hit[0]! - pt[0]!), drag.start[1] ?? 0, r3(hit[2]! - pt[2]!)];
      }
      s.keys[drag.i] = { ...k, [drag.side]: h };
      d.post({ type: 'studio:timeline/handle', key: s.key, i: drag.i, side: drag.side, h, alone: e.altKey, end });
      d.markDirty();
      return;
    }
    let v = k.v.slice();
    if (drag.up || e.shiftKey) {
      // Up / down: the screen's px turned into metres at the dot (measured when the drag began).
      if (!drag.up) (drag.up = true), (drag.y0 = e.clientY), (drag.start = k.v.slice());
      v = drag.start.slice();
      v[1] = r3((drag.start[1] ?? 0) + (drag.y0 - e.clientY) * drag.mpp);
    } else {
      const hit = d.adapter().toGround?.(e.clientX, e.clientY, drag.h);
      if (hit) v = [r3(hit[0]! - s.base[0]!), k.v[1] ?? 0, r3(hit[2]! - s.base[2]!)];
    }
    s.keys[drag.i] = { ...k, v };
    d.post({ type: 'studio:timeline/point', key: s.key, i: drag.i, v, end });
    d.markDirty();
  };
  const begin = (e: PointerEvent, w: number[], more: Partial<NonNullable<typeof drag>>) => {
    drag = { i: -2, id: e.pointerId, h: w[1] ?? 0, up: e.shiftKey, y0: e.clientY, mpp: mppAt(w), start: [], x0: e.clientX, yy0: e.clientY, moved: false, ...more };
    ghost = null;
    drawn = '';
  };
  const onDown = (e: PointerEvent) => {
    const at = shown || area ? targetOf(e) : null;
    if (!at || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (at.corner !== undefined && area) {
      take(e);
      const c = corners(area.a)[at.corner]!;
      return begin(e, c, { corner: at.corner, floor: c[1], size0: area.a.size.slice() });
    }
    if (at.point === -1 && area) {
      take(e);
      return begin(e, area.a.p, { i: -1, start: area.a.p.slice() });
    }
    if (!shown) return;
    if (at.handle) {
      const [i, side] = at.handle;
      const w = handleW(shown, i, side);
      if (!w) return;
      take(e);
      return begin(e, w, { i, side, start: w.map((v, j) => v - keyW(shown!, i)[j]!) });
    }
    if (at.line) {
      take(e);
      const n = nearest(e.clientX - root.getBoundingClientRect().left, e.clientY - root.getBoundingClientRect().top, 40);
      return begin(e, [0, 0, 0], { line: n ? n.t : -1 });
    }
    if (at.point === undefined || at.point < 0) return;
    const k = shown.keys[at.point];
    if (!k) return;
    take(e);
    begin(e, keyW(shown, at.point), { i: at.point, start: k.v.slice() });
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) {
      // The "+" on the line follows a mouse over it (studio-timeline-2). Not taken: the game's own hover goes on.
      if (!shown || e.pointerType === 'touch') return;
      const over = targetOf(e)?.line;
      const r = root.getBoundingClientRect();
      const g = over ? nearest(e.clientX - r.left, e.clientY - r.top, 40) : null;
      if (JSON.stringify(g) !== JSON.stringify(ghost)) (ghost = g), (drawn = ''), d.markDirty();
      return;
    }
    if (e.pointerId !== drag.id) return;
    take(e);
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.yy0) < 3) return;
    drag.moved = true;
    if (drag.line === undefined) moveTo(e, false);
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    take(e);
    const dg = drag;
    if (dg.line !== undefined) {
      // A press on the line that did not move: a key at that moment.
      if (!dg.moved && dg.line >= 0 && shown) d.post({ type: 'studio:timeline/insert', key: shown.key, t: dg.line });
    } else if (dg.moved) moveTo(e, true);
    else if (dg.i >= 0 && !dg.side && shown) {
      // A point pressed twice without moving (within 400 ms): a corner, or smooth again.
      const now = performance.now();
      if (lastUp && lastUp.i === dg.i && now - lastUp.at < 400) {
        d.post({ type: 'studio:timeline/corner', key: shown.key, i: dg.i });
        lastUp = null;
      } else lastUp = { i: dg.i, at: now };
    }
    drag = null;
    drawn = '';
    d.markDirty();
  };
  win.addEventListener('pointerdown', onDown, opts);
  win.addEventListener('pointermove', onMove, opts);
  win.addEventListener('pointerup', onUp, opts);
  win.addEventListener('pointercancel', onUp, opts);

  return {
    handle(msg) {
      if (msg.type === 'studio:timeline/pose') {
        const p = d.poser();
        for (const e of msg.poses) {
          try {
            p.setPose(e.key, e.pose as Pose);
          } catch {
            /* gone (deleted, the page changing): the others go on */
          }
        }
        d.markDirty();
      } else if (msg.type === 'studio:timeline/area') {
        const mine = (drag?.i === -1 || drag?.corner !== undefined) && area && msg.key === area.key;
        // While the area or a corner is dragged, ours is newer (the label still follows the shell's).
        if (mine) area = { ...area!, label: msg.label ?? area!.label };
        else area = msg.key && msg.area ? { key: msg.key, a: structuredClone(msg.area), label: msg.label ?? '' } : null;
        drawn = '';
        d.markDirty();
      } else if (msg.type === 'studio:timeline/path') {
        // While a dot is dragged, the shell's echo of the same key keeps the dot under the finger (ours is newer).
        // A handle's drag takes the shell's keys (the other handle lining up is worked out there); a point's keeps ours.
        if (drag && shown && msg.key === shown.key && !drag.side) {
          shown = { ...shown, base: msg.base ?? shown.base, now: msg.now ?? null, sel: msg.sel ?? [] };
        } else if (drag?.side && shown && msg.key === shown.key && msg.keys?.length) {
          shown = { ...shown, base: msg.base ?? shown.base, keys: structuredClone(msg.keys), now: msg.now ?? null, sel: msg.sel ?? [] };
        } else {
          drag = null;
          shown = msg.key && msg.base && msg.keys?.length ? { key: msg.key, base: msg.base.slice(), keys: structuredClone(msg.keys), now: msg.now ?? null, sel: msg.sel ?? [] } : null;
        }
        drawn = '';
        d.markDirty();
      }
    },
    frame() {
      draw();
    },
    clear() {
      shown = null;
      area = null;
      drag = null;
      ghost = null;
      draw();
    },
  };
}
