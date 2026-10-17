// The one validator for the two result files (contract 4): placement.json and library.json.
//
// WHY one function in one place: the shell (before it sends), the local server (before it writes)
// and a hosted server later (before it stores) must agree byte for byte on what a valid file is.
// If each side had its own checks they would drift, and an AI agent reading the file would see
// shapes nobody tested. So everything that accepts or writes these files imports this module.
//
// What "valid" means here, and why:
// - Strict shape: unknown fields are rejected, not ignored. The files are a hand-off format for an
//   AI agent; an unexpected field would be read as meaningful by the agent. (The *loader* inside
//   the game is the lenient side: it warns and skips, so one bad entry never breaks a game.)
// - Bounded: at most 500 objects, coordinates within +/-10000 m (3D) or +/-100000 px (2D).
//   Real scenes are far smaller; the bounds stop a runaway drag (NaN, 1e308) from being saved.
// - Rounded: 1 mm (3D) / 0.1 px (2D) / 1e-4 rad. Finer precision is noise from a pointer drag and
//   makes diffs and code search ("was" values) harder for the agent.
// - Canonical: the same content always serializes to the same bytes (keys sorted, order-free lists
//   sorted and de-duplicated). Saving twice without changes produces no diff.
// - Prototype-safe: "__proto__", "constructor" and "prototype" are refused as keys anywhere, so a
//   crafted file cannot pollute objects in code that merges it.
//
// This file is plain JavaScript with no imports so it runs unchanged in Node, in the browser and in
// a bundled single-file CLI.

export const LIMITS = Object.freeze({
  maxBytes: 256 * 1024, // raw JSON text; 500 objects with labels and "was" stay well under this
  maxObjects: 500,
  maxReplace: 500,
  maxAdded: 500,
  maxUnused: 5000, // a big asset folder can have thousands of files nobody references
  maxUsedBy: 500,
  maxCoord3d: 10000, // metres
  maxCoord2d: 100000, // pixels
  step3d: 1000, // 1 / 1000 = 1 mm
  step2d: 10, // 1 / 10 = 0.1 px
  stepAngle: 10000, // 1 / 10000 rad
  stepScale: 10000,
  minScale: 0.0001,
  maxScale: 10000,
  maxLabel: 120,
  maxPath: 300,
  maxUrl: 2000,
  maxDepth: 8,
  maxOrders: 100, // sibling lists with a changed draw order (2D layers)
});

// Object keys (contract section "keys"): letters, digits and _ : # . - /, 1 to 80 chars.
// "path:0/3/1" (position in the scene graph) and "tree#2" (second object named "tree") both fit.
export const KEY_RE = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ERRORS = 20;

/**
 * Validate and normalize a placement.json or library.json.
 *
 * @param {string | object} input  JSON text or an already parsed value.
 * @param {{ tool?: 'placement' | 'library' }} [opts]  When set, the file must be this tool's file.
 * @returns {{ ok: true, value: object, json: string } | { ok: false, errors: string[] }}
 *   `value` is the normalized object; `json` is its canonical text (what should be written to disk).
 */
export function validateStudioFile(input, opts = {}) {
  const errors = [];
  const fail = (where, msg) => {
    if (errors.length < MAX_ERRORS) errors.push(where ? `${where}: ${msg}` : msg);
  };

  let data = input;
  if (typeof input === 'string') {
    // Length in UTF-16 units is a cheap upper bound check before parsing; the byte check follows.
    if (input.length > LIMITS.maxBytes || utf8Length(input) > LIMITS.maxBytes) {
      return { ok: false, errors: [`file is larger than ${LIMITS.maxBytes} bytes`] };
    }
    try {
      data = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`not valid JSON (${e.message})`] };
    }
  }

  // Structural pass first: plain data only, no forbidden keys, bounded depth. Everything after this
  // can assume ordinary objects and arrays.
  if (!checkPlain(data, '', 0, fail)) return { ok: false, errors };
  if (!isObject(data)) return { ok: false, errors: ['the file must be a JSON object'] };

  if (data.version !== 1) fail('version', 'must be 1');
  if (data.tool !== 'placement' && data.tool !== 'library') {
    fail('tool', 'must be "placement" or "library"');
    return { ok: false, errors };
  }
  if (opts.tool && data.tool !== opts.tool) {
    fail('tool', `expected "${opts.tool}"`);
    return { ok: false, errors };
  }

  const value = data.tool === 'placement' ? placement(data, fail) : library(data, fail);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value, json: canonicalJSON(value) };
}

