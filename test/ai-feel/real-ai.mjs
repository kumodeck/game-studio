// A real AI on the AI's hands (studio-ai-hands, 2026-10-24): the claude CLI, with this package's arrange skill, asked
// what a person asked that day (in Japanese, as they did: STEPS below) — and checked that it does the editor's work
// itself instead of handing it back.
//   1. "make the blue pillar spiral" → a motion on the timeline (an editor motion), not code in the game, and no
//      "press Reload" / steps for the person;
//   2. (the same conversation) "take the blue pillar's old motion off, only the spiral" → the AI takes "Sway" off
//      itself, with no steps for the person (or says it is off already, when it took it off in 1);
//   3. the same words in a NEW conversation, with Sway put back on the pillar first (the person's state that day: the
//      old motion and the spiral both on it) → the AI takes Sway off itself, the spiral stays.
// The game is Pillar Plaza (`pillars/`: a blue pillar that already sways), copied to a temporary folder. The editor
// runs with its own HOME (so no KUMODeck sign-in on this computer is read) and is open in a headless Chrome the whole
// time, as the person's editor would be; the AI's `--do` reaches it there. The skill is the package's own
// (`.claude/skills/arrange` → skills/arrange), MCP servers off, the person's other settings and plugins not loaded.
//
//   node test/ai-feel/real-ai.mjs [--model <model>] [--keep] [--out <dir>]
// Prints what the AI ran (`--do` lines), what it said (the editor's pass `t=…` hidden), and the checks. Exit 1 on a
// failure, 3 when there is no claude CLI or no headless Chrome. It costs real AI usage (three short turns).
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage } from '../adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const MODEL = take('--model');
const KEEP = args.includes('--keep');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The editor's link carries its pass: never printed (a person's secret on their own computer).
const hide = (s) => String(s).replace(/([?&]t=)[A-Za-z0-9_-]+/g, '$1…');

if (spawnSync('claude', ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.log('skipped: no claude CLI');
  process.exit(3);
}

const STEPS = [
  { say: '青い柱を螺旋で動かして', first: true },
  { say: '青い柱の前の動きを外して、螺旋だけにして' },
  { say: '青い柱の前の動きを外して、螺旋だけにして', first: true, seed: true },
];
// Handing the work back (Japanese and English): steps to click, asking for a reload or a Save, "in the editor, do …".
const HANDBACK = /右クリック|再読み込み|リロード|を押して(?!くだ)|押してください|開き直|選んで.*(外|押)|手順|^\s*[1-9]\.\s|Reload|right-click|press Save|保存してください|Save を押/m;

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const base = mkdtempSync(join(tmpdir(), 'studio-real-ai-'));
const game = join(base, 'game');
const home = join(base, 'home');
const out = take('--out') ? resolve(take('--out')) : join(base, 'report');
mkdirSync(home, { recursive: true });
mkdirSync(out, { recursive: true });
cpSync(join(PKG, 'test/ai-feel/pillars'), game, { recursive: true });
rmSync(join(game, 'README.md'), { force: true });
mkdirSync(join(game, '.claude/skills'), { recursive: true });
symlinkSync(join(PKG, 'skills/arrange'), join(game, '.claude/skills/arrange'));
mkdirSync(join(game, '.studio/ui'), { recursive: true });
writeFileSync(join(game, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'ja', theme: 'dark', seen: ['timeline-steps', 'open-line'] }));
const code0 = { main: readFileSync(join(game, 'main.js'), 'utf8'), index: readFileSync(join(game, 'index.html'), 'utf8') };
// STUDIO_BROWSER: whatever the AI starts never opens a browser of this computer (the headless one below is the editor).
const editorEnv = { ...process.env, HOME: home, STUDIO_BROWSER: '/usr/bin/true' };

