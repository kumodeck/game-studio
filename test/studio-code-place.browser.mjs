// studio-code-knobs (2026-10-24) in a headless browser: the two needs asked for that day, on screen.
//   1. "Things placed procedurally, motions made by maths: I want to fine-tune them by hand — but keep them procedural."
//   2. "Things placed by coordinates: I want to fix them by hand, as coordinates."
// Neon Run as the AI leaves it after "four hexagons in a row, 6 m apart; spin the pillar in a spiral": the hexagons are
// a codePlace('hex') (Gap and Count its knobs, a drag turns Gap), the pillar has codeMotion('spiral') on its timeline
// (Radius and Lap its knobs, a drag of its path's ◇ turns Radius). One language a run (`--lang en|ja`), dark then light:
//   layout  press a hexagon → the card's Layout ("Line · 4", Rule) with its knobs, violet rings in the game, the line under
//           the strip; Gap typed 6 → 4: the row closes up IN PLACE (the same game page: no reload), Save · 1; a hexagon
//           dragged toward the camera: Gap follows it (the chip "Gap 4 → x m"), the others too; ⌥-drag of another: just
//           that one (Manually overridden, its pin), the rest stays; "Place individually" on a third: all four put by
//           hand; ⌘Z ⌘Z ⌘Z: back to Gap 4 with none by hand.
//   motion  the pillar's timeline: the rule motion's strip ("Rule motion: Spiral · Radius 2 m · Lap 4 s"), its knobs on
//           the line, no "Repeat: Once"; the ◇ of its path dragged out: Radius 2 → 3 m; Disable / enable; "Make editable
//           points": a motion of points; ⌘Z back to the rule.
//   plain   (the first theme) a game with no rule (Neon Run as it is): the card and the list as before (no Layout, no tag).
//   keepout (studio-code-keepout, 2026-10-24; the plan's step 3, need 4: "when things are placed procedurally I want to
//           mark where they must not go — as coordinates or as code"): twelve crystals scattered by a rule (codePlace
//           'crystal', its code avoids codeAvoid('road')), and codeAvoid('near-player') in the code for the AI to add:
//           press a crystal → the card's Keep-out areas ("On the road", Rule) and the road painted in the game → "+ Draw a
//           box" and a drag on the ground → the crystals in it step out ("2 moved out"), Save · 1 → "✦ Describe with text":
//           the chips, the request (`places`, `intent: 'avoid'`) → the AI's place.avoid: its row glows, a circle with a ◇
//           → the ◇ dragged out, then 5 → 6 m typed → Save: the file → "On the road" off → ⌘Z back on → ⌘Z ×4: as at
//           the start → a box that leaves almost no room: "N of 12 have no place to go" and the × → one put by hand on
//           the road: "Inside a keep-out area" → × on a row.
//   torule  (the first theme; studio-code-torule, 2026-10-24 — need 3: "turn what I placed / moved by hand into a close
//           formula") six street lamps placed by hand (the third 0.6 m off the line) and the ship's motion of points:
//           pick the six → ✦ Turn into a rule → the draft in the chat box, sent (intent "to-code") → a stand-in AI writes
//           codePlace('lamp-row') and sends `--do place.code --replace` → the hand lamps hidden, the rule's lit violet,
//           orange dots where they stood and the chip "lamp-3 · 0.6 m", the card's "Max deviation: lamp-3 (0.6 m)" → ⌘Z:
//           the hand lamps back. The ship: the motion row's ⋯ → Turn into a rule… → `motion.code --replace` → the strip
//           lit with orange marks, "Compare with original · Max deviation …" on the line, orange dots in the game → Save:
//           the comparison gone.
//   coords  (the first theme; studio-to-coords, 2026-10-24 — a request that day: "a rule's thing stays a rule however it is moved;
//           a button converts it to coordinates", and the CRYSTAL FIELD try: a lamp dragged away from the road did nothing
//           and said nothing, and lifted it silently left its row) a first-time maker drags one lamp of each row
//           forward / back, left / right, up / down. The row of that try (Count and Gap, its distance from the road fixed,
//           `drag: 'gap'`): forward = every gap follows; sideways, Height, Turn = nothing moves, the chip says why while the
//           finger is down and the line after says it again with ✦ (its draft in the chat box); ⌥ + Height = just that
//           one, told "Placed … by hand · ⌘Z · Reset to rule", marked Hand-placed on the card and in the list, the line's
//           Reset to rule puts it back; an arrow key and the whole row dragged keep it too. The row SKILL.md asks for now
//           (`drag: { along, side, up }`): sideways = its distance from the road, Height = its height, for all of them.
//           Never a pin without ⌥, never an object entry.
// Pictures (`--shots <dir>`): 2-<lang>-<theme>-<step>.png (the plan's step-2 pictures), 3-… (step 3), 4-… (step 4),
// c-<lang>-<theme>-<step>.png (to coords).
// `--before`: only the first keep-out picture (run with the previous version's UI: `--ui <dir>`).
//
//   node test/studio-code-place.browser.mjs [--lang en|ja] [--themes dark,light] [--width 1280] [--only layout,motion,plain,keepout,torule,coords] [--shots <dir>] [--before]
// Exit 1 on a failure.
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { askEditor } from '../src/server/hands-cli.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const LANG = take('--lang', 'ja');
const THEMES = take('--themes', 'dark,light').split(',').filter((x) => x === 'dark' || x === 'light');
const WIDTH = Number(take('--width', '1280'));
const PHONE = WIDTH < 500;
const ONLY = take('--only', 'layout,motion,plain,keepout,torule,coords').split(',');
const BEFORE = args.includes('--before');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = LANG === 'ja'
  ? { saved: '間 → 4 m', layout: '並べ方', line: '直線 · 4 個', tag: 'ルール', gap: '間', note: '動かすと間が変わる', pinned: 'この 1 個だけ手で置いています', handTag: '手置き', hand: '座標にする', motion: '動きのルール', radius: '半径', points: '座標にする', pointsDone: 'らせんのルールを座標にしました', repeat: 'くり返し', off: '一時停止' }
  : { saved: 'Gap → 4 m', layout: 'Layout', line: 'Line · 4', tag: 'Rule', gap: 'Gap', note: 'Drag to adjust Gap', pinned: 'Manually overridden', handTag: 'Hand-placed', hand: 'Convert to coordinates', motion: 'Rule motion', radius: 'Radius', points: 'Convert to coordinates', pointsDone: 'Converted the Spiral rule to coordinates', repeat: 'Repeat', off: 'Disable' };

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

// The rule layout and the rule motion as the AI writes them (SKILL.md "Code layouts", "Motion"), in the person's language.
const RULES = `
    // Four hexagons in a row, "Gap" m apart toward the back (the AI's codePlace: the editor's knobs Gap and Count).
    codePlace('hex', {
      name: ${JSON.stringify(LANG === 'ja' ? '六角形' : 'hex')},
      knobs: { n: { v: 4, label: ${JSON.stringify(LANG === 'ja' ? '個数' : 'Count')}, unit: '', min: 1, max: 8, step: 1 }, gap: { v: 6, label: ${JSON.stringify(LANG === 'ja' ? '間' : 'Gap')}, unit: 'm', min: 2, max: 12 } },
      count: (k) => k.n,
      make: () => { const h = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .5, 6), glow(0xff6a1a, 1.3)); return h; },
      at: (i, k) => ({ p: [-2.4 + i * 1.6, .95, -4 - i * k.gap], r: [Math.PI / 2, 0, 0] }),
      drag: 'gap',
    });
    // The pillar's spiral (the AI's codeMotion: Radius and Lap the editor's knobs, a drag of its path turns Radius).
    codeMotion('spiral', {
      name: ${JSON.stringify(LANG === 'ja' ? 'らせん' : 'Spiral')},
      knobs: { radius: { v: 2, label: ${JSON.stringify(LANG === 'ja' ? '半径' : 'Radius')}, unit: 'm', min: .2, max: 6 }, lap: { v: 4, label: ${JSON.stringify(LANG === 'ja' ? '1 周' : 'Lap')}, unit: 's', min: .5, max: 20 } },
      round: (k) => k.lap,
      at: (t, k) => { const a = (t / k.lap) * 2 * Math.PI; return { p: [k.radius * Math.cos(a) - k.radius, 0, k.radius * Math.sin(a)] }; },
      drag: 'radius',
    });
`;
const MOTION_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [{ name: LANG === 'ja' ? 'らせん' : 'Spiral', code: 'spiral' }],
  motion: { pillar: { clips: [{ use: LANG === 'ja' ? 'らせん' : 'Spiral', when: { on: 'start' } }] } } };

// Step 3: crystals scattered by a rule that keeps off the road; a second condition (near the player's start) for the AI.
const W3 = LANG === 'ja'
  ? { title: '置かない所', road: '道の上', rule: 'ルール', hand: '手', chip: '置かない所', crystal: '結晶', near: 'プレイヤーから', out: '個が外へ', skipped: '個は置ける所がありません', inside: '置かない所の中です', box: '四角 1', ask: 'プレイヤーから 5 m 以内には置かない' }
  : { title: 'Keep-out areas', road: 'On the road', rule: 'Rule', hand: 'Hand', chip: 'Keep-out areas', crystal: 'crystal', near: 'From the player', out: 'moved out', skipped: 'no place to go', inside: 'Inside a keep-out area', box: 'Box 1', ask: 'not within 5 m of the player' };
