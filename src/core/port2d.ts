// Turn a small Port2D (written per game, usually by the user's AI agent)
// into the full StudioAdapter the bridge drives.
//
// WHY the split: the hard, engine-independent parts — picking with a finger
// radius, keeping the finger offset while dragging, rotating around the pivot,
// panning/zooming the edit view, framing everything — are the same for every
// 2D engine. Putting them here means an adapter for a new engine is a page of
// direct engine calls (read/write x, y, rotation, scale; report a screen
// rectangle), which an AI can write correctly from one example and which the
// self-check can verify.
import { LIMITS, type AssetRef, type Item, type Pose, type Port2D, type StudioAdapter } from '../contract.ts';
import type { Core } from './index.ts';

type Mat = [number, number, number, number, number, number];

export function invert(m: number[]): Mat | null {
  const [a, b, c, d, e, f] = m as Mat;
  const det = a * d - b * c;
  if (!det || !Number.isFinite(det)) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
export function apply(m: number[], x: number, y: number): [number, number] {
  return [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
}
/** Normalise an angle to (-PI, PI]. */
export function wrapAngle(r: number): number {
  let a = r % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

function guessHow(url: string): AssetRef['how'] {
  const ext = url.split(/[?#]/)[0]!.split('.').pop()!.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) return 'texture';
  if (['glb', 'gltf', 'fbx', 'obj'].includes(ext)) return 'model';
  if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext)) return 'sound';
  if (['json', 'atlas'].includes(ext)) return 'atlas';
  if (['woff2', 'woff', 'ttf', 'otf'].includes(ext)) return 'font';
  return 'other';
}

/**
 * Names that say "ground / background" (en + ja). Kept short on purpose: a false
 * positive only pins one object at the back, which the person can still move by asking the AI.
 */
export const BACKDROP_NAME = /(^|[^a-z])(ground|floor|terrain|background|backdrop|bg|sky)([^a-z]|$)|地面|背景|床|地形|空$/i;

/**
 * Which objects at the back of one sibling list are the ground / background
 * (Item.backdrop). `sibs` back → front; `w` = drawn width in px at the current
 * view, `refW` = the game's width at the same view. A sibling is a backdrop
 * when its name says so or it is at least 90 % as wide as the game; only the
 * unbroken run from the very back counts (a wide cloud in the middle is not
 * the ground), and never the whole list (then the list is all "layers" the
 * person may want to reorder, e.g. parallax strips).
 */
export function backdropRun(sibs: Array<{ key: string; label?: string; w?: number }>, refW: number): string[] {
  const out: string[] = [];
  for (const s of sibs) {
    const wide = refW > 0 && typeof s.w === 'number' && s.w >= refW * 0.9;
    if (!wide && !BACKDROP_NAME.test(s.label || '')) break;
    out.push(s.key);
  }
  return out.length >= sibs.length ? [] : out;
}

interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

export function adapterFromPort2D(port: Port2D, _core: Core, win: Window = window): StudioAdapter {
  const grabs = new Map<string, [number, number]>(); // key -> parent-space offset (finger - pivot)
  const view: ViewState = { x: 0, y: 0, zoom: 1 };
  const applyView = () => port.setView?.({ ...view });

  const canvasEl = (): HTMLCanvasElement | null => {
    if (port.canvas) return port.canvas();
    let best: HTMLCanvasElement | null = null;
    let area = 0;
    for (const c of Array.from(win.document.querySelectorAll('canvas'))) {
      const r = c.getBoundingClientRect();
      if (r.width * r.height > area) {
        area = r.width * r.height;
        best = c;
      }
    }
    return best;
  };
  const canvasRect = () => {
    const c = canvasEl();
    if (c) return c.getBoundingClientRect();
    return { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight, right: win.innerWidth, bottom: win.innerHeight } as DOMRect;
  };

  // ----- draw order (layers) -----
  // The port speaks engine indices (every child counts, e.g. a background
  // that is not listed); the editor speaks ranks among the LISTED objects of
  // one parent (Pose.z, 0 = back). WHY ranks: "one step forward" must pass
  // the next thing the person can see in the list, not an invisible child,
  // and undo must land exactly where it was. Moving to the rank of another
  // listed object with remove-then-insert puts it just above that object when
  // going forward and just below it when going back, so the others keep their
  // relative order and setPose(old z) is an exact undo.
  const canOrder = typeof port.order === 'function' && typeof port.setOrder === 'function';
  /** Listed keys per parent, from the last objects() call (list() refreshes it). */
  let siblings = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  const orderOf = (key: string) => {
    try {
      const o = port.order!(key);
      return o && typeof o.parent === 'string' && Number.isFinite(o.index) ? o : null;
    } catch {
      return null;
    }
  };
  /** Listed siblings of `key`, back to front, with their engine index. */
  const ranked = (key: string) => {
    const parent = parentOf.get(key);
    if (parent === undefined) return null;
    const out: Array<{ key: string; index: number }> = [];
    for (const k of siblings.get(parent) || []) {
      const o = orderOf(k);
      if (o && o.parent === parent) out.push({ key: k, index: o.index });
    }
    return out.sort((a, b) => a.index - b.index);
  };
  const rankOf = (key: string): number | undefined => {
    if (!canOrder) return undefined;
    const r = ranked(key);
    const i = r ? r.findIndex((e) => e.key === key) : -1;
    return i >= 0 ? i : undefined;
  };
  const reorder = (key: string, z: number) => {
    const r = ranked(key);
    if (!r) return;
    const cur = r.findIndex((e) => e.key === key);
    const to = Math.max(0, Math.min(r.length - 1, Math.round(z)));
    if (cur < 0 || to === cur) return;
    port.setOrder!(key, r[to]!.index);
  };

  const pose = (key: string): Pose | null => {
    const p = port.get(key);
    if (!p) return null;
    const out: Pose = { p: [p.p[0] ?? 0, p.p[1] ?? 0], r: p.r ?? 0, s: p.s ?? 1 };
    const z = rankOf(key);
    if (z !== undefined) out.z = z;
    return out;
  };

  const list = (): Item[] => {
    const objs = port.objects();
    if (canOrder) {
      siblings = new Map();
      parentOf.clear();
      for (const o of objs) {
        const ord = orderOf(o.key);
        if (!ord) continue;
        parentOf.set(o.key, ord.parent);
        const arr = siblings.get(ord.parent) || [];
        arr.push(o.key);
        siblings.set(ord.parent, arr);
      }
    }
    const out: Item[] = [];
    // Ground / background at the back of each list (Item.backdrop).
    const backdrops = new Set<string>();
    if (canOrder) {
      const refW = canvasRect().width * view.zoom;
      const labels = new Map(objs.map((o) => [o.key, o.label] as const));
      for (const keys of siblings.values()) {
        const sibs = keys.map((k) => ({ k, o: orderOf(k) })).filter((e) => e.o).sort((a, b) => a.o!.index - b.o!.index)
          .map(({ k }) => {
            let w: number | undefined;
            try {
              w = port.bounds(k)?.w;
            } catch {
              w = undefined;
            }
            return { key: k, label: labels.get(k), w };
          });
        for (const k of backdropRun(sibs, refW)) backdrops.add(k);
      }
    }
    for (const o of objs) {
      const ps = pose(o.key);
      if (!ps) continue;
      out.push({
        key: o.key,
        label: o.label ?? o.key,
        kinds: o.kinds ?? ['object'],
        group: o.group,
        unstable: o.unstable,
        rotatable: o.rotatable !== false,
        scalable: o.scalable !== false,
        layer: ps.z !== undefined ? parentOf.get(o.key) : undefined,
        backdrop: ps.z !== undefined && backdrops.has(o.key) ? true : undefined,
        pose: ps,
      });
    }
    return out;
  };

  const set = (key: string, p: Pose): Pose | null => {
    if (!port.get(key)) return null;
    port.set(key, p);
    if (canOrder && p.z !== undefined && Number.isFinite(p.z)) reorder(key, p.z);
    return pose(key);
  };

  /** Union of all object rectangles, in screen px at the CURRENT view. */
  const allBounds = () => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of port.objects()) {
      const b = port.bounds(o.key);
      if (!b || !Number.isFinite(b.x)) continue;
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
  };

  // View maths. The engine shows a world point that would be at screen w
  // (identity view) at S(w) = c + zoom*(w - c) + t, c = canvas centre.
  const centre = () => {
    const r = canvasRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  };
  const toIdentity = (sx: number, sy: number) => {
    const [cx, cy] = centre();
    return [cx + (sx - cx - view.x) / view.zoom, cy + (sy - cy - view.y) / view.zoom] as const;
  };

  /** Scene (stage) space → screen. Default: canvas pixels through the edit view. */
  const sceneMatrix = (): number[] | null => {
    const m = port.sceneToScreen?.();
    if (m && m.length === 6) return m;
    const c = canvasEl();
    if (!c || !c.width || !c.height) return null;
    const r = c.getBoundingClientRect();
    const kx = r.width / c.width, ky = r.height / c.height;
    // When the port has no setView, the view is not applied to the picture.
    const z = port.setView ? view.zoom : 1;
    const tx = port.setView ? view.x : 0, ty = port.setView ? view.y : 0;
    const [cx, cy] = centre();
    // identity screen: w = (r.left + kx*x, r.top + ky*y); shown at c + z*(w - c) + t
    return [z * kx, 0, 0, z * ky, cx + z * (r.left - cx) + tx, cy + z * (r.top - cy) + ty];
  };

  const adapter: StudioAdapter = {
    toGround(x, y) {
      const m = sceneMatrix();
      const inv = m && invert(m);
      return inv ? apply(inv, x, y) : null;
    },
    toScreen(p) {
      const m = sceneMatrix();
      return m ? apply(m, p[0] ?? 0, p[1] ?? 0) : null;
    },
    kind: port.name,
    dim: '2d',
    version: port.version,
    list,
    begin() {
      port.pause?.();
      applyView();
      return list();
    },
    end() {
      view.x = 0;
      view.y = 0;
      view.zoom = 1;
      port.setView?.({ x: 0, y: 0, zoom: 1 });
      port.resume?.();
    },
    render: () => port.render(),
    pickNear(x, y, radius) {
      const vw = win.innerWidth, vh = win.innerHeight;
      const hits: Array<{ key: string; inside: boolean; area: number; order: number; onScreen: boolean }> = [];
      port.objects().forEach((o, order) => {
        const b = port.bounds(o.key);
        if (!b) return;
        const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
        const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
        if (Math.hypot(dx, dy) > radius) return;
        const onScreen = b.x + b.w > 0 && b.y + b.h > 0 && b.x < vw && b.y < vh;
        hits.push({ key: o.key, inside: dx === 0 && dy === 0, area: Math.max(1, b.w * b.h), order, onScreen });
      });
      // Visible first, then directly under the finger, then smaller, then
      // drawn later (on top in most 2D engines).
      hits.sort((a, b) => Number(b.onScreen) - Number(a.onScreen) || Number(b.inside) - Number(a.inside) || a.area - b.area || b.order - a.order);
      return hits.map((h) => h.key);
    },
    anchor(key) {
      const ps = pose(key);
      const m = port.parentToScreen(key);
      if (!ps || !m) return null;
      const center = apply(m, ps.p[0]!, ps.p[1]!);
      const b = port.bounds(key);
      const size = b ? Math.max(b.w, b.h) : 0;
      const vw = win.innerWidth, vh = win.innerHeight;
      const visible = center[0] > -vw && center[1] > -vh && center[0] < 2 * vw && center[1] < 2 * vh;
      return { center, rect: b ? { ...b } : undefined, size, pose: ps, visible };
    },
    grab(key, x, y) {
      const ps = pose(key);
      const m = port.parentToScreen(key);
      const inv = m && invert(m);
      if (!ps || !inv) return false;
      const q = apply(inv, x, y);
      grabs.set(key, [q[0] - ps.p[0]!, q[1] - ps.p[1]!]);
      return true;
    },
    drag(key, x, y) {
      const ps = pose(key)!;
      const m = port.parentToScreen(key);
      const inv = m && invert(m);
      if (!ps || !inv) return ps;
      const off = grabs.get(key) || [0, 0];
      const q = apply(inv, x, y);
      return set(key, { ...ps, p: [q[0] - off[0], q[1] - off[1]] }) || ps;
    },
    rotate(key, d) {
      const ps = pose(key)!;
      return set(key, { ...ps, r: wrapAngle((ps.r ?? 0) + d) }) || ps;
    },
    scale(key, f) {
      const ps = pose(key)!;
      const clamp = (v: number) => Math.min(LIMITS.maxScale, Math.max(LIMITS.minScale, v * f));
      const s = Array.isArray(ps.s) ? ps.s.map(clamp) : clamp((ps.s as number) ?? 1);
      return set(key, { ...ps, s }) || ps;
    },
    setPose: set,
    // The outline's shape, when the port can draw objects alone (pixi does); else a box.
    silhouette: port.silhouette ? (keys: string[]) => {
      try {
        return port.silhouette!(keys);
      } catch {
        return null;
      }
    } : undefined,
    async capture(key, { size }) {
      // The port's own thumbnail first; when it has none (null), crop the
      // object from the screen like ports without capture().
      if (port.capture) {
        const url = await port.capture(key, size).catch(() => null);
        if (url && url.startsWith('data:image/')) return { ok: true, dataUrl: url };
      }
      const c = canvasEl();
      const b = port.bounds(key);
      if (!c || !b || b.w < 1 || b.h < 1) return { ok: false };
      try {
        port.render();
        const r = c.getBoundingClientRect();
        const sx = c.width / r.width, sy = c.height / r.height;
        const out = win.document.createElement('canvas');
        out.width = out.height = size;
        const g = out.getContext('2d')!;
        const k = Math.min(size / b.w, size / b.h);
        const w = b.w * k, h = b.h * k;
        g.drawImage(c, (b.x - r.left) * sx, (b.y - r.top) * sy, b.w * sx, b.h * sy, (size - w) / 2, (size - h) / 2, w, h);
        return { ok: true, dataUrl: out.toDataURL('image/png') };
      } catch {
        return { ok: false };
      }
    },
    view: {
      pan(dx, dy) {
        view.x += dx;
        view.y += dy;
        applyView();
      },
      zoom(f, x, y) {
        const [cx, cy] = centre();
        const px = x ?? cx, py = y ?? cy;
        const [wx, wy] = toIdentity(px, py);
        view.zoom = Math.min(20, Math.max(0.05, view.zoom * f));
        view.x = px - cx - view.zoom * (wx - cx);
        view.y = py - cy - view.zoom * (wy - cy);
        applyView();
      },
      // The opening view (and ⌘K "Back to the opening view"). On a portrait screen — a phone — the game's own picture
      // (the identity view: exactly what Play shows), else everything in frame as before. WHY (the second design review's
      // ⑩, 2026-10-19): "everything in frame" on a 390 px wide phone shrank a landscape world to a strip — Firefly Ruins'
      // urn was 15×21 pt with the top 40 % of the screen empty sky — while the game itself already zooms in on its middle
      // for a portrait screen. 3D opens on the game's camera the same way (three.js home()).
      home() {
        const r = canvasRect();
        if (r.height > r.width) {
          view.x = 0;
          view.y = 0;
          view.zoom = 1;
          applyView();
        } else adapter.view.frameAll();
      },
      frameAll() {
        const b = allBounds();
        if (!b) return;
        const r = canvasRect();
        // Bounds at the identity view.
        const [ix0, iy0] = toIdentity(b.x0, b.y0);
        const [ix1, iy1] = toIdentity(b.x1, b.y1);
        const w = Math.max(1, ix1 - ix0), h = Math.max(1, iy1 - iy0);
        const z = Math.min(20, Math.max(0.05, Math.min((r.width * 0.9) / w, (r.height * 0.9) / h)));
        const [cx, cy] = centre();
        view.zoom = z;
        view.x = -z * ((ix0 + ix1) / 2 - cx);
        view.y = -z * ((iy0 + iy1) / 2 - cy);
        applyView();
      },
      // Only called when the object is out of view (bridge/editor.ts
      // focusIfHidden): move the least that brings it in, with room for the
      // handles under it, instead of centring it (centring slid a game that
      // fits the frame sideways and cut its edges; reviews 2026-10-16).
      // Too big for the frame: centre it.
      focus(key) {
        const b = port.bounds(key);
        if (!b) return;
        const r = canvasRect();
        const left = Math.max(r.left, 0), top = Math.max(r.top, 0);
        const right = Math.min(r.right, win.innerWidth), bottom = Math.min(r.bottom, win.innerHeight);
        const m = 16, below = 64;
        const fit = (lo: number, hi: number, a0: number, a1: number) => {
          if (a1 - a0 > hi - lo - 2 * m) return (lo + hi) / 2 - (a0 + a1) / 2;
          if (a0 < lo + m) return lo + m - a0;
          if (a1 > hi - m) return hi - m - a1;
          return 0;
        };
        view.x += fit(left, right, b.x, b.x + b.w);
        view.y += fit(top, bottom, b.y, b.y + b.h + below);
        applyView();
      },
      state: () => ({ ...view }),
      restore(s) {
        const v = s as Partial<ViewState> | null;
        if (!v || typeof v !== 'object') return;
        if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom! > 0) {
          view.x = v.x!;
          view.y = v.y!;
          view.zoom = v.zoom!;
          applyView();
        }
      },
    },
    assetsOf(key) {
      const raw = port.assetsOf?.(key) || [];
      return raw.map((a) => {
        if (typeof a !== 'string') return a;
        let url = a;
        try {
          url = new URL(a, win.location.href).href;
        } catch {
          /* keep as given */
        }
        return { url, how: guessHow(url), sure: true };
      });
    },
  };
  // Copy and delete (CONTRACT.md §1.8): passed through when the port has all
  // three; otherwise src/core/edits.ts shows stand-ins.
  if (typeof port.clone === 'function' && typeof port.remove === 'function' && typeof port.putBack === 'function') {
    adapter.clone = (key, newKey) => !!port.clone!(key, newKey);
    adapter.remove = (key) => !!port.remove!(key);
    adapter.putBack = (key) => !!port.putBack!(key);
  }
  return adapter;
}
