// "You have 3 unsaved changes" before edits are lost (a try of the editor, 2026-10-21: "some people forget to press Save — we have to make
// them notice. When edits are about to be lost, show a modal"). src/shell/unsaved-guard.ts says what each step loses.
// Every step of that list, each with: changes → the step → the window / no changes → none / Cancel → nothing happens /
// Save and continue → saved first, then the step. Real clicks and taps (and keys) wherever a person would use them.
//
//   leave-link   local Lantern Cove, the Look page's "Back to the original look" link (it opens another page in this tab):
//                no changes → it goes; changes → the window; Esc and Cancel stay; Tab stays inside; Enter = Save and
//                continue → placement.json + one request for the AI, then the page goes
//   unload       local Lantern Cove: the browser's own question (beforeunload) on reload only while something is
//                unsaved; none after Save
//   play         local Lantern Cove: since the same day ▶ Play with anything unsaved asks first — Save and play / Try
//                without saving (kind 'play'; the whole of it in test/studio-play-choice.browser.mjs). Here, a game
//                tool's unsaved data: the window says Try loses it; Cancel stays in Edit, Save and play writes
//                .studio/data/mark.json first, Try without saving plays and the file keeps what was saved
//   ai-reload    local Lantern Cove + a game tool: the AI changes the game's code → the window before the game reloads;
//                Cancel keeps the old page (and asks no more for that change); after Save it reloads by itself
//   layer        Glow Garden: World ↔ UI with an unsaved move asks nothing, the count stays
//   demo         the web demo: "← Samples" with an unsaved move asks nothing (its draft is its save, nothing is lost)
//                and the editor opened again shows the move; no beforeunload either
//   look         the window in PC, the chat's side window and a phone × light and dark: inside the screen; photos
//
//   node test/studio-unsaved-guard.browser.mjs [--shots <dir>] [--only leave-link,unload,…]
// Exit 1 on failure.
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAYOUTS = {
  pc: { id: 'pc', width: 1280, height: 800, mobile: false, dpr: 1 },
  side: { id: 'side', width: 400, height: 900, mobile: false, dpr: 2 },
  phone: { id: 'phone', width: 390, height: 844, mobile: true, dpr: 2 },
};

const GAME = `document.querySelector('iframe').contentWindow`;
const EDIT_READY = `document.querySelectorAll('.obj, .noname').length > 0 && !!${GAME}?.__gameStudio?._debug`;
const PLAYING = `!!${GAME}?.__gameStudio && !${GAME}.__gameStudio._debug`;
// The one Save, beside ▶ Play (2026-10-21; it was the Save in the game's corner, [data-part=save-fab], until then).
const FAB = `(() => { const f = document.querySelector('[data-part=save]'); return f && !f.hidden && f.offsetParent ? f.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`;
// Play's window: the line that says a game tool's changes are lost by Try without saving.
const TOOLS_LINE = `document.querySelector('[data-part=unsaved-guard]:not([hidden]) [data-part=unsaved-guard-tools]')?.textContent || ''`;
const GUARD = `(() => { const g = document.querySelector('[data-part=unsaved-guard]'); return g && !g.hidden ? g.querySelector('h2').textContent : ''; })()`;
const RECT = (sel) => `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length && x.getBoundingClientRect().width && getComputedStyle(x).visibility !== 'hidden'); if (!e) return null;
  // A link that wraps onto two lines: its first line (the middle of its whole box can be between the two).
  const b = e.getBoundingClientRect(), r = e.tagName === 'A' ? e.getClientRects()[0] : b; return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, left: b.left, top: b.top, right: b.right, bottom: b.bottom }); })()`;
const keyDown = (k, extra = {}) => `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ...${JSON.stringify(extra)} }))`;
// The handler's answer itself (what the browser asks the page before it shows its question).
const UNLOAD_ASKS = `(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()`;

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

