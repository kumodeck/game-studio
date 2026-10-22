// ▶ Play with changes not saved asks first: "Save and play" or "Try without saving" (a try of the editor, 2026-10-21: "when
// 'this change isn't in the game yet', some people want to save and some want to try it without saving — let them
// choose with buttons"). src/shell/unsaved-guard.ts (kind 'play') and main.ts togglePlay. Real clicks, taps and keys:
//
//   choose    local Lantern Cove, PC: one move →
//               ▶ Play → the window ("You have 1 unsaved change" + the second line), Save and play has the focus
//               Cancel → still Edit, nothing handed to the AI, "Save · 1" / Esc → the same / a press outside → the same
//               Try without saving → playing, the move shown, no request for the AI, Save · 1 beside Play, no strip
//               over the game; back to Edit: the move and "Save · 1" are still there
//               (placement.json itself already has the move as a draft, written ~0.7 s after it — main.ts keepNow,
//               play-unsaved — so "saved" here means what Save adds: the request handed to the AI.)
//               Save and play → the request for the AI (with placement.json) BEFORE Play, then playing,
//               no Save left; back to Edit: no window, no Save
//               nothing changed → ▶ Play goes straight in (no window)
//   keys      the same with P: P → the window; Enter = Save and play
//   big       a big change (the lighthouse 30 m away): Save and play → "Check before you save" first; its × stays in
//             Edit with nothing saved; "Save anyway" saves, then plays
//   demo      the web demo: the second line says "kept in this browser"; Try / Save and play as above
//   look      PC, the chat's side window, a phone × light, dark (in Japanese; --lang en for English): the window inside
//             the screen, every word fits, narrow = one button per row with the main one on top; photos
//             `choice-<pc|side|phone>-<light|dark>-<1-window|2-play>.png` with --shots
//
//   node test/studio-play-choice.browser.mjs [--shots <dir>] [--only choose,keys,big,demo,look] [--lang ja|en]
// --lang (look only, ja by default): en was added for the public docs' English pictures (docs/site, 2026-10-22).
// Exit 1 on failure.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ONLY = opt('--only') ? opt('--only').split(',') : null;
const want = (name) => !ONLY || ONLY.includes(name);
const LOOK_LANG = opt('--lang') === 'en' ? 'en' : 'ja';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAYOUTS = {
  pc: { id: 'pc', width: 1280, height: 800, mobile: false, dpr: 1 },
  side: { id: 'side', width: 400, height: 900, mobile: false, dpr: 2 },
  phone: { id: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
};

const GAME = `document.querySelector('iframe').contentWindow`;
const EDIT_READY = `document.querySelectorAll('.obj, .noname').length > 0 && !!${GAME}?.__gameStudio?._debug`;
const PLAYING = `document.querySelector('.shell')?.dataset.playing === 'on' && !!${GAME}?.__gameStudio && !${GAME}.__gameStudio._debug`;
// The one Save, beside ▶ Play.
const FAB = `(() => { const f = document.querySelector('[data-part=save]'); return f && !f.hidden && f.offsetParent ? f.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`;
// The window: its kind, title, second line and buttons (empty when closed).
const WIN = `(() => { const g = document.querySelector('[data-part=unsaved-guard]'); if (!g || g.hidden) return 'null';
  const r = (e) => { const b = e.getBoundingClientRect(); return { text: e.textContent, l: b.left, t: b.top, r: b.right, b: b.bottom, fits: e.scrollWidth <= e.clientWidth + 1, bg: getComputedStyle(e).backgroundColor }; };
  return JSON.stringify({ kind: g.dataset.kind, title: g.querySelector('h2').textContent, why: g.querySelector('[data-part=unsaved-guard-why]')?.textContent || '',
    box: r(g), focus: document.activeElement?.dataset.action || '',
    save: r(g.querySelector('[data-action=guard-save]')), skip: r(g.querySelector('[data-action=guard-discard]')), no: r(g.querySelector('[data-action=guard-cancel]')) }); })()`;
// Anything left of the old strip over the game ("This change isn't in the game yet"), or any other line saying it.
const STRIP = `(() => { const n = document.querySelector('[data-part=play-unsaved]'); return !!n || /in the game yet|ゲームに入っていません/.test(document.querySelector('.stage')?.innerText || ''); })()`;
const SAFE = `(() => { const e = document.querySelector('[data-part=safe-save]'); return !!e && !e.hidden; })()`;
const RECT = (sel) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length && x.getBoundingClientRect().width && getComputedStyle(x).visibility !== 'hidden'); if (!e) return null;
  const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()`;
const ORANGE = 'rgb(255, 107, 26)';

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

function gameFolder(src, { theme = 'dark', lang = 'en' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'play-choice-'));
  cpSync(join(PKG, src), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang, theme }));
  return root;
}
const requests = (root) => (existsSync(join(root, '.studio/requests')) ? readdirSync(join(root, '.studio/requests')).filter((f) => f.endsWith('.json')).length : 0);
const savedX = (root, k) => {
  try {
    return JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8')).objects?.[k]?.p?.[0] ?? null;
  } catch {
    return null;
  }
};

const browser = await launch();
let page = null;

async function run(name, layout, opts) {
  const tag = `${name}-${layout.id}${opts.theme ? `-${opts.theme}` : ''}`;
  console.log(tag);
  page = await newPage(browser, { width: layout.width, height: layout.height, mobile: layout.mobile });
  if (!layout.mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: layout.width, height: layout.height, deviceScaleFactor: layout.dpr, mobile: false });
  if (opts.theme) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: opts.theme }] });
  const shot = async (file) => SHOTS && writeFileSync(join(SHOTS, file), await page.screenshot());
  const until = async (fn, ms = 6000) => {
    const t0 = Date.now();
    for (;;) {
      if (await fn().catch(() => false)) return true;
      if (Date.now() - t0 > ms) return false;
      await sleep(200);
    }
  };
  const press = async (p) => (layout.mobile ? page.tap(p.x, p.y) : page.click(p.x, p.y));
  const pressSel = async (sel) => {
    const r = JSON.parse((await page.eval(RECT(sel))) || 'null');
    if (!r) return false;
    await press(r);
    return true;
  };
  const key = async (k, code, vk, text) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  const win = async () => JSON.parse((await page.eval(WIN)) || 'null');
  const nudgeX = async (d) => page.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); if (!i) return false;
    i.value = String((parseFloat(i.value) || 0) + ${d}); i.dispatchEvent(new Event('change')); return true; })()`);
  /** Move `k` by `d` with the card and wait for the count on Save. */
  const move = async (k, d, n = 1) => {
    await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
    await sleep(600);
    check(await nudgeX(d), `moved ${k} with the card`);
    return until(async () => new RegExp(String(n)).test(await page.eval(FAB)), 4000);
  };
  const cardX = async () => parseFloat(await page.eval(`document.querySelector('[data-part=card] .fields input')?.value`));
  const t = { page, tag, shot, until, press, pressSel, key, win, move, cardX, layout };
  try {
    if (opts.fresh) {
      await page.goto(opts.fresh);
      await page.eval(`new Promise((r) => { try { localStorage.clear(); } catch {} const q = indexedDB.deleteDatabase('kumodeck-game-studio-demo'); q.onsuccess = q.onerror = q.onblocked = () => r(true); })`);
    }
    await page.goto(opts.url);
    await page.waitFor(EDIT_READY, 40000);
    await sleep(1200);
    await opts.steps(t);
  } catch (e) {
    check(false, `${tag}: ${e.message}`);
  } finally {
    await page.close();
    page = null;
  }
}

