#!/usr/bin/env node
// The first five minutes with a REAL AI: Claude Code or Codex, this checkout's plugin, an empty folder, a newcomer
// who speaks North American English and only does what the screen and the AI say.
//
//   node test/playtest/realagent.mjs                       # Claude Code, then Codex
//   node test/playtest/realagent.mjs --agent claude        # one of them
//   node test/playtest/realagent.mjs --agent codex --codex-sandbox danger-full-access
//   node test/playtest/realagent.mjs --agent codex --codex-network   # workspace-write + local network (the EPERM fix)
//
// What one run does (and times):
//   1. `/arrange` (Claude) or `$arrange` (Codex) in an empty folder. The skill should ask ONCE "3D or 2D" (§0); the
//      newcomer says "3D"; the agent copies the sample and starts the editor; its URL comes from .studio/studio.log.
//   2. The editor opens in a headless Chrome (never the person's own: `open` is replaced on the agent's PATH). With
//      nothing picked, the newcomer types the phrase in the box at the bottom and presses Enter, then watches:
//      request written → "has it" (received) → working → done → the game reloads by itself, new things violet.
//   3. The newcomer drags one thing and presses Save. The agent should ask ONCE how to apply placement.json (§4);
//      the newcomer says "the loader"; the agent applies it.
//   4. Undo AI change: one press, the game's files go back to how they were after step 2; the agent must not redo it.
// When the editor says the AI isn't watching (Codex, or a watch that ended), the newcomer does what it says: types
// "look" in the agent. Every such moment is a stumble in the report.
//
// WHY a separate tool from playtest.mjs: that one plays the editor with no AI at all (fast, no cost, every build).
// This one costs real model usage (about $1-3 a run) and up to 15 minutes, so it runs on purpose, a few times a wave.
// It never fixes anything: it records pictures, one video per agent, the timeline and the whole conversation.
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch, newPage } from '../adapters-2d/cdp.mjs';
import { agentEnv, claudeAgent, codexAgent, fakeOpener, findCodex, newcomerAnswer } from './agents.mjs';
import { shooter, startVideo } from './recorder.mjs';
import { writeRealReport } from './realreport.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(here, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = parseArgs(process.argv.slice(2));
// Local time (the folder name is read by people in this time zone).
const d0 = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const stamp = `${d0.getFullYear()}${p2(d0.getMonth() + 1)}${p2(d0.getDate())}-${p2(d0.getHours())}${p2(d0.getMinutes())}`;
const outRoot = resolve(args.out || join(args.outBase || 'playtest-results', `realagent-${stamp}`));
mkdirSync(outRoot, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'studio-realagent-'));
const gpu = args.gpu !== false && process.platform === 'darwin' ? gpuChrome(work) : null;
if (gpu) process.env.STUDIO_CHROME = gpu;

