// One Save (a try of v0.1.9, 2026-10-21 — src/shell/save-loud.ts): the screen test and its photos. History: "Save, loud" the
// same day (B and C) put an orange Save in the game's corner AND an orange "Save to game" beside ▶ Play; a try of it:
// "why are there two buttons that do the same thing?" and "'Save to game' — I don't get what that means". Now:
//   - ONE Save, beside ▶ Play, in Edit and in Play, on every width: orange, "Save · N", one bounce when a change first
//     appears; its tooltip is one sentence ("Save, and Claude puts it in the game's code")
//   - ▶ Play with changes asks first: Save and play / Try without saving (unsaved-guard.ts; the same day, "let them
//     choose with buttons"); once playing, nothing more over the game (the strip "This change isn't in the game yet
//     [Save] ×" went then)
//   - no Save in the game's corner, no "Save to game" anywhere
// Steps (one object of examples/three-crates moved with the card, as a person types it):
//   0-open        nothing changed: no Save anywhere
//   1-edit        one change: the one Save beside Play (orange, bounced once)
//   2-play        ▶ Play → the window → Try without saving: the same Save beside Play, nothing over the game
//   3-play-saved  Edit, ▶ Play again → Save and play: no Save left, placement.json written, playing
//   4-edit-saved  back in Edit: "✓ Saved" left of Undo, no Save
// (Photos taken with this file before that change have steps 3-play-hide / 4-play-saved / 5-edit-saved: the strip.)
// plus: a second change does not bounce again; with reduced motion nothing bounces; the press beside Play saves too.
// At PC 1280×800, the Claude app's side window 400×900, a phone 390×844 and a small phone 320×568, light and dark.
//
//   node test/save-loud.browser.mjs --out <dir> [--tag after|before] [--ui <a built studio-ui folder>] [--lang ja|en]
//     [--only pc,side,phone,small] [--themes light,dark]
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
  // The smallest phone still sold (iPhone SE 1st gen. width): where the top bar is tightest. The one Save never moves
  // elsewhere — the game's title gives way first (it ends in "…"), Save and Play keep their size (shell.css .top-right).
  { id: 'small', width: 320, height: 568, mobile: true },
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
  const save = document.querySelector('[data-part=save]');
  const play = [...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width);
  // Every Save press on screen (the one beside Play; v0.1.9 also had one in the game's corner).
  const saves = [...document.querySelectorAll('[data-action=save], [data-action=save-top], [data-part=save-fab]')].filter((e) => !e.hidden && e.offsetParent && e.getBoundingClientRect().width);
  return JSON.stringify({
    top: box(save), bumps: Number(save?.dataset.bumps || 0), tip: save?.title || '', saves: saves.length, play: box(play),
    saved: box(document.querySelector('[data-part=save-state]')),
    old: /保存してゲームへ|Save to game/.test(document.body.innerText),
    // Anything over the game saying "not in the game yet" (the strip of 2026-10-21 B, gone since Play asks first).
    strip: !!document.querySelector('[data-part=play-unsaved]') || /in the game yet|ゲームに入っていません/.test(document.querySelector('.stage')?.innerText || ''),
    choice: (() => { const g = document.querySelector('[data-part=unsaved-guard][data-kind=play]'); return g && !g.hidden ? { title: g.querySelector('h2').textContent,
      save: box(g.querySelector('[data-action=guard-save]')), skip: box(g.querySelector('[data-action=guard-discard]')) } : null; })(),
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
    check(!s.top && s.saves === 0, 'nothing changed: no Save anywhere');

    // One change.
    const k = await page.eval(`(() => { const i = studioShell.items().find((x) => x.movable !== false && !x.held); return i ? i.key : null; })()`);
    await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
    await sleep(800);
    await nudge();
    // The bounce, caught half-way (it is .48 s): the photo of 1-edit is taken after it settled.
    await sleep(900);
    s = await state();
    await photo(page, '1-edit');
    console.log(`  edit: save "${s.top?.text}" ${s.top?.bg} (${s.saves} on screen) · play "${s.play?.text}" · tip "${s.tip}"`);
    check(s.saves === 1, `one Save on screen, not two (${s.saves})`);
    check(!s.old, 'no "Save to game" anywhere');
    const word = LANG === 'ja' ? '保存' : 'Save';
    // "Save · 1" (+ "⌘S" with a keyboard): the word is the same on every width.
    check(!!s.top && s.top.text.startsWith(`${word} · 1`), `the word is "${word}" with the count ("${s.top?.text}")`);
    check(!!s.top && s.top.bg === ORANGE && s.top.fg === WHITE, `C: orange with white words (${s.top?.bg})`);
    check(s.bumps === 1, `C: it bounced once (${s.bumps})`);
    check(!!s.top && !!s.play && s.play.l - s.top.r >= 0 && s.play.l - s.top.r <= 8 && Math.abs(s.play.y - s.top.y) < 2, 'right beside ▶ Play (left of it, same line)');
    check(!!s.top && s.top.l >= 0 && (!s.play || s.play.r <= s.W), 'the top bar still fits (Save and Play whole on screen)');
    // Since plan step 1 (2026-10-23, "one word for one thing") the sentence names the AI (i18n ai.name.*: Claude /
    // Codex in their terminals, "your AI" elsewhere — this test inherits the environment it is run in) and lost its
    // "(the game outside the editor changes too)".
    const tip = LANG === 'ja' ? /^保存すると、(Claude |Codex |あなたの AI )がゲームのコードに入れます(\s|$)/ : /^Save, and (Claude|Codex|your AI) puts it in the game’s code(\s|$)/;
    check(tip.test(s.tip), `its tooltip is one sentence ("${s.tip}")`);

    // A second change: no second bounce.
    await nudge();
    await sleep(900);
    s = await state();
    check(s.bumps === 1, `C: the second change does not bounce again (${s.bumps})`);

    // ▶ Play: the window first (the two nudges were of one object: one change), then Try without saving.
    if (s.play) await press(s.play);
    check(await until((x) => !!x.choice, 3000), '▶ Play with changes: the window first');
    s = await state();
    const title = LANG === 'ja' ? '保存していない変更が 1 個あります' : 'You have 1 unsaved change';
    check(s.choice?.title === title && s.choice.save?.bg === ORANGE, `"${s.choice?.title}", the main press orange (${s.choice?.save?.bg})`);
    if (s.choice?.skip) await press(s.choice.skip);
    await until((x) => x.playing);
    await sleep(2500);
    s = await state();
    await photo(page, '2-play');
    console.log(`  play: top "${s.top?.text}"${s.note ? ` · note "${s.note}"` : ''}`);
    check(!s.strip, 'nothing over the game says "not in the game yet" (chosen already)');
    check(!!s.top && s.saves === 1 && /1/.test(s.top.text), `the same one Save beside Play while playing ("${s.top?.text}")`);
    check(!s.old, 'no "Save to game" anywhere while playing');
    check(!s.note, 'the old grey note after "Playing" is gone');

    // Edit, ▶ Play again → Save and play.
    if (s.play) await press(s.play);
    await until((x) => !x.playing);
    await sleep(1200);
    s = await state();
    check(s.bumps === 1, `back to Edit: no bounce (the change is not new) (${s.bumps})`);
    check(!s.choice, 'Edit from Play: no window');
    if (s.play) await press(s.play);
    check(await until((x) => !!x.choice, 3000), '▶ Play again: the window again');
    s = await state();
    if (s.choice?.save) await press(s.choice.save);
    await until((x) => x.playing && !x.top, 8000);
    await sleep(1500);
    s = await state();
    await photo(page, '3-play-saved');
    check(s.playing && !s.top && !s.strip, 'Save and play: playing, no Save left, nothing over the game');
    const file = join(root, 'placement.json');
    check(existsSync(file) && readFileSync(file, 'utf8').includes(k), 'placement.json written');
    // Back to Edit after Save: nothing to save, no Save anywhere.
    if (s.play) await press(s.play);
    await until((x) => !x.playing);
    await sleep(1200);
    s = await state();
    await photo(page, '4-edit-saved');
    check(!s.top && s.saves === 0, 'saved: no Save anywhere in Edit');
    check(!!s.saved, '"✓ Saved" left of Undo');

    // Reduced motion: the next first change does not bounce.
    if (size.id === 'pc' && theme === THEMES[0]) {
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
      await sleep(600);
      await nudge();
      await sleep(900);
      s = await state();
      check(!!s.top && s.bumps === 1, `reduced motion: Save shows, no bounce (${s.bumps})`);
      // The press beside Play saves too (Save and play was tried above): "✓ Saved" in its place for a moment, then gone.
      await press(s.top);
      await sleep(300);
      s = await state();
      check(!!s.top && /✓|Saved|保存済み/.test(s.top.text) && !s.saved, `pressed: "${s.top?.text}" in its place, one "✓ Saved" only`);
      await until((x) => !x.top, 4000);
      s = await state();
      check(!s.top && !!s.saved, 'then gone; "✓ Saved" left of Undo');
      check(readFileSync(join(root, 'placement.json'), 'utf8').includes(k), 'placement.json written');
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
