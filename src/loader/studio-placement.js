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
// `ui.<key>.set` and `theme` (UI stage 3, 2026-10-22): what the editor's card changed — the element's main text, that
// text's size and colour, the box's fill, a button's colours when hovered / pressed / disabled — and the game's CSS
// variables (--accent…). Applied here too, so the game shows them before the AI writes them into the code: the
// colours and the fill through one style sheet (#studio-ui-set; a state's with !important, the way :hover beats
// the normal look), set on the element itself when the game's own CSS is more specific; the text and its size on
// the text itself (uiTextPart: data-studio-text, else the element's first own text). theme: style.setProperty on
// <html>. `screen` (UI stage 2) says which screen an element is on: nothing to apply.
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
//
// Code motions, code layouts and keep-out areas (studio-code-base, 2026-10-24: "sometimes a motion is made by maths, not
// by points — what then?", and the four user needs of that day: tune a procedural layout or a formula motion by hand and
// keep it a formula; keep-out areas for a procedural layout, drawn or written as code). The AI writes the formula once in
// the game's code, with 1–3 knobs (the numbers a person would say: a radius, a gap, a count); the editor shows it with
// its name and lets the person turn the knobs; the file keeps only what the person changed ({ v, was }, like a pose):
//   codeMotion('spiral', { name, knobs, round, note, game, drag, at(t, k, g) })   a Library motion whose shape is code:
//       placement.json `motions: [{ name, code: 'spiral', knobs? }]`; it plays only where the file attaches it (a clip
//       `{ use: name }`, `off: true` = switched off). at() answers the offsets { p, r, s } after t seconds, like clipAt.
//   codePlace('hex', { name, knobs, count, make(i), at(i, k, g), drag, avoid })   objects the code puts: made by make(i)
//       and named hex-1, hex-2 … by this file inside applyPlacement (after the world, before `objects`), placed at
//       at(i, k, g) — `places.hex` in the file: knobs, pins ("just this one" by hand, over the formula), hand (all by
//       hand), avoid (keep-out areas), from (hand-placed objects it replaced: hidden). Placed with or without a file.
//   codeAvoid('road', { name, after, knobs, test(p, k, g), show })   a keep-out condition: a layout's place that tests
//       true is tried again (g.try + 1, up to 30 times); a place that never gets out (a row) is left out (skipped).
// report.places = { hex: { keys, skipped } } (a game makes physics bodies for them after applyPlacement, as for the rest).
// The lists are on globalThis (Symbol.for('game-studio.codeMotions' / 'codePlaces' / 'codeAvoids')), so the editor's
// copy in the same page finds what the game's copy was told.

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
  const three = !!(root && root.isObject3D);
  const isWorld = !!root && typeof root === 'object' && root.nodeType !== 9;
  // The world the play hook moves (below), kept before the file is read: a game with no placement.json yet (404) still
  // plays the editor's draft motions in its edit page.
  if (isWorld) last = { root, n: three ? 3 : 2, three };
  // The code's layouts (codePlace) are the game's own objects: put in whatever the file is — none yet, a broken one, one
  // for another level — so a game never loses them because of placement.json (only the person's changes need the file).
  const codeOnly = () => (isWorld && placeCode(root, three, null, report, opts), report);
  let data = source;
  if (typeof source === 'string') {
    try {
      const res = await fetch(source, { cache: 'no-cache' });
      if (!res.ok) return codeOnly(); // no file yet: nothing to apply
      data = await res.json();
    } catch (e) {
      warn('could not read ' + source + ' (' + e.message + ')');
      return codeOnly();
    }
  }
  const dim = three ? '3d' : '2d';
  if (!data || data.tool !== 'placement' || !data.objects || typeof data.objects !== 'object') {
    warn('not a placement file');
    return codeOnly();
  }
  if (data.theme && typeof data.theme === 'object' && typeof document !== 'undefined') applyTheme(document, data.theme);
  if (data.ui && typeof data.ui === 'object' && typeof document !== 'undefined') report.ui = applyUi(document, data.ui);
  if (root && root.nodeType === 9) return report; // applyPlacement(document): the UI only
  if (data.dim !== dim) {
    warn('the file is for ' + data.dim + ' but the root is a ' + (three ? 'three.js' : 'PixiJS') + ' object');
    return codeOnly();
  }
  if (Array.isArray(data.levels)) {
    const level = (opts && opts.level) || levelOfCodeless(data);
    if (!level) {
      warn('this file has levels: pass { level } to applyPlacement');
      return codeOnly();
    }
    data = placementForLevel(data, level);
  }
  const n = three ? 3 : 2;
  // After the world, before `objects`: an entry the person wrote for one of these keys wins over the formula.
  placeCode(root, three, data.places, report, opts);
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
    clip = resolveClip({ use: name, when: { on: 'say' } }, library, key);
    if (clip && clip.code) clip.n = k.three ? 3 : 2;
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
  return (k && k.clips.find((c) => c.name === name)) || resolveClip(library.find((m) => m && m.name === name) ? { use: name } : null, library, key);
}

/**
 * When a clip starts, in one shape: studio-motion-triggers' `when` object, or studio-timeline's (`start: true` = at
 * once; else a string `when` = the person's words for the AI; a clip with `use` and no `when` = at once).
 */
export function whenOf(c) {
  if (!c || typeof c !== 'object') return { on: 'say' };
  const w = Array.isArray(c.when) ? c.when.find((x) => x && typeof x.on === 'string') : c.when;
  if (w && typeof w === 'object' && typeof w.on === 'string') return w;
  if (c.start === true || (c.use && w === undefined)) return { on: 'start' };
  return typeof w === 'string' && w.trim() ? { on: 'say', say: w } : { on: 'say' };
}

