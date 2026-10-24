// The game's rule motions in the game page (studio-code-knobs, 2026-10-24; the plan's step 2, items 7–9, and the first
// round's decision 6). A rule motion is the game's codeMotion() — "the
// pillar goes round in a spiral, Radius 2 m, 4 s a lap" — whose shape is the game's own at(t, knobs). The shell cannot
// run it (it lives in this page), so here:
//
//   timeline/pose `code`   the timeline's ▶ / time line: each such object's pose gets its rule's offsets at that time
//                          (p added, the turn added, the size times), on top of its place (and its points' motion).
//   timeline/path `code`   the picked object's rule drawn as a violet dotted line — one round (none: 4 s), 64 places —
//                          with nothing to grab but ONE ◇ at its outermost place when the rule names a `drag` knob: a
//                          drag of the ◇ looks for the knob value that brings the line through the finger's spot on
//                          the ground (golden-section, the same search as a layout's drag: code-place.ts findKnob) and
//                          says it (timeline/code-knob: live, then `end` = one ⌘Z in the shell). Its label "Radius 2 m",
//                          its chip "Radius 2 → 3 m" while dragged.
//   timeline/code-points   "Make editable points": the rule's shape over `len` seconds as position keys (`per` a round),
//                          for the shell to turn it into an ordinary motion of points (one ⌘Z).
// WHY violet and a ◇: violet is the rule's (and the AI's) colour everywhere; a white dot with an orange ring is a point
// the hand put (timeline-path.ts), so a ◇ says at a glance "this is not a point: it turns a number".
// WHY its own listeners, added before input.ts (editor.ts makes this before attaching input): a press on the ◇ must not
// pick or drag what is under it — the same reason as timeline-path.ts.
import type { BridgeToShell, CodeAt, Lang, MotionKey, Pose, ShellToBridge, StudioAdapter } from '../contract.ts';
import { findKnob, knobRange, knobText, unitText } from './code-place.ts';

const VIOLET = '#8b7cff';
const YOU = '#ff6b1a';
const SAMPLES = 64;

type Win = Window & typeof globalThis;
type At = (t: number, k: Record<string, number>, g: Record<string, unknown>) => { p?: unknown; r?: unknown; s?: unknown } | null | undefined;
interface Entry {
  id: string;
  knobs: Record<string, { v: number; label: string; unit: string; min?: number; max?: number; step?: number }>;
  at: At;
}

const motions = (win: Win): Map<string, Entry> => {
  const m = (win as unknown as Record<symbol, unknown>)[Symbol.for('game-studio.codeMotions')];
  return m instanceof Map ? (m as Map<string, Entry>) : new Map();
};
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, n: number): number[] | null => {
  if (num(v)) return Array.from({ length: n }, () => v);
  return Array.isArray(v) && v.length >= n && v.slice(0, n).every(num) ? (v.slice(0, n) as number[]) : null;
};

/** One rule's offsets at `t` ({ p, r, s } as the loader's codeAt: r = [x, y, z] turns in 3D), or null when it fails. */
export function ruleAt(win: Win, code: string, t: number, k: Record<string, number>, key: string | null, n: 2 | 3): { p: number[] | null; r: number[] | null; s: number[] | null } | null {
  const m = motions(win).get(code);
  if (!m || typeof m.at !== 'function') return null;
  let a: ReturnType<At>;
  try {
    a = m.at(Math.max(0, t), k, { key, obj: null, dt: 0, player: null });
  } catch {
    return null;
  }
  if (!a || typeof a !== 'object') return null;
  const r = num(a.r) ? (n === 3 ? [0, a.r, 0] : [a.r]) : vec(a.r, n === 3 ? 3 : 1);
  return { p: vec(a.p, n), r, s: num(a.s) ? Array.from({ length: n }, () => a!.s as number) : vec(a.s, n) };
}