/**
 * Stable JSON text: object keys sorted at every level, 2-space indent, trailing newline.
 * Arrays of numbers stay on one line ("p": [3.25, 0, -4.1]) so a person or an agent reads one
 * object per few lines, and so the "was" values look like the numbers in the game's code
 * (an agent searches the code for "3.25, 0, -4.1" to find the line to rewrite).
 */
export function canonicalJSON(value) {
  return stringify(sortKeys(value), '') + '\n';
}

function stringify(v, indent) {
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every((x) => typeof x === 'number')) return '[' + v.map((x) => JSON.stringify(x)).join(', ') + ']';
    const inner = indent + '  ';
    return '[\n' + v.map((x) => inner + stringify(x, inner)).join(',\n') + '\n' + indent + ']';
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    const inner = indent + '  ';
    return '{\n' + keys.map((k) => inner + JSON.stringify(k) + ': ' + stringify(v[k], inner)).join(',\n') + '\n' + indent + '}';
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------------------------
// placement.json

function placement(data, fail) {
  onlyFields(data, ['version', 'tool', 'dim', 'space', 'objects', 'order', 'added', 'removed'], '', fail);
  const dim = data.dim;
  if (dim !== '3d' && dim !== '2d') fail('dim', 'must be "3d" or "2d"');
  // "local" = positions are relative to the object's parent (what object.position means in both
  // three.js and PixiJS). Missing means local; other spaces are reserved for later tools.
  const space = data.space === undefined ? 'local' : data.space;
  if (space !== 'local') fail('space', 'must be "local"');

  const out = { version: 1, tool: 'placement', dim, space, objects: {} };
  if (!isObject(data.objects)) {
    fail('objects', 'must be an object keyed by object key');
    return out;
  }
  const keys = Object.keys(data.objects);
  if (keys.length > LIMITS.maxObjects) fail('objects', `at most ${LIMITS.maxObjects} objects`);
  if (dim !== '3d' && dim !== '2d') return out;

  for (const key of keys.slice(0, LIMITS.maxObjects)) {
    const where = `objects[${JSON.stringify(key)}]`;
    if (!KEY_RE.test(key)) {
      fail(where, 'key must match ' + KEY_RE);
      continue;
    }
    const entry = data.objects[key];
    if (!isObject(entry)) {
      fail(where, 'must be an object');
      continue;
    }
    onlyFields(entry, ['p', 'r', 's', 't', 'was', 'label', 'unstable'], where, fail);
    const pose = readPose(entry, dim, where, fail);
    if (pose.p === undefined && pose.r === undefined && pose.s === undefined && pose.t === undefined) {
      fail(where, 'needs at least one of p, r, s, t');
    }
    const o = { ...pose };
    if (entry.was !== undefined) {
      if (!isObject(entry.was)) fail(`${where}.was`, 'must be an object');
      else {
        onlyFields(entry.was, ['p', 'r', 's', 't'], `${where}.was`, fail);
        const was = readPose(entry.was, dim, `${where}.was`, fail);
        if (Object.keys(was).length) o.was = was;
      }
    }
    if (entry.label !== undefined) {
      const label = readLabel(entry.label, `${where}.label`, fail);
      if (label) o.label = label;
    }
    if (entry.unstable !== undefined && typeof entry.unstable !== 'boolean') {
      fail(`${where}.unstable`, 'must be true or false');
    }
    // A scene-graph path key changes whenever the code adds or reorders objects, so it is always
    // flagged, whatever the sender said. The agent uses the flag to suggest naming the object.
    if (entry.unstable === true || key.startsWith('path:')) o.unstable = true;
    out.objects[key] = o;
  }
  if (data.order !== undefined) {
    const order = readOrder(data.order, dim, fail);
    if (order.length) out.order = order;
  }
  if (data.added !== undefined) {
    const added = readAdded(data.added, dim, fail);
    if (added.length) out.added = added;
  }
  if (data.removed !== undefined) {
    const removed = readRemoved(data.removed, dim, fail);
    if (removed.length) out.removed = removed;
  }
  // One key, one meaning: a copy is never also a moved object or a deleted one.
  const addedKeys = new Set((out.added || []).map((a) => a.key));
  for (const k of addedKeys) if (Object.hasOwn(out.objects, k)) fail(`added`, `"${k}" is also in objects`);
  for (const r of out.removed || []) if (addedKeys.has(r.key)) fail(`removed`, `"${r.key}" is also in added`);
  return out;
}

