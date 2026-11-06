// The first 5 minutes, without a browser: a folder with no game → a starter is copied in; no
// starters → the examples; a too-old Node stops with one line.
//
//   node --experimental-strip-types --no-warnings --test test/first-run.test.mjs
//
// The real CLI (skills/arrange/bin/studio.mjs, run `npm run build` first) is started as a child
// process, so what is tested is what an agent runs. Fake starters live in test/first-run/starters.
import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStarters, findStarters, pickStarter, starterFiles, copyStarter, noGameLine, shelfList, readTry, readableName, COMING } from '../src/server/starters.mjs';
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
  assert.match(noGameLine('/g', list, { shelf: true }), /^studio: no-game \/g - the editor opens on its shelf of samples: don't ask which one/);
  assert.match(noGameLine('/g', list), /^studio: no-game \/g - nothing to check yet: start the editor without this option/);
  assert.match(noGameLine('/g', []), /no samples/);
  assert.deepEqual(shelfList(list).map((s) => s.id), ['three-crates', 'pixi-garden'], 'no "Coming" cards next to the fallback');
  rmSync(none, { recursive: true, force: true });
});

// Decided 2026-11-06: a folder without a game opens the editor on its shelf of samples (the AI asks nothing; it used to
// exit 4 and the AI asked "3D or 2D?"). Only a check that needs the game itself still stops with exit 4.
test('CLI: a folder without a game opens the shelf (no exit 4), --starters lists them, --check-view still exits 4', async () => {
  const dir = tmp('empty');
  const lines = await startAndStop([dir, '--starters-dir', FAKE]);
  assert.equal(lines[0], `studio: no-game ${dir} - the editor opens on its shelf of samples: don't ask which one, the person picks one there and it is copied into this folder`);
  assert.match(lines[1], /^studio: ready http:\/\/127\.0\.0\.1:\d+\/__studio\/\?t=/);
  assert.deepEqual(readdirSync(dir).filter((f) => f !== '.studio'), [], 'nothing copied before a pick');
  const c = run([dir, '--check-view', '--starters-dir', FAKE]);
  assert.equal(c.status, 4, c.stderr);
  assert.match(c.stdout, /^studio: no-game .* - nothing to check yet/);
  // Decided 2026-11-06: no "--entry <file>" advice for an EMPTY folder (it is for a game whose page has another name).
  assert.doesNotMatch(c.stderr, /--entry/, 'an empty folder gets only the sample line');
  // The hand-off commands only need .studio/: a watch's --requests right after the editor starts must not stop.
  const q = run([dir, '--requests', '--starters-dir', FAKE]);
  assert.equal(q.status, 0, q.stderr);
  const l = run(['--starters', '--starters-dir', FAKE]);
  assert.equal(l.status, 0);
  assert.deepEqual(l.stdout.trim().split('\n').map((x) => JSON.parse(x).id), ['fake-3d', 'fake-2d', 'fake-2d-late']);
  // --entry other.html stays the old error: the person named a page, so it is not "no game".
  const e = run([dir, '--entry', 'other.html']);
  assert.equal(e.status, 2);
  rmSync(dir, { recursive: true, force: true });
});

