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
  // 12 since the timeline (studio-timeline, 2026-10-22): levels → [i] → motion → key → clips → [j] → keys → p → [k] → v →
  // [m] is 11 deep; 8 was enough for every earlier part (levels → [i] → objects → key → p → [k] is 6).
  maxDepth: 12,
  maxOrders: 100, // sibling lists with a changed draw order (2D layers)
  maxLevels: 100, // levels of one game (2026-10-22); each has its own 500 objects, the whole file its maxBytes
  // `ui` (the game's HTML UI moved in the editor's UI layer, UI stage 1, 2026-10-19): offsets in CSS px from where the
  // game's own CSS puts the element. 200 elements / 10,000 px / scale 0.1–10 are far beyond a real title screen or HUD;
  // they stop a runaway drag, like the bounds above.
  maxUi: 200,
  maxUiCoord: 10000,
  minUiScale: 0.1,
  maxUiScale: 10,
  maxUiView: 100000,
  // UI stages 2–3 (2026-10-22): a text typed on the card (200 characters: a title, a button, a line of a dialogue), a
  // colour / a theme value (64 / 200: "#rrggbbaa", rgb(), a font list), a font size 1–500 px, 100 theme variables.
  maxUiText: 200,
  maxUiColor: 64,
  maxUiValue: 200,
  minUiFont: 1,
  maxUiFont: 500,
  maxTheme: 100,
  // `motion` (motion-gui, 2026-10-22): a path of at most 32 points (a patrol round a yard has 4–8; more is a curve, which
  // is stage 2), speeds up to 1 km/s or 100,000 px/s and spins up to 100 rad/s (16 turns a second): far beyond a
  // moving platform or a spinning coin, they stop a runaway field like the bounds above. Speeds round to 1 mm/s / 0.1
  // px/s, spins like angles.
  maxMotionPoints: 32,
  maxSpeed3d: 1000,
  maxSpeed2d: 100000,
  maxSpin: 100,
  // `motion` clips (the timeline, studio-timeline 2026-10-22): 16 named motions per object, 256 keys per property, 10
  // minutes long, angles up to ±1000 rad (a key may hold many turns: a wheel that rolls for a minute). Far beyond a
  // door, a lift or a patrol; they stop a runaway file like the bounds above. Times round to 1 ms.
  maxClips: 16,
  maxClipKeys: 256,
  minClipLen: 0.1,
  maxClipLen: 600,
  maxClipName: 40,
  maxClipWhen: 200,
  maxClipAngle: 1000,
  stepTime: 1000,
  // When a motion plays (studio-motion-triggers, 2026-10-22): 64 Library motions per file (a game has a handful: Open,
  // Bob, Spin), a cue name like a key (lower case, digits, -: written as is into the game's code), up to 1000 rounds.
  maxMotions: 64,
  maxRounds: 1000,
  // studio-timeline-2 (2026-10-22): up to 4 ways a motion starts ("E or a click or walking in": a handful at most).
  maxWhens: 4,
});

/** When a motion starts (contract MotionWhen.on). */
export const MOTION_TRIGGERS = Object.freeze(['start', 'time', 'key', 'click', 'after', 'enter', 'touch', 'cue', 'say']);
/** A cue's name: "chest-opened", "boss-down". */
export const CUE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A key's KeyboardEvent.code: "KeyE", "Space", "ArrowUp", "Digit1". */
const KEY_CODE_RE = /^[A-Za-z][A-Za-z0-9]{1,24}$/;

/** How a key goes on to the next (contract MotionKey.ease). */
export const MOTION_EASES = Object.freeze(['linear', 'ease', 'step']);

