// Motion in the game page (motion-gui, 2026-10-22; CONTRACT.md §1.9): the picked object's path drawn over the game, its
// points dragged by hand, and the card's ▶ — that one object moving in the frozen scene.
//
// What is drawn (only for the picked object, only while it has a path; nothing else's path: the scene stays quiet):
//   a dotted orange line from the object through its points (back to the object for a loop), a small orange dot where
//   it starts, and a white dot with an orange ring on each point — the ring of the picked object's outline, the colour
//   of "your hand" (handles.ts). The dot is the handle: drag it and the point follows on the ground at its own height
//   (adapter.toGround), the line with it; letting go is one undo step (the shell records it).
// WHY DOM in a shadow root, as handles.ts: the same look and hit in every engine, out of reach of the game's CSS.
// WHY the press is taken here before input.ts sees it: this file's window listeners are added when the editor is made,
// before input.ts attaches its own (capture listeners on one target run in the order they were added), so a press on
// a dot never selects or drags what is under it; any other press goes on to input.ts untouched (and stops the ▶).
//
// ▶ (motion/play): the object's place is kept, then every frame it is put at place + motionAt(t) (the loader's own
// maths, src/loader, so the editor shows exactly what the game will do) through the copy/delete layer — not the game
// rules layer: a grid snap would make the motion jump, and the rules are about where a hand puts things. Stop puts the
// place back exactly. Nothing is reported as moved: the preview is not an edit.
//
// Positions: `p` and the path are the object's PARENT space; toScreen / toGround speak the scene's. They agree for
// objects at the top of the scene (every starter's). An object inside a moved group draws its path off by the group's
// offset (design.md §5, stage 2).
import type { Anchor, BridgeToShell, Inset, Lang, Motion, Pose, ShellToBridge, StudioAdapter } from '../contract.ts';
import { motionAt } from '../loader/studio-placement.js';

const YOU = '#ff6b1a';
const WORDS: Record<Lang, { point: (i: number) => string }> = {
  en: { point: (i) => `Point ${i}: drag to move it` },
  ja: { point: (i) => `点 ${i}：引いて動かす` },
};

const CSS = `
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.hit { pointer-events: auto; cursor: grab; fill: transparent; }
.hit.on { cursor: grabbing; }
`;

export interface MotionViewDeps {
  win: Window & typeof globalThis;
  /** The current layer's adapter as the editor drives it (pose reads, toScreen / toGround). */
  adapter(): StudioAdapter;
  /** The copy/delete layer of that adapter (the ▶ poses through it: no game rules, no snapping). */
  poser(): StudioAdapter;
  post(m: BridgeToShell): void;
  /** Viewport px the shell's floating panels cover (the card): the first points are put where they are not under it. */
  inset(): Inset;
  lang(): Lang;
  /** The studio's own requestAnimationFrame (never held with the game's frames). */
  raf(cb: (t: number) => void): number;
  markDirty(): void;
}

export interface MotionView {
  handle(msg: ShellToBridge): void;
  /** Every editor frame: the ▶ moves on, the path follows the camera. */
  frame(): void;
  /** Stop the ▶ (the object goes back) and draw nothing: editing ended, the layer switched. */
  clear(): void;
  /** Stop the ▶ if `key` is the one playing (or any, without a key): an edit is about to touch it. */
  stopFor(key?: string): void;
}

