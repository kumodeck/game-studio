// The game's UI the editor can SEE but not select yet (studio-canvas-ui stage 2, 2026-10-24; CONTRACT.md §1.13 "Not
// delivered yet"; the canvas UI plan's decisions 9–11).
//
// Stage 1 made a UI drawn in the canvas selectable once the AI names it in the code (codeUi). Until then it is part of
// the picture, and a press on it did nothing at all — the person could not tell "not possible" from "broken". Now, on
// the UI layer:
//   - where the editor KNOWS there is UI it cannot select, a faint dotted frame with the tag "Not selectable yet"
//     (above the frame; to its right when there is no room above — the top bar's strip sits there);
//   - a press outside every UI box: a cross where it was pressed, and the shell's one line "This UI can't be selected
//     yet · ✦ Have Claude make this UI editable" (the picture round the press goes with it, for the ask's chip).
//
// What the editor KNOWS (never a guess — a "UI-looking" region that turned out to be the world would be a frame that
// selects nothing, decision 9):
//   - 'hud-canvas': a 2D canvas laid OVER the game's canvas (three.js with a HUD canvas, a Pixi HUD canvas): the lumps of
//     what is drawn in it (its non-transparent pixels), outside every codeUi box (those are selectable already);
//   - 'left-out': what the engine's adapter already leaves out because it is UI (Port2D.leftOut: Phaser's scrollFactor 0,
//     Pixi's `studio = false` layers).
// One canvas with everything in it gives nothing: the world and the UI are one picture there (bridge.ts then makes no UI
// layer either, exactly as before). The frames are not in the UI list (the list is what can be selected, decision 10).
//
// All of it is the editor's own drawing in the game page (a shadow root marked data-studio-ui, so the game's CSS cannot
// reach it and play-shot.ts's painter leaves it out), gone when editing ends.
import type { BridgeToShell, UiFound } from '../contract.ts';
import { shootPage } from './play-shot.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** CSS px per grid cell when the HUD canvas is read (4 = a 1280×800 canvas is a 320×200 grid). */
const CELL = 4;
/** A pixel counts as drawn above this alpha (of 255): a soft shadow's edge does not. */
const ALPHA = 24;
/** Lumps on one line closer than this (CSS px) are one thing: the words of "SCORE 12,480" without a box behind them. */
const SAME_LINE_GAP = 12;
/** A lump bigger than this share of its canvas is not a UI part (a full-screen tint, a vignette): left out. */
const TOO_BIG = 0.5;
/** Room kept round a codeUi box (CSS px): its anti-aliased edge is not a lump of its own. */
const BOX_PAD = 6;
/** At most this many frames (a HUD of 30 icons would be a sea of dotted lines; the AI gets the first ones as clues). */
const MAX_FOUND = 24;
/** The picture round a press that goes with the ask (CSS px; the plan's 240×160). */
export const SHOT_AREA = { w: 240, h: 160 };

// ---------------------------------------------------------------- pure parts (test/ui-found.test.ts)

/**
 * The lumps of a grid (1 = drawn): 8-neighbour connected cells → their boxes in cells [x0, y0, x1, y1] (x1 / y1
 * exclusive). One pass of union-find over the drawn cells.
 */
export function lumps(grid: Uint8Array, gw: number, gh: number): Array<[number, number, number, number]> {
  const parent = new Int32Array(gw * gh).fill(-1);
  const root = (i: number): number => {
    while (parent[i]! !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const join = (a: number, b: number) => {
    const ra = root(a), rb = root(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (!grid[i]) continue;
      parent[i] = i;
      // The cells already seen that touch this one: left, and the three above.
      if (x > 0 && grid[i - 1]) join(i, i - 1);
      if (y > 0) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < gw && grid[i - gw + dx]) join(i, i - gw + dx);
        }
      }
    }
  }
  const boxes = new Map<number, [number, number, number, number]>();
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (!grid[i]) continue;
      const r = root(i);
      const b = boxes.get(r);
      if (!b) boxes.set(r, [x, y, x + 1, y + 1]);
      else {
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x + 1 > b[2]) b[2] = x + 1;
        if (y + 1 > b[3]) b[3] = y + 1;
      }
    }
  }
  return [...boxes.values()];
}

