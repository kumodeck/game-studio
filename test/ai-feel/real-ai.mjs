// A real AI on the AI's hands (studio-ai-hands, 2026-10-24): the claude CLI, with this package's arrange skill, asked
// what a person asked that day (in Japanese, as they did: STEPS below) — and checked that it does the editor's work
// itself instead of handing it back.
// Since studio-code-base (2026-10-24: "a spiral is a code motion; a row with a gap I change later is a code layout"):
//   1. "make the blue pillar spiral" → a CODE motion: codeMotion() written in the game's code and put on the pillar's
//      timeline with --do motion.code (the editor shows it, with its knobs), no "press Reload" / steps for the person;
//   2. (a new conversation) "ten street lamps, 6 m apart; I want to change the gap later" → a code layout: codePlace()
//      in the code and --do place.code (the editor lists ten lamps under the layout's name, a knob at 6).
// `--steps points` runs the earlier set (studio-ai-hands): the spiral, then "take the old motion off, only the spiral"
// in the same conversation and in a new one with Sway put back first.
// `--steps to-rule` (studio-code-torule, 2026-10-24 — "turn what I placed / moved by hand into a close formula"): the
// plaza gets six street lamps put by hand along the left (the third 0.6 m off the line), a ship that sways side to side
// by a motion of points made on the timeline ("Ship sway", 9 points, a little shaky) and five crates dropped here and
// there; each in a new conversation:
//   1. "turn the street lamps into a rule" (in Japanese, as STEPS has it) → a codePlace() in the code and `--do place.code
//      --replace` with the six lamps (the editor hides them, the rule's lamps stand in their place), the reply has the
//      editor's number for how close it is;
//   2. "turn the ship's motion into a rule" → a codeMotion() and `--do motion.code --replace`: "Ship sway" is a rule
//      now, still on the ship, starting with the game;
//   3. "turn the crates into a rule" → no rule comes close (scattered by hand): nothing replaced, said in a line.
// None of them may hand steps back to the person.
// `--steps to-coords` (studio-to-coords, 2026-10-24 — the CRYSTAL FIELD try: the AI gave a lamp row only Count and Gap, so
// a lamp dragged away from the road did nothing): the plaza gets a road, then "line the street lamps along both sides of
// the road" (in Japanese) → a codePlace() with a knob for each way a person would drag one (SKILL.md: `drag` by way —
// along the road and away from it at least), shown with --do place.code. One conversation.
// The game is Pillar Plaza (`pillars/`: a blue pillar that already sways), copied to a temporary folder. The editor
// runs with its own HOME (so no KUMODeck sign-in on this computer is read) and is open in a headless Chrome the whole
// time, as the person's editor would be; the AI's `--do` reaches it there. The skill is the package's own
// (`.claude/skills/arrange` → skills/arrange), MCP servers off, the person's other settings and plugins not loaded.
//
//   node test/ai-feel/real-ai.mjs [--model <model>] [--keep] [--out <dir>]
// Prints what the AI ran (`--do` lines), what it said (the editor's pass `t=…` hidden), and the checks. Exit 1 on a
// failure, 3 when there is no claude CLI or no headless Chrome. It costs real AI usage (three short turns).
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

const TO_RULE = take('--steps') === 'to-rule';
const TO_COORDS = take('--steps') === 'to-coords';
const STEPS = TO_COORDS ? [
  { say: '街灯を道の両側に並べて', first: true, kind: 'by-way' },
] : TO_RULE ? [
  { say: '街灯をルールにして', first: true, kind: 'to-rule-place' },
  { say: '船の動きをルールにして', first: true, kind: 'to-rule-motion' },
  { say: '木箱をルールにして', first: true, kind: 'to-rule-none' },
] : take('--steps') === 'points' ? [
  { say: '青い柱を螺旋で動かして', first: true, kind: 'spiral' },
  { say: '青い柱の前の動きを外して、螺旋だけにして', kind: 'only' },
  { say: '青い柱の前の動きを外して、螺旋だけにして', first: true, seed: true, kind: 'only' },
] : [
  { say: '青い柱を螺旋で動かして', first: true, kind: 'code-motion' },
  { say: '街灯を 6 m おきに 10 本並べて。間は後で変えたい', first: true, kind: 'code-place' },
];
// Handing the work back (Japanese and English): steps to click, asking for a reload or a Save, "in the editor, do …".
const HANDBACK = /右クリック|再読み込み|リロード|を押して(?!くだ)|押してください|開き直|選んで.*(外|押)|手順|^\s*[1-9]\.\s|Reload|right-click|press Save|保存してください|Save を押/m;

