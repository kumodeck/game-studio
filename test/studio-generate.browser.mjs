// The Library's "Make with AI" as the place to make things (generate-ui, 2026-10-22; the product request of 10/22: "3D, images,
// sound and so on each get a proper screen for making them"). The real local server, the built editor, a starter game
// and the fake KUMODeck on 127.0.0.1 (test/kumo-fake.mjs: nothing leaves the machine, no money moves).
//
//   node test/studio-generate.browser.mjs [--shots <dir>] [--before] [--only pc,side,phone] [--game lantern-cove|firefly-ruins]
//                                         [--theme dark|light|both] [--lang en|ja]
//
// Per game × size (PC 1280×800 mouse · the chat's side window 400×900 mouse · phone 390×844 touch) × theme:
//   1. signed in, "Make with AI" open: five kinds (Image · 3D · Sound · Music · Voice), the balance, a price on Make
//   2. Sound: an example's words go into the box with one press; the price is the sound's ($0.004 for 2 s)
//   3. Make → the AI terms once → Make: a "Making…" line and tile, then a "Just made" card with ▶, the file in
//      assets/, the history in .studio/generated.json, and KUMODeck was asked for audio.sfx with the pinned model
//   4. the card's "Add to scene" drafts "Add this to the scene" in the ask box with the file's chip (nothing sent)
//   5. the history row's "Change" puts the same kind, words and length back in the form (nothing sent)
//   6. (PC) Music and Voice: the right task, model and options reach KUMODeck; history has three sounds
//   7. the key never appears in the page
// --before: only step 1's picture, for the editor before this change (no assertions about the new parts).
// Pictures (--shots): gen-<game>-<size>-<theme>-<step>.png (before: before-<game>-<size>-<theme>-1-open.png).
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { runWatch } from '../src/server/ai-watch.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { fakeKumoServer, FAKE_KUMO_TOKEN as TOKEN, FAKE_KUMO_PROJECT as PROJECT } from './kumo-fake.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const BEFORE = args.includes('--before');
const LANG = opt('--lang') || 'en';
const THEMES = (opt('--theme') || 'both') === 'both' ? ['dark', 'light'] : [opt('--theme')];
const GAMES = ['lantern-cove', 'firefly-ruins'].filter((g) => !opt('--game') || g === opt('--game'));
const SIZES = [
  { id: 'pc', w: 1280, h: 800, touch: false },
  { id: 'side', w: 400, h: 900, touch: false },
  { id: 'phone', w: 390, h: 844, touch: true },
].filter((s) => !opt('--only') || opt('--only').split(',').includes(s.id));
const W = {
  en: { addFile: 'Add this to the scene', example: 'Coin pickup, bright chime' },
  ja: { addFile: 'これをシーンに足して', example: 'コインを拾う音、明るいチャイム' },
}[LANG];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Visible = laid out, on screen and not covered (what a person can see and press). Same as studio-library-use.
const VIS = `(e) => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
  if (!e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
  const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
  const top = document.elementFromPoint(x, y); return !!top && (e === top || e.contains(top) || top.contains(e)); }`;
const shown = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].some(e => e.offsetParent)`;
const text = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent).map(e => e.textContent).join(' | ')`;