const KEEPOUT = `
    // Twelve crystals scattered over the field, never on the road (the AI's codePlace and codeAvoid; SKILL.md "Code layouts").
    codePlace('crystal', {
      name: ${JSON.stringify(W3.crystal)},
      knobs: { n: { v: 12, label: ${JSON.stringify(LANG === 'ja' ? '個数' : 'Count')}, unit: '', min: 1, max: 30, step: 1 } },
      count: (k) => k.n,
      make: () => new THREE.Mesh(new THREE.OctahedronGeometry(.45), glow(0x6ff0ff, 1.4)),
      at: (i, k, g) => ({ p: [-12 + g.rand() * 24, 1.1, 4 - g.rand() * 34] }),
      avoid: ['road'],
    });
    codeAvoid('road', { name: ${JSON.stringify(W3.road)}, test: (p) => Math.abs(p[0]) < 5 });
    // Not within r m of where the player starts (a knob; its shape a circle, so the editor puts a ◇ on it).
    codeAvoid('near-player', {
      name: ${JSON.stringify(W3.near)}, after: ${JSON.stringify(LANG === 'ja' ? '以内' : 'within')},
      knobs: { r: { v: 5, label: ${JSON.stringify(LANG === 'ja' ? '距離' : 'Distance')}, unit: 'm', min: 1, max: 20 } },
      test: (p, k, g) => !!g.player && Math.hypot(p[0] - g.player[0], p[2] - g.player[2]) < k.r,
      show: (k, g) => (g.player ? { circle: { p: [g.player[0], 0, g.player[2]], r: k.r } } : null),
    });
`;

// ✦ Turn into a rule (studio-code-torule): the hand-placed lamps and the hand-made motion, as a person's game has them.
const SHIP_MOTION = LANG === 'ja' ? 'ship の動き' : 'Ship motion';
// Six street lamps on the left of the road, put one by one by hand (the third 0.6 m off the line), and the lamp's look
// the rule will use too.
const LAMPS = `
    const makeLamp = () => {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 3.2, 8), glow(0x8a7cff, .6));
      pole.position.y = 1.6;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.32, 16, 12), glow(0xffb3f0, 2));
      bulb.position.y = 3.3;
      lamp.add(pole, bulb);
      return lamp;
    };
    window.__lamps = [-6, -6, -6.6, -6, -6, -6].map((x, i) => {
      const lamp = makeLamp();
      lamp.name = \`lamp-\${i + 1}\`;
      lamp.position.set(x, 0, -6 - i * 6);
      scene.add(lamp);
      return lamp;
    });
    // @rules
`;
// What the stand-in AI writes for ✦ Turn into a rule (SKILL.md "Turn into a rule"): a row 6 m apart, and a wave.
const TO_RULE = `
    codePlace('lamp-row', {
      name: ${JSON.stringify(LANG === 'ja' ? '街灯' : 'Street lamps')},
      knobs: { n: { v: 6, label: ${JSON.stringify(LANG === 'ja' ? '本数' : 'Count')}, unit: '', min: 1, max: 20, step: 1 }, gap: { v: 6, label: ${JSON.stringify(LANG === 'ja' ? '間' : 'Gap')}, unit: 'm', min: 2, max: 15 } },
      count: (k) => k.n,
      make: () => makeLamp(),
      at: (i, k) => ({ p: [-6, 0, -6 - i * k.gap] }),
      drag: 'gap',
    });
    codeMotion('ship-wave', {
      name: ${JSON.stringify(LANG === 'ja' ? '波' : 'Wave')},
      knobs: { w: { v: 1.5, label: ${JSON.stringify(LANG === 'ja' ? '幅' : 'Width')}, unit: 'm', min: .2, max: 4 }, lap: { v: 2, label: ${JSON.stringify(LANG === 'ja' ? '1 往復' : 'Round')}, unit: 's', min: .5, max: 10 } },
      round: (k) => k.lap,
      at: (t, k) => ({ p: [k.w * Math.sin((t / k.lap) * 2 * Math.PI), 0, 0] }),
      drag: 'w',
    });
`;
// The ship's motion as the person made it on the timeline: a wave side to side, 9 points, the fourth a little off.
const SHIP_FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [{ name: SHIP_MOTION, len: 2, repeat: 'loop', keys: { p: Array.from({ length: 9 }, (_, i) => ({ t: i / 4, v: [Math.round((Math.sin((i / 8) * 2 * Math.PI) * 1.5 + (i === 3 ? 0.12 : 0)) * 1000) / 1000, 0, 0], ease: 'linear' })) } }],
  motion: { ship: { clips: [{ use: SHIP_MOTION, when: { on: 'start' } }] } } };

// To coords (studio-to-coords): two rows of street lamps by the road. Left: the CRYSTAL FIELD row of 10/24 (Count and Gap,
// its distance from the road fixed in the code, `drag: 'gap'`). Right: the row SKILL.md asks for now — a knob for each way
// a person may drag one (along the road: Gap, away from it: From the road, up: Height).
const LAMP_NAME = LANG === 'ja' ? '街灯' : 'Street lamps';
const LAMP_NAME_R = LANG === 'ja' ? '街灯（右）' : 'Right lamps';
const COORDS = `
    const makeLamp = () => {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 3.2, 8), glow(0x8a7cff, .6));
      pole.position.y = 1.6;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.32, 16, 12), glow(0xffb3f0, 2));
      bulb.position.y = 3.3;
      lamp.add(pole, bulb);
      return lamp;
    };
    codePlace('lamp-row', {
      name: ${JSON.stringify(LAMP_NAME)},
      knobs: { n: { v: 5, label: ${JSON.stringify(LANG === 'ja' ? '本数' : 'Count')}, unit: '', min: 1, max: 10, step: 1 }, gap: { v: 8, label: ${JSON.stringify(LANG === 'ja' ? '間' : 'Gap')}, unit: 'm', min: 2, max: 15 } },
      count: (k) => k.n,
      make: () => makeLamp(),
      at: (i, k) => ({ p: [-5.6, 0, -6 - i * k.gap] }),
      drag: 'gap',
    });
    codePlace('lamp-way', {
      name: ${JSON.stringify(LAMP_NAME_R)},
      knobs: { gap: { v: 8, label: ${JSON.stringify(LANG === 'ja' ? '間' : 'Gap')}, unit: 'm', min: 2, max: 15 }, side: { v: 5.6, label: ${JSON.stringify(LANG === 'ja' ? '道からの距離' : 'From the road')}, unit: 'm', min: 2, max: 12 }, h: { v: 0, label: ${JSON.stringify(LANG === 'ja' ? '高さ' : 'Height')}, unit: 'm', min: 0, max: 6 } },
      count: 5,
      make: () => makeLamp(),
      at: (i, k) => ({ p: [k.side, k.h, -6 - i * k.gap] }),
      drag: { along: 'gap', side: 'side', up: 'h' },
    });
`;

/**
 * Neon Run in a temporary folder: `rules` = with the hexagons as a rule layout and the pillar's rule motion; 'keepout' =
 * the crystals; 'torule' = the hand lamps and the ship's hand motion; 'coords' = the two rows of rule lamps.
 */
function makeGame(theme, rules) {
  const root = mkdtempSync(join(tmpdir(), 'studio-code-knobs-'));
  cpSync(join(PKG, 'test/neon-run'), root, { recursive: true });
  copyFileSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), join(root, 'studio-placement.js'));
  if (rules === 'coords') {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
      .replace("import { applyPlacement } from './studio-placement.js';", "import { applyPlacement, codePlace } from './studio-placement.js';")
      .replace("    await applyPlacement(scene, './placement.json');", `${COORDS}\n    await applyPlacement(scene, './placement.json');`);
    writeFileSync(join(root, 'index.html'), html);
  } else if (rules === 'torule') {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
      .replace("import { applyPlacement } from './studio-placement.js';", "import { applyPlacement, codeMotion, codePlace } from './studio-placement.js';")
      .replace("    await applyPlacement(scene, './placement.json');", `${LAMPS}\n    await applyPlacement(scene, './placement.json');`);
    writeFileSync(join(root, 'index.html'), html);
    writeFileSync(join(root, 'placement.json'), JSON.stringify(SHIP_FILE, null, 2));
  } else if (rules === 'keepout') {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
      .replace("import { applyPlacement } from './studio-placement.js';", "import { applyPlacement, codeAvoid, codePlace } from './studio-placement.js';")
      // The player starts at (0, 0, -4) for the conditions (applyPlacement's { player }): in front of the camera.
      .replace("    await applyPlacement(scene, './placement.json');", `${KEEPOUT}    await applyPlacement(scene, './placement.json', { player: [0, 0, -4] });`);
    writeFileSync(join(root, 'index.html'), html);
    writeFileSync(join(root, 'placement.json'), JSON.stringify({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {} }, null, 2));
  } else if (rules) {
    let html = readFileSync(join(root, 'index.html'), 'utf8')
      .replace("import { applyPlacement } from './studio-placement.js';", "import { applyPlacement, codeMotion, codePlace } from './studio-placement.js';");
    // The hand-placed loop out (the rule puts them now), the pillar standing still (the rule motion moves it).
    html = html.replace(/    const hexes = \[\];\n    for \(let i = 0; i < 4; i\+\+\) \{[\s\S]*?\n    \}\n/, `    const hexes = [];\n${RULES}`)
      .replace('      pillar.position.z += 6 * dt;\n      if (pillar.position.z > 8) pillar.position.z -= 40;\n', '');
    writeFileSync(join(root, 'index.html'), html);
    writeFileSync(join(root, 'placement.json'), JSON.stringify(MOTION_FILE, null, 2));
  }
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps', 'open-line'] }));
  return root;
}

const GW = `document.querySelector('iframe.game:not(.leaving)').contentWindow`;
const DBG = `${GW}.__gameStudio._debug`;
const ROW = `JSON.stringify([...${GW}[Symbol.for('game-studio.codePlaces')].get('hex').objs].map((o) => Math.round(o.position.z * 100) / 100))`;

