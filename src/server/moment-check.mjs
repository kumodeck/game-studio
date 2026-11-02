// `studio.mjs <folder> --check-moment [seconds]`: the AI's own check of a game's checkpoint hooks (pause-edit stage 3,
// 2026-10-28; SKILL.md "Checkpoints", CONTRACT.md §1.14.1).
//
// WHY: the first real Claude run of stage 3 wrote save() / load() in 61 s, said "I have not tried keeping one and opening
// it", and its load() called `fire().position` on a fire() that returns nothing — the person's first checkpoint then said
// "The game changed, so this checkpoint can't open". The AI cannot press ⚑ in the person's editor, so it gets the same
// round trip here, on the game as it is played (no editor), in a private headless Chrome (as --shot):
//   1. a tab plays the game for `seconds` (default 6: past the start, where enemies and bullets exist), then calls
//      save() and checks it is JSON data — the picture .studio/shot/moment-kept.png;
//   2. a second tab opens the game fresh with a script before the game's own that, at the game's FIRST frame, calls
//      load(that moment) before the frame runs (the editor's way: bridge/moment-load.ts), then lets the game go on —
//      the picture .studio/shot/moment-opened.png a moment later, the errors, the frames that ran.
// One line back: `studio: moment check ok …` (exit 0), `studio: moment check failed: …` (exit 1: what threw, where),
// `studio: moment check skipped: …` (exit 3: no Chrome, or no hooks).
import { realpathSync } from 'node:fs';
import { writeStudioFile } from './files.mjs';
import { ASK_MOMENTS_KEPT, askMomentId, getAskMoment } from './ask-moments.mjs';
import { findHeadlessChrome, launchHeadless, openTab, pause, startPlainServer } from './view-check.mjs';

/** The default play time before save(), and the most a person may ask for. */
export const MOMENT_CHECK_AT_S = 6;
const MOMENT_CHECK_MAX_S = 120;
/** After load, how long the game runs before its picture (a few frames: the first picture is the loaded one). */
const MOMENT_CHECK_AFTER_MS = 200;

/** In the first tab: save() now, as JSON text, or why not. */
const SAVE_NOW = `(() => {
  const k = globalThis[Symbol.for('game-studio.moment')];
  if (!k || typeof k.save !== 'function' || typeof k.load !== 'function') return { none: true };
  let m;
  try { m = k.save(); } catch (e) { return { error: 'save() threw: ' + String(e && e.stack || e).split('\\n').slice(0, 2).join(' ') }; }
  let s;
  try { s = JSON.stringify(m); } catch (e) { return { error: 'save() returned something that is not plain data (' + e.message + ')' }; }
  if (s === undefined) return { error: 'save() returned nothing' };
  return { json: s, keys: m && typeof m === 'object' ? Object.keys(m).slice(0, 12) : [] };
})()`;

/**
 * The script put before the game's own in the second tab (pure text; test/checkpoint-files.test.mjs runs it): at the
 * game's first requestAnimationFrame callback, load(moment) first — awaited when it returns a promise — then the
 * callback. Errors and frames are kept on window.__studioMomentCheck.
 */
export function momentLoadScript(json) {
  return `(() => {
  const M = JSON.parse(${JSON.stringify(json)});
  const out = window.__studioMomentCheck = { loaded: false, none: false, error: null, errors: [], frames: 0 };
  addEventListener('error', (e) => { if (e.message) out.errors.push(String(e.message) + (e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : '')); });
  addEventListener('unhandledrejection', (e) => out.errors.push(String(e.reason && e.reason.message || e.reason)));
  const raf = window.requestAnimationFrame.bind(window);
  let first = true;
  window.requestAnimationFrame = function requestAnimationFrame(cb) {
    if (!first) return raf((t) => { out.frames++; cb(t); });
    first = false;
    return raf(async (t) => {
      const k = globalThis[Symbol.for('game-studio.moment')];
      if (!k || typeof k.load !== 'function') out.none = true;
      else {
        try {
          const r = k.load(M);
          if (r && typeof r.then === 'function') await r;
          out.loaded = true;
        } catch (e) {
          const st = String(e && e.stack || '').split('\\n').slice(1, 3).map((l) => l.trim().replace(/^at /, '').replace(/https?:\\/\\/[^/]+\\//, '')).join(' ← ');
          out.error = String(e && e.message || e) + (st ? ' (' + st + ')' : '');
          return;
        }
      }
      out.frames++;
      cb(t);
    });
  };
})();`;
}

