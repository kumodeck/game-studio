// studio-placement.js: apply placement.json to a running game (three.js or PixiJS) and to its HTML UI.
//
//   import { applyPlacement } from './studio-placement.js';
//   const report = await applyPlacement(scene, './placement.json'); // three: the Scene; Pixi: app.stage
//   // report = { applied: ['tree-01'], missing: ['old-rock'], unstable: ['path:0/3/1'], skipped: [] }
//   await applyPlacement(document, './placement.json');             // a game with no world (HTML only): the UI only
//
// `ui` (UI stage 1, 2026-10-19): HTML elements marked data-studio-key="title-logo" that were moved / resized in the
// editor's UI layer. Each gets the CSS `translate` / `scale` properties (offset in CSS px from where the game's own
// CSS puts it); left / top / transform are never touched, so a title centred with transform: translate(-50%, -50%)
// stays centred. A translate / scale the game's stylesheet already gives is kept (the offset is added to it). Applied
// before the world, whatever the world's dim, and also to elements the game adds later (a game-over screen built
// with innerHTML): only when the file has a `ui`, so other games pay nothing. report.ui = { applied, missing }.
//
// `levels` (2026-10-22): a game with several levels gets one world part per level in the file. Pass the level being
// built: applyPlacement(scene, './placement.json', { level: 'cave' }). Without `level`, a file with levels moves
// nothing in the world (another level's layout must never land on this one); the UI is applied either way.
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
//
// `motion` (motion-gui, 2026-10-22: asked for as "build an object's movement with the GUI"): per key, a path the object
// goes along and / or a spin, made in the editor's card. Run by this file from the game's own frames, so a game that
// loads placement.json moves them without any code of its own:
//   position = the place it was given (after `objects`) + motionAt(m, seconds).off
//   angle    = the angle it was given + spin × seconds (three: rotation.y; Pixi: rotation)
// NOT inside the editor (the page URL has studio=edit): there the editor owns every pose, plays one object's motion
// itself (▶ on the card) and must see the place, not a point along the way. A game that writes the object's position
// every frame itself (physics, its own update) wins over this; the skill tells the AI to put the motion into that code.
// report.motion = the keys that move; stopMotion() stops them all (a game that wants to take over).
//
// `motions` + `when` / `until` (studio-motion-triggers, 2026-10-22: "a motion starts when something happens, stops when
// something happens, or runs the whole game"): `motions` at the top are the Library's motions (len / repeat / keys);
// an object's clip `{ use: 'Hop', when, until }` uses one by name. When it starts:
//   start · time (after N s) · key (KeyboardEvent.code) · click (Pixi: a tap on it; three: the game's camera, learnt
//   from scene.onBeforeRender) · after (another clip ended) · enter (an object walks into a box: `who`'s key, or
//   setPlayer(obj)) — all run here; touch · cue · say need the game: touch(key), cue(name), playMotion(key, name).
// until: { times } rounds, { cue } a named cue; then 'reset' = back to its first pose. motionRunner() is the one place
// for these rules; the editor's "Try" uses it too. report.motionWaits = the clips that wait for the game's code.

