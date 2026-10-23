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
import { openPlace } from '../src/server/open-in.mjs';

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
  // A desktop as the person has one: not over SSH, and a display on Linux (open-in.mjs canOpenBrowser).
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DISPLAY: process.env.DISPLAY || ':0' };
  delete env.SSH_CONNECTION;
  delete env.SSH_TTY;
  delete env.STUDIO_BROWSER;
  const all = []; // every line any command printed (stdout and stderr), for the "never a bare link" check
  const run = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30000, env: { ...env, ...extra } });
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

/** The line after every ready line (open-in.mjs replyLine). */
const REPLY = 'studio: reply with this link alone on the first line of your answer, exactly as printed: ';

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
    assert.equal(l.stderr, REPLY + url + '\n', 'the reminder beside it, on stderr');
    assert.ok((await fetch(l.stdout.trim(), { redirect: 'manual' })).status === 302, 'the link opens the editor (pass traded for a cookie)');

    const again = run([dir, '--detach', '--no-open']);
    assert.deepEqual(again.stdout.trim().split('\n').slice(0, 2), [`studio: ready ${url} pid ${a.stdout.match(/pid (\d+)/)[1]} (already running)`, REPLY + url]);

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
    assert.match(a.stdout, /\nstudio: open none - nothing opened \(--no-open\)/, '--no-open holds when the person never chose');

    const b = run([dir, '--open-in', 'browser']);
    assert.equal(b.status, 0, b.stderr);
    const [first, reply, second] = b.stdout.trim().split('\n');
    assert.equal(first, url1, 'the link first');
    assert.equal(reply, REPLY + url1);
    assert.match(second, /^studio: open-in browser \(\.studio\/open\.json\) - opened the link in the default browser/);
    assert.equal(JSON.parse(readFileSync(join(dir, '.studio/open.json'), 'utf8')).open, 'browser');
    assert.deepEqual(await openedLinks(1), [url1]);

    // Running again in the app: told it is the browser's, no second tab once the link has been opened (the fake
    // browser above only wrote it down, so open it as a browser would: the pass traded for a cookie).
    assert.equal((await fetch(url1, { redirect: 'manual' })).status, 302);
    await sleep(300); // server.json gets openedAt (lifecycle.mjs markOpened)
    const c = run([dir, '--detach', '--no-open']);
    assert.match(c.stdout, /\(already running\)\nstudio: reply with this link .*\nstudio: open browser - already open .*--link --open/);
    assert.equal((await openedLinks(1)).length, 1);
    run([dir, '--link', '--open']);
    assert.deepEqual(await openedLinks(2), [url1, url1]);

    // A new session in the app: its start line has --no-open, and the browser opens anyway.
    run([dir, '--stop']);
    const d = run([dir, '--detach', '--no-open']);
    const url2 = d.stdout.match(/^studio: ready (\S+) pid/m)[1];
    assert.match(d.stdout, /^studio: ready \S+ pid \d+\nstudio: reply with this link .*\nstudio: open browser - it opened in their default browser\. Do not also open it next to the chat/m);
    assert.deepEqual((await openedLinks(3)).slice(2), [url2]);

    // Back to the window next to the chat, in one command.
    const e = run([dir, '--open-in', 'app']);
    assert.equal(e.stdout.trim().split('\n')[0], url2);
    assert.match(e.stdout, /studio: open-in app .*next to the chat/);
    run([dir, '--stop']);
    const f = run([dir, '--detach']);
    assert.match(f.stdout, /\nstudio: open app - .*preview_start/, f.stdout);
    assert.equal((await openedLinks(3)).length, 3, 'app: nothing opens by itself, even without --no-open');

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
    const r = run([dir, '--link', '--open'], { STUDIO_BROWSER: rec });
    assert.equal(r.stdout, url + '\n');
    const t0 = Date.now();
    while (!existsSync(got) && Date.now() - t0 < 5000) await sleep(50);
    assert.equal(readFileSync(got, 'utf8').trim(), url);
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});

