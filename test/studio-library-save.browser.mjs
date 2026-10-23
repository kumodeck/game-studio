// A swap in Assets, then back to the Scene and Save (⌘S): library.json is handed to the AI too.
//
//   node test/studio-library-save.browser.mjs
//
// WHY (end-to-end save check 2026-10-18): leaving Assets unmounts the Library panel. Its
// unsaved count went with it, so ⌘S on the Scene wrote only placement.json; library.json stayed a draft with no
// `saved` request, and the real AI (claude -p, following SKILL.md) said "the sail swap was not part of this save" and
// left the game's code alone. Now the panel's unsaved decisions are kept while it is closed (tools/library/index.ts).
//
// Steps (Lantern Cove, a temporary copy): move the crate (so Save has a placement change too) → Assets → sail.jpg →
// Replace… → sail-tanbark.jpg → back to the Scene → Save shows both changes → ⌘S → two `saved` requests
// (placement.json and library.json), library.json has the swap, Save shows nothing unsaved → Assets again: the swap is
// shown as saved (no unsaved count comes back).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { copyStarter, readStarters } from '../src/server/starters.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DBG = `document.querySelector('iframe').contentWindow.__gameStudio._debug`;
const click = (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent); if (!el || el.disabled) return false; el.click(); return true; })()`;
const saveLabel = `[...document.querySelectorAll('[data-action=save]')].find(b => b.offsetParent)?.textContent || ''`;
const unsaved = (label) => Number((/(\d+)\s*$/.exec(label) || [])[1] || 0);

const starter = (await readStarters(join(PKG, 'starters'))).find((s) => s.id === 'lantern-cove');
const root = mkdtempSync(join(tmpdir(), 'studio-library-save-'));
await copyStarter(starter, root);
const lines = [];
// No KUMODeck sign-in (studio-library-shelf, 2026-10-23): the Library reads it at once now for its "✦ Make with AI" words,
// and the real ~/.kumo of the machine running this must not be read (nor its balance land in a picture).
const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: (l) => lines.push(l) });
const browser = await launch();
const page = await newPage(browser, { width: 1280, height: 800 });
const ok = (s) => console.log(`  ✓ ${s}`);
const requests = () => (existsSync(join(root, '.studio/requests')) ? readdirSync(join(root, '.studio/requests')) : []).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(root, '.studio/requests', f), 'utf8')));
try {
  await page.goto(srv.url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 90000);
  await sleep(1500);

  // A placement change (the crate's numbers, as typed in the card).
  await page.eval(`window.studioShell.actions.select('crate')`);
  await page.waitFor(`!!document.querySelector('.card .num input')`, 5000);
  await page.eval(`(() => { const i = document.querySelector('.card .num input'); i.value = String(Number(i.value) + 2); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await page.waitFor(`/\\d/.test(${saveLabel})`, 5000);
  const one = unsaved(await page.eval(saveLabel));
  ok(`moved the crate: Save · ${one}`);

  // The swap in Assets.
  await page.eval(click('[data-tool=library]'));
  await page.waitFor(`!!document.querySelector('.assets-page .gsl-tile[data-path="assets/sail.jpg"]')`, 20000);
  await page.eval(click('.assets-page .gsl-tile[data-path="assets/sail.jpg"]'));
  await page.waitFor(`!!document.querySelector('.gsl-replace .gsl-primary')`, 5000);
  await page.eval(click('.gsl-replace .gsl-primary'));
  await page.waitFor(`!!document.querySelector('.gsl-picker [data-path="assets/sail-tanbark.jpg"]')`, 5000);
  await page.eval(click('.gsl-picker [data-path="assets/sail-tanbark.jpg"]'));
  await sleep(800);
  assert.equal(unsaved(await page.eval(saveLabel)), one + 1, 'the swap is not counted in Save');
  ok('swapped sail.jpg → sail-tanbark.jpg in Assets');

  // Back to the Scene: the swap is still counted.
  await page.eval(click('[data-tool=placement]'));
  await sleep(800);
  assert.equal(unsaved(await page.eval(saveLabel)), one + 1, `back on the Scene, Save forgot the swap ("${await page.eval(saveLabel)}")`);
  ok(`back on the Scene: Save · ${one + 1} (the swap still counted)`);

  // ⌘S.
  await page.eval(`(document.activeElement?.blur?.(), window.focus())`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', modifiers: 4, windowsVirtualKeyCode: 83 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', modifiers: 4, windowsVirtualKeyCode: 83 });
  for (let i = 0; i < 50 && requests().filter((r) => r.kind === 'saved').length < 2; i++) await sleep(100);
  const saved = requests().filter((r) => r.kind === 'saved').flatMap((r) => r.files).sort();
  assert.deepEqual(saved, ['library.json', 'placement.json'], `saved requests: ${JSON.stringify(saved)}`);
  assert.ok(lines.some((l) => l.startsWith('studio: saved library.json')), lines.join('\n'));
  const lib = JSON.parse(readFileSync(join(root, 'library.json'), 'utf8'));
  assert.deepEqual(lib.replace.map((r) => [r.from, r.to]), [['assets/sail.jpg', 'assets/sail-tanbark.jpg']]);
  await page.waitFor(`!/\\d/.test(${saveLabel})`, 5000);
  ok('⌘S: two requests (placement.json, library.json), library.json has the swap, nothing unsaved');

  // Assets again: the swap is the saved state now (no unsaved count comes back).
  await page.eval(click('[data-tool=library]'));
  await page.waitFor(`!!document.querySelector('.assets-page .gsl-tile[data-path="assets/sail.jpg"]')`, 20000);
  await sleep(800);
  assert.equal(unsaved(await page.eval(saveLabel)), 0, `Assets again: Save shows "${await page.eval(saveLabel)}"`);
  ok('Assets again: nothing unsaved');
  const errors = page.logs.filter((l) => l.startsWith('exception'));
  assert.deepEqual(errors, [], 'page errors');
  console.log('studio-library-save: ok');
} finally {
  await page.close();
  await browser.close();
  await srv.close();
  rmSync(root, { recursive: true, force: true });
}
