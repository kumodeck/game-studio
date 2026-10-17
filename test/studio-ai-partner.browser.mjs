// The "AI partner" editor in a headless browser: the real local server, the
// built shell, an example game.
//
//   node test/studio-ai-partner.browser.mjs [example ...] [--lang ja] [--shots <dir>] [--no-nudge]
//
// For each example, at 1280×800 (mouse) and 390×844 (touch):
// - the title is the game's name; the engine name is not shown by default;
// - 3D: picking an object from the list frames it with its neighbours (not
//   filling the screen), and the ground frames the play area;
// - the card: name, copy / delete, then the numbers (open on PC, under "…" on a phone);
//   the ask bar at the bottom of the game names the picked object (its chip);
// - typing a request and pressing Ask keeps .studio/requests/<id>.json and
//   prints one `studio: request ask …` line; the AI line says "waiting";
// - objects with no name: one button asks the AI to name them (kind "name");
// - after a save with nobody watching: the line says so at once and what to
//   do (PC only; --no-nudge skips it);
// - the AI's status file (written here like an agent would, with
//   `studio.mjs --status`) shows as "got it" and "done (3)"; with the code
//   changed, the game reloads by itself and offers "Undo AI change";
// - "Ideas for your AI" (from the ⌘K list): in-game ideas first, KUMODeck
//   below; an edited "fit" idea is kept as a request;
// - several picked with "Select several" (edit-ops): the card's ask box says
//   "the N you picked" and the one request names all N;
// - Library: no "0" marks; "Ask my AI to delete it" is kept as a request
//   (step delete-files) like every other hand-off.
// Each example runs in a temporary copy of its folder. Exit code 1 on the
// first failed expectation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const shotsArg = take('--shots');
const SHOTS = shotsArg ? resolve(shotsArg) : null;
const LANG = take('--lang');
const noNudgeAt = args.indexOf('--no-nudge');
const NUDGE = noNudgeAt < 0;
if (noNudgeAt >= 0) args.splice(noNudgeAt, 1);
const EXAMPLES = args.length ? args : ['three-crates', 'pixi-garden'];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const UNUSED = 'old-unused.svg';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio._debug`;
const IN = {
  ready: `document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe').contentWindow.__gameStudio?._debug`,
  list: `JSON.stringify(${DBG}.list())`,
  /** Where an object is drawn, in shell-page px, and the game frame. */
  anchor: (key) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
    const a = ${DBG}.anchor(${JSON.stringify(key)}); if (!a) return null;
    return JSON.stringify({ x: r.left + a.center[0], y: r.top + a.center[1], rect: a.rect, frame: { x: r.left, y: r.top, w: r.width, h: r.height } }); })()`,
  click: (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent); if (!el || el.disabled) return false; el.click(); return true; })()`,
  // checkVisibility: inside a closed <details>, Chrome keeps offsetParent but hides the content.
  visible: (sel) => `!![...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent && e.checkVisibility())`,
  text: (sel) => `([...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent)?.textContent || '')`,
};
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

const requests = (root) => {
  try {
    return readdirSync(join(root, '.studio/requests')).filter((n) => n.endsWith('.json')).sort().map((n) => JSON.parse(readFileSync(join(root, '.studio/requests', n), 'utf8')));
  } catch {
    return [];
  }
};

