// A stand-in for the AI agent, for tests and videos: it does what the arrange skill tells a real
// agent to do (skills/arrange/SKILL.md §3), with nothing but the CLI.
//
//   node test/ai-feel/fake-agent.mjs <game folder> [--slow]
//
// 1. Runs `studio.mjs <folder> --watch` (what Claude Code runs as its Monitor) and reads its lines.
// 2. On `studio: request ask …`: `--status received`, then `--status working --note …`, then
//    changes the game's code in two writes (a real agent often writes several files; the editor
//    must wait for "done" instead of reloading a half-written game), then `--status done
//    --changed <n> --note …` — the one-line reply the editor shows above the input.
// 3. On `studio: undone …` (the person pressed "Undo AI change"): leaves the code alone and
//    marks it handled with one line.
//
// The change it makes depends on the game it finds: Lantern Cove gets three more lighthouses
// around the island; the three-crates example gets three more crates in a row. Anything else:
// a comment at the end of the main script (a change that moves nothing).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What to change, by the game in the folder. Each step is one file write. */
export function planFor(folder, lang = 'en') {
  const ja = lang === 'ja';
  const lc = join(folder, 'js/main.js');
  if (existsSync(join(folder, 'js/props.js')) && existsSync(lc) && readFileSync(lc, 'utf8').includes('Lantern Cove')) {
    return {
      // The note is in the person's language (the request's `lang`), as the skill asks.
      working: ja ? '島のまわりに灯台を 3 つ足しています' : 'Adding 3 lighthouses around the island',
      done: ja ? '島のまわりに灯台を 3 つ足しました' : 'Added 3 lighthouses around the island',
      changed: 3,
      steps: [
        () => edit(lc, "import { makeTerrain, makeDepthField } from './terrain.js';", "import { makeTerrain, makeDepthField, height } from './terrain.js';"),
        () => edit(lc, 'for (const p of props.all) scene.add(p);\n', `for (const p of props.all) scene.add(p);
// Three more lighthouses around the island, smaller than the main one: on the far headland, the
// beach rise and the point by the pier. Copies of the main lighthouse, each with its own mark.
for (const [key, x, z, s] of [['lighthouse-west', -38, -27, 0.7], ['lighthouse-east', 31, -8, 0.75], ['lighthouse-point', 27, 13, 0.65]]) {
  const lh = props.lighthouse.clone();
  lh.userData = { studioKey: key };
  lh.name = key;
  lh.scale.setScalar(s);
  lh.position.set(x, height(x, z) - 0.15, z);
  scene.add(lh);
}
`),
      ],
    };
  }
  const tc = join(folder, 'game.js');
  if (existsSync(tc) && readFileSync(tc, 'utf8').includes('[2, 0, 2]].forEach')) {
    return {
      working: ja ? '木箱を 3 つ並べています' : 'Adding 3 crates in a row',
      done: ja ? '木箱を 3 つ並べました' : 'Added 3 crates in a row by the yard',
      changed: 3,
      steps: [
        () => edit(tc, ' * Crate Yard', ' * Crate Yard (3 more crates in a row)'),
        () => edit(tc, '[2, 0, 2]].forEach', '[2, 0, 2], [-1, 0, 3], [0.2, 0, 3], [1.4, 0, 3]].forEach'),
      ],
    };
  }
  const any = ['main.js', 'game.js', 'js/main.js'].map((f) => join(folder, f)).find(existsSync);
  return {
    working: 'Looking at it', done: 'Made the change', changed: 0,
    steps: any ? [() => writeFileSync(any, readFileSync(any, 'utf8') + '\n// changed by the stand-in agent\n')] : [],
  };
}

/**
 * A reply in the chat over a paused game (pause, 2026-10-22; SKILL.md §3.1.1 "Paused"): an answer in the note, no code
 * change. It names what the request says was nearest the player and how many turns came before, so a test can tell
 * that the moment and the talk so far reached it.
 */
export function chatReplyFor(rec) {
  const ja = rec.lang === 'ja';
  const near = Array.isArray(rec.near) && rec.near[0] ? rec.near[0].label || rec.near[0].key : '';
  const turns = Array.isArray(rec.history) ? rec.history.length : 0;
  if (turns) {
    return ja ? `（${turns} 件の話の続き）はい、変えるなら一か所だけです。直しましょうか？` : `(Following our ${turns} earlier messages) Yes: it is one line to change. Shall I?`;
  }
  return ja
    ? `止めた瞬間を見ました。${near ? `いちばん近いのは「${near}」です。` : ''}ここではゲームのコードの通りに動いています。`
    : `I see the moment you stopped at.${near ? ` Nearest you is "${near}".` : ''} It does what the code says here.`;
}

function edit(file, from, to) {
  const s = readFileSync(file, 'utf8');
  if (!s.includes(from)) throw new Error(`fake agent: "${from.slice(0, 40)}" not found in ${file}`);
  writeFileSync(file, s.replace(from, to));
}

