// studio-placement.js: apply placement.json to a running game (three.js or PixiJS).
//
//   import { applyPlacement } from './studio-placement.js';
//   const report = await applyPlacement(scene, './placement.json'); // three: the Scene; Pixi: app.stage
//   // report = { applied: ['tree-01'], missing: ['old-rock'], unstable: ['path:0/3/1'], skipped: [] }
//
// Call it once after the world is built and BEFORE physics bodies are created: an engine that
// copies body positions into objects every frame would otherwise move them back.
//
// This file is copied into the user's game, so it is small, has no imports, and never throws for
// a bad or missing file: a game must keep running even if placement.json is broken. Unknown keys
// and bad values are skipped with one console.warn line. (The strict check lives in the editor and
// the server, which refuse to write a bad file in the first place.)
//
// Finding the object for a key follows the editor's key rules, in this order:
//   studioKey mark     three: object.userData.studioKey, Pixi: object.studioKey
//   "path:0/3/1"       child indexes from the root (unstable: changes when code reorders objects)
//   name / name#2      three: object.name, Pixi: object.label; "#2" = the second such object
//   userData id/name   three only: object.userData.id or object.userData.name
// `order` (2D only): draw orders changed in the editor, per parent, keys back -> front. PixiJS
// draws children in array order, so they are put back in that order, in the places they already
// take (a background that is not listed stays where it is). Keys are resolved first, and keys that
// depend on the tree order (path:…, name#2) are stamped as studioKey, so the editor still finds
// every object under the same key after the reorder.
// Names are compared after the same clean-up the editor applies to make a key (characters outside
// A-Z a-z 0-9 _ : # . - / become "_", at most 80 characters).