async function run(example, layout) {
  const mobile = layout === 'phone';
  const tag = `${example}-${mobile ? '390' : '1280'}${LANG ? `-${LANG}` : ''}`;
  const root = mkdtempSync(join(tmpdir(), `studio-ai-${example}-`));
  cpSync(join(PKG, 'examples', example), root, { recursive: true });
  rmSync(join(root, 'placement.json'), { force: true });
  rmSync(join(root, '.studio/requests'), { recursive: true, force: true });
  rmSync(join(root, '.studio/status.json'), { force: true });
  // A file nothing uses, for the Library's "Ask my AI to delete it".
  writeFileSync(join(root, UNUSED), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
  if (LANG) {
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  }
  const lines = [];
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  const step = (name) => console.log(`  ✓ ${tag}: ${name}`);
  let n = 0;
  const shot = async (name) => {
    n++;
    if (!SHOTS) return;
    await sleep(350);
    writeFileSync(join(SHOTS, `ai-partner-${tag}-${n}-${name}.png`), await page.screenshot());
  };
  const press = async (sel) => assert.ok(await page.eval(IN.click(sel)), `no enabled, visible ${sel}`);
  const list = async () => JSON.parse(await page.eval(IN.list));
  const openSheet = async () => {
    if (mobile && !(await page.eval(IN.visible('.placement')))) {
      await press('[data-action=sheet]');
      await sleep(600);
    }
  };
  const agent = (...a) => {
    const r = spawnSync(process.execPath, [CLI, root, ...a], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    await page.goto(srv.url);
    await page.waitFor(IN.ready, 30000);
    const title = /<title>([^<]*)<\/title>/.exec(readFileSync(join(root, 'index.html'), 'utf8'))[1].trim();

    // --- title: the game's name; the engine name hidden by default ---
    await page.waitFor(`document.querySelector('.brand .title')?.textContent === ${JSON.stringify(title)}`, 5000);
    assert.equal(await page.eval(`document.querySelector('.brand .adapter').hidden`), true, 'engine name shown by default');
    assert.match(await page.eval('document.title'), new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    step(`title "${title}", engine name hidden`);
    await shot('open');

    const items = await list();
    const dim = items[0].pose.p.length === 3 ? '3d' : '2d';

    // --- 3D: picking from the list frames the object with its neighbours ---
    if (dim === '3d') {
      await openSheet();
      const onScreen = async (skip) => {
        let k = 0;
        for (const it of await list()) {
          if (it.key === skip) continue;
          const a = await j(page, IN.anchor(it.key));
          if (a && a.x > a.frame.x && a.x < a.frame.x + a.frame.w && a.y > a.frame.y && a.y < a.frame.y + a.frame.h) k++;
        }
        return k;
      };
      const barrel = items.find((i) => i.label === 'barrel') || items[1];
      await press(`li.obj[data-key="${barrel.key}"]`);
      await sleep(700);
      const a = await j(page, IN.anchor(barrel.key));
      assert.ok(a.rect && a.rect.h < a.frame.h * 0.5 && a.rect.w < a.frame.w * 0.6, `"${barrel.label}" fills the screen: ${JSON.stringify(a.rect)} in ${JSON.stringify(a.frame)}`);
      const around = await onScreen(barrel.key);
      assert.ok(around >= 2, `only ${around} other objects in view around "${barrel.label}"`);
      step(`list pick "${barrel.label}": ${Math.round(a.rect.w)}×${Math.round(a.rect.h)} px, ${around} neighbours in view`);
      await shot('pick-from-list');
      const ground = items.find((i) => i.label === 'ground');
      if (ground) {
        await press(`li.obj[data-key="${ground.key}"]`);
        await sleep(700);
        const k = await onScreen(ground.key);
        assert.ok(k >= items.length - 3, `ground pick: only ${k} of ${items.length - 1} objects in view`);
        step(`list pick "ground": ${k} objects in view (play area, not the whole plane)`);
      }
    }

    // --- the card: name · copy / delete, then the numbers ---
    // A named object that has its own row (not folded into a "×4" group row).
    const target = items.find((i) => !i.unstable && i.movable !== false && i.label !== 'ground' && !items.some((o) => o !== i && o.group && o.group === i.group)) || items[0];
    await openSheet();
    await press(`li.obj[data-key="${target.key}"]`);
    await page.waitFor(`document.querySelector('.card strong')?.textContent === ${JSON.stringify(target.label)}`, 5000);
    const order = await page.eval(`JSON.stringify([...document.querySelector('.card').children].map(e => e.className || e.tagName))`);
    const cls = JSON.parse(order);
    const has = (c) => cls.findIndex((x) => x.split(' ').includes(c));
    // The ask bar sits at the bottom of the game (rebrand 2026-10-16): always in
    // the same place, and its orange chip names the picked object before a word
    // is typed. The card is the head (name, copy, delete) then the body (numbers…).
    assert.ok(cls[0].split(' ').includes('card-head') && has('card-body') > 0, `card order: ${order}`);
    assert.ok(await page.eval(`!!document.querySelector('.card .card-head .card-actions') && !!document.querySelector('.card .card-body > .fine')`), 'card: copy / delete in the head, the numbers in the body');
    assert.ok(await page.eval(`!!document.querySelector('.ask-strip [data-part=ask] .ask-input') && !document.querySelector('.ask-input').disabled`), 'ask box not in the bar at the bottom of the game');
    assert.equal(await page.eval(IN.text('.ask-chip')), target.label, 'the ask bar does not name the picked object');
    assert.ok((await page.eval(`document.querySelector('.ask-input').getAttribute('aria-label')`)).includes(target.label), 'the ask field is not read aloud with the name');
    // edit-ops buttons live in .card-actions (merge of edit-ops + AI partner, 2026-10-16).
    assert.ok(await page.eval(`!!document.querySelector('.card .card-actions [data-action=copy]') && !!document.querySelector('.card .card-actions [data-action=remove]')`), 'copy / delete are not in .card-actions');
    // PC: the numbers are always shown (folded, nobody used them). Phone: the 56 px card folds them under "…".
    assert.equal(await page.eval(IN.visible('.card .num input')), !mobile, mobile ? 'number fields visible on the folded phone card' : 'number fields hidden on PC');
    step(`ask bar at the bottom names "${target.label}"; card: name · copy / delete → numbers (${mobile ? 'under "…"' : 'open'})`);

    // --- ask: words → request file + one line + the AI line ---
    const words = LANG === 'ja' ? 'あと 3 つ並べて' : 'add 3 more in a row';
    await page.eval(`document.querySelector('.ask-strip .ask-input').focus()`);
    await page.send('Input.insertText', { text: words });
    await shot('ask-typed');
    await press('[data-action=ask-ai]');
    await page.waitFor(`!!document.querySelector('.ask-note:not(.hint)') && ${IN.visible('.ai-caption > :is(.ai-line, .ask-note)')}`, 5000);
    let reqs = requests(root);
    assert.equal(reqs.length, 1, JSON.stringify(reqs));
    assert.deepEqual([reqs[0].kind, reqs[0].text, reqs[0].objects[0].key], ['ask', words, target.key]);
    assert.ok(reqs[0].objects[0].pose && reqs[0].objects[0].pose.p.length === (dim === '3d' ? 3 : 2), 'the pose at the time of asking is in the request');
    assert.ok(lines.some((l) => l.startsWith(`studio: request ask .studio/requests/${reqs[0].id}.json`)), lines.join('\n'));
    assert.equal(await page.eval(`document.querySelector('.ask-strip .ask-input').value`), '', 'the box is emptied after sending');
    await page.waitFor(IN.visible('.ai-line'), 3000);
    step(`asked "${words}" about "${target.label}" → ${reqs[0].id}.json`);
    await shot('ask-sent');

    // --- several picked (edit-ops "Select several") → one request about all of them ---
    {
      const pickable = (await list()).filter((i) => i.movable !== false && !i.copyOf).map((i) => i.key);
      const want = pickable.slice(0, Math.min(4, pickable.length));
      assert.ok(want.length >= 2, `only ${pickable.length} pickable objects`);
      await openSheet();
      await press('[data-action=multi]');
      for (const k of want) {
        if (!(await page.eval(`document.querySelector('li.obj[data-key="${k}"]')?.getAttribute('aria-selected') === 'true'`))) {
          // Rows of a "name ×N" group are inside a folded row: open it first.
          if (!(await page.eval(IN.visible(`li.obj[data-key="${k}"]`)))) await page.eval(`(() => { const e = [...document.querySelectorAll('li.obj .expand')].find(b => b.offsetParent); if (e) e.click(); })()`);
          await press(`li.obj[data-key="${k}"]`);
        }
      }
      const sel = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('li.obj[aria-selected=true]')].map(e => e.dataset.key))`));
      await page.waitFor(`!!document.querySelector('.card .group-head')`, 5000);
      const n = Number((await page.eval(IN.text('.ask-strip .ask-chip'))).match(/\d+/)?.[0]);
      assert.ok(n >= 2, `ask bar chip: ${await page.eval(IN.text('.ask-strip .ask-chip'))}`);
      const manyWords = LANG === 'ja' ? 'まとめて少し大きくして' : 'make these a bit bigger';
      await page.eval(`document.querySelector('.ask-strip .ask-input').focus()`);
      await page.send('Input.insertText', { text: manyWords });
      await shot('ask-many-typed');
      await press('[data-action=ask-ai]');
      await page.waitFor(`!!document.querySelector('.ask-note:not(.hint)') && ${IN.visible('.ai-caption > :is(.ai-line, .ask-note)')}`, 5000);
      const manyReq = requests(root).find((r) => r.kind === 'ask' && r.text === manyWords);
      assert.ok(manyReq, JSON.stringify(requests(root)));
      assert.equal(manyReq.objects.length, n, `request has ${manyReq.objects.length} objects, card said ${n}`);
      assert.ok(manyReq.objects.every((o) => o.pose), 'every picked object carries its pose');
      assert.ok(lines.some((l) => l.startsWith(`studio: request ask .studio/requests/${manyReq.id}.json`)), lines.join('\n'));
      step(`picked ${n} with "Select several" (${sel.length} rows marked) → one request about all ${n}: ${manyReq.objects.map((o) => o.label || o.key).join(', ')}`);
      await shot('ask-many-sent');
      // "Done" first: while "Select" is on, "Done" is the only way out shown
      // (two "stop" buttons side by side were one too many: mari review).
      await press('[data-action=multi]');
      await press('[data-action=select-none]');
      await press(`li.obj[data-key="${target.key}"]`);
      await page.waitFor(`document.querySelector('.card strong')?.textContent === ${JSON.stringify(target.label)}`, 5000);
    }

    // --- phone: "…" opens the numbers ---
    if (mobile) {
      await press('.card details.fine > summary');
      await page.waitFor(IN.visible('.card .num input'), 2000);
      step('"…" opens the numbers');
      await shot('fine-open');
      await press('.card details.fine > summary');
    }

    // --- no name: one button asks the AI to name them ---
    const unnamed = (await list()).filter((i) => i.unstable);
    if (unnamed.length) {
      await page.waitFor(IN.visible('.noname [data-action=ask-name-all]'), 3000);
      await shot('noname');
      await press('.noname [data-action=ask-name-all]');
      await page.waitFor(`!${IN.visible('.noname [data-action=ask-name-all]')}`, 3000);
      reqs = requests(root);
      const nameReq = reqs.find((r) => r.kind === 'name');
      assert.ok(nameReq && nameReq.objects.length === unnamed.length, JSON.stringify(nameReq));
      assert.ok(lines.some((l) => l.startsWith('studio: request name ')));
      // The agent heard about them at the start too (skill §3.2: offer once to name them).
      assert.ok(lines.some((l) => l.startsWith(`studio: unnamed ${unnamed.length} object`)), lines.join('\n'));
      step(`asked the AI to name ${unnamed.length} object(s) · the agent got "${lines.find((l) => l.startsWith('studio: unnamed'))}" at the start`);
    }

    // --- the AI writes its status (as an agent would, with studio.mjs --status) ---
    agent('--status', 'received');
    await page.waitFor(`document.querySelector('.ai-line')?.classList.contains('received')`, 15000);
    step(`AI line: "${await page.eval(IN.text('.ai-line'))}"`);
    await shot('ai-received');
    // The "AI" changes the code (a comment is enough): with "done", the game reloads by itself (AI feel).
    const main = ['game.js', 'main.js', 'js/main.js'].map((f) => join(root, f)).find((f) => { try { readFileSync(f); return true; } catch { return false; } });
    writeFileSync(main, readFileSync(main, 'utf8') + '\n// the AI was here\n');
    await page.eval(`window.__frame0 = document.querySelector('iframe'), true`);
    agent('--status', 'done', '--changed', '3', '--note', LANG === 'ja' ? '樽を 3 つ並べました。' : 'Added 3 barrels in a row.');
    await page.waitFor(`document.querySelector('.ai-line')?.classList.contains('done')`, 15000);
    assert.match(await page.eval(IN.text('.ai-line')), /3/);
    assert.equal(requests(root).length, 0, 'done moves the handled requests to requests/done/');
    step(`AI line: "${await page.eval(IN.text('.ai-line'))}"`);
    await shot('ai-done');
    await page.waitFor(`document.querySelector('iframe') !== window.__frame0 && document.querySelectorAll('iframe.game').length === 1`, 20000);
    await page.waitFor(IN.ready, 30000);
    assert.ok(await page.eval(IN.visible('[data-action=ai-undo]')), 'no "Undo AI change" after the AI\'s change');
    step('the code changed and the AI is done: the game reloaded by itself, with "Undo AI change"');

    // --- a save nobody picks up: "say 'look'" ---
    if (NUDGE && !mobile) {
      await press(`li.obj[data-key="${target.key}"]`);
      await page.waitFor(`document.querySelector('.card strong')?.textContent === ${JSON.stringify(target.label)}`, 5000);
      await page.eval(`(() => { const i = document.querySelector('.card .num input'); i.value = String(Number(i.value) + 1); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      // "Save · 1" appears with the change (the draft is already in placement.json).
      await page.waitFor(IN.visible('[data-action=save]'), 3000);
      await press('[data-action=save]');
      await page.waitFor(`document.querySelector('.ai-line') && !document.querySelector('.ai-line').hidden && !document.querySelector('.ai-line').classList.contains('done')`, 5000);
      assert.ok(requests(root).some((r) => r.kind === 'saved'), 'the save was not kept as a request');
      // Nobody watches (no `studio.mjs --watch`): said at once, not after 20 s (AI feel, 10/16).
      await page.waitFor(`document.querySelector('.ai-line')?.classList.contains('away')`, 2000);
      step(`nobody watching → at once "${await page.eval(IN.text('.ai-line'))}"`);
      await shot('away');
    }

    // --- ideas for your AI: in-game first, KUMODeck below ---
    // From the ⌘K list (press the ask field): "Ideas for your AI…".
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); })()`);
    await page.waitFor(IN.visible('.palette [data-action=next]'), 3000);
    await press('.palette [data-action=next]');
    await page.waitFor(IN.visible('[data-step=fit]'), 3000);
    const stepsOrder = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('[data-step]')].map(b => b.dataset.step))`));
    assert.deepEqual(stepsOrder, ['fit', 'look', 'tool', 'publish', 'multiplayer', 'save-data', 'ai-assets']);
    step('ideas: fit / look / tool, then KUMODeck');
    await shot('ideas');
    await press('[data-step=fit]');
    await page.waitFor(IN.visible('textarea.prompt'), 3000);
    const fitWords = LANG === 'ja' ? '1 マス 50 cm に合わせて' : 'snap to a 50 cm grid';
    await page.eval(`(() => { const t = document.querySelector('textarea.prompt'); t.focus(); t.select(); })()`);
    await page.send('Input.insertText', { text: fitWords });
    await press('[data-action=ask]');
    await page.waitFor(`document.querySelector('.note')?.textContent.length > 0`, 3000);
    const fit = requests(root).find((r) => r.kind === 'next-step' && r.step === 'fit');
    assert.ok(fit && fit.text === fitWords, JSON.stringify(requests(root)));
    step(`idea "fit" with the person's words → ${fit.id}.json`);
    await shot('idea-sent');

    // --- library: no "0" marks ---
    await openSheet();
    // A page in the side (Ideas) hides the tool switch: "‹ Back" / "‹ Close" first.
    for (let i = 0; i < 2 && (await page.eval(IN.visible('.page-head > .link'))); i++) await press('.page-head > .link');
    if (!(await page.eval(IN.visible('[data-tool=library]')))) await press('[data-action=sheet]');
    await press('[data-tool=library]');
    await page.waitFor(`!!document.querySelector('.gsl-name, .gsl-empty')`, 10000);
    await sleep(500);
    const counts = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.gsl-chip b')].map(b => b.textContent))`));
    assert.ok(!counts.includes('0'), `a 0 mark is shown: ${counts}`);
    step(`library marks: ${counts.join(', ')} (no 0)`);
    await shot('library');

    // --- library: "Ask my AI to delete it" goes through the same request as everything else ---
    await press(`.gsl-tile[data-path="${UNUSED}"]`);
    await press('.gsl-del');
    await press('.gsl-del-ask');
    await page.waitFor(`!!document.querySelector('.gsl-tag-del')`, 5000);
    const delReq = requests(root).find((r) => r.kind === 'next-step' && r.step === 'delete-files');
    assert.ok(delReq, JSON.stringify(requests(root)));
    assert.deepEqual(delReq.files, ['.studio/next-step.md', UNUSED]);
    assert.ok(lines.includes('studio: next-step delete-files .studio/next-step.md'), lines.join('\n'));
    assert.ok(readFileSync(join(root, UNUSED)).length > 0, 'the editor deleted a file');
    await page.waitFor(IN.visible('.ai-line'), 3000);
    step(`library "ask my AI to delete" → ${delReq.id}.json + next-step.md (file still there)`);
    await shot('library-delete-asked');

    const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
    assert.deepEqual(errors, [], 'page errors');
  } catch (e) {
    console.log(page.logs.slice(-20).join('\n'));
    console.log(lines.join('\n'));
    if (SHOTS) writeFileSync(join(SHOTS, `ai-partner-${tag}-FAIL.png`), await page.screenshot().catch(() => Buffer.alloc(0)));
    throw e;
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const ex of EXAMPLES) {
  for (const layout of ['pc', 'phone']) {
    console.log(`${ex} · ${layout}`);
    await run(ex, layout);
  }
}
console.log('all passed');
