// The person's own game, whatever its page is called (hands-on report 2026-10-21, "own game"): with no index.html the editor
// opens the game page itself (neon-orb.html, game.html, dist/index.html), never a copy and never the sample; the
// sample only comes when there is really no game.
//
//   node --experimental-strip-types --no-warnings --test test/own-game.test.mjs
//
// Like first-run.test.mjs, the built CLI (skills/arrange/bin/studio.mjs, `npm run build` first) runs as a child
// process, so what is tested is what an agent runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGamePages, pickGamePage } from '../src/server/find-game.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const FAKE = join(PKG, 'test/first-run/starters');
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 20000 });

// A single-file three.js game, as an AI writes one: the engine from a CDN, all the code inline.
const NEON = `<!doctype html><title>NEON ORB</title>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer();
document.body.appendChild(renderer.domElement);
addEventListener('keydown', (e) => {});
renderer.setAnimationLoop(() => renderer.render(scene, new THREE.PerspectiveCamera()));
</script>`;
// A hand-written 2D canvas game: no engine, its code in game.js.
const CANVAS_PAGE = `<!doctype html><title>Dash</title><canvas id="c"></canvas><script src="game.js"></script>`;
const CANVAS_JS = `const g = document.getElementById('c').getContext('2d');
function loop() { g.fillRect(0, 0, 10, 10); requestAnimationFrame(loop); }
addEventListener('keydown', () => {}); loop();`;
// Pages that are not the game, though they mention one.
const ABOUT = `<!doctype html><title>About</title><h1>About NEON ORB</h1><p>Made with three.js and a canvas.</p>`;
const README_EXPORT = `<!doctype html><meta name="generator" content="markdown-it"><pre>import * as THREE from 'three'; new THREE.Scene(); requestAnimationFrame</pre>`;

function folder(name, files) {
  const dir = mkdtempSync(join(tmpdir(), `studio-own-${name}-`));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}
const listing = (dir) => readdirSync(dir).filter((f) => f !== '.studio').sort();

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

