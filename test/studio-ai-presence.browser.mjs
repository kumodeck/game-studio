// Is the AI there, said next to the ask field before typing (ai presence, a hands-on review 2026-10-23), in a headless browser:
// the real local server, the built editor and the stand-in agent (test/ai-feel/fake-agent.mjs) for Claude.
//
//   node test/studio-ai-presence.browser.mjs [--lang ja] [--theme light|dark] [--shots <dir>]
//   node test/studio-ai-presence.browser.mjs --ui <an older studio-ui folder> --before --shots <dir>   (photos only)
//
// Checks (three-crates, PC 1280×800, the editor started "from Claude Code"):
// 1. Opened with no heartbeat: "Not sure Claude is open · How to open" inside the field, no green dot, no "● AI" in
//    the top bar, and the placeholder says the other half ("kept as a note for Claude").
// 2. The words open one line of what to do (Claude Code in this game's folder), and it closes.
// 3. Sent with nobody watching: the fact — "Kept as a note for Claude. Nothing in the game changes until Claude reads
//    it." — with what was asked under it and "How to open"; no "Call your AI", no promise ("next time").
// 4. Claude starts watching (the stand-in's watch): "● Claude is watching" with a green dot; the kept note is picked
//    up: "Claude is on it" (or its own words) → "Done"-line with its note.
// 5. Claude goes away (the watch ends) and stays away a minute: "Claude isn't watching · How to open", no dot.
// 6. A narrow window (the side window, 420 wide): the words move to their own line above the field, whole.
// --before: the same steps on an older build, only the photos (for the before / after picture).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startFakeAgent } from './ai-feel/fake-agent.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const has = (flag) => {
  const i = args.indexOf(flag);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const shotsArg = take('--shots');
const SHOTS = shotsArg ? resolve(shotsArg) : null;
const LANG = take('--lang', 'en');
const THEME = take('--theme', 'dark');
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const BEFORE = has('--before');
// The presence's "isn't watching" waits this long after the heartbeat stops (ai-presence.ts AWAY_AFTER_MS, written
// out: plain node cannot import .ts), plus the heartbeat's own 5 s and a poll.
const AWAY_AFTER_MS = 60_000;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');
const READY = `document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe')?.contentWindow?.__gameStudio?._debug`;
const STATE = `JSON.stringify((() => { const p = document.querySelector('.presence'); const l = document.querySelector('.ai-line');
  return { p: p ? { state: p.dataset.state, text: p.textContent, dot: getComputedStyle(p.querySelector('.dot')).display !== 'none',
    inField: !!p.closest('.ask-box'), row: !!p.closest('.presence-row') } : null,
    peer: !!document.querySelector('[data-part=peer]'), ph: document.querySelector('.ask-input')?.placeholder,
    line: l && !l.hidden ? l.textContent : '', lineCls: l?.className, help: document.querySelector('.ai-open-help:not([hidden])')?.textContent || '' }; })())`;

const rect = (sel) => `JSON.stringify((() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`;
async function press(page, sel) {
  const p = await j(page, rect(sel));
  assert.ok(p, `nothing visible for ${sel}`);
  await page.click(p.x, p.y);
}
async function enter(page) {
  const down = { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' };
  await page.send('Input.dispatchKeyEvent', down);
  await page.send('Input.dispatchKeyEvent', { ...down, type: 'keyUp', text: undefined });
}

const root = mkdtempSync(join(tmpdir(), 'studio-ai-presence-'));
cpSync(join(PKG, 'examples/three-crates'), root, { recursive: true });
for (const f of ['placement.json', '.studio/requests', '.studio/status.json', '.studio/watch.json', '.studio/undo']) rmSync(join(root, f), { recursive: true, force: true });
mkdirSync(join(root, '.studio/ui'), { recursive: true });
writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme: THEME }));

