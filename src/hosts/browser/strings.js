// Words of the web demo's front page (index.html + lp.js), English and Japanese.
// A file of its own so the page's translations sit with the other UI translations
// (the editor's are in src/shell/i18n.ts and src/hosts/browser/text.ts).
// `line` is the same words as the editor's top line (src/hosts/browser/text.ts, demo.banner).
// "W A S D" is written with no-break spaces so a phone never splits the keys across two lines.
// Voice: docs/VOICE.md (name the thing, no pitch, sentence case). The product line (title) is the README's first sentence.
// It names what Game Studio is: a free level editor for the web games your AI makes (2026-10-29). The line before it
// promised to make the person's AI a game studio instead of naming the tool; "level editor" is also what three.js,
// Phaser and PixiJS makers search for.
// pageTitle and description are also what search results and link previews show (scripts/web-demo-lp.mjs and
// scripts/seo.mjs put them in the built page, 2026-10-29): the words people search for ("free", "level editor",
// "Claude Code", "Codex", "three.js"), kept true. A title of about 60 characters and a description of about 150 show
// whole in search results (Japanese: about 30 and 80).
window.DEMO_LIST_TEXT = {
  en: {
    pageTitle: 'KUMODeck Game Studio: free level editor for Claude Code and Codex',
    description: 'A free level editor for the web games your AI makes. Move things in your three.js, Phaser or PixiJS game, click Save, and Claude Code or Codex updates the code.',
    // The link-preview picture (og:image): the editor on the 3D sample, as the README's picture.
    socialAlt: 'The Game Studio editor on Lantern Cove, a 3D sample game, with the lighthouse selected',
    posterAlt: '{title}, a sample game',
    brand: 'Game Studio',
    github: 'GitHub',
    docs: 'Docs',
    title: 'A free level editor for the web games your AI makes.',
    lead: 'Move things around in your game by hand, click Save, and Claude Code or Codex updates the code.',
    installLabel: 'Paste this into Claude Code or Codex',
    copy: 'Copy',
    copied: 'Copied',
    installNote: 'Needs Node.js 22.13 or later. Free, runs on your computer, no account.',
    repoLink: 'View on GitHub →',
    tryTitle: 'Try it here',
    tryLead: 'This is the editor itself, on a sample game. Select something and drag it.',
    full: 'Open full size ↗',
    loading: 'Opening the editor…',
    open: 'Open the editor →',
    hintIdle: 'Click the editor to use it. Until then, scrolling moves this page.',
    hintActive: 'Using the editor. Keys stay in it; click outside it to scroll the page.',
    tap: 'Tap to open the editor',
    phoneNote: 'Opens the editor on its own page. The 3D sample takes a little while on a phone.',
    line: 'Demo · Not connected to an AI · Saves stay in this browser',
    f1Title: 'Arrange by hand',
    f1: 'Select anything in your game and drag it. Turn, lift and resize it from the strip under it. In 3D, fly around with W A S D.',
    f2Title: 'Save, and your AI updates the game',
    f2: 'Ask for a change in place, like “add three more like this.” Click Save and your AI updates your code. The editor never edits it.',
    f3Title: 'See every asset',
    f3: 'The Library lists every image, model and sound your game uses, and the objects you can add to the scene.',
    engines: 'three.js works out of the box. For PixiJS, Phaser, canvas, DOM or a Godot web export, your AI writes a small adapter.',
    kdTitle: 'Optional: KUMODeck',
    kd: 'Sign in with KUMODeck to make images and 3D models with AI, paid with credits. Everything else works without an account.',
    kdLink: 'About KUMODeck →',
    foot: 'Nothing on this page is sent anywhere: what you change in the demo stays in this browser.',
    license: 'MIT License',
    error: 'Could not read the list of samples.',
    // The samples' English lines come from each starter's starter.json ("blurb"), via studio/games.json.
  },
  ja: {
    pageTitle: 'KUMODeck ゲームスタジオ｜Claude Code・Codex で使える無料のレベルエディタ',
    description: 'AI が作るウェブゲームのための無料のレベルエディタ。three.js・Phaser・PixiJS のゲームの物を手で動かして保存すると、Claude Code や Codex がコードに反映します。',
    socialAlt: 'ゲームスタジオのエディタで、3D の見本のゲーム「Lantern Cove」の灯台を選んだところ',
    posterAlt: '見本のゲーム「{title}」',
    brand: 'ゲームスタジオ',
    github: 'GitHub',
    docs: '使い方',
    title: 'AI が作るウェブゲームのための、無料のレベルエディタ。',
    lead: 'ゲームの中の物を手で動かして保存すると、Claude Code や Codex がコードに反映します。',
    installLabel: 'Claude Code か Codex に、この 1 行を貼ってください',
    copy: 'コピー',
    copied: 'コピーしました',
    installNote: 'Node.js 22.13 以降が必要です。無料で、手元のパソコンで動き、アカウントは要りません。',
    repoLink: 'GitHub で見る →',
    tryTitle: 'ここで試す',
    tryLead: 'エディタそのものです。見本のゲームで、物を選んでドラッグしてみてください。',
    full: '大きく開く ↗',
    loading: 'エディタを開いています…',
    open: 'エディタを開く →',
    hintIdle: 'エディタをクリックすると操作できます。それまではスクロールでこのページが動きます。',
    hintActive: 'エディタを操作中です。キーはエディタに届きます。外をクリックするとページをスクロールできます。',
    tap: 'タップでエディタを開く',
    phoneNote: 'エディタを別のページで開きます。3D の見本はスマホでは少し時間がかかります。',
    line: '試し版・AI にはつながっていません・保存はこのブラウザの中だけ',
    f1Title: '手で並べる',
    f1: 'ゲームの中の物を選んで、ドラッグで動かします。下の帯で回す・持ち上げる・大きさを変える。3D では W A S D で見回せます。',
    f2Title: '保存すると、AI がゲームに反映',
    f2: '「これをあと 3 つ」のように、その場で AI に頼めます。保存すると AI がコードを直します。エディタがコードを書き換えることはありません。',
    f3Title: '素材をひと目で',
    f3: 'ライブラリに、ゲームが使う画像・モデル・音と、シーンに足せる物が並びます。',
    engines: 'three.js はそのまま使えます。PixiJS・Phaser・canvas・DOM・Godot の Web 書き出しでは、AI が小さなアダプタを書きます。',
    kdTitle: '任意: KUMODeck',
    kd: 'KUMODeck にログインすると、AI で画像や 3D モデルを作れます（クレジットで支払い）。それ以外はアカウントなしで使えます。',
    kdLink: 'KUMODeck について →',
    foot: 'このページからは何も送りません。試し版で変えたものは、このブラウザの中だけに残ります。',
    license: 'MIT ライセンス',
    error: '見本の一覧を読めませんでした。',
    // Translations of each starter.json "blurb" (update when starters/<id>/starter.json changes).
    'big-swell': '夕日の荒れた海。アヒル・ブイ・いかだ・木箱が波に乗り、数秒おきに大波が全部を持ち上げます。水をタップすると木箱が落ちます。',
    'lantern-cove': '夕暮れの静かな港。澄んだ水、灯台、本当に浮かぶ舟。水をタップすると舟が進みます。',
    'firefly-ruins': '夕日の池のほとりに古い石の門。ホタルが出てきて、タップすると風が吹きます。',
    // Domino Spiral and Marble Rain: the same words as their strings.json "blurb" (keep the two in step).
    'domino-spiral': '暗い鏡の床に、光るドミノ約 400 枚がうず巻きに並びます。鉄の球が最初の 1 枚を倒します。先頭をドラッグすると、列ぜんぶがついてきます。',
    'marble-rain': '光る玉が何百も、三角に並んだピンの間を落ちて、下の箱にたまります。ピンを 1 本動かすと、玉の落ち方が変わります。',
    // The paused moment's sample (examples/three-neon-boss, added with --also; pause-edit fix 1).
    'three-neon-boss': 'ネオンの道を走るゲーム。数秒でボスが来ます。来たら ❚❚ で止めて、その瞬間だけ動かせます。',
  },
};