/** The ways a motion repeats (contract Motion.repeat). */
export const MOTION_REPEATS = Object.freeze(['pingpong', 'loop', 'once']);

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
  onlyFields(data, ['version', 'tool', 'dim', 'space', 'objects', 'order', 'added', 'removed', 'ui', 'uiView', 'theme', 'motion', 'motions', 'levels', 'levelsWas'], '', fail);
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
  if (dim !== '3d' && dim !== '2d') return out;
  Object.assign(out, readWorld(data, dim, fail));
  // `ui` / `uiView` are optional: a file without them (every file before UI stage 1, and every game without
  // data-studio-key) comes out exactly as before — same fields, same bytes. `uiView` only travels with a `ui`.
  if (data.ui !== undefined) {
    const ui = readUi(data.ui, fail);
    if (Object.keys(ui).length) {
      out.ui = ui;
      if (data.uiView !== undefined) {
        const view = readUiView(data.uiView, fail);
        if (view) out.uiView = view;
      }
    }
  } else if (data.uiView !== undefined) readUiView(data.uiView, fail);
  // `theme` (UI stage 3) is optional too, and on its own: a theme changed with no element moved is a file with `theme` only.
  if (data.theme !== undefined) {
    const theme = readTheme(data.theme, fail);
    if (Object.keys(theme).length) out.theme = theme;
  }
  // `levels` / `levelsWas` (2026-10-22, CONTRACT.md §4.1) are optional too: absent for every game with one level, so
  // its file keeps its bytes. Each level holds its own world part, read by the same rules as the top one.
  if (data.levels !== undefined) {
    const levels = readLevels(data.levels, dim, fail);
    if (levels.length) {
      if (Object.keys(out.objects).length || out.added || out.removed || out.order || out.motion) fail('levels', 'with levels, the top objects must be {} (each level has its own)');
      out.levels = levels;
      if (data.levelsWas !== undefined) {
        const was = readOrderedKeys(data.levelsWas, 'levelsWas', fail);
        if (was) out.levelsWas = was;
      }
      // An editor-made level is built from a level the code has.
      const code = new Set(out.levelsWas || levels.filter((l) => !l.from).map((l) => l.id));
      for (const l of levels) if (l.from && !code.has(l.from)) fail(`levels[${LEVEL_AT.get(l)}].from`, `"${l.from}" is not one of the code's levels`);
    }
  } else if (data.levelsWas !== undefined) fail('levelsWas', 'only with levels');
  // `motions` (studio-motion-triggers, 2026-10-22): the Library's motions, at the top even with levels. Every clip's
  // `use` must name one of them (a clip that uses nothing would not move).
  const names = new Set();
  if (data.motions !== undefined) {
    const n = dim === '3d' ? 3 : 2;
    const ms = readClips(data.motions, n, dim === '3d' ? LIMITS.maxCoord3d : LIMITS.maxCoord2d, dim === '3d' ? LIMITS.step3d : LIMITS.step2d, 'motions', fail, true);
    for (const m of ms) names.add(m.name);
    if (ms.length) out.motions = ms;
  }
  for (const w of [out, ...(out.levels || [])]) for (const [key, m] of Object.entries(w.motion || {})) for (const c of m.clips || []) {
    if (c.use !== undefined && !names.has(c.use)) fail(`motion[${JSON.stringify(key)}]`, `uses "${c.use}", which is not in motions`);
  }
  return out;
}

/**
 * One world part: `objects` (moves), `order`, `added`, `removed`, `motion` — the top of the file, or one level's (levels,
 * where `objects` may be left out). Returns only the fields that have something, so equal content gives equal bytes.
 */
function readWorld(data, dim, fail, objectsOptional = false) {
  const out = { objects: {} };
  if (data.objects === undefined && objectsOptional) delete out.objects;
  else if (!isObject(data.objects)) {
    fail('objects', 'must be an object keyed by object key');
    return out;
  }
  const keys = Object.keys(data.objects || {});
  if (keys.length > LIMITS.maxObjects) fail('objects', `at most ${LIMITS.maxObjects} objects`);

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
  if (out.objects && objectsOptional && !Object.keys(out.objects).length) delete out.objects;
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
  for (const k of addedKeys) if (out.objects && Object.hasOwn(out.objects, k)) fail(`added`, `"${k}" is also in objects`);
  for (const r of out.removed || []) if (addedKeys.has(r.key)) fail(`removed`, `"${r.key}" is also in added`);
  // `motion` is optional too: absent (every file before motion-gui) = the same bytes as before. A deleted object
  // does not move.
  if (data.motion !== undefined) {
    const motion = readMotion(data.motion, dim, fail);
    for (const r of out.removed || []) if (Object.hasOwn(motion, r.key)) fail(`motion`, `"${r.key}" is also in removed`);
    if (Object.keys(motion).length) out.motion = motion;
  }
  return out;
}

// Where each read level stood in the file (a level listed twice is left out, so the list's own index would be off).
const LEVEL_AT = new WeakMap();

