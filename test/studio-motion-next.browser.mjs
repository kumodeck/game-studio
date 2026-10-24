// What to press after making a motion, in a headless browser (studio-motion-next, 2026-10-24; a hands-on
// review). The review's check, as a first-time maker: "make a motion and
// put it in the game; then make it adjustable with numbers" — they press Save, then ✦ Turn into a rule, without a doubt.
// Lantern Cove, PC 1280×800, the stand-in AI watching (test/ai-feel/fake-agent.mjs), one language a run (`--lang en|ja`),
// dark by default (`--themes dark,light`):
//   1. the lighthouse: the strip's Motion → Make a motion → two moves → Done: over the ask field, "<motion> is made · Save
//      puts it in the game · Recording · press ● when you're done", its ● → "… · ✦ Have Claude convert it to rules"
//      (studio-motion-next-2: the one line over the field; it was under the plate's line); on the plate's line, beside
//      Preview / Repeat / When, "✦ Turn into a rule" (the same row);
//   2. ✦ Ask Claude: a menu — "Have Claude convert this motion to rules / Have this motion changed… / Have another motion
//      added…" (studio-motion-next-2's words; Esc closes it);
//   3. Save (the top bar): "Saved: <motion>" → the AI has it in: "✓ Saved: <motion> · In the game" (with the timeline open,
//      the chip beside the ask field: "✓ In the game: <motion>", the result first); the line over the field gone;
//   4. ✦ Turn into a rule on the line: the draft "Turn into a close rule" in the chat box, nothing sent;
//   5. the sea stack: Make a motion, a move, then ● Rec motion off (Fine-tune): the line over the field at once;
//   6. no page errors.
// Pictures (`--shots <dir>`): <after|before>-<lang>-<theme>-<1-next|2-menu|3a-save-word|3-saved|4-rule|5-rec-off>.png
// (3a: the top bar's Save as "Save (put it in the game)", for the picture only — the review's other way, to compare). `--before --ui <dir>`
// (the build before this change): the same steps, pictures only, no checks.
//
//   node test/studio-motion-next.browser.mjs [--shots <dir>] [--before] [--ui <dir>] [--themes dark,light] [--lang en|ja]
// Exit 1 on a failure.
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
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const LANG = take('--lang', 'en') === 'ja' ? 'ja' : 'en';
const THEMES = take('--themes', 'dark').split(',');
const BEFORE = args.includes('--before');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, what) => {
  if (BEFORE) return;
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const ROOT = `document.querySelector('iframe.game, iframe').contentDocument.querySelector('[data-studio-ui]').shadowRoot`;
const DBG = `document.querySelector('iframe.game, iframe').contentWindow.__gameStudio?._debug`;
const TL = `window.__studioTimeline`;
const LINE = `(() => { const l = document.querySelector('.ai-line'); return l && !l.hidden ? l.innerText.replace(/\\s+/g, ' ').trim() : ''; })()`;
// studio-motion-next-2 (2026-10-24): the next step is the one line over the ask field now (motion-note.ts; the plate's .tl-next
// is gone), and ✦ Ask's rows say the result. Its parts are read as test/studio-motion-next-2.browser.mjs reads them.
const W = LANG === 'ja'
  ? { made: /^(.+)ができました$/, rule: 'Claude にルールベースに変換してもらう', btn: 'Claude にルールベースに変換してもらう', menu: ['この動きを Claude にルールベースに変換してもらう', 'この動きを直してもらう…', '別の動きを足してもらう…'],
    kept: /^保存しました: (.+)/, in: /保存しました: (.+) · ゲームに入りました/, draft: 'ルールベースに変換して' }
  : { made: /^(.+) is made$/, rule: 'Have Claude convert it to rules', btn: 'Have Claude convert it to rules', menu: ['Have Claude convert this motion to rules', 'Have this motion changed…', 'Have another motion added…'],
    kept: /^Saved: (.+)/, in: /Saved: (.+) · In the game/, draft: 'Convert it to rules' };

async function open(browser, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-motion-next-'));
  cpSync(join(PKG, 'starters', 'lantern-cove'), root, { recursive: true });
  for (const f of ['placement.json', '.studio/requests', '.studio/status.json', '.studio/watch.json']) rmSync(join(root, f), { recursive: true, force: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  // "Started from Claude Code": the AI's name is Claude; the stand-in's --watch is the heartbeat (studio-play-save.browser.mjs).
  const srv = await startStudioServer({ root, uiDir: UI, log: () => {}, env: { CLAUDECODE: '1' } });
  const agent = startFakeAgent(root);
  const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
  await sleep(2500);
  return { page, close: async () => (await agent?.stop(), await page.close?.(), await srv.close?.()) };
}

async function run(browser, theme) {
  const tag = `${LANG} ${theme}`;
  console.log(`${tag}${BEFORE ? ' (before)' : ''}`);
  const { page, close } = await open(browser, theme);
  try {
    const j = async (expr) => JSON.parse((await page.eval(expr)) || 'null');
    const shot = async (what) => SHOTS && (await sleep(300), writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${LANG}-${theme}-${what}.png`), await page.screenshot()));
    const until = async (expr, ms) => {
      const t0 = Date.now();
      for (;;) {
        if (await page.eval(expr).catch(() => false)) return true;
        if (Date.now() - t0 > ms) return false;
        await sleep(200);
      }
    };
    const select = async (k) => (await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`), await sleep(1100));
    // On screen = has a box (a fixed menu has no offsetParent, so the box is what counts).
    const at = (sel) => j(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => !x.closest('[hidden]') && x.getBoundingClientRect().width); if (!b) return null;
      const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, h: r.height }); })()`);
    /** A press as a person makes it (the pointer at the element's middle); false = not on screen. */
    const press = async (sel) => {
      const p = await at(sel);
      if (p) (await page.click(p.x, p.y), await sleep(600));
      return !!p;
    };
    const stripAt = (sel) => j(`(() => { const o = document.querySelector('iframe.game, iframe').getBoundingClientRect(); const b = ${ROOT}.querySelector(${JSON.stringify(sel)});
      if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`);
    const menu = () => j(`(() => { const m = document.querySelector('[data-part=context-menu]'); if (!m || m.hidden) return null;
      return JSON.stringify([...m.querySelectorAll('.ctx-label')].map((c) => [...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim())); })()`);
    const text = (part) => j(`JSON.stringify((() => { const e = document.querySelector('[data-part=${part}]'); return e && !e.hidden && e.offsetParent ? e.textContent : null; })())`);
    const key = async (k, code, vk) => {
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
      await sleep(300);
    };
    /** The end of a drag of `k` by dx (the editor's own message, as the bridge sends it at the drag's end). */
    const drag = async (k, dx) => (await page.eval(`(() => { const p = ${TL}.shownPose(${JSON.stringify(k)}); ${TL}.moved(${JSON.stringify(k)}, { ...p, p: [p.p[0] + ${dx}, p.p[1], p.p[2]] }, true, p); })()`), await sleep(1300));
    /** The strip's Motion → Make a motion on `k` (pressed twice on a busy machine, as test/studio-no-presets.browser.mjs). */
    const makeOn = async (k) => {
      await select(k);
      await page.waitFor(`!!${ROOT}.querySelector('[data-studio-motion]:not([hidden])')`, 15000).catch(() => {});
      for (let i = 0; i < 2 && !(await at('[data-part=context-menu] [data-action=ctx-motion-make]')); i++) {
        const b = await stripAt('[data-studio-motion]');
        if (b) (await page.click(b.x, b.y), await sleep(900));
      }
      await press('[data-part=context-menu] [data-action=ctx-motion-make]');
    };
    check(await until(`document.querySelector('.presence')?.dataset.state === 'watching'`, 30000), `${tag}: the stand-in AI is watching`);

    // ---- 1. make the lighthouse's motion → Done: the next step ----
    await makeOn('lighthouse');
    await drag('lighthouse', 2.5);
    await drag('lighthouse', -2.5);
    await page.eval(`${TL}.state().playing && document.querySelector('[data-part=tl-play]')?.click()`);
    await press('[data-part=tl-done]');
    const made = await text('motion-note-what');
    const motion = W.made.exec(made || '')?.[1] ?? '';
    check(!!motion, `${tag}: the next step over the field ("${made}")`);
    // ● Rec motion is still on after Done: the line ends with "press ● when you're done"; its ● → the ✦ part.
    await press('[data-part=motion-note-rec-off]');
    check((await text('motion-note-rule')) === W.rule, `${tag}: its ✦ part, a button ("${await text('motion-note-rule')}")`);
    const ruleBtn = await at('[data-part=tl-to-rule]');
    const play = await at('[data-part=tl-play]');
    const starts = await at('[data-part=tl-starts]');
    check((await text('tl-to-rule')) === W.btn && !!ruleBtn && !!play && Math.abs(ruleBtn.y - play.y) < 6 && !!starts && Math.abs(ruleBtn.y - starts.y) < 6,
      `${tag}: "✦ ${W.btn}" on the line, the row of Preview / When (${JSON.stringify({ rule: ruleBtn?.y, play: play?.y, when: starts?.y })})`);
    await shot('1-next');

    // ---- 2. ✦ Ask Claude: a menu by what is asked ----
    await press('[data-part=tl-ask]');
    const rows = (await menu()) ?? [];
    check(JSON.stringify(rows) === JSON.stringify(W.menu), `${tag}: ✦ Ask is a menu (${rows.join(' | ')})`);
    const mm = await at('[data-part=context-menu]');
    const askB = await at('[data-part=tl-ask]');
    check(!!mm && !!askB && mm.top + mm.h <= askB.top, `${tag}: the menu opens above the button (the plate is at the foot)`);
    await shot('2-menu');
    await key('Escape', 'Escape', 27);
    check(!(await menu()), `${tag}: Esc closes it`);

    // ---- 3. Save: what was kept, then in the game ----
    // The review's "show what Save means — e.g. 'Save (put it in the game)'": decided by pictures. A picture of the top bar
    // with that word (the button's text node changed for the picture only, then put back), beside 1-next's plain "Save".
    if (SHOTS && !BEFORE) {
      const alt = LANG === 'ja' ? '保存（ゲームに入れる）' : 'Save (put it in the game)';
      const was = await page.eval(`(() => { const b = document.querySelector('[data-part=save]'); const w = [...b.querySelectorAll('*'), b].flatMap((e) => [...e.childNodes]).find((n) => n.nodeType === 3 && n.textContent.trim()); if (!w) return ''; const o = w.textContent; w.textContent = ${JSON.stringify(alt)}; window.__saveWord = [w, o]; return o; })()`);
      await shot('3a-save-word');
      if (was) await page.eval(`(() => { const [w, o] = window.__saveWord; w.textContent = o; })()`);
    }
    check(await press('[data-part=save]'), `${tag}: Save is on screen (the top bar)`);
    await until(`${LINE}.length > 0`, 5000);
    const pressed = await page.eval(LINE);
    check(W.kept.test(pressed) && pressed.includes(motion), `${tag}: Save → "${pressed}"`);
    const inGame = await until(`${JSON.stringify(W.in.source)} && new RegExp(${JSON.stringify(W.in.source)}).test(${LINE})`, 25000);
    const line = await page.eval(LINE);
    check(inGame && line.includes(motion), `${tag}: the AI has it in → "${line}"`);
    check((await text('motion-note')) === null, `${tag}: the line over the field has done its job`);
    // The timeline is open, so the finished line is the chip beside the ask field (fix-0142 ④): the result first.
    const chip = await text('ai-tuck');
    check(chip === null || (chip.startsWith(LANG === 'ja' ? 'ゲームに入りました: ' : 'In the game: ') && chip.includes(motion)), `${tag}: the chip beside the field says it is in ("${chip}")`);
    await shot('3-saved');

    // ---- 4. ✦ Turn into a rule on the line: a draft, nothing sent ----
    check(await press('[data-part=tl-to-rule]'), `${tag}: ✦ ${W.btn} pressed`);
    const draft = await page.eval(`document.querySelector('.ask-input')?.value ?? ''`);
    check(draft === W.draft, `${tag}: the draft in the chat box ("${draft}"), nothing sent`);
    await shot('4-rule');
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); } })()`);

    // ---- 5. the sea stack: a move, then ● Rec motion off ----
    // (Not the crate: low on the screen, Fine-tune's taller plate covers it and the plate folds to its line — fix-0143 ⑨ B.)
    await makeOn('sea-stack');
    await drag('sea-stack', 2);
    await page.eval(`${TL}.state().playing && document.querySelector('[data-part=tl-play]')?.click()`);
    if (!(await at('[data-part=tl-auto]'))) await press('[data-part=tl-fine-btn]');
    await press('[data-part=tl-auto]');
    const off = await text('motion-note-what');
    check(W.made.test(off || '') && !(await at('[data-part=tl-done]')), `${tag}: ● Rec motion off → the next step ("${off}")`);
    await shot('5-rec-off');

    const errors = page.logs.filter((l) => /^exception|error:/.test(l) && !/favicon|net::/.test(l));
    check(!errors.length, `${tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await close();
  }
}

const browser = await launch();
try {
  for (const theme of THEMES) await run(browser, theme);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'ok');
process.exit(failed ? 1 : 0);