// Copies made in the editor: [{ key, from, p, r?, s?, label? }]. The order is kept (it is the order
// they were made, so a copy of a copy comes after the copy it was made from), unlike most lists here.
function readAdded(v, dim, fail) {
  const list = optionalArray(v, 'added', LIMITS.maxObjects, fail);
  const out = [];
  const seen = new Set();
  list.forEach((item, i) => {
    const where = `added[${i}]`;
    if (!isObject(item)) return fail(where, 'must be an object');
    onlyFields(item, ['key', 'from', 'p', 'r', 's', 't', 'label'], where, fail);
    if (typeof item.key !== 'string' || !KEY_RE.test(item.key)) return fail(`${where}.key`, 'must match ' + KEY_RE);
    if (typeof item.from !== 'string' || !KEY_RE.test(item.from)) return fail(`${where}.from`, 'must match ' + KEY_RE);
    if (item.key === item.from) return fail(where, '"key" and "from" are the same');
    if (seen.has(item.key)) return fail(`${where}.key`, `"${item.key}" is listed twice`);
    seen.add(item.key);
    if (item.p === undefined) return fail(`${where}.p`, 'is required');
    const pose = readPose(item, dim, where, fail);
    if (!pose.p) return;
    const o = { key: item.key, from: item.from, ...pose };
    if (item.label !== undefined) {
      const label = readLabel(item.label, `${where}.label`, fail);
      if (label) o.label = label;
    }
    out.push(o);
  });
  return out;
}

// Objects deleted in the editor: [{ key, label?, was?, unstable? }], sorted by key.
function readRemoved(v, dim, fail) {
  const list = optionalArray(v, 'removed', LIMITS.maxObjects, fail);
  const out = [];
  const seen = new Set();
  list.forEach((item, i) => {
    const where = `removed[${i}]`;
    if (!isObject(item)) return fail(where, 'must be an object');
    onlyFields(item, ['key', 'label', 'was', 'unstable'], where, fail);
    if (typeof item.key !== 'string' || !KEY_RE.test(item.key)) return fail(`${where}.key`, 'must match ' + KEY_RE);
    if (seen.has(item.key)) return fail(`${where}.key`, `"${item.key}" is listed twice`);
    seen.add(item.key);
    const o = { key: item.key };
    if (item.label !== undefined) {
      const label = readLabel(item.label, `${where}.label`, fail);
      if (label) o.label = label;
    }
    if (item.was !== undefined) {
      if (!isObject(item.was)) fail(`${where}.was`, 'must be an object');
      else {
        onlyFields(item.was, ['p', 'r', 's', 't'], `${where}.was`, fail);
        const was = readPose(item.was, dim, `${where}.was`, fail);
        if (Object.keys(was).length) o.was = was;
      }
    }
    if (item.unstable !== undefined && typeof item.unstable !== 'boolean') fail(`${where}.unstable`, 'must be true or false');
    if (item.unstable === true || item.key.startsWith('path:')) o.unstable = true;
    out.push(o);
  });
  return out.sort((a, b) => cmp(a.key, b.key));
}

