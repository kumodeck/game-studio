// The shelf of samples, in a headless browser (decided 2026-11-06: a folder without a game opens the editor on its
// shelf; the AI asks nothing):
//
//   node test/studio-shelf-screen.browser.mjs [--starters-dir <dir>] [--shots <dir>] [--lang en|ja] [--only pc,phone,light]
//
// 1. An empty folder: the real CLI says "no-game … the editor opens on its shelf" and then "ready" (no exit 4).
// 2. PC: one heading, one line, the cards in `order`, "Coming" cards not pressable, no sideways scroll.
// 3. Pointing at a card plays that sample in its picture; pointing at another moves the one game there (never two).
// 4. A press grows the card in place (no dialog, no scrim): the picture, the three tries, the words to ask in a violet
//    tag, ONE button "Open <title>". Escape goes back.
// 5. Open: the sample is copied into the folder ("studio: started …" on stdout), the page reloads into the editor on it,
//    and the guide shows one card: 1 of 3 Move → Next → 2 of 3 with a ring on ▶ Play → (play, P) → 3 of 3 with a ring
//    on ● Clip. "Try asking" over the field puts the words in it. Skip ends it, and a reload shows no guide.
// 6. Phone (390×844): one column, no sideways scroll, a tap grows the card. 7. Light theme. 8. Japanese.
//
// The plugin's own starters/ by default (Big Swell first and real since 2026-11-06; Domino Spiral and Marble Rain are
// "Coming" until they are in). The words of each card come from the sample: starter.json (English) and strings.json
// (Japanese: the card's line, the thing to move, the words to ask).
// --shots writes PNGs. Exit code 1 on the first failure.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const LANG = opt('--lang') || 'en';
const ONLY = new Set((opt('--only') || 'pc,phone,light,ja').split(','));
const STARTERS = opt('--starters-dir') ? ['--starters-dir', resolve(opt('--starters-dir'))] : [];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s) => console.log(`  ✓ ${s}`);
const folders = [];

