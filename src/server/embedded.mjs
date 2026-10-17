// Files the server sends to the browser that are not part of the game or of the built UI:
// the local host client, the fallback page and the loader.
//
// In the source tree they are read from disk, so editing them needs no rebuild. The build
// (build.mjs) replaces this whole module with one that holds the same files as string constants,
// which is how studio.mjs stays a single file.

import { readFileSync } from 'node:fs';

const FILES = {
  'host.js': new URL('./local-host.client.js', import.meta.url),
  'fallback.html': new URL('./fallback.html', import.meta.url),
  'studio-placement.js': new URL('../loader/studio-placement.js', import.meta.url),
};

export function embedded(name) {
  return readFileSync(FILES[name], 'utf8');
}
