// The AI's hands in the editor (studio-ai-hands, 2026-10-24; CONTRACT.md §3.6): what `studio.mjs <game> --do …` asks
// the editor to do — take a motion off an object, make a motion from points, move / rename / duplicate an object, add a
// level, Save — and the same change written into placement.json when no editor is open.
//
// WHY (a request, 2026-10-24): "I asked Claude, and it asked me to do the Studio's hand work. That is the worst
// experience." Claude answered with a numbered list (1. select the blue pillar 2. right-click the card's Motion row 3.
// "Remove from this object" 4. Save), because SKILL.md said "Do not write motions / motion in placement.json: they are
// the editor's". The same day it made a spiral by writing it into index.html, so the spiral was not on the timeline,
// fought the editor's own motion, and the person was asked to press Reload. Now the AI does editor work through the
// editor: a running editor changes on screen (one ⌘Z undoes it, it counts on Save · n), and with no editor open the
// same op is written into placement.json in the shape the editor itself writes.
//
// One module for both sides, so they agree on what an op means: the CLI (src/server/hands-cli.mjs) reads the ops and
// writes the file with applyHandsToFile(); the editor (src/shell/ai-hands.ts) reads the same ops, makes the same motion
// from points (handsMotion), the same pose (handsPose), picks the same clip (handsClip) and the same default start
// (handsDefaultWhen), and words its result with the same sentence (handsSaid) for the AI's stdout line.
// No imports but the validator (the bundled CLI and the shell bundle both take this file as it is).
import { CUE_RE, KEY_RE, LIMITS, MOTION_EASES, MOTION_REPEATS, MOTION_TRIGGERS, validateStudioFile } from './studio-files.mjs';

/**
 * Every op, with the fields it needs and the fields it may have. A field not listed is an error (an AI's typo —
 * `"clip"` for `"name"` — should fail loudly, not be ignored). `level`: the level the op is about (a game with levels;
 * the editor opens it first, the file writes into it).
 */
export const HANDS_OPS = Object.freeze({
  'motion.make': { need: ['name'], may: ['len', 'repeat', 'points', 'keys', 'ease', 'key', 'when', 'until', 'replace', 'level'] },
  'motion.attach': { need: ['key', 'name'], may: ['when', 'until', 'level'] },
  'motion.detach': { need: ['key'], may: ['name', 'all', 'level'] },
  'motion.delete': { need: ['name'], may: [] },
  'motion.rename': { need: ['name', 'to'], may: [] },
  'motion.set': { need: ['name'], may: ['repeat', 'len', 'key', 'when', 'until', 'level'] },
  'object.move': { need: ['key'], may: ['to', 'by', 'level'] },
  'object.turn': { need: ['key'], may: ['to', 'by', 'deg', 'level'] },
  'object.scale': { need: ['key'], may: ['to', 'by', 'level'] },
  'object.rename': { need: ['key', 'to'], may: ['level'] },
  'object.duplicate': { need: ['key'], may: ['to', 'by', 'level'] },
  'object.delete': { need: ['key'], may: ['level'] },
  'object.ground': { need: ['key'], may: ['level'] },
  'level.new': { need: [], may: ['name'] },
  'level.duplicate': { need: [], may: ['id', 'name'] },
  'level.rename': { need: ['to'], may: ['id'] },
  'level.switch': { need: ['id'], may: [] },
  save: { need: [], may: [] },
  'editor.reload': { need: [], may: ['editor'] },
  // Read only: the objects as the person calls them ("Blue pillar (1st)"), their keys and motions, the Library's
  // motions and the levels — so "the blue pillar's old motion" can be found without asking the person.
  list: { need: [], may: [] },
});
export const HANDS_OP_NAMES = Object.freeze(Object.keys(HANDS_OPS));
/** At most this many ops in one --do (a spiral is one op; 50 is a whole re-layout). */
export const HANDS_MAX_OPS = 50;
/** A level id, as studio.levels() gives them (letters, digits, - and _). */
const HANDS_LEVEL_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HANDS_CTRL_RE = /[\u0000-\u001f\u007f]/;

const handsNum = (x) => typeof x === 'number' && Number.isFinite(x);
const handsVec = (x, n) => Array.isArray(x) && (n ? x.length === n : x.length === 2 || x.length === 3) && x.every(handsNum);
const handsText = (x, max) => typeof x === 'string' && !!x.trim() && x.length <= max && !HANDS_CTRL_RE.test(x);

/**
 * Read the AI's ops: a JSON text, one op object, or a list of them. Each is `{ "do": "motion.detach", "key": … }`.
 * Returns { ok: true, ops } (copies, `when` / `until` in the file's shape) or { ok: false, errors }.
 */
export function readHandsInput(input) {
  let v = input;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch (e) {
      return { ok: false, errors: [`not JSON: ${String(e && e.message).slice(0, 120)}`] };
    }
  }
  const list = Array.isArray(v) ? v : [v];
  if (!list.length) return { ok: false, errors: ['no ops'] };
  if (list.length > HANDS_MAX_OPS) return { ok: false, errors: [`at most ${HANDS_MAX_OPS} ops at once`] };
  const errors = [];
  const ops = list.map((op, i) => readHandsOp(op, list.length > 1 ? `op ${i + 1}` : 'op', errors));
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, ops };
}