/** @param {{ rootReal: string, entry: string, at?: number }} o */
export async function runMomentCheck(o) {
  const at = Math.min(MOMENT_CHECK_MAX_S, Math.max(0.5, Number.isFinite(o.at) ? o.at : MOMENT_CHECK_AT_S));
  const bin = findHeadlessChrome();
  if (!bin) return { status: 'skipped', line: 'studio: moment check skipped: no Chrome or Chromium found (set STUDIO_CHROME to its path)' };
  const plain = await startPlainServer(o.rootReal);
  let browser;
  try {
    browser = await launchHeadless(bin);
  } catch (e) {
    await plain.close();
    return { status: 'skipped', line: `studio: moment check skipped: headless Chrome could not start here (${String(e && e.message).split('\n')[0]})` };
  }
  try {
    const url = `${plain.origin}/${o.entry.split('/').map(encodeURIComponent).join('/')}`;
    // 1. Played for `at` seconds, then save().
    const a = await openTab(browser, 1280, 800);
    await a.goto(url);
    await pause(at * 1000);
    const saved = await a.eval(SAVE_NOW).catch((e) => ({ error: `the page could not be read (${e.message})` }));
    if (saved.none) return { status: 'skipped', line: 'studio: moment check skipped: the game has no codeMoment() save and load (SKILL.md "Checkpoints")' };
    if (saved.error) return { status: 'failed', line: `studio: moment check failed: ${saved.error} — fix save() (SKILL.md "Checkpoints")` };
    const kept = await writeStudioFile(o.rootReal, 'shot/moment-kept.png', await a.screenshot());
    await a.close();
    // 2. A fresh run, load(moment) before its first frame.
    const b = await openTab(browser, 1280, 800);
    await b.beforePage(momentLoadScript(saved.json));
    await b.goto(url);
    await b.waitFor('window.__studioMomentCheck && (window.__studioMomentCheck.loaded || window.__studioMomentCheck.error || window.__studioMomentCheck.none)', 15000).catch(() => null);
    await pause(MOMENT_CHECK_AFTER_MS);
    const r = (await b.eval('window.__studioMomentCheck || null').catch(() => null)) || { errors: [] };
    const opened = await writeStudioFile(o.rootReal, 'shot/moment-opened.png', await b.screenshot());
    await b.close();
    const what = `kept at ${at} s (${saved.json.length} characters: ${saved.keys.join(', ')})`;
    if (r.error) return { status: 'failed', line: `studio: moment check failed: load(m) threw ${JSON.stringify(r.error)} on the moment ${what} — fix load() (SKILL.md "Checkpoints"); pictures ${kept} ${opened}` };
    if (r.none) return { status: 'failed', line: `studio: moment check failed: load is gone in a fresh run (codeMoment() is called later than the game's first frame?) — ${what}` };
    if (!r.loaded) return { status: 'failed', line: `studio: moment check failed: the game never asked for a frame in 15 s, so load(m) was not called — ${what}` };
    if (r.errors.length) return { status: 'failed', line: `studio: moment check failed: after load(m) the game threw ${JSON.stringify(r.errors[0])}${r.errors.length > 1 ? ` (+${r.errors.length - 1})` : ''} — ${what}; pictures ${kept} ${opened}` };
    if (!r.frames) return { status: 'failed', line: `studio: moment check failed: after load(m) the game drew no frame — ${what}` };
    return { status: 'ok', line: `studio: moment check ok — ${what}, loaded into a fresh run before its first frame, then ${r.frames} frames ran with no error; look at ${kept} and ${opened}: the same moment` };
  } finally {
    await browser.close();
    await plain.close();
  }
}

/** Before the game's own script: its uncaught errors, kept for the line (the time-only run has no load script). */
const ERRORS_KEPT = `(() => { const e = window.__studioErrors = []; addEventListener('error', (x) => { if (x.message && e.length < 20) e.push(String(x.message)); }); })();`;

/** How long a game without save / load may be played to reach an ask's time (the same cap as `--check-moment [s]`). */
export const BACK_MAX_S = MOMENT_CHECK_MAX_S;

/**
 * `--check-moment <back>` (pause-ask stage 3, 2026-11-02; SKILL.md "Paused"): the moment a paused request was asked
 * from, opened with the game's code as it is NOW, and its picture (.studio/shot/moment-back.png) — so the AI looks at
 * the same moment the person will see behind ▶ Try from 0:05.02, before it replies.
 * WHY a separate path from the check above: that one makes its own moment (plays 6 s, save()); this one opens the
 * person's (the ask's `back`, ask-moments.mjs). A back with `moment` loads it before the first frame (the editor's way)
 * and shoots right after; a back without one (the game had no save / load when it was asked) plays from the start to
 * the same time — the line says "same time, new run", as the editor's Try does.
 * @param {{ rootReal: string, entry: string, back: { time: number, moment?: unknown } }} o
 */
