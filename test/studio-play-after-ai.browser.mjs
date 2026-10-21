// Play after an AI change keeps the unsaved moves (a try of the editor, 2026-10-21, v0.1.7, a game of their own without the loader: "I moved
// objects, then asked the AI for something, then pressed Play: only what I asked the AI for showed, the moves did not. But
// the editor still shows the objects where I moved them, so the two disagree").
//
// Each case moves the lighthouse WITHOUT saving, asks the AI (a stand-in agent, test/ai-feel/fake-agent.mjs, that does
// what the arrange skill says with the CLI) for a change, waits for the editor's own reload after "done", then presses
// Play and goes back to Edit, comparing the game with the editor each time:
//
//   bare        Lantern Cove without its loader line (a game that does not read placement.json).
//               The AI changes ANOTHER object (the boat's hull colour). Play and Edit: the move AND the AI's colour.
//   loader      the same with the loader (the game reads the draft itself)
//   cleared     bare, and the AI also deletes placement.json (the editor's draft) while it works: Play must still show the
//               move (the case of that try: before the fix, the editor showed the move and Play did not)
//   same        bare, and the AI moves the SAME object in the code (the lighthouse to another headland): the person's
//               move wins on screen, in Play too, and the lighthouse carries the AI's violet mark (the AI changed it)
//   save        bare, after the AI change: Undo AI change puts the colour back and the move stays, then Save hands the move
//               over (one `saved` request, placement.json with `was` = the code's pose)
//
//   node test/studio-play-after-ai.browser.mjs [--shots <dir>] [--only bare,loader,cleared,same,save] [--ui <a built studio-ui folder>]
// Exit 1 on failure.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startFakeAgent } from './ai-feel/fake-agent.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const ONLY = opt('--only') ? opt('--only').split(',') : null;
const UI_DIR = opt('--ui') ? resolve(opt('--ui')) : join(PKG, 'skills/arrange/bin/studio-ui');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GAME = `document.querySelector('iframe.game:not(.leaving)')?.contentWindow`;
const EDIT_READY = `document.querySelectorAll('.obj, .noname').length > 0 && !!${GAME}?.__gameStudio?._debug && document.querySelectorAll('iframe.game').length === 1`;
const THREE_LIST = `(() => { const out = []; for (const s of ${GAME}.__studioThree?.scenes || []) s.traverse((o) => { const k = o.userData?.studioKey;
  if (k && o.visible) out.push({ key: k, pose: { p: [o.position.x, o.position.y, o.position.z] } }); }); return out; })()`;
const PLAY_READY = `!!${GAME}?.__gameStudio && !${GAME}.__gameStudio._debug && ((${GAME}.__gameStudio._play?.list() || ${THREE_LIST}) || []).length > 0`;
const LIST = `JSON.stringify(${GAME}.__gameStudio._debug ? ${GAME}.__gameStudio._debug.list() : (${GAME}.__gameStudio._play?.list() || ${THREE_LIST}))`;
// The boat's hull colour as the running game draws it (the AI's change in the "bare" and "loader" cases): the colours of
// the materials with the hull's roughness (0.55, only the hull's in Lantern Cove).
const HULL = `(() => { const seen = new Set(); for (const s of ${GAME}?.__studioThree?.scenes || []) s.traverse((o) => { const m = o.isMesh && o.material;
  if (m?.color && Math.abs(m.roughness - 0.55) < 1e-6 && !m.metalness) seen.add(m.color.getHexString()); });
  return seen.size ? [...seen].join(',') : 'none of ' + (${GAME}?.__studioThree?.scenes || []).length + ' scenes'; })()`;
// The one Save, beside ▶ Play (2026-10-21; it was the Save in the game's corner, [data-part=save-fab], until then).
const FAB = `(() => { const f = document.querySelector('[data-part=save]'); return f && !f.hidden && f.offsetParent ? f.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`;
// The rows with the AI's violet tag (as studio-ai-feel reads them).
const MARKED = `JSON.stringify([...document.querySelectorAll('li.obj')].filter((r) => r.querySelector(':scope > .tag.ai')).map((r) => r.dataset.key))`;
const PLAY_BTN = `(() => { const b = [...document.querySelectorAll('[data-action=play]')].find((x) => x.offsetParent && x.getBoundingClientRect().width); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`;

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};
const close = (a, b, d) => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < d);

