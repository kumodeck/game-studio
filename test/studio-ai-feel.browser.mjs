// "Asking the AI feels good" in a headless browser (AI feel, 2026-10-16): the real local server,
// the built editor, and a stand-in agent (test/ai-feel/fake-agent.mjs) that does what the arrange
// skill tells a real one: `--watch`, then received → working → files → done.
//
//   node test/studio-ai-feel.browser.mjs [--only pc|phone] [--lang ja] [--shots <dir>]
//   node test/studio-ai-feel.browser.mjs --film <out.mp4> [--game lantern-cove] [--phone] [--lang ja] [--shots <dir>]
//
// Checks (three-crates, PC 1280 mouse and phone 390 touch):
// 1. The input is for writing to the AI: pressing it does not open the ⌘K list; typing a word that
//    names an action ("assets") shows only those suggestions, a sentence closes them; ⌘K opens all.
// 2. Nothing can reach the AI: Enter → within 2 s one calm line, the fact ("Kept as a note for your AI. Nothing in the
//    game changes until your AI reads it.", ai presence 2026-10-23; it was "it goes in the next time your AI runs" and a
//    "Call your AI" button), no green beside the field, no /arrange (hands-on test 2026-10-19).
// 3. The agent starts (as after "look" or /arrange): the waiting request is picked up, the line
//    goes "Claude is on it" → the AI's own words, and the violet light runs round the input meanwhile.
// 4. The agent writes the code in two steps: the game does NOT reload half-way; after "done" it
//    reloads by itself (no button), behind the old picture (never an empty list or no game), with
//    the camera and the selection kept; only the new crates are marked violet.
// 5. "Undo AI change": one press, the files are back and the crates are gone; Redo brings them back.
// 6. With the agent watching, a second request shows "is on it" within ~1 s of Enter.
// 5b. The finished line goes by itself (2026-10-20: "this line is always there, it's in the way"): not while the pointer is on it (PC),
//    gone within LINE_MAX_MS + grace after, not back on the next polls; going to the ask field (PC; it was "● AI" until
//    2026-10-23) or ⌘K (phone) brings it back with
//    its Undo / Redo, and ⌘K lists "Undo AI change" while it is gone.
// 7. The agent asks something (`--status asking` with choices and the object it is about): the question with its
//    buttons and now → after, the object lit in the scene, the ask field says "Answer your AI…", the dot still, no
//    running light; pressing a button sends an `answer` request back (hands-on test 2026-10-19).
// --film: the whole flow on one game (default lantern-cove) as an mp4 (screencast → ffmpeg):
//   the agent watching from the start, the sentence typed, Enter, the light, the change appearing
//   with only the new things glowing, Undo, Redo. With --away the agent starts only after the person
//   has seen "Your AI isn't watching" (the way back from a dead end).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startVideo } from './playtest/recorder.mjs';
import { startFakeAgent } from './ai-feel/fake-agent.mjs';
// The finished line's clock, as in src/shell/line-fade.ts (written out: these checks run with plain `node`, which
// cannot import .ts; test/line-fade.test.ts reads the module itself).
const LINE_MIN_MS = 5000, LINE_MAX_MS = 10_000, LINE_GRACE_MS = 2000, LINE_FADE_MS = 400;

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const has = (flag) => {
  const i = args.indexOf(flag);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const shotsArg = take('--shots');
const SHOTS = shotsArg ? resolve(shotsArg) : null;
const LANG = take('--lang');
const ONLY = take('--only');
const FILM = take('--film');
const GAME = take('--game') || (FILM ? 'lantern-cove' : 'three-crates');
const PHONE = has('--phone');
// --film --away: start with no AI watching; after Enter the line says so, then the agent starts (as after "look").
const AWAY = has('--away');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio._debug`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe')?.contentWindow?.__gameStudio?._debug`,
  keys: `JSON.stringify(${DBG}.list().map((i) => i.key))`,
  anchor: (key) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
    const a = ${DBG}.anchor(${JSON.stringify(key)}); return a ? JSON.stringify({ x: r.left + a.center[0], y: r.top + a.center[1] }) : 'null'; })()`,
  rect: (sel) => `JSON.stringify((() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent || x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`,
  click: (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent); if (!el || el.disabled) return false; el.click(); return true; })()`,
  palette: `(document.querySelector('.shell').dataset.palette || 'closed')`,
  line: `JSON.stringify({ cls: document.querySelector('.ai-line').className, text: document.querySelector('.ai-line').hidden ? '' : document.querySelector('.ai-line').textContent, ai: document.querySelector('.shell').dataset.ai, presence: document.querySelector('.presence')?.dataset.state })`,
  // Rows with the violet AI mark: one object's row by its key, a kind's header row (it carries data-group) as "group:<g>".
  marked: `JSON.stringify([...document.querySelectorAll('li.obj')].filter((r) => r.querySelector(':scope > .tag.ai')).map((r) => r.dataset.group ? 'group:' + r.dataset.group : r.dataset.key))`,
  // The picked objects (a kind's header row and its member rows name the same keys: a set).
  selected: `JSON.stringify([...new Set([...document.querySelectorAll('li.obj[aria-selected=true]')].map((e) => e.dataset.key))].sort())`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

/** A copy of the game in a temporary folder (requests, status, layout from earlier runs removed). */
function gameCopy(id) {
  const src = id === 'lantern-cove' || id === 'firefly-ruins' ? join(PKG, 'starters', id) : join(PKG, 'examples', id);
  const root = mkdtempSync(join(tmpdir(), `studio-ai-feel-${id}-`));
  cpSync(src, root, { recursive: true });
  for (const f of ['placement.json', '.studio/requests', '.studio/status.json', '.studio/watch.json', '.studio/undo']) rmSync(join(root, f), { recursive: true, force: true });
  if (LANG) {
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  }
  return root;
}

async function openEditor(root, mobile) {
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 }, );
  page.onEvent = (method, fn) => browser.on((m) => { if (m.method === method) fn(m.params); });
  await page.goto(srv.url);
  await page.waitFor(IN.ready, 90000);
  return { srv, browser, page };
}