// "Started from Claude Code" without the plugin's hook: the name is Claude, and nothing watches until the stand-in starts.
const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: { CLAUDECODE: '1' } });
const browser = await launch();
const page = await newPage(browser, { width: 1280, height: 800 });
let agent = null;
const tag = `${BEFORE ? 'before' : 'after'}-${LANG}-${THEME}`;
let n = 0;
const shot = async (name) => {
  n++;
  if (!SHOTS) return;
  await sleep(400);
  writeFileSync(join(SHOTS, `${tag}-${n}-${name}.png`), await page.screenshot());
};
const ok = (s) => console.log(`  ✓ ${tag}: ${s}`);
const check = (fn) => {
  if (!BEFORE) fn();
};
const ja = LANG === 'ja';
try {
  await page.goto(srv.url);
  await page.waitFor(READY, 90000);
  await sleep(1500);

  // ---- 1. opened, no heartbeat ever: not sure ----
  let s = await j(page, STATE);
  await shot('open');
  check(() => {
    assert.equal(s.peer, false, 'no "● AI" in the top bar');
    assert.equal(s.p?.state, 'unsure');
    assert.match(s.p.text, ja ? /Claude が開いているか分かりません.*開き方/ : /Not sure Claude is open.*How to open/);
    assert.equal(s.p.dot, false, 'no green without proof');
    assert.equal(s.p.inField, true, 'inside the field on a wide bar');
    assert.match(s.ph, ja ? /Claude へのメモを書く/ : /Write a note for Claude/);
    ok('opened: "not sure", no dot, the placeholder says it is a note');
  });
  if (!BEFORE) {
    // The placeholder is never cut by the words beside it (or the words went above).
    const cut = await page.eval(`(() => { const i = document.querySelector('.ask-input'); const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(i).font; return c.measureText(i.placeholder).width > i.clientWidth + 1; })()`);
    assert.equal(cut, false, 'the placeholder fits');
  }

  // ---- 2. the words open one line of what to do ----
  if (!BEFORE) {
    await press(page, '.presence');
    await page.waitFor(`!!document.querySelector('.ai-open-help:not([hidden])')`, 3000);
    s = await j(page, STATE);
    assert.match(s.help, ja ? /このゲームのフォルダで Claude Code/ : /If Claude Code is open in this game’s folder/);
    await shot('how-to-open');
    await press(page, '[data-action=ai-open-close]');
    await page.waitFor(`!document.querySelector('.ai-open-help:not([hidden])')`, 3000);
    ok('"How to open": one line, and it closes');
  }

  // ---- 3. sent with nobody watching: the fact ----
  await press(page, '.ask-input');
  await page.send('Input.insertText', { text: ja ? '木箱を 3 つ並べて' : 'Add three crates in a row' });
  await enter(page);
  await page.waitFor(`document.querySelector('.ai-line')?.classList.contains('away') || document.querySelector('.ai-line')?.classList.contains('nudge')`, 5000);
  await sleep(600);
  s = await j(page, STATE);
  await shot('sent-nobody');
  check(() => {
    assert.match(s.line, ja ? /Claude へのメモとして残しました。Claude が読むまでゲームは変わりません。/ : /Kept as a note for Claude\. Nothing in the game changes until Claude reads it\./);
    assert.match(s.line, ja ? /木箱を 3 つ並べて/ : /Add three crates in a row/, 'what was asked, under it');
    assert.doesNotMatch(s.line, /next time|次に動いた|Call your AI|AI を呼ぶ/);
    assert.match(s.p.text, ja ? /開き方/ : /How to open/, '"How to open" right under it');
    ok('sent with nobody there: the fact, what was asked, "How to open" under it');
  });
  if (!BEFORE) {
    const cut = await page.eval(`(() => { const e = document.querySelector('.ai-line .ai-head'); return e.scrollWidth > e.clientWidth + 1; })()`);
    assert.equal(cut, false, 'the kept-note sentence is never cut with "…"');
  }

  // ---- 4. Claude starts watching; the note is picked up ----
  agent = startFakeAgent(root, { slow: true });
  await page.waitFor(`/received|working|seen|sent/.test(document.querySelector('.ai-line')?.className || '')`, 20000);
  await sleep(300);
  s = await j(page, STATE);
  await shot('on-it');
  check(() => {
    assert.ok(['watching', 'working'].includes(s.p.state), `green while it has it: ${s.p.state}`);
    assert.equal(s.p.dot, true);
    ok(`picked up: "${s.line.slice(0, 60)}"`);
  });
  await page.waitFor(`document.querySelector('.ai-line')?.classList.contains('done') || document.querySelector('.ai-line')?.classList.contains('updating')`, 30000);
  await page.waitFor(`document.querySelector('.ai-line')?.classList.contains('done')`, 30000);
  await sleep(600);
  await shot('done');
  await page.waitFor(`!!document.querySelector('.presence[data-state=watching]') || ${BEFORE}`, 15000);
  await sleep(11000); // the finished line fades (line-fade.ts LINE_MAX_MS): the field alone, Claude watching
  s = await j(page, STATE);
  await shot('watching');
  check(() => {
    assert.equal(s.p.state, 'watching');
    assert.match(s.p.text, ja ? /Claude が見ています/ : /Claude is watching/);
    assert.equal(s.p.dot, true);
    assert.match(s.ph, ja ? /Claude にゲームの直しを頼む/ : /Ask Claude to change the game/);
    ok('watching: "● Claude is watching", the placeholder names Claude');
  });

  // ---- 5. Claude goes away and stays away ----
  await agent.stop();
  agent = null;
  if (!BEFORE) {
    await sleep(8000);
    s = await j(page, STATE);
    assert.equal(s.p.state, 'unsure', 'within the grace: not sure, never "watching" and not yet "away"');
    assert.equal(s.p.dot, false);
  }
  await sleep(AWAY_AFTER_MS);
  if (!BEFORE) await page.waitFor(`!!document.querySelector('.presence[data-state=away]')`, 15000);
  s = await j(page, STATE);
  await shot('away');
  check(() => {
    assert.match(s.p.text, ja ? /Claude が見ていません.*開き方/ : /Claude isn’t watching.*How to open/);
    assert.equal(s.p.dot, false);
    ok('gone a minute: "Claude isn\'t watching · How to open", no dot');
  });

  // ---- 6. a narrow window: the words on their own line above the field ----
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(1500);
  s = await j(page, STATE);
  await shot('narrow');
  check(() => {
    assert.equal(s.p.row, true, 'above the field');
    ok('narrow: the words above the field');
  });
  if (!BEFORE) {
    const clipped = await page.eval(`(() => { const p = document.querySelector('.presence'); return p.scrollWidth > p.clientWidth + 1; })()`);
    assert.equal(clipped, false, 'the words are never cut');
    const phCut = await page.eval(`(() => { const i = document.querySelector('.ask-input'); const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(i).font; return c.measureText(i.placeholder).width > i.clientWidth + 1; })()`);
    assert.equal(phCut, false, 'the placeholder fits on a narrow bar too');
  }
  console.log(`studio-ai-presence: ${BEFORE ? 'photos taken' : 'all passed'} (${tag})`);
} catch (e) {
  console.error(`  ✗ ${tag}: ${e.stack || e.message}`);
  process.exitCode = 1;
} finally {
  if (agent) await agent.stop();
  await browser.close?.();
  await srv.close?.();
  rmSync(root, { recursive: true, force: true });
}
