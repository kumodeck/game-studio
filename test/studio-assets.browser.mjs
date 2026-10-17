// The Assets panel always ends in an answer (play test 2026-10-17: "the assets don't show up" — Firefly
// Ruins' Assets said "0 files" + "Reading the folder…" and stayed there).
//
//   node test/studio-assets.browser.mjs [--shots <dir>] [--lang ja|en] [--only firefly-ruins,lantern-cove]
//
// Per starter (Firefly Ruins 2D, Lantern Cove 3D), local editor, 1280×800, headless:
//   1. the starter as `--starter` copies it (no asset files: both samples draw in code), Assets
//      opened at once / after the scene / after ▶ Play and back → "No assets yet…", never
//      "Reading the folder…", no "0 files"
//   2. the same game with two files in assets/ → both listed, "2 files"
//   3. the folder read fails (the shell's fetch of api/assets answers 500) → "Couldn't read the
//      folder (…)." + Try again; the read works again → Try again → the files are listed
//   4. (Firefly Ruins only, it takes 15 s) the read never answers → "no answer after 15 seconds"
// No page errors anywhere. Exit 1 on failure.
//
// WHY a fetch wrapper and not CDP Fetch: cdp.mjs's page already answers every paused request
// itself (its CDN cache), and two handlers for one request race.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { copyStarter, readStarters } from '../src/server/starters.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const LANG = opt('--lang') || 'en';
const ONLY = opt('--only')?.split(',');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in every frame before its own scripts. Only the shell's own api/assets call is touched,
// and only while window.__assetsFail is set: '500' = an error answer, 'hang' = no answer at all.
const FETCH_SWITCH = `(() => {
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const mode = window.__assetsFail;
    if (mode && /\\/__studio\\/api\\/assets(\\?|$)/.test(new URL(url, location.href).pathname + '?')) {
      if (mode === 'hang') return new Promise(() => {});
      return Promise.resolve(new Response(JSON.stringify({ error: 'disk on fire' }), { status: 500, headers: { 'content-type': 'application/json' } }));
    }
    return real(input, init);
  };
})();`;

const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`,
  state: `JSON.stringify({
    names: [...document.querySelectorAll('.gsl-tile .gsl-name')].map((e) => e.textContent),
    count: document.querySelector('.gsl-count')?.textContent ?? null,
    empty: document.querySelector('.gsl-empty')?.textContent ?? null,
    fail: document.querySelector('.gsl-readfail:not([hidden])')?.textContent ?? null,
  })`,
  click: (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`,
};
const LOADING = { en: 'Reading the folder…', ja: 'フォルダを読んでいます…' }[LANG];