async function run(theme, first) {
  console.log(`${LANG} ${theme} ${WIDTH}`);
  const root = makeGame(theme, true);
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: WIDTH, height: PHONE ? 844 : 800, mobile: PHONE, cdnCache: process.env.STUDIO_CDN_CACHE });
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `2-${LANG}-${theme}${PHONE ? '-phone' : ''}-${what}.png`), await page.screenshot());
    const ai = (ops) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
    const list = async () => (await ai([{ do: 'list' }])).results?.[0]?.list;
    const hexPlace = async () => (await list())?.places?.find((p) => p.id === 'hex');
    const at = async (key) => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)'); const r = f.getBoundingClientRect();
      const a = ${DBG}.anchor(${JSON.stringify(key)}); return a ? JSON.stringify({ x: r.left + a.center[0], y: r.top + a.center[1] }) : 'null'; })()`));
    // A phone's card folds its numbers (and a layout's knobs) under "…": opened before it is read.
    const card = () => page.eval(`(() => { const f = document.querySelector('[data-part=card] details.fine'); if (f && !f.open) f.open = true; return document.querySelector('[data-part=card]')?.innerText ?? ''; })()`);
    // …and folded again before a drag in the game (open, the sheet covers the hexagons on a phone).
    const fold = async () => (await page.eval(`(() => { const f = document.querySelector('[data-part=card] details.fine'); if (f && f.open && ${PHONE}) f.open = false; return 1; })()`), await sleep(300));
    const note = () => page.eval(`(() => { const h = [...${GW}.document.querySelectorAll('[data-studio-ui]')].map((x) => x.shadowRoot?.querySelector('.note')).find((n) => n && n.style.display !== 'none'); return h ? h.textContent : ''; })()`);
    const rings = () => page.eval(`${GW}.document.querySelector('[data-studio-code-place]')?.shadowRoot?.querySelectorAll('svg path').length ?? 0`);
    const saveN = () => page.eval(`document.querySelector('[data-part=save]')?.textContent ?? ''`);
    const key = async (k, modifiers = 0, code = k) => {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
    };
    const undoKey = () => key('z', 4, 'KeyZ');
    /** A mouse drag with modifiers (8 = Shift, 1 = ⌥), `mid` = a picture while the button is still down. */
    const drag = async (a, b, modifiers = 0, mid = null) => {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, modifiers });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
      for (let i = 1; i <= 12; i++) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12, button: 'left', buttons: 1, modifiers });
        await sleep(30);
      }
      if (mid) await mid();
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
      await sleep(500);
    };
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug`, 90000);
    await sleep(1500);

    if (ONLY.includes('layout')) {
      // ---- 1. press a hexagon: the card's Layout, the rings, the line ----
      await page.eval(`studioShell.actions.select('hex-2')`);
      await sleep(900);
      const c1 = await card();
      check(c1.includes(W.layout) && c1.includes(W.line) && c1.includes(W.tag), `the card says the layout: "${c1.replace(/\n/g, ' / ').slice(0, 120)}"`);
      check(await page.eval(`!!document.querySelector('[data-part=rule-knob-gap]') && !!document.querySelector('[data-part=rule-knob-n]')`), 'its knobs Gap and Count are on the card');
      check(await page.eval(`!document.querySelector('[data-part=card] .f-cells.n3')`), 'no Position numbers (the rule decides them)');
      check((await rings()) >= 8, `violet rings and the dotted line in the game (${await rings()} paths)`);
      // A phone's open card can cover the hexagon for a moment (the camera then steps back to show it): wait for the line.
      await page.waitFor(`(() => { const h = [...${GW}.document.querySelectorAll('[data-studio-ui]')].map((x) => x.shadowRoot?.querySelector('.note')).find((n) => n && n.style.display !== 'none'); return !!h && h.textContent.includes(${JSON.stringify(W.note)}); })()`, 4000).catch(() => null);
      check((await note()).includes(W.note), `the line under the strip: "${await note()}"`);
      check(JSON.parse(await page.eval(ROW)).join() === '-4,-10,-16,-22', `the rule put them 6 m apart (${await page.eval(ROW)})`);
      if (!PHONE) check((await page.eval(`document.querySelector('[data-action=card-more]')?.title ?? ''`)).includes(W.hand), 'the card\'s ⋯ has Place individually too');
      await shot('1-knob');

      // ---- 2. Gap typed 6 → 4: in place (the same page), Save · 1 ----
      await page.eval(`${GW}.__same = 1`);
      await card();
      await page.eval(`document.querySelector('[data-part=rule-knob-gap]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
      await sleep(200);
      await page.eval(`(() => { const f = document.querySelector('[data-part=rule-knob-gap-in]'); f.value = '4'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      await sleep(900);
      check(JSON.parse(await page.eval(ROW)).join() === '-4,-8,-12,-16', `Gap 4: the row closes up (${await page.eval(ROW)})`);
      check(await page.eval(`${GW}.__same === 1`), 'in place: the same game page (no reload)');
      check((await hexPlace())?.knobs?.gap?.v === 4, `the draft: gap 4 (${JSON.stringify((await hexPlace())?.knobs?.gap)})`);
      check(/1/.test(await saveN()), `Save · 1 ("${await saveN()}")`);
      await shot('2-gap4');

      // ---- 3. drag hex-2 toward the camera: Gap follows (the chip), the others too ----
      await fold();
      const a2 = await at('hex-2');
      const a1 = await at('hex-1');
      let chip = '';
      // At least 36 px toward the camera: with the camera stepped back (a phone's taller card) 40 % of the gap between two
      // hexagons was a few px — less than a drag (studio-code-keepout's phone run, 10/24).
      await drag(a2, { x: a2.x, y: a2.y + Math.max(36, (a1.y - a2.y) * 0.4) }, 0, async () => {
        chip = await page.eval(`(() => { const h = [...${GW}.document.querySelectorAll('[data-studio-ui]')].map((x) => x.shadowRoot?.querySelector('.chip')).find((n) => n && n.style.display !== 'none'); return h ? h.textContent : ''; })()`);
        await shot('3-drag');
      });
      const g3 = (await hexPlace())?.knobs?.gap?.v;
      const row3 = JSON.parse(await page.eval(ROW));
      check(typeof g3 === 'number' && g3 < 4 && g3 >= 2, `the drag turned Gap: 4 → ${g3}`);
      check(row3.every((z, i) => Math.abs(z - (-4 - i * g3)) < 0.02), `every hexagon on the rule with it (${row3.join()})`);
      check(chip.includes(W.gap) && chip.includes('→'), `the chip while dragging: "${chip}"`);
      check(await page.eval(`${GW}.__same === 1`), 'still the same game page');
      await shot('3-dragged');

      // ---- 4. ⌥-drag hex-3: just that one (its pin), the rest stays ----
      await page.eval(`studioShell.actions.select('hex-3')`);
      await sleep(700);
      await fold();
      const a3 = await at('hex-3');
      await drag(a3, { x: a3.x - 120, y: a3.y }, 1);
      const p4 = await hexPlace();
      check(p4?.pins?.includes('hex-3'), `⌥: hex-3 put by hand (pins ${JSON.stringify(p4?.pins)})`);
      check(p4?.knobs?.gap?.v === g3, `Gap unchanged (${p4?.knobs?.gap?.v})`);
      check((await card()).includes(W.pinned) && (await card()).includes(W.handTag), `the card: "${(await card()).replace(/\n/g, ' / ').slice(0, 80)}"`);
      await shot('4-one');

      // ---- 5. Place individually (hex-1's card) ----
      await page.eval(`studioShell.actions.select('hex-1')`);
      await sleep(700);
      await card();
      await page.eval(`document.querySelector('[data-part=rule-individually]').click()`);
      await sleep(900);
      const p5 = await hexPlace();
      check(p5?.hand === true && p5?.pins?.length === 4, `placed individually: hand, 4 pins (${JSON.stringify({ hand: p5?.hand, pins: p5?.pins })})`);
      check(!(await page.eval(`!!document.querySelector('[data-part=rule-layout]')`)), 'the card is an ordinary card now (Position)');
      await shot('5-individually');

      // ---- 6. ⌘Z ⌘Z ⌘Z: Gap 4, none by hand ----
      await page.eval(`document.activeElement?.blur()`);
      for (let i = 0; i < 3; i++) (await undoKey(), await sleep(500));
      const p6 = await hexPlace();
      check(p6?.knobs?.gap?.v === 4 && !p6?.hand && !p6?.pins?.length, `⌘Z ×3: back to Gap 4, none by hand (${JSON.stringify({ gap: p6?.knobs?.gap?.v, hand: p6?.hand, pins: p6?.pins })})`);
      check(JSON.parse(await page.eval(ROW)).join() === '-4,-8,-12,-16', `the row as at Gap 4 (${await page.eval(ROW)})`);
      await shot('6-undo');

      // ---- 7. Save: the receipt says the rule's number ("Saved: hex Gap → 4 m") ----
      await page.eval(`document.querySelector('[data-part=save]')?.click()`);
      await sleep(1500);
      const line = await page.eval(`[...document.querySelectorAll('.ai-line, .ask-news:not([hidden]), .toast.on')].map((e) => e.textContent).join(' | ')`);
      check(line.includes(W.saved), `the Save receipt: "${line.slice(0, 140)}"`);
      const saved = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
      check(saved.places?.hex?.knobs?.gap?.v === 4 && saved.places.hex.knobs.gap.was === 6 && !Object.keys(saved.objects).some((k) => k.startsWith('hex-')),
        `placement.json: places.hex.knobs.gap { v: 4, was: 6 }, no hexagon in objects (${JSON.stringify(saved.places)})`);
      await shot('7-save');

      // ---- 8. tell them apart: a hand-placed gate shows no rings; the mouse over a hexagon shows its layout's ----
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      await page.eval(`studioShell.actions.select('gate')`);
      await sleep(700);
      await fold();
      check((await rings()) === 0, `the gate (by hand): no violet rings (${await rings()})`);
      const h3 = await at('hex-3');
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h3.x, y: h3.y });
      await sleep(400);
      check((await rings()) >= 8, `the mouse over a hexagon: its layout's rings (${await rings()} paths)`);
      await shot('8-tell');
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    }

    if (ONLY.includes('motion')) {
      // ---- 9. the pillar's rule motion on the timeline: the strip, its knobs on the line, no "Repeat" ----
      await page.eval(`studioShell.actions.select('pillar')`);
      await sleep(800);
      check((await card()).includes(W.tag), `the card's Motion row says Rule: "${(await card()).replace(/\n/g, ' / ').slice(0, 90)}"`);
      await page.eval(`document.querySelector('[data-part=motion-timeline-line]')?.click()`);
      await page.waitFor(`!!document.querySelector('[data-part=tl-rule]')`, 15000);
      await sleep(900);
      const words = await page.eval(`document.querySelector('[data-part=tl-rule-words]')?.textContent ?? ''`);
      check(words.includes(W.motion) && words.includes(W.radius) && words.includes('2 m'), `the strip: "${words}"`);
      check(await page.eval(`!!document.querySelector('[data-part=tl-knob-radius]') && !!document.querySelector('[data-part=tl-knob-lap]')`), 'its knobs Radius and Lap on the line');
      check(!(await page.eval(`!!document.querySelector('.tl-head [data-part=tl-rep]')`)), 'no "Repeat: Once" on the line');
      const pathN = () => page.eval(`${GW}.document.querySelector('[data-studio-code-motion]')?.shadowRoot?.querySelectorAll('svg path').length ?? 0`);
      check((await pathN()) >= 2, `its violet line in the game (${await pathN()} paths)`);
      await shot('9-strip');

      // ---- 10. the ◇ dragged out: Radius 2 → more ----
      const dia = JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect();
        const c = ${GW}.document.querySelector('[data-studio-code-motion]')?.shadowRoot?.querySelector('[data-code-knob]'); if (!c) return 'null';
        const r = c.getBoundingClientRect(); return JSON.stringify({ x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2 }); })()`));
      check(!!dia, `the ◇ is there (${JSON.stringify(dia)})`);
      const spiral = async () => (await list())?.motions?.find((m) => m.code === 'spiral');
      if (dia) {
        const pil = await at('pillar');
        const away = { x: dia.x + (dia.x - pil.x) * 0.5, y: dia.y + (dia.y - pil.y) * 0.5 };
        await drag(dia, away, 0, async () => await shot('10-diamond'));
        const r8 = (await spiral())?.knobs?.radius?.v;
        check(typeof r8 === 'number' && r8 > 2, `the ◇ turned Radius: 2 → ${r8}`);
        const w8 = await page.eval(`document.querySelector('[data-part=tl-rule-words]')?.textContent ?? ''`);
        check(w8.includes(`${r8}`), `the strip follows: "${w8}"`);
        await shot('10-radius');
      }

      // ---- 11. Disable, enable ----
      await page.eval(`document.querySelector('[data-part=tl-rule-sw]').click()`);
      await sleep(500);
      check(await page.eval(`!!document.querySelector('.tl-rule.off')`), 'disabled: the strip grey and dashed');
      await shot('11-off');
      await page.eval(`document.querySelector('[data-part=tl-rule-sw]').click()`);
      await sleep(500);
      check(await page.eval(`!document.querySelector('.tl-rule.off')`), 'enabled again');

      // ---- 12. Convert to coordinates (studio-to-coords: it was "Make editable points"), ⌘Z back to the rule ----
      const btn = await page.eval(`document.querySelector('[data-part=tl-rule-points]')?.textContent ?? ''`);
      check(btn === W.points, `the strip's button: "${btn}"`);
      const place0 = JSON.stringify((await list())?.objects?.find?.((o) => o.key === 'pillar')?.p ?? null);
      await page.eval(`document.querySelector('[data-part=tl-rule-points]').click()`);
      await sleep(1200);
      const pts = (await list())?.motions?.find((m) => m.name === (LANG === 'ja' ? 'らせん' : 'Spiral'));
      check(pts && !pts.code, `made into a motion of points (${JSON.stringify(pts).slice(0, 120)})`);
      const told = await page.eval(`[...document.querySelectorAll('.ai-line, .ask-news:not([hidden]), .toast.on')].map((e) => e.textContent).join(' | ')`);
      check(told.includes(W.pointsDone), `the line: "${told.slice(0, 120)}"`);
      // Relative (the request of 10/24: "for a motion, relative is better"): the first point is the pillar's own place (offset 0),
      // and its place is not in the points — moving the pillar moves its path.
      const first = pts?.points?.[0] ?? pts?.keys?.p?.[0]?.v;
      check(Array.isArray(first) && first.every((v) => Math.abs(v) < 1e-6), `the points are offsets from where it stands (first ${JSON.stringify(first)})`);
      check(JSON.stringify((await list())?.objects?.find?.((o) => o.key === 'pillar')?.p ?? null) === place0, 'the pillar\'s place as it was');
      check(await page.eval(`!document.querySelector('[data-part=tl-rule]')`), 'the strip is points now (no rule strip)');
      await shot('12-points');
      await page.eval(`document.activeElement?.blur()`);
      await undoKey();
      await sleep(800);
      check(!!(await spiral()), '⌘Z: the rule motion again');
      check(await page.eval(`!!document.querySelector('[data-part=tl-rule]')`), 'its strip again');
    }
  } finally {
    await browser.close();
    await srv.close();
  }
}

