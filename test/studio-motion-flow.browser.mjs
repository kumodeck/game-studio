// Making a motion and putting it on objects (studio-motion-flow; a hands-on try of v0.1.18, 2026-10-22: "I couldn't tell how
// to make a motion and then put it on objects"), in a headless browser on Lantern Cove (3D, a copy of the starter).
// The checks (PC light):
//   1. the card of an object with no motion: no Motion row (studio-card-doors, plan step 3, 2026-10-23: the strip's Motion
//      is the one way in); an object with one: one line, its name and when it plays, and a press opens the timeline;
//   2. the strip's Motion → "Make a motion": the timeline opens on it with its one line (studio-no-presets); Esc ends
//      making, nothing made (the first-time three steps went with studio-motion-line, plan step 4: none show);
//   3. the Library's Motion filter starts with "+ New motion" ("for crate" with the crate picked, "Pick an object first"
//      with nothing); pressed with nothing picked: the Scene, one line, and the next object picked gets the timeline;
//   4. a motion's tile dragged onto the crate in the game: the Library fades (the game shows), the crate is named
//      ("Attach “Hop” to crate"), let go = attached — the Scene, the crate picked, the timeline on Hop with
//      "✓ “Hop” attached · When does it move?" and Starts focused; one undo step; Esc during a drag = nothing;
//   5. the strip's "Use a saved motion" on an object with no motion (the card's "From Library" until plan step 3): the
//      same "When does it move?" ringed;
//   6. no page errors.
// A phone (390×844, touch) in the pictures run: a long press picks the tile up, the finger drops it on the crate.
// And pictures (`--shots <dir> [--before] --no-checks`): PC 1280×800, the side window 400×900, a phone 390×844 × light and
// dark — `1-card` (the crate, no motion), `2-library` (the Motion filter, the crate picked), `3-drag` (Hop held over the
// crate), `4-attached` (just after), `5-steps` (the first-time steps). `--before` (with `--ui` = the v0.1.18 build): the
// same places as they were — no 3-drag / 5-steps; 4 = the detail's "Attach to crate".
//
//   node test/studio-motion-flow.browser.mjs [--shots <dir>] [--before] [--ui <dir>] [--only pc,side,phone] [--themes light,dark] [--lang en|ja] [--no-checks]
// Exit 1 on a failure.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
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
// The words the checks read, in each language (studio-tests-0165, 2026-10-25: the checks had the English only, so
// `--lang ja` failed on the words alone — shell/i18n.ts tl.make.drag, lib.motion.newFor / dragTip / pickFirst,
// motion.pickFirst, motion.drag.onto).
const W = LANG === 'ja'
  ? { drag: /ドラッグしてください（Esc でやめる）/, newFor: /crate に/, dragTip: /物にドラッグすると付きます/, pickFirst: /物を選んでから/, pickToMake: /物を選ぶと、その物の動きを作ります/, onto: /“Hop” を crate に付ける/ }
  : { drag: /Drag .+ \(Esc to cancel\)/, newFor: /for crate/, dragTip: /drag one onto an object/, pickFirst: /Pick an object first/, pickToMake: /Pick an object to make its motion/, onto: /Attach “Hop” to crate/ };