/** The timeline's poses with each object's rule offsets added (timeline/pose `code`); poses without a rule as they are. */
export function withRuleMotions(win: Win, poses: Array<{ key: string; pose: Pose }>, code: CodeAt[] | undefined, dim: '2d' | '3d'): Array<{ key: string; pose: Pose }> {
  if (!code?.length) return poses;
  const n = dim === '3d' ? 3 : 2;
  const out = poses.map((e) => ({ key: e.key, pose: structuredClone(e.pose) as Pose }));
  for (const c of code) {
    const e = out.find((x) => x.key === c.key);
    const a = e ? ruleAt(win, c.code, c.t, c.knobs, c.key, n) : null;
    if (!e || !a) continue;
    const p = e.pose;
    if (a.p) p.p = p.p.map((v, i) => v + (a.p![i] ?? 0));
    if (a.r) {
      if (n === 3) {
        p.r = (p.r ?? 0) + (a.r[1] ?? 0);
        if (a.r[0] || a.r[2] || p.t) p.t = [(p.t?.[0] ?? 0) + (a.r[0] ?? 0), (p.t?.[1] ?? 0) + (a.r[2] ?? 0)];
      } else p.r = (p.r ?? 0) + (a.r[0] ?? 0);
    }
    if (a.s) p.s = Array.isArray(p.s) ? p.s.map((v, i) => v * (a.s![i] ?? 1)) : a.s.every((v) => v === a.s![0]) ? (p.s ?? 1) * a.s[0]! : a.s.map((v) => v * ((p.s as number | undefined) ?? 1));
  }
  return out;
}

export interface CodeMotionViewDeps {
  win: Win;
  adapter(): StudioAdapter;
  post(m: BridgeToShell): void;
  lang(): Lang;
  markDirty(): void;
}

type Path = NonNullable<Extract<ShellToBridge, { type: 'studio:timeline/path' }>['code']> & { key: string; base: number[] };

