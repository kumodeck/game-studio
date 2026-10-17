// Pictures of the six screens of the editor's design, the same steps each
// time, for judging the look by eye (no assertions about the look; the other
// browser tests cover behaviour).
//
//   node test/rebrand-shots.browser.mjs [example ...] --shots <dir> [--lang ja|en] [--theme dark|light|both] [--only pc|phone]
//
// For each example (default three-crates and pixi-garden), at 1280×800
// (mouse) and 390×844 (touch, 2× pixels), in each theme:
//   1-open    the first screen
//   2-sel     one object picked (outline, name tag, tool strip, card)
//   3-multi   three picked
//   4-ai      after "your AI added 3": the game is changed in a temporary
//             copy the way an AI would change its code, the status says
//             "done", and "Reload the game" is pressed
//   5-ask     the ⌘K list with a few words typed
//   6-assets  Assets with one file open
// Each example runs in a temporary copy of its folder.
//
// `<example>-crowd` (three-crates-crowd, pixi-garden-crowd): the same sample
// with a crowd added in the temporary copy — 240 objects from 120 asset files
// (3D) / 270 sprites from 90 files (2D) — to judge the list, the ⌘K list and
// Assets when there are hundreds of things. Shots: 1-open, 2-sel (one picked
// far down the list), 5-ask (a name typed), 6-assets.
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const SHOTS = resolve(take('--shots') || join(tmpdir(), 'studio-rebrand-shots'));
const LANG = take('--lang') || 'ja';
const THEME = take('--theme') || 'both';
const THEMES = THEME === 'both' ? ['dark', 'light'] : [THEME];
const ONLY = take('--only');
// --typed: also shoot the ⌘K list with a few words typed (5b).
const TYPED = args.includes('--typed') ? (args.splice(args.indexOf('--typed'), 1), true) : false;
const EXAMPLES = args.length ? args : ['three-crates', 'pixi-garden'];
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What each sample picks, and how "the AI" changes its code for 4-ai.
const PLAN = {
  'three-crates': {
    one: 'crate-4', many: ['crate-1', 'crate-2', 'crate-3'], ask: 'crate を',
    ai: (dir) => {
      const f = join(dir, 'game.js');
      writeFileSync(f, readFileSync(f, 'utf8').replace('[2, 0, 2]].forEach', '[2, 0, 2], [-4.2, 0, 3], [-2.8, 0, 3.4], [-1.4, 0, 3.8]].forEach'));
    },
  },
  'pixi-garden': {
    one: 'house', many: ['tree', 'tree#2', 'flower-by-rock'], ask: 'tree を',
    ai: (dir) => {
      const f = join(dir, 'game.js');
      writeFileSync(f, readFileSync(f, 'utf8').replace("app.stage.addChild(bg, ground, cloud, house, tree1, tree2, rock, flower, fence, ui);",
        "const more = [0, 1, 2].map((i) => sprite('flower', 560 + i * 40, 520, `flower-${i + 2}`));\napp.stage.addChild(bg, ground, cloud, house, tree1, tree2, rock, flower, ...more, fence, ui);"));
    },
  },
};

// The crowds: written into the temporary copy only (the samples stay small).
const pad = (n) => String(n).padStart(3, '0');
const CROWD = {
  'three-crates': {
    one: 'barrel-165', ask: 'lamp-2',
    add: (dir) => {
      mkdirSync(join(dir, 'assets/props'), { recursive: true });
      const kinds = ['crate', 'barrel', 'lamp'];
      for (let i = 0; i < 120; i++) copyFileSync(join(dir, `assets/${kinds[i % 3]}.glb`), join(dir, `assets/props/${kinds[i % 3]}-${pad(i + 1)}.glb`));
      const f = join(dir, 'game.js');
      writeFileSync(f, readFileSync(f, 'utf8').replace('scene.add(lamp.scene);\n', `scene.add(lamp.scene);
const kinds = ['crate', 'barrel', 'lamp'];
const crowd = await Promise.all(Array.from({ length: 120 }, (_, i) => loader.loadAsync(\`assets/props/\${kinds[i % 3]}-\${String(i + 1).padStart(3, '0')}.glb\`)));
crowd.forEach((m, i) => { for (let j = 0; j < 2; j++) { const n = i * 2 + j; const o = j ? m.scene.clone() : m.scene;
  o.name = \`\${kinds[i % 3]}-\${n + 1}\`; o.userData.studioAsset = \`assets/props/\${kinds[i % 3]}-\${String(i + 1).padStart(3, '0')}.glb\`;
  o.position.set(-10 + (n % 20) * 1.05, 0, 4 + Math.floor(n / 20) * 0.6); o.scale.setScalar(0.4); shadows(o); scene.add(o); } });
`));
    },
  },
  'pixi-garden': {
    one: 'rock-202', ask: 'post-1',
    add: (dir) => {
      mkdirSync(join(dir, 'assets/props'), { recursive: true });
      const kinds = ['flower', 'rock', 'post'];
      for (let i = 0; i < 90; i++) copyFileSync(join(dir, `assets/${kinds[i % 3]}.svg`), join(dir, `assets/props/${kinds[i % 3]}-${pad(i + 1)}.svg`));
      const f = join(dir, 'game.js');
      writeFileSync(f, readFileSync(f, 'utf8').replace('app.stage.addChild(bg, ground, cloud, house, tree1, tree2, rock, flower, fence, ui);', `const kinds = ['flower', 'rock', 'post'];
const crowd = [];
for (let i = 0; i < 90; i++) {
  const t = await Assets.load(\`assets/props/\${kinds[i % 3]}-\${String(i + 1).padStart(3, '0')}.svg\`);
  for (let j = 0; j < 3; j++) { const n = i * 3 + j; const s = new Sprite(t); s.anchor.set(0.5); s.scale.set(0.45);
    s.position.set(30 + (n % 30) * 25, 300 + Math.floor(n / 30) * 28); s.label = \`\${kinds[i % 3]}-\${n + 1}\`; crowd.push(s); }
}
app.stage.addChild(bg, ground, cloud, house, tree1, tree2, rock, flower, fence, ...crowd, ui);`));
    },
  },
};

