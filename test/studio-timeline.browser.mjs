// The timeline (studio-timeline, 2026-10-22: "make motion like Unity or Blender"), in a headless browser on Lantern
// Cove (3D, a copy of the starter). The checks (PC light):
//   1. an older file's motion (v0.1.13: the buoy's spin) opens as a clip, and nothing counts as changed;
//   2. the rowboat's card has a Motion row ("+ New motion" since studio-motion-flow; the picture runs, where it has
//      "Row" already: "Row" and ◆ Timeline); it opens the plate at the foot of
//      the game, auto key on;
//   3. the time line moved to 2 s (the ruler pressed), the boat dragged in the game: a key — a clip "Motion" with keys at
//      0 s and 2 s — Save counts it, the boat's place is unchanged, one undo step;
//   4. the path in 3D: two dots in the game; Shift-dragging the 2 s dot lifts that key (its height goes up);
//   5. scrubbing to 1 s shows the boat on its way; ▶ moves it by itself, ❚❚ stops;
//   6. on the plate: a key pressed and Delete removes it, ⌘Z brings it back; the ease menu sets the picked key's ease;
//   7. "New: Spin" on the buoy's menu makes a second motion that waits for a cue;
//   8. Save writes `motion.rowboat.clips` the schema takes; ▶ Play: the starter's loader moves the boat;
//   9. folding puts the boat back at its place.
// And pictures (`--shots <dir> --no-checks`): PC 1280×800, the side window 400×900, a phone 390×844 × light and dark —
// the plate open with the boat's keys and its path at 1.5 s (`1-open`), and while ▶ plays (`2-play`), from a file that
// has the boat's motion already. The "before" pictures are motion-gui's (v0.1.13).
//
//   node test/studio-timeline.browser.mjs [--shots <dir>] [--only pc,side,phone] [--themes light,dark] [--lang en|ja] [--no-checks]
// The checks run once, on the first size and theme (PC light by default).
// Exit 1 on a failure.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const DBG = `document.querySelector('iframe.game, iframe').contentWindow.__gameStudio._debug`;
const TL = `window.__studioTimeline`;
// The path's dots in the game page (bridge/timeline-path.ts), in the editor page's px.
const POINTS = `(() => { const f = [...document.querySelectorAll('iframe')].find((x) => x.offsetParent) || document.querySelector('iframe');
  const host = f.contentDocument.querySelector('[data-studio-timeline]'); if (!host) return '[]';
  const o = f.getBoundingClientRect();
  return JSON.stringify([...host.shadowRoot.querySelectorAll('[data-point]')].map((c) => [o.left + +c.getAttribute('cx'), o.top + +c.getAttribute('cy')])); })()`;
const PLATE = `(() => { const p = document.querySelector('[data-part=timeline]'); if (!p) return null; const r = p.getBoundingClientRect();
  return JSON.stringify({ shown: !p.hidden && r.height > 0, top: r.top, left: r.left, width: r.width, height: r.height,
    auto: document.querySelector('[data-part=tl-auto]')?.getAttribute('aria-pressed') === 'true',
    keys: [...p.querySelectorAll('[data-part=tl-key]')].map((k) => ({ key: k.dataset.key, ch: k.dataset.ch, t: +k.dataset.t, on: k.classList.contains('on') })) }); })()`;
const SAVE = `(() => { const b = [...document.querySelectorAll('[data-part=save], [data-part=save-fab]')].find((x) => !x.hidden && x.offsetParent); return b ? b.textContent : ''; })()`;

// The picture runs start from a file that already has the boat's motion (keys at 0, 1.5 and 3 s, lifted in the
// middle) and the buoy's older spin: the plate and the path show without dragging.
const PICTURE_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, motion: {
  rowboat: { clips: [{ name: 'Row', len: 3, repeat: 'pingpong', start: true, keys: {
    p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 1.2, -1.5] }, { t: 3, v: [-5, 0, 0] }], r: [{ t: 0, v: [0, 0, 0] }, { t: 3, v: [0, 0.8, 0] }] } }] },
  buoy: { spin: 1.5708 },
} };

