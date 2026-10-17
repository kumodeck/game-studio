// Apply a saved placement.json to a PixiJS v8 stage (the "loader" route).
//
// What an AI agent adds to a Pixi game when the user keeps the numbers in
// placement.json instead of rewriting the literal positions in the code.
// Call it once after the scene is built, before the game starts moving things.
//
// Keys are rebuilt with the same rules as the studio's Pixi adapter
// (.studio/adapter.js): `studioKey` -> `label` -> tree path (path:0/3/1),
// repeats numbered #2, #3 in tree order. Unknown keys and broken values are
// skipped with one warning, so a stale file never breaks the game.
//
// `order` (optional) holds draw orders the person changed in the studio: per
// parent, the keys back -> front. Pixi draws a container's children in array
// order, so the loader puts those children back in that order.

/** Fetch ./placement.json; null when there is none (normal for a fresh game). */
export async function loadPlacement(url = './placement.json') {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const clean = (s) => String(s).replace(/[^A-Za-z0-9_:#.\-\/]/g, '_').slice(0, 80);
// Pixi v8 sets `label` to the class name when none is given: not a real name.
const DEFAULT_LABELS = new Set(['Sprite', 'Graphics', 'Mesh', 'TilingSprite', 'NineSliceSprite',
  'ParticleContainer', 'RenderContainer', 'DOMContainer', 'Text', 'BitmapText', 'HTMLText', 'AnimatedSprite', 'Container']);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** @returns {{ applied: string[], missing: string[] }} */
export function applyPlacement(stage, file) {
  const report = { applied: [], missing: [] };
  if (!file || file.tool !== 'placement' || file.dim !== '2d' || !file.objects) return report;
  const byKey = new Map();
  const seen = new Map();
  const walk = (c, path) => c.children.forEach((o, i) => {
    if (o.studio === false) return;
    const p = path.concat(i);
    const own = o.studioKey || (o.label && !DEFAULT_LABELS.has(o.label) ? o.label : '');
    let key;
    if (own) {
      key = clean(own);
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      if (n > 1) key = `${key.slice(0, 76)}#${n}`;
    } else key = `path:${p.join('/')}`;
    byKey.set(key, o);
    if (o.children && o.children.length) walk(o, p);
  });
  walk(stage, []);
  for (const [key, e] of Object.entries(file.objects)) {
    const o = byKey.get(key);
    if (!o || !Array.isArray(e.p) || !num(e.p[0]) || !num(e.p[1])) { report.missing.push(key); continue; }
    o.position.set(e.p[0], e.p[1]);
    if (num(e.r)) o.rotation = e.r;
    if (num(e.s)) o.scale.set(e.s);
    else if (Array.isArray(e.s) && num(e.s[0]) && num(e.s[1])) o.scale.set(e.s[0], e.s[1]);
    report.applied.push(key);
  }
  applyOrder(byKey, file.order, report);
  if (report.missing.length) console.warn(`placement.json: ${report.missing.length} unknown key(s) skipped:`, report.missing.join(', '));
  return report;
}

/**
 * Draw order (layers): for each list, put the named children in the order
 * back -> front, in the places those children already take (other children,
 * such as a background, stay where they are).
 */
function applyOrder(byKey, order, report) {
  if (!Array.isArray(order) || !order.length) return;
  // Keys made from the tree position (path:…) or a repeat number (tree#2)
  // change when children are reordered. Stamp them on the objects first, so
  // the studio still finds every object under the same key afterwards.
  for (const [key, o] of byKey) if ((key.startsWith('path:') || key.includes('#')) && !o.studioKey) o.studioKey = key;
  for (const g of order) {
    if (!g || !Array.isArray(g.keys)) continue;
    const objs = g.keys.map((k) => byKey.get(k)).filter(Boolean);
    const parent = objs[0] && objs[0].parent;
    const mine = objs.filter((o) => o.parent === parent);
    if (!parent || mine.length < 2) continue;
    const slots = mine.map((o) => parent.getChildIndex(o)).sort((a, b) => a - b);
    for (const o of mine) parent.removeChild(o);
    mine.forEach((o, i) => parent.addChildAt(o, slots[i]));
    report.applied.push(`order:${g.in}`);
  }
}