const DBG = `document.querySelector('iframe').contentWindow.__gameStudio?._debug`;

async function run(example, layout, theme) {
  const mobile = layout === 'phone';
  const crowd = example.endsWith('-crowd');
  const base = crowd ? example.slice(0, -6) : example;
  const plan = crowd ? CROWD[base] : PLAN[example] || PLAN['three-crates'];
  const tag = `${mobile ? 'ph' : 'pc'}-${theme}-${example}`;
  const root = mkdtempSync(join(tmpdir(), `studio-rebrand-${example}-`));
  cpSync(join(PKG, 'examples', base), root, { recursive: true });
  if (crowd) plan.add(root);
  rmSync(join(root, 'placement.json'), { force: true });
  rmSync(join(root, '.studio/requests'), { recursive: true, force: true });
  rmSync(join(root, '.studio/status.json'), { force: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme }));
  const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  const browser = await launch();
  const page = await newPage(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1280, height: 800 });
  const shot = async (name) => {
    await sleep(600);
    writeFileSync(join(SHOTS, `${tag}-${name}.png`), await page.screenshot());
    console.log(`  ✓ ${tag}-${name}`);
  };
  const ready = async () => {
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${DBG}`, 30000);
    await sleep(900);
  };
  const shell = (code) => page.eval(`(() => { const s = window.studioShell; ${code} })()`);
  try {
    await page.goto(srv.url);
    await ready();
    await shot('1-open');
    if (crowd) return await crowdShots(page, shell, shot, plan, mobile);
    await shell(`s.actions.select(${JSON.stringify(plan.one)}); return true;`);
    // Moved a little (arrow keys): the top bar shows "Save · 1".
    for (let i = 0; i < 3; i++) await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })), true`);
    await shot('2-sel');
    await shell(`s.actions.selectMany(${JSON.stringify(plan.many)}, ${JSON.stringify(plan.many[0])}); return true;`);
    await shot('3-multi');
    // "Your AI added 3": the code changes, the status says done, the game reloads by itself.
    await shell(`s.actions.select(null); return true;`);
    plan.ai(root);
    writeFileSync(join(root, '.studio/status.json'), JSON.stringify({ version: 1, state: 'done', changed: 3, note: LANG === 'ja' ? (example.startsWith('three') ? 'crate を 3 個、手前に並べました' : '花を 3 本、家の前に植えました') : (example.startsWith('three') ? 'Put 3 more crates in a row at the front' : 'Planted 3 flowers in front of the house'), at: new Date().toISOString() }));
    // The editor reloads the game by itself when the code changed and the AI is done (AI feel, 10/16).
    await page.waitFor(`!!document.querySelector('[data-action=ai-show], [data-action=ai-undo]') && document.querySelectorAll('iframe.game').length === 1`, 20000);
    await ready();
    await page.waitFor(`!!document.querySelector('[data-action=ai-show]')`, 15000).catch(() => null);
    await shot('4-ai');
    // The ⌘K list, about the picked object.
    await shell(`s.actions.select(${JSON.stringify(plan.one)}); return true;`);
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); return true; })()`);
    await shot('5-ask');
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.value = ${JSON.stringify(plan.ask)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    if (TYPED) await shot('5b-ask-typed');
    await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await page.eval(`document.querySelector('.ask-input').blur()`);
    // Assets, one file open.
    await page.eval(`document.querySelector('[data-tool=library]').click()`);
    await page.waitFor(`document.querySelectorAll('.gsl-tile').length > 0`, 20000);
    await sleep(1500);
    // PC: one file open (its card at the right). Phone: the sheet of pictures (the file's card opens below them).
    if (!mobile) await page.eval(`document.querySelector('.gsl-tile').click()`);
    await shot('6-assets');
  } catch (e) {
    console.log(`  ✗ ${tag}: ${e.message}\n${page.logs.slice(-12).join('\n')}`);
    process.exitCode = 1;
  } finally {
    await page.close();
    await browser.close?.();
    await srv.close?.();
    rmSync(root, { recursive: true, force: true });
  }
}

// The crowd: one picked far down the list (the list scrolls to it), a name typed into ⌘K, Assets.
async function crowdShots(page, shell, shot, plan, mobile) {
  await shell(`s.actions.select(${JSON.stringify(plan.one)}); return true;`);
  if (mobile) await page.eval(`document.querySelector('[data-action=sheet]')?.click(), true`);
  await shot('2-sel');
  if (mobile) await page.eval(`document.querySelector('[data-action=sheet]')?.click(), true`);
  await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.focus(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); i.value = ${JSON.stringify(plan.ask)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await shot('5-ask');
  await page.eval(`(() => { const i = document.querySelector('.ask-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); return true; })()`);
  await page.eval(`document.querySelector('[data-tool=library]').click()`);
  await page.waitFor(`document.querySelectorAll('.gsl-tile').length > 0`, 20000).catch(async (e) => {
    console.log(`  view: ${await page.eval(`document.querySelector('.shell').dataset.view`)}`);
    throw e;
  });
  await sleep(1500);
  await shot('6-assets');
}

for (const ex of EXAMPLES) {
  for (const theme of THEMES) {
    for (const layout of ['pc', 'phone']) {
      if (ONLY && ONLY !== layout) continue;
      await run(ex, layout, theme);
    }
  }
}
process.exit(process.exitCode || 0);
