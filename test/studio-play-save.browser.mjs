// Plan step 6 "the corner while playing, and what Save says" (2026-10-23), in a headless
// browser: the real local server, the built editor, test/neon-run and the stand-in AI (test/ai-feel/fake-agent.mjs).
//
//   save   (the AI watching) move gate, ship, ring, orb and a hex → Save: "Saved: moved gate · moved ship · moved ring
//          · 2 more" + "Claude is putting it in the code…" → the AI is done: "✓ In the game (5)" with ▶ Play.
//   noai   (nobody watching) the same Save: "Saved. Claude puts it in the code when it opens" — never "putting it in".
//   play   a move not saved → ▶ Play: the window is the title and three buttons, no line about the AI → Try without
//          saving → the corner has ONE button, "❚❚ Pause and talk P" (no ✦ mark) → P: "Paused · Claude sees this
//          moment", the field "Ask Claude about this moment…", Move and "▶ Resume P" → a message gets the stand-in's
//          reply → P resumes → ? lists ` as "Ask Claude without pausing".
//
//   node test/studio-play-save.browser.mjs [--only save,noai,play] [--lang en|ja] [--shots <dir>] [--prefix after]
//                                          [--ui <studio-ui dir>] [--before] [--theme dark|light]
// --before: photos only (no checks), for the build before this change (--ui <that build's studio-ui>).
// Photos: <shots>/06-<prefix>-<lang>-<name>.png.
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startFakeAgent } from './ai-feel/fake-agent.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (f, d = null) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const ONLY = take('--only') ? take('--only').split(',') : null;
const want = (n) => !ONLY || ONLY.includes(n);
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
const PREFIX = take('--prefix', 'after');
const LANG = take('--lang', 'en') === 'ja' ? 'ja' : 'en';
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const BEFORE = args.includes('--before');
const THEME = take('--theme', 'dark') === 'light' ? 'light' : 'dark';
const ja = LANG === 'ja';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, what) => {
  if (BEFORE) return;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

const FR = `document.querySelector('iframe')`;
const DBG = `${FR}.contentWindow.__gameStudio?._debug`;
const EDIT_READY = `document.querySelectorAll('.obj').length > 0 && !!${DBG}`;
const PLAYING = `document.querySelector('.shell')?.dataset.playing === 'on' && !${DBG}`;
const OV = `${FR}.contentDocument.querySelector('game-studio-play')`;
const LINE = `(() => { const l = document.querySelector('.ai-line'); return l && !l.hidden ? l.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`;
// The overlay over the game while playing: the corner, the paused panel.
const PLAY_UI = `JSON.stringify((() => { const h = ${OV}; if (!h) return null; const r = h.shadowRoot; const q = (s) => r.querySelector(s);
  const vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
  const chat = q('[data-part=pause-chat]');
  return { pause: vis(q('[data-part=pause-button]')) ? q('[data-part=pause-button]').textContent : null, mark: vis(q('.mark')),
    chat: vis(chat), title: chat ? chat.querySelector('.title b')?.textContent : '', sees: chat ? chat.querySelector('.title .sees')?.textContent : '',
    placeholder: chat ? chat.querySelector('form input')?.placeholder : '', resume: q('[data-action=pause-resume]')?.textContent || '',
    move: q('[data-action=pause-move]')?.textContent || '', replies: [...r.querySelectorAll('[data-part=pause-reply]')].map((e) => e.textContent) }; })())`;

function gameFolder() {
  const root = mkdtempSync(join(tmpdir(), 'play-save-'));
  cpSync(join(PKG, 'test/neon-run'), root, { recursive: true });
  for (const f of ['placement.json', '.studio/requests', '.studio/status.json', '.studio/watch.json']) rmSync(join(root, f), { recursive: true, force: true });
  // test/neon-run keeps no loader of its own (its README): the built one, as the other screen tests copy it.
  if (!existsSync(join(root, 'studio-placement.js'))) copyFileSync(join(UI, '../studio-placement.js'), join(root, 'studio-placement.js'));
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme: THEME }));
  return root;
}

