// The view check (`studio.mjs <game> --check-view`, src/server/view-check.mjs) in a real headless
// browser: the game must look the same inside the editor as when it is played.
//
//   node --test test/view-check.browser.mjs
//   STUDIO_CHROME=<path>   browser binary (default: first Chrome found)
//
// Regression for the a trial on 2026-10-16: pixi-garden with the adapter from before cc4bd6e5
// (test/view-check/pixi-garden-adapter-before-cc4bd6e5.js). Its thumbnails left objects as Pixi v8
// render groups, so the editor showed the garden without trees, house, rocks and flowers while the
// in-editor self-check still said "ok". The view check must fail on that adapter and pass on the
// current one. It runs the built skills/arrange/bin/studio.mjs (what users get), on temporary
// copies of the example, so the repository is never written to. Needs the network for the Pixi CDN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = join(PKG, 'skills/arrange/bin/studio.mjs');
const skip = findChrome() ? false : 'no headless Chrome found (set STUDIO_CHROME)';

/** Run `studio.mjs <dir> --check-view`; resolve with { code, out }. */
function checkView(dir) {
  return new Promise((res) => {
    execFile(process.execPath, [STUDIO, dir, '--check-view'], { timeout: 120_000 }, (err, stdout, stderr) => {
      res({ code: err ? err.code : 0, out: stdout.trim(), err: stderr });
    });
  });
}

test('view check: fails on the pre-cc4bd6e5 pixi-garden adapter, passes on the current one', { skip, timeout: 300_000 }, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'studio-view-check-'));
  try {
    const current = join(scratch, 'current');
    const old = join(scratch, 'old');
    cpSync(join(PKG, 'examples/pixi-garden'), current, { recursive: true });
    cpSync(join(PKG, 'examples/pixi-garden'), old, { recursive: true });
    copyFileSync(join(PKG, 'test/view-check/pixi-garden-adapter-before-cc4bd6e5.js'), join(old, '.studio/adapter.js'));

    await t.test('old adapter: the editor picture drifts', async () => {
      const r = await checkView(old);
      assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}\n${r.err}`);
      assert.match(r.out, /^studio: check-view failed: the game looks different in the editor/);
      // The in-editor self-check alone does not see it (this is why the view check exists).
      assert.match(r.err, /studio: check ok/);
      const note = readFileSync(join(old, '.studio/view-check.md'), 'utf8');
      assert.match(note, /The adapter changes how objects are drawn/);
      assert.match(note, /disableRenderGroup/);
      assert.ok(existsSync(join(old, '.studio/view-check/editor.png')));
      assert.ok(existsSync(join(old, '.studio/view-check/game.png')));
    });

    await t.test('current adapter: same picture', async () => {
      const r = await checkView(current);
      assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}\n${r.err}`);
      assert.match(r.out, /^studio: check-view ok/);
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// `studio.mjs <game> --shot` (skill §3.3, play test 2026-10-16): the AI looks at the game it
// changed before it reports. 3D too (three-crates), both sizes, the real game without the editor.
test('--shot: the game as played, at 1280x800 and 390x844, 3D included', { skip, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-shot-'));
  try {
    cpSync(join(PKG, 'examples/three-crates'), dir, { recursive: true });
    const r = await new Promise((res) => {
      execFile(process.execPath, [STUDIO, dir, '--shot'], { timeout: 90_000 }, (err, stdout) => res({ code: err ? err.code : 0, out: stdout.trim() }));
    });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out, 'studio: shot ok .studio/shot/game.png .studio/shot/game-phone.png');
    for (const [f, w, h] of [['game.png', 1280, 800], ['game-phone.png', 390, 844]]) {
      const png = readFileSync(join(dir, '.studio/shot', f));
      assert.equal(png.toString('ascii', 1, 4), 'PNG');
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [w, h], f);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