export async function runBackCheck(o) {
  const t = Math.round(o.back.time * 100) / 100;
  const bin = findHeadlessChrome();
  if (!bin) return { status: 'skipped', line: 'studio: moment check skipped: no Chrome or Chromium found (set STUDIO_CHROME to its path)' };
  const plain = await startPlainServer(o.rootReal);
  let browser;
  try {
    browser = await launchHeadless(bin);
  } catch (e) {
    await plain.close();
    return { status: 'skipped', line: `studio: moment check skipped: headless Chrome could not start here (${String(e && e.message).split('\n')[0]})` };
  }
  try {
    const url = `${plain.origin}/${o.entry.split('/').map(encodeURIComponent).join('/')}`;
    const tab = await openTab(browser, 1280, 800);
    if (o.back.moment === undefined) {
      // No moment kept (no save / load then): the same time of a new run. If the game HAS save / load now, say so —
      // the next ask from that pause keeps the whole moment.
      if (t > BACK_MAX_S) return { status: 'skipped', line: `studio: moment check skipped: the ask was at ${t} s, more than ${BACK_MAX_S} s to play to without save / load` };
      await tab.beforePage(ERRORS_KEPT);
      await tab.goto(url);
      await pause(t * 1000);
      const errors = await tab.eval('(window.__studioErrors || []).slice(0, 3)').catch(() => []);
      const hooks = await tab.eval(SAVE_NOW).then((r) => !r.none, () => false);
      const shot = await writeStudioFile(o.rootReal, 'shot/moment-back.png', await tab.screenshot());
      const after = hooks ? ' (the game has save / load now: the next ask from a pause keeps the whole moment)' : ' — the game has no codeMoment() save / load: write them (SKILL.md "Checkpoints") so the person\'s ▶ Try opens the same moment, then check again';
      return { status: 'ok', line: `studio: moment check ok — same time, new run: played from the start to ${t} s; look at ${shot}${errors.length ? ` (errors: ${JSON.stringify(errors[0])})` : ''}${after}` };
    }
    let json;
    try {
      json = JSON.stringify(o.back.moment);
    } catch {
      json = undefined;
    }
    if (json === undefined) return { status: 'failed', line: 'studio: moment check failed: the ask\'s moment is not JSON data' };
    await tab.beforePage(momentLoadScript(json));
    await tab.goto(url);
    await tab.waitFor('window.__studioMomentCheck && (window.__studioMomentCheck.loaded || window.__studioMomentCheck.error || window.__studioMomentCheck.none)', 15000).catch(() => null);
    // A frame or two: the first picture after load(m) is the loaded moment (the editor's Try holds right there).
    await pause(60);
    const r = (await tab.eval('window.__studioMomentCheck || null').catch(() => null)) || { errors: [] };
    const shot = await writeStudioFile(o.rootReal, 'shot/moment-back.png', await tab.screenshot());
    if (r.none) return { status: 'failed', line: `studio: moment check failed: the game has no codeMoment() load() now, so the ask's moment at ${t} s cannot open — put save / load back (SKILL.md "Checkpoints"); picture ${shot}` };
    if (r.error) return { status: 'failed', line: `studio: moment check failed: load(m) threw ${JSON.stringify(r.error)} on the ask's moment at ${t} s — the change broke load(), or the moment's data no longer fits it; picture ${shot}` };
    if (!r.loaded) return { status: 'failed', line: `studio: moment check failed: the game never asked for a frame in 15 s, so the ask's moment at ${t} s did not open; picture ${shot}` };
    if (r.errors.length) return { status: 'failed', line: `studio: moment check failed: after load(m) the game threw ${JSON.stringify(r.errors[0])} at the ask's moment (${t} s); picture ${shot}` };
    return { status: 'ok', line: `studio: moment check ok — the ask's moment at ${t} s opened with the code as it is now; look at ${shot}: is what was asked for there (the marks: the request's shotMarked)?` };
  } finally {
    await browser.close();
    await plain.close();
  }
}

/** The CLI's end of `--check-moment <back>`: the back read from .studio/asks/. */
export async function backCheck(root, entry, back) {
  const rootReal = realpathSync(root);
  const id = askMomentId(back);
  const b = id ? await getAskMoment(rootReal, id) : null;
  if (!b) {
    process.stdout.write(`studio: moment check failed: no ask's moment ${JSON.stringify(back)} (the request's "back", .studio/asks/<id>.json; only the newest ${ASK_MOMENTS_KEPT} are kept)\n`);
    return 1;
  }
  const r = await runBackCheck({ rootReal, entry, back: b });
  process.stdout.write(r.line + '\n');
  return r.status === 'ok' ? 0 : r.status === 'failed' ? 1 : 3;
}

/** The CLI's end of it. */
export async function momentCheck(root, entry, at) {
  const r = await runMomentCheck({ rootReal: realpathSync(root), entry, at });
  process.stdout.write(r.line + '\n');
  return r.status === 'ok' ? 0 : r.status === 'failed' ? 1 : 3;
}
