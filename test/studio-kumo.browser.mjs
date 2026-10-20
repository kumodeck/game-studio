// "Make with AI" (optional KUMODeck sign-in) end to end in a headless browser: the real local
// server, the built shell, an example game, and a fake KUMODeck on 127.0.0.1 (nothing leaves the
// machine). 2026-10-16.
//
//   node test/studio-kumo.browser.mjs [--shots <dir>] [--lang ja]
//
// At 1280×800 (mouse) and 390×844 (touch):
//   1. not signed in: one quiet "Make with AI" button; opened = one sentence + `npx kumodeck login`
//   2. the CLI signs in (credentials.json appears) → "I signed in" → the form with balance and price
//   0. (1280 only) a game with no assets: "No assets yet…", not "Reading the folder…" forever
//   3. a picture: KUMODeck asks for the AI terms once → tick "I agree" → Make → assets/<name>.jpg,
//      New in the grid, balance went down, and NO "Save · 1" (the file is already in assets/)
//   4. a 3D model (11 MB, slow): Make → a "Making · 0:01" tile in the grid and a waiting line with
//      the usual time → the model lands in assets/ → the credits are read again without reopening
//      → "heavy for a web game" + "Ask my AI to make it lighter" → a request for the AI in
//      .studio/requests/ → still no "Save · 1"; the file's detail says the same and shows it sent
//   5. balance too low: Make is disabled and says why (nothing sent)
//   6. the key never appears in the page
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { fakeKumoServer, FAKE_KUMO_TOKEN as TOKEN, FAKE_KUMO_PROJECT as PROJECT } from './kumo-fake.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shotsAt = args.indexOf('--shots');
const SHOTS = shotsAt >= 0 ? resolve(args.splice(shotsAt, 2)[1]) : null;
const langAt = args.indexOf('--lang');
const LANG = langAt >= 0 ? args.splice(langAt, 2)[1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IN = {
  visible: (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].some(e => e.offsetParent)`,
  click: (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent); if (!el || el.disabled) return false; el.click(); return true; })()`,
  text: (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent).map(e => e.textContent).join(' | ')`,
  type: (sel, v) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  disabled: (sel) => `!!document.querySelector(${JSON.stringify(sel)})?.disabled`,
};

async function run(mobile) {
  const tag = mobile ? '390' : '1280';
  const base = mkdtempSync(join(tmpdir(), 'studio-kumo-'));
  const root = join(base, 'game');
  const home = join(base, 'home');
  cpSync(join(PKG, 'examples/canvas-stars'), root, { recursive: true });
  if (LANG) {
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  }
  const kumo = await fakeKumoServer({ delayMs: 1500, modelBytes: 11 * 1024 * 1024 });
  writeFileSync(join(root, 'kumo.json'), JSON.stringify({ projectId: PROJECT, api: kumo.api }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, kumo: { home, env: {} } });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  const shot = async (name) => {
    if (SHOTS) writeFileSync(join(SHOTS, `kumo-${tag}${LANG ? `-${LANG}` : ''}-${name}.png`), await page.screenshot());
  };
  const assets = () => (existsSync(join(root, 'assets')) ? readdirSync(join(root, 'assets')).sort() : []);
  const before = assets();
  // The shell's Save buttons: "Save · n" (data-unsaved = n).
  const unsaved = () => page.eval(`Math.max(0, ...[...document.querySelectorAll('[data-unsaved]')].map((b) => Number(b.dataset.unsaved)))`);
  try {
    await page.goto(srv.url + '&tool=library');
    // (Phone: Make with AI is in the "+" next to the search, the second design review's ⑦.)
    const openAi = async () => {
      if (!mobile) return page.eval(IN.click('.gsl-ai-open'));
      if (!(await page.eval(IN.click('.gsl-more')))) return false;
      await new Promise((r) => setTimeout(r, 200));
      return page.eval(IN.click('.gsl-more-item[data-action=more-ai-open]'));
    };
    await page.waitFor(IN.visible(mobile ? '.gsl-more' : '.gsl-ai-open'), 20000);
    // 1. not signed in
    assert.ok(await openAi());
    await page.waitFor(IN.visible('.gsl-ai-cmd code'));
    assert.equal(await page.eval(IN.text('.gsl-ai-cmd code')), 'npx kumodeck login');
    await shot('1-signed-out');

    // 2. the CLI signs in, then "I signed in"
    mkdirSync(join(home, '.kumo'), { recursive: true });
    writeFileSync(join(home, '.kumo/credentials.json'), kumo.credentials());
    assert.ok(await page.eval(IN.click('.gsl-ai-again')));
    await page.waitFor(IN.visible('.gsl-ai-prompt'));
    assert.match(await page.eval(IN.text('.gsl-ai-acct')), /maker@example\.com.*\$5\.00/);
    assert.match(await page.eval(IN.text('.gsl-ai-make')), /\$0\.003/);
    await page.eval(IN.type('.gsl-ai-prompt', 'night sky full of small stars'));
    await shot('2-form');

    // 3. a picture: the terms once, then Make
    assert.ok(await page.eval(IN.click('.gsl-ai-make')));
    await page.waitFor(IN.visible('.gsl-ai-terms'));
    assert.ok(await page.eval(IN.disabled('.gsl-ai-make')), 'Make waits for "I agree"');
    await shot('3-terms');
    assert.ok(await page.eval(`(() => { const c = document.querySelector('.gsl-ai-terms input[type=checkbox]'); c.click(); return c.checked; })()`));
    assert.ok(await page.eval(IN.click('.gsl-ai-make')));
    await page.waitFor(`${IN.text('.gsl-ai-note')}.includes('star-sky.png')`);
    assert.deepEqual(assets(), [...before, 'star-sky.png'].sort());
    await page.waitFor(`[...document.querySelectorAll('.gsl-tile')].some(t => t.textContent.includes('star-sky.png') && t.querySelector('.gsl-tag-new'))`);
    assert.match(await page.eval(IN.text('.gsl-ai-acct')), /\$4\.99/);
    assert.equal(await unsaved(), 0, 'a made file is not a change to save');
    assert.ok(!(await page.eval(IN.text('.gsl-pending'))), 'no "1 unsaved" in the panel either');
    await shot('4-picture-added');

    // 4. a 3D model
    assert.ok(await page.eval(`(() => { const b = [...document.querySelectorAll('.gsl-ai-kinds .gsl-chip')][1]; b.click(); return true; })()`));
    await page.eval(IN.type('.gsl-ai-prompt', 'a small wooden chest'));
    assert.match(await page.eval(IN.text('.gsl-ai-make')), /\$0\.20/);
    if (!LANG) assert.match(await page.eval(IN.text('.gsl-ai .gsl-muted')), /about 3 minutes/);
    assert.ok(await page.eval(IN.click('.gsl-ai-make')));
    await page.waitFor(`${IN.text('.gsl-ai .gsl-section')}.length > 0`);
    // While it is made: a tile in the grid and a waiting line, both with a clock.
    await page.waitFor(IN.visible('.gsl-tile-making'));
    if (!LANG) assert.match(await page.eval(IN.text('.gsl-tile-making')), /a small wooden chest.*Making · 0:0\d/);
    if (!LANG) assert.match(await page.eval(IN.text('.gsl-ai-wait')), /0:0\d · usually about 3 minutes/);
    await shot('5a-model-making');
    await page.waitFor(`${IN.text('.gsl-ai .gsl-section')}.includes('assets/chest.glb')`, 30000);
    assert.ok(assets().includes('chest.glb'));
    await page.waitFor(`!(${IN.visible('.gsl-tile-making')})`);
    // The credits are read again: 5.00 − 0.01 − 0.20, without closing the panel.
    await page.waitFor(`${IN.text('.gsl-ai-acct')}.includes('$4.79')`, 10000);
    // Heavy: the line and the one button.
    await page.waitFor(IN.visible('.gsl-ai .gsl-heavy'), 10000);
    if (!LANG) assert.match(await page.eval(IN.text('.gsl-ai-note')), /chest\.glb \(11 MB\)/);
    if (!LANG) assert.match(await page.eval(IN.text('.gsl-ai .gsl-heavy')), /11 MB is heavy for a web game/);
    await shot('5b-model-heavy');
    assert.equal(await unsaved(), 0, 'a made 3D file is not a change to save');
    assert.ok(await page.eval(IN.click('.gsl-ai .gsl-ask-lighter')));
    // The button is disabled at the click; the label changes once the request is stored.
    if (!LANG) await page.waitFor(`${IN.text('.gsl-ai .gsl-ask-lighter')} === 'Sent to your AI'`);
    const reqDir = join(root, '.studio/requests');
    const findLighter = () => (existsSync(reqDir) ? readdirSync(reqDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(reqDir, f), 'utf8'))) : [])
      .find((r) => r.kind === 'ask' && r.text.includes('assets/chest.glb'));
    for (let i = 0; i < 50 && !findLighter(); i++) await sleep(100);
    const lighter = findLighter();
    assert.ok(lighter, 'the request for the AI is in .studio/requests/');
    assert.match(lighter.text, LANG === "ja" ? /軽く.*11 MB/ : /lighter.*11 MB/);
    // The file's own detail says the same, and remembers that it was sent.
    assert.ok(await page.eval(`(() => { const t = [...document.querySelectorAll('.gsl-tile')].find((t) => t.dataset.path === 'assets/chest.glb'); if (!t) return false; t.click(); return true; })()`));
    await page.waitFor(IN.visible('.gsl-detail .gsl-heavy'));
    assert.ok(await page.eval(IN.disabled('.gsl-detail .gsl-ask-lighter')));
    await shot('5c-model-detail');

    // 5. balance too low: nothing is sent
    kumo.st.balance = 5;
    const posts = kumo.st.posts;
    assert.ok(await page.eval(IN.click('.gsl-ai-close, .gsl-ai .gsl-close')));
    assert.ok(await openAi());
    await page.waitFor(`${IN.text('.gsl-ai-acct')}.includes('$0.05')`);
    await page.waitFor(`(${IN.visible('.gsl-ai-prompt')})`);
    assert.ok(await page.eval(IN.disabled('.gsl-ai-make')));
    assert.ok(await page.eval(`${IN.text('.gsl-ai-bad')}.length > 0`));
    assert.equal(kumo.st.posts, posts);
    await shot('6-short');

    // 6. the key never reached the page
    assert.ok(!(await page.eval('document.documentElement.outerHTML')).includes(TOKEN));
    console.log(`ok ${tag}`);
  } catch (e) {
    if (SHOTS) writeFileSync(join(SHOTS, `kumo-${tag}-FAIL.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
    throw e;
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    await kumo.close();
    rmSync(base, { recursive: true, force: true });
  }
}

/** 0. A game with no assets at all: the grid says so once the folder is read. */
async function emptyFolder() {
  const base = mkdtempSync(join(tmpdir(), 'studio-kumo-empty-'));
  const root = join(base, 'game');
  mkdirSync(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><canvas width="320" height="200"></canvas><script>window.studio?.ready?.()</script>\n');
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, kumo: { home: join(base, 'home'), env: {} } });
  const browser = await launch();
  const page = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(srv.url + '&tool=library');
    await page.waitFor(`${IN.text('.gsl-empty')}.includes('No assets yet')`, 15000);
    assert.match(await page.eval(IN.text('.gsl-empty')), /Make with AI/);
    if (SHOTS) writeFileSync(join(SHOTS, `kumo-1280${LANG ? `-${LANG}` : ''}-0-empty.png`), await page.screenshot());
    console.log('ok empty folder');
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(base, { recursive: true, force: true });
  }
}

if (!LANG) await emptyFolder();
await run(false);
await run(true);
await sleep(0);
console.log('studio-kumo: all ok');