/**
 * Boxes that are one thing: overlapping or touching, or on the same line with a gap of `lineGap` or less (the words of
 * a text drawn without a box behind it). Until nothing changes.
 */
export function mergeRects(rects: Rect[], lineGap = SAME_LINE_GAP): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  const one = (a: Rect, b: Rect) => {
    const gx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
    const gy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
    if (gx <= 1 && gy <= 1) return true;
    // The same line: they share at least half of the lower one's height.
    const shared = -gy;
    return gx <= lineGap && shared >= 0.5 * Math.min(a.h, b.h);
  };
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < out.length && !again; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (!one(out[i]!, out[j]!)) continue;
        const a = out[i]!, b = out[j]!;
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
        out.splice(j, 1);
        again = true;
        break;
      }
    }
  }
  return out;
}

/** The nearest of the 9 places of a W × H screen to a point (the chip's "bottom left"; thirds across and down). */
export function placeOf(x: number, y: number, W: number, H: number): string {
  const c = x < W / 3 ? 0 : x < (2 * W) / 3 ? 1 : 2;
  const r = y < H / 3 ? 0 : y < (2 * H) / 3 ? 1 : 2;
  return ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'][r * 3 + c]!;
}

// ---------------------------------------------------------------- the page

type Win = Window & typeof globalThis;

const visible = (win: Win, c: Element) => {
  const r = c.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = win.getComputedStyle(c);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
};
const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const zOf = (win: Win, c: Element) => {
  const z = Number(win.getComputedStyle(c).zIndex);
  return Number.isFinite(z) ? z : 0;
};

/**
 * The 2D canvases laid over another canvas of the game (the UI's own canvas): drawn above it (a higher z-index, or
 * the same and later in the page). The editor's own canvases (data-studio-ui) are not the game's.
 */
export function hudCanvases(win: Win): HTMLCanvasElement[] {
  const all = Array.from(win.document.querySelectorAll('canvas')).filter((c) => !c.hasAttribute('data-studio-ui') && visible(win, c));
  return all.filter((c) => {
    const r = c.getBoundingClientRect();
    return all.some((o) => {
      if (o === c || !overlaps(o.getBoundingClientRect(), r)) return false;
      const zc = zOf(win, c), zo = zOf(win, o);
      return zc !== zo ? zc > zo : !!(o.compareDocumentPosition(c) & 4 /* c follows o */);
    });
  });
}

/**
 * Mark the HUD canvases as the UI layer's (data-studio-ui-layer, as code-ui.ts marks a codeUi's canvas): the editor's
 * layer style then hides them while the world is edited (the eye shows them faded) and shows them on the UI layer, and
 * the three.js adapter does not hide them as "the game's DOM over the canvas" — which it did, so a HUD with nothing
 * delivered was never on screen in the editor at all (found while building this, 2026-10-24). Only 2D canvases (a
 * second WebGL canvas is not read); called by the bridge before editing starts (before the adapters hide anything).
 */
export function markHudCanvases(win: Win): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (const c of hudCanvases(win)) {
    let two = false;
    try {
      two = !!c.width && !!c.height && !!c.getContext('2d');
    } catch {
      two = false;
    }
    if (!two) continue;
    c.setAttribute('data-studio-ui-layer', '');
    out.push(c);
  }
  return out;
}

