// The shelf's words (shelf.ts: the samples a folder without a game opens on; shelf-tour.ts: the one card that guides
// the first three tries after one opens). English is the fallback for every key. How to word them: docs/VOICE.md.
// Kept apart from i18n.ts (decided 2026-11-06): the shelf is drawn before the editor starts, and its words change
// together, not with the editor's.
import type { Lang } from '../contract.ts';
import { plural } from './i18n.ts';

const en = {
  'title': 'Start with a sample',
  // One line under the title: what these are and what to do with them (no feature list: the moving pictures show it).
  'lead': 'Small games to move, pause and ask your AI about. Open one and play with it for a minute, then make your own.',
  'own': 'Have a game already?',
  'own.how': 'Open its folder with your AI and type {cmd}',
  'crumb': 'New game',
  'coming': 'Coming',
  'playing': 'Playing',
  'meta': '{engine} · {dim}',
  'dim.3d': '3D',
  'dim.2d': '2D',
  'back': 'All samples',
  'open': 'Open {title}',
  'opening': 'Opening {title}…',
  'openFailed': 'Couldn’t open it: {e}',
  'hasGame': 'This folder has a game now. Reload to open it.',
  // The three tries, in the same order for every sample (decided 2026-11-06): move it, pause and ask, clip it.
  'step.move': 'Move',
  'step.move.with': 'Drag the {move}.',
  'step.move.any': 'Drag anything in the game.',
  'step.move.more': 'It stays where you put it, even while it plays.',
  'step.pause': 'Play, then press P',
  'step.pause.at': 'at about {s} s.',
  'step.pause.any': 'when something good happens.',
  'step.pause.more': 'Ask for a change right there:',
  'step.clip': '● Clip',
  'step.clip.more': 'the Before / After: 10 s, ready to post.',
  // The guide after it opens: one card at a time, three at most, Skip any time and never again.
  'tour.head': 'Try {title} · {n} of {all}',
  'tour.move': 'Drag the {move}',
  'tour.moveAny': 'Drag anything in the game',
  'tour.moveMore': 'It keeps doing what it does from where you put it.',
  'tour.next': 'Next',
  'tour.play': 'Press Play. Pause at about {s} s',
  'tour.playAny': 'Press Play. Pause when something good happens',
  'tour.playMore': 'Press P to stop that moment, then ask for a change right there.',
  // A sample whose ask says "here" (starter.json `try.mark`): point at the spot first. A hint, not a step of its own.
  'tour.playMoreMark': 'Press P to stop that moment, press ◎ Mark and point at the spot, then ask.',
  'tour.clip': 'When the change is in, press ● Clip',
  'tour.clipMore': 'You get a 10-second Before / After, ready to post.',
  'tour.done': 'Done',
  'tour.skip': 'Skip',
  'tour.key': 'play / pause',
  'try.ask': 'Try asking',
  'try.askTip': 'Puts it in the field. Press Return to send it.',
  'ask.quote': '“{text}”',
};
type Key = keyof typeof en;

const ja: Partial<Record<Key, string>> = {
  'title': '見本から始める',
  'lead': '動かして、止めて、AI に頼める小さなゲームです。1 つ開いて 1 分遊んでから、自分のゲームを作りましょう。',
  'own': 'もうゲームがある？',
  'own.how': 'そのフォルダを AI で開いて {cmd} と打つ',
  'crumb': '新しいゲーム',
  'coming': '準備中',
  'playing': '再生中',
  'back': 'すべての見本',
  'open': '{title} を開く',
  'opening': '{title} を開いています…',
  'openFailed': '開けませんでした: {e}',
  'hasGame': 'このフォルダにゲームができました。読み込み直すと開きます。',
  'step.move': '動かす',
  'step.move.with': '{move} をドラッグ。',
  'step.move.any': 'ゲームの中の物をどれでもドラッグ。',
  'step.move.more': '動いている間も、置いた所にいます。',
  'step.pause': '▶ で遊んで P で止める',
  'step.pause.at': '{s} 秒ごろ。',
  'step.pause.any': 'いい場面が来たら。',
  'step.pause.more': 'その場面で直してほしい事を頼む:',
  'step.clip': '● Clip',
  'step.clip.more': 'で前 / 後の 10 秒の動画。そのまま投稿できます。',
  'tour.head': '{title} を試す · {n} / {all}',
  'tour.move': '{move} をドラッグ',
  'tour.moveAny': 'ゲームの中の物をどれでもドラッグ',
  'tour.moveMore': '置いた所から、いつもの動きを続けます。',
  'tour.next': '次へ',
  'tour.play': '▶ で遊んで、{s} 秒ごろに止める',
  'tour.playAny': '▶ で遊んで、いい場面で止める',
  'tour.playMore': 'P でその場面を止めて、そこで直してほしい事を頼みます。',
  'tour.playMoreMark': 'P でその場面を止めて、◎ 印で場所を指してから頼みます。',
  'tour.clip': '直ったら ● Clip を押す',
  'tour.clipMore': '前 / 後の 10 秒の動画ができます。そのまま投稿できます。',
  'tour.done': '終わり',
  'tour.skip': 'スキップ',
  'tour.key': '遊ぶ / 止める',
  'try.ask': '頼んでみる',
  'try.askTip': '入力欄に入ります。Return で送ります。',
  'ask.quote': '「{text}」',
};

export function shelfText(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  const s = (lang === 'ja' ? ja[key] : undefined) ?? en[key];
  return plural(s, vars).replace(/\{(\w+)\}/g, (_m, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

type Words = { en?: string; ja?: string } | null | undefined;

/**
 * A sample's own words in `lang` (its starter.json for English, its strings.json for the others: the server puts both
 * in). Japanese falls back to English; English never shows another language. Decided 2026-11-06: no stand-ins here any
 * more, every sample on the shelf carries its own words.
 */
function pick(lang: Lang, w: Words): string {
  return (lang === 'ja' ? w?.ja || w?.en : w?.en) || '';
}
/** What a sample's "Try asking" says in `lang`. */
export function askWords(lang: Lang, ask: Words): string {
  return pick(lang, ask);
}
/**
 * The thing to move as a person reads it ("duck", not "duck_1"): `moveName` from the server, else the raw `move`.
 * In another language the English name follows in brackets (the Japanese word, then "(lighthouse)"): the editor's list shows
 * the game's own names, which are English, so the person can find it there (seen in the shots, 2026-11-06).
 */
export function moveWords(lang: Lang, tr: { move?: string; moveName?: Words } | null | undefined): string {
  const en = tr?.moveName?.en || tr?.move || '';
  if (lang === 'ja' && tr?.moveName?.ja) return en && en !== tr.moveName.ja ? `${tr.moveName.ja}（${en}）` : tr.moveName.ja;
  return en;
}
/** The card's line in `lang`: strings.json's `blurb` (the server's `blurbs`), else starter.json's English. */
export function blurbWords(lang: Lang, it: { blurb: string; blurbs?: { ja?: string } }): string {
  return (lang === 'ja' ? it.blurbs?.ja : undefined) || it.blurb;
}
