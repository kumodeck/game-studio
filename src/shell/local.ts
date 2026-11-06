// Entry of studio-shell.js: the shell page served by the local server
// (skills/arrange/bin/studio.mjs), talking to it through createLocalHost().
// The browser-only web demo has its own entry (src/hosts/browser/main.ts).
//
// A folder without a game opens on the shelf of samples instead of the editor (shelf.ts, decided 2026-11-06): the
// server says which (api/open `shelf: true`). After a sample is picked the page reloads into the editor, and the
// one-card guide (shelf-tour.ts) runs beside it once.
import { start } from './main.ts';
import { createLocalHost } from './host-local.ts';
import { showShelf, createShelfHost } from './shelf.ts';
import { startTour } from './shelf-tour.ts';

const host = createLocalHost();
const shelf = createShelfHost();
void shelf.isShelf().then((on) => {
  if (on) return showShelf(host, shelf);
  start(host);
  startTour();
});
