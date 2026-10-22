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
// Positions: the place and the keys are the object's PARENT space; toScreen / toGround speak the scene's. They agree
// for objects at the top of the scene (every starter's); an object inside a moved group draws its path off by the
// group's offset (stage 2).
import type { BridgeToShell, Lang, MotionArea, MotionKey, Pose, ShellToBridge, StudioAdapter } from '../contract.ts';
import { trackAt } from '../loader/studio-placement.js';

const YOU = '#ff6b1a';
const WORDS: Record<Lang, { point: (t: string) => string; area: string }> = {
  en: { point: (t) => `Key at ${t} s: drag to move it, Shift+drag for up and down`, area: 'The area: drag to move it, Shift+drag for up and down' },
  ja: { point: (t) => `${t} 秒のキー：引いて動かす・Shift で上下`, area: '範囲：引いて動かす・Shift で上下' },
};

const CSS = `
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.hit { pointer-events: auto; cursor: grab; fill: transparent; }
.hit.on { cursor: grabbing; }
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
  let drag: { i: number; id: number; h: number; up: boolean; y0: number; mpp: number; start: number[] } | null = null;
  let drawn = '';

  /** The curve's points in the scene: `samples` per span between keys (the loader's own maths). */
  const curve = (s: Shown, samples = 20): number[][] => {
    const ks = s.keys;
    if (ks.length < 2) return ks.map((k) => k.v.map((v, i) => v + (s.base[i] ?? 0)));
    const out: number[][] = [];
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i]!.t, b = ks[i + 1]!.t;
      for (let j = 0; j < samples; j++) {
        const v = trackAt(ks, a + ((b - a) * j) / samples, true) as number[] | null;
        if (v) out.push(v.map((x, k) => x + (s.base[k] ?? 0)));
      }
    }
    out.push(ks[ks.length - 1]!.v.map((v, k) => v + (s.base[k] ?? 0)));
    return out;
  };

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
    const line = pts.map(scr);
    const shadowLine = pts.map((w) => scr(ground(w)));
    const keysW = s.keys.map((k) => k.v.map((v, i) => v + (s.base[i] ?? 0)));
    const keysS = keysW.map(scr);
    const dropS = keysW.map((w) => scr(ground(w)));
    const nowS = s.now ? scr(s.now.map((v, i) => v + (s.base[i] ?? 0))) : null;
    const sig = JSON.stringify([line, keysS, nowS, s.sel, drag?.i ?? -1, d.lang(), hasArea ? areaSig(scr) : null]);
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
    keysS.forEach((p, i) => {
      if (!p) return;
      const on = s.sel.includes(i) || drag?.i === i;
      circle(p, on ? 8.5 : 7, on ? YOU : '#fff', on ? '#fff' : YOU);
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
    if (hasArea) drawArea(scr);
  };

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
    const hit = doc.createElementNS(NSs, 'circle');
    hit.setAttribute('cx', m[0].toFixed(1));
    hit.setAttribute('cy', m[1].toFixed(1));
    hit.setAttribute('r', win.matchMedia?.('(pointer: coarse)').matches ? '22' : '16');
    hit.setAttribute('class', `hit${drag?.i === -1 ? ' on' : ''}`);
    hit.setAttribute('data-point', '-1');
    hit.setAttribute('data-part', 'tl-area');
    hit.setAttribute('aria-label', WORDS[d.lang()].area);
    const tip = doc.createElementNS(NSs, 'title');
    tip.textContent = WORDS[d.lang()].area;
    hit.append(tip);
    svg.append(hit);
  }

  // ----- dragging a key's dot -----
  const pointOf = (e: PointerEvent): number | null => {
    for (const t of e.composedPath()) {
      if (t instanceof Element && t.getAttribute('data-point') !== null && svg.contains(t)) return Number(t.getAttribute('data-point'));
    }
    return null;
  };
  const opts = { capture: true, passive: false } as AddEventListenerOptions;
  const take = (e: Event) => {
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const moveTo = (e: PointerEvent, end: boolean) => {
    if (drag && drag.i === -1 && area) {
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
    if (!drag || !shown) return;
    const s = shown;
    const k = s.keys[drag.i];
    if (!k) return;
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
  const onDown = (e: PointerEvent) => {
    const i = shown || area ? pointOf(e) : null;
    if (i === -1 && area) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      take(e);
      const w = area.a.p;
      const a = d.adapter();
      const p0 = a.toScreen?.(w), p1 = a.toScreen?.([w[0]!, w[1]! + 1, w[2]!]);
      const px = p0 && p1 ? Math.abs(p1[1] - p0[1]) : 0;
      drag = { i: -1, id: e.pointerId, h: w[1] ?? 0, up: e.shiftKey, y0: e.clientY, mpp: px > 0.5 ? 1 / px : 0.02, start: w.slice() };
      drawn = '';
      return;
    }
    if (i === null || !shown) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    take(e);
    const k = shown.keys[i];
    if (!k) return;
    const w = k.v.map((v, j) => v + (shown!.base[j] ?? 0));
    // Metres per screen px at the dot, for Shift (up / down): one metre up, measured on screen.
    const a = d.adapter();
    const p0 = a.toScreen?.(w), p1 = a.toScreen?.([w[0]!, w[1]! + 1, w[2]!]);
    const px = p0 && p1 ? Math.abs(p1[1] - p0[1]) : 0;
    drag = { i, id: e.pointerId, h: w[1] ?? 0, up: e.shiftKey, y0: e.clientY, mpp: px > 0.5 ? 1 / px : 0.02, start: k.v.slice() };
    drawn = '';
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    take(e);
    moveTo(e, false);
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    take(e);
    moveTo(e, true);
    drag = null;
    drawn = '';
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
        if (!(drag?.i === -1 && area && msg.key === area.key)) area = msg.key && msg.area ? { key: msg.key, a: structuredClone(msg.area), label: msg.label ?? '' } : null;
        drawn = '';
        d.markDirty();
      } else if (msg.type === 'studio:timeline/path') {
        // While a dot is dragged, the shell's echo of the same key keeps the dot under the finger (ours is newer).
        if (drag && shown && msg.key === shown.key) {
          shown = { ...shown, base: msg.base ?? shown.base, now: msg.now ?? null, sel: msg.sel ?? [] };
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
      draw();
    },
  };
}