// Draw orders (2D layers): [{ in, keys, was? }], keys back -> front. Unlike the other lists in these
// files the key lists are NOT sorted: their order is the content. The entries themselves are sorted
// by `in` so the same orders always give the same bytes.
function readOrder(v, dim, fail) {
  if (dim !== '2d') {
    fail('order', 'only 2D games have a draw order');
    return [];
  }
  const list = optionalArray(v, 'order', LIMITS.maxOrders, fail);
  const out = [];
  const seenIn = new Set();
  list.forEach((item, i) => {
    const where = `order[${i}]`;
    if (!isObject(item)) return fail(where, 'must be an object');
    onlyFields(item, ['in', 'keys', 'was'], where, fail);
    if (typeof item.in !== 'string' || !KEY_RE.test(item.in)) return fail(`${where}.in`, 'must match ' + KEY_RE);
    if (seenIn.has(item.in)) return fail(`${where}.in`, `"${item.in}" is listed twice`);
    seenIn.add(item.in);
    const keys = readOrderedKeys(item.keys, `${where}.keys`, fail);
    if (!keys) return;
    const o = { in: item.in, keys };
    if (item.was !== undefined) {
      const was = readOrderedKeys(item.was, `${where}.was`, fail);
      if (was) o.was = was;
    }
    out.push(o);
  });
  return out.sort((a, b) => cmp(a.in, b.in));
}

// Like readKeyList (library usedBy) but the order is kept and duplicates are an error.
function readOrderedKeys(v, where, fail) {
  if (!Array.isArray(v) || v.length === 0) {
    fail(where, 'must be a non-empty array of object keys');
    return null;
  }
  if (v.length > LIMITS.maxObjects) {
    fail(where, `at most ${LIMITS.maxObjects} keys`);
    return null;
  }
  const seen = new Set();
  for (const [i, k] of v.entries()) {
    if (typeof k !== 'string' || !KEY_RE.test(k)) {
      fail(`${where}[${i}]`, 'must match ' + KEY_RE);
      return null;
    }
    if (seen.has(k)) {
      fail(`${where}[${i}]`, `"${k}" is listed twice`);
      return null;
    }
    seen.add(k);
  }
  return v.slice();
}

// p / r / s / t for one object. 3D: p = [x, y, z] metres, r = yaw (rotation.y) radians,
// s = uniform number or [x, y, z], t = optional tilt [rotation.x, rotation.z] radians (only when the
// object was tipped in the editor; absent = the game's own x / z rotation stays). 2D: p = [x, y] px,
// r = angle radians (clockwise, as PixiJS), s = number or [x, y]; no t (2D turns on one axis).
function readPose(src, dim, where, fail) {
  const n = dim === '3d' ? 3 : 2;
  const bound = dim === '3d' ? LIMITS.maxCoord3d : LIMITS.maxCoord2d;
  const step = dim === '3d' ? LIMITS.step3d : LIMITS.step2d;
  const pose = {};
  if (src.p !== undefined) {
    if (!Array.isArray(src.p) || src.p.length !== n) fail(`${where}.p`, `must be ${n} numbers`);
    else {
      const p = src.p.map((v, i) => readNumber(v, -bound, bound, `${where}.p[${i}]`, fail));
      if (p.every((v) => v !== null)) pose.p = p.map((v) => round(v, step));
    }
  }
  if (src.r !== undefined) {
    const r = readNumber(src.r, -1e6, 1e6, `${where}.r`, fail);
    if (r !== null) pose.r = normalizeAngle(r);
  }
  if (src.s !== undefined) {
    const s = readScale(src.s, n, `${where}.s`, fail);
    if (s !== null) pose.s = s;
  }
  if (src.t !== undefined) {
    if (dim !== '3d') fail(`${where}.t`, 'is only for 3D (2D turns on one axis: use r)');
    else if (!Array.isArray(src.t) || src.t.length !== 2) fail(`${where}.t`, 'must be 2 numbers: [rotation.x, rotation.z] in radians');
    else {
      const t = src.t.map((v, i) => readNumber(v, -1e6, 1e6, `${where}.t[${i}]`, fail));
      if (t.every((v) => v !== null)) pose.t = t.map(normalizeAngle);
    }
  }
  return pose;
}

