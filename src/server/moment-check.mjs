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

/** The CLI's end of it. */
export async function momentCheck(root, entry, at) {
  const r = await runMomentCheck({ rootReal: realpathSync(root), entry, at });
  process.stdout.write(r.line + '\n');
  return r.status === 'ok' ? 0 : r.status === 'failed' ? 1 : 3;
}