// A game tool that counts each press in the game as one unsaved change (the shape of CONTRACT.md §7's tools).
const MARK_TOOL = `studio.extend({ tools: [{
  id: 'mark', label: { en: 'Mark', ja: 'しるし' }, icon: '✎', marks: 0,
  pointer(e, ctx) { if (e.type === 'up') { this.marks++; ctx.changed(); } return true; },
  data() { return { marks: this.marks }; },
  restore(d) { this.marks = (d && d.marks) || 0; },
}] });
`;

function gameFolder(src, { theme = 'dark', look = false, tool = false, lang = 'en' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'unsaved-guard-'));
  cpSync(join(PKG, src), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang, theme }));
  // An AI-written look (one harmless rule) gives the Look page its "Back to the original look" link (?ui=off).
  if (look) writeFileSync(join(root, '.studio/ui/studio.css'), '/* written by the AI (test) */ .brand .app { letter-spacing: 0; }\n');
  if (tool) writeFileSync(join(root, '.studio/tools.js'), MARK_TOOL);
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
// The browser's own questions (beforeunload), seen by the protocol; answered "Stay" unless told otherwise.
const dialogs = [];
let dialogAnswer = false;
let page = null;
browser.on((m) => {
  if (m.method !== 'Page.javascriptDialogOpening' || !page) return;
  dialogs.push(m.params.type);
  void page.send('Page.handleJavaScriptDialog', { accept: dialogAnswer }).catch(() => {});
});