async function open(browser, withAgent) {
  const root = gameFolder();
  // "Started from Claude Code": the AI's name is Claude (no plugin hook here; the stand-in's --watch is the heartbeat).
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: { CLAUDECODE: '1' } });
  const agent = withAgent ? startFakeAgent(root) : null;
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(srv.url);
  await page.waitFor(EDIT_READY, 90000);
  await sleep(2500);
  const j = async (e) => JSON.parse((await page.eval(e)) || 'null');
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(300);
    writeFileSync(join(SHOTS, `06-${PREFIX}-${LANG}-${name}.png`), await page.screenshot());
  };
  const key = async (k, code, vk, text, modifiers = 0) => {
    const base = { key: k, code, windowsVirtualKeyCode: vk, modifiers };
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    if (text) await page.send('Input.dispatchKeyEvent', { type: 'char', ...base, text });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(300);
  };
  const until = async (expr, ms) => {
    const t0 = Date.now();
    for (;;) {
      if (await page.eval(expr).catch(() => false)) return true;
      if (Date.now() - t0 > ms) return false;
      await sleep(200);
    }
  };
  const press = async (sel) => {
    const p = await j(`JSON.stringify((() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`);
    if (p) await page.click(p.x, p.y);
    return !!p;
  };
  // Move objects as a person does: pick (the list's own action), then → twice (nudge).
  const nudge = async (keys) => {
    for (const k of keys) {
      await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`);
      await sleep(400);
      await key('ArrowRight', 'ArrowRight', 39);
      await key('ArrowRight', 'ArrowRight', 39);
    }
    await key('Escape', 'Escape', 27);
  };
  const watching = () => until(`document.querySelector('.presence')?.dataset.state === 'watching'`, 30000);
  return { root, srv, agent, page, j, shot, key, until, press, nudge, watching,
    close: async () => { await agent?.stop(); await page.close?.(); await srv.close?.(); } };
}

const MOVED = ['gate', 'ship', 'ring', 'orb', 'hex-1'];

const browser = await launch();
try {
  if (want('save')) {
    console.log(`save (${LANG}): the AI watching`);
    const g = await open(browser, true);
    try {
      check(await g.watching(), 'the stand-in is watching');
      await g.nudge(MOVED);
      await g.shot('save-0-changed');
      await g.key('s', 'KeyS', 83, '', 4); // ⌘S
      await g.until(`${LINE}.length > 0`, 5000);
      let line = await g.page.eval(LINE);
      await g.shot('save-1-pressed');
      // Three of the five by name (in the scene's order), then "2 more".
      const named = (line.match(ja ? /(\S+) を動かした/g : /moved (\S+)/g) || []).length;
      check(named === 3 && (ja ? /^保存しました: .*ほか 2/ : /^Saved: .*· 2 more/).test(line), `pressed: what was kept, by name ("${line}")`);
      check(ja ? /Claude がコードに入れています…/.test(line) : /Claude is putting it in the code…/.test(line) || /In the game/.test(line), 'pressed: Claude is putting it in the code');
      const inGame = await g.until(`/${ja ? 'ゲームに入りました' : 'In the game'}/.test(${LINE})`, 20000);
      line = await g.page.eval(LINE);
      await g.shot('save-2-in');
      check(inGame && (ja ? /ゲームに入りました（5 個）/.test(line) : /In the game \(5\)/.test(line)), `done: in the game, with the count ("${line}")`);
      check(await g.page.eval(`!!document.querySelector('.ai-line [data-action=ai-play]')`), 'done: ▶ Play on the line');
    } finally {
      await g.close();
    }
  }

  if (want('noai')) {
    console.log(`noai (${LANG}): nobody watching`);
    const g = await open(browser, false);
    try {
      await g.nudge(['gate']);
      await g.key('s', 'KeyS', 83, '', 4);
      const fact = await g.until(`/${ja ? 'Claude が開いたら、コードに入れます' : 'Claude puts it in the code when it opens'}/.test(${LINE})`, 25000);
      const line = await g.page.eval(LINE);
      await g.shot('save-3-noai');
      check(fact, `no AI: the fact ("${line}")`);
      check(!/putting it in|コードに入れています|In the game|ゲームに入りました/.test(line), 'no AI: no promise');
    } finally {
      await g.close();
    }
  }

  if (want('play')) {
    console.log(`play (${LANG}): the corner and the pause`);
    const g = await open(browser, true);
    try {
      await g.watching();
      await g.nudge(['gate']);
      await g.press('[data-action=play]');
      await g.until(`!!document.querySelector('[data-part=unsaved-guard]:not([hidden])')`, 5000);
      const win = await g.j(`JSON.stringify((() => { const w = document.querySelector('[data-part=unsaved-guard]'); return { text: w.innerText.replace(/\\s+/g, ' ').trim(), ps: w.querySelectorAll('p').length,
        buttons: [...w.querySelectorAll('button')].map((b) => b.textContent) }; })())`);
      await g.shot('play-1-window');
      check(win.ps === 0 && !/AI|Claude|コード|code/.test(win.text), `the window: no line about the AI ("${win.text}")`);
      check(JSON.stringify(win.buttons) === JSON.stringify(ja ? ['やめる', '保存せずに試す', '保存して遊ぶ'] : ['Cancel', 'Try without saving', 'Save and play']), `three buttons ${JSON.stringify(win.buttons)}`);
      await g.press('[data-action=guard-discard]');
      await g.until(PLAYING, 20000);
      await g.until(`!!${OV}?.shadowRoot?.querySelector('[data-part=pause-button]')`, 10000);
      await sleep(1500);
      let u = await g.j(PLAY_UI);
      await g.shot('play-2-corner');
      check(!!u && u.mark === false, 'playing: no ✦ mark in the corner');
      check(!!u?.pause && (ja ? /止めて話す\s*P/ : /Pause and talk\s*P/).test(u.pause), `playing: one button "❚❚ Pause and talk P" ("${u?.pause}")`);
      await g.key('p', 'KeyP', 80, 'p');
      await g.until(`JSON.parse(${PLAY_UI})?.chat === true`, 8000);
      u = await g.j(PLAY_UI);
      await g.shot('play-3-paused');
      check(u.title === (ja ? '止めています' : 'Paused'), `paused: "${u.title}"`);
      check(u.sees.startsWith(ja ? 'Claude はこの瞬間を見ています' : 'Claude sees this moment'), `paused: "${u.sees}"`);
      check(u.placeholder === (ja ? 'この瞬間について Claude に頼む…' : 'Ask Claude about this moment…'), `the field: "${u.placeholder}"`);
      check((ja ? /続ける\s*P/ : /Resume\s*P/).test(u.resume) && !!u.move, `Move and ▶ Resume P ("${u.move}" / "${u.resume}")`);
      await g.page.eval(`(${OV}.shadowRoot.querySelector('[data-part=pause-chat] form input').focus(), true)`);
      await g.page.send('Input.insertText', { text: ja ? 'ゲートが道に近すぎる？' : 'Is the gate too close to the road?' });
      await g.key('Enter', 'Enter', 13, '\r');
      const replied = await g.until(`JSON.parse(${PLAY_UI})?.replies.length > 0`, 20000);
      await g.shot('play-4-reply');
      check(replied, 'paused: the stand-in answers in the chat');
      await g.page.eval(`(document.activeElement?.blur?.(), ${FR}.contentDocument.activeElement?.blur?.(), true)`);
      await g.press('[data-action=pause-resume]');
      if (!(await g.until(`JSON.parse(${PLAY_UI})?.chat === false`, 4000))) await g.key('p', 'KeyP', 80, 'p');
      u = await g.j(PLAY_UI);
      check(u.chat === false && !!u.pause, 'resumed: the corner button is back');
      // ? while playing: the sheet lists ` (asking without pausing).
      // The sheet opens with ? from the editor page (as studio-camera-p): a press on the top bar's empty middle first.
      await g.page.click(640, 22);
      await g.page.eval(`(document.activeElement?.blur?.(), true)`);
      await g.key('?', 'Slash', 191, '?');
      await g.until(`!!document.querySelector('[data-part=shortcuts]:not([hidden])')`, 4000);
      const row = await g.page.eval(`document.querySelector('[data-part=shortcuts] [data-key=askPlaying]')?.innerText.replace(/\\s+/g, ' ').trim() || ''`);
      await g.shot('play-5-keys');
      check((ja ? /止めずに Claude に頼む/ : /Ask Claude without pausing/).test(row) && row.includes('`'), `the key sheet: "${row}"`);
    } finally {
      await g.close();
    }
  }
} finally {
  browser.close();
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log(BEFORE ? 'photos taken' : 'all ok');