/** The lumps of what is drawn in a HUD canvas, outside `skip` (viewport CSS px), as viewport CSS px boxes. */
function canvasLumps(c: HTMLCanvasElement, skip: Rect[]): Rect[] {
  let data: Uint8ClampedArray;
  try {
    // A canvas with a WebGL context answers null here (not ours to read); an empty one has nothing drawn.
    const ctx = c.getContext('2d');
    if (!ctx || !c.width || !c.height) return [];
    data = ctx.getImageData(0, 0, c.width, c.height).data;
  } catch {
    return []; // a picture from another site made it unreadable
  }
  const r = c.getBoundingClientRect();
  const W = c.width, H = c.height;
  const gw = Math.ceil(r.width / CELL), gh = Math.ceil(r.height / CELL);
  const grid = new Uint8Array(gw * gh);
  // About one sample per CSS px (a 2× canvas is read every other pixel).
  const kx = r.width / W, ky = r.height / H;
  const step = Math.max(1, Math.round(1 / Math.max(kx, ky)));
  for (let y = 0; y < H; y += step) {
    const gy = Math.min(gh - 1, Math.floor((y * ky) / CELL));
    const row = y * W;
    for (let x = 0; x < W; x += step) {
      if (data[(row + x) * 4 + 3]! <= ALPHA) continue;
      grid[gy * gw + Math.min(gw - 1, Math.floor((x * kx) / CELL))] = 1;
    }
  }
  // What a codeUi box covers is selectable already: its cells are not lumps (the box and a few px round it).
  for (const s of skip) {
    const x0 = Math.max(0, Math.floor((s.x - BOX_PAD - r.left) / CELL)), x1 = Math.min(gw, Math.ceil((s.x + s.w + BOX_PAD - r.left) / CELL));
    const y0 = Math.max(0, Math.floor((s.y - BOX_PAD - r.top) / CELL)), y1 = Math.min(gh, Math.ceil((s.y + s.h + BOX_PAD - r.top) / CELL));
    for (let y = y0; y < y1; y++) grid.fill(0, y * gw + x0, y * gw + Math.max(x0, x1));
  }
  const boxes = lumps(grid, gw, gh).map(([x0, y0, x1, y1]) => ({ x: r.left + x0 * CELL, y: r.top + y0 * CELL, w: (x1 - x0) * CELL, h: (y1 - y0) * CELL }));
  return mergeRects(boxes).filter((b) => (b.w >= 6 || b.h >= 6) && b.w * b.h <= TOO_BIG * r.width * r.height);
}

/**
 * Everything found now: the HUD canvases' lumps (outside `skip`, the UI boxes on screen) and the adapter's left-out UI.
 * Rounded, at most MAX_FOUND, top of the screen first.
 */