function gameFolder(bare) {
  const root = mkdtempSync(join(tmpdir(), 'play-after-ai-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  if (bare) {
    const p = join(root, 'js/main.js');
    const s = readFileSync(p, 'utf8');
    if (!/await applyPlacement\([^)]*\);/.test(s)) throw new Error('no applyPlacement line to take out');
    writeFileSync(p, s.replace(/await applyPlacement\([^)]*\);/g, '/* no loader (test) */'));
  }
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'en' }));
  return root;
}
function edit(file, from, to) {
  const s = readFileSync(file, 'utf8');
  if (!s.includes(from)) throw new Error(`"${from}" not found in ${file}`);
  writeFileSync(file, s.replace(from, to));
}
/** The AI's change: another object's colour (the boat's hull), or the lighthouse moved to another headland in the code. */
const plans = (root) => ({
  colour: { working: 'Making the boat lighter', done: 'Made the boat lighter', changed: 1,
    steps: [() => edit(join(root, 'js/props.js'), 'hullBlue: std(0x2d4b63, 0.55)', 'hullBlue: std(0x5a8fbf, 0.55)')] },
  // The AI changes the colour and takes the editor's draft away (a real agent may tidy placement.json up — the skill
  // tells it to remove what it applied, and to delete the file when it is empty). The editor's "nothing new to write"
  // test compared with what IT wrote last, so before this fix Play then read no draft at all.
  colourClear: { working: 'Making the boat lighter', done: 'Made the boat lighter', changed: 1,
    steps: [() => edit(join(root, 'js/props.js'), 'hullBlue: std(0x2d4b63, 0.55)', 'hullBlue: std(0x5a8fbf, 0.55)'), () => rmSync(join(root, 'placement.json'), { force: true })] },
  lighthouse: { working: 'Moving the lighthouse', done: 'Moved the lighthouse to the north headland', changed: 1,
    steps: [() => edit(join(root, 'js/props.js'), "prop('lighthouse', -24, -20, { ground: true })", "prop('lighthouse', -24, -12, { ground: true })")] },
});

const browser = await launch();
let srv = null;
const roots = [];
const want = (name) => !ONLY || ONLY.includes(name);

async function run(name, { bare, plan: planName, extra }) {
  console.log(name);
  const root = gameFolder(bare);
  roots.push(root);
  if (srv) await srv.close?.();
  srv = await startStudioServer({ root, uiDir: UI_DIR, log: () => {} });
  const page = await newPage(browser, { width: 1280, height: 800, mobile: false });
  let agent = null;
  let n = 0;
  const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${name}-${++n}-${what}.png`), await page.screenshot());
  const list = async () => JSON.parse((await page.eval(LIST).catch(() => '[]')) || '[]');
  const poseOf = async (k) => (await list()).find((i) => i.key === k)?.pose?.p || null;
  const until = async (fn, ms = 8000) => {
    const t0 = Date.now();
    for (;;) {
      if (await fn().catch(() => false)) return true;
      if (Date.now() - t0 > ms) return false;
      await sleep(200);
    }
  };
  const togglePlay = async () => {
    const b = JSON.parse((await page.eval(PLAY_BTN)) || 'null');
    if (b) await page.click(b.x, b.y);
    else await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }))`);
    // ▶ Play with changes not saved asks first (unsaved-guard.ts kind 'play', 2026-10-21): this case is "Play without
    // saving", so Try without saving.
    const tr = await until(async () => !!(await page.eval(`document.querySelector('[data-part=unsaved-guard][data-kind=play]:not([hidden])')`)), 2000);
    if (tr) await page.eval(`document.querySelector('[data-part=unsaved-guard] [data-action=guard-discard]').click(), true`);
  };
  const cardX = async () => parseFloat(await page.eval(`document.querySelector('[data-part=card] .fields input')?.value`));
  try {
    await page.goto(srv.url);
    await page.waitFor(EDIT_READY, 40000);
    await sleep(1200);
    // 1. Move the lighthouse with the card (one change, not saved).
    const start = await poseOf('lighthouse');
    await page.eval(`studioShell.actions.select('lighthouse')`);
    await sleep(700);
    check(await page.eval(`(() => { const i = document.querySelector('[data-part=card] .fields input'); if (!i) return false;
      i.value = String((parseFloat(i.value) || 0) + 6); i.dispatchEvent(new Event('change')); return true; })()`), 'moved the lighthouse with the card');
    const moved = [start[0] + 6, ...start.slice(1)];
    check(await until(async () => close(await poseOf('lighthouse'), moved, 0.06) || Math.abs((await cardX()) - moved[0]) < 0.06, 10000), `lighthouse ${start} → ${moved}`);
    const fab = await page.eval(FAB);
    check(/\d/.test(fab), `not saved ("${fab}")`);
    await sleep(900); // the draft is written ~0.7 s after the last change
    await shot('moved');

    // 2. Ask the AI (with nothing picked: about the whole game), the stand-in changes the code, the editor reloads.
    const plan = plans(root)[planName];
    agent = startFakeAgent(root, { plan });
    await page.eval(`studioShell.actions.select(null)`).catch(() => undefined);
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); i.value = ${JSON.stringify(plan.working)};
      i.dispatchEvent(new Event('input', { bubbles: true })); i.form ? i.form.requestSubmit() : i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    check(await until(async () => (await page.eval(`document.querySelector('.ai-line')?.classList.contains('done')`)) && (await page.eval(EDIT_READY)), 30000), 'the AI finished and the editor reloaded the game');
    await sleep(1500);
    // Where the lighthouse must stand from here on: the person's move, also when the AI moved it in the code ("same").
    const stand = moved;
    check(await until(async () => close(await poseOf('lighthouse'), stand, 0.06)), `after the AI: the editor shows the move (${await poseOf('lighthouse')})`);
    const fab1 = await page.eval(FAB);
    check(fab1 === fab, `after the AI: still not saved ("${fab1}")`);
    const marked = JSON.parse(await page.eval(MARKED));
    if (planName === 'lighthouse') check(marked.includes('lighthouse'), `the AI's violet mark on the lighthouse it moved (${marked})`);
    else check(!marked.includes('lighthouse'), `no violet mark on the lighthouse the AI did not touch (${marked})`);
    if (planName.startsWith('colour')) check((await page.eval(HULL)).includes('5a8fbf'), `after the AI: the new hull colour (${await page.eval(HULL)})`);
    await shot('after-ai');

    // 3. Play: the same as the editor (the move AND the AI's change).
    await togglePlay();
    await page.waitFor(PLAY_READY, 40000);
    check(await until(async () => close(await poseOf('lighthouse'), stand, 0.06)), `Play: the move is there (${await poseOf('lighthouse')})`);
    if (planName.startsWith('colour')) check((await page.eval(HULL)).includes('5a8fbf'), `Play: the AI's colour is there (${await page.eval(HULL)})`);
    await sleep(800);
    await shot('play');

    // 4. Back to Edit: still the same.
    await togglePlay();
    await page.waitFor(EDIT_READY, 40000);
    check(await until(async () => close(await poseOf('lighthouse'), stand, 0.06) && Math.abs((await cardX().catch(() => NaN)) - stand[0]) < 0.06 || close(await poseOf('lighthouse'), stand, 0.06)),
      `back to Edit: the move is there (${await poseOf('lighthouse')})`);
    check((await page.eval(FAB)) === fab, `back to Edit: "${await page.eval(FAB)}" as before`);
    await sleep(500);
    await shot('edit-back');
    if (extra) await extra({ page, root, poseOf, until, moved, start, shot });
  } catch (e) {
    check(false, `${name}: ${e.stack || e.message}`);
  } finally {
    await agent?.stop();
    await page.close();
  }
}

