// studio-code-knobs (2026-10-24) in a headless browser: the two needs asked for that day, on screen.
//   1. "Things placed procedurally, motions made by maths: I want to fine-tune them by hand — but keep them procedural."
//   2. "Things placed by coordinates: I want to fix them by hand, as coordinates."
// Neon Run as the AI leaves it after "four hexagons in a row, 6 m apart; spin the pillar in a spiral": the hexagons are
// a codePlace('hex') (Gap and Count its knobs, a drag turns Gap), the pillar has codeMotion('spiral') on its timeline
// (Radius and Lap its knobs, a drag of its path's ◇ turns Radius). One language a run (`--lang en|ja`), dark then light:
//   layout  press a hexagon → the card's Layout ("Line · 4", Rule) with its knobs, violet rings in the game, the line under
//           the strip; Gap typed 6 → 4: the row closes up IN PLACE (the same game page: no reload), Save · 1; a hexagon
//           dragged toward the camera: Gap follows it (the chip "Gap 4 → x m"), the others too; ⌥-drag of another: just
//           that one (Manually overridden, its pin), the rest stays; "Place individually" on a third: all four put by
//           hand; ⌘Z ⌘Z ⌘Z: back to Gap 4 with none by hand.
//   motion  the pillar's timeline: the rule motion's strip ("Rule motion: Spiral · Radius 2 m · Lap 4 s"), its knobs on
//           the line, no "Repeat: Once"; the ◇ of its path dragged out: Radius 2 → 3 m; Disable / enable; "Make editable
//           points": a motion of points; ⌘Z back to the rule.
//   plain   (the first theme) a game with no rule (Neon Run as it is): the card and the list as before (no Layout, no tag).
// Pictures (`--shots <dir>`): 2-<lang>-<theme>-<step>.png (the plan's step-2 pictures).
//
//   node test/studio-code-place.browser.mjs [--lang en|ja] [--themes dark,light] [--width 1280] [--only layout,motion,plain] [--shots <dir>]
// Exit 1 on a failure.
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { askEditor } from '../src/server/hands-cli.mjs';
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
const LANG = take('--lang', 'ja');
const THEMES = take('--themes', 'dark,light').split(',').filter((x) => x === 'dark' || x === 'light');
const WIDTH = Number(take('--width', '1280'));
const PHONE = WIDTH < 500;
const ONLY = take('--only', 'layout,motion,plain').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = LANG === 'ja'
  ? { saved: '間 → 4 m', layout: '並べ方', line: '直線 · 4 個', tag: 'ルール', gap: '間', note: '動かすと間が変わる', pinned: 'この 1 個だけ手動で配置中', hand: '個別に配置', motion: '動きのルール', radius: '半径', points: '編集点にする', repeat: 'くり返し', off: '一時停止' }
  : { saved: 'Gap → 4 m', layout: 'Layout', line: 'Line · 4', tag: 'Rule', gap: 'Gap', note: 'Drag to adjust Gap', pinned: 'Manually overridden', hand: 'Place individually', motion: 'Rule motion', radius: 'Radius', points: 'Make editable points', repeat: 'Repeat', off: 'Disable' };

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

// The rule layout and the rule motion as the AI writes them (SKILL.md "Code layouts", "Motion"), in the person's language.
const RULES = `
    // Four hexagons in a row, "Gap" m apart toward the back (the AI's codePlace: the editor's knobs Gap and Count).
    codePlace('hex', {
      name: ${JSON.stringify(LANG === 'ja' ? '六角形' : 'hex')},
      knobs: { n: { v: 4, label: ${JSON.stringify(LANG === 'ja' ? '個数' : 'Count')}, unit: '', min: 1, max: 8, step: 1 }, gap: { v: 6, label: ${JSON.stringify(LANG === 'ja' ? '間' : 'Gap')}, unit: 'm', min: 2, max: 12 } },
      count: (k) => k.n,
      make: () => { const h = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .5, 6), glow(0xff6a1a, 1.3)); return h; },
      at: (i, k) => ({ p: [-2.4 + i * 1.6, .95, -4 - i * k.gap], r: [Math.PI / 2, 0, 0] }),
      drag: 'gap',
    });
    // The pillar's spiral (the AI's codeMotion: Radius and Lap the editor's knobs, a drag of its path turns Radius).
    codeMotion('spiral', {
      name: ${JSON.stringify(LANG === 'ja' ? 'らせん' : 'Spiral')},
      knobs: { radius: { v: 2, label: ${JSON.stringify(LANG === 'ja' ? '半径' : 'Radius')}, unit: 'm', min: .2, max: 6 }, lap: { v: 4, label: ${JSON.stringify(LANG === 'ja' ? '1 周' : 'Lap')}, unit: 's', min: .5, max: 20 } },
      round: (k) => k.lap,
      at: (t, k) => { const a = (t / k.lap) * 2 * Math.PI; return { p: [k.radius * Math.cos(a) - k.radius, 0, k.radius * Math.sin(a)] }; },
      drag: 'radius',
    });
`;
const MOTION_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [{ name: LANG === 'ja' ? 'らせん' : 'Spiral', code: 'spiral' }],
  motion: { pillar: { clips: [{ use: LANG === 'ja' ? 'らせん' : 'Spiral', when: { on: 'start' } }] } } };