export function createMotionView(d: MotionViewDeps): MotionView {
  const { win } = d;
  const doc = win.document;
  const host = doc.createElement('div');
  host.setAttribute('data-studio-ui', '');
  host.setAttribute('data-studio-motion', '');
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

  let shown: { key: string; motion: Motion } | null = null;
  let play: { key: string; motion: Motion; base: Pose; t0: number } | null = null;
  let drag: { i: number; id: number; h: number; base: number[] } | null = null;
  // The last picture drawn (so a frame that changes nothing draws nothing).
  let drawn = '';

  const poseOf = (key: string): Pose | null => {
    try {
      return d.adapter().anchor(key)?.pose ?? null;
    } catch {
      return null;
    }
  };
  /** Where the object's path starts: its place (kept while the ▶ plays, when the object itself is on its way). */
  const baseOf = (key: string): number[] | null => (play?.key === key ? play.base.p : poseOf(key)?.p) ?? null;

  const stop = (tell: boolean) => {
    if (!play) return;
    const p = play;
    play = null;
    try {
      d.poser().setPose(p.key, p.base);
    } catch {
      /* the object is gone (deleted, the page changing): nothing to put back */
    }
    d.markDirty();
    if (tell) d.post({ type: 'studio:motion/played', key: null });
  };

  const draw = () => {
    const a = d.adapter();
    const key = shown?.key;
    const path = shown?.motion.path;
    const base = key && path?.length ? baseOf(key) : null;
    if (!key || !path?.length || !base || !a.toScreen) {
      // By what is on screen, not by `drawn` (handle() empties that to force the next picture).
      if (svg.firstChild) svg.replaceChildren();
      drawn = '';
      return;
    }
    const world = [base, ...path.map((q) => q.map((v, i) => v + (base[i] ?? 0)))];
    const pts = world.map((w) => a.toScreen!(w));
    const sig = JSON.stringify(pts) + (drag ? drag.i : '');
    if (sig === drawn) return;
    drawn = sig;
    mount();
    svg.replaceChildren();
    const ring = shown!.motion.repeat === 'loop' ? [...pts, pts[0]!] : pts;
    // The line: a faint dark halo under a dotted orange line (readable on any colour, as the outline's halo is).
    let dpath = '';
    let pen = false;
    for (const p of ring) {
      if (!p) {
        pen = false;
        continue;
      }
      dpath += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
      pen = true;
    }
    const line = (stroke: string, width: number, dash?: string) => {
      const el = doc.createElementNS(NS, 'path');
      el.setAttribute('d', dpath);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', stroke);
      el.setAttribute('stroke-width', String(width));
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      if (dash) el.setAttribute('stroke-dasharray', dash);
      svg.append(el);
    };
    line('rgba(0,0,0,.28)', 5);
    line(YOU, 2, '1 7');
    const dot = (p: [number, number], r: number, fill: string, stroke?: string) => {
      const c = doc.createElementNS(NS, 'circle');
      c.setAttribute('cx', p[0].toFixed(1));
      c.setAttribute('cy', p[1].toFixed(1));
      c.setAttribute('r', String(r));
      c.setAttribute('fill', fill);
      if (stroke) (c.setAttribute('stroke', stroke), c.setAttribute('stroke-width', '2.5'));
      svg.append(c);
      return c;
    };
    if (pts[0]) dot(pts[0], 3.5, YOU);
    const coarse = win.matchMedia?.('(pointer: coarse)').matches;
    pts.slice(1).forEach((p, i) => {
      if (!p) return;
      dot(p, drag?.i === i ? 8 : 7, '#fff', YOU);
      // The hit area is bigger than the dot: 32 px across with a mouse, 44 with a finger.
      const hit = dot(p, coarse ? 22 : 16, 'transparent');
      hit.setAttribute('class', `hit${drag?.i === i ? ' on' : ''}`);
      hit.setAttribute('data-point', String(i));
      hit.setAttribute('role', 'button');
      hit.setAttribute('aria-label', WORDS[d.lang()].point(i + 1));
      const tip = doc.createElementNS(NS, 'title');
      tip.textContent = WORDS[d.lang()].point(i + 1);
      hit.append(tip);
    });
  };

  /**
   * The first points of a new path, where the person can see them: to the object's right on screen (left when the
   * card covers the right), on the ground at the object's own height. A loop gets a square: right, then away (up the
   * screen), then back. Kept as given when the game cannot tell (no toGround, the sky).
   */
  const seed = (key: string, m: Motion): Motion | null => {
    const a = d.adapter();
    let an: Anchor | null = null;
    try {
      an = a.anchor(key);
    } catch {
      an = null;
    }
    const base = an?.pose.p;
    if (!an || !base || !a.toGround) return null;
    const [cx, cy] = an.center;
    const step = Math.max(90, Math.min(220, (an.size || 80) * 1.2));
    const ins = d.inset();
    const right = cx + step < win.innerWidth - ins.right - 40;
    const sx = right ? step : -step;
    const up = cy - step * 0.6 > ins.top + 40 ? -step * 0.6 : step * 0.6;
    const shots: Array<[number, number]> = m.repeat === 'loop' ? [[cx + sx, cy], [cx + sx, cy + up], [cx, cy + up]] : [[cx + sx, cy]];
    const out: number[][] = [];
    for (const [x, y] of shots) {
      const hit = a.toGround(x, y, base[1] ?? 0);
      if (!hit) return null;
      const off = hit.map((v, i) => Math.round((v - (base[i] ?? 0)) * 1000) / 1000);
      // Further than 200 m (a point at the horizon) is not "in sight": keep the stand-in points.
      if (Math.hypot(...off) > 200) return null;
      out.push(off);
    }
    if (out.every((q) => Math.hypot(...q) < 0.05)) return null;
    return { ...m, path: out };
  };

  // ----- dragging a point -----
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
  const moveTo = (e: PointerEvent, end: boolean) => {
    if (!drag || !shown) return;
    const a = d.adapter();
    const hit = a.toGround?.(e.clientX, e.clientY, drag.h);
    const m = shown.motion;
    if (hit && m.path) {
      const path = m.path.map((q) => q.slice());
      const old = path[drag.i]!;
      const r = (v: number) => Math.round(v * 1000) / 1000;
      // 3D: across the ground only, the point keeps its height (raising points is stage 2). 2D: where the finger is.
      path[drag.i] = old.length === 3 ? [r(hit[0]! - drag.base[0]!), old[1] ?? 0, r(hit[2]! - (drag.base[2] ?? 0))] : [r(hit[0]! - drag.base[0]!), r(hit[1]! - (drag.base[1] ?? 0))];
      shown = { key: shown.key, motion: { ...m, path } };
    }
    d.post({ type: 'studio:motion/changed', key: shown.key, motion: structuredClone(shown.motion), end });
    d.markDirty();
  };
  const onDown = (e: PointerEvent) => {
    const i = shown ? pointOf(e) : null;
    if (i === null || !shown) {
      // A press anywhere else in the game ends the ▶ (the person is about to do something else), then goes on.
      if (play) stop(true);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    take(e);
    const base = baseOf(shown.key);
    const q = shown.motion.path?.[i];
    if (!base || !q) return;
    drag = { i, id: e.pointerId, h: (base[1] ?? 0) + (q[1] ?? 0), base };
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
      if (msg.type === 'studio:motion/show') {
        drag = null;
        shown = msg.key && msg.motion?.path?.length ? { key: msg.key, motion: structuredClone(msg.motion) } : null;
        if (play && play.key !== msg.key) stop(true);
        if (msg.seed && msg.key && msg.motion?.path) {
          const m = seed(msg.key, msg.motion);
          if (m) {
            shown = { key: msg.key, motion: m };
            d.post({ type: 'studio:motion/changed', key: msg.key, motion: structuredClone(m), end: true, seed: true });
          }
        }
        drawn = '';
        d.markDirty();
      } else if (msg.type === 'studio:motion/play') {
        const again = play && play.key === msg.key ? play.base : null;
        if (play && !again) stop(false);
        if (!msg.key || !msg.motion) return void stop(false);
        const pose = again ?? poseOf(msg.key);
        if (!pose) return void d.post({ type: 'studio:motion/played', key: null });
        play = { key: msg.key, motion: structuredClone(msg.motion), base: structuredClone(pose), t0: win.performance.now() };
        if (shown?.key === msg.key && msg.motion.path?.length) shown = { key: msg.key, motion: structuredClone(msg.motion) };
        d.markDirty();
      }
    },
    frame() {
      if (play) {
        const t = (win.performance.now() - play.t0) / 1000;
        const at = motionAt(play.motion, t) as { off: number[] | null; turn: number; done: boolean };
        const b = play.base;
        const pose: Pose = { ...b, p: at.off ? b.p.map((v, i) => v + (at.off![i] ?? 0)) : b.p.slice() };
        if (play.motion.spin) pose.r = (b.r ?? 0) + at.turn;
        try {
          d.poser().setPose(play.key, pose);
        } catch {
          stop(true);
        }
        d.markDirty();
        // `once` arrived: stay at the end a moment so the eye sees where it stops, then back to the place.
        if (at.done && t > lastLeg(play.motion) + 0.8) stop(true);
      }
      draw();
    },
    clear() {
      stop(false);
      shown = null;
      drag = null;
      draw();
    },
    stopFor(key) {
      if (play && (!key || key === play.key)) stop(true);
    },
  };
}

/** Seconds a `once` path takes (its length over its speed). */
function lastLeg(m: Motion): number {
  const pts = [m.path![0]!.map(() => 0), ...m.path!];
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(...pts[i]!.map((v, k) => v - pts[i - 1]![k]!));
  return len / (m.speed && m.speed > 0 ? m.speed : 1);
}