// Levels (2026-10-22): [{ id, label?, labelWas?, from?, objects?, added?, removed?, order?, motion? }]. The order is
// kept: it is the person's order of the levels (the content), like a draw order's keys. Errors inside a level say which
// one. `motion` is part of a level's world (integrate3, 2026-10-22): its keys are that level's objects ("boat" in Meadow
// and in Cave are different boats), so it lives with the level's objects, never at the top next to `levels`.
function readLevels(v, dim, fail) {
  const list = optionalArray(v, 'levels', LIMITS.maxLevels, fail);
  const out = [];
  const seen = new Set();
  list.forEach((item, i) => {
    const where = `levels[${i}]`;
    const lfail = (w, msg) => fail(w ? `${where}.${w}` : where, msg);
    if (!isObject(item)) return fail(where, 'must be an object');
    onlyFields(item, ['id', 'label', 'labelWas', 'from', 'objects', 'added', 'removed', 'order', 'motion'], where, fail);
    if (typeof item.id !== 'string' || !KEY_RE.test(item.id)) return fail(`${where}.id`, 'must match ' + KEY_RE);
    if (seen.has(item.id)) return fail(`${where}.id`, `"${item.id}" is listed twice`);
    seen.add(item.id);
    const o = { id: item.id };
    for (const f of ['label', 'labelWas']) {
      if (item[f] === undefined) continue;
      const label = readLabel(item[f], `${where}.${f}`, fail);
      if (label) o[f] = label;
    }
    if (item.from !== undefined) {
      if (typeof item.from !== 'string' || !KEY_RE.test(item.from)) fail(`${where}.from`, 'must match ' + KEY_RE);
      else if (item.from === item.id) fail(`${where}.from`, 'is the level itself');
      else o.from = item.from;
    }
    Object.assign(o, readWorld(item, dim, lfail, true));
    LEVEL_AT.set(o, i);
    out.push(o);
  });
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

// The game's HTML UI (UI stage 1): { "<data-studio-key>": { p: [dx, dy], s?, label? } }. p = CSS px from the place
// the game's own CSS gives the element (the CSS `translate` the loader adds), s = CSS `scale` (1 is not written:
// equal content, equal bytes). No `was`: the original is always p [0, 0], s 1, and the key itself finds the element
// in the code. Keys use the same characters as object keys. The world's `dim` does not apply: UI is always screen px.
function readUi(v, fail) {
  const out = {};
  if (!isObject(v)) {
    fail('ui', 'must be an object keyed by data-studio-key');
    return out;
  }
  const keys = Object.keys(v);
  if (keys.length > LIMITS.maxUi) fail('ui', `at most ${LIMITS.maxUi} elements`);
  for (const key of keys.slice(0, LIMITS.maxUi)) {
    const where = `ui[${JSON.stringify(key)}]`;
    if (!KEY_RE.test(key)) {
      fail(where, 'key must match ' + KEY_RE);
      continue;
    }
    const e = v[key];
    if (!isObject(e)) {
      fail(where, 'must be an object');
      continue;
    }
    onlyFields(e, ['p', 's', 'label', 'screen', 'set', 'setWas'], where, fail);
    if (!Array.isArray(e.p) || e.p.length !== 2) {
      fail(`${where}.p`, 'must be 2 numbers: [dx, dy] in CSS px');
      continue;
    }
    const p = e.p.map((x, i) => readNumber(x, -LIMITS.maxUiCoord, LIMITS.maxUiCoord, `${where}.p[${i}]`, fail));
    if (p.some((x) => x === null)) continue;
    const o = { p: p.map((x) => round(x, LIMITS.step2d)) };
    if (e.s !== undefined) {
      const sc = readNumber(e.s, LIMITS.minUiScale, LIMITS.maxUiScale, `${where}.s`, fail);
      if (sc !== null && round(sc, LIMITS.stepScale) !== 1) o.s = round(sc, LIMITS.stepScale);
    }
    if (e.label !== undefined) {
      const label = readLabel(e.label, `${where}.label`, fail);
      if (label) o.label = label;
    }
    // UI stage 2: the screen (a data-studio-screen value: key characters).
    if (e.screen !== undefined) {
      if (typeof e.screen !== 'string' || !KEY_RE.test(e.screen)) fail(`${where}.screen`, 'must match ' + KEY_RE);
      else o.screen = e.screen;
    }
    // UI stage 3: what the card changed, and the game's own values. `setWas` only travels with a `set`.
    if (e.set !== undefined) {
      const set = readUiSet(e.set, `${where}.set`, fail);
      if (Object.keys(set).length) {
        o.set = set;
        if (e.setWas !== undefined) {
          const was = readUiSet(e.setWas, `${where}.setWas`, fail);
          if (Object.keys(was).length) o.setWas = was;
        }
      }
    } else if (e.setWas !== undefined) readUiSet(e.setWas, `${where}.setWas`, fail);
    out[key] = o;
  }
  return out;
}

// A colour as CSS writes it: #rgb … #rrggbbaa, rgb()/rgba()/hsl()/hsla() with plain numbers, or a colour word. Never
// anything that could end the declaration it is put in (the loader writes it into a style sheet for the states).
const UI_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]{1,60}\)|[a-zA-Z]{3,30})$/;
// A theme value (a colour, a font list, a length): no ; { } < > \ (it goes into style.setProperty, and into the AI's CSS).
const UI_VALUE_RE = /^[^;{}<>\\\u0000-\u001f\u007f]{1,200}$/;
const THEME_NAME_RE = /^--[A-Za-z0-9_-]{1,60}$/;
const UI_STATES = ['@hover', '@active', '@disabled'];

