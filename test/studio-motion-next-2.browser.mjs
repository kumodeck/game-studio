// The motion's one line over the ask field, and ✦ Ask's menu in the result's words, in a headless browser
// (studio-motion-next-2, 2026-10-24; a hands-on review of v0.1.58). Lantern Cove, PC 1280×800, the stand-in AI watching (test/ai-feel/fake-agent.mjs), one
// language a run (`--lang en|ja`), dark by default (`--themes dark,light`):
//   0. the lighthouse's motion made and saved (the strip's Motion → Make a motion → two moves → Done → Save): "a motion
//      that is already there". Done turns ● Rec motion off with it (studio-done-stops-rec, 2026-10-24, a review's answer):
//      the line says "… is made · Save puts it in the game · ✦ Have Claude convert it to rules", no "Recording";
//      after Save, ● turned back on (the plate's ●): the line says "● Recording · press ● when you're done";
//   1. the review's check 1: one point of its path dragged (the bridge's own timeline/point, as at a drag's end) → "lighthouse’s
//      motion changed · Save puts it in the game · ● Recording · press ● when you're done", the top bar's Save ringed in the
//      line's orange; the line's ● → Rec motion off → "… · ✦ Have Claude convert it to rules";
//   2. check 2: the key picked on the timeline, its ease → Steady: the line still there;
//   3. check 3: the timeline folded (⌄): the line still there (over the field, nothing of the plate on screen);
//   4. check 4: Save → the line gone, the AI line "Saved: lighthouse’s motion";
//   5. another object picked after a change: "Not saved: lighthouse’s motion · Save puts it in the game" (its name picks it back);
//   6. ✦ Ask: three rows — "Have Claude convert this motion to rules / Have this motion changed… / Have another motion
//      added…", each with its grey example; each pressed puts a different draft in the field (nothing sent);
//   7. no page errors.
// Pictures (`--shots <dir>`): <after|before>-<lang>-<theme>-<0a-done|0-rec|1-drag|1b-rec-off|1c-save-a|2-ease|3-folded|4-saved|5-other|6-menu|6a-fix|6b-add>.png
// (1c: A of the two ways to tie the line to Save — a Save pressable in the line — drawn into the page for the picture only, to
// compare with 1b, B, which is what is built). `--before --ui <dir>` (the v0.1.58 build): the same steps, pictures only, no checks.
//
//   node test/studio-motion-next-2.browser.mjs [--shots <dir>] [--before] [--ui <dir>] [--themes dark,light] [--lang en|ja]
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
// The one line, as read on screen: its parts joined by a space (the gaps are the flex row's), the button that ends recording
// read as the ● it shows (a drawn dot, not a letter); '' when it is not there.
const NOTE = `(() => { const n = document.querySelector('[data-part=motion-note]'); if (!n || n.hidden || !n.offsetParent) return '';
  return [...n.children].map((c) => { const x = c.cloneNode(true); x.querySelectorAll('.mn-rec-off').forEach((b) => b.replaceWith('●')); return x.textContent.replace(/\\s+/g, ' ').trim(); })
    .filter(Boolean).join(' '); })()`;
const W = LANG === 'ja'
  ? { changed: (m) => `${m}を変えました`, made: (m) => `${m}ができました`, save: '保存するとゲームに入ります', rec: '記録中 · 終わったら ● を押す', rule: 'Claude にルールベースに変換してもらう',
    other: (m) => `保存していない動き: ${m}`, kept: /^保存しました: (.+)/,
    menu: ['この動きを Claude にルールベースに変換してもらう', 'この動きを直してもらう…', '別の動きを足してもらう…'], subs: ['半径・速さなどをカードで変えられるように', '例：もっとゆっくり・高く跳ねる', '例：近づいたら回る'],
    drafts: ['ルールベースに変換して', 'この動きを直して:', '別の動きを足して:'], saveA: '保存' }
  : { changed: (m) => `${m} changed`, made: (m) => `${m} is made`, save: 'Save puts it in the game', rec: 'Recording · press ● when you’re done', rule: 'Have Claude convert it to rules',
    other: (m) => `Not saved: ${m}`, kept: /^Saved: (.+)/,
    menu: ['Have Claude convert this motion to rules', 'Have this motion changed…', 'Have another motion added…'], subs: ['then change radius, speed… on the card', 'e.g. slower, bounce higher', 'e.g. spin when you get close'],
    drafts: ['Convert it to rules', 'Change this motion:', 'Add another motion:'], saveA: 'Save' };

