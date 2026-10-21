// Pictures (and checks) for "More in Claude" on the line over the game while playing (a try of v0.1.8, 2026-10-21: "it should say
// see Claude for details — Claude if Claude, Codex if Codex, or general"). The editor's AI line had it since the same
// day (save-clear, ai-flow.ts moreIn); the line over the game (bridge/play-ask.ts, "Fixed · Reload") did not.
// One run per build of the editor, same steps, in ▶ Play of test/play-ask/vanish with the real local server:
//   1-fixed   asked from inside Play, the AI's done: "Fixed: … / “…” · More in Claude"  [Reload] ×
//   2-asking  the AI asks with two choices: the question, its buttons, "More in Claude"
//   3-long    a long request: what was asked is cut with "…", "More in Claude" is not (the row stays one line)
//   4-full    full screen (the game's own F), when headless Chrome enters it
// at PC 1280×800, the Claude app's side window 400×900 and a phone 390×844, light and dark.
//
//   node test/play-line-more-shots.browser.mjs --out <dir> [--tag after|before] [--ui <a built studio-ui folder>]
//     [--agent claude|codex|none] [--lang ja|en] [--only pc,side,phone] [--themes light,dark]
//
// --ui: the editor page (and the game page's bridge, studio-edit.js) photographed; "before" is the build before this
// change with the same server. --agent: the environment the editor is started in (which-ai.mjs).
// Exit 1 when a check fails (not with --tag before).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(HERE, 'skills/arrange/bin/studio.mjs');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = resolve(take('--out'));
const TAG = take('--tag', 'after');
const UI = resolve(take('--ui', join(HERE, 'skills/arrange/bin/studio-ui')));
const LANG = take('--lang', 'ja');
const AGENT = take('--agent', 'claude');
const ONLY = take('--only');
const THEMES = take('--themes', 'light,dark').split(',');
const STRICT = TAG !== 'before';
mkdirSync(OUT, { recursive: true });
// The editor's environment decides the AI (which-ai.mjs). `{}` alone would fall back to this process's own (a run
// inside Claude Code has CLAUDECODE=1), so "none" is a key no AI sets.
const ENV = AGENT === 'claude' ? { CLAUDECODE: '1' } : AGENT === 'codex' ? { CODEX_SANDBOX: 'seatbelt' } : { KUMO_NO_AI: '1' };
const MORE = { claude: { ja: '詳しくは Claude で', en: 'More in Claude' }, codex: { ja: '詳しくは Codex で', en: 'More in Codex' }, none: { ja: '詳しくはお使いの AI で', en: 'More in your AI' } }[AGENT][LANG];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'side', width: 400, height: 900 },
  { id: 'phone', width: 390, height: 844, mobile: true },
];
let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : STRICT ? '✗' : '·'} ${what}`);
  if (!ok && STRICT) failed++;
};

const FR = `document.querySelector('iframe.game:not(.leaving)')`;
const OV = `${FR}.contentDocument.querySelector('game-studio-play')`;
// The line over the game as the person sees it: its words, the small row on one line, "More in …" whole and inside it.
const LINE = `(() => { const h = ${OV}; if (!h) return null; const r = h.shadowRoot; const l = r.querySelector('.line'); if (!l || l.hidden) return null;
  const f = ${FR}.getBoundingClientRect(); const lb = l.getBoundingClientRect(); const s = l.querySelector('.sub'); const m = l.querySelector('[data-part=play-ask-more]');
  const lh = s ? parseFloat(getComputedStyle(s).lineHeight) || 16 : 16; const hd = l.querySelector('.head');
  return JSON.stringify({ text: l.textContent, more: m ? m.textContent : '', sub: s ? s.textContent : '',
    subOneLine: !s || s.getBoundingClientRect().height <= lh * 1.5, headOneLine: hd.getBoundingClientRect().height <= (parseFloat(getComputedStyle(hd).lineHeight) || 20) * 1.5,
    moreWhole: !m || m.scrollWidth <= m.clientWidth + 1, moreIn: !m || m.getBoundingClientRect().right <= s.getBoundingClientRect().right + 1,
    inFrame: lb.left >= 0 && lb.right <= f.width + 1, choices: r.querySelectorAll('.choices button').length, reload: !!r.querySelector('[data-action=play-reload]') }); })()`;
const j = async (page, expr) => JSON.parse((await page.eval(expr)) || 'null');

const status = (root, ...a) => {
  const r = spawnSync(process.execPath, [CLI, root, '--status', ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
};
const playRequests = (root) => (existsSync(join(root, '.studio/requests')) ? readdirSync(join(root, '.studio/requests')) : []).filter((n) => n.endsWith('.json')).sort()
  .map((n) => JSON.parse(readFileSync(join(root, '.studio/requests', n), 'utf8'))).filter((r) => r.kind === 'play');

async function keyIn(page, key, code, text) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0), text });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
}

/** Ask from inside Play: ` (or ✦ in the top bar where the corner mark is not drawn), the words, Enter. Returns the request. */
async function ask(page, root, size, words) {
  const before = playRequests(root).length;
  const spark = await j(page, `(() => { const a = document.querySelector('[data-action=play-ask]'); if (!a || a.hidden || !a.offsetParent) return null; const b = a.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()`);
  if (spark) size.mobile ? await page.tap(spark.x, spark.y) : await page.click(spark.x, spark.y);
  else {
    await page.click(Math.round(size.width / 2), Math.round(size.height / 2));
    await keyIn(page, '`', 'Backquote', '`');
  }
  await page.waitFor(`!${OV}.shadowRoot.querySelector('.bar').hidden`, 5000);
  await page.send('Input.insertText', { text: words });
  await keyIn(page, 'Enter', 'Enter', '\r');
  for (let i = 0; i < 80; i++) {
    const recs = playRequests(root);
    if (recs.length > before) return recs[recs.length - 1];
    await sleep(100);
  }
  throw new Error('no play request');
}

