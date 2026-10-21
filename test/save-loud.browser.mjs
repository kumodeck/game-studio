// Save, loud (a try of the editor, 2026-10-21, B and C — src/shell/save-loud.ts): the screen test and its photos. A second look at
// the black "Save to game · 1" of the first answer: "nobody will notice that" → B and C:
//   C  the Save in the game filled with KUMO's orange, one small bounce when a change first appears
//   B  "Save to game" right beside ▶ Play while something is not saved; while playing, a strip over the game:
//      "This change isn't in the game yet  [Save to game]  ×"; Save takes them all away
// Steps (one object of examples/three-crates moved with the card, as a person types it):
//   0-open        nothing changed: no Save anywhere
//   1-edit        one change: orange Save in the game (bounced once) + Save beside Play
//   2-play        ▶ Play: the strip, Save beside Play (the one in the game steps away with the rest)
//   3-play-hide   × on the strip: the strip goes, Save beside Play stays
//   4-play-saved  Edit, Play again (the strip is back), Save on the strip: everything gone, placement.json written
// plus: a second change does not bounce again; with reduced motion nothing bounces.
// At PC 1280×800, the Claude app's side window 400×900 and a phone 390×844, light and dark.
//
//   node test/save-loud.browser.mjs --out <dir> [--tag after|before] [--ui <a built studio-ui folder>] [--lang ja|en]
//     [--only pc,side,phone] [--themes light,dark]
// --ui: the editor page photographed (default: this checkout's build), so "before" is shot from the old build with the
// same steps (the checks are then only printed). Exit 1 when a check fails.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = take('--out') ? resolve(take('--out')) : null;
const TAG = take('--tag', 'after');
const UI = resolve(take('--ui', join(HERE, 'skills/arrange/bin/studio-ui')));
const LANG = take('--lang', 'ja');
const ONLY = take('--only');
const THEMES = take('--themes', 'light,dark').split(',');
const STRICT = TAG !== 'before';
if (OUT) mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'side', width: 400, height: 900 },
  { id: 'phone', width: 390, height: 844, mobile: true },
];
let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : STRICT ? '✗' : '·'} ${what}`);
  if (!ok && STRICT) failed++;
};

// What is on screen: each box (page coordinates) with its words and fill, or null when not shown.
const STATE = `(() => {
  const box = (e) => { if (!e || e.hidden || !e.offsetParent) return null; const r = e.getBoundingClientRect(); if (!r.width) return null;
    const cs = getComputedStyle(e); return { l: r.left, t: r.top, r: r.right, b: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height,
      text: e.innerText.replace(/\\s+/g, ' ').trim(), bg: cs.backgroundColor, fg: cs.color }; };
  const fab = document.querySelector('[data-part=save-fab]');
  const play = [...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width);
  return JSON.stringify({
    fab: box(fab), bumps: Number(fab?.dataset.bumps || 0), top: box(document.querySelector('[data-part=save-top]')), play: box(play),
    strip: box(document.querySelector('[data-part=play-unsaved]')), stripSave: box(document.querySelector('[data-part=play-unsaved-save]')),
    stripHide: box(document.querySelector('[data-part=play-unsaved-hide]')), stage: box(document.querySelector('.stage')),
    note: (() => { const n = document.querySelector('.brand .here-note'); return n && !n.hidden && n.offsetParent ? n.textContent : ''; })(),
    playing: document.querySelector('.shell').dataset.playing === 'on', W: innerWidth,
  });
})()`;
const ORANGE = 'rgb(255, 107, 26)';
const WHITE = 'rgb(255, 255, 255)';

async function shoot(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-save-loud-'));
  cpSync(join(HERE, 'examples/three-crates'), root, { recursive: true, filter: (p) => !p.includes('/.studio/') && !p.endsWith('/.studio') && !p.endsWith('placement.json') });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {} });
  const browser = await launch();
  const name = (what) => join(OUT, `loud-${TAG}-${size.id}-${theme}-${what}.png`);
  const photo = async (page, what) => OUT && writeFileSync(name(what), await page.screenshot());
  console.log(`${TAG} ${size.id} ${theme}`);
  try {
    const page = await newPage(browser, size);
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    const state = async () => JSON.parse(await page.eval(STATE));
    const press = async (b) => (size.mobile ? page.tap(b.x, b.y) : page.click(b.x, b.y));
    const nudge = () => page.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); if (!i) return false; i.value = String((parseFloat(i.value) || 0) + 0.5); i.dispatchEvent(new Event('change')); return true; })()`);
    const until = async (fn, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (fn(await state())) return true;
        await sleep(200);
      }
      return false;
    };
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(1500);
    let s = await state();
    await photo(page, '0-open');
    check(!s.fab && !s.top && !s.strip, 'nothing changed: no Save anywhere');

    // One change.
    const k = await page.eval(`(() => { const i = studioShell.items().find((x) => x.movable !== false && !x.held); return i ? i.key : null; })()`);
    await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
    await sleep(800);
    await nudge();
    // The bounce, caught half-way (it is .48 s): the photo of 1-edit is taken after it settled.
    await sleep(900);
    s = await state();
    await photo(page, '1-edit');
    console.log(`  edit: fab "${s.fab?.text}" ${s.fab?.bg} · top "${s.top?.text}" · play "${s.play?.text}"`);
    check(!!s.fab && s.fab.bg === ORANGE && s.fab.fg === WHITE, `C: the Save in the game is orange with white words (${s.fab?.bg})`);
    check(s.bumps === 1, `C: it bounced once (${s.bumps})`);
    const narrow = size.id !== 'pc';
    const topWord = narrow ? (LANG === 'ja' ? '保存' : 'Save') : LANG === 'ja' ? '保存してゲームへ' : 'Save to game';
    check(!!s.top && s.top.text === topWord && s.top.bg === ORANGE, `B: "${topWord}" in orange in the top bar ("${s.top?.text}")`);
    check(!!s.top && !!s.play && s.play.l - s.top.r >= 0 && s.play.l - s.top.r <= 8 && Math.abs(s.play.y - s.top.y) < 2, 'B: right beside ▶ Play (left of it, same line)');
    check(!!s.top && s.top.l >= 0 && (!s.play || s.play.r <= s.W), 'B: the top bar still fits');

    // A second change: no second bounce.
    await nudge();
    await sleep(900);
    s = await state();
    check(s.bumps === 1, `C: the second change does not bounce again (${s.bumps})`);

    // ▶ Play.
    if (s.play) await press(s.play);
    await until((x) => x.playing);
    await sleep(2500);
    s = await state();
    await photo(page, '2-play');
    console.log(`  play: strip "${s.strip?.text}" (${Math.round(s.strip?.h || 0)} px) · top "${s.top?.text}"${s.note ? ` · note "${s.note}"` : ''}`);
    const stripWord = LANG === 'ja' ? 'この変更はまだゲームに入っていません' : 'not in the game yet';
    check(!!s.strip && s.strip.text.includes(stripWord), 'B: the strip over the game says the change is not in the game yet');
    check(!!s.stripSave && s.stripSave.bg === ORANGE, 'B: with the orange Save on it');
    check(!!s.strip && !!s.stage && s.strip.t >= s.stage.t && s.strip.t - s.stage.t <= 16 && s.strip.l >= 0 && s.strip.r <= s.W, 'B: at the top of the game, whole on screen');
    check(!!s.strip && s.strip.h <= (size.id === 'pc' ? 44 : 64), `B: low enough not to be in the way (${Math.round(s.strip?.h || 0)} px)`);
    check(!!s.top && !s.fab, 'B: Save beside Play stays; the one in the game steps away');
    check(!s.note, 'the old grey note after "Playing" is gone');

    // × on the strip.
    if (s.stripHide) {
      await press(s.stripHide);
      await sleep(600);
      s = await state();
      await photo(page, '3-play-hide');
      check(!s.strip && !!s.top, '×: the strip goes, Save beside Play stays');
    } else check(false, 'the strip has ×');

    // Edit, Play again: the strip is back for the new round; Save on it.
    if (s.play) await press(s.play);
    await until((x) => !x.playing);
    await sleep(1200);
    s = await state();
    check(s.bumps === 1, `back to Edit: no bounce (the change is not new) (${s.bumps})`);
    if (s.play) await press(s.play);
    await until((x) => x.playing);
    await sleep(2000);
    s = await state();
    check(!!s.strip, 'the next Play shows the strip again');
    if (s.stripSave) {
      await press(s.stripSave);
      await until((x) => !x.top && !x.strip, 6000);
      await sleep(600);
      s = await state();
      await photo(page, '4-play-saved');
      check(!s.strip && !s.top, 'Save on the strip: the strip and Save beside Play are gone');
      const file = join(root, 'placement.json');
      check(existsSync(file) && readFileSync(file, 'utf8').includes(k), 'placement.json written');
      check(s.playing, 'still playing');
    }
    // Back to Edit after Save: nothing to save, no Save anywhere.
    if (s.play) await press(s.play);
    await until((x) => !x.playing);
    await sleep(1200);
    s = await state();
    check(!s.fab && !s.top && !s.strip, 'saved: no Save anywhere in Edit');

    // Reduced motion: the next first change does not bounce.
    if (size.id === 'pc' && theme === THEMES[0]) {
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
      await sleep(600);
      await nudge();
      await sleep(900);
      s = await state();
      check(!!s.fab && s.bumps === 1, `reduced motion: Save shows, no bounce (${s.bumps})`);
    }
    await page.close();
  } catch (e) {
    check(false, `${size.id} ${theme}: ${e.message}`);
  } finally {
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const size of SIZES.filter((s) => !ONLY || ONLY.split(',').includes(s.id))) {
  for (const theme of THEMES) await shoot(size, theme);
}
console.log(`save-loud: ${OUT || '(no photos)'}${failed ? ` — ${failed} check(s) failed` : ''}`);
process.exit(failed ? 1 : 0);