const KEY_CHARS = /[^A-Za-z0-9_:#.\-\/]/g;
const cleanName = (s) => (typeof s === 'string' && s ? s.replace(KEY_CHARS, '_').slice(0, 80) : '');

/**
 * @param {object} root  three.js Scene/Object3D or PixiJS Container (app.stage)
 * @param {string | object} [source]  URL of placement.json (default './placement.json') or its parsed content
 * @param {{ level?: string }} [opts]  level: the id of the level being built (a game with levels)
 * @returns {Promise<{ applied: string[], missing: string[], unstable: string[], skipped: string[] }>}
 */
export async function applyPlacement(root, source = './placement.json', opts = {}) {
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
  if (data.ui && typeof data.ui === 'object' && typeof document !== 'undefined') report.ui = applyUi(document, data.ui);
  if (root && root.nodeType === 9) return report; // applyPlacement(document): the UI only
  if (data.dim !== dim) {
    warn('the file is for ' + data.dim + ' but the root is a ' + (three ? 'three.js' : 'PixiJS') + ' object');
    return report;
  }
  if (Array.isArray(data.levels)) {
    if (!(opts && opts.level)) {
      warn('this file has levels: pass { level } to applyPlacement');
      return report;
    }
    data = placementForLevel(data, opts.level);
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
  if ((data.motion && typeof data.motion === 'object') || Array.isArray(data.motions)) runMotion(root, data, n, three, report);
  if (report.missing.length) warn(report.missing.length + ' key(s) not found, ignored: ' + report.missing.slice(0, 10).join(', '));
  if (report.skipped.length) warn(report.skipped.length + ' entr(ies) with bad values, ignored: ' + report.skipped.slice(0, 10).join(', '));
  return report;
}

// The keys moved by this file (any copy of it on the page): the editor's ▶ Play (bridge/play-arrange.ts) leaves them
// alone, so an object is never moved twice. A global symbol, because the game and the editor each load their own copy.
const MOVING = Symbol.for('game-studio.motion');
// Every object this file can move: key → { o, three, base, clips }. `base` is the pose after `objects` (the place every
// key is an offset from); `clips` are resolved (a Library motion's len / repeat / keys filled in, `when` read).
// `run` decides what plays when (motionRunner, shared with the editor's "Try"); one frame loop poses what it says.
const known = new Map();
let run = null;
let ticking = false;
// The world given to applyPlacement and the Library's motions in its file: playMotion(key, name) can start a Library
// motion on an object it was never attached to ("make the crate Hop when…": the AI's one line).
let world = null;
let library = [];
// setPlayer(obj): who walks into the areas of `enter` clips that name no `who` (or a `who` the loader cannot find).
let player = null;

/**
 * Stop the motion of one object (`key`), or of every object (no key). The objects stay where they are now. A stopped
 * key stays in the "moved by the loader" set: the game took it over, the editor's Play must not start it again.
 */
export function stopMotion(key) {
  if (key === undefined) {
    if (run) run.stop();
    olds.clear();
    if (globalThis[MOVING]) globalThis[MOVING].clear();
  } else {
    if (run) run.stop(key);
    const k = known.get(key);
    if (k) olds.delete(k);
  }
}

/**
 * Play one of an object's named motions from its start: the cue a game gives ("the player reached the door" →
 * playMotion('door', 'Open')). The name is the object's clip, or any Library motion (`motions` in the file), even one
 * that is not on this object. The clip playing on that object stops where it is and this one takes over.
 * false = no such object / motion, or inside the editor.
 */
export function playMotion(key, name) {
  if (editing()) return false;
  let k = known.get(key);
  let clip = k && k.clips.find((c) => c.name === name);
  if (!clip) {
    const lib = library.find((m) => m && m.name === name);
    const o = !lib ? null : k ? k.o : world && findByKey(world, key, !!world.isObject3D);
    if (!o) return false;
    if (!k) k = remember(key, o, !!world.isObject3D, []);
    clip = { ...lib, use: name, when: { on: 'say' } };
    k.clips.push(clip);
  }
  ensureRun().play(key, clip, performance.now());
  tickSoon();
  return true;
}

/** A named cue happened in the game ("chest-opened"): the clips that start on it start, the ones that stop on it stop. */
export function cue(name) {
  return fire({ on: 'cue', cue: name });
}

/** The player touched this object (the game's own collision): its clips that start on a touch start. */
export function touch(key) {
  return fire({ on: 'touch', key });
}

/** The object that walks into areas (`enter` clips): for a game whose player has no key the loader can find. */
export function setPlayer(obj) {
  player = obj || null;
  tickSoon();
}

function fire(ev) {
  if (!run || editing()) return false;
  const n = run.fire(ev, performance.now());
  tickSoon();
  return n > 0;
}

/** An object's clip by name (for a game that moves the object itself: clipAt(clipOf('door', 'Open'), seconds)). */
export function clipOf(key, name) {
  const k = known.get(key);
  return (k && k.clips.find((c) => c.name === name)) || resolveClip(library.find((m) => m && m.name === name) ? { use: name } : null, library);
}

/**
 * When a clip starts, in one shape: studio-motion-triggers' `when` object, or studio-timeline's (`start: true` = at
 * once; else a string `when` = the person's words for the AI; a clip with `use` and no `when` = at once).
 */
export function whenOf(c) {
  if (!c || typeof c !== 'object') return { on: 'say' };
  const w = c.when;
  if (w && typeof w === 'object' && typeof w.on === 'string') return w;
  if (c.start === true || (c.use && w === undefined)) return { on: 'start' };
  return typeof w === 'string' && w.trim() ? { on: 'say', say: w } : { on: 'say' };
}

/** A clip as it plays: a `use` clip gets its Library motion's len / repeat / keys; null = bad, or a motion not there. */
export function resolveClip(c, lib) {
  if (!c || typeof c !== 'object') return null;
  if (typeof c.use === 'string') {
    const m = (Array.isArray(lib) ? lib : []).find((x) => x && x.name === c.use && x.keys && typeof x.keys === 'object');
    return m ? { name: typeof c.name === 'string' ? c.name : c.use, use: c.use, len: m.len, repeat: m.repeat, keys: m.keys, when: whenOf(c), until: c.until } : null;
  }
  return typeof c.name === 'string' && c.keys && typeof c.keys === 'object' ? { ...c, when: whenOf(c) } : null;
}

/**
 * What plays when (studio-motion-triggers, 2026-10-22): one place for the rules, used by this file in the game and by
 * the editor's "Try" (the same answers in both). No DOM, no scene: it is told what happened (fire), asked where things
 * are (step) and answers each moving key's offsets (clipAt's shape).
 *   objs: [{ key, clips }] with resolved clips (resolveClip). The rules:
 *   - a clip starts on its `when` (fire's event, or by itself: `time` after `after` seconds, `after` when that clip
 *     ends, `enter` when the player's position goes into the area: step's `where(who)`); again = from its start;
 *   - one clip per object plays: a new one takes over where the last one is (as playMotion always did);
 *   - `until.times` = after that many rounds (a loop: len; a pingpong: there and back; a once: its length),
 *     `until.cue` = when that cue fires; `then: 'reset'` puts it back on its first pose, else it stays where it is.
 */
export function motionRunner(objs) {
  const list = (Array.isArray(objs) ? objs : []).filter((x) => x && Array.isArray(x.clips));
  const movers = new Map();
  const held = new Map();
  let t0 = null;
  const timed = new Set();
  const inside = new Map();
  const ok = (v) => typeof v === 'number' && isFinite(v);
  const round = (c) => (ok(c.len) && c.len > 0 ? c.len : 1) * (c.repeat === 'pingpong' ? 2 : 1);
  const hits = (w, ev, key) => {
    if (!w || w.on !== ev.on) return false;
    if (ev.on === 'key') return w.key === ev.key;
    if (ev.on === 'cue') return w.cue === ev.cue;
    if (ev.on === 'after') return w.use === ev.use && (w.key || key) === ev.key;
    if (ev.on === 'click' || ev.on === 'touch' || ev.on === 'enter' || ev.on === 'say') return ev.key === key && (ev.on !== 'say' || !ev.use || ev.use === w.use);
    return true;
  };
  const play = (key, clip, now) => {
    movers.set(key, { clip, t0: now });
    held.delete(key);
  };
  const end = (key, r, at, now, out) => {
    movers.delete(key);
    const pose = r.clip.until && r.clip.until.then === 'reset' ? clipAt(r.clip, 0) : at;
    held.set(key, pose);
    out.set(key, pose);
    fireAt({ on: 'after', key, use: r.clip.use || r.clip.name }, now);
  };
  function fireAt(ev, now) {
    let n = 0;
    if (ev.on === 'start') t0 = now;
    for (const { key, clips } of list) {
      for (const c of clips) if (hits(c.when, ev, key)) (play(key, c, now), n++);
      const r = movers.get(key);
      if (ev.on === 'cue' && r && r.clip.until && r.clip.until.cue === ev.cue) {
        const out = new Map();
        end(key, r, clipAt(r.clip, (now - r.t0) / 1000), now, out);
        n++;
      }
    }
    return n;
  }
  return {
    fire: fireAt,
    play,
    /** Stop one key, or all (no key): they stay where they are, nothing more plays on them until fired again. */
    stop(key) {
      if (key === undefined) (movers.clear(), held.clear());
      else movers.delete(key), held.delete(key);
    },
    /** Something still to watch: a clip playing, a timer not fired yet, an area. */
    busy: () => movers.size > 0 || list.some(({ clips }) => clips.some((c) => (c.when && c.when.on === 'enter') || (c.when && c.when.on === 'time' && t0 !== null && !timed.has(c)))),
    /** Where things are at `now` (ms): key → offsets ({ p, r, s }) for every object playing or holding its last pose. */
    step(now, where) {
      const out = new Map();
      if (t0 !== null) for (const { key, clips } of list) for (const c of clips) {
        const w = c.when;
        if (w && w.on === 'time' && !timed.has(c) && (now - t0) / 1000 >= (ok(w.after) ? w.after : 0)) (timed.add(c), play(key, c, now));
      }
      if (where) for (const { key, clips } of list) for (const c of clips) {
        const w = c.when;
        if (!w || w.on !== 'enter' || !w.area || !Array.isArray(w.area.p) || !Array.isArray(w.area.size)) continue;
        const p = where(w.who || null);
        const isIn = !!p && w.area.p.every((v, i) => Math.abs((p[i] || 0) - v) <= Math.abs(w.area.size[i] || 0) / 2);
        if (isIn && !inside.get(c)) play(key, c, now);
        inside.set(c, isIn);
      }
      for (const [key, r] of [...movers]) {
        const t = Math.max(0, (now - r.t0) / 1000);
        const u = r.clip.until;
        const stopAt = u && ok(u.times) && u.times > 0 ? u.times * round(r.clip) : null;
        // A `once` clip with rounds plays again from its start each round ("hop 3 times"), then stops at its end.
        const again = stopAt !== null && r.clip.repeat !== 'loop' && r.clip.repeat !== 'pingpong';
        const tt = (u2) => (again ? Math.min(u2, stopAt) % round(r.clip) || (u2 > 0 ? round(r.clip) : 0) : u2);
        if (stopAt !== null && t >= stopAt) end(key, r, clipAt(r.clip, again ? round(r.clip) : stopAt - 1e-6), now, out);
        else {
          const at = clipAt(r.clip, tt(t));
          if (again) at.done = false;
          out.set(key, at);
          if (at.done) end(key, r, at, now, out);
        }
      }
      for (const [key, at] of held) if (!out.has(key)) out.set(key, at);
      return out;
    },
    /** What each object plays now (key → clip name): the editor's rows light up with it. */
    playing: () => new Map([...movers].map(([k, r]) => [k, r.clip.name])),
  };
}

/**
 * Where a clip is after `t` seconds: offsets from the object's place, per property — `p` added to the position, `r`
 * added to the angles ([x, y, z] in 3D, [angle] in 2D), `s` multiplying the size — each null when the clip has no key
 * for it (that property is left as it is). `done` = a `once` clip has reached its end (it stays on its last pose).
 * Shared with the editor (the timeline's scrub and ▶, Play), so the editor and the game move the same way.
 */
export function clipAt(c, t) {
  const out = { p: null, r: null, s: null, done: false };
  if (!c || typeof c !== 'object' || !c.keys || typeof c.keys !== 'object') return out;
  const len = isNum(c.len) && c.len > 0 ? c.len : 1;
  let u = isNum(t) ? Math.max(0, t) : 0;
  if (c.repeat === 'loop') u %= len;
  else if (c.repeat === 'pingpong') (u %= 2 * len), (u = u > len ? 2 * len - u : u);
  else if (u >= len) (u = len), (out.done = true);
  for (const ch of ['p', 'r', 's']) out[ch] = trackAt(c.keys[ch], u, ch === 'p');
  return out;
}

/**
 * One property's value at `u` seconds into its clip, from its keys ({ t, v, ease }, in time order). Before the first
 * key: the first; after the last: the last. `ease` is how a key goes on to the next one: 'linear' (the same speed),
 * 'ease' (the default: starts slowly and stops slowly), 'step' (holds, then jumps at the next key). `smooth` (the
 * position): the way goes through the points on a curve (Catmull-Rom), not in straight lines — the shape the editor
 * draws as the path; a 'step' key breaks the curve there.
 */
export function trackAt(keys, u, smooth) {
  const ks = Array.isArray(keys) ? keys.filter((k) => k && isNum(k.t) && Array.isArray(k.v) && k.v.length && k.v.every(isNum)) : [];
  if (!ks.length) return null;
  const n = ks[0].v.length;
  if (ks.some((k) => k.v.length !== n)) return null;
  if (!(u > ks[0].t)) return ks[0].v.slice();
  const last = ks[ks.length - 1];
  if (u >= last.t) return last.v.slice();
  let i = 0;
  while (i < ks.length - 2 && u >= ks[i + 1].t) i++;
  const a = ks[i], b = ks[i + 1], ease = a.ease || 'ease';
  if (ease === 'step') return a.v.slice();
  let f = b.t > a.t ? (u - a.t) / (b.t - a.t) : 1;
  if (ease === 'ease') f = f * f * (3 - 2 * f);
  if (!smooth || ks.length < 3) return a.v.map((v, k) => v + (b.v[k] - v) * f);
  const p0 = i > 0 && (ks[i - 1].ease || 'ease') !== 'step' ? ks[i - 1].v : a.v;
  const p3 = i + 2 < ks.length && (b.ease || 'ease') !== 'step' ? ks[i + 2].v : b.v;
  const f2 = f * f, f3 = f2 * f;
  return a.v.map((v, k) => 0.5 * (2 * v + (b.v[k] - p0[k]) * f + (2 * p0[k] - 5 * v + 4 * b.v[k] - p3[k]) * f2 + (3 * v - p0[k] - 3 * b.v[k] + p3[k]) * f3));
}

/**
 * Where a motion is after `t` seconds: `off` = the offset from the object's place (null without a path), `turn` = the
 * angle added (spin × t), `done` = a `once` path has arrived. The older shape of `motion` (v0.1.13: a path, a speed,
 * a spin), still played for files saved before the timeline; the editor turns it into a clip when it opens one.
 * Path points are offsets from the place, the start ([0, 0(, 0)]) left out; constant speed along straight lines;
 * `repeat` pingpong (default: there and back), loop (back to the start and round again), once (stops at the last point).
 */
export function motionAt(m, t) {
  const out = { off: null, turn: 0, done: false };
  if (!m || typeof m !== 'object') return out;
  if (isNum(m.spin)) out.turn = m.spin * t;
  const n = Array.isArray(m.path) && Array.isArray(m.path[0]) ? m.path[0].length : 0;
  const path = n ? m.path.filter((q) => Array.isArray(q) && q.length === n && q.every(isNum)) : [];
  if (!path.length) return out;
  const rep = m.repeat === 'loop' || m.repeat === 'once' ? m.repeat : 'pingpong';
  const pts = [path[0].map(() => 0), ...path];
  if (rep === 'loop') pts.push(pts[0]);
  const lens = pts.slice(1).map((q, i) => Math.hypot(...q.map((v, k) => v - pts[i][k])));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = Math.max(0, (isNum(m.speed) && m.speed > 0 ? m.speed : 1) * t);
  if (!(total > 0)) return (out.off = pts[0]), out;
  if (rep === 'once') (out.done = d >= total), (d = Math.min(d, total));
  else if (rep === 'loop') d %= total;
  else (d %= 2 * total), (d = d > total ? 2 * total - d : d);
  let i = 0;
  while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
  const f = lens[i] ? Math.min(1, d / lens[i]) : 0;
  out.off = pts[i].map((v, k) => v + (pts[i + 1][k] - v) * f);
  return out;
}

/** A legacy motion (path / spin) as the same offsets clipAt gives: the editor and the loader play both one way. */
function legacyAt(m, t, n) {
  const a = motionAt(m, t);
  return { p: a.off, r: isNum(m.spin) ? (n === 3 ? [0, a.turn, 0] : [a.turn]) : null, s: null, done: a.done };
}

/** Put `o` at its place + the offsets `at` (clipAt's shape). Only the properties `at` has are touched. */
function poseAt(o, base, at, three) {
  if (at.p) three ? o.position.set(base.p[0] + at.p[0], base.p[1] + at.p[1], base.p[2] + at.p[2]) : o.position.set(base.p[0] + at.p[0], base.p[1] + at.p[1]);
  if (at.r) {
    if (three) (o.rotation.x = base.r[0] + (at.r[0] || 0)), (o.rotation.y = base.r[1] + (at.r[1] || 0)), (o.rotation.z = base.r[2] + (at.r[2] || 0));
    else o.rotation = base.r[0] + (at.r[0] || 0);
  }
  if (at.s) three ? o.scale.set(base.s[0] * at.s[0], base.s[1] * at.s[1], base.s[2] * at.s[2]) : o.scale.set(base.s[0] * at.s[0], base.s[1] * at.s[1]);
}

const editing = () => typeof location !== 'undefined' && /[?&]studio=edit(&|$)/.test(location.search);

function remember(key, o, three, clips) {
  const base = three
    ? { p: [o.position.x, o.position.y, o.position.z], r: [o.rotation.x, o.rotation.y, o.rotation.z], s: [o.scale.x, o.scale.y, o.scale.z] }
    : { p: [o.position.x, o.position.y], r: [o.rotation], s: [o.scale.x, o.scale.y] };
  const k = { o, three, base, clips };
  known.set(key, k);
  (globalThis[MOVING] || (globalThis[MOVING] = new Set())).add(key);
  return k;
}

function ensureRun() {
  if (!run) run = motionRunner([...known].map(([key, k]) => ({ key, clips: k.clips })));
  return run;
}

// Where `who` is in the world (an `enter` area's test): the object with that key, else setPlayer's.
function whereIs(who) {
  const o = (who && world && findByKey(world, who, !!world.isObject3D)) || player;
  if (!o || !o.position) return null;
  if (o.getWorldPosition) {
    const v = o.getWorldPosition(o.position.clone());
    return [v.x, v.y, v.z];
  }
  return [o.position.x, o.position.y];
}

// One loop per applyPlacement: a new file (another level, the game restarted) starts a new generation and the old loop
// ends at its next frame, so two loops never pose the same object.
let gen = 0;
function tickSoon() {
  if (ticking || !run || typeof requestAnimationFrame !== 'function') return;
  ticking = true;
  const g = gen;
  const tick = (now) => {
    if (g !== gen) return;
    if (!run.busy() && !olds.size) return void (ticking = false);
    for (const [k, l] of olds) {
      if (k.o.parent === null) olds.delete(k);
      else poseAt(k.o, k.base, legacyAt(l.m, (now - l.t0) / 1000, l.n), k.three);
    }
    for (const [key, at] of run.step(now, whereIs)) {
      const k = known.get(key);
      // The object left the scene (another level was built; three and Pixi set parent to null): forget it.
      if (!k || k.o.parent === null) run.stop(key);
      else poseAt(k.o, k.base, at, k.three);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * The `motion` part of the file: each object's clips (a Library motion it uses, or keys of its own), each starting on
 * its `when` (whenOf) — or the older path / spin. Nothing runs inside the editor (studio=edit in the URL): there the
 * editor owns every pose and plays the timeline itself. Keys and clicks are listened to once per page.
 */
function runMotion(root, data, n, three, report) {
  world = root;
  library = Array.isArray(data.motions) ? data.motions.filter((m) => m && typeof m.name === 'string') : [];
  const motion = data.motion && typeof data.motion === 'object' ? data.motion : {};
  if (editing()) return;
  gen++;
  ticking = false;
  known.clear();
  clicks.clear();
  olds.clear();
  if (run) run.stop();
  run = null;
  const list = [];
  const legacy = [];
  const warn2 = [];
  for (const key of Object.keys(motion)) {
    const m = motion[key], o = findByKey(root, key, three);
    if (!o || !m || typeof m !== 'object') continue;
    const clips = Array.isArray(m.clips) ? m.clips.map((c) => resolveClip(c, library)).filter(Boolean) : [];
    const old = !clips.length && (isNum(m.spin) || (Array.isArray(m.path) && m.path.length && m.path.every((q) => Array.isArray(q) && q.length === n && q.every(isNum))));
    if (!clips.length && !old) continue;
    // The older path / spin plays at once, as a clip of the same shape (clipAt is not its maths: a frame function).
    const k = remember(key, o, three, clips);
    if (old) legacy.push([key, k, m]);
    for (const c of clips) {
      const w = c.when;
      if (w.on === 'click') clickable(key, o, three);
      if (w.on === 'enter' && !(w.who && findByKey(root, w.who, three)) && !player) warn2.push(key + ': no player for its area (setPlayer)');
      if (w.on === 'touch' || w.on === 'cue' || w.on === 'say') warn2.push(key + ' · ' + c.name + ': waits for the game (' + w.on + ')');
    }
    list.push(key);
  }
  if (!list.length) return;
  report.motion = list;
  if (warn2.length) report.motionWaits = warn2;
  ensureRun().fire({ on: 'start' }, performance.now());
  listen(three);
  for (const [, k, m] of legacy) olds.set(k, { m, t0: performance.now(), n });
  tickSoon();
}

// v0.1.13's path / spin (no clip, so the runner does not know it): object → { m, t0, n }, posed by the same frame loop.
const olds = new Map();

let listening = false;
const clicks = new Map();
let view = null;
function listen(three) {
  if (listening || typeof addEventListener !== 'function') return;
  listening = true;
  addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (e.repeat || tag === 'INPUT' || tag === 'TEXTAREA') return;
    fire({ on: 'key', key: e.code });
  });
  // three: the camera and canvas the game draws with, learnt from the scene's onBeforeRender (no import of three here).
  if (three && world && world.isScene) {
    const was = world.onBeforeRender;
    world.onBeforeRender = function (renderer, scene, camera) {
      view = { camera, canvas: renderer && renderer.domElement };
      if (typeof was === 'function') return was.apply(this, arguments);
    };
    addEventListener('pointerdown', (e) => {
      if (!view || !view.camera || e.target !== view.canvas) return;
      const hit = clickedKey(e, view);
      if (hit) fire({ on: 'click', key: hit });
    });
  }
}

/** Pixi: the object itself takes taps. three: noted, found by clickedKey from the drawn picture. */
function clickable(key, o, three) {
  clicks.set(key, o);
  if (!three && typeof o.on === 'function') {
    o.eventMode = 'static';
    o.cursor = 'pointer';
    o.on('pointertap', () => fire({ on: 'click', key }));
  }
}

// The nearest clickable object under the pointer: each one's bounding sphere, projected with the game's camera.
function clickedKey(e, v) {
  const r = v.canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null, bestD = Infinity;
  for (const [key, o] of clicks) {
    if (o.parent === null) continue;
    o.updateWorldMatrix && o.updateWorldMatrix(true, true);
    o.traverse((m) => {
      const g = m.geometry;
      if (!g || !m.visible) return;
      if (!g.boundingSphere && g.computeBoundingSphere) g.computeBoundingSphere();
      if (!g.boundingSphere) return;
      const c = g.boundingSphere.center.clone().applyMatrix4(m.matrixWorld);
      const rad = g.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis();
      const camPos = v.camera.getWorldPosition(c.clone());
      const dist = c.distanceTo(camPos);
      const p = c.clone().project(v.camera);
      if (p.z > 1 || p.z < -1) return;
      const sx = ((p.x + 1) / 2) * r.width, sy = ((1 - p.y) / 2) * r.height;
      const fov = v.camera.fov ? (v.camera.fov * Math.PI) / 180 : 1;
      const sr = Math.max(8, (rad / Math.max(1e-6, dist * Math.tan(fov / 2))) * (r.height / 2));
      if (Math.hypot(sx - x, sy - y) <= sr && dist < bestD) (best = key), (bestD = dist);
    });
  }
  return best;
}

/**
 * The file as one level sees it (levels, 2026-10-22): that level's objects / added / removed / order / motion at the
 * top, no `levels` (`motion` is a level's own since integrate3: its keys are that level's objects). A file without levels comes back as it is; a level the file does not list has nothing to apply.
 */
export function placementForLevel(data, id) {
  if (!data || !Array.isArray(data.levels)) return data;
  const l = data.levels.find((x) => x && x.id === id) || {};
  const out = { ...data, objects: l.objects || {} };
  for (const k of ['added', 'removed', 'order', 'motion']) if (l[k]) out[k] = l[k];
  else delete out[k];
  delete out.levels;
  delete out.levelsWas;
  return out;
}

function applyUi(doc, ui) {
  const out = { applied: [], missing: [] };
  const put = (el) => {
    const k = el.dataset.studioKey, e = Object.hasOwn(ui, k) && ui[k];
    if (!e || !Array.isArray(e.p) || e.p.length !== 2 || !e.p.every(isNum) || (e.s !== undefined && !isNum(e.s))) return;
    if (placeUi(el, e.p, e.s === undefined ? 1 : e.s) && !out.applied.includes(k)) out.applied.push(k);
  };
  doc.querySelectorAll('[data-studio-key]').forEach(put);
  for (const k of Object.keys(ui)) if (!out.applied.includes(k)) out.missing.push(k);
  // Elements made later (a result screen written with innerHTML, a HUD rebuilt each round) get the same place.
  if (typeof MutationObserver === 'function') {
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) {
        if (n.dataset.studioKey) put(n);
        n.querySelectorAll('[data-studio-key]').forEach(put);
      }
    }).observe(doc.documentElement, { childList: true, subtree: true });
  }
  return out;
}