async function shoot(size, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-play-line-more-'));
  cpSync(join(HERE, 'test/play-ask/vanish'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: ENV });
  const browser = await launch();
  const name = (what) => join(OUT, `${TAG}${AGENT === 'claude' ? '' : `-${AGENT === 'none' ? 'any' : AGENT}`}-${size.id}-${theme}-${what}.png`);
  console.log(`${TAG} ${size.id} ${theme} (agent: ${AGENT})`);
  // An AI that watches (so the line says "looking", not "kept"), as the editor sees it in Claude Code.
  const watch = spawn(process.execPath, [CLI, root, '--watch', '--for', '5'], { stdio: 'ignore' });
  try {
    const page = await newPage(browser, size);
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${FR}?.contentWindow?.__gameStudio?._debug`, 90000);
    await page.eval(`document.querySelector('button.play').click()`);
    await page.waitFor(`document.querySelector('.shell').dataset.playing === 'on' && !!${OV}?.shadowRoot?.querySelector('.line')`, 30000);
    await sleep(600);

    // 1. Asked, then done (the game's files changed: Reload).
    const asked = LANG === 'ja' ? 'ここで止まるとキャラが消えた' : 'The hero vanishes when I stop here';
    const rec = await ask(page, root, size, asked);
    status(root, 'received', '--request', rec.id);
    await sleep(400);
    const f = join(root, 'game.js');
    writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter((l) => !l.includes('BUG')).join('\n'));
    status(root, 'done', '--request', rec.id, '--changed', '0', '--note', LANG === 'ja' ? 'パッドの上でもキャラが消えないようにしました' : 'Fixed: the hero no longer vanishes on the pad');
    await page.waitFor(`(() => { const o = JSON.parse(${LINE} || 'null'); return !!o && o.reload; })()`, 15000);
    await sleep(500);
    let o = await j(page, LINE);
    console.log(`  line: ${o.text}`);
    check(o.more === MORE, `fixed: "${MORE}" at the end of the small row (got "${o.more}")`);
    check(o.sub.includes('“') || o.sub.includes('「') || o.sub.includes(asked.slice(0, 6)), 'fixed: what was asked stays in the row');
    check(o.subOneLine && o.headOneLine && o.moreWhole && o.moreIn && o.inFrame, `fixed: one line, "${MORE}" whole and inside (${JSON.stringify({ sub: o.subOneLine, head: o.headOneLine, whole: o.moreWhole, in: o.moreIn, frame: o.inFrame })})`);
    writeFileSync(name('1-fixed'), await page.screenshot());

    // 2. The AI asks with two choices.
    status(root, 'asking', '--request', rec.id, '--note', LANG === 'ja' ? 'パッドは光ったままにしますか？' : 'Should the pad still glow?',
      '--choice', LANG === 'ja' ? '光らせる' : 'Keep the glow', '--choice', LANG === 'ja' ? '消す' : 'Turn it off');
    await page.waitFor(`(() => { const o = JSON.parse(${LINE} || 'null'); return !!o && o.choices === 2; })()`, 15000);
    await sleep(400);
    o = await j(page, LINE);
    check(o.more === MORE, `asking: "${MORE}" (got "${o.more}")`);
    check(o.subOneLine && o.moreWhole && o.moreIn && o.inFrame, 'asking: one line, whole, inside');
    writeFileSync(name('2-asking'), await page.screenshot());

    // 3. A long request (what was asked is cut, "More in …" is not). The question answered first: while it is open, the
    // field's words are an answer, not a new request.
    status(root, 'done', '--request', rec.id, '--changed', '0', '--note', LANG === 'ja' ? '光らせたままにしました' : 'Kept the glow');
    await sleep(1200);
    const long = LANG === 'ja' ? 'ジャンプした後に着地すると時々キャラが床にめり込んで動けなくなるので直して' : 'After a jump the hero sometimes sinks into the floor on landing and cannot move, please fix it';
    const rec2 = await ask(page, root, size, long);
    status(root, 'done', '--request', rec2.id, '--changed', '0', '--note', LANG === 'ja' ? '着地の判定を直しました' : 'Fixed the landing check');
    await page.waitFor(`(() => { const o = JSON.parse(${LINE} || 'null'); return !!o && o.more !== undefined && /${LANG === 'ja' ? '着地の判定' : 'landing check'}/.test(o.text); })()`, 15000);
    await sleep(500);
    o = await j(page, LINE);
    check(o.more === MORE, `long: "${MORE}" (got "${o.more}")`);
    check(o.subOneLine && o.moreWhole && o.moreIn && o.inFrame, `long: still one line, "${MORE}" not cut (${JSON.stringify({ sub: o.subOneLine, whole: o.moreWhole, in: o.moreIn, frame: o.inFrame })})`);
    writeFileSync(name('3-long'), await page.screenshot());

    // 4. Full screen (the game's own F): the line is in the top layer, drawn over the full-screen page.
    await page.click(Math.round(size.width / 2), Math.round(size.height * 0.7));
    await keyIn(page, 'f', 'KeyF', 'f');
    await sleep(900);
    const fs = await page.eval(`!!${FR}.contentDocument.fullscreenElement`);
    if (fs) {
      o = await j(page, LINE);
      check(!!o && o.more === MORE && o.subOneLine && o.moreWhole, 'full screen: the line keeps "More in …" on one line');
      writeFileSync(name('4-full'), await page.screenshot());
    } else console.log('  · headless Chrome did not enter full screen (no 4-full)');
  } finally {
    watch.kill();
    browser.close();
    srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const size of SIZES) {
  if (ONLY && !ONLY.split(',').includes(size.id)) continue;
  for (const theme of THEMES) await shoot(size, theme);
}
console.log(failed ? `play-line-more-shots: ${failed} check(s) failed` : 'play-line-more-shots: ok');
process.exit(failed ? 1 : 0);