/** A game with no rule (Neon Run as it is): the card and the list as before — no Layout, no tag. */
async function plain(theme) {
  console.log(`${LANG} ${theme} ${WIDTH} plain`);
  const root = makeGame(theme, false);
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: WIDTH, height: PHONE ? 844 : 800, mobile: PHONE, cdnCache: process.env.STUDIO_CDN_CACHE });
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug`, 90000);
    await sleep(1200);
    await page.eval(`studioShell.actions.select('hex-2')`);
    await sleep(800);
    check(await page.eval(`!document.querySelector('[data-part=rule-layout]') && !document.querySelector('.rule-tag')`), 'no Layout on the card, no Rule tag in the list');
    check(await page.eval(`!!document.querySelector('[data-part=card] .f-cells.n3') || !!document.querySelector('[data-part=card]')`), 'the card as before');
    check(await page.eval(`!${GW}.document.querySelector('[data-studio-code-place]')`), 'no rings in the game');
  } finally {
    await browser.close();
    await srv.close();
  }
}

/**
 * ✦ Turn into a rule (studio-code-torule, 2026-10-24; the plan's flows 8 and 9, pictures n3-place / n3-motion): the hand
 * lamps and the ship's hand motion turned into rules by a stand-in AI (the request, then what SKILL.md says it does).
 */
async function toRule(theme) {
  console.log(`${LANG} ${theme} ${WIDTH} torule`);
  const root = makeGame(theme, 'torule');
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const T = LANG === 'ja'
    ? { btn: 'ルール化する', draft: '近いルールにして', compare: '元の配置と比べる', compareMotion: '元の動きと比べる', max: '最大のずれ: lamp-3（0.6 m）', menu: 'ルール化する…', lit: '最大のずれ', motion: '動きのルール' }
    : { btn: 'Turn into a rule', draft: 'Turn into a close rule', compare: 'Compare with original', compareMotion: 'Compare with original', max: 'Max deviation: lamp-3 (0.6 m)', menu: 'Turn into a rule…', lit: 'Max deviation', motion: 'Rule motion' };
  try {
    const page = await newPage(browser, { width: WIDTH, height: PHONE ? 844 : 800, mobile: PHONE, cdnCache: process.env.STUDIO_CDN_CACHE });
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `4-${LANG}-${theme}${PHONE ? '-phone' : ''}-${what}.png`), await page.screenshot());
    const ai = (ops) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
    const card = () => page.eval(`(() => { const f = document.querySelector('[data-part=card] details.fine'); if (f && !f.open) f.open = true; return document.querySelector('[data-part=card]')?.innerText ?? ''; })()`);
    const toast = () => page.eval(`[...document.querySelectorAll('.ai-line, .ask-news:not([hidden]), .toast.on')].map((e) => e.textContent).join(' | ')`);
    const marks = (sel) => page.eval(`${GW}.document.querySelector('[data-studio-code-place]')?.shadowRoot?.querySelectorAll(${JSON.stringify(sel)}).length ?? 0`);
    const chipText = () => page.eval(`(() => { const r = ${GW}.document.querySelector('[data-studio-code-place]')?.shadowRoot?.querySelector('[data-part=place-gap-chip]'); return r?.nextSibling?.textContent ?? ''; })()`);
    const shown = () => page.eval(`JSON.stringify(${GW}.__lamps.map((l) => l.visible))`);
    const lastRequest = () => {
      const dir = join(root, '.studio/requests');
      const f = readdirSync(dir).filter((x) => x.includes('-ask-')).sort().at(-1);
      return f ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null;
    };
    const undoKey = async () => {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
    };
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug`, 90000);
    await sleep(1500);
    const lamps = ['lamp-1', 'lamp-2', 'lamp-3', 'lamp-4', 'lamp-5', 'lamp-6'];

    // ---- 1. the six hand lamps picked: ✦ Turn into a rule on their card → the draft in the chat box ----
    await page.eval(`studioShell.actions.selectMany(${JSON.stringify(lamps)}, 'lamp-1')`);
    await sleep(900);
    check(await page.eval(`(document.querySelector('[data-part=to-rule]')?.textContent ?? '').includes(${JSON.stringify(T.btn)})`), `the card of the six has "✦ ${T.btn}"`);
    await shot('0-pick');
    await page.eval(`document.querySelector('[data-part=to-rule]').click()`);
    await sleep(500);
    const draft = await page.eval(`document.querySelector('.ask-input')?.value ?? ''`);
    check(draft === T.draft, `the draft in the chat box: "${draft}" (nothing sent yet)`);
    check(await page.eval(`document.activeElement?.classList.contains('ask-input')`), 'the cursor is in the chat box');
    await shot('1-draft');
    await page.eval(`document.querySelector('[data-part=ask]').requestSubmit()`);
    await sleep(1200);
    const req = lastRequest();
    check(req?.intent === 'to-code' && req?.objects?.length === 6 && req.objects.every((o) => o.pose?.p?.length === 3), `the request: intent to-code, 6 objects with where each stands (${JSON.stringify({ intent: req?.intent, n: req?.objects?.length })})`);
    check(req?.objects?.find((o) => o.key === 'lamp-3')?.pose?.p?.[0] === -6.6, 'lamp-3\'s place as it stands (x -6.6)');

    // ---- 2. the stand-in AI: the rule in the code, then one --do (SKILL.md "Turn into a rule") ----
    const html = readFileSync(join(root, 'index.html'), 'utf8').replace('    // @rules\n', TO_RULE);
    writeFileSync(join(root, 'index.html'), html);
    const r = await ai([{ do: 'place.code', id: 'lamp-row', replace: lamps }]);
    const said = r.results?.[0]?.said ?? r.results?.[0]?.error ?? JSON.stringify(r);
    check(/the largest gap is lamp-3 ↔ lamp-row-3, 0\.6 m \(6 of 6 compared\)/.test(said), `the AI's line has the editor's measure: "${said.slice(-90)}"`);
    await sleep(2500);
    check((await toast()).includes(T.max.replace(/^[^:]+: /, '')), `the line over the chat box: "${(await toast()).slice(0, 160)}"`);
    check((await shown()) === JSON.stringify([false, false, false, false, false, false]), `the hand lamps hidden (${await shown()})`);
    const handRows = () => page.eval(`document.querySelectorAll('.obj[data-key^="lamp-"]:not([data-key^="lamp-row"])').length`);
    check((await handRows()) === 0, `…and not in the list (${await handRows()} rows)`);
    const c2 = await card();
    check(c2.includes(T.compare) && c2.includes(T.max), `the card (lamp-row-3, the farthest): "${c2.replace(/\n/g, ' / ').slice(0, 160)}"`);
    check(await page.eval(`(document.querySelector('.card-head .key')?.textContent ?? '') + (document.querySelector('.card-head strong')?.textContent ?? '')`).then((x) => x.includes('3')), 'the card is the rule\'s 3rd lamp');
    check((await marks('[data-part=place-was]')) === 6, `six orange dots where they stood (${await marks('[data-part=place-was]')})`);
    check((await chipText()).startsWith('lamp-3 · 0.6'), `the chip over the farthest: "${await chipText()}"`);
    check(await page.eval(`JSON.stringify(${GW}[Symbol.for('game-studio.codePlaces')].get('lamp-row').objs.map((o) => o.position.z))`).then((x) => x === '[-6,-12,-18,-24,-30,-36]'), 'the rule put six lamps 6 m apart');
    await shot('2-place');

    // ---- 3. the switch hides the marks; on again ----
    await page.eval(`document.querySelector('[data-part=rule-compare-sw]').click()`);
    await sleep(500);
    check((await marks('[data-part=place-was]')) === 0, 'Compare off: no orange dots');
    await page.eval(`document.querySelector('[data-part=rule-compare-sw]').click()`);
    await sleep(500);
    check((await marks('[data-part=place-was]')) === 6, 'Compare on: the dots again');

    // ---- 4. ⌘Z: the hand lamps back, the comparison gone ----
    await page.eval(`document.activeElement?.blur()`);
    await undoKey();
    await sleep(2500);
    check((await shown()) === JSON.stringify([true, true, true, true, true, true]), `⌘Z: the hand lamps back (${await shown()})`);
    check((await handRows()) > 0, `…and in the list again (${await handRows()} rows)`);
    const p4 = (await ai([{ do: 'list' }])).results?.[0]?.list?.places?.find((p) => p.id === 'lamp-row');
    check(!p4?.from, `…and the layout no longer replaces them (${JSON.stringify(p4?.from ?? null)})`);
    await page.eval(`studioShell.actions.select('lamp-row-3')`);
    await sleep(700);
    check(!(await card()).includes(T.compare), 'no comparison on the card after ⌘Z');
    await shot('3-undo');
    // ⌘⇧Z: the swap again (and its comparison).
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 12, windowsVirtualKeyCode: 90 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 12, windowsVirtualKeyCode: 90 });
    await sleep(2500);
    await page.eval(`studioShell.actions.select('lamp-row-3')`);
    await sleep(700);
    check((await card()).includes(T.max), '⌘⇧Z: the swap and its comparison again');

    // ---- 5. the ship's motion: the row's ⋯ → Turn into a rule… → the stand-in AI's motion.code --replace ----
    await page.eval(`studioShell.actions.select('ship')`);
    await sleep(800);
    await card();
    await page.eval(`document.querySelector('[data-part=motion-more]')?.click()`);
    await sleep(400);
    const row = await page.eval(`document.querySelector('[data-part=context-menu]:not([hidden]) [data-action=ctx-motion-to-rule]')?.textContent ?? ''`);
    check(row.includes(T.menu), `the motion row's menu has "✦ ${T.menu}" ("${row}")`);
    await shot('4-menu');
    await page.eval(`document.querySelector('[data-action=ctx-motion-to-rule]').click()`);
    await sleep(500);
    check(await page.eval(`document.querySelector('.ask-input')?.value ?? ''`).then((x) => x === T.draft), 'the draft in the chat box');
    check(await page.eval(`document.querySelector('.ask-chip')?.textContent ?? ''`).then((x) => x.includes(SHIP_MOTION)), 'the chip names the ship\'s motion');
    await page.eval(`document.querySelector('[data-part=ask]').requestSubmit()`);
    await sleep(1200);
    const req2 = lastRequest();
    check(req2?.intent === 'to-code' && req2?.motions?.[0]?.name === SHIP_MOTION && req2.motions[0].keys?.p?.length === 9, `the request: intent to-code, the motion with its 9 points (${JSON.stringify({ intent: req2?.intent, m: req2?.motions?.[0]?.name, n: req2?.motions?.[0]?.keys?.p?.length })})`);
    const r2 = await ai([{ do: 'motion.code', code: 'ship-wave', name: SHIP_MOTION, replace: true }]);
    const said2 = r2.results?.[0]?.said ?? r2.results?.[0]?.error ?? '';
    check(/the largest gap is 0\.1\d? m at [\d.]+ s of a 2 s round/.test(said2), `the AI's line has the editor's measure: "${said2.slice(-90)}"`);
    await sleep(1500);
    // The timeline on the ship: the strip lit, the old points' marks on its edge, the comparison on the line.
    await page.eval(`studioShell.actions.select('ship')`);
    await sleep(600);
    await page.eval(`document.querySelector('[data-part=motion-timeline-line]')?.click()`);
    await page.waitFor(`!!document.querySelector('[data-part=tl-rule]')`, 15000);
    await sleep(900);
    check(await page.eval(`!!document.querySelector('.tl-rule.lit')`), 'the rule strip glows (the AI\'s change)');
    check(await page.eval(`document.querySelectorAll('[data-part=tl-rule-was]').length`).then((n) => n === 9), 'nine orange marks on its lower edge (the old points)');
    const line = await page.eval(`document.querySelector('[data-part=tl-compare]')?.textContent ?? ''`);
    check(line.includes(T.compareMotion) && line.includes(T.lit) && /0\.1 m/.test(line), `the line: "${line}"`);
    // PC: the line stays one row (a phone's line is two rows anyway: the switch keeps its size there).
    if (!PHONE) check(await page.eval(`!document.querySelector('.timeline.narrow')`), 'the line stays one row (the comparison is short of room before the line is)');
    else check(await page.eval(`document.querySelector('[data-part=tl-compare-sw]').getBoundingClientRect().height <= 16`), 'the phone\'s switch stays a switch (not a 40 px button)');
    const dots = await page.eval(`${GW}.document.querySelector('[data-studio-code-motion]')?.shadowRoot?.querySelectorAll('[data-part=tl-was-dot]').length ?? 0`);
    check(dots === 9, `orange dots of the old points in the game (${dots})`);
    check(await page.eval(`document.querySelector('[data-part=tl-rule-words]')?.textContent ?? ''`).then((x) => x.includes(T.motion)), 'the strip says it is a rule motion now (the same name)');
    await shot('5-motion');

    // ---- 6. Save: the comparison is gone (the AI takes the hand's shape out of the code now) ----
    await page.eval(`document.querySelector('[data-part=save]')?.click()`);
    await sleep(1800);
    check(await page.eval(`!document.querySelector('[data-part=tl-compare]') && !document.querySelector('.tl-rule.lit') && !document.querySelector('[data-part=tl-rule-was]')`), 'Save: no comparison on the timeline');
    await page.eval(`studioShell.actions.select('lamp-row-3')`);
    await sleep(700);
    check(!(await card()).includes(T.compare) && (await marks('[data-part=place-was]')) === 0, 'Save: none on the card, no orange dots');
    const saved = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
    check(JSON.stringify(saved.places?.['lamp-row']?.from) === JSON.stringify(lamps) && saved.motions?.find((m) => m.name === SHIP_MOTION)?.code === 'ship-wave',
      `placement.json: places.lamp-row.from = the six, the ship's motion a rule (${JSON.stringify({ from: saved.places?.['lamp-row']?.from, m: saved.motions?.map((m) => m.code ?? 'points') })})`);
    await shot('6-saved');
  } finally {
    await browser.close();
    await srv.close();
  }
}