// ✦ Turn into a rule: the editor's measure in the `studio: did …` lines the AI got back ("the largest gap is lamp-3 ↔
// lamp-row-3, 0.62 m", "… 0.12 m at 0.8 s"), and whether the reply says it (to one or two decimals).
const measured = (stream) => [...String(stream).matchAll(/largest gap is .*?(\d+(?:\.\d+)?) m\b/g)].map((m) => Number(m[1]));
const saysMeasure = (stream, reply) => measured(stream).some((x) => [x.toFixed(1), String(Math.round(x * 100) / 100)].some((v) => reply.includes(v)));

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
// The to-rule set's plaza (above): lamps, a ship with its motion of points, crates — all put by hand.
if (TO_RULE) {
  const main = readFileSync(join(game, 'main.js'), 'utf8').replace("await applyPlacement(scene, './placement.json');", `// Six street lamps along the left of the plaza, put one by one by hand.
function lamp(key, x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8), new THREE.MeshStandardMaterial({ color: '#3a3f4c' }));
  pole.position.y = 1.6;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshStandardMaterial({ color: '#fff1b8', emissive: '#ffd36b' }));
  bulb.position.y = 3.3;
  g.add(pole, bulb);
  g.position.set(x, 0, z);
  g.userData.studioKey = key;
  scene.add(g);
  return g;
}
lamp('lamp-1', -8, 6);
lamp('lamp-2', -8, 2);
lamp('lamp-3', -8.6, -2);
lamp('lamp-4', -8, -6);
lamp('lamp-5', -8, -10);
lamp('lamp-6', -8, -14);
// A small ship on the right (it sways side to side: "Ship sway" in placement.json, made on the timeline).
const ship = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.8, 3), new THREE.MeshStandardMaterial({ color: '#36c98e' }));
ship.rotation.x = -Math.PI / 2;
ship.position.set(6, 0.6, 4);
ship.userData.studioKey = 'ship';
scene.add(ship);
// Five wooden crates dropped here and there by hand.
for (const [i, [x, z]] of [[3, -3], [9, -8], [-2, 9], [11, 1], [4.5, -12]].entries()) {
  const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#a0703c' }));
  crate.position.set(x, 0.5, z);
  crate.userData.studioKey = \`crate-\${i + 1}\`;
  scene.add(crate);
}

await applyPlacement(scene, './placement.json');`);
  writeFileSync(join(game, 'main.js'), main);
  const pl = JSON.parse(readFileSync(join(game, 'placement.json'), 'utf8'));
  pl.motions.push({ name: 'Ship sway', len: 2, repeat: 'loop', keys: { p: Array.from({ length: 9 }, (_, i) => ({ t: i / 4, v: [Math.round((Math.sin((i / 8) * 2 * Math.PI) * 1.5 + (i === 3 ? 0.12 : 0)) * 1000) / 1000, 0, 0], ease: 'linear' })) } });
  pl.motion.ship = { clips: [{ use: 'Ship sway', when: { on: 'start' } }] };
  writeFileSync(join(game, 'placement.json'), JSON.stringify(pl, null, 2));
}
// The to-coords set's road: a dark strip down the middle of the plaza (front to back), 5 m wide.
if (TO_COORDS) {
  const main = readFileSync(join(game, 'main.js'), 'utf8').replace("await applyPlacement(scene, './placement.json');", `// A road down the middle of the plaza, from the front to the back (5 m wide).
const road = new THREE.Mesh(new THREE.PlaneGeometry(5, 30), new THREE.MeshStandardMaterial({ color: '#2b2d33' }));
road.rotation.x = -Math.PI / 2;
road.position.y = 0.01;
road.userData.studioKey = 'road';
scene.add(road);

await applyPlacement(scene, './placement.json');`);
  writeFileSync(join(game, 'main.js'), main);
}
mkdirSync(join(game, '.studio/ui'), { recursive: true });
writeFileSync(join(game, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'ja', theme: 'dark', seen: ['timeline-steps', 'open-line'] }));
const code0 = { main: readFileSync(join(game, 'main.js'), 'utf8'), index: readFileSync(join(game, 'index.html'), 'utf8') };
const LAMPS = ['lamp-1', 'lamp-2', 'lamp-3', 'lamp-4', 'lamp-5', 'lamp-6'];
// Every .js of the game but the loader's copy (the AI may put the layout in a file of its own).
const readGameJs = () => readdirSync(game).filter((f) => f.endsWith('.js') && f !== 'studio-placement.js' && f !== 'main.js').map((f) => readFileSync(join(game, f), 'utf8')).join('\n');
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
// What the editor has (its own --do list, the way the AI reads it): code motions with `code`, code layouts in `places`.
const listNow = () => {
  const r = spawnSync(process.execPath, [CLI, game, '--do', 'list'], { encoding: 'utf8', env: editorEnv });
  const line = r.stdout.split('\n').find((l) => l.startsWith('studio: list '));
  try {
    return line ? JSON.parse(line.slice('studio: list '.length)) : null;
  } catch {
    return null;
  }
};
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
    // A rule that does not come close is no change at all: it may just say so (it may still read the editor's --do list).
    if (step.kind !== 'to-rule-none') check(dos.length > 0, 'it used --do (the editor\'s own work)');
    check(!HANDBACK.test(reply), 'no steps, reload or Save handed back to the person');
    check(/^https?:\/\/127\.0\.0\.1:\d+\/__studio\/\?t=/.test(reply.trim()), 'the editor\'s link is the first line');
    const codeText = Object.values(codeNow).join('\n') + readGameJs();
    if (step.kind === 'spiral' || step.kind === 'only') {
      check(codeNow.main === code0.main && codeNow.index === code0.index, 'the game\'s code is untouched (the motion is the editor\'s, not code)');
      const spiral = m.find((c) => c.points >= 8 && c.name !== 'Sway');
      if (step.kind === 'spiral') check(!!spiral, `a spiral on the blue pillar's timeline (${spiral ? `${spiral.name}, ${spiral.points} points` : 'none'})`);
      else check(!!spiral && !m.some((c) => c.name === 'Sway' || c.use === 'Sway') && m.length === 1, 'only the spiral is left: Sway is off');
      if (step.seed) check(dos.some((c) => /motion\.detach/.test(c)), 'it took Sway off itself (motion.detach)');
    } else if (step.kind === 'code-motion') {
      const l = listNow();
      const cm = (l?.motions ?? []).filter((x) => x.code);
      const onPillar = l?.objects?.find((o) => o.key === 'blue-pillar')?.motions ?? [];
      console.log(`  editor's list: code motions ${JSON.stringify(cm)}; blue-pillar's motions ${JSON.stringify(onPillar)}`);
      check(/codeMotion\s*\(/.test(codeText), 'it wrote a codeMotion() in the game\'s code');
      check(dos.some((c) => /motion\.code/.test(c)), 'it put it on the timeline itself (--do motion.code)');
      check(cm.some((x) => onPillar.includes(x.name) && !x.missing && Object.keys(x.knobs ?? {}).length >= 1 && Object.keys(x.knobs ?? {}).length <= 3), 'the blue pillar has the code motion on its timeline, with 1–3 knobs');
    } else if (step.kind === 'to-rule-place') {
      const l = listNow();
      const lp = (l?.places ?? []).find((p) => LAMPS.every((k) => p.from?.includes(k)));
      console.log(`  editor's list: places ${JSON.stringify((l?.places ?? []).map((p) => ({ id: p.id, name: p.name, n: p.keys?.length, knobs: Object.fromEntries(Object.entries(p.knobs ?? {}).map(([k, v]) => [k, v.v])), from: p.from })))}`);
      check(/codePlace\s*\(/.test(codeText), 'it wrote a codePlace() in the game\'s code');
      check(dos.some((c) => /place\.code/.test(c) && /replace/.test(c)), 'it swapped it in itself (--do place.code --replace)');
      check(!!lp && lp.keys.length === 6 && !lp.keys.some((k) => LAMPS.includes(k)), `the six hand lamps replaced by six of the rule's own (${lp ? `${lp.id}: ${lp.keys.join(', ')}` : 'none'})`);
      const rows = JSON.parse(await page.eval(`JSON.stringify(Array.from(document.querySelectorAll('.obj'), (e) => e.dataset.key))`) || '[]');
      check(!rows.some((k) => LAMPS.includes(k)), 'the hand lamps are out of the editor\'s list (hidden in the game)');
      check(saysMeasure(r.s, reply), `the reply says how close it is, in the editor's number (${measured(r.s).join(', ') || 'none measured'})`);
      writeFileSync(join(out, 'to-rule-place.png'), await page.screenshot());
    } else if (step.kind === 'to-rule-motion') {
      const l = listNow();
      const sway = (l?.motions ?? []).find((m) => m.name === 'Ship sway');
      const onShip = l?.objects?.find((o) => o.key === 'ship')?.motions ?? [];
      console.log(`  editor's list: Ship sway ${JSON.stringify(sway)}; ship's motions ${JSON.stringify(onShip)}`);
      check(/codeMotion\s*\(/.test(codeText), 'it wrote a codeMotion() in the game\'s code');
      check(dos.some((c) => /motion\.code/.test(c) && /replace/.test(c)), 'it swapped it in itself (--do motion.code --replace)');
      check(!!sway?.code && !sway.missing && onShip.includes('Ship sway'), '"Ship sway" is a rule now, by the same name, still on the ship');
      check(saysMeasure(r.s, reply), `the reply says how close it is, in the editor's number (${measured(r.s).join(', ') || 'none measured'})`);
      writeFileSync(join(out, 'to-rule-motion.png'), await page.screenshot());
    } else if (step.kind === 'to-rule-none') {
      const l = listNow();
      const crates = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-5'];
      const replaced = (l?.places ?? []).some((p) => crates.some((k) => p.from?.includes(k)));
      check(!replaced && !dos.some((c) => /replace/.test(c) && /crate/.test(c)), 'nothing replaced: the crates stay where they were put');
      check(reply.trim().split('\n').filter((x) => x.trim()).length <= 4, 'said in a line or two (with the link)');
    } else if (step.kind === 'by-way') {
      const l = listNow();
      const ps = l?.places ?? [];
      console.log(`  editor's list: places ${JSON.stringify(ps.map((p) => ({ id: p.id, name: p.name, n: p.keys?.length, knobs: Object.fromEntries(Object.entries(p.knobs ?? {}).map(([k, v]) => [k, `${v.label} ${v.v}${v.unit ?? ''}`])), drag: p.drag })))}`);
      const row = ps.find((p) => (p.keys?.length ?? 0) >= 4);
      const ways = row?.drag && typeof row.drag === 'object' ? Object.keys(row.drag) : row?.drag ? ['along'] : [];
      check(/codePlace\s*\(/.test(codeText), 'it wrote a codePlace() in the game\'s code');
      check(dos.some((c) => /place\.code/.test(c)), 'it showed it in the editor itself (--do place.code)');
      check(!!row && Object.keys(row.knobs ?? {}).length <= 3, `the lamps in the editor under the layout's name, 1–3 knobs (${row ? `${row.name} ×${row.keys.length}` : 'none'})`);
      check(ways.includes('side') && (ways.includes('along') || ways.includes('move')), `a knob for each way a person drags one: along the road and away from it (drag ${JSON.stringify(row?.drag ?? null)})`);
      writeFileSync(join(out, 'by-way.png'), await page.screenshot());
    } else if (step.kind === 'code-place') {
      const l = listNow();
      console.log(`  editor's list: places ${JSON.stringify((l?.places ?? []).map((p) => ({ id: p.id, name: p.name, n: p.keys?.length, knobs: p.knobs })))}`);
      const lamps = (l?.places ?? []).find((p) => (p.keys?.length ?? 0) >= 10);
      check(/codePlace\s*\(/.test(codeText), 'it wrote a codePlace() in the game\'s code');
      check(dos.some((c) => /place\.code/.test(c)), 'it showed it in the editor itself (--do place.code)');
      check(!!lamps && Object.values(lamps.knobs ?? {}).some((k) => k.v === 6) && Object.keys(lamps.knobs ?? {}).length <= 3, `ten lamps in the editor under the layout's name, a knob at 6 (${lamps ? `${lamps.name} ×${lamps.keys.length}` : 'none'})`);
    }
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