/** Real input: a click or a tap at the middle of the first visible match. */
async function press(page, sel, mobile) {
  const p = await j(page, IN.rect(sel));
  assert.ok(p, `nothing visible for ${sel}`);
  if (mobile) await page.tap(p.x, p.y);
  else await page.click(p.x, p.y);
}
async function type(page, text, perChar = 0) {
  if (!perChar) return page.send('Input.insertText', { text });
  for (const ch of text) {
    await page.send('Input.insertText', { text: ch });
    await sleep(perChar);
  }
}
async function key(page, k, modifiers = 0) {
  const code = { Enter: 13, Escape: 27, k: 75, a: 65, Backspace: 8 }[k];
  const down = { type: 'keyDown', key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: code, modifiers };
  if (k === 'Enter') down.text = '\r';
  await page.send('Input.dispatchKeyEvent', down);
  await page.send('Input.dispatchKeyEvent', { ...down, type: 'keyUp', text: undefined });
}
const clearAsk = (page) => page.eval(`(() => { const i = document.querySelector('.ask-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

/**
 * Record, every 30 ms in the page, how many game frames are showing, how many rows the list has and
 * the AI line's phase: the proof that the reload never flashed an empty list or no game.
 */
const SAMPLER = `(() => { window.__aiSamples = []; const s = () => window.__aiSamples.push({ at: Date.now(),
  frames: document.querySelectorAll('iframe.game:not(.gone)').length, all: document.querySelectorAll('iframe.game').length,
  rows: document.querySelectorAll('li.obj').length, ph: document.querySelector('.ai-line').className.replace('ai-line ', ''),
  ai: document.querySelector('.shell').dataset.ai }); window.__aiTimer = setInterval(s, 30); s(); return true; })()`;

async function run(layout) {
  const mobile = layout === 'phone';
  const tag = `${GAME}-${mobile ? 'phone' : 'pc'}${LANG ? `-${LANG}` : ''}`;
  const root = gameCopy(GAME);
  const { srv, browser, page } = await openEditor(root, mobile);
  const ok = (name) => console.log(`  ✓ ${tag}: ${name}`);
  let n = 0;
  const shot = async (name) => {
    n++;
    if (!SHOTS) return;
    await sleep(300);
    writeFileSync(join(SHOTS, `${tag}-${String(n).padStart(2, '0')}-${name}.png`), await page.screenshot());
  };
  const times = {};
  let agent = null;
  const events = [];
  try {
    await sleep(800);
    await shot('open');

    // ---- 1. the input is for the AI; ⌘K is the list ----
    await press(page, '.ask-input', mobile);
    await sleep(400);
    assert.equal(await page.eval(IN.palette), 'closed', 'pressing the input opened the ⌘K list (play test stumble 6)');
    assert.equal(await page.eval(`document.activeElement?.classList.contains('ask-input')`), true);
    await shot('input-pressed');
    await type(page, LANG === 'ja' ? '素材' : 'assets');
    await page.waitFor(`${IN.palette} === 'suggest'`, 3000);
    const sugg = await j(page, `JSON.stringify([...document.querySelectorAll('.palette .p-row')].map((r) => r.textContent))`);
    assert.ok(sugg.some((s) => /Open Assets|Open the Library|素材を開く|ライブラリを開く/.test(s)), `"assets" should suggest the Library: ${sugg}`);
    assert.ok(!sugg.some((s) => /Make it night|夜/.test(s)), `suggestions only, not the AI examples: ${sugg}`);
    assert.equal(await page.eval(`!!document.querySelector('.scrim:not([hidden])')`), false, 'suggestions must not dim the game');
    await shot('typed-assets');
    await clearAsk(page);
    await type(page, 'Add three crates in a row');
    await sleep(250);
    assert.equal(await page.eval(IN.palette), 'closed', 'a sentence must close the suggestions');
    await clearAsk(page);
    await key(page, 'k', mobile ? 2 : 4);
    await page.waitFor(`${IN.palette} === 'open'`, 3000);
    await shot('cmd-k');
    await key(page, 'Escape');
    await page.waitFor(`${IN.palette} === 'closed'`, 3000);
    ok('the input writes to the AI; "assets" suggests Open Assets; a sentence closes it; ⌘K opens the list');

    // Pick crate-1 (its row), and remember where it is on screen (the camera must not move on reload).
    if (mobile) {
      await press(page, '[data-action=sheet]', true);
      await sleep(600);
    }
    await page.eval(IN.click('li.obj[data-key="crate-1"] .name, li.obj[data-key="crate-1"]'));
    await sleep(800);
    if (mobile) {
      await page.eval(IN.click('[data-action=sheet]'));
      await sleep(600);
    }
    const sel0 = await j(page, IN.selected);
    const at0 = await j(page, IN.anchor('crate-1'));
    const view0 = await page.eval(`JSON.stringify(${DBG}.view())`);
    assert.ok(at0, 'crate-1 on screen');

    // ---- 2. nobody watching: said at once ----
    await press(page, '.ask-input', mobile);
    await type(page, 'Add three crates in a row');
    let t0 = Date.now();
    await key(page, 'Enter');
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('away')`, 2000);
    times.away = Date.now() - t0;
    const away = await j(page, IN.line);
    assert.match(away.text, /Kept as a note for|へのメモとして残しました/);
    assert.doesNotMatch(away.text, /next time|次に動いた|\/arrange|Claude Code/, 'a fact, not a promise; no command to run');
    assert.equal(await page.eval(`!!document.querySelector('[data-action=ai-call]')`), false, 'no "Call your AI" (it copied a word without saying why)');
    assert.ok(!['watching', 'working'].includes(away.presence), `no green beside the field while nobody can pick it up: ${away.presence}`);
    assert.notEqual(away.ai, 'busy', 'no light while nobody will answer');
    assert.equal(await page.eval(IN.palette), 'closed', 'Enter on a sentence must send it, not run an action');
    await shot('away');
    ok(`nothing reaches the AI: the fact in one line in ${times.away} ms`);

    // ---- 3–4. the agent starts; received → working; no reload until done; then by itself ----
    await page.eval(SAMPLER);
    const code0 = readFileSync(join(root, 'game.js'), 'utf8');
    agent = startFakeAgent(root, { onEvent: (what) => events.push({ at: Date.now(), what }) });
    t0 = Date.now();
    await page.waitFor(`document.querySelector('.ai-line').matches('.seen, .received, .working')`, 4000);
    times.pickedUp = Date.now() - t0;
    assert.equal((await j(page, IN.line)).ai, 'busy', 'the light runs while the AI has it');
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('working')`, 6000);
    const working = await j(page, IN.line);
    assert.match(working.text, /Adding 3 crates in a row…|木箱を 3 つ並べています…/);
    await shot('working');
    await page.waitFor(`${IN.keys}.includes('crate-7')`, 20000);
    times.reloaded = Date.now() - t0;
    await page.waitFor(`document.querySelectorAll('iframe.game').length === 1`, 8000).catch(async (e) => {
      console.log(await page.eval(`JSON.stringify([...document.querySelectorAll('iframe.game')].map((f) => f.className + ' ' + !!f.contentWindow?.__gameStudio?._debug)) + ' rows ' + document.querySelectorAll('li.obj').length`));
      throw e;
    });
    await sleep(500);
    const samples = await j(page, `(() => { clearInterval(window.__aiTimer); return JSON.stringify(window.__aiSamples); })()`);
    const done = events.find((e) => e.what === 'done');
    const wrote = events.filter((e) => e.what === 'wrote a file');
    assert.ok(done && wrote.length === 2, `agent events: ${JSON.stringify(events.map((e) => e.what))}`);
    const firstSwap = samples.find((s) => s.all > 1);
    assert.ok(firstSwap, 'the game reloaded in a second frame');
    assert.ok(firstSwap.at >= done.at - 50, `reloaded ${done.at - firstSwap.at} ms before the AI said done (half-written game)`);
    assert.equal(Math.min(...samples.map((s) => s.frames)), 1, 'a moment with no game on screen');
    assert.ok(Math.min(...samples.map((s) => s.rows)) > 0, 'a moment with an empty list');
    assert.ok(!(await page.eval(`!!document.querySelector('[data-action=ai-reload]')`)), 'no Reload button to press');
    const fresh = readFileSync(join(root, 'game.js'), 'utf8');
    assert.notEqual(fresh, code0);
    // Camera and selection kept.
    const at1 = await j(page, IN.anchor('crate-1'));
    assert.ok(Math.hypot(at1.x - at0.x, at1.y - at0.y) < 3, `the view moved: ${JSON.stringify([at0, at1])}`);
    assert.equal(await page.eval(`JSON.stringify(${DBG}.view())`), view0, 'view state');
    assert.deepEqual(await j(page, IN.selected), sel0, 'selection');
    // Only what changed is violet: the three new crates.
    const marked = await j(page, IN.marked);
    // The three new crates (and their kind's header row), nothing the AI did not touch.
    for (const k of ['crate-5', 'crate-6', 'crate-7']) assert.ok(marked.includes(k), `${k} not marked: ${marked}`);
    for (const k of ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'lamp', 'ground']) assert.ok(!marked.includes(k), `${k} marked but unchanged: ${marked}`);
    const line = await j(page, IN.line);
    assert.match(line.text, /Added 3 crates in a row by the yard|木箱を 3 つ並べました/);
    assert.match(line.text, /3 things changed|3 個変わりました/);
    assert.ok(line.cls.includes('done'));
    assert.notEqual(line.ai, 'busy');
    await shot('done-marked');
    ok(`picked up in ${times.pickedUp} ms; reloaded by itself ${times.reloaded} ms after the agent started, after "done", no flash; camera + selection kept; violet: ${marked.join(', ')}`);

    // ---- 5. Undo AI change, then Redo ----
    if (mobile) {
      // The phone is folded here: the list button pressed after the pick (above) folds the bottom since 2026-10-21
      // (sheet-fold.ts; it only closed the list before). Folded, the AI's line is not drawn and its news is a dot on ▴;
      // one press on ▴ opens the bottom and the line with Undo. (Until test-fix, 2026-10-21, this pressed Undo at once
      // and stopped with "nothing visible": the place changed, Undo is not lost — ▴, or ⌘K "Undo AI change".)
      assert.equal(await page.eval(`document.querySelector('.shell').dataset.fold || ''`), 'min', 'the phone is folded after the list button');
      assert.equal(await page.eval(`document.querySelector('.bar [data-action=sheet]').dataset.news || ''`), 'on', 'folded, no dot on ▴ for the AI\'s line');
      await press(page, '[data-action=sheet]', true);
      await page.waitFor(`!document.querySelector('.shell').dataset.fold && ${IN.rect('[data-action=ai-undo]')} !== 'null'`, 3000);
      await shot('unfolded');
    }
    await press(page, '[data-action=ai-undo]', mobile);
    await page.waitFor(`!${IN.keys}.includes('crate-5')`, 15000);
    assert.equal(readFileSync(join(root, 'game.js'), 'utf8'), code0, 'the code is back');
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('undone')`, 3000);
    assert.deepEqual(await j(page, IN.marked), [], 'no violet after undo');
    await shot('undone');
    await press(page, '[data-action=ai-redo]', mobile);
    await page.waitFor(`${IN.keys}.includes('crate-7')`, 15000);
    assert.equal(readFileSync(join(root, 'game.js'), 'utf8'), fresh, 'the AI change is back');
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('redone')`, 3000);
    await shot('redone');
    ok('Undo AI change: one press, code and game back; Redo puts it back');

    // ---- 5b. the finished line goes by itself, and comes back when asked ----
    const lineGone = `document.querySelector('.ai-line').hidden && document.querySelector('.ai-caption').hidden`;
    if (!mobile) {
      // The pointer on the line: it stays past its longest time.
      const r = await j(page, IN.rect('.ai-line'));
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
      await sleep(LINE_MAX_MS + 800);
      assert.equal(await page.eval(`document.querySelector('.ai-line').hidden`), false, 'the line went while the pointer was on it');
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 120 });
    }
    t0 = Date.now();
    await page.waitFor(lineGone, LINE_MAX_MS + LINE_GRACE_MS + LINE_FADE_MS + 2000).catch(async (e) => {
      console.log(await page.eval(`JSON.stringify({ line: document.querySelector('.ai-line').className, hidden: document.querySelector('.ai-line').hidden,
        hover: document.querySelector('.ai-line').matches(':hover'), focus: document.querySelector('.ai-line').matches(':focus-within'), active: document.activeElement?.outerHTML?.slice(0, 120),
        caption: [...document.querySelector('.ai-caption').children].map((c) => c.className + ':' + c.hidden) })`));
      throw e;
    });
    times.faded = Date.now() - t0;
    if (!mobile) assert.ok(times.faded >= LINE_GRACE_MS - 300, `gone ${times.faded} ms after the pointer left (grace ${LINE_GRACE_MS})`);
    await shot('faded');
    // Polls (every 3 s) draw the line again: it stays gone.
    await sleep(3600);
    assert.equal(await page.eval(lineGone), true, 'the faded line came back on a poll');
    // Phone: fold the bottom again (▾), so ⌘K below brings the line back to a folded bottom — folded, it drew the line
    // unseen until test-fix (2026-10-21); now it unfolds.
    if (mobile) {
      await press(page, '[data-action=sheet]', true);
      await page.waitFor(`document.querySelector('.shell').dataset.fold === 'min'`, 3000);
    }
    // ⌘K keeps "Undo AI change" (the line was redone: its change can be undone again) and "Show your AI's last reply".
    await key(page, 'k', mobile ? 2 : 4);
    await page.waitFor(`${IN.palette} === 'open'`, 3000);
    const rows = await j(page, `JSON.stringify([...document.querySelectorAll('.palette .p-row')].map((r) => r.dataset.row))`);
    assert.ok(rows.includes('ai-undo') && rows.includes('ai-recall'), `⌘K rows: ${rows}`);
    if (mobile) {
      // No "● AI" in a phone's top bar: ⌘K brings it back.
      await page.eval(IN.click('.palette .p-row[data-row="ai-recall"]'));
    } else {
      await key(page, 'Escape');
      await page.waitFor(`${IN.palette} === 'closed'`, 3000);
      // Going to the field brings it back (the top bar's "● AI" did until 2026-10-23).
      await page.eval(`(document.activeElement?.blur?.(), true)`);
      await press(page, '.ask-input', false);
    }
    await page.waitFor(`!document.querySelector('.ai-line').hidden && !!document.querySelector('.ai-line [data-action=ai-undo]')`, 3000);
    // Drawn where it can be pressed (folded, it was in the DOM but not on screen).
    assert.ok(await j(page, IN.rect('.ai-line [data-action=ai-undo]')), 'the recalled line\'s Undo is not on screen');
    if (mobile) assert.equal(await page.eval(`document.querySelector('.shell').dataset.fold || ''`), '', '⌘K "Show your AI\'s last reply" left the bottom folded');
    await shot('recalled');
    // And it goes again by itself.
    await page.waitFor(lineGone, LINE_MAX_MS + LINE_GRACE_MS + LINE_FADE_MS + 2000);
    ok(`the finished line goes by itself (${times.faded} ms after${mobile ? '' : ' the pointer left'}; at least ${LINE_MIN_MS} ms), stays gone on polls, comes back from ${mobile ? '⌘K' : 'the ask field'} with Undo`);

    // ---- 6. with the agent watching: "has it" within a second ----
    await page.waitFor(`document.querySelector('.presence')?.dataset.state === 'watching'`, 5000);
    await press(page, '.ask-input', mobile);
    await type(page, 'Make it night');
    t0 = Date.now();
    await key(page, 'Enter');
    await page.waitFor(`document.querySelector('.ai-line').matches('.sent, .seen, .received, .working')`, 2000);
    times.sent = Date.now() - t0;
    await page.waitFor(`document.querySelector('.ai-line').matches('.seen, .received, .working')`, 3000);
    times.seen = Date.now() - t0;
    await shot('seen');
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('done')`, 15000);
    times.done2 = Date.now() - t0;
    ok(`watching: "sent" in ${times.sent} ms, "has it" in ${times.seen} ms, done in ${times.done2} ms`);

    // ---- 7. the AI asks in its own window (dogfood 2026-10-17, U2): the editor says so, with the question ----
    const q = 'Is the second door a real door, or only for looks?';
    const askedId = readdirSync(join(root, '.studio/requests/done')).filter((n) => n.endsWith('.json')).sort().pop()?.slice(0, -5);
    writeFileSync(join(root, '.studio/status.json'), JSON.stringify({ version: 1, state: 'asking', note: q, request: askedId,
      choices: ['A real door', 'Only for looks'], about: ['crate-1'], before: 'A door you walk through', after: 'A picture of a door', at: new Date().toISOString() }) + '\n');
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('asking')`, 4000);
    const asking = JSON.parse(await page.eval(`(() => { const l = document.querySelector('.ai-line');
      const tagEl = document.querySelector('iframe').contentWindow.document.querySelector('[data-studio-ui]')?.shadowRoot?.querySelector('.tag.ai');
      const tag = tagEl ? tagEl.style.display + ' ' + tagEl.textContent : 'none';
      return JSON.stringify({ head: l.querySelector('.ai-head')?.textContent, sub: (l.querySelector('.ai-sub .ai-said') || l.querySelector('.ai-sub'))?.textContent, more: l.querySelector('.ai-more')?.textContent || '',
        choices: [...l.querySelectorAll('[data-action=ai-answer]')].map((b) => b.textContent),
        compare: l.querySelector('[data-part=ai-compare]')?.textContent || '', show: !!l.querySelector('[data-action=ai-ask-show]'), tag,
        placeholder: document.querySelector('.ask-input').placeholder,
        dot: getComputedStyle(l, '::before').animationName, ai: document.querySelector('.shell').dataset.ai, hidden: l.hidden }); })()`));
    assert.equal(asking.hidden, false);
    assert.equal(asking.head, q, 'the question first');
    assert.equal(asking.sub, LANG === 'ja' ? 'AI から質問です' : 'Your AI has a question');
    assert.doesNotMatch(asking.head + asking.sub, /Claude Code/, 'no "answer it in another window"');
    // Where the AI's whole question is, at the end of the grey row (2026-10-21): Claude / Codex / "your AI" by how the editor was started.
    assert.match(asking.more, LANG === 'ja' ? /^詳しくは.+で$/ : /^More in /);
    assert.deepEqual(asking.choices, ['A real door', 'Only for looks']);
    assert.match(asking.compare, /A door you walk through.*A picture of a door/);
    assert.equal(asking.show, true, '"Show it in the scene"');
    // Lit in the game with its tag; when it is the selected object, the selection outline already shows it (the bridge
    // draws one outline per object).
    const selNow = await j(page, IN.selected);
    if (!selNow.includes('crate-1')) assert.match(asking.tag, /^flex .*(asking about this|聞いているのはこれ)/, 'the object it is about is lit in the game, with its tag');
    assert.equal(asking.placeholder, LANG === 'ja' ? 'AI に答える…' : 'Answer your AI…');
    assert.equal(asking.dot, 'none', 'the violet dot does not blink');
    assert.notEqual(asking.ai, 'busy', 'no running light: the person acts now');
    await shot('asking');
    // A button answers: the answer goes back to the AI as a request (its watch prints a `studio: answer` line).
    const before = new Set(readdirSync(join(root, '.studio/requests')));
    await page.eval(IN.click('.ai-line [data-action=ai-answer]'));
    await page.waitFor(`!document.querySelector('.ai-line').classList.contains('asking')`, 3000);
    let ans = null;
    for (let i = 0; i < 20 && !ans; i++) {
      const n = readdirSync(join(root, '.studio/requests')).find((f) => f.endsWith('.json') && !before.has(f));
      if (n) ans = JSON.parse(readFileSync(join(root, '.studio/requests', n), 'utf8'));
      else await sleep(100);
    }
    assert.ok(ans, 'an answer request was kept');
    assert.equal(ans.kind, 'answer');
    assert.equal(ans.text, 'A real door');
    assert.equal(ans.question, q);
    if (askedId) assert.equal(ans.to, askedId);
    assert.deepEqual(ans.objects.map((o) => o.key), ['crate-1']);
    assert.notEqual(await page.eval(`document.querySelector('.ask-input').placeholder`), asking.placeholder, 'the field asks again');
    await shot('answered');
    ok('asking: answered in the editor (buttons, now → after, the object lit); the answer reached the AI');
    return times;
  } finally {
    await agent?.stop();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** The film: the whole flow on one game, as a person would see it. */
async function film(out) {
  const root = gameCopy(GAME);
  const mobile = PHONE;
  const { srv, browser, page } = await openEditor(root, mobile);
  const events = [];
  let agent = AWAY ? null : startFakeAgent(root, { slow: true, onEvent: (what) => events.push({ at: Date.now(), what }) });
  const tag = `${GAME}-film-${mobile ? 'phone' : 'pc'}${AWAY ? '-away' : ''}${LANG ? `-${LANG}` : ''}`;
  let n = 0;
  const shot = async (name) => {
    n++;
    if (SHOTS) writeFileSync(join(SHOTS, `${tag}-${String(n).padStart(2, '0')}-${name}.png`), await page.screenshot());
  };
  const text = GAME === 'lantern-cove' ? (LANG === 'ja' ? '島のまわりに灯台を 3 つ足して' : 'Add three lighthouses around the island') : 'Add three crates in a row';
  try {
    if (!AWAY) await page.waitFor(`document.querySelector('.presence')?.dataset.state === 'watching'`, 10000);
    await sleep(2500); // let the water settle into its loop
    const video = await startVideo(page, { maxWidth: mobile ? 780 : 1280, maxHeight: mobile ? 1688 : 800 });
    await sleep(1500);
    await shot('open');
    await press(page, '.ask-input', mobile);
    await sleep(500);
    await type(page, text, 55);
    await sleep(600);
    await shot('typed');
    await key(page, 'Enter');
    if (AWAY) {
      await page.waitFor(`document.querySelector('.ai-line').classList.contains('away')`, 2000);
      await sleep(600);
      await shot('away');
      await sleep(3400);
      // The person switches to their AI and types "look" (or runs /arrange): its watch starts and finds the request.
      agent = startFakeAgent(root, { slow: true, onEvent: (what) => events.push({ at: Date.now(), what }) });
      await page.waitFor(`document.querySelector('.ai-line').matches('.seen, .received')`, 8000);
    } else await page.waitFor(`document.querySelector('.ai-line').matches('.sent, .seen')`, 2000);
    await sleep(400);
    await shot('sent');
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('working')`, 15000);
    await sleep(700);
    await shot('working');
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('done') && document.querySelectorAll('iframe.game').length === 1`, 40000);
    await sleep(2200);
    await shot('done');
    await sleep(1800);
    await press(page, '[data-action=ai-undo]', mobile);
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('undone') && document.querySelectorAll('iframe.game').length === 1`, 20000);
    await sleep(2200);
    await shot('undone');
    await press(page, '[data-action=ai-redo]', mobile);
    await page.waitFor(`document.querySelector('.ai-line').classList.contains('redone') && document.querySelectorAll('iframe.game').length === 1`, 20000);
    await sleep(2500);
    await shot('redone');
    const r = await video.stop(resolve(out));
    console.log(`  film: ${JSON.stringify(r)}`);
    console.log(`  agent: ${events.map((e) => e.what).filter((w) => !w.startsWith('line ')).join(' → ')}`);
  } finally {
    await agent?.stop();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

if (FILM) {
  await film(FILM);
} else {
  const all = {};
  for (const layout of ONLY ? [ONLY] : ['pc', 'phone']) all[layout] = await run(layout);
  console.log(`timings (ms): ${JSON.stringify(all)}`);
}