/** The page the running editor shows (GET /__studio/api/open → gameUrl), via the pass in the ready URL. */
async function openedPage(url) {
  const u = new URL(url);
  const r = await fetch(url, { redirect: 'manual' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const j = await (await fetch(`${u.origin}/__studio/api/open`, { headers: { cookie } })).json();
  return j.gameUrl;
}

test('own game: only neon-orb.html → it opens, as it is (no copy, no index.html, no sample)', async () => {
  const dir = folder('neon', { 'neon-orb.html': NEON, 'notes.md': '# ideas' });
  const lines = await startAndStop([dir]);
  const entry = lines.find((l) => l.startsWith('studio: entry '));
  assert.ok(entry, lines.join('\n'));
  assert.match(entry, /^studio: entry neon-orb\.html - /);
  assert.match(entry, /not copied/);
  assert.doesNotMatch(entry, /index\.html/, 'the line never says what is missing');
  assert.ok(lines.some((l) => l.startsWith('studio: ready ')));
  assert.ok(!lines.some((l) => /no-game|started/.test(l)), 'no sample');
  assert.deepEqual(listing(dir), ['neon-orb.html', 'notes.md'], 'nothing renamed, copied or created');
  assert.equal(readFileSync(join(dir, 'neon-orb.html'), 'utf8'), NEON, 'the game itself is untouched');
  rmSync(dir, { recursive: true, force: true });
});

test('own game: the editor shows that very file (gameUrl), started with --detach, and --stop stops it', async () => {
  const dir = folder('detach', { 'neon-orb.html': NEON });
  const r = run([dir, '--detach', '--no-open']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^studio: entry neon-orb\.html /m);
  const url = r.stdout.match(/^studio: ready (\S+)/m)[1];
  assert.equal(await openedPage(url), '/neon-orb.html');
  // Run twice: the same editor, not a second one.
  assert.match(run([dir, '--detach', '--no-open']).stdout, /already running/);
  assert.match(run([dir, '--stop']).stdout, /^studio: stopped pid /m);
  rmSync(dir, { recursive: true, force: true });
});

test('own game: game.html and about.html → game.html; a README export never wins', async () => {
  const dir = folder('pick', { 'about.html': ABOUT, 'README.html': README_EXPORT, 'game.html': CANVAS_PAGE, 'game.js': CANVAS_JS });
  const pages = await findGamePages(dir);
  assert.deepEqual(pages.map((p) => p.entry), ['game.html'], 'about and the README are not games');
  const lines = await startAndStop([dir]);
  assert.match(lines.find((l) => l.startsWith('studio: entry ')), /^studio: entry game\.html /);
  rmSync(dir, { recursive: true, force: true });
});

test('own game: two games → the most game-like, and the line names the other for --entry', async () => {
  const dir = folder('two', { 'neon-orb.html': NEON, 'sketch.html': CANVAS_PAGE, 'game.js': CANVAS_JS });
  const pick = await pickGamePage(dir);
  assert.equal(pick.entry, 'neon-orb.html', 'an engine scores above a bare canvas');
  assert.deepEqual(pick.others, ['sketch.html']);
  const lines = await startAndStop([dir]);
  assert.match(lines.find((l) => l.startsWith('studio: entry ')), /Other game pages: sketch\.html\. Wrong page\? Run again with --entry <file>$/);
  // --entry opens the other one, without the line.
  const again = await startAndStop([dir, '--entry', 'sketch.html']);
  assert.ok(!again.some((l) => l.startsWith('studio: entry ')));
  rmSync(dir, { recursive: true, force: true });
});

test('own game: a built game in dist/ is served from dist/ (Vite source next to it is skipped)', async () => {
  const dir = folder('dist', {
    'package.json': '{"scripts":{"build":"vite build"}}',
    'index.html': '<!doctype html><div id="app"></div><script type="module" src="/src/main.ts"></script>',
    'src/main.ts': "import * as THREE from 'three'; new THREE.Scene();",
    'dist/index.html': '<!doctype html><script type="module" src="/assets/index-abc.js"></script>',
    'dist/assets/index-abc.js': 'class Scene{}; const r = new WebGLRenderer(); r.setAnimationLoop(()=>{}); THREE.Scene; addEventListener("pointerdown",()=>{})',
  });
  const r = run([dir, '--detach', '--no-open']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^studio: entry dist\/index\.html /m);
  const url = r.stdout.match(/^studio: ready (\S+)/m)[1];
  assert.equal(await openedPage(url), '/index.html', 'dist/ is the root, so /assets/… resolve as when deployed');
  assert.ok(existsSync(join(dir, 'dist/.studio/server.json')), 'the editor lives in dist/.studio');
  assert.match(run([dir, '--stop']).stdout, /^studio: stopped pid /m, '--stop with the project folder finds it');
  rmSync(dir, { recursive: true, force: true });
});

test('own game: only a Vite source (no build yet) → build-first, exit 5, never the sample', () => {
  const dir = folder('build', {
    'package.json': '{"scripts":{"build":"vite build"}}',
    'app/index.html': '<!doctype html><canvas></canvas><script type="module" src="./main.ts"></script>',
    'app/main.ts': "import * as THREE from 'three'; requestAnimationFrame(() => {});",
  });
  const r = run([dir, '--starters-dir', FAKE]);
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.match(r.stdout, /^studio: build-first app\/index\.html - /);
  assert.doesNotMatch(r.stdout, /no-game/);
  rmSync(dir, { recursive: true, force: true });
});

test('own game: a folder with no game (notes, an about page) → the sample is offered (exit 4)', () => {
  const dir = folder('none', { 'notes.md': '# todo', 'about.html': ABOUT, 'chart.html': '<canvas id="c"></canvas>' });
  const r = run([dir, '--starters-dir', FAKE]);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /^studio: no-game /);
  rmSync(dir, { recursive: true, force: true });
});

test('own game: --starter refuses a folder whose game is neon-orb.html (nothing copied)', () => {
  const dir = folder('starter', { 'neon-orb.html': NEON });
  const r = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--no-open']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /already has a game \(neon-orb\.html\)/);
  assert.deepEqual(listing(dir), ['neon-orb.html']);
  rmSync(dir, { recursive: true, force: true });
});

test('own game: hand-off commands with the same folder land in the same .studio (no entry line)', () => {
  const dir = folder('handoff', { 'dist/game.html': NEON });
  const r = run([dir, '--requests']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, '', 'no requests, and no entry line for the agent to read');
  const s = run([dir, '--status', 'working']);
  assert.equal(s.status, 0, s.stdout + s.stderr);
  assert.ok(existsSync(join(dir, 'dist/.studio/status.json')));
  rmSync(dir, { recursive: true, force: true });
});
