/**
 * Which objects of a three.js scene can be moved, and the stable key of each one.
 *
 * Pure functions over the Object3D shape (children, name, userData, isMesh, …) — no three import, so the same file
 * runs in the editor, in the placement loader the game ships, and in Node tests with plain objects.
 * The editor and the loader MUST agree on keys byte for byte: placement.json is keyed by them.
 *
 * Candidates ("the meaningful top-most node that contains a mesh"):
 *   - a node with the author's mark `userData.studioKey`, or with a name, or directly under the scene
 *   - that has at least one mesh in its subtree
 *   - not a light, camera, helper, line, point cloud, sprite, InstancedMesh, or anything marked `userData.studio = false`
 *     (InstancedMesh / merged geometry / particles have no single body to move)
 *   - once a node is a candidate we do not descend into it (moving a car moves its wheels), with two exceptions:
 *       · a descendant with an explicit `userData.studioKey` is also listed (the author asked for it)
 *       · `userData.studio = 'children'` on a node means "list my children, not me" (a level group, a glTF scene root)
 *   - an unnamed, mesh-less group directly under the scene that holds 2+ mesh-bearing children is treated as a
 *     plain container and its children are listed instead (the common `const world = new Group()` pattern),
 *     unless the code placed the group itself (a barn built from walls, roof and door: one object; see
 *     isPlainContainer)
 *
 * Keys, first that applies (see the placement plan §4-2):
 *   1. `userData.studioKey` — the author's explicit mark; the most stable (names get reused, e.g. every tree "tree")
 *   2. `name`; the 2nd object with the same name in traversal order gets `name#2`, the 3rd `name#3`, …
 *   3. `userData.id` / `userData.name`
 *   4. the position in the tree, `path:0/3/1` (child indices from the scene) — UNSTABLE: any code change that adds
 *      an object earlier in the tree shifts it. Listed with `unstable: true` so the editor can say "no name".
 * Keys match /^[A-Za-z0-9_:#.\-\/]{1,80}$/. Other characters become "_" and the original text stays in `label`.
 */

