/**
 * How a line of dominoes falls: each domino is one angle (0 = standing, π/2 = flat on its face), turning about its
 * front bottom edge. Our own few lines, no physics library.
 *
 * WHY one angle each and not 400 free boxes (decided 2026-11-06): a domino in a line only ever tips forward onto the
 * next one, so one number holds everything that is seen, and 400 of them step in well under a millisecond — 60 fps on
 * a phone. It grew out of examples/three-tumble's "a few lines of our own" boxes.
 *
 * Each step (fixed dt, so a run is the same run every time — the editor's Try replays to the same second):
 *   1. gravity turns every tipping domino a little more (a slab about its edge);
 *   2. contacts: a domino may not pass through the back of the next one. Where it would, both are moved apart, half
 *      each (equal dominoes), so the falling one pushes the next and then leans on it — the push travels down the line;
 *   3. the speed of each is what the step moved it (position-based: no bounce, nothing ever blows up).
 *
 * Plain numbers only (no three.js): the same file runs in the browser and in the unit tests (node).
 */

const FLAT = Math.PI / 2;

/**
 * The tilt at which domino i (height h, thickness t, its front edge `gap` behind the next one's front edge) touches the
 * back face of the next domino tilted by φ:  θ = φ + asin((gap·cos φ − t) / h).
 * (The top front corner of i meets the plane of the next one's back face.)
 */
export function touchAt(phi, h, t, gap) {
  const s = (gap * Math.cos(phi) - t) / h;
  return phi + Math.asin(Math.max(-1, Math.min(1, s)));
}

/**
 * A line of `n` dominoes. `h` height, `t` thickness, `gap` distance between two dominoes (m), `g` gravity (m/s²).
 * Returns { th, step(dt), push(i, w), fallen() }: th[i] = tilt of domino i, read by the game each frame to draw it.
 */
export function makeLine(n, { h, t, gap, g }) {
  const th = new Float64Array(n);
  const prev = new Float64Array(n);
  const om = new Float64Array(n); // angular speed (rad/s)
  const hit = new Float64Array(n); // how hard it was last pushed (for the glow): decays in the game
  // A uniform slab turning about one bottom edge: I = m(h² + t²)/3, torque = m·g·(h/2·sin θ − t/2·cos θ).
  const inv = (3 * g) / (2 * (h * h + t * t));
  let moving = 0; // dominoes before this are all lying still: not stepped (only the front of the wave costs time)
  let front = -1; // the furthest domino that has started to move

  function step(dt) {
    const last = Math.min(n - 1, front + 1);
    for (let i = moving; i <= last; i++) {
      prev[i] = th[i];
      if (th[i] <= 0 && om[i] <= 0) continue; // standing: gravity holds it up
      om[i] += (h * Math.sin(th[i]) - t * Math.cos(th[i])) * inv * dt;
      th[i] = Math.min(FLAT, Math.max(0, th[i] + om[i] * dt));
    }
    // Contacts, a few sweeps (Gauss–Seidel) so a long leaning row settles in one step.
    for (let it = 0; it < 4; it++) {
      for (let i = Math.max(moving, 0); i < last; i++) {
        if (th[i] <= 0) continue;
        const lim = touchAt(th[i + 1], h, t, gap);
        const over = th[i] - lim;
        if (over <= 0) continue;
        // How fast the limit moves when the next one tilts (≈ 1–2): moving the next by d moves the limit by k·d.
        const k = (touchAt(th[i + 1] + 1e-4, h, t, gap) - lim) / 1e-4;
        const d = over / (1 + k * k);
        th[i] = Math.max(0, th[i] - d);
        th[i + 1] = Math.min(FLAT, th[i + 1] + k * d);
        if (i + 1 > front) front = i + 1;
        hit[i + 1] = Math.max(hit[i + 1], k * d / dt);
      }
    }
    for (let i = moving; i <= Math.min(n - 1, front + 1); i++) {
      om[i] = (th[i] - prev[i]) / dt;
      if (th[i] >= FLAT && om[i] > 0) om[i] = 0;
    }
    // Lying still and leaning on one that lies still too: done for good.
    while (moving < front && Math.abs(om[moving]) < 1e-4 && th[moving] > 1 && Math.abs(om[moving + 1]) < 1e-4) moving++;
  }

  /** Push domino i forward with angular speed w (rad/s): the ball's hit. */
  function push(i, w) {
    if (i < 0 || i >= n) return;
    om[i] = Math.max(om[i], w);
    th[i] = Math.max(th[i], 1e-3);
    hit[i] = Math.max(hit[i], w);
    if (i > front) front = i;
  }

  /** How many have fallen past 45°. */
  function fallen() {
    let c = 0;
    for (let i = 0; i < n; i++) if (th[i] > Math.PI / 4) c++;
    return c;
  }

  return { th, om, hit, step, push, fallen, get front() { return front; } };
}
