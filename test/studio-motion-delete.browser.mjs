// studio-motion-delete (2026-10-24) in a headless browser: the card's Motion row has its own menu — a right-click on
// the row, or the ⋯ at its right end — with "Remove from this object" and a red "Delete motion". On Lantern Cove,
// one language a run (`--lang en|ja`), dark. The rowboat and the buoy both have "Row"; the crate alone has "Bob".
//   menu     a real right-click on the row opens the motion's menu (two rows, the second red), not the pick's;
//   key      Delete with that menu open only closes it: the rowboat (the OBJECT) and its motion are both still there;
//   ask      Delete motion on Row (2 objects): one line "It also comes off 1 other object" and nothing gone yet; Esc = no;
//   delete   …the red row again: Row comes off both, ⌘Z (real keys) puts it back on both;
//   alone    Delete motion on Bob (the crate only): gone at once, the line says ⌘Z brings it back; ⌘Z does;
//   remove   Remove from this object on the rowboat: only the rowboat loses Row (the buoy keeps it); ⌘Z;
//   object   the Delete key with no menu open deletes the picked object, as before — its motion stays in the Library.
// Sizes (`--sizes`, default pc): pc 1280×800, wide 1440×900. Not the phone: its card is the bottom sheet, folded, and
// the Motion row is inside the sheet's fold (the strip's Motion is the way in there) — not this change's place.
// Pictures (`--shots <dir>`): <lang>-<size>-<step>.png.
//
//   node test/studio-motion-delete.browser.mjs [--lang en|ja] [--sizes pc,wide] [--shots <dir>]
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = { pc: { id: 'pc', width: 1280, height: 800 }, wide: { id: 'wide', width: 1440, height: 900 } };
const SIZES = take('--sizes', 'pc').split(',').map((s) => ALL[s]).filter(Boolean);
const W = LANG === 'ja'
  ? { detach: 'この物から外す', del: '動きを削除', other1: 'ほかの 1 つの物からも外れます', back: '⌘Z で戻せます' }
  : { detach: 'Remove from this object', del: 'Delete motion', other1: 'It also comes off 1 other object', back: '⌘Z brings it back' };

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const K = (t, v) => ({ t, v });
const FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [
    { name: 'Row', len: 2, repeat: 'pingpong', keys: { p: [K(0, [0, 0, 0]), K(1, [-2, 0, 1]), K(2, [-4, 0, 0])] } },
    { name: 'Bob', len: 1, repeat: 'once', keys: { p: [K(0, [0, 0, 0]), K(0.5, [0, 0.6, 0]), K(1, [0, 0, 0])] } }],
  motion: {
    rowboat: { clips: [{ use: 'Row', when: { on: 'start' } }] },
    buoy: { clips: [{ use: 'Row', when: { on: 'start' } }] },
    crate: { clips: [{ use: 'Bob', when: { on: 'start' } }] } } };

const TL = 'window.__studioTimeline';
const KEYS = { Delete: 46, Escape: 27, z: 90 };
async function key(page, k, modifiers = 0) {
  const down = { type: 'keyDown', key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: KEYS[k], modifiers };
  await page.send('Input.dispatchKeyEvent', down);
  await page.send('Input.dispatchKeyEvent', { ...down, type: 'keyUp' });
}