function readHandsOp(op, at, errors) {
  const fail = (what) => (errors.push(`${at}: ${what}`), null);
  if (!op || typeof op !== 'object' || Array.isArray(op)) return fail('must be an object like {"do":"motion.detach","key":"pillar-1","name":"Row"}');
  const spec = HANDS_OPS[op.do];
  if (!spec) return fail(`"do" must be one of ${HANDS_OP_NAMES.join(', ')}`);
  at = `${at} (${op.do})`;
  const out = { do: op.do };
  for (const f of Object.keys(op)) if (f !== 'do' && !spec.need.includes(f) && !spec.may.includes(f)) fail(`unknown field "${f}" (it takes ${[...spec.need, ...spec.may].join(', ') || 'nothing'})`);
  for (const f of spec.need) if (op[f] === undefined) fail(`needs "${f}"`);
  const has = (f) => op[f] !== undefined;
  if (has('key') && (typeof op.key !== 'string' || !KEY_RE.test(op.key))) fail('"key" must be an object key (letters, digits, _ : # . - /)');
  else if (has('key')) out.key = op.key;
  if (has('name')) {
    // A level's name may be longer than a motion's (it is shown in the level's head, up to 60 characters).
    const max = op.do.startsWith('level.') ? 60 : LIMITS.maxClipName;
    if (!handsText(op.name, max)) fail(`"name" must be 1 to ${max} characters`);
    else out.name = op.name.trim();
  }
  for (const f of ['id', 'level']) {
    if (!has(f)) continue;
    if (typeof op[f] !== 'string' || !HANDS_LEVEL_RE.test(op[f])) fail(`"${f}" must be a level id (letters, digits, - and _)`);
    else out[f] = op[f];
  }
  for (const f of ['all', 'replace', 'deg', 'editor']) {
    if (!has(f)) continue;
    if (typeof op[f] !== 'boolean') fail(`"${f}" must be true or false`);
    else out[f] = op[f];
  }
  if (has('to') || has('by')) readHandsAmounts(op, out, fail);
  if (has('len')) {
    if (!handsNum(op.len) || op.len < LIMITS.minClipLen || op.len > LIMITS.maxClipLen) fail(`"len" must be ${LIMITS.minClipLen} to ${LIMITS.maxClipLen} seconds`);
    else out.len = op.len;
  }
  if (has('repeat')) {
    if (!MOTION_REPEATS.includes(op.repeat)) fail(`"repeat" must be one of ${MOTION_REPEATS.join(', ')}`);
    else out.repeat = op.repeat;
  }
  if (has('ease')) {
    if (!MOTION_EASES.includes(op.ease)) fail(`"ease" must be one of ${MOTION_EASES.join(', ')}`);
    else out.ease = op.ease;
  }
  if (has('points')) {
    const ok = Array.isArray(op.points) && op.points.length >= 2 && op.points.length <= LIMITS.maxClipKeys && op.points.every((p) => handsVec(p))
      && op.points.every((p) => p.length === op.points[0].length);
    if (!ok) fail(`"points" must be 2 to ${LIMITS.maxClipKeys} positions, each [x, y, z] (3D) or [x, y] (2D), offsets from where the object stands`);
    else out.points = op.points.map((p) => p.slice());
  }
  if (has('keys')) {
    if (!op.keys || typeof op.keys !== 'object' || Array.isArray(op.keys)) fail('"keys" must be { "p": [{ "t": 0, "v": [0, 0, 0] }, …], "r": …, "s": … }');
    else out.keys = structuredClone(op.keys);
  }
  if (op.do === 'motion.make' && !has('points') && !has('keys')) fail('needs "points" (positions to go through) or "keys"');
  if (op.do === 'motion.make' && has('points') && has('keys')) fail('"points" or "keys", not both');
  if (has('when')) {
    const w = readHandsWhen(op.when);
    if (w.error) fail(`"when": ${w.error}`);
    else out.when = w.when;
  }
  if (has('until')) {
    const u = readHandsUntil(op.until);
    if (u.error) fail(`"until": ${u.error}`);
    else out.until = u.until;
  }
  if (op.do === 'motion.set' && ['repeat', 'len', 'when', 'until'].every((f) => !has(f))) fail('needs one of "repeat", "len", "when", "until"');
  if (op.do.startsWith('object.') && ['move', 'turn', 'scale'].includes(op.do.slice(7)) && !has('to') && !has('by')) fail('needs "to" or "by"');
  return out;
}

