// Command line entry: node studio.mjs <game folder> [options]
//
// Started by the AI agent (via the plugin's skill) in the background. The agent learns what
// happens by reading standard output, so stdout carries exactly one line per event, always starting
// with "studio: ":
//   studio: ready <url>                      the editor is up; open this link
//   studio: saved placement.json (3 objects)  a result file was written
//   studio: added assets/rock.glb            the user added an asset
//   studio: next-step publish .studio/next-step.md   the user asked for a KUMODeck step
//   studio: request ask .studio/requests/<id>.json "…" (barrel)   the user asked the AI something
//   studio: stopped
//   studio: check-view ok|failed|skipped …   with --check-view (then the process exits)
//   studio: no-game <folder> - ask once …    no index.html: offer a starter (exit 4, see --starter)
//   studio: started <id> (12 files)          --starter copied a sample game in; "ready" follows
//   studio: undone .studio/requests/<id>.json "…"   the person pressed "Undo AI change"
//   studio: watching 0 waiting               --watch started (then one line per request, as above)
//   studio: ready <url> pid <n>              --detach: the editor runs on its own (log in .studio/studio.log)
//   studio: stopped pid <n> …  /  studio: not running …   --stop
// Anything meant only for a human (help text, the QR code) goes to stderr.

import { promises as fs, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// First of the relative imports on purpose: build.mjs then puts it first in studio.mjs, so a too-old
// Node stops with one line before any other code runs (node-check.mjs).
import { NODE_MIN } from './node-check.mjs';
import { startStudioServer } from './server.mjs';
import { encodeQR, qrToTerminal } from './qr.mjs';
import { runViewCheck, runGameShot } from './view-check.mjs';
import { writeStudioFile } from './files.mjs';
import { normalizeStatus, isRequestId, AI_STATES } from '../schema/handoff.mjs';
import { findStarters, pickStarter, copyStarter, noGameLine } from './starters.mjs';
import { runWatch } from './ai-watch.mjs';
import { recordServer, forgetServer, liveServers, stopFolder, detachEditor } from './lifecycle.mjs';

const HELP = `Usage: node studio.mjs <game folder> [options]

Opens the game in the KUMODeck Game Studio editor. Saving writes placement.json and
library.json into the folder; your AI agent reads them and updates the code.

Options:
  --entry <file>   page to open (default: index.html)
  --port <n>       port to listen on (default: a free port)
  --tool <name>    open on "placement" (default) or "library"
  --lan            listen on this computer's Wi-Fi/LAN address so a phone on the same
                   network can open the editor (prints a QR code; the pass is still required)
  --no-open        do not open a browser
  --detach         start the editor on its own and return: prints "studio: ready <url> pid <n>"
                   (the editor keeps running after this command and your AI's turn end; its
                   output goes to <folder>/.studio/studio.log). Use this to start it.
  --stop           stop the editor (and the --watch) started for this folder, by the pids in
                   .studio/server.json and .studio/watch.json. Nothing else is stopped
  --check-view     check that the game looks the same in the editor as when it is played
                   (a private headless Chrome; writes .studio/view-check.md), then exit.
                   Exit code 0 ok, 1 different, 3 could not check
  --shot           shoot the game as it is played (no editor) in a private headless Chrome:
                   .studio/shot/game.png (1280x800) and game-phone.png (390x844), then exit.
                   Look at them after changing the game, before you report. Exit 3 = no Chrome
  --ui <folder>    built editor UI (default: studio-ui next to this file)

A folder without a game (no index.html):
  --starter <3d|2d|id>  copy a sample game into the folder (created if missing; nothing is
                   ever overwritten), then open the editor on it
  --starters       list the sample games (one JSON per line), then exit
  --starters-dir <folder>  take the samples from this folder instead of the plugin's starters/

For the AI agent (hand-offs, see the arrange skill), then exit:
  --watch          keep running and print one studio: line per new request (the waiting ones
                   first). Run it as your watch (Claude Code: Monitor): while it runs, the
                   editor shows the person that you are watching (.studio/watch.json)
  --requests       print the requests waiting in .studio/requests/ (one JSON per line)
  --status <state> tell the editor how it is going: received | working | asking | done | failed
                   (asking: you asked the person something in your window; --note is the question)
                   (writes .studio/status.json; the editor shows one short line)
    --request <id>   the latest request this is about (default: the newest waiting one)
    --changed <n>    how many things you changed in the game (shown as "done (n)")
    --note <text>    one short line for the person, in their language
                   done / failed also move the waiting requests up to <id> into
                   .studio/requests/done/, so the next --requests shows only new ones
  -h, --help       show this help

Nothing is sent anywhere: the server only talks to the browser on this machine (or, with
--lan, on your local network) and only reads and writes inside the game folder.
Needs Node.js ${NODE_MIN.join(".")} or later.`;

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.starters) return listStarters(path.dirname(fileURLToPath(import.meta.url)), args);
  if (args.help || !args.dir) {
    process.stderr.write(HELP + '\n');
    return args.help ? 0 : 2;
  }

  let root = path.resolve(args.dir);
  const entry = args.entry || 'index.html';
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (args.stop) return stopCommand(root);
  if (args.detach) return detachCommand(root, argv, args);
  // --starter: fill a folder that has no game (it may not exist yet), then carry on as usual.
  if (args.starter !== undefined) {
    const code = await useStarter(root, entry, here, args);
    if (code !== null) return code;
  }
  if (!existsSync(root) || !(await fs.stat(root)).isDirectory()) {
    process.stderr.write(`studio: ${root} isn’t a folder. Check the path and try again.\n`);
    return 2;
  }
  // Many starters keep the served files in public/ (with config and tooling one level up).
  // Serve the folder that actually holds the page, so relative URLs and placement.json resolve
  // the same way they do when the game is deployed.
  if (!existsSync(path.join(root, entry)) && existsSync(path.join(root, 'public', entry))) {
    root = path.join(root, 'public');
  }
  if (!existsSync(path.join(root, entry))) {
    // No game here. With the default page that usually means "an empty folder": say on stdout what
    // the agent asks and runs next (the arrange skill, "A folder without a game"). Exit 4 = no game.
    if (!args.entry) {
      process.stdout.write(noGameLine(root, await findStarters(here, args.startersDir)) + '\n');
      process.stderr.write(`There’s no ${entry} in ${root} yet. To open a different page, use --entry <file>.\n`);
      return 4;
    }
    process.stderr.write(`studio: no ${entry} in ${root}. Check the name after --entry.\n`);
    return 2;
  }

  let host = '127.0.0.1';
  if (args.lan) {
    host = lanAddress();
    if (!host) {
      process.stderr.write('studio: couldn’t find a Wi-Fi or LAN address for --lan. Connect to a network and try again.\n');
      return 2;
    }
  }

  if (args.requests) return listRequests(root);
  if (args.watch) {
    await runWatch(realpathSync(root));
    return 0;
  }
  if (args.status !== undefined) return writeStatus(root, args);

  if (args.checkView) return checkView(root, entry, args, here);
  if (args.shot) return gameShot(root, entry);
  const srv = await startStudioServer({
    root,
    entry,
    host,
    port: args.port,
    isLan: args.lan,
    uiDir: args.ui ? path.resolve(args.ui) : path.join(here, 'studio-ui'),
    onStop: () => stop(),
  });

  // --tool library: open the editor on the Library (the shell reads ?tool=).
  const link = args.tool === 'library' ? `${srv.url}&tool=library` : srv.url;
  if (args.tool && args.tool !== 'library' && args.tool !== 'placement') process.stderr.write(`studio: unknown --tool ${args.tool} (placement | library)\n`);
  process.stdout.write(`studio: ready ${link}\n`);
  // For --stop (and --detach's "already running"): this folder's editors by pid (lifecycle.mjs).
  const rootReal = realpathSync(root);
  await recordServer(rootReal, { url: link, port: srv.port, origin: srv.origin, stopToken: srv.stopToken });
  process.stderr.write(`Game Studio is open for ${root}\nPress Ctrl+C to stop.\n`);
  if (args.lan) {
    process.stderr.write('\nScan this with a phone on the same Wi-Fi:\n' + qrToTerminal(encodeQR(link)) + '\n\n');
  }
  if (args.open !== false) openBrowser(link);

  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await srv.close();
    await forgetServer(rootReal);
    process.stdout.write('studio: stopped\n');
    process.exit(0);
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return null; // keep running
}

