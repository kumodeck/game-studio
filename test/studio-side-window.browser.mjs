// The side window next to a chat (a try of v0.1.5 in the Claude app on 2026-10-19 with an AI-made 3D runner: "it's hard
// to use from the sidebar"). In its screenshot at ~400 wide the game was the top quarter,
// the list was 36 rows of "Unnamed group", the tools (sheet, card, ask bar, ↑↓, the strip) took more room than the
// game, and the chat app's own toolbar lay over the ask bar.
//
// A desktop window driven by a mouse (no touch emulation: that is a phone, test/studio-narrow), the real server and
// the built shell, at 400×900, 420×800, 360×700 and 480×1000:
//   1. the side window is told from a phone (data-fit="side") and its top bar has "Open large"
//   2. the list sheet opened and an object picked: the game keeps at least half the window above the sheet, with
//      the picked object in it; the low sheet reads at least 3 list rows (2 at 700 high), the picked row among them,
//      and the card; nothing that can be pressed in the window's bottom 48 px (the chat app's toolbar)
//   3. the strip and the camera ↑↓ are a mouse's 28 px (not a finger's 44) and do not overlap
//   4. the sheet's grip, dragged up, gives more rows (the game still seen above it); a click on it takes it back low
//   5. an AI-written runner with 60 unnamed objects: the list's first row folds them all ("Unnamed objects 60 · Ask
//      AI to name them"), no two rows in view read the same, the picked one shows under it as a picture and x · z,
//      ▸ opens them all (each with its own x · z), and "Ask AI to name them" keeps one `name` request for all of them
//   6. "Open large" opens the printed link (pass included) — in a second browser with no cookie, at 1280×800, the
//      editor opens (PC layout, no "Open large"), an ask about the picked object is kept and Save writes the file
//
//   node test/studio-side-window.browser.mjs [--shots <dir>] [--only 400x900,420x800] [--game lantern-cove|runner] [--lang ja|en]
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The runner, cut down from what an AI wrote for that try (a neon runner): groups of parts and loose meshes, no names.
const RUNNER = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Neon Run</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#0a0418}</style>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js" } }</script>
</head><body><script type="module">
import * as THREE from 'three';
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x140828);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 6, 12);
camera.lookAt(0, 0, -16);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
scene.add(new THREE.HemisphereLight(0xff88cc, 0x332266, 2));
const mat = (c, e = 0) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: e });
const road = new THREE.Mesh(new THREE.PlaneGeometry(14, 240), mat(0x2a1450)); road.rotation.x = -Math.PI / 2; road.position.z = -100; scene.add(road);
for (let i = 0; i < 36; i++) {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.6, 0.8), mat(0x444466)); p.position.y = 1.3; g.add(p);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.9), mat(0xff6a00, 1)); cap.position.y = 2.7; g.add(cap);
  g.position.set(((i * 7) % 5 - 2) * 2.2, 0, -4 - i * 3); scene.add(g);
}
for (let i = 0; i < 14; i++) { const h = 6 + ((i * 13) % 9); const b = new THREE.Mesh(new THREE.BoxGeometry(4, h, 4), mat(0x3a2266)); b.position.set(i % 2 ? 11 : -11, h / 2, -8 - i * 7); scene.add(b); }
for (let i = 0; i < 10; i++) { const c = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.12, 8, 20), mat(0xffdd33, 0.8)); c.position.set(((i * 3) % 5 - 2) * 2.2, 1.2, -3 - i * 6); scene.add(c); }
renderer.setAnimationLoop(() => renderer.render(scene, camera));
</script></body></html>`;

const SIZES = [[400, 900], [420, 800], [360, 700], [480, 1000]].filter(([w, h]) => !opt('--only') || opt('--only').split(',').includes(`${w}x${h}`));
const GAMES = [
  { id: 'lantern-cove', pick: 'lighthouse' },
  { id: 'runner', pick: null },
].filter((g) => !opt('--game') || g.id === opt('--game'));

const WIN = `document.querySelector('iframe').contentWindow`;
const READY = `document.querySelectorAll('.obj, .noname:not([hidden])').length > 0 && !!${WIN}.__gameStudio?._debug`;
const visible = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.offsetParent) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`;
// The rows that read whole: inside the list's scroll box, above the card and the bar.
const MEASURE = `(() => {
  const H = innerHeight;
  const box = document.querySelector('.side .list-scroll').getBoundingClientRect();
  const covers = [...document.querySelectorAll('.card-slot > .card:not([hidden]), .dock .bar')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().top);
  const bottom = Math.min(box.bottom, ...covers);
  const rows = [...document.querySelectorAll('.side .list-scroll > .noname:not([hidden]), .side .list-scroll .obj')].filter((e) => e.offsetParent);
  const seen = rows.filter((e) => { const r = e.getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= bottom + 1; });
  const sel = rows.find((e) => e.getAttribute('aria-selected') === 'true');
  const side = document.querySelector('.side').getBoundingClientRect();
  const stage = document.querySelector('iframe').getBoundingClientRect();
  // Pressable = really under the pointer there (elementFromPoint): rows scrolled out of the list's box and the folded
  // card's hidden numbers have boxes down there too, but a press there never reaches them.
  const low = [...document.querySelectorAll('button, input, [role=option], [role=separator], summary, a')].filter((e) => {
    if (!e.offsetParent) return false; const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0 && r.bottom > H - 48 && r.top < H)) return false;
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max((Math.max(r.top, H - 48) + Math.min(r.bottom, H)) / 2, 0), H - 1);
    const hit = document.elementFromPoint(x, y); return !!hit && (hit === e || e.contains(hit)); })
    .map((e) => e.dataset.action || e.getAttribute('aria-label') || e.className);
  const total = rows.length;
  return JSON.stringify({ total, seen: seen.length, texts: seen.map((e) => e.innerText.replace(/\\s+/g, ' ').trim()), selSeen: !!sel && seen.includes(sel),
    card: covers.length > 1, game: Math.round(side.top - stage.top), sheetTop: Math.round(side.top), sheetH: Math.round(side.height), low });
})()`;
// The strip's and the camera ↑↓'s buttons in the game frame (their own shadow roots).
const GAME_UI = `JSON.stringify([...${WIN}.document.querySelectorAll('[data-studio-ui]')].flatMap((host) => host.shadowRoot ? [...host.shadowRoot.querySelectorAll('button')] : [])
  .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden'; })
  .map((b) => { const r = b.getBoundingClientRect(); return { rise: !!b.dataset.rise, x: r.left, y: r.top, w: r.width, h: r.height }; }))`;
