// The timeline's second stage (studio-timeline-2, 2026-10-22), in a headless browser on Lantern Cove (3D, a copy of the
// starter). The checks (PC light), with a real mouse in the game page:
//   1. a point of the boat's path picked on the plate: its two handles show in the game;
//   2. a handle dragged: the path bends (the other handle lines up), one undo step; the head's Point ▾ says "Bent by hand";
//   3. the line hovered: a "+" follows it; clicked: a key at that moment (4 keys), the time line there, the new point picked;
//   4. Point ▾ → Corner: the point is a diamond; a double-click on it: smooth again;
//   5. "+ or": a second way to start (a click), its Try ▶; changed to "enters an area": the box, a corner dragged = its size;
//   6. New: Scene — "+ Link an object" → the crate (studio-motion-focus: the way in; it was "+ Add crate to …" on the
//      crate's own row); K keys it;
//   7. Save: handles, a `when` list and the scene's `tracks` in placement.json, and the schema takes it;
//   8. no page errors.
// And pictures (`--shots <dir> --no-checks`): PC 1280×800, the side window 400×900, a phone 390×844 × light and dark —
// `1-handles` (a bent point picked: its handles, the "+" on the line on PC), `2-when` ("E or enters an area": the box
// with its corners, the second row), `3-scene` (a scene of three objects: the boat picked, the buoy and the barrel linked).
//
//   node test/studio-timeline-2.browser.mjs [--shots <dir>] [--only pc,side,phone] [--themes light,dark] [--lang en|ja] [--no-checks]
// Exit 1 on a failure.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const LANG = take('--lang', 'en');
const ONLY = take('--only', 'pc,side,phone').split(',');
const THEMES = take('--themes', 'light,dark').split(',');
const CHECKS = !args.includes('--no-checks');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'side', width: 400, height: 900 },
  { id: 'phone', width: 390, height: 844, mobile: true },
].filter((s) => ONLY.includes(s.id));

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const TL = `window.__studioTimeline`;
const choose = (part, value, i) => `(() => { const s = document.querySelector('[data-part=${part}]${i ? `[data-i="${i}"]` : ''}'); if (!s) return false; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
/** The centre of an element of the game page's timeline layer (its shadow root), in the editor page's px. */
const IN = (sel) => `(() => { const f = document.querySelector('iframe.game, iframe'); const h = f.contentDocument.querySelector('[data-studio-timeline]');
  const e = h && h.shadowRoot.querySelector(${JSON.stringify(sel)}); if (!e) return null; const o = f.getBoundingClientRect(); const r = e.getBoundingClientRect();
  return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`;
/** A point `f` (0–1) along the path's line, in the editor page's px. */
const ALONG = (f) => `(() => { const fr = document.querySelector('iframe.game, iframe'); const h = fr.contentDocument.querySelector('[data-studio-timeline]');
  const e = h && h.shadowRoot.querySelector('[data-line]'); if (!e) return null; const p = e.getPointAtLength(e.getTotalLength() * ${f}); const o = fr.getBoundingClientRect();
  return JSON.stringify({ x: o.left + p.x, y: o.top + p.y }); })()`;
const PLATE = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`;
const UNDO = `(document.querySelector('[data-action=undo]') || {}).title || ''`;

const row = { name: 'Row', len: 3, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 1.2, -1.5] }, { t: 3, v: [-5, 0, 0] }] } };
// The checks start from the boat rowing at the start (and the buoy's Bob), nothing of the second stage yet.
const CHECK_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [row, { name: 'Bob', len: 2, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 0.4, 0] }] } }],
  motion: { rowboat: { clips: [{ use: 'Row', when: { on: 'start' } }] }, buoy: { clips: [{ use: 'Bob', when: { on: 'start' } }] } } };
