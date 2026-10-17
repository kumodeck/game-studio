// "Make with AI" (optional KUMODeck sign-in) end to end in a headless browser: the real local
// server, the built shell, an example game, and a fake KUMODeck on 127.0.0.1 (nothing leaves the
// machine). 2026-10-16.
//
//   node test/studio-kumo.browser.mjs [--shots <dir>] [--lang ja]
//
// At 1280×800 (mouse) and 390×844 (touch):
//   1. not signed in: one quiet "Make with AI" button; opened = one sentence + `npx kumodeck login`
//   2. the CLI signs in (credentials.json appears) → "I signed in" → the form with balance and price
//   3. a picture: KUMODeck asks for the AI terms once → tick "I agree" → Make → assets/<name>.jpg,
//      New in the grid, balance went down
//   4. a 3D model: Make → "being made" → the model lands in assets/
//   5. balance too low: Make is disabled and says why (nothing sent)
//   6. the key never appears in the page
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const kumo = await fakeKumoServer();
  writeFileSync(join(root, 'kumo.json'), JSON.stringify({ projectId: PROJECT, api: kumo.api }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, kumo: { home, env: {} } });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  const shot = async (name) => {
    if (SHOTS) writeFileSync(join(SHOTS, `kumo-${tag}${LANG ? `-${LANG}` : ''}-${name}.png`), await page.screenshot());
  };
  const assets = () => (existsSync(join(root, 'assets')) ? readdirSync(join(root, 'assets')).sort() : []);
  const before = assets();
  try {
    await page.goto(srv.url + '&tool=library');
    await page.waitFor(IN.visible('.gsl-ai-open'), 20000);
    // 1. not signed in
    assert.ok(await page.eval(IN.click('.gsl-ai-open')));
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
    await shot('4-picture-added');

    // 4. a 3D model
    assert.ok(await page.eval(`(() => { const b = [...document.querySelectorAll('.gsl-ai-kinds .gsl-chip')][1]; b.click(); return true; })()`));
    await page.eval(IN.type('.gsl-ai-prompt', 'a small wooden chest'));
    assert.match(await page.eval(IN.text('.gsl-ai-make')), /\$0\.20/);
    assert.ok(await page.eval(IN.click('.gsl-ai-make')));
    await page.waitFor(`${IN.text('.gsl-ai .gsl-section')}.length > 0`);
    await page.waitFor(`${IN.text('.gsl-ai .gsl-section')}.includes('assets/chest.glb')`, 30000);
    assert.ok(assets().includes('chest.glb'));
    await shot('5-model-added');

    // 5. balance too low: nothing is sent
    kumo.st.balance = 5;
    const posts = kumo.st.posts;
    assert.ok(await page.eval(IN.click('.gsl-ai-close, .gsl-ai .gsl-close')));
    assert.ok(await page.eval(IN.click('.gsl-ai-open')));
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

await run(false);
await run(true);
await sleep(0);
console.log('studio-kumo: all ok');