function readScale(v, n, where, fail) {
  const one = (x, w) => {
    const s = readNumber(x, -LIMITS.maxScale, LIMITS.maxScale, w, fail);
    if (s === null) return null;
    const r = round(s, LIMITS.stepScale);
    // Negative scale is allowed (mirroring a sprite is common in 2D); zero is not, because it
    // makes the object invisible and un-pickable in the editor.
    if (Math.abs(r) < LIMITS.minScale) {
      fail(w, `must not be 0 (absolute value at least ${LIMITS.minScale})`);
      return null;
    }
    return r;
  };
  if (typeof v === 'number') return one(v, where);
  if (!Array.isArray(v) || v.length !== n) {
    fail(where, `must be a number or ${n} numbers`);
    return null;
  }
  const s = v.map((x, i) => one(x, `${where}[${i}]`));
  if (s.some((x) => x === null)) return null;
  // [2, 2, 2] and 2 mean the same thing; collapse so equal content gives equal bytes.
  return s.every((x) => x === s[0]) ? s[0] : s;
}

// Into (-pi, pi], then rounded to 1e-4. After rounding, -pi lands on -3.1416, which is outside the
// range by less than one step; it is folded to +3.1416 so the canonical range is [-3.1415, 3.1416].
function normalizeAngle(r) {
  const TAU = Math.PI * 2;
  let a = r - TAU * Math.ceil((r - Math.PI) / TAU);
  if (a <= -Math.PI) a += TAU;
  let out = round(a, LIMITS.stepAngle);
  if (out < -Math.PI) out = -out;
  return out;
}

// ---------------------------------------------------------------------------------------------
// library.json

function library(data, fail) {
  onlyFields(data, ['version', 'tool', 'replace', 'added', 'unused'], '', fail);
  const out = { version: 1, tool: 'library', replace: [], added: [], unused: [] };

  const replace = optionalArray(data.replace, 'replace', LIMITS.maxReplace, fail);
  const seenFrom = new Set();
  replace.forEach((item, i) => {
    const where = `replace[${i}]`;
    if (!isObject(item)) return fail(where, 'must be an object');
    onlyFields(item, ['from', 'to', 'usedBy'], where, fail);
    // "from" may be a remote URL (a texture loaded from a CDN); "to" must be a file in the folder,
    // because the agent rewrites the reference to point at something the user actually has.
    const from = readPathOrUrl(item.from, `${where}.from`, fail);
    const to = readPath(item.to, `${where}.to`, fail);
    if (from === null || to === null) return;
    if (from === to) return fail(where, '"from" and "to" are the same');
    if (seenFrom.has(from)) return fail(`${where}.from`, 'is replaced more than once');
    seenFrom.add(from);
    const r = { from, to };
    if (item.usedBy !== undefined) {
      const used = readKeyList(item.usedBy, `${where}.usedBy`, fail);
      if (used.length) r.usedBy = used;
    }
    out.replace.push(r);
  });
  out.replace.sort((a, b) => cmp(a.from, b.from));

  const added = optionalArray(data.added, 'added', LIMITS.maxAdded, fail);
  added.forEach((item, i) => {
    const where = `added[${i}]`;
    if (!isObject(item)) return fail(where, 'must be an object');
    onlyFields(item, ['file', 'place'], where, fail);
    const file = readPath(item.file, `${where}.file`, fail);
    if (file === null) return;
    const a = { file };
    if (item.place !== undefined) {
      const place = readPlace(item.place, `${where}.place`, fail);
      if (place) a.place = place;
    }
    out.added.push(a);
  });
  // Order of "added" is kept: two drops of the same file are two objects, and the order is the
  // order the user placed them, which the agent may mirror in code.

  const unused = optionalArray(data.unused, 'unused', LIMITS.maxUnused, fail);
  const set = new Set();
  unused.forEach((p, i) => {
    const path = readPath(p, `unused[${i}]`, fail);
    if (path !== null) set.add(path);
  });
  out.unused = [...set].sort(cmp);
  return out;
}