async function runOne(game, sz, theme) {
  const tag = `${game}-${sz.id}-${theme}`;
  const base = mkdtempSync(join(tmpdir(), 'studio-generate-'));
  const root = join(base, 'game');
  const home = join(base, 'home');
  cpSync(join(PKG, 'starters', game), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  const kumo = await fakeKumoServer({ delayMs: 1200 });
  writeFileSync(join(root, 'kumo.json'), JSON.stringify({ projectId: PROJECT, api: kumo.api }));
  // Signed in already (what `npx kumodeck login` saves): this test is about making, studio-kumo is about signing in.
  mkdirSync(join(home, '.kumo'), { recursive: true });
  writeFileSync(join(home, '.kumo/credentials.json'), kumo.credentials());
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {}, kumo: { home, env: {} } });
  // An AI's watch, as when a person works next to their AI (no big "your AI isn't watching" card over the sheet).
  const watch = new AbortController();
  void runWatch(root, { out: () => {}, signal: watch.signal }).catch(() => undefined);
  const browser = await launch();
  const page = await newPage(browser, { width: sz.w, height: sz.h, mobile: sz.touch });
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(400);
    writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'gen'}-${tag}-${name}.png`), await page.screenshot());
  };
  // A real press (mouse click / finger tap) on the middle of the first visible match, scrolled into view first.
  const press = async (sel) => {
    const at = JSON.parse(await page.eval(`(() => { const v = ${VIS}; const all = [...document.querySelectorAll(${JSON.stringify(sel)})];
      let e = all.find(v); if (!e) { e = all.find((x) => x.getBoundingClientRect().width); e?.scrollIntoView({ block: 'center', inline: 'center' }); if (!v(e)) return 'null'; }
      const r = e.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`));
    assert.ok(at, `${tag}: nothing visible to press for ${sel}`);
    if (sz.touch) await page.tap(at[0], at[1]);
    else await page.click(at[0], at[1]);
    await sleep(300);
  };
  const scrollTo = (sel) => page.eval(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'center' })`);
  const type = (sel, v) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const assets = () => (existsSync(join(root, 'assets')) ? readdirSync(join(root, 'assets')) : []);
  const history = () => {
    try {
      return JSON.parse(readFileSync(join(root, '.studio/generated.json'), 'utf8')).items;
    } catch {
      return [];
    }
  };
  try {
    await page.goto(srv.url + '&tool=library');
    // The game's objects and files listed (a picture of "Reading the folder…" says nothing), and the sheet still.
    await page.waitFor(`document.querySelectorAll('.gsl-tile[data-kind=file]').length > 0`, 30000);
    await sleep(900);
    // 1. open (narrow windows — the side window and a phone — fold Make with AI into the "+" next to the search)
    if (await page.eval(`(${VIS})(document.querySelector('.gsl-ai-open'))`)) await press('.gsl-ai-open');
    else {
      await press('.gsl-more');
      await press('.gsl-more-item[data-action=more-ai-open]');
    }
    await page.waitFor(shown('.gsl-ai-prompt'), 15000);
    assert.match(await page.eval(text('.gsl-ai-acct')), /maker@example\.com.*\$5\.00/);
    await shot('1-open');
    if (BEFORE) return console.log(`ok before ${tag}`);
    assert.equal(await page.eval(`document.querySelectorAll('.gsl-ai-kinds .gsl-chip').length`), 5, `${tag}: five kinds`);

    // 2. Sound, and an example's words with one press
    await press('.gsl-ai-kinds .gsl-chip[data-kind=sfx]');
    await press('.gsl-ai-try button');
    assert.equal(await page.eval(`document.querySelector('.gsl-ai-prompt').value`), W.example);
    assert.match(await page.eval(text('.gsl-ai-make')), /\$0\.004/, `${tag}: 2 s of sound costs $0.004`);
    await shot('2-sound-form');

    // 3. Make → the terms once → Make: making, then the card
    await press('.gsl-ai-make');
    await page.waitFor(shown('.gsl-ai-terms'));
    await press('.gsl-ai-terms input[type=checkbox]');
    await press('.gsl-ai-make');
    await page.waitFor(shown('.gsl-ai-wait'), 5000);
    await page.waitFor(shown('.gsl-tile-making'), 5000);
    await scrollTo('.gsl-ai-wait');
    await shot('3-sound-making');
    await page.waitFor(shown('.gsl-ai-made'), 10000);
    assert.ok(assets().includes('coin-pickup.wav'), `${tag}: the sound is in assets/`);
    const sfx = kumo.st.inputs.filter((i) => i.kind === 'audio');
    assert.deepEqual(sfx.at(-1), { kind: 'audio', task: 'audio.sfx', model: 'elevenlabs-sound-effects-v2', prompt: W.example, durationSec: 2 });
    assert.equal(history().length, 1);
    assert.deepEqual({ kind: history()[0].kind, prompt: history()[0].prompt, path: history()[0].path }, { kind: 'sfx', prompt: W.example, path: 'assets/coin-pickup.wav' });
    assert.ok(await page.eval(shown('.gsl-ai-made .gsl-ai-play')), `${tag}: ▶ on the card`);
    await page.waitFor(`${text('.gsl-ai-history')}.includes(${JSON.stringify(W.example)})`, 5000);
    await page.waitFor(`${text('.gsl-ai-acct')}.includes('$4.99')`, 5000);
    await scrollTo('.gsl-ai-made');
    await shot('4-sound-made');

    // 4. "Add to scene" on the card: the ask box's draft with the file's chip, nothing sent
    const reqs = () => (existsSync(join(root, '.studio/requests')) ? readdirSync(join(root, '.studio/requests')).length : 0);
    const before = reqs();
    await press('.gsl-ai-made .gsl-add-scene');
    await page.waitFor(`document.querySelector('.ask-input')?.value === ${JSON.stringify(W.addFile)}`, 5000);
    assert.match(await page.eval(`document.querySelector('.ask-chip')?.textContent || ''`), /coin-pickup\.wav/);
    assert.equal(reqs(), before, `${tag}: nothing sent before Enter`);
    await page.eval(`(() => { const a = document.querySelector('.ask-input'); a.value = ''; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    // 5. the history's "Change": the same kind, words and length back in the form
    await press('.gsl-ai-kinds .gsl-chip[data-kind=picture]');
    await type('.gsl-ai-prompt', '');
    await press('.gsl-ai-history .gsl-ai-change');
    assert.equal(await page.eval(`document.querySelector('.gsl-ai-kinds .gsl-chip[aria-pressed=true]').dataset.kind`), 'sfx');
    assert.equal(await page.eval(`document.querySelector('.gsl-ai-prompt').value`), W.example);
    assert.equal(await page.eval(`document.activeElement?.classList.contains('gsl-ai-prompt')`), true, `${tag}: the cursor is in the words`);
    assert.equal(kumo.st.posts, 2, `${tag}: "Change" sent nothing (2 = the refused first try + the sound)`);
    await scrollTo('.gsl-ai-history');
    await shot('5-history');

    // 6. Music and Voice (PC): what reaches KUMODeck
    if (sz.id === 'pc') {
      await press('.gsl-ai-kinds .gsl-chip[data-kind=music]');
      await type('.gsl-ai-prompt', 'calm harbor at dusk, soft guitar');
      assert.match(await page.eval(text('.gsl-ai-make')), /\$0\.038/);
      await press('.gsl-ai-make');
      await page.waitFor(`${text('.gsl-ai-made')}.includes('calm-harbor.wav')`, 10000);
      await press('.gsl-ai-kinds .gsl-chip[data-kind=voice]');
      await type('.gsl-ai-prompt', 'Welcome to the harbor!');
      await press('.gsl-ai-make');
      await page.waitFor(`${text('.gsl-ai-made')}.includes('welcome.mp3')`, 10000);
      const [music, voice] = kumo.st.inputs.filter((i) => i.kind === 'audio').slice(-2);
      assert.deepEqual(music, { kind: 'audio', task: 'audio.music', model: 'stable-audio-3-medium', prompt: 'calm harbor at dusk, soft guitar', durationSec: 30, loop: true });
      assert.deepEqual(voice, { kind: 'audio', task: 'audio.voice', model: 'elevenlabs-turbo-v2.5', text: 'Welcome to the harbor!', voice: 'neutral' });
      assert.deepEqual(history().map((h) => h.kind), ['voice', 'music', 'sfx'], 'newest first');
      await scrollTo('.gsl-ai-history');
      await shot('6-three-sounds');
    }

    // 7. the key never reached the page
    assert.ok(!(await page.eval('document.documentElement.outerHTML')).includes(TOKEN));
    console.log(`ok ${tag}`);
  } catch (e) {
    if (SHOTS) writeFileSync(join(SHOTS, `FAIL-${tag}.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
    throw e;
  } finally {
    watch.abort();
    await page.close();
    await browser.close();
    await srv.close();
    await kumo.close();
    rmSync(base, { recursive: true, force: true });
  }
}

let failed = 0;
for (const game of GAMES)
  for (const sz of SIZES)
    for (const theme of THEMES) {
      try {
        await runOne(game, sz, theme);
      } catch (e) {
        failed++;
        console.error(`FAIL ${game}-${sz.id}-${theme}: ${e.stack || e}`);
      }
    }
console.log(failed ? `studio-generate: ${failed} failed` : 'studio-generate: all ok');
process.exit(failed ? 1 : 0);
