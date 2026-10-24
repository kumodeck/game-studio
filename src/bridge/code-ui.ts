// The UI the game draws in its canvas, in the game page (studio-canvas-ui, 2026-10-24; CONTRACT.md §1.13).
//
// A request that day: "I want to edit the UI drawn INSIDE the canvas, not only the HTML UI, as UI." The game's code
// says where each one is once (codeUi() in the loader: the AI rewrites the drawing so it reads box() / look() / value());
// this file is the editor's hands on them:
//   - one Port2D over the codeUi list (objects / get / set / bounds / render), MERGED with the HTML UI's port into ONE
//     list (mergeUiPorts: top of the screen first; a key both have = the HTML one, said once) — the person thinks
//     "the score", not "the canvas score", so the frame, the strip, the card and the list are the HTML UI's, unchanged;
//   - render = the game draws ONE frame with time stopped (core time.step(), or the game's studio.redraw(fn)): the
//     UI is part of the game's picture, so only the game can draw it again;
//   - the card's rows from `look` (only what the code gave), its states and sample values (props / handle);
//   - the world darkened around the boxes only (a board with box-shaped holes over the UI's canvas: the UI is usually
//     drawn in a canvas of its own over the world, or in the world's own canvas, so no layer can go between them);
//   - while one is dragged: where it was (dotted) and how far it is from the nearest of the 9 places ("20 px from the top
//     middle"), the place it will keep to on every window size (Q2 = a, 2026-10-24);
//   - the AI's `ui.code`: each box moved 40 px and drawn once — if the picture did not follow, the AI is told (and only
//     the AI: decision 8), so a rewrite that misses box() never reaches the person as "it is selected but does not move".
//
// Nothing here is the game's code: the editor's values live on the codeUi entries (`live`) while editing; Play in the
// same page draws them (the person's draft), a reload forgets them, the file (placement.json `ui.<id>` with `code`)
// keeps them until the AI writes them into the code on Save.
import type { BridgeToShell, CodeUiInfo, Port2D, Pose, ShellToBridge, UiProps, UiState, UiStyleSet } from '../contract.ts';
import type { Core } from '../core/index.ts';

/** A codeUi entry as the loader keeps it (src/loader/studio-placement.js codeUi). The methods are the game's copy's. */
interface Entry {
  id: string;
  name: string;
  kind: string;
  at: { from: string; x: number; y: number };
  scale: number;
  look: Record<string, string | number>;
  states: Partial<Record<UiState, { color?: string; background?: string }>>;
  sample: string | null;
  round: boolean;
  live: Live | null;
  canvas(): HTMLCanvasElement | null;
  box(): { x: number; y: number; w: number; h: number; s: number; W: number; H: number; k: number; ky: number };
  lookNow(st?: UiState | null): Record<string, string | number>;
  atNow(): { from: string; at: [number, number]; scale: number };
}
interface Live {
  p: number[];
  s: number;
  set?: UiStyleSet;
  state: UiState | null;
  sample: string | null;
}

const LIST = Symbol.for('game-studio.codeUis');
const FILE = Symbol.for('game-studio.codeUiFile');
const STATES: UiState[] = ['hover', 'active', 'disabled'];
const MIN_S = 0.1, MAX_S = 10;
/** How far `ui.code` moves each box to see that its picture follows (decision 8). */
const PROBE_PX = 40;

/** The game's codeUi entries (none = []). */
export function codeUiEntries(win: Window): Entry[] {
  const m = (win as unknown as Record<symbol, unknown>)[LIST];
  return m instanceof Map ? (Array.from(m.values()) as Entry[]).filter((e) => e && typeof e.box === 'function' && typeof e.atNow === 'function') : [];
}

// ---- words of the 9 places (the line while dragging; the editor's own words, not the shell's i18n: drawn in the game page)
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

