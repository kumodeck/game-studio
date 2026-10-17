// Entry of dist/studio-edit.js — the edit script injected as the first child
// of <head> in the game page, so it runs before any game code.
//
// Order matters:
// 1. core (time control + load log) wraps browser APIs before the game uses them
// 2. built-in probes install their engine hooks (e.g. __THREE_DEVTOOLS__)
// 3. window.studio is published so `.studio/adapter.js` (loaded next by the
//    host, still before the game) can register an AI-written adapter
// 4. after the first frame, the bridge picks an adapter and talks to the shell
// Capture the browser's own rAF before any wrapper (see core/native.ts).
import '../core/native.ts';
// boot.js (classic, side effects only) must run before everything else of
// the three.js adapter: it installs __THREE_DEVTOOLS__ and wraps rAF/render.
import '../adapters/three/boot.js';
import { threeProbe } from '../adapters/three/index.ts';
import { startBridge } from './bridge.ts';

startBridge({ builtins: [threeProbe] });
