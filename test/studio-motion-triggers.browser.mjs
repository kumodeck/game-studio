// When a motion plays, and motions as Library assets (studio-motion-triggers, 2026-10-22: "a motion starts when an event
// happens, stops, or runs the whole game" / "treat a motion as one of the assets"), in a headless browser on Lantern
// Cove (3D, a copy of the starter). The checks (PC light):
//   1. a file of the timeline's first shape (the boat's clip with its own keys, start: true; the buoy's older spin)
//      opens with its motions in the Library and nothing counted as changed;
//   2. the strip (one line since studio-motion-panel; Stops and Try in its ⋯): Starts "The game starts" for the boat; changed to "A key is pressed" (E), Stops
//      after 2 rounds; the row's chip says so; the Try row gains an "E" ▶;
//   3. Try: ▶ Game starts — the boat waits; ▶ E — the boat moves (the loader's own rules, motionRunner); Stop;
//   4. Starts "The player enters an area": a box in the game, its point dragged moves the area (one undo step);
//   4b. one line: no second row, no words field; ▷ by Starts tries E; ✦ Ask AI puts "Rowboat · Row" in the chat box
//      with the cursor, a send carries the boat and Row (the chip stays); Starts "In the chat…" goes to the chat box too;
//   5. the Library's Motion filter: 2 motions; the boat's "Row" picked shows its detail (on rowboat), "Attach to" puts it
//      on the crate (the card's Motion menu then lists it, and "Take … off");
//   6. the ask box names the picked motion; sending writes a request with `motions`;
//   7. Save: placement.json has `motions` and the boat's `{ use: 'Row', when: key E, until: 2 rounds }`; the schema takes it;
//   8. ▶ Play: the starter's loader waits, E (in the game) starts the boat.
// And pictures (`--shots <dir> --no-checks`): PC 1280×800, the side window 400×900, a phone 390×844 × light and dark —
// `1-when` (the boat starts when the player enters the pier's area: the box and the row), `2-try` (Try: E pressed, the
// crate's Hop playing), `3-library` (the Motion filter, "Hop" picked with its detail), `4-ask` (✦ Ask AI on the crate's
// Hop: the chat box's "crate · Hop" chip with the person's words).
//
//   node test/studio-motion-triggers.browser.mjs [--shots <dir>] [--only pc,side,phone] [--themes light,dark] [--lang en|ja] [--no-checks]
// Exit 1 on a failure.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const SAVE = `(() => { const b = [...document.querySelectorAll('[data-part=save], [data-part=save-fab]')].find((x) => !x.hidden && x.offsetParent); return b ? b.textContent : ''; })()`;
/** Change a <select> on the page (a native menu cannot be clicked headless). */
const choose = (part, value) => `(() => { const s = document.querySelector('[data-part=${part}]'); if (!s) return false; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;

// The checks start from the timeline's first shape: the boat's own keys (start: true) and the buoy's older spin.
const OLD_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, motion: {
  rowboat: { clips: [{ name: 'Row', len: 3, repeat: 'pingpong', start: true, keys: {
    p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 1.2, -1.5] }, { t: 3, v: [-5, 0, 0] }] } }] },
  buoy: { spin: 1.5708 },
} };
// The pictures start from the new shape: Library motions, the boat waiting for the pier's area, the crate for E, the
// barrel for a cue the AI connects.
const NEW_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    { name: 'Row', len: 3, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 1.2, -1.5] }, { t: 3, v: [-5, 0, 0] }] } },
    { name: 'Bob', len: 2, repeat: 'pingpong', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 0.4, 0] }] } },
    { name: 'Hop', len: 0.8, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.4, v: [0, 1.4, 0] }, { t: 0.8, v: [0, 0, 0] }] } },
    { name: 'Roll', len: 1.5, keys: { r: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [0, 0, 6.2832] }] } },
  ],
  motion: {
    rowboat: { clips: [{ use: 'Row', when: { on: 'enter', area: { p: [10, 0.5, 4], size: [4, 2, 3] }, who: 'player' } }] },
    buoy: { clips: [{ use: 'Bob', when: { on: 'start' } }] },
    crate: { clips: [{ use: 'Hop', when: { on: 'key', key: 'KeyE' }, until: { times: 3 } }] },
    barrel: { clips: [{ use: 'Roll', when: { on: 'cue', cue: 'barrel-hit' } }] },
  } };

async function run(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-motion-triggers-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  // The first-time steps (studio-motion-flow) closed already: this test and its pictures are about the "when".
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps'] }));
  const full = CHECKS && size.id === 'pc' && theme === THEMES[0];
  writeFileSync(join(root, 'placement.json'), JSON.stringify(full ? OLD_FILE : NEW_FILE, null, 2));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const shot = async (page, what) => SHOTS && writeFileSync(join(SHOTS, `after-${size.id}-${theme}-${what}.png`), await page.screenshot());
  console.log(`${size.id} ${theme}${full ? ' (checks)' : ''}`);
  try {
    const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const state = () => j(`JSON.stringify(${TL}.state())`);
    const pose = (k) => j(`JSON.stringify(${DBG}.anchor(${JSON.stringify(k)}).pose)`);
    // The strip is one line since studio-motion-panel: Starts on it, Stops and every cue to Try in its ⋯ (opened first).
    const openMore = async () => {
      if (await j(`JSON.stringify(!!document.querySelector('[data-part=tl-more]'))`)) return;
      await page.eval(`(document.querySelector('[data-part=tl-more-btn]') || { click() {} }).click()`);
      await sleep(300);
    };
    const whenRow = async () => {
      await openMore();
      return j(`(() => { const r = document.querySelector('[data-part=tl-head]'); const m = document.querySelector('[data-part=tl-more]'); if (!r || !m) return null;
      return JSON.stringify({ starts: r.querySelector('[data-part=tl-starts]')?.value ?? null, stops: m.querySelector('[data-part=tl-stops]')?.value ?? null,
        cues: [...m.querySelectorAll('[data-part=tl-cue]')].map((b) => ({ id: b.dataset.cue, on: b.classList.contains('on'), ai: b.classList.contains('ai') })),
        chips: [...document.querySelectorAll('[data-part=tl-whenchip]')].map((c) => c.textContent) }); })()`);
    };
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
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(2500);
    if (full) {
      // 1. The timeline's first shape: in the Library, not a change.
      check(!/[1-9]/.test(await page.eval(SAVE)), `a file of the first shape is not a change ("${(await page.eval(SAVE)).trim()}")`);
      await openTimeline('rowboat');
      let w = await whenRow();
      check(w?.starts === 'start', `Starts: the boat's start: true reads as "The game starts" (${w?.starts})`);
      check(w?.cues.some((c) => c.id === 'start'), 'Try has "Game starts"');
      // 2. Starts: a key (E); Stops after 2 rounds.
      await page.eval(choose('tl-starts', 'key'));
      await sleep(400);
      await page.eval(choose('tl-stops', 'times'));
      await sleep(400);
      await page.eval(`(() => { const f = document.querySelector('[data-part=tl-times]'); f.value = '2'; f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await sleep(400);
      w = await whenRow();
      check(w?.starts === 'key' && w?.stops === 'times', `Starts "A key is pressed", Stops after rounds (${w?.starts}, ${w?.stops})`);
      const cap = await page.eval(`document.querySelector('[data-part=tl-key-pick]')?.textContent`);
      check(cap === 'E', `the key is E (${cap})`);
      check(w?.cues.some((c) => c.id === 'key:KeyE'), `Try gains ▶ E (${w?.cues.map((c) => c.id).join(', ')})`);
      check(w?.chips.some((c) => /E · 2×/.test(c)), `the boat's row says so (${w?.chips.join(' | ')})`);
      check(/[1-9]/.test(await page.eval(SAVE)), `Save counts it ("${(await page.eval(SAVE)).trim()}")`);
      // 3. Try.
      const home = await pose('rowboat');
      await page.eval(`document.querySelector('[data-part=tl-cue][data-cue=start]').click()`);
      await sleep(700);
      const waited = await pose('rowboat');
      check(Math.hypot(waited.p[0] - home.p[0], waited.p[2] - home.p[2]) < 1e-3, 'Try ▶ Game starts: the boat waits for E');
      await page.eval(`document.querySelector('[data-part=tl-cue][data-cue="key:KeyE"]').click()`);
      await sleep(700);
      const moved = await pose('rowboat');
      const st = await state();
      check(Math.hypot(moved.p[0] - home.p[0], moved.p[2] - home.p[2]) > 0.05 && st.trying && st.lit.rowboat === 'Row', `Try ▶ E: the boat rows (${moved.p.map((v) => v.toFixed(2))}, ${JSON.stringify(st.lit)})`);
      w = await whenRow();
      check(w?.cues.find((c) => c.id === 'key:KeyE')?.on, 'the E ▶ lights while it plays');
      await page.eval(`document.querySelector('[data-part=tl-try-stop]').click()`);
      await sleep(500);
      check(!(await state()).trying, 'Stop ends trying');
      // 4. An area.
      await page.eval(choose('tl-starts', 'enter'));
      await sleep(700);
      const area = await j(`(() => { const f = document.querySelector('iframe'); const h = f.contentDocument.querySelector('[data-studio-timeline]'); const c = h && h.shadowRoot.querySelector('[data-part=tl-area]');
        if (!c) return null; const o = f.getBoundingClientRect(); return JSON.stringify({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), ox: o.left, oy: o.top }); })()`);
      check(!!area, 'The player enters an area: a box in the game with its point');
      if (area) {
        await page.eval(`(() => { const f = document.querySelector('iframe'); const w = f.contentWindow;
          const at = (type, x, y) => w.dispatchEvent(new w.PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 9, button: 0, pointerType: 'mouse' }));
          const hit = f.contentDocument.querySelector('[data-studio-timeline]').shadowRoot.querySelector('[data-part=tl-area]');
          hit.dispatchEvent(new w.PointerEvent('pointerdown', { clientX: ${area.x}, clientY: ${area.y}, bubbles: true, composed: true, pointerId: 9, button: 0, pointerType: 'mouse' }));
          for (let i = 1; i <= 6; i++) at('pointermove', ${area.x} - i * 15, ${area.y});
          at('pointerup', ${area.x} - 90, ${area.y}); return true; })()`);
        await sleep(600);
        const tip = await page.eval(`(document.querySelector('[data-action=undo]') || {}).title || ''`);
        check(/motion|動き/.test(tip), `the area's drag is one undo step ("${tip.split('\n')[0]}")`);
      }
      // Back to E (for Save and Play below).
      await page.eval(choose('tl-starts', 'key'));
      await sleep(500);
      // 4b. One line (studio-motion-panel, a review of 2026-10-22): no second row; ▷ tries this motion; ✦ Ask AI → the chat box.
      const line = await j(`(() => { const h = document.querySelector('[data-part=tl-head]'); return JSON.stringify({ h: h.getBoundingClientRect().height,
        second: !!document.querySelector('[data-part=tl-when-row]'), when: !!document.querySelector('[data-part=tl-when]'), tryThis: (document.querySelector('[data-part=tl-try-this]') || {}).dataset?.cue ?? null,
        ask: !!document.querySelector('[data-part=tl-ask]') }); })()`);
      check(line && line.h <= 52 && !line.second && !line.when, `the strip is one line, no words field (${line?.h}px)`);
      check(line?.tryThis === 'key:KeyE' && line.ask, `▷ by Starts tries E (${line?.tryThis}); ✦ Ask AI is on the line`);
      await page.eval(`document.querySelector('[data-part=tl-ask]').click()`);
      await sleep(600);
      const asked = await j(`JSON.stringify({ chip: (document.querySelector('[data-part=ask] .ask-chip') || {}).textContent || '', focus: document.activeElement === document.querySelector('[data-part=ask] input'),
        ph: (document.querySelector('[data-part=ask] input') || {}).placeholder || '' })`);
      check(/· Row$/.test(asked.chip) && asked.focus, `✦ Ask AI: the chat box's chip "${asked.chip}", the cursor in it`);
      await page.eval(`(() => { const i = document.querySelector('[data-part=ask] input'); i.value = 'Start it when the player walks up'; i.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-part=ask]').requestSubmit(); return true; })()`);
      await sleep(1500);
      const askDir = join(root, '.studio/requests');
      const mine = (existsSync(askDir) ? readdirSync(askDir) : []).filter((f) => f.includes('-ask-')).map((f) => JSON.parse(readFileSync(join(askDir, f), 'utf8'))).find((r) => /walks up$/.test(r.text));
      check(mine?.motions?.[0]?.name === 'Row' && JSON.stringify(mine.objects).includes('rowboat'), `the request is about the boat and Row: ${JSON.stringify({ o: mine?.objects?.map?.((o) => o.key ?? o), m: mine?.motions })?.slice(0, 160)}`);
      const after = await page.eval(`(document.querySelector('[data-part=ask] .ask-chip') || {}).textContent || ''`);
      check(/· Row$/.test(after), `after sending, the chip stays for the next words ("${after}")`);
      // Starts ▾ "In the chat, to your AI…": the chat box with the chip (no field on the line); then back to E.
      await page.eval(choose('tl-starts', 'say'));
      await sleep(600);
      const said = await j(`JSON.stringify({ focus: document.activeElement === document.querySelector('[data-part=ask] input'), when: !!document.querySelector('[data-part=tl-when]') })`);
      check(said.focus && !said.when, 'Starts ▾ "In the chat…": the cursor goes to the chat box, no field on the line');
      await page.eval(choose('tl-starts', 'key'));
      await sleep(500);
      // 5. The Library: Motion.
      await page.eval(`studioShell.actions.switchTool('library')`);
      await sleep(1200);
      const chip = await j(`(() => { const c = document.querySelector('.shelf-filters [data-shelf=motion]'); return c ? JSON.stringify(c.textContent) : null; })()`);
      check(!!chip && /2/.test(chip), `the Library's filters have Motion (${chip})`);
      await page.eval(`document.querySelector('.shelf-filters [data-shelf=motion]').click()`);
      await sleep(600);
      const tiles = await j(`JSON.stringify([...document.querySelectorAll('[data-kind=motion].gsl-tile')].map((t) => t.dataset.motion))`);
      check(tiles?.length === 2 && tiles.includes('Row'), `its tiles: ${tiles?.join(', ')}`);
      await page.eval(`document.querySelector('.gsl-tile[data-motion="Row"]').click()`);
      await sleep(600);
      const det = await j(`(() => { const d = document.querySelector('[data-part=motion-detail]'); return d ? JSON.stringify({ title: d.querySelector('[data-part=motion-title]')?.textContent, users: [...d.querySelectorAll('.lib-motion-user')].map((u) => u.dataset.key) }) : null; })()`);
      check(det?.title === 'Row' && det.users.includes('rowboat'), `Row's detail: on ${det?.users?.join(', ')}`);
      await page.eval(choose('motion-attach-to', 'crate'));
      await sleep(600);
      const onCrate = await j(`JSON.stringify(${TL}.usage('Row').map((u) => u.key))`);
      check(onCrate.includes('crate'), `"Attach to" crate (${onCrate.join(', ')})`);
      // Since studio-motion-flow an attach shows it in the Scene ("When does it move?"): back to the Library's Motion.
      await page.eval(`studioShell.actions.switchTool('library')`);
      await sleep(1000);
      await page.eval(`document.querySelector('.shelf-filters [data-shelf=motion]').click()`);
      await sleep(500);
      // 6. The ask box names the motion; a request carries it.
      await page.eval(`document.querySelector('.gsl-tile[data-motion="Row"]').click()`);
      await sleep(300);
      await page.eval(`document.querySelector('.gsl-tile[data-motion="Row"]').click()`);
      await sleep(500);
      const askChip = await page.eval(`(document.querySelector('[data-part=ask] .ask-chip') || {}).textContent || ''`);
      check(/Row/.test(askChip), `the ask box's chip names it ("${askChip}")`);
      await page.eval(`(() => { const i = document.querySelector('[data-part=ask] input'); i.value = 'Make the crate row when the player walks up'; i.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-part=ask]').requestSubmit(); return true; })()`);
      await sleep(1500);
      const reqDir = join(root, '.studio/requests');
      const reqs = existsSync(reqDir) ? readdirSync(reqDir).filter((f) => f.includes('-ask-')).map((f) => JSON.parse(readFileSync(join(reqDir, f), 'utf8'))) : [];
      const req = reqs.find((r) => r.motions && /^Make the crate/.test(r.text));
      check(!!req && req.motions[0].name === 'Row' && req.motions[0].on.some((o) => o.key === 'crate'), `the request has motions: ${JSON.stringify(req?.motions)?.slice(0, 160)}`);
      // The card: the crate's Motion menu lists its motion, the Library's others, and "Take … off".
      await page.eval(`studioShell.actions.switchTool('placement')`);
      await sleep(800);
      await page.eval(`studioShell.actions.select('crate')`);
      await sleep(800);
      const opts = await j(`JSON.stringify([...document.querySelectorAll('[data-part=card] [data-part=motion-clip] option')].map((o) => o.value))`);
      check(opts.includes('Row') && opts.includes('attach:Motion') && opts.includes('detach'), `the crate's Motion menu: ${opts.join(', ')}`);
      // 7. Save.
      await page.eval(`studioShell.actions.save()`);
      await sleep(1500);
      const f = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      check(f.motions?.some((m) => m.name === 'Row' && m.keys?.p?.length === 3), `placement.json motions: ${f.motions?.map((m) => m.name).join(', ')}`);
      const rb = f.motion?.rowboat?.clips?.[0];
      check(rb?.use === 'Row' && rb.when?.on === 'key' && rb.when.key === 'KeyE' && rb.until?.times === 2 && !rb.keys, `rowboat: ${JSON.stringify(rb)}`);
      check(f.motion?.crate?.clips?.[0]?.use === 'Row', 'crate uses Row too');
      const v = validateStudioFile(f, { tool: 'placement' });
      check(v.ok, `the schema takes the file${v.ok ? '' : ': ' + v.errors.join('; ')}`);
      // 8. ▶ Play: the loader waits for E.
      const play = await j(`(() => { const b = [...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      await page.click(play.x, play.y);
      const PLAY = `[...document.querySelectorAll('iframe')].map((f) => f.contentWindow.__gameStudio && f.contentWindow.__gameStudio._play).find(Boolean)`;
      const WIN = `[...document.querySelectorAll('iframe')].find((f) => f.contentWindow.__gameStudio && f.contentWindow.__gameStudio._play).contentWindow`;
      await page.waitFor(`(() => { const p = ${PLAY}; return !!p && p.list().length > 0; })()`, 30000);
      await sleep(1500);
      const boat = async () => j(`JSON.stringify((${PLAY}.list().find((i) => i.key === 'rowboat') || {}).pose)`);
      const p0 = await boat();
      await sleep(500);
      const p1 = await boat();
      check(!!p0 && JSON.stringify(p0.p) === JSON.stringify(p1.p), 'Play: the boat waits for E');
      await page.eval(`(() => { const w = ${WIN}; w.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyE', key: 'e', bubbles: true })); return true; })()`);
      await sleep(700);
      const p2 = await boat();
      check(!!p2 && JSON.stringify(p2.p) !== JSON.stringify(p1.p), `Play: E — the loader starts it (${p2?.p?.map((x) => x.toFixed(2))})`);
    } else {
      // Pictures. 1: the boat waits for the pier's area (the box in the game, the row's chip).
      await openTimeline('rowboat');
      await page.eval(`${TL}.setTime(1.5)`);
      await sleep(900);
      await shot(page, '1-when');
      // 2: Try — the game started (the buoy bobs), E pressed (the crate hops).
      await page.eval(`studioShell.actions.select('crate')`);
      await sleep(700);
      await openMore();
      await page.eval(`document.querySelector('[data-part=tl-cue][data-cue=start]').click()`);
      await sleep(400);
      await page.eval(`document.querySelector('[data-part=tl-cue][data-cue="key:KeyE"]').click()`);
      await sleep(350);
      await shot(page, '2-try');
      await page.eval(`document.querySelector('[data-part=tl-try-stop]')?.click()`);
      await sleep(300);
      // 4: ✦ Ask AI on the crate's Hop — the chat box's chip and the person's words (studio-motion-panel).
      await page.eval(`document.querySelector('[data-part=tl-more-btn].on')?.click()`);
      await sleep(200);
      await page.eval(`document.querySelector('[data-part=tl-ask]')?.click()`);
      await sleep(500);
      await page.eval(`(() => { const i = document.querySelector('[data-part=ask] input'); i.value = ${JSON.stringify(LANG === 'ja' ? 'プレイヤーが近づいたら動き出して' : 'Start it when the player walks up')}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await sleep(300);
      await shot(page, '4-ask');
      // 3: the Library, Motion, Hop picked.
      await page.eval(`studioShell.actions.switchTool('library')`);
      await sleep(1200);
      await page.eval(`document.querySelector('.shelf-filters [data-shelf=motion]')?.click()`);
      await sleep(500);
      await page.eval(`document.querySelector('.gsl-tile[data-motion="Hop"]')?.click()`);
      await sleep(900);
      await shot(page, '3-library');
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
