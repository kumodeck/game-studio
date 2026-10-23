// The second design review's ⑦–⑪ (2026-10-19), one check each, PC 1280×800 (mouse) and a phone 390×844 (touch),
// light and dark, with the real server and the built editor:
//   ⑦ the Library is quiet: PC — the grid fills the page (6 columns at 1280, no empty third on the right), no
//     "Object" / "Asset" tag and no "Drawn in code" on the tiles, scrolled to the end the last row clears the ask bar
//     (room under the grid ≥ the bar's height + 16). Phone — the first tile starts in the top half of the screen
//     (the head is two rows: Scene | Library with the filters, then the search with one "+"; Multi-select, Add files
//     and Make with AI are in the "+"), and the camera ↑↓ is not on screen while the Library or the list is open.
//   ⑧ the phone's foot holds two things: the card's name sits on the same middle line as its three buttons; the ↑↓
//     only show with nothing picked (not with the card, a menu or a sheet up); a notice ("Added sea-stack-2 to the
//     scene") is one line inside the ask bar, not a plate over it (PC too).
//   ⑨ the list: no orange dot on a picked row (only the grey "not saved" ring); every row's picture is in 1 s after
//     the list shows.
//   ⑩ Firefly Ruins on a phone: the urn is 30 pt or more each way when the editor opens.
//   ⑪ playing: the top bar says "Playing", not "Scene"; after Edit no tooltip is left on screen; the shortcut sheet's
//     camera row is "E / Q" with the Space+ keys in its one-line note, and the fly note is one line; a copy's card
//     says "Copy of sea-stack · Save to keep it" on one line; "Select all 2 like this" has no tooltip of the same words.
// Pictures (--shots <dir>): <size>-<theme>-<n>-<what>.png.
//
//   node test/studio-w3-polish.browser.mjs [--shots <dir>] [--only pc,phone,none] [--theme light|dark|both] [--report]
//                                          [--demo <built web demo>]
// --report: print what was measured and do not fail (the "before" pictures were taken this way).
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, d = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const REPORT = args.includes('--report');
const THEMES = opt('--theme', 'both') === 'both' ? ['light', 'dark'] : [opt('--theme')];
const ONLY = opt('--only', 'pc,phone').split(',');
// --demo <built web demo>: also the demo served like KUMODeck's test version — the top line is one line on a phone
// (⑪), and the front page's 3D / 2D tags are grey (⑨).
const DEMO = opt('--demo') ? resolve(opt('--demo')) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = `document.querySelector('iframe.game:not(.leaving)').contentWindow`;
const DBG = `${WIN}.__gameStudio._debug`;
const RISE = `[...${WIN}.document.querySelectorAll('[data-studio-ui]')].map((h) => h.shadowRoot?.querySelector('.cam')).find(Boolean)`;
// The ↑↓ group is on screen: laid out, not display:none / hidden, inside the window.
const RISE_ON = `(() => { const c = ${RISE}; if (!c) return false; const r = c.getBoundingClientRect(); const cs = getComputedStyle(c);
  return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && r.bottom > 0 && r.top < ${WIN}.innerHeight; })()`;

let failed = 0;
const notes = [];