/** Run the CLI in the background until its "ready" line. */
async function startCli(folder) {
  const child = spawn(process.execPath, [CLI, folder, ...STARTERS, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no ready line\n${out}\n${err}`)), 20000);
    const check = () => {
      if (/studio: ready \S+\n/.test(out)) {
        clearTimeout(t);
        res();
      }
    };
    child.stdout.on('data', check);
    child.on('exit', (c) => rej(new Error(`studio.mjs exited ${c}\n${out}\n${err}`)));
  });
  const url = out.split('\n').find((l) => l.startsWith('studio: ready ')).slice('studio: ready '.length);
  return { out: () => out, url, stop: () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); }) };
}

function emptyFolder(name) {
  const base = mkdtempSync(join(tmpdir(), 'studio-shelf-'));
  folders.push(base);
  const f = join(base, name);
  mkdirSync(f);
  return f;
}

const IN = {
  cards: `JSON.stringify([...document.querySelectorAll('[data-part=samples-card]')].map((c) => ({ id: c.dataset.id, coming: c.classList.contains('coming'), tag: c.tagName })))`,
  rect: (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.getClientRects().length && !e.closest("[hidden]")); if (!el) return null;
    const q = el.getBoundingClientRect(); return JSON.stringify({ x: q.left + q.width / 2, y: q.top + q.height / 2, w: q.width, h: q.height, top: q.top, right: q.right, bottom: q.bottom, left: q.left }); })()`,
  frames: `document.querySelectorAll('iframe.samples-live').length`,
  sideways: `document.documentElement.scrollWidth > window.innerWidth + 1`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

async function run() {
  const browser = await launch();
  const shot = async (page, name) => {
    if (!SHOTS) return;
    await sleep(350);
    writeFileSync(join(SHOTS, `${name}.png`), await page.screenshot());
  };
  try {
    // ---------- 1–5: PC, dark ----------
    if (ONLY.has('pc')) {
      const folder = emptyFolder('my-first-game');
      const cli = await startCli(folder);
      assert.match(cli.out(), /^studio: no-game .* - the editor opens on its shelf of samples: don't ask which one, the person picks one there and it is copied into this folder\n/);
      assert.deepEqual(readdirSync(folder).filter((f) => f !== '.studio'), [], 'nothing copied before a pick');
      step('empty folder → "no-game … opens on its shelf" and ready (no exit 4)');

      const page = await newPage(browser, { width: 1280, height: 800 });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await page.goto(`${cli.url}&lang=${LANG}`);
      await page.waitFor(`document.querySelectorAll('[data-part=samples-card]').length >= 2`);
      const cards = await j(page, IN.cards);
      const live = cards.filter((c) => !c.coming);
      assert.ok(live.length >= 2, `samples on the shelf: ${JSON.stringify(cards)}`);
      for (const c of cards.filter((x) => x.coming)) assert.equal(c.tag, 'DIV', `${c.id}: a Coming card is not a button`);
      if (!STARTERS.length) assert.ok(cards.some((c) => c.id === 'neon-run' && !c.coming), 'Neon Run is on the shelf');
      if (cards.some((c) => c.id === 'big-swell')) {
        assert.equal(cards[0].id, 'big-swell', 'Big Swell first (order 0)');
        assert.equal(cards[0].coming, false, 'Big Swell is a real card, not Coming');
      }
      assert.equal(await page.eval(IN.sideways), false, 'no sideways scroll');
      assert.equal(await page.eval(`document.querySelectorAll('[role=dialog], .scrim').length`), 0);
      assert.ok(await page.eval(`!!document.querySelector('[data-part=samples-own] code')`), 'Have a game already? … /arrange');
      step(`shelf: ${cards.map((c) => c.id + (c.coming ? ' (Coming)' : '')).join(', ')}`);
      await shot(page, `1-shelf-dark-pc-${LANG}`);

      // 3. Pointing plays that sample, one at a time.
      const first = await j(page, IN.rect(`[data-part=samples-card][data-id="${live[0].id}"] .samples-pic`));
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: first.x, y: first.y });
      await page.waitFor(`document.querySelector('[data-id="${live[0].id}"].is-live iframe.samples-live.on')`, 20000);
      await sleep(1500);
      await shot(page, `2-point-dark-pc-${LANG}`);
      const second = await j(page, IN.rect(`[data-part=samples-card][data-id="${live[1].id}"] .samples-pic`));
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: second.x, y: second.y });
      await page.waitFor(`document.querySelector('[data-id="${live[1].id}"].is-live iframe.samples-live')`, 20000);
      assert.equal(await page.eval(IN.frames), 1, 'one live game at a time');
      assert.equal(await page.eval(`!!document.querySelector('[data-id="${live[0].id}"] iframe')`), false, 'the first one stopped');
      step('pointing plays that card only (one game at a time)');

      // 4. A press grows it in place.
      const pick = live.find((c) => c.id === 'lantern-cove') || live[0];
      const pr = await j(page, IN.rect(`[data-part=samples-card][data-id="${pick.id}"]`));
      await page.click(pr.x, pr.y);
      await page.waitFor(`!!document.querySelector('[data-part=samples-big]')`);
      const big = await j(page, `JSON.stringify({ open: document.querySelector('[data-action=samples-open]').textContent, buttons: [...document.querySelectorAll('[data-part=samples-big] button')].map((b) => b.dataset.action),
        steps: document.querySelectorAll('.samples-steps li').length, say: document.querySelector('[data-part=samples-say]')?.textContent || '', frames: document.querySelectorAll('iframe.samples-live').length })`);
      assert.equal(big.steps, 3, 'three tries');
      // The tries in words a person reads (decided 2026-11-06): the thing to move by its name, never "lighthouse_1";
      // the second as the editor's top bar shows it (whole seconds: pauseAt is the game's clock, about 0.6 s ahead).
      const stepsText = await page.eval(`document.querySelector('.samples-steps').textContent`);
      assert.doesNotMatch(stepsText, /_\d/, `no placement name with a copy number: ${stepsText}`);
      assert.match(stepsText, LANG === 'ja' ? /\d+ 秒ごろ/ : /about \d+ s\./, `whole seconds: ${stepsText}`);
      if (LANG === 'ja') assert.doesNotMatch(stepsText, /[A-Za-z]{4,} をドラッグ/, `the thing to move in Japanese: ${stepsText}`);
      assert.deepEqual(big.buttons, ['samples-back', 'samples-open'], 'one button to press (and the way back)');
      assert.equal(big.frames, 1);
      assert.equal(await page.eval(`document.querySelectorAll('[role=dialog], .scrim').length`), 0, 'not a dialog');
      await page.waitFor(`document.querySelector('.samples-big iframe.samples-live.on')`, 20000);
      await sleep(1500);
      step(`the card grows in place: "${big.open}", tag ${big.say}`);
      await shot(page, `3-choose-dark-pc-${LANG}`);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.waitFor(`!document.querySelector('[data-part=samples-big]') && document.querySelectorAll('[data-part=samples-card]').length > 1`);
      assert.equal(await page.eval(IN.frames), 0, 'back: no game running');
      step('Escape goes back to all samples');

      // 5. Open.
      const pr2 = await j(page, IN.rect(`[data-part=samples-card][data-id="${pick.id}"]`));
      await page.click(pr2.x, pr2.y);
      await page.waitFor(`!!document.querySelector('[data-action=samples-open]')`);
      const ob = await j(page, IN.rect('[data-action=samples-open]'));
      await page.click(ob.x, ob.y);
      await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 40000);
      assert.match(cli.out(), new RegExp(`\\nstudio: started ${pick.id} \\(\\d+ files\\) `));
      assert.ok(existsSync(join(folder, 'index.html')), 'the sample is in the folder');
      await page.waitFor(`!!document.querySelector('[data-part=samples-tour][data-step="1"]')`, 20000);
      const t1 = await page.eval(`document.querySelector('[data-part=samples-tour]').textContent`);
      assert.match(t1, LANG === 'ja' ? /1 \/ 3/ : /1 of 3/);
      assert.ok(await page.eval(`!!document.querySelector('[data-part=try-ask] button')`), 'Try asking over the field');
      step(`Open → copied, the editor on it, guide 1 of 3: ${t1.slice(0, 60)}…`);
      await sleep(1500);
      await shot(page, `4-tour-move-dark-pc-${LANG}`);

      const nx = await j(page, IN.rect('[data-action=tour-next]'));
      await page.click(nx.x, nx.y);
      await page.waitFor(`!!document.querySelector('[data-part=samples-tour][data-step="2"]') && !!document.querySelector('[data-part=tour-ring]')`);
      const ring = await j(page, IN.rect('[data-part=tour-ring]'));
      const play = await j(page, IN.rect('[data-action=play]'));
      assert.ok(Math.abs(ring.x - play.x) < 4 && Math.abs(ring.y - play.y) < 4, 'the ring is on ▶ Play');
      const ta = await j(page, IN.rect('[data-action=try-ask]'));
      await page.click(ta.x, ta.y);
      const asked = await page.eval(`document.querySelector('[data-part=bar] input').value`);
      assert.ok(asked.length > 5, 'Try asking put the words in the field');
      assert.equal(await page.eval(`!!document.querySelector('[data-part=try-ask]')`), false, 'and went');
      step(`2 of 3: ring on ▶ Play; Try asking → field: “${asked}”`);
      await page.eval(`(() => { const i = document.querySelector('[data-part=bar] input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`);
      await shot(page, `5-tour-play-dark-pc-${LANG}`);

      await page.click(play.x, play.y);
      await page.waitFor(`document.querySelector('[data-part=app]').dataset.playing === 'on'`, 20000);
      await sleep(1200);
      const pp = await j(page, IN.rect('[data-action=play-pause]'));
      await page.click(pp.x, pp.y);
      await page.waitFor(`!!document.querySelector('[data-part=samples-tour][data-step="3"]')`, 20000);
      await sleep(800);
      step('Play, then pause → 3 of 3 (● Clip)');
      await shot(page, `6-tour-clip-dark-pc-${LANG}`);
      const sk = await j(page, IN.rect('[data-action=tour-skip]'));
      await page.click(sk.x, sk.y);
      assert.equal(await page.eval(`!!document.querySelector('[data-part=samples-tour]')`), false, 'Skip: gone');
      await page.goto(`${cli.url.split('?')[0]}?lang=${LANG}`);
      await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 40000);
      await sleep(1500);
      assert.equal(await page.eval(`!!document.querySelector('[data-part=samples-tour]')`), false, 'never again');
      step('Skip → gone, and not back after a reload');
      await cli.stop();
    }

    // ---------- 6: phone ----------
    if (ONLY.has('phone')) {
      const folder = emptyFolder('phone-game');
      const cli = await startCli(folder);
      const page = await newPage(browser, { width: 390, height: 844, mobile: true });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await page.goto(`${cli.url}&lang=${LANG}`);
      await page.waitFor(`document.querySelectorAll('[data-part=samples-card]').length >= 2`);
      assert.equal(await page.eval(IN.sideways), false, 'phone: no sideways scroll');
      const cols = await page.eval(`new Set([...document.querySelectorAll('[data-part=samples-card]')].map((c) => Math.round(c.getBoundingClientRect().left))).size`);
      assert.equal(cols, 1, 'phone: one column');
      await shot(page, `7-shelf-dark-phone-${LANG}`);
      const c = await j(page, IN.rect('button[data-part=samples-card]'));
      await page.tap(c.x, c.y);
      await page.waitFor(`!!document.querySelector('[data-part=samples-big] iframe.samples-live.on')`, 20000);
      await sleep(1500);
      assert.equal(await page.eval(IN.sideways), false, 'phone, grown card: no sideways scroll');
      step('phone: one column, a tap grows the card and plays it');
      await shot(page, `8-choose-dark-phone-${LANG}`);
      const po = await j(page, IN.rect('[data-action=samples-open]'));
      await page.tap(po.x, po.y);
      await page.waitFor(`!!document.querySelector('[data-part=samples-tour][data-step="1"]')`, 40000);
      await sleep(2000);
      const tc = await j(page, IN.rect('[data-part=samples-tour]'));
      assert.ok(tc.left >= 15 && tc.right <= 375, `phone: the guide fits (${tc.left}–${tc.right})`);
      assert.equal(await page.eval(IN.sideways), false, 'phone, editor with the guide: no sideways scroll');
      step('phone: Open → the editor with the guide, inside the screen');
      await shot(page, `9-tour-move-dark-phone-${LANG}`);
      await cli.stop();
    }

    // ---------- 7–8: light, Japanese ----------
    for (const v of [ONLY.has('light') && { theme: 'light', lang: LANG }, ONLY.has('ja') && LANG !== 'ja' && { theme: 'dark', lang: 'ja' }].filter(Boolean)) {
      const folder = emptyFolder(`game-${v.theme}-${v.lang}`);
      const cli = await startCli(folder);
      const page = await newPage(browser, { width: 1280, height: 800 });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v.theme }] });
      await page.goto(`${cli.url}&lang=${v.lang}`);
      await page.waitFor(`document.querySelectorAll('[data-part=samples-card]').length >= 2`);
      assert.equal(await page.eval('document.documentElement.dataset.theme'), v.theme);
      if (v.lang === 'ja') {
        assert.equal(await page.eval('document.documentElement.lang'), 'ja');
        assert.notEqual(await page.eval(`document.querySelector('.samples-head h1').textContent`), 'Start with a sample', 'the Japanese words');
        // Every real card's line in Japanese (the sample's strings.json blurb), not starter.json's English.
        const lines = await j(page, `JSON.stringify([...document.querySelectorAll('button[data-part=samples-card] p')].map((p) => p.textContent))`);
        for (const l of lines) assert.match(l, /[\u3040-\u30ff\u4e00-\u9fff]/, `a Japanese card line: ${l}`);
      }
      await shot(page, `1-shelf-${v.theme}-pc-${v.lang}`);
      const lc = await page.eval(`(document.querySelector('button[data-part=samples-card][data-id="lantern-cove"]') || document.querySelector('button[data-part=samples-card]')).dataset.id`);
      const r = await j(page, IN.rect(`[data-part=samples-card][data-id="${lc}"]`));
      await page.click(r.x, r.y);
      await page.waitFor(`!!document.querySelector('[data-part=samples-big] iframe.samples-live.on')`, 20000);
      await sleep(1500);
      await shot(page, `3-choose-${v.theme}-pc-${v.lang}`);
      const vo = await j(page, IN.rect('[data-action=samples-open]'));
      await page.click(vo.x, vo.y);
      await page.waitFor(`!!document.querySelector('[data-part=samples-tour][data-step="1"]') && !!document.querySelector('[data-part=try-ask]')`, 40000);
      await sleep(2000);
      if (v.lang === 'ja') {
        const tour = await page.eval(`document.querySelector('[data-part=samples-tour]').textContent`);
        // In Japanese, with the English name the editor's list shows in brackets after it ("... (lighthouse) ...").
        assert.match(tour, /[\u3040-\u30ff\u4e00-\u9fff]+（[a-z ]+） をドラッグ/, `the guide names the thing in Japanese and English: ${tour}`);
      }
      await shot(page, `4-tour-move-${v.theme}-pc-${v.lang}`);
      step(`${v.theme} / ${v.lang}: shelf, grown card, the guide`);
      await cli.stop();
    }
    console.log('studio-shelf-screen: all passed');
  } finally {
    await browser.close();
    for (const f of folders) rmSync(f, { recursive: true, force: true });
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