function readUiColor(v, where, fail) {
  if (typeof v !== 'string' || v.length > LIMITS.maxUiColor || !UI_COLOR_RE.test(v.trim())) {
    fail(where, 'must be a CSS colour (#rrggbb, rgb(), hsl() or a colour name)');
    return null;
  }
  return v.trim();
}

/** `set` / `setWas` of a UI element (UI stage 3): text, fontSize, color, background, and per state color / background. */
function readUiSet(v, where, fail) {
  const out = {};
  if (!isObject(v)) {
    fail(where, 'must be an object');
    return out;
  }
  onlyFields(v, ['text', 'fontSize', 'color', 'background', ...UI_STATES], where, fail);
  if (v.text !== undefined) {
    if (typeof v.text !== 'string') fail(`${where}.text`, 'must be a string');
    else if (v.text.length > LIMITS.maxUiText) fail(`${where}.text`, `at most ${LIMITS.maxUiText} characters`);
    else out.text = v.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  }
  if (v.fontSize !== undefined) {
    const n = readNumber(v.fontSize, LIMITS.minUiFont, LIMITS.maxUiFont, `${where}.fontSize`, fail);
    if (n !== null) out.fontSize = round(n, LIMITS.step2d);
  }
  for (const k of ['color', 'background']) {
    if (v[k] === undefined) continue;
    const c = readUiColor(v[k], `${where}.${k}`, fail);
    if (c) out[k] = c;
  }
  for (const st of UI_STATES) {
    if (v[st] === undefined) continue;
    const w = `${where}[${JSON.stringify(st)}]`;
    if (!isObject(v[st])) {
      fail(w, 'must be an object');
      continue;
    }
    onlyFields(v[st], ['color', 'background'], w, fail);
    const o = {};
    for (const k of ['color', 'background']) {
      if (v[st][k] === undefined) continue;
      const c = readUiColor(v[st][k], `${w}.${k}`, fail);
      if (c) o[k] = c;
    }
    if (Object.keys(o).length) out[st] = o;
  }
  return out;
}

/** `theme` (UI stage 3): { "--accent": { v, was? } }, at most maxTheme, keys in order (same content = same bytes). */
function readTheme(v, fail) {
  const out = {};
  if (!isObject(v)) {
    fail('theme', 'must be an object keyed by CSS variable name (--accent)');
    return out;
  }
  const names = Object.keys(v);
  if (names.length > LIMITS.maxTheme) fail('theme', `at most ${LIMITS.maxTheme} variables`);
  for (const name of names.slice(0, LIMITS.maxTheme)) {
    const where = `theme[${JSON.stringify(name)}]`;
    if (!THEME_NAME_RE.test(name)) {
      fail(where, 'name must match ' + THEME_NAME_RE);
      continue;
    }
    const e = v[name];
    if (!isObject(e)) {
      fail(where, 'must be an object');
      continue;
    }
    onlyFields(e, ['v', 'was'], where, fail);
    const val = (x, w) => (typeof x === 'string' && UI_VALUE_RE.test(x.trim()) ? x.trim() : (fail(w, 'must be a CSS value without ; { } < >'), null));
    const nv = val(e.v, `${where}.v`);
    if (nv === null) continue;
    const o = { v: nv };
    if (e.was !== undefined) {
      const w = val(e.was, `${where}.was`);
      if (w !== null) o.was = w;
    }
    out[name] = o;
  }
  return out;
}