// ---------------------------------------------------------------------------------------------
// --detach / --stop (lifecycle.mjs): start the editor so it outlives the agent's turn, and stop only this folder's.

/** Where an editor for `root` writes server.json: the folder, or its public/ when the game is served from there. */
function servedRoots(root) {
  const out = [];
  for (const r of [root, path.join(root, 'public')]) {
    if (existsSync(path.join(r, '.studio'))) out.push(realpathSync(r));
  }
  return out;
}

async function stopCommand(root) {
  if (!existsSync(root)) {
    process.stderr.write(`studio: ${root} isn’t a folder. Check the path and try again.\n`);
    return 2;
  }
  const { stopped, watch } = await stopFolder(servedRoots(root));
  if (!stopped.length && !watch) {
    process.stdout.write(`studio: not running (no editor started for ${root})\n`);
    return 0;
  }
  const what = [stopped.length ? `pid ${stopped.join(', ')}` : '', watch ? `the watch (pid ${watch})` : ''].filter(Boolean).join(' and ');
  process.stdout.write(`studio: stopped ${what}\n`);
  return 0;
}

async function detachCommand(root, argv, args) {
  if (!existsSync(root) && args.starter === undefined) {
    process.stderr.write(`studio: ${root} isn’t a folder. Check the path and try again.\n`);
    return 2;
  }
  // Already open for this folder (the agent ran the start line twice, or a new turn): the same editor, not a second.
  for (const r of servedRoots(root)) {
    const live = (await liveServers(r)).filter((s) => s.url);
    if (live.length) {
      const s = live[live.length - 1];
      process.stdout.write(`studio: ready ${s.url} pid ${s.pid} (already running)\n`);
      return 0;
    }
  }
  await fs.mkdir(path.join(root, '.studio'), { recursive: true });
  const log = path.join(root, '.studio', 'studio.log');
  const script = fileURLToPath(import.meta.url);
  const r = await detachEditor({ script, args: argv.filter((a) => a !== '--detach'), log });
  if (r.code === 0) {
    for (const l of r.lines) process.stdout.write(l + '\n');
    process.stdout.write(`studio: ready ${r.url} pid ${r.pid}\n`);
    process.stderr.write(`The editor keeps running on its own (log: ${log}).\nStop it with: node ${script} ${root} --stop\n`);
    return 0;
  }
  if (r.timeout) {
    process.stdout.write(`studio: not ready yet after ${Math.round(DETACH_WAIT_S)} s (pid ${r.pid}). Read ${log}; stop it with --stop\n`);
    return 1;
  }
  // It stopped before it was ready: what it said is the answer (no game, a folder error, a blocked port).
  for (const l of r.lines) (l.startsWith('studio: ') && !/^studio: [^ ]+ (isn|couldn|no )/.test(l) ? process.stdout : process.stderr).write(l + '\n');
  return r.code;
}

