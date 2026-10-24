// Where a keep-out area is, on the ground (studio-code-keepout, 2026-10-24; the plan's step 3, item 3). Pure maths, no
// DOM: keep-out.ts projects what this gives and paints it (test/keep-out-paint.test.ts checks the painted cells against
// the condition itself).
//
// A box drawn by hand is its four floor corners. A code condition (codeAvoid) is painted one of two ways:
//   - its `show(k, g)` shape when it has one: { circle: { p, r } } · { box: { p, size } } · { poly: [[x, z], …] } (2D:
//     [[x, y], …]) — exact, and the only kind with a ◇ on its edge (a knob dragged there finds the number that brings the
//     edge to the finger, as a rule motion's ◇ does);
//   - else the ground is tried every 0.5 m (2D: every 8 px) with its own `test` — the editor never reads the rule, it
//     runs it, so "not on the road" paints the road whatever the AI wrote. Cells in a row are joined into runs (one
//     quad each) and the edge is where an "in" cell meets an "out" one, joined into long straight pieces.
// WHY run the test and not ask the AI for a shape: a condition is often not a shape at all ("where the floor is lava",
// "between the trees") — the picture must be true for any rule, and the rule is the truth the loader uses.
// Axes: the ground is x and z in 3D (y up), x and y in 2D; `a` / `b` below are those two.

export type Shape =
  | { kind: 'circle'; p: number[]; r: number }
  | { kind: 'box'; p: number[]; size: number[] }
  | { kind: 'poly'; pts: number[][] };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, n: number): number[] | null => (Array.isArray(v) && v.length >= n && v.slice(0, n).every(num) ? (v.slice(0, n) as number[]) : null);

/** The ground's second axis: z in 3D, y in 2D. */
export const B = (n: 2 | 3) => (n === 3 ? 2 : 1);

/** A codeAvoid `show(k, g)` answer as a shape (anything else: null — then the ground is tried with `test`). */
export function shapeOf(v: unknown, n: 2 | 3): Shape | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const c = o.circle as Record<string, unknown> | undefined;
  if (c && typeof c === 'object') {
    const p = vec(c.p, n);
    if (p && num(c.r) && c.r > 0) return { kind: 'circle', p, r: c.r };
  }
  const b = o.box as Record<string, unknown> | undefined;
  if (b && typeof b === 'object') {
    const p = vec(b.p, n), size = vec(b.size, n);
    if (p && size) return { kind: 'box', p, size };
  }
  if (Array.isArray(o.poly) && o.poly.length >= 3) {
    const pts = o.poly.map((q) => vec(q, 2)).filter((q): q is number[] => !!q);
    if (pts.length >= 3) return { kind: 'poly', pts };
  }
  return null;
}

/**
 * A shape's edge as world points, closed (the last is the first): a circle in `seg` pieces, a box's four floor corners,
 * a polygon as given. 3D points sit at height `y` (a circle / box at its own p's height when it has one).
 */
export function outlineOf(s: Shape, n: 2 | 3, y: number, seg = 48): number[][] {
  const at = (a: number, b: number, h = y) => (n === 3 ? [a, h, b] : [a, b]);
  const pts: number[][] = [];
  if (s.kind === 'circle') {
    const h = n === 3 ? s.p[1]! : y;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * 2 * Math.PI;
      pts.push(at(s.p[0]! + s.r * Math.cos(t), s.p[B(n)]! + s.r * Math.sin(t), h));
    }
    return pts;
  }
  if (s.kind === 'box') return boxCorners(s, n).concat([boxCorners(s, n)[0]!]);
  for (const q of s.pts) pts.push(at(q[0]!, q[1]!));
  pts.push(pts[0]!.slice());
  return pts;
}

/**
 * A box's four floor corners, in order round it (3D: `p` = the middle of its bottom, `size` = [w, h, d]; 2D: `p` = its
 * middle, `size` = [w, h]) — the loader's own reading of a box (studio-placement.js inBox).
 */
export function boxCorners(b: { p: number[]; size: number[] }, n: 2 | 3): number[][] {
  const w = b.size[0]! / 2, d = b.size[B(n)]! / 2;
  const x = b.p[0]!, z = b.p[B(n)]!;
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  return c.map(([i, k]) => (n === 3 ? [x + i * w, b.p[1]!, z + k * d] : [x + i * w, z + k * d]));
}