// How objects move by themselves (motion-gui, 2026-10-22): { "<key>": { path?, speed?, repeat?, spin? } }. `path` =
// points as offsets from the object's place (dim's numbers, the start left out), `speed` along it, `repeat` how it goes
// on; `spin` = radians per second round the up axis. A path without speed / repeat gets none written: the loader's
// defaults (1 unit/s, pingpong) apply, but the editor always writes both so the AI reads them plainly.
function readMotion(v, dim, fail) {
  const out = {};
  if (!isObject(v)) {
    fail('motion', 'must be an object keyed by object key');
    return out;
  }
  const keys = Object.keys(v);
  if (keys.length > LIMITS.maxObjects) fail('motion', `at most ${LIMITS.maxObjects} objects`);
  const n = dim === '3d' ? 3 : 2;
  const bound = dim === '3d' ? LIMITS.maxCoord3d : LIMITS.maxCoord2d;
  const step = dim === '3d' ? LIMITS.step3d : LIMITS.step2d;
  for (const key of keys.slice(0, LIMITS.maxObjects)) {
    const where = `motion[${JSON.stringify(key)}]`;
    if (!KEY_RE.test(key)) {
      fail(where, 'key must match ' + KEY_RE);
      continue;
    }
    const e = v[key];
    if (!isObject(e)) {
      fail(where, 'must be an object');
      continue;
    }
    // The timeline's shape (studio-timeline): clips, and nothing of the older shape beside them.
    if (e.clips !== undefined) {
      onlyFields(e, ['clips'], where, fail);
      const clips = readClips(e.clips, n, bound, step, `${where}.clips`, fail);
      if (clips.length) out[key] = { clips };
      continue;
    }
    onlyFields(e, ['path', 'speed', 'repeat', 'spin'], where, fail);
    const o = {};
    if (e.path !== undefined) {
      if (!Array.isArray(e.path) || !e.path.length || e.path.length > LIMITS.maxMotionPoints) {
        fail(`${where}.path`, `must be 1 to ${LIMITS.maxMotionPoints} points`);
      } else {
        const pts = e.path.map((q, i) => {
          if (!Array.isArray(q) || q.length !== n) {
            fail(`${where}.path[${i}]`, `must be ${n} numbers`);
            return null;
          }
          const p = q.map((x, k) => readNumber(x, -bound, bound, `${where}.path[${i}][${k}]`, fail));
          return p.every((x) => x !== null) ? p.map((x) => round(x, step)) : null;
        });
        if (pts.every((q) => q)) o.path = pts;
      }
    }
    if (e.speed !== undefined) {
      const max = dim === '3d' ? LIMITS.maxSpeed3d : LIMITS.maxSpeed2d;
      const sp = readNumber(e.speed, 0, max, `${where}.speed`, fail);
      if (sp !== null && !(sp > 0)) fail(`${where}.speed`, 'must be more than 0');
      else if (sp !== null) o.speed = round(sp, step);
      if (e.path === undefined) fail(`${where}.speed`, 'only with a path');
    }
    if (e.repeat !== undefined) {
      if (!MOTION_REPEATS.includes(e.repeat)) fail(`${where}.repeat`, `must be one of ${MOTION_REPEATS.join(', ')}`);
      else o.repeat = e.repeat;
      if (e.path === undefined) fail(`${where}.repeat`, 'only with a path');
    }
    if (e.spin !== undefined) {
      const sp = readNumber(e.spin, -LIMITS.maxSpin, LIMITS.maxSpin, `${where}.spin`, fail);
      if (sp !== null && round(sp, LIMITS.stepAngle) === 0) fail(`${where}.spin`, 'must not be 0 (leave it out)');
      else if (sp !== null) o.spin = round(sp, LIMITS.stepAngle);
    }
    if (e.path === undefined && e.spin === undefined) fail(where, 'needs a path or a spin');
    if (o.path || o.spin !== undefined) out[key] = o;
  }
  return out;
}

