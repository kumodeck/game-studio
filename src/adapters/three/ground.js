/**
 * Which listed 3D objects are the ground, a road, the sea or the sky (Item.backdrop in 3D). Pure maths on world boxes
 * { min: [x,y,z], max: [x,y,z] } and names, so it can be tested without WebGL (test/hold.test.ts).
 *
 * WHY (a hands-on try of 2026-10-19, item 4): "just trying things out, the road (the ground) ended up 16 m up, and
 * I could save it like that". 2D already keeps its ground / background at the back (core/port2d.ts backdropRun);
 * 3D had nothing, so the road was one list pick and one Height drag away from flying. The editor holds what this
 * finds still (bridge/hold.ts) until the person presses "Make movable".
 *
 * A listed object is a ground / sky when:
 * - its name's last word says so (groundName: ground, road, sea, sky, and the same words in Japanese), whatever its size; or
 * - its box is far bigger than a typical object's: more than 20× (a sky dome, a sea), or more than 6× and flat (a
 *   ground plane, a long road). The same two rules focus.js sceneSphere uses to leave such boxes out of "frame all",
 *   so what the camera ignores and what the editor holds are the same things.
 * Never every object (a scene of only big things is all "things" the person may want to place), and the size rules
 * need at least three objects (two boxes say nothing about what is typical).
 */
import { sphereOf } from './focus.js';

/**
 * The name's LAST word says ground / road / sea / sky ("ground", "main-road", "Sky_01", "oceanFloor"): an English
 * compound is named by its last word, so "sea-stack" (a rock), "road-sign" and "skyline" are things, not grounds.
 * WHY not core/port2d.ts BACKDROP_NAME as it is: it matches a ground word anywhere, which in 2D only decides draw
 * order at the very back of a list; here it held Lantern Cove's sea stacks still (found by test/web-demo-move,
 * 2026-10-19). Japanese names: the same words as 2D (a whole name, or ending in sea / sky).
 */
const GROUND_WORDS = new Set(['ground', 'floor', 'terrain', 'background', 'backdrop', 'bg', 'sky', 'skybox', 'skydome', 'road', 'street', 'sea', 'ocean', 'water']);
const JA_GROUND = /^(地面|背景|床|地形|道路|水面)$|地面$|道路$|海$|空$/;
export function groundName(label) {
  const words = String(label || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/).filter((w) => w && !/^\d+$/.test(w));
  const last = words[words.length - 1] || '';
  return GROUND_WORDS.has(last) || JA_GROUND.test(last);
}

/**
 * @param {Array<{ key: string, label?: string, named?: boolean, box: { min: number[], max: number[] } | null }>} list
 *   `named` = the label is the game's own name (an unnamed object's label is its key, which says nothing)
 * @returns {Set<string>} the keys of the grounds / skies
 */
export function groundKeys(list) {
  const out = new Set();
  const sized = list.filter((e) => e.box);
  const radii = sized.map((e) => sphereOf(e.box).r).sort((a, b) => a - b);
  const typical = radii[Math.floor(radii.length / 2)] || 1;
  for (const e of list) {
    if (e.named !== false && groundName(e.label)) {
      out.add(e.key);
      continue;
    }
    if (!e.box || sized.length < 3) continue;
    const b = e.box;
    const r = sphereOf(b).r;
    const flat = b.max[1] - b.min[1] < 0.05 * Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
    if (r > typical * 20 || (flat && r > typical * 6)) out.add(e.key);
  }
  return out.size >= list.length ? new Set() : out;
}