/** Neon Run in a temporary folder: `rules` = with the hexagons as a rule layout and the pillar's rule motion. */
function makeGame(theme, rules) {
  const root = mkdtempSync(join(tmpdir(), 'studio-code-knobs-'));
  cpSync(join(PKG, 'test/neon-run'), root, { recursive: true });
  copyFileSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), join(root, 'studio-placement.js'));
  if (rules) {
    let html = readFileSync(join(root, 'index.html'), 'utf8')
      .replace("import { applyPlacement } from './studio-placement.js';", "import { applyPlacement, codeMotion, codePlace } from './studio-placement.js';");
    // The hand-placed loop out (the rule puts them now), the pillar standing still (the rule motion moves it).
    html = html.replace(/    const hexes = \[\];\n    for \(let i = 0; i < 4; i\+\+\) \{[\s\S]*?\n    \}\n/, `    const hexes = [];\n${RULES}`)
      .replace('      pillar.position.z += 6 * dt;\n      if (pillar.position.z > 8) pillar.position.z -= 40;\n', '');
    writeFileSync(join(root, 'index.html'), html);
    writeFileSync(join(root, 'placement.json'), JSON.stringify(MOTION_FILE, null, 2));
  }
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps', 'open-line'] }));
  return root;
}

const GW = `document.querySelector('iframe.game:not(.leaving)').contentWindow`;
const DBG = `${GW}.__gameStudio._debug`;
const ROW = `JSON.stringify([...${GW}[Symbol.for('game-studio.codePlaces')].get('hex').objs].map((o) => Math.round(o.position.z * 100) / 100))`;

