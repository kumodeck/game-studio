// The editor's link, always with its pass, and "open it in my browser" remembered (a try with v0.1.7 on 2026-10-21, the
// Claude app: the AI gave `http://127.0.0.1:<port>/__studio/` with no ?t=, a link that only says "Missing pass", and
// opening it in the browser took a second ask). open-in.mjs has the why.
//
//   npm run build && node --test test/link-first.test.mjs
//
// The built CLI (skills/arrange/bin/studio.mjs) is what is tested: it is what the agent runs. The person's browser is
// never started: a fake `open` / `xdg-open` first on PATH writes down the link it was asked to open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const FAKE = join(PKG, 'test/first-run/starters');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FULL = /^http:\/\/127\.0\.0\.1:\d+\/__studio\/\?t=[A-Za-z0-9_-]{16,}$/;

function setup(name) {
  const base = mkdtempSync(join(tmpdir(), `studio-link-${name}-`));
  const bin = join(base, 'bin');
  const opened = join(base, 'opened.txt');
  mkdirSync(bin);
  for (const cmd of ['open', 'xdg-open']) {
    writeFileSync(join(bin, cmd), `#!/bin/sh\necho "$@" >> "${opened}"\n`);
    chmodSync(join(bin, cmd), 0o755);
  }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const all = []; // every line any command printed (stdout and stderr), for the "never a bare link" check
  const run = (args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30000, env });
    all.push(...`${r.stdout}\n${r.stderr}`.split('\n'));
    return r;
  };
  const openedLinks = async (n) => {
    const t0 = Date.now();
    const read = () => (existsSync(opened) ? readFileSync(opened, 'utf8').trim().split('\n').filter(Boolean) : []);
    while (read().length < n && Date.now() - t0 < 5000) await sleep(50);
    await sleep(200); // and nothing more arrives
    return read();
  };
  return { base, dir: join(base, 'game'), run, all, openedLinks };
}

/** Lines that name the editor's address without its pass. */
const bare = (lines) => lines.filter((l) => l.includes('/__studio/') && !/\/__studio\/\?(?:.*&)?t=[A-Za-z0-9_-]{8,}/.test(l));