async function open(game, size, theme) {
  const root = mkdtempSync(join(tmpdir(), `studio-w3-${game}-`));
  cpSync(join(PKG, 'starters', game), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en', theme }));
  // No KUMODeck sign-in (studio-library-shelf, 2026-10-23): the Library reads it at once now for its "✦ Make with AI" words,
  // and the real ~/.kumo of the machine running this must not be read (nor its balance land in a picture).
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const phone = size === 'phone';
  const page = await newPage(browser, phone ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
  const close = async () => {
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { page, close, phone };
}

function checker(tag) {
  return (cond, what, value) => {
    notes.push(`${cond ? 'ok' : 'NG'}  ${tag}: ${what}${value !== undefined ? ` — ${typeof value === 'string' ? value : JSON.stringify(value)}` : ''}`);
    console.log(notes[notes.length - 1]);
    if (!cond && !REPORT) {
      failed++;
    }
  };
}

async function helpers(page, phone, tag) {
  const J = async (js) => JSON.parse((await page.eval(`JSON.stringify(${js})`)) ?? 'null');
  const shot = async (name) => {
    if (!SHOTS) return;
    await page.eval(`document.activeElement?.blur?.()`);
    await sleep(400);
    writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
  };
  const at = (sel) => J(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getBoundingClientRect().width); if (!e) return null;
    const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const press = async (sel) => {
    const p = await at(sel);
    assert.ok(p, `${tag}: nothing to press for ${sel}`);
    if (phone) await page.tap(p[0], p[1]);
    else await page.click(p[0], p[1]);
    await sleep(400);
  };
  return { J, shot, at, press };
}

async function pc(theme) {
  const tag = `pc-${theme}`;
  const ok = checker(tag);
  const { page, close } = await open('lantern-cove', 'pc', theme);
  const { J, shot, press } = await helpers(page, false, tag);
  try {
    // ⑨ every row's picture within 1 s of the list showing.
    await sleep(1000);
    const blank = await J(`[...document.querySelectorAll('.objects .obj')].filter((r) => r.offsetParent && r.querySelector('img.thumb') && !r.querySelector('img.thumb[src]:not(.empty)')).map((r) => r.textContent.trim())`);
    // Measured, not failed on: in headless Chrome the pictures are drawn by software GL (SwiftShader), 30–570 ms each,
    // so Lantern Cove's 15 take about 4 s whatever the editor does; the line says how many were still blank at 1 s.
    notes.push(`${blank.length ? '--' : 'ok'}  ${tag}: ⑨ rows with their picture 1 s after the list shows (measured) — ${blank.length ? `blank: ${blank.join(', ')}` : 'all drawn'}`);
    console.log(notes[notes.length - 1]);
    await sleep(800);
    // ⑨ a picked row: no orange dot.
    await press('.objects .obj[data-key="lighthouse"]');
    await sleep(600);
    const dot = await J(`(() => { const r = document.querySelector('.objects .obj[aria-selected="true"]'); if (!r) return 'no row'; const a = getComputedStyle(r, '::after');
      return a.content === 'none' || a.content === '' || a.width === '0px' ? '' : a.backgroundColor; })()`);
    ok(dot === '', '⑨ no orange dot on the picked row', dot || 'none');
    await shot('1-picked');

    // ⑦ the Library, with nothing picked (a pick opens its detail in the right column; that column is the grid's
    // only neighbour then).
    await page.eval(`studioShell.actions.select(null)`);
    await sleep(400);
    await press('.nav-row[data-tool=library]');
    await page.waitFor(`document.querySelectorAll('.assets-page .gsl-tile').length > 4`, 15000);
    await sleep(1200);
    const g = await J(`(() => { const grid = document.querySelector('.assets-page .gsl-grid'); const gr = grid.getBoundingClientRect();
      const tiles = [...grid.querySelectorAll('.gsl-tile')]; const top = tiles[0].getBoundingClientRect().top;
      const row = tiles.filter((t) => Math.abs(t.getBoundingClientRect().top - top) < 2); const last = row[row.length - 1].getBoundingClientRect();
      const page = document.querySelector('.assets-page').getBoundingClientRect();
      return { cols: row.length, rightGap: Math.round(page.right - last.right), pageW: Math.round(page.width),
        kinds: [...document.querySelectorAll('.assets-page .gsl-grid .lib-kind')].filter((e) => e.offsetParent).length,
        code: [...document.querySelectorAll('.assets-page .gsl-grid .gsl-tile')].filter((t) => /Drawn in code/.test(t.textContent)).length }; })()`);
    ok(g.cols >= 6, '⑦ 6 columns at 1280', g.cols);
    ok(g.rightGap <= 48, '⑦ no empty space right of the grid (≤ 48 px: the page margin)', `${g.rightGap} px of ${g.pageW}`);
    ok(g.kinds === 0, '⑦ no Object / Asset tag on the tiles', g.kinds);
    ok(g.code === 0, '⑦ no "Drawn in code" on the tiles', g.code);
    await shot('2-library');
    await page.eval(`(() => { const g = document.querySelector('.assets-page .gsl-grid'); g.scrollTop = g.scrollHeight; })()`);
    await sleep(500);
    const end = await J(`(() => { const tiles = [...document.querySelectorAll('.assets-page .gsl-grid .gsl-tile')]; const b = Math.max(...tiles.map((t) => t.getBoundingClientRect().bottom));
      const bar = document.querySelector('.dock .bar').getBoundingClientRect(); return { last: Math.round(b), barTop: Math.round(bar.top), barH: Math.round(bar.height), plate: Math.round(document.querySelector('.assets-page').getBoundingClientRect().bottom) }; })()`);
    ok(end.plate - end.last >= end.barH + 16, '⑦ scrolled to the end, the room under the grid ≥ the ask bar\'s height + 16',
      `last row ends ${end.last}, bar ${end.barTop}–${end.barTop + end.barH}, room under the grid ${end.plate - end.last}`);
    ok(end.last <= end.barTop - 16, '⑦ the last row ends 16 px or more above the bar', `${end.barTop - end.last} px`);
    await shot('3-library-end');

    // ⑧ "Add to scene" from the Library: the notice is inside the ask bar, no plate over it.
    await page.eval(`(() => { const g = document.querySelector('.assets-page .gsl-grid'); g.scrollTop = 0; })()`);
    await press('.assets-page .lib-object[data-key="barrel"]');
    await press('.lib-object-detail [data-action=add-to-scene]');
    await sleep(500);
    const news = await J(`(() => { const c = document.querySelector('.ai-caption'); const plate = !!c && !c.hidden && c.getBoundingClientRect().height > 0;
      const inBar = [...document.querySelectorAll('.dock .bar *')].find((e) => /Added .* to the scene/.test(e.textContent) && e.children.length === 0 && e.getBoundingClientRect().height > 0)
        || [...document.querySelectorAll('.dock .bar input')].find((i) => /Added .* to the scene/.test(i.placeholder));
      return { plate, inBar: !!inBar }; })()`);
    ok(!news.plate && news.inBar, '⑧ "Added … to the scene" is one line inside the ask bar, no plate over it', news);
    await shot('4-added');

    // ⑪ a copy's card: no copy line (5-2 of the third review); "Select all 2 like this" without the same words as a tooltip.
    await page.eval(`studioShell.actions.select('sea-stack')`);
    await sleep(600);
    await press('.card [data-action=copy]');
    await sleep(600);
    const card = await J(`(() => { const n = [...document.querySelectorAll('.card p, .card .note-line, .card .copy-note')].find((e) => /sea-stack/.test(e.textContent));
      const k = document.querySelector('.card [data-action=select-kind]');
      return { text: n ? n.textContent.trim() : '', lines: n ? Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight || '16')) : 0,
        kindTitle: k ? k.getAttribute('title') || k.dataset.tip || '' : 'no link', kindText: k ? k.textContent : '' }; })()`);
    // Since the third design review (5-2, 2026-10-20) there is no line at all: the list's "duplicate" tag and "Save · 1" say it.
    ok(card.text === '', '⑪ the copy\'s card: no "Copy of … · Save to keep it" line', card.text);
    ok(card.kindTitle === '' || card.kindTitle !== card.kindText, '⑪ "Select all … like this" has no tooltip of the same words', card.kindTitle || 'none');
    await shot('5-copy-card');

    // ⑪ the shortcut sheet's camera and fly rows.
    await page.eval(`document.activeElement?.blur?.()`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '?', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 8, text: '?' });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '?', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 8 });
    await page.waitFor(`!!document.querySelector('.keys-sheet:not([hidden])')`, 3000);
    const keys = await J(`(() => { const row = (k) => { const r = document.querySelector('.keys-row[data-key=' + k + ']'); if (!r) return null; const n = r.querySelector('.keys-note');
      return { keys: [...r.querySelectorAll('kbd')].map((x) => x.textContent).join(' '), note: n ? n.textContent : '', noteLines: n ? Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)) : 0 }; };
      return { camera: row('camera'), fly: row('fly') }; })()`);
    ok(keys.camera && keys.camera.keys === 'E Q' && /Space\+E/.test(keys.camera.note), '⑪ camera row: E / Q, Space+ keys in its note', keys.camera);
    ok(keys.fly && keys.fly.noteLines <= 1, '⑪ fly note: one line', keys.fly);
    await shot('6-shortcuts');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);

    // ⑪ playing: "Playing" in the top bar; after Edit no tooltip left.
    await press('.top-actions .play');
    await sleep(1500);
    const here = await page.eval(`document.querySelector('.top .here')?.textContent || ''`);
    ok(here === 'Playing', '⑪ the top bar says Playing while playing', here);
    await shot('7-playing');
    await press('.top-actions .play');
    await sleep(1500);
    const tip = await J(`(() => { const t = document.querySelector('.tip'); return t && !t.hidden ? t.textContent : ''; })()`);
    ok(tip === '', '⑪ after Edit, no tooltip left on screen', tip || 'none');
    await shot('8-after-edit');
  } catch (e) {
    failed++;
    notes.push(`NG  ${tag}: ${e.message || e}`);
    console.log(`NG  ${tag}: ${e.stack || e}`);
  } finally {
    await close();
  }
}