export function findUi(win: Win, skip: Rect[], leftOut: Rect[]): UiFound[] {
  const out: UiFound[] = [];
  const W = win.innerWidth, H = win.innerHeight;
  for (const c of hudCanvases(win)) for (const b of canvasLumps(c, skip)) out.push({ box: [b.x, b.y, b.w, b.h], from: 'hud-canvas' });
  for (const b of leftOut) {
    if (!b || ![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w < 1 || b.h < 1 || b.w * b.h > TOO_BIG * W * H) continue;
    // Already selectable (a codeUi in front of it), or a lump of the HUD canvas already: once.
    const inside = (s: Rect) => b.x >= s.x - BOX_PAD && b.y >= s.y - BOX_PAD && b.x + b.w <= s.x + s.w + BOX_PAD && b.y + b.h <= s.y + s.h + BOX_PAD;
    if (skip.some(inside) || out.some((f) => inside({ x: f.box[0], y: f.box[1], w: f.box[2], h: f.box[3] }))) continue;
    out.push({ box: [b.x, b.y, b.w, b.h], from: 'left-out' });
  }
  return out
    .map((f) => ({ ...f, box: f.box.map((v) => Math.round(v)) as UiFound['box'] }))
    .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
    .slice(0, MAX_FOUND);
}

// ---------------------------------------------------------------- the view (frames, tags, the cross)

// The editor's own words drawn in the game page (as code-ui.ts's "20 px from the top centre"); the glossary's.
const WORDS: Record<'ja' | 'en', { tag: string }> = {
  ja: { tag: 'まだ選べません' },
  en: { tag: 'Not selectable yet' },
};

export interface UiFoundDeps {
  win: Win;
  post(msg: BridgeToShell): void;
  lang(): 'ja' | 'en';
  /** The world adapter's leftOut() boxes ([] = none). */
  leftOut(): Rect[];
  /** The UI boxes on screen now (what a press selects): their drawing is not "found". */
  boxes(): Rect[];
  /** Something on the UI layer can be selected (its list is not empty). */
  any(): boolean;
  /** The game has codeUis (its UI is drawn in its canvas, some of it delivered): a miss speaks outside frames too. */
  delivered(): boolean;
  /** Draw the world once now: a WebGL canvas keeps its picture only in the task it was drawn in (the photo). */
  render(): void;
  /** The game draws one frame of its own, time stopped (studio.redraw, else core time.step()). */
  drawGame(): void;
}

export interface UiFoundView {
  /** The frames now (worked out again first when something changed). */
  list(): UiFound[];
  /** Something changed (a UI box moved, a new page, the layer): work them out again at the next quiet frame. */
  stale(): void;
  /** Every editor frame: work out again when stale (never mid-drag), draw the frames on the UI layer, else none. */
  frame(o: { ui: boolean; editing: boolean; busy: boolean }): void;
  /** A tap on the UI layer that selected nothing: the cross and the shell's line. false = nothing to say (as before). */
  missed(x: number, y: number): boolean;
  /** The cross goes (`tell`: the shell's line too — a press in the game page; the shell's own Esc says it itself). */
  clear(tell: boolean): void;
  /** Editing ends: nothing of it stays in the game page. */
  end(): void;
}

export function createUiFound(d: UiFoundDeps): UiFoundView {
  const { win } = d;
  const doc = win.document;
  let found: UiFound[] = [];
  let sent = '';
  let stale = true;
  let lastWork = 0;
  let cross: { x: number; y: number; on: number } | null = null;
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let drawn = '';
  // The game page was resized while the game is held (the editor's panels open, the window): a game sizes its HUD canvas
  // in its resize handler, and setting a canvas's width clears it — with the game held, nothing draws it again, and the
  // HUD vanished from the picture (found while building this, 2026-10-24: the frames went with it, the HUD stayed blank).
  // So the game draws ONE frame of its own after a resize (no time passes), only in a page with a HUD canvas.
  // true at first: a resize before the editor came (the shell sizes the game's frame as it opens) went unseen.
  let resized = true;
  win.addEventListener('resize', () => {
    resized = true;
  });

  const work = () => {
    stale = false;
    lastWork = win.performance.now();
    try {
      found = findUi(win, d.boxes(), d.leftOut());
    } catch (e) {
      console.warn('[studio] looking for the game\'s UI failed:', e);
      found = [];
    }
    const sig = JSON.stringify(found);
    if (sig !== sent) {
      sent = sig;
      d.post({ type: 'studio:ui/found', found });
    }
  };

  const ensureHost = () => {
    if (host && host.isConnected) return root!;
    host = doc.createElement('game-studio-found');
    // Marked as the editor's: the painter of the ask's picture and the HUD finder leave it out.
    host.setAttribute('data-studio-ui', '');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('style', 'position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483600;pointer-events:none');
    root = host.attachShadow({ mode: 'open' });
    (doc.body || doc.documentElement).appendChild(host);
    return root;
  };
  const paint = (show: boolean) => {
    const L = WORDS[d.lang()];
    const sig = show ? JSON.stringify([found, cross, d.lang()]) : '';
    if (sig === drawn) return;
    drawn = sig;
    if (!show) {
      host?.remove();
      host = null;
      root = null;
      return;
    }
    const r = ensureHost();
    // The plan's look (mock/canvas-ui.html .nyb / .nyt): a faint white dashed frame 5 px round the lump, the tag in a
    // dark pill with a dashed edge; the frame pressed into a little brighter. A thin dark edge outside the white dashes
    // so the frame reads on a light game too (pixi-garden's pale green, 2026-10-24).
    const css = `.f{position:fixed;border:1.5px dashed rgba(255,255,255,.42);border-radius:8px;box-sizing:border-box;box-shadow:0 0 0 1px rgba(0,0,0,.22)}
.f.on{border-color:rgba(255,255,255,.85);background:rgba(255,255,255,.05)}
.t{position:fixed;font:11.5px/18px system-ui,-apple-system,'Hiragino Sans','Hiragino Kaku Gothic ProN',sans-serif;padding:0 7px;border-radius:6px;background:rgba(28,28,30,.92);border:1px dashed rgba(255,255,255,.45);color:#d6d6da;white-space:nowrap}
svg{position:fixed;left:0;top:0;overflow:visible}`;
    const parts: string[] = [];
    // The tag's size, near enough to keep it off the other frames (11.5 px type, 7 px padding a side).
    const tw = [...L.tag].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 11.5 : 6.4), 16), th = 20;
    const frames = found.map((f) => ({ x: f.box[0] - 5, y: f.box[1] - 5, w: f.box[2] + 10, h: f.box[3] + 10 }));
    const free = (r: Rect, own: number) => r.y >= 4 && r.x >= 0 && r.x + r.w <= win.innerWidth
      && !frames.some((o, j) => j !== own && r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
    found.forEach((f, i) => {
      const [x, y, w, h] = f.box;
      const on = cross && cross.on === i ? ' on' : '';
      parts.push(`<div class="f${on}" data-found="${i}" style="left:${x - 5}px;top:${y - 5}px;width:${w + 10}px;height:${h + 10}px"></div>`);
      // Above the frame; to its right when there is no room above (the top bar's strip and the game's top edge) or the
      // place above is another frame (the score's, right over the health bar: found while building this, 2026-10-24).
      const above = { x: x - 5, y: y - 5 - 22, w: tw, h: th }, right = { x: x + w + 12, y: y + h / 2 - 10, w: tw, h: th };
      const t = free(above, i) ? above : free(right, i) ? right : above.y >= 4 ? above : right;
      parts.push(`<div class="t" data-found-tag="${i}" style="left:${t.x}px;top:${t.y}px">${L.tag}</div>`);
    });
    if (cross) {
      // The cross where it was pressed: white with a dark edge, readable on any game.
      const { x, y } = cross;
      const arm = 11;
      const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
      const shape = `<circle cx="${x}" cy="${y}" r="7"/>${line(x - arm, y, x + arm, y)}${line(x, y - arm, x, y + arm)}`;
      parts.push(`<svg data-found-cross="" width="1" height="1"><g fill="none" stroke="rgba(0,0,0,.7)" stroke-width="3.5">${shape}</g><g fill="none" stroke="#fff" stroke-width="1.5">${shape}</g></svg>`);
    }
    r.innerHTML = `<style>${css}</style>${parts.join('')}`;
  };

  return {
    list() {
      if (stale) work();
      return found;
    },
    stale() {
      stale = true;
    },
    frame(o) {
      const on = o.ui && o.editing;
      // Quiet frames only (a drag redraws the HUD every frame; the frames follow when it is let go), and not more
      // often than 4 times a second; a look every 3 s besides, for a game page that changed by itself (a resize).
      const now = win.performance.now();
      if (resized && o.editing && !o.busy) {
        resized = false;
        if (hudCanvases(win).length) {
          d.drawGame();
          d.render();
        }
        stale = true;
        lastWork = 0;
      }
      if (!o.busy && (stale ? now - lastWork > 250 : on && now - lastWork > 3000)) work();
      if (!on && cross) cross = null;
      paint(on && !o.busy);
    },
    missed(x, y) {
      if (stale) work();
      if (!found.length && !d.delivered()) return false;
      const on = found.findIndex((f) => x >= f.box[0] - 5 && x <= f.box[0] + f.box[2] + 5 && y >= f.box[1] - 5 && y <= f.box[1] + f.box[3] + 5);
      cross = { x, y, on };
      drawn = '';
      paint(true);
      // The picture round the press (the ask's chip), the world drawn first in this task (a WebGL canvas's picture).
      let shot: string | undefined;
      try {
        d.render();
        const a = { x: Math.round(x - SHOT_AREA.w / 2), y: Math.round(y - SHOT_AREA.h / 2), w: SHOT_AREA.w, h: SHOT_AREA.h };
        shot = shootPage(win, (e) => e.hasAttribute('data-studio-ui') || e.tagName === 'GAME-STUDIO-PLAY', a) || undefined;
      } catch {
        shot = undefined;
      }
      d.post({ type: 'studio:ui/missing', at: [Math.round(x), Math.round(y)], place: placeOf(x, y, win.innerWidth, win.innerHeight), ...(d.any() ? {} : { none: true }), ...(shot ? { shot } : {}) });
      return true;
    },
    clear(tell) {
      if (!cross) return;
      cross = null;
      if (tell) d.post({ type: 'studio:ui/missing', at: null });
    },
    end() {
      cross = null;
      paint(false);
      stale = true;
    },
  };
}
