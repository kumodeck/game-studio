// The timeline's line, readable (studio-ui-lead, 2026-10-23; a hands-on try of v0.1.26 at 1800 px: "not one thing on the
// timeline's line is readable" — the motion menu "Mo…", the "attached" chip, "Point Sm…", "Keys Ea…"). In a headless browser, PC 1280×800 and a phone
// 390×844, light and dark (`--themes`), one language a run (`--lang en|ja`):
//   1. a motion attached from the Library (the strip's Motion → Use a saved motion → Hop, on the crate; the card's "From
//      Library" went with studio-card-doors, plan step 3): the line is ▶ Preview · "Repeat [Once ▾]" (the sentence
//      "crate moves [Once ▾] in [0.8 s ▾]" until studio-no-sentence, 2026-10-24) · "When does it move?" [the menu, ringed] ▷ … Fine-tune ✦ ⌄ (studio-motion-line, plan step 4,
//      2026-10-23: no time readout, no ● on the line, Fine-tune for ⋯) — no motion menu, no "✓ attached", no Point /
//      Keys; nothing on it is cut or ends in "…", and on PC it is one line (two on a phone);
//   2. a key picked on the boat's row: the picked keys' row under the line — "1 selected", "Pace ▾", "Path ▾", Delete
//      (Gemini's words, studio-ui-lead2) — readable; Delete takes the key, ⌘Z brings it back;
//   3. Fine-tune (⋯ until plan step 4) holds the motion's menu (this motion, + Make a motion, rename, take off; no
//      "New: Scene" since studio-ui-lead2);
//   4. (PC) making a motion from the strip: the line is the step ("✓ Moves 0–1 s …") and Done only, no "when" until Done;
//      after Done, "When does it move?" ringed;
//   5. the rows: the picked object's name is not cut, and no "when" chip on it (the line says it);
//   6. no page errors.
// Pictures (`--shots <dir>`): after-<lang>-<theme>-<pc|phone>-<1-line|2-keys|3-more|4-making>.png. `--before --ui <dir>`
// (the build before this change): before-<lang>-<theme>-<pc|phone>-<1-line|2-keys>.png.
//
//   node test/studio-timeline-line.browser.mjs [--shots <dir>] [--only pc,phone] [--themes light,dark] [--lang en|ja] [--before --ui <dir>]
// Exit 1 on a failure.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
const BEFORE = args.includes('--before');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'phone', width: 390, height: 844, mobile: true },
].filter((s) => ONLY.includes(s.id));

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const TL = `window.__studioTimeline`;
const ROOT = `document.querySelector('iframe.game, iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const WORDS = LANG === 'ja'
  ? { when: 'いつ動く？', sel: '選択中: 1', toNext: '進み方', ease: 'なめらかに（自然な加減速）', turns: '通り道', smooth: '丸くなめらかに', del: '消す',
    made: /^✓ 0〜1 秒の動きができました/, done: '終わる', motion: '動き', make: '＋ 動きを作る', off: 'この物から外す' }
  : { when: 'When does it move?', sel: '1 selected', toNext: 'Pace', ease: 'Smooth (slow start & stop)', turns: 'Path', smooth: 'Smooth curve', del: 'Delete',
    made: /^✓ Moves 0–1 s\./, done: 'Done', motion: 'Motion', make: '+ Make a motion', off: 'Take it off this object' };

// The boat has "Motion" (keys at 0, 1.5 and 3 s, lifted in the middle, turning); the Library has "Hop" for the crate.
const FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [{ name: 'Hop', len: 0.8, repeat: 'once', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.4, v: [0, 1, 0] }, { t: 0.8, v: [0, 0, 0] }] } }],
  motion: { rowboat: { clips: [{ name: 'Motion', len: 3, repeat: 'pingpong', start: true, keys: {
    p: [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2.5, 1.2, -1.5] }, { t: 3, v: [-5, 0, 0] }], r: [{ t: 0, v: [0, 0, 0] }, { t: 3, v: [0, 0.8, 0] }] } }] } } };

/** What is cut on the line and the picked keys' row: a menu narrower than its words, a text that overflows, a part past the plate's edge. */
const CUT = `(() => { const bad = []; const m = document.createElement('canvas').getContext('2d');
  const plate = document.querySelector('[data-part=timeline]'); if (!plate) return '["no plate"]'; const r0 = plate.getBoundingClientRect();
  for (const el of plate.querySelectorAll('[data-part=tl-head] *, [data-part=tl-sel] *')) {
    const cs = getComputedStyle(el); if (cs.display === 'none') continue;
    if (el.tagName === 'SELECT') { m.font = cs.font; const w = m.measureText(el.selectedOptions[0]?.textContent || '').width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      if (el.clientWidth + 2 < w) bad.push('select ' + (el.dataset.part || '') + ' ' + Math.round(el.clientWidth) + ' < ' + Math.round(w)); }
    else if (!el.children.length && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') bad.push('text ' + el.className + ' "' + el.textContent.trim().slice(0, 24) + '"');
    const r = el.getBoundingClientRect(); if (r.width && (r.right > r0.right + 1 || r.left < r0.left - 1)) bad.push('past the edge: ' + (el.dataset.part || el.className));
  }
  return JSON.stringify(bad); })()`;
/** The line's parts in order (data-part, or the class), skipping the gap and the break. */
const PARTS = `JSON.stringify([...document.querySelector('[data-part=tl-head]').children].filter((c) => !/tl-gap|tl-break/.test(c.className))
  .map((c) => c.dataset.part || c.querySelector('[data-part]')?.dataset.part || [...c.classList].find((k) => k.startsWith('tl-'))))`;
/** How many rows the line takes (distinct tops of its visible parts). */
const ROWS = `(() => { const boxes = [...document.querySelector('[data-part=tl-head]').children].map((c) => c.getBoundingClientRect()).filter((r) => r.width && r.height).sort((a, b) => a.top - b.top);
  let rows = 0, bottom = -1e9; for (const r of boxes) { if (r.top > bottom - 4) { rows++; bottom = r.bottom; } else bottom = Math.max(bottom, r.bottom); } return rows; })()`;

async function run(size, theme) {
  const tag = `${LANG} ${theme} ${size.id}`;
  console.log(`${tag}${BEFORE ? ' (before)' : ''}`);
  const root = mkdtempSync(join(tmpdir(), 'studio-tl-line-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps'] }));
  writeFileSync(join(root, 'placement.json'), JSON.stringify(FILE, null, 2));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${LANG}-${theme}-${size.id}-${what}.png`), await page.screenshot());
    const select = async (k) => (await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`), await sleep(1000));
    const press = async (pt) => (size.mobile ? await page.tap(Math.round(pt.x), Math.round(pt.y)) : await page.click(Math.round(pt.x), Math.round(pt.y)), await sleep(600));
    const fine = async (open) => size.mobile && page.eval(`(() => { const d = document.querySelector('[data-part=card] details.fine'); if (d) d.open = ${open}; return true; })()`);
    const text = (sel) => j(`JSON.stringify(document.querySelector(${JSON.stringify(sel)})?.textContent ?? null)`);
    const keyAt = (k, t) => j(`(() => { const k = [...document.querySelectorAll('[data-part=tl-key]')].find((x) => x.dataset.key === ${JSON.stringify(k)} && !x.dataset.ch && Math.abs(+x.dataset.t - ${t}) < 0.06);
      if (!k) return null; const r = k.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
    const keys = (k) => j(`JSON.stringify((${TL}.motionOf(${JSON.stringify(k)})?.clips ?? []).map((c) => (c.keys.p ?? []).map((x) => x.t)))`);
    /** The picked object's Motion button in the game's strip (the one way in since studio-card-doors, plan step 3). */
    const pressMotion = async () => {
      await page.waitFor(`!!${ROOT}.querySelector('[data-studio-motion]:not([hidden])')`, 15000).catch(() => {});
      const btn = await j(`(() => { const o = document.querySelector('iframe.game, iframe').getBoundingClientRect(); const b = ${ROOT}.querySelector('[data-studio-motion]');
        if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`);
      if (btn) await press(btn);
      return !!btn;
    };
    /** A row of the editor's menu (context-menu.ts), pressed. */
    const pressRow = async (action) => {
      const b = await j(`(() => { const b = document.querySelector('[data-part=context-menu] [data-action=${JSON.stringify(action)}]'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      if (b) await press(b);
      return !!b;
    };
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(2500);
    // ---- 1. a motion attached from the Library: the line ----
    await select('crate');
    if (BEFORE) {
      await fine(true);
      await sleep(300);
      await page.eval(`(() => { const s = document.querySelector('[data-part=card] [data-part=motion-from-lib]'); if (!s) return false; s.value = 'attach:Hop'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await sleep(900);
      await fine(false);
    } else {
      // The strip's Motion (no motion yet: a menu) → "Use a saved motion" → Hop.
      await pressMotion();
      await pressRow('ctx-motion-lib');
      await pressRow('ctx-motion-lib-Hop');
      await sleep(900);
    }
    await sleep(500);
    const parts1 = await j(PARTS);
    const cut1 = await j(CUT);
    const rows1 = await j(ROWS);
    await shot('1-line');
    if (!BEFORE) {
      // Plan step 4 (studio-motion-line, 2026-10-23): ▶ Preview · Repeat [▾] (the sentence until studio-no-sentence) · "When does it move?" ▾ ▷ · Fine-tune ✦ ⌄ —
      // the time readout and ● Rec motion left the line (the red line's cap, the ruler's last point, Fine-tune).
      // A phone's ⌄ is over the rows (the names column's head, studio-fix-0142 ⑬), not on the line.
      // studio-motion-next (2026-10-24): ✦ Turn into a rule after "when" (a motion of points; hidden in the narrow order).
      const want = ['tl-play', 'tl-rep', 'tl-sep', 'tl-lbl', 'tl-starts', 'tl-try-this', 'tl-to-rule', 'tl-fine-btn', 'tl-ask', ...(size.mobile ? [] : ['tl-fold'])];
      check(JSON.stringify(parts1.filter((p) => p !== 'tl-try-this')) === JSON.stringify(want.filter((p) => p !== 'tl-try-this')), `${tag}: the line is ▶ · Repeat · "when" · Fine-tune ✦ ⌄ — no motion menu, no "attached", no Point / Keys (${parts1.join(' · ')})`);
      const lbl = await text('[data-part=tl-head] .tl-when-lbl');
      const ringed = await j(`JSON.stringify(!!document.querySelector('[data-part=tl-head] .tl-starts.ask'))`);
      check((size.mobile || lbl === WORDS.when) && ringed, `${tag}: "${WORDS.when}" and the menu ringed (label "${lbl}", ringed ${ringed})`);
      check(cut1.length === 0, `${tag}: nothing on the line is cut${cut1.length ? ': ' + cut1.join(' | ') : ''}`);
      check(size.mobile ? rows1 <= 2 : rows1 === 1, `${tag}: ${size.mobile ? 'two rows at most' : 'one line'} (${rows1})`);
    }
    // ---- 2. a key picked: the picked keys' row ----
    await select('rowboat');
    await sleep(500);
    const k15 = await keyAt('rowboat', 1.5);
    check(!!k15, `${tag}: the boat's 1.5 s key is on the plate`);
    if (k15) await press(k15);
    const cut2 = await j(CUT);
    await shot('2-keys');
    if (!BEFORE && k15) {
      const sel = await j(`(() => { const r = document.querySelector('[data-part=tl-sel]'); if (!r || r.hidden) return null;
        const o = (p) => { const s = r.querySelector('[data-part=' + p + ']'); return s ? s.selectedOptions[0]?.textContent : null; };
        return JSON.stringify({ n: r.querySelector('[data-part=tl-sel-n]')?.textContent, labels: [...r.querySelectorAll('.tl-sel-lbl')].map((l) => l.textContent), ease: o('tl-ease'), point: o('tl-point'), del: r.querySelector('[data-part=tl-sel-del]')?.textContent?.trim() }); })()`);
      check(!!sel && sel.n === WORDS.sel && sel.labels[0] === WORDS.toNext && sel.ease === WORDS.ease && sel.labels[1] === WORDS.turns && sel.point === WORDS.smooth && sel.del === WORDS.del,
        `${tag}: the picked keys' row reads "${WORDS.sel} · ${WORDS.toNext} [${WORDS.ease}] · ${WORDS.turns} [${WORDS.smooth}] · ${WORDS.del}" (${JSON.stringify(sel)})`);
      check(!(await j(`JSON.stringify([...document.querySelectorAll('[data-part=tl-head] [data-part=tl-ease], [data-part=tl-head] [data-part=tl-point]')].length)`)), `${tag}: no Point / Keys on the line itself`);
      check(cut2.length === 0, `${tag}: nothing on the line or the row is cut${cut2.length ? ': ' + cut2.join(' | ') : ''}`);
      // Delete, then ⌘Z.
      const del = await j(`(() => { const b = document.querySelector('[data-part=tl-sel-del]'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
      if (del) await press(del);
      const after = await keys('rowboat');
      check(JSON.stringify(after) === '[[0,3]]', `${tag}: Delete takes the picked key (${JSON.stringify(after)})`);
      check(await j(`JSON.stringify(!!document.querySelector('[data-part=tl-sel]')?.hidden)`), `${tag}: the row goes once nothing is picked`);
      await page.eval(`studioShell.actions.undo()`);
      await sleep(500);
      check(JSON.stringify(await keys('rowboat')) === '[[0,1.5,3]]', '⌘Z brings it back');
    }
    // ---- 3. Fine-tune (⋯ until plan step 4): the motion's menu ----
    const box = BEFORE ? 'tl-more' : 'tl-fine';
    await page.eval(`document.querySelector('[data-part=${BEFORE ? 'tl-more-btn' : 'tl-fine-btn'}]')?.click()`);
    await sleep(400);
    const clipOpts = await j(`JSON.stringify([...document.querySelectorAll('[data-part=${box}] [data-part=tl-clip] option')].map((o) => [o.value, o.textContent]))`);
    const clipLabel = await text(`[data-part=${box}] [data-part=tl-more-clip] .tl-more-k`);
    await shot('3-more');
    if (!BEFORE) {
      check(!!clipOpts && clipLabel === WORDS.motion && clipOpts.some(([v]) => v === 'Motion') && clipOpts.some(([v, t]) => v === 'new:make' && t === WORDS.make) && !clipOpts.some(([v]) => v === 'new:scene') && clipOpts.some(([v]) => v === 'rename') && clipOpts.some(([v, t]) => v === 'delete' && t === WORDS.off),
        `${tag}: Fine-tune has "${WORDS.motion}": the motion, + Make a motion, rename, take off — no scene line (${(clipOpts || []).map((o) => o[1]).join(' | ')})`);
      check(!(await j(`JSON.stringify(!!document.querySelector('[data-part=tl-head] [data-part=tl-clip]'))`)), `${tag}: and the line has none`);
    }
    await page.eval(`document.querySelector('[data-part=${BEFORE ? 'tl-more-btn' : 'tl-fine-btn'}].on')?.click()`);
    await sleep(300);
    // ---- 5. the rows ----
    const row = await j(`(() => { const n = document.querySelector('[data-part=timeline] .tl-name.picked, [data-part=timeline] .tl-name'); if (!n) return null; const o = n.querySelector('.tl-obj');
      return JSON.stringify({ name: o?.textContent, cut: o ? o.scrollWidth > o.clientWidth + 1 : null, chip: !!n.querySelector('[data-part=tl-whenchip]'), clip: n.querySelector('.tl-clipname')?.textContent ?? null }); })()`);
    if (!BEFORE) check(!!row && row.name === 'rowboat' && !row.cut && !row.chip, `${tag}: the row says the object, whole, with no "when" chip (${JSON.stringify(row)})`);
    // ---- 4. (PC) making from the strip: the step line, then Done ----
    if (!BEFORE && !size.mobile) {
      await page.eval(`${TL}.setOpen(false)`);
      await sleep(300);
      await select('barrel');
      await pressMotion();
      await pressRow('ctx-motion-make');
      await sleep(300);
      await page.eval(`(() => { const p = ${TL}.shownPose('barrel'); ${TL}.moved('barrel', { ...p, p: [p.p[0] + 2.5, p.p[1], p.p[2]] }, true, p); })()`);
      await sleep(1500);
      const parts4 = await j(PARTS);
      const made = await text('[data-part=tl-made]');
      const cut4 = await j(CUT);
      await shot('4-making');
      check(WORDS.made.test(made || '') && !parts4.includes('tl-starts') && parts4.includes('tl-done') && cut4.length === 0,
        `${tag}: making — the step and Done only, whole ("${made}"; ${parts4.join(' · ')}${cut4.length ? '; cut: ' + cut4.join(' | ') : ''})`);
      await page.eval(`document.querySelector('[data-part=tl-done]')?.click()`);
      await sleep(500);
      const parts5 = await j(PARTS);
      const ringed = await j(`JSON.stringify(!!document.querySelector('[data-part=tl-head] .tl-starts.ask'))`);
      check(parts5.includes('tl-starts') && !parts5.includes('tl-made') && ringed, `${tag}: Done — "${WORDS.when}" ringed, the step gone (${parts5.join(' · ')})`);
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