/**
 * Every way a clip starts (studio-timeline-2, 2026-10-22: "E or a click"): `when` may be a list — any one of them
 * starts it. One `when` (or none) is a list of one (whenOf's answer).
 */
export function whensOf(c) {
  const ws = c && Array.isArray(c.when) ? c.when.filter((x) => x && typeof x.on === 'string') : [];
  return ws.length ? ws : [whenOf(c)];
}

/**
 * A clip as it plays: a `use` clip gets its Library motion's len / repeat / keys; null = bad, or a motion not there.
 * A scene motion (studio-timeline-2: `tracks`, several objects in one motion) gives object `key` its own track, and
 * `scene: true` (the runner then starts the scene's other objects with it). `when` = the first way it starts (as
 * before), `whens` = all of them (whensOf: the runner's).
 */
export function resolveClip(c, lib, key) {
  if (!c || typeof c !== 'object') return null;
  if (typeof c.use === 'string') {
    const m = (Array.isArray(lib) ? lib : []).find((x) => x && x.name === c.use && (typeof (x.tracks || x.keys) === 'object' || typeof x.code === 'string'));
    const tr = m && m.tracks;
    const off = c.off === true ? { off: true } : {};
    // A code motion (codeMotion): its shape is the code's `at`, with the file's knobs; `key` for at()'s g.key.
    if (m && typeof m.code === 'string') return { name: typeof c.name === 'string' ? c.name : c.use, use: c.use, code: m.code, knobs: m.knobs, key, repeat: 'loop', when: whenOf(c), whens: whensOf(c), until: c.until, ...off };
    return m ? { name: typeof c.name === 'string' ? c.name : c.use, use: c.use, len: m.len, repeat: m.repeat, keys: tr ? tr[key] || {} : m.keys, when: whenOf(c), whens: whensOf(c), until: c.until, scene: !!tr, ...off } : null;
  }
  return typeof c.name === 'string' && c.keys && typeof c.keys === 'object' ? { ...c, when: whenOf(c), whens: whensOf(c) } : null;
}

/**
 * What plays when (studio-motion-triggers, 2026-10-22): one place for the rules, used by this file in the game and by
 * the editor's "Try" (the same answers in both). No DOM, no scene: it is told what happened (fire), asked where things
 * are (step) and answers each moving key's offsets (clipAt's shape).
 *   objs: [{ key, clips }] with resolved clips (resolveClip). The rules:
 *   - a clip starts on its `when` (fire's event, or by itself: `time` after `after` seconds, `after` when that clip
 *     ends, `enter` when the player's position goes into the area: step's `where(who)`); again = from its start;
 *     a list of `when`s: any one of them (studio-timeline-2);
 *   - a scene clip (`scene`: one motion, several objects) that starts starts the scene's other objects at the same
 *     moment, so they keep one time line whichever of them was triggered;
 *   - one clip per object plays: a new one takes over where the last one is (as playMotion always did);
 *   - `until.times` = after that many rounds (a loop: len; a pingpong: there and back; a once: its length),
 *     `until.cue` = when that cue fires; `then: 'reset'` puts it back on its first pose, else it stays where it is.
 */
