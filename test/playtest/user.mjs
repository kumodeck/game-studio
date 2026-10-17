// "The first five minutes" as a newcomer does them, in one headless browser:
// open -> press a thing -> move it -> turn it -> size it -> copy it -> type one
// English sentence in the box at the bottom -> Save -> look at placement.json
// -> Play. Nothing is read first: the person only uses what is on screen.
//
// WHY this is not another studio-e2e: the e2e tests stop at the first wrong
// thing and say nothing about how it felt. Here every step runs even after an
// earlier one went wrong, and each one leaves a picture, a time ("how long did
// I wait") and, when something was off, one "stumble" line for the report.
// Nothing is fixed here; the people who own the editor do that.
//
// The page is the editor started the way the skill starts it (SKILL.md §3):
// `node <skill>/bin/studio.mjs <folder> --no-open`, the URL from its
// `studio: ready` line. Only the target worktree's files are run; nothing is
// written there (the game is a temporary copy, HOME is a temporary folder).
//
// Finding things on screen: what a person sees (buttons, the card, the strip in
// the game) is found by its markup; where an object is drawn comes from the
// editor's own debug list (`__gameStudio._debug`), which stands in for the
// person's eyes. When a newer build renames something, the step records
// "not found" as a stumble instead of stopping.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, newPage } from '../adapters-2d/cdp.mjs';
import { clock, shooter, startVideo } from './recorder.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A person looks for a moment before the next action. Not counted in any wait.
const LOOK_MS = 700;
const DBG = `document.querySelector('iframe')?.contentWindow?.__gameStudio?._debug`;
const ROOT = `document.querySelector('iframe')?.contentDocument?.querySelector('[data-studio-ui]')?.shadowRoot`;
export const SENTENCE = 'Put three lighthouses around this one';

export const LAYOUTS = {
  pc: { width: 1280, height: 800, mobile: false, video: { maxWidth: 1280, maxHeight: 800 } },
  phone: { width: 390, height: 844, mobile: true, video: { maxWidth: 390, maxHeight: 844 } },
};

/** Start `studio.mjs <folder> --no-open` and wait for its ready line. */
export function startEditor({ studioBin, folder, home, timeoutMs = 30000 }) {
  const t0 = Date.now();
  const proc = spawn(process.execPath, [studioBin, folder, '--no-open'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  const err = [];
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push({ s: (Date.now() - t0) / 1000, line: buf.slice(0, i) });
      buf = buf.slice(i + 1);
    }
  });
  proc.stderr.on('data', (d) => err.push(String(d)));
  const ready = new Promise((resolve) => {
    const end = Date.now() + timeoutMs;
    const tick = () => {
      const r = lines.find((l) => l.line.startsWith('studio: ready '));
      if (r) return resolve({ url: r.line.slice('studio: ready '.length).trim(), s: r.s });
      if (proc.exitCode !== null || Date.now() > end) return resolve({ url: null, s: (Date.now() - t0) / 1000, exit: proc.exitCode });
      setTimeout(tick, 50);
    };
    tick();
  });
  return {
    proc, lines, err, ready,
    has: (prefix) => lines.find((l) => l.line.startsWith(prefix)),
    stop: () => new Promise((res) => {
      if (proc.exitCode !== null) return res();
      proc.once('exit', () => res());
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } res(); }, 3000);
    }),
  };
}

/**
 * One run: one sample folder (already a temporary copy) at one layout.
 * Returns { steps, stumbles, timing, shots, video, errors, texts, placement, requests }.
 */