/**
 * Start the stand-in. `slow` spaces the steps out like a person would see a real agent (for the
 * video); the default is quick (for tests). `plan` ({ working, done, changed, steps }) replaces planFor()'s change. Returns { stop(), log } where log lists what it did with
 * times (ms since start).
 */
export function startFakeAgent(folder, { slow = false, onEvent = () => {}, plan: given = null } = {}) {
  const t0 = Date.now();
  const log = [];
  const note = (what) => {
    log.push({ t: Date.now() - t0, what });
    onEvent(what);
  };
  const status = (...a) => {
    const r = spawnSync(process.execPath, [CLI, folder, '--status', ...a], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fake agent: --status ${a[0]} failed: ${r.stderr}`);
  };
  const gap = slow ? { wake: 1200, read: 900, step: 1300, look: 900 } : { wake: 300, read: 300, step: 500, look: 300 };
  const watch = spawn(process.execPath, [CLI, folder, '--watch'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let queue = Promise.resolve();
  createInterface({ input: watch.stdout }).on('line', (line) => {
    note(`line ${line}`);
    const ask = /^studio: request ask (\.studio\/requests\/(\S+)\.json)/.exec(line);
    // Paused (2026-10-22): a chat message from over a paused game: answer, change nothing.
    const paused = /^studio: request play (\.studio\/requests\/(\S+)\.json) .*\(paused, chat /.exec(line);
    const undone = /^studio: undone \.studio\/requests\/(\S+)\.json/.exec(line);
    // A Save (plan step 6, studio-play-save): the agent puts placement.json in the code. Nothing to write for a test
    // game that reads placement.json at load; the statuses are what the editor's line after Save follows.
    // The watch's line names the file, not the request: --status without --request is about the newest waiting one.
    const saved = /^studio: saved /.test(line);
    if (ask) {
      queue = queue.then(async () => {
        let lang = 'en';
        try {
          lang = JSON.parse(readFileSync(join(folder, ask[1]), 'utf8')).lang || 'en';
        } catch {
          /* moved already: English */
        }
        // `plan`: a change of the test's own (studio-play-after-ai: another object's colour), else the game's usual one.
        const plan = given || planFor(folder, lang);
        await sleep(gap.wake); // a Monitor wakes the agent within a few seconds
        status('received', '--request', ask[2]);
        note('received');
        await sleep(gap.read);
        status('working', '--request', ask[2], '--note', plan.working);
        note('working');
        for (const step of plan.steps) {
          await sleep(gap.step);
          step();
          note('wrote a file');
        }
        await sleep(gap.look); // §3.3: look at the game before reporting
        status('done', '--request', ask[2], '--changed', String(plan.changed), '--note', plan.done);
        note('done');
      }).catch((e) => note(`error ${e.message}`));
    } else if (paused) {
      queue = queue.then(async () => {
        let rec = {};
        try {
          rec = JSON.parse(readFileSync(join(folder, paused[1]), 'utf8'));
        } catch {
          /* handled already */
        }
        await sleep(gap.wake);
        status('received', '--request', paused[2]);
        note('received');
        await sleep(gap.read);
        status('working', '--request', paused[2], '--note', rec.lang === 'ja' ? 'この瞬間を見ています' : 'Looking at this moment');
        note('working');
        await sleep(gap.look);
        status('done', '--request', paused[2], '--changed', '0', '--note', chatReplyFor(rec));
        note('replied');
      }).catch((e) => note(`error ${e.message}`));
    } else if (saved) {
      queue = queue.then(async () => {
        await sleep(gap.wake);
        status('received');
        note('received');
        await sleep(gap.read + gap.step);
        status('done', '--changed', '0', '--note', 'Put the saved layout in the code');
        note('saved done');
      }).catch((e) => note(`error ${e.message}`));
    } else if (undone) {
      queue = queue.then(async () => {
        await sleep(gap.wake);
        // §3.1 `undone`: the person put the code back; leave it, and mark the record handled.
        status('done', '--request', undone[1], '--note', 'Okay, I left it as it was before'); // (seen in the agent's window, not the editor's line)
        note('undone handled');
      }).catch((e) => note(`error ${e.message}`));
    }
  });
  return {
    log,
    stop: () => new Promise((r) => {
      if (watch.exitCode !== null) return r();
      watch.once('exit', () => r());
      watch.kill('SIGTERM');
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  if (!folder) {
    process.stderr.write('usage: node test/ai-feel/fake-agent.mjs <game folder> [--slow]\n');
    process.exit(2);
  }
  const a = startFakeAgent(resolve(folder), { slow: process.argv.includes('--slow'), onEvent: (w) => process.stdout.write(`fake-agent: ${w}\n`) });
  process.once('SIGINT', () => void a.stop().then(() => process.exit(0)));
}