// --check-view: one run of the view check (view-check.mjs) on a private server, then exit. The
// server's own lines (ready, check ok/failed) go to stderr so stdout carries only the verdict.
async function checkView(root, entry, args, here) {
  const rootReal = realpathSync(root);
  const logs = [];
  const srv = await startStudioServer({
    root,
    entry,
    uiDir: args.ui ? path.resolve(args.ui) : path.join(here, 'studio-ui'),
    log: (l) => {
      logs.push(l);
      process.stderr.write(l + '\n');
    },
  });
  try {
    const r = await runViewCheck(srv, { rootReal, entry, logs });
    process.stdout.write(r.line + '\n');
    return r.status === 'ok' ? 0 : r.status === 'failed' ? 1 : 3;
  } finally {
    await srv.close();
  }
}

// --shot: the game played normally, shot in a private headless Chrome (view-check.mjs runGameShot),
// so the AI can look at the result of its change before it reports. Exit 0 ok, 3 could not shoot.
async function gameShot(root, entry) {
  const r = await runGameShot({ rootReal: realpathSync(root), entry });
  process.stdout.write(r.line + '\n');
  return r.status === 'ok' ? 0 : 3;
}

// ---------------------------------------------------------------------------------------------
// Starters (starters.mjs): a sample game for a folder without one.

