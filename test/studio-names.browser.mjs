// Names for objects without one, and the ask bar's chip (a hands-on try, 2026-10-19, item 3 and "the object's
// name in the chat box is in the way"). An AI-written runner: pillars made as `new THREE.Group()` of a black box and a
// pink lid, flowing toward the camera every frame, a road, a sky dome, a player box, no names. The card and the ask
// chip both read "Unnamed group" (in Japanese), the thumbnail was a black box with a pink lid nobody read as a
// pillar, and the chip took half the ask field.
//
// With the real server and the built editor, in Japanese (the language of that try), at PC 1280×800 (mouse), the side window
// next to a chat 400×900 (mouse) and a phone 390×844 (touch):
//   1. every unnamed object gets a name a person can read, from its shape, colour, size and place: the pillars read
//      "Black pillar by the road (left, 3rd)" (side and count; checked in Japanese), the road "Road", the sky "Sky",
//      the player "Blue box"; no two the same; no "group" word (either language) anywhere on screen; no `path:` key
//   2. the card of an unnamed object says in one line what a name is good for, with "Ask your AI to name it"; the
//      press keeps one `name` request about it, the guessed name sent along as a hint
//   3. the ask chip stays small: at most a third of the ask box (and ≤ 168 px), one line, the whole name in its
//      tooltip; several picked = a count; the field keeps at least half the box
//   4. the picked object is marked strongly in the game (the selection layer draws), and a mouse over its row in the
//      list, or over the card, lights it in the game (the hover layer draws; off again when the mouse leaves)
//
//   node test/studio-names.browser.mjs [--shots <dir>] [--before] [--game <index.html>] [--only pc,side,phone] [--lang ja|en]
// --before: photos only (the build before this change), no checks. --game: another game file (the AI-made one).
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const BEFORE = args.includes('--before');
const LANG = opt('--lang') || 'ja';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What an AI wrote for "a three.js runner, unnamed Group pillars flowing toward the camera, a road, a sky" (claude -p,
// 2026-10-19), cut down: the same objects in the same order, the same shapes and colours.
const RUNNER = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Runner</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}canvas{display:block}</style>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js" } }</script>
</head><body><script type="module">
import * as THREE from 'three';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 40, 140);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 4, 8);
camera.lookAt(0, 1, -10);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(5, 10, 5); scene.add(sun);
const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.MeshBasicMaterial({ color: 0x87ceeb, side: THREE.BackSide, fog: false }));
scene.add(sky);
const road = new THREE.Mesh(new THREE.PlaneGeometry(14, 400), new THREE.MeshStandardMaterial({ color: 0x808080 }));
road.rotation.x = -Math.PI / 2; road.position.z = -150; scene.add(road);
const bodyGeo = new THREE.BoxGeometry(1, 3, 1), bodyMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
const capGeo = new THREE.BoxGeometry(1.3, 0.2, 1.3), capMat = new THREE.MeshStandardMaterial({ color: 0xff69b4 });
const pillars = [];
for (let i = 0; i < 20; i++) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, bodyMat); body.position.y = 1.5;
  const cap = new THREE.Mesh(capGeo, capMat); cap.position.y = 3.1;
  g.add(body, cap);
  // (The AI's game picks the side at random; fixed here so the test reads the same every run.)
  g.position.set(i % 3 === 1 ? 5.5 : -5.5, 0, -i * 8);
  scene.add(g); pillars.push(g);
}
const player = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3399ff }));
player.position.set(0, 0.5, 2); scene.add(player);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const p of pillars) { p.position.z += 20 * dt; if (p.position.z > camera.position.z + 2) p.position.z -= 160; }
  renderer.render(scene, camera);
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
</script></body></html>`;

const SIZES = [
  { id: 'pc', w: 1280, h: 800, touch: false },
  { id: 'side', w: 400, h: 900, touch: false },
  { id: 'phone', w: 390, h: 844, touch: true },
].filter((s) => !opt('--only') || opt('--only').split(',').includes(s.id));
const WIN = `document.querySelector('iframe').contentWindow`;
const READY = `document.querySelectorAll('.obj, .noname:not([hidden])').length > 0 && !!${WIN}.__gameStudio?._debug`;
// Everything a person can read: text, and the words shown on hover or read aloud.
const SHOWN = `(() => {
  const words = [document.body.innerText];
  for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) words.push(el.getAttribute('title') || '', el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '');
  return words.join('\\n');
})()`;
// How much the editor draws in a layer of the game page's overlay (the canvas ring, or boxes): >0 = something shows.
const LAYER = (cls) => `(() => { for (const host of ${WIN}.document.querySelectorAll('[data-studio-ui]')) {
  const l = host.shadowRoot && host.shadowRoot.querySelector('.layer.${cls}'); if (!l) continue;
  if (getComputedStyle(l).display === 'none' || getComputedStyle(l).opacity === '0') return 0;
  let n = 0; for (const c of l.children) { const r = c.getBoundingClientRect(); if (r.width > 0 && r.height > 0) n++; } return n; } return -1; })()`;
const requests = (root) => {
  const dir = join(root, '.studio/requests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')));
};

let failed = 0;
for (const sz of SIZES) {
  const tag = `${sz.id}-${sz.w}x${sz.h}`;
  const root = mkdtempSync(join(tmpdir(), 'studio-names-'));
  writeFileSync(join(root, 'index.html'), opt('--game') ? readFileSync(resolve(opt('--game')), 'utf8') : RUNNER);
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, { width: sz.w, height: sz.h, mobile: sz.touch });
  const shot = async (name) => SHOTS && writeFileSync(join(SHOTS, `${BEFORE ? 'before' : 'after'}-${tag}-${name}.png`), await page.screenshot());
  try {
    await page.goto(srv.url);
    await page.waitFor(READY, 30000);
    await sleep(1200);
    const items = JSON.parse(await page.eval(`JSON.stringify(studioShell.items().map((i) => ({ key: i.key, kinds: i.kinds, group: i.group })))`));
    // The pillars: the group shared by the most objects.
    const byGroup = new Map();
    for (const it of items) byGroup.set(it.group, [...(byGroup.get(it.group) || []), it.key]);
    const pillars = [...byGroup.values()].sort((a, b) => b.length - a.length)[0];
    const pick = pillars[2];
    // Narrow screens: open the list sheet first (the card sits over it).
    if (sz.id !== 'pc') await page.eval(`document.querySelector('[data-action=sheet]')?.click()`), await sleep(700);
    await page.eval(`studioShell.actions.select(${JSON.stringify(pick)})`);
    await page.waitFor(`studioShell.selected() === ${JSON.stringify(pick)}`, 3000);
    await sleep(1200);
    await shot('1-picked');
    // The card: what it is, then (grey, second line) which one.
    const card = await page.eval(`[document.querySelector('.card strong')?.textContent || '', document.querySelector('.card .head-text .key')?.textContent || ''].join('|')`);
    const chip = JSON.parse(await page.eval(`(() => { const c = document.querySelector('.ask-chip'), b = document.querySelector('.ask-box'), i = document.querySelector('.ask-input');
      const r = c.getBoundingClientRect(), rb = b.getBoundingClientRect(), ri = i.getBoundingClientRect();
      return JSON.stringify({ text: c.innerText, title: c.title, hidden: c.hidden || r.width === 0, w: r.width, h: r.height, box: rb.width, field: ri.width, lineH: parseFloat(getComputedStyle(c).lineHeight) || 16 }); })()`));
    console.log(`  ${tag}: card "${card}" · chip "${chip.text}" ${Math.round(chip.w)}px of a ${Math.round(chip.box)}px box (field ${Math.round(chip.field)}px)`);
    if (BEFORE) {
      if (!sz.touch) {
        // The same hover as the after photos (nothing lights before this change).
        const row = JSON.parse(await page.eval(`(() => { const rows = [...document.querySelectorAll('.objects .obj')].filter((e) => e.offsetParent && !e.matches('[aria-selected=true]'));
          const r = rows.find((e) => e.matches('.sub')) || rows[0]; if (!r) return 'null'; const b = r.getBoundingClientRect(); return JSON.stringify([b.x + b.width / 2, b.y + b.height / 2]); })()`));
        if (row) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: row[0], y: row[1] }), await sleep(500), await shot('2-hover-row');
      }
      console.log(`  ✓ ${tag} (photos only)`);
      continue;
    }
    // 1. Names.
    const shown = JSON.parse(await page.eval(`JSON.stringify(studioShell.items().map((i) => [i.key, studioShell.nameOf(i.key)]))`));
    const nameOf = Object.fromEntries(shown);
    console.log(`  ${tag}: ${[...new Set(shown.map((s) => s[1]))].slice(0, 8).join(' / ')} …`);
    const dup = shown.map((s) => s[1]).find((n, i, a) => a.indexOf(n) !== i);
    assert.equal(dup, undefined, `${tag}: two objects read the same: "${dup}"`);
    if (!opt('--game')) {
      const ja = LANG === 'ja';
      assert.match(nameOf[pick], ja ? /^道路わきの黒い柱（[左右]・\d+ 本目）$/ : /^Black pillar by the road \((left|right), \d+(st|nd|rd|th)\)$/, `${tag}: the pillar reads "${nameOf[pick]}"`);
      const [cb, cw] = card.split('|');
      assert.equal(ja ? `${cb}（${cw}）` : `${cb} (${cw})`, nameOf[pick], `${tag}: the card reads "${card}"`);
      const roadKey = items.find((i) => i.kinds.includes('plane')).key, skyKey = items.find((i) => i.kinds.includes('sphere')).key;
      const playerKey = items.find((i) => i.kinds.includes('box')).key;
      assert.equal(nameOf[roadKey], ja ? '道路' : 'Road');
      assert.equal(nameOf[skyKey], ja ? '空' : 'Sky');
      assert.equal(nameOf[playerKey], ja ? '青い箱' : 'Blue box');
    }
    const words = await page.eval(SHOWN);
    assert.ok(!/まとまり|[Uu]nnamed group|path:/.test(words), `${tag}: an inner word on screen: …${(words.match(/.{0,40}(まとまり|[Uu]nnamed group|path:).{0,20}/) || [''])[0]}…`);
    // 3. The chip: small, one line, the whole name on hover; the field keeps the room.
    assert.equal(chip.hidden, false, `${tag}: no chip`);
    assert.ok(chip.w <= Math.min(168, chip.box / 3) + 1, `${tag}: the chip is ${Math.round(chip.w)}px of ${Math.round(chip.box)}px`);
    assert.ok(chip.h <= chip.lineH * 1.6 + 8, `${tag}: the chip wraps (${Math.round(chip.h)}px high)`);
    assert.ok(chip.field >= chip.box / 2, `${tag}: the field keeps ${Math.round(chip.field)}px of ${Math.round(chip.box)}px`);
    assert.ok(chip.title.includes(nameOf[pick]), `${tag}: the chip's tooltip "${chip.title}" lacks the whole name`);
    // 4. The pick, marked in the game.
    assert.ok((await page.eval(LAYER('sel'))) > 0, `${tag}: the picked object is not marked in the game`);
    // 2. The card's line about names and its button.
    const why = JSON.parse(await page.eval(`(() => { const p = document.querySelector('.card [data-part=noname-why]'); const b = document.querySelector('.card [data-action=ask-name]');
      return JSON.stringify({ text: p && p.offsetParent ? p.innerText : null, btn: b && b.offsetParent ? b.innerText : null }); })()`));
    if (sz.id !== 'pc' && !why.text) {
      // The narrow card (phone, side window) folds the notes under "…".
      await page.eval(`document.querySelector('.card .fine summary')?.click()`);
      await sleep(300);
      Object.assign(why, JSON.parse(await page.eval(`(() => { const p = document.querySelector('.card [data-part=noname-why]'); const b = document.querySelector('.card [data-action=ask-name]');
        return JSON.stringify({ text: p && p.offsetParent ? p.innerText : null, btn: b && b.offsetParent ? b.innerText : null }); })()`)));
    }
    assert.ok(why.text && why.text.length <= 80, `${tag}: the card's line about names: "${why.text}"`);
    assert.equal(why.btn, LANG === 'ja' ? 'AI に名前を付けてもらう' : 'Ask your AI to name it');
    // 4b. Hover: a row in the list (mouse only) lights its object; off when the mouse leaves; the card lights the pick.
    if (!sz.touch) {
      // Another pillar's row (a pillar lit is the picture to look at; the sky's row lights the whole edge of the view).
      const row = JSON.parse(await page.eval(`(() => { const rows = [...document.querySelectorAll('.objects .obj')].filter((e) => e.offsetParent && !e.matches('[aria-selected=true]'));
        const r = rows.find((e) => e.matches('.sub')) || rows[0]; if (!r) return 'null';
        const b = r.getBoundingClientRect(); return JSON.stringify([b.x + b.width / 2, b.y + b.height / 2]); })()`));
      if (row) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: row[0], y: row[1] });
        await page.waitFor(`${LAYER('hover')} > 0`, 3000).catch(() => {});
        await sleep(200);
        await shot('2-hover-row');
        assert.ok((await page.eval(LAYER('hover'))) > 0, `${tag}: a mouse over a row does not light its object`);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sz.w / 2, y: 4 });
        await page.waitFor(`${LAYER('hover')} <= 0`, 3000).catch(() => {});
        assert.ok((await page.eval(LAYER('hover'))) <= 0, `${tag}: the light stays after the mouse left the row`);
      }
      const c = JSON.parse(await page.eval(`(() => { const b = document.querySelector('.card').getBoundingClientRect(); return JSON.stringify([b.x + b.width / 2, b.y + 14]); })()`));
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c[0], y: c[1] });
      await page.waitFor(`${LAYER('hover')} > 0`, 3000).catch(() => {});
      assert.ok((await page.eval(LAYER('hover'))) > 0, `${tag}: a mouse over the card does not light the picked object`);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sz.w / 2, y: 4 });
    }
    // 2b. "Ask AI to name it": one request about it, the guessed name along.
    const before = requests(root).filter((r) => r.kind === 'name').length;
    await page.eval(`document.querySelector('.card [data-action=ask-name]').click()`);
    await page.waitFor(`!!document.querySelector('.ask-note:not([hidden])')`, 5000).catch(() => {});
    await sleep(300);
    const named = requests(root).filter((r) => r.kind === 'name');
    assert.equal(named.length, before + 1, `${tag}: ${named.length - before} name requests`);
    const obj = named.at(-1).objects.find((o) => o.key === pick);
    assert.ok(obj, `${tag}: the name request is not about the picked pillar`);
    assert.ok(JSON.stringify(named.at(-1)).includes(nameOf[pick]), `${tag}: the guessed name is not sent along`);
    // 3b. Several picked: the chip is a count.
    await page.eval(`studioShell.actions.selectMany(${JSON.stringify(pillars.slice(0, 4))}, ${JSON.stringify(pillars[0])})`);
    await sleep(600);
    const many = await page.eval(`document.querySelector('.ask-chip').innerText`);
    assert.equal(many, '×4', `${tag}: several picked, the chip reads "${many}"`);
    await shot('3-several');
    const errors = page.logs.filter((l) => l.startsWith('exception'));
    assert.deepEqual(errors, [], 'page errors');
    console.log(`  ✓ ${tag}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${e.message}`);
    await shot('FAIL').catch(() => {});
  } finally {
    await page.close();
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('studio-names: ok');
