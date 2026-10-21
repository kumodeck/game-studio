// The names a person reads in the list (src/shell/names.ts, polish pass 2026-10-16, play test stumble 8):
// no `path:` keys, no "No name", no two rows with the same name.
// Run: node --experimental-strip-types --no-warnings --test test/names.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { displayName, fileStem, uiName } from '../src/shell/names.ts';

const t = (k: string) => ({ 'noname.kind.shape': 'Unnamed shape', 'noname.kind.picture': 'Unnamed picture', 'noname.kind.object': 'Unnamed object' } as Record<string, string>)[k] ?? k;
const item = (key: string, label: string, extra: Record<string, unknown> = {}) => ({ key, label, kinds: ['object'], ...extra });

test('a named object reads as its name', () => {
  assert.equal(displayName(item('crate-4', 'crate-4'), t), 'crate-4');
  assert.equal(displayName(item('tree', 'tree'), t), 'tree');
});

test('the second object with the same name reads "tree 2", not "tree" again', () => {
  assert.equal(displayName(item('tree#2', 'tree'), t), 'tree 2');
  assert.equal(displayName(item('tree#1', 'tree'), t), 'tree');
  // A label that is not the key's base name is left as it is.
  assert.equal(displayName(item('enemy#2', 'Goblin'), t), 'Goblin');
});

test('an unnamed object is called by its picture file, else by its kind — never by its tree path', () => {
  assert.equal(displayName(item('path:6', 'sprite (no name)', { unstable: true, kinds: ['sprite'], group: 'http://127.0.0.1:5173/assets/big_rock.svg?v=2' }), t), 'big rock');
  assert.equal(displayName(item('path:8', 'path:8', { unstable: true, kinds: ['box', 'object'] }), t), 'Unnamed shape');
  assert.equal(displayName(item('path:1', 'graphics (no name)', { unstable: true, kinds: ['graphics'] }), t), 'Unnamed shape');
  assert.equal(displayName(item('path:2', 'x', { unstable: true, kinds: ['weird'] }), t), 'Unnamed object');
  for (const it of [item('path:6', 'path:6', { unstable: true, kinds: ['sprite'] })]) assert.doesNotMatch(displayName(it, t), /path:|No name/);
});

test('fileStem reads only picture and model files', () => {
  assert.equal(fileStem('assets/tree.svg'), 'tree');
  assert.equal(fileStem('shape:1234abcd:5678'), null);
  assert.equal(fileStem(undefined), null);
  assert.equal(fileStem('models/old%20boat.glb#x'), 'old boat');
});

// ----- guessed names (a hands-on try, 2026-10-19, item 3: "Unnamed group" on the card and in the ask bar) -----
import { guessNames, hueOf } from '../src/shell/names.ts';

// The AI-written runner's objects as the three.js adapter reports them (Item.look: world box, its middle, main colour).
const runner = () => {
  const out: Array<Record<string, unknown>> = [
    { key: 'path:2', kinds: ['sphere', 'object'], unstable: true, group: 'shape:a:b', look: { size: [600, 600, 600], c: [0, 0, 0], color: '#87ceeb', inside: true } },
    { key: 'path:3', kinds: ['plane', 'object'], unstable: true, group: 'shape:c:d', look: { size: [14, 0, 400], c: [0, 0, -150], color: '#808080' } },
  ];
  for (let i = 0; i < 20; i++) {
    const x = i % 3 === 1 ? 5.5 : -5.5;
    out.push({ key: `path:${4 + i}`, kinds: ['group', 'object'], unstable: true, group: 'shape:e:f', look: { size: [1.3, 3.2, 1.3], c: [x, 1.6, -i * 8], color: '#111111' } });
  }
  out.push({ key: 'path:24', kinds: ['box', 'object'], unstable: true, group: 'shape:g:h', look: { size: [1, 1, 1], c: [0, 0.5, 2], color: '#3399ff' } });
  return out as never[];
};

