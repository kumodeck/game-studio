// KUMODeck Game Studio placement loader (MIT). Applies placement.json to a three.js Scene or PixiJS stage.
const KEY_CHARS = /[^A-Za-z0-9_:#.\-\/]/g;
const cleanName = (s) => (typeof s === 'string' && s ? s.replace(KEY_CHARS, '_').slice(0, 80) : '');
export async function applyPlacement(root, source = './placement.json', opts = {}) {
const report = { applied: [], missing: [], unstable: [], skipped: [] };
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
const three = !!(root && root.isObject3D);
const dim = three ? '3d' : '2d';
if (!data || data.tool !== 'placement' || !data.objects || typeof data.objects !== 'object') {
warn('not a placement file');
return report;
}
if (data.ui && typeof data.ui === 'object' && typeof document !== 'undefined') report.ui = applyUi(document, data.ui);
if (root && root.nodeType === 9) return report;
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
if (data.motion && typeof data.motion === 'object') runMotion(root, data.motion, n, three, report);
if (report.missing.length) warn(report.missing.length + ' key(s) not found, ignored: ' + report.missing.slice(0, 10).join(', '));
if (report.skipped.length) warn(report.skipped.length + ' entr(ies) with bad values, ignored: ' + report.skipped.slice(0, 10).join(', '));
return report;
}
const MOVING = Symbol.for('game-studio.motion');
const known = new Map();
const movers = new Map();
let ticking = false;
export function stopMotion(key) {
if (key === undefined) {
movers.clear();
if (globalThis[MOVING]) globalThis[MOVING].clear();
} else movers.delete(key);
}
export function playMotion(key, name) {
const k = known.get(key);
const clip = k && k.clips.find((c) => c && c.name === name);
if (!clip || editing()) return false;
start(key, { clip });
return true;
}
export function clipOf(key, name) {
const k = known.get(key);
return (k && k.clips.find((c) => c && c.name === name)) || null;
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
if (!smooth || ks.length < 3) return a.v.map((v, k) => v + (b.v[k] - v) * f);
const p0 = i > 0 && (ks[i - 1].ease || 'ease') !== 'step' ? ks[i - 1].v : a.v;
const p3 = i + 2 < ks.length && (b.ease || 'ease') !== 'step' ? ks[i + 2].v : b.v;
const f2 = f * f, f3 = f2 * f;
return a.v.map((v, k) => 0.5 * (2 * v + (b.v[k] - p0[k]) * f + (2 * p0[k] - 5 * v + 4 * b.v[k] - p3[k]) * f2 + (3 * v - p0[k] - 3 * b.v[k] + p3[k]) * f3));
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
const editing = () => typeof location !== 'undefined' && /[?&]studio=edit(&|$)/.test(location.search);
function start(key, what) {
movers.set(key, { ...what, t0: performance.now() });
if (ticking || typeof requestAnimationFrame !== 'function') return;
ticking = true;
const tick = (now) => {
if (!movers.size) return void (ticking = false);
for (const [key, r] of movers) {
const k = known.get(key);
if (!k || k.o.parent === null) {
movers.delete(key);
continue;
}
const t = Math.max(0, (now - r.t0) / 1000);
poseAt(k.o, k.base, r.clip ? clipAt(r.clip, t) : legacyAt(r.legacy, t, k.three ? 3 : 2), k.three);
}
requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
}
function runMotion(root, motion, n, three, report) {
if (editing()) return;
const list = [];
for (const key of Object.keys(motion)) {
const m = motion[key], o = findByKey(root, key, three);
if (!o || !m || typeof m !== 'object') continue;
const clips = Array.isArray(m.clips) ? m.clips.filter((c) => c && typeof c === 'object' && typeof c.name === 'string' && c.keys && typeof c.keys === 'object') : [];
const legacy = !clips.length && (isNum(m.spin) || (Array.isArray(m.path) && m.path.length && m.path.every((q) => Array.isArray(q) && q.length === n && q.every(isNum))));
if (!clips.length && !legacy) continue;
const base = three
? { p: [o.position.x, o.position.y, o.position.z], r: [o.rotation.x, o.rotation.y, o.rotation.z], s: [o.scale.x, o.scale.y, o.scale.z] }
: { p: [o.position.x, o.position.y], r: [o.rotation], s: [o.scale.x, o.scale.y] };
known.set(key, { o, three, base, clips });
(globalThis[MOVING] || (globalThis[MOVING] = new Set())).add(key);
list.push(key);
const first = clips.find((c) => c.start === true);
if (legacy) start(key, { legacy: m });
else if (first) start(key, { clip: first });
}
if (list.length) report.motion = list;
}
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
