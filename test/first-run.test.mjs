// The first 5 minutes, without a browser: a folder with no game → a starter is copied in; no
// starters → the examples; a too-old Node stops with one line.
//
//   node --experimental-strip-types --no-warnings --test test/first-run.test.mjs
//
// The real CLI (skills/arrange/bin/studio.mjs, run `npm run build` first) is started as a child
// process, so what is tested is what an agent runs. Fake starters live in test/first-run/starters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStarters, findStarters, pickStarter, starterFiles, copyStarter, noGameLine } from '../src/server/starters.mjs';
import { nodeTooOld } from '../src/server/node-check.mjs';
import { normalizeUi } from '../src/shell/ui-prefs.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const FAKE = join(PKG, 'test/first-run/starters');
const tmp = (name) => mkdtempSync(join(tmpdir(), `studio-first-${name}-`));
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 20000 });

/** Start the CLI, wait for "studio: ready", stop it. Returns every stdout line. */
async function startAndStop(args) {
  const child = spawn(process.execPath, [CLI, ...args, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no ready line\n${out}\n${err}`)), 15000);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('studio: ready ')) {
        clearTimeout(t);
        res();
      }
    });
    child.on('exit', (c) => {
      clearTimeout(t);
      rej(new Error(`exited ${c}\n${out}\n${err}`));
    });
  });
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  return out.trim().split('\n');
}

test('starters: the agreed shape is read, broken ones skipped, 3d first then by order', async () => {
  const list = await readStarters(FAKE);
  assert.deepEqual(list.map((s) => `${s.dim} ${s.id}`), ['3d fake-3d', '2d fake-2d', '2d fake-2d-late']);
  assert.equal(list[0].title, 'Fake Harbor');
  assert.ok(list[0].thumb.endsWith('thumb.png'));
  assert.equal(list[2].thumb, null, 'no thumb.png → null');
  assert.equal(pickStarter(list, '3d').id, 'fake-3d');
  assert.equal(pickStarter(list, '2D').id, 'fake-2d', 'the lowest order of the dimension');
  assert.equal(pickStarter(list, 'fake-2d-late').id, 'fake-2d-late', 'an id works too');
  assert.equal(pickStarter(list, 'nope'), null);
});

test('starters: only the game is copied (no starter.json, thumb, README, hand-off notes)', async () => {
  const [s] = await readStarters(FAKE);
  assert.deepEqual(await starterFiles(s.dir), ['game.js', 'index.html']);
  // .studio/: the adapter and the game's settings travel, notes and requests do not.
  const src = tmp('src');
  mkdirSync(join(src, '.studio/requests'), { recursive: true });
  for (const f of ['index.html', '.studio/adapter.js', '.studio/studio.json', '.studio/check.md', '.studio/requests/a.json', 'assets/a.png']) {
    mkdirSync(dirname(join(src, f)), { recursive: true });
    writeFileSync(join(src, f), 'x');
  }
  assert.deepEqual(await starterFiles(src), ['.studio/adapter.js', '.studio/studio.json', 'assets/a.png', 'index.html']);
  rmSync(src, { recursive: true, force: true });
});

test('starters: never overwrite — any file already there and nothing is copied', async () => {
  const [s] = await readStarters(FAKE);
  const dest = tmp('conflict');
  writeFileSync(join(dest, 'game.js'), 'mine');
  const r = await copyStarter(s, dest);
  assert.deepEqual(r.conflicts, ['game.js']);
  assert.deepEqual(readdirSync(dest), ['game.js']);
  assert.equal(readFileSync(join(dest, 'game.js'), 'utf8'), 'mine');
  rmSync(dest, { recursive: true, force: true });
});

test('no starters at all: the examples (three-crates 3d, pixi-garden 2d) are offered instead', async () => {
  const none = tmp('none');
  const list = await findStarters(join(PKG, 'skills/arrange/bin'), none);
  assert.deepEqual(list.map((s) => `${s.dim} ${s.id} ${s.fallback}`), ['3d three-crates true', '2d pixi-garden true']);
  assert.match(noGameLine('/g', list), /--starter 3d \(Crates\) or --starter 2d \(Garden\)/);
  assert.match(noGameLine('/g', []), /no samples/);
  rmSync(none, { recursive: true, force: true });
});

test('CLI: a folder without a game says what to ask (exit 4), --starters lists them', () => {
  const dir = tmp('empty');
  const r = run([dir, '--starters-dir', FAKE]);
  assert.equal(r.status, 4, r.stderr);
  assert.equal(r.stdout.trim(), `studio: no-game ${dir} - ask once "Start from a sample? 3D or 2D", then run again with --starter 3d (Fake Harbor) or --starter 2d (Fake Pond)`);
  assert.deepEqual(readdirSync(dir), [], 'nothing written');
  const l = run(['--starters', '--starters-dir', FAKE]);
  assert.equal(l.status, 0);
  assert.deepEqual(l.stdout.trim().split('\n').map((x) => JSON.parse(x).id), ['fake-3d', 'fake-2d', 'fake-2d-late']);
  // --entry other.html stays the old error: the person named a page, so it is not "no game".
  const e = run([dir, '--entry', 'other.html']);
  assert.equal(e.status, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('CLI: --starter copies the sample into the folder (made if missing) and opens the editor', async () => {
  const base = tmp('start');
  const dir = join(base, 'my-game'); // does not exist yet
  const lines = await startAndStop([dir, '--starter', '3d', '--starters-dir', FAKE]);
  assert.equal(lines[0], 'studio: started fake-3d (2 files) Fake Harbor');
  assert.match(lines[1], /^studio: ready http:\/\/127\.0\.0\.1:\d+\/__studio\/\?t=/);
  assert.deepEqual(readdirSync(dir).filter((f) => f !== '.studio').sort(), ['game.js', 'index.html']);
  // A second --starter in the same folder is refused: it has a game now.
  const again = run([dir, '--starter', '2d', '--starters-dir', FAKE]);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /already has a game/);
  // Without --starter it is just a game folder now.
  const open = await startAndStop([dir]);
  assert.match(open[0], /^studio: ready /);
  rmSync(base, { recursive: true, force: true });
});

test('CLI: no starters → --starter 2d falls back to pixi-garden (with its adapter)', async () => {
  const none = tmp('none2');
  const dir = tmp('fallback');
  const lines = await startAndStop([dir, '--starter', '2d', '--starters-dir', none]);
  assert.match(lines[0], /^studio: started pixi-garden \(\d+ files\) Garden$/);
  assert.ok(existsSync(join(dir, 'index.html')) && existsSync(join(dir, '.studio/adapter.js')));
  assert.ok(!existsSync(join(dir, 'README.md')), "the example's README stays behind");
  const bad = run([tmp('bad'), '--starter', 'zzz', '--starters-dir', none]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /no sample "zzz" \(samples: 3d three-crates, 2d pixi-garden\)/);
  rmSync(none, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('no first-run tips: an old intro step in prefs.json is dropped', () => {
  // The four-step intro was removed (2026-10-17); prefs.json files written before still load.
  assert.equal(normalizeUi({ intro: 2 }).intro, undefined);
  assert.equal(normalizeUi({ intro: 2, lang: 'ja' }).lang, 'ja');
});

test('Node check: the one line, and the real CLI on an old Node', () => {
  assert.equal(nodeTooOld('22.13.0'), null);
  assert.equal(nodeTooOld('23.0.1'), null);
  assert.equal(nodeTooOld('v24.1.0'), null);
  assert.equal(nodeTooOld('22.12.9'), 'Game Studio needs Node.js 22.13 or later (you have 22.12.9). Get the latest LTS at https://nodejs.org, then try again.');
  assert.equal(nodeTooOld('v18.19.0'), 'Game Studio needs Node.js 22.13 or later (you have 18.19.0). Get the latest LTS at https://nodejs.org, then try again.');
  assert.equal(nodeTooOld('bun'), null, 'a runtime that does not say: let it try');
  // A real old Node, when this machine has one (nvm, or STUDIO_OLD_NODE=<path to node>).
  const nvm = join(homedir(), '.nvm/versions/node');
  const old = process.env.STUDIO_OLD_NODE
    || (existsSync(nvm) ? readdirSync(nvm).filter((v) => nodeTooOld(v)).map((v) => join(nvm, v, 'bin/node')).find((p) => existsSync(p)) : undefined);
  if (!old) return console.log('  (no old Node found: set STUDIO_OLD_NODE to run the real check)');
  const r = spawnSync(old, [CLI, tmp('old')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^Game Studio needs Node\.js 22\.13 or later \(you have \d+\.\d+\.\d+\)\. Get the latest LTS at https:\/\/nodejs\.org, then try again\.\n$/, r.stderr);
  console.log(`  ${old}: ${r.stderr.trim()}`);
});

test('every starter and example that ships studio-placement.js ships the current built loader', () => {
  // Opened on its own (no editor), a starter shows the editor's copies only if its loader is the current one
  // (speed pass 2026-10-17: the starters kept the loader from before copies existed). `npm run build` refreshes them.
  const built = readFileSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), 'utf8');
  const stale = [];
  for (const dir of ['starters', 'examples']) {
    for (const id of readdirSync(join(PKG, dir))) {
      const f = join(PKG, dir, id, 'studio-placement.js');
      if (existsSync(f) && readFileSync(f, 'utf8') !== built) stale.push(`${dir}/${id}`);
    }
  }
  assert.deepEqual(stale, [], 'run npm run build to refresh these copies');
});