export function motionRunner(objs) {
  // A clip switched off (`off`, studio-code-base) stays on its object and never plays.
  const list = (Array.isArray(objs) ? objs : []).filter((x) => x && Array.isArray(x.clips)).map((x) => ({ ...x, clips: x.clips.filter((c) => c && !c.off) }));
  const movers = new Map();
  const held = new Map();
  let t0 = null;
  const timed = new Set();
  const inside = new Map();
  const ok = (v) => typeof v === 'number' && isFinite(v);
  // A code motion's round is its code's (codeMotion `round`); one with none never ends, so `until.times` never comes.
  const round = (c) => (c.code ? codeRound(c) || Infinity : (ok(c.len) && c.len > 0 ? c.len : 1) * (c.repeat === 'pingpong' ? 2 : 1));
  // A clip's ways to start (resolveClip's `whens`, studio-timeline-2; else its `when`, one or a list).
  const ws = (c) => c.whens || (Array.isArray(c.when) ? c.when : c.when ? [c.when] : []);
  const hits = (c, ev, key) => ws(c).some((w) => hit(w, ev, key));
  const hit = (w, ev, key) => {
    if (!w || w.on !== ev.on) return false;
    if (ev.on === 'key') return w.key === ev.key;
    if (ev.on === 'cue') return w.cue === ev.cue;
    if (ev.on === 'after') return w.use === ev.use && (w.key || key) === ev.key;
    if (ev.on === 'click' || ev.on === 'touch' || ev.on === 'enter' || ev.on === 'say') return ev.key === key && (ev.on !== 'say' || !ev.use || ev.use === w.use);
    return true;
  };
  const play = (key, clip, now, alone) => {
    movers.set(key, { clip, t0: now });
    held.delete(key);
    if (clip.scene && !alone) for (const o of list) if (o.key !== key) for (const c of o.clips) if (c.use === clip.use) play(o.key, c, now, true);
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
      for (const c of clips) if (hits(c, ev, key)) (play(key, c, now), n++);
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
    busy: () => movers.size > 0 || list.some(({ clips }) => clips.some((c) => ws(c).some((w) => w.on === 'enter' || (w.on === 'time' && t0 !== null && !timed.has(w))))),
    /** Where things are at `now` (ms): key → offsets ({ p, r, s }) for every object playing or holding its last pose. */
    step(now, where) {
      const out = new Map();
      if (t0 !== null) for (const { key, clips } of list) for (const c of clips) for (const w of ws(c)) {
        if (w.on === 'time' && !timed.has(w) && (now - t0) / 1000 >= (ok(w.after) ? w.after : 0)) (timed.add(w), play(key, c, now));
      }
      if (where) for (const { key, clips } of list) for (const c of clips) for (const w of ws(c)) {
        if (w.on !== 'enter' || !w.area || !Array.isArray(w.area.p) || !Array.isArray(w.area.size)) continue;
        const p = where(w.who || null);
        const isIn = !!p && w.area.p.every((v, i) => Math.abs((p[i] || 0) - v) <= Math.abs(w.area.size[i] || 0) / 2);
        if (isIn && !inside.get(w)) play(key, c, now);
        inside.set(w, isIn);
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
  if (c && typeof c === 'object' && typeof c.code === 'string') return codeAt(c, t);
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
  // A span with a handle bent by hand (studio-timeline-2: `out` of its start, `in` of its end) is a Bézier curve; the
  // side without one takes the smooth curve's handle, so only what was bent changes.
  if (smooth && (hOk(a.out, n) || hOk(b.in, n))) {
    const o = handlesOf(ks, i).out, q = handlesOf(ks, i + 1).in, g = 1 - f;
    return a.v.map((v, k) => g * g * g * v + 3 * g * g * f * (v + o[k]) + 3 * g * f * f * (b.v[k] + q[k]) + f * f * f * b.v[k]);
  }
  if (!smooth || ks.length < 3) return a.v.map((v, k) => v + (b.v[k] - v) * f);
  const p0 = i > 0 && (ks[i - 1].ease || 'ease') !== 'step' ? ks[i - 1].v : a.v;
  const p3 = i + 2 < ks.length && (b.ease || 'ease') !== 'step' ? ks[i + 2].v : b.v;
  const f2 = f * f, f3 = f2 * f;
  return a.v.map((v, k) => 0.5 * (2 * v + (b.v[k] - p0[k]) * f + (2 * p0[k] - 5 * v + 4 * b.v[k] - p3[k]) * f2 + (3 * v - p0[k] - 3 * b.v[k] + p3[k]) * f3));
}

const hOk = (h, n) => Array.isArray(h) && h.length === n && h.every(isNum);

/**
 * Position key `i`'s two handles (offsets from its point): its own `in` / `out` (bent by hand; both 0 = a corner), else
 * the smooth curve's — a sixth of the way from the key before to the key after, the Bézier form of the Catmull-Rom
 * curve trackAt draws, so a handle grabbed for the first time starts where the path already is. null at the ends.
 * Shared with the editor (shell/path-edit.ts), which draws these handles.
 */
export function handlesOf(ks, i) {
  const k = ks[i], n = k.v.length, prev = ks[i - 1], next = ks[i + 1];
  const p0 = prev && (prev.ease || 'ease') !== 'step' ? prev.v : k.v;
  const p3 = next && (k.ease || 'ease') !== 'step' ? next.v : k.v;
  return {
    in: !prev ? null : hOk(k.in, n) ? k.in : k.v.map((_, j) => (prev.v[j] - p3[j]) / 6),
    out: !next ? null : hOk(k.out, n) ? k.out : k.v.map((_, j) => (next.v[j] - p0[j]) / 6),
  };
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

// `here`: the editor's page plays now (▶ Play in the same page, play hook below): the motions run as on a Play page.
let here = false;
const editing = () => !here && typeof location !== 'undefined' && /[?&]studio=edit(&|$)/.test(location.search);

// ▶ Play in the editor's own page (studio-no-reload, 2026-10-22: "when I go back to edit after playing, don't load"):
// the edit page becomes Play without opening the game again, so the motions this file runs on a Play page — every
// `when` (a click, an area, a cue, the game's playMotion()) — must start in that page too, from the draft the editor
// sends (it may differ from the file the page read, or the page may have read none). The editor finds this copy through
// a global set (the game and the editor each load their own copy; only the game's has a world: `last`, the root of the
// last applyPlacement given one):
//   start({ motion, motions }) → the keys it moves; stop() → they stop where they are (the editor puts them back).
// Before, a page opened for Edit never started them, and the editor opened a new Play page whenever a clip waited for
// something (bridge/play-switch.ts).
let last = null;
const hook = {
  has: () => !!last,
  start(d) {
    if (!last) return [];
    here = true;
    const r = {};
    runMotion(last.root, { motion: d && d.motion, motions: d && d.motions }, last.n, last.three, r);
    return r.motion || [];
  },
  stop() {
    here = false;
    gen++;
    ticking = false;
    stopMotion();
    known.clear();
    run = null;
  },
};
if (typeof globalThis !== 'undefined') (globalThis[Symbol.for('game-studio.play')] || (globalThis[Symbol.for('game-studio.play')] = new Set())).add(hook);

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
    const clips = Array.isArray(m.clips) ? m.clips.map((c) => resolveClip(c, library, key)).filter((c) => c && !c.off) : [];
    for (const c of clips) if (c.code) c.n = n;
    const old = !clips.length && (isNum(m.spin) || (Array.isArray(m.path) && m.path.length && m.path.every((q) => Array.isArray(q) && q.length === n && q.every(isNum))));
    if (!clips.length && !old) continue;
    // The older path / spin plays at once, as a clip of the same shape (clipAt is not its maths: a frame function).
    const k = remember(key, o, three, clips);
    if (old) legacy.push([key, k, m]);
    for (const c of clips) for (const w of c.whens) {
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
 * The level a game WITHOUT levels in its code builds (studio-uniforms, 2026-10-23): `levelsWas: []` = the person made
 * Level 2 in the editor and the AI has not added studio.levels() yet, so the game still calls applyPlacement without
 * { level }. In the editor's frame that is the level on screen (the URL's studioLevel: a copy is built from the game
 * as it is, its own entries over it); anywhere else Level 1 (the first level without `from`), so the shipped game
 * keeps the layout it had. Any other file with levels: '' (the warning above — a level's layout never lands on another).
 */
export function levelOfCodeless(data) {
  if (!Array.isArray(data.levelsWas) || data.levelsWas.length) return '';
  let want = '';
  try {
    if (typeof window !== 'undefined' && window.parent !== window) want = new URL(window.location.href).searchParams.get('studioLevel') || '';
  } catch {
    want = '';
  }
  if (want && data.levels.some((l) => l && l.id === want)) return want;
  const first = data.levels.find((l) => l && !l.from);
  return first ? first.id : '';
}

/**
 * The file as one level sees it (levels, 2026-10-22): that level's objects / added / removed / order / motion at the
 * top, no `levels` (`motion` is a level's own since integrate3: its keys are that level's objects; `places` too, studio-code-base). A file without levels comes back as it is; a level the file does not list has nothing to apply.
 */
export function placementForLevel(data, id) {
  if (!data || !Array.isArray(data.levels)) return data;
  const l = data.levels.find((x) => x && x.id === id) || {};
  const out = { ...data, objects: l.objects || {} };
  for (const k of ['added', 'removed', 'order', 'motion', 'names', 'places']) if (l[k]) out[k] = l[k];
  else delete out[k];
  delete out.levels;
  delete out.levelsWas;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Code motions, code layouts and keep-out areas (studio-code-base, 2026-10-24; see the top of the file, CONTRACT.md
// §1.9.4 and §1.12). WHY in the code and not in the file: a formula ("6 m apart", "round in a spiral") is the game's
// own shape, and the person's wish was "tune it by hand, but keep it a formula". So the code keeps the formula and its
// first numbers; the file keeps only the numbers the person turned (`knobs: { gap: { v: 4, was: 6 } }`), the objects put
// by hand ("just this one": `pins`) and the keep-out areas — the same split as an object's place (`p` and `was`). On
// Save the AI writes `v` into the code where `was` is (SKILL.md); until then this file plays the new numbers.

const CODE_MOTIONS = Symbol.for('game-studio.codeMotions');
const CODE_PLACES = Symbol.for('game-studio.codePlaces');
const CODE_AVOIDS = Symbol.for('game-studio.codeAvoids');
/** One list per page for each, shared by every copy of this file in it (the game's and the editor's). */
const codeList = (sym) => (globalThis[sym] instanceof Map ? globalThis[sym] : (globalThis[sym] = new Map()));
const CODE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KNOB_NAME = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
// The units the editor knows how to say (it shows "s" as seconds in the person's language, "deg" as "°", "x" as "×").
const KNOB_UNITS = ['m', 'px', 's', 'deg', '%', 'x', 'm/s', 'px/s', ''];
// A layout's objects at most (the file's 500 objects are shared by every layout and every hand-placed object).
const MAX_PLACED = 200;
// Tries for a place outside every keep-out area before that object is left out (decision 12: 30).
const MAX_TRIES = 30;
const warned = new Set();
const warnOnce = (msg) => {
  if (warned.has(msg)) return;
  warned.add(msg);
  warn(msg);
};
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

/**
 * A knob list as the code writes it — { radius: { v: 2, label: 'Radius', unit: 'm', min: 0.2, max: 6, step? } } — kept
 * to the first 3 (the editor's row holds three; a fourth is said once) and to the shapes the editor can show.
 */
function knobsOf(knobs, where) {
  const out = {};
  if (!knobs || typeof knobs !== 'object') return out;
  const names = Object.keys(knobs).filter((n) => {
    const ok = KNOB_NAME.test(n) && knobs[n] && typeof knobs[n] === 'object' && isNum(knobs[n].v);
    if (!ok) warnOnce(`${where}: knob "${n}" needs a name (letters, digits, _) and a number v`);
    return ok;
  });
  if (names.length > 3) warnOnce(`${where}: at most 3 knobs (the first 3 are shown)`);
  for (const n of names.slice(0, 3)) {
    const d = knobs[n];
    out[n] = { v: d.v, label: text(d.label, 20) || n, unit: KNOB_UNITS.includes(d.unit) ? d.unit : '' };
    for (const f of ['min', 'max']) if (isNum(d[f])) out[n][f] = d[f];
    if (isNum(d.step) && d.step > 0) out[n].step = d.step;
  }
  return out;
}

/** The numbers a formula runs with: the file's `v` for a knob the person turned, else the code's. */
export function knobValues(knobs, fileKnobs) {
  const k = {};
  for (const [name, d] of Object.entries(knobs || {})) {
    const f = fileKnobs && typeof fileKnobs === 'object' && fileKnobs[name] && fileKnobs[name].v;
    k[name] = isNum(f) ? f : d.v;
  }
  return k;
}

/**
 * A motion whose shape is code (a spiral, a wave, a chase). Written once in the game's code; it plays only where
 * placement.json attaches it (the editor's timeline: `motions: [{ name, code: id }]` and a clip `{ use: name }`), so a
 * motion that is not on the timeline does not move in the game either. Returns the entry (or null for a bad one).
 *   name   the first name, in the person's words ("Spiral"); the editor may rename it (the id stays)
 *   knobs  1–3 numbers the person would say ({ radius: { v: 2, label, unit: 'm', min, max } })
 *   round  seconds of one round (a number or (k) => number); none = it never ends
 *   note   what the knobs cannot say (20 characters: "follows the player")
 *   game   true = it reads the game (the player, the score): played frame by frame, never scrubbed
 *   drag   the knob a drag of its path turns (the editor, later)
 *   at(t, k, g)  the offsets after t seconds: { p, r, s } like clipAt (added to the place / angles, multiplying the
 *          size). g = { key, obj, dt, player }. A shape motion depends on t alone, so any moment can be shown.
 */
export function codeMotion(id, def) {
  if (typeof id !== 'string' || !CODE_ID.test(id) || !def || typeof def.at !== 'function') {
    warnOnce(`codeMotion(${JSON.stringify(id)}): needs an id (a-z, 0-9, -) and at(t, k)`);
    return null;
  }
  const m = { id, name: text(def.name, 40) || id, knobs: knobsOf(def.knobs, `codeMotion('${id}')`), round: def.round, note: text(def.note, 20), game: def.game === true, drag: def.drag, at: def.at };
  codeList(CODE_MOTIONS).set(id, m);
  return m;
}

/**
 * Objects the code puts (a row of lamps, coins scattered on a field). Put in by applyPlacement — after the world, before
 * the file's `objects` — whether or not the file names it: count() objects from make(i), named "<id>-1", "<id>-2" …,
 * each at at(i, k, g) under the root given to applyPlacement. The file's `places[id]` is only what the person changed.
 *   name   the layout's name in the person's words ("Lamp row")
 *   knobs  1–3 numbers ({ gap: { v: 6, label: 'Gap', unit: 'm' }, n: { v: 10, label: 'Count', step: 1 } })
 *   count  how many (a number or (k) => number; at most 200)
 *   make(i)  a new object for number i (three: an Object3D; PixiJS: a display object)
 *   at(i, k, g)  where number i goes: { p, r?, s? } in the root's space (3D r = [x, y, z] or a turn round y; 2D r =
 *          the angle). g = { try, rand, level }: rand() is the same every load for the same id, number and try (a
 *          scatter stays where it was); try counts the places refused by a keep-out area
 *   drag   the knob a drag of one of its objects turns (the editor: "moving it changes Gap · ⌥ just this one")
 *   avoid  codeAvoid ids on from the start (the person can switch them off)
 */
export function codePlace(id, def) {
  if (typeof id !== 'string' || !CODE_ID.test(id) || !def || typeof def.make !== 'function' || typeof def.at !== 'function') {
    warnOnce(`codePlace(${JSON.stringify(id)}): needs an id (a-z, 0-9, -), make(i) and at(i, k)`);
    return null;
  }
  const was = codeList(CODE_PLACES).get(id);
  const p = { id, name: text(def.name, 40) || id, knobs: knobsOf(def.knobs, `codePlace('${id}')`), count: def.count, make: def.make, at: def.at, drag: def.drag,
    avoid: Array.isArray(def.avoid) ? def.avoid.filter((a) => typeof a === 'string' && CODE_ID.test(a)) : [], keys: [], skipped: [], objs: was ? was.objs : [] };
  codeList(CODE_PLACES).set(id, p);
  return p;
}

/**
 * A keep-out condition, for the code layouts that name it (codePlace `avoid`, or the person's list in the file).
 *   name / after  how the list says it ("From the player" [5 m] "within")
 *   knobs  1–3 numbers ({ r: { v: 5, label: 'Distance', unit: 'm' } })
 *   test(p, k, g)  true = nothing goes at p (the layout's space). g = { player, level }: the player where the level
 *          starts (setPlayer, applyPlacement's { player }, or an object keyed "player"), since layouts are put once then
 *   show(k, g)  optional: the shape to paint on the ground ({ circle: { p, r } } / { box: { p, size } })
 */
export function codeAvoid(id, def) {
  if (typeof id !== 'string' || !CODE_ID.test(id) || !def || typeof def.test !== 'function') {
    warnOnce(`codeAvoid(${JSON.stringify(id)}): needs an id (a-z, 0-9, -) and test(p, k)`);
    return null;
  }
  const a = { id, name: text(def.name, 40) || id, after: text(def.after, 20), knobs: knobsOf(def.knobs, `codeAvoid('${id}')`), test: def.test, show: def.show };
  codeList(CODE_AVOIDS).set(id, a);
  return a;
}

/** A code motion's round in seconds with the clip's knobs (codeMotion `round`), or null (none: it never ends). */
export function codeRound(c) {
  const m = c && codeList(CODE_MOTIONS).get(c.code);
  if (!m) return null;
  let r = m.round;
  try {
    if (typeof r === 'function') r = r(knobValues(m.knobs, c.knobs));
  } catch (e) {
    warnOnce(`codeMotion('${m.id}'): round failed (${e && e.message})`);
    r = null;
  }
  return isNum(r) && r > 0 ? r : null;
}

/** [x, y(, z)] from a number or a list, n long (a number is the same for every axis, or the turn round the up axis). */
function vecOf(v, n, turn) {
  if (isNum(v)) return n === 3 && turn ? [0, v, 0] : n === 3 ? [v, v, v] : turn ? [v] : [v, v];
  if (!Array.isArray(v) || !v.every(isNum)) return null;
  const w = turn && n === 2 ? 1 : n;
  return v.length >= w ? v.slice(0, w) : null;
}

/**
 * Where a code motion is after t seconds: its at() with the knobs (the file's over the code's), in clipAt's shape. A
 * motion the page has no codeMotion() for stays where it is (and is said once). A `game` motion gets g.dt since the
 * last call of this clip (the runner calls it once a frame).
 */
function codeAt(c, t) {
  const out = { p: null, r: null, s: null, done: false };
  const m = codeList(CODE_MOTIONS).get(c.code);
  if (!m) {
    warnOnce(`placement.json uses the code motion "${c.code}", but the game has no codeMotion('${c.code}')`);
    return out;
  }
  const u = isNum(t) ? Math.max(0, t) : 0;
  const k = known.get(c.key);
  const g = { key: c.key, obj: k ? k.o : null, dt: m.game ? Math.max(0, u - (isNum(c.last) ? c.last : u)) : 0, player: m.game ? whereIs(null) : null };
  if (m.game) c.last = u;
  let a;
  try {
    a = m.at(u, knobValues(m.knobs, c.knobs), g);
  } catch (e) {
    warnOnce(`codeMotion('${m.id}'): at failed (${e && e.message})`);
    return out;
  }
  if (!a || typeof a !== 'object') return out;
  const n = c.n === 2 ? 2 : 3;
  out.p = vecOf(a.p, n, false);
  out.r = vecOf(a.r, n, true);
  out.s = vecOf(a.s, n, false);
  return out;
}

/** A seeded random (mulberry32 over a string's hash): the same numbers for the same id, number and try, every load. */
function randOf(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let x = Math.imul(h ^ (h >>> 15), 1 | h);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** The player's place when a level starts (keep-out conditions read it): opts.player, setPlayer's, or a "player". */
function playerAt(root, three, opts) {
  const o = opts && opts.player;
  if (Array.isArray(o) && o.every(isNum)) return o.slice();
  const obj = (o && o.position ? o : null) || player || findByKey(root, 'player', three);
  if (!obj || !obj.position) return null;
  return three ? [obj.position.x, obj.position.y, obj.position.z] : [obj.position.x, obj.position.y];
}

/**
 * A box drawn in the editor: 3D `p` = the middle of its bottom, `size` = [width, height, depth]; 2D `p` = its middle,
 * `size` = [width, height].
 */
function inBox(q, b, n) {
  if (!b || !Array.isArray(b.p) || !Array.isArray(b.size) || !Array.isArray(q)) return false;
  if (n === 2) return Math.abs(q[0] - b.p[0]) <= b.size[0] / 2 && Math.abs(q[1] - b.p[1]) <= b.size[1] / 2;
  return Math.abs(q[0] - b.p[0]) <= b.size[0] / 2 && q[1] >= b.p[1] - 1e-9 && q[1] <= b.p[1] + b.size[1] && Math.abs(q[2] - b.p[2]) <= b.size[2] / 2;
}

/**
 * A layout's keep-out tests (only that layout's, chosen 2026-10-24 — a box drawn for the crystals does
 * not move the coins): its code's `avoid` (on unless the file says `off`), the file's conditions and its boxes.
 */
function avoidTests(p, f, n, g) {
  const tests = [];
  const fileCodes = new Map();
  for (const a of Array.isArray(f.avoid) ? f.avoid : []) {
    if (!a || typeof a !== 'object') continue;
    if (a.box) {
      if (!a.off) tests.push((q) => inBox(q, a.box, n));
    } else if (typeof a.code === 'string') fileCodes.set(a.code, a);
  }
  for (const id of new Set([...p.avoid, ...fileCodes.keys()])) {
    const e = fileCodes.get(id);
    if (e && e.off) continue;
    const d = codeList(CODE_AVOIDS).get(id);
    if (!d) {
      warnOnce(`codePlace('${p.id}') avoids "${id}", but the game has no codeAvoid('${id}')`);
      continue;
    }
    const k = knobValues(d.knobs, e && e.knobs);
    tests.push((q) => {
      try {
        return !!d.test(q, k, g);
      } catch (err) {
        warnOnce(`codeAvoid('${id}'): test failed (${err && err.message})`);
        return false;
      }
    });
  }
  return tests;
}

/** Put a formula's place on an object: { p, r?, s? } (a code layout's at()). Only what it has is touched. */
function putCode(o, a, three) {
  const p = vecOf(a.p, three ? 3 : 2, false);
  if (p) three ? o.position.set(p[0], p[1], p[2]) : o.position.set(p[0], p[1]);
  if (a.r !== undefined) {
    if (three && Array.isArray(a.r) && a.r.length === 3 && a.r.every(isNum)) o.rotation.set(a.r[0], a.r[1], a.r[2]);
    else if (isNum(a.r) || (Array.isArray(a.r) && isNum(a.r[0]))) {
      const r = isNum(a.r) ? a.r : a.r[0];
      if (three) o.rotation.y = r;
      else o.rotation = r;
    }
  }
  if (a.s !== undefined) {
    if (isNum(a.s) && a.s !== 0) three ? o.scale.setScalar(a.s) : o.scale.set(a.s, a.s);
    else if (Array.isArray(a.s) && a.s.every(isNum)) three ? o.scale.set(a.s[0], a.s[1], a.s[2] ?? a.s[0]) : o.scale.set(a.s[0], a.s[1]);
  }
}

/** One layout's place for number i on try `tr` (at() answers { p, r?, s? }), or null when at() gives nothing usable. */
function codePlaceAt(p, i, k, tr, level, n) {
  const g = { try: tr, rand: randOf(`${p.id}:${i}:${tr}`), level: level || null };
  let a;
  try {
    a = p.at(i, k, g);
  } catch (e) {
    warnOnce(`codePlace('${p.id}'): at failed (${e && e.message})`);
    return null;
  }
  return a && typeof a === 'object' && vecOf(a.p, n, false) ? a : null;
}

/**
 * Put in every code layout (codePlace) under `root`: the objects of an earlier applyPlacement are taken out first (a
 * level built again, the game restarted), so they are never doubled. `places` = the file's (this level's) changes.
 * report.places = { id: { keys, skipped } }.
 */
function placeCode(root, three, places, report, opts) {
  const all = codeList(CODE_PLACES);
  if (!all.size) return;
  report.places = {};
  const made = new Set();
  for (const p of all.values()) {
    for (const o of p.objs) if (o && o.parent) three ? o.parent.remove(o) : o.parent.removeChild(o);
    p.objs = [];
    p.keys = [];
    p.home = { root, three, opts };
    const f = places && typeof places === 'object' && places[p.id] && typeof places[p.id] === 'object' ? places[p.id] : {};
    for (const o of layOut(p, f)) made.add(o);
    report.places[p.id] = { keys: p.keys.slice(), skipped: p.skipped.slice() };
  }
  // `from` (✦ To code): the hand-placed objects a layout replaced, hidden until the AI takes them out of the code —
  // only objects this file did not make (the hand ones may have had the layout's own keys).
  for (const [id, f] of Object.entries(places && typeof places === 'object' ? places : {})) {
    if (!f || !Array.isArray(f.from) || !all.has(id)) continue;
    for (const key of f.from) {
      const o = typeof key === 'string' && handObject(root, key, three, made);
      if (o) o.visible = false;
    }
  }
}

/**
 * One layout's objects, number by number: the formula's place (tried again out of the keep-out areas), then the pin.
 * An object of the same key made before is kept and only moved (the editor turning a knob in place: relayCodePlace);
 * new numbers are made, numbers that are gone are taken out. p.spots = each number's formula place (null: none).
 */
function layOut(p, f) {
  const { root, three, opts } = p.home;
  const n = three ? 3 : 2;
  const level = (opts && opts.level) || null;
  const old = new Map(p.objs.map((o, j) => [p.keys[j], o]));
  p.objs = [];
  p.keys = [];
  p.skipped = [];
  p.spots = [];
  const k = knobValues(p.knobs, f.knobs);
  let count = p.count;
  try {
    if (typeof count === 'function') count = count(k);
  } catch (e) {
    warnOnce(`codePlace('${p.id}'): count failed (${e && e.message})`);
    count = 0;
  }
  count = isNum(count) ? Math.max(0, Math.min(MAX_PLACED, Math.floor(count))) : 0;
  // Keep-out areas move what the formula places; what a hand put ("just this one", "Place by hand") stays put.
  const tests = f.hand ? [] : avoidTests(p, f, n, { player: playerAt(root, three, opts), level });
  for (let i = 0; i < count; i++) {
    const key = `${p.id}-${i + 1}`;
    const pin = f.pins && f.pins[key] && Array.isArray(f.pins[key].p) ? f.pins[key] : null;
    let at = null;
    if (pin || !tests.length) at = codePlaceAt(p, i, k, 0, level, n);
    else {
      let prev = null;
      for (let tr = 0; tr < MAX_TRIES; tr++) {
        const a = codePlaceAt(p, i, k, tr, level, n);
        if (!a) break;
        const q = vecOf(a.p, n, false);
        if (!tests.some((t) => t(q))) {
          at = a;
          break;
        }
        // The same place again: a row, which has nowhere else to go.
        if (prev && prev.every((v, j) => Math.abs(v - q[j]) < 1e-9)) break;
        prev = q;
      }
    }
    p.spots.push(at ? vecOf(at.p, n, false) : null);
    if (!at && !pin) {
      p.skipped.push(key);
      continue;
    }
    let o = old.get(key) || null;
    old.delete(key);
    if (!o) {
      try {
        o = p.make(i);
      } catch (e) {
        warnOnce(`codePlace('${p.id}'): make failed (${e && e.message})`);
      }
      if (!o || !o.position) {
        p.skipped.push(key);
        continue;
      }
      if (three) {
        o.name = key;
        o.userData.studioKey = key;
        root.add(o);
      } else {
        o.label = key;
        o.studioKey = key;
        root.addChild(o);
      }
    }
    if (at) putCode(o, at, three);
    if (pin) put(o, pin, n, three);
    p.objs.push(o);
    p.keys.push(key);
  }
  for (const o of old.values()) if (o && o.parent) three ? o.parent.remove(o) : o.parent.removeChild(o);
  return p.objs;
}

/**
 * The editor (studio-code-knobs, 2026-10-24: "turning a layout's number reloads the game — change it in place"): code
 * layout `id` laid out again where it stands, with `f` (its `places` entry of the draft). Null: no such layout yet.
 */
export function relayCodePlace(id, f) {
  const p = codeList(CODE_PLACES).get(id);
  if (!p || !p.home) return null;
  layOut(p, f && typeof f === 'object' ? f : {});
  return { keys: p.keys.slice(), skipped: p.skipped.slice() };
}

/** Number i's formula place with the knob values `k` (the editor's drag looks for a knob with it), or null. */
export function codeSpot(id, i, k) {
  const p = codeList(CODE_PLACES).get(id);
  const n = p && p.home && p.home.three ? 3 : 2;
  const a = p && codePlaceAt(p, i, k, 0, (p.home && p.home.opts && p.home.opts.level) || null, n);
  return a ? vecOf(a.p, n, false) : null;
}

/** The object with this key that is not one of `made` (a code layout's). */
function handObject(root, key, three, made) {
  let found = null;
  walk(root, (o) => {
    if (found) return false;
    if (made.has(o)) return 'skip';
    const mark = three ? o.userData && o.userData.studioKey : o.studioKey;
    if (mark === key || cleanName(three ? o.name : o.label) === key) found = o;
    return !found;
  });
  return found;
}

function applyUi(doc, ui) {
  const out = { applied: [], missing: [] };
  const put = (el) => {
    const k = el.dataset.studioKey, e = Object.hasOwn(ui, k) && ui[k];
    if (!e || !Array.isArray(e.p) || e.p.length !== 2 || !e.p.every(isNum) || (e.s !== undefined && !isNum(e.s))) return;
    if (placeUi(el, e.p, e.s === undefined ? 1 : e.s) && !out.applied.includes(k)) out.applied.push(k);
    if (sheet && e.set && typeof e.set === 'object') setUi(el, k, e.set, sheet);
  };
  // Only for a file whose card changed something (a file of moves alone adds nothing to the page, as before).
  const sheet = Object.values(ui).some((e) => e && e.set) ? uiSheet(doc, ui) : null;
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

const UI_COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]{1,60}\)|[a-zA-Z]{3,30})$/;
const UI_STATES = { '@hover': ':hover', '@active': ':active', '@disabled': ':disabled' };
const okColor = (c) => typeof c === 'string' && UI_COLOR.test(c);

/** The page's CSS variables changed in the editor (`theme`): on <html>, so every rule that uses them follows. */
function applyTheme(doc, theme) {
  for (const [name, e] of Object.entries(theme)) {
    if (/^--[A-Za-z0-9_-]{1,60}$/.test(name) && e && typeof e.v === 'string' && !/[;{}<>]/.test(e.v)) doc.documentElement.style.setProperty(name, e.v);
  }
}

/**
 * One style sheet for the elements' colours (#studio-ui-set): each state's with !important (it must beat the normal
 * look, the game's or the editor's), made once for the file. Colours that are not CSS colours are skipped; the key is a
 * data-studio-key (key characters only), so the selectors are safe.
 */
function uiSheet(doc, ui) {
  const rules = [];
  for (const [k, e] of Object.entries(ui)) {
    const set = e && e.set;
    if (!set || typeof set !== 'object' || !/^[A-Za-z0-9_:#.\-\/]{1,80}$/.test(k)) continue;
    const sel = `[data-studio-key="${k}"]`;
    for (const [st, pseudo] of Object.entries(UI_STATES)) {
      const o = set[st];
      if (!o || typeof o !== 'object') continue;
      if (okColor(o.background)) rules.push(`${sel}${pseudo}{background-color:${o.background}!important}`);
      if (okColor(o.color)) rules.push(`${sel}${pseudo},${sel}${pseudo} *{color:${o.color}!important}`);
    }
  }
  const el = doc.createElement('style');
  el.id = 'studio-ui-set';
  el.textContent = rules.join('\n');
  (doc.head || doc.documentElement).appendChild(el);
  return el;
}

/**
 * The normal look and the words of one element (`set`): see the top of the file. The fill (and the colour of a button,
 * whose text is itself) goes in the sheet as a plain rule, so the game's own :hover / :active rules, more specific,
 * still win while hovered or pressed; when the game's normal rule is more specific than that, on the element itself.
 * The colour of a text inside the element (a title card's <h1>) and the size go on that text.
 */
function setUi(el, k, set, sheet) {
  const part = uiTextPart(el);
  const rule = (prop, css, v) => {
    if (getComputedStyle(el)[prop] === cssColor(el, v)) return;
    sheet.textContent += `\n[data-studio-key="${k}"]{${css}:${v}}`;
    if (getComputedStyle(el)[prop] !== cssColor(el, v)) el.style[prop] = v;
  };
  if (part) {
    if (typeof set.text === 'string') {
      const n = uiTextNode(part);
      if (n) n.data = keepSpace(n.data, set.text.slice(0, 200));
    }
    if (isNum(set.fontSize) && set.fontSize > 0) part.style.fontSize = `${set.fontSize}px`;
    if (okColor(set.color)) {
      if (part === el) rule('color', 'color', set.color);
      else part.style.color = set.color;
    }
  }
  if (okColor(set.background)) rule('backgroundColor', 'background-color', set.background);
}

/** A colour as getComputedStyle writes it (to tell whether a rule took). */
function cssColor(el, c) {
  const probe = el.ownerDocument.createElement('i');
  probe.style.color = c;
  probe.style.display = 'none';
  el.ownerDocument.documentElement.appendChild(probe);
  const v = getComputedStyle(probe).color;
  probe.remove();
  return v;
}

/** The new words in the old text node's place, keeping its spaces around (the HTML's line breaks). */
function keepSpace(old, text) {
  const m = /^(\s*)[\s\S]*?(\s*)$/.exec(old);
  return (m ? m[1] : '') + text + (m ? m[2] : '');
}

/** The element's own non-blank text nodes (not inside its children). */
function ownText(el) {
  return Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.data.trim());
}

/**
 * The text the card's Text / Size / Colour change, shared with the editor (src/bridge/ui-extras.ts) so both pick the
 * same one: data-studio-text (on the element or inside it), else the first element, in page order, with words of its
 * own (a title card's <h1>, a button itself). null when there is none, or when that element mixes words with what the
 * game writes ("Glow <b>0</b> / 5": two text nodes around a value) — changing one piece of it would read wrong.
 * Never inside data-studio-value (a score: the game's to write).
 */
export function uiTextPart(el) {
  const mark = el.matches('[data-studio-text]') ? el : el.querySelector('[data-studio-text]');
  const one = (e) => (ownText(e).length === 1 ? e : null);
  if (mark) return one(mark);
  const walk = (e) => {
    if (e.matches('[data-studio-value]')) return undefined;
    if (ownText(e).length) return e;
    for (const c of e.children) {
      const r = walk(c);
      if (r) return r;
    }
    return undefined;
  };
  const p = walk(el);
  return p ? one(p) : null;
}

/** The one text node of a uiTextPart(). */
export function uiTextNode(part) {
  return ownText(part)[0] || null;
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