// One object's clips (the timeline, studio-timeline 2026-10-22; contract MotionClip): 1–16, names unique, at most one
// that plays at the start, keys per property in strictly increasing time within the clip's length. Values: position
// offsets like a pose's `p`, angles added (3D three numbers, 2D one), sizes multiplied (like a pose's `s`).
function readClips(v, n, bound, step, where, fail, lib = false) {
  const out = [];
  const max = lib ? LIMITS.maxMotions : LIMITS.maxClips;
  if (!Array.isArray(v) || (!lib && !v.length) || v.length > max) {
    fail(where, `must be ${lib ? 0 : 1} to ${max} ${lib ? 'motions' : 'clips'}`);
    return out;
  }
  const names = new Set();
  let starts = 0;
  const okName = (x) => typeof x === 'string' && !!x.trim() && x.length <= LIMITS.maxClipName && !/[\u0000-\u001f\u007f]/.test(x);
  v.forEach((c, i) => {
    const at = `${where}[${i}]`;
    if (!isObject(c)) return fail(at, 'must be an object');
    // A Library motion (studio-motion-triggers) is a clip without "when"; an object's clip that uses one has no len /
    // repeat / keys of its own.
    if (lib) onlyFields(c, ['name', 'len', 'repeat', 'keys', 'tracks'], at, fail);
    else if (c.use !== undefined) onlyFields(c, ['name', 'use', 'when', 'until'], at, fail);
    else onlyFields(c, ['name', 'len', 'repeat', 'start', 'when', 'until', 'keys'], at, fail);
    const o = {};
    if (c.use !== undefined && !lib) {
      if (!okName(c.use)) return fail(`${at}.use`, `must be 1 to ${LIMITS.maxClipName} characters`);
      const name = c.name === undefined ? c.use : c.name;
      if (!okName(name)) return fail(`${at}.name`, `must be 1 to ${LIMITS.maxClipName} characters`);
      if (names.has(name)) return fail(`${at}.name`, `"${name}" is used twice`);
      names.add(name);
      if (c.name !== undefined && c.name !== c.use) o.name = c.name;
      o.use = c.use;
      readWhenUntil(c, o, n, bound, step, at, fail, true);
      out.push(o);
      return;
    }
    if (!okName(c.name)) fail(`${at}.name`, `must be 1 to ${LIMITS.maxClipName} characters`);
    else if (names.has(c.name)) fail(`${at}.name`, `"${c.name}" is used twice`);
    else (names.add(c.name), (o.name = c.name));
    const len = readNumber(c.len, LIMITS.minClipLen, LIMITS.maxClipLen, `${at}.len`, fail);
    if (len !== null) o.len = round(len, LIMITS.stepTime);
    if (c.repeat !== undefined) {
      if (!MOTION_REPEATS.includes(c.repeat)) fail(`${at}.repeat`, `must be one of ${MOTION_REPEATS.join(', ')}`);
      else o.repeat = c.repeat;
    }
    if (!lib && c.start !== undefined) {
      if (c.start !== true) fail(`${at}.start`, 'must be true (leave it out for a clip that waits for a cue)');
      else if (++starts > 1) fail(`${at}.start`, 'only one clip of an object plays at the start');
      else o.start = true;
    }
    if (!lib) readWhenUntil(c, o, n, bound, step, at, fail, false);
    // A scene motion (studio-timeline-2): keys per object (`tracks`) instead of one object's `keys`.
    if (lib && c.tracks !== undefined) {
      if (c.keys !== undefined) fail(`${at}.keys`, 'a motion has keys or tracks, not both');
      const ks = isObject(c.tracks) ? Object.keys(c.tracks) : [];
      if (!ks.length || ks.length > LIMITS.maxClips) return fail(`${at}.tracks`, `must be an object of 1 to ${LIMITS.maxClips} object keys`);
      o.tracks = {};
      for (const k of ks) {
        if (!KEY_RE.test(k)) fail(`${at}.tracks`, `${JSON.stringify(k)}: key must match ` + KEY_RE);
        else o.tracks[k] = readKeys(c.tracks[k], n, bound, step, len, `${at}.tracks[${JSON.stringify(k)}]`, fail);
      }
    } else o.keys = readKeys(c.keys, n, bound, step, len, `${at}.keys`, fail);
    if (o.name !== undefined && o.len !== undefined) out.push(o);
  });
  return out;
}

