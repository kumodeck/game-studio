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
// a comment at the end of the main script (a change that moves nothing). For a paused ask, the
// shelf's samples have their own answers (SHELF_FIXES / shelfFix, below).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Where the stand-in's three lighthouses stand, by the opening camera the ask came with (`view.eye`: the editor's
 * camera; Lantern Cove's wide one stands at x = 8, the portrait phone's at x = -4). [key, x, z, scale].
 * Fixed 2026-11-07: the spots were (-38,-27 / 31,-8 / 27,13), and from the opening camera none of the three showed
 * (beyond the left and right edges; the sample's "Try asking" After showed no change). These are found by projecting
 * terrain.js height() through main.js's two opening cameras (16:9 and 4:3 frames, and a portrait phone): on the
 * headland right of the lighthouse (the sail covers the headland's middle), on the far hills between the sail and the
 * sea stack, and on the right-hand beach in front of the cottage (wide) or the headland's near ledge (portrait, which
 * sees only the headland). test/fix-1107.test.ts checks every spot is on land and inside its camera.
 */
export function lighthouseSpots(view) {
  const wide = !view || !Array.isArray(view.eye) || view.eye[0] > 2;
  return wide
    ? [['lighthouse-cliff', -20, -17, 0.5], ['lighthouse-far', -24, -91, 0.9], ['lighthouse-shore', 15, -8, 0.55]]
    : [['lighthouse-cliff', -20, -17, 0.5], ['lighthouse-far', -24, -91, 0.9], ['lighthouse-ledge', -22, -11, 0.5]];
}

/** What to change, by the game in the folder. Each step is one file write. `view`: the ask's camera (lighthouseSpots). */
export function planFor(folder, lang = 'en', view = null) {
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
// Three more lighthouses around the island, smaller than the main one, where the opening view sees
// them. Copies of the main lighthouse, each with its own mark.
for (const [key, x, z, s] of ${JSON.stringify(lighthouseSpots(view))}) {
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
  // ✦ Have Claude make it appear here (pause-edit, 2026-10-28; SKILL.md "Paused"): something the game made, dragged to
  // where it should appear. A real AI changes where the game makes it; the stand-in says it would, in one line.
  if (rec.made && rec.here && Array.isArray(rec.here.to?.p)) {
    const name = rec.here.label || rec.here.key;
    const x = Number(rec.here.to.p[0]).toFixed(1);
    // One line: what was done (SKILL.md "Paused": never "Reload" — the editor offers ▶ Try from … itself).
    return ja ? `${name}は X ${x} のあたりから出るようにします。` : `${name} will come in around X ${x}.`;
  }
  const near = Array.isArray(rec.near) && rec.near[0] ? rec.near[0].label || rec.near[0].key : '';
  const turns = Array.isArray(rec.history) ? rec.history.length : 0;
  if (turns) {
    return ja ? `（${turns} 件の話の続き）はい、変えるなら一か所だけです。直しましょうか？` : `(Following our ${turns} earlier messages) Yes: it is one line to change. Shall I?`;
  }
  return ja
    ? `止めた瞬間を見ました。${near ? `いちばん近いのは「${near}」です。` : ''}ここではゲームのコードの通りに動いています。`
    : `I see the moment you stopped at.${near ? ` Nearest you is "${near}".` : ''} It does what the code says here.`;
}

// ---------------------------------------------------------------- the sample shelf's "Try asking" answers
// The shelf (decided 2026-11-06): every sample's starter.json has `try.ask` — the one thing to ask from a paused
// moment. Here is the stand-in's answer to each, for the tests and the clips: one change that makes the picture very
// different in a 10-second Before / After, made the way a real AI would make it (change a number in the code).
// One row per sample, so whoever adds a sample adds one row and nothing else here.
//   is(folder)       — is this folder that sample (by its code: a copied sample has no starter.json)
//   fix(folder, rec) — change the code; { files, note } (note in rec.lang), or null when the code is not as expected
// Pass `fix: shelfFix` to startFakeAgent to answer a paused ask with them.
const readIf = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
export const SHELF_FIXES = [
  {
    // Big Swell: “Make the waves twice as tall.” → WAVE_HEIGHT × 2 (1.0 → 2.0; every wave and the big swell follow it).
    id: 'big-swell',
    is: (folder) => /const WAVE_HEIGHT = [\d.]+;/.test(readIf(join(folder, 'game.js'))),
    fix(folder, rec) {
      const f = join(folder, 'game.js');
      const src = readFileSync(f, 'utf8');
      const m = /const WAVE_HEIGHT = ([\d.]+);/.exec(src);
      if (!m) return null;
      const v = (Number(m[1]) * 2).toFixed(1);
      writeFileSync(f, src.replace(m[0], `const WAVE_HEIGHT = ${v};`));
      return { files: ['game.js'], note: rec.lang === 'ja' ? `波の高さを ${m[1]} → ${v} にしました。` : `The waves are now twice as tall (WAVE_HEIGHT ${m[1]} → ${v}).` };
    },
  },
  {
    // Lantern Cove: “Add three more lighthouses around the island.” → the same change planFor() makes for a plain ask.
    id: 'lantern-cove',
    is: (folder) => existsSync(join(folder, 'js/props.js')) && readIf(join(folder, 'js/main.js')).includes('Lantern Cove'),
    fix(folder, rec) {
      const plan = planFor(folder, rec.lang, rec.view);
      for (const step of plan.steps) step();
      return { files: ['js/main.js'], note: plan.done + (rec.lang === 'ja' ? '。' : '.'), changed: plan.changed };
    },
  },
  {
    // Neon Run (examples/three-neon-boss): “Bring the boss in from here.” (with a ◎ mark) → the boss comes in 2 m more
    // to the left (as test/studio-clip-ba.browser.mjs's nudgeBoss: the v0.1.82 clip).
    id: 'three-neon-boss',
    is: (folder) => /boss\.position\.set\(/.test(readIf(join(folder, 'game.js'))),
    fix(folder, rec) {
      const f = join(folder, 'game.js');
      const src = readFileSync(f, 'utf8');
      const m = /boss\.position\.set\((-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\);/.exec(src);
      if (!m) return null;
      const x = (Number(m[1]) - 2).toFixed(1);
      writeFileSync(f, src.replace(m[0], `boss.position.set(${x}, ${m[2]}, ${m[3]});`));
      return { files: ['game.js'], note: rec.lang === 'ja' ? `ボスは X ${x} から出るようにしました。` : `The boss now comes in at X ${x}, more to the left.` };
    },
  },
  {
    // Firefly Ruins: “Make it night and double the fireflies.” → the firefly count × 2 (46 → 92) in js/life.js, and a
    // deep blue veil over the world under the fireflies in js/main.js (so they glow brighter against it).
    id: 'firefly-ruins',
    is: (folder) => readIf(join(folder, 'js/main.js')).includes('Firefly Ruins') && existsSync(join(folder, 'js/life.js')),
    fix(folder, rec) {
      const life = join(folder, 'js/life.js'), main = join(folder, 'js/main.js');
      const src = readFileSync(life, 'utf8');
      const m = /for \(let i = 0; i < (\d+); i\+\+\) \{\n(\s+)const s = new Sprite\(flyTex\);/.exec(src);
      if (!m) return null;
      const n = Number(m[1]) * 2;
      writeFileSync(life, src.replace(m[0], m[0].replace(`i < ${m[1]};`, `i < ${n};`)));
      edit(main, "import { Application, Container, Rectangle, Sprite } from 'pixi.js';", "import { Application, Container, Graphics, Rectangle, Sprite } from 'pixi.js';");
      edit(main, 'app.stage.addChild(backdrop.back, backdrop.bank, ...objects.back, backdrop.shafts, pond.pond, ...objects.front, life.layer, vignette);',
        `// Night: a deep blue veil over the world, under the fireflies (they glow on top of it).
const night = new Graphics().rect(-W, -H, W * 3, H * 3).fill({ color: 0x0a1030, alpha: 0.62 });
night.studio = false;
app.stage.addChild(backdrop.back, backdrop.bank, ...objects.back, backdrop.shafts, pond.pond, ...objects.front, night, life.layer, vignette);`);
      return { files: ['js/life.js', 'js/main.js'], note: rec.lang === 'ja' ? `夜にして、ホタルを ${m[1]} → ${n} 匹にしました。` : `It is night now, and there are twice the fireflies (${m[1]} → ${n}).` };
    },
  },
  {
    // Domino Spiral: “Make the dominoes twice as tall.” → DOMINO_HEIGHT × 2 in game.js (1.0 → 2.0).
    id: 'domino-spiral',
    is: (folder) => readIf(join(folder, 'game.js')).includes('Domino Spiral'),
    fix(folder, rec) {
      const f = join(folder, 'game.js');
      const src = readIf(f);
      const m = /const DOMINO_HEIGHT = ([\d.]+);/.exec(src);
      if (!m) return null;
      const v = (Number(m[1]) * 2).toFixed(1);
      writeFileSync(f, src.replace(m[0], `const DOMINO_HEIGHT = ${v};`));
      return { files: ['game.js'], note: rec.lang === 'ja' ? `ドミノの高さを ${m[1]} → ${v} にしました。` : `The dominoes are now twice as tall (DOMINO_HEIGHT ${m[1]} → ${v}).` };
    },
  },
  {
    // Marble Rain: “Add a spinning paddle here.” (with a ◎ mark) → one [x, y] in the empty PADDLES list of game.js, at the
    // mark (marbleRainPaddle below).
    id: 'marble-rain',
    is: (folder) => readIf(join(folder, 'game.js')).includes('Marble Rain'),
    fix: (folder, rec) => marbleRainPaddle(folder, rec),
  },
];

/** The shelf's answer for the sample in `folder` (SHELF_FIXES), as startFakeAgent's `fix`; null for any other game. */
export function shelfFix(folder, rec) {
  const row = SHELF_FIXES.find((r) => r.is(folder));
  return row ? row.fix(folder, rec) : null;
}

/**
 * Marble Rain (starters/marble-rain, sample shelf, 2026-11-06): the fix for its `try.ask` "Add a spinning paddle here."
 * — one spinning paddle at the person's ◎ mark, written as a real AI would: the empty `const PADDLES = [];` in game.js
 * gets one [x, y] in the board's pixels. Its row in SHELF_FIXES calls it (so `fix: shelfFix` answers it); also usable alone as `fix`.
 * Where: the first mark's `world` (the 2D adapter's toGround = board pixels); a mark without one, its place on the
 * frame (0–1) times the board (1280 × 800); no mark, just above the first pins. null when game.js is not Marble Rain.
 */
export function marbleRainPaddle(folder, rec) {
  const f = join(folder, 'game.js');
  if (!existsSync(f)) return null;
  const src = readFileSync(f, 'utf8');
  if (!src.includes('Marble Rain') || !src.includes('const PADDLES = [];')) return null;
  const m = Array.isArray(rec.marks) ? rec.marks[0] : null;
  const at = Array.isArray(m?.world) && m.world.length >= 2 ? m.world
    : Array.isArray(m?.screen) ? [(m.screen.length === 4 ? (m.screen[0] + m.screen[2]) / 2 : m.screen[0]) * 1280, (m.screen.length === 4 ? (m.screen[1] + m.screen[3]) / 2 : m.screen[1]) * 800]
      : [640, 118];
  const [x, y] = at.map((v) => Math.round(Number(v)));
  writeFileSync(f, src.replace('const PADDLES = [];', `const PADDLES = [[${x}, ${y}]];`));
  return { files: ['game.js'], note: rec.lang === 'ja' ? `◎ の所に回る板を足しました（x ${x}, y ${y}）。玉をはじきます。` : `Added a spinning paddle at your mark (x ${x}, y ${y}): it bats the marbles aside.` };
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
 * `madeCode` (pause-edit fix 1, 2026-10-28; walk 1 ✕6): a paused `made` request ("make it appear here") is answered as
 * a real AI does — examples/three-neon-boss's game.js makes the boss where it was put — with `--changed 1`. Without it the
 * stand-in only says it would (`--changed 0`), as before.
 * pause-ask stage 3 (2026-11-02; SKILL.md "Paused"): `fix(folder, rec)` changes the code for a paused ask that is not a
 * "made" one and answers `{ files, note, changed? }` (null = an answer only); `connect(folder)` writes the game's
 * codeMoment values and save / load. As SKILL.md asks, with a change from a paused moment whose `back` kept no moment
 * (the game had no save / load: decided 2026-11-02), `connect` runs first, with the fix; after any change it runs
 * `--check-moment <back>` (the line is in the log as `check …`) and replies with `--files`.
 * ● Clip stage 2 (2026-11-05; SKILL.md "Clip post"): an `ask` with `intent: "clip-post"` (✦ Rewrite) changes no files and
 * answers with the post as the note — `clipPost(rec)`'s, else a plain rewrite of its own (with the address when the
 * clip's mark is on).
 * The shelf's samples (2026-11-06): pass `fix: shelfFix` for a paused ask on a shelf sample to get that sample's
 * one-number fix (SHELF_FIXES). WHY not the default: older tests ask from a paused Neon Run and expect no file change
 * (its row would move the boss); the shelf tests opt in (merged 2026-11-06).
 */
export function startFakeAgent(folder, { slow = false, onEvent = () => {}, plan: given = null, madeCode = false, fix = null, connect = null, clipPost = null } = {}) {
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
        let rec = {};
        try {
          rec = JSON.parse(readFileSync(join(folder, ask[1]), 'utf8'));
        } catch {
          /* moved already */
        }
        if (rec.intent === 'clip-post') {
          await sleep(gap.wake);
          status('received', '--request', ask[2]);
          await sleep(gap.read);
          const post = clipPost ? clipPost(rec) : `Fixed my web game from a paused moment, then filmed it 👇${rec.clip?.mark === false ? '' : ' https://github.com/kumodeck/game-studio'}`;
          status('done', '--request', ask[2], '--changed', '0', '--note', post);
          note('rewrote the post');
          return;
        }
        // `plan`: a change of the test's own (studio-play-after-ai: another object's colour), else the game's usual one.
        const plan = given || planFor(folder, lang, rec.view);
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
        let changed = 0;
        let reply = null;
        const files = [];
        const gameJs = join(folder, 'game.js');
        const made = madeCode && rec.made && Array.isArray(rec.here?.to?.p) && existsSync(gameJs);
        const fixing = !rec.made && typeof fix === 'function';
        // The moment it was asked from (stage 3): kept whole only when the game had save / load at the pause.
        let kept = null;
        if (typeof rec.back === 'string') {
          try {
            kept = JSON.parse(readFileSync(join(folder, rec.back), 'utf8'));
          } catch {
            kept = null;
          }
        }
        if ((made || fixing) && connect && kept && !('moment' in kept)) {
          connect(folder);
          files.push('game.js');
          note('wrote the moment hooks');
        }
        if (made) {
          const [x, y, z] = rec.here.to.p.map((v) => Number(v).toFixed(1));
          edit(gameJs, 'boss.position.set(0, 2.6, -26);', `boss.position.set(${x}, ${y}, ${z});`);
          changed = 1;
          if (!files.includes('game.js')) files.push('game.js');
          note('wrote a file');
        } else if (fixing) {
          const r = fix(folder, rec);
          if (r) {
            changed = r.changed ?? 1;
            reply = r.note;
            for (const f of r.files ?? []) if (!files.includes(f)) files.push(f);
            note('wrote a file');
          }
        }
        // SKILL.md "Paused": check from the same moment before replying (the picture .studio/shot/moment-back.png).
        if (changed && typeof rec.back === 'string') {
          const c = spawnSync(process.execPath, [CLI, folder, '--check-moment', rec.back], { encoding: 'utf8', timeout: 120000 });
          note(`check ${(c.stdout || c.stderr || '').trim().split('\n').pop()}`);
        }
        await sleep(gap.look);
        status('done', '--request', paused[2], '--changed', String(changed), ...(files.length && changed ? ['--files', files.join(',')] : []), '--note', reply ?? chatReplyFor(rec));
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
