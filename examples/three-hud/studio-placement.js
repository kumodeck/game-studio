// KUMODeck Game Studio placement loader (MIT). Applies placement.json to a three.js Scene or PixiJS stage.
const KEY_CHARS = /[^A-Za-z0-9_:#.\-\/]/g;
const cleanName = (s) => (typeof s === 'string' && s ? s.replace(KEY_CHARS, '_').slice(0, 80) : '');
export async function applyPlacement(root, source = './placement.json') {
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
if (report.missing.length) warn(report.missing.length + ' key(s) not found, ignored: ' + report.missing.slice(0, 10).join(', '));
if (report.skipped.length) warn(report.skipped.length + ' entr(ies) with bad values, ignored: ' + report.skipped.slice(0, 10).join(', '));
return report;
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