const anchorY = (key) => `(() => { const f = document.querySelector('iframe'); const r = f.getBoundingClientRect();
  const a = f.contentWindow.__gameStudio._debug.anchor(${JSON.stringify(key)}); return a ? r.top + a.center[1] : null; })()`;
const requests = (root) => {
  const dir = join(root, '.studio/requests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')));
};
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

let failed = 0;
for (const g of GAMES) {
  const root = mkdtempSync(join(tmpdir(), `studio-side-${g.id}-`));
  if (g.id === 'runner') writeFileSync(join(root, 'index.html'), RUNNER);
  else cpSync(join(PKG, 'starters', g.id), root, { recursive: true });
  if (opt('--lang')) {
    mkdirSync(join(root, '.studio/ui'), { recursive: true });
    writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: opt('--lang') }));
  }
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  try {
    // A phone of the same size (touch) is not the side window: it keeps the phone's sheet and sizes (studio-narrow).
    if (g.id === 'lantern-cove') {
      const phone = await newPage(browser, { width: 390, height: 844, mobile: true });
      try {
        await phone.goto(srv.url);
        await phone.waitFor(READY, 30000);
        assert.equal(await phone.eval(`document.querySelector('.shell').dataset.fit`), 'full', 'a phone (touch) was taken for the side window');
        assert.equal(await phone.eval(visible('.top [data-action=open-large]')), false, 'a phone shows "Open large"');
        console.log('  ✓ phone 390×844 (touch): not the side window');
      } catch (e) {
        failed++;
        console.log(`  ✗ ${e.message}`);
      } finally {
        await phone.close();
      }
    }
    for (const [w, h] of SIZES) {
      const tag = `${g.id}-${w}x${h}`;
      const page = await newPage(browser, { width: w, height: h });
      const shot = async (name) => SHOTS && writeFileSync(join(SHOTS, `side-${tag}-${name}.png`), await page.screenshot());
      try {
        await page.goto(srv.url);
        await page.waitFor(READY, 30000);
        await sleep(800);
        // 1. The side window, with "Open large".
        assert.equal(await page.eval(`document.querySelector('.shell').dataset.fit`), 'side', `${tag}: not taken for the side window`);
        assert.ok(await page.eval(visible('.top [data-action=open-large]')), `${tag}: no "Open large" in the top bar`);
        // 2. The list sheet, one object picked.
        await page.eval(`document.querySelector('[data-action=sheet]').click()`);
        await sleep(700);
        const keys = await page.eval(`studioShell.items().map((i) => i.key)`);
        const key = g.pick && keys.includes(g.pick) ? g.pick : keys[Math.floor(keys.length / 2)];
        await page.eval(`studioShell.actions.select(${JSON.stringify(key)})`);
        await page.waitFor(`studioShell.selected() === ${JSON.stringify(key)}`, 3000);
        await sleep(1000);
        const m = JSON.parse(await page.eval(MEASURE));
        const y = await page.eval(anchorY(key));
        await shot('1-picked');
        console.log(`  ${tag}: game ${m.game}px of ${h} above the sheet; ${m.seen} rows read (${m.texts.join(' | ')}); picked ${key} ${m.selSeen ? 'in view' : 'NOT in view'} at y=${Math.round(y)}; bottom 48 px: ${m.low.join(', ') || 'nothing'}`);
        assert.ok(m.game >= h * 0.5, `${tag}: the game keeps only ${m.game}px above the sheet (want ≥ half of ${h})`);
        assert.ok(m.seen >= Math.min(h <= 720 ? 2 : 3, m.total), `${tag}: only ${m.seen} of ${m.total} rows read in the low sheet`);
        assert.ok(m.selSeen, `${tag}: the picked row is not in view`);
        assert.ok(m.card, `${tag}: the picked object's card is gone`);
        assert.ok(y !== null && y < m.sheetTop, `${tag}: the picked object is under the sheet (y=${y}, sheet top ${m.sheetTop})`);
        assert.deepEqual(m.low, [], `${tag}: something to press in the window's bottom 48 px`);
        // 3. The strip and ↑↓: a mouse's size, apart.
        const ui = JSON.parse(await page.eval(GAME_UI));
        const rise = ui.filter((b) => b.rise), strip = ui.filter((b) => !b.rise);
        assert.ok(rise.length === 2 || g.id !== 'lantern-cove', `${tag}: the camera ↑↓ are not shown (${rise.length})`);
        for (const b of ui) assert.ok(b.w <= 30 && b.h <= 30, `${tag}: a ${b.rise ? '↑↓' : 'strip'} button is ${Math.round(b.w)}×${Math.round(b.h)} (want the mouse's 28)`);
        for (const r of rise) for (const s of strip) assert.ok(!overlap(r, s), `${tag}: the strip lies over the camera ↑↓`);
        // 5. The runner's unnamed objects: one folded row.
        if (g.id === 'runner') {
          const fold = JSON.parse(await page.eval(`(() => { const f = document.querySelector('.side .list-scroll > .noname');
            return JSON.stringify({ cls: f.className, text: f.innerText.replace(/\\s+/g, ' ').trim(), btn: f.querySelector('[data-action=ask-name-all]')?.innerText,
              rows: [...document.querySelectorAll('.side .objects .obj')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim()) }); })()`));
          assert.equal(fold.cls, 'noname fold', `${tag}: the unnamed objects are not folded into one row`);
          const word = opt('--lang') === 'ja' ? '名前のない物' : 'Unnamed objects';
          assert.ok(fold.text.startsWith(`${word} ${keys.length}`), `${tag}: the folded row reads "${fold.text}"`);
          assert.equal(fold.btn, opt('--lang') === 'ja' ? 'AI に名前を付けてもらう' : 'Ask AI to name them');
          assert.equal(fold.rows.length, 1, `${tag}: folded, only the picked one is listed (${fold.rows.join(' | ')})`);
          // Its guessed name (names.ts, 2026-10-19: "Gray pillar (3rd)"), or where it stands when the editor has none.
          assert.match(fold.rows[0], /^x −?\d+\.\d · z −?\d+\.\d$|\S+ \S+|[（(]/, `${tag}: the picked one is told apart: "${fold.rows[0]}"`);
          const dup = m.texts.find((t, i) => m.texts.indexOf(t) !== i);
          assert.equal(dup, undefined, `${tag}: two rows in view read the same: "${dup}"`);
          if (w === 400) {
            // ▸ opens them all, each with its own place; again closes.
            await page.eval(`document.querySelector('.side .noname [data-action=noname-fold]').click()`);
            await sleep(300);
            const open = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.side .objects .obj.unnamed-row')].map((e) => e.innerText.trim()))`));
            assert.equal(open.length, keys.length, `${tag}: ▸ lists ${open.length} of ${keys.length}`);
            assert.ok(new Set(open).size >= keys.length * 0.9, `${tag}: the open rows mostly read the same (${new Set(open).size} different of ${open.length})`);
            await shot('2-fold-open');
            await page.eval(`document.querySelector('.side .noname [data-action=noname-fold]').click()`);
            await sleep(300);
            // "Ask AI to name them": one request for all of them.
            await page.eval(`document.querySelector('.side .noname [data-action=ask-name-all]').click()`);
            await page.waitFor(`!document.querySelector('.side .noname [data-action=ask-name-all]')`, 5000);
            const named = requests(root).filter((r) => r.kind === 'name');
            assert.equal(named.length, 1, `${tag}: ${named.length} name requests`);
            // (A request names at most its first 50 objects: src/schema/handoff.mjs maxObjects.)
            assert.equal(named[0].objects.length, Math.min(50, keys.length), `${tag}: the name request holds ${named[0].objects.length} of ${keys.length}`);
          }
        }
        // 4. The grip: up for more rows, a click back to low.
        const grip = JSON.parse(await page.eval(`JSON.stringify(document.querySelector('.side .sheet-grip').getBoundingClientRect())`));
        const gx = grip.x + grip.width / 2, gy = grip.y + grip.height / 2;
        await page.mouseDrag(gx, gy, gx, gy - Math.round(h * 0.25), 8);
        await sleep(900);
        const up = JSON.parse(await page.eval(MEASURE));
        await shot('3-pulled-up');
        console.log(`  ${tag}: pulled up → ${up.seen} rows read, game ${up.game}px`);
        assert.ok(up.sheetH > m.sheetH + h * 0.15, `${tag}: the grip did not pull the sheet up (${m.sheetH} → ${up.sheetH})`);
        assert.ok(up.seen > m.seen || up.seen >= up.total, `${tag}: no more rows after pulling it up (${m.seen} → ${up.seen})`);
        assert.ok(up.game >= 80, `${tag}: pulled up, the game is gone (${up.game}px)`);
        await page.click(gx, gy - Math.round(h * 0.25));
        await sleep(900);
        const back = JSON.parse(await page.eval(MEASURE));
        assert.ok(Math.abs(back.sheetH - m.sheetH) <= 2, `${tag}: a click on the grip did not take it back low (${m.sheetH} → ${back.sheetH})`);
        // 6. Open large (once per game): the printed link, then a second browser with no cookie opens it.
        if (w === 400) {
          await page.eval(`window.__opened = []; window.open = (u) => (window.__opened.push(u), {})`);
          await page.eval(`document.querySelector('.top [data-action=open-large]').click()`);
          await page.waitFor(`window.__opened.length === 1`, 5000);
          const link = await page.eval(`window.__opened[0]`);
          // (Compared, never printed: the link carries the pass.)
          assert.equal(link, srv.url, `${tag}: "Open large" did not open the printed link`);
          const big = await launch();
          try {
            const p2 = await newPage(big, { width: 1280, height: 800 });
            await p2.goto(link);
            await p2.waitFor(READY, 30000);
            await sleep(800);
            assert.equal(await p2.eval(`document.querySelector('.shell').dataset.layout`), 'pc', `${tag}: the large window is not the PC layout`);
            assert.equal(await p2.eval(visible('.top [data-action=open-large]')), false, `${tag}: "Open large" in the large window`);
            await p2.eval(`studioShell.actions.select(${JSON.stringify(key)})`);
            await p2.waitFor(`studioShell.selected() === ${JSON.stringify(key)}`, 3000);
            const before = requests(root).length;
            await p2.eval(`document.querySelector('.ask-strip .ask-input').focus()`);
            await p2.send('Input.insertText', { text: 'make it glow' });
            await p2.eval(`document.querySelector('[data-action=ask-ai]').click()`);
            await p2.waitFor(`document.querySelector('.ask-strip .ask-input').value === ''`, 5000);
            const asked = requests(root).filter((r) => r.kind === 'ask' && r.text === 'make it glow');
            assert.equal(asked.length, 1, `${tag}: the ask in the large window was not kept (${requests(root).length - before} new)`);
            assert.equal(asked[0].objects[0].key, key);
            await p2.eval(`(() => { const i = document.querySelector('.card .num input'); i.value = String(Number(i.value) + 1); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
            await p2.waitFor(visible('[data-action=save]'), 3000);
            await p2.eval(`document.querySelector('[data-action=save]').click()`);
            await p2.waitFor(`!!document.querySelector('.save-state') && /\\S/.test(document.querySelector('.save-state').textContent)`, 5000).catch(() => {});
            await sleep(500);
            assert.ok(requests(root).some((r) => r.kind === 'saved'), `${tag}: Save in the large window was not kept`);
            assert.ok(existsSync(join(root, 'placement.json')), `${tag}: Save in the large window wrote no placement.json`);
            if (SHOTS) writeFileSync(join(SHOTS, `side-${g.id}-large-window.png`), await p2.screenshot());
            const errors2 = p2.logs.filter((l) => l.startsWith('exception'));
            assert.deepEqual(errors2, [], `${tag}: page errors in the large window`);
            console.log(`  ${tag}: Open large → the printed link; a second browser at 1280×800 opened it, asked and saved`);
          } finally {
            await big.close();
          }
        }
        const errors = page.logs.filter((l) => l.startsWith('exception'));
        assert.deepEqual(errors, [], 'page errors');
        console.log(`  ✓ ${tag}`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${e.message}`);
        await shot('FAIL').catch(() => {});
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await srv.close();
    rmSync(root, { recursive: true, force: true });
  }
}
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('ok');
