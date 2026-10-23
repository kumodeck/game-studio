// studio-motion-delete (a request, 10/24: "is there a way to delete a motion?"): the card's Motion row has a menu —
// right-click on the row, or its ⋯ — with "Remove from this object" (the motion stays in the Library) and "Delete
// motion" (red; it comes off every object). Delete asks in one line only when other objects have it too.
// Run: node --experimental-strip-types --no-warnings --test test/motion-delete.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { motionMenu, type MotionCardDeps } from '../src/shell/motion-card.ts';
import type { MenuEntry } from '../src/shell/context-menu.ts';
import { translate } from '../src/shell/i18n.ts';
import type { LibraryMotion, MotionClip } from '../src/contract.ts';

const src = (f: string) => readFileSync(new URL(`../src/shell/${f}`, import.meta.url), 'utf8');
type Row = Extract<MenuEntry, { run(): void }>;
const rows = (es: MenuEntry[]) => es.filter((e): e is Row => 'run' in e);

function deps(usedBy: number, lib = ['Hop']) {
  const log: string[] = [];
  const menus: MenuEntry[][] = [];
  const d: MotionCardDeps = {
    t: (k, v) => translate('ja', k, v),
    clips: () => [], shown: () => null, library: () => lib.map((name) => ({ name } as LibraryMotion)), room: () => true, open: () => false,
    choose() {}, attach() {}, make() {}, toggle() {},
    detach: (n) => log.push(`detach ${n}`),
    remove: (n) => log.push(`remove ${n}`),
    usedBy: () => usedBy,
    say: (s) => log.push(`say ${s}`),
    menu: (_at, es) => menus.push(es),
    undoKey: '⌘Z',
  };
  return { d, log, menus };
}
const hop = { name: 'Hop', use: 'Hop' } as MotionClip;
const at = { x: 10, y: 10 };

test('two rows, the glossary words: この物から外す and a red 動きを削除', () => {
  const { d } = deps(1);
  const r = rows(motionMenu(d, hop, at));
  assert.deepEqual(r.map((x) => x.label), ['この物から外す', '動きを削除']);
  assert.equal(r[0]!.danger, undefined);
  assert.equal(r[1]!.danger, true);
  assert.equal(translate('en', 'motion.menu.detach'), 'Remove from this object');
  assert.equal(translate('en', 'motion.menu.delete'), 'Delete motion');
});

test('Remove takes it off this object only and says it stays in the Library', () => {
  const { d, log } = deps(3);
  rows(motionMenu(d, hop, at))[0]!.run();
  assert.deepEqual(log, ['detach Hop', 'say 「Hop」を外しました。ライブラリに残っています']);
});

test('Delete on this object alone: no question, gone, and one line says ⌘Z brings it back', () => {
  const { d, log, menus } = deps(1);
  rows(motionMenu(d, hop, at))[1]!.run();
  assert.equal(menus.length, 0);
  assert.deepEqual(log, ['remove Hop', 'say 「Hop」を削除しました。⌘Z で戻せます']);
});

test('Delete when other objects have it: one line first, and nothing is deleted until the red row is pressed', () => {
  const { d, log, menus } = deps(3);
  rows(motionMenu(d, hop, at))[1]!.run();
  assert.deepEqual(log, []);
  assert.equal(menus.length, 1);
  assert.deepEqual(menus[0]![0], { note: 'ほかの 2 つの物からも外れます' });
  const yes = rows(menus[0]!);
  assert.equal(yes.length, 1);
  assert.equal(yes[0]!.danger, true);
  yes[0]!.run();
  assert.deepEqual(log, ['remove Hop', 'say 「Hop」を削除しました。⌘Z で戻せます']);
  assert.equal(translate('en', 'motion.delete.other1'), 'It also comes off 1 other object');
});

test('a motion with no Library motion behind it has only Remove', () => {
  const { d } = deps(1, []);
  assert.deepEqual(rows(motionMenu(d, hop, at)).map((x) => x.label), ['この物から外す']);
});

test('the Delete key never reaches the editor (it deletes the OBJECT) while the motion menu is open', () => {
  const menu = src('context-menu.ts');
  assert.match(menu, /holdDelete && \(k === 'Delete' \|\| k === 'Backspace'\)\)\) hide\(true\)/);
  const main = src('main.ts');
  assert.match(main, /place: 'card-motion'[^}]*holdDelete: true/);
  // A right-click on the row opens the motion's menu, not the pick's over the game.
  assert.match(main, /closest\?\.\('\[data-part="motion-row"\]'\)\) return;/);
  // The editor's Delete still deletes objects (keymap), the motion row adds no key of its own.
  assert.doesNotMatch(src('motion-card.ts'), /addEventListener\('keydown'/);
});