async function open(browser, theme) {
  const root = mkdtempSync(join(tmpdir(), 'studio-motion-next-2-'));
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
    const shot = async (what) => SHOTS && (await sleep(350), writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${LANG}-${theme}-${what}.png`), await page.screenshot()));
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
      const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }); })()`);
    /** A press as a person makes it (the pointer at the element's middle); false = not on screen. */
    const press = async (sel) => {
      const p = await at(sel);
      if (p) (await page.click(p.x, p.y), await sleep(600));
      return !!p;
    };
    const stripAt = (sel) => j(`(() => { const o = document.querySelector('iframe.game, iframe').getBoundingClientRect(); const b = ${ROOT}.querySelector(${JSON.stringify(sel)});
      if (!b || b.hidden || !b.getBoundingClientRect().width) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2 }); })()`);
    const menuRows = () => j(`(() => { const m = document.querySelector('[data-part=context-menu]'); if (!m || m.hidden) return null;
      return JSON.stringify([...m.querySelectorAll('.ctx-row')].map((r) => ({ label: [...r.querySelector('.ctx-label').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
        sub: r.querySelector('.ctx-sub')?.textContent ?? null, id: r.dataset.action }))); })()`);
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
    const saveNow = async () => {
      const ok = await press('[data-part=save]');
      await until(`${LINE}.length > 0`, 5000);
      return ok;
    };
    const glow = () => page.eval(`document.querySelector('[data-part=save]')?.dataset.glow ?? ''`);
    check(await until(`document.querySelector('.presence')?.dataset.state === 'watching'`, 30000), `${tag}: the stand-in AI is watching`);

    // ---- 0. a motion that is already there: made and saved ----
    await makeOn('lighthouse');
    await drag('lighthouse', 2.5);
    await drag('lighthouse', -2.5);
    await page.eval(`${TL}.state().playing && document.querySelector('[data-part=tl-play]')?.click()`);
    await press('[data-part=tl-done]');
    const motion = await page.eval(`${TL}.shownName('lighthouse') ?? ''`);
    const fresh = await page.eval(NOTE);
    check(fresh.startsWith(W.made(motion)) && fresh.includes(W.save), `${tag}: made, not saved yet → "${fresh}"`);
    // studio-done-stops-rec: Done = done recording too — ● off, and the line in its "made" form, not "● Recording".
    check((await page.eval(`${TL}.state().auto`)) === false, `${tag}: Done → ● Rec motion off`);
    check(fresh === `${W.made(motion)} · ${W.save} · ${W.rule}` && !fresh.includes(W.rec), `${tag}: Done → the line "made" ("${fresh}"), no "Recording"`);
    await shot('0a-done');
    check(await saveNow(), `${tag}: Save (the top bar)`);
    await until(`${LINE}.includes('${LANG === 'ja' ? 'ゲームに入りました' : 'In the game'}') || (document.querySelector('[data-part=ai-tuck]')?.offsetParent && document.querySelector('[data-part=ai-tuck]').textContent.length > 0)`, 25000);
    await select('lighthouse');
    // ● back on (Done turned it off), for the checks below that speak of recording.
    await page.eval(`${TL}.setAuto(true)`);
    await sleep(400);
    const rec0 = await page.eval(NOTE);
    check(rec0 === W.rec, `${tag}: saved, ● Rec motion on: "${rec0}" (check 4)`);
    check(!(await glow()), `${tag}: nothing to save: the Save is not ringed`);
    await shot('0-rec');

    // ---- 1. a point dragged → the line (check 1) ----
    await page.eval(`(() => { const p = ${TL}.shownPose('lighthouse'); ${TL}.onMessage({ type: 'studio:timeline/point', key: 'lighthouse', i: 1, v: [2.5, 1.2, 0], end: false }); ${TL}.onMessage({ type: 'studio:timeline/point', key: 'lighthouse', i: 1, v: [2.5, 1.2, 0], end: true }); })()`);
    await sleep(900);
    const n1 = await page.eval(NOTE);
    check(n1 === `${W.changed(motion)} · ${W.save} · ${W.rec}`, `${tag}: a point dragged → "${n1}" (check 1)`);
    check((await glow()) === 'motion', `${tag}: the top bar's Save ringed in the line's orange`);
    const note = await at('[data-part=motion-note]');
    const field = await at('[data-part=ask]');
    check(!!note && !!field && note.bottom <= field.top + 1 && field.top - note.bottom < 24, `${tag}: the line sits right over the ask field (${JSON.stringify({ note: note?.bottom, field: field?.top })})`);
    await shot('1-drag');
    check(await press('[data-part=motion-note-rec-off]'), `${tag}: the line's ● pressed`);
    const n1b = await page.eval(NOTE);
    check(n1b === `${W.changed(motion)} · ${W.save} · ${W.rule}` && (await page.eval(`${TL}.state().auto`)) === false, `${tag}: Rec motion off → "${n1b}"`);
    await shot('1b-rec-off');
    // A of the two ways (the review's "press Save in the line, or ring the Save above"): a Save in the line, for the picture only.
    if (SHOTS && !BEFORE) {
      await page.eval(`(() => { const s = document.querySelector('[data-part=motion-note-save]'); const w = s.querySelector('.mn-save-w'); const b = document.createElement('button');
        b.className = 'top-save'; b.textContent = ${JSON.stringify(W.saveA)}; b.style.cssText = 'display:inline-flex;align-items:center;height:22px;padding:0 9px;border:0;border-radius:999px;background:var(--you);color:var(--you-fg);font:inherit;font-weight:600;margin:0 2px';
        w.replaceWith(b); const top = document.querySelector('[data-part=save]'); window.__glowWas = top.dataset.glow; delete top.dataset.glow; })()`);
      await shot('1c-save-a');
      await page.eval(`(() => { const top = document.querySelector('[data-part=save]'); if (window.__glowWas) top.dataset.glow = window.__glowWas; ${TL}.render(); })()`);
    }

    // ---- 2. the ease → Steady: still there (check 2) ----
    const k = await at('[data-part=tl-key][data-key=lighthouse]:not(.sum), [data-part=tl-key][data-key=lighthouse]');
    if (k) (await page.click(k.x, k.y), await sleep(500));
    const eased = await page.eval(`(() => { const s = document.querySelector('[data-part=tl-ease]'); if (!s) return false; s.value = 'linear'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(500);
    const n2 = await page.eval(NOTE);
    check(eased && n2.startsWith(W.changed(motion)), `${tag}: the ease → Steady: the line stays ("${n2}") (check 2)`);
    await shot('2-ease');

    // ---- 3. folded: still there (check 3) ----
    check(await press('[data-part=timeline] [data-action=tl-fold]'), `${tag}: the timeline folded (⌄)`);
    await sleep(500);
    const n3 = await page.eval(NOTE);
    const plate = await at('[data-part=timeline]');
    check(!plate && n3 === `${W.changed(motion)} · ${W.save} · ${W.rule}`, `${tag}: folded, the plate gone, the line stays: "${n3}" (check 3)`);
    check((await glow()) === 'motion', `${tag}: folded, the Save still ringed`);
    await shot('3-folded');

    // ---- 4. Save: gone, "Saved: <motion>" (check 4) ----
    await saveNow();
    const said = await page.eval(LINE);
    const n4 = await page.eval(NOTE);
    check(n4 === '' && W.kept.test(said) && said.includes(motion), `${tag}: Save → the line gone, the AI line "${said}" (check 4)`);
    check(!(await glow()), `${tag}: saved: the ring goes with it`);
    await shot('4-saved');

    // ---- 5. another object picked after a change: still said ----
    await page.eval(`${TL}.setOpen(true)`);
    await sleep(500);
    await page.eval(`(() => { ${TL}.onMessage({ type: 'studio:timeline/point', key: 'lighthouse', i: 1, v: [2.5, 2, 0], end: true }); })()`);
    await sleep(500);
    await select('sailboat');
    const n5 = await page.eval(NOTE);
    check(n5 === `${W.other(motion)} · ${W.save}`, `${tag}: another object picked → "${n5}"`);
    check((await glow()) === 'motion', `${tag}: another object picked: the Save still ringed`);
    await shot('5-other');
    check(await press('[data-part=motion-note-go]'), `${tag}: the motion's name pressed`);
    await sleep(600);
    check((await page.eval(`studioShell.selected()`)) === 'lighthouse' && (await page.eval(NOTE)).startsWith(W.changed(motion)), `${tag}: … picks the lighthouse back ("${await page.eval(NOTE)}")`);

    // ---- 6. ✦ Ask: three rows by what is wanted, three drafts ----
    if (!(await at('[data-part=tl-ask]'))) (await page.eval(`${TL}.setOpen(true)`), await sleep(600));
    await press('[data-part=tl-ask]');
    const rows = (await menuRows()) ?? [];
    check(JSON.stringify(rows.map((r) => r.label)) === JSON.stringify(W.menu), `${tag}: ✦ Ask's rows: ${rows.map((r) => r.label).join(' | ')}`);
    check(JSON.stringify(rows.map((r) => r.sub)) === JSON.stringify(W.subs), `${tag}: … each with its example: ${rows.map((r) => r.sub).join(' | ')}`);
    const mm = await at('[data-part=context-menu]');
    const askB = await at('[data-part=tl-ask]');
    check(!!mm && !!askB && mm.bottom <= askB.top + 1, `${tag}: the menu opens above the button`);
    await shot('6-menu');
    const drafts = [];
    const clear = () => page.eval(`(() => { const i = document.querySelector('.ask-input'); if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); } })()`);
    for (const [i, id] of ['ctx-tl-ask-rule', 'ctx-tl-ask-fix', 'ctx-tl-ask-add'].entries()) {
      if (i) await press('[data-part=tl-ask]');
      await press(`[data-part=context-menu] [data-action=${id}]`);
      drafts.push((await page.eval(`document.querySelector('.ask-input')?.value ?? ''`)).trim());
      if (i === 1) await shot('6a-fix');
      if (i === 2) await shot('6b-add');
      await clear();
    }
    check(JSON.stringify(drafts) === JSON.stringify(W.drafts) && new Set(drafts).size === 3, `${tag}: three different drafts: ${drafts.join(' | ')}`);

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