const start = spawnSync(process.execPath, [CLI, game, '--detach', '--no-open'], { encoding: 'utf8', env: editorEnv, timeout: 60000 });
const url = start.stdout.match(/^studio: ready (\S+) pid/m)?.[1];
if (!url) {
  console.log('could not start the editor:\n' + hide(start.stdout + start.stderr));
  process.exit(1);
}
let browser;
try {
  browser = await launch();
} catch (e) {
  console.log(`skipped: ${e.message}`);
  spawnSync(process.execPath, [CLI, game, '--stop'], { env: editorEnv });
  process.exit(3);
}
const page = await newPage(browser, { width: 1280, height: 800 });
const motions = async () => JSON.parse((await page.eval(`JSON.stringify((window.__studioTimeline?.motionOf('blue-pillar')?.clips ?? []).map((c) => ({ name: c.name, use: c.use, len: c.len, repeat: c.repeat ?? 'once', points: c.keys?.p?.length ?? 0, when: c.when })))`)) || '[]');
try {
  await page.goto(url);
  await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
  await sleep(2000);
  console.log(`editor open (headless), blue-pillar: ${JSON.stringify(await motions())}`);

  for (const [i, step] of STEPS.entries()) {
    console.log(`\n${i + 1}. 「${step.say}」${step.first && i ? ' (a new conversation)' : ''}`);
    if (step.seed && !(await motions()).some((c) => (c.use ?? c.name) === 'Sway')) {
      // The person's state that day: the old motion back on the pillar beside the spiral (put there through the editor).
      const sd = spawnSync(process.execPath, [CLI, game, '--do', 'motion.attach', '--key', 'blue-pillar', '--name', 'Sway', '--when', 'start'], { encoding: 'utf8', env: editorEnv });
      await sleep(800);
      console.log(`  (before: ${sd.stdout.split('\n')[0]}; blue-pillar: ${JSON.stringify((await motions()).map((c) => c.name))})`);
    }
    const cargs = ['-p', step.say, '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--setting-sources', 'project',
      '--permission-mode', 'bypassPermissions', ...(step.first ? [] : ['--continue']), ...(MODEL ? ['--model', MODEL] : [])];
    const t0 = Date.now();
    const r = await new Promise((resolveRun) => {
      const c = spawn('claude', cargs, { cwd: game, env: { ...process.env, STUDIO_BROWSER: '/usr/bin/true' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let s = '';
      let e = '';
      c.stdout.on('data', (d) => (s += d));
      c.stderr.on('data', (d) => (e += d));
      const timer = setTimeout(() => c.kill('SIGTERM'), 15 * 60_000);
      c.on('close', (code) => (clearTimeout(timer), resolveRun({ code, s, e })));
    });
    writeFileSync(join(out, `step${i + 1}.jsonl`), hide(r.s));
    const events = r.s.split('\n').filter(Boolean).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
    const bash = events.flatMap((ev) => (ev.type === 'assistant' ? ev.message?.content ?? [] : [])).filter((b) => b.type === 'tool_use' && b.name === 'Bash').map((b) => String(b.input?.command ?? ''));
    const edits = events.flatMap((ev) => (ev.type === 'assistant' ? ev.message?.content ?? [] : [])).filter((b) => b.type === 'tool_use' && /^(Edit|Write|MultiEdit)$/.test(b.name)).map((b) => b.input?.file_path);
    const reply = events.filter((ev) => ev.type === 'result').map((ev) => ev.result).join('\n');
    const dos = bash.filter((c) => c.includes('--do'));
    console.log(`  (${Math.round((Date.now() - t0) / 1000)} s, exit ${r.code})`);
    for (const c of dos) console.log(`  ran: ${hide(c).replace(/\s+/g, ' ').slice(0, 300)}${c.length > 300 ? ' …' : ''}`);
    if (edits.length) console.log(`  edited: ${edits.join(', ')}`);
    console.log(`  said:\n${hide(reply).split('\n').map((l) => '    ' + l).join('\n')}`);
    await sleep(1500);
    const m = await motions();
    console.log(`  blue-pillar in the editor now: ${JSON.stringify(m.map((c) => [c.name, c.points, c.len, c.repeat]))}`);
    const codeNow = { main: readFileSync(join(game, 'main.js'), 'utf8'), index: readFileSync(join(game, 'index.html'), 'utf8') };
    check(r.code === 0 && !!reply, 'the AI answered');
    check(dos.length > 0, 'it used --do (the editor\'s own work)');
    check(codeNow.main === code0.main && codeNow.index === code0.index, 'the game\'s code is untouched (the motion is the editor\'s, not code)');
    check(!HANDBACK.test(reply), 'no steps, reload or Save handed back to the person');
    check(/^https?:\/\/127\.0\.0\.1:\d+\/__studio\/\?t=/.test(reply.trim()), 'the editor\'s link is the first line');
    const spiral = m.find((c) => c.points >= 8 && c.name !== 'Sway');
    if (i === 0) check(!!spiral, `a spiral on the blue pillar's timeline (${spiral ? `${spiral.name}, ${spiral.points} points` : 'none'})`);
    if (i >= 1) check(!!spiral && !m.some((c) => c.name === 'Sway' || c.use === 'Sway') && m.length === 1, 'only the spiral is left: Sway is off');
    if (i === 2) check(dos.some((c) => /motion\.detach/.test(c)), 'it took Sway off itself (motion.detach)');
  }
  writeFileSync(join(out, 'placement.json'), readFileSync(join(game, 'placement.json'), 'utf8'));
  writeFileSync(join(out, 'editor.png'), await page.screenshot());
} finally {
  await browser.close();
  spawnSync(process.execPath, [CLI, game, '--stop'], { env: editorEnv });
  console.log(`\nreport: ${out}`);
  if (!KEEP) rmSync(game, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
