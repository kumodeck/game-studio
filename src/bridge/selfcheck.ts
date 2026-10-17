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

/**
 * Tiny fingerprint of what the canvas shows. Copying into a 32×32 2D canvas
 * right after render() works for WebGL too: the drawing buffer is still
 * readable within the same task even without preserveDrawingBuffer.
 */
function fingerprint(win: Window, canvas: HTMLCanvasElement | null): string | null {
  if (!canvas || !canvas.width || !canvas.height) return null;
  try {
    const c = win.document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(canvas, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    // A perfectly uniform picture means we could not read what was drawn
    // (WebGL without preserveDrawingBuffer is cleared once presented), not
    // that the game shows a blank screen: report "unreadable" instead.
    let uniform = true;
    for (let i = 4; i < d.length && uniform; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) uniform = false;
    if (uniform) return null;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (Math.imul(h, 31) + d[i]! + d[i + 1]! * 3 + d[i + 2]! * 7) | 0;
    return String(h);
  } catch {
    return null; // tainted canvas (cross-origin image without CORS): cannot read
  }
}

/** Wait for two real frames: adapters that repaint from their own loop draw by then. */
const frames = (core: Core) => new Promise<void>((r) => core.time.raf(() => core.time.raf(() => r())));

const near = (a: number[] | undefined, b: number[] | undefined, eps: number) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) <= eps);

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
  // few px may not change a 32×32 fingerprint in a meaningful way).
  const sample = items.find((it) => {
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
  try {
    adapter.render();
    await frames(core);
    const fp0 = fingerprint(win, canvas);
    // Move by a visible amount: 2D 40 px; 3D a fifth of the object's size on screen
    // is not known in world units, so use 0.5 units plus 10% of |p|.
    const moved = clonePose(before);
    const delta = adapter.dim === '2d' ? 40 : 0.5 + Math.abs(before.p[0] || 0) * 0.1;
    moved.p[0] = (moved.p[0] || 0) + delta;
    const after = adapter.setPose(sample.key, moved);
    adapter.render();
    await frames(core);
    const fp1 = fingerprint(win, canvas);
    const back = adapter.list().find((i) => i.key === sample.key)?.pose;
    const eps = adapter.dim === '2d' ? 0.11 : 0.0011;
    checks.push({
      id: 'pose-roundtrip',
      ok: !!after && near(back?.p, moved.p, eps),
      detail: after ? `asked ${fmt(moved.p)}, read back ${fmt(back?.p)}` : 'setPose returned null for a listed key',
    });
    if (fp0 == null || fp1 == null) checks.push({ id: 'screen-changes', ok: true, skipped: true, detail: 'canvas pixels not readable here (no canvas, a cross-origin image, or WebGL cleared after drawing)' });
    else checks.push({ id: 'screen-changes', ok: fp0 !== fp1, detail: fp0 === fp1 ? 'render() after setPose drew the same picture: set() may write a copy, or render() does not draw' : undefined });
    const a1 = adapter.anchor(sample.key);
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