const ONLY = take('--only', 'pc,side,phone').split(',');
const THEMES = take('--themes', 'light,dark').split(',');
const CHECKS = !args.includes('--no-checks');
const BEFORE = args.includes('--before');
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
/** Change a <select> on the page (a native menu cannot be clicked headless). */
const choose = (sel, value) => `(() => { const s = document.querySelector(${JSON.stringify(sel)}); if (!s) return false; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;

// The Library has four motions; the crate and the lighthouse have none (the case from the try: a thing with no motion yet).
const FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    { name: 'Row', len: 3, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 1.2, -1.5] }, { t: 3, v: [-5, 0, 0] }] } },
    { name: 'Bob', len: 2, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 0.4, 0] }] } },
    { name: 'Hop', len: 0.8, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.4, v: [0, 1.4, 0] }, { t: 0.8, v: [0, 0, 0] }] } },
    { name: 'Roll', len: 1.5, keys: { r: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [0, 0, 6.2832] }] } },
  ],
  motion: {
    rowboat: { clips: [{ use: 'Row', when: { on: 'start' } }] },
    buoy: { clips: [{ use: 'Bob', when: { on: 'start' } }] },
    barrel: { clips: [{ use: 'Roll', when: { on: 'cue', cue: 'barrel-hit' } }] },
  } };

async function run(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-motion-flow-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  writeFileSync(join(root, 'placement.json'), JSON.stringify(FILE, null, 2));
  const full = CHECKS && !BEFORE && size.id === 'pc' && theme === THEMES[0];
  // No KUMODeck sign-in (studio-library-shelf, 2026-10-23): the Library reads it at once now for its "✦ Make with AI" words,
  // and the real ~/.kumo of the machine running this must not be read (nor its balance land in a picture).
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const shot = async (page, what) => SHOTS && writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${size.id}-${theme}-${what}.png`), await page.screenshot());
  console.log(`${size.id} ${theme}${full ? ' (checks)' : ''}${BEFORE ? ' (before)' : ''}`);
  try {
    const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const state = () => j(`JSON.stringify(${TL}.state())`);
    const fine = async (open) => size.id !== 'pc' && page.eval(`(() => { const d = document.querySelector('[data-part=card] details.fine'); if (d) d.open = ${open}; return true; })()`);
    const select = async (k) => {
      await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
      await sleep(900);
    };
    const toLibrary = async () => {
      await page.eval(`studioShell.actions.switchTool('library')`);
      await sleep(1200);
      await page.eval(`(document.querySelector('.shelf-filters [data-shelf=motion]') || {}).click?.()`);
      await sleep(600);
    };
    // The card's Motion row since studio-card-doors (plan step 3): one line, only when the object has a motion.
    const card = () => j(`(() => { const c = document.querySelector('[data-part=card]'); if (!c) return null;
      return JSON.stringify({ row: !!c.querySelector('[data-part=motion-row]'), make: !!c.querySelector('[data-part=motion-make]'), fromLib: !!c.querySelector('[data-part=motion-from-lib]'),
        line: c.querySelector('[data-part=motion-timeline-line]')?.textContent ?? null }); })()`);
    const ROOT = `document.querySelector('iframe.game, iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
    const tapAt = async (pt) => (size.mobile ? await page.tap(Math.round(pt.x), Math.round(pt.y)) : await page.click(Math.round(pt.x), Math.round(pt.y)), await sleep(500));
    /** The picked object's Motion button in the game's strip (the one way in, motion-tool.ts), then a row of its menu. */
    const strip = async (...rows) => {
      await page.waitFor(`!!${ROOT}.querySelector('[data-studio-motion]:not([hidden])')`, 15000).catch(() => {});
      const at = () => j(`(() => { const o = document.querySelector('iframe.game, iframe').getBoundingClientRect(); const b = ${ROOT}.querySelector('[data-studio-motion]');
        if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`);
      // Where the button stays (studio-tests-0165, 2026-10-25): on the phone the strip moves for a moment after the card
      // changes (Fine-tune closed — measured 156 → 422 px within 200 ms), and a tap at the first place hit the game's
      // canvas (the lighthouse picked again, no menu). Read until two reads 250 ms apart agree (2 s at most).
      let b = await at();
      for (let k = 0; k < 8 && b; k++) {
        await sleep(250);
        const b2 = await at();
        const same = !!b2 && Math.abs(b2.x - b.x) < 1 && Math.abs(b2.y - b.y) < 1;
        b = b2;
        if (same) break;
      }
      if (!b) return false;
      await tapAt(b);
      for (const a of rows) {
        const r = await j(`(() => { const b = document.querySelector('[data-part=context-menu] [data-action=${JSON.stringify(a)}]'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
        if (!r) return false;
        await tapAt(r);
      }
      return true;
    };
    // studio-ui-lead (2026-10-23): no "✓ attached" chip; just attached = "When does it move?" with its menu ringed (.ask) and focused.
    const after = () => j(`(() => { const s = document.querySelector('[data-part=tl-starts]');
      return JSON.stringify({ ringed: !!s?.closest('.tl-starts.ask'), focused: !!s && document.activeElement === s, lib: !document.querySelector('[data-part=assets-page]')?.hidden }); })()`);
    /** Where an object is in the editor page (its middle in the game, through the frame's box). */
    const objectAt = (k) => j(`(() => { const d = ${DBG}; const m = d.middle(${JSON.stringify(k)}); const s = m && d.toScreen(m); if (!s) return null;
      const o = document.querySelector('iframe.game').getBoundingClientRect(); return JSON.stringify({ x: o.left + s[0], y: o.top + s[1] }); })()`);
    const tileAt = (name) => j(`(() => { const t = document.querySelector('.gsl-tile[data-motion=${JSON.stringify(name)}]'); if (!t) return null; t.scrollIntoView({ block: 'center' });
      const r = t.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
    const mouse = (type, x, y, buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const touch = (type, x, y) => page.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1 }] });
    /** Pick a motion's tile up and hold it over `k` (a mouse, or a finger's long press); `release` = let go there. */
    const hold = async (name, k, { release = true, shotWhat = null, esc = false } = {}) => {
      const t = await tileAt(name);
      if (!t) return false;
      await sleep(300);
      const t2 = await tileAt(name);
      const target0 = await objectAt(k);
      if (size.mobile) {
        await touch('touchStart', t2.x, t2.y);
        await sleep(650);
      } else {
        await mouse('mouseMoved', t2.x, t2.y, 0);
        await mouse('mousePressed', t2.x, t2.y);
      }
      // The Library fades as the tile lifts: the object's place is read again once the game shows.
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const x = t2.x + ((target0.x - t2.x) * i) / steps, y = t2.y + ((target0.y - t2.y) * i) / steps;
        if (size.mobile) await touch('touchMove', x, y);
        else await mouse('mouseMoved', x, y);
        await sleep(40);
      }
      // …read again here (the comment above said so, the code did not until studio-motion-flow-2, 2026-10-22): on PC the
      // place read before the lift could be off once the game shows, the tag named the sailboat or nothing, and one
      // pc-dark run dropped Hop on the lighthouse. The editor attaches to what is under the pointer at the release (as
      // designed), so the test now goes to where the object is then.
      await sleep(350);
      const target1 = (await objectAt(k)) || target0;
      for (let i = 1; i <= 3; i++) {
        const x = target0.x + ((target1.x - target0.x) * i) / 3, y = target0.y + ((target1.y - target0.y) * i) / 3;
        if (size.mobile) await touch('touchMove', x, y);
        else await mouse('mouseMoved', x, y);
        await sleep(40);
      }
      target0.x = target1.x;
      target0.y = target1.y;
      await sleep(350);
      if (shotWhat) await shot(page, shotWhat);
      const during = await j(`JSON.stringify({ drag: document.querySelector('[data-part=app]').dataset.drag || null, tag: (document.querySelector('[data-part=motion-drag-tag]:not([hidden])') || {}).textContent || null,
        fade: getComputedStyle(document.querySelector('[data-part=assets-page]')).opacity })`);
      if (esc) await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      if (release) {
        if (size.mobile) await touch('touchEnd', target0.x, target0.y);
        else await mouse('mouseReleased', target0.x, target0.y, 0);
      }
      await sleep(900);
      return during;
    };
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(2500);

    // ---- 1. the cards ----
    await select('crate');
    await fine(true);
    await sleep(700);
    await fine(true);
    await sleep(300);
    await shot(page, '1-card');
    await fine(false);
    if (full) {
      const c = await card();
      check(!!c && !c.row && !c.make && !c.fromLib, `no motion: no Motion row on the card (${JSON.stringify(c)})`);
      await select('barrel');
      const b = await card();
      // fix-0140 (J1): the card's line is the motion's name only — when it plays is the timeline's sentence (it was cut here).
      check(!!b?.row && b.line === 'Roll', `a motion: one line, its name ("${b?.line}")`);
      await page.eval(`document.querySelector('[data-part=card] [data-part=motion-timeline-line]')?.click()`);
      await sleep(700);
      check((await state()).open && (await state()).clip === 'Roll', `the line opens the timeline on it (${(await state()).clip})`);
      await page.eval(`${TL}.setOpen(false)`);
      await sleep(300);
      // ---- 2. the strip's Make a motion; Esc ----
      await select('crate');
      const made = await strip('ctx-motion-make');
      await sleep(500);
      let st = await state();
      const coach = () => page.eval(`!!document.querySelector('[data-part=tl-coach], .tl-coach')`);
      // studio-no-presets: "Make a motion" is making (its own line says the step); the first-time three steps are gone
      // since studio-motion-line (plan step 4, 2026-10-23: the line says the next step).
      const line = await page.eval(`document.querySelector('[data-part=tl-first]')?.textContent || ''`);
      check(made && st.open && !(await coach()) && W.drag.test(line), `Make a motion opens the timeline on the crate, its one line ("${line}")`);
      check(!(await state()).clip, 'nothing made yet (the first move makes it)');
      await page.eval(`(document.activeElement?.blur?.(), window.focus(), document.body.focus())`);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(500);
      const line2 = await page.eval(`document.querySelector('[data-part=tl-first]')?.textContent || ''`);
      check(!/Esc to cancel/.test(line2) && !(await state()).clip && !(await coach()), `Esc: making ends, nothing made, no first-time steps ("${line2}")`);
      await page.eval(`${TL}.setOpen(false)`);
      await sleep(300);
      // ---- 3. + New motion in the Library ----
      await select('crate');
      await toLibrary();
      const first = await j(`(() => { const t = document.querySelector('.gsl-grid > .gsl-tile'); return t ? JSON.stringify({ part: t.dataset.part, text: t.textContent }) : null; })()`);
      check(first?.part === 'motion-new' && W.newFor.test(first.text), `the Motion filter starts with + New motion ("${first?.text}")`);
      const count = await page.eval(`(document.querySelector('.gsl-count') || {}).textContent || ''`);
      check(W.dragTip.test(count), `the count line says the hand ("${count}")`);
      await page.eval(`studioShell.actions.select(null)`);
      await sleep(700);
      const none = await page.eval(`(document.querySelector('[data-part=motion-new]') || {}).textContent || ''`);
      check(W.pickFirst.test(none), `nothing picked: "${none}"`);
      await page.eval(`document.querySelector('[data-part=motion-new]').click()`);
      await sleep(900);
      const onScene = await page.eval(`document.querySelector('[data-part=assets-page]').hidden`);
      // (`askLine`: a second `const line` in this block was a syntax error since studio-no-presets — the test never ran; studio-ui-lead 2026-10-23.)
      const askLine = await page.eval(`(() => { const a = document.querySelector('[data-part=ask]'); return (a && a.textContent) + ' ' + ((document.querySelector('.toast') || {}).textContent || ''); })()`);
      check(onScene && W.pickToMake.test(askLine), `the Scene, and one line: "${(askLine.match(W.pickToMake) || [''])[0]}"`);
      const lh = await objectAt('lighthouse');
      await page.click(lh.x, lh.y);
      await sleep(1000);
      st = await state();
      const row = await page.eval(`(document.querySelector('.tl-name.picked') || {}).dataset?.row || ''`);
      check(st.open && row === 'lighthouse', `the next pick (the lighthouse) opens the timeline on it (open ${st.open}, row "${row}")`);
      await page.eval(`${TL}.setOpen(false)`);
      await sleep(300);
      // ---- 4. drag Hop onto the crate ----
      await toLibrary();
      const undo0 = await page.eval(`(document.querySelector('[data-action=undo]') || {}).title || ''`);
      const d1 = await hold('Bob', 'crate', { esc: true });
      check(d1?.drag === 'motion', `a tile picked up: the editor says so (${JSON.stringify(d1)})`);
      const usageBob = await j(`JSON.stringify(${TL}.usage('Bob').map((u) => u.key))`);
      check(!usageBob.includes('crate') && !(await j(`JSON.stringify(document.querySelector('[data-part=assets-page]').hidden)`)), `Esc: nothing attached, the Library is back (${usageBob.join(', ')})`);
      const d2 = await hold('Hop', 'crate');
      check(d2?.drag === 'motion' && Number(d2.fade) < 0.2, `the Library fades while held (opacity ${d2?.fade})`);
      check(W.onto.test(d2?.tag || ''), `over the crate: "${d2?.tag}"`);
      const onCrate = await j(`JSON.stringify(${TL}.usage('Hop').map((u) => u.key))`);
      check(onCrate.includes('crate'), `let go: Hop is on the crate (${onCrate.join(', ')})`);
      const a = await after();
      st = await state();
      check(!a.lib && st.open && st.clip === 'Hop', `the Scene, the timeline on Hop (${st.clip})`);
      check(a.ringed && a.focused, `"When does it move?" ringed, with its menu focused (${JSON.stringify(a)})`);
      const undo1 = await page.eval(`(document.querySelector('[data-action=undo]') || {}).title || ''`);
      check(undo1 !== undo0 && /motion|動き/.test(undo1), `one undo step ("${undo1.split('\n')[0]}")`);
      // ---- 5. the card's From Library ----
      await page.eval(`${TL}.setOpen(false)`);
      await sleep(300);
      await select('lighthouse');
      await strip('ctx-motion-lib', 'ctx-motion-lib-Bob');
      await sleep(800);
      const a2 = await after();
      check(a2.ringed && (await state()).clip === 'Bob', `the strip's Use a saved motion: Bob on the plate, "When" ringed (${JSON.stringify(a2)}, ${(await state()).clip})`);
    } else {
      // ---- pictures ----
      await select('crate');
      await toLibrary();
      await shot(page, '2-library');
      if (BEFORE) {
        await page.eval(`document.querySelector('.gsl-tile[data-motion="Hop"]')?.click()`);
        await sleep(700);
        await page.eval(`document.querySelector('[data-action=motion-attach]')?.click()`);
        await sleep(900);
        await shot(page, '4-attached');
      } else {
        const held = await hold('Hop', 'crate', { shotWhat: '3-drag' });
        await sleep(300);
        await shot(page, '4-attached');
        // Every size since studio-motion-flow-2 (it was the phone only): Hop lands on the crate, and on nothing else.
        if (CHECKS) {
          const on = await j(`JSON.stringify(${TL}.usage('Hop').map((u) => u.key))`);
          check(on.length === 1 && on[0] === 'crate' && /crate/.test(held?.tag || ''), `${size.id} ${theme}: ${size.mobile ? 'a long press picks the tile up, the finger drops' : 'the mouse drops'} it on the crate (${on.join(', ')}; held: ${held?.tag})`);
        }
        await page.eval(`${TL}.setOpen(false)`);
        await sleep(300);
        await select('lighthouse');
        await fine(true);
        await sleep(300);
        // Every size and theme (studio-motion-flow-2, 2026-10-22): the lighthouse has no motion — no Motion row on its
        // card since studio-card-doors (plan step 3), and the strip's Make a motion opens the plate.
        const lh = await card();
        if (CHECKS) check(!!lh && !lh.row && !lh.make, `${size.id} ${theme}: the lighthouse's card (no motion) has no Motion row (${JSON.stringify(lh)})`);
        await fine(false);
        const mk = await strip('ctx-motion-make');
        await sleep(900);
        if (CHECKS) check(mk && !!(await state())?.open, `${size.id} ${theme}: the strip's Make a motion opens the timeline`);
        await fine(false);
        await sleep(400);
        await shot(page, '5-steps');
      }
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
