// Entry of the web demo's editor page (studio/studio-web.js, built by
// scripts/build-web-demo.mjs): the same shell as the local studio, started
// with the browser-only host instead of the local server's.
//
// The page is studio/?game=<id>; the samples are listed in studio/games.json
// and live in ../games/<id>/. An unknown id goes back to the front page (../).
// `&embed=1`: the editor inside the front page's frame (embed.ts): no "← Samples" (the front page switches the
// samples itself), an unknown id opens the first sample (going "back" would put the front page inside its own frame),
// the keys pressed in it don't scroll the front page, and the wheel scrolls that page until the editor is first pressed.
import type { Lang } from '../../contract.ts';
import { start } from '../../shell/main.ts';
import { detectLang, setExtraText } from '../../shell/i18n.ts';
import { h } from '../../shell/dom.ts';
import { createBrowserHost, type DemoGame } from './host.ts';
import { openStore } from './store.ts';
import { DEMO_TEXT } from './text.ts';
import { holdPageScrollEverywhere, isEmbedded, shareWheelUntilPressed } from './embed.ts';

async function boot() {
  for (const l of Object.keys(DEMO_TEXT) as Lang[]) setExtraText(l, DEMO_TEXT[l]);
  const lang = detectLang(location.search, navigator.language || 'en');
  const tx = (key: string) => DEMO_TEXT[lang][key] ?? DEMO_TEXT.en[key] ?? key;
  const embedded = isEmbedded(location.search);

  // The one line at the top (the brief for the demo, 2026-10-16).
  // It sits above the shell, which is sized to the rest (demo.css), so nothing of the editor is covered.
  // Two spellings of the same line: the long one on a PC, the short one on a phone (demo.css picks), so the phone's line
  // is one line too (the second design review's ⑪, 2026-10-19: the long one wrapped to two there).
  const long = h('span', { class: 'demo-long', text: tx('demo.banner') });
  const short = h('span', { class: 'demo-short', 'aria-hidden': 'true', text: tx('demo.bannerShort') });
  const line = h('span', { class: 'demo-text' }, long, short);
  const banner = h('div', { class: 'demo-banner', role: 'note' },
    ...(embedded ? [] : [h('a', { class: 'demo-back', href: '../', text: `← ${tx('demo.samples')}` })]), line);
  document.body.classList.add('studio-demo');
  if (embedded) {
    document.body.classList.add('studio-embed');
    holdPageScrollEverywhere(document);
    shareWheelUntilPressed(document);
  }
  document.body.prepend(banner);

  const res = await fetch('games.json', { cache: 'no-cache' });
  const manifest = (await res.json()) as { games: DemoGame[] };
  const id = new URLSearchParams(location.search).get('game');
  const game = manifest.games.find((g) => g.id === id) ?? (embedded ? manifest.games[0] : undefined);
  if (!game) {
    location.replace('../');
    return;
  }
  const store = await openStore();
  if (!store.persistent) {
    long.textContent = `${tx('demo.banner')} — ${tx('demo.memory')}`;
    short.textContent = `${tx('demo.bannerShort')} — ${tx('demo.memory')}`;
  }
  start(await createBrowserHost(game, '../games/', store));
}

void boot();
