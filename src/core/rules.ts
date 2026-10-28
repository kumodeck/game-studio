// Game rules: fit the editor to one game without touching the editor or the
// adapter (CONTRACT.md §7).
//
// `.studio/studio.json` (plain settings the AI writes) and the optional
// `constrain()` from `.studio/tools.js` sit between the bridge and the
// adapter, as one more StudioAdapter. So snapping, bounds and per-kind rules
// work the same for three.js, PixiJS, Phaser, a hand-written canvas game or
// anything else, and the adapters stay unaware of them.
//
// What is constrained: edits made with handles, keys and game tools (drag,
// rotate, scale, nudgeY). What is not: setPose() — undo/redo and loading a
// saved file must restore poses exactly, even if the rules changed since.
import type { GameConfig, GameExtension, GameRule, GridStep, Item, Pose, StudioAdapter } from '../contract.ts';

const DEG = Math.PI / 180;

export interface RulesHolder {
  config: GameConfig | null;
  ext: GameExtension[];
}

/** "crate*" → /^crate.*$/ (only * and ? are special). */
export function globToRe(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

export interface MergedRule {
  hidden: boolean;
  locked: boolean;
  lockHeight: boolean;
  rotate: boolean;
  scale: boolean;
  scaleDefault?: number;
  scaleMin?: number;
  scaleMax?: number;
  grid?: GridStep;
  angle?: number;
}

/** All rules whose glob matches the key, label or group, merged in order (later wins). */
export function rulesFor(item: Pick<Item, 'key' | 'label' | 'group'>, config: GameConfig | null): MergedRule {
  const out: MergedRule = { hidden: false, locked: false, lockHeight: false, rotate: true, scale: true, grid: config?.snap?.grid, angle: config?.snap?.angle };
  for (const r of (config?.rules || []) as GameRule[]) {
    if (!r || typeof r.match !== 'string') continue;
    const re = globToRe(r.match);
    if (!re.test(item.key) && !re.test(item.label || '') && !(item.group && re.test(item.group))) continue;
    if (typeof r.hidden === 'boolean') out.hidden = r.hidden;
    if (typeof r.locked === 'boolean') out.locked = r.locked;
    if (typeof r.lockHeight === 'boolean') out.lockHeight = r.lockHeight;
    if (typeof r.rotate === 'boolean') out.rotate = r.rotate;
    if (typeof r.scale === 'boolean') out.scale = r.scale;
    else if (r.scale && typeof r.scale === 'object') {
      out.scale = true;
      if (typeof r.scale.default === 'number' && r.scale.default > 0) out.scaleDefault = r.scale.default;
      if (typeof r.scale.min === 'number' && r.scale.min > 0) out.scaleMin = r.scale.min;
      if (typeof r.scale.max === 'number' && r.scale.max > 0) out.scaleMax = r.scale.max;
    }
    if (r.snap && typeof r.snap === 'object') {
      if (r.snap.grid !== undefined) out.grid = r.snap.grid;
      if (r.snap.angle !== undefined) out.angle = r.snap.angle;
    }
  }
  return out;
}

const roundTo = (v: number, step: number) => (step > 0 ? Number((Math.round(v / step) * step).toFixed(6)) : v);
const wrap = (a: number) => {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
};

/**
 * Snap a position to the grid and clamp it to the bounds.
 * 3D: a single grid number applies to x and z (heights stay free); [x, y, z]
 * sets each axis. 2D: a single number applies to x and y.
 */
export function placeOnGrid(p: number[], grid: GridStep | undefined, bounds: GameConfig['bounds'] | undefined, dim: '2d' | '3d'): number[] {
  const out = p.slice();
  if (grid !== undefined) {
    const steps = Array.isArray(grid) ? grid : dim === '3d' ? [grid, 0, grid] : [grid, grid];
    for (let i = 0; i < out.length; i++) {
      const st = Number(steps[i]);
      if (Number.isFinite(st) && st > 0) out[i] = roundTo(out[i]!, st);
    }
  }
  if (bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
    for (let i = 0; i < out.length; i++) {
      const lo = bounds.min[i], hi = bounds.max[i];
      if (typeof lo === 'number' && out[i]! < lo) out[i] = lo;
      if (typeof hi === 'number' && out[i]! > hi) out[i] = hi;
    }
  }
  return out;
}

const samePose = (a: Pose, b: Pose) => JSON.stringify(a) === JSON.stringify(b);

export function withRules(inner: StudioAdapter, holder: RulesHolder): StudioAdapter {
  // Raw (unsnapped) angle per object while it is being turned, so small
  // finger moves add up instead of being swallowed by the angle snap.
  const rawR = new Map<string, number>();
  let cache = new Map<string, Item>();

  const refresh = () => {
    cache = new Map(inner.list().map((i) => [i.key, i]));
    return cache;
  };
  const itemOf = (key: string) => cache.get(key) || refresh().get(key);
  const ruleOf = (key: string) => {
    const it = itemOf(key);
    return it ? rulesFor(it, holder.config) : null;
  };
  const decorate = (list: Item[]): Item[] => {
    cache = new Map(list.map((i) => [i.key, i]));
    const out: Item[] = [];
    for (const it of list) {
      const r = rulesFor(it, holder.config);
      if (r.hidden) continue;
      out.push({
        ...it,
        rotatable: it.rotatable && r.rotate && !r.locked,
        scalable: it.scalable && r.scale && !r.locked,
        movable: it.movable !== false && !r.locked,
        liftable: it.liftable !== false && !r.lockHeight && !r.locked,
        defaultScale: r.scaleDefault ?? it.defaultScale,
      });
    }
    return out;
  };
  const current = (key: string): Pose | null => inner.anchor(key)?.pose ?? itemOf(key)?.pose ?? null;

  /** Grid, bounds, then the game's own constrain(); writes back only when something changed. */
  const fix = (key: string, pose: Pose, moved: boolean): Pose => {
    const r = ruleOf(key);
    let next: Pose = { ...pose, p: pose.p.slice() };
    if (moved) next.p = placeOnGrid(next.p, r?.grid, holder.config?.bounds, inner.dim);
    else next.p = placeOnGrid(next.p, undefined, holder.config?.bounds, inner.dim);
    const item = itemOf(key);
    for (const e of holder.ext) {
      if (e.constrain && item) {
        try {
          const c = e.constrain(key, next, item);
          if (c && Array.isArray(c.p)) next = c;
        } catch (err) {
          console.warn('[studio] constrain() failed:', err);
        }
      }
    }
    if (samePose(next, pose)) return pose;
    return inner.setPose(key, next) || pose;
  };

  const ruled: StudioAdapter = {
    ...inner,
    list: () => decorate(inner.list()),
    begin: (o) => decorate(inner.begin(o)),
    pickNear(x, y, radius) {
      return inner.pickNear(x, y, radius).filter((k) => !ruleOf(k)?.hidden);
    },
    grab(key, x, y) {
      const r = ruleOf(key);
      if (!r || r.locked || r.hidden) return false;
      rawR.delete(key);
      return inner.grab(key, x, y);
    },
    drag(key, x, y) {
      const r = ruleOf(key);
      if (!r || r.locked) return current(key)!;
      const before = r.lockHeight ? current(key) : null;
      let after = inner.drag(key, x, y);
      // Snap to surfaces (bridge/snap.ts) moves the height with the ground under it: not for a height the game holds.
      if (before && after.p[1] !== before.p[1]) after = inner.setPose(key, { ...after, p: [after.p[0]!, before.p[1]!, after.p[2]!] }) || after;
      return fix(key, after, true);
    },
    rotate(key, d) {
      const r = ruleOf(key);
      const before = current(key);
      if (!r || !before || r.locked || !r.rotate) return before!;
      const b = before.r ?? 0;
      const after = inner.rotate(key, d);
      const step = (r.angle ?? 0) * DEG;
      if (!(step > 0)) return fix(key, after, false);
      // Keep accumulating the unsnapped angle; restart from the object's
      // angle when it no longer matches (undo, another gesture).
      let raw = rawR.get(key);
      if (raw === undefined || Math.abs(wrap(roundTo(raw, step) - b)) > 1e-6) raw = b;
      raw += wrap((after.r ?? 0) - b);
      rawR.set(key, raw);
      const target = wrap(roundTo(raw, step));
      const snapped = Math.abs(wrap(target - (after.r ?? 0))) > 1e-9 ? inner.setPose(key, { ...after, r: target }) || after : after;
      return fix(key, snapped, false);
    },
    // Turning around another axis, or around the box middle (3D): blocked where
    // turning is (locked, rotate: false). A game with an angle step keeps the
    // snapped vertical turn of rotate() for the y axis.
    turn: inner.turn ? (key, d, axis) => {
      const r = ruleOf(key);
      const before = current(key);
      if (!r || !before || r.locked || !r.rotate) return before!;
      if (axis === 'y' && (r.angle ?? 0) > 0) return ruled.rotate(key, d);
      return fix(key, inner.turn!(key, d, axis), false);
    } : undefined,
    scale(key, f) {
      const r = ruleOf(key);
      const before = current(key);
      if (!r || !before || r.locked || !r.scale) return before!;
      const after = inner.scale(key, f);
      const s0 = Array.isArray(after.s) ? after.s[0] ?? 1 : after.s ?? 1;
      let s1 = s0;
      if (r.scaleMin !== undefined && s1 < r.scaleMin) s1 = r.scaleMin;
      if (r.scaleMax !== undefined && s1 > r.scaleMax) s1 = r.scaleMax;
      if (s1 === s0) return fix(key, after, false);
      const k = s1 / (s0 || 1);
      const s = Array.isArray(after.s) ? after.s.map((v) => v * k) : s1;
      return fix(key, inner.setPose(key, { ...after, s }) || after, false);
    },
    setPose(key, pose) {
      rawR.delete(key);
      return inner.setPose(key, pose);
    },
    view: inner.view,
  };
  if (inner.drop) {
    // Drop to floor (End) changes the height only: blocked where the height is (locked, lockHeight).
    ruled.drop = (key, skip) => {
      const r = ruleOf(key);
      const before = current(key);
      if (!r || !before || r.locked || r.lockHeight) return before!;
      return fix(key, inner.drop!(key, skip), true);
    };
  }
  if (inner.nudgeY) {
    ruled.nudgeY = (key, dy) => {
      const r = ruleOf(key);
      const before = current(key);
      if (!r || !before || r.locked || r.lockHeight) return before!;
      return fix(key, inner.nudgeY!(key, dy), true);
    };
  }
  return ruled;
}
