// The timeline shows the picked object only, and the objects you link to it (studio-motion-focus, 2026-10-23; a
// request: "when I make a motion every other object's motion shows up too — mostly I only need the one I picked; and
// sometimes I want it to work with other objects, so let me add the ones to link"). In a headless browser on Lantern
// Cove (3D, a copy of the starter) where five objects move — the screen in the request had every moving tile in the rows and
// the picked one last. The checks (the first size and theme), with a real mouse:
//   1. the crate picked (its "Hop"), the timeline open: one row — the crate — and "+ Link an object" under it;
//   2. "+ Link an object" pressed: the list of the scene's objects (not the crate), a search field; "barr" finds the barrel;
//   3. the barrel chosen: two rows (crate first), the head says "Linked · 2", Hop is one motion with both objects' tracks;
//   4. "+ Link an object" again, then the buoy clicked in the game: it is linked (three rows: the picked one first, the
//      linked ones in the scene list's order) and the crate stays picked;
//   5. the buoy picked: its rows are the same three, the buoy first (a link goes both ways);
//   6. × on the barrel's row: unlinked (two rows), the barrel's own motion (Roll) is still on it;
//   7. ⋯ → "Show every motion in the scene": every moving object's row; "Show only the selected one" goes back;
//   8. Save: Hop has `tracks` for the crate and the buoy (the crate's keys as they were), the buoy is attached to Hop with
//      the crate's "when", the barrel only has Roll; the schema takes the file;
//   9. no page errors.
// Pictures (`--shots <dir>`): <before|after>-<size>-<theme>-<lang>-<1-picked|2-list|3-linked|4-all>.png. `--before` (the
// build before this change, `--ui <dir>`): 1-picked only (every moving object's row, the crate last).
//
//   node test/studio-motion-focus.browser.mjs [--shots <dir>] [--before] [--ui <dir>] [--only pc,side,phone] [--themes light,dark] [--lang en|ja] [--no-checks]
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
const BEFORE = args.includes('--before');
const CHECKS = !args.includes('--no-checks') && !BEFORE;
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
const DBG = `document.querySelector('iframe.game, iframe').contentWindow.__gameStudio?._debug`;
// (Scrolled into view first: the link list scrolls, and its last objects are below its fold.)
const PLATE = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.getBoundingClientRect().width) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`;
/** The plate's object rows (not the property rows under a ▾), top to bottom. */
const ROWS = `JSON.stringify([...document.querySelectorAll('[data-part=timeline] .tl-name[data-row]')].map((e) => e.dataset.row))`;

// Five objects move (a crate that hops on E, a boat that rows, a buoy that bobs, a barrel that rolls, a sailboat that
// turns): the screen in the request, where every one of them was a row while the crate's motion was being made.
const hop = { name: 'Hop', len: 1.2, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.6, v: [0, 1.6, 0] }, { t: 1.2, v: [0, 0, 0] }] } };
const FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    hop,
    { name: 'Row', len: 3, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 0.4, -1.5] }, { t: 3, v: [-5, 0, 0] }] } },
    { name: 'Bob', len: 2, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 0.4, 0] }] } },
    { name: 'Roll', len: 2.5, repeat: 'loop', keys: { r: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 2.5, v: [0, 0, 6.2832], ease: 'linear' }] } },
    { name: 'Turn', len: 6, repeat: 'loop', keys: { r: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 6, v: [0, 6.2832, 0], ease: 'linear' }] } },
  ],
  motion: {
    rowboat: { clips: [{ use: 'Row', when: { on: 'start' } }] },
    buoy: { clips: [{ use: 'Bob', when: { on: 'start' } }] },
    barrel: { clips: [{ use: 'Roll', when: { on: 'start' } }] },
    sailboat: { clips: [{ use: 'Turn', when: { on: 'start' } }] },
    crate: { clips: [{ use: 'Hop', when: { on: 'key', key: 'KeyE' } }] },
  } };

async function run(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-motion-focus-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps'] }));
  writeFileSync(join(root, 'placement.json'), JSON.stringify(FILE, null, 2));
  const full = CHECKS && size.id === SIZES[0].id && theme === THEMES[0];
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const tag = `${size.id} ${theme} ${LANG}`;
  const shot = async (page, what) => SHOTS && writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${size.id}-${theme}-${LANG}-${what}.png`), await page.screenshot());
  console.log(`${tag}${BEFORE ? ' (before)' : full ? ' (checks)' : ''}`);
  try {
    const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const motion = (k) => j(`JSON.stringify(${TL}.motionOf(${JSON.stringify(k)}))`);
    const press = async (sel) => {
      const at = await j(PLATE(sel));
      if (at) await (size.mobile ? page.tap(at.x, at.y) : page.click(at.x, at.y));
      await sleep(600);
      return !!at;
    };
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
    await sleep(2500);
    // The crate picked, the timeline open on its Hop (the card's ◆ Timeline, as a person opens it).
    await page.eval(`studioShell.actions.select('crate')`);
    await sleep(1000);
    await page.eval(`${TL}.setOpen(true)`);
    await sleep(1200);
    await page.eval(`${TL}.setTime(0.6)`);
    await sleep(700);
    await shot(page, '1-picked');
    if (BEFORE) return;

    const rows = () => j(ROWS);
    if (full) check(JSON.stringify(await rows()) === '["crate"]', `${tag}: one row, the picked crate (${JSON.stringify(await rows())})`);
    check(!!(await j(PLATE('[data-part=tl-link]'))), `${tag}: the row's "+" (Link an object; studio-ui-lead2: it was a row under the rows)`);

    // 2. The list.
    await press('[data-part=tl-link]');
    const items = await j(`JSON.stringify([...document.querySelectorAll('[data-part=tl-link-item]')].map((e) => e.dataset.key))`);
    if (full) {
      check(items.length > 5 && !items.includes('crate') && items.includes('barrel') && items.includes('buoy'), `the list: the scene's objects, not the crate (${items.length}: ${items.slice(0, 6).join(', ')}…)`);
      await page.eval(`(() => { const f = document.querySelector('[data-part=tl-link-find]'); f.value = 'barr'; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await sleep(300);
      const found = await j(`JSON.stringify([...document.querySelectorAll('[data-part=tl-link-item]')].map((e) => e.dataset.key))`);
      check(JSON.stringify(found) === '["barrel"]', `"barr" finds the barrel (${JSON.stringify(found)})`);
      await page.eval(`(() => { const f = document.querySelector('[data-part=tl-link-find]'); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await sleep(300);
    }
    await shot(page, '2-list');

    // 3. The barrel chosen.
    await press('[data-part=tl-link-item][data-key=barrel]');
    if (full) {
      check(JSON.stringify(await rows()) === '["crate","barrel"]', `the barrel linked: two rows, the crate first (${JSON.stringify(await rows())})`);
      const chip = await page.eval(`(document.querySelector('[data-part=tl-scene]') || {}).textContent || ''`);
      check(/2/.test(chip), `the head says so ("${chip}")`);
      const b = await motion('barrel');
      check(!!b?.clips?.some((c) => c.use === 'Hop' && c.scene) && b.clips.some((c) => c.use === 'Roll'), `the barrel moves with Hop and keeps its Roll (${b?.clips?.map((c) => c.use).join(', ')})`);
      check(!(await j(PLATE('[data-part=tl-link-pop]'))), 'the list closed');
    }

    // 4. Linked from the game: "+ Link", then a click on the buoy (where the game draws it).
    if (!size.mobile) {
      await press('[data-part=tl-link]');
      const at = await j(`(() => { const f = document.querySelector('iframe.game, iframe').getBoundingClientRect(); const a = ${DBG}.anchor('buoy');
        return a ? JSON.stringify({ x: f.left + a.center[0], y: f.top + a.center[1] }) : 'null'; })()`);
      const free = at && (await page.eval(`document.elementFromPoint(${at.x}, ${at.y})?.tagName === 'IFRAME'`));
      if (free) await page.click(at.x, at.y);
      else await press('[data-part=tl-link-item][data-key=buoy]');
      await sleep(1200);
      if (full) {
        check(JSON.stringify(await rows()) === '["crate","buoy","barrel"]', `the buoy ${free ? 'clicked in the game' : 'chosen (covered in the game)'}: linked (${JSON.stringify(await rows())})`);
        check(!!(await j(PLATE('[data-part=timeline] .tl-name.picked[data-row=crate]'))), 'the crate is still the picked one');
      }
    } else await press('[data-part=tl-link]').then(() => press('[data-part=tl-link-item][data-key=buoy]'));
    await page.eval(`${TL}.setTime(0.6)`);
    await sleep(700);
    await shot(page, '3-linked');

    if (full) {
      // 5. The buoy picked: the same rows, itself first.
      await page.eval(`studioShell.actions.select('buoy')`);
      await sleep(800);
      check(JSON.stringify(await rows()) === '["buoy","barrel","crate"]', `the buoy picked: its linked rows come along, the buoy first (${JSON.stringify(await rows())})`);
      await page.eval(`studioShell.actions.select('crate')`);
      await sleep(800);
      // 6. × on the barrel.
      await page.eval(`document.querySelector('[data-part=tl-leave][data-key=barrel]').click()`);
      await sleep(600);
      check(JSON.stringify(await rows()) === '["crate","buoy"]', `× unlinked the barrel (${JSON.stringify(await rows())})`);
      const b = await motion('barrel');
      check(JSON.stringify(b?.clips?.map((c) => c.use)) === '["Roll"]', `the barrel keeps its own Roll (${JSON.stringify(b?.clips?.map((c) => c.use))})`);
      // 7. Every motion.
      await page.eval(`document.querySelector('[data-part=tl-more-btn]').click()`);
      await sleep(400);
      await page.eval(`document.querySelector('[data-part=tl-all]').click()`);
      await sleep(600);
      const all = await rows();
      check(['rowboat', 'buoy', 'barrel', 'sailboat', 'crate'].every((k) => all.includes(k)), `"Show every motion": every moving object (${JSON.stringify(all)})`);
    }
    if (!full) {
      await page.eval(`document.querySelector('[data-part=tl-more-btn]').click()`);
      await sleep(400);
      await page.eval(`document.querySelector('[data-part=tl-all]').click()`);
      await sleep(600);
    }
    await shot(page, '4-all');
    await press('[data-part=tl-all-off]');
    if (full) {
      check(JSON.stringify(await rows()) === '["crate","buoy"]', `"Show only the selected one": back (${JSON.stringify(await rows())})`);
      // 8. Save.
      await page.eval(`studioShell.actions.save()`);
      await sleep(1500);
      const f = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      const h = f.motions?.find((m) => m.name === 'Hop');
      check(!!h?.tracks && Object.keys(h.tracks).sort().join() === 'buoy,crate' && JSON.stringify(h.tracks.crate) === JSON.stringify(hop.keys) && !h.keys,
        `Hop: tracks ${Object.keys(h?.tracks ?? {}).join(', ')}, the crate's keys as they were`);
      const bu = f.motion?.buoy?.clips?.find((c) => c.use === 'Hop');
      check(bu?.when?.on === 'key' && bu.when.key === 'KeyE', `the buoy is on Hop with the crate's "when" (${JSON.stringify(bu?.when)})`);
      check(JSON.stringify(f.motion?.barrel?.clips?.map((c) => c.use)) === '["Roll"]', 'the barrel: Roll only');
      const v = validateStudioFile(f, { tool: 'placement' });
      check(v.ok, `the schema takes the file${v.ok ? '' : ': ' + v.errors.join('; ')}`);
    }
    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `${tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    await srv.close?.();
  }
}

for (const size of SIZES) for (const theme of THEMES) await run(size, theme);
console.log(failed ? `${failed} check(s) failed` : 'ok');
process.exit(failed ? 1 : 0);