async function phone(theme) {
  const tag = `phone-${theme}`;
  const ok = checker(tag);
  const { page, close } = await open('lantern-cove', 'phone', theme);
  const { J, shot, press } = await helpers(page, true, tag);
  try {
    await sleep(1800);
    ok(await page.eval(RISE_ON), '⑧ ↑↓ on screen with nothing picked');
    await shot('1-open');
    await page.eval(`studioShell.actions.select('lighthouse')`);
    await sleep(900);
    const head = await J(`(() => { const s = document.querySelector('.card .head-text strong').getBoundingClientRect(); const b = document.querySelector('.card .card-actions .icon-btn').getBoundingClientRect();
      return { name: Math.round(s.top + s.height / 2), buttons: Math.round(b.top + b.height / 2) }; })()`);
    ok(Math.abs(head.name - head.buttons) <= 1, '⑧ the card\'s name on the buttons\' middle line', head);
    ok(!(await page.eval(RISE_ON)), '⑧ no ↑↓ while the card is up');
    await shot('2-card');
    await page.eval(`studioShell.actions.select(null)`);
    await sleep(600);
    await press('.bar [data-action=sheet]');
    await sleep(700);
    ok(!(await page.eval(RISE_ON)), '⑦⑧ no ↑↓ while the list sheet is open');
    await shot('3-list');
    await press('.nav-row[data-tool=library]');
    await page.waitFor(`document.querySelectorAll('.assets-page .gsl-grid .gsl-tile').length > 2`, 15000);
    await sleep(1200);
    const lib = await J(`(() => { const t = [...document.querySelectorAll('.assets-page .gsl-grid .gsl-tile')].find((x) => x.getBoundingClientRect().width);
      const r = t.getBoundingClientRect(); const kinds = [...document.querySelectorAll('.assets-page .gsl-grid .lib-kind')].filter((e) => e.offsetParent).length;
      const vis = (sel) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().width && e.checkVisibility({ visibilityProperty: true }));
      return { top: Math.round(r.top), kinds, multi: vis('.assets-page [data-action=shelf-multi]'), add: vis('.assets-page .gsl-add'), plus: vis('.assets-page [data-action=library-more]') }; })()`);
    ok(lib.top < 422, '⑦ the first tile starts in the top half', `${lib.top} / 844`);
    ok(lib.kinds === 0, '⑦ no Object / Asset tag on the tiles', lib.kinds);
    ok(lib.plus && !lib.multi && !lib.add, '⑦ one "+" next to the search; Multi-select and Add files inside it', lib);
    ok(!(await page.eval(RISE_ON)), '⑦ no ↑↓ while the Library is open');
    await shot('4-library');
    if (lib.plus) {
      await press('.assets-page [data-action=library-more]');
      await sleep(400);
      await shot('5-library-plus');
      await press('.assets-page [data-action=library-more]');
    }
    // ⑧ the notice after "Add to scene" on a phone: inside the ask bar too, and the foot is the card and the bar only.
    await page.eval(`document.querySelector('.assets-page .lib-object[data-key="barrel"]').scrollIntoView({ block: 'center' })`);
    await sleep(400);
    await press('.assets-page .lib-object[data-key="barrel"]');
    await page.waitFor(`!!document.querySelector('.lib-object-detail [data-action=add-to-scene]')`, 5000);
    await page.eval(`document.querySelector('.lib-object-detail [data-action=add-to-scene]').scrollIntoView({ block: 'center' })`);
    await sleep(400);
    await press('.lib-object-detail [data-action=add-to-scene]');
    await sleep(500);
    const news = await J(`(() => { const c = document.querySelector('.ai-caption'); const plate = !!c && !c.hidden && c.getBoundingClientRect().height > 0;
      const n = document.querySelector('.ask-news:not([hidden])'); return { plate, inBar: !!n && /Added .* to the scene/.test(n.textContent), text: n ? n.textContent : '' }; })()`);
    ok(!news.plate && news.inBar, '⑧ "Added … to the scene" is one line inside the ask bar, no plate over it', news);
    ok(!(await page.eval(RISE_ON)), '⑧ no ↑↓ with the new copy\'s card up');
    await shot('6-added');
  } catch (e) {
    failed++;
    notes.push(`NG  ${tag}: ${e.message || e}`);
    console.log(`NG  ${tag}: ${e.stack || e}`);
  } finally {
    await close();
  }
}

