// Entry of studio-shell.js: the shell page served by the local server
// (skills/arrange/bin/studio.mjs), talking to it through createLocalHost().
// The browser-only web demo has its own entry (src/hosts/browser/main.ts).
import { start } from './main.ts';
import { createLocalHost } from './host-local.ts';

start(createLocalHost());
