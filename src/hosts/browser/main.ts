// Entry of the web demo's editor page (studio/studio-web.js, built by
// scripts/build-web-demo.mjs): the same shell as the local studio, started
// with the browser-only host instead of the local server's.
//
// The page is studio/?game=<id>; the samples are listed in studio/games.json
// and live in ../games/<id>/. An unknown id goes back to the front page (../).
// `&embed=1`: the editor inside the front page's frame (embed.ts): no "← Samples" (the front page switches the
// samples itself), an unknown id opens the first sample (going "back" would put the front page inside its own frame),
// and the keys pressed in it don't scroll the front page.
import type { Lang } from '../../contract.ts';
import { start } from '../../shell/main.ts';
import { detectLang, setExtraText } from '../../shell/i18n.ts';
import { h } from '../../shell/dom.ts';
import { createBrowserHost, type DemoGame } from './host.ts';
import { openStore } from './store.ts';
import { DEMO_TEXT } from './text.ts';
import { holdPageScrollEverywhere, isEmbedded } from './embed.ts';

async function boot() {
  for (const l of Object.keys(DEMO_TEXT) as Lang[]) setExtraText(l, DEMO_TEXT[l]);
  const lang = detectLang(location.search, navigator.language || 'en');
  const tx = (key: string) => DEMO_TEXT[lang][key] ?? DEMO_TEXT.en[key] ?? key;
  const embedded = isEmbedded(location.search);

  // The one line at the top (the brief for the demo, 2026-10-16).
  // It sits above the shell, which is sized to the rest (demo.css), so nothing of the editor is covered.
  const line = h('span', { class: 'demo-text', text: tx('demo.banner') });
  const banner = h('div', { class: 'demo-banner', role: 'note' },
    ...(embedded ? [] : [h('a', { class: 'demo-back', href: '../', text: `← ${tx('demo.samples')}` })]), line);
  document.body.classList.add('studio-demo');
  if (embedded) {
    document.body.classList.add('studio-embed');
    holdPageScrollEverywhere(document);
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
  if (!store.persistent) line.textContent = `${tx('demo.banner')} — ${tx('demo.memory')}`;
  start(await createBrowserHost(game, '../games/', store));
}

void boot();