// link always (2026-10-23): in the Claude app the AI opened the editor in the pane next to the chat and replied
// with the app's card and a sentence, no link. Now the browser is the default and every ready line is followed by the
// line that says what goes first in the reply.
test('default: --detach opens the default browser (no open.json, no --no-open), with the reply line and where it went', async () => {
  const { base, dir, run, all, openedLinks } = setup('default');
  try {
    const a = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach']);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    const lines = a.stdout.trim().split('\n');
    const i = lines.findIndex((l) => l.startsWith('studio: ready '));
    const url = lines[i].match(/^studio: ready (\S+) pid \d+$/)[1];
    assert.match(url, FULL);
    assert.equal(lines[i + 1], REPLY + url, 'right after the ready line, the link in it');
    assert.match(lines[i + 2], /^studio: open browser - it opened in their default browser\. Do not also open it next to the chat \(no preview_start\)/);
    assert.equal(lines.length, i + 3, 'nothing after that');
    assert.ok(!existsSync(join(dir, '.studio/open.json')), 'the default is not written down: only a choice is');
    assert.deepEqual(await openedLinks(1), [url]);

    // The same line again while nobody has opened the link yet (here: the fake browser only wrote it down): opened.
    const b = run([dir, '--detach']);
    assert.match(b.stdout, /\(already running\)\nstudio: reply with this link .*\nstudio: open browser - it opened/);
    assert.deepEqual(await openedLinks(2), [url, url]);

    // Once the link has been opened somewhere (the pass traded for a cookie), the same line opens no second tab.
    assert.equal((await fetch(url, { redirect: 'manual' })).status, 302);
    const t0 = Date.now();
    while (!JSON.parse(readFileSync(join(dir, '.studio/server.json'), 'utf8')).servers[0].openedAt && Date.now() - t0 < 3000) await sleep(50);
    const c = run([dir, '--detach']);
    assert.match(c.stdout, /\(already running\)\nstudio: reply with this link .*\nstudio: open browser - already open in their browser, so no second tab was opened/);
    assert.equal((await openedLinks(2)).length, 2);

    // Reopened (a new version, a restart after --stop): a fresh editor opens in the browser again.
    run([dir, '--stop']);
    const d = run([dir, '--detach']);
    const url2 = d.stdout.match(/^studio: ready (\S+) pid/m)[1];
    assert.notEqual(url2, url, 'a new pass');
    assert.ok(d.stdout.includes(REPLY + url2));
    assert.deepEqual((await openedLinks(3))[2], url2);
    assert.deepEqual(bare([...all, ...readFileSync(join(dir, '.studio/studio.log'), 'utf8').split('\n')]), []);
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});

test('--open-in app before the first start: --detach opens nothing and says to open it next to the chat', async () => {
  const { base, dir, run, openedLinks } = setup('app');
  try {
    mkdirSync(dir);
    assert.match(run([dir, '--open-in', 'app']).stdout, /^studio: open-in app .* - remembered; start it with --detach \(it opens nothing by itself\)/);
    const a = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach']);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    const url = a.stdout.match(/^studio: ready (\S+) pid/m)[1];
    assert.match(a.stdout, new RegExp(`\\nstudio: reply with this link .*\\nstudio: open app - this person opens the editor next to the chat .*preview_start`));
    assert.ok(a.stdout.includes(REPLY + url));
    assert.deepEqual(await openedLinks(0), [], 'app: nothing opened');
    // The same line again: still nothing.
    assert.match(run([dir, '--detach']).stdout, /\nstudio: open app - /);
    assert.deepEqual(await openedLinks(0), []);
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});

test('over SSH (or Linux with no display): nothing opened, the link first and "open this link in your browser"', async () => {
  const { base, dir, run, openedLinks } = setup('ssh');
  try {
    const ssh = { SSH_CONNECTION: '10.0.0.2 50000 10.0.0.1 22' };
    const a = run([dir, '--starter', '3d', '--starters-dir', FAKE, '--detach'], ssh);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    const url = a.stdout.match(/^studio: ready (\S+) pid/m)[1];
    assert.ok(a.stdout.includes(REPLY + url + '\nstudio: open none - no browser can be opened from here (SSH or no display). After the link, tell them: "Open this link in your browser."\n'), a.stdout);
    assert.deepEqual(await openedLinks(0), [], 'no browser started');
  } finally {
    run([dir, '--stop']);
    rmSync(base, { recursive: true, force: true });
  }
});

test('openPlace: browser by default, app opens nothing, a remembered browser beats --no-open, no display = nowhere', () => {
  const desk = { env: {}, platform: 'darwin' };
  assert.deepEqual(openPlace({ place: null, ...desk }), { place: 'browser', open: true });
  assert.deepEqual(openPlace({ place: null, noOpen: true, ...desk }), { place: 'none', open: false });
  assert.deepEqual(openPlace({ place: 'browser', noOpen: true, ...desk }), { place: 'browser', open: true });
  assert.deepEqual(openPlace({ place: 'app', ...desk }), { place: 'app', open: false });
  assert.deepEqual(openPlace({ place: null, env: { SSH_TTY: '/dev/ttys001' }, platform: 'darwin' }), { place: 'nowhere', open: false });
  assert.deepEqual(openPlace({ place: 'browser', env: {}, platform: 'linux' }), { place: 'nowhere', open: false });
  assert.deepEqual(openPlace({ place: null, env: { WAYLAND_DISPLAY: 'wayland-0' }, platform: 'linux' }), { place: 'browser', open: true });
  assert.deepEqual(openPlace({ place: null, env: { SSH_CONNECTION: 'x', STUDIO_BROWSER: '/bin/true' }, platform: 'linux' }), { place: 'browser', open: true });
});