// The pictures: the boat's 1.5 s point bent by hand, starting on E or the pier's area; a scene of three objects.
const SHOT_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    { ...row, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 1.2, -1.5], in: [1.4, -0.2, 1.1], out: [-1.6, 0.3, -0.4] }, { t: 3, v: [-5, 0, 0] }] } },
    { name: 'Arrival', len: 4, tracks: {
      rowboat: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 0.6, -1.5] }, { t: 3, v: [-5, 0, 0] }] },
      buoy: { p: [{ t: 0.5, v: [0, 0, 0] }, { t: 1.2, v: [0, -0.5, 0] }, { t: 2, v: [0, 0, 0] }] },
      barrel: { r: [{ t: 1.5, v: [0, 0, 0] }, { t: 2.5, v: [0, 0, 6.2832] }], p: [{ t: 1.5, v: [0, 0, 0] }, { t: 2.5, v: [1.5, 0, 0] }] } } },
  ],
  motion: {
    rowboat: { clips: [{ use: 'Row', when: [{ on: 'key', key: 'KeyE' }, { on: 'enter', area: { p: [3.5, 0.5, 4.5], size: [4, 2, 3] }, who: 'player' }] }, { use: 'Arrival', when: { on: 'cue', cue: 'boat-arrives' } }] },
    buoy: { clips: [{ use: 'Arrival', when: { on: 'cue', cue: 'boat-arrives' } }] },
    barrel: { clips: [{ use: 'Arrival', when: { on: 'cue', cue: 'boat-arrives' } }] },
  } };