export function createCodeMotionView(d: CodeMotionViewDeps) {
  const { win } = d;
  const doc = win.document;
  const host = doc.createElement('div');
  host.setAttribute('data-studio-ui', '');
  host.setAttribute('data-studio-code-motion', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = `.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.hit { pointer-events: auto; cursor: grab; fill: transparent; }
.hit.on { cursor: grabbing; }
text { font: 600 11px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; fill: #fff; paint-order: stroke; stroke: rgba(0,0,0,.5); stroke-width: 3px; }`;
  const root = doc.createElement('div');
  root.className = 'root';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg') as SVGSVGElement;
  root.append(svg);
  shadow.append(style, root);
  let mounted = false;
  let path: Path | null = null;
  // The ◇ dragged: its knob's number before and now, the ground height it is dragged on.
  let drag: { id: number; from: number; v: number; y: number } | null = null;
  let drawn = '';

  const n = () => (d.adapter().dim === '3d' ? 3 : 2);
  /** The rule's line in the scene: SAMPLES + 1 places over one round (none: 4 s), with knob values `k`. */
  const line = (p: Path, k: Record<string, number>): number[][] => {
    const len = p.round && p.round > 0 ? p.round : 4;
    const out: number[][] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const a = ruleAt(win, p.code, (len * i) / SAMPLES, k, p.key, n() as 2 | 3);
      if (a?.p) out.push(a.p.map((v, j) => v + (p.base[j] ?? 0)));
    }
    return out;
  };
  /**
   * The outermost place of the line (farthest from where the object stands, on the ground): where the ◇ sits — of the
   * places on screen when there are some (a phone's narrow view cut the far side of a spiral off, ◇ and all).
   */
  const outer = (pts: number[][], base: number[]) => {
    const a = d.adapter();
    const vw = win.innerWidth, vh = win.innerHeight;
    const seen = pts.filter((q) => {
      const s = a.toScreen?.(q);
      return !!s && s[0] > 16 && s[0] < vw - 16 && s[1] > 16 && s[1] < vh - 16;
    });
    let best: number[] | null = null, bd = -1;
    for (const q of seen.length ? seen : pts) {
      const dd = q.length === 3 ? Math.hypot(q[0]! - base[0]!, q[2]! - base[2]!) : Math.hypot(q[0]! - base[0]!, q[1]! - base[1]!);
      if (dd > bd + 1e-6) (bd = dd), (best = q);
    }
    return best;
  };
  const words = () => {
    const p = path!;
    const def = p.drag ? motions(win).get(p.code)?.knobs[p.drag] : undefined;
    return def ? { label: def.label, unit: unitText(d.lang(), def.unit), step: def.step } : null;
  };

  const draw = () => {
    const a = d.adapter();
    if (!path || !a.toScreen) {
      if (svg.firstChild) svg.replaceChildren();
      drawn = '';
      return;
    }
    const p = path;
    const k = drag && p.drag ? { ...p.knobs, [p.drag]: drag.v } : p.knobs;
    const pts = line(p, k);
    const scr = pts.map((q) => a.toScreen!(q));
    const o = p.drag ? outer(pts, p.base) : null;
    const os = o ? a.toScreen(o) : null;
    const w = words();
    const label = w && p.drag ? (drag ? `${w.label} ${knobText(drag.from, w.step)} → ${knobText(drag.v, w.step)}${w.unit}` : `${w.label} ${knobText(k[p.drag]!, w.step)}${w.unit}`) : '';
    const sig = JSON.stringify([scr, os, label, !!drag]);
    if (sig === drawn) return;
    drawn = sig;
    if (!mounted && doc.body) (doc.body.append(host), (mounted = true));
    svg.replaceChildren();
    let dd = '';
    let pen = false;
    for (const s of scr) {
      if (!s) {
        pen = false;
        continue;
      }
      dd += `${pen ? 'L' : 'M'}${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
      pen = true;
    }
    const stroke = (color: string, width: number, dash?: string) => {
      const el = doc.createElementNS(NS, 'path');
      el.setAttribute('d', dd);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(width));
      el.setAttribute('stroke-linecap', 'round');
      if (dash) el.setAttribute('stroke-dasharray', dash);
      svg.append(el);
    };
    stroke('rgba(0,0,0,.3)', 5);
    stroke(VIOLET, 2.2, '5 5');
    if (!os) return;
    // The ◇: violet (orange while dragged — the hand on it), its knob's name and number beside it.
    const r = drag ? 8 : 7;
    const dm = doc.createElementNS(NS, 'rect');
    dm.setAttribute('x', (os[0] - r).toFixed(1));
    dm.setAttribute('y', (os[1] - r).toFixed(1));
    dm.setAttribute('width', String(2 * r));
    dm.setAttribute('height', String(2 * r));
    dm.setAttribute('rx', '1.5');
    dm.setAttribute('transform', `rotate(45 ${os[0].toFixed(1)} ${os[1].toFixed(1)})`);
    dm.setAttribute('fill', drag ? YOU : '#fff');
    dm.setAttribute('stroke', drag ? '#fff' : VIOLET);
    dm.setAttribute('stroke-width', '2.5');
    svg.append(dm);
    if (label) {
      const tx = doc.createElementNS(NS, 'text');
      tx.setAttribute('x', (os[0] + 14).toFixed(1));
      tx.setAttribute('y', (os[1] - 10).toFixed(1));
      tx.textContent = label;
      svg.append(tx);
    }
    const coarse = win.matchMedia?.('(pointer: coarse)').matches;
    const hit = doc.createElementNS(NS, 'circle');
    hit.setAttribute('cx', os[0].toFixed(1));
    hit.setAttribute('cy', os[1].toFixed(1));
    hit.setAttribute('r', coarse ? '22' : '14');
    hit.setAttribute('class', `hit${drag ? ' on' : ''}`);
    hit.setAttribute('data-code-knob', '');
    hit.setAttribute('data-part', 'tl-code-knob');
    if (label) {
      const tip = doc.createElementNS(NS, 'title');
      tip.textContent = label;
      hit.append(tip);
    }
    svg.append(hit);
  };

  // ----- the ◇'s drag -----
  const opts = { capture: true, passive: false } as AddEventListenerOptions;
  const take = (e: Event) => {
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  const onDown = (e: PointerEvent) => {
    if (!path?.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!e.composedPath().some((t) => t instanceof Element && t.hasAttribute('data-code-knob') && svg.contains(t))) return;
    take(e);
    const o = outer(line(path, path.knobs), path.base);
    drag = { id: e.pointerId, from: path.knobs[path.drag]!, v: path.knobs[path.drag]!, y: o?.[1] ?? path.base[1] ?? 0 };
    drawn = '';
    d.markDirty();
  };
  const moveTo = (e: PointerEvent, end: boolean) => {
    const p = path;
    if (!drag || !p?.drag) return;
    const def = motions(win).get(p.code)?.knobs[p.drag];
    const want = d.adapter().toGround?.(e.clientX, e.clientY, drag.y);
    if (def && want) {
      const [lo, hi] = knobRange({ v: drag.from, min: def.min, max: def.max });
      // The knob that brings the line nearest the finger: of each try, its place nearest the spot (64 a round).
      const near = (x: number) => {
        const pts = line(p, { ...p.knobs, [p.drag!]: x });
        let best: number[] | null = null, bd = Infinity;
        for (const q of pts) {
          const dd = q.length === 3 ? Math.hypot(q[0]! - want[0]!, q[2]! - want[2]!) : Math.hypot(q[0]! - want[0]!, q[1]! - want[1]!);
          if (dd < bd) (bd = dd), (best = q);
        }
        return best;
      };
      const v = findKnob(near, want, lo, hi, !!def.step && def.step >= 1);
      if (v !== null) {
        const q = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, (hi - lo) / 100))));
        drag.v = def.step && def.step >= 1 ? v : Math.round(v / q) * q;
      }
    }
    d.post({ type: 'studio:timeline/code-knob', name: p.name, knob: p.drag, v: drag.v, end });
    drawn = '';
    d.markDirty();
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
    if (path?.drag) path = { ...path, knobs: { ...path.knobs, [path.drag]: drag.v } };
    drag = null;
    drawn = '';
    d.markDirty();
  };
  win.addEventListener('pointerdown', onDown, opts);
  win.addEventListener('pointermove', onMove, opts);
  win.addEventListener('pointerup', onUp, opts);
  win.addEventListener('pointercancel', onUp, opts);

  return {
    handle(msg: ShellToBridge) {
      if (msg.type === 'studio:timeline/path') {
        // While the ◇ is dragged the shell's echo keeps ours (the knob under the finger is newer).
        if (drag && path && msg.key === path.key && msg.code) return;
        path = msg.key && msg.code && msg.base ? { ...msg.code, key: msg.key, base: msg.base.slice() } : null;
        drawn = '';
        d.markDirty();
      } else if (msg.type === 'studio:timeline/code-points') {
        // "Make editable points": `per` places a round, over `len` seconds, as offsets (the object's place is not in them).
        const m = motions(win).get(msg.code);
        let keys: MotionKey[] | null = null;
        if (m) {
          const round = msg.len > 0 ? msg.len : 4;
          const count = Math.max(2, Math.min(256, Math.round(msg.per)));
          keys = [];
          for (let i = 0; i <= count; i++) {
            const t = (round * i) / count;
            const a = ruleAt(win, msg.code, t, msg.knobs, null, n() as 2 | 3);
            if (!a?.p) {
              keys = null;
              break;
            }
            keys.push({ t: Math.round(t * 1000) / 1000, v: a.p.map((v) => Math.round(v * 1000) / 1000) });
          }
        }
        d.post({ type: 'studio:timeline/code-points', id: msg.id, keys });
      }
    },
    frame: draw,
    clear() {
      path = null;
      drag = null;
      draw();
    },
  };
}
