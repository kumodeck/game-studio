// Play test: the first five minutes of Game Studio, from a clean start, as a
// newcomer would do them — pictures of every step, one video per screen size,
// how long each wait was, console errors, and a report.md.
//
//   node oss/game-studio/test/playtest/playtest.mjs [--worktree <path>] [--sample <id|path>]... [--only pc|phone]
//        [--out <dir>] [--no-empty] [--cdn-cache <dir>]
//
// --worktree  another checkout of this repository (default: this one). Only READ:
//             its editor (skills/arrange/bin/studio.mjs) and samples run from a
//             temporary copy; every output goes into THIS checkout.
// --sample    `three-crates`, `starters/<id>`, `examples/<id>` or a folder path.
//             A bare id is looked up in starters/ first, then examples/.
//             Default: three-crates and pixi-garden.
// --out       the folder for this run. Default: <out-base>/<date>-<time>-<branch>/.
// --out-base  where dated run folders go (default ./playtest-results in the current folder).
//             A repository can keep a one-line launcher that passes its own place.
// --no-empty  skip the "start in an empty folder" probe.
//
// Clean start = a new temporary copy of the sample, a new HOME for the editor
// process (no saved sign-in, no settings) and a new browser profile.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUTS, playRun, startEditor } from './user.mjs';
import { writeReport } from './report.mjs';
import { launch, newPage } from '../adapters-2d/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// The game-studio package this script belongs to (its checkout is the default target).
const SELF_PKG = resolve(HERE, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parse(argv) {
  const o = { worktree: SELF_PKG, samples: [], only: null, out: null, outBase: resolve('playtest-results'), empty: true, cdnCache: process.env.STUDIO_CDN_CACHE || null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--worktree') o.worktree = resolve(argv[++i]);
    else if (a === '--sample') o.samples.push(argv[++i]);
    else if (a === '--only') o.only = argv[++i];
    else if (a === '--out') o.out = resolve(argv[++i]);
    else if (a === '--out-base') o.outBase = resolve(argv[++i]);
    else if (a === '--no-empty') o.empty = false;
    else if (a === '--cdn-cache') o.cdnCache = resolve(argv[++i]);
    else if (a === '-h' || a === '--help') o.help = true;
    else o.samples.push(a);
  }
  if (!o.samples.length) o.samples = ['three-crates', 'pixi-garden'];
  return o;
}

function sampleDir(pkg, s) {
  if (isAbsolute(s) || s.startsWith('.')) return resolve(s);
  if (s.includes('/')) return join(pkg, s);
  for (const d of ['starters', 'examples']) if (existsSync(join(pkg, d, s, 'index.html'))) return join(pkg, d, s);
  return join(pkg, 'examples', s);
}

const git = (cwd, ...a) => {
  try { return execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim(); } catch { return ''; }
};

/**
 * Empty folder: what does a person with no game see? (The plan's first five
 * minutes start in an empty folder.) Runs the editor there for a few seconds;
 * if it serves a page, takes a PC and a phone picture of it.
 */
async function emptyProbe({ studioBin, outDir }) {
  const folder = mkdtempSync(join(tmpdir(), 'studio-playtest-empty-'));
  const home = mkdtempSync(join(tmpdir(), 'studio-playtest-home-'));
  const ed = startEditor({ studioBin, folder, home, timeoutMs: 10000 });
  const r = await ed.ready;
  const out = { ready: r, stdout: ed.lines.map((l) => l.line), stderr: ed.err.join('').trim(), exit: ed.proc.exitCode, shots: [] };
  try {
    if (r.url) {
      for (const layout of ['pc', 'phone']) {
        const L = LAYOUTS[layout];
        const browser = await launch();
        try {
          const page = await newPage(browser, { width: L.width, height: L.height, mobile: L.mobile });
          await page.goto(r.url);
          await sleep(4000);
          const file = `empty-${layout}.jpg`;
          const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
          writeFileSync(join(outDir, file), Buffer.from(shot.data, 'base64'));
          out.shots.push({ file, caption: `Empty folder, ${layout}` });
        } finally {
          await browser.close();
        }
      }
    }
  } finally {
    await ed.stop();
    rmSync(folder, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
  return out;
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 20).join('\n'));
    return;
  }
  // --worktree may be the package itself or a checkout that has it at oss/game-studio.
  const pkg = existsSync(join(o.worktree, 'oss/game-studio/package.json')) ? join(o.worktree, 'oss/game-studio') : o.worktree;
  const studioBin = join(pkg, 'skills/arrange/bin/studio.mjs');
  if (!existsSync(studioBin)) throw new Error(`no editor at ${studioBin}`);
  const branch = git(o.worktree, 'branch', '--show-current') || basename(o.worktree);
  const commit = git(o.worktree, 'rev-parse', '--short', 'HEAD');
  const dirty = git(o.worktree, 'status', '--porcelain', '--', 'oss/game-studio') ? ' (with uncommitted changes)' : '';
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const outDir = o.out || join(o.outBase, `${stamp}-${branch.replace(/[^A-Za-z0-9._-]+/g, '-')}`);
  mkdirSync(outDir, { recursive: true });
  const layouts = o.only ? [o.only] : ['pc', 'phone'];
  const node = process.version;
  console.log(`play test: ${branch} @ ${commit}${dirty} -> ${relative(process.cwd(), outDir) || outDir}`);

  const empty = o.empty ? await emptyProbe({ studioBin, outDir }) : null;
  if (empty) console.log(`  empty folder: ${empty.ready.url ? 'served a page' : `no page (exit ${empty.exit})`}`);

  const runs = [];
  for (const s of o.samples) {
    const src = sampleDir(pkg, s);
    const id = basename(src);
    if (!existsSync(join(src, 'index.html'))) {
      console.log(`  ${id}: no index.html at ${src}, skipped`);
      runs.push({ sample: id, src, missing: true });
      continue;
    }
    for (const layout of layouts) {
      const folder = mkdtempSync(join(tmpdir(), `studio-playtest-${id}-`));
      const home = mkdtempSync(join(tmpdir(), 'studio-playtest-home-'));
      cpSync(src, folder, { recursive: true });
      // A clean start: no earlier session's results in the copy.
      for (const f of ['placement.json', 'library.json', '.studio/requests', '.studio/status.json', '.studio/next-step.md']) rmSync(join(folder, f), { recursive: true, force: true });
      const tag = `${id}-${layout}`;
      console.log(`  ${tag} ...`);
      try {
        const r = await playRun({ studioBin, folder, home, layout, outDir, tag, cdnCache: o.cdnCache });
        for (const st of r.steps) console.log(`    ${st.ok ? 'ok  ' : 'FAIL'} ${st.name} (${st.s.toFixed(1)} s) ${st.note}`);
        runs.push({ sample: id, src: relative(o.worktree, src), layout, tag, ...r });
      } catch (e) {
        console.log(`    crashed: ${e.stack}`);
        runs.push({ sample: id, src: relative(o.worktree, src), layout, tag, crashed: e.message, steps: [], stumbles: [{ weight: 3, text: `The play test itself crashed: ${e.message}`, layout }], timing: [], shots: [], texts: [], errors: [], warnings: [] });
      } finally {
        rmSync(folder, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      }
    }
  }
  const ffv = spawnSync(process.env.STUDIO_FFMPEG || 'ffmpeg', ['-version'], { encoding: 'utf8' }).stdout?.split('\n')[0] || 'none';
  const file = writeReport({ outDir, branch, commit: commit + dirty, worktree: o.worktree, node, ffmpeg: ffv, when: now, empty, runs });
  writeFileSync(join(outDir, 'run.json'), JSON.stringify({ branch, commit, worktree: o.worktree, when: now, empty, runs }, null, 2));
  console.log(`report: ${file}`);
}

main().then(() => process.exit(0), (e) => {
  console.error(e.stack || e);
  process.exit(1);
});