export interface CodeUiDeps {
  win: Window;
  core: Core;
  post(msg: BridgeToShell): void;
  lang(): 'ja' | 'en';
  /** studio.redraw(fn): the game's own one-frame draw, when it gave one. */
  redraw(): (() => void) | null;
  /** Keys an HTML element already uses (data-studio-key): those codeUis are not listed (the HTML one is). */
  domKeys(): Set<string>;
}

export interface CodeUi {
  /** The Port2D over the listed codeUis (for mergeUiPorts). */
  port: Port2D;
  has(key: string): boolean;
  props(key: string): UiProps | null;
  /** A studio:ui/* message about a codeUi key (set / sample / state / props-get / code-check / code-clear); false = not ours. */
  handle(msg: ShellToBridge): boolean;
  begin(): void;
  end(): void;
  /** Every editor frame: draw the game once when something changed; the board, the line; the list for the shell. */
  frame(o: { ui: boolean; editing: boolean; inHand: string[] }): void;
}

/** The codeUi side of the UI seat, or null when the game has none (then nothing changes for it). */
export function createCodeUi(d: CodeUiDeps): CodeUi | null {
  const { win } = d;
  const doc = win.document;
  if (!codeUiEntries(win).length) return null;
  const told = new Set<string>();
  // The codeUis listed: not an HTML key (said once — to the console and to the AI's `ui.code`).
  const listed = (): Entry[] => {
    const dom = d.domKeys();
    return codeUiEntries(win).filter((e) => {
      if (!dom.has(e.id)) return true;
      if (!told.has(e.id)) {
        told.add(e.id);
        console.info(`[studio] codeUi('${e.id}'): an HTML element has data-studio-key="${e.id}" too — the HTML one is listed. Give one of them another key.`);
      }
      return false;
    });
  };
  const byId = (key: string) => listed().find((e) => e.id === key) ?? null;
  let dirty = false;
  let infoDirty = true;
  let editingNow = false;

  /** The editor's values on the entry, made from the file's (or the code's) the first time. */
  const live = (e: Entry): Live => {
    if (e.live && Array.isArray(e.live.p)) return e.live;
    const fm = (win as unknown as Record<symbol, unknown>)[FILE];
    const f = fm instanceof Map ? (fm.get(e.id) as { p: number[]; s: number; set?: UiStyleSet } | undefined) : undefined;
    e.live = { p: f ? f.p.slice() : [0, 0], s: f ? f.s : 1, ...(f?.set ? { set: structuredClone(f.set) } : {}), state: null, sample: null };
    return e.live;
  };
  const changed = () => {
    dirty = true;
    infoDirty = true;
  };
  /** The game draws one frame now (time stopped). */
  const drawNow = () => {
    dirty = false;
    const fn = d.redraw();
    if (fn) {
      try {
        fn();
      } catch (err) {
        console.warn('[studio] studio.redraw failed:', err);
      }
      return;
    }
    d.core.time.step();
  };

  /** The canvas's place on screen and its units → CSS px. */
  const screenOf = (e: Entry) => {
    const c = e.canvas();
    const r = c ? c.getBoundingClientRect() : ({ left: 0, top: 0, width: win.innerWidth, height: win.innerHeight } as DOMRect);
    const b = e.box();
    const sx = b.W > 0 ? r.width / b.W : 1, sy = b.H > 0 ? r.height / b.H : 1;
    return { r, b, sx, sy };
  };
  const boundsOf = (e: Entry) => {
    const { r, b, sx, sy } = screenOf(e);
    return { x: r.left + b.x * sx, y: r.top + b.y * sy, w: b.w * sx, h: b.h * sy };
  };

  const port: Port2D = {
    name: 'canvas-ui',
    // Top of the screen first (then left first): the list reads like the screen.
    objects() {
      const tops = new Map(listed().map((e) => {
        const b = boundsOf(e);
        return [e.id, [Math.round(b.y), Math.round(b.x)]] as const;
      }));
      return listed().sort((a, b) => tops.get(a.id)![0]! - tops.get(b.id)![0]! || tops.get(a.id)![1]! - tops.get(b.id)![1]!)
        // 'named': the list says `name` (the code's word for it), not the key in words as for an HTML element.
        .map((e) => ({ key: e.id, label: e.name, kinds: ['ui', e.kind === 'bar' ? 'bar' : e.kind === 'button' ? 'button' : e.kind === 'image' ? 'image' : 'text', 'named'], rotatable: false }));
    },
    get(key) {
      const e = byId(key);
      if (!e) return null;
      const l = live(e);
      return { p: [l.p[0]!, l.p[1]!], r: 0, s: l.s };
    },
    set(key, pose: Pose) {
      const e = byId(key);
      if (!e) return;
      const l = live(e);
      const raw = Array.isArray(pose.s) ? pose.s[0] : pose.s;
      l.s = Math.min(MAX_S, Math.max(MIN_S, typeof raw === 'number' && Number.isFinite(raw) ? raw : l.s));
      l.p = [Number(pose.p[0]) || 0, Number(pose.p[1]) || 0];
      changed();
    },
    parentToScreen(key) {
      const e = byId(key);
      if (!e) return null;
      const l = live(e);
      const { r, b, sx, sy } = screenOf(e);
      const a = sx * b.k, dd = sy * b.ky;
      return [a, 0, 0, dd, r.left + (b.x + b.w / 2) * sx - a * l.p[0]!, r.top + (b.y + b.h / 2) * sy - dd * l.p[1]!];
    },
    bounds(key) {
      const e = byId(key);
      return e ? boundsOf(e) : null;
    },
    render() {
      if (dirty && d.core.time.frozen) drawNow();
    },
    canvas: () => null,
    capture: async () => null,
    // A round button's outline is a circle (the light's hole is too).
    silhouette(keys) {
      const es = keys.map(byId);
      if (es.length !== 1 || !es[0] || !es[0].round) return null;
      const bb = boundsOf(es[0]);
      const m = doc.createElement('canvas');
      m.width = Math.max(1, Math.ceil(bb.w));
      m.height = Math.max(1, Math.ceil(bb.h));
      const x = m.getContext('2d');
      if (!x) return null;
      x.beginPath();
      x.ellipse(m.width / 2, m.height / 2, m.width / 2, m.height / 2, 0, 0, Math.PI * 2);
      x.fill();
      return { x: bb.x, y: bb.y, w: bb.w, h: bb.h, mask: m };
    },
  };

  // ---------------------------------------------------------------- the card (the HTML UI's rows, from `look`)
  const was = (e: Entry): UiStyleSet => {
    const w: Record<string, unknown> = {};
    for (const n of ['text', 'fontSize', 'color', 'background'] as const) if (e.look[n] !== undefined) w[n] = e.look[n];
    for (const s of STATES) if (e.states[s] && Object.keys(e.states[s]!).length) w[`@${s}`] = { ...e.states[s] };
    return w as UiStyleSet;
  };
  const props = (key: string): UiProps | null => {
    const e = byId(key);
    if (!e) return null;
    const l = live(e);
    const now = e.lookNow(l.state);
    const has = (n: string) => e.look[n] !== undefined;
    const button = e.kind === 'button' && STATES.some((s) => e.states[s] && Object.keys(e.states[s]!).length);
    const txt = e.kind === 'text' || e.kind === 'button' || e.kind === 'box';
    return {
      key,
      state: l.state,
      button,
      text: has('text') ? String(now.text ?? '') : null,
      fontSize: has('fontSize') && typeof now.fontSize === 'number' ? now.fontSize : null,
      color: has('color') || (l.state && e.states[l.state]?.color !== undefined) ? String(now.color ?? '') || null : null,
      background: has('background') || (l.state && e.states[l.state]?.background !== undefined) ? String(now.background ?? '') || null : null,
      was: was(e),
      // A bar's samples are full / half / empty (the card says them in words); a text's are the HTML UI's.
      sample: e.kind === 'bar' ? { now: l.sample, value: true, bar: true } : txt && (e.sample !== null || has('text')) ? { now: l.sample, value: true, ...(e.sample ? { hint: e.sample } : {}) } : null,
    };
  };
  const postProps = (key: string) => {
    const p = props(key);
    if (p) d.post({ type: 'studio:ui/props', props: p });
  };
  const setLook = (e: Entry, name: string, value: string | number | null, state?: UiState) => {
    const l = live(e);
    const set = (l.set ??= {}) as Record<string, unknown>;
    if (state) {
      if (name !== 'color' && name !== 'background') return;
      const o = ((set[`@${state}`] as Record<string, unknown> | undefined) ??= {});
      if (value === null) delete o[name];
      else o[name] = value;
      if (!Object.keys(o).length) delete set[`@${state}`];
    } else if (value === null) delete set[name];
    else set[name] = name === 'fontSize' ? Math.max(1, Math.min(500, Number(value) || 0)) : String(value).slice(0, 200);
    changed();
  };

  // ---------------------------------------------------------------- the list for the shell (the file's from / at)
  const info = (): CodeUiInfo[] => listed().map((e) => {
    const a = e.atNow();
    const b = e.box();
    const bb = boundsOf(e);
    return { key: e.id, name: e.name, kind: e.kind, from: a.from, at: a.at, scale: a.scale, code: { ...e.at, scale: e.scale },
      look: Object.keys(e.look), box: [Math.round(bb.x), Math.round(bb.y), Math.round(bb.w), Math.round(bb.h)],
      size: [Math.round(b.w * 10) / 10, Math.round(b.h * 10) / 10], frame: [b.W, b.H, b.k, b.ky] };
  });
  const postInfo = () => {
    infoDirty = false;
    const dom = d.domKeys();
    d.post({ type: 'studio:ui/codes', list: info(), clash: codeUiEntries(win).filter((e) => dom.has(e.id)).map((e) => e.id) });
  };

  // ---------------------------------------------------------------- decision 8: does the picture follow the box?
  const check = (key: string): { key: string; ok: boolean; why?: string; note?: string } => {
    const all = codeUiEntries(win);
    const e = byId(key);
    if (!e) {
      if (all.some((x) => x.id === key)) return { key, ok: false, why: `an HTML element has data-studio-key="${key}" too, so the editor lists the HTML one: give codeUi('${key}') another id` };
      return { key, ok: false, why: `the game has no codeUi('${key}') (it has: ${all.length ? all.map((x) => `'${x.id}'`).join(', ') : 'none'})` };
    }
    const c = e.canvas();
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = c ? (c.getContext('2d') as CanvasRenderingContext2D | null) : null;
    } catch {
      ctx = null;
    }
    if (!c || !ctx || !c.width || !c.height) return { key, ok: true, note: 'not measured (it is not drawn in a 2D canvas)' };
    if (!d.core.time.frozen && !d.redraw()) return { key, ok: true, note: 'not measured (the game was running)' };
    const read = () => {
      try {
        return ctx!.getImageData(0, 0, c.width, c.height).data;
      } catch {
        return null;
      }
    };
    const l = live(e);
    const p0 = l.p.slice();
    drawNow();
    const before = read();
    const b0 = e.box();
    l.p = [p0[0]! + PROBE_PX, p0[1]!];
    drawNow();
    const after = read();
    const b1 = e.box();
    l.p = p0;
    drawNow();
    if (!before || !after) return { key, ok: true, note: 'not measured (the canvas cannot be read)' };
    // Units → canvas px.
    const u = b0.W > 0 ? c.width / b0.W : 1, v = b0.H > 0 ? c.height / b0.H : 1;
    const rect = (b: typeof b0, pad: number) => [Math.max(0, Math.floor(b.x * u) - pad), Math.max(0, Math.floor(b.y * v) - pad), Math.min(c.width, Math.ceil((b.x + b.w) * u) + pad), Math.min(c.height, Math.ceil((b.y + b.h) * v) + pad)] as const;
    // A pixel changed: its colour or its cover by more than a soft shadow's (24 of 255).
    const diff = (i: number) => Math.abs(before[i]! - after[i]!) + Math.abs(before[i + 1]! - after[i + 1]!) + Math.abs(before[i + 2]! - after[i + 2]!) > 48 || Math.abs(before[i + 3]! - after[i + 3]!) > 24;
    const count = (x0: number, y0: number, x1: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (diff((y * c.width + x) * 4)) n++;
      return n;
    };
    const [ax0, ay0, ax1, ay1] = rect(b0, 0), [bx0, by0, bx1, by1] = rect(b1, 0);
    if (count(ax0, ay0, ax1, ay1) < 4 || count(bx0, by0, bx1, by1) < 4) {
      return { key, ok: false, why: `moving it ${PROBE_PX} px changed nothing on screen: the drawing does not read codeUi('${key}').box() — draw it at box().x / box().y (× box().s), then send ui.code again` };
    }
    // What is drawn, from the pixels that changed around both boxes: wider / taller than the box = the box is too small
    // (the frame would not cover it, a press beside it would miss).
    const pad = Math.round(Math.max(b0.w * u, b0.h * v) * 0.5) + 8;
    const [sx0, sy0] = rect(b0, pad), [, , sx1, sy1] = rect(b1, pad);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) {
      if (!diff((y * c.width + x) * 4)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const shift = (b1.x - b0.x) * u;
    const drawnW = (maxX - minX + 1 - shift) / u, drawnH = (maxY - minY + 1) / v;
    const slack = 4;
    if (Number.isFinite(drawnW) && (drawnW > b0.w + slack || drawnH > b0.h + slack)) {
      return { key, ok: false, why: `the box is smaller than what is drawn (${Math.round(b0.w)}×${Math.round(b0.h)}, drawn ${Math.round(drawnW)}×${Math.round(drawnH)}): make size() cover the whole drawing, then send ui.code again` };
    }
    return { key, ok: true };
  };

  // ---------------------------------------------------------------- the board (the world darker around the boxes) and the line
  const boards = new Map<HTMLCanvasElement, SVGSVGElement>();
  const NS = 'http://www.w3.org/2000/svg';
  let boardKey = '';
  const paintBoards = (on: boolean) => {
    if (!on) {
      for (const s of boards.values()) s.remove();
      boards.clear();
      for (const c of Array.from(doc.querySelectorAll('canvas[data-studio-ui-canvas]'))) c.removeAttribute('data-studio-ui-canvas');
      boardKey = '';
      return;
    }
    const es = listed();
    const byCanvas = new Map<HTMLCanvasElement, Entry[]>();
    for (const e of es) {
      const c = e.canvas();
      if (c) byCanvas.set(c, [...(byCanvas.get(c) ?? []), e]);
    }
    const shapes = [...byCanvas].map(([c, list]) => {
      const r = c.getBoundingClientRect();
      return { c, r, holes: list.map((e) => ({ b: boundsOf(e), round: e.round })) };
    });
    const sig = JSON.stringify(shapes.map((s) => [s.r.left, s.r.top, s.r.width, s.r.height, s.holes.map((h) => [Math.round(h.b.x), Math.round(h.b.y), Math.round(h.b.w), Math.round(h.b.h), h.round])]));
    if (sig === boardKey) return;
    boardKey = sig;
    for (const [c, s] of boards) if (!byCanvas.has(c)) (s.remove(), boards.delete(c));
    // The canvases the boards cover (the UI's own, and a world canvas under it) are not dimmed by the layer's filter
    // too (editor.ts paintLayers): one darkening, the board's.
    for (const c of Array.from(doc.querySelectorAll('canvas'))) {
      const r = c.getBoundingClientRect();
      const under = shapes.some((s) => r.left >= s.r.left - 1 && r.top >= s.r.top - 1 && r.right <= s.r.right + 1 && r.bottom <= s.r.bottom + 1);
      if (under || byCanvas.has(c)) c.setAttribute('data-studio-ui-canvas', '');
      else c.removeAttribute('data-studio-ui-canvas');
    }
    for (const s of shapes) {
      let svg = boards.get(s.c);
      if (!svg || !svg.isConnected) {
        svg = doc.createElementNS(NS, 'svg') as SVGSVGElement;
        svg.setAttribute('data-studio-ui-board', '');
        svg.setAttribute('aria-hidden', 'true');
        // Right after the UI's canvas, in its stacking: over the game's picture, under the HTML UI that comes later.
        const z = win.getComputedStyle(s.c).zIndex;
        svg.setAttribute('style', `position:fixed;pointer-events:none;margin:0;padding:0;border:0;${z && z !== 'auto' ? `z-index:${z};` : ''}`);
        svg.appendChild(doc.createElementNS(NS, 'path'));
        s.c.after(svg);
        boards.set(s.c, svg);
      }
      const { left, top, width, height } = s.r;
      Object.assign(svg.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      const holes = s.holes.map(({ b, round }) => {
        const x = b.x - left - 3, y = b.y - top - 3, w = b.w + 6, h = b.h + 6;
        if (round) return `M${x + w / 2},${y}a${w / 2},${h / 2} 0 1,0 0.01,0z`;
        return `M${x},${y}h${w}v${h}h${-w}z`;
      }).join('');
      const path = svg.firstChild as SVGPathElement;
      path.setAttribute('d', `M0,0H${width}V${height}H0z${holes}`);
      path.setAttribute('fill-rule', 'evenodd');
      path.setAttribute('fill', 'rgba(0,0,0,.15)');
    }
  };

  /**
   * The canvases that hold codeUis OVER another canvas (a HUD canvas over the 3D world) are the UI layer's, like HTML UI:
   * marked while editing, so the editor's layer style hides them on the world (faded with the eye) and the three.js
   * adapter leaves them alone. A codeUi in the world's own canvas (one canvas for everything) is never hidden.
   */
  const markOverlays = (on: boolean) => {
    for (const c of Array.from(doc.querySelectorAll('canvas[data-studio-ui-layer]'))) c.removeAttribute('data-studio-ui-layer');
    if (!on) return;
    const all = Array.from(doc.querySelectorAll('canvas'));
    for (const e of listed()) {
      const c = e.canvas();
      if (!c) continue;
      const r = c.getBoundingClientRect();
      const over = all.some((o) => {
        if (o === c) return false;
        const q = o.getBoundingClientRect();
        return q.width * q.height > 0 && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top;
      });
      if (over) c.setAttribute('data-studio-ui-layer', '');
    }
  };

  // The line and the words while one is dragged; where it was (dotted).
  let line: SVGSVGElement | null = null;
  const lastBounds = new Map<string, { x: number; y: number; w: number; h: number }>();
  const startBounds = new Map<string, { x: number; y: number; w: number; h: number }>();
  const paintLine = (keys: string[]) => {
    const es = keys.map(byId).filter((e): e is Entry => !!e);
    if (es.length !== 1) {
      line?.remove();
      line = null;
      startBounds.clear();
      return;
    }
    const e = es[0]!;
    if (!startBounds.has(e.id)) startBounds.set(e.id, lastBounds.get(e.id) ?? boundsOf(e));
    const was0 = startBounds.get(e.id)!;
    const c = e.canvas();
    const r = c ? c.getBoundingClientRect() : ({ left: 0, top: 0, width: win.innerWidth, height: win.innerHeight, right: win.innerWidth, bottom: win.innerHeight } as DOMRect);
    const a = e.atNow();
    const bb = boundsOf(e);
    if (!line || !line.isConnected) {
      line = doc.createElementNS(NS, 'svg') as SVGSVGElement;
      line.setAttribute('data-studio-ui-line', '');
      line.setAttribute('aria-hidden', 'true');
      line.setAttribute('style', 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;overflow:visible');
      (doc.body || doc.documentElement).appendChild(line);
    }
    // The point of the canvas it is measured from, and the box's point facing it.
    const [hz, v] = a.from === 'center' ? ['m', 'm'] : a.from === 'left' ? ['l', 'm'] : a.from === 'right' ? ['r', 'm'] : a.from === 'top' ? ['m', 't'] : a.from === 'bottom' ? ['m', 'b'] : [a.from.endsWith('left') ? 'l' : 'r', a.from.startsWith('top') ? 't' : 'b'];
    const ax = hz === 'l' ? r.left : hz === 'r' ? r.right : r.left + r.width / 2, ay = v === 't' ? r.top : v === 'b' ? r.bottom : r.top + r.height / 2;
    const bx = hz === 'l' ? bb.x : hz === 'r' ? bb.x + bb.w : bb.x + bb.w / 2, by = v === 't' ? bb.y : v === 'b' ? bb.y + bb.h : bb.y + bb.h / 2;
    const words = placeWords(a.from, a.at, d.lang());
    const accent = '#ff8a3d';
    const tw = Math.max(60, words.length * (d.lang() === 'ja' ? 12 : 6.6) + 16);
    // Left of the box when there is room (the editor's card floats over the right of the game), else right of it; on the
    // box's middle line, under the line's end.
    const lx = bb.x - tw - 10 >= 4 ? bb.x - tw - 10 : Math.min(win.innerWidth - tw - 4, bb.x + bb.w + 10);
    const ly = Math.min(win.innerHeight - 24, Math.max(4, bb.y + bb.h / 2 - 10));
    line.innerHTML = `<rect x="${was0.x}" y="${was0.y}" width="${was0.w}" height="${was0.h}" rx="4" fill="none" stroke="${accent}" stroke-width="1.5" stroke-dasharray="5 4" opacity=".75"/>`
      + `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${accent}" stroke-width="1" stroke-dasharray="3 3"/>`
      + `<circle cx="${ax}" cy="${ay}" r="3" fill="${accent}"/>`
      + `<g transform="translate(${lx},${ly})"><rect width="${tw}" height="20" rx="5" fill="rgba(20,20,24,.92)" stroke="${accent}" stroke-width="1"/>`
      + `<text x="8" y="14" font-family="system-ui,-apple-system,'Hiragino Sans',sans-serif" font-size="11" fill="#ffd2b0"></text></g>`;
    line.querySelector('text')!.textContent = words;
    line.setAttribute('data-from', a.from);
    line.setAttribute('data-words', words);
  };

  return {
    port,
    has: (key) => !!byId(key),
    props,
    handle(msg) {
      switch (msg.type) {
        case 'studio:ui/code-check': {
          const results = msg.keys.map(check);
          infoDirty = true;
          d.post({ type: 'studio:ui/code-checked', id: msg.id, results });
          return true;
        }
        case 'studio:ui/code-clear': {
          const fm = (win as unknown as Record<symbol, unknown>)[FILE];
          if (fm instanceof Map) fm.delete(msg.key);
          const e = codeUiEntries(win).find((x) => x.id === msg.key);
          if (e) e.live = { p: [0, 0], s: 1, state: null, sample: null };
          changed();
          return true;
        }
        case 'studio:ui/set':
        case 'studio:ui/sample':
        case 'studio:ui/state':
        case 'studio:ui/props-get': {
          const key = msg.key;
          const e = key ? byId(key) : null;
          if (!e) {
            // A state shown on an HTML element: one at a time, so a codeUi's goes back to normal.
            if (msg.type === 'studio:ui/state') for (const x of listed()) if (x.live?.state) (x.live.state = null, changed());
            return false;
          }
          if (msg.type === 'studio:ui/set') {
            if (msg.name === 'text' || msg.name === 'fontSize' || msg.name === 'color' || msg.name === 'background') setLook(e, msg.name, msg.value, msg.state && STATES.includes(msg.state) ? msg.state : undefined);
            if (!msg.quiet) postProps(e.id);
          } else if (msg.type === 'studio:ui/sample') {
            live(e).sample = typeof msg.text === 'string' ? msg.text.slice(0, 200) : null;
            changed();
            postProps(e.id);
          } else if (msg.type === 'studio:ui/state') {
            for (const x of listed()) if (x !== e && x.live?.state) x.live.state = null;
            live(e).state = msg.state && STATES.includes(msg.state) ? msg.state : null;
            changed();
            postProps(e.id);
          } else postProps(e.id);
          return true;
        }
        default:
          return false;
      }
    },
    begin() {
      editingNow = true;
      for (const e of listed()) live(e);
      markOverlays(true);
      changed();
      postInfo();
    },
    end() {
      editingNow = false;
      // The looks shown and the samples were for editing; the moves and the card's changes stay (the draft Play shows).
      for (const e of codeUiEntries(win)) if (e.live) (e.live.state = null, e.live.sample = null);
      paintBoards(false);
      paintLine([]);
      markOverlays(false);
      changed();
      if (d.core.time.frozen) drawNow();
    },
    frame(o) {
      if (dirty && d.core.time.frozen) drawNow();
      paintBoards(editingNow && o.editing && o.ui);
      const hand = o.ui && o.editing ? o.inHand.filter((k) => !!byId(k)) : [];
      paintLine(hand);
      if (!hand.length) for (const e of listed()) lastBounds.set(e.id, boundsOf(e));
      // The list for the file (from / at) once a gesture is over (not 60 times a second while dragging).
      if (infoDirty && editingNow && !hand.length) postInfo();
    },
  };
}

/**
 * The UI seat's ONE list (CONTRACT.md §1.1, 2026-10-24): the HTML UI's port and the codeUi port as one Port2D. Each key
 * goes to the port that lists it. The order is the screen's, top first (then left first), so a canvas score at the top
 * sits above an HTML button at the bottom — only when the game has codeUis: an HTML-only game keeps its page order.
 */
export function mergeUiPorts(dom: Port2D | null, code: Port2D): Port2D {
  if (!dom) return code;
  let owner = new Map<string, Port2D>();
  const of = (key: string) => owner.get(key) ?? (code.get(key) ? code : dom);
  return {
    name: dom.name,
    objects() {
      const a = dom.objects(), b = code.objects();
      owner = new Map([...b.map((o) => [o.key, code] as const), ...a.map((o) => [o.key, dom] as const)]);
      const all = [...a, ...b];
      const top = new Map(all.map((o) => {
        const r = (owner.get(o.key) ?? dom).bounds(o.key);
        return [o.key, r ? [Math.round(r.y), Math.round(r.x)] : [Infinity, Infinity]] as const;
      }));
      return all.sort((x, y) => top.get(x.key)![0]! - top.get(y.key)![0]! || top.get(x.key)![1]! - top.get(y.key)![1]!);
    },
    get: (key) => of(key).get(key),
    set: (key, pose) => of(key).set(key, pose),
    parentToScreen: (key) => of(key).parentToScreen(key),
    bounds: (key) => of(key).bounds(key),
    render() {
      dom.render();
      code.render();
    },
    canvas: () => null,
    capture: async () => null,
    silhouette: (keys) => (keys.every((k) => of(k) === code) && code.silhouette ? code.silhouette(keys) : null),
    pause: () => dom.pause?.(),
    resume: () => dom.resume?.(),
  };
}