async function listStarters(here, args) {
  const list = await findStarters(here, args.startersDir);
  for (const s of list) {
    process.stdout.write(JSON.stringify({ id: s.id, dim: s.dim, title: s.title, blurb: s.blurb, thumb: s.thumb, ...(s.fallback ? { fallback: true } : {}) }) + '\n');
  }
  process.stderr.write(`studio: ${list.length} sample${list.length === 1 ? '' : 's'}\n`);
  return 0;
}

/** Copy the chosen starter into `root`. null = done, go on and open the editor; a number = exit. */
async function useStarter(root, entry, here, args) {
  // The same sample is already here (the start line run again: after a blocked first start, EPERM in a sandbox, or
  // a new turn): open it, copy nothing. Same page byte for byte = the sample as copied (agent-solid pass 2026-10-17).
  if (existsSync(path.join(root, entry))) {
    const s0 = pickStarter(await findStarters(here, args.startersDir), args.starter);
    const mine = s0 && (await fs.readFile(path.join(s0.dir, entry)).catch(() => null));
    const theirs = await fs.readFile(path.join(root, entry)).catch(() => null);
    if (mine && theirs && mine.equals(theirs)) {
      process.stdout.write(`studio: note the sample ${s0.id} is already in this folder, so nothing was copied; opening it\n`);
      return null;
    }
  }
  // Never into a folder that has a game: a starter is for starting, not for mixing into a project.
  if (existsSync(path.join(root, entry)) || existsSync(path.join(root, 'public', entry))) {
    process.stderr.write(`studio: ${root} already has a game (${entry}). --starter only works in a folder without one, so nothing was copied.\n`);
    return 2;
  }
  if (existsSync(root) && !(await fs.stat(root)).isDirectory()) {
    process.stderr.write(`studio: ${root} isn’t a folder. Check the path and try again.\n`);
    return 2;
  }
  const list = await findStarters(here, args.startersDir);
  const s = pickStarter(list, args.starter);
  if (!s) {
    const have = list.map((x) => `${x.dim} ${x.id}`).join(', ') || 'none';
    process.stderr.write(`studio: no sample "${args.starter}" (samples: ${have})\n`);
    return 2;
  }
  await fs.mkdir(root, { recursive: true });
  const r = await copyStarter(s, root);
  if (r.conflicts.length) {
    process.stderr.write(`studio: nothing copied, because these files are already in ${root}: ${r.conflicts.slice(0, 5).join(', ')}${r.conflicts.length > 5 ? ' …' : ''}\n`);
    return 2;
  }
  process.stdout.write(`studio: started ${s.id} (${r.files.length} files) ${s.title}\n`);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Hand-offs (CONTRACT.md §3.4), for the agent. Requests are files first, so these work whether or
// not the editor or a watcher is running.

/** Waiting requests (not yet moved to done/), oldest first. */
async function pendingRequests(root) {
  const dir = path.join(root, '.studio', 'requests');
  const names = await fs.readdir(dir).catch(() => []);
  const out = [];
  for (const n of names.filter((x) => x.endsWith('.json')).sort()) {
    const id = n.slice(0, -5);
    if (!isRequestId(id)) continue;
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')));
    } catch {
      out.push({ id, error: 'not valid JSON' });
    }
  }
  return out;
}

async function listRequests(root) {
  const list = await pendingRequests(root);
  for (const r of list) process.stdout.write(JSON.stringify(r) + '\n');
  process.stderr.write(`studio: ${list.length} waiting request${list.length === 1 ? '' : 's'} in .studio/requests/\n`);
  return 0;
}