test('the runner: pillars by the road with side and count, the road, the sky, the player — all different', () => {
  const ja = guessNames(runner(), 'ja');
  assert.equal(ja.get('path:2'), '空');
  assert.equal(ja.get('path:3'), '道路');
  assert.equal(ja.get('path:24'), '青い箱');
  // The 1st pillar (z 0) is on the left, the 2nd (z −8) on the right; counted from the camera's side per side.
  assert.equal(ja.get('path:4'), '道路わきの黒い柱（左・1 本目）');
  assert.equal(ja.get('path:5'), '道路わきの黒い柱（右・1 本目）');
  assert.equal(ja.get('path:6'), '道路わきの黒い柱（左・2 本目）');
  assert.equal(new Set(ja.values()).size, ja.size, 'two objects read the same');
  for (const v of ja.values()) assert.doesNotMatch(v, /まとまり|path:/);
  const en = guessNames(runner(), 'en');
  assert.equal(en.get('path:2'), 'Sky');
  assert.equal(en.get('path:3'), 'Road');
  assert.equal(en.get('path:24'), 'Blue box');
  assert.equal(en.get('path:6'), 'Black pillar by the road (left, 2nd)');
  assert.equal(en.get('path:5'), 'Black pillar by the road (right, 1st)');
  assert.equal(new Set(en.values()).size, en.size);
});

test('two kinds that read the same are told apart by size; lanes that are not two sides get a count only', () => {
  const its = [
    { key: 'a', kinds: ['box'], unstable: true, group: 'g1', look: { size: [1, 1, 1], c: [0, 0, 0], color: '#ff0000' } },
    { key: 'b', kinds: ['box'], unstable: true, group: 'g2', look: { size: [4, 4, 4], c: [3, 0, 0], color: '#ee1111' } },
    ...[-4, -2, 0, 2, 4].map((x, i) => ({ key: `l${i}`, kinds: ['torus'], unstable: true, group: 'g3', look: { size: [1, 1, 0.3], c: [x, 1, -i * 3], color: '#ffdd33' } })),
  ] as never[];
  const ja = guessNames(its, 'ja');
  assert.equal(ja.get('a'), '小さな赤い箱');
  assert.equal(ja.get('b'), '大きな赤い箱');
  assert.equal(ja.get('l0'), '黄色い輪（1 番目）');
  assert.equal(ja.get('l4'), '黄色い輪（5 番目）');
  assert.equal(guessNames(its, 'en').get('l2'), 'Yellow ring (3rd)');
});

test('a copy reads as its original; named objects and objects without a look are left to displayName', () => {
  const its = [...runner(), { key: 'path:4~c1', kinds: ['group'], unstable: true, copyOf: 'path:4', look: { size: [1.3, 3.2, 1.3], c: [9, 1, 0] } }, { key: 'tree', label: 'tree', kinds: ['mesh'], look: { size: [1, 3, 1] } }] as never[];
  const m = guessNames(its, 'ja');
  assert.equal(m.get('path:4~c1'), m.get('path:4'));
  assert.equal(m.has('tree'), false);
});

test('colour words', () => {
  assert.equal(hueOf('#111111'), 'black');
  assert.equal(hueOf('#808080'), 'gray');
  assert.equal(hueOf('#ffffff'), 'white');
  assert.equal(hueOf('#ff69b4'), 'pink');
  assert.equal(hueOf('#3399ff'), 'blue');
  assert.equal(hueOf('#6cbf4a'), 'green');
  assert.equal(hueOf('#b83a2e'), 'red');
  assert.equal(hueOf('#5a3a2a'), 'brown');
  assert.equal(hueOf('#ffdd33'), 'yellow');
  assert.equal(hueOf('#3a2266'), 'purple');
  assert.equal(hueOf('nope'), null);
});

// Ive review 3 ⑤ (2026-10-20): a UI element is named by its data-studio-key, not by its text (the title card read
// "Glow Garden Tap the lant…" in the list, on the card and in the chip). The text is the card's grey second line.
test('a UI element is called by its key in words, whatever it says', () => {
  const ui = (key: string, label: string) => item(key, label, { kinds: ['ui', 'text'] });
  assert.equal(displayName(ui('title-card', 'Glow Garden Tap the lanterns to light th'), t), 'Title card');
  assert.equal(displayName(ui('score', 'Glow 0 / 5'), t), 'Score');
  assert.equal(displayName(ui('start-button', 'Start'), t), 'Start button');
  assert.equal(uiName('hudTopLeft'), 'Hud top left');
  assert.equal(uiName('menu_play.btn'), 'Menu play btn');
  // Short enough not to be cut ("…") where a name is shown: the list row, the card, the ask chip.
  assert.ok(displayName(ui('title-card', 'x'.repeat(40)), t).length <= 12);
});