test('--link: the running editor\'s link with its pass, one line; "not running" without one; --detach again prints the same link', async () => {
  const { base, dir, run, all, openedLinks } = setup('link');
  try {
    const none = run([dir, '--link']);
    assert.equal(none.status, 1);
    assert.match(none.stdout, /^studio: not running \(no editor started for .*\) - start it with --detach/);
    assert.ok(!none.stdout.includes('http'), 'no link when nothing runs');

    const a = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach', '--no-open']);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    const url = a.stdout.match(/^studio: ready (\S+) pid (\d+)$/m)[1];
    assert.match(url, FULL);

    const l = run([dir, '--link']);
    assert.equal(l.status, 0, l.stderr);
    assert.equal(l.stdout, url + '\n', 'exactly the link, nothing else on stdout');
    assert.ok((await fetch(l.stdout.trim(), { redirect: 'manual' })).status === 302, 'the link opens the editor (pass traded for a cookie)');

    const again = run([dir, '--detach', '--no-open']);
    assert.match(again.stdout, new RegExp(`^studio: ready ${url.replace(/[.?]/g, '\\$&')} pid \\d+ \\(already running\\)\\n$`));

    // --tool library: still the pass, then the tool.
    run([dir, '--stop']);
    run([dir, '--detach', '--no-open', '--tool', 'library']);
    assert.match(run([dir, '--link']).stdout.trim(), /^http:\/\/127\.0\.0\.1:\d+\/__studio\/\?t=[A-Za-z0-9_-]{16,}&tool=library$/);

    assert.deepEqual(await openedLinks(0), [], '--no-open and --link open nothing');
    assert.deepEqual(bare([...all, ...readFileSync(join(dir, '.studio/studio.log'), 'utf8').split('\n')]), []);
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});

test('--open-in browser: opens the link now, is remembered, and the next --detach --no-open (the app) opens the browser too; --open-in app puts it back', async () => {
  const { base, dir, run, all, openedLinks } = setup('pref');
  try {
    const a = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach', '--no-open']);
    const url1 = a.stdout.match(/^studio: ready (\S+) pid/m)[1];
    assert.ok(!a.stdout.includes('studio: open browser'), 'nothing said when the person never chose');

    const b = run([dir, '--open-in', 'browser']);
    assert.equal(b.status, 0, b.stderr);
    const [first, second] = b.stdout.trim().split('\n');
    assert.equal(first, url1, 'the link first');
    assert.match(second, /^studio: open-in browser \(\.studio\/open\.json\) - opened the link in the default browser/);
    assert.equal(JSON.parse(readFileSync(join(dir, '.studio/open.json'), 'utf8')).open, 'browser');
    assert.deepEqual(await openedLinks(1), [url1]);

    // Running again in the app: told it is the browser's, nothing reopened by itself.
    const c = run([dir, '--detach', '--no-open']);
    assert.match(c.stdout, /\(already running\)\nstudio: open browser - .*--link --open/);
    assert.equal((await openedLinks(1)).length, 1);
    run([dir, '--link', '--open']);
    assert.deepEqual(await openedLinks(2), [url1, url1]);

    // A new session in the app: its start line has --no-open, and the browser opens anyway.
    run([dir, '--stop']);
    const d = run([dir, '--detach', '--no-open']);
    const url2 = d.stdout.match(/^studio: ready (\S+) pid/m)[1];
    assert.match(d.stdout, /^studio: ready \S+ pid \d+\nstudio: open browser - .*it opened there\. Do not open it next to the chat/m);
    assert.deepEqual((await openedLinks(3)).slice(2), [url2]);

    // Back to the window next to the chat, in one command.
    const e = run([dir, '--open-in', 'app']);
    assert.equal(e.stdout.trim().split('\n')[0], url2);
    assert.match(e.stdout, /studio: open-in app .*next to the chat/);
    run([dir, '--stop']);
    const f = run([dir, '--detach', '--no-open']);
    assert.ok(!f.stdout.includes('open browser'), f.stdout);
    assert.equal((await openedLinks(3)).length, 3, 'the app\'s --no-open is kept again');

    assert.equal(run([dir, '--open-in', 'chrome']).status, 2);
    assert.deepEqual(bare([...all, ...readFileSync(join(dir, '.studio/studio.log'), 'utf8').split('\n')]), []);
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});

test('--open-in with no editor running: remembered, says how to start it, prints no link', () => {
  const { base, dir, run } = setup('cold');
  try {
    mkdirSync(dir);
    const r = run([dir, '--open-in', 'browser']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^studio: open-in browser \(\.studio\/open\.json\) - remembered; the editor is not running: --detach starts it in the browser\n$/);
    // A broken file is as if never said (no crash, the environment decides).
    writeFileSync(join(dir, '.studio/open.json'), '{oops');
    assert.match(run([dir, '--link']).stdout, /^studio: not running/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('STUDIO_BROWSER: the link goes to that command instead of the system browser', async () => {
  const { base, dir, run } = setup('envbrowser');
  try {
    const rec = join(base, 'rec.sh');
    const got = join(base, 'got.txt');
    writeFileSync(rec, `#!/bin/sh\necho "$@" > "${got}"\n`);
    chmodSync(rec, 0o755);
    const a = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach', '--no-open']);
    const url = a.stdout.match(/^studio: ready (\S+) pid/m)[1];
    const r = spawnSync(process.execPath, [CLI, dir, '--link', '--open'], { encoding: 'utf8', env: { ...process.env, STUDIO_BROWSER: rec } });
    assert.equal(r.stdout, url + '\n');
    const t0 = Date.now();
    while (!existsSync(got) && Date.now() - t0 < 5000) await sleep(50);
    assert.equal(readFileSync(got, 'utf8').trim(), url);
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});
