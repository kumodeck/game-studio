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
// `--steps writeback` (studio-writeback, 2026-10-24 — "the code is the truth": what the person changed of a rule is
// written into the code on Save and leaves placement.json): the plaza gets a road and the street lamps on both sides as
// ONE codePlace (CRYSTAL FIELD's: Count and Gap, the distance from the road fixed in the code); each in a new
// conversation, the person (this test, through the editor) changes the rule and presses Save, then says "saved":
//   1. every lamp 1 m further from the road (an offset, as their sideways drag makes) → the AI writes it into the
//      codePlace and sends `place.code --fold`: the file's offsets are gone, every lamp stands where it stood, nothing
//      left to save;
//   2. lamp 5 put by hand (a pin, as ⌥-drag makes) → the AI writes it into the code (an exception of the rule, or its
//      own object) and folds the pins: the pin is gone from the file, lamp 5 where the person put it, the others as
//      they were.
// `--steps canvas-ui` (studio-canvas-ui, 2026-10-24 — "I want to edit the UI drawn inside the canvas as UI"): the game is
// examples/three-canvas-hud (its score, health bar, JUMP button and minimap drawn in a 2D canvas, the plain way); each in a
// new conversation:
//   1. "make this UI editable" (in Japanese) → the AI rewrites the drawing with codeUi() and sends --do ui.code: the
//      editor lists them (its 40 px check passed), the HUD's picture is the same before and after the rewrite;
//   2. the person (through the editor) moves the bar to the top middle at 1.4× and gives the button a pink pressed fill,
//      presses Save, says "saved" → the AI writes them into codeUi() and sends [ui.code, ui.set --clear]: no `ui` left
//      in placement.json, every box where the person saw it, nothing left to save.
// `--steps canvas-ui-2` (studio-canvas-ui stage 2, 2026-10-24 — the UI not selectable yet): the same example with nothing
// delivered; the person (this test, in the editor) opens the UI layer, presses the minimap's dotted frame, presses ✦
// "Ask … to make this UI editable" and sends the draft (an ask with `intent: "ui-code"`, the place, the frames, the
// picture), then says in the AI's window that they asked from the editor → the AI delivers ALL the HUD's parts at once
// (codeUi + --do ui.code, the check passed, the picture the same), the dotted frames are gone (`uiFound` empty), it marks
// the request done, and it hands no steps back.
// `--steps canvas-ui-phaser` / `--steps canvas-ui-pixi` (studio-canvas-ui-3, 2026-10-24 — Phaser / Pixi UI kept as
// objects): examples/phaser-runner (the distance text, empty until a run starts) or examples/pixi-bubbles (the score and
// the note), nothing delivered; "make this UI editable" (in Japanese) → the AI rewrites them with codeUi() kept as
// objects (onChange) and sends --do ui.code: the check passed, listed in the editor, each object where it was drawn with
// its own size and colour (the same look), the reply in Japanese (SKILL.md: reply in the person's language — the stage 2
// run answered a Japanese ask in English), no steps handed back.
// `--steps made` (pause-edit, 2026-10-28 — "pause in the middle and give instructions, by hand or to the AI"): the game is
// examples/three-neon-boss (the game makes a boss a few seconds in, in plain code); the person (this test, in the editor)
// plays at ¼×, pauses when the boss comes, moves the boss to the left lane in the paused moment, presses ✦ "Have
// Claude make it appear here" and sends the draft (a `play` request with `made` and `here`), then says in the AI's
// window that they asked from the editor → the AI changes where the game makes the boss in the code (to the left), marks
// the request done with one line, hands no steps back; Play from the start (a new page): the boss comes in on the left.
// `--steps moment` (pause-edit stage 2, 2026-10-28 — the score, the time left, the health in the paused moment): the game
// is examples/three-neon-boss as it ships (its numbers plain variables, no codeMoment); the person (this test, in the
// editor) plays, pauses, reads "This moment"'s one line, presses ✦ "Have Claude make this moment editable" and sends the
// draft (a paused `play` request with `intent: "moment-values"`), then says in the AI's window that they asked from the
// editor → the AI writes codeMoment() with the run's numbers, marks the request done with one line, hands no steps back;
// Play from the start and pause: "This moment" lists them, `--do list` has `moment`, `--do moment.set --v 5` sets one.
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
const WRITEBACK = take('--steps') === 'writeback';
const CANVAS2 = take('--steps') === 'canvas-ui-2';
const CANVAS = take('--steps') === 'canvas-ui';
const MADE = take('--steps') === 'made';
const MOMENT = take('--steps') === 'moment';
// Stage 3: a Phaser or a Pixi game's UI kept as objects.
const ENGINE = take('--steps') === 'canvas-ui-phaser' ? 'phaser' : take('--steps') === 'canvas-ui-pixi' ? 'pixi' : null;
// The game's main script (the canvas-ui sets' game is examples/three-canvas-hud: game.js; stage 3's Phaser / Pixi game.js).
const MAIN = CANVAS || CANVAS2 || ENGINE || MADE || MOMENT ? 'game.js' : 'main.js';
const STEPS = MOMENT ? [
  { say: 'エディタから頼んだよ', first: true, kind: 'moment' },
] : MADE ? [
  { say: 'エディタから頼んだよ', first: true, kind: 'made' },
] : ENGINE ? [
  { say: 'このUIを編集できるようにして', first: true, kind: 'canvas-engine' },
] : CANVAS2 ? [
  { say: 'エディタから頼んだよ', first: true, kind: 'canvas-ask' },
] : CANVAS ? [
  { say: 'このUIを編集できるようにして', first: true, kind: 'canvas-deliver' },
  { say: '保存した', first: true, kind: 'canvas-save' },
] : WRITEBACK ? [
  { say: '保存した', first: true, kind: 'wb-offset' },
  { say: '保存した', first: true, kind: 'wb-pin' },
] : TO_COORDS ? [
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
cpSync(join(PKG, MADE || MOMENT ? 'examples/three-neon-boss' : ENGINE ? `examples/${ENGINE === 'phaser' ? 'phaser-runner' : 'pixi-bubbles'}` : CANVAS || CANVAS2 ? 'examples/three-canvas-hud' : 'test/ai-feel/pillars'), game, { recursive: true });
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
// The writeback set's road and street lamps: both sides of the road as ONE codePlace (as CRYSTAL FIELD and the real AI
// write it), Count (each side) and Gap its knobs, the distance from the road (5.6 m) fixed in the code — the shape the
// person's sideways drag becomes an offset of.
if (WRITEBACK) {
  const main = readFileSync(join(game, 'main.js'), 'utf8')
    .replace("import { applyPlacement } from './studio-placement.js';", "import { applyPlacement, codePlace } from './studio-placement.js';")
    .replace("await applyPlacement(scene, './placement.json');", `// A road down the middle of the plaza, from the front to the back (5 m wide).
const road = new THREE.Mesh(new THREE.PlaneGeometry(5, 30), new THREE.MeshStandardMaterial({ color: '#2b2d33' }));
road.rotation.x = -Math.PI / 2;
road.position.y = 0.01;
road.userData.studioKey = 'road';
scene.add(road);
// Street lamps on both sides of the road: Count (each side) and Gap are its knobs.
function makeLamp() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8), new THREE.MeshStandardMaterial({ color: '#3a3f4c' }));
  pole.position.y = 1.6;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshStandardMaterial({ color: '#fff1b8', emissive: '#ffd36b' }));
  bulb.position.y = 3.3;
  g.add(pole, bulb);
  return g;
}
codePlace('lamp-row', {
  name: '街灯',
  knobs: { n: { v: 5, label: '本数（片側）', unit: '', min: 1, max: 10, step: 1 }, gap: { v: 6, label: '間', unit: 'm', min: 2, max: 15 } },
  count: (k) => k.n * 2,
  make: () => makeLamp(),
  at: (i, k) => ({ p: [(i % 2 ? 1 : -1) * 5.6, 0, 6 - Math.floor(i / 2) * k.gap] }),
  drag: { along: 'gap' },
});

await applyPlacement(scene, './placement.json');`);
  writeFileSync(join(game, 'main.js'), main);
  // The editor's own loader (with codePlace, offsets and jitter), as the AI copies it in (SKILL.md §4 Way 1).
  cpSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), join(game, 'studio-placement.js'));
}
mkdirSync(join(game, '.studio/ui'), { recursive: true });
writeFileSync(join(game, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: 'ja', theme: 'dark', seen: ['timeline-steps', 'open-line'] }));
const code0 = { main: readFileSync(join(game, MAIN), 'utf8'), index: readFileSync(join(game, 'index.html'), 'utf8') };
const LAMPS = ['lamp-1', 'lamp-2', 'lamp-3', 'lamp-4', 'lamp-5', 'lamp-6'];
// Every .js of the game but the loader's copy (the AI may put the layout in a file of its own).
const readGameJs = () => readdirSync(game).filter((f) => f.endsWith('.js') && f !== 'studio-placement.js' && f !== MAIN).map((f) => readFileSync(join(game, f), 'utf8')).join('\n');
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
// The writeback set: every lamp's place in the game the editor shows (x, y, z, rounded to the centimetre).
const GW = `document.querySelector('iframe.game:not(.leaving)')?.contentWindow`;
const lampsNow = async () => JSON.parse((await page.eval(`(() => { const p = ${GW}?.[Symbol.for('game-studio.codePlaces')]?.get('lamp-row');
  return JSON.stringify(p ? p.keys.map((k, i) => [k, ...[p.objs[i].position.x, p.objs[i].position.y, p.objs[i].position.z].map((v) => Math.round(v * 100) / 100 + 0)]) : []); })()`)) || '[]');
