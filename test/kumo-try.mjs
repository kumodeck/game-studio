// Try "Make with AI" by hand before the real KUMODeck has it: a fake KUMODeck (test/kumo-fake.mjs)
// and the studio on a copy of a game, with a made-up sign-in in a temporary HOME. Your real
// ~/.kumo is not read or written; nothing leaves the machine; nothing is charged.
//
//   node test/kumo-try.mjs <game folder> [--signed-out]
//
// Prints the editor link. Open it, go to Assets → Make with AI. --signed-out starts without the
// sign-in (the "npx kumodeck login" view); the fake sign-in appears 20 s later, then press
// "I signed in". The 3D model takes about 20 s here (minutes on the real one). Ctrl+C to stop.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { fakeKumoServer, FAKE_KUMO_PROJECT } from './kumo-fake.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const signedOut = args.includes('--signed-out');
const root = args.find((a) => !a.startsWith('--'));
if (!root || !existsSync(join(root, 'index.html'))) {
  console.error('Usage: node test/kumo-try.mjs <game folder with index.html> [--signed-out]');
  process.exit(2);
}
if (existsSync(join(root, 'kumo.json'))) {
  console.error('This folder already has kumo.json (a real KUMODeck project). Use a copy of an example instead.');
  process.exit(2);
}
const home = mkdtempSync(join(tmpdir(), 'studio-kumo-try-'));
const kumo = await fakeKumoServer({ delayMs: 10000 });
writeFileSync(join(root, 'kumo.json'), JSON.stringify({ projectId: FAKE_KUMO_PROJECT, api: kumo.api }));
const signIn = () => {
  mkdirSync(join(home, '.kumo'), { recursive: true });
  writeFileSync(join(home, '.kumo/credentials.json'), kumo.credentials());
};
if (signedOut) setTimeout(() => (signIn(), console.log('(fake) signed in now: press "I signed in"')), 20000);
else signIn();
const srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), kumo: { home, env: {} } });
console.log(`Open: ${srv.url}&tool=library`);
console.log(`(fake KUMODeck: balance $5.00; kumo.json was written in the folder and is removed on Ctrl+C)`);
process.on('SIGINT', async () => {
  await srv.close();
  await kumo.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(join(root, 'kumo.json'), { force: true });
  process.exit(0);
});