async function run(name, layout, opts) {
  const tag = `${name}-${layout.id}${opts.theme ? `-${opts.theme}` : ''}`;
  console.log(tag);
  page = await newPage(browser, { width: layout.width, height: layout.height, mobile: layout.mobile });
  if (!layout.mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: layout.width, height: layout.height, deviceScaleFactor: layout.dpr, mobile: false });
  let n = 0;
  const shot = async (what) => {
    if (!SHOTS) return;
    // JPEG 80 like the photos of play-unsaved (PNG of a 3D game is ~1 MB a picture).
    const r = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    writeFileSync(join(SHOTS, `${tag}-${++n}-${what}.jpg`), Buffer.from(r.data, 'base64'));
  };
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
  const nudgeX = async (d) => page.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); if (!i) return false;
    i.value = String((parseFloat(i.value) || 0) + ${d}); i.dispatchEvent(new Event('change')); return true; })()`);
  /** Move `k` by `d` with the card (one unsaved change) and wait for "Save · 1". */
  const move = async (k, d) => {
    await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
    await sleep(600);
    check(await nudgeX(d), `moved ${k} with the card`);
    return until(async () => /1/.test(await page.eval(FAB)), 4000);
  };
  const guardText = () => page.eval(GUARD);
  const openLook = async () => {
    await page.eval(`studioShell.actions.openSettings()`);
    const shown = await until(async () => !!(await page.eval(RECT('[data-part=ai-look] a'))), 4000);
    // The narrow layouts' sheet grows to the page (an animation): press the link where it ends up.
    let last = '';
    await until(async () => {
      const now = await page.eval(RECT('[data-part=ai-look] a'));
      const still = now === last;
      last = now;
      return still;
    }, 3000);
    return shown;
  };
  const t = { page, tag, shot, until, press, pressSel, move, guardText, openLook, layout };
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

try {
  if (want('leave-link')) {
    const root = gameFolder('starters/lantern-cove', { look: true });
    roots.push(root);
    const url = await serve(root);
    await run('leave-link', LAYOUTS.pc, { url, steps: async ({ page, move, guardText, openLook, pressSel, until, shot }) => {
      // No changes: the link just goes.
      check(await openLook(), 'the Look page has "Back to the original look"');
      await pressSel('[data-part=ai-look] a');
      check(await until(async () => /ui=off/.test(await page.eval('location.href')), 8000), 'no changes: the link opens its page, no window');
      await page.goto(url);
      await page.waitFor(EDIT_READY, 40000);
      await sleep(1000);

      check(await move('lighthouse', 6), 'one unsaved change ("Save · 1")');
      const x = await page.eval(`parseFloat(document.querySelector('[data-part=card] .fields input').value)`);
      await openLook();
      await pressSel('[data-part=ai-look] a');
      check(await until(async () => (await guardText()) === 'You have 1 unsaved change', 3000), `the window: "${await guardText()}"`);
      check((await page.eval(`document.activeElement?.dataset.action`)) === 'guard-save', 'Save and continue has the focus');
      await shot('window');
      // Tab goes round the three buttons and stays inside.
      const seen = [];
      for (let i = 0; i < 4; i++) {
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        seen.push(await page.eval(`document.activeElement?.dataset.action || document.activeElement?.tagName`));
      }
      check(seen.join(',') === 'guard-cancel,guard-discard,guard-save,guard-cancel', `Tab stays inside (${seen.join(', ')})`);
      // Esc = Cancel: nothing happens.
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(600);
      check((await guardText()) === '' && !/ui=off/.test(await page.eval('location.href')), 'Esc: closed, still here');
      check(/1/.test(await page.eval(FAB)) && requests(root) === 0, `Esc: still "Save · 1", nothing saved (${requests(root)} requests)`);
      // The Cancel button: the same.
      await pressSel('[data-part=ai-look] a');
      await until(async () => !!(await guardText()), 3000);
      await pressSel('[data-action=guard-cancel]');
      await sleep(600);
      check((await guardText()) === '' && !/ui=off/.test(await page.eval('location.href')) && requests(root) === 0, 'Cancel: closed, still here, nothing saved');
      // Enter = Save and continue: saved and handed to the AI first, then the page goes.
      await pressSel('[data-part=ai-look] a');
      await until(async () => !!(await guardText()), 3000);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      check(await until(async () => /ui=off/.test(await page.eval('location.href').catch(() => '')), 10000), 'Enter: the page went on');
      check(Math.abs((savedX(root, 'lighthouse') ?? NaN) - x) < 0.05 && requests(root) === 1, `Enter: saved first (placement.json x ${savedX(root, 'lighthouse')}, ${requests(root)} request for the AI)`);
      check(dialogs.length === 0, `no browser question on the way (${dialogs.join(',')})`);
    } });
  }

  if (want('unload')) {
    const root = gameFolder('starters/lantern-cove');
    roots.push(root);
    const url = await serve(root);
    await run('unload', LAYOUTS.pc, { url, steps: async ({ page, move, until, pressSel }) => {
      // The browser asks only after the page has been used (a real press first).
      await pressSel('.brand .title');
      check((await page.eval(UNLOAD_ASKS)) === false, 'no changes: the page does not ask');
      dialogs.length = 0;
      await page.eval(`(window.__before = 1, setTimeout(() => location.reload(), 0), true)`);
      await page.waitFor(`!window.__before && ${EDIT_READY}`, 40000);
      check(dialogs.length === 0, 'no changes: reloads without the browser\'s question');
      await sleep(1500);
      check(await move('lighthouse', 6), 'one unsaved change');
      await pressSel('.brand .title');
      check((await page.eval(UNLOAD_ASKS)) === true, 'changes: the page asks (beforeunload)');
      dialogs.length = 0;
      dialogAnswer = false;
      await page.eval(`setTimeout(() => location.reload(), 0), true`);
      const asked = await until(async () => dialogs.includes('beforeunload'), 4000);
      check(asked, `reload: the browser's own question (${dialogs.join(',') || 'none'})`);
      await sleep(800);
      check(/1/.test(await page.eval(FAB)), 'Stay: still here with "Save · 1"');
      await page.eval(`studioShell.actions.save()`);
      await until(async () => requests(root) === 1, 4000);
      await sleep(600);
      check((await page.eval(UNLOAD_ASKS)) === false, 'after Save: the page does not ask');
    } });
  }

  if (want('play')) {
    const root = gameFolder('starters/lantern-cove', { tool: true });
    roots.push(root);
    const url = await serve(root);
    await run('play', LAYOUTS.pc, { url, steps: async ({ page, move, guardText, pressSel, until, press, shot }) => {
      const playBtn = '[data-action=play]';
      // Unsaved moves: Play asks (Save and play / Try without saving); Try keeps them (play-unsaved, 2026-10-21).
      check(await move('lighthouse', 6), 'one unsaved move');
      const x = await page.eval(`parseFloat(document.querySelector('[data-part=card] .fields input').value)`);
      await pressSel(playBtn);
      check(await until(async () => (await guardText()) === 'You have 1 unsaved change', 3000), `Play with an unsaved move: the window ("${await guardText()}")`);
      check(!(await page.eval(TOOLS_LINE)), 'no game tool line (nothing of a tool is lost)');
      await pressSel('[data-action=guard-discard]');
      check(await until(async () => !!(await page.eval(PLAYING)), 20000), 'Try without saving: playing');
      await pressSel(playBtn);
      await page.waitFor(EDIT_READY, 40000);
      check(/1/.test(await page.eval(FAB)), `back in Edit: still "${await page.eval(FAB)}"`);
      // A game tool's unsaved data (only in the game page).
      const markOnce = async () => {
        await page.waitFor(`!!document.querySelector('[data-game-tool=mark]')`, 8000);
        if ((await page.eval(`document.querySelector('[data-game-tool=mark]').getAttribute('aria-pressed')`)) !== 'true') await pressSel('[data-game-tool=mark]');
        await page.waitFor(`document.querySelector('[data-game-tool=mark]').getAttribute('aria-pressed') === 'true'`, 3000);
        const g = JSON.parse(await page.eval(RECT('iframe')));
        await press({ x: g.left + (g.right - g.left) * 0.3, y: g.top + (g.bottom - g.top) * 0.6 });
        return until(async () => /\(1\)/.test(await page.eval(`document.querySelector('[data-game-tool=mark]').textContent`)), 3000);
      };
      check(await markOnce(), 'the game tool has 1 unsaved change');
      await pressSel(playBtn);
      check(await until(async () => (await guardText()) === 'You have 2 unsaved changes', 3000), `Play with the move and the tool's data: "${await guardText()}"`);
      check(/^1 change in a game tool is lost/.test(await page.eval(TOOLS_LINE)), `the window says Try loses the tool's change ("${await page.eval(TOOLS_LINE)}")`);
      await shot('play-window');
      await pressSel('[data-action=guard-cancel]');
      await sleep(1200);
      check((await guardText()) === '' && !!(await page.eval(EDIT_READY)), 'Cancel: still in Edit');
      check(/\(1\)/.test(await page.eval(`document.querySelector('[data-game-tool=mark]').textContent`)), 'Cancel: the tool still has its change');
      // Save and play: .studio/data/mark.json first, then Play.
      await pressSel(playBtn);
      check(await until(async () => !!(await guardText()), 3000), 'Play again: the window again');
      await pressSel('[data-action=guard-save]');

      check(await until(async () => !!(await page.eval(PLAYING)), 20000), 'Save and play: playing');
      const data = existsSync(join(root, '.studio/data/mark.json')) ? JSON.parse(readFileSync(join(root, '.studio/data/mark.json'), 'utf8')) : null;
      check(data?.marks === 1, `Save and play: saved first (.studio/data/mark.json ${JSON.stringify(data)})`);
      check(Math.abs((savedX(root, 'lighthouse') ?? NaN) - x) < 0.05 && requests(root) === 2, `the move was saved with it (${requests(root)} requests for the AI: placement.json and the tool's data)`);
      await pressSel(playBtn);
      await page.waitFor(EDIT_READY, 40000);
      await sleep(800);
      // Try without saving: plays, the file keeps what was saved.
      check(await markOnce(), 'the game tool has 1 new unsaved change');
      await pressSel(playBtn);
      await until(async () => !!(await guardText()), 3000);
      await pressSel('[data-action=guard-discard]');
      check(await until(async () => !!(await page.eval(PLAYING)), 20000), 'Try without saving: playing');
      check(JSON.parse(readFileSync(join(root, '.studio/data/mark.json'), 'utf8')).marks === 1, 'Try without saving: the file is as it was saved');
    } });
  }

  if (want('ai-reload')) {
    const root = gameFolder('starters/lantern-cove', { tool: true });
    roots.push(root);
    const url = await serve(root);
    await run('ai-reload', LAYOUTS.pc, { url, steps: async ({ page, guardText, pressSel, until, press }) => {
      await page.waitFor(`!!document.querySelector('[data-game-tool=mark]')`, 8000);
      await pressSel('[data-game-tool=mark]');
      await page.waitFor(`document.querySelector('[data-game-tool=mark]').getAttribute('aria-pressed') === 'true'`, 3000);
      const g = JSON.parse(await page.eval(RECT('iframe')));
      await press({ x: g.left + (g.right - g.left) * 0.3, y: g.top + (g.bottom - g.top) * 0.6 });
      check(await until(async () => /\(1\)/.test(await page.eval(`document.querySelector('[data-game-tool=mark]').textContent`)), 3000), 'the game tool has 1 unsaved change');
      await page.eval(`(${GAME}.__guardMark = 1, true)`);
      // The AI changes the game's code (a line at the end of its script): the editor would reload the game.
      appendFileSync(join(root, 'js/main.js'), '\n// changed by the AI (test)\n');
      check(await until(async () => (await guardText()) === 'You have 1 unsaved change', 12000), `the AI's change: the window first ("${await guardText()}")`);
      await pressSel('[data-action=guard-cancel]');
      await sleep(7000);
      check((await guardText()) === '', 'Cancel: not asked again for the same change');
      check((await page.eval(`${GAME}.__guardMark === 1`)) === true, 'Cancel: the game page was not reloaded');
      await page.eval(`studioShell.actions.save()`);
      check(await until(async () => existsSync(join(root, '.studio/data/mark.json')), 5000), 'Save: .studio/data/mark.json');
      check(await until(async () => (await page.eval(`${GAME}?.__guardMark`).catch(() => 1)) !== 1 && !!(await page.eval(EDIT_READY)), 15000), 'after Save: the AI\'s change shows by itself (the game reloaded)');
      check((await guardText()) === '', 'no window then');
    } });
  }

  if (want('layer')) {
    const root = gameFolder('examples/three-hud');
    roots.push(root);
    const url = await serve(root);
    await run('layer', LAYOUTS.pc, { url, steps: async ({ page, guardText, until }) => {
      // The title card moved on the UI layer (as in play-unsaved's Glow Garden case), then back to the World and again.
      await page.eval(keyDown('u'));
      await sleep(1200);
      await page.eval(`studioShell.actions.select('title-card')`);
      await sleep(700);
      await nudgeAgain(page, 60);
      check(await until(async () => /1/.test(await page.eval(FAB)), 4000), `one unsaved move on the UI layer ("${await page.eval(FAB)}")`);
      await page.eval(keyDown('u'));
      await sleep(1200);
      check((await guardText()) === '' && /1/.test(await page.eval(FAB)), `UI → World: no window, "${await page.eval(FAB)}"`);
      await page.eval(keyDown('u'));
      await sleep(1200);
      check((await guardText()) === '' && /1/.test(await page.eval(FAB)), `World → UI: no window, "${await page.eval(FAB)}"`);
    } });
  }

  if (want('demo')) {
    const dir = join(mkdtempSync(join(tmpdir(), 'unsaved-guard-demo-')), 'site');
    roots.push(dirname(dir));
    execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', dir], { stdio: 'ignore' });
    const host = await startHost({ dir });
    try {
      const url = `${host.url}studio/?game=lantern-cove&lang=en`;
      await run('demo', LAYOUTS.pc, { fresh: `${host.url}studio/games.json`, url, steps: async ({ page, move, guardText, pressSel, until }) => {
        check(await move('lighthouse', 6), 'one unsaved move');
        const x = await page.eval(`parseFloat(document.querySelector('[data-part=card] .fields input').value)`);
        check((await page.eval(UNLOAD_ASKS)) === false, 'the demo does not ask on leaving (its draft is its save)');
        dialogs.length = 0;
        await pressSel('.demo-back');
        await sleep(500);
        check((await guardText()) === '', '"← Samples": no window');
        check(await until(async () => !/studio\/\?game/.test(await page.eval('location.href').catch(() => 'studio/?game')), 8000), '"← Samples": went to the samples');
        check(dialogs.length === 0, 'no browser question');
        await page.goto(url);
        await page.waitFor(EDIT_READY, 40000);
        await page.eval(`studioShell.actions.select('lighthouse')`);
        await sleep(800);
        const back = await page.eval(`parseFloat(document.querySelector('[data-part=card] .fields input').value)`);
        check(Math.abs(back - x) < 0.06, `opened again: the lighthouse is where it was put (${back}, want ${x})`);
      } });
    } finally {
      await host.close?.();
    }
  }

  if (want('look')) {
    // The six of the brief (PC, the chat's side window, a phone × light, dark) in English, and one in Japanese.
    const looks = [];
    for (const theme of ['light', 'dark']) for (const l of [LAYOUTS.pc, LAYOUTS.side, LAYOUTS.phone]) looks.push({ theme, l, lang: 'en' });
    looks.push({ theme: 'light', l: LAYOUTS.pc, lang: 'ja' }, { theme: 'dark', l: LAYOUTS.phone, lang: 'ja' });
    for (const { theme, l, lang } of looks) {
      {
        const root = gameFolder('starters/lantern-cove', { look: true, theme, lang });
        roots.push(root);
        await run(lang === 'en' ? 'look' : `look-${lang}`, l, { theme, url: await serve(root), steps: async ({ page, move, guardText, openLook, pressSel, until, shot, layout }) => {
          // Three changes (three objects), so the photo shows the plural.
          check(await move('lighthouse', 6), 'a move');
          const others = JSON.parse(await page.eval(`JSON.stringify(${GAME}.__gameStudio._debug.list().map((i) => i.key))`))
            .filter((k) => /^pine/.test(k)).slice(0, 2);
          for (const k of others) {
            await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
            await sleep(600);
            await nudgeAgain(page, 2);
          }
          check(await until(async () => /3/.test(await page.eval(FAB)), 4000), `three unsaved changes ("${await page.eval(FAB)}")`);
          check(await openLook(), 'the Look page');
          await pressSel('[data-part=ai-look] a');
          const want = lang === 'en' ? 'You have 3 unsaved changes' : '保存していない変更が 3 個あります';
          check(await until(async () => (await guardText()) === want, 3000), `the window: "${await guardText()}"`);
          await sleep(400);
          const box = JSON.parse(await page.eval(RECT('[data-part=unsaved-guard]')));
          check(box.left >= 8 && box.top >= 8 && box.right <= layout.width - 8 && box.bottom <= layout.height - 8, `inside the screen (${Math.round(box.left)}, ${Math.round(box.top)} – ${Math.round(box.right)}, ${Math.round(box.bottom)})`);
          const fits = await page.eval(`[...document.querySelectorAll('[data-part=unsaved-guard] button')].every((b) => b.scrollWidth <= b.clientWidth + 1)`);
          check(fits, 'every button\'s words fit');
          await shot('window');
          await pressSel('[data-action=guard-cancel]');
          await sleep(500);
          check((await guardText()) === '', 'Cancel closes it');
        } });
      }
    }
  }
} finally {
  await browser.close?.();
  await srv?.close?.();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}

async function nudgeAgain(p, d) {
  await p.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); i.value = String((parseFloat(i.value) || 0) + ${d}); i.dispatchEvent(new Event('change')); })()`);
  await sleep(500);
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
