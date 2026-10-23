// Adapter self-check.
//
// Most adapters will be written by the user's AI agent for one specific game.
// A wrong adapter fails in quiet ways ("nothing can be selected", "the handle
// moves but the picture does not"), which a person cannot diagnose. So right
// after an adapter is found the bridge runs a few cheap tests on one object,
// puts it back exactly, and reports which promise is broken. The shell shows
// the result; the host hands it to the AI (local: .studio/check.md).
import { KEY_RE, type SelfCheckResult, type StudioAdapter, type Pose } from '../contract.ts';
import type { Core } from '../core/index.ts';

type Check = SelfCheckResult['checks'][number];

/** Largest visible canvas: the one the game most likely draws into. */
export function mainCanvas(doc: Document): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  let area = 0;
  for (const c of Array.from(doc.querySelectorAll('canvas'))) {
    if (c.dataset.studio === 'ui') continue;
    const r = c.getBoundingClientRect();
    const a = r.width * r.height;
    if (a > area) {
      area = a;
      best = c;
    }
  }
  return best;
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * What the canvas shows inside `box` (CSS px of the game's page; null = the whole canvas), as RGBA pixels at the
 * canvas's own resolution, scaled down only when the box is larger than SNAP px a side.
 *
 * WHY a box and not the whole picture (Ive review N1 / W1-5, 2026-10-17): this used to shrink the whole canvas to
 * 32×32 and compare hashes. In the editor's camera on a phone (390–400 px wide, the world zoomed out) a 40 px test
 * move of a small object is ~10 screen px, about a third of one of those 32 cells, and the shrink (bilinear, no
 * mipmaps) samples only a few source pixels per cell, so the move vanished. Our own Firefly Ruins then showed
 * "This game's adapter needs a fix" on phones and in the 400 px side window. Cropping around the object keeps
 * its pixels, so any real change shows.
 *
 * Read right after render() in the same task: WebGL without preserveDrawingBuffer is still readable then.
 */
const SNAP = 96;
function snapshot(win: Window, canvas: HTMLCanvasElement | null, box: Box | null): Uint8ClampedArray | null {
  if (!canvas || !canvas.width || !canvas.height) return null;
  try {
    const cr = canvas.getBoundingClientRect();
    if (!(cr.width > 0 && cr.height > 0)) return null;
    const kx = canvas.width / cr.width, ky = canvas.height / cr.height;
    let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
    if (box) {
      const x0 = Math.max(cr.left, box.x), y0 = Math.max(cr.top, box.y);
      const x1 = Math.min(cr.right, box.x + box.w), y1 = Math.min(cr.bottom, box.y + box.h);
      // The object is off the canvas: fall back to the whole picture rather than read nothing.
      if (x1 - x0 >= 2 && y1 - y0 >= 2) {
        sx = Math.floor((x0 - cr.left) * kx);
        sy = Math.floor((y0 - cr.top) * ky);
        sw = Math.max(1, Math.ceil((x1 - x0) * kx));
        sh = Math.max(1, Math.ceil((y1 - y0) * ky));
      }
    }
    const f = Math.min(1, SNAP / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * f)), h = Math.max(1, Math.round(sh * f));
    const c = win.document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(canvas, sx, sy, sw, sh, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  } catch {
    return null; // tainted canvas (cross-origin image without CORS): cannot read
  }
}

/** One colour everywhere: we could not read what was drawn (WebGL cleared once presented), not a real picture. */
function uniform(d: Uint8ClampedArray): boolean {
  for (let i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) return false;
  return true;
}

/**
 * Did the picture change? Pixels whose colour moved by more than 4 (of 255) in any channel. One is enough: the
 * game is frozen while editing, so two draws of the same scene are the same pixels; 4 only absorbs GPU dithering.
 */
function changed(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 4) return true;
  return false;
}

/** The two boxes together, a few px larger (an outline or soft edge drawn just outside the box counts too). */
function union(a: Box | undefined, b: Box | undefined): Box | null {
  if (!a || !b) return a || b ? pad(a || b!) : null;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return pad({ x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y });
}
const pad = (r: Box): Box => ({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 });
/** Without a box from the adapter: a square of its size around the pivot. */
const boxOf = (a: ReturnType<StudioAdapter['anchor']>): Box | undefined =>
  !a ? undefined : a.rect || { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };

/** Wait for two real frames: adapters that repaint from their own loop draw by then. */
const frames = (core: Core) => new Promise<void>((r) => core.time.raf(() => core.time.raf(() => r())));

const near = (a: number[] | undefined, b: number[] | undefined, eps: number) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) <= eps);

/** The checks that move the sample object and read it back: a game still settling can spoil them once. */
const MOVING_CHECKS = new Set(['pose-roundtrip', 'screen-changes', 'anchor-follows', 'restored']);
/** How long the editor waits before the second look (bridge/editor.ts): 1.2 s ≈ a slow first second of a game. */
export const SECOND_LOOK_MS = 1200;

/**
 * Is a failed check worth running once more before telling anyone (polish-1022, 2026-10-22)? Only when everything
 * that failed is a moving check (above): "no adapter", "no objects" or bad keys do not change by waiting.
 */
export function worthASecondLook(res: SelfCheckResult): boolean {
  const failed = res.checks.filter((c) => !c.ok);
  return failed.length > 0 && failed.every((c) => MOVING_CHECKS.has(c.id));
}

export async function runSelfCheck(adapter: StudioAdapter | null, core: Core, win: Window): Promise<SelfCheckResult> {
  const checks: Check[] = [];
  const res: SelfCheckResult = { ok: false, kind: adapter ? adapter.kind : null, checks };
  if (!adapter) {
    checks.push({ id: 'adapter-found', ok: false, detail: 'No adapter answered. three.js games are found automatically; other engines need .studio/adapter.js calling studio.register2D(...).' });
    return res;
  }
  checks.push({ id: 'adapter-found', ok: true, detail: `${adapter.kind} ${adapter.version || ''}`.trim() });

  let items: ReturnType<StudioAdapter['list']> = [];
  try {
    items = adapter.list();
  } catch (e) {
    checks.push({ id: 'has-objects', ok: false, detail: `list() threw: ${(e as Error).message}` });
    return res;
  }
  checks.push({ id: 'has-objects', ok: items.length > 0, detail: `${items.length} object(s)` });
  const unnamed = items.filter((it) => it.unstable).map((it) => it.key);
  if (unnamed.length) {
    res.unnamed = unnamed.slice(0, 50);
    res.unnamedCount = unnamed.length;
  }

  const seen = new Set<string>();
  const bad = items.filter((it) => {
    const dup = seen.has(it.key);
    seen.add(it.key);
    return dup || !KEY_RE.test(it.key);
  });
  checks.push({ id: 'keys-valid', ok: bad.length === 0, detail: bad.length ? `bad or duplicate keys: ${bad.slice(0, 5).map((b) => JSON.stringify(b.key)).join(', ')}` : undefined });

  // Pick an object that is on screen and not huge (a ground plane moved by a
  // few px may not change a 32×32 fingerprint in a meaningful way). On screen =
  // its centre inside the window: `visible` alone also allows a margin of a
  // screen round it, and a 2D game opened on its own picture on a phone (port2d
  // home(), the second design review's ⑩, 2026-10-19) has objects just off the
  // edge — Firefly Ruins' bell — whose move draws nothing, so the check failed
  // on our own sample. Objects with the centre off screen are the fallback.
  const inView = (it: (typeof items)[number]) => {
    const a = adapter.anchor(it.key);
    return !!a && a.visible && a.size > 4 && a.center[0] >= 0 && a.center[1] >= 0 && a.center[0] <= win.innerWidth && a.center[1] <= win.innerHeight;
  };
  // Not the ground / road / sky when anything else is on screen (studio-blank-level, 2026-10-23): a 0.5 m move of a
  // sky dome or a 120 m road draws the same picture, and the check then blamed the game on NEON DASH-like runners.
  const sample = items.find((it) => !it.backdrop && inView(it)) || items.find(inView) || items.find((it) => {
    const a = adapter.anchor(it.key);
    return a && a.visible && a.size > 4;
  }) || items[0];
  if (!sample) {
    for (const id of ['pose-roundtrip', 'screen-changes', 'anchor-follows', 'restored'] as const) checks.push({ id, ok: false, skipped: true });
    res.ok = false;
    return res;
  }
  res.sample = sample.key;

  const canvas = mainCanvas(win.document);
  const before = clonePose(sample.pose);
  const a0 = adapter.anchor(sample.key);
  // Draw, let loop-driven adapters draw too, then draw once more and read in the same task (see snapshot()).
  const drawn = async () => {
    adapter.render();
    await frames(core);
    adapter.render();
  };
  try {
    // Move by a visible amount: 2D 40 px; 3D a fifth of the object's size on screen
    // is not known in world units, so use 0.5 units plus 10% of |p|.
    const delta = adapter.dim === '2d' ? 40 : 0.5 + Math.abs(before.p[0] || 0) * 0.1;
    const moveBy = (d: number) => {
      const moved = clonePose(before);
      moved.p[0] = (moved.p[0] || 0) + d;
      return { moved, after: adapter.setPose(sample.key, moved) };
    };
    let { moved, after } = moveBy(delta);
    let a1 = adapter.anchor(sample.key);
    // Both pictures are read around where the object was and where it went, after the move (the box is known then).
    const box = () => union(boxOf(a0), boxOf(a1));
    const pictures = async () => {
      adapter.setPose(sample.key, before);
      await drawn();
      const p0 = snapshot(win, canvas, box());
      adapter.setPose(sample.key, moved);
      await drawn();
      return [p0, snapshot(win, canvas, box())] as const;
    };
    let [fp0, fp1] = await pictures();
    // Moved behind something (Firefly Ruins' bell slides behind the giant head when moved right), the picture can
    // barely change. Try the other way before saying "nothing changed on screen".
    if (fp0 && fp1 && !changed(fp0, fp1)) {
      ({ moved, after } = moveBy(-delta));
      a1 = adapter.anchor(sample.key);
      [fp0, fp1] = await pictures();
    }
    const back = adapter.list().find((i) => i.key === sample.key)?.pose;
    const eps = adapter.dim === '2d' ? 0.11 : 0.0011;
    checks.push({
      id: 'pose-roundtrip',
      ok: !!after && near(back?.p, moved.p, eps),
      detail: after ? `asked ${fmt(moved.p)}, read back ${fmt(back?.p)}` : 'setPose returned null for a listed key',
    });
    if (!fp0 || !fp1 || (uniform(fp0) && uniform(fp1))) checks.push({ id: 'screen-changes', ok: true, skipped: true, detail: 'canvas pixels not readable here (no canvas, a cross-origin image, or WebGL cleared after drawing)' });
    else checks.push({ id: 'screen-changes', ok: changed(fp0, fp1), detail: changed(fp0, fp1) ? undefined : 'render() after setPose drew the same picture around the object: set() may write a copy, or render() does not draw' });
    const followed = !!a0 && !!a1 && Math.hypot(a1.center[0] - a0.center[0], a1.center[1] - a0.center[1]) > 0.5;
    checks.push({ id: 'anchor-follows', ok: followed, detail: followed ? undefined : 'anchor()/bounds() did not move with the object (handles would be left behind)' });
  } catch (e) {
    checks.push({ id: 'pose-roundtrip', ok: false, detail: `threw: ${(e as Error).message}` });
  } finally {
    try {
      adapter.setPose(sample.key, before);
      adapter.render();
      const end = adapter.list().find((i) => i.key === sample.key)?.pose;
      checks.push({ id: 'restored', ok: near(end?.p, before.p, 1e-6), detail: near(end?.p, before.p, 1e-6) ? undefined : `left at ${fmt(end?.p)} instead of ${fmt(before.p)}` });
    } catch (e) {
      checks.push({ id: 'restored', ok: false, detail: `threw: ${(e as Error).message}` });
    }
  }
  res.ok = checks.every((c) => c.ok);
  return res;
}

function clonePose(p: Pose): Pose {
  return { p: p.p.slice(), r: p.r, s: Array.isArray(p.s) ? p.s.slice() : p.s };
}
function fmt(p: number[] | undefined): string {
  return p ? `[${p.map((v) => Math.round(v * 1000) / 1000).join(', ')}]` : 'nothing';
}