/** Start the CLI and keep it running: { url, origin, cookie, out(), stop() } (the shelf's HTTP side). */
async function startServer(args) {
  const child = spawn(process.execPath, [CLI, ...args, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no ready line\n${out}`)), 15000);
    child.stdout.on('data', () => out.includes('studio: ready ') && (clearTimeout(t), res()));
    child.on('exit', (c) => (clearTimeout(t), rej(new Error(`exited ${c}\n${out}`))));
  });
  const url = /studio: ready (\S+)/.exec(out)[1];
  const r = await fetch(url, { redirect: 'manual' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { url, origin: new URL(url).origin, cookie, out: () => out, stop: () => new Promise((res) => (child.once('exit', res), child.kill('SIGTERM'))) };
}

test('shelf API: the list in order with try, the sample files, open = copy in once, then the folder is a game', async () => {
  const dir = tmp('shelf');
  const s = await startServer([dir, '--starters-dir', FAKE]);
  const get = (p) => fetch(s.origin + p, { headers: { cookie: s.cookie } });
  const post = (p, body) => fetch(s.origin + p, { method: 'POST', headers: { cookie: s.cookie, 'content-type': 'application/json', origin: s.origin }, body: JSON.stringify(body) });
  try {
    assert.equal((await (await get('/__studio/api/open')).json()).shelf, true);
    const shelf = await (await get('/__studio/api/shelf')).json();
    // --starters-dir: no "Coming" cards (those are only for the plugin's own starters).
    assert.deepEqual(shelf.items.map((i) => `${i.id} ${i.order}`), ['fake-2d 1', 'fake-3d 1', 'fake-2d-late 2'], 'by order, then id (not 3d first)');
    const f3 = shelf.items.find((i) => i.id === 'fake-3d');
    assert.deepEqual(f3.try, { move: 'crate', moveName: { en: 'crate' }, pauseAt: 2.25, ask: { en: 'Make the boxes twice as big.' } });
    assert.equal(f3.thumb, '/__studio/shelf/fake-3d/thumb.png');
    assert.equal(f3.play, '/__studio/shelf/fake-3d/index.html');
    assert.equal(shelf.items.find((i) => i.id === 'fake-2d-late').thumb, null);
    // The sample's own files, read-only, never outside it, never without the pass.
    assert.equal((await get('/__studio/shelf/fake-3d/thumb.png')).headers.get('content-type'), 'image/png');
    const page = await (await get('/__studio/shelf/fake-3d/index.html')).text();
    assert.doesNotMatch(page, /studio-edit\.js/, 'played as it is, without the edit script');
    // Raw paths (fetch would tidy them before sending; "%2e%2e" segments are resolved by the URL parser itself, so they
    // only ever reach another sample or the game route): an encoded slash out of the sample's folder is refused.
    const raw = (p) => new Promise((res) => http.get({ host: new URL(s.origin).hostname, port: new URL(s.origin).port, path: p, headers: { cookie: s.cookie } }, (r) => (r.resume(), res(r.statusCode))));
    assert.equal(await raw('/__studio/shelf/fake-3d/..%2F..%2Fbroken/index.html'), 400);
    assert.equal(await raw('/__studio/shelf/fake-3d/.studio'), 404, 'no hidden files');
    assert.equal((await get('/__studio/shelf/nope/index.html')).status, 404);
    assert.equal((await fetch(s.origin + '/__studio/shelf/fake-3d/index.html')).status, 403, 'no cookie, no file');
    assert.equal((await post('/__studio/api/shelf/open', { id: 'nope' })).status, 404);
    // Open: copied in, the same line as --starter on stdout, and now the folder has a game.
    const o = await post('/__studio/api/shelf/open', { id: 'fake-3d' });
    assert.equal(o.status, 200);
    assert.deepEqual(readdirSync(dir).filter((f) => f !== '.studio').sort(), ['game.js', 'index.html']);
    assert.match(s.out(), /\nstudio: started fake-3d \(2 files\) Fake Harbor\n/);
    const open = await (await get('/__studio/api/open')).json();
    assert.equal(open.shelf, undefined);
    assert.equal(open.gameUrl, '/index.html');
    assert.equal((await (await post('/__studio/api/shelf/open', { id: 'fake-3d' })).json()).already, true, 'a double press copies nothing again');
    const other = await post('/__studio/api/shelf/open', { id: 'fake-2d' });
    assert.equal(other.status, 409, 'never a second sample into a game');
    assert.equal((await other.json()).code, 'has-game');
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  // A folder with a game has no shelf at all.
  const g = tmp('game');
  writeFileSync(join(g, 'index.html'), '<canvas></canvas>');
  const s2 = await startServer([g]);
  try {
    assert.equal((await fetch(s2.origin + '/__studio/api/shelf', { headers: { cookie: s2.cookie } })).status, 404);
    assert.equal((await fetch(s2.origin + '/__studio/shelf/lantern-cove/index.html', { headers: { cookie: s2.cookie } })).status, 404);
  } finally {
    await s2.stop();
    rmSync(g, { recursive: true, force: true });
  }
});

test('shelf: try is cleaned, a starter may stand for examples/<id> (only that), Coming fills the planned six', async () => {
  assert.equal(readTry(null), null);
  assert.equal(readTry({ move: '  ', ask: { fr: 'x' } }), null, 'nothing to show');
  assert.deepEqual(readTry({ move: 'duck', pauseAt: 7.6123, ask: { en: ' Make it so. ', ja: '' }, extra: 1 }), { move: 'duck', pauseAt: 7.61, ask: { en: 'Make it so.' }, moveName: { en: 'duck' } });
  // The thing to move as a person reads it (decided 2026-11-06): a placement name may carry a copy number.
  assert.equal(readableName('lighthouse_1'), 'lighthouse');
  assert.equal(readableName('rope_bridge-2'), 'rope bridge');
  assert.equal(readableName('bigRock'), 'big rock');
  assert.equal(readableName('gate'), 'gate');
  // A grid of copies (Marble Rain's pins, row and column): both numbers go.
  assert.equal(readableName('pin-1-2'), 'pin');
  assert.deepEqual(readTry({ move: 'lighthouse_1', moveName: { ja: ' 灯台 ', fr: 'x' } }).moveName, { en: 'lighthouse', ja: '灯台' });
  assert.equal(readTry({ pauseAt: -1 }), null);
  // `mark: true` passes (the guide's Play card then says to point with ◎); anything else is dropped.
  assert.equal(readTry({ ask: { en: 'Add one here.' }, mark: true }).mark, true);
  assert.equal(readTry({ ask: { en: 'Add one here.' }, mark: 'yes' }).mark, undefined);
  // { "from": "examples/<id>" }: the game is read from there, its starter.json under the fields given here.
  const base = tmp('link');
  const w = (f, t) => (mkdirSync(dirname(join(base, f)), { recursive: true }), writeFileSync(join(base, f), t));
  w('examples/run/index.html', '<canvas></canvas>');
  w('examples/run/starter.json', JSON.stringify({ title: 'Run', dim: '3d', blurb: 'b', order: 2, try: { ask: { en: 'Go.' } } }));
  w('examples/run/strings.json', JSON.stringify({ ja: { blurb: 'B', try: { ask: 'J', move: 'M' } } }));
  w('starters/run-link/starter.json', JSON.stringify({ from: 'examples/run', order: 1.5 }));
  // The starter's own strings.json wins over the example's, one field at a time.
  w('starters/run-link/strings.json', JSON.stringify({ ja: { try: { ask: 'J2' } } }));
  w('starters/escape/starter.json', JSON.stringify({ from: '../../etc' }));
  w('starters/abs/starter.json', JSON.stringify({ from: 'examples/../../x' }));
  const list = await readStarters(join(base, 'starters'));
  assert.deepEqual(list.map((s) => s.id), ['run-link'], 'only examples/<id> is accepted');
  assert.equal(list[0].order, 1.5);
  assert.equal(list[0].title, 'Run');
  assert.deepEqual(list[0].try, { ask: { en: 'Go.', ja: 'J2' } }, 'strings.json put in; no move, so no moveName');
  assert.deepEqual(list[0].blurbs, { ja: 'B' });
  assert.equal(list[0].dir, join(base, 'examples/run'));
  assert.deepEqual(await starterFiles(list[0].dir), ['index.html'], 'one copy of the game, nothing doubled');
  // Coming: the planned samples not here yet, in their order; a starter of that id takes the card.
  const shelf = shelfList(list);
  assert.deepEqual(shelf.map((s) => `${s.id}${s.coming ? '*' : ''}`), ['run-link', 'domino-spiral*', 'marble-rain*']);
  assert.deepEqual(shelfList(list, { coming: false }).map((s) => s.id), ['run-link']);
  assert.ok(!shelfList([{ ...list[0], id: COMING[0].id }]).some((s) => s.coming && s.id === COMING[0].id));
  rmSync(base, { recursive: true, force: true });
});

test('the plugin\'s own shelf: Neon Run stands for examples/three-neon-boss, every sample has words to try', async () => {
  const list = await readStarters(join(PKG, 'starters'));
  const neon = list.find((s) => s.id === 'neon-run');
  assert.ok(neon, 'Neon Run is on the shelf');
  assert.equal(neon.dir, join(PKG, 'examples/three-neon-boss'));
  assert.ok(!existsSync(join(PKG, 'starters/neon-run/index.html')), 'no second copy of the game');
  // Every sample carries its own words in both languages (decided 2026-11-06: no stand-ins in the server or the shell).
  for (const s of list) {
    assert.ok(s.try?.ask?.en && s.try.ask.ja, `${s.id}: “Try asking” words in en (starter.json) and ja (strings.json)`);
    assert.ok(s.try.moveName?.en && s.try.moveName.ja, `${s.id}: the thing to move, named in en and ja`);
    assert.ok(s.blurbs?.ja, `${s.id}: the card's line in ja (strings.json blurb)`);
  }
  assert.equal(neon.try.pauseAt, 4.6, "Neon Run's try is the example's (one place for it)");
  assert.ok(!JSON.parse(readFileSync(join(PKG, 'starters/neon-run/starter.json'), 'utf8')).try, 'no second try in starters/neon-run');
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

// Decided 2026-11-06: --version answers "which Game Studio is this?" with the number alone (it was "unknown option").
test('CLI: --version / -v print the version from package.json and exit 0; a folder with files still gets the --entry hint', () => {
  const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
  for (const flag of ['--version', '-v']) {
    const r = run([flag]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), pkg.version);
  }
  const dir = tmp('notes');
  writeFileSync(join(dir, 'notes.txt'), 'not a game');
  const r = run([dir, '--check-view', '--starters-dir', FAKE]);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /--entry <file>/, 'files but no page: maybe it is called something else');
  rmSync(dir, { recursive: true, force: true });
});