async function run(theme, first) {
  console.log(`${LANG} ${theme} ${WIDTH}`);
  const root = makeGame(theme, true);
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: WIDTH, height: PHONE ? 844 : 800, mobile: PHONE, cdnCache: process.env.STUDIO_CDN_CACHE });
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `2-${LANG}-${theme}${PHONE ? '-phone' : ''}-${what}.png`), await page.screenshot());
    const ai = (ops) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
    const list = async () => (await ai([{ do: 'list' }])).results?.[0]?.list;
    const hexPlace = async () => (await list())?.places?.find((p) => p.id === 'hex');
    const at = async (key) => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)'); const r = f.getBoundingClientRect();
      const a = ${DBG}.anchor(${JSON.stringify(key)}); return a ? JSON.stringify({ x: r.left + a.center[0], y: r.top + a.center[1] }) : 'null'; })()`));
    // A phone's card folds its numbers (and a layout's knobs) under "…": opened before it is read.
    const card = () => page.eval(`(() => { const f = document.querySelector('[data-part=card] details.fine'); if (f && !f.open) f.open = true; return document.querySelector('[data-part=card]')?.innerText ?? ''; })()`);
    // …and folded again before a drag in the game (open, the sheet covers the hexagons on a phone).
    const fold = async () => (await page.eval(`(() => { const f = document.querySelector('[data-part=card] details.fine'); if (f && f.open && ${PHONE}) f.open = false; return 1; })()`), await sleep(300));
    const note = () => page.eval(`(() => { const h = [...${GW}.document.querySelectorAll('[data-studio-ui]')].map((x) => x.shadowRoot?.querySelector('.note')).find((n) => n && n.style.display !== 'none'); return h ? h.textContent : ''; })()`);
    const rings = () => page.eval(`${GW}.document.querySelector('[data-studio-code-place]')?.shadowRoot?.querySelectorAll('svg path').length ?? 0`);
    const saveN = () => page.eval(`document.querySelector('[data-part=save]')?.textContent ?? ''`);
    const key = async (k, modifiers = 0, code = k) => {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
    };
    const undoKey = () => key('z', 4, 'KeyZ');
    /** A mouse drag with modifiers (8 = Shift, 1 = ⌥), `mid` = a picture while the button is still down. */
    const drag = async (a, b, modifiers = 0, mid = null) => {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, modifiers });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
      for (let i = 1; i <= 12; i++) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12, button: 'left', buttons: 1, modifiers });
        await sleep(30);
      }
      if (mid) await mid();
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
      await sleep(500);
    };
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug`, 90000);
    await sleep(1500);

    if (ONLY.includes('layout')) {
      // ---- 1. press a hexagon: the card's Layout, the rings, the line ----
      await page.eval(`studioShell.actions.select('hex-2')`);
      await sleep(900);
      const c1 = await card();
      check(c1.includes(W.layout) && c1.includes(W.line) && c1.includes(W.tag), `the card says the layout: "${c1.replace(/\n/g, ' / ').slice(0, 120)}"`);
      check(await page.eval(`!!document.querySelector('[data-part=rule-knob-gap]') && !!document.querySelector('[data-part=rule-knob-n]')`), 'its knobs Gap and Count are on the card');
      check(await page.eval(`!document.querySelector('[data-part=card] .f-cells.n3')`), 'no Position numbers (the rule decides them)');
      check((await rings()) >= 8, `violet rings and the dotted line in the game (${await rings()} paths)`);
      check((await note()).includes(W.note), `the line under the strip: "${await note()}"`);
      check(JSON.parse(await page.eval(ROW)).join() === '-4,-10,-16,-22', `the rule put them 6 m apart (${await page.eval(ROW)})`);
      if (!PHONE) check((await page.eval(`document.querySelector('[data-action=card-more]')?.title ?? ''`)).includes(W.hand), 'the card\'s ⋯ has Place individually too');
      await shot('1-knob');

      // ---- 2. Gap typed 6 → 4: in place (the same page), Save · 1 ----
      await page.eval(`${GW}.__same = 1`);
      await card();
      await page.eval(`document.querySelector('[data-part=rule-knob-gap]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
      await sleep(200);
      await page.eval(`(() => { const f = document.querySelector('[data-part=rule-knob-gap-in]'); f.value = '4'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      await sleep(900);
      check(JSON.parse(await page.eval(ROW)).join() === '-4,-8,-12,-16', `Gap 4: the row closes up (${await page.eval(ROW)})`);
      check(await page.eval(`${GW}.__same === 1`), 'in place: the same game page (no reload)');
      check((await hexPlace())?.knobs?.gap?.v === 4, `the draft: gap 4 (${JSON.stringify((await hexPlace())?.knobs?.gap)})`);
      check(/1/.test(await saveN()), `Save · 1 ("${await saveN()}")`);
      await shot('2-gap4');

      // ---- 3. drag hex-2 toward the camera: Gap follows (the chip), the others too ----
      await fold();
      const a2 = await at('hex-2');
      const a1 = await at('hex-1');
      let chip = '';
      await drag(a2, { x: a2.x, y: a2.y + (a1.y - a2.y) * 0.4 }, 0, async () => {
        chip = await page.eval(`(() => { const h = [...${GW}.document.querySelectorAll('[data-studio-ui]')].map((x) => x.shadowRoot?.querySelector('.chip')).find((n) => n && n.style.display !== 'none'); return h ? h.textContent : ''; })()`);
        await shot('3-drag');
      });
      const g3 = (await hexPlace())?.knobs?.gap?.v;
      const row3 = JSON.parse(await page.eval(ROW));
      check(typeof g3 === 'number' && g3 < 4 && g3 >= 2, `the drag turned Gap: 4 → ${g3}`);
      check(row3.every((z, i) => Math.abs(z - (-4 - i * g3)) < 0.02), `every hexagon on the rule with it (${row3.join()})`);
      check(chip.includes(W.gap) && chip.includes('→'), `the chip while dragging: "${chip}"`);
      check(await page.eval(`${GW}.__same === 1`), 'still the same game page');
      await shot('3-dragged');

      // ---- 4. ⌥-drag hex-3: just that one (its pin), the rest stays ----
      await page.eval(`studioShell.actions.select('hex-3')`);
      await sleep(700);
      await fold();
      const a3 = await at('hex-3');
      await drag(a3, { x: a3.x - 120, y: a3.y }, 1);
      const p4 = await hexPlace();
      check(p4?.pins?.includes('hex-3'), `⌥: hex-3 put by hand (pins ${JSON.stringify(p4?.pins)})`);
      check(p4?.knobs?.gap?.v === g3, `Gap unchanged (${p4?.knobs?.gap?.v})`);
      check((await card()).includes(W.pinned), `the card: "${(await card()).replace(/\n/g, ' / ').slice(0, 80)}"`);
      await shot('4-one');

      // ---- 5. Place individually (hex-1's card) ----
      await page.eval(`studioShell.actions.select('hex-1')`);
      await sleep(700);
      await card();
      await page.eval(`document.querySelector('[data-part=rule-individually]').click()`);
      await sleep(900);
      const p5 = await hexPlace();
      check(p5?.hand === true && p5?.pins?.length === 4, `placed individually: hand, 4 pins (${JSON.stringify({ hand: p5?.hand, pins: p5?.pins })})`);
      check(!(await page.eval(`!!document.querySelector('[data-part=rule-layout]')`)), 'the card is an ordinary card now (Position)');
      await shot('5-individually');

      // ---- 6. ⌘Z ⌘Z ⌘Z: Gap 4, none by hand ----
      await page.eval(`document.activeElement?.blur()`);
      for (let i = 0; i < 3; i++) (await undoKey(), await sleep(500));
      const p6 = await hexPlace();
      check(p6?.knobs?.gap?.v === 4 && !p6?.hand && !p6?.pins?.length, `⌘Z ×3: back to Gap 4, none by hand (${JSON.stringify({ gap: p6?.knobs?.gap?.v, hand: p6?.hand, pins: p6?.pins })})`);
      check(JSON.parse(await page.eval(ROW)).join() === '-4,-8,-12,-16', `the row as at Gap 4 (${await page.eval(ROW)})`);
      await shot('6-undo');

      // ---- 7. Save: the receipt says the rule's number ("Saved: hex Gap → 4 m") ----
      await page.eval(`document.querySelector('[data-part=save]')?.click()`);
      await sleep(1500);
      const line = await page.eval(`[...document.querySelectorAll('.ai-line, .ask-news:not([hidden]), .toast.on')].map((e) => e.textContent).join(' | ')`);
      check(line.includes(W.saved), `the Save receipt: "${line.slice(0, 140)}"`);
      const saved = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      check(saved.places?.hex?.knobs?.gap?.v === 4 && saved.places.hex.knobs.gap.was === 6 && !Object.keys(saved.objects).some((k) => k.startsWith('hex-')),
        `placement.json: places.hex.knobs.gap { v: 4, was: 6 }, no hexagon in objects (${JSON.stringify(saved.places)})`);
      await shot('7-save');

      // ---- 8. tell them apart: a hand-placed gate shows no rings; the mouse over a hexagon shows its layout's ----
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      await page.eval(`studioShell.actions.select('gate')`);
      await sleep(700);
      await fold();
      check((await rings()) === 0, `the gate (by hand): no violet rings (${await rings()})`);
      const h3 = await at('hex-3');
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h3.x, y: h3.y });
      await sleep(400);
      check((await rings()) >= 8, `the mouse over a hexagon: its layout's rings (${await rings()} paths)`);
      await shot('8-tell');
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    }

    if (ONLY.includes('motion')) {
      // ---- 9. the pillar's rule motion on the timeline: the strip, its knobs on the line, no "Repeat" ----
      await page.eval(`studioShell.actions.select('pillar')`);
      await sleep(800);
      check((await card()).includes(W.tag), `the card's Motion row says Rule: "${(await card()).replace(/\n/g, ' / ').slice(0, 90)}"`);
      await page.eval(`document.querySelector('[data-part=motion-timeline-line]')?.click()`);
      await page.waitFor(`!!document.querySelector('[data-part=tl-rule]')`, 15000);
      await sleep(900);
      const words = await page.eval(`document.querySelector('[data-part=tl-rule-words]')?.textContent ?? ''`);
      check(words.includes(W.motion) && words.includes(W.radius) && words.includes('2 m'), `the strip: "${words}"`);
      check(await page.eval(`!!document.querySelector('[data-part=tl-knob-radius]') && !!document.querySelector('[data-part=tl-knob-lap]')`), 'its knobs Radius and Lap on the line');
      check(!(await page.eval(`!!document.querySelector('.tl-head [data-part=tl-rep]')`)), 'no "Repeat: Once" on the line');
      const pathN = () => page.eval(`${GW}.document.querySelector('[data-studio-code-motion]')?.shadowRoot?.querySelectorAll('svg path').length ?? 0`);
      check((await pathN()) >= 2, `its violet line in the game (${await pathN()} paths)`);
      await shot('9-strip');

      // ---- 10. the ◇ dragged out: Radius 2 → more ----
      const dia = JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect();
        const c = ${GW}.document.querySelector('[data-studio-code-motion]')?.shadowRoot?.querySelector('[data-code-knob]'); if (!c) return 'null';
        const r = c.getBoundingClientRect(); return JSON.stringify({ x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2 }); })()`));
      check(!!dia, `the ◇ is there (${JSON.stringify(dia)})`);
      const spiral = async () => (await list())?.motions?.find((m) => m.code === 'spiral');
      if (dia) {
        const pil = await at('pillar');
        const away = { x: dia.x + (dia.x - pil.x) * 0.5, y: dia.y + (dia.y - pil.y) * 0.5 };
        await drag(dia, away, 0, async () => await shot('10-diamond'));
        const r8 = (await spiral())?.knobs?.radius?.v;
        check(typeof r8 === 'number' && r8 > 2, `the ◇ turned Radius: 2 → ${r8}`);
        const w8 = await page.eval(`document.querySelector('[data-part=tl-rule-words]')?.textContent ?? ''`);
        check(w8.includes(`${r8}`), `the strip follows: "${w8}"`);
        await shot('10-radius');
      }

      // ---- 11. Disable, enable ----
      await page.eval(`document.querySelector('[data-part=tl-rule-sw]').click()`);
      await sleep(500);
      check(await page.eval(`!!document.querySelector('.tl-rule.off')`), 'disabled: the strip grey and dashed');
      await shot('11-off');
      await page.eval(`document.querySelector('[data-part=tl-rule-sw]').click()`);
      await sleep(500);
      check(await page.eval(`!document.querySelector('.tl-rule.off')`), 'enabled again');

      // ---- 12. Make editable points, ⌘Z back to the rule ----
      await page.eval(`document.querySelector('[data-part=tl-rule-points]').click()`);
      await sleep(1200);
      const pts = (await list())?.motions?.find((m) => m.name === (LANG === 'ja' ? 'らせん' : 'Spiral'));
      check(pts && !pts.code, `made into a motion of points (${JSON.stringify(pts).slice(0, 120)})`);
      check(await page.eval(`!document.querySelector('[data-part=tl-rule]')`), 'the strip is points now (no rule strip)');
      await shot('12-points');
      await page.eval(`document.activeElement?.blur()`);
      await undoKey();
      await sleep(800);
      check(!!(await spiral()), '⌘Z: the rule motion again');
      check(await page.eval(`!!document.querySelector('[data-part=tl-rule]')`), 'its strip again');
    }
  } finally {
    await browser.close();
    await srv.close();
  }
}

/** A game with no rule (Neon Run as it is): the card and the list as before — no Layout, no tag. */
async function plain(theme) {
  console.log(`${LANG} ${theme} ${WIDTH} plain`);
  const root = makeGame(theme, false);
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: WIDTH, height: PHONE ? 844 : 800, mobile: PHONE, cdnCache: process.env.STUDIO_CDN_CACHE });
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug`, 90000);
    await sleep(1200);
    await page.eval(`studioShell.actions.select('hex-2')`);
    await sleep(800);
    check(await page.eval(`!document.querySelector('[data-part=rule-layout]') && !document.querySelector('.rule-tag')`), 'no Layout on the card, no Rule tag in the list');
    check(await page.eval(`!!document.querySelector('[data-part=card] .f-cells.n3') || !!document.querySelector('[data-part=card]')`), 'the card as before');
    check(await page.eval(`!${GW}.document.querySelector('[data-studio-code-place]')`), 'no rings in the game');
  } finally {
    await browser.close();
    await srv.close();
  }
}

for (const [i, theme] of THEMES.entries()) {
  await run(theme, i === 0);
  if (i === 0 && ONLY.includes('plain')) await plain(theme);
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