async function run(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-timeline-2-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  // The first-time steps (studio-motion-flow) closed already: this test is about the second stage.
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps'] }));
  const full = CHECKS && size.id === 'pc' && theme === THEMES[0];
  writeFileSync(join(root, 'placement.json'), JSON.stringify(full ? CHECK_FILE : SHOT_FILE, null, 2));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const shot = async (page, what) => SHOTS && writeFileSync(join(SHOTS, `after-${size.id}-${theme}-${what}.png`), await page.screenshot());
  console.log(`${size.id} ${theme}${full ? ' (checks)' : ''}`);
  try {
    const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const state = () => j(`JSON.stringify(${TL}.state())`);
    const motion = (k) => j(`JSON.stringify(${TL}.motionOf(${JSON.stringify(k)}))`);
    const fine = async (open) => size.id !== 'pc' && page.eval(`(() => { const d = document.querySelector('[data-part=card] details.fine'); if (d) d.open = ${open}; return true; })()`);
    const openTimeline = async (key) => {
      await page.eval(`studioShell.actions.select(${JSON.stringify(key)})`);
      await sleep(900);
      await fine(true);
      await sleep(300);
      if (!(await state()).open) await page.eval(`document.querySelector('[data-part=card] [data-part=motion-timeline]').click()`);
      await sleep(600);
      await fine(false);
      await sleep(400);
    };
    /** Press the plate's diamond of `key` at `t` (a real click: the plate picks it). */
    const pickKey = async (key, t) => {
      const at = await j(PLATE(`[data-part=tl-key][data-key="${key}"][data-ch=""][data-t="${t}"]`));
      if (at) await page.click(at.x, at.y);
      await sleep(400);
      return !!at;
    };
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(2500);
    if (full) {
      // 1. A point picked: its handles.
      await openTimeline('rowboat');
      await page.eval(`${TL}.setTime(1.5)`);
      await sleep(500);
      check(await pickKey('rowboat', 1.5), 'the boat\'s 1.5 s key on the plate');
      const hOut = await j(IN('[data-handle="1:out"]'));
      const hIn = await j(IN('[data-handle="1:in"]'));
      check(!!hOut && !!hIn, 'its two handles show in the game');
      // 2. A handle dragged: the path bends, the other side lines up; one undo step; Point ▾ says "Bent by hand".
      if (hOut) await page.mouseDrag(hOut.x, hOut.y, hOut.x + 70, hOut.y - 30, 8);
      await sleep(700);
      let k1 = (await motion('rowboat'))?.clips?.[0]?.keys?.p?.[1];
      const lined = k1?.in && k1?.out && Math.abs(Math.atan2(k1.in[2], k1.in[0]) - Math.atan2(-k1.out[2], -k1.out[0])) < 0.05;
      check(!!k1?.out && lined, `the handle bent the path, the other one lined up (${JSON.stringify(k1 && { in: k1.in, out: k1.out })})`);
      check(/motion|動き/i.test(await page.eval(UNDO)), `one undo step ("${(await page.eval(UNDO)).split('\n')[0]}")`);
      check((await page.eval(`(document.querySelector('[data-part=tl-point]') || {}).value`)) === 'custom', 'Point ▾: Bent by hand');
      // 3. The line: a "+" under the mouse, a click = a key there.
      const mid = await j(ALONG(0.2));
      if (mid) await page.click(mid.x, mid.y);
      await sleep(600);
      const t0 = (await motion('rowboat'))?.clips?.[0]?.keys?.p?.length;
      check(t0 === 4, `a click on the line put a key there (${t0} keys)`);
      const st = await state();
      check(st.sel.length === 1 && st.sel[0].ch === 'p' && Math.abs(st.time - st.sel[0].t) < 1e-6 && st.time > 0 && st.time < 1.5, `the time line and the pick on the new key (${st.time}, ${JSON.stringify(st.sel)})`);
      // Hover alone (no click): the "+" with its time.
      const mid2 = await j(ALONG(0.75));
      if (mid2) await page.eval(`(() => { const f = document.querySelector('iframe.game, iframe'); const w = f.contentWindow; const o = f.getBoundingClientRect();
        const hit = f.contentDocument.querySelector('[data-studio-timeline]').shadowRoot.querySelector('[data-line]');
        hit.dispatchEvent(new w.PointerEvent('pointermove', { clientX: ${mid2.x} - o.left, clientY: ${mid2.y} - o.top, bubbles: true, composed: true, pointerId: 1, pointerType: 'mouse' })); return true; })()`);
      await sleep(400);
      const plus = await page.eval(`(() => { const h = document.querySelector('iframe.game, iframe').contentDocument.querySelector('[data-studio-timeline]'); return [...h.shadowRoot.querySelectorAll('text')].map((t) => t.textContent).find((x) => /^\\+ \\d/.test(x)) || ''; })()`);
      check(!!plus, `hovering the line shows "${plus}"`);
      // 4. Point ▾ → Corner on the 1.5 s point; then a double-click on it: smooth.
      await pickKey('rowboat', 1.5);
      await page.eval(choose('tl-point', 'corner'));
      await sleep(500);
      const idx = ((await motion('rowboat'))?.clips?.[0]?.keys?.p ?? []).findIndex((k) => Math.abs(k.t - 1.5) < 1e-6);
      k1 = (await motion('rowboat'))?.clips?.[0]?.keys?.p?.[idx];
      check(!!k1 && JSON.stringify(k1.in) === '[0,0,0]' && JSON.stringify(k1.out) === '[0,0,0]', `Point ▾ Corner (${JSON.stringify(k1)})`);
      check(!!(await j(IN(`[data-corner-point="${idx}"]`))), 'the corner is drawn as a diamond');
      const dot = await j(IN(`[data-point="${idx}"]`));
      if (dot) {
        await page.click(dot.x, dot.y);
        await sleep(120);
        await page.click(dot.x, dot.y);
      }
      await sleep(600);
      k1 = (await motion('rowboat'))?.clips?.[0]?.keys?.p?.[idx];
      check(!!k1 && !k1.in && !k1.out, 'a double-click on the point: smooth again');
      // …and a corner again for the file.
      if (dot) {
        await page.click(dot.x, dot.y);
        await sleep(120);
        await page.click(dot.x, dot.y);
      }
      await sleep(500);
      // 5. "+ or": a click as well; then an area as the second, its corner dragged.
      // "+ or" and the other ways are in the strip's ⋯ since studio-motion-panel; the line says "+1 more".
      await page.eval(`document.querySelector('[data-part=tl-more]') || document.querySelector('[data-part=tl-more-btn]').click()`);
      await sleep(300);
      await page.eval(`document.querySelector('[data-part=tl-or-add]').click()`);
      await sleep(600);
      let w = (await motion('rowboat'))?.clips?.[0]?.when;
      check(Array.isArray(w) && w.length === 2 && w[1].on === 'click', `"+ or": ${JSON.stringify(w)}`);
      check((await state()).cues.includes('click:rowboat'), 'Try gains ▶ Click');
      // studio-ui-lead (2026-10-23): the line says "+1 more" (the row's chip shows only with every motion shown).
      const chip = await page.eval(`document.querySelector('[data-part=tl-or-more]')?.textContent || ''`);
      check(/1/.test(chip), `the line says there is another way ("${chip}")`);
      await page.eval(choose('tl-starts-or', 'enter', 1));
      await sleep(800);
      check(!!(await page.eval(`(document.querySelector('[data-part=tl-or-more]') || {}).textContent || ''`)), 'the line says there is another way (+1)');
      // ⋯ closed again: its panel sits over the game, where the area's corners are pressed below.
      await page.eval(`document.querySelector('[data-part=tl-more-btn].on')?.click()`);
      await sleep(200);
      // A corner the mouse can reach (one under the ask bar or the plate is not in the game's frame).
      // The area starts at the boat, low on the screen (under the ask bar): put it farther out on the water first (the
      // same message its middle point sends when dragged), until a corner is in the open.
      let corner = null;
      const at0 = ((await motion('rowboat'))?.clips?.[0]?.when ?? [])[1]?.area?.p ?? [0, 0, 0];
      for (const d of [[0, 0, 0], [-6, 0, -6], [0, 0, -10], [-10, 0, 0], [-8, 0, -14], [6, 0, -10]]) {
        await page.eval(`${TL}.onMessage({ type: 'studio:timeline/area-moved', key: 'rowboat', p: ${JSON.stringify(at0.map((v, i) => v + d[i]))}, end: true })`);
        await sleep(400);
        for (const ci of [0, 1, 2, 3]) {
          const c = await j(IN(`[data-part=tl-area-corner][data-corner="${ci}"]`));
          if (c && (await page.eval(`document.elementFromPoint(${c.x}, ${c.y})?.tagName === 'IFRAME'`))) corner = c;
          if (corner) break;
        }
        if (corner) break;
      }
      check(!!corner, 'the area\'s corners show');
      const before = ((await motion('rowboat'))?.clips?.[0]?.when ?? [])[1]?.area;
      if (corner) await page.mouseDrag(corner.x, corner.y, corner.x + 60, corner.y + 10, 8);
      await sleep(700);
      const after = ((await motion('rowboat'))?.clips?.[0]?.when ?? [])[1]?.area;
      check(!!before && !!after && JSON.stringify(before.size) !== JSON.stringify(after.size), `a corner dragged: the size ${JSON.stringify(before?.size)} → ${JSON.stringify(after?.size)}`);
      check(/motion|動き/i.test(await page.eval(UNDO)), 'one undo step');
      // 6. A scene: New → Scene; the crate joins; K keys it.
      await page.eval(`document.querySelector('[data-part=tl-more]') || document.querySelector('[data-part=tl-more-btn]').click()`);
      await sleep(300);
      await page.eval(choose('tl-clip', 'new:scene'));
      await sleep(700);
      const sceneChip = await page.eval(`(document.querySelector('[data-part=tl-scene]') || {}).textContent || ''`);
      // A scene of one says nothing yet (studio-motion-focus: "Linked · n" from two on).
      check(!sceneChip, `a scene of one: no "Linked" yet ("${sceneChip}")`);
      const sceneName = (await state()).clip;
      await page.eval(`${TL}.setTime(1)`);
      await page.eval(`${TL}.onKey({ key: 'k', ctrl: false, meta: false, shift: false })`);
      await sleep(300);
      await page.eval(`document.querySelector('[data-part=tl-link]').click()`);
      await sleep(500);
      const linkItem = await page.eval(`!!document.querySelector('[data-part=tl-link-item][data-key=crate]')`);
      check(linkItem, '"+ Link an object" lists the crate');
      await page.eval(`document.querySelector('[data-part=tl-link-item][data-key=crate]').click()`);
      await sleep(500);
      await page.eval(`studioShell.actions.select('crate')`);
      await sleep(800);
      await page.eval(`${TL}.onKey({ key: 'k', ctrl: false, meta: false, shift: false })`);
      await sleep(500);
      const sc = await page.eval(`(document.querySelector('[data-part=tl-scene]') || {}).textContent || ''`);
      check(/2/.test(sc), `the scene has 2 objects ("${sc}")`);
      // 7. Save.
      await page.eval(`studioShell.actions.save()`);
      await sleep(1500);
      const f = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      const rowM = f.motions?.find((m) => m.name === 'Row');
      check(rowM?.keys?.p?.length === 4 && rowM.keys.p.some((k) => JSON.stringify(k.in) === '[0,0,0]') && rowM.keys.p.some((k) => k.out && JSON.stringify(k.out) !== '[0,0,0]'), `Row has its corner and a bent point: ${JSON.stringify(rowM?.keys?.p)?.slice(0, 200)}`);
      const scM = f.motions?.find((m) => m.name === sceneName);
      check(!!scM?.tracks && Object.keys(scM.tracks).sort().join() === 'crate,rowboat' && !scM.keys, `the scene "${sceneName}": tracks ${Object.keys(scM?.tracks ?? {}).join(', ')}`);
      const rw = f.motion?.rowboat?.clips?.find((c) => c.use === 'Row');
      check(Array.isArray(rw?.when) && rw.when[1]?.on === 'enter', `the boat's Row starts on ${JSON.stringify(rw?.when)?.slice(0, 120)}`);
      check(f.motion?.crate?.clips?.[0]?.use === sceneName, 'the crate is attached to the scene');
      const v = validateStudioFile(f, { tool: 'placement' });
      check(v.ok, `the schema takes the file${v.ok ? '' : ': ' + v.errors.join('; ')}`);
    } else {
      // Pictures. 1: the bent point picked (its handles). (The "+" on the line is checked, not pictured: at the opening
      // camera the line's free part is under the ask bar.)
      await openTimeline('rowboat');
      // Narrow: the plate is taller than when it opened (the second row's "or"): open it again, so the boat is brought
      // into what is left of the game above it (setOpen's focus, with the new inset).
      if (size.id !== 'pc') {
        await page.eval(`${TL}.setOpen(false)`);
        await sleep(500);
        await page.eval(`${TL}.setOpen(true)`);
        await sleep(1500);
      }
      await page.eval(`${TL}.setTime(1.5)`);
      await sleep(600);
      await pickKey('rowboat', 1.5);
      await sleep(700);
      await shot(page, '1-handles');
      // 2: "E or the player enters an area": the box with its four corners, the second row (no key picked).
      await page.eval(`${TL}.onKey({ key: 'Escape', ctrl: false, meta: false, shift: false }, true)`);
      await sleep(900);
      await shot(page, '2-when');
      // 3: the scene "Arrival" (three objects: the boat picked, the buoy and the barrel linked).
      await page.eval(`document.querySelector('[data-part=tl-more]') || document.querySelector('[data-part=tl-more-btn]').click()`);
      await sleep(300);
      await page.eval(choose('tl-clip', 'Arrival'));
      await sleep(500);
      await page.eval(`${TL}.setTime(1.5)`);
      await sleep(1000);
      await shot(page, '3-scene');
    }
    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    await srv.close?.();
  }
}

for (const size of SIZES) for (const theme of THEMES) await run(size, theme);
console.log(failed ? `${failed} check(s) failed` : 'ok');
process.exit(failed ? 1 : 0);