/**
 * Step 3 (studio-code-keepout): a rule layout's keep-out areas — the card's list, a box drawn on the ground, a condition
 * added by the AI from the words, its ◇ and knob, on / off, ⌘Z, no place left, one put by hand inside, ×.
 */
async function keepout(theme) {
  console.log(`${LANG} ${theme} ${WIDTH} keepout`);
  const root = makeGame(theme, 'keepout');
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: WIDTH, height: PHONE ? 844 : 800, mobile: PHONE, cdnCache: process.env.STUDIO_CDN_CACHE });
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `3-${LANG}-${theme}${PHONE ? '-phone' : ''}-${what}.png`), await page.screenshot());
    const ai = (ops) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
    const crystal = async () => (await ai([{ do: 'list' }])).results?.[0]?.list?.places?.find((p) => p.id === 'crystal');
    const draft = async () => (await crystal())?.avoid ?? [];
    const card = () => page.eval(`(() => { const f = document.querySelector('[data-part=card] details.fine'); if (f && !f.open) f.open = true; return document.querySelector('[data-part=card]')?.innerText ?? ''; })()`);
    const fold = async () => (await page.eval(`(() => { const f = document.querySelector('[data-part=card] details.fine'); if (f && f.open && ${PHONE}) f.open = false; return 1; })()`), await sleep(300));
    const saveN = () => page.eval(`document.querySelector('[data-part=save]')?.textContent ?? ''`);
    const told = () => page.eval(`[...document.querySelectorAll('.ai-line, .ask-news:not([hidden]), .toast.on')].map((e) => e.textContent).join(' | ')`);
    const KO = `${GW}.document.querySelector('[data-studio-keep-out]')?.shadowRoot`;
    const koCount = (sel) => page.eval(`${KO}?.querySelectorAll(${JSON.stringify(sel)}).length ?? 0`);
    const koText = () => page.eval(`[...(${KO}?.querySelectorAll('text') ?? [])].map((t) => t.textContent).join(' | ')`);
    // Where the crystals stand now ([x, z] each) and which have no place.
    const spots = async () => JSON.parse(await page.eval(`JSON.stringify([...${GW}[Symbol.for('game-studio.codePlaces')].get('crystal').objs].map((o) => [Math.round(o.position.x * 100) / 100, Math.round(o.position.z * 100) / 100]))`));
    const skipped = async () => JSON.parse(await page.eval(`JSON.stringify(${GW}[Symbol.for('game-studio.codePlaces')].get('crystal').skipped)`));
    /** A ground point on the editor page's screen. */
    const scr = async (p) => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); const s = ${DBG}.toScreen(${JSON.stringify(p)}); return s ? JSON.stringify({ x: f.left + s[0], y: f.top + s[1] }) : 'null'; })()`));
    /** An element of the keep-out picture on the editor page's screen (its middle). */
    const koAt = async (sel) => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect(); const c = ${KO}?.querySelector(${JSON.stringify(sel)}); if (!c) return 'null'; const r = c.getBoundingClientRect(); return JSON.stringify({ x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2 }); })()`));
    const key = async (k, modifiers = 0, code = k) => {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
    };
    const undoKey = async () => (await page.eval(`document.activeElement?.blur()`), await key('z', 4, 'KeyZ'), await sleep(600));
    /** A drag in the game: a finger on a phone (one finger draws a box), the mouse elsewhere; `mid` = while still down. */
    const drag = async (a, b, mid = null) => {
      if (PHONE) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
        for (let i = 1; i <= 12; i++) (await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12, id: 1 }] }), await sleep(30));
        if (mid) await mid();
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
        for (let i = 1; i <= 12; i++) (await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12, button: 'left', buttons: 1 }), await sleep(30));
        if (mid) await mid();
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
      }
      await sleep(600);
    };
    const click = (part) => page.eval(`(() => { const b = document.querySelector('[data-part=card] [data-part=${part}]'); b?.click(); return !!b; })()`);
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug`, 90000);
    await sleep(1500);

    // ---- 1. press a crystal: Keep-out areas on the card ("On the road", Rule), the road painted in the game ----
    await page.eval(`studioShell.actions.select('crystal-1')`);
    await sleep(900);
    const c1 = await card();
    if (BEFORE) {
      await shot('0-before');
      check(true, `before: "${c1.replace(/\n/g, ' / ').slice(0, 100)}"`);
      return;
    }
    check(c1.includes(W3.title) && c1.includes(W3.road) && c1.includes(W3.rule), `the card's keep-out list: "${c1.replace(/\n/g, ' / ').slice(0, 160)}"`);
    const start = await spots();
    check(start.length === 12 && start.every(([x]) => Math.abs(x) >= 5), `12 crystals, none on the road (${JSON.stringify(start)})`);
    await page.waitFor(`(${KO}?.querySelectorAll('path[fill="url(#ko-hatch)"]').length ?? 0) > 0`, 6000).catch(() => null);
    check((await koCount('path[fill="url(#ko-hatch)"]')) > 0 && (await koText()).includes(W3.road), `the road painted in the game ("${(await koText()).slice(0, 60)}", ${await koCount('path[fill="url(#ko-hatch)"]')} pieces)`);
    await shot('1-road');

    // ---- 2. + Draw a box round the two nearest crystals on the left: they step out (one ⌘Z, Save · 1) ----
    check(await click('ko-draw'), 'the "+ Draw a box" button');
    await sleep(500);
    check((await koText()).length > 0 && (await page.eval(`document.querySelector('[data-part=ko-draw]')?.getAttribute('aria-pressed')`)) === 'true', `drawing: the button on, the hint in the game ("${(await koText()).slice(-60)}")`);
    await fold();
    // The crystals the game shows (well inside its frame: the list and the card sit over its sides), nearest the camera first.
    const frame = JSON.parse(await page.eval(`JSON.stringify(document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect())`));
    const seen = async (q) => {
      const s = await scr([q[0], 0, q[1]]);
      return !!s && s.x > frame.left + 40 && s.x < frame.left + frame.width * (PHONE ? 0.9 : 0.62) && s.y > frame.top + 60 && s.y < frame.top + frame.height * (PHONE ? 0.5 : 0.8);
    };
    const left = [];
    for (const q of start.filter(([x]) => x < -5).sort((a, b) => b[1] - a[1])) if (await seen([q[0] - 1, q[1] + 1]) && (await seen([q[0] + 1, q[1] - 1]))) left.push(q);
    const a1 = left[0] ?? start[0], a2 = left.slice(1).sort((p, q) => Math.hypot(p[0] - a1[0], p[1] - a1[1]) - Math.hypot(q[0] - a1[0], q[1] - a1[1]))[0];
    const inBox = [a1, ...(a2 && Math.hypot(a2[0] - a1[0], a2[1] - a1[1]) < 7 ? [a2] : [])];
    const bx = [Math.min(...inBox.map((q) => q[0])) - 1, Math.max(...inBox.map((q) => q[0])) + 1], bz = [Math.min(...inBox.map((q) => q[1])) - 1, Math.max(...inBox.map((q) => q[1])) + 1];
    const A = await scr([bx[0], 0, bz[1]]), Bp = await scr([bx[1], 0, bz[0]]);
    check(!!A && !!Bp, `the box's corners on screen (${JSON.stringify([A, Bp])})`);
    if (A && Bp) await drag(A, Bp, () => shot('2-drawing'));
    const after = await spots();
    const inside = (q) => q[0] > bx[0] + 0.3 && q[0] < bx[1] - 0.3 && q[1] > bz[0] + 0.3 && q[1] < bz[1] - 0.3;
    check(after.every((q) => !inside(q)), `no crystal left in the box (x ${bx.map((v) => v.toFixed(1))}, z ${bz.map((v) => v.toFixed(1))}): ${JSON.stringify(after)}`);
    const d2 = await draft();
    check(d2.some((x) => x.box && x.name === W3.box), `the draft: ${JSON.stringify(d2)}`);
    check((await told()).includes(W3.out), `the line: "${(await told()).slice(0, 120)}"`);
    check(/1/.test(await saveN()), `Save · 1 ("${await saveN()}")`);
    check((await card()).includes(W3.box) && (await card()).includes(W3.hand), 'the card lists the box (Hand)');
    await shot('2-box');

    // ---- 3. ✦ Describe with text: the chips, the request; the AI adds "From the player": its row glows, a circle with a ◇ ----
    check(await click('ko-describe'), 'the "✦ Describe with text" button');
    await sleep(500);
    const chips = await page.eval(`[...document.querySelectorAll('[data-part=ask] .ask-chip:not([hidden])')].map((e) => e.textContent).join(' + ')`);
    check(chips.includes(`${W3.crystal} ×12`) && chips.includes(W3.chip), `the ask chips: "${chips}"`);
    await page.eval(`(() => { const i = document.querySelector('[data-part=ask] .ask-input'); i.value = ${JSON.stringify(W3.ask)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await shot('3-ask');
    await page.eval(`document.querySelector('[data-part=ask]').requestSubmit()`);
    await sleep(1200);
    const reqDir = join(root, '.studio/requests');
    const reqs = (() => { try { return readdirSync(reqDir).filter((f) => f.endsWith('.json')).sort(); } catch { return []; } })();
    const req = reqs.length ? JSON.parse(readFileSync(join(reqDir, reqs[reqs.length - 1]), 'utf8')) : null;
    check(req?.intent === 'avoid' && req?.places?.[0]?.id === 'crystal' && req.places[0].avoid?.length === 2, `the request: intent ${req?.intent}, places ${JSON.stringify(req?.places)?.slice(0, 160)}`);
    const r3 = await ai([{ do: 'place.avoid', id: 'crystal', code: 'near-player' }]);
    check(r3.results?.[0]?.ok, `the AI's place.avoid: ${JSON.stringify(r3.results?.[0])}`);
    await sleep(500);
    await card();
    check(await page.eval(`!!document.querySelector('[data-part=ko-row].lit[data-row="code:near-player"]')`), 'its row glows violet');
    check((await card()).includes(W3.near), 'the card lists it');
    const nearNow = (await spots()).filter(([x, z]) => Math.hypot(x, z + 4) < 5);
    check(!nearNow.length, `no crystal within 5 m of the player's start (${JSON.stringify(nearNow)})`);
    check((await koCount('[data-ko-knob]')) === 1, 'its ◇ on the circle');
    await shot('3-arrived');

    // ---- 4. the ◇ dragged out, then 6 m typed: the circle grows, the crystals near it step out ----
    await fold();
    // A phone's sheet shrinks after "…" folds: the ◇ is pressed once nothing of the editor covers it.
    const free = async (q) => q && (await page.waitFor(`document.elementFromPoint(${q.x}, ${q.y})?.matches?.('iframe.game')`, 4000).catch(() => false));
    await free(await koAt('[data-ko-knob]'));
    const dia = await koAt('[data-ko-knob]');
    const mid = await scr([0, 0, -4]);
    // Outward (a bigger circle) — or inward when outward leaves the game's frame (a phone's camera is close).
    const out4 = dia && mid ? { x: dia.x + (dia.x - mid.x) * 0.25, y: dia.y + (dia.y - mid.y) * 0.25 } : null;
    const fr4 = JSON.parse(await page.eval(`JSON.stringify(document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect())`));
    const fits = out4 && out4.x > fr4.left + 10 && out4.x < fr4.right - 10 && out4.y > fr4.top + 10 && out4.y < fr4.bottom - 10;
    check(!!dia, `the ◇ is on screen (${JSON.stringify(dia)})`);
    if (dia && mid) await drag(dia, fits ? out4 : { x: dia.x - (dia.x - mid.x) * 0.2, y: dia.y - (dia.y - mid.y) * 0.2 }, () => shot('4-diamond'));
    const r4 = (await draft()).find((x) => x.code === 'near-player')?.knobs?.r?.v;
    check(typeof r4 === 'number' && (fits ? r4 > 5 : r4 < 5), `the ◇ turned Distance: 5 → ${r4} (${fits ? 'out' : 'in'})`);
    await card();
    await page.eval(`document.querySelector('[data-part=ko-knob-near-player-r]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await sleep(200);
    await page.eval(`(() => { const f = document.querySelector('[data-part=ko-knob-near-player-r-in]'); f.value = '6'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await sleep(900);
    const k6 = (await draft()).find((x) => x.code === 'near-player')?.knobs?.r;
    check(k6?.v === 6, `Distance 6 m (${JSON.stringify(k6)})`);
    const near6 = (await spots()).filter(([x, z]) => Math.hypot(x, z + 4) < 6);
    check(!near6.length, `no crystal within 6 m (${JSON.stringify(near6)})`);
    await shot('4-6m');

    // ---- 5. Save: the file has the box and the condition ({ v: 6, was: 5 }) ----
    await page.eval(`document.querySelector('[data-part=save]')?.click()`);
    await sleep(1500);
    const saved = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
    const av = saved.places?.crystal?.avoid ?? [];
    check(av.length === 2 && av[0].box && av[0].name === W3.box && av[1].code === 'near-player' && av[1].knobs?.r?.v === 6 && av[1].knobs.r.was === 5, `placement.json places.crystal.avoid: ${JSON.stringify(av)}`);

    // ---- 6. "On the road" off: { code: 'road', off: true }, crystals may stand on the road; ⌘Z: back on ----
    await card();
    await page.eval(`document.querySelector('[data-part=ko-row][data-row="code:road"] [data-part=ko-sw]').click()`);
    await sleep(900);
    check((await draft()).some((x) => x.code === 'road' && x.off), `off: ${JSON.stringify(await draft())}`);
    check((await spots()).some(([x]) => Math.abs(x) < 5), `some crystal on the road now (${JSON.stringify(await spots())})`);
    check(!(await koText()).includes(W3.road), 'the road no longer painted');
    await shot('5-off');
    await undoKey();
    check(!(await draft()).some((x) => x.code === 'road' && x.off) && (await spots()).every(([x]) => Math.abs(x) >= 5), '⌘Z: "On the road" on again, none on the road');

    // ---- 7. ⌘Z ×4 (6 m typed, the ◇, the AI's condition, the box): as at the start ----
    for (let i = 0; i < 4; i++) await undoKey();
    check(!(await draft()).some((x) => x.box || x.code === 'near-player'), `⌘Z ×4: no box, no condition (${JSON.stringify(await draft())})`);
    check(JSON.stringify(await spots()) === JSON.stringify(start), 'the crystals where they were at the start');

    // ---- 8. a box that leaves almost no room (the AI's): "N of 12 have no place to go", × where they would go ----
    await ai([{ do: 'place.avoid', id: 'crystal', box: { p: [0, 0, -14], size: [26, 10, 34] } }]);
    await sleep(900);
    const sk = await skipped();
    const keys8 = (await crystal())?.keys ?? [];
    check(sk.length > 0 && keys8.length > 0, `some have no place (${sk.length}), some do (${keys8.length})`);
    if (keys8[0]) await page.eval(`studioShell.actions.select(${JSON.stringify(keys8[0])})`);
    await sleep(800);
    const c8 = await card();
    check(c8.includes(W3.skipped) && c8.includes(String(sk.length)), `the line: "${c8.split('\n').find((l) => l.includes(W3.skipped))}"`);
    check((await koCount('path[stroke="#ff453a"]')) >= 2, `× in the game (${(await koCount('path[stroke="#ff453a"]')) / 2})`);
    await shot('6-skipped');
    await undoKey();
    check(!(await skipped()).length, '⌘Z: every crystal has a place again');

    // ---- 9. one put by hand on the road: "Manually overridden" and "Inside a keep-out area" (it stays) ----
    await ai([{ do: 'place.set', id: 'crystal', pin: { key: 'crystal-2', p: [0, 1.1, -10] } }]);
    await page.eval(`studioShell.actions.select('crystal-2')`);
    await sleep(900);
    const c9 = await card();
    check(c9.includes(W3.inside), `the card: "${c9.replace(/\n/g, ' / ').slice(0, 120)}"`);
    check((await spots()).some(([x, z]) => x === 0 && z === -10), 'it stays on the road (the hand wins)');
    await shot('7-inside');
    await undoKey();

    // ---- 10. × on a row: a box the AI drew, taken out (one ⌘Z) ----
    await page.eval(`studioShell.actions.select('crystal-1')`);
    await ai([{ do: 'place.avoid', id: 'crystal', box: { p: [8, 0, -10], size: [3, 4, 3] } }]);
    await sleep(600);
    await card();
    const rows = () => page.eval(`document.querySelectorAll('[data-part=ko-row]').length`);
    const n10 = await rows();
    await page.eval(`document.querySelector('[data-part=ko-row] [data-part=ko-x]')?.click()`);
    await sleep(600);
    await card();
    check((await rows()) === n10 - 1 && !(await draft()).some((x) => x.box), `× took the box out (${n10} → ${await rows()} rows)`);
  } finally {
    await browser.close();
    await srv.close();
  }
}

/**
 * To coords (studio-to-coords, 2026-10-24): a first-time maker drags one lamp of each row forward / back, left / right
 * and up / down — never "nothing happened" without a word, never a lamp silently out of its row (see the top).
 */
async function toCoords(theme) {
  console.log(`${LANG} ${theme} ${WIDTH} coords`);
  const root = makeGame(theme, 'coords');
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  const C = LANG === 'ja'
    ? { note: '動かすと間が変わる', noteWay: '動かすと間・道からの距離が変わる', side: '横の位置はルールで決まっています', up: '高さはルールで決まっています', turn: '向きはルールで決まっています',
      heldSide: '街灯の横の位置はルールで決まっています · ⌥+ドラッグでこの 1 個だけ', ask: '✦', draft: '街灯を横にも動かせるようにして', pinned: '街灯 3 だけ手で置きました', reset: 'ルールに戻す',
      hand: '手置き', keys: '街灯はルールで並んでいます', group: '街灯はルールで並んでいるので、まとめては動きません', gap: '間' }
    : { note: 'Drag to adjust Gap', noteWay: 'Drag to adjust Gap, From the road ·', side: 'Sideways position is set by the rule', up: 'Height is set by the rule', turn: 'Angle is set by the rule',
      heldSide: 'Street lamps: sideways position is set by the rule · ⌥-drag to move just this one', ask: '✦', draft: 'Let me move Street lamps sideways too', pinned: 'Placed Street lamps 3 by hand (just this one)', reset: 'Reset to rule',
      hand: 'Hand-placed', keys: 'Street lamps is laid out by a rule', group: 'Street lamps is laid out by a rule, so it doesn’t move as a group', gap: 'Gap' };
  try {
    const page = await newPage(browser, { width: WIDTH, height: PHONE ? 844 : 800, mobile: PHONE, cdnCache: process.env.STUDIO_CDN_CACHE });
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `c-${LANG}-${theme}${PHONE ? '-phone' : ''}-${what}.png`), await page.screenshot());
    const ai = (ops) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
    const place = async (id) => (await ai([{ do: 'list' }])).results?.[0]?.list?.places?.find((p) => p.id === id);
    const rows = (id) => page.eval(`JSON.stringify([...${GW}[Symbol.for('game-studio.codePlaces')].get(${JSON.stringify(id)}).objs].map((o) => [o.position.x, o.position.y, o.position.z, o.rotation.y].map((v) => Math.round(v * 100) / 100)))`).then((x) => JSON.parse(x));
    const at = async (key) => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)'); const r = f.getBoundingClientRect();
      const a = ${DBG}.anchor(${JSON.stringify(key)}); return a ? JSON.stringify({ x: r.left + a.center[0], y: r.top + a.center[1] }) : 'null'; })()`));
    const card = () => page.eval(`(() => { const f = document.querySelector('[data-part=card] details.fine'); if (f && !f.open) f.open = true; return document.querySelector('[data-part=card]')?.innerText ?? ''; })()`);
    const fold = async () => (await page.eval(`(() => { const f = document.querySelector('[data-part=card] details.fine'); if (f && f.open && ${PHONE}) f.open = false; return 1; })()`), await sleep(300));
    const inUi = (cls) => page.eval(`(() => { const h = [...${GW}.document.querySelectorAll('[data-studio-ui]')].map((x) => x.shadowRoot?.querySelector(${JSON.stringify(cls)})).find((n) => n && n.style.display !== 'none'); return h ? h.textContent : ''; })()`);
    const toast = () => page.eval(`document.querySelector('.toast.on')?.textContent ?? ''`);
    const toastActs = () => page.eval(`JSON.stringify([...document.querySelectorAll('.toast.on [data-part=toast-act]')].map((b) => b.textContent))`).then((x) => JSON.parse(x));
    const strip = async (k) => JSON.parse(await page.eval(`(() => { const f = document.querySelector('iframe.game:not(.leaving)').getBoundingClientRect();
      const b = [...${GW}.document.querySelectorAll('[data-studio-ui]')].map((x) => x.shadowRoot?.querySelector('[data-studio-handle=${k}]')).find(Boolean);
      if (!b || !b.getBoundingClientRect().width) return 'null'; const r = b.getBoundingClientRect(); return JSON.stringify({ x: f.left + r.left + r.width / 2, y: f.top + r.top + r.height / 2 }); })()`));
    /** No lamp of either row by hand, and none an object of its own (the CRYSTAL FIELD file had two pins). */
    const noneOut = async (what) => {
      const a = await place('lamp-row'), b = await place('lamp-way');
      const objs = (await ai([{ do: 'list' }])).results?.[0]?.list?.objects ?? [];
      check(!a?.pins?.length && !b?.pins?.length && !a?.hand && !b?.hand, `${what}: no lamp out of its row (pins ${JSON.stringify([a?.pins ?? [], b?.pins ?? []])})`);
      void objs;
    };
    /** A mouse drag with modifiers (1 = ⌥); `mid` runs before the release. The press must land on the game (not the card). */
    const drag = async (a, b, modifiers = 0, mid = null) => {
      check(await page.eval(`document.elementFromPoint(${a.x}, ${a.y})?.tagName === 'IFRAME'`), `the press at ${Math.round(a.x)},${Math.round(a.y)} is on the game`);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, modifiers });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
      for (let i = 1; i <= 12; i++) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12, button: 'left', buttons: 1, modifiers });
        await sleep(30);
      }
      if (mid) await mid();
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
      await sleep(600);
    };
    const pick = async (key) => {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      await page.eval(`studioShell.actions.select(${JSON.stringify(key)})`);
      await sleep(800);
      await fold();
    };
    const blurAsk = () => page.eval(`(() => { const i = document.querySelector('.ask-input'); if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); } document.activeElement?.blur?.(); return 1; })()`);
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${GW}?.__gameStudio?._debug && !!${GW}[Symbol.for('game-studio.codePlaces')]?.get('lamp-way')?.objs?.length`, 90000);
    await sleep(1500);

    // ---- 1. the left row (CRYSTAL FIELD's): before a touch, the line says what a drag does ----
    await pick('lamp-row-3');
    check((await inUi('.note')).includes(C.note), `the line under the strip: "${await inUi('.note')}"`);
    const r0 = await rows('lamp-row');
    await shot('1-pick');

    // ---- 2. forward / back (toward lamp 2): every gap follows ----
    let a3 = await at('lamp-row-3');
    const a2 = await at('lamp-row-2');
    let chip = '';
    await drag(a3, { x: a3.x + (a2.x - a3.x) * 0.4, y: a3.y + (a2.y - a3.y) * 0.4 }, 0, async () => (chip = await inUi('.chip')));
    const g2 = (await place('lamp-row'))?.knobs?.gap?.v;
    const r2 = await rows('lamp-row');
    check(typeof g2 === 'number' && g2 < 8, `forward: the gap 8 → ${g2} (chip "${chip}")`);
    check(r2.every((q, i) => Math.abs(q[2] - (-6 - i * g2)) < 0.02 && q[0] === -5.6), `every lamp on the rule with it (${JSON.stringify(r2.map((q) => q[2]))})`);
    await noneOut('forward');
    await shot('2-forward');

    // ---- 3. left / right (away from the road): nothing moves, and it says why (while dragging, then the line with ✦) ----
    a3 = await at('lamp-row-3');
    await drag(a3, { x: a3.x - 160, y: a3.y }, 0, async () => {
      chip = await inUi('.chip');
      await shot('3-side-chip');
    });
    const r3 = await rows('lamp-row');
    check(JSON.stringify(r3) === JSON.stringify(r2), `sideways: every lamp where it was (${JSON.stringify(r3.map((q) => q[0]))})`);
    check(chip.includes(C.side), `while dragging, the chip says why: "${chip}"`);
    check((await toast()).includes(C.heldSide), `after, the line says it again: "${await toast()}"`);
    const acts = await toastActs();
    check(acts.length === 1 && acts[0].startsWith(C.ask) && acts[0].includes(C.draft), `…with ✦: ${JSON.stringify(acts)}`);
    await noneOut('sideways');
    await shot('3-side-told');
    await page.eval(`document.querySelector('.toast.on [data-part=toast-act]')?.click()`);
    await sleep(400);
    check((await page.eval(`document.querySelector('.ask-input')?.value ?? ''`)) === C.draft, `✦: the draft in the chat box ("${await page.eval(`document.querySelector('.ask-input')?.value ?? ''`)}"), nothing sent`);
    await shot('3-side-ask');
    await blurAsk();

    // ---- 4. up / down (Height) and a turn (Turn): nothing moves, why ----
    await pick('lamp-row-3');
    for (const [tool, want, dy, dx] of [['lift', C.up, -110, 0], ['rotate', C.turn, 0, 120]]) {
      const b = await strip(tool);
      check(!!b, `the strip has ${tool}`);
      if (!b) continue;
      const before = await rows('lamp-row');
      await drag(b, { x: b.x + dx, y: b.y + dy }, 0, async () => {
        chip = await inUi('.chip');
        if (tool === 'lift') await shot('4-up-chip');
      });
      check(JSON.stringify(await rows('lamp-row')) === JSON.stringify(before), `${tool}: every lamp where it was`);
      check(chip.includes(want), `${tool}: the chip "${chip}"`);
      check((await toast()).includes(want.replace(/^./, (c) => c.toLowerCase())) || (await toast()).includes(want), `${tool}: the line "${await toast()}"`);
      await noneOut(tool);
    }

    // ---- 5. ⌥ + Height: just that one by hand — told, marked, and Reset to rule puts it back ----
    const lift = await strip('lift');
    await drag(lift, { x: lift.x, y: lift.y - 110 }, 1);
    const p5 = await place('lamp-row');
    const r5 = await rows('lamp-row');
    check(p5?.pins?.length === 1 && p5.pins[0] === 'lamp-row-3', `⌥: lamp 3 by hand (pins ${JSON.stringify(p5?.pins)})`);
    check(r5[2][1] > 0.3 && r5.filter((_, i) => i !== 2).every((q) => q[1] === 0), `…it alone went up (${JSON.stringify(r5.map((q) => q[1]))})`);
    check((await toast()).includes(C.pinned), `told: "${await toast()}"`);
    check((await toastActs()).includes(C.reset), `…with ${C.reset}: ${JSON.stringify(await toastActs())}`);
    const c5 = await card();
    check(c5.includes(C.hand) && c5.includes(C.reset), `the card marks it: "${c5.replace(/\n/g, ' / ').slice(0, 100)}"`);
    const listMark = await page.eval(`document.querySelectorAll('[data-part=list-hand-tag]').length`);
    check(listMark >= 1, `the list marks it too (${listMark})`);
    await shot('5-alone');
    await page.eval(`[...document.querySelectorAll('.toast.on [data-part=toast-act]')].find((b) => b.textContent === ${JSON.stringify(C.reset)})?.click()`);
    await sleep(900);
    check(!(await place('lamp-row'))?.pins?.length && (await rows('lamp-row'))[2][1] === 0, 'Reset to rule: back in its row');

    // ---- 6. an arrow key, and the whole row dragged together: the rule keeps them ----
    await pick('lamp-row-2');
    const r6 = await rows('lamp-row');
    await page.eval(`document.activeElement?.blur?.()`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await sleep(700);
    check(JSON.stringify(await rows('lamp-row')) === JSON.stringify(r6), 'an arrow key: every lamp where it was');
    check((await toast()).includes(C.keys), `…and why: "${await toast()}"`);
    await page.eval(`studioShell.actions.selectMany(${JSON.stringify(['lamp-row-1', 'lamp-row-2', 'lamp-row-3', 'lamp-row-4', 'lamp-row-5'])}, 'lamp-row-3')`);
    await sleep(800);
    await fold();
    const g6 = await at('lamp-row-3');
    await drag(g6, { x: g6.x + 120, y: g6.y + 30 });
    check(JSON.stringify(await rows('lamp-row')) === JSON.stringify(r6), 'the whole row dragged: every lamp where it was');
    check((await toast()).includes(C.group), `…and why: "${await toast()}"`);
    await noneOut('keys and the group');
    await shot('6-group');

    // ---- 7. the right row (a knob for each way): sideways = From the road, Height = its height, for all of them ----
    await pick('lamp-way-3');
    check((await inUi('.note')).includes(C.noteWay), `the line (Move's two knobs): "${await inUi('.note')}"`);
    let w3 = await at('lamp-way-3');
    await drag(w3, { x: w3.x + 50, y: w3.y }, 0, async () => {
      chip = await inUi('.chip');
      await shot('7-side-chip');
    });
    const sd = (await place('lamp-way'))?.knobs?.side?.v;
    const rw = await rows('lamp-way');
    check(typeof sd === 'number' && sd > 5.6, `sideways: From the road 5.6 → ${sd} (chip "${chip}")`);
    check(rw.every((q) => Math.abs(q[0] - sd) < 0.02), `every lamp of the row with it (${JSON.stringify(rw.map((q) => q[0]))})`);
    check(!(await toast()).includes(C.side), 'no "set by the rule": it followed');
    const lw = await strip('lift');
    await drag(lw, { x: lw.x, y: lw.y - 90 }, 0, async () => (chip = await inUi('.chip')));
    const hv = (await place('lamp-way'))?.knobs?.h?.v;
    const rh = await rows('lamp-way');
    check(typeof hv === 'number' && hv > 0.2 && rh.every((q) => Math.abs(q[1] - hv) < 0.02), `Height: every lamp up ${hv} (${JSON.stringify(rh.map((q) => q[1]))}; chip "${chip}")`);
    w3 = await at('lamp-way-3');
    const w2 = await at('lamp-way-2');
    await drag(w3, { x: w3.x + (w2.x - w3.x) * 0.4, y: w3.y + (w2.y - w3.y) * 0.4 });
    check(((await place('lamp-way'))?.knobs?.gap?.v ?? 8) < 8, `forward: its gap ${(await place('lamp-way'))?.knobs?.gap?.v}`);
    await noneOut('the right row');
    await shot('7-way');

    // ---- 8. Save: knobs only — no pin, no lamp an object of its own ----
    await page.eval(`document.querySelector('[data-part=save]')?.click()`);
    await sleep(1500);
    const saved = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
    check(!Object.keys(saved.objects ?? {}).some((k) => k.startsWith('lamp-')) && !saved.places?.['lamp-row']?.pins && !saved.places?.['lamp-way']?.pins,
      `placement.json: knobs only (${JSON.stringify(saved.places)})`);
  } finally {
    await browser.close();
    await srv.close();
  }
}

for (const [i, theme] of THEMES.entries()) {
  if (ONLY.includes('layout') || ONLY.includes('motion')) await run(theme, i === 0);
  if (i === 0 && ONLY.includes('plain')) await plain(theme);
  if (ONLY.includes('keepout')) await keepout(theme);
  if (i === 0 && ONLY.includes('torule')) await toRule(theme);
  if (i === 0 && ONLY.includes('coords')) await toCoords(theme);
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