async function run(size) {
  const tag = `${LANG} ${size.id}`;
  console.log(tag);
  const root = mkdtempSync(join(tmpdir(), 'studio-motion-delete-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme: 'dark', seen: ['timeline-steps', 'open-line'] }));
  writeFileSync(join(root, 'placement.json'), JSON.stringify(FILE, null, 2));
  // No KUMODeck sign-in: the real ~/.kumo of the machine running this is never read.
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile, cdnCache: process.env.STUDIO_CDN_CACHE });
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${LANG}-${size.id}-${what}.png`), await page.screenshot());
    const select = async (k) => (await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`), await sleep(900));
    const uses = (n) => page.eval(`${TL}.usage(${JSON.stringify(n)}).map((u) => u.key).sort().join(',')`);
    const menu = () => j(`(() => { const m = document.querySelector('[data-part=context-menu]'); if (!m || m.hidden) return null;
      return JSON.stringify({ place: m.dataset.place, note: m.querySelector('.ctx-note')?.textContent ?? null,
        rows: [...m.querySelectorAll('.ctx-row')].map((b) => ({ label: b.textContent, danger: b.classList.contains('danger'), color: getComputedStyle(b).color })) }); })()`);
    const box = (sel) => j(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.offsetWidth) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
    const press = async (sel) => {
      const b = await box(sel);
      if (!b) return false;
      if (size.mobile) await page.tap(b.x, b.y);
      else await page.click(b.x, b.y);
      await sleep(500);
      return true;
    };
    const row = (label) => `[data-part=context-menu] .ctx-row[data-action="ctx-${label}"]`;
    // A one-line notice sits in the ask bar where its placeholder is (.ask-news); a longer one on the toast plate.
    const toast = () => page.eval(`[...document.querySelectorAll('.ask-news:not([hidden]), .toast.on')].map((e) => e.textContent).join(' | ')`);
    const undo = async () => (await key(page, 'z', 4), await sleep(700));
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(2500);

    // ---- menu: a real right-click on the row (PC) / the ⋯ (phone) ----
    await select('rowboat');
    const more = await box('[data-part=card] [data-part=motion-more]');
    check(!!more, `the Motion row has a ⋯ at its right end`);
    if (!size.mobile) {
      const r = await box('[data-part=card] [data-part=motion-timeline-line]');
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'right', buttons: 2, clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'right', buttons: 0, clickCount: 1 });
      await sleep(500);
    } else await press('[data-part=card] [data-part=motion-more]');
    const m1 = await menu();
    await shot('1-menu');
    check(m1?.place === 'card-motion' && m1.rows.length === 2 && m1.rows[0].label === W.detach && m1.rows[1].label === W.del, `the motion's menu: "${W.detach}" and "${W.del}" (${JSON.stringify(m1)})`);
    check(!!m1 && !m1.rows[0].danger && m1.rows[1].danger && m1.rows[1].color !== m1.rows[0].color, `"${W.del}" is red, "${W.detach}" is not`);

    // ---- key: Delete with the menu open ----
    await key(page, 'Delete');
    await sleep(600);
    check(!(await menu()), `Delete closed the menu`);
    check((await page.eval(`studioShell.items().some((i) => i.key === 'rowboat')`)) && (await uses('Row')) === 'buoy,rowboat', `…and deleted neither the rowboat nor its motion (Row on ${await uses('Row')})`);

    // ---- ask: Delete motion on Row (2 objects) ----
    await press('[data-part=card] [data-part=motion-more]');
    await press(row('motion-delete'));
    const m2 = await menu();
    await shot('2-ask');
    check(m2?.note === W.other1 && m2.rows.length === 1 && m2.rows[0].danger, `one line first: "${m2?.note}" and the red row again`);
    check((await uses('Row')) === 'buoy,rowboat', `nothing deleted yet`);
    await key(page, 'Escape');
    await sleep(400);
    check(!(await menu()) && (await uses('Row')) === 'buoy,rowboat', `Esc = no: Row is still on both`);

    // ---- delete ----
    await press('[data-part=card] [data-part=motion-more]');
    await press(row('motion-delete'));
    await press(row('motion-delete-yes'));
    check((await uses('Row')) === '' && !(await box('[data-part=card] [data-part=motion-row]')), `Row came off both objects, the card has no Motion row (${await uses('Row')})`);
    await shot('3-deleted');
    await undo();
    check((await uses('Row')) === 'buoy,rowboat', `⌘Z put Row back on both (${await uses('Row')})`);

    // ---- alone: Bob, the crate only ----
    await select('crate');
    await press('[data-part=card] [data-part=motion-more]');
    await press(row('motion-delete'));
    const gone = !(await menu()) && (await uses('Bob')) === '';
    const said = await toast();
    await shot('4-alone');
    check(gone, `Bob (one object): deleted at once, no question`);
    check(said.includes(W.back.replace('⌘Z', '')) || said.includes(W.back), `the one line says ${W.back} ("${said}")`);
    await undo();
    check((await uses('Bob')) === 'crate', `⌘Z brought Bob back on the crate`);

    // ---- remove: from the rowboat only ----
    await select('rowboat');
    await press('[data-part=card] [data-part=motion-more]');
    await press(row('motion-detach'));
    check((await uses('Row')) === 'buoy', `Remove: only the rowboat lost Row, the buoy keeps it (${await uses('Row')})`);
    await shot('5-removed');
    await undo();
    check((await uses('Row')) === 'buoy,rowboat', `⌘Z put it back on the rowboat`);

    // ---- object: the Delete key with no menu deletes the OBJECT, the motion stays ----
    await select('rowboat');
    await page.eval(`document.activeElement?.blur?.()`);
    await key(page, 'Delete');
    await sleep(800);
    await sleep(1000);
    // The list's row (the model drops it at once; studioShell.items() waits for the game's next list).
    const still = await page.eval(`!!document.querySelector('.objects .obj[data-key="rowboat"]')`);
    check(!still, `Delete with no menu deletes the rowboat itself (its row left the list)`);
    // The motion is not touched: still in the Library and on the buoy. (The deleted object's own record stays in the
    // motion store until Save, so ⌘Z brings the rowboat back moving — that is the object's undo, not this change's.)
    check((await uses('Row')).split(',').includes('buoy'), `…and Row stays (on ${await uses('Row')})`);

    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  } finally {
    await browser.close();
    await srv.close?.();
  }
}

for (const s of SIZES) await run(s);
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