const KEY_CHARS = /[^A-Za-z0-9_:#.\-\/]/g;
const cleanName = (s) => (typeof s === 'string' && s ? s.replace(KEY_CHARS, '_').slice(0, 80) : '');

/**
 * @param {object} root  three.js Scene/Object3D or PixiJS Container (app.stage)
 * @param {string | object} [source]  URL of placement.json (default './placement.json') or its parsed content
 * @returns {Promise<{ applied: string[], missing: string[], unstable: string[], skipped: string[] }>}
 */
export async function applyPlacement(root, source = './placement.json') {
  const report = { applied: [], missing: [], unstable: [], skipped: [] };
  let data = source;
  if (typeof source === 'string') {
    try {
      const res = await fetch(source, { cache: 'no-cache' });
      if (!res.ok) return report; // no file yet: nothing to apply
      data = await res.json();
    } catch (e) {
      warn('could not read ' + source + ' (' + e.message + ')');
      return report;
    }
  }
  const three = !!(root && root.isObject3D);
  const dim = three ? '3d' : '2d';
  if (!data || data.tool !== 'placement' || !data.objects || typeof data.objects !== 'object') {
    warn('not a placement file');
    return report;
  }
  if (data.dim !== dim) {
    warn('the file is for ' + data.dim + ' but the root is a ' + (three ? 'three.js' : 'PixiJS') + ' object');
    return report;
  }
  const n = three ? 3 : 2;
  for (const key of Object.keys(data.objects)) {
    const e = data.objects[key];
    if (e && e.unstable) report.unstable.push(key);
    const obj = findByKey(root, key, three);
    if (!obj) report.missing.push(key);
    else if (put(obj, e, n, three)) report.applied.push(key);
    else report.skipped.push(key);
  }
  // Copies made in the editor (`added`, in the order they were made) that the code does not make yet: a clone of
  // the original (`from`) under the new key, at the saved pose (polish pass 2026-10-16). WHY: before, a copy lived
  // only in this file until the AI wrote it into the code, so it vanished in Play ("Copy is broken"). A clone looks
  // right but does not act (a boat that floats, a coin that spins) until the AI adds it to the code; a key the game
  // already has is skipped (the AI did). Deleted objects (`removed`) are hidden while they still stand where they
  // were (`was.p`), so a path key that now names another object leaves that one alone.
  for (const a of Array.isArray(data.added) ? data.added : []) {
    if (!a || typeof a.key !== 'string' || findByKey(root, a.key, three)) continue;
    const src = typeof a.from === 'string' && findByKey(root, a.from, three);
    const c = src && src.parent && copyOf(src, three);
    if (!c || !put(c, a, n, three)) {
      report.missing.push(a.key);
      continue;
    }
    if (three) (c.userData.studioKey = a.key), src.parent.add(c);
    else (c.studioKey = a.key), src.parent.addChildAt(c, src.parent.getChildIndex(src) + 1);
    report.applied.push(a.key);
  }
  for (const r of Array.isArray(data.removed) ? data.removed : []) {
    const o = r && typeof r.key === 'string' && findByKey(root, r.key, three);
    const w = o && r.was && r.was.p;
    if (o && !(Array.isArray(w) && w.some((v, i) => Math.abs(v - [o.position.x, o.position.y, o.position.z][i]) > 1e-3))) (o.visible = false), report.applied.push(r.key);
  }
  if (!three && Array.isArray(data.order)) applyOrder(root, data.order, report);
  if (report.missing.length) warn(report.missing.length + ' key(s) not found, ignored: ' + report.missing.slice(0, 10).join(', '));
  if (report.skipped.length) warn(report.skipped.length + ' entr(ies) with bad values, ignored: ' + report.skipped.slice(0, 10).join(', '));
  return report;
}

/** Apply one entry's p / r / t / s to obj; false (nothing changed) when a value is bad. */
function put(obj, e, n, three) {
  const p = e && e.p;
  const s = e && e.s;
  const okP = p === undefined || (Array.isArray(p) && p.length === n && p.every(isNum));
  const okR = e && (e.r === undefined || isNum(e.r)) && (e.t === undefined || (three && Array.isArray(e.t) && e.t.length === 2 && e.t.every(isNum)));
  const okS = s === undefined || (isNum(s) && s !== 0) || (Array.isArray(s) && s.length === n && s.every(isNum));
  if (!okP || !okR || !okS) return false;
  if (p) obj.position.set(p[0], p[1], p[2]);
  if (e.r !== undefined) {
    if (three) obj.rotation.y = e.r;
    else obj.rotation = e.r;
  }
  // 3D tilt (tipped forward / sideways in the editor): rotation.x and rotation.z, in the object's own Euler order.
  if (three && e.t !== undefined) {
    obj.rotation.x = e.t[0];
    obj.rotation.z = e.t[1];
  }
  if (s !== undefined) {
    if (Array.isArray(s)) obj.scale.set(s[0], s[1], s[2]);
    else if (three) obj.scale.setScalar(s);
    else obj.scale.set(s, s);
  }
  return true;
}

/** A copy that draws the same thing: three's clone (shares geometry and materials); Pixi: clone(), or a new sprite of the same texture. */
function copyOf(o, three) {
  try {
    if (three || typeof o.clone === 'function') return o.clone();
    return o.texture ? new o.constructor(o.texture) : null;
  } catch (e) {
    return null;
  }
}

function applyOrder(root, order, report) {
  const lists = [];
  for (const g of order) {
    const objs = g && Array.isArray(g.keys) ? g.keys.map((k) => [k, findByKey(root, k, false)]).filter((x) => x[1]) : [];
    const parent = objs.length && objs[0][1].parent;
    const mine = objs.filter((x) => x[1].parent === parent);
    if (parent && mine.length > 1) lists.push([parent, mine]);
  }
  for (const [, mine] of lists) for (const [k, o] of mine) if (!o.studioKey && (k.startsWith('path:') || k.includes('#'))) o.studioKey = k;
  for (const [parent, mine] of lists) {
    const slots = mine.map((x) => parent.getChildIndex(x[1])).sort((a, b) => a - b);
    for (const [, o] of mine) parent.removeChild(o);
    mine.forEach((x, i) => parent.addChildAt(x[1], slots[i]));
  }
  if (lists.length) report.applied.push('order');
}

/** Find the object for one key under root (exported for tests and for code that wants to check keys). */
export function findByKey(root, key, three = !!(root && root.isObject3D)) {
  // The mark first, even for path keys: applyOrder stamps path keys as marks before reordering.
  const mark = (o) => (three ? o.userData && o.userData.studioKey : o.studioKey);
  let found = null;
  walk(root, (o) => {
    if (!found && mark(o) === key) found = o;
    return !found;
  });
  if (found) return found;
  if (key.startsWith('path:')) {
    let o = root;
    for (const i of key.slice(5).split('/')) {
      o = o && o.children && o.children[Number(i)];
      if (!o || !/^\d+$/.test(i)) return null;
    }
    return o;
  }

  // name#k: the k-th object with that name, counting only the outermost ones (a group named "tree"
  // that holds a mesh also named "tree" counts once, like the editor's "meaningful top node").
  const m = /^(.*)#(\d+)$/.exec(key);
  const name = m ? m[1] : key;
  let want = m ? Number(m[2]) : 1;
  walk(root, (o) => {
    if (found) return false;
    // Pixi: an object with a studioKey is known by that key, not its label (as in the editor).
    if (cleanName(three ? o.name : o.studioKey ? '' : o.label) === name) {
      if (--want === 0) found = o;
      return 'skip';
    }
    return true;
  });
  if (found || !three) return found;
  walk(root, (o) => {
    const u = o.userData;
    if (!found && u && (String(u.id) === key || cleanName(u.name) === key)) found = o;
    return !found;
  });
  return found;
}

// Depth-first, pre-order, root excluded. visit() returns false to stop, 'skip' to not descend.
function walk(root, visit) {
  const stack = (root.children || []).slice().reverse();
  while (stack.length) {
    const o = stack.pop();
    const r = visit(o);
    if (r === false) return;
    if (r !== 'skip' && o.children) for (let i = o.children.length - 1; i >= 0; i--) stack.push(o.children[i]);
  }
}

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

function warn(msg) {
  console.warn('[studio] placement.json: ' + msg);
}