export async function playRun({ studioBin, folder, home, layout, outDir, tag, cdnCache }) {
  const L = LAYOUTS[layout];
  const mobile = L.mobile;
  const steps = [];
  const stumbles = [];
  const texts = new Set();
  // weight: 3 = could not do it / broken, 2 = got through but lost, 1 = small.
  const stumble = (weight, text, shot) => stumbles.push({ weight, text, shot, layout });
  const c = clock();
  const editor = startEditor({ studioBin, folder, home });
  const browser = await launch();
  const page = await newPage(browser, { width: L.width, height: L.height, mobile, cdnCache });
  // cdp.mjs gives no per-page event hook; one page per browser here, so a method filter is enough.
  page.onEvent = (method, fn) => browser.on((m) => { if (m.method === method) fn(m.params); });
  // A newcomer in North America: English UI, US locale.
  await page.send('Emulation.setLocaleOverride', { locale: 'en-US' }).catch(() => {});
  await page.send('Network.enable').catch(() => {});
  await page.send('Network.setUserAgentOverride', { userAgent: (await page.eval('navigator.userAgent')).replace('HeadlessChrome', 'Chrome'), acceptLanguage: 'en-US,en' }).catch(() => {});
  const S = shooter(page, outDir, tag);
  const video = await startVideo(page, L.video);
  const j = async (expr) => JSON.parse((await page.eval(expr).catch(() => null)) || 'null');
  const press = (x, y) => (mobile ? page.tap(x, y) : page.click(x, y));
  const drag = (a, b, n = 12) => (mobile ? page.touchDrag(a.x, a.y, b.x, b.y, n) : page.mouseDrag(a.x, a.y, b.x, b.y, n));
  /** Visible element in the editor page -> its middle in page px. */
  const where = (sel) => j(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetWidth && x.checkVisibility?.() !== false);
    if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, label: (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().slice(0, 80) }); })()`);
  /** Button on the tool strip drawn inside the game frame -> page px. */
  const inStrip = (sel) => j(`(() => { const f = document.querySelector('iframe'); const root = ${ROOT}; if (!f || !root) return null;
    const b = root.querySelector(${JSON.stringify(sel)}); if (!b || b.hidden || !b.getBoundingClientRect().width) return null;
    const o = f.getBoundingClientRect(), r = b.getBoundingClientRect();
    return JSON.stringify({ x: o.left + r.left + r.width / 2, y: o.top + r.top + r.height / 2, label: (b.getAttribute('aria-label') || b.title || '').trim() }); })()`);
  const list = async () => (await j(`JSON.stringify(${DBG}?.list?.() || [])`)) || [];
  const box = (k) => j(`(() => { const f = document.querySelector('iframe').getBoundingClientRect(); const a = ${DBG}.anchor(${JSON.stringify(k)}); if (!a) return null;
    const r = a.rect; return JSON.stringify({ x: f.left + (r ? r.x + r.w / 2 : a.center[0]), y: f.top + (r ? r.y + r.h / 2 : a.center[1]), w: r?.w || a.size, h: r?.h || a.size, pose: a.pose }); })()`);
  const pose = async (k) => (await list()).find((i) => i.key === k)?.pose || null;
  const selectedName = () => page.eval(`document.querySelector('.card strong')?.textContent || ''`).catch(() => '');
  /** Collect every word the person can read right now (editor page + the strip inside the game). */
  const readTexts = async () => {
    const got = await j(`(() => { const out = new Set(); const add = (s) => { s = (s || '').replace(/\\s+/g, ' ').trim(); if (s && /[A-Za-z]/.test(s) && s.length < 200) out.add(s); };
      const walk = (root) => { for (const e of root.querySelectorAll('*')) { if (e.shadowRoot) walk(e.shadowRoot); if (e.closest?.('script,style')) continue;
        if (e.checkVisibility && !e.checkVisibility()) continue;
        for (const n of e.childNodes) if (n.nodeType === 3) add(n.textContent);
        add(e.getAttribute('aria-label')); add(e.title); if (e.placeholder) add(e.placeholder); } };
      walk(document); const r = ${ROOT}; if (r) walk(r); return JSON.stringify([...out]); })()`);
    for (const t of got || []) texts.add(t);
  };
  const step = async (name, fn) => {
    const a = Date.now();
    let ok = true;
    let note = '';
    try {
      note = (await fn()) || '';
    } catch (e) {
      ok = false;
      note = e.message.split('\n')[0];
    }
    await readTexts().catch(() => {});
    steps.push({ name, ok, s: (Date.now() - a) / 1000, note });
    await sleep(LOOK_MS);
    return ok;
  };
  const waitFor = (expr, ms) => page.waitFor(expr, ms);

  let target = null;
  // The object moved / turned / sized (the copy later becomes `target`; it is in "added", not "objects").
  let edited = null;
  let url = null;
  try {
    // ---- 1. open: how long until the editor answers, the page loads, the game is drawn ----
    await step('open', async () => {
      const r = await editor.ready;
      c.marks.push({ name: 'editor printed "studio: ready"', s: r.s, kind: 'since start' });
      if (!r.url) {
        stumble(3, `The editor never printed its URL (exit ${r.exit}): ${editor.err.join('').trim().slice(0, 200)}`);
        throw new Error('no studio: ready line');
      }
      url = r.url;
      await page.goto(url);
      c.mark('editor page loaded');
      await S.shot('loading', 'Right after the page loaded');
      try {
        await waitFor(`document.querySelectorAll('.obj').length > 0 && !!(${DBG})`, 45000);
      } catch {
        stumble(3, 'The game never showed its objects in the editor (45 s)', await S.shot('never-ready', 'Still not ready after 45 s'));
        throw new Error('objects never listed');
      }
      const s = c.mark('game drawn, objects listed');
      for (let i = 0; i < 50 && !editor.has('studio: check '); i++) await sleep(100);
      const chk = editor.has('studio: check ');
      if (chk) c.marks.push({ name: `self-check line (${chk.line.split(' ')[2]})`, s: chk.s, kind: 'since start' });
      if (chk && !chk.line.startsWith('studio: check ok')) stumble(2, `Self-check did not pass: "${chk.line}"`);
      if (s > 10) stumble(s > 20 ? 3 : 2, `${s.toFixed(1)} s from start to a usable game (goal: 10 s)`);
      await sleep(800);
      const hint = await page.eval(`(() => { const h = document.querySelector('.first-hint'); return h && !h.hidden ? h.textContent : ''; })()`).catch(() => '');
      await S.shot('open', `Opened. First-time line: ${hint ? `"${hint}"` : '(none)'}`);
      if (!hint) stumble(1, 'No first-time line telling what to do first', S.taken.at(-1).file);
      return `${(await list()).length} objects; first-time line: ${hint || '(none)'}`;
    });
    if (!url) return await finish();

    // ---- 2. press a thing in the game ----
    await step('press an object', async () => {
      const items = await list();
      const cands = [];
      for (const it of items) {
        const b = await box(it.key);
        if (!b || b.w < 12 || b.w > 300 || b.x < 20 || b.y < 20 || b.x > L.width - 20 || b.y > L.height - 140) continue;
        // Only where the game itself is under the finger (not a panel over it).
        if (!(await page.eval(`document.elementFromPoint(${b.x}, ${b.y}) === document.querySelector('iframe')`))) continue;
        cands.push({ ...it, b, score: Math.abs(b.w - 90) + (it.unstable ? 1000 : 0) });
      }
      cands.sort((p, q) => p.score - q.score);
      if (!cands.length) throw new Error('no object big enough and visible to press');
      const t = cands[0];
      const a = Date.now();
      await press(t.b.x, t.b.y);
      try {
        await waitFor(`!!document.querySelector('.card strong')?.textContent`, 4000);
      } catch {
        stumble(3, `Pressing "${t.label}" in the game did not pick it`, await S.shot('press-nothing', 'Pressed an object: nothing picked'));
        throw new Error('nothing picked');
      }
      c.marks.push({ name: 'press -> card shows', s: (Date.now() - a) / 1000, kind: 'took' });
      const name = await selectedName();
      const it = (await list()).find((i) => i.label === name) || t;
      target = { key: it.key, label: it.label };
      edited = target;
      const shotFile = await S.shot('picked', `Pressed "${name}"`);
      // The first-time line must not still say "Click an object to pick it" once something is picked (the intro
      // moving on to its next step — "2/4 Now drag it to move it" — is fine).
      if (await page.eval(`(() => { const h = document.querySelector('.first-hint'); return !!h && !h.hidden && !!h.offsetParent && (!h.dataset.intro || h.dataset.intro === 'pick'); })()`).catch(() => false)) {
        stumble(2, 'After picking, "pick an object" is still on screen (it later sits on top of the tool line)', shotFile);
      }
      return `picked "${name}"`;
    });

    // ---- 3. move: a newcomer grabs the thing itself and drags it ----
    await step('move (drag the object)', async () => {
      if (!target) throw new Error('nothing picked');
      const b = await box(target.key);
      const p0 = b.pose;
      await drag(b, { x: b.x + (mobile ? 50 : 90), y: b.y + (mobile ? 30 : 40) });
      await sleep(300);
      let p1 = await pose(target.key);
      if (JSON.stringify(p1?.p) !== JSON.stringify(p0.p)) {
        await S.shot('moved', 'Dragged the object itself');
        return 'the object follows the drag';
      }
      // Fallback the person would find next: the move button on the strip.
      const mv = await inStrip('[data-studio-handle=move]');
      stumble(2, 'Dragging the picked object itself did not move it', await S.shot('drag-nothing', 'Dragged the object: it stayed'));
      if (!mv) throw new Error('no move button either');
      await drag(mv, { x: mv.x + 80, y: mv.y + 40 });
      p1 = await pose(target.key);
      if (JSON.stringify(p1?.p) === JSON.stringify(p0.p)) throw new Error('move button did not move it either');
      await S.shot('moved', 'Moved with the strip button');
      return 'moved only with the strip button';
    });

    /** A strip tool: tap its button, then drag from a spot away from the object (the strip's "choose, then drag"). */
    const stripTool = async (handle, d, check, label) => {
      if (!target) throw new Error('nothing picked');
      const btn = await inStrip(`[data-studio-handle=${handle}]`);
      if (!btn) {
        stumble(3, `No ${label} button on the tool strip`, await S.shot(`no-${handle}`, `Looked for ${label}`));
        throw new Error(`no ${handle} button`);
      }
      const p0 = await pose(target.key);
      await press(btn.x, btn.y);
      await sleep(350);
      // 3D turn opens axis choices; a newcomer takes the first ("turn", around up).
      const axis = await inStrip('[data-studio-choice="axis:y"]');
      if (axis) {
        await S.shot(`${handle}-choices`, `${label}: the strip asks which way`);
        await press(axis.x, axis.y);
        await sleep(300);
      }
      const hint = await j(`(() => { const e = ${ROOT}?.querySelector('.hint'); return JSON.stringify(e && e.style.display !== 'none' ? e.textContent : null); })()`);
      // Two lines in the same place: the tool's own line and the editor's first-time line (stumble 5 of the first run).
      if (hint && (await page.eval(`(() => { const h = document.querySelector('.first-hint'); return !!h && !h.hidden && !!h.offsetParent; })()`).catch(() => false))) {
        stumble(2, `${label}: the tool's line and the first-time line are on screen together`, await S.shot(`${handle}-two-lines`, `${label}: two lines at once`));
      }
      // Start the drag where the game is under the pointer, away from the object and the strip.
      const b = await box(target.key);
      const fr = await j(`JSON.stringify(document.querySelector('iframe').getBoundingClientRect())`);
      let start = null;
      let best = -1;
      for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.25, 0.4, 0.55]) {
        const pt = { x: fr.left + fr.width * fx, y: fr.top + fr.height * fy };
        if (!(await page.eval(`document.elementFromPoint(${pt.x}, ${pt.y}) === document.querySelector('iframe')`))) continue;
        const dd = Math.min(Math.hypot(pt.x - b.x, pt.y - b.y), Math.hypot(pt.x - btn.x, pt.y - btn.y));
        if (dd > best) { best = dd; start = pt; }
      }
      if (!start) throw new Error('no free spot on the game to drag from');
      let readout = null;
      const end = { x: start.x + d[0], y: start.y + d[1] };
      // Hold before release to read the readout next to the strip, like a person watching it.
      if (mobile) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
        for (let i = 1; i <= 12; i++) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (d[0] * i) / 12, y: start.y + (d[1] * i) / 12, id: 1 }] });
      } else {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
        for (let i = 1; i <= 12; i++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (d[0] * i) / 12, y: start.y + (d[1] * i) / 12, button: 'left', buttons: 1 });
      }
      readout = await j(`(() => { const e = ${ROOT}?.querySelector('.chip'); return JSON.stringify(e && e.style.display !== 'none' ? e.textContent : null); })()`);
      await S.shot(handle, `${label}: while dragging (readout ${readout ? `"${readout}"` : 'none'})`);
      if (mobile) await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(300);
      const p1 = await pose(target.key);
      if (!check(p0, p1)) {
        stumble(3, `${label}: tapped the button and dragged, the object did not change`, S.taken.at(-1).file);
        throw new Error(`${handle} did nothing`);
      }
      return `${label}${hint ? ` (first-time line: "${hint}")` : ''}; readout ${readout ? `"${readout}"` : 'none'}`;
    };
    const s0 = (p) => (Array.isArray(p?.s) ? p.s[0] : p?.s ?? 1);
    await step('turn', () => stripTool('rotate', [105, 0], (a, b) => Math.abs((b?.r ?? 0) - (a?.r ?? 0)) > 0.05, 'Turn'));
    await step('size', () => stripTool('scale', [70, -40], (a, b) => Math.abs(s0(b) - s0(a)) > 0.05, 'Size'));

    // ---- 6. copy: the card's Copy button (no shortcut known yet) ----
    await step('copy', async () => {
      if (!target) throw new Error('nothing picked');
      const n0 = (await list()).length;
      let btn = await where('.card [data-action=copy]');
      if (!btn) {
        // Phone: maybe behind "more".
        const more = await where('.card [data-action=more], .card [aria-haspopup]');
        if (more) {
          stumble(1, 'Copy is hidden behind another button on the card');
          await press(more.x, more.y);
          await sleep(300);
          btn = await where('[data-action=copy]');
        }
      }
      if (!btn) {
        stumble(3, 'No Copy button on the card', await S.shot('no-copy', 'Looked for Copy'));
        throw new Error('no copy button');
      }
      const a = Date.now();
      await press(btn.x, btn.y);
      try {
        await waitFor(`(${DBG}.list().length) > ${n0}`, 5000);
      } catch {
        stumble(3, 'Pressed Copy, no copy appeared', await S.shot('copy-nothing', 'Pressed Copy'));
        throw new Error('no copy');
      }
      c.marks.push({ name: 'Copy -> copy appears', s: (Date.now() - a) / 1000, kind: 'took' });
      await sleep(300);
      await S.shot('copied', `Pressed Copy ("${btn.label}")`);
      // The copy is picked now (as in most editors); the next steps are about it.
      const now = await selectedName();
      const it = (await list()).find((i) => i.label === now);
      if (it) target = { key: it.key, label: it.label };
      return `copy appeared (${n0} -> ${(await list()).length} objects), picked now: "${now}"`;
    });

    // ---- 7. one English sentence in the box at the bottom ----
    await step('ask (type one sentence)', async () => {
      const box0 = await where('.ask-input');
      if (!box0) {
        stumble(3, 'No text box at the bottom', await S.shot('no-ask', 'Looked for the box'));
        throw new Error('no ask box');
      }
      const ph = await page.eval(`document.querySelector('.ask-input').placeholder`).catch(() => '');
      await press(box0.x, box0.y);
      await sleep(400);
      const pal = await page.eval(`!!document.querySelector('.palette')?.offsetParent`).catch(() => false);
      if (pal) await S.shot('ask-focus', 'Pressed the box: a list opened over it');
      await page.send('Input.insertText', { text: SENTENCE });
      await sleep(300);
      await S.shot('ask-typed', `Typed "${SENTENCE}" (placeholder was "${ph}")`);
      const before = new Set(existsSync(join(folder, '.studio/requests')) ? readdirSync(join(folder, '.studio/requests')) : []);
      const a = Date.now();
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      let file = null;
      for (let i = 0; i < 50 && !file; i++) {
        await sleep(100);
        const now = existsSync(join(folder, '.studio/requests')) ? readdirSync(join(folder, '.studio/requests')) : [];
        file = now.find((f) => !before.has(f) && f.endsWith('.json'));
      }
      if (!file) {
        stumble(3, 'Typed a sentence and pressed Enter: no request was written for the AI', await S.shot('ask-nothing', 'After Enter'));
        throw new Error('no request file');
      }
      c.marks.push({ name: 'Enter -> request file written', s: (Date.now() - a) / 1000, kind: 'took' });
      await sleep(600);
      const req = JSON.parse(readFileSync(join(folder, '.studio/requests', file), 'utf8'));
      const note = await page.eval(`[...document.querySelectorAll('.ai-caption :is(.ai-line,.ask-note)')].filter(e => !e.hidden && e.textContent).map(e => e.textContent).join(' | ')`).catch(() => '');
      await S.shot('ask-sent', `After Enter: "${note}"`);
      if (req.text !== SENTENCE) stumble(2, `The request's text is "${req.text}", not what was typed`);
      if (!(req.objects || []).some((o) => o.key === target?.key)) stumble(1, `The request is not about the picked "${target?.label}" (objects: ${(req.objects || []).map((o) => o.key).join(', ') || 'none'})`);
      // With no AI connected nothing answers; does the screen say so within a moment?
      return `.studio/requests/${file} kind=${req.kind} objects=${(req.objects || []).map((o) => o.key).join(',')}; screen says: ${note || '(nothing)'}`;
    });

    // ---- 8. Save ----
    let saved = null;
    await step('Save', async () => {
      await page.eval(`document.activeElement?.blur?.()`).catch(() => {});
      const b = await where('[data-action=save]');
      if (!b) {
        stumble(3, 'No Save button', await S.shot('no-save', 'Looked for Save'));
        throw new Error('no save');
      }
      const a = Date.now();
      await press(b.x, b.y);
      for (let i = 0; i < 60 && !editor.has('studio: saved'); i++) await sleep(100);
      if (!editor.has('studio: saved')) {
        stumble(3, `Pressed "${b.label}": nothing was handed to the AI`, await S.shot('save-nothing', 'Pressed Save'));
        throw new Error('no saved line');
      }
      c.marks.push({ name: 'Save -> "studio: saved" line', s: (Date.now() - a) / 1000, kind: 'took' });
      await sleep(500);
      const state = await page.eval(`document.querySelector('.save-state')?.offsetParent ? document.querySelector('.save-state').textContent : ''`).catch(() => '');
      await S.shot('saved', `Pressed "${b.label}"; screen says "${state}"`);
      if (!state) stumble(1, 'After Save the screen did not say it was saved', S.taken.at(-1).file);
      // ---- 9. placement.json ----
      const f = join(folder, 'placement.json');
      if (!existsSync(f)) throw new Error('no placement.json');
      saved = JSON.parse(readFileSync(f, 'utf8'));
      const o = saved.objects?.[edited?.key];
      const problems = [];
      if (!o) problems.push(`no entry for the edited "${edited?.key}"`);
      else {
        if (!o.t && !o.p && !o.now) problems.push('entry has no new pose');
      }
      if (!(saved.added || []).length) problems.push('the copy is not in "added"');
      if (problems.length) stumble(2, `placement.json: ${problems.join('; ')}`);
      return `"${b.label}" -> ${state || '(no word on screen)'}; placement.json: ${Object.keys(saved.objects || {}).length} changed, ${(saved.added || []).length} added`;
    });

    // ---- 9b. no AI is connected: what does the screen say while the person waits? ----
    // The editor says at once when no AI watches (before 10/16: a nudge after about 20 s).
    await step('wait for the AI (none connected)', async () => {
      const read = () => page.eval(`[...document.querySelectorAll('.ai-caption :is(.ai-line,.ask-note)')].filter(e => !e.hidden && e.textContent).map(e => e.textContent.trim()).join(' | ')`).catch(() => '');
      const first = await read();
      const a = Date.now();
      // Since the AI-feel pass (10/16) the editor knows at once that no AI watches and says what to do.
      if (/look|見て|watching|見ていません/i.test(first)) {
        c.marks.push({ name: 'after Save, until the screen says what to do', s: 0, kind: 'took' });
        await S.shot('waiting', `At once with no AI: "${first}"`);
        return `at once: "${first}"`;
      }
      let now = first;
      while (Date.now() - a < 25000 && now === first) {
        await sleep(500);
        now = await read();
      }
      const s = (Date.now() - a) / 1000;
      if (now !== first) c.marks.push({ name: 'after Save, until the screen says what to do', s, kind: 'took' });
      const file = await S.shot('waiting', `After ${s.toFixed(0)} s with no AI: "${now}"`);
      if (now === first) stumble(2, `Waited 25 s after Save with no AI: the screen still says "${first}"`, file);
      return now === first ? `no change in 25 s: "${first}"` : `after ${s.toFixed(1)} s: "${now}"`;
    });

    // ---- 10. Play ----
    await step('Play', async () => {
      const b = await where('[data-action=play]');
      if (!b) {
        stumble(3, 'No Play button', await S.shot('no-play', 'Looked for Play'));
        throw new Error('no play');
      }
      // The game frame reloads for Play: wait for a NEW document (the old one is already "complete").
      await page.eval(`window.__playtestDoc = document.querySelector('iframe')?.contentDocument, true`);
      const a = Date.now();
      await press(b.x, b.y);
      try {
        // "Running" = the new game has come through two animation frames: its start-up code ran and its loop drew at
        // least once (speed pass, 2026-10-17). Before, a loaded page with an empty canvas counted, which read 0.2 s
        // for a game still compiling its first frame.
        await waitFor(`(() => { const f = document.querySelector('iframe'); const d = f?.contentDocument; const w = f?.contentWindow;
          if (!(document.querySelector('.shell')?.dataset.playing === 'on' && d && d !== window.__playtestDoc && d.readyState === 'complete' && !!d.querySelector('canvas, body > *'))) return false;
          if (w.__playtestFrames === undefined) { w.__playtestFrames = 0; const tick = () => { if (++w.__playtestFrames < 2) w.requestAnimationFrame(tick); }; w.requestAnimationFrame(tick); }
          return w.__playtestFrames >= 2; })()`, 15000);
      } catch {
        stumble(3, 'Pressed Play: the game did not start', await S.shot('play-nothing', 'Pressed Play'));
        throw new Error('not playing');
      }
      c.marks.push({ name: 'Play -> game running', s: (Date.now() - a) / 1000, kind: 'took' });
      await sleep(1500);
      await S.shot('playing', 'Playing');
      await sleep(1500);
      await S.shot('playing-later', 'Playing, 1.5 s later');
      const note = await page.eval(`document.querySelector('.play-note')?.textContent || ''`).catch(() => '');
      return `playing; note "${note}"`;
    });
    return await finish();
  } finally {
    // finish() already ran on the happy path; this only cleans up.
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    await editor.stop();
  }

  async function finish() {
    const vid = await video.stop(join(outDir, `${tag}.mp4`));
    const errors = page.logs.filter((l) => /^(exception|error|assert)/.test(l));
    const warnings = page.logs.filter((l) => /^warning/.test(l));
    if (errors.length) stumble(2, `${errors.length} console error(s): ${errors[0].slice(0, 160)}`);
    const requests = existsSync(join(folder, '.studio/requests')) ? readdirSync(join(folder, '.studio/requests')) : [];
    let placement = null;
    try { placement = JSON.parse(readFileSync(join(folder, 'placement.json'), 'utf8')); } catch { /* none */ }
    return {
      layout, steps, stumbles, timing: c.marks, shots: S.taken, video: vid, errors, warnings,
      texts: [...texts], placement, requests, stdout: editor.lines.map((l) => `${l.s.toFixed(1)}s ${l.line}`),
    };
  }
}
