/**
 * Apply a saved placement.json to a three.js scene — the three.js half of the placement loader.
 *
 * The game calls this ONCE, after building its world and BEFORE creating physics bodies (a physics engine copies
 * positions into its bodies at creation and writes them back every frame; applying later would be undone).
 *
 *   import { applyPlacement } from './studio-placement.js';
 *   const report = await applyPlacement(scene, './placement.json');
 *   // { applied: ['crate-1'], missing: ['old-rock'], unstable: ['path:0/3'] }
 *
 * Keys come from keys.js — the same function the editor uses — so what you saved is what gets applied.
 * Never throws: a missing file does nothing, an unknown key or a bad value is skipped with one console.warn line.
 * One broken save must never stop the game from starting.
 *
 * This is the reference implementation the loader package (src/loader/) wraps; examples import it through their
 * own `studio-placement.js` so a game folder looks the same as after the AI adds the loader.
 */

import { keyMap } from './keys.js';

const LIMIT = 10000; // |value| bound of placement.json (metres)

function finite3(a) {
  return Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= LIMIT);
}

/** Apply an already parsed placement object synchronously. */
export function applyPlacementData(scene, data) {
  const report = { applied: [], missing: [], unstable: [] };
  if (!data || typeof data !== 'object' || data.version !== 1 || !data.objects || typeof data.objects !== 'object') {
    if (data) console.warn('[studio] placement.json ignored: not a version 1 placement file');
    return report;
  }
  if (data.dim && data.dim !== '3d') {
    console.warn('[studio] placement.json ignored: it is for a 2D game');
    return report;
  }
  scene.updateMatrixWorld(true);
  const map = keyMap(scene);
  const bad = [];
  for (const key of Object.keys(data.objects)) {
    const e = data.objects[key];
    const o = map.get(key);
    if (!o) {
      report.missing.push(key);
      continue;
    }
    if (!e || !finite3(e.p)) {
      bad.push(key);
      continue;
    }
    o.position.set(e.p[0], e.p[1], e.p[2]);
    if (typeof e.r === 'number' && Number.isFinite(e.r) && Math.abs(e.r) <= Math.PI * 8) o.rotation.y = e.r;
    if (typeof e.s === 'number' && Number.isFinite(e.s) && e.s > 0 && e.s <= LIMIT) o.scale.set(e.s, e.s, e.s);
    else if (Array.isArray(e.s) && e.s.length === 3 && e.s.every((x) => typeof x === 'number' && x > 0 && x <= LIMIT)) o.scale.set(e.s[0], e.s[1], e.s[2]);
    o.updateMatrixWorld(true);
    report.applied.push(key);
    if (e.unstable || key.startsWith('path:')) report.unstable.push(key);
  }
  if (report.missing.length || bad.length) {
    console.warn(`[studio] placement: ${report.applied.length} applied, ${report.missing.length} not found (${report.missing.slice(0, 5).join(', ')}), ${bad.length} invalid`);
  }
  return report;
}

/** Fetch and apply. `src` is a URL (default ./placement.json) or an already parsed object. */
export async function applyPlacement(scene, src = './placement.json') {
  if (src && typeof src === 'object') return applyPlacementData(scene, src);
  let data = null;
  try {
    const res = await fetch(src, { cache: 'no-store' });
    if (!res.ok) return { applied: [], missing: [], unstable: [] }; // no saved placement yet: nothing to do
    data = await res.json();
  } catch (e) {
    console.warn('[studio] placement.json could not be read:', e && e.message);
    return { applied: [], missing: [], unstable: [] };
  }
  return applyPlacementData(scene, data);
}