// Where a newly added asset was placed. No "dim" in library.json, so the dimension comes from the
// length of p (3 = metres, 2 = pixels) and the same bounds and rounding as placement.json apply.
function readPlace(v, where, fail) {
  if (!isObject(v)) {
    fail(where, 'must be an object');
    return null;
  }
  onlyFields(v, ['key', 'p', 'r', 's'], where, fail);
  if (typeof v.key !== 'string' || !KEY_RE.test(v.key)) {
    fail(`${where}.key`, 'must match ' + KEY_RE);
    return null;
  }
  if (!Array.isArray(v.p) || (v.p.length !== 2 && v.p.length !== 3)) {
    fail(`${where}.p`, 'must be 2 or 3 numbers');
    return null;
  }
  const pose = readPose(v, v.p.length === 3 ? '3d' : '2d', where, fail);
  return { key: v.key, ...pose };
}

function readKeyList(v, where, fail) {
  if (!Array.isArray(v)) {
    fail(where, 'must be an array of keys');
    return [];
  }
  if (v.length > LIMITS.maxUsedBy) fail(where, `at most ${LIMITS.maxUsedBy} keys`);
  const set = new Set();
  v.slice(0, LIMITS.maxUsedBy).forEach((k, i) => {
    if (typeof k !== 'string' || !KEY_RE.test(k)) fail(`${where}[${i}]`, 'must match ' + KEY_RE);
    else set.add(k);
  });
  return [...set].sort(cmp);
}

/**
 * A file path relative to the game folder, POSIX style: "assets/tree.png".
 * Refused: absolute paths, "." / ".." segments, backslashes, control characters, drive letters.
 * Exported because the server uses the same rule for uploads and the library tool for display.
 */
export function isSafeRelativePath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > LIMITS.maxPath) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return false;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function readPath(v, where, fail) {
  if (!isSafeRelativePath(v)) {
    fail(where, 'must be a relative path inside the game folder (like "assets/tree.png")');
    return null;
  }
  return v;
}

function readPathOrUrl(v, where, fail) {
  if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
    if (v.length > LIMITS.maxUrl || /[\u0000- \u007f]/.test(v)) {
      fail(where, 'is not a usable URL');
      return null;
    }
    return v;
  }
  return readPath(v, where, fail);
}

// ---------------------------------------------------------------------------------------------
// small helpers

function checkPlain(v, where, depth, fail) {
  if (depth > LIMITS.maxDepth) {
    fail(where, 'nested too deeply');
    return false;
  }
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') {
    if (Number.isFinite(v)) return true;
    fail(where, 'numbers must be finite');
    return false;
  }
  if (Array.isArray(v)) return v.every((x, i) => checkPlain(x, `${where}[${i}]`, depth + 1, fail));
  if (isObject(v)) {
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEYS.has(k)) {
        fail(where, `the key "${k}" is not allowed`);
        return false;
      }
      if (!checkPlain(v[k], where ? `${where}.${k}` : k, depth + 1, fail)) return false;
    }
    return true;
  }
  fail(where, 'only JSON values are allowed');
  return false;
}

function isObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function onlyFields(obj, allowed, where, fail) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(where ? `${where}.${k}` : k, 'unknown field');
  }
}

function optionalArray(v, where, max, fail) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    fail(where, 'must be an array');
    return [];
  }
  if (v.length > max) {
    fail(where, `at most ${max} entries`);
    return [];
  }
  return v;
}

function readNumber(v, min, max, where, fail) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail(where, 'must be a finite number');
    return null;
  }
  if (v < min || v > max) {
    fail(where, `must be between ${min} and ${max}`);
    return null;
  }
  return v;
}

function readLabel(v, where, fail) {
  if (typeof v !== 'string') {
    fail(where, 'must be a string');
    return null;
  }
  // Labels come from object names in someone's game: untrusted text. Control characters are
  // dropped (they break terminals and diffs); HTML is not escaped here because every consumer must
  // render labels as text, never as markup.
  return v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, LIMITS.maxLabel);
}

// Math.round(v * step) / step: dividing an integer by a power of ten yields the double closest to
// the short decimal, so 3.25 serializes as "3.25", not "3.2500000000000004".
function round(v, step) {
  const r = Math.round(v * step) / step;
  return r === 0 ? 0 : r; // fold -0 into 0
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort(cmp)) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
