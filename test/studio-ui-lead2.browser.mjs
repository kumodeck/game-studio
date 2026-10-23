// UI lead, round 2 (studio-ui-lead2, 2026-10-23) in a headless browser: PC 1280×800 dark and a phone 390×844 light
// (`--pairs`), one language a run (`--lang en|ja`), on Lantern Cove with a scene motion "Arrival" over the boat, the buoy
// and the barrel (in that order in the file) and a long name given to the crate:
//   1. the rows: the buoy picked — the rows stay boat · buoy · barrel (the buoy lit where it is, not moved to the top; the
//      request of 10/23: "the one I pick jumps to the top and the order changes every time"); the barrel's grip dragged above
//      the boat — barrel · boat · buoy; Save writes that order with the motion (`order`); Undo puts it back;
//   2. a key picked: the row reads "1 selected · Pace [Smooth (slow start & stop)] · Path [Smooth curve] · Delete" (Gemini's
//      words), nothing cut;
//   3. ⋯: the motion menu has no "New: Scene"; the rows are Motion · Loop & End · Trigger · Try · Tracks (with "+ Link an
//      object"), each heading on one line;
//   4. the next five of studio-ui-lead: the card's Motion menu is whole (PC); the presence line is the bar's own top (PC);
//      "✦ AI" reads on the phone; the names column grows for the crate's long name (not cut); no link row under the rows —
//      the focused row's "+" opens the list;
//   5. no page errors.
// Pictures (`--shots <dir>`): after-<lang>-<theme>-<pc|phone>-<1-rows|2-keys|3-more|4-card|5-name>.png. `--before --ui <dir>`
// (the build before this change): before-… with the same steps and no checks.
//
//   node test/studio-ui-lead2.browser.mjs [--shots <dir>] [--pairs pc:dark,phone:light] [--lang en|ja] [--before --ui <dir>]
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
const BEFORE = args.includes('--before');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = { pc: { id: 'pc', width: 1280, height: 800 }, phone: { id: 'phone', width: 390, height: 844, mobile: true } };
// One light and one dark (the brief: the changed screens, one pair): PC dark, phone light.
const PAIRS = take('--pairs', 'pc:dark,phone:light').split(',').map((p) => p.split(':')).map(([s, th]) => [SIZES[s], th]).filter(([s]) => s);

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const TL = `window.__studioTimeline`;
const WORDS = LANG === 'ja'
  ? { sel: '選択中: 1', pace: '進み方', ease: 'なめらかに（自然な加減速）', path: '通り道', smooth: '丸くなめらかに', del: '消す', make: '＋ 動きを作る',
    more: ['動き', '終わり方とくり返し', '動かすきっかけ', '試す', '表示する行'], link: '連携する物', ai: 'AI' }
  : { sel: '1 selected', pace: 'Pace', ease: 'Smooth (slow start & stop)', path: 'Path', smooth: 'Smooth curve', del: 'Delete', make: '+ Make a motion',
    more: ['Motion', 'Loop & End', 'Trigger', 'Try', 'Tracks'], link: 'Link an object', ai: 'AI' };

// A scene "Arrival" over the boat, the buoy and the barrel — in that order in the file — and a long name on the crate.
const K = (t, v) => ({ t, v });
const FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  names: { crate: 'The old crate by the pier' },
  motions: [{ name: 'Arrival', len: 4, tracks: {
    rowboat: { p: [K(0, [0, 0, 0]), K(2, [-3, 0.5, -1]), K(4, [-6, 0, 0])] },
    buoy: { p: [K(0, [0, 0, 0]), K(2, [0, 0.6, 0]), K(4, [0, 0, 0])] },
    barrel: { p: [K(0, [0, 0, 0]), K(4, [2, 0, 2])] } } }],
  motion: Object.fromEntries(['rowboat', 'buoy', 'barrel'].map((k) => [k, { clips: [{ name: 'Arrival', use: 'Arrival', when: { on: 'start' } }] }])) };

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
/** The rows: [key, picked, has a grip] in the order drawn. */
const ROWS = `JSON.stringify([...document.querySelectorAll('[data-part=timeline] .tl-name[data-row]')].map((n) => [n.dataset.row, n.classList.contains('picked'), !!n.querySelector('[data-part=tl-grip]')]))`;
/** How many rows the line takes (distinct tops of its visible parts). */
const LINE_ROWS = `(() => { const boxes = [...document.querySelector('[data-part=tl-head]').children].map((c) => c.getBoundingClientRect()).filter((r) => r.width && r.height).sort((a, b) => a.top - b.top);
  let rows = 0, bottom = -1e9; for (const r of boxes) { if (r.top > bottom - 4) { rows++; bottom = r.bottom; } else bottom = Math.max(bottom, r.bottom); } return rows; })()`;