// One object's keys per property (contract MotionKeys): 1–256 a property, strictly increasing in time within the
// clip's length. Position keys may carry the path's handles (studio-timeline-2: `in` / `out`, offsets like `v`).
function readKeys(v, n, bound, step, len, at, fail) {
  const out = {};
  if (!isObject(v)) {
    fail(at, 'must be an object');
    return out;
  }
  onlyFields(v, ['p', 'r', 's'], at, fail);
  const widths = { p: n, r: n === 3 ? 3 : 1, s: n };
  const range = { p: [bound, step], r: [LIMITS.maxClipAngle, LIMITS.stepAngle], s: [LIMITS.maxScale, LIMITS.stepScale] };
  for (const ch of ['p', 'r', 's']) {
    if (v[ch] === undefined) continue;
    const kw = `${at}.${ch}`;
    if (!Array.isArray(v[ch]) || !v[ch].length || v[ch].length > LIMITS.maxClipKeys) {
      fail(kw, `must be 1 to ${LIMITS.maxClipKeys} keys`);
      continue;
    }
    let last = -1;
    const [max, st] = range[ch];
    const nums = (a, w) => (Array.isArray(a) && a.length === widths[ch] ? a.map((x, q) => readNumber(x, -max, max, `${w}[${q}]`, fail)) : (fail(w, `must be ${widths[ch]} numbers`), null));
    const ks = v[ch].map((k, j) => {
      const kat = `${kw}[${j}]`;
      if (!isObject(k)) return fail(kat, 'must be an object'), null;
      onlyFields(k, ch === 'p' ? ['t', 'v', 'ease', 'in', 'out'] : ['t', 'v', 'ease'], kat, fail);
      const t = readNumber(k.t, 0, LIMITS.maxClipLen, `${kat}.t`, fail);
      if (t !== null && len !== null && t > len + 1e-9) return fail(`${kat}.t`, 'is after the clip’s end (len)'), null;
      if (t !== null && round(t, LIMITS.stepTime) <= last) return fail(`${kat}.t`, 'keys must be in time order, one per moment'), null;
      if (t !== null) last = round(t, LIMITS.stepTime);
      const vals = nums(k.v, `${kat}.v`);
      if (k.ease !== undefined && !MOTION_EASES.includes(k.ease)) return fail(`${kat}.ease`, `must be one of ${MOTION_EASES.join(', ')}`), null;
      const hs = ['in', 'out'].map((h) => (k[h] === undefined ? undefined : nums(k[h], `${kat}.${h}`)));
      if (t === null || !vals || vals.some((x) => x === null) || hs.some((h) => h === null || (h && h.some((x) => x === null)))) return null;
      const key = { t: round(t, LIMITS.stepTime), v: vals.map((x) => round(x, st)) };
      if (k.ease !== undefined) key.ease = k.ease;
      if (hs[0]) key.in = hs[0].map((x) => round(x, st));
      if (hs[1]) key.out = hs[1].map((x) => round(x, st));
      return key;
    });
    if (ks.every((k) => k)) out[ch] = ks;
  }
  return out;
}