const sameLamps = (a, b) => a.length === b.length && a.every((q, i) => q[0] === b[i][0] && q.slice(1).every((v, j) => Math.abs(v - b[i][j + 1]) <= 0.011));
const unsavedNow = async () => /\d/.test(await page.eval(`document.querySelector('[data-part=save]')?.textContent ?? ''`));
const fileNow = () => (existsSync(join(game, 'placement.json')) ? JSON.parse(readFileSync(join(game, 'placement.json'), 'utf8')) : {});
const doEditor = (...a) => spawnSync(process.execPath, [CLI, game, '--do', ...a], { encoding: 'utf8', env: editorEnv }).stdout;
const waitFor = async (f, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) if (await f()) return true;
  return !!(await f());
};
// The person's change before each writeback step (through the editor, as their drag would), then their Save.
const PERSON = {
  'wb-offset': () => doEditor('place.set', '--id', 'lamp-row', '--offsets', '[{"way":"side","how":"same","v":1}]'),
  'wb-pin': () => doEditor('place.set', '--id', 'lamp-row', '--pin', '{"key":"lamp-row-5","p":[-9.4,0,-0.8]}'),
};
// The canvas-ui set: the HUD canvas's picture (read three times, then one frame drawn: reading a canvas moves it to the
// browser's CPU drawing, so both pictures of a comparison are drawn the same way) and how many pixels differ from one before.
const hudPng = () => page.eval(`(() => { const w = ${GW}; const c = w?.document.getElementById('hud'); if (!c) return null; const x = c.getContext('2d');
  for (let i = 0; i < 3; i++) x.getImageData(0, 0, c.width, c.height); w.__gameStudio?.core?.time?.step?.(); return c.toDataURL('image/png'); })()`);