const rect = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width }); })()`;

async function run(size, theme) {
  const tag = `${LANG} ${theme} ${size.id}`;
  console.log(`${tag}${BEFORE ? ' (before)' : ''}`);
  const root = mkdtempSync(join(tmpdir(), 'studio-ui-lead2-'));
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
    const select = async (k) => (await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`), await sleep(900));
    const press = async (pt) => (size.mobile ? await page.tap(Math.round(pt.x), Math.round(pt.y)) : await page.click(Math.round(pt.x), Math.round(pt.y)), await sleep(600));
    const drag = async (a, b) => (size.mobile ? await page.touchDrag(a.x, a.y, b.x, b.y, 10) : await page.mouseDrag(a.x, a.y, b.x, b.y, 10), await sleep(700));
    const text = (sel) => j(`JSON.stringify(document.querySelector(${JSON.stringify(sel)})?.textContent ?? null)`);
    const keyAt = (k, t) => j(`(() => { const k = [...document.querySelectorAll('[data-part=tl-key]')].find((x) => x.dataset.key === ${JSON.stringify(k)} && !x.dataset.ch && Math.abs(+x.dataset.t - ${t}) < 0.06);
      if (!k) return null; const r = k.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(2500);
    // ---- 1. the rows: the buoy picked, the order stays; the barrel dragged to the top ----
    await select('buoy');
    await page.eval(`${TL}.setOpen(true)`);
    await sleep(1000);
    const rows1 = await j(ROWS);
    await shot('1-rows');
    if (!BEFORE) {
      check(JSON.stringify(rows1) === JSON.stringify([['rowboat', false, true], ['buoy', true, true], ['barrel', false, true]]),
        `${tag}: the buoy picked — boat · buoy · barrel as in the file, the buoy lit where it is, a grip on each (${JSON.stringify(rows1)})`);
      const grip = await j(rect('[data-part=tl-grip][data-grip=barrel]'));
      const first = await j(rect('[data-part=timeline] .tl-name[data-row=rowboat]'));
      if (grip && first) await drag(grip, { x: grip.x, y: first.top + 3 });
      const rows2 = await j(ROWS);
      check(JSON.stringify((rows2 || []).map((r) => r[0])) === JSON.stringify(['barrel', 'rowboat', 'buoy']), `${tag}: the barrel dragged above the boat — barrel · boat · buoy (${JSON.stringify((rows2 || []).map((r) => r[0]))})`);
      check(!!(rows2 || []).find((r) => r[0] === 'buoy')?.[1], `${tag}: the buoy still the picked one`);
      // Saved in that order; Undo puts it back.
      await page.eval(`studioShell.actions.save()`);
      await sleep(1500);
      const f = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      // `order` next to `tracks` (the file sorts object keys; contract LibraryMotion.order).
      const order = f.motions?.find((m) => m.name === 'Arrival')?.order ?? [];
      check(order.join() === 'barrel,rowboat,buoy', `${tag}: Save writes the rows' order with the motion (order: ${order.join(', ')})`);
      await page.eval(`studioShell.actions.undo()`);
      await sleep(600);
      const rows3 = await j(ROWS);
      check(JSON.stringify((rows3 || []).map((r) => r[0])) === JSON.stringify(['rowboat', 'buoy', 'barrel']), `${tag}: Undo — boat · buoy · barrel again (${JSON.stringify((rows3 || []).map((r) => r[0]))})`);
    }
    // ---- 2. a key picked: the row's words ----
    const k2 = await keyAt('buoy', 2);
    check(!!k2, `${tag}: the buoy's 2 s key is on the plate`);
    if (k2) await press(k2);
    const cut2 = await j(CUT);
    await shot('2-keys');
    if (!BEFORE && k2) {
      const sel = await j(`(() => { const r = document.querySelector('[data-part=tl-sel]'); if (!r || r.hidden) return null;
        const o = (p) => { const s = r.querySelector('[data-part=' + p + ']'); return s ? s.selectedOptions[0]?.textContent : null; };
        return JSON.stringify({ n: r.querySelector('[data-part=tl-sel-n]')?.textContent, labels: [...r.querySelectorAll('.tl-sel-lbl')].map((l) => l.textContent), ease: o('tl-ease'), point: o('tl-point'), del: r.querySelector('[data-part=tl-sel-del]')?.textContent?.trim() }); })()`);
      check(!!sel && sel.n === WORDS.sel && sel.labels[0] === WORDS.pace && sel.ease === WORDS.ease && sel.labels[1] === WORDS.path && sel.point === WORDS.smooth && sel.del === WORDS.del,
        `${tag}: the picked keys' row reads "${WORDS.sel} · ${WORDS.pace} [${WORDS.ease}] · ${WORDS.path} [${WORDS.smooth}] · ${WORDS.del}" (${JSON.stringify(sel)})`);
      check(cut2.length === 0, `${tag}: nothing on the line or the row is cut${cut2.length ? ': ' + cut2.join(' | ') : ''}`);
    }
    await page.eval(`${TL}.onKey({ key: 'Escape', ctrl: false, meta: false, shift: false })`);
    await sleep(300);
    // ---- 3. ⋯: no "New: Scene"; the rows' headings ----
    await page.eval(`document.querySelector('[data-part=tl-more-btn]')?.click()`);
    await sleep(500);
    const clipOpts = await j(`JSON.stringify([...document.querySelectorAll('[data-part=tl-more] [data-part=tl-clip] option')].map((o) => [o.value, o.textContent]))`);
    const heads = await j(`JSON.stringify([...document.querySelectorAll('[data-part=tl-more] .tl-more-k')].map((k) => [k.textContent, Math.round(k.getBoundingClientRect().height), parseFloat(getComputedStyle(k).lineHeight) || 16]))`);
    const linkWords = await text('[data-part=tl-more] [data-part=tl-more-link]');
    await shot('3-more');
    if (!BEFORE) {
      check(!!clipOpts && clipOpts.some(([v, t]) => v === 'new:make' && t === WORDS.make) && !clipOpts.some(([v]) => v === 'new:scene') && !clipOpts.some(([, t]) => /場面|Scene/.test(t)),
        `${tag}: the motion menu — + Make a motion, no "New: Scene" (${(clipOpts || []).map((o) => o[1]).join(' | ')})`);
      check(JSON.stringify((heads || []).map((h) => h[0])) === JSON.stringify(WORDS.more), `${tag}: ⋯'s rows are ${WORDS.more.join(' · ')} (${(heads || []).map((h) => h[0]).join(' · ')})`);
      check((heads || []).every((h) => h[1] < h[2] * 1.8), `${tag}: each heading on one line (${(heads || []).map((h) => `${h[0]} ${h[1]}px`).join(', ')})`);
      check((linkWords || '').includes(WORDS.link), `${tag}: "+ ${WORDS.link}" in words, in the Tracks row ("${linkWords}")`);
    }
    await page.eval(`document.querySelector('[data-part=tl-more-btn].on')?.click()`);
    await sleep(300);
    // ---- 4. the next five: the card's Motion menu, the presence line, "✦ AI", the names column, the row's "+" ----
    await select('rowboat');
    await sleep(600);
    const card = await j(`(() => { const s = document.querySelector('[data-part=card] [data-part=motion-clip]'); if (!s) return null; const m = document.createElement('canvas').getContext('2d'); const cs = getComputedStyle(s);
      m.font = cs.font; const w = m.measureText(s.selectedOptions[0]?.textContent || '').width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); return JSON.stringify({ text: s.selectedOptions[0]?.textContent, w: Math.round(w), cw: s.clientWidth }); })()`);
    // The presence words: beside the field when they fit (English), else on the bar's own top line (Japanese at 600 px).
    const presence = await j(`(() => { const row = document.querySelector('.presence-row'); const p = document.querySelector('.presence'); const bar = document.querySelector('[data-part=bar]'); if (!row || !p || !bar) return null;
      if (!row.contains(p)) return JSON.stringify({ inBox: true, hidden: row.hidden });
      const r = p.getBoundingClientRect(), b = bar.getBoundingClientRect(); return JSON.stringify({ hidden: row.hidden, w: Math.round(r.width), bw: Math.round(b.width), gap: Math.round(b.top - r.bottom), left: Math.round(r.left - b.left) }); })()`);
    const ask = await j(`(() => { const b = document.querySelector('[data-part=tl-ask]'); if (!b) return null; const s = b.querySelector('.tl-ask-s'); const w = b.querySelector('.tl-ask-w');
      return JSON.stringify({ short: s && s.offsetWidth > 0 ? s.textContent : null, long: w && w.offsetWidth > 0 ? w.textContent : null, bw: Math.round(b.getBoundingClientRect().width) }); })()`);
    const lineRows = await j(LINE_ROWS);
    await shot('4-card');
    if (!BEFORE) {
      if (!size.mobile) {
        check(!!card && card.cw + 2 >= card.w, `${tag}: the card's Motion menu is whole ("${card?.text}", ${card?.w} px in ${card?.cw})`);
        check(!!presence && (presence.inBox || presence.hidden || (presence.w >= presence.bw * 0.85 && presence.gap <= 2 && presence.gap >= -12)),
          `${tag}: the presence words beside the field, or the bar's own top line — as wide as the bar, joined to it (${JSON.stringify(presence)})`);
      } else {
        check(!!ask && ask.short === WORDS.ai && !ask.long && ask.bw >= 44, `${tag}: "✦ ${WORDS.ai}" on the phone, not a bare square (${JSON.stringify(ask)})`);
        check(lineRows <= 2, `${tag}: the line still two rows at most (${lineRows})`);
      }
    }
    await select('crate');
    await sleep(600);
    const name = await j(`(() => { const n = document.querySelector('[data-part=timeline] .tl-name.picked'); const col = document.querySelector('[data-part=timeline] .tl-names-col'); if (!n || !col) return null; const o = n.querySelector('.tl-obj');
      return JSON.stringify({ name: o?.textContent, cut: o ? o.scrollWidth > o.clientWidth + 1 || o.scrollHeight > o.clientHeight + 1 : null, col: Math.round(col.getBoundingClientRect().width), plus: !!n.querySelector('[data-part=tl-link]'), linkRow: !!document.querySelector('[data-part=timeline] .tl-name.tl-link-name') }); })()`);
    await shot('5-name');
    if (!BEFORE) {
      check(!!name && name.name === FILE.names.crate && !name.cut, `${tag}: the crate's long name whole in the names column (${JSON.stringify(name)})`);
      check(!!name && name.col > (size.mobile ? 96 : 140) && name.col <= (size.mobile ? 176 : 300), `${tag}: the column grew for it, within its cap (${name?.col} px)`);
      check(!!name && name.plus && !name.linkRow, `${tag}: the "+" on the picked row, no link row under the rows`);
      // The "+" opens the list (the scene's objects, the boat among them), with "or click an object in the game".
      const plus = await j(rect('[data-part=timeline] .tl-name.picked [data-part=tl-link]'));
      if (plus) await press(plus);
      const list = await j(`JSON.stringify({ open: !!document.querySelector('[data-part=tl-link-pop]'), boat: !!document.querySelector('[data-part=tl-link-item][data-key=rowboat]'), hint: document.querySelector('[data-part=tl-link-pop] .tl-link-hint')?.textContent ?? null })`);
      check(!!list && list.open && list.boat && !!list.hint, `${tag}: the "+" opens the list with the boat and the "click it in the game" line (${JSON.stringify(list)})`);
      await page.eval(`${TL}.linkPick(null)`);
      await sleep(200);
    }
    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `${tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    await srv.close?.();
  }
}

for (const [size, theme] of PAIRS) await run(size, theme);
console.log(failed ? `${failed} check(s) failed` : 'ok');
process.exit(failed ? 1 : 0);
