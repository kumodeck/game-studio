// Words of the web demo's sample list (index.html), English and Japanese.
// A file of its own so the page's translations sit with the other UI translations
// (the editor's are in src/shell/i18n.ts and src/hosts/browser/text.ts).
window.DEMO_LIST_TEXT = {
  en: {
    line: 'Demo · saves stay in this browser only',
    title: 'Game Studio',
    lead: 'Move, turn and resize the things in a game, right in your browser. Pick a sample.',
    foot: 'Nothing is sent anywhere: what you change stays in this browser. This demo is not connected to an AI.',
    open: 'Open',
    error: 'Could not read the list of samples.',
    // The samples' English lines come from each starter's starter.json ("blurb"), via studio/games.json.
  },
  ja: {
    line: '試し版・保存はこのブラウザの中だけ',
    title: 'ゲームスタジオ',
    lead: 'ゲームの中の物を、ブラウザの中で動かす・回す・大きさを変える。見本を選んでください。',
    foot: 'どこにも送りません。変えたものはこのブラウザの中だけに残ります。試し版は AI にはつながっていません。',
    open: '開く',
    error: '見本の一覧を読めませんでした。',
    // Translations of each starter.json "blurb" (update when starters/<id>/starter.json changes).
    'lantern-cove': '夕暮れの静かな港。澄んだ水、灯台、本当に浮かぶ舟。水をタップすると舟が進みます。',
    'firefly-ruins': '夕日の池のほとりに古い石の門。ホタルが出てきて、タップすると風が吹きます。',
  },
};
