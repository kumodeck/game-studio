// Words of the browser-only demo (English and Japanese, like the shell).
//
// `banner` is the one line at the top of every demo page (`bannerShort` is the same line on a phone, where the long
// one wrapped to two lines — the second design review's ⑪, 2026-10-19), and the only place the editor says the demo
// is a demo with no AI behind it (2026-10-18: the line in the ask box's place, "… Get Game Studio →", was
// taken out — the person is already using Game Studio). Plain words, no pitch. The rest replace
// shell strings (i18n.ts keys, through setExtraText) that would promise an AI
// hand-off: in the demo nothing picks a request up, so each says so plainly
// and that the same request reaches the AI in Claude Code on your computer
// (the brief for the demo, 2026-10-16). The person's own words stay in the line ({text});
// after an ask the line says "not connected" and the note under it says where
// the request would go (one sentence each: the first draft said both twice).
import type { Lang } from '../../contract.ts';

export const DEMO_TEXT: Record<Lang, Record<string, string>> = {
  en: {
    'demo.banner': 'Demo · Not connected to an AI · Saves stay in this browser',
    'demo.bannerShort': 'Demo · No AI · Saved in this browser',
    'demo.samples': 'Samples',
    'demo.memory': 'This browser can’t save here. Your changes are lost when you close the page.',
    'demo.missing': 'We couldn’t find that sample. Choose one from the list.',
    'ai.waitingAsk': '“{text}” — the demo isn’t connected to an AI',
    'ai.waiting': 'The demo isn’t connected to an AI. In Claude Code or Codex on your computer, your {what} goes to your AI.',
    'ai.waitingSaved': 'Saved in this browser. (The demo isn’t connected to an AI.)',
    'ask.sent': 'In Claude Code or Codex on your computer, this request goes to your AI.',
    'ask.nameSent': 'The demo isn’t connected to an AI. In Claude Code or Codex on your computer, your AI names them.',
    'next.sent': 'The demo isn’t connected to an AI. In Claude Code or Codex on your computer, this request goes to your AI. You can copy it.',
    // Save in the demo keeps the layout in this browser; no AI puts it in a game (2026-10-21: the editor's "Save to game"
    // and its tooltip promise that, so the demo keeps the plain words it had).
    'save.fab': 'Save',
    'save.unsavedTip': '{n:1 unsaved change|# unsaved changes}. Save keeps {n:it|them} in this browser',
    'play.unsaved': '{n:This change isn’t|These changes aren’t} saved yet',
  },
  ja: {
    'demo.banner': '試し版・AI にはつながっていません・保存はこのブラウザの中だけ',
    'demo.bannerShort': '試し版・AI なし・保存はこのブラウザだけ',
    'demo.samples': '見本',
    'demo.memory': 'このブラウザでは保存できません。ページを閉じると変更は消えます。',
    'demo.missing': 'その見本はありません。一覧から選んでください。',
    'ai.waitingAsk': '「{text}」— 試し版では AI にはつながっていません',
    'ai.waiting': '試し版では AI にはつながっていません。手元の Claude Code や Codex では、この{what}が AI に届きます。',
    'ai.waitingSaved': 'このブラウザの中に保存しました（試し版では AI にはつながっていません）。',
    'ask.sent': '手元の Claude Code や Codex では、この頼みが AI に届きます。',
    'ask.nameSent': '試し版では AI にはつながっていません。手元の Claude Code や Codex では、AI が名前を付けます。',
    'next.sent': '試し版では AI にはつながっていません。手元の Claude Code や Codex では、この頼みが AI に届きます。「頼む文をコピー」で写せます。',
    'save.fab': '保存',
    'save.unsavedTip': 'まだ保存していない変更が {n} 個あります。保存するとこのブラウザの中に残ります',
    'play.unsaved': 'この変更はまだ保存していません',
  },
};