/** `to` / `by` mean different things per op: a position, an angle, a size, or a new name. */
function readHandsAmounts(op, out, fail) {
  const kind = op.do;
  for (const f of ['to', 'by']) {
    if (op[f] === undefined) continue;
    const v = op[f];
    if (kind === 'object.rename' || kind === 'motion.rename' || kind === 'level.rename') {
      if (f === 'by') fail('"by" is not for a rename');
      else if (!handsText(v, kind === 'motion.rename' ? LIMITS.maxClipName : 120)) fail('"to" must be the new name');
      else out.to = v.trim();
    } else if (kind === 'object.move' || kind === 'object.duplicate') {
      if (!handsVec(v)) fail(`"${f}" must be [x, y, z] (3D) or [x, y] (2D)`);
      else out[f] = v.slice();
    } else if (kind === 'object.turn') {
      if (!handsNum(v)) fail(`"${f}" must be an angle (radians; "deg": true for degrees)`);
      else out[f] = v;
    } else if (kind === 'object.scale') {
      if (f === 'by' ? !(handsNum(v) && v > 0) : !(handsNum(v) && v !== 0) && !handsVec(v)) fail(f === 'by' ? '"by" must be a number above 0 (2 = twice as big)' : '"to" must be a size (1 = as built) or [x, y, z]');
      else out[f] = Array.isArray(v) ? v.slice() : v;
    } else fail(`"${f}" is not for ${kind}`);
  }
  if (out.to !== undefined && out.by !== undefined) fail('"to" or "by", not both');
}

/**
 * When a motion starts, the AI's way: the file's object ({ "on": "key", "key": "KeyE" }), a list of them, or a short
 * word — "start", "click", "touch", "key:E" / "key:Space", "time:2", "after:Hop", "cue:chest-opened", "say:<words>".
 */
export function readHandsWhen(v) {
  if (Array.isArray(v)) {
    if (v.length < 1 || v.length > LIMITS.maxWhens) return { error: `a list of 1 to ${LIMITS.maxWhens}` };
    const xs = v.map(readHandsWhen);
    const bad = xs.find((x) => x.error);
    if (bad) return bad;
    const ws = xs.map((x) => x.when);
    return { when: ws.length === 1 ? ws[0] : ws };
  }
  let w = v;
  if (typeof v === 'string') {
    const i = v.indexOf(':');
    const on = (i < 0 ? v : v.slice(0, i)).trim();
    const arg = i < 0 ? '' : v.slice(i + 1).trim();
    if (on === 'key') {
      // "E" → "KeyE", "1" → "Digit1": the AI may write the key as people say it; the file wants KeyboardEvent.code.
      const code = /^[A-Za-z]$/.test(arg) ? `Key${arg.toUpperCase()}` : /^[0-9]$/.test(arg) ? `Digit${arg}` : arg;
      w = { on, key: code };
    } else if (on === 'time') w = { on, after: Number(arg) };
    else if (on === 'after') w = { on, use: arg };
    else if (on === 'cue') w = { on, cue: arg };
    else if (on === 'say') w = arg ? { on, say: arg } : { on };
    else w = { on };
  }
  if (!w || typeof w !== 'object' || !MOTION_TRIGGERS.includes(w.on)) return { error: `"on" must be one of ${MOTION_TRIGGERS.join(', ')}` };
  if (w.on === 'key' && !(typeof w.key === 'string' && /^[A-Za-z][A-Za-z0-9]{1,24}$/.test(w.key))) return { error: 'a key like "KeyE", "Space", "ArrowUp" (or "key:E")' };
  if (w.on === 'time' && !(handsNum(w.after) && w.after >= 0 && w.after <= LIMITS.maxClipLen)) return { error: 'time needs "after": seconds' };
  if (w.on === 'after' && !handsText(w.use, LIMITS.maxClipName)) return { error: 'after needs the motion it follows ("after:Hop")' };
  if (w.on === 'cue' && !(typeof w.cue === 'string' && CUE_RE.test(w.cue))) return { error: 'a cue name like "chest-opened" (lower case, digits, -)' };
  if (w.on === 'enter' && !(w.area && handsVec(w.area.p) && handsVec(w.area.size))) return { error: 'enter needs "area": { "p": [x, y, z], "size": [w, h, d] }' };
  return { when: structuredClone(w) };
}

/** When it stops: { "times": 3 }, { "cue": "boss-down" }, { "then": "reset" }, or "times:3" / "cue:boss-down"; null = never. */
export function readHandsUntil(v) {
  if (v === null || v === 'never') return { until: null };
  let u = v;
  if (typeof v === 'string') {
    const [k, a] = v.split(':').map((s) => s.trim());
    u = k === 'times' ? { times: Number(a) } : k === 'cue' ? { cue: a } : null;
  }
  if (!u || typeof u !== 'object' || Array.isArray(u)) return { error: '{ "times": 3 } or { "cue": "boss-down" } (null = never stops)' };
  const out = {};
  if (u.times !== undefined) {
    if (!(Number.isInteger(u.times) && u.times >= 1 && u.times <= LIMITS.maxRounds)) return { error: `"times" must be 1 to ${LIMITS.maxRounds}` };
    out.times = u.times;
  }
  if (u.cue !== undefined) {
    if (!(typeof u.cue === 'string' && CUE_RE.test(u.cue))) return { error: '"cue" must be a cue name like "boss-down"' };
    out.cue = u.cue;
  }
  if (u.then !== undefined) {
    if (u.then !== 'stay' && u.then !== 'reset') return { error: '"then" must be stay or reset' };
    out.then = u.then;
  }
  if (out.times === undefined && out.cue === undefined) return { error: 'needs "times" or "cue"' };
  return { until: out };
}