async function run(starter) {
  const tag = starter.id;
  const step = (s) => console.log(`  ✓ ${tag}: ${s}`);
  const shot = async (page, name) => SHOTS && writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
  const root = mkdtempSync(join(tmpdir(), `studio-assets-${tag}-`));
  await copyStarter(starter, root);
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FETCH_SWITCH });
  const state = async () => JSON.parse(await page.eval(IN.state));
  const open = async () => {
    await page.goto(`${srv.url}&lang=${LANG}`);
    await page.waitFor(`!!document.querySelector('[data-tool=library]')`, 15000);
  };
  const toAssets = async () => {
    await page.eval(IN.click('[data-tool=library]'));
    await page.waitFor(`document.querySelector('[data-tool=library]')?.getAttribute('aria-selected') === 'true'`);
  };
  const toScene = () => page.eval(IN.click('[data-tool=placement]'));
  /** Wait until the panel shows an answer (a list, an empty line other than "Reading…", or the failure). */
  const settled = async (ms = 10000) => {
    await page.waitFor(`(() => { const s = ${IN.state}; const v = JSON.parse(s);
      return v.names.length > 0 || v.fail || (v.empty && v.empty !== ${JSON.stringify(LOADING)}); })()`, ms);
    return state();
  };
  try {
    // --- 1. no asset files: an answer, whatever the order ---
    await open();
    await toAssets(); // before the game is ready
    let s = await settled();
    assert.deepEqual(s.names, []);
    assert.ok(s.empty && s.empty !== LOADING, `first: ${JSON.stringify(s)}`);
    assert.equal(s.count, '', '"0 files" shown above the empty line');
    step(`Assets at once → "${s.empty}"`);
    await shot(page, '1-empty');
    await page.waitFor(IN.ready, 30000);
    await toScene();
    await sleep(300);
    await toAssets();
    s = await settled();
    assert.ok(s.empty && s.empty !== LOADING && !s.names.length, `scene → assets: ${JSON.stringify(s)}`);
    step('scene → Assets → same answer');
    await toScene();
    await page.eval(IN.click('[data-action=play]'));
    await sleep(1500);
    await page.eval(IN.click('[data-action=play]'));
    await page.waitFor(IN.ready, 30000);
    await toAssets();
    s = await settled();
    assert.ok(s.empty && s.empty !== LOADING && !s.names.length, `after play: ${JSON.stringify(s)}`);
    step('▶ Play → Edit → Assets → same answer');

    // --- 2. two files in assets/ ---
    mkdirSync(join(root, 'assets'), { recursive: true });
    copyFileSync(join(starter.dir, 'thumb.png'), join(root, 'assets', 'sign.png'));
    writeFileSync(join(root, 'assets', 'chime.wav'), wav());
    await open();
    await page.waitFor(IN.ready, 30000);
    await toAssets();
    s = await settled();
    assert.deepEqual(s.names.sort(), ['chime.wav', 'sign.png']);
    assert.match(s.count, /2/);
    step(`two files → listed (${s.count})`);
    await shot(page, '2-files');

    // --- 3. the read fails → the failure line + Try again → works again ---
    // Leaving Assets unmounts the panel; the next Assets is a fresh panel whose first read fails.
    await toScene();
    await page.eval(`window.__assetsFail = '500'`);
    await toAssets();
    s = await settled();
    assert.ok(s.fail, `no failure line: ${JSON.stringify(s)}`);
    assert.ok(!s.empty, 'the failure and "Reading the folder…" / an empty line both shown');
    assert.match(s.fail, /disk on fire/);
    step(`read fails → "${s.fail}"`);
    await shot(page, '3-failed');
    await page.eval(`window.__assetsFail = null`);
    assert.ok(await page.eval(IN.click('[data-action=library-retry]')), 'no Try again button');
    await page.waitFor(`document.querySelectorAll('.gsl-tile .gsl-name').length === 2`, 10000);
    s = await state();
    assert.equal(s.fail, null, 'the failure line stayed after a good read');
    step('Try again → listed');

    // --- 4. the read never answers (15 s) ---
    if (starter.id === 'firefly-ruins') {
      await toScene();
      await page.eval(`window.__assetsFail = 'hang'`);
      await toAssets();
      await page.waitFor(`!!document.querySelector('.gsl-readfail:not([hidden])')`, 20000);
      s = await state();
      assert.match(s.fail, /15/);
      step(`no answer → "${s.fail}" after 15 s`);
      await shot(page, '4-no-answer');
      await page.eval(`window.__assetsFail = null`);
    }

    const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (e) {
    console.log(page.logs.slice(-20).join('\n'));
    await shot(page, 'FAIL').catch(() => {});
    throw e;
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** A 0.1 s silent WAV (44-byte header + samples), so the sound row has a real file. */
function wav() {
  const n = 4410;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24);
  b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

const starters = (await readStarters(join(PKG, 'starters'))).filter((s) => !ONLY || ONLY.includes(s.id));
assert.ok(starters.length, 'no starters');
let failed = 0;
for (const s of starters) {
  try {
    await run(s);
  } catch (e) {
    failed++;
    console.error(`✗ ${s.id}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