try {
  if (want('bare')) await run('bare', { bare: true, plan: 'colour' });
  if (want('loader')) await run('loader', { bare: false, plan: 'colour' });
  if (want('cleared')) await run('cleared', { bare: true, plan: 'colourClear' });
  if (want('same')) await run('same', { bare: true, plan: 'lighthouse' });
  if (want('save')) {
    await run('save', { bare: true, plan: 'colour', extra: async ({ page, root, poseOf, until, moved }) => {
      // Undo AI change first (a Save is a new request: the AI's last change is history after it, as before this fix).
      // The AI's line may have faded by now: "● AI" brings it back with its "Undo AI change".
      const undoBtn = `document.querySelector('[data-action=ai-undo]')`;
      if (!(await page.eval(`!!${undoBtn}`))) await page.eval(`document.querySelector('[data-part=peer]')?.click()`);
      check(await until(async () => page.eval(`!!${undoBtn}`), 4000), 'Undo AI change offered');
      await page.eval(`${undoBtn}?.click()`);
      check(await until(async () => readFileSync(join(root, 'js/props.js'), 'utf8').includes('0x2d4b63'), 10000), 'Undo AI change: the code is back');
      check(await until(async () => (await page.eval(EDIT_READY)) && (await page.eval(HULL)).includes('2d4b63'), 20000), `Undo AI change: the old colour (${await page.eval(HULL)})`);
      check(await until(async () => close(await poseOf('lighthouse'), moved, 0.06)), `Undo AI change: the move stays (${await poseOf('lighthouse')})`);
      check(/\d/.test(await page.eval(FAB)), `Undo AI change: still not saved ("${await page.eval(FAB)}")`);
      // Save: the move goes to the AI with the code's pose as `was`, one request.
      await page.eval(`studioShell.actions.save()`);
      await sleep(1500);
      const file = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      const e = file.objects?.lighthouse;
      check(!!e && Math.abs(e.p[0] - moved[0]) < 0.05 && Math.abs(e.was.p[0] - (moved[0] - 6)) < 0.05, `Save: placement.json has the move and the code's pose (${JSON.stringify(e)})`);
      const reqs = readdirSync(join(root, '.studio/requests')).filter((f) => f.endsWith('.json'));
      const saved = reqs.map((f) => JSON.parse(readFileSync(join(root, '.studio/requests', f), 'utf8'))).filter((r) => r.kind === 'saved');
      check(saved.length === 1, `Save: one "saved" request for the AI (${saved.length})`);
      check(!/\d/.test(await page.eval(FAB)), `Save: no count left ("${await page.eval(FAB)}")`);
    } });
  }
} finally {
  await browser.close?.();
  await srv?.close?.();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
