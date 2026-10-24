// KUMODeck Game Studio placement loader (MIT). Applies placement.json to a three.js Scene or PixiJS stage.
const KEY_CHARS = /[^A-Za-z0-9_:#.\-\/]/g;
const cleanName = (s) => (typeof s === 'string' && s ? s.replace(KEY_CHARS, '_').slice(0, 80) : '');
export async function applyPlacement(root, source = './placement.json', opts = {}) {
const report = { applied: [], missing: [], unstable: [], skipped: [] };
const three = !!(root && root.isObject3D);
if (root && typeof root === 'object' && root.nodeType !== 9) last = { root, n: three ? 3 : 2, three };
let data = source;
if (typeof source === 'string') {
try {
const res = await fetch(source, { cache: 'no-cache' });
if (!res.ok) return report;
data = await res.json();
} catch (e) {
warn('could not read ' + source + ' (' + e.message + ')');
return report;
}
}
const dim = three ? '3d' : '2d';
if (!data || data.tool !== 'placement' || !data.objects || typeof data.objects !== 'object') {
warn('not a placement file');
return report;
}
if (data.theme && typeof data.theme === 'object' && typeof document !== 'undefined') applyTheme(document, data.theme);
if (data.ui && typeof data.ui === 'object' && typeof document !== 'undefined') report.ui = applyUi(document, data.ui);
if (root && root.nodeType === 9) return report;
if (data.dim !== dim) {
warn('the file is for ' + data.dim + ' but the root is a ' + (three ? 'three.js' : 'PixiJS') + ' object');
return report;
}
if (Array.isArray(data.levels)) {
const level = (opts && opts.level) || levelOfCodeless(data);
if (!level) {
warn('this file has levels: pass { level } to applyPlacement');
return report;
}
data = placementForLevel(data, level);
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
const m = (Array.isArray(lib) ? lib : []).find((x) => x && x.name === c.use && typeof (x.tracks || x.keys) === 'object');
const tr = m && m.tracks;
return m ? { name: typeof c.name === 'string' ? c.name : c.use, use: c.use, len: m.len, repeat: m.repeat, keys: tr ? tr[key] || {} : m.keys, when: whenOf(c), whens: whensOf(c), until: c.until, scene: !!tr } : null;
}
return typeof c.name === 'string' && c.keys && typeof c.keys === 'object' ? { ...c, when: whenOf(c), whens: whensOf(c) } : null;
}
export function motionRunner(objs) {
const list = (Array.isArray(objs) ? objs : []).filter((x) => x && Array.isArray(x.clips));
const movers = new Map();
const held = new Map();
let t0 = null;
const timed = new Set();
const inside = new Map();
const ok = (v) => typeof v === 'number' && isFinite(v);
const round = (c) => (ok(c.len) && c.len > 0 ? c.len : 1) * (c.repeat === 'pingpong' ? 2 : 1);
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
const clips = Array.isArray(m.clips) ? m.clips.map((c) => resolveClip(c, library, key)).filter(Boolean) : [];
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
for (const k of ['added', 'removed', 'order', 'motion', 'names']) if (l[k]) out[k] = l[k];
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
if (sheet && e.set && typeof e.set === 'object') setUi(el, k, e.set, sheet);
};
const sheet = Object.values(ui).some((e) => e && e.set) ? uiSheet(doc, ui) : null;
doc.querySelectorAll('[data-studio-key]').forEach(put);
for (const k of Object.keys(ui)) if (!out.applied.includes(k)) out.missing.push(k);
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