// Per element: the translate / scale its stylesheet gives (read once, before anything is added) and the offset now.
const UI_STATE = Symbol.for('game-studio.ui');

/**
 * Put a UI element `p` = [dx, dy] CSS px from where the game's CSS puts it, at scale `s` (1 = as the game draws it).
 * Shared with the editor's UI layer (src/adapters/ui), so the editor and the game agree to the pixel. false = the
 * game itself writes an inline translate / scale on this element (it moves it): left alone.
 * The size keeps the element's middle where it is: CSS `scale` grows the box around its transform-origin, and a title
 * centred with transform: translate(-50%, -50%) has its box shifted away from that origin, so it would walk. The
 * correction is worked out here, from the box as it is now, and never saved: `p` stays "how far the middle moved",
 * right on any window size. A ResizeObserver works it out again when the box changes (a hidden screen shown later,
 * a window resized), only for elements with a size of their own (s ≠ 1).
 */
export function placeUi(el, p, s) {
  let st = el[UI_STATE];
  if (!st) {
    if (el.style.translate || el.style.scale) return false;
    const cs = getComputedStyle(el);
    st = el[UI_STATE] = { t: cssParts(cs.translate), s: cssParts(cs.scale), p: [0, 0], v: 1 };
  }
  st.p = [p[0], p[1]];
  st.v = s;
  const t = st.t, b = st.s ? st.s.map((x) => parseFloat(x) / (x.endsWith('%') ? 100 : 1)) : [1];
  const bx = b[0], by = b[1] === undefined ? bx : b[1];
  let x = p[0], y = p[1];
  if (s !== 1) {
    const cs = getComputedStyle(el);
    const m = /^matrix(3d)?\(([^)]+)\)/.exec(cs.transform);
    const v = m ? m[2].split(',').map(Number) : null;
    const [a, bb, c, d, e, f] = !v ? [1, 0, 0, 1, 0, 0] : m[1] ? [v[0], v[1], v[4], v[5], v[12], v[13]] : v;
    const o = (cs.transformOrigin || '').split(' ').map(parseFloat);
    const ux = (el.offsetWidth || 0) / 2 - (o[0] || 0), uy = (el.offsetHeight || 0) / 2 - (o[1] || 0);
    if (el.offsetWidth !== undefined && (m || cs.transform === 'none')) {
      x -= (s - 1) * bx * (a * ux + c * uy + e);
      y -= (s - 1) * by * (bb * ux + d * uy + f);
    }
    if (!st.ro && typeof ResizeObserver === 'function') (st.ro = new ResizeObserver(() => placeUi(el, st.p, st.v))).observe(el);
  }
  const none = !x && !y && s === 1;
  el.style.translate = none ? '' : t ? `calc(${t[0]} + ${x}px) calc(${t[1] || '0px'} + ${y}px)${t[2] ? ' ' + t[2] : ''}` : `${x}px ${y}px`;
  el.style.scale = s === 1 ? '' : st.s ? `${bx * s} ${by * s}${b[2] === undefined ? '' : ' ' + b[2]}` : String(s);
  return true;
}

/** The offset placeUi() last gave (p [0, 0], s 1 for an element it never touched). */
export function uiOffset(el) {
  const st = el[UI_STATE];
  return st ? { p: st.p.slice(), s: st.v } : { p: [0, 0], s: 1 };
}

// "none" → null; "-50% 0px" / "calc(-50% + 4px) 2px" → its space-separated values (spaces inside one level of () kept).
function cssParts(v) {
  return !v || v === 'none' ? null : v.match(/(?:[^\s(]|\([^)]*\))+/g);
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