export interface Grid {
  /** 1 = the condition says "not here" at that cell's middle. Row-major: index = iz * nx + ix. */
  cells: Uint8Array;
  nx: number;
  nz: number;
  a0: number;
  b0: number;
  step: number;
}
export interface Bounds {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** At most this many cells per condition: a wide view gets a coarser grid (step doubled) instead of a slow frame. */
export const MAX_CELLS = 40000;

/**
 * Try the ground in `bounds` every `step` (doubled until the cells fit MAX_CELLS) with `test` at each cell's middle
 * (3D at height `y`). A test that throws counts as "out" (the loader treats it the same way).
 */
export function sampleGrid(test: (q: number[]) => boolean, bounds: Bounds, step: number, y: number, n: 2 | 3): Grid {
  let s = step;
  const span = (lo: number, hi: number) => Math.max(1, Math.ceil((hi - lo) / s));
  while (span(bounds.a0, bounds.a1) * span(bounds.b0, bounds.b1) > MAX_CELLS) s *= 2;
  const nx = span(bounds.a0, bounds.a1), nz = span(bounds.b0, bounds.b1);
  const cells = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    const b = bounds.b0 + (iz + 0.5) * s;
    for (let ix = 0; ix < nx; ix++) {
      const a = bounds.a0 + (ix + 0.5) * s;
      let hit = false;
      try {
        hit = !!test(n === 3 ? [a, y, b] : [a, b]);
      } catch {
        hit = false;
      }
      if (hit) cells[iz * nx + ix] = 1;
    }
  }
  return { cells, nx, nz, a0: bounds.a0, b0: bounds.b0, step: s };
}

/** The "in" cells of each row joined: [iz, from ix, to ix (exclusive)]. One quad each to paint. */
export function runsOf(g: Grid): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let iz = 0; iz < g.nz; iz++) {
    let ix = 0;
    while (ix < g.nx) {
      if (!g.cells[iz * g.nx + ix]) {
        ix++;
        continue;
      }
      const from = ix;
      while (ix < g.nx && g.cells[iz * g.nx + ix]) ix++;
      out.push([iz, from, ix]);
    }
  }
  return out;
}

/**
 * The edge of the painted cells as ground segments [[a, b], [a, b]]: wherever an "in" cell meets an "out" one (or the
 * grid's border), pieces on one straight line joined end to end — so a road's edge is two long lines, not a staircase
 * of 0.5 m steps. The grid's own border is not an edge (the area goes on past what is tried).
 */
export function edgesOf(g: Grid): Array<[[number, number], [number, number]]> {
  const at = (ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < g.nx && iz < g.nz && !!g.cells[iz * g.nx + ix];
  const outOf = (ix: number, iz: number) => ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz;
  const A = (ix: number) => g.a0 + ix * g.step;
  const Bv = (iz: number) => g.b0 + iz * g.step;
  const out: Array<[[number, number], [number, number]]> = [];
  // Lines across a (between rows iz-1 and iz), joined along a.
  for (let iz = 0; iz <= g.nz; iz++) {
    let start = -1;
    for (let ix = 0; ix <= g.nx; ix++) {
      const edge = ix < g.nx && at(ix, iz) !== at(ix, iz - 1) && !outOf(ix, iz - 1) && !outOf(ix, iz);
      if (edge && start < 0) start = ix;
      if (!edge && start >= 0) (out.push([[A(start), Bv(iz)], [A(ix), Bv(iz)]]), (start = -1));
    }
  }
  // Lines along b (between columns ix-1 and ix), joined along b.
  for (let ix = 0; ix <= g.nx; ix++) {
    let start = -1;
    for (let iz = 0; iz <= g.nz; iz++) {
      const edge = iz < g.nz && at(ix, iz) !== at(ix - 1, iz) && !outOf(ix - 1, iz) && !outOf(ix, iz);
      if (edge && start < 0) start = iz;
      if (!edge && start >= 0) (out.push([[A(ix), Bv(start)], [A(ix), Bv(iz)]]), (start = -1));
    }
  }
  return out;
}

/** The point of `pts` nearest `want` on the ground (a ◇'s search: which knob value brings the edge to the finger). */
export function nearestOn(pts: number[][], want: number[], n: 2 | 3): number[] | null {
  let best: number[] | null = null, bd = Infinity;
  for (const q of pts) {
    const d = Math.hypot(q[0]! - want[0]!, q[B(n)]! - want[B(n)]!);
    if (d < bd) (bd = d), (best = q);
  }
  return best;
}

/** Ground bounds round `pts` (and `extra` around them): the part of the ground worth trying. */
export function boundsOf(pts: number[][], n: 2 | 3, extra: number): Bounds | null {
  const ok = pts.filter((q) => q && num(q[0]) && num(q[B(n)]));
  if (!ok.length) return null;
  const as = ok.map((q) => q[0]!), bs = ok.map((q) => q[B(n)]!);
  return { a0: Math.min(...as) - extra, a1: Math.max(...as) + extra, b0: Math.min(...bs) - extra, b1: Math.max(...bs) + extra };
}

/** Two bounds' common part (null: none). */
export function clipBounds(a: Bounds, b: Bounds | null): Bounds | null {
  if (!b) return a;
  const o = { a0: Math.max(a.a0, b.a0), a1: Math.min(a.a1, b.a1), b0: Math.max(a.b0, b.b0), b1: Math.min(a.b1, b.b1) };
  return o.a1 > o.a0 && o.b1 > o.b0 ? o : null;
}