/**
 * The Library motion an op makes ({ name, len, repeat, keys } as the file writes it), or { error }.
 * `points`: positions the object goes through, as offsets from where it stands, spread evenly over `len` (default 2 s),
 * linear between them unless `ease` says otherwise — WHY linear: every key's default ease slows to a stop at the key,
 * so a spiral of 48 points would stutter 48 times; the path is still the smooth curve through the points (the loader's
 * trackAt). `keys`: the file's own keys (p / r / s), when the AI needs turns or sizes too.
 * Checked with the file's own validator, so a motion the editor or the loader would refuse is refused here first.
 */
export function handsMotion(op, dim) {
  const n = dim === '2d' ? 2 : 3;
  const len = op.len ?? 2;
  let keys;
  if (op.points) {
    if (op.points[0].length !== n) return { error: `points must have ${n} numbers each in a ${dim.toUpperCase()} game` };
    const ease = op.ease ?? 'linear';
    const last = op.points.length - 1;
    keys = { p: op.points.map((v, i) => ({ t: (len * i) / last, v: v.slice(), ...(i < last && ease !== 'ease' ? { ease } : {}) })) };
  } else keys = structuredClone(op.keys);
  const m = { name: op.name, len, ...(op.repeat && op.repeat !== 'once' ? { repeat: op.repeat } : {}), keys };
  const r = validateStudioFile({ version: 1, tool: 'placement', dim, space: 'local', objects: {}, motions: [m] }, { tool: 'placement' });
  if (!r.ok) return { error: r.errors.slice(0, 3).map((e) => e.replace(/^motions\[0\]\.?/, '')).join('; ') };
  return { motion: r.value.motions[0] };
}

/** The clip of `clips` an op means: by its name or its Library motion's; none named = the only one. { clip } or { error }. */
export function handsClip(clips, name, key) {
  const cs = clips || [];
  const said = () => (cs.length ? `its motions: ${cs.map((c) => `"${c.name}"`).join(', ')}` : 'it has no motion');
  if (!cs.length) return { error: `${key} has no motion` };
  if (name === undefined) {
    if (cs.length === 1) return { clip: cs[0] };
    return { error: `${key} has ${cs.length ? `${cs.length} motions` : 'no motion'}: say which one with "name" (${said()})` };
  }
  const c = cs.find((x) => x.name === name) || cs.find((x) => x.use === name);
  return c ? { clip: c } : { error: `${key} has no motion "${name}" (${said()})` };
}

/**
 * How a motion the AI MAKES starts when the op does not say: with the game. WHY not the attach rule below ("after its
 * last motion"): the person asked for it to move now ("make it spiral"), and after a motion that loops forever (Sway,
 * pingpong) "after" never comes — a real AI's spiral would have waited for ever (found in the real-AI run, 2026-10-24).
 */
export const HANDS_MAKE_WHEN = Object.freeze({ on: 'start' });

/** How a motion put on an object starts when the op does not say: the editor's own rule (timeline-wire attach). */
export function handsDefaultWhen(clips) {
  const cs = clips || [];
  const last = cs[cs.length - 1];
  const starts = cs.some((c) => (c.when && typeof c.when === 'object' && !Array.isArray(c.when) ? c.when.on === 'start' : c.start === true || c.when === undefined));
  return starts && last ? { on: 'after', use: last.use ?? last.name } : { on: 'start' };
}

/** The pose after a move / turn / scale op, rounded like the file. { pose } or { error } (needs the pose for `by`). */
export function handsPose(op, pose, dim) {
  const n = dim === '2d' ? 2 : 3;
  const step = dim === '2d' ? 10 : 1000;
  const rd = (v, s) => Math.round(v * s) / s;
  const out = pose ? structuredClone(pose) : {};
  if (op.do === 'object.move' || op.do === 'object.duplicate') {
    const v = op.to ?? op.by;
    if (!v) return { pose: out };
    if (v.length !== n) return { error: `a position has ${n} numbers in a ${dim.toUpperCase()} game` };
    if (op.by && !pose?.p) return { error: `where ${op.key} stands now is not known here: give "to" (a place), or open the editor` };
    out.p = v.map((x, i) => rd(op.by ? pose.p[i] + x : x, step));
  } else if (op.do === 'object.turn') {
    const a = (op.deg ? (op.to ?? op.by) * Math.PI / 180 : op.to ?? op.by);
    if (op.by !== undefined && !pose) return { error: `how ${op.key} is turned now is not known here: give "to", or open the editor` };
    let r = op.by !== undefined ? (pose.r ?? 0) + a : a;
    // (-π, π], like the file.
    r = Math.atan2(Math.sin(r), Math.cos(r));
    if (r <= -Math.PI + 1e-9) r = Math.PI;
    out.r = rd(r, 10000);
  } else if (op.do === 'object.scale') {
    if (op.by !== undefined) {
      if (!pose) return { error: `the size of ${op.key} now is not known here: give "to", or open the editor` };
      const s = pose.s ?? 1;
      out.s = Array.isArray(s) ? s.map((x) => rd(x * op.by, 10000)) : rd(s * op.by, 10000);
    } else {
      if (Array.isArray(op.to) && op.to.length !== n) return { error: `a size has 1 or ${n} numbers in a ${dim.toUpperCase()} game` };
      out.s = Array.isArray(op.to) ? op.to.map((x) => rd(x, 10000)) : rd(op.to, 10000);
    }
  }
  return { pose: out };
}

