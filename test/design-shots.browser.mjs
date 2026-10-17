// Screenshots of every screen the design pass looks at, the same steps each
// time, so "before" and "after" pictures line up one to one.
//
//   node test/design-shots.browser.mjs [example ...] --shots <dir> [--tag before|after] [--prefix apple|visual] [--lang ja] [--rules]
//
// For each example at 1280×800 (mouse) and 390×844 (touch): first screen,
// one object picked (handles showing, their names on the first pick), an
// object with no name (2D), several picked, saved, "Ideas for your AI", the
// Library, the Look page, the light theme, and the help line ("?") where there is one. It checks only that each
// screen opens (no assertions about the look): the look is judged by eye
// from the pictures, and the other browser tests cover behaviour.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const SHOTS = resolve(take('--shots') || join(tmpdir(), 'studio-apple-shots'));
const TAG = take('--tag') || 'now';
// File name prefix: each design pass keeps its own set (apple-…, visual-…).
const PREFIX = take('--prefix') || 'apple';
const LANG = take('--lang') || 'ja';
// --rules: give the game a .studio/studio.json (grid, 45° steps, the picked
// kind's height fixed and size 0.5–2) and take only the "rules" picture (the
// card with the rules and the numbers open). The samples have no rules file.
const RULES = args.includes('--rules') ? (args.splice(args.indexOf('--rules'), 1), true) : false;
const EXAMPLES = args.length ? args : ['three-crates', 'pixi-garden'];
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio._debug`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`,
  list: `JSON.stringify(${DBG}.list())`,
  click: (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent && e.checkVisibility()); if (!el || el.disabled) return false; el.scrollIntoView({ block: 'nearest' }); el.click(); return true; })()`,
  visible: (sel) => `!![...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent && e.checkVisibility())`,
};

async function run(example, layout) {
  const mobile = layout === 'phone';
  const tag = `${PREFIX}-${TAG}-${example}-${mobile ? '390' : '1280'}`;
  const root = mkdtempSync(join(tmpdir(), `studio-design-${example}-`));
  cpSync(join(PKG, 'examples', example), root, { recursive: true });
  rmSync(join(root, 'placement.json'), { force: true });
  rmSync(join(root, '.studio/requests'), { recursive: true, force: true });
  rmSync(join(root, '.studio/status.json'), { force: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  if (RULES) {
    writeFileSync(join(root, '.studio/studio.json'), JSON.stringify({ version: 1, snap: { grid: example.startsWith('three') ? 1 : 8, angle: 45 },
      rules: [{ match: 'barrel*', lockHeight: true, scale: { min: 0.5, max: 2 } }, { match: 'house*', scale: { min: 0.5, max: 2 } }] }));
  }
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  let n = 0;
  const shot = async (name) => {
    n++;
    await sleep(450);
    writeFileSync(join(SHOTS, `${tag}-${n}-${name}.png`), await page.screenshot());
    console.log(`  ✓ ${tag}-${n}-${name}`);
  };
  const press = async (sel) => {
    if (process.env.DS_TRACE) console.log(`    press ${sel}`);
    if (!(await page.eval(IN.click(sel)))) throw new Error(`no enabled, visible ${sel}`);
    await sleep(250);
  };
  const tryPress = async (sel) => page.eval(IN.click(sel));
  // Since the rebrand (2026-10-16) Ideas and the Look page are rows of the ⌘K list (press the ask field).
  const palette = async (action) => {
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); })()`);
    await sleep(200);
    await press(`.palette [data-action=${action}]`);
  };
  const list = async () => JSON.parse(await page.eval(IN.list));
  const openSheet = async () => {
    if (mobile && !(await page.eval(IN.visible('.placement, .page-head, .tool-mount')))) await press('[data-action=sheet]');
  };
  const backToList = async () => {
    await openSheet();
    await tryPress('.page-head > .link');
    if (!(await page.eval(IN.visible('.placement')))) await press('[data-tool=placement]');
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 30000);
    await sleep(800);
    // 1. First screen (phone: sheet closed, then open).
    await shot('open');
    if (mobile) {
      await openSheet();
      await shot('open-list');
    }
    const items = await list();
    const named = items.filter((i) => !i.unstable && i.movable !== false && !i.backdrop);
    const pick = named.find((i) => /tree|barrel|house/i.test(i.label || i.key)) || named[0];
    // 2. One object picked: card + handles in the game.
    await backToList();
    await press(`li.obj[data-key="${pick.key}"]`);
    await sleep(500);
    await shot('selected');
    if (RULES) {
      await tryPress('.card details.fine > summary');
      await shot('rules');
      return;
    }
    // 3. An object with no name (2D gardens have two).
    const noName = items.find((i) => i.unstable);
    if (noName) {
      await press(`li.obj[data-key="${noName.key}"]`);
      await sleep(400);
      await shot('noname');
    }
    // 4. Several picked with "Select several".
    const two = named.filter((i) => i.key !== pick.key).slice(0, 2);
    await press(`li.obj[data-key="${pick.key}"]`);
    await press('[data-action=multi]');
    for (const it of two) await press(`li.obj[data-key="${it.key}"]`);
    await sleep(400);
    await shot('many');
    await press('[data-action=multi]');
    await tryPress('[data-action=select-none]');
    // 5. Move one object by a typed number, then save.
    await press(`li.obj[data-key="${pick.key}"]`);
    await tryPress('.card details.fine > summary');
    await page.eval(`(() => { const i = document.querySelector('.card .fine .num input'); i.value = String(Number(i.value) + 1); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(300);
    await tryPress('.card details.fine > summary');
    await shot('unsaved');
    await press('[data-action=save]');
    await sleep(600);
    await shot('saved');
    // 5b. Ask about the picked object; the line keeps the words.
    const typeAsk = async (text) => {
      await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.value = ''; i.focus(); })()`);
      await page.send('Input.insertText', { text });
      await sleep(150);
    };
    await typeAsk(LANG === 'ja' ? 'あと 3 つ並べて' : 'add 3 more in a row');
    await press('[data-action=ask-ai]');
    await sleep(700);
    await shot('asked');
    // 5c. The AI answers "done" (written the way the agent writes it: studio.mjs --status).
    const reqDir = join(root, '.studio/requests');
    const last = readdirSync(reqDir).filter((f) => f.endsWith('.json')).sort().pop().replace(/\.json$/, '');
    writeFileSync(join(root, '.studio/status.json'), JSON.stringify({ version: 1, state: 'done', request: last, handled: [last], changed: 3,
      note: LANG === 'ja' ? '3 つ並べて置きました' : 'Put 3 in a row', at: new Date().toISOString() }));
    await sleep(4500);
    await shot('ai-done');
    // 5c2. Stand in for the AI's change: move one saved object in placement.json
    // (both examples apply it when they start), reload from the AI line, see
    // the "AI" marks and select what changed.
    const placed = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
    const moved = placed.objects[pick.key];
    if (moved) {
      moved.p[0] += example.startsWith('three') ? 1.5 : 60;
      writeFileSync(join(root, 'placement.json'), JSON.stringify(placed));
      if (await tryPress('[data-action=ai-reload]')) {
        await page.waitFor(IN.ready, 30000);
        await sleep(1500);
        await openSheet();
        await shot('ai-changed');
        if (await tryPress('[data-action=ai-show]')) {
          await sleep(500);
          await shot('ai-show');
        }
        await tryPress('[data-action=select-none]');
      }
    }
    // 5c3. Drag a number's label (PC: a mouse held on "x" and moved right).
    if (!mobile) {
      await press(`li.obj[data-key="${pick.key}"]`);
      await tryPress('.card details.fine > summary');
      const at = JSON.parse(await page.eval(`(() => { const r = document.querySelector('.card .num .scrub').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 8; i++) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + i * 10, y: at.y, button: 'left', buttons: 1 });
        await sleep(30);
      }
      await shot('scrub');
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x + 80, y: at.y, button: 'left', clickCount: 1 });
      await tryPress('.card details.fine > summary');
      // One undo step for the whole drag; taking it keeps the later steps
      // free of unsaved changes (Play would stop on its confirm box).
      await page.eval(`window.studioShell.actions.undo()`);
    }
    // 5d. Nothing picked: the strip asks about the whole game.
    await page.eval(`window.studioShell.actions.select(null)`);
    await typeAsk(LANG === 'ja' ? '夜にして' : 'make it night');
    await shot('ask-game');
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.value = ''; i.dispatchEvent(new Event('input')); i.blur(); })()`);
    // 5e. Playing.
    await press('[data-action=play]');
    await sleep(1500);
    await shot('play');
    await press('[data-action=play]');
    await page.waitFor(IN.ready, 30000);
    await sleep(600);
    // 6. "Ideas for your AI" (next steps).
    await palette('next');
    await sleep(300);
    await shot('next');
    // 7. Library (a page in the side closes first: its "‹ Close" is the way back).
    await openSheet();
    await tryPress('.page-head > .link');
    await press('[data-tool=library]');
    await sleep(900);
    await shot('library');
    // 7b. A file's detail opens with "In the scene: N"; pressing it selects those objects.
    const tiles = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.gsl-tile[data-path]')].map(t => t.dataset.path))`));
    for (const path of tiles) {
      await press(`.gsl-tile[data-path="${path}"]`);
      await sleep(250);
      if (await page.eval(IN.visible('.gsl-scene-all'))) break;
    }
    if (await page.eval(IN.visible('.gsl-scene-all'))) {
      await page.eval(`document.querySelector('.gsl-detail')?.scrollIntoView({ block: 'start' })`);
      await sleep(200);
      await shot('asset-detail');
      await press('.gsl-scene-all');
      await sleep(600);
      await shot('asset-to-scene');
      await tryPress('[data-action=select-none]');
      await openSheet();
      await press('[data-tool=library]');
      await sleep(400);
    }
    // 8. Look page.
    await palette('settings');
    await sleep(300);
    await shot('look');
    // 9. The light theme (the Look page's "Light"), one object picked.
    if (await tryPress('[data-ui=theme-light]')) {
      await backToList();
      await press(`li.obj[data-key="${pick.key}"]`);
      await sleep(400);
      await shot('light');
    }
    // 10. The how-to help ("?"), when the page has one.
    await backToList();
    if (await tryPress('[data-action=help]')) {
      await sleep(300);
      await shot('help');
    }
  } finally {
    await page.close();
    await browser.close?.();
    await srv.close?.();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const ex of EXAMPLES) {
  for (const layout of ['pc', 'phone']) {
    console.log(`${ex} ${layout}`);
    await run(ex, layout);
  }
}
console.log('EXIT 0');
process.exit(0);