const roots = [];
let srv = null;
const serve = async (root) => {
  if (srv) await srv.close?.();
  srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  return srv.url;
};
const PLAY = '[data-action=play]';

try {
  if (want('choose')) {
    const root = gameFolder('starters/lantern-cove');
    roots.push(root);
    await run('choose', LAYOUTS.pc, { url: await serve(root), steps: async ({ page, until, pressSel, press, key, win, move, cardX }) => {
      // Nothing changed: straight into Play.
      await pressSel(PLAY);
      await sleep(500);
      check((await win()) === null, 'nothing changed: no window');
      check(await until(async () => !!(await page.eval(PLAYING)), 20000), 'nothing changed: playing');
      await pressSel(PLAY);
      await page.waitFor(EDIT_READY, 40000);
      await sleep(800);
      check((await win()) === null, 'Edit from Play: no window');

      check(await move('lighthouse', 6), 'one unsaved move ("Save · 1")');
      const x = await cardX();
      await pressSel(PLAY);
      check(await until(async () => !!(await win()), 3000), 'Play with a change: the window');
      let w = await win();
      check(w?.kind === 'play', `it is Play's window (${w?.kind})`);
      check(w?.title === 'You have 1 unsaved change', `title "${w?.title}"`);
      check(w?.why === 'Save, and your AI puts the changes in the game’s code.', `second line "${w?.why}"`);
      check(w?.save.text === 'Save and play' && w?.skip.text === 'Try without saving' && w?.no.text === 'Cancel', `buttons "${w?.no.text}" · "${w?.skip.text}" · "${w?.save.text}"`);
      check(w?.focus === 'guard-save', 'Save and play has the focus (Enter)');
      check(w?.save.bg === ORANGE, `Save and play is the orange of Save (${w?.save.bg})`);
      // PC: one row, the main one at the right end.
      check(Math.abs(w.save.t - w.skip.t) < 2 && w.save.l > w.skip.l && w.skip.l > w.no.l, 'PC: Cancel · Try without saving · Save and play in one row');

      // Cancel: Edit as it was.
      await pressSel('[data-action=guard-cancel]');
      await sleep(800);
      check((await win()) === null && !!(await page.eval(EDIT_READY)) && !(await page.eval(PLAYING)), 'Cancel: still in Edit');
      check(/1/.test(await page.eval(FAB)) && requests(root) === 0, `Cancel: "${await page.eval(FAB)}", nothing handed to the AI`);
      // Esc: the same.
      await pressSel(PLAY);
      await until(async () => !!(await win()), 3000);
      await key('Escape', 'Escape', 27);
      await sleep(800);
      check((await win()) === null && !(await page.eval(PLAYING)) && requests(root) === 0, 'Esc: still in Edit, nothing handed to the AI');
      // A press outside the window: the same.
      await pressSel(PLAY);
      await until(async () => !!(await win()), 3000);
      await press({ x: 30, y: 400 });
      await sleep(800);
      check((await win()) === null && !(await page.eval(PLAYING)) && requests(root) === 0, 'a press outside: still in Edit, nothing handed to the AI');

      // Try without saving: Play with the move, nothing written, Save stays, no strip.
      await pressSel(PLAY);
      await until(async () => !!(await win()), 3000);
      await pressSel('[data-action=guard-discard]');
      check(await until(async () => !!(await page.eval(PLAYING)), 20000), 'Try without saving: playing');
      const inPlay = await until(async () => {
        const l = JSON.parse(await page.eval(`JSON.stringify(${GAME}.__gameStudio._play?.list() || [])`));
        return Math.abs((l.find((i) => i.key === 'lighthouse')?.pose?.p?.[0] ?? NaN) - x) < 0.06;
      }, 8000);
      check(inPlay, 'Try without saving: the game shows the move');
      check(requests(root) === 0, 'Try without saving: no request for the AI');
      check(/1/.test(await page.eval(FAB)), `Try without saving: "${await page.eval(FAB)}" beside Play`);
      await sleep(600);
      check(!(await page.eval(STRIP)), 'no strip over the game ("not in the game yet")');
      await pressSel(PLAY);
      await page.waitFor(EDIT_READY, 40000);
      await sleep(600);
      check((await win()) === null, 'Edit from Play: no window');
      await page.eval(`studioShell.actions.select('lighthouse')`);
      await sleep(600);
      check(Math.abs((await cardX()) - x) < 0.06 && /1/.test(await page.eval(FAB)), `back in Edit: the move (${await cardX()}) and "${await page.eval(FAB)}" are still there`);

      // Save and play: saved and handed to the AI first, then Play.
      await pressSel(PLAY);
      await until(async () => !!(await win()), 3000);
      // Watch the order: was the game page already in Play when placement.json changed?
      await page.eval(`(window.__playAt = 0, new MutationObserver(() => { if (document.querySelector('.shell')?.dataset.playing === 'on' && !window.__playAt) window.__playAt = Date.now(); }).observe(document.querySelector('.shell'), { attributes: true }), true)`);
      await pressSel('[data-action=guard-save]');
      let savedAt = 0;
      await until(async () => {
        if (!savedAt && requests(root) === 1) savedAt = Date.now();
        return !!savedAt && !!(await page.eval(PLAYING));
      }, 20000);
      const playAt = await page.eval('window.__playAt');
      check(!!savedAt && requests(root) === 1 && Math.abs((savedX(root, 'lighthouse') ?? NaN) - x) < 0.05, `Save and play: placement.json has the move, ${requests(root)} request for the AI`);
      check(!!(await page.eval(PLAYING)), 'Save and play: playing');
      check(!playAt || playAt >= savedAt - 300, `saved before Play (saved ${savedAt ? 'yes' : 'no'}, Play ${playAt ? playAt - savedAt : '?'} ms after)`);
      check(await until(async () => (await page.eval(FAB)) === '', 4000), 'Save and play: no Save left beside Play');
      check(!(await page.eval(STRIP)), 'no strip over the game');
      await pressSel(PLAY);
      await page.waitFor(EDIT_READY, 40000);
      await sleep(600);
      await pressSel(PLAY);
      await sleep(600);
      check((await win()) === null, 'saved: ▶ Play again goes straight in');
    } });
  }

  if (want('keys')) {
    const root = gameFolder('starters/lantern-cove');
    roots.push(root);
    await run('keys', LAYOUTS.pc, { url: await serve(root), steps: async ({ page, until, key, win, move, cardX }) => {
      check(await move('lighthouse', 6), 'one unsaved move');
      const x = await cardX();
      await page.eval(`document.activeElement?.blur?.(), true`);
      await key('p', 'KeyP', 80, 'p');
      check(await until(async () => (await win())?.kind === 'play', 3000), 'P: the same window');
      // The window keeps its keys: a second P presses nothing behind it.
      await key('p', 'KeyP', 80, 'p');
      await sleep(400);
      check((await win())?.kind === 'play' && !(await page.eval(PLAYING)), 'P again: the window stays, still in Edit');
      await key('Escape', 'Escape', 27);
      await sleep(600);
      check((await win()) === null && !(await page.eval(PLAYING)), 'Esc: still in Edit');
      await key('p', 'KeyP', 80, 'p');
      await until(async () => !!(await win()), 3000);
      await key('Enter', 'Enter', 13, '\r');
      check(await until(async () => !!(await page.eval(PLAYING)), 20000), 'Enter = Save and play: playing');
      check(Math.abs((savedX(root, 'lighthouse') ?? NaN) - x) < 0.05 && requests(root) === 1, `Enter: saved (${requests(root)} request)`);
      await key('p', 'KeyP', 80, 'p');
      check(await until(async () => !!(await page.eval(EDIT_READY)), 40000), 'P in Play: back to Edit, no window');
      // Try without saving from the keys: Tab to it, Enter.
      check(await move('lighthouse', 3), 'another move');
      await page.eval(`document.activeElement?.blur?.(), true`);
      await key('p', 'KeyP', 80, 'p');
      await until(async () => !!(await win()), 3000);
      await key('Tab', 'Tab', 9);
      await key('Tab', 'Tab', 9);
      check((await win())?.focus === 'guard-discard', `Tab ×2: "${(await win())?.focus}"`);
      await key('Enter', 'Enter', 13, '\r');
      check(await until(async () => !!(await page.eval(PLAYING)), 20000), 'Enter on Try without saving: playing');
      check(requests(root) === 1 && /1/.test(await page.eval(FAB)), `not saved ("${await page.eval(FAB)}", ${requests(root)} request)`);
    } });
  }

  if (want('big')) {
    const root = gameFolder('starters/lantern-cove');
    roots.push(root);
    await run('big', LAYOUTS.pc, { url: await serve(root), steps: async ({ page, until, pressSel, win, move }) => {
      check(await move('lighthouse', 30), 'the lighthouse 30 m away (a big change)');
      await pressSel(PLAY);
      await until(async () => !!(await win()), 3000);
      await pressSel('[data-action=guard-save]');
      check(await until(async () => !!(await page.eval(SAFE)), 4000), 'Save and play: "Check before you save" first');
      await pressSel('[data-action=safe-cancel]');
      await sleep(1000);
      check(!(await page.eval(PLAYING)) && requests(root) === 0 && /1/.test(await page.eval(FAB)), 'its ×: still in Edit, nothing saved');
      await pressSel(PLAY);
      await until(async () => !!(await win()), 3000);
      await pressSel('[data-action=guard-save]');
      await until(async () => !!(await page.eval(SAFE)), 4000);
      await pressSel('[data-action=safe-save]');
      check(await until(async () => !!(await page.eval(PLAYING)), 20000), '"Save anyway": playing');
      check(requests(root) === 1 && savedX(root, 'lighthouse') !== null, `saved first (${requests(root)} request)`);
    } });
  }

  if (want('demo')) {
    const dir = join(mkdtempSync(join(tmpdir(), 'play-choice-demo-')), 'site');
    roots.push(dirname(dir));
    execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', dir], { stdio: 'ignore' });
    const host = await startHost({ dir });
    try {
      for (const l of [LAYOUTS.pc, LAYOUTS.phone]) {
        await run('demo', l, { fresh: `${host.url}studio/games.json`, url: `${host.url}studio/?game=lantern-cove&lang=en`, steps: async ({ page, until, pressSel, win, move }) => {
          check(await move('lighthouse', 6), 'one unsaved move');
          await pressSel(PLAY);
          check(await until(async () => (await win())?.kind === 'play', 3000), 'the window');
          const w = await win();
          check(w?.why === 'Save, and your changes are kept in this browser.', `the demo's second line "${w?.why}"`);
          await pressSel('[data-action=guard-discard]');
          check(await until(async () => !!(await page.eval(PLAYING)), 20000), 'Try without saving: playing');
          check(/1/.test(await page.eval(FAB)) && !(await page.eval(STRIP)), `"${await page.eval(FAB)}" beside Play, no strip`);
          await pressSel(PLAY);
          await page.waitFor(EDIT_READY, 40000);
          await sleep(600);
          await pressSel(PLAY);
          await until(async () => !!(await win()), 3000);
          await pressSel('[data-action=guard-save]');
          check(await until(async () => !!(await page.eval(PLAYING)), 20000), 'Save and play: playing');
          check(await until(async () => (await page.eval(FAB)) === '', 4000), 'saved: no Save left');
        } });
      }
    } finally {
      await host.close?.();
    }
  }

  if (want('look')) {
    for (const theme of ['light', 'dark']) for (const l of [LAYOUTS.pc, LAYOUTS.side, LAYOUTS.phone]) {
      const root = gameFolder('starters/lantern-cove', { theme, lang: LOOK_LANG });
      roots.push(root);
      await run('look', l, { theme, url: await serve(root), steps: async ({ page, until, pressSel, win, move, shot, layout }) => {
        // Three changes, so the photo shows the number.
        check(await move('lighthouse', 6), 'a move');
        const others = JSON.parse(await page.eval(`JSON.stringify(${GAME}.__gameStudio._debug.list().map((i) => i.key))`)).filter((k) => /^pine/.test(k)).slice(0, 2);
        for (const [i, k] of others.entries()) check(await move(k, 2, i + 2), `and ${k}`);
        await pressSel(PLAY);
        check(await until(async () => (await win())?.kind === 'play', 3000), 'the window');
        await sleep(500);
        const w = await win();
        // The words (src/shell/i18n.ts guard.title / playWhy / playSave / playTry / cancel) in the language shown.
        const W = LOOK_LANG === 'ja'
          ? { title: '保存していない変更が 3 個あります', why: '保存すると AI がゲームのコードに入れます。', save: '保存して遊ぶ', skip: '保存せずに試す', no: 'やめる' }
          : { title: 'You have 3 unsaved changes', why: 'Save, and your AI puts the changes in the game’s code.', save: 'Save and play', skip: 'Try without saving', no: 'Cancel' };
        check(w?.title === W.title, `「${w?.title}」`);
        check(w?.why === W.why, `「${w?.why}」`);
        check(w?.save.text === W.save && w?.skip.text === W.skip && w?.no.text === W.no, `「${w?.save.text}」「${w?.skip.text}」「${w?.no.text}」`);
        check(w?.save.bg === ORANGE, `${W.save} is orange (${w?.save.bg})`);
        check(w.box.l >= 8 && w.box.t >= 8 && w.box.r <= layout.width - 8 && w.box.b <= layout.height - 8, `inside the screen (${Math.round(w.box.l)}, ${Math.round(w.box.t)} – ${Math.round(w.box.r)}, ${Math.round(w.box.b)})`);
        check(w.save.fits && w.skip.fits && w.no.fits, 'every button\'s words fit');
        if (layout.id === 'pc') check(Math.abs(w.save.t - w.no.t) < 2 && w.save.l > w.skip.l, 'PC: one row, the main one at the right');
        else check(w.save.b <= w.skip.t + 1 && w.skip.b <= w.no.t + 1 && Math.abs(w.save.l - w.no.l) < 2, `narrow: one per row, ${W.save} on top`);
        await shot(`choice-${layout.id}-${theme}-1-window.png`);
        await pressSel('[data-action=guard-discard]');
        check(await until(async () => !!(await page.eval(PLAYING)), 20000), `${W.skip}: playing`);
        await sleep(1500);
        check(!(await page.eval(STRIP)) && /3/.test(await page.eval(FAB)), `playing: no strip, 「${await page.eval(FAB)}」 beside Play`);
        await shot(`choice-${layout.id}-${theme}-2-play.png`);
      } });
    }
  }
} finally {
  await browser.close?.();
  await srv?.close?.();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
