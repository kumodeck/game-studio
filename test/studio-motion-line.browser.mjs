// A motion starts as one line (studio-motion-line, 2026-10-23; a review of 10/22 "cluttered, hard to follow", 10/23 "none of
// it makes sense"; 10/23 "with a motion, the timeline should be out, not hidden"). In a headless browser, PC 1280×800 and
// a phone 390×844, light and dark (`--themes`), one language a run (`--lang en|ja`), test/neon-run's gate and
// examples/three-isles (`--games`):
//   1. Make a motion → one move: the line is "▶ Preview  gate moves [Once ▾] in [1 s ▾] · When does it move? [▾]" with
//      Fine-tune ✦ ⌄ — no ⋯, no time readout, no ● on it — and the timeline (ruler, the row, its points) under it; Save · 1;
//      nothing on the line is cut or past the plate's edge (studio-timeline-line's measure); no first-time steps;
//   2. ▶ Preview plays; "[1 s ▾]" → 2 s: the points go to 0 s and 2 s;
//   3. Fine-tune: a sheet in the plate (● Rec motion, Loop & End, Trigger, Try, the motion's menu, Moving objects with
//      "+ Link an object"); the row's "+" only now; a point picked → Pace changed;
//   4. folded (⌄) and opened again, and the page reloaded: Fine-tune is still open (remembered);
//   5. no page errors.
// Pictures (`--shots <dir>`): 04-<after|before>-<game>-<lang>-<theme>-<pc|phone>-<1-made|2-fine>.png. `--before --ui <dir>`
// (the build before this change): the same two moments, pictures only.
//
//   node test/studio-motion-line.browser.mjs [--shots <dir>] [--only pc,phone] [--themes light,dark] [--lang en|ja] [--games neon,isles] [--before --ui <dir>]
// Exit 1 on a failure.
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
const ONLY = take('--only', 'pc,phone').split(',');
const THEMES = take('--themes', 'light,dark').split(',');
const GAMES = take('--games', 'neon,isles').split(',');
const BEFORE = args.includes('--before');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'phone', width: 390, height: 844, mobile: true },
].filter((s) => ONLY.includes(s.id));
// The object a motion is made on: the neon run's gate (the mock's), an isle's first thing that is not the ground.
const GAME = {
  neon: { dir: 'test/neon-run', pick: (keys) => (keys.includes('gate') ? 'gate' : keys.at(-1)) },
  isles: { dir: 'examples/three-isles', pick: (keys) => keys.find((k) => !/ground|sea|water|island|isle|sky/i.test(k)) ?? keys[0] },
};

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const TL = `window.__studioTimeline`;
const WORDS = LANG === 'ja'
  ? { play: '見る', fine: '細かく調整', len2: '2 秒', moves: /^(.+) が (\d+(?:\.\d)? 秒) で (1 回だけ) 動く$/, when: 'いつ動く？', rec: '動きを記録', link: '連携する物', pace: '進み方' }
  : { play: 'Preview', fine: 'Fine-tune', len2: '2 s', moves: /^(.+) moves (Once) in (\d+(?:\.\d)? s)$/, when: 'When does it move?', rec: 'Rec motion', link: 'Link an object', pace: 'Pace' };

/** What is cut on the line, the picked keys' row and Fine-tune: a menu narrower than its words, a text that overflows, a part past the plate's edge. */
const CUT = `(() => { const bad = []; const m = document.createElement('canvas').getContext('2d');
  const plate = document.querySelector('[data-part=timeline]'); if (!plate) return '["no plate"]'; const r0 = plate.getBoundingClientRect();
  for (const el of plate.querySelectorAll('[data-part=tl-head] *, [data-part=tl-sel] *, [data-part=tl-fine] *')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || !el.getClientRects().length) continue;
    const inFine = !!el.closest('[data-part=tl-fine]');
    if (el.tagName === 'SELECT' && !(inFine && el.dataset.part === 'tl-clip')) { m.font = cs.font; const w = m.measureText(el.selectedOptions[0]?.textContent || '').width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      if (el.clientWidth + 2 < w) bad.push('select ' + (el.dataset.part || '') + ' ' + Math.round(el.clientWidth) + ' < ' + Math.round(w)); }
    else if (!el.children.length && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') bad.push('text ' + el.className + ' "' + el.textContent.trim().slice(0, 24) + '"');
    const r = el.getBoundingClientRect(); if (r.width && (r.right > r0.right + 1 || r.left < r0.left - 1)) bad.push('past the edge: ' + (el.dataset.part || el.className));
  }
  return JSON.stringify(bad); })()`;
/** The line's parts in order (data-part, or the class), skipping the gap, the break and the dot. */
const PARTS = `JSON.stringify([...document.querySelector('[data-part=tl-head]').children].filter((c) => !/tl-gap|tl-break|tl-sep/.test(c.className))
  .map((c) => c.dataset.part || c.querySelector('[data-part]')?.dataset.part || [...c.classList].find((k) => k.startsWith('tl-'))))`;