// A clip's `when` / `until` (studio-motion-triggers, 2026-10-22; contract MotionWhen / MotionUntil). `when` may still be
// studio-timeline's words (a string) on a clip with keys of its own; a clip that uses a Library motion has the object.
function readWhenUntil(c, o, n, bound, step, at, fail, uses) {
  const w = c.when;
  if (Array.isArray(w)) {
    // A list (studio-timeline-2: "E or a click"): 2–4 ways, any one starts it.
    if (w.length < 2 || w.length > LIMITS.maxWhens) fail(`${at}.when`, `a list of 2 to ${LIMITS.maxWhens} (one is written as itself)`);
    const xs = w.slice(0, LIMITS.maxWhens).map((x, i) => {
      const one = {};
      readWhenUntil({ when: isObject(x) ? x : 0 }, one, n, bound, step, `${at}.when[${i}]`, fail, true);
      return one.when;
    });
    if (xs.every((x) => x)) o.when = xs;
  } else if (w !== undefined) {
    if (typeof w === 'string' && !uses) {
      if (w.length > LIMITS.maxClipWhen) fail(`${at}.when`, `must be text of at most ${LIMITS.maxClipWhen} characters`);
      else if (c.start) fail(`${at}.when`, 'only for a clip that waits for a cue');
      else o.when = w.replace(/[\u0000-\u001f\u007f]/g, '');
    } else if (!isObject(w) || !MOTION_TRIGGERS.includes(w.on)) fail(`${at}.when.on`, `must be one of ${MOTION_TRIGGERS.join(', ')}`);
    else {
      const wa = `${at}.when`;
      const x = { on: w.on };
      const fields = { start: [], time: ['after'], key: ['key'], click: [], after: ['use', 'key'], enter: ['area', 'who'], touch: [], cue: ['cue'], say: ['say'] }[w.on];
      onlyFields(w, ['on', ...fields], wa, fail);
      if (w.on === 'time') {
        const a = readNumber(w.after, 0, LIMITS.maxClipLen, `${wa}.after`, fail);
        if (a !== null) x.after = round(a, LIMITS.stepTime);
      } else if (w.on === 'key') {
        if (typeof w.key !== 'string' || !KEY_CODE_RE.test(w.key)) fail(`${wa}.key`, 'must be a KeyboardEvent.code ("KeyE", "Space")');
        else x.key = w.key;
      } else if (w.on === 'after') {
        if (typeof w.use !== 'string' || !w.use.trim() || w.use.length > LIMITS.maxClipName) fail(`${wa}.use`, 'must name a motion');
        else x.use = w.use;
        if (w.key !== undefined) {
          if (typeof w.key !== 'string' || !KEY_RE.test(w.key)) fail(`${wa}.key`, 'key must match ' + KEY_RE);
          else x.key = w.key;
        }
      } else if (w.on === 'enter') {
        const ar = w.area;
        if (!isObject(ar)) fail(`${wa}.area`, 'must be { p, size }');
        else {
          onlyFields(ar, ['p', 'size'], `${wa}.area`, fail);
          const nums = (a, lo, f) => (Array.isArray(a) && a.length === n ? a.map((v, k) => readNumber(v, lo, bound, `${wa}.area.${f}[${k}]`, fail)) : (fail(`${wa}.area.${f}`, `must be ${n} numbers`), null));
          const p = nums(ar.p, -bound, 'p');
          const sz = nums(ar.size, 0, 'size');
          if (p && sz && p.every((v) => v !== null) && sz.every((v) => v !== null)) x.area = { p: p.map((v) => round(v, step)), size: sz.map((v) => round(v, step)) };
        }
        if (w.who !== undefined) {
          if (typeof w.who !== 'string' || !KEY_RE.test(w.who)) fail(`${wa}.who`, 'key must match ' + KEY_RE);
          else x.who = w.who;
        }
      } else if (w.on === 'cue') {
        if (typeof w.cue !== 'string' || !CUE_RE.test(w.cue)) fail(`${wa}.cue`, 'must be a cue name: lower case letters, digits and -, like "chest-opened"');
        else x.cue = w.cue;
      } else if (w.on === 'say' && w.say !== undefined) {
        if (typeof w.say !== 'string' || w.say.length > LIMITS.maxClipWhen) fail(`${wa}.say`, `must be text of at most ${LIMITS.maxClipWhen} characters`);
        else if (w.say.trim()) x.say = w.say.replace(/[\u0000-\u001f\u007f]/g, '');
      }
      o.when = x;
    }
  }
  const u = c.until;
  if (u === undefined) return;
  if (!isObject(u)) return fail(`${at}.until`, 'must be { times } or { cue }, with then: stay | reset');
  onlyFields(u, ['times', 'cue', 'then'], `${at}.until`, fail);
  const x = {};
  if (u.times !== undefined) {
    const t = readNumber(u.times, 1, LIMITS.maxRounds, `${at}.until.times`, fail);
    if (t !== null) x.times = Math.round(t);
  }
  if (u.cue !== undefined) {
    if (typeof u.cue !== 'string' || !CUE_RE.test(u.cue)) fail(`${at}.until.cue`, 'must be a cue name like "boss-down"');
    else x.cue = u.cue;
  }
  if (u.then !== undefined && u.then !== 'stay' && u.then !== 'reset') fail(`${at}.until.then`, 'must be stay or reset');
  else if (u.then === 'reset') x.then = 'reset';
  if (Object.keys(x).length) o.until = x;
}

// The game's size in CSS px when the UI was saved: [width, height], whole pixels. A hint for the AI turning offsets
// into % / vw (the offsets themselves stay px).
function readUiView(v, fail) {
  if (!Array.isArray(v) || v.length !== 2) {
    fail('uiView', 'must be 2 numbers: [width, height] in CSS px');
    return null;
  }
  const n = v.map((x, i) => readNumber(x, 1, LIMITS.maxUiView, `uiView[${i}]`, fail));
  return n.some((x) => x === null) ? null : n.map((x) => Math.round(x));
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