async function urn(theme) {
  const tag = `phone-${theme}-ruins`;
  const ok = checker(tag);
  const { page, close } = await open('firefly-ruins', 'phone', theme);
  const { J, shot } = await helpers(page, true, tag);
  try {
    await sleep(1800);
    await page.eval(`studioShell.actions.select('urn')`);
    await sleep(900);
    const r = await J(`${DBG}.anchor('urn').rect`);
    ok(r && r.w >= 30 && r.h >= 30, '⑩ the urn is 30 pt or more each way', r && `${Math.round(r.w)}×${Math.round(r.h)} pt`);
    await shot('7-urn');
  } catch (e) {
    failed++;
    notes.push(`NG  ${tag}: ${e.message || e}`);
    console.log(`NG  ${tag}: ${e.stack || e}`);
  } finally {
    await close();
  }
}

async function demo(theme) {
  const ok = checker(`demo-${theme}`);
  const host = await startHost({ dir: DEMO });
  const browser = await launch();
  try {
    for (const phone of [false, true]) {
      const tag = `demo-${phone ? 'phone' : 'pc'}-${theme}`;
      const page = await newPage(browser, phone ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await page.goto(`${host.url}?lang=en`);
      await sleep(1500);
      const kind = await page.eval(`(() => { const k = document.querySelector('.kind'); if (!k) return null; const c = getComputedStyle(k).color; const a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); return { color: c, accent: a, text: k.textContent }; })()`);
      ok(!!kind && !/255, 106, 43|255, 107, 26/.test(kind.color), `⑨ ${phone ? 'phone' : 'PC'}: the front page's ${kind?.text} tag is grey`, kind?.color);
      await page.goto(`${host.url}studio/?game=lantern-cove&lang=en`);
      await page.waitFor(`!!document.querySelector('.demo-banner') && document.querySelectorAll('.obj').length > 0`, 90000);
      await sleep(7000); // the host's test bar shrinks to its chip after 6 s, as a visitor sees it
      const line = await page.eval(`JSON.stringify((() => { const b = document.querySelector('.demo-banner'); const t = b.querySelector('.demo-text');
        const shown = [...t.children].find((c) => getComputedStyle(c).position !== 'absolute');
        return { h: Math.round(b.getBoundingClientRect().height), text: shown ? shown.textContent : '', cut: t.scrollWidth > t.clientWidth + 1,
          lines: shown ? shown.getClientRects().length : 0 }; })())`).then(JSON.parse);
      ok(line.h <= 24 && line.lines === 1 && !line.cut, `⑪ ${phone ? 'phone' : 'PC'}: the demo's top line is one line, not cut`, line);
      if (SHOTS) writeFileSync(join(SHOTS, `${tag}-top.png`), await page.screenshot());
      await page.close();
    }
  } catch (e) {
    failed++;
    console.log(`NG  demo-${theme}: ${e.stack || e}`);
  } finally {
    await browser.close();
    await host.close();
  }
}

for (const theme of THEMES) {
  if (DEMO) await demo(theme);
  if (ONLY.includes('pc')) await pc(theme);
  if (ONLY.includes('phone')) {
    await phone(theme);
    await urn(theme);
  }
}
console.log(`\n${notes.filter((n) => n.startsWith('NG')).length} NG of ${notes.length}`);
if (failed && !REPORT) process.exit(1);
