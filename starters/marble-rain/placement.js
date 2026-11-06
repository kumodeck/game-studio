// Apply a saved placement.json to a Phaser scene (the "loader" route).
//
// This is the small piece an AI agent adds to a Phaser game when the user
// chooses "keep the numbers in placement.json" instead of rewriting the
// literal positions in the code. Call it at the END of the scene's create(),
// after every object exists and before the first update.
//
// Keys are rebuilt with the same rules as the studio's Phaser adapter
// (.studio/adapter.js): `studioKey` marker -> `name` -> tree path, repeats
// numbered #2, #3 in tree order. Unknown keys and broken values are skipped
// with one warning, so a stale file never breaks the game.

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
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** @returns {{ applied: string[], missing: string[] }} */
export function applyPlacement(scene, file) {
  const report = { applied: [], missing: [] };
  if (!file || file.tool !== 'placement' || file.dim !== '2d' || !file.objects) return report;
  const byKey = new Map();
  const seen = new Map();
  const walk = (list, path) => list.forEach((o, i) => {
    const studioOff = o.studio === false || (o.data && o.getData('studio') === false);
    if (studioOff) return;
    const p = path.concat(i);
    const own = o.studioKey ?? (o.data ? o.getData('studioKey') : undefined) ?? o.name;
    let key;
    if (own) {
      key = clean(own);
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      if (n > 1) key = `${key.slice(0, 76)}#${n}`;
    } else key = `path:${clean(scene.sys.settings.key)}/${p.join('/')}`;
    byKey.set(key, o);
    if (Array.isArray(o.list)) walk(o.list, p);
  });
  walk(scene.children.list, []);
  for (const [key, e] of Object.entries(file.objects)) {
    const o = byKey.get(key);
    if (!o || !Array.isArray(e.p) || !num(e.p[0]) || !num(e.p[1])) { report.missing.push(key); continue; }
    o.setPosition(e.p[0], e.p[1]);
    if (num(e.r)) o.setRotation(e.r);
    if (num(e.s)) o.setScale(e.s);
    else if (Array.isArray(e.s) && num(e.s[0]) && num(e.s[1])) o.setScale(e.s[0], e.s[1]);
    if (o.body) (o.body.physicsType === 1 && o.refreshBody) ? o.refreshBody() : o.body.reset?.(o.x, o.y);
    report.applied.push(key);
  }
  if (report.missing.length) console.warn(`placement.json: ${report.missing.length} unknown key(s) skipped:`, report.missing.join(', '));
  return report;
}