async function run(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-timeline-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  // The first-time steps (studio-motion-flow) closed already: this test and its pictures are about the plate itself.
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps'] }));
  const full = CHECKS && size.id === 'pc' && theme === THEMES[0];
  // The checks start from the older shape only (the buoy's spin): the boat's motion is made by hand.
  writeFileSync(join(root, 'placement.json'), JSON.stringify(full ? { ...PICTURE_FILE, motion: { buoy: PICTURE_FILE.motion.buoy } } : PICTURE_FILE, null, 2));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const name = (what) => join(SHOTS, `after-${size.id}-${theme}-${what}.png`);
  const shot = async (page, what) => SHOTS && writeFileSync(name(what), await page.screenshot());
  console.log(`${size.id} ${theme}${full ? ' (checks)' : ''}`);
  try {
    const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const state = () => j(`JSON.stringify(${TL}.state())`);
    const boatPose = () => j(`JSON.stringify(${DBG}.anchor('rowboat').pose)`);
    const boatAt = () => j(`(() => { const a = ${DBG}.anchor('rowboat'); const o = document.querySelector('iframe').getBoundingClientRect(); return JSON.stringify({ x: o.left + a.center[0], y: o.top + a.center[1], p: a.pose.p }); })()`);
    // The ruler: press at `s` seconds.
    const rulerAt = async (s) => j(`(() => { const r = document.querySelector('[data-part=tl-ruler]').getBoundingClientRect(); const v = ${TL}; const span = Math.max(...[...document.querySelectorAll('.tl-tick')].map((t) => parseFloat(t.textContent) || 0));
      return JSON.stringify({ x: r.left + 12 + (${s} / span) * (r.width - 24), y: r.top + r.height / 2, span }); })()`);
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(2500);
    // 1. The older file (the buoy's spin): read as a clip, not a change.
    if (full) check(!/[1-9]/.test(await page.eval(SAVE)), `an older file's motion is not a change ("${(await page.eval(SAVE)).trim()}")`);
    await page.eval(`studioShell.actions.select('rowboat')`);
    await sleep(1200);
    // Phone and the side window keep the numbers (and so the Motion row) under "…" on the card.
    const fine = async (open) => size.id !== 'pc' && page.eval(`(() => { const d = document.querySelector('[data-part=card] details.fine'); if (d) d.open = ${open}; return true; })()`);
    await fine(true);
    await sleep(400);
    // studio-motion-flow: an object with no motion shows "+ New motion" (and "From Library": the buoy's spin is one);
    // one with a motion shows its name and ◆ Timeline (motion-card.ts).
    const row = await j(`(() => { const q = (p) => document.querySelector('[data-part=card] [data-part=' + p + ']');
      return JSON.stringify({ make: !!q('motion-make'), fromLib: !!q('motion-from-lib'), clip: q('motion-clip')?.value ?? null, tl: !!q('motion-timeline') }); })()`);
    if (full) check(!!row && row.make && row.fromLib, `the card's Motion row: + New motion and From Library (${JSON.stringify(row)})`);
    // The picture runs start from PICTURE_FILE, where the boat already has "Row": no "+ New motion" there (as designed),
    // so ◆ Timeline opens the plate. 2026-10-22 (studio-motion-flow-2): 9e1634134 clicked motion-make in every run and the
    // runs after PC light stopped on `null.click()` — the test, not the product (each run is a fresh copy, nothing carried over).
    else check(!!row && !row.make && row.clip === 'Row' && row.tl, `the card's Motion row: "Row" and ◆ Timeline (${JSON.stringify(row)})`);
    await page.eval(`document.querySelector('[data-part=card] [data-part=${full ? 'motion-make' : 'motion-timeline'}]').click()`);
    await sleep(600);
    await fine(false);
    await sleep(500);
    const plate = await j(PLATE);
    check(!!plate?.shown, `◆ Timeline opens the plate (${plate && Math.round(plate.top)}…${plate && Math.round(plate.top + plate.height)})`);
    if (full) {
      check(plate.auto, 'auto key is on');
      check(plate.top > size.height * 0.6 && plate.width > size.width * 0.6, 'PC: at the foot of the game, across it');
      const ask = await j(`JSON.stringify(document.querySelector('[data-part=bar]').getBoundingClientRect())`);
      check(ask.bottom <= plate.top + 1, `the ask bar sits above it (${Math.round(ask.bottom)} ≤ ${Math.round(plate.top)})`);
      // Since motion-focus (2026-10-23: "basically only the selected object"): the plate shows the picked object's rows
      // only; the buoy's older spin is still read as a clip (checked after Save below) but not drawn here.
      check(!plate.keys.some((k) => k.key === 'buoy'), 'only the picked object\'s rows: the buoy is not on the plate');
      // 3. 2 s on the ruler, then drag the boat.
      const r2 = await rulerAt(2);
      await page.click(Math.round(r2.x), Math.round(r2.y));
      await sleep(400);
      const s2 = await state();
      check(Math.abs(s2.time - 2) < 0.1, `the ruler sets the time (${s2.time} s, span ${r2.span} s)`);
      const b0 = await boatAt();
      await page.mouseDrag(Math.round(b0.x), Math.round(b0.y), Math.round(b0.x - 160), Math.round(b0.y + 10), 10);
      await sleep(800);
      const k1 = (await j(PLATE)).keys.filter((k) => k.key === 'rowboat');
      check(k1.length >= 2 && k1.some((k) => Math.abs(k.t) < 1e-3) && k1.some((k) => Math.abs(k.t - 2) < 0.06), `keys at 0 s and 2 s on the boat's row (${k1.map((k) => k.t).join(', ')})`);
      // The boat (its clip) and the Library (a new motion): 2 since studio-motion-triggers.
      check(/[12]/.test(await page.eval(SAVE)), `Save counts it ("${(await page.eval(SAVE)).trim()}")`);
      const tip = await page.eval(`(document.querySelector('[data-action=undo]') || {}).title || ''`);
      check(/motion|動き/.test(tip), `Undo names it ("${tip.split('\n')[0]}")`);
      // 4. The path: two dots; Shift-drag the 2 s one up.
      await page.eval(`studioShell.actions.select('rowboat')`);
      await sleep(600);
      const pts = await j(POINTS);
      check(pts.length === 2, `the path in the game has 2 dots (${pts.length})`);
      if (pts[1]) {
        await page.eval(`(() => { const f = document.querySelector('iframe'); const w = f.contentWindow;
          const at = (type, x, y) => w.dispatchEvent(new w.PointerEvent(type, { clientX: x, clientY: y, shiftKey: true, bubbles: true, pointerId: 7, button: 0, pointerType: 'mouse' }));
          const o = f.getBoundingClientRect(); const x = ${pts[1][0]} - o.left, y = ${pts[1][1]} - o.top;
          const hit = f.contentDocument.querySelector('[data-studio-timeline]').shadowRoot.querySelector('[data-point="1"]');
          hit.dispatchEvent(new w.PointerEvent('pointerdown', { clientX: x, clientY: y, shiftKey: true, bubbles: true, composed: true, pointerId: 7, button: 0, pointerType: 'mouse' }));
          for (let i = 1; i <= 6; i++) at('pointermove', x, y - i * 12);
          at('pointerup', x, y - 72); return true; })()`);
        await sleep(600);
      }
      // 5. Scrub to 1 s: on its way; ▶ / ❚❚.
      const r1 = await rulerAt(1);
      await page.click(Math.round(r1.x), Math.round(r1.y));
      await sleep(400);
      const mid = await boatPose();
      check(Math.abs(mid.p[0] - b0.p[0]) + Math.abs(mid.p[2] - b0.p[2]) > 0.2, `at 1 s the boat is on its way (${mid.p.map((v) => v.toFixed(2))})`);
      await page.eval(`document.querySelector('[data-part=tl-play]').click()`);
      await sleep(250);
      const a = await boatPose();
      await sleep(350);
      const b = await boatPose();
      check(JSON.stringify(a.p) !== JSON.stringify(b.p) && (await state()).playing, '▶ moves it by itself');
      await page.eval(`document.querySelector('[data-part=tl-play]').click()`);
      await sleep(300);
      check(!(await state()).playing, '❚❚ stops');
      // 6. Pick the 2 s key on the boat's row, Delete, ⌘Z.
      const key2 = await j(`(() => { const k = [...document.querySelectorAll('[data-part=tl-key]')].find((x) => x.dataset.key === 'rowboat' && !x.dataset.ch && Math.abs(+x.dataset.t - 2) < 0.06);
        if (!k) return null; const r = k.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      if (key2) {
        await page.click(Math.round(key2.x), Math.round(key2.y));
        await sleep(300);
        check((await state()).sel.length >= 1, `pressing a key picks it (${(await state()).sel.length})`);
        await page.eval(`(() => { const s = document.querySelector('[data-part=tl-ease]'); s.value = 'linear'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await sleep(300);
        const ez = await page.eval(`document.querySelector('[data-part=tl-ease]').value`);
        check(ez === 'linear', `the ease menu sets the picked key's ease (${ez})`);
        await page.eval(`document.querySelector('[data-part=timeline]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))`);
        await sleep(400);
        const left = (await j(PLATE)).keys.filter((k) => k.key === 'rowboat' && !k.ch);
        check(!left.some((k) => Math.abs(k.t - 2) < 0.06), `Delete removes it (${left.map((k) => k.t).join(', ')})`);
        await page.eval(`studioShell.actions.undo()`);
        await sleep(400);
        const back = (await j(PLATE)).keys.filter((k) => k.key === 'rowboat' && !k.ch);
        check(back.some((k) => Math.abs(k.t - 2) < 0.06), '⌘Z brings it back');
      } else check(false, 'the 2 s key is on the plate');
      // The boat's motion goes back and forth (so ▶ Play below sees it moving whenever it looks). Repeat is in the
      // strip's ⋯ since studio-motion-panel (the one line keeps what is used every time).
      await page.eval(`document.querySelector('[data-part=tl-more]') || document.querySelector('[data-part=tl-more-btn]').click()`);
      await sleep(300);
      await page.eval(`(() => { const s = document.querySelector('[data-part=tl-repeat]'); s.value = 'pingpong'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await sleep(300);
      await page.eval(`document.querySelector('[data-part=tl-more-btn].on')?.click()`);
      await sleep(200);
      // 7. The buoy: New: Spin.
      await page.eval(`studioShell.actions.select('buoy')`);
      await sleep(600);
      await page.eval(`(() => { const s = document.querySelector('[data-part=tl-clip]'); s.value = 'new:spin'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await sleep(400);
      const st = await state();
      const clips = await j(`JSON.stringify([...document.querySelectorAll('[data-part=tl-clip] option')].map((o) => o.value).filter((v) => v && !v.startsWith('new:') && v !== '-' && v !== 'rename' && v !== 'delete'))`);
      check(clips.length === 2 && st.clip !== 'Motion', `a second motion on the buoy (${clips.join(', ')}; showing ${st.clip})`);
      // Since studio-motion-triggers: "waits" = Starts "In my words…" (the AI connects it), on the head's second row.
      const cue = await page.eval(`document.querySelector('[data-part=tl-starts]').value`);
      check(cue === 'say', `the second one waits for a cue (${cue})`);
      // 8. Save and the file.
      await page.eval(`studioShell.actions.save()`);
      await sleep(1500);
      const f = existsSync(join(root, 'placement.json')) ? JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8')) : null;
      // Since studio-motion-triggers the keys are the Library motion's (`motions`), the boat's clip names it (`use`).
      const use = f?.motion?.rowboat?.clips?.[0];
      const rb = use && (f.motions || []).find((m) => m.name === use.use);
      check(!!rb && rb.keys.p.length >= 2, `placement.json: rowboat ${JSON.stringify(rb)?.slice(0, 160)}`);
      const lift = rb?.keys.p.find((k) => Math.abs(k.t - 2) < 0.06);
      check(!!lift && lift.v[1] > 0.3, `the Shift-dragged point is higher (y ${lift?.v[1]})`);
      check(rb?.repeat === 'pingpong' && lift?.ease === 'linear', `the repeat and the ease are in the file (${rb?.repeat}, ${lift?.ease})`);
      check(f?.motion?.buoy?.clips?.length === 2, 'the buoy: its older spin as a clip, and the new one');
      check(!f?.objects?.rowboat, 'a key is not a move: the boat\'s place is not in `objects`');
      check(validateStudioFile(f, { tool: 'placement' }).ok, 'the schema takes the file');
      // 9. Fold: the boat at its place.
      await page.eval(`document.querySelector('[data-action=tl-fold]').click()`);
      await sleep(500);
      check(!(await j(PLATE)).shown, 'folded');
      const home = await boatPose();
      check(Math.hypot(home.p[0] - b0.p[0], home.p[2] - b0.p[2]) < 1e-3, `folded, the boat is at its place (${home.p.map((v) => v.toFixed(2))})`);
      // ▶ Play: the starter's loader plays the boat's start clip.
      const play = await j(`(() => { const b = [...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      await page.click(play.x, play.y);
      await sleep(800);
      // "Save and play" may ask first (nothing unsaved now: it should not).
      const PLAY = `[...document.querySelectorAll('iframe')].map((f) => f.contentWindow.__gameStudio && f.contentWindow.__gameStudio._play).find(Boolean)`;
      await page.waitFor(`(() => { const p = ${PLAY}; return !!p && p.list().length > 0; })()`, 30000);
      await sleep(1200);
      const pose = async () => j(`JSON.stringify(Object.fromEntries(${PLAY}.list().filter((i) => i.key === 'rowboat').map((i) => [i.key, i.pose])))`);
      const pa = await pose();
      await sleep(500);
      const pb = await pose();
      check(!!pa.rowboat && JSON.stringify(pa.rowboat.p) !== JSON.stringify(pb.rowboat.p), 'Play: the loader moves the boat (no code written)');
    } else {
      // Pictures: the plate open at 1.5 s (the lifted key), the boat's path, then ▶.
      await page.eval(`${TL}.setTime(1.5)`);
      await sleep(700);
      await shot(page, '1-open');
      await page.eval(`document.querySelector('[data-part=tl-play]').click()`);
      await sleep(900);
      await shot(page, '2-play');
      await page.eval(`document.querySelector('[data-part=tl-play]').click()`);
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
