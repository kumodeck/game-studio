// The web demo's samples in their "AI delivered it" form (pause walk 2 fix ✕3, 2026-10-28).
//
// WHY: the web demo is where people without the plugin meet the paused moment first, and it has no
// AI. Neon Run shipped as the example does — without codeMoment() — so "This moment" said "The game's numbers, like the
// score, aren't shown here yet." with nothing to press, and ⚑ "This game can't start from the middle yet." (walk 2 ✕3):
// none of stages 2-3 could be seen there. Here the demo's COPY of a sample gets the code an AI writes when asked (✦ Have
// Claude connect this moment to the game; SKILL.md "This moment", "Checkpoints"): pause → Time left 5 → Resume, and the
// run FINISHes in 5 seconds.
// The example itself stays as it ships (examples/three-neon-boss/: without codeMoment), because that is what a person's
// own game is at first, and what the screen tests' "no codeMoment" cases and the docs' "not yet" line show.
//
// build-web-demo.mjs applies `deliver(id, src)` to each copied sample's file named here; a sample not named is copied as
// it is. Each entry checks the lines it hooks onto: an example that changed under it fails the build (it does not ship
// a demo game that silently lost its hooks).

/**
 * Neon Run (examples/three-neon-boss): the values (the HUD's own rounding — Math.floor — so This moment and the HUD say
 * the same "13,099": walk 2 ✕8) and save / load (the run's seed, numbers, the ship, the hexagons, the boss, the drones,
 * the shots; placed things come from the scene). The names are the HUD's words in English (SCORE, TIME): the demo is one
 * build for every language, and the names are the game's words, not the editor's.
 */
const NEON_RUN = `
// This moment (what an AI writes when asked: SKILL.md "This moment" and "Checkpoints"; the web demo's copy only —
// scripts/web-demo-delivered.mjs). The numbers as the HUD rounds them; save / load keep the run's own state.
codeMoment({
  values: {
    score: { name: 'Score', get: () => Math.floor(score), set: (v) => { score = v; }, round: 0 },
    timeLeft: { name: 'Time left', unit: 's', min: 0, get: () => timeLeft, set: (v) => { timeLeft = v; } },
    hp: { name: 'Health', min: 0, max: maxHp, step: 1, get: () => hp, set: (v) => { hp = v; } },
  },
  save: () => ({
    v: 1, seed, score, timeLeft, hp, over, t, fireIn,
    ship: { x: ship.position.x },
    hexes: hexes.map((h) => [h.position.x, h.position.z, h.rotation.y]),
    boss: boss ? { p: boss.position.toArray(), ry: boss.rotation.y } : null,
    drones: drones.map((d) => d.position.toArray()),
    shots: shots.map((s) => s.position.toArray()),
  }),
  load: (m) => {
    if (!m || m.v !== 1) return;
    ({ seed, score, timeLeft, hp, over, t, fireIn } = m);
    ship.position.x = m.ship.x;
    m.hexes.forEach(([x, z, ry], i) => { if (hexes[i]) { hexes[i].position.x = x; hexes[i].position.z = z; hexes[i].rotation.y = ry; } });
    if (m.boss) {
      if (!boss) spawnBoss();
      boss.position.fromArray(m.boss.p);
      boss.rotation.y = m.boss.ry;
    }
    if (m.drones.length && !drones.length) spawnDrones();
    m.drones.forEach((p, i) => drones[i]?.position.fromArray(p));
    for (const p of m.shots) {
      fire(); // this game's fire() pushes the new shot into shots and returns nothing
      shots[shots.length - 1].position.fromArray(p);
    }
    if (over) {
      endEl.textContent = hp <= 0 ? 'GAME OVER' : 'FINISH';
      endEl.hidden = false;
    }
  },
});
`;

const IMPORT = "import { applyPlacement } from './studio-placement.js';";
const AFTER = 'const speed = 12;\n';

/** Sample id → its file and how the delivered form goes in. */
export const DELIVERED = {
  'three-neon-boss': {
    file: 'game.js',
    deliver(src) {
      if (!src.includes(IMPORT) || !src.includes(AFTER)) throw new Error('web-demo-delivered: examples/three-neon-boss/game.js changed (its import or `const speed = 12;`): update scripts/web-demo-delivered.mjs');
      return src.replace(IMPORT, "import { applyPlacement, codeMoment } from './studio-placement.js';").replace(AFTER, `${AFTER}${NEON_RUN}`);
    },
  },
};

/** The sample's file in its delivered form, or null when the demo ships this sample as it is. */
export function deliveredFile(id) {
  return DELIVERED[id]?.file ?? null;
}