/** The sentence as it reads (the menus by their chosen words). */
const SENTENCE = `JSON.stringify([...(document.querySelector('[data-part=tl-line]')?.children ?? [])].map((c) => c.querySelector('select')?.selectedOptions[0]?.textContent ?? c.textContent).join(' '))`;

async function run(game, size, theme) {
  const tag = `${game} ${LANG} ${theme} ${size.id}`;
  console.log(`${tag}${BEFORE ? ' (before)' : ''}`);
  const root = mkdtempSync(join(tmpdir(), 'studio-motion-line-'));
  cpSync(join(PKG, GAME[game].dir), root, { recursive: true });
  // test/neon-run keeps no loader of its own (its README): the built one, as the screen tests copy it.
  if (!existsSync(join(root, 'studio-placement.js'))) copyFileSync(join(UI, '../studio-placement.js'), join(root, 'studio-placement.js'));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `04-${BEFORE ? 'before' : 'after'}-${game}-${LANG}-${theme}-${size.id}-${what}.png`), await page.screenshot());
    const at = (sel) => j(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || !b.getClientRects().length) return null; b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
    const press = async (sel) => {
      const pt = await at(sel);
      if (!pt) return false;
      size.mobile ? await page.tap(Math.round(pt.x), Math.round(pt.y)) : await page.click(Math.round(pt.x), Math.round(pt.y));
      await sleep(600);
      return true;
    };
    const choose = async (sel, value) => (await page.eval(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); if (!s) return false; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`), await sleep(600));
    const save = () => j(`JSON.stringify(document.querySelector('[data-unsaved]')?.dataset.unsaved ?? null)`);
    const pts = (k) => j(`JSON.stringify((${TL}.motionOf(${JSON.stringify(k)})?.clips ?? []).map((c) => (c.keys.p ?? []).map((x) => x.t)))`);
    const boot = async () => {
      await page.goto(srv.url);
      await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
      await sleep(2500);
    };
    await boot();
    const keys = await j(`JSON.stringify([...document.querySelectorAll('.obj')].map((e) => e.dataset.key))`);
    const k = GAME[game].pick(keys);
    // ---- 1. Make a motion, one move ----
    await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
    await sleep(1000);
    await page.eval(`${TL}.make(${JSON.stringify(k)})`);
    await sleep(600);
    // One drag: live poses, then the end (the bridge's way: placement/moved).
    await page.eval(`(() => { const p = ${TL}.shownPose(${JSON.stringify(k)}); const up = (d) => ({ ...p, p: p.p.map((v, i) => (i === 1 ? v + d : v)) });
      ${TL}.moved(${JSON.stringify(k)}, up(0.6), false, p); ${TL}.moved(${JSON.stringify(k)}, up(1.2), true, p); })()`);
    await sleep(1800);
    await page.eval(`document.querySelector('[data-part=tl-done]')?.click()`);
    await sleep(600);
    const parts = await j(PARTS);
    const said = await j(SENTENCE);
    const cut1 = await j(CUT);
    await shot('1-made');
    if (!BEFORE) {
      check(parts[0] === 'tl-play' && parts[1] === 'tl-line' && parts.includes('tl-starts') && parts.includes('tl-fine-btn') && parts.includes('tl-fold'),
        `${tag}: the line is ▶ · the sentence · when · Fine-tune ✦ ⌄ (${parts.join(' · ')})`);
      check(!parts.includes('tl-more-btn') && !parts.includes('tl-now') && !parts.includes('tl-auto'), `${tag}: no ⋯, no time readout, no ● on the line`);
      const play = await j(`JSON.stringify(document.querySelector('[data-part=tl-play] .tl-play-w')?.textContent ?? null)`);
      check(play === WORDS.play, `${tag}: "▶ ${WORDS.play}" (${play})`);
      check(WORDS.moves.test(said || ''), `${tag}: the sentence reads "${said}"`);
      const tl = await j(`(() => { const p = document.querySelector('[data-part=timeline]'); const vis = (s) => { const e = p?.querySelector(s); return !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().height > 0; };
        return JSON.stringify({ ruler: vis('[data-part=tl-ruler]'), row: vis('.tl-name'), points: p ? [...p.querySelectorAll('[data-part=tl-key]')].filter((x) => !x.dataset.ch).length : 0, coach: !!p?.querySelector('.tl-coach, [data-part=tl-coach]') }); })()`);
      check(tl.ruler && tl.row && tl.points >= 2 && !tl.coach, `${tag}: the timeline is out — ruler, the row, its points — and no first-time steps (${JSON.stringify(tl)})`);
      check(cut1.length === 0, `${tag}: nothing on the line is cut${cut1.length ? ': ' + cut1.join(' | ') : ''}`);
      const n = await save();
      check(n === '1', `${tag}: one move = Save · 1 (${n})`);
      check(!(await j(`JSON.stringify(!!document.querySelector('[data-part=tl-link]'))`)), `${tag}: no "+ Link an object" on the row while Fine-tune is closed`);
      // ---- 2. ▶ Preview, then 1 s → 2 s ----
      await press('[data-part=tl-play]');
      check(await j(`JSON.stringify(${TL}.state().playing || ${TL}.state().time > 0)`), `${tag}: ▶ ${WORDS.play} plays`);
      await choose('[data-part=tl-len]', '2');
      const after = await pts(k);
      check(JSON.stringify(after?.[0]) === '[0,2]', `${tag}: "[${WORDS.len2}]" — the points at 0 s and 2 s (${JSON.stringify(after)})`);
      check(new RegExp(WORDS.len2).test((await j(SENTENCE)) || ''), `${tag}: the sentence says ${WORDS.len2}`);
    }
    // ---- 3. Fine-tune ----
    if (BEFORE) await page.eval(`document.querySelector('[data-part=tl-more-btn]')?.click()`);
    else await press('[data-part=tl-fine-btn]');
    await sleep(500);
    if (!BEFORE) {
      const fine = await j(`(() => { const f = document.querySelector('[data-part=timeline] [data-part=tl-fine]'); if (!f || f.hidden) return null;
        return JSON.stringify({ rows: [...f.querySelectorAll('.tl-more-row')].map((r) => r.dataset.part), rec: f.querySelector('[data-part=tl-more-rec] .tl-more-k')?.textContent,
          link: f.querySelector('[data-part=tl-more-link]')?.textContent?.trim() ?? null, pop: !!document.querySelector('body > .tl-more[data-part=tl-more], .shell > .tl-more[data-part=tl-more]') }); })()`);
      check(!!fine && ['tl-more-rec', 'tl-more-clip', 'tl-more-loop', 'tl-more-or', 'tl-tries', 'tl-more-all'].every((p) => fine.rows.includes(p)) && fine.rec === WORDS.rec && !fine.pop,
        `${tag}: Fine-tune is a sheet in the plate: ● ${WORDS.rec}, the motion, Loop & End, Trigger, Try, Moving objects (${JSON.stringify(fine)})`);
      check(!!fine && fine.link === WORDS.link, `${tag}: "+ ${WORDS.link}" in Fine-tune (${fine?.link})`);
      check(await j(`JSON.stringify(!!document.querySelector('[data-part=tl-link]'))`), `${tag}: the row's "+" now that Fine-tune is open`);
      // A point picked → Pace.
      const k2 = await j(`(() => { const x = [...document.querySelectorAll('[data-part=tl-key]')].find((e) => !e.dataset.ch && Math.abs(+e.dataset.t - 2) < 0.06); if (!x) return null; const r = x.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      if (k2) size.mobile ? await page.tap(Math.round(k2.x), Math.round(k2.y)) : await page.click(Math.round(k2.x), Math.round(k2.y));
      await sleep(600);
      const pace = await j(`JSON.stringify(document.querySelector('[data-part=tl-sel] .tl-sel-lbl')?.textContent ?? null)`);
      check(pace === WORDS.pace, `${tag}: a point picked — "${WORDS.pace}" (${pace})`);
      await choose('[data-part=tl-ease]', 'linear');
      const ease = await j(`JSON.stringify((${TL}.motionOf(${JSON.stringify(k)})?.clips?.[0]?.keys.p ?? []).map((x) => x.ease ?? 'ease'))`);
      check(!!ease && ease.includes('linear'), `${tag}: Pace changed (${JSON.stringify(ease)})`);
    }
    const cut2 = await j(CUT);
    await shot('2-fine');
    if (!BEFORE) {
      check(cut2.length === 0, `${tag}: nothing on the line, the row or Fine-tune is cut${cut2.length ? ': ' + cut2.join(' | ') : ''}`);
      // ---- 4. folded and opened again; reloaded ----
      await press('[data-action=tl-fold]');
      await page.eval(`${TL}.setOpen(true)`);
      await sleep(600);
      check(await j(`JSON.stringify(!document.querySelector('[data-part=tl-fine]')?.hidden)`), `${tag}: folded and opened again — Fine-tune still open`);
      // The browser's own note taken away: the game's ui prefs alone (a new port is a new browser storage) say "opened".
      await sleep(1500);
      await page.eval(`(() => { try { localStorage.removeItem('studio.tl.fine'); } catch {} return true; })()`);
      await boot();
      await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
      await sleep(800);
      await page.eval(`${TL}.setOpen(true)`);
      await sleep(800);
      check(await j(`JSON.stringify(!document.querySelector('[data-part=tl-fine]')?.hidden)`), `${tag}: the page reloaded — Fine-tune still open (the game's ui prefs)`);
    }
    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `${tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    await srv.close?.();
  }
}

for (const game of GAMES) for (const size of SIZES) for (const theme of THEMES) await run(game, size, theme);
console.log(failed ? `${failed} check(s) failed` : 'ok');
process.exit(failed ? 1 : 0);