async function runOne(agentName) {
  const out = join(outRoot, agentName);
  mkdirSync(out, { recursive: true });
  const folder = join(work, `${agentName}-my-first-game`);
  mkdirSync(folder, { recursive: true });
  const opened = join(out, 'browser-open-attempts.txt');
  const env = agentEnv(fakeOpener(join(work, `${agentName}-bin`), opened));
  const T0 = Date.now();
  const deadline = T0 + args.maxMin * 60000;
  const t = () => +((Date.now() - T0) / 1000).toFixed(1);
  const R = { agent: agentName, folder, steps: [], times: {}, questions: [], stumbles: [], timeline: [], shots: [], notes: [] };
  const stumble = (w, text) => { R.stumbles.push({ w, text, s: t() }); console.log(`  ! ${text}`); };
  const mark = (k) => { if (R.times[k] === undefined) R.times[k] = t(); };

  let A;
  if (agentName === 'claude') {
    A = claudeAgent({ cwd: folder, env, pluginDir: PKG, permissionMode: args.claudePermission, model: args.model });
  } else {
    const c = findCodex(join(work, 'npm-cache'));
    if (!c.bin) return { ...R, fatal: `Codex could not run here: ${c.why}` };
    R.notes.push(`codex binary: ${c.bin}${c.version ? ` (${c.version})` : ''}; sandbox ${args.codexSandbox}${args.codexNetwork ? ' + sandbox_workspace_write.network_access=true' : ''}`);
    // --codex-network: the setting the editor's EPERM line and SKILL's trouble table tell a person to use
    // (agent-solid pass 2026-10-17), so a run checks that the advice works end to end.
    const extraArgs = args.codexNetwork ? ['-c', 'sandbox_workspace_write.network_access=true'] : [];
    A = codexAgent({ bin: c.bin, cwd: folder, env, home: join(work, 'codex-home'), pluginDir: PKG, sandbox: args.codexSandbox, extraArgs });
  }
  R.transcript = A.st.log;

  // ---- the conversation loop: answer questions once each, time out, say "look" when the screen says to ----
  let seenTurns = 0;
  let page = null;
  let status = {};
  const phaseQ = (phase) => R.questions.filter((q) => q.phase === phase).length;
  async function drive(phase, until, { maxMs, lookAfterMs = 0, lookWords = 'look' } = {}) {
    const end = Math.min(Date.now() + maxMs, deadline);
    const startedAt = Date.now();
    let looked = false;
    while (Date.now() < end) {
      if (page) await sample();
      // `until` runs on every sample: it also records the moments (has it / working / done) as they happen.
      const reached = await until(status);
      const quiet = !A.st.busy && Date.now() - A.st.idleSince > 2500;
      if (quiet && A.st.turns > seenTurns) {
        seenTurns = A.st.turns;
        const ans = newcomerAnswer(A.st.lastTurnText);
        if (ans && !reached) {
          R.questions.push({ phase, kind: ans.kind, s: t(), text: A.st.lastTurnText.slice(-600), reply: ans.reply });
          console.log(`  ? (${phase}/${ans.kind}) -> ${ans.reply}`);
          A.say(ans.reply);
          continue;
        }
      }
      if (quiet && reached) return true;
      if (A.st.exited) return false;
      // The editor says nobody is watching (or nothing moves for long): do what it says, once per phase.
      if (quiet && lookAfterMs && !looked && Date.now() - startedAt > lookAfterMs && page && ['away', 'sent', 'seen', 'nudge', 'waiting'].includes(status.ph)) {
        looked = true;
        R.notes.push(`${phase}: the editor said "${status.text}" → typed "${lookWords}" in ${agentName} at ${t()} s`);
        if (agentName === 'claude') stumble(2, `${phase}: the watch did not pick it up; the newcomer had to type "${lookWords}" (screen: "${status.text}")`);
        A.say(lookWords);
      }
      await sleep(300);
    }
    return false;
  }
  async function sample() {
    const s = await page.eval(STATUS).then((x) => JSON.parse(x || '{}')).catch(() => ({}));
    const key = `${s.ph}|${s.peer}|${s.frames}|${s.rows}|${(s.marked || []).length}|${s.text}`;
    if (key !== status._key) R.timeline.push({ s: t(), ph: s.ph, peer: s.peer, frames: s.frames, rows: s.rows, marked: (s.marked || []).length, text: s.text });
    status = { ...s, _key: key };
  }

  let browser = null;
  let video = null;
  try {
    // ---- 1. /arrange in an empty folder → one question → 3D → the editor's URL ----
    const cmd = agentName === 'claude' ? '/arrange' : '$arrange';
    A.say(cmd);
    let url = null;
    const findUrl = () => {
      const log = join(folder, '.studio/studio.log');
      const fromLog = existsSync(log) && readFileSync(log, 'utf8').match(/studio: ready (\S+)/);
      if (fromLog) { mark('ready line in .studio/studio.log'); return fromLog[1]; }
      const said = A.st.log.filter((l) => l.who === 'agent').map((l) => l.text).join('\n').match(/https?:\/\/(?:127\.0\.0\.1|localhost)[^\s)>\]`'"]+/);
      return said ? said[0].replace(/[.,;:]+$/, '') : null;
    };
    const ok1 = await drive('start', async () => !!(url = findUrl()), { maxMs: 6 * 60000 });
    mark('agent finished telling the URL');
    R.steps.push({ name: '1. /arrange → one question → 3D sample → editor URL', ok: ok1 && !!url, note: url ? `URL after ${R.times['agent finished telling the URL']} s; questions: ${phaseQ('start')}` : 'no URL' });
    if (phaseQ('start') !== 1) stumble(phaseQ('start') ? 2 : 2, `start: the agent asked ${phaseQ('start')} question(s) before the editor opened (SKILL §0 says exactly one: 3D or 2D)`);
    if (existsSync(opened)) R.notes.push(`tried to open a browser: ${readFileSync(opened, 'utf8').trim().split('\n').length} time(s) (recorded, not opened)`);
    if (!url) { stumble(3, 'start: no editor URL (see transcript)'); return finish(); }
    const watchOn = existsSync(join(folder, '.studio/watch.json'));
    R.notes.push(`after start: watch ${watchOn ? 'running (.studio/watch.json)' : 'not running'}; files: ${listGame(folder).join(', ').slice(0, 300)}`);

    // ---- 2. open the editor like the person (headless), ask in English ----
    browser = await launch();
    page = await newPage(browser, { width: 1280, height: 800 });
    page.onEvent = (m, fn) => browser.on((x) => { if (x.method === m) fn(x.params); });
    await page.send('Emulation.setLocaleOverride', { locale: 'en-US' }).catch(() => {});
    const S = shooter(page, out, agentName);
    R.shots = S.taken;
    video = await startVideo(page, { maxWidth: 1280, maxHeight: 800, minGapMs: 100 });
    const tOpen = Date.now();
    await page.goto(url);
    let opened2 = await page.waitFor(`document.querySelectorAll('li.obj').length > 0`, 60000).then(() => true, () => false);
    R.times['editor page → objects listed (s)'] = +((Date.now() - tOpen) / 1000).toFixed(1);
    if (!opened2) {
      // A person tells the AI once, then opens whatever link it gives next (10/17: Codex's editor stopped with its turn).
      await S.shot('blank', 'The link from the agent: nothing loads');
      stumble(3, `editor: the link from the agent did not load (server reachable: ${await reachable(url)})`);
      const tLog = existsSync(join(folder, '.studio/studio.log')) ? readFileSync(join(folder, '.studio/studio.log'), 'utf8') : '';
      A.say('The link just shows a blank page. Can you check?');
      await A.st.waitIdle(4 * 60000);
      const log2 = existsSync(join(folder, '.studio/studio.log')) ? readFileSync(join(folder, '.studio/studio.log'), 'utf8') : '';
      const said = A.st.log.filter((l) => l.who === 'agent').map((l) => l.text).join('\n').match(/https?:\/\/(?:127\.0\.0\.1|localhost)[^\s)>\]`'"]+/g);
      const url2 = (log2 !== tLog && (log2.match(/studio: ready (\S+)/g) || []).pop()?.slice(14)) || said?.pop()?.replace(/[.,;:]+$/, '') || url;
      R.notes.push(`restart: the agent's next link ${url2 === url ? 'is the same' : 'is new'}; server reachable: ${await reachable(url2)}`);
      const t2 = Date.now();
      await page.goto(url2);
      opened2 = await page.waitFor(`document.querySelectorAll('li.obj').length > 0`, 60000).then(() => true, () => false);
      R.times['second link → objects listed (s)'] = +((Date.now() - t2) / 1000).toFixed(1);
      url = url2;
    }
    await sleep(1500);
    await sample();
    await S.shot('opened', `Editor opened from the agent's URL; AI dot: ${status.peer} ("${status.peerTitle}")`);
    if (!opened2) { stumble(3, 'editor: the game never listed its objects (90 s)'); return finish(); }
    if (agentName === 'claude' && status.peer !== 'live') stumble(2, `editor: right after opening, the AI dot says "${status.peerTitle}" (not watching)`);
    const before = new Set(status.keys || []);
    const lightsBefore = (status.keys || []).filter((k) => /lighthouse/i.test(k)).length;

    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`).catch(() => {});
    const box = await page.eval(`JSON.stringify((() => { const e = document.querySelector('.ask-input'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`).then(JSON.parse);
    if (!box) { stumble(3, 'editor: no box at the bottom to ask in'); return finish(); }
    await page.click(box.x, box.y);
    await sleep(400);
    await page.send('Input.insertText', { text: args.phrase });
    await sleep(500);
    await S.shot('typed', `Typed "${args.phrase}" with nothing picked (whole game)`);
    const S1 = snapshot(folder);
    const tAsk = Date.now();
    const askAt = t();
    await key(page, 'Enter');
    const rel = (k) => { if (R.times[k] === undefined) R.times[k] = +((Date.now() - tAsk) / 1000).toFixed(1); };
    let sawAway = false;
    const ok2 = await drive('ask', async (s) => {
      if (['seen', 'received', 'working'].includes(s.ph)) rel('ask: Enter → "has it" (seen/received)');
      if (s.ph === 'received') rel('ask: Enter → received');
      if (s.ph === 'working') rel('ask: Enter → working');
      if (s.ph === 'away') { if (!sawAway) { sawAway = true; await S.shot('away', `After Enter: "${s.text}"`); } }
      if (s.ph === 'done' || s.ph === 'failed') rel('ask: Enter → done');
      if (s.ph === 'done' && s.frames === 1 && (s.marked || []).length) rel('ask: Enter → reloaded with violet marks');
      return (s.ph === 'done' || s.ph === 'failed') && s.frames === 1;
    }, { maxMs: 7 * 60000, lookAfterMs: agentName === 'claude' ? 45000 : 3000 });
    await sleep(2500);
    await sample();
    const added = (status.keys || []).filter((k) => !before.has(k));
    const lights = (status.keys || []).filter((k) => /lighthouse/i.test(k)).length;
    await S.shot('asked-done', `After the AI: "${status.text}" · violet: ${(status.marked || []).join(', ') || 'none'}`);
    R.steps.push({ name: `2. "${args.phrase}" → has it → working → done → reload, new things violet`, ok: ok2 && status.ph === 'done' && added.length > 0,
      note: `asked at ${askAt} s; line now "${status.text}"; new keys: ${added.join(', ') || 'none'}; lighthouses ${lightsBefore} → ${lights}; violet: ${(status.marked || []).join(', ') || 'none'}` });
    if (ok2 && !(status.marked || []).length) stumble(2, 'ask: after done, nothing is marked violet');
    if (ok2 && !added.length) stumble(2, 'ask: done, but no new object appeared in the list');
    if (phaseQ('ask')) stumble(1, `ask: the agent asked ${phaseQ('ask')} question(s) before doing it`);
    const S2 = snapshot(folder);
    const btn = (sel) => page.eval(`JSON.stringify((() => { const e = [...document.querySelectorAll('${sel}')].find((x) => x.offsetParent); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`).then(JSON.parse);

    // ---- 4. Undo AI change (on the lighthouses), then Redo ----
    // WHY before Save (the brief lists it last): Undo needs an AI change that touched files. A Save in a sample that
    // already reads placement.json changes no file (10/17 run: no Undo button then, rightly). The lighthouses do.
    const ub = await btn('[data-action=ai-undo]');
    let ok4 = false;
    let back = ['(not pressed)'];
    let lightsUndone = null;
    if (!ub) stumble(3, 'undo: no "Undo AI change" button after the lighthouses were done');
    else {
      const tU = Date.now();
      await page.click(ub.x, ub.y);
      ok4 = await page.waitFor(`document.querySelector('.ai-line')?.classList.contains('undone') && document.querySelectorAll('iframe.game').length === 1`, 20000).then(() => true, () => false);
      R.times['undo: press → game back (undone)'] = +((Date.now() - tU) / 1000).toFixed(1);
      await sleep(1500);
      await sample();
      lightsUndone = (status.keys || []).filter((k) => /lighthouse/i.test(k)).length;
      back = diff(S1, snapshot(folder));
      await S.shot('undone', `Pressed Undo AI change: "${status.text}" · lighthouses now ${lightsUndone}`);
      const rb = await btn('[data-action=ai-redo]');
      if (rb) {
        const tR = Date.now();
        await page.click(rb.x, rb.y);
        await page.waitFor(`document.querySelector('.ai-line')?.classList.contains('redone') && document.querySelectorAll('iframe.game').length === 1`, 20000).catch(() => {});
        R.times['redo: press → lighthouses back'] = +((Date.now() - tR) / 1000).toFixed(1);
        await sleep(1500);
        await sample();
        await S.shot('redone', `Pressed Redo: "${status.text}"`);
      } else R.notes.push('undo: no Redo button after Undo');
    }
    const S4 = snapshot(folder);
    // The agent hears about it (Claude: its watch wakes it; Codex: the newcomer types "look") and must not redo it.
    const turns0 = A.st.turns;
    if (agentName === 'codex') A.say('look');
    else {
      const end = Date.now() + 60000;
      while (Date.now() < end && A.st.turns === turns0 && !A.st.busy) await sleep(500);
      if (A.st.turns === turns0 && !A.st.busy) R.notes.push('undo: the agent did not wake up for the undone/redone requests within 60 s');
    }
    await A.st.waitIdle(3 * 60000);
    await sample();
    R.notes.push(`undo: after the agent heard about it: "${status.text}"`);
    const redoByAgent = diff(S4, snapshot(folder));
    R.steps.push({ name: '4. Undo AI change → files back (then Redo), the agent does not touch them', ok: ok4 && !back.length && !redoByAgent.length,
      note: `after Undo, differs from before the ask: ${back.join(', ') || 'nothing'}; lighthouses after Undo ${lightsUndone}; Redo back as after the ask: ${diff(S2, S4).length ? 'no (' + diff(S2, S4).join(', ') + ')' : 'yes'}; changed by the agent afterwards: ${redoByAgent.join(', ') || 'nothing'}` });
    if (back.length && ub) stumble(3, `undo: files not back as before the ask: ${back.join(', ')}`);
    if (redoByAgent.length) stumble(3, `undo: the agent changed files after Undo/Redo: ${redoByAgent.join(', ')}`);

    // ---- 3. move something, Save, the agent applies (asks once how, unless the game already reads placement.json) ----
    const S5 = snapshot(folder);
    const preLoader = Object.keys(S5).some((f) => /\.(m?js|html)$/.test(f) && /applyPlacement|placement\.json/.test(readFileSync(join(folder, f), 'utf8')) && !/studio-placement\.js$/.test(f));
    const picked = await pickAndDrag(page);
    await S.shot('moved', picked ? `Dragged "${picked}"` : 'Could not pick anything to drag');
    if (!picked) stumble(2, 'save: could not pick and drag an object');
    const save = await btn('[data-action=save]');
    const tSave = Date.now();
    if (save) await page.click(save.x, save.y);
    await sleep(800);
    await S.shot('saved', `Pressed Save: "${(await sample(), status.text)}"`);
    const relS = (k) => { if (R.times[k] === undefined) R.times[k] = +((Date.now() - tSave) / 1000).toFixed(1); };
    const ok3 = await drive('save', async (s) => {
      if (['seen', 'received', 'working'].includes(s.ph)) relS('save: Save → "has it"');
      if (s.ph === 'done' || s.ph === 'failed') relS('save: Save → done');
      return (s.ph === 'done' || s.ph === 'failed') && s.frames === 1;
    }, { maxMs: 6 * 60000, lookAfterMs: agentName === 'claude' ? 45000 : 3000 });
    await sleep(2000);
    await sample();
    const changed3 = diff(S5, snapshot(folder));
    await S.shot('applied', `After applying: "${status.text}"`);
    // A sample already reads placement.json: not asking is right, asking once is still what SKILL §4 says (10/17:
    // Claude did not ask, Codex asked once). Only more than once, or none for a game without a loader, is wrong.
    const qOk = preLoader ? phaseQ('save') <= 1 : phaseQ('save') === 1;
    R.steps.push({ name: `3. Save → the agent applies it (asks once how${preLoader ? '; the game already reads placement.json, so 0 or 1 questions' : ''})`, ok: ok3 && status.ph === 'done' && qOk,
      note: `questions: ${phaseQ('save')} (${R.questions.filter((q) => q.phase === 'save').map((q) => q.kind).join(', ')}); game already read placement.json: ${preLoader}; files changed: ${changed3.join(', ') || 'none'}; line "${status.text}"` });
    if (!qOk) stumble(2, `save: the agent asked ${phaseQ('save')} time(s) how to apply (expected ${preLoader ? '0 or 1' : '1'})`);
    else if (preLoader && phaseQ('save')) stumble(1, 'save: asked how to apply although the sample already reads placement.json');
    await S.shot('end', `End: "${(await sample(), status.text)}"`);

    // ---- wrap up like a person ----
    A.say("That's all for now, thanks! You can stop the editor.");
    await A.st.waitIdle(90000);
    return finish();
  } catch (e) {
    // Keep what was recorded (the conversation above all) when the script itself breaks.
    R.fatal = e.stack || String(e);
    return R;
  } finally {
    if (video) R.video = await video.stop(join(out, `${agentName}.mp4`)).catch((e) => ({ error: e.message }));
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await A.stop();
    // How the agent stopped the editor (10/17: Claude's `pkill -f` pattern also stopped another editor on the machine).
    const tools = A.st.log.filter((l) => l.who === 'tool').map((l) => String(l.text));
    const byName = tools.filter((x) => /\b(pkill|killall)\b|pgrep[^\n]*\|\s*xargs\s+kill/.test(x));
    if (byName.length) stumble(1, `stopped processes by name: ${byName.map((x) => x.slice(0, 120)).join(' | ')}`);
    R.notes.push(`stopped with --stop: ${tools.some((x) => /studio\.mjs[^\n]*--stop\b/.test(x)) ? 'yes' : 'no'}; started with --detach: ${tools.some((x) => /studio\.mjs[^\n]*--detach\b/.test(x)) ? 'yes' : 'no'}`);
    R.leftover = killUnder(folder);
    R.cost = A.st.cost;
    R.toolCalls = A.st.log.filter((l) => l.who === 'tool').length;
    R.total = t();
  }

  function finish() {
    const passed = R.steps.filter((s) => s.ok).length;
    R.verdict = `${passed}/4 steps passed in ${t()} s; ${R.questions.length} question(s); ${R.stumbles.length} stumble(s)`;
    return R;
  }
}

// ---- page helpers ----

const STATUS = `JSON.stringify((() => { const q = (s) => document.querySelector(s); const line = q('.ai-line');
  const f = q('iframe.game:not(.gone)') || q('iframe'); let keys = [];
  try { keys = f?.contentWindow?.__gameStudio?._debug?.list?.().map((i) => i.key) || []; } catch {}
  return { ph: line ? line.className.replace('ai-line', '').trim() : '', text: line && !line.hidden ? line.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) : '',
    peer: q('.peer')?.dataset.state, peerTitle: q('.peer')?.title || '', frames: document.querySelectorAll('iframe.game').length,
    rows: document.querySelectorAll('li.obj').length, keys,
    marked: [...document.querySelectorAll('li.obj')].filter((r) => r.querySelector(':scope > .tag.ai')).map((r) => r.dataset.group ? 'group:' + r.dataset.group : r.dataset.key) }; })())`;

async function key(page, k) {
  const down = { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : 27 };
  if (k === 'Enter') down.text = '\r';
  await page.send('Input.dispatchKeyEvent', down);
  await page.send('Input.dispatchKeyEvent', { ...down, type: 'keyUp', text: undefined });
}

/** Press a mid-sized object that the game shows (not under a panel) and drag it a little. Returns its name. */
async function pickAndDrag(page) {
  const items = JSON.parse(await page.eval(`JSON.stringify((() => { const f = document.querySelector('iframe.game:not(.gone)') || document.querySelector('iframe'); const o = f.getBoundingClientRect(); const d = f.contentWindow.__gameStudio._debug;
    return d.list().map((i) => { const a = d.anchor(i.key); if (!a) return null; const r = a.rect; const x = o.left + (r ? r.x + r.w / 2 : a.center[0]), y = o.top + (r ? r.y + r.h / 2 : a.center[1]);
      return { key: i.key, label: i.label, x, y, w: r?.w || a.size, free: document.elementFromPoint(x, y) === f, unstable: !!i.unstable }; }).filter(Boolean); })())`).catch(() => '[]'));
  const c = items.filter((i) => i.free && i.w > 20 && i.w < 300 && !i.unstable).sort((a, b) => Math.abs(a.w - 90) - Math.abs(b.w - 90))[0];
  if (!c) return null;
  await page.click(c.x, c.y);
  await sleep(600);
  await page.mouseDrag(c.x, c.y, c.x + 80, c.y + 30, 12);
  await sleep(600);
  return c.label || c.key;
}

async function reachable(u) {
  try { const r = await fetch(u, { signal: AbortSignal.timeout(3000) }); return `yes (${r.status})`; } catch (e) { return `no (${e.cause?.code || e.name})`; }
}

// ---- files ----

/** Hashes of the game's own files (what Undo AI change restores): not .studio/, not the person's saved files. */
function snapshot(root) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n === '.studio' || n === 'node_modules' || n === '.git') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (!/^(placement|library)\.json$/.test(n)) out[relative(root, p)] = createHash('md5').update(readFileSync(p)).digest('hex');
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}
const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const listGame = (root) => Object.keys(snapshot(root)).sort();

/** Stop every process still running from the play test's folder (the editor, a watch), and say which. */
function killUnder(folder) {
  let ps = '';
  try { ps = execSync('ps -ax -o pid=,command=', { encoding: 'utf8' }); } catch { return []; }
  const left = ps.split('\n').filter((l) => l.includes(folder)).map((l) => l.trim());
  for (const l of left) { try { process.kill(Number(l.split(' ')[0]), 'SIGTERM'); } catch { /* gone */ } }
  return left.map((l) => l.replace(/^\d+\s+/, '').slice(0, 200));
}

/** macOS: a wrapper that runs the same headless Chrome on the GPU (Metal) instead of SwiftShader (3D at ~1 fps). */
function gpuChrome(dir) {
  const bin = findChrome();
  if (!bin) return null;
  const f = join(dir, 'chrome-gpu.sh');
  writeFileSync(f, `#!/bin/bash\nargs=()\nfor a in "$@"; do case "$a" in --use-angle=swiftshader|--enable-unsafe-swiftshader) ;; *) args+=("$a");; esac; done\nexec '${bin}' "\${args[@]}" --use-angle=metal\n`, { mode: 0o755 });
  return f;
}

function parseArgs(a) {
  const o = { agents: [], phrase: 'Add three lighthouses around the island', maxMin: 15, claudePermission: 'auto', codexSandbox: 'workspace-write' };
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v === '--agent') o.agents.push(...a[++i].split(','));
    else if (v === '--phrase') o.phrase = a[++i];
    else if (v === '--out') o.out = a[++i];
    else if (v === '--out-base') o.outBase = a[++i];
    else if (v === '--max-min') o.maxMin = Number(a[++i]);
    else if (v === '--model') o.model = a[++i];
    else if (v === '--claude-permission') o.claudePermission = a[++i];
    else if (v === '--codex-sandbox') o.codexSandbox = a[++i];
    else if (v === '--codex-network') o.codexNetwork = true;
    else if (v === '--no-gpu') o.gpu = false;
    else if (v === '-h' || v === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8).join('\n')); process.exit(0); }
    else throw new Error(`unknown option ${v}`);
  }
  if (!o.agents.length) o.agents = ['claude', 'codex'];
  return o;
}

// Run last: the helpers and constants above are `const`s, not hoisted.
const results = [];
for (const agent of args.agents) {
  console.log(`\n=== ${agent} ===`);
  const r = await runOne(agent).catch((e) => ({ agent, fatal: e.stack || String(e) }));
  results.push(r);
  writeRealReport(join(outRoot, agent), r);
  console.log(r.fatal ? `  fatal: ${r.fatal.split('\n')[0]}` : `  ${r.verdict}`);
}
writeFileSync(join(outRoot, 'results.json'), JSON.stringify(results.map(({ transcript, ...r }) => r), null, 2));
console.log(`\nreports: ${outRoot}/<agent>/report.md`);