export const KEY_RE = /^[A-Za-z0-9_:#.\-/]{1,80}$/;
const MAX_CANDIDATES = 500; // same cap as placement.json; a scene with more movable things is out of scope

/** Make any string a valid key (keeps it readable: "Big Tree (1)" → "Big_Tree__1_"). */
export function sanitizeKey(s) {
  let k = String(s).replace(/[^A-Za-z0-9_:#.\-/]/g, '_').slice(0, 80);
  if (!k) k = '_';
  return k;
}

/** Things that are never movable on their own. */
export function isExcluded(o) {
  if (!o) return true;
  const ud = o.userData || {};
  if (ud.studio === false) return true;
  if (o.isLight || o.isCamera || o.isBone || o.isAudio || o.isAudioListener) return true;
  if (o.isInstancedMesh || o.isBatchedMesh || o.isPoints || o.isLine || o.isSprite) return true;
  // Helpers (GridHelper, AxesHelper, BoxHelper, …) are Lines; the light/camera helpers are groups named by type.
  if (typeof o.type === 'string' && /Helper$/.test(o.type)) return true;
  return false;
}

function hasMesh(o) {
  if (isExcluded(o)) return false;
  if (o.isMesh || o.isSkinnedMesh) return true;
  const c = o.children || [];
  for (let i = 0; i < c.length; i++) if (hasMesh(c[i])) return true;
  return false;
}

function meshChildCount(o) {
  let n = 0;
  for (const c of o.children || []) if (hasMesh(c)) n++;
  return n;
}

/** Has the code placed this node itself (moved, turned or sized it)? Missing fields count as untouched. */
function isPlaced(o) {
  const p = o.position, r = o.rotation, s = o.scale;
  if (p && (p.x || p.y || p.z)) return true;
  if (r && (r.x || r.y || r.z)) return true;
  if (s && ((s.x ?? 1) !== 1 || (s.y ?? 1) !== 1 || (s.z ?? 1) !== 1)) return true;
  return false;
}

/** A child that is itself made of 2+ mesh-bearing parts (a tree group inside a forest, a house inside a town). */
function hasCompositeChild(o) {
  for (const c of o.children || []) if (!c.isMesh && !c.isSkinnedMesh && meshChildCount(c) >= 2) return true;
  return false;
}

/** More mesh-bearing children than one built thing has (a barn is 3-10 parts; a level is dozens). */
const MAX_PARTS = 32;

/**
 * An unnamed group directly under the scene: a plain container (list its children) or one object made of parts?
 *
 * WHY the extra tests (dogfood 2026-10-17, "U4"): an AI-written three.js farm builds its barn as
 * `const barn = new Group(); barn.position.set(-6, 0, -5); barn.add(walls, roof, door)`, with no names. The old rule
 * ("unnamed, 2+ mesh children = a container like `const world = new Group()`") listed walls, roof and door as three
 * rows, and clicking the barn selected only its door: the person could not move the barn. A group the code placed
 * itself (moved, turned, sized) is a thing, not a folder; `world` groups sit at the origin. Still a container even
 * when placed: one that holds composite things (a forest of tree groups) or more parts than a thing has.
 * A thing built at the origin out of parts with absolute positions still lists its parts (as before): the person
 * can name it, or the AI can mark it (`userData.studioKey`).
 */
function isPlainContainer(o, parentIsScene) {
  const ud = o.userData || {};
  if (ud.studio === 'children') return true;
  if (ud.studioKey != null) return false;
  if (!parentIsScene || o.name) return false;
  if (o.isMesh || o.isSkinnedMesh) return false;
  const parts = meshChildCount(o);
  if (parts < 2) return false;
  return !isPlaced(o) || hasCompositeChild(o) || parts > MAX_PARTS;
}

/**
 * Walk the scene and return candidates in traversal order:
 * [{ object, key, label, unstable, source: 'mark'|'name'|'userData'|'path', path }]
 */
export function collectCandidates(scene) {
  const found = [];
  const walk = (o, path, parentIsScene, insideCandidate) => {
    if (found.length >= MAX_CANDIDATES) return;
    if (isExcluded(o)) return;
    const ud = o.userData || {};
    const marked = ud.studioKey != null && ud.studioKey !== '';
    if (!insideCandidate || marked) {
      if (isPlainContainer(o, parentIsScene)) {
        (o.children || []).forEach((c, i) => walk(c, path.concat(i), true, false));
        return;
      }
      const meaningful = marked || !!o.name || parentIsScene;
      if (meaningful && hasMesh(o)) {
        found.push({ object: o, path });
        (o.children || []).forEach((c, i) => walk(c, path.concat(i), false, true));
        return;
      }
    }
    (o.children || []).forEach((c, i) => walk(c, path.concat(i), false, insideCandidate));
  };
  (scene.children || []).forEach((c, i) => walk(c, [i], true, false));
  return assignKeys(found);
}

function assignKeys(found) {
  const used = new Set();
  const nameCount = new Map();
  const out = [];
  const take = (base) => {
    let k = base;
    for (let n = 2; used.has(k); n++) k = sanitizeKey(`${base.slice(0, 74)}#${n}`);
    used.add(k);
    return k;
  };
  // Pass 1: explicit marks claim their keys first, so a later name can never steal an author's key.
  const marks = new Map();
  for (const f of found) {
    const ud = f.object.userData || {};
    if (ud.studioKey != null && ud.studioKey !== '') marks.set(f, take(sanitizeKey(ud.studioKey)));
  }
  for (const f of found) {
    const o = f.object;
    const ud = o.userData || {};
    const pathStr = f.path.join('/');
    let key;
    let source;
    let label;
    if (marks.has(f)) {
      key = marks.get(f);
      source = 'mark';
      label = String(ud.studioKey);
    } else if (o.name) {
      const n = (nameCount.get(o.name) || 0) + 1;
      nameCount.set(o.name, n);
      const base = sanitizeKey(o.name);
      key = take(n === 1 ? base : sanitizeKey(`${base.slice(0, 74)}#${n}`));
      source = 'name';
      label = o.name;
    } else if (ud.id != null && ud.id !== '' && (typeof ud.id === 'string' || typeof ud.id === 'number')) {
      key = take(sanitizeKey(ud.id));
      source = 'userData';
      label = String(ud.id);
    } else if (typeof ud.name === 'string' && ud.name) {
      key = take(sanitizeKey(ud.name));
      source = 'userData';
      label = ud.name;
    } else {
      key = take(`path:${pathStr}`);
      source = 'path';
      label = null;
    }
    out.push({ object: o, key, label: label ?? key, unstable: source === 'path', source, path: pathStr });
  }
  return out;
}

/** Map key → Object3D for a scene (what the loader needs). */
export function keyMap(scene) {
  const m = new Map();
  for (const c of collectCandidates(scene)) m.set(c.key, c.object);
  return m;
}