/** "crate-1" → "crate-2" (the editor's copyKey rule, edit-ops.ts): a key nothing has. */
export function handsCopyKey(from, taken) {
  let base = from.replace(/^path:.*$/, 'copy').replace(/#\d+$/, '').replace(/[-_ .]?\d+$/, '');
  base = (base || 'copy').slice(0, 70);
  for (let n = 2; n < 100000; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}

const handsQ = (s) => `"${s}"`;
const handsWhenWords = (w) => {
  const one = (x) => (x.on === 'start' ? 'starts with the game' : x.on === 'time' ? `starts ${x.after} s after the start` : x.on === 'key' ? `starts when ${x.key} is pressed`
    : x.on === 'click' ? 'starts when it is clicked' : x.on === 'after' ? `starts after "${x.use}" ends` : x.on === 'enter' ? 'starts when the player walks into its area'
    : x.on === 'touch' ? 'starts when the player touches it (the game calls touch(key))' : x.on === 'cue' ? `starts on cue('${x.cue}') in the game's code`
    : 'waits for the game\'s code to call playMotion(key, name)');
  return Array.isArray(w) ? w.map(one).join(' or ') : one(w);
};

/**
 * One English line of what an op did, for the AI (the `studio: did …` line). `x`: what only the doer knows — the motion
 * made ({ motion }), the clip taken off ({ clip }), a copy's key, how many objects lost a deleted motion, a level's name.
 */
export function handsSaid(op, x = {}) {
  if (x.said) return x.said;
  const on = op.key ? ` on ${op.key}` : '';
  switch (op.do) {
    case 'motion.make': {
      const m = x.motion;
      const pts = m?.keys?.p?.length;
      return `made ${handsQ(m?.name ?? op.name)} (${pts ? `${pts} points, ` : ''}${m?.len ?? op.len ?? 2} s, ${m?.repeat ?? 'once'})${op.key ? ` and put it${on}, ${handsWhenWords(x.when ?? op.when ?? { on: 'start' })}` : ' in the Library'}`;
    }
    case 'motion.attach': return `put ${handsQ(op.name)}${on}, ${handsWhenWords(x.when ?? op.when ?? { on: 'start' })}`;
    case 'motion.detach': return x.all ? `took every motion off ${op.key} (${x.all})` : `took ${handsQ(x.clip ?? op.name)} off ${op.key}`;
    case 'motion.delete': return `deleted ${handsQ(op.name)} from the Library${x.from ? ` (it came off ${x.from} object${x.from === 1 ? '' : 's'})` : ''}`;
    case 'motion.rename': return `renamed the motion ${handsQ(op.name)} to ${handsQ(x.to ?? op.to)}`;
    case 'motion.set': {
      const parts = [op.repeat ? `repeat ${op.repeat}` : '', op.len ? `${op.len} s` : '', op.when ? handsWhenWords(op.when) : '', op.until !== undefined ? (op.until ? `stops after ${op.until.times ? `${op.until.times} rounds` : `cue('${op.until.cue}')`}` : 'never stops') : ''].filter(Boolean);
      return `set ${handsQ(op.name)}${op.key ? on : ''}: ${parts.join(', ')}`;
    }
    case 'object.move': return `moved ${op.key} to [${(x.pose?.p ?? op.to ?? []).join(', ')}]`;
    case 'object.turn': return `turned ${op.key} to ${Math.round(((x.pose?.r ?? 0) * 180) / Math.PI)}°`;
    case 'object.scale': return `resized ${op.key} to ${JSON.stringify(x.pose?.s ?? op.to)}`;
    case 'object.rename': return `renamed ${op.key} to ${handsQ(op.to)} (the code's key stays until you rename it there: placement.json "names")`;
    case 'object.duplicate': return `duplicated ${op.key} as ${x.copy ?? '?'}`;
    case 'object.delete': return `deleted ${op.key}`;
    case 'object.ground': return `put ${op.key} on the ground`;
    case 'level.new': return `made a new level ${handsQ(x.label ?? op.name ?? '')} (${x.id ?? '?'}) and opened it`;
    case 'level.duplicate': return `duplicated the level as ${handsQ(x.label ?? op.name ?? '')} (${x.id ?? '?'}) and opened it`;
    case 'level.rename': return `renamed the level ${x.id ?? op.id ?? ''} to ${handsQ(op.to)}`;
    case 'level.switch': return `opened the level ${op.id}`;
    case 'save': return 'saved (as the person\'s Save: a saved request follows)';
    case 'editor.reload': return op.editor ? 'reloaded the editor page' : 'reloaded the game in the editor';
    case 'list': return 'listed the objects, motions and levels';
    default: return op.do;
  }
}

// ---------------------------------------------------------------------------------------------
// The same ops on placement.json, for when no editor is open (the CLI writes the result after the file's validator).

/**
 * Apply `ops` to a placement file (its validated value, or null for none yet). Returns { file, results }: the new value
 * (not yet validated: the caller runs validateStudioFile and writes nothing when it fails) and one { do, ok, said | error }
 * per op. An op that fails changes nothing; the others still apply (each result says).
 * What only the game knows is refused with a reason (the ground under an object, a blank level's objects): those need
 * the editor open.
 */
export function applyHandsToFile(file, ops, o = {}) {
  const f = file ? structuredClone(file) : { version: 1, tool: 'placement', dim: o.dim || '3d', space: 'local', objects: {} };
  const dim = f.dim;
  const results = [];
  for (const op of ops) {
    try {
      const r = handsFileOp(f, op, dim);
      results.push(r.error ? { do: op.do, ok: false, error: r.error } : { do: op.do, ok: true, said: handsSaid(op, r), ...(r.list ? { list: r.list } : {}) });
    } catch (e) {
      results.push({ do: op.do, ok: false, error: String(e && e.message).slice(0, 200) });
    }
  }
  return { file: handsTidy(f), results };
}

/** Empty parts out (the validator wants no empty `motion` / `added`…), and the top `objects` there with levels. */
function handsTidy(f) {
  for (const w of [f, ...(f.levels || [])]) {
    for (const k of ['motion', 'names']) if (w[k] && !Object.keys(w[k]).length) delete w[k];
    for (const k of ['added', 'removed']) if (w[k] && !w[k].length) delete w[k];
  }
  if (f.motions && !f.motions.length) delete f.motions;
  if (!f.objects) f.objects = {};
  return f;
}

/** The world part an op is about: the top of a file without levels, else the level `op.level` names. */
function handsWorld(f, op) {
  if (!f.levels) {
    if (op.level) return { error: `this game has no levels yet (no "level" needed)` };
    return { w: f };
  }
  if (!op.level) return { error: `this game has levels: say which one with "level" (${f.levels.map((l) => l.id).join(', ')})` };
  const w = f.levels.find((l) => l.id === op.level);
  return w ? { w } : { error: `no level "${op.level}" (${f.levels.map((l) => l.id).join(', ')})` };
}

function handsFileOp(f, op, dim) {
  const kind = op.do.split('.')[0];
  // No editor open: there is no person's Save to press, and placement.json is written as it is.
  if (op.do === 'save') return { said: 'nothing to save: no editor is open, and placement.json is written as it is' };
  if (op.do === 'editor.reload') return { error: 'the editor is not open (nothing to reload)' };
  if (op.do === 'list') return { list: handsFileList(f) };
  if (op.do === 'object.ground') return { error: 'putting it on the ground needs the editor open (it measures what is under the object)' };
  if (op.do === 'level.new') return { error: 'a new (blank) level needs the editor open (it lists what the level keeps)' };
  if (op.do === 'level.switch') return { error: 'the editor is not open: it opens on a level when it starts' };
  if (kind === 'level') return handsFileLevel(f, op);
  if (op.do === 'motion.delete' || op.do === 'motion.rename' || (op.do === 'motion.set' && !op.key) || (op.do === 'motion.make' && !op.key)) return handsFileLibrary(f, op, dim);
  const at = handsWorld(f, op);
  if (at.error) return at;
  const w = at.w;
  if (kind === 'motion') return handsFileMotion(f, w, op, dim);
  return handsFileObject(w, op, dim);
}

const handsLib = (f, name) => (f.motions || []).find((m) => m.name === name) || null;
const handsWorlds = (f) => [f, ...(f.levels || [])];
const handsFree = (f, base) => {
  if (!handsLib(f, base)) return base;
  for (let i = 2; ; i++) if (!handsLib(f, `${base} ${i}`)) return `${base} ${i}`;
};

/** Ops on the Library alone: delete, rename, set repeat / length for every object, make without an object. */
function handsFileLibrary(f, op, dim) {
  if (op.do === 'motion.make') return handsFileMake(f, op, dim);
  const l = handsLib(f, op.name);
  if (!l) return { error: `no motion "${op.name}" in the Library (${(f.motions || []).map((m) => `"${m.name}"`).join(', ') || 'it has none'})` };
  if (op.do === 'motion.delete') {
    let from = 0;
    for (const w of handsWorlds(f)) for (const k of Object.keys(w.motion || {})) {
      const cs = (w.motion[k].clips || []).filter((c) => c.use !== op.name);
      if (cs.length === (w.motion[k].clips || []).length) continue;
      from++;
      if (cs.length) w.motion[k] = { clips: cs };
      else delete w.motion[k];
    }
    f.motions = f.motions.filter((m) => m !== l);
    return { from };
  }
  if (op.do === 'motion.rename') {
    const to = handsFree(f, op.to);
    for (const w of handsWorlds(f)) for (const k of Object.keys(w.motion || {})) {
      w.motion[k] = { clips: w.motion[k].clips.map((c) => {
        const fix = (x) => (x && x.on === 'after' && x.use === op.name ? { ...x, use: to } : x);
        const when = Array.isArray(c.when) ? c.when.map(fix) : fix(c.when);
        const out = { ...c, ...(when ? { when } : {}) };
        if (c.use === op.name) {
          out.use = to;
          if (c.name === op.name) out.name = to;
        }
        if (out.name === out.use) delete out.name;
        return out;
      }) };
    }
    l.name = to;
    return { to };
  }
  // motion.set without an object: the Library motion's repeat / length (every object that uses it plays it so).
  if (op.when !== undefined || op.until !== undefined) {
    let n = 0;
    for (const w of handsWorlds(f)) for (const k of Object.keys(w.motion || {})) for (const c of w.motion[k].clips || []) if (c.use === op.name) (handsSetClip(c, op), n++);
    if (!n) return { error: `"${op.name}" is on no object: put it on one first (motion.attach)` };
  }
  handsSetLib(l, op);
  return {};
}

function handsSetLib(l, op) {
  if (op.repeat) {
    if (op.repeat === 'once') delete l.repeat;
    else l.repeat = op.repeat;
  }
  if (op.len) {
    // A new length stretches the keys with it (timeline-model stretchClip): "slower" / "faster" keep the same path.
    const k = op.len / l.len;
    for (const ch of ['p', 'r', 's']) for (const key of l.keys?.[ch] || []) key.t = Math.min(op.len, Math.round(key.t * k * 1000) / 1000);
    for (const tr of Object.values(l.tracks || {})) for (const ch of ['p', 'r', 's']) for (const key of tr[ch] || []) key.t = Math.min(op.len, Math.round(key.t * k * 1000) / 1000);
    l.len = op.len;
  }
}

function handsSetClip(c, op) {
  if (op.when !== undefined) {
    c.when = structuredClone(op.when);
    delete c.start;
  }
  if (op.until !== undefined) {
    if (op.until) c.until = structuredClone(op.until);
    else delete c.until;
  }
}

/** motion.make: the Library motion (made from points or keys), and on the object when there is a key. */
function handsFileMake(f, op, dim, w) {
  const made = handsMotion(op, dim);
  if (made.error) return made;
  const m = made.motion;
  const was = handsLib(f, m.name);
  if (was && op.replace) {
    // `replace`: the same name with new keys — every object that has it moves the new way (the AI fixing its spiral).
    for (const k of Object.keys(was)) delete was[k];
    Object.assign(was, m);
  } else {
    // Without it a name already taken gets "Spiral 2", as the editor's Library does: an AI never overwrites by accident.
    if (was) m.name = handsFree(f, m.name);
    (f.motions ||= []).push(m);
  }
  if (!w) return { motion: m };
  const clips = w.motion?.[op.key]?.clips || [];
  if (clips.some((c) => (c.use ?? c.name) === m.name)) {
    const c = clips.find((x) => (x.use ?? x.name) === m.name);
    handsSetClip(c, op);
    return { motion: m, when: c.when };
  }
  if (clips.length >= LIMITS.maxClips) return { error: `${op.key} already has ${LIMITS.maxClips} motions` };
  // A motion the AI makes starts with the game unless it says otherwise (HANDS_MAKE_WHEN).
  const when = op.when ?? HANDS_MAKE_WHEN;
  const clip = { use: m.name, when, ...(op.until ? { until: op.until } : {}) };
  (w.motion ||= {})[op.key] = { clips: [...clips, clip] };
  return { motion: m, when };
}

function handsFileMotion(f, w, op, dim) {
  if ((w.removed || []).some((r) => r.key === op.key)) return { error: `${op.key} was deleted` };
  if (op.do === 'motion.make') return handsFileMake(f, op, dim, w);
  const clips = w.motion?.[op.key]?.clips || [];
  if (op.do === 'motion.attach') {
    if (!handsLib(f, op.name)) return { error: `no motion "${op.name}" in the Library (${(f.motions || []).map((m) => `"${m.name}"`).join(', ') || 'it has none'})` };
    if (clips.some((c) => (c.use ?? c.name) === op.name)) return { error: `${op.key} has "${op.name}" already (motion.set changes when it starts)` };
    if (clips.length >= LIMITS.maxClips) return { error: `${op.key} already has ${LIMITS.maxClips} motions` };
    const when = op.when ?? handsDefaultWhen(clips);
    (w.motion ||= {})[op.key] = { clips: [...clips, { use: op.name, when, ...(op.until ? { until: op.until } : {}) }] };
    return { when };
  }
  const named = clips.map((c) => ({ ...c, name: c.name ?? c.use }));
  if (op.do === 'motion.detach') {
    if (op.all) {
      if (!clips.length) return { error: `${op.key} has no motion` };
      delete w.motion[op.key];
      return { all: named.map((c) => `"${c.name}"`).join(', ') };
    }
    const r = handsClip(named, op.name, op.key);
    if (r.error) return r;
    const rest = clips.filter((_, i) => named[i] !== r.clip);
    if (rest.length) w.motion[op.key] = { clips: rest };
    else delete w.motion[op.key];
    return { clip: r.clip.name };
  }
  // motion.set with an object: when / until on its clip; repeat / length on the Library motion (they are the motion's).
  const r = handsClip(named, op.name, op.key);
  if (r.error) return r;
  handsSetClip(clips[named.indexOf(r.clip)], op);
  const l = handsLib(f, r.clip.use ?? r.clip.name);
  if (l) handsSetLib(l, op);
  return {};
}

function handsFileObject(w, op, dim) {
  const added = (w.added || []).find((a) => a.key === op.key);
  if ((w.removed || []).some((r) => r.key === op.key)) return { error: `${op.key} was deleted` };
  const entry = w.objects?.[op.key];
  const now = added ? { p: added.p, r: added.r, s: added.s } : entry ? { p: entry.p, r: entry.r, s: entry.s, ...(entry.t ? { t: entry.t } : {}) } : null;
  if (op.do === 'object.rename') {
    (w.names ||= {})[op.key] = op.to;
    return {};
  }
  if (op.do === 'object.delete') {
    if (added) w.added = w.added.filter((a) => a !== added);
    else (w.removed ||= []).push({ key: op.key, ...(entry?.label ? { label: entry.label } : {}), ...(entry?.was ? { was: entry.was } : {}) });
    if (w.objects) delete w.objects[op.key];
    if (w.motion) delete w.motion[op.key];
    if (w.names) delete w.names[op.key];
    if (w.removed) w.removed.sort((a, b) => (a.key < b.key ? -1 : 1));
    return {};
  }
  if (op.do === 'object.duplicate') {
    const base = handsPose({ ...op, do: 'object.move' }, now, dim);
    if (!now?.p && !op.to) return { error: `where ${op.key} stands is not known here: give "to" (the copy's place), or open the editor` };
    if (base.error) return base;
    const taken = new Set([...Object.keys(w.objects || {}), ...(w.added || []).map((a) => a.key), ...(w.removed || []).map((r) => r.key)]);
    const copy = handsCopyKey(op.key, taken);
    const p = base.pose;
    (w.added ||= []).push({ key: copy, from: op.key, p: p.p, r: p.r ?? 0, s: p.s ?? 1 });
    return { copy };
  }
  const r = handsPose(op, now, dim);
  if (r.error) return r;
  if (added) Object.assign(added, { p: r.pose.p ?? added.p, r: r.pose.r ?? added.r, s: r.pose.s ?? added.s });
  else {
    const e = (w.objects ||= {})[op.key] || {};
    if (r.pose.p) e.p = r.pose.p;
    if (r.pose.r !== undefined) e.r = r.pose.r;
    if (r.pose.s !== undefined) e.s = r.pose.s;
    w.objects[op.key] = e;
  }
  return { pose: r.pose };
}

function handsFileLevel(f, op) {
  if (!f.levels) return { error: 'this game has no levels in placement.json yet: open the editor (its levels come from the game)' };
  const id = op.id ?? (op.do === 'level.rename' || op.do === 'level.duplicate' ? null : undefined);
  if (op.do === 'level.rename' || op.do === 'level.duplicate') {
    if (!id) return { error: `say which level with "id" (${f.levels.map((l) => l.id).join(', ')})` };
  }
  const l = f.levels.find((x) => x.id === id);
  if (!l) return { error: `no level "${id}" (${f.levels.map((x) => x.id).join(', ')})` };
  if (op.do === 'level.rename') {
    // The code's name stays in labelWas (the AI renames it in the code); renamed back = nothing to do.
    const code = l.labelWas ?? l.label ?? l.id;
    if (op.to === code) delete l.labelWas;
    else if (!l.from) l.labelWas = code;
    l.label = op.to;
    return { id: l.id };
  }
  // level.duplicate: a level made in the editor is `from` its code level, with this level's entries over it.
  const ids = new Set(f.levels.map((x) => x.id));
  let n = 2;
  while (ids.has(`${l.from ?? l.id}-${n}`)) n++;
  const nid = `${l.from ?? l.id}-${n}`;
  const label = op.name ?? `${l.label ?? l.id} ${n}`;
  const copy = { ...structuredClone(l), id: nid, label, from: l.from ?? l.id };
  delete copy.labelWas;
  f.levels.splice(f.levels.indexOf(l) + 1, 0, copy);
  if (!f.levelsWas) f.levelsWas = f.levels.filter((x) => !x.from).map((x) => x.id);
  return { id: nid, label };
}

/**
 * `list` with no editor open: what placement.json knows (only objects it has an entry for — the editor's own `list`
 * has every object of the game, with the names the person sees).
 */
function handsFileList(f) {
  const world = (w) => {
    const keys = new Set([...Object.keys(w.objects || {}), ...(w.added || []).map((a) => a.key), ...Object.keys(w.motion || {}), ...Object.keys(w.names || {})]);
    return [...keys].sort().map((key) => {
      const o = { key };
      const label = w.names?.[key] ?? w.objects?.[key]?.label;
      if (label) o.name = label;
      const ms = (w.motion?.[key]?.clips || []).map((c) => c.name ?? c.use);
      if (ms.length) o.motions = ms;
      return o;
    });
  };
  const out = { from: 'placement.json (no editor open: only the objects it has)', objects: f.levels ? [] : world(f) };
  out.motions = (f.motions || []).map((m) => ({ name: m.name, len: m.len, repeat: m.repeat ?? 'once' }));
  if (f.levels) out.levels = f.levels.map((l) => ({ id: l.id, name: l.label ?? l.id, objects: world(l) }));
  return out;
}