const hudDiff = (png) => page.eval(`new Promise((ok) => { const w = ${GW}; const c = w?.document.getElementById('hud'); if (!c) return ok(-1); const img = new Image(); img.onload = () => {
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const x = o.getContext('2d'); x.drawImage(img, 0, 0);
  const a = x.getImageData(0, 0, c.width, c.height).data, b = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < a.length; i += 4) if ([0, 1, 2, 3].some((k) => Math.abs(a[i + k] * a[i + 3] - b[i + k] * b[i + 3]) / 255 > 24)) n++;
  ok(n); }; img.src = ${JSON.stringify('PNG')}; })`.replace('"PNG"', JSON.stringify(png)));
/** Every codeUi's box in the game page now ({ id: [x, y, w, h] }, to the tenth of a px). */
const uiBoxes = async () => JSON.parse((await page.eval(`(() => { const m = ${GW}?.[Symbol.for('game-studio.codeUis')]; const o = {};
  if (m) for (const [k, e] of m) { const b = e.box(); o[k] = [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 10) / 10); } return JSON.stringify(o); })()`)) || '{}');
const sameBoxes = (a, b) => Object.keys(a).length > 0 && Object.keys(a).every((k) => b[k] && a[k].every((v, i) => Math.abs(v - b[k][i]) <= 1));
// The canvas-ui set's person: the bar to the top middle at 1.4×, the button's pressed fill pink (the ids the AI chose).
PERSON['canvas-save'] = () => {
  const ui = (listNow()?.ui ?? []).filter((u) => u.code);
  const bar = ui.find((u) => u.kind === 'bar') ?? ui.find((u) => /hp|health|life|bar/.test(u.key)) ?? ui[1];
  const btn = ui.find((u) => u.kind === 'button') ?? ui.find((u) => /jump/.test(u.key));
  const said = [bar ? doEditor('ui.set', '--id', bar.key, '--from', 'top', '--p', '[0,20]', '--s', '1.4') : 'no bar'];
  if (btn) said.push(doEditor('ui.set', '--id', btn.key, '--set', '{"@active":{"background":"#ff8fb1"}}'));
  return said.map((x) => x.split('\n')[0]).join(' / ');
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
    let lamps0 = null;
    const hud0 = step.kind === 'canvas-deliver' || step.kind === 'canvas-ask' ? await hudPng() : null;
    // Stage 2's person: the UI layer, a press on the minimap's dotted frame, ✦, and Send (the draft as it is).
    let asked = null;
    if (step.kind === 'canvas-ask') {
      await page.eval(`document.querySelector('[data-part=layer-switch] [data-layer=ui]')?.click()`);
      await sleep(1500);
      const frames = JSON.parse(await page.eval(`(() => { const r = ${GW}?.document.querySelector('game-studio-found')?.shadowRoot;
        return JSON.stringify(r ? [...r.querySelectorAll('.f')].map((f) => { const b = f.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }) : []); })()`) || '[]');
      // The minimap: the frame lowest on the left.
      const mm = frames.filter((b) => b[0] < 200).sort((a, b) => b[1] - a[1])[0];
      const fb = JSON.parse(await page.eval(`JSON.stringify(document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect())`));
      console.log(`  (the person: the UI layer — ${frames.length} dotted frames; presses the minimap's ${JSON.stringify(mm)})`);
      if (mm) await page.click(fb.left + mm[0] + mm[2] / 2, fb.top + mm[1] + mm[3] / 2);
      await sleep(700);
      const line = await page.eval(`document.querySelector('[data-part=ui-missing]:not([hidden])')?.innerText.replace(/\\s+/g, ' ') ?? null`);
      console.log(`  (the line: ${line})`);
      await page.eval(`document.querySelector('[data-action=ui-missing-ask]')?.click()`);
      await sleep(600);
      const box = await page.eval(`(() => { const a = document.querySelector('[data-part=ask]'); return a.querySelector('.ask-chip:not([hidden])')?.textContent + ' | ' + a.querySelector('.ask-input').value; })()`);
      console.log(`  (the box: ${box}; sends it)`);
      writeFileSync(join(out, `step${i + 1}-before.png`), await page.screenshot());
      await page.eval(`document.querySelector('[data-part=ask] .ask-send')?.click()`);
      await sleep(1500);
      const dir = join(game, '.studio/requests');
      const name = existsSync(dir) ? readdirSync(dir).filter((n) => n.includes('-ask-')).sort().pop() : null;
      asked = name ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : null;
      check(!!asked && asked.intent === 'ui-code' && Array.isArray(asked.pressed) && (asked.found ?? []).length >= 4 && /^\.studio\/play\//.test(asked.shot ?? ''),
        `the editor sent the ask: intent ui-code, the place, the frames, the picture (${asked ? JSON.stringify({ intent: asked.intent, pressed: asked.pressed, found: asked.found?.length, shot: asked.shot }) : 'none'})`);
    }
    // The paused moment's person (pause-edit): Play at ¼×, pause when the boss comes, the boss to the left lane, ✦, Send.
    if (step.kind === 'made') {
      await page.eval(`document.querySelector('button.play').click()`);
      await page.waitFor(`document.querySelector('.shell').dataset.playing === 'on' && !!document.querySelector('[data-part=play-pause]:not([hidden])')`, 30000);
      await sleep(800);
      await page.eval(`document.querySelector('[data-part=play-speed]').click()`);
      await sleep(300);
      await page.eval(`document.querySelector('[data-action="ctx-speed-0.25"]').click()`);
      await waitFor(async () => (await page.eval(`JSON.stringify(${GW}.__gameStudio._move.list().map((i) => i.key))`)).includes('"boss"'), 90000);
      await page.eval(`document.querySelector('[data-part=play-pause]').click()`);
      await waitFor(() => page.eval(`document.querySelector('.shell').dataset.moment === 'on'`), 10000);
      await sleep(800);
      const at = await page.eval(`JSON.stringify(${GW}.__gameStudio._move.list().find((i) => i.key === 'boss')?.pose)`);
      await page.eval(`studioShell.actions.select('boss')`);
      await sleep(700);
      await page.eval(`(() => { const i = document.querySelector('[data-part=card] input[aria-label=x]'); i.value = '-3.4'; i.dispatchEvent(new Event('change')); return 1; })()`);
      await sleep(700);
      await page.eval(`document.querySelector('[data-action=moment-appear]')?.click()`);
      await sleep(600);
      const box = await page.eval(`(() => { const a = document.querySelector('[data-part=ask]'); return a.querySelector('.ask-chip:not([hidden])')?.textContent + ' | ' + a.querySelector('.ask-input').value; })()`);
      console.log(`  (the person: ¼×, paused at the boss ${at}, the boss to x -3.4, ✦ — the box: ${box}; sends it)`);
      writeFileSync(join(out, `step${i + 1}-before.png`), await page.screenshot());
      await page.eval(`document.querySelector('[data-part=ask] .ask-send')?.click()`);
      await sleep(1500);
      const dir = join(game, '.studio/requests');
      const name = existsSync(dir) ? readdirSync(dir).filter((n) => n.includes('-play-')).sort().pop() : null;
      asked = name ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : null;
      check(!!asked && asked.paused === true && asked.made === true && asked.here?.key === 'boss' && Math.abs((asked.here?.to?.p?.[0] ?? 0) + 3.4) < 0.01 && /^\.studio\/play\//.test(asked.shot ?? ''),
        `the editor sent the ask: paused, made, here = the boss at x -3.4, the picture (${asked ? JSON.stringify({ made: asked.made, here: asked.here, shot: asked.shot }) : 'none'})`);
    }
    // This moment's person (pause-edit stage 2): Play, pause, This moment's line, ✦, Send.
    if (step.kind === 'moment') {
      await page.eval(`document.querySelector('button.play').click()`);
      await page.waitFor(`document.querySelector('.shell').dataset.playing === 'on' && !!document.querySelector('[data-part=play-pause]:not([hidden])')`, 30000);
      await sleep(2500);
      await page.eval(`document.querySelector('[data-part=play-pause]').click()`);
      await waitFor(() => page.eval(`document.querySelector('.shell').dataset.moment === 'on'`), 10000);
      await sleep(800);
      const line = await page.eval(`document.querySelector('[data-part=moment-none]')?.textContent ?? null`);
      await page.eval(`document.querySelector('[data-action=moment-values-ask]')?.click()`);
      await sleep(600);
      const box = await page.eval(`(() => { const a = document.querySelector('[data-part=ask]'); return a.querySelector('.ask-chip:not([hidden])')?.textContent + ' | ' + a.querySelector('.ask-input').value; })()`);
      console.log(`  (the person: paused — This moment says "${line}"; ✦ — the box: ${box}; sends it)`);
      writeFileSync(join(out, `step${i + 1}-before.png`), await page.screenshot());
      await page.eval(`document.querySelector('[data-part=ask] .ask-send')?.click()`);
      await sleep(1500);
      const dir = join(game, '.studio/requests');
      const name = existsSync(dir) ? readdirSync(dir).filter((n) => n.includes('-play-')).sort().pop() : null;
      asked = name ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : null;
      check(!!asked && asked.paused === true && asked.intent === 'moment-values' && /^\.studio\/play\//.test(asked.shot ?? ''),
        `the editor sent the ask: paused, intent moment-values, the picture (${asked ? JSON.stringify({ intent: asked.intent, text: asked.text, shot: asked.shot }) : 'none'})`);
    }
    let boxes0 = null;
    if (PERSON[step.kind]) {
      console.log(`  (the person: ${PERSON[step.kind]().split('\n')[0].replace(/ - in the editor.*/, '')})`);
      await sleep(1200);
      await page.eval(`document.querySelector('[data-part=save]')?.click()`);
      await waitFor(async () => !(await unsavedNow()), 10000);
      await sleep(1500);
      if (CANVAS) {
        boxes0 = await uiBoxes();
        console.log(`  (saved: ui ${JSON.stringify(fileNow().ui ?? {})}; boxes ${JSON.stringify(boxes0)})`);
      } else {
        lamps0 = await lampsNow();
        console.log(`  (saved: places ${JSON.stringify(fileNow().places ?? {})}; lamps ${JSON.stringify(lamps0.map((q) => q.slice(1)))})`);
      }
      writeFileSync(join(out, `step${i + 1}-before.png`), await page.screenshot());
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
    const codeNow = { main: readFileSync(join(game, MAIN), 'utf8'), index: readFileSync(join(game, 'index.html'), 'utf8') };
    check(r.code === 0 && !!reply, 'the AI answered');
    // A rule that does not come close is no change at all: it may just say so (it may still read the editor's --do list).
    // A rule that does not come close is no change at all, and "make it appear here" is a change of the game's code only.
    // …and "make this moment editable" too (its --do list is a look, not a change).
    if (step.kind !== 'to-rule-none' && step.kind !== 'made' && step.kind !== 'moment') check(dos.length > 0, 'it used --do (the editor\'s own work)');
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
    } else if (step.kind === 'wb-offset' || step.kind === 'wb-pin') {
      // The AI's done reads the game again (its change): wait for the page, then look.
      await waitFor(async () => (await page.eval(`document.querySelectorAll('iframe.game').length === 1 && !!${GW}?.__gameStudio?._debug`)) && (await lampsNow()).length === 10, 30000);
      await sleep(3000);
      const lamps1 = await lampsNow();
      const l = listNow();
      const lp = (l?.places ?? []).find((p) => p.id === 'lamp-row');
      const fileLp = await waitFor(() => !fileNow().places?.['lamp-row']?.[step.kind === 'wb-offset' ? 'offsets' : 'pins'], 15000) ? null : fileNow().places?.['lamp-row'];
      const codeHas = readFileSync(join(game, 'main.js'), 'utf8') + readGameJs();
      console.log(`  editor's list: lamp-row ${JSON.stringify(lp && { offsets: lp.offsets, pins: lp.pins, knobs: Object.fromEntries(Object.entries(lp.knobs ?? {}).map(([k, v]) => [k, v.v])) })}; placement.json lamp-row ${JSON.stringify(fileNow().places?.['lamp-row'] ?? null)}`);
      console.log(`  lamps now ${JSON.stringify(lamps1.map((q) => q.slice(1)))}`);
      check(edits.some((f) => /main\.js$|\.js$/.test(String(f))) || codeHas !== code0.main, 'it wrote the change into the game\'s code');
      check(dos.some((c) => /place\.code/.test(c) && /fold/.test(c)), 'it folded what it wrote out of the file itself (--do place.code --fold)');
      check(!dos.some((c) => /place\.set/.test(c) && /(offsets|unpin|hand)/.test(c)), 'no place.set --offsets [] / --unpin / --hand for the write-back (those are the person\'s changes)');
      if (step.kind === 'wb-offset') {
        check(!lp?.offsets && fileLp === null, `the offsets are out of the editor and of placement.json (${JSON.stringify(lp?.offsets ?? null)})`);
        check(/6\.6|\+ ?1\b|1 ?\+|side/.test(codeHas), 'the code has the 1 m (6.6 m from the road, or + 1)');
      } else {
        check(!lp?.pins && fileLp === null, `the pin is out of the editor and of placement.json (${JSON.stringify(lp?.pins ?? null)})`);
        check(/-9\.4/.test(codeHas), 'the code has lamp 5\'s place (-9.4 …)');
      }
      check(sameLamps(lamps1, lamps0 ?? []), `every lamp where the person saw it (within 1 cm): ${sameLamps(lamps1, lamps0 ?? []) ? 'yes' : JSON.stringify(lamps1.map((q, j) => q.slice(1).map((v, k) => Math.round((v - (lamps0?.[j]?.[k + 1] ?? 0)) * 100) / 100)))}`);
      check(!(await unsavedNow()), `nothing left to save in the editor ("${await page.eval(`document.querySelector('[data-part=save]')?.textContent ?? ''`)}")`);
      const measuredSame = /the look is the same/.test(r.s);
      check(measuredSame, 'the editor\'s measure the AI got back: the look is the same');
      writeFileSync(join(out, `${step.kind}.png`), await page.screenshot());
    } else if (step.kind === 'canvas-deliver') {
      await waitFor(async () => (await page.eval(`document.querySelectorAll('iframe.game').length === 1 && !!${GW}?.__gameStudio?._debug`)), 30000);
      await sleep(2500);
      const l = listNow();
      const ui = (l?.ui ?? []).filter((u) => u.code);
      console.log(`  editor's list: ui ${JSON.stringify(ui.map((u) => ({ key: u.key, name: u.name, kind: u.kind, box: u.box, at: u.codeAt })))}`);
      check(/codeUi\s*\(/.test(codeText), 'it wrote codeUi() into the game\'s drawing');
      check(dos.some((c) => /ui\.code/.test(c)), 'it put them in the editor itself (--do ui.code)');
      check(/its picture follows it/.test(r.s), 'the editor\'s check passed (each box moved 40 px: the picture followed)');
      check(ui.length >= 3 && ui.some((u) => /score/i.test(u.key + u.name)), `the score, the bar and the button in the editor's UI list (${ui.map((u) => u.key).join(', ') || 'none'})`);
      const n = hud0 ? await hudDiff(hud0) : -1;
      check(n >= 0 && n < 200, `the HUD's picture is the same before and after the rewrite (${n} pixels differ)`);
      writeFileSync(join(out, 'canvas-deliver.png'), await page.screenshot());
    } else if (step.kind === 'canvas-ask') {
      await waitFor(async () => (await page.eval(`document.querySelectorAll('iframe.game').length === 1 && !!${GW}?.__gameStudio?._debug`)), 30000);
      await sleep(3000);
      const l = listNow();
      const ui = (l?.ui ?? []).filter((u) => u.code);
      console.log(`  editor's list: ui ${JSON.stringify(ui.map((u) => ({ key: u.key, name: u.name, kind: u.kind, box: u.box })))}; uiFound ${JSON.stringify(l?.uiFound ?? [])}`);
      check(/codeUi\s*\(/.test(codeText), 'it wrote codeUi() into the game\'s drawing');
      check(dos.some((c) => /ui\.code/.test(c)), 'it put them in the editor itself (--do ui.code)');
      check(/its picture follows it/.test(r.s), 'the editor\'s check passed (each box moved 40 px: the picture followed)');
      check(ui.length >= 4 && ui.some((u) => /map/i.test(u.key + u.name)) && ui.some((u) => /score/i.test(u.key + u.name)), `all of them at once: the minimap and the rest (${ui.map((u) => u.key).join(', ') || 'none'})`);
      check(!(l?.uiFound ?? []).length, `the dotted frames are gone (uiFound ${JSON.stringify(l?.uiFound ?? [])})`);
      const n = hud0 ? await hudDiff(hud0) : -1;
      check(n >= 0 && n < 200, `the HUD's picture is the same before and after the rewrite (${n} pixels differ)`);
      const st = existsSync(join(game, '.studio/status.json')) ? JSON.parse(readFileSync(join(game, '.studio/status.json'), 'utf8')) : null;
      check(!!asked && !!st && st.state === 'done' && (st.request === asked.id || (st.handled ?? []).includes(asked.id)), `the ask marked done in the editor (${st ? JSON.stringify({ state: st.state, request: st.request, note: st.note }) : 'no status'})`);
      writeFileSync(join(out, 'canvas-ask.png'), await page.screenshot());
    } else if (step.kind === 'canvas-engine') {
      await waitFor(async () => (await page.eval(`document.querySelectorAll('iframe.game').length === 1 && !!${GW}?.__gameStudio?._debug`)), 30000);
      await sleep(3000);
      const l = listNow();
      const ui = (l?.ui ?? []).filter((u) => u.code);
      // Each delivered object where the game drew it, with its own size and colour (the original game: Phaser's distance
      // at 16, 20 in its own pixels, 22px #2b1d3a; Pixi's score at 16, 16 and the note at 16, 46, CSS px, white / #8fc6d4).
      const objs = JSON.parse((await page.eval(`(() => { const m = ${GW}?.[Symbol.for('game-studio.codeUis')]; const o = [];
        if (m) for (const [k, e] of m) { const b = e.box(); const t = e.obj; const st = t && t.style;
          o.push({ k, box: [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 10) / 10), obj: t ? [t.x, t.y] : null, scale: t ? (t.scaleX ?? t.scale?.x) : null,
            size: st ? String(st.fontSize) : null, colour: st ? String(st.color ?? st.fill) : null, text: t ? t.text : null }); }
        return JSON.stringify(o); })()`)) || '[]');
      console.log(`  editor's list: ui ${JSON.stringify(ui.map((u) => ({ key: u.key, name: u.name, kind: u.kind, box: u.box })))}; the game's objects ${JSON.stringify(objs)}; uiFound ${JSON.stringify(l?.uiFound ?? [])}`);
      check(/codeUi\s*\(/.test(codeText), 'it wrote codeUi() into the game\'s code');
      check(/onChange\s*\(/.test(codeText), 'kept as objects: it moves them in onChange()');
      check(dos.some((c) => /ui\.code/.test(c)), 'it put them in the editor itself (--do ui.code)');
      check(/its picture follows it/.test(r.s), 'the editor\'s check passed (each box moved 40 px: the picture followed)');
      const want = ENGINE === 'phaser' ? [[16, 20]] : [[16, 16], [16, 46]];
      const at = (o) => o.obj ?? o.box.slice(0, 2);
      check(ui.length >= want.length && want.every(([x, y]) => objs.some((o) => Math.abs(at(o)[0] - x) <= 1.5 && Math.abs(at(o)[1] - y) <= 1.5)),
        `each one where the game drew it (${want.map((w) => w.join(', ')).join(' · ')}): ${JSON.stringify(objs.map((o) => [o.k, at(o)]))}`);
      const look = ENGINE === 'phaser' ? objs.find((o) => Math.abs(at(o)[0] - 16) <= 1.5 && Math.abs(at(o)[1] - 20) <= 1.5) : objs.find((o) => Math.abs(at(o)[0] - 16) <= 1.5 && Math.abs(at(o)[1] - 16) <= 1.5);
      check(!look?.size || (ENGINE === 'phaser' ? /^22(px)?$/.test(look.size) && /2b1d3a/i.test(look.colour) && (look.scale ?? 1) === 1 : /^22(px)?$/.test(look.size) && (look.scale ?? 1) === 1),
        `its own size and colour (${JSON.stringify(look && { size: look.size, colour: look.colour, scale: look.scale })})`);
      check(/[ぁ-んァ-ヶ一-龠]/.test(reply.split('\n').slice(1).join('\n')), 'the reply is in Japanese (the person asked in Japanese)');
      // SKILL.md "UI drawn in the canvas" step 5: the link and one line (a note in brackets — the link's own — aside).
      const said = reply.split('\n').slice(1).map((x) => x.trim()).filter((x) => x && !/^[（(]/.test(x));
      check(said.length <= 2, `said in a line or two (${said.length} lines)`);
      writeFileSync(join(out, `canvas-${ENGINE}.png`), await page.screenshot());
    } else if (step.kind === 'canvas-save') {
      await waitFor(async () => (await page.eval(`document.querySelectorAll('iframe.game').length === 1 && !!${GW}?.__gameStudio?._debug`)), 30000);
      await sleep(3000);
      const boxes1 = await uiBoxes();
      const f = fileNow();
      console.log(`  placement.json ui ${JSON.stringify(f.ui ?? null)}; boxes now ${JSON.stringify(boxes1)}`);
      check(edits.length > 0 || codeNow.main !== code0.main, 'it wrote the change into the game\'s code');
      check(dos.some((c) => /ui\.set/.test(c) && /clear/.test(c)) && dos.some((c) => /ui\.code/.test(c)), 'it read the game again and cleared the entries itself (--do ui.code + ui.set --clear)');
      check(!f.ui || !Object.values(f.ui).some((e) => e.code), `no canvas UI left in placement.json (${JSON.stringify(f.ui ?? null)})`);
      check(sameBoxes(boxes0 ?? {}, boxes1), `every box where the person saw it: ${JSON.stringify(Object.fromEntries(Object.keys(boxes0 ?? {}).map((k) => [k, (boxes1[k] ?? []).map((v, i) => Math.round((v - boxes0[k][i]) * 10) / 10)])))}`);
      check(!(await unsavedNow()), `nothing left to save in the editor ("${await page.eval(`document.querySelector('[data-part=save]')?.textContent ?? ''`)}")`);
      writeFileSync(join(out, 'canvas-save.png'), await page.screenshot());
    } else if (step.kind === 'made') {
      const spawnAt = /function spawnBoss[\s\S]*?boss\.position\.set\(\s*(-?[\d.]+)/.exec(codeNow.main);
      console.log(`  where the game makes the boss now: ${spawnAt ? spawnAt[0].split('\n').pop().trim() : 'not found'}`);
      check(codeNow.main !== code0.main, 'it changed the game\'s code');
      check(!!spawnAt && Number(spawnAt[1]) < -2.5, `the boss is made on the left (x ${spawnAt?.[1]}; it was 0, the person put it at -3.4)`);
      const st = existsSync(join(game, '.studio/status.json')) ? JSON.parse(readFileSync(join(game, '.studio/status.json'), 'utf8')) : null;
      check(!!st && st.request === asked?.id && st.state === 'done', `the request is done (${st ? `${st.state} · ${st.note ?? ''}` : 'no status'})`);
      // Play from the start (a new page, the new code): the boss comes in on the left.
      await page.eval(`document.querySelector('[data-part=play-more]').click()`);
      await sleep(400);
      await page.eval(`document.querySelector('[data-action=ctx-play-fresh]').click()`);
      await sleep(3000);
      const ok = await waitFor(async () => (await page.eval(`JSON.stringify(${GW}?.__gameStudio?._move?.list()?.map((i) => i.key) ?? [])`)).includes('"boss"'), 60000);
      const bx = ok ? JSON.parse(await page.eval(`JSON.stringify(${GW}.__gameStudio._move.list().find((i) => i.key === 'boss').pose)`)) : null;
      check(!!bx && bx.p[0] < -2.5, `Play from the start: the boss comes in on the left (x ${bx?.p?.[0]?.toFixed?.(2)})`);
      writeFileSync(join(out, 'made-after.png'), await page.screenshot());
    } else if (step.kind === 'moment') {
      const cm = /codeMoment\s*\(\s*\{[\s\S]*?\n\s*\}\s*\}?\s*\)\s*;?/.exec(codeNow.main + readGameJs());
      console.log(`  its codeMoment:\n${cm ? cm[0].split('\n').map((l) => '    ' + l).join('\n') : '    (not found)'}`);
      check(/codeMoment\s*\(/.test(codeText), 'it wrote a codeMoment() in the game\'s code');
      check(codeNow.index === code0.index, 'the HUD (index.html) is untouched: nothing else changed on screen');
      const st = existsSync(join(game, '.studio/status.json')) ? JSON.parse(readFileSync(join(game, '.studio/status.json'), 'utf8')) : null;
      check(!!st && st.request === asked?.id && st.state === 'done', `the request is done (${st ? `${st.state} · ${st.note ?? ''}` : 'no status'})`);
      // Play from the start (a new page, the new code), pause: This moment lists them, and the AI's hands see them.
      await page.eval(`document.querySelector('[data-part=play-more]').click()`);
      await sleep(400);
      await page.eval(`document.querySelector('[data-action=ctx-play-fresh]').click()`);
      await sleep(3000);
      await waitFor(() => page.eval(`!!${GW}?.__gameStudio?._move && document.querySelector('.shell').dataset.playing === 'on' && !!document.querySelector('[data-part=play-pause]:not([hidden])')`), 60000);
      await sleep(2000);
      await page.eval(`document.querySelector('[data-part=play-pause]').click()`);
      await waitFor(() => page.eval(`document.querySelector('.shell').dataset.moment === 'on'`), 10000);
      await waitFor(() => page.eval(`document.querySelectorAll('[data-part=moment-value]').length > 0`), 5000);
      const rows = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('[data-part=moment-value]')].map((e) => e.textContent))`) || '[]');
      console.log(`  This moment after Play from the start: ${JSON.stringify(rows)}`);
      check(rows.length >= 3, `This moment lists the run's numbers (${rows.length})`);
      const l = listNow();
      console.log(`  --do list: moment ${JSON.stringify(l?.moment)}, paused ${l?.paused}`);
      check(Array.isArray(l?.moment) && l.moment.length >= 3 && l.paused === true, '--do list has moment (3 or more values) and paused');
      const time = (l?.moment ?? []).find((x) => /time|left|timer/i.test(x.id) && x.set);
      const said = time ? doEditor('moment.set', '--id', time.id, '--v', '5') : '';
      console.log(`  ${hide(said).split('\n')[0]}`);
      check(/^studio: did set .* to 5 for this moment/.test(said), `--do moment.set --id ${time?.id ?? '?'} --v 5`);
      writeFileSync(join(out, 'moment-after.png'), await page.screenshot());
    } else if (step.kind === 'code-place') {
      const l = listNow();
      console.log(`  editor's list: places ${JSON.stringify((l?.places ?? []).map((p) => ({ id: p.id, name: p.name, n: p.keys?.length, knobs: p.knobs })))}`);
      const lamps = (l?.places ?? []).find((p) => (p.keys?.length ?? 0) >= 10);
      check(/codePlace\s*\(/.test(codeText), 'it wrote a codePlace() in the game\'s code');
      check(dos.some((c) => /place\.code/.test(c)), 'it showed it in the editor itself (--do place.code)');
      check(!!lamps && Object.values(lamps.knobs ?? {}).some((k) => k.v === 6) && Object.keys(lamps.knobs ?? {}).length <= 3, `ten lamps in the editor under the layout's name, a knob at 6 (${lamps ? `${lamps.name} ×${lamps.keys.length}` : 'none'})`);
    }
  }
  writeFileSync(join(out, 'placement.json'), JSON.stringify(fileNow(), null, 2));
  writeFileSync(join(out, 'editor.png'), await page.screenshot());
} finally {
  await browser.close();
  spawnSync(process.execPath, [CLI, game, '--stop'], { env: editorEnv });
  console.log(`\nreport: ${out}`);
  if (!KEEP) rmSync(game, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
