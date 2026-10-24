// KUMODeck Game Studio placement loader (MIT). Applies placement.json to a three.js Scene or PixiJS stage.
const KEY_CHARS = /[^A-Za-z0-9_:#.\-\/]/g;
const cleanName = (s) => (typeof s === 'string' && s ? s.replace(KEY_CHARS, '_').slice(0, 80) : '');
export async function applyPlacement(root, source = './placement.json', opts = {}) {
const report = { applied: [], missing: [], unstable: [], skipped: [] };
const three = !!(root && root.isObject3D);
const isWorld = !!root && typeof root === 'object' && root.nodeType !== 9;
if (isWorld) last = { root, n: three ? 3 : 2, three };
const codeOnly = () => (isWorld && placeCode(root, three, null, report, opts), report);
let data = source;
if (typeof source === 'string') {
try {
const res = await fetch(source, { cache: 'no-cache' });
if (!res.ok) return codeOnly();
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
codeThemeFile(data.theme);
codeUiFile(data.ui);
if (data.ui && typeof data.ui === 'object' && typeof document !== 'undefined') report.ui = applyUi(document, data.ui);
if (root && root.nodeType === 9) return report;
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
placeCode(root, three, data.places, report, opts);
for (const key of Object.keys(data.objects)) {
const e = data.objects[key];
if (e && e.unstable) report.unstable.push(key);
const obj = findByKey(root, key, three);
if (!obj) report.missing.push(key);
else if (put(obj, e, n, three)) report.applied.push(key);
else report.skipped.push(key);
}
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
const MOVING = Symbol.for('game-studio.motion');
const known = new Map();
let run = null;
let ticking = false;
let world = null;
let library = [];
let player = null;
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
export function cue(name) {
return fire({ on: 'cue', cue: name });
}
export function touch(key) {
return fire({ on: 'touch', key });
}
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
export function clipOf(key, name) {
const k = known.get(key);
return (k && k.clips.find((c) => c.name === name)) || resolveClip(library.find((m) => m && m.name === name) ? { use: name } : null, library, key);
}
export function whenOf(c) {
if (!c || typeof c !== 'object') return { on: 'say' };
const w = Array.isArray(c.when) ? c.when.find((x) => x && typeof x.on === 'string') : c.when;
if (w && typeof w === 'object' && typeof w.on === 'string') return w;
if (c.start === true || (c.use && w === undefined)) return { on: 'start' };
return typeof w === 'string' && w.trim() ? { on: 'say', say: w } : { on: 'say' };
}
export function whensOf(c) {
const ws = c && Array.isArray(c.when) ? c.when.filter((x) => x && typeof x.on === 'string') : [];
return ws.length ? ws : [whenOf(c)];
}
export function resolveClip(c, lib, key) {
if (!c || typeof c !== 'object') return null;
if (typeof c.use === 'string') {
const m = (Array.isArray(lib) ? lib : []).find((x) => x && x.name === c.use && (typeof (x.tracks || x.keys) === 'object' || typeof x.code === 'string'));
const tr = m && m.tracks;
const off = c.off === true ? { off: true } : {};
if (m && typeof m.code === 'string') return { name: typeof c.name === 'string' ? c.name : c.use, use: c.use, code: m.code, knobs: m.knobs, key, repeat: 'loop', when: whenOf(c), whens: whensOf(c), until: c.until, ...off };
return m ? { name: typeof c.name === 'string' ? c.name : c.use, use: c.use, len: m.len, repeat: m.repeat, keys: tr ? tr[key] || {} : m.keys, when: whenOf(c), whens: whensOf(c), until: c.until, scene: !!tr, ...off } : null;
}
return typeof c.name === 'string' && c.keys && typeof c.keys === 'object' ? { ...c, when: whenOf(c), whens: whensOf(c) } : null;
}
export function motionRunner(objs) {
const list = (Array.isArray(objs) ? objs : []).filter((x) => x && Array.isArray(x.clips)).map((x) => ({ ...x, clips: x.clips.filter((c) => c && !c.off) }));
const movers = new Map();
const held = new Map();
let t0 = null;
const timed = new Set();
const inside = new Map();
const ok = (v) => typeof v === 'number' && isFinite(v);
const round = (c) => (c.code ? codeRound(c) || Infinity : (ok(c.len) && c.len > 0 ? c.len : 1) * (c.repeat === 'pingpong' ? 2 : 1));
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
stop(key) {
if (key === undefined) (movers.clear(), held.clear());
else movers.delete(key), held.delete(key);
},
busy: () => movers.size > 0 || list.some(({ clips }) => clips.some((c) => ws(c).some((w) => w.on === 'enter' || (w.on === 'time' && t0 !== null && !timed.has(w))))),
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
playing: () => new Map([...movers].map(([k, r]) => [k, r.clip.name])),
};
}
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
export function handlesOf(ks, i) {
const k = ks[i], n = k.v.length, prev = ks[i - 1], next = ks[i + 1];
const p0 = prev && (prev.ease || 'ease') !== 'step' ? prev.v : k.v;
const p3 = next && (k.ease || 'ease') !== 'step' ? next.v : k.v;
return {
in: !prev ? null : hOk(k.in, n) ? k.in : k.v.map((_, j) => (prev.v[j] - p3[j]) / 6),
out: !next ? null : hOk(k.out, n) ? k.out : k.v.map((_, j) => (next.v[j] - p0[j]) / 6),
};
}
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
function legacyAt(m, t, n) {
const a = motionAt(m, t);
return { p: a.off, r: isNum(m.spin) ? (n === 3 ? [0, a.turn, 0] : [a.turn]) : null, s: null, done: a.done };
}
function poseAt(o, base, at, three) {
if (at.p) three ? o.position.set(base.p[0] + at.p[0], base.p[1] + at.p[1], base.p[2] + at.p[2]) : o.position.set(base.p[0] + at.p[0], base.p[1] + at.p[1]);
if (at.r) {
if (three) (o.rotation.x = base.r[0] + (at.r[0] || 0)), (o.rotation.y = base.r[1] + (at.r[1] || 0)), (o.rotation.z = base.r[2] + (at.r[2] || 0));
else o.rotation = base.r[0] + (at.r[0] || 0);
}
if (at.s) three ? o.scale.set(base.s[0] * at.s[0], base.s[1] * at.s[1], base.s[2] * at.s[2]) : o.scale.set(base.s[0] * at.s[0], base.s[1] * at.s[1]);
}
let here = false;
const editing = () => !here && typeof location !== 'undefined' && /[?&]studio=edit(&|$)/.test(location.search);
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
function whereIs(who) {
const o = (who && world && findByKey(world, who, !!world.isObject3D)) || player;
if (!o || !o.position) return null;
if (o.getWorldPosition) {
const v = o.getWorldPosition(o.position.clone());
return [v.x, v.y, v.z];
}
return [o.position.x, o.position.y];
}
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
if (!k || k.o.parent === null) run.stop(key);
else poseAt(k.o, k.base, at, k.three);
}
requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
}
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
function clickable(key, o, three) {
clicks.set(key, o);
if (!three && typeof o.on === 'function') {
o.eventMode = 'static';
o.cursor = 'pointer';
o.on('pointertap', () => fire({ on: 'click', key }));
}
}
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
const CODE_MOTIONS = Symbol.for('game-studio.codeMotions');
const CODE_PLACES = Symbol.for('game-studio.codePlaces');
const CODE_AVOIDS = Symbol.for('game-studio.codeAvoids');
const codeList = (sym) => (globalThis[sym] instanceof Map ? globalThis[sym] : (globalThis[sym] = new Map()));
const CODE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KNOB_NAME = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
const KNOB_UNITS = ['m', 'px', 's', 'deg', '%', 'x', 'm/s', 'px/s', ''];
const MAX_PLACED = 200;
const MAX_TRIES = 30;
const warned = new Set();
const warnOnce = (msg) => {
if (warned.has(msg)) return;
warned.add(msg);
warn(msg);
};
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
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
export function knobValues(knobs, fileKnobs) {
const k = {};
for (const [name, d] of Object.entries(knobs || {})) {
const f = fileKnobs && typeof fileKnobs === 'object' && fileKnobs[name] && fileKnobs[name].v;
k[name] = isNum(f) ? f : d.v;
}
return k;
}
export function codeMotion(id, def) {
if (typeof id !== 'string' || !CODE_ID.test(id) || !def || typeof def.at !== 'function') {
warnOnce(`codeMotion(${JSON.stringify(id)}): needs an id (a-z, 0-9, -) and at(t, k)`);
return null;
}
const m = { id, name: text(def.name, 40) || id, knobs: knobsOf(def.knobs, `codeMotion('${id}')`), round: def.round, note: text(def.note, 20), game: def.game === true, drag: def.drag, at: def.at };
codeList(CODE_MOTIONS).set(id, m);
return m;
}
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
export function codeAvoid(id, def) {
if (typeof id !== 'string' || !CODE_ID.test(id) || !def || typeof def.test !== 'function') {
warnOnce(`codeAvoid(${JSON.stringify(id)}): needs an id (a-z, 0-9, -) and test(p, k)`);
return null;
}
const a = { id, name: text(def.name, 40) || id, after: text(def.after, 20), knobs: knobsOf(def.knobs, `codeAvoid('${id}')`), test: def.test, show: def.show };
codeList(CODE_AVOIDS).set(id, a);
return a;
}
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
function vecOf(v, n, turn) {
if (isNum(v)) return n === 3 && turn ? [0, v, 0] : n === 3 ? [v, v, v] : turn ? [v] : [v, v];
if (!Array.isArray(v) || !v.every(isNum)) return null;
const w = turn && n === 2 ? 1 : n;
return v.length >= w ? v.slice(0, w) : null;
}
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
function playerAt(root, three, opts) {
const o = opts && opts.player;
if (Array.isArray(o) && o.every(isNum)) return o.slice();
const obj = (o && o.position ? o : null) || player || findByKey(root, 'player', three);
if (!obj || !obj.position) return null;
return three ? [obj.position.x, obj.position.y, obj.position.z] : [obj.position.x, obj.position.y];
}
function inBox(q, b, n) {
if (!b || !Array.isArray(b.p) || !Array.isArray(b.size) || !Array.isArray(q)) return false;
if (n === 2) return Math.abs(q[0] - b.p[0]) <= b.size[0] / 2 && Math.abs(q[1] - b.p[1]) <= b.size[1] / 2;
return Math.abs(q[0] - b.p[0]) <= b.size[0] / 2 && q[1] >= b.p[1] - 1e-9 && q[1] <= b.p[1] + b.size[1] && Math.abs(q[2] - b.p[2]) <= b.size[2] / 2;
}
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
function codePlaceAt(p, i, k, tr, level, n, seen) {
const r = randOf(`${p.id}:${i}:${tr}`);
const g = { try: tr, rand: seen ? () => ((seen.rand = true), r()) : r, level: level || null };
let a;
try {
a = p.at(i, k, g);
} catch (e) {
warnOnce(`codePlace('${p.id}'): at failed (${e && e.message})`);
return null;
}
return a && typeof a === 'object' && vecOf(a.p, n, false) ? a : null;
}
function placeOf(a, n) {
if (!a) return a;
const by = vecOf(a.by, n, false);
return by ? { ...a, p: vecOf(a.p, n, false).map((v, j) => v + by[j]) } : a;
}
const OFFSET_WAYS = ['along', 'side', 'up', 'turn', 'size', 'move'];
const OFFSET_HOWS = ['same', 'zigzag', 'ramp', 'jitter'];
const jitterAt = (seed, i, axis) => randOf(`jitter:${isNum(seed) ? seed : 0}:${i}:${axis}`)() * 2 - 1;
export function jitter(seed, i, axis = 0) {
return jitterAt(seed, i, axis);
}
const MAX_OFFSETS = 8;
function offsetsOf(v, where) {
if (!Array.isArray(v)) return [];
const out = [];
for (const o of v.slice(0, MAX_OFFSETS)) {
const ok = o && OFFSET_WAYS.includes(o.way) && OFFSET_HOWS.includes(o.how) && (o.way !== 'move' || o.how === 'same' || o.how === 'jitter')
&& (o.way === 'move' ? Array.isArray(o.v) && o.v.length === 2 && o.v.every(isNum) : isNum(o.v));
if (ok) out.push(o);
else warnOnce(`${where}: an offset needs a way (${OFFSET_WAYS.join(', ')}), a how (${OFFSET_HOWS.join(', ')}) and a number v`);
}
return out;
}
export function offsetFrame(spots, n, random) {
if (random || !Array.isArray(spots)) return null;
const pts = [];
spots.forEach((q, i) => Array.isArray(q) && pts.push({ i, x: q[0], z: n === 3 ? q[2] : q[1] }));
if (pts.length < 3) return null;
const xs = pts.map((q) => q.x), zs = pts.map((q) => q.z);
const tol = Math.max(1e-6, 0.02 * Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)));
for (const [u, w] of [[0, 1], [0, 2], [1, 2]]) {
const len = Math.hypot(pts[w].x - pts[u].x, pts[w].z - pts[u].z);
if (len < tol) continue;
let d = [(pts[w].x - pts[u].x) / len, (pts[w].z - pts[u].z) / len];
const across = (q) => d[0] * q.z - d[1] * q.x;
const c0 = across(pts[0]);
let c1 = null;
const row = pts.map((q) => {
const c = across(q);
if (Math.abs(c - c0) <= tol) return 0;
if (c1 === null) c1 = c;
return Math.abs(c - c1) <= tol ? 1 : -1;
});
if (row.includes(-1)) continue;
const nb = row.filter((x) => x === 1).length;
if (c1 !== null && (Math.min(nb, pts.length - nb) < 2 || Math.max(nb, pts.length - nb) < 3)) continue;
const t = (q) => d[0] * q.x + d[1] * q.z;
const rows = c1 === null ? [pts] : [pts.filter((_, j) => !row[j]), pts.filter((_, j) => row[j])];
const lo = Math.min(...rows[0].map(t)), hi = Math.max(...rows[0].map(t));
if (Math.abs(t(rows[0][0]) - hi) < Math.abs(t(rows[0][0]) - lo)) d = [-d[0], -d[1]];
const nrm = [-d[1], d[0]];
const cs = rows.map((r) => d[0] * r[0].z - d[1] * r[0].x);
const mid = rows.length === 2 ? (cs[0] + cs[1]) / 2 : 0;
const out = spots.map(() => null);
rows.forEach((r, l) => {
const sg = Math.abs(cs[l] - mid) > tol ? Math.sign(cs[l] - mid) : 1;
const lo2 = Math.min(...r.map(t)), hi2 = Math.max(...r.map(t));
const back = Math.abs(t(r[0]) - hi2) < Math.abs(t(r[0]) - lo2);
const order = r.slice().sort((a, b) => (back ? t(b) - t(a) : t(a) - t(b)) || a.i - b.i);
order.forEach((q, rank) => (out[q.i] = { l, r: rank, a: d.slice(), s: [nrm[0] * sg, nrm[1] * sg], m: l === 1 }));
});
return out;
}
return null;
}
export function offsetAt(offs, frame, i, n) {
if (!offs || !offs.length) return null;
const f = frame ? frame[i] : null;
const p = n === 3 ? [0, 0, 0] : [0, 0];
const z = n === 3 ? 2 : 1;
let r = 0, s = 1;
for (const o of offs) {
const jit = o.how === 'jitter';
if (!f && ((o.how !== 'same' && !jit) || o.way === 'along' || o.way === 'side')) continue;
const k = jit ? jitterAt(o.seed, i, 0) : o.how === 'zigzag' ? ((f.r % 2 === 1) === !!o.odd ? 1 : 0) : o.how === 'ramp' ? f.r : 1;
if (o.way === 'size') s *= o.how === 'ramp' || jit ? 1 + (o.v - 1) * k : k ? o.v : 1;
else if (o.way === 'turn') r += (((f && f.m ? -1 : 1) * o.v * k) * Math.PI) / 180;
else if (o.way === 'up') {
if (n === 3) p[1] += o.v * k;
} else if (o.way === 'move') (p[0] += o.v[0] * k), (p[z] += o.v[1] * (jit ? jitterAt(o.seed, i, 1) : k));
else {
const u = o.way === 'along' ? f.a : f.s;
p[0] += u[0] * o.v * k;
p[z] += u[1] * o.v * k;
}
}
return { p, r, s: Math.max(0.01, s) };
}
function shiftAt(a, off, n) {
if (!a || !off) return a;
return { ...a, p: vecOf(a.p, n, false).map((v, j) => v + off.p[j]) };
}
const MADE = new WeakMap();
function turnedAt(a, off, o, three) {
if (!off || (!off.r && off.s === 1)) return a;
const out = { ...a };
const own = MADE.get(o) || { r: 0, s: 1 };
if (off.r) {
if (three && Array.isArray(a.r) && a.r.length === 3) out.r = [a.r[0], a.r[1] + off.r, a.r[2]];
else out.r = (isNum(a.r) ? a.r : Array.isArray(a.r) && isNum(a.r[0]) ? a.r[0] : own.r) + off.r;
}
if (off.s !== 1) {
const s = a.s !== undefined ? a.s : own.s;
out.s = Array.isArray(s) ? s.map((v) => v * off.s) : (isNum(s) && s !== 0 ? s : 1) * off.s;
}
return out;
}
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
for (const [id, f] of Object.entries(places && typeof places === 'object' ? places : {})) {
if (!f || !Array.isArray(f.from) || !all.has(id)) continue;
for (const key of f.from) {
const o = typeof key === 'string' && handObject(root, key, three, made);
if (o) o.visible = false;
}
}
}
function countOf(p, k) {
let count = p.count;
try {
if (typeof count === 'function') count = count(k);
} catch (e) {
warnOnce(`codePlace('${p.id}'): count failed (${e && e.message})`);
count = 0;
}
return isNum(count) ? Math.max(0, Math.min(MAX_PLACED, Math.floor(count))) : 0;
}
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
const count = countOf(p, k);
const seen = { rand: false };
const first = [];
for (let i = 0; i < count; i++) first.push(codePlaceAt(p, i, k, 0, level, n, seen));
p.base = first.map((a) => (a && a.hand !== true ? vecOf(a.p, n, false) : null));
p.frame = offsetFrame(p.base, n, seen.rand);
p.random = seen.rand;
p.fk = { sig: JSON.stringify(k), frame: p.frame };
const offs = (p.offs = f.hand ? [] : offsetsOf(f.offsets, `codePlace('${p.id}')`));
const tests = f.hand ? [] : avoidTests(p, f, n, { player: playerAt(root, three, opts), level });
for (let i = 0; i < count; i++) {
const key = `${p.id}-${i + 1}`;
const pin = f.pins && f.pins[key] && Array.isArray(f.pins[key].p) ? f.pins[key] : null;
const off = offsetAt(offs, p.frame, i, n);
let at = null;
if (pin || !tests.length || (first[i] && first[i].hand === true)) at = shiftAt(placeOf(first[i], n), off, n);
else {
let prev = null;
for (let tr = 0; tr < MAX_TRIES; tr++) {
const a = shiftAt(placeOf(tr ? codePlaceAt(p, i, k, tr, level, n) : first[i], n), off, n);
if (!a) break;
const q = vecOf(a.p, n, false);
if (!tests.some((t) => t(q))) {
at = a;
break;
}
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
MADE.set(o, { r: three ? o.rotation.y : o.rotation, s: three ? [o.scale.x, o.scale.y, o.scale.z] : [o.scale.x, o.scale.y] });
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
if (at) putCode(o, turnedAt(at, off, o, three), three);
if (pin) put(o, pin, n, three);
p.objs.push(o);
p.keys.push(key);
}
for (const o of old.values()) if (o && o.parent) three ? o.parent.remove(o) : o.parent.removeChild(o);
return p.objs;
}
export function relayCodePlace(id, f) {
const p = codeList(CODE_PLACES).get(id);
if (!p || !p.home) return null;
layOut(p, f && typeof f === 'object' ? f : {});
return { keys: p.keys.slice(), skipped: p.skipped.slice() };
}
function ruleAt(id, i, k) {
const p = codeList(CODE_PLACES).get(id);
if (!p) return null;
const n = p.home && p.home.three ? 3 : 2;
const level = (p.home && p.home.opts && p.home.opts.level) || null;
const a = placeOf(codePlaceAt(p, i, k, 0, level, n), n);
if (!a) return null;
let off = null;
if (p.offs && p.offs.length) {
const sig = JSON.stringify(k);
if (!p.fk || p.fk.sig !== sig) {
const seen = { rand: false };
const spots = [];
for (let j = 0; j < countOf(p, k); j++) {
const b = codePlaceAt(p, j, k, 0, level, n, seen);
spots.push(b && b.hand !== true ? vecOf(b.p, n, false) : null);
}
p.fk = { sig, frame: offsetFrame(spots, n, seen.rand) };
}
off = offsetAt(p.offs, p.fk.frame, i, n);
}
return { a: shiftAt(a, off, n), off, o: p.objs[p.keys.indexOf(`${id}-${i + 1}`)] || null, n, three: n === 3 };
}
export function codeSpot(id, i, k) {
const r = ruleAt(id, i, k);
return r ? vecOf(r.a.p, r.n, false) : null;
}
export function codePose(id, i, k) {
const r = ruleAt(id, i, k);
if (!r) return null;
const n = r.n;
const a = r.o ? turnedAt(r.a, r.off, r.o, r.three) : r.a;
const out = { p: vecOf(a.p, n, false) };
if (n === 3 && Array.isArray(a.r) && a.r.length === 3 && a.r.every(isNum)) (out.r = a.r[1]), (out.t = [a.r[0], a.r[2]]);
else if (isNum(a.r)) out.r = a.r;
else if (Array.isArray(a.r) && isNum(a.r[0])) out.r = a.r[0];
if (isNum(a.s) && a.s !== 0) out.s = a.s;
else if (Array.isArray(a.s) && a.s.every(isNum)) out.s = a.s.slice(0, n);
return out;
}
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
const CODE_UIS = Symbol.for('game-studio.codeUis');
const CODE_UI_FILE = Symbol.for('game-studio.codeUiFile');
export const UI_FROMS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const UI_KINDS = ['text', 'bar', 'button', 'image', 'box'];
const UI_LOOK = ['text', 'fontSize', 'color', 'background'];
const UI_STATE_NAMES = ['hover', 'active', 'disabled'];
function codeUiFile(ui) {
const m = new Map();
if (ui && typeof ui === 'object') {
for (const [k, e] of Object.entries(ui)) {
if (!e || e.code !== k || !Array.isArray(e.p) || e.p.length !== 2 || !e.p.every(isNum)) continue;
const o = { p: e.p.slice(), s: isNum(e.s) && e.s > 0 ? e.s : 1 };
if (UI_FROMS.includes(e.from) && Array.isArray(e.at) && e.at.length === 2 && e.at.every(isNum)) (o.from = e.from), (o.at = e.at.slice());
if (e.set && typeof e.set === 'object') o.set = e.set;
m.set(k, o);
}
}
globalThis[CODE_UI_FILE] = m;
uiPokeAll();
}
const codeUiFileOf = (id) => (globalThis[CODE_UI_FILE] instanceof Map ? globalThis[CODE_UI_FILE].get(id) : undefined) || null;
function uiSides(from) {
const [v, h] = from === 'center' ? ['middle', 'middle'] : from === 'left' || from === 'right' ? ['middle', from] : from.includes('-') ? from.split('-') : [from, 'middle'];
return [h, v];
}
export function uiBoxAt(from, x, y, w, h, W, H) {
const [hz, v] = uiSides(UI_FROMS.includes(from) ? from : 'top-left');
return [hz === 'left' ? x : hz === 'right' ? W - x - w : W / 2 + x - w / 2, v === 'top' ? y : v === 'bottom' ? H - y - h : H / 2 + y - h / 2];
}
export function uiAtOf(from, bx, by, w, h, W, H) {
const [hz, v] = uiSides(from);
return [hz === 'left' ? bx : hz === 'right' ? W - bx - w : bx + w / 2 - W / 2, v === 'top' ? by : v === 'bottom' ? H - by - h : by + h / 2 - H / 2];
}
export function uiNearest(bx, by, w, h, W, H) {
const col = [Math.abs(bx), Math.abs(bx + w / 2 - W / 2), Math.abs(W - bx - w)];
const row = [Math.abs(by), Math.abs(by + h / 2 - H / 2), Math.abs(H - by - h)];
const c = col.indexOf(Math.min(...col)), r = row.indexOf(Math.min(...row));
return UI_FROMS[r * 3 + c];
}
const UI_VAR = /^var\(\s*(--[A-Za-z0-9_-]{1,60})\s*(?:,\s*([^();{}<>]{1,60}))?\)$/;
const uiColorOk = (c) => typeof c === 'string' && (UI_COLOR.test(c) || UI_VAR.test(c.trim()));
function uiResolve(v) {
const m = typeof v === 'string' ? UI_VAR.exec(v.trim()) : null;
if (!m) return v;
return themeNow(m[1]) || (m[2] ? m[2].trim() : v);
}
function uiLookOf(v) {
const o = {};
if (!v || typeof v !== 'object') return o;
if (typeof v.text === 'string') o.text = v.text.slice(0, 200);
if (isNum(v.fontSize) && v.fontSize > 0) o.fontSize = v.fontSize;
for (const k of ['color', 'background']) if (uiColorOk(v[k])) o[k] = v[k];
return o;
}
export function codeUi(id, def) {
const ok = typeof id === 'string' && CODE_ID.test(id) && def && typeof def === 'object';
if (!ok) warnOnce(`codeUi(${JSON.stringify(id)}): needs an id (a-z, 0-9, -) and { at, size }`);
const d = def && typeof def === 'object' ? def : {};
const at = d.at && typeof d.at === 'object' ? d.at : {};
const states = {};
if (d.states && typeof d.states === 'object') for (const s of UI_STATE_NAMES) if (d.states[s]) states[s] = uiLookOf(d.states[s]);
const list = codeList(CODE_UIS);
const was = ok ? list.get(id) : null;
const e = {
id: ok ? id : 'ui', name: text(d.name, 40) || (ok ? id : 'UI'), kind: UI_KINDS.includes(d.kind) ? d.kind : 'box',
screen: typeof d.screen === 'string' && /^[A-Za-z0-9_:#.\-\/]{1,80}$/.test(d.screen) ? d.screen : null,
at: { from: UI_FROMS.includes(at.from) ? at.from : 'top-left', x: isNum(at.x) ? at.x : 0, y: isNum(at.y) ? at.y : 0 },
size: d.size, scale: isNum(d.scale) && d.scale > 0 ? d.scale : 1, look: uiLookOf(d.look), states,
sample: typeof d.sample === 'string' || isNum(d.sample) ? String(d.sample).slice(0, 200) : null, round: d.round === true,
canvasOf: d.canvas, units: d.units === 'canvas' ? 'canvas' : 'css',
live: was ? was.live : null,
subs: [], sig: '',
};
e.canvas = () => uiCanvas(e);
e.frame = () => uiFrame(e);
e.box = () => uiBox(e);
e.lookNow = (st) => uiLookNow(e, st);
e.atNow = () => uiAtNow(e);
e.poke = () => uiPoke(e);
e.resolve = uiResolve;
if (d.size && typeof d.size === 'object' && typeof d.size.getBounds === 'function') {
e.obj = d.size;
(globalThis[UI_OBJECTS] instanceof WeakSet ? globalThis[UI_OBJECTS] : (globalThis[UI_OBJECTS] = new WeakSet())).add(d.size);
}
if (ok) list.set(id, e);
return {
id: e.id,
box: () => {
const b = uiBox(e);
return { x: b.x, y: b.y, w: b.w, h: b.h, s: b.s };
},
look: (st) => uiLookNow(e, st),
value: (v) => {
if (e.subs.length && !e.soon) (e.soon = true), queueMicrotask(() => ((e.soon = false), uiPoke(e)));
const sm = e.live && e.live.sample;
if (typeof sm !== 'string') return v;
return e.kind === 'bar' ? (isNum(Number(sm)) && sm !== '' ? Number(sm) : 0) : sm;
},
hit: (x, y) => {
if (!isNum(x) || !isNum(y)) return false;
const b = uiBox(e);
if (e.round) {
const rx = b.w / 2, ry = b.h / 2;
return rx > 0 && ry > 0 && ((x - b.x - rx) / rx) ** 2 + ((y - b.y - ry) / ry) ** 2 <= 1;
}
return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
},
state: () => (e.live && UI_STATE_NAMES.includes(e.live.state) ? e.live.state : null),
onChange: (fn) => {
if (typeof fn !== 'function') return () => {};
e.subs.push(fn);
uiResize();
e.sig = '';
uiPoke(e);
return () => e.subs.splice(e.subs.indexOf(fn) >>> 0, 1);
},
};
}
const UI_OBJECTS = Symbol.for('game-studio.codeUiObjects');
function uiPoke(e) {
const o = e.obj && typeof e.obj.text === 'string' && e.kind !== 'bar' ? e.obj : null;
const sm = o && e.live && typeof e.live.sample === 'string' ? e.live.sample : null;
if (sm === null && o && e.textWas !== undefined) (uiText(o, e.textWas), (e.textWas = undefined));
if (!e.subs.length && !o) return false;
const b = uiBox(e), L = uiLookNow(e);
const box = { x: b.x, y: b.y, w: b.w, h: b.h, s: b.s };
const sig = [b.x, b.y, b.w, b.h, b.s].map((v) => Math.round(v * 100)).join() + JSON.stringify(L) + (sm === null ? '' : '\n' + sm);
if (sig === e.sig) return false;
e.sig = sig;
for (const fn of e.subs.slice()) {
try {
fn(box, L);
} catch (err) {
warnOnce(`codeUi('${e.id}'): onChange failed (${err && err.message})`);
}
}
if (sm !== null) {
if (e.textWas === undefined) e.textWas = o.text;
if (o.text !== sm) uiText(o, sm);
}
return true;
}
const uiText = (o, v) => (typeof o.setText === 'function' ? o.setText(v) : (o.text = v));
function uiPokeAll() {
for (const e of codeList(CODE_UIS).values()) uiPoke(e);
for (const t of themeSubs()) t.poke();
}
let resizing = false;
function uiResize() {
if (resizing || typeof addEventListener !== 'function') return;
resizing = true;
addEventListener('resize', () => setTimeout(uiPokeAll, 0));
}
const CODE_THEMES = Symbol.for('game-studio.codeThemes');
const CODE_THEME_FILE = Symbol.for('game-studio.codeThemeFile');
const CODE_THEME_SUBS = Symbol.for('game-studio.codeThemeSubs');
const THEME_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,59}$/;
const THEME_VALUE = /^[^;{}<>\\\u0000-\u001f\u007f]{1,200}$/;
const themeSubs = () => (globalThis[CODE_THEME_SUBS] instanceof Set ? globalThis[CODE_THEME_SUBS] : (globalThis[CODE_THEME_SUBS] = new Set()));
function themeNow(name) {
const e = codeList(CODE_THEMES).get(name);
const f = globalThis[CODE_THEME_FILE] instanceof Map ? globalThis[CODE_THEME_FILE].get(name) : undefined;
if (e) return e.live || f || e.v;
if (f) return f;
try {
return typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
} catch (err) {
return '';
}
}
function codeThemeFile(theme) {
const m = new Map();
if (theme && typeof theme === 'object') for (const [n, e] of Object.entries(theme)) if (/^--[A-Za-z0-9_-]{1,60}$/.test(n) && e && typeof e.v === 'string' && THEME_VALUE.test(e.v)) m.set(n, e.v);
globalThis[CODE_THEME_FILE] = m;
}
export function codeTheme(def) {
const list = codeList(CODE_THEMES);
const out = {};
const names = [];
for (const [k, raw] of Object.entries(def && typeof def === 'object' ? def : {})) {
const d = typeof raw === 'string' ? { v: raw } : raw && typeof raw === 'object' ? raw : {};
if (!THEME_KEY.test(k) || typeof d.v !== 'string' || !THEME_VALUE.test(d.v.trim())) {
warnOnce(`codeTheme: "${k}" needs a name (letters, digits, - and _) and a value v ('#ffcf6e')`);
continue;
}
const name = '--' + k;
const was = list.get(name);
const type = d.type === 'font' || d.type === 'color' ? d.type : /font|family|typeface/i.test(k) ? 'font' : 'color';
list.set(name, { name, v: d.v.trim(), label: text(d.label, 40) || null, type, live: was ? was.live : null });
names.push([k, name]);
Object.defineProperty(out, k, { enumerable: true, get: () => themeNow(name) });
}
const values = () => Object.fromEntries(names.map(([k, n]) => [k, themeNow(n)]));
out.onChange = (fn) => {
if (typeof fn !== 'function') return () => {};
const sub = { sig: '', poke: () => {
const v = values(), sig = JSON.stringify(v);
if (sig === sub.sig) return false;
sub.sig = sig;
try {
fn(v);
} catch (err) {
warnOnce(`codeTheme: onChange failed (${err && err.message})`);
}
return true;
} };
themeSubs().add(sub);
sub.poke();
return () => themeSubs().delete(sub);
};
return out;
}
function uiCanvas(e) {
let c = e.canvasOf;
if (typeof c === 'function') {
try {
c = c();
} catch (err) {
c = null;
}
}
if (c && typeof c.getBoundingClientRect === 'function') return c;
if (typeof document === 'undefined') return null;
const all = document.getElementsByTagName('canvas');
return all.length ? all[all.length - 1] : null;
}
function uiFrame(e) {
const c = uiCanvas(e);
const cw = c ? c.clientWidth || (c.getBoundingClientRect && c.getBoundingClientRect().width) || c.width || 0 : typeof innerWidth === 'number' ? innerWidth : 0;
const ch = c ? c.clientHeight || (c.getBoundingClientRect && c.getBoundingClientRect().height) || c.height || 0 : typeof innerHeight === 'number' ? innerHeight : 0;
if (e.units === 'canvas' && c && cw > 0) return { W: c.width, H: c.height, k: c.width / cw, ky: ch > 0 ? c.height / ch : c.width / cw };
return { W: cw, H: ch, k: 1, ky: 1 };
}
function uiSize(e) {
let s = e.size;
if (typeof s === 'function') {
try {
s = s();
} catch (err) {
warnOnce(`codeUi('${e.id}'): size() failed (${err && err.message})`);
s = null;
}
}
if (isNum(s)) return [Math.max(0, s), Math.max(0, s)];
if (s && typeof s === 'object' && !Array.isArray(s)) {
let r = null;
try {
r = typeof s.getBounds === 'function' ? s.getBounds() : s;
} catch (err) {
warnOnce(`codeUi('${e.id}'): getBounds() failed (${err && err.message})`);
}
const sc = (a, b) => Math.abs(isNum(a) ? a : isNum(b) ? b : 1) || 1;
const sx = s.getBounds ? sc(s.scaleX, s.scale && s.scale.x) : 1, sy = s.getBounds ? sc(s.scaleY, s.scale && s.scale.y) : 1;
return r && isNum(r.width) && isNum(r.height) ? [Math.max(0, r.width / sx), Math.max(0, r.height / sy)] : [0, 0];
}
return Array.isArray(s) && s.length >= 2 && isNum(s[0]) && isNum(s[1]) ? [Math.max(0, s[0]), Math.max(0, s[1])] : [0, 0];
}
function uiBox(e) {
const { W, H, k, ky } = uiFrame(e);
const [w0, h0] = uiSize(e);
const wc = w0 * e.scale, hc = h0 * e.scale;
const f = codeUiFileOf(e.id);
const live = e.live;
let cx, cy, p0;
if (f && f.from) {
const [bx, by] = uiBoxAt(f.from, f.at[0], f.at[1], wc * f.s, hc * f.s, W, H);
cx = bx + (wc * f.s) / 2;
cy = by + (hc * f.s) / 2;
p0 = f.p;
} else {
const [bx, by] = uiBoxAt(e.at.from, e.at.x, e.at.y, wc, hc, W, H);
cx = bx + wc / 2;
cy = by + hc / 2;
p0 = [0, 0];
if (f && !live) (cx += f.p[0] * k), (cy += f.p[1] * ky);
}
if (live && Array.isArray(live.p)) (cx += (live.p[0] - p0[0]) * k), (cy += (live.p[1] - p0[1]) * ky);
const s = live && isNum(live.s) ? live.s : f ? f.s : 1;
const w = wc * s, h = hc * s;
return { x: cx - w / 2, y: cy - h / 2, w, h, s: e.scale * s, W, H, k, ky };
}
function uiAtNow(e) {
const b = uiBox(e);
const from = uiNearest(b.x, b.y, b.w, b.h, b.W, b.H);
const at = uiAtOf(from, b.x, b.y, b.w, b.h, b.W, b.H);
return { from, at: at.map((v) => Math.round(v * 10) / 10), scale: Math.round(b.s * 1000) / 1000 };
}
function uiLookNow(e, st) {
const out = Object.assign({}, e.look);
const f = codeUiFileOf(e.id);
const set = e.live && e.live.set ? e.live.set : f && f.set ? f.set : null;
if (set) Object.assign(out, uiLookOf(set));
const s = st === undefined ? (e.live && UI_STATE_NAMES.includes(e.live.state) ? e.live.state : null) : UI_STATE_NAMES.includes(st) ? st : null;
if (s) {
if (e.states[s]) Object.assign(out, e.states[s]);
if (set && set['@' + s]) {
const o = uiLookOf(set['@' + s]);
for (const k of ['color', 'background']) if (o[k]) out[k] = o[k];
}
}
for (const k of ['color', 'background']) if (out[k]) out[k] = uiResolve(out[k]);
return out;
}
function applyUi(doc, ui) {
const out = { applied: [], missing: [] };
const put = (el) => {
const k = el.dataset.studioKey, e = Object.hasOwn(ui, k) && ui[k];
if (!e || e.code || !Array.isArray(e.p) || e.p.length !== 2 || !e.p.every(isNum) || (e.s !== undefined && !isNum(e.s))) return;
if (placeUi(el, e.p, e.s === undefined ? 1 : e.s) && !out.applied.includes(k)) out.applied.push(k);
if (sheet && e.set && typeof e.set === 'object') setUi(el, k, e.set, sheet);
};
const sheet = Object.values(ui).some((e) => e && e.set) ? uiSheet(doc, ui) : null;
doc.querySelectorAll('[data-studio-key]').forEach(put);
for (const k of Object.keys(ui)) if (!out.applied.includes(k) && !(ui[k] && ui[k].code)) out.missing.push(k);
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
function applyTheme(doc, theme) {
for (const [name, e] of Object.entries(theme)) {
if (/^--[A-Za-z0-9_-]{1,60}$/.test(name) && e && typeof e.v === 'string' && !/[;{}<>]/.test(e.v)) doc.documentElement.style.setProperty(name, e.v);
}
}
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
function cssColor(el, c) {
const probe = el.ownerDocument.createElement('i');
probe.style.color = c;
probe.style.display = 'none';
el.ownerDocument.documentElement.appendChild(probe);
const v = getComputedStyle(probe).color;
probe.remove();
return v;
}
function keepSpace(old, text) {
const m = /^(\s*)[\s\S]*?(\s*)$/.exec(old);
return (m ? m[1] : '') + text + (m ? m[2] : '');
}
function ownText(el) {
return Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.data.trim());
}
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
export function uiTextNode(part) {
return ownText(part)[0] || null;
}
const UI_STATE = Symbol.for('game-studio.ui');
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
export function uiOffset(el) {
const st = el[UI_STATE];
return st ? { p: st.p.slice(), s: st.v } : { p: [0, 0], s: 1 };
}
function cssParts(v) {
return !v || v === 'none' ? null : v.match(/(?:[^\s(]|\([^)]*\))+/g);
}
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
export function findByKey(root, key, three = !!(root && root.isObject3D)) {
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
const m = /^(.*)#(\d+)$/.exec(key);
const name = m ? m[1] : key;
let want = m ? Number(m[2]) : 1;
walk(root, (o) => {
if (found) return false;
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