async function writeStatus(root, args) {
  if (!AI_STATES.includes(args.status)) {
    process.stderr.write(`studio: --status must be one of ${AI_STATES.join(', ')}\n`);
    return 2;
  }
  const pending = await pendingRequests(root);
  const latest = pending.length ? pending[pending.length - 1].id : undefined;
  const request = args.request && args.request !== 'latest' ? args.request : latest;
  if (args.request && args.request !== 'latest' && !isRequestId(args.request)) {
    process.stderr.write('studio: --request must be a request id like 20261016-153012-482-ask-9f3c\n');
    return 2;
  }
  const st = normalizeStatus({
    state: args.status, request, changed: Number.isFinite(args.changed) ? Math.round(args.changed) : undefined,
    note: args.note, at: new Date().toISOString(),
  });
  // done / failed: the requests up to this one are handled; move them out of the waiting list.
  if ((args.status === 'done' || args.status === 'failed') && pending.length) {
    const handled = pending.filter((r) => isRequestId(r.id) && (!request || r.id <= request)).map((r) => r.id);
    const doneDir = path.join(root, '.studio', 'requests', 'done');
    await fs.mkdir(doneDir, { recursive: true });
    for (const id of handled) await fs.rename(path.join(root, '.studio', 'requests', `${id}.json`), path.join(doneDir, `${id}.json`)).catch(() => {});
    if (handled.length) st.handled = handled.slice(-200);
  }
  const p = await writeStudioFile(realpathSync(root), 'status.json', JSON.stringify(st, null, 2) + '\n');
  process.stdout.write(`studio: status ${st.state}${st.request ? ' ' + st.request : ''} (${p})\n`);
  return 0;
}

function parseArgs(argv) {
  const out = { open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--lan') out.lan = true;
    else if (a === '--no-open') out.open = false;
    else if (a === '--detach') out.detach = true;
    else if (a === '--stop') out.stop = true;
    else if (a === '--check-view') out.checkView = true;
    else if (a === '--shot') out.shot = true;
    else if (a === '--entry') out.entry = argv[++i];
    else if (a === '--ui') out.ui = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]) || 0;
    else if (a === '--tool') out.tool = argv[++i];
    else if (a === '--requests') out.requests = true;
    else if (a === '--watch') out.watch = true;
    else if (a === '--status') out.status = argv[++i] || '';
    else if (a === '--request') out.request = argv[++i];
    else if (a === '--changed') out.changed = Number(argv[++i]);
    else if (a === '--note') out.note = argv[++i];
    else if (a === '--starter') out.starter = argv[++i] || '';
    else if (a === '--starters') out.starters = true;
    else if (a === '--starters-dir') out.startersDir = path.resolve(argv[++i] || '.');
    else if (!a.startsWith('-') && !out.dir) out.dir = a;
    else {
      process.stderr.write(`studio: unknown option ${a}\n`);
      out.help = true;
    }
  }
  return out;
}

// First private IPv4 address that is not loopback. Wi-Fi/Ethernet names first, because VPN and
// container bridges (utun, docker0, vboxnet) are not reachable from a phone.
function lanAddress() {
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) =>
    (list || []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, address: a.address })),
  );
  const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  const preferred = (n) => /^(en|eth|wl|wlan|Wi-Fi|Ethernet)/i.test(n);
  const pick = all.find((a) => preferred(a.name) && isPrivate(a.address)) || all.find((a) => isPrivate(a.address));
  return pick ? pick.address : null;
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => process.stderr.write(`Open this link in your browser: ${url}\n`));
    child.unref();
  } catch {
    process.stderr.write(`Open this link in your browser: ${url}\n`);
  }
}

// Run when executed directly (also true for the bundled studio.mjs). Compare real paths: plugin
// installs often reach the file through a symlinked cache folder.
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code !== null) process.exit(code);
    },
    (e) => {
      // One line that says what to do (polish pass 2026-10-16), not only what broke.
      const how = e && e.code === 'EACCES' ? ' — this port needs admin rights. Start again without --port and a free one is picked for you.'
        : e && e.code === 'EADDRNOTAVAIL' ? ' — that address isn’t on this computer. Start again without --host.'
        : e && e.code === 'ENOENT' ? ' — check the folder path and try again.'
        // Codex's default sandbox (workspace-write) refuses even a server on 127.0.0.1 (real-agent play test
        // 10/17); the agent stopped there and told the person nothing they could do. Checked with
        // `codex sandbox -c sandbox_mode="workspace-write"` (EPERM) and the same with
        // `-c sandbox_workspace_write.network_access=true` (listens), codex-cli 0.163.0.
        : e && e.code === 'EPERM' && e.syscall === 'listen' ? ' — your AI’s sandbox is blocking the editor’s local server (it only listens on this computer). Run this command outside the sandbox (approve it if your AI asks), or start Codex with: codex -c sandbox_workspace_write.network_access=true'
        : '';
      process.stderr.write(`studio: ${e && e.message}${how}\n`);
      process.exit(1);
    },
  );
}
