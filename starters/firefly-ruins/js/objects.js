// Firefly Ruins — the 14 things you can arrange.
//
// Each is a Container with `studioKey` (its stable name in the editor). Its children (the painted picture, a soft
// contact shadow, a flame, a swinging bell…) have NO label, so the editor treats the whole container as one object.
// Animations only ever touch children, so the pose the editor reads/writes is the user's placement alone.
// Live parts are kept in `parts` (a WeakMap), not on the objects: the editor's Copy builds a fresh container and
// would not carry custom fields anyway.
import { Assets, Container, Graphics, MeshPlane, Sprite } from 'pixi.js';
import * as P from './paint.js';
import { WATER } from './backdrop.js';

export const parts = new WeakMap();

// ------------------------------------------------------------------ files (assets/)
// WHY files (2026-10-17): with every picture painted in code, the editor's Assets panel had nothing to show. These
// four pictures and the bell's sound are real files now (made by scripts/make-starter-assets.mjs in the Game Studio
// package, ≈ 0.26 MB together). Each has the same size, anchor and hang points as its painter in paint.js, which
// stays as the fallback: a missing or broken file never breaks the scene.
// Pictures are painted at 3× their size in the world: `resolution: 3` makes a 156×180 bell.png 52×60 world px.
// WHY Pixi's Assets loader: the texture then remembers its URL, which is how the editor tells "Used by: bell".
export const FILES = {
  bell: 'assets/bell.png',
  lantern: 'assets/lantern.png',
  boat: 'assets/boat.png',
  banner: 'assets/banner.png',
  bellSound: 'assets/bell.mp3', // played by life.js; marked on the bell (studioAsset) so the editor lists it there
};
/** Load the pictures in FILES: { bell, lantern, boat, banner } → Texture, or null when that file did not load. */
export async function loadPictures() {
  const out = {};
  await Promise.all(['bell', 'lantern', 'boat', 'banner'].map(async (k) => {
    out[k] = await Assets.load({ src: FILES[k], data: { resolution: 3 } }).catch(() => {
      console.warn(`[ruins] ${FILES[k]} did not load: painted in code instead`);
      return null;
    });
  }));
  return out;
}
const FOOT = WATER - 4; // where things stand on the bank

const shadowTex = P.paint(128, 32, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(6,10,14,0.55)'); g.addColorStop(1, 'rgba(6,10,14,0)');
  ctx.save(); ctx.scale(1, h / w); ctx.fillStyle = g; ctx.fillRect(0, 0, w, w); ctx.restore();
});
const glowWarm = P.glowTexture(64, 'rgba(255,220,150,1)', 'rgba(255,130,40,0)');

function sprite({ tex, ax, ay }, x = 0, y = 0) {
  const s = new Sprite(tex);
  s.anchor.set(ax, ay);
  s.position.set(x, y);
  return s;
}
function thing(key, x, y = FOOT, shadowW = 0) {
  const c = new Container();
  c.studioKey = key;
  c.position.set(x, y);
  if (shadowW) {
    const sh = new Sprite(shadowTex);
    sh.anchor.set(0.5);
    sh.width = shadowW;
    sh.height = shadowW * 0.16;
    sh.y = 2;
    c.addChild(sh);
  }
  return c;
}

/** `pics` = loadPictures(); a missing one is painted by paint.js instead. */
export function makeObjects(pics = {}) {
  const art = (tex, ax, ay, painter) => (tex ? { tex, ax, ay } : painter());
  const back = []; // stand on the bank (drawn before the pond)
  const front = []; // in or over the water (drawn after the pond)

  const bellFrame = thing('bell', 92, FOOT, 130);
  bellFrame.addChild(sprite(P.paintBellFrame()));
  const bell = sprite(art(pics.bell, 0.5, 0, P.paintBell), 0, -170);
  bellFrame.studioAsset = FILES.bellSound;
  bellFrame.addChild(bell);
  parts.set(bellFrame, { bell, angle: 0, vel: 0 });
  back.push(bellFrame);

  const head = thing('giant-head', 250, FOOT + 6, 260);
  head.addChild(sprite(P.paintGiantHead()));
  back.push(head);

  const stone1 = thing('stone-1', 400, FOOT + 2, 150);
  stone1.addChild(sprite(P.paintStone(0)));
  back.push(stone1);

  // Banner: a pole with a cloth that moves in the wind (verlet cloth, drawn as shaded quads each frame).
  const banner = thing('banner', 462, FOOT + 2, 50);
  const pole = new Graphics().rect(-3, -250, 6, 250).fill(0x2a2018).rect(-3, -250, 2, 250).fill({ color: 0xd59a5c, alpha: 0.6 });
  const cloth = new Graphics();
  // With assets/banner.png the cloth is that picture laid on the moving points (a MeshPlane with the same 7×9 grid),
  // and `cloth` only adds the light and shade of the folds on top. Without it, `cloth` draws the whole banner.
  const clothMesh = pics.banner ? new MeshPlane({ texture: pics.banner, verticesX: 7, verticesY: 9 }) : null;
  if (clothMesh) banner.addChild(pole, clothMesh, cloth);
  else banner.addChild(pole, cloth);
  parts.set(banner, { cloth, mesh: clothMesh, sim: makeCloth(7, 9, 9, 14, -244) });

  const arch = thing('arch', 610, FOOT + 2, 330);
  arch.addChild(sprite(P.paintArch()));
  back.push(arch);
  const stairs = thing('stairs', 610, FOOT + 6, 0);
  stairs.addChild(sprite(P.paintStairs()));
  back.push(stairs);
  back.push(banner); // in front of the gate's left pier, so the cloth flies across the stone

  const urn = thing('urn', 728, FOOT, 50);
  urn.addChild(sprite(P.paintUrn()));
  back.push(urn);

  const pillar1 = thing('pillar-1', 800, FOOT, 80);
  pillar1.addChild(sprite(P.paintPillar(true)));
  back.push(pillar1);
  const pillar2 = thing('pillar-2', 872, FOOT + 4, 80);
  pillar2.addChild(sprite(P.paintPillar(false)));
  pillar2.rotation = 0.08;
  back.push(pillar2);

  const lantern = thing('lantern', 950, FOOT, 70);
  lantern.addChild(sprite(art(pics.lantern, 0.5, 1, P.paintLanternBody)));
  const flame = new Sprite(glowWarm);
  flame.anchor.set(0.5);
  flame.position.set(0, -86);
  flame.blendMode = 'add';
  const halo = new Sprite(glowWarm);
  halo.anchor.set(0.5);
  halo.position.set(0, -86);
  halo.scale.set(3.2);
  halo.alpha = 0.35;
  halo.blendMode = 'add';
  lantern.addChild(halo, flame);
  parts.set(lantern, { flame, halo });
  back.push(lantern);

  const tree = thing('tree', 1080, FOOT + 2, 220);
  tree.addChild(sprite(P.paintTrunk()));
  const canopy = sprite(P.paintCanopy(), 4, -300);
  tree.addChild(canopy);
  parts.set(tree, { canopy });
  back.push(tree);

  const stone2 = thing('stone-2', 1200, FOOT + 3, 120);
  stone2.addChild(sprite(P.paintStone(1)));
  back.push(stone2);

  // In the water: a little boat with a paper lantern, and a clump of reeds.
  const boat = thing('boat', 400, WATER + 70, 0);
  const hull = sprite(art(pics.boat, 0.5, 0.7, P.paintBoat));
  const lamp = new Sprite(glowWarm);
  lamp.anchor.set(0.5);
  lamp.position.set(-53, -31);
  lamp.scale.set(0.55);
  lamp.blendMode = 'add';
  const bob = new Container();
  bob.addChild(hull, lamp);
  boat.addChild(bob);
  parts.set(boat, { bob });
  front.push(boat);

  const reeds = thing('reeds', 236, WATER + 30, 0);
  P.reseed(131);
  const blades = [];
  for (let i = 0; i < 11; i++) {
    const len = 50 + P.rnd() * 70;
    const b = sprite(P.paintBlade(len, i % 3 ? '#7c8a44' : '#a59a50'), (i - 5) * 6 + (P.rnd() - 0.5) * 6, 0);
    b.rotation = (i - 5) * 0.04;
    reeds.addChild(b);
    blades.push({ b, r: b.rotation, k: 0.6 + P.rnd() * 0.8, ph: P.rnd() * 6 });
  }
  parts.set(reeds, { blades });
  front.push(reeds);

  return { back, front, all: [...back, ...front] };
}

/**
 * A tiny verlet cloth hanging from the pole top: `cols`×`rows` points, `dx`/`dy` spacing, pinned along the top
 * row. step(dt, wind) moves it; draw(g, lightDir) fills each quad, brighter where the cloth turns toward the sun.
 */
function makeCloth(cols, rows, dx, dy, top) {
  const pts = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = 4 + i * dx, y = top + 4 + j * dy;
    pts.push({ x, y, px: x, py: y, pin: j === 0 });
  }
  const at = (i, j) => pts[j * cols + i];
  const links = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (i < cols - 1) links.push([at(i, j), at(i + 1, j), dx]);
    if (j < rows - 1) links.push([at(i, j), at(i, j + 1), dy]);
  }
  return {
    step(dt, wind, t) {
      const g = 380 * dt * dt;
      for (const p of pts) {
        if (p.pin) continue;
        const vx = (p.x - p.px) * 0.985, vy = (p.y - p.py) * 0.985;
        p.px = p.x; p.py = p.y;
        // Wind: steady breeze to the left (from the sun side) with gusts, more at the free end.
        const w = (wind + Math.sin(t * 1.3 + p.y * 0.05) * 0.4 + Math.sin(t * 3.1 + p.x * 0.2) * 0.2) * dt * dt * 260;
        p.x += vx + w * ((p.x + 10) / 60);
        p.y += vy + g;
      }
      for (let k = 0; k < 4; k++) for (const [a, b, len] of links) {
        const ex = b.x - a.x, ey = b.y - a.y, d = Math.hypot(ex, ey) || 1, f = (d - len) / d / 2;
        if (!a.pin) { a.x += ex * f; a.y += ey * f; }
        if (!b.pin) { b.x -= ex * f; b.y -= ey * f; }
      }
    },
    /** `mesh` (a MeshPlane with the picture) gets the points; `gfx` then only shades the folds over it. */
    draw(gfx, mesh) {
      gfx.clear();
      if (mesh) {
        const p = mesh.geometry.positions;
        pts.forEach((q, k) => { p[k * 2] = q.x; p[k * 2 + 1] = q.y; });
        mesh.geometry.getBuffer('aPosition').update();
      }
      for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        // Shade: a quad squeezed sideways is turned away; stretched is facing us. Warm red cloth, sun-lit.
        const lit = Math.max(0.25, Math.min(1.2, (b.x - a.x + c.x - d.x) / (2 * dx)));
        if (mesh) {
          // Over the picture: dark where the cloth turns away, a warm sheen where it faces the sun. The last row only
          // down to where the cloth ends (the bottom 9 of banner.png's 112 px are the see-through fringe: 64% of a row).
          const e = j === rows - 2 ? 0.36 : 1;
          const c2 = { x: b.x + (c.x - b.x) * e, y: b.y + (c.y - b.y) * e }, d2 = { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
          if (lit < 1) gfx.poly([a.x, a.y, b.x, b.y, c2.x, c2.y, d2.x, d2.y]).fill({ color: 0x1a0606, alpha: (1 - lit) * 0.6 });
          else gfx.poly([a.x, a.y, b.x, b.y, c2.x, c2.y, d2.x, d2.y]).fill({ color: 0xffc890, alpha: (lit - 1) * 0.6 });
          continue;
        }
        const r = Math.min(255, 120 * lit + 40), gC = Math.min(255, 38 * lit + 12), bC = Math.min(255, 30 * lit + 14);
        gfx.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill({ color: (r << 16) | (gC << 8) | bC });
      }
      if (mesh) return; // the sigil and the trim are in the picture
      // An old sigil: a gold ring in the middle of the cloth (drawn on the moving mesh, so it folds with it).
      const m = at(Math.floor(cols / 2), Math.floor(rows / 2) - 1);
      gfx.circle(m.x, m.y, 9).stroke({ color: 0xd8a24a, width: 2, alpha: 0.85 });
      gfx.circle(m.x, m.y, 3).fill({ color: 0xd8a24a, alpha: 0.85 });
      // Gold trim along the bottom edge.
      const last = rows - 1;
      gfx.moveTo(at(0, last).x, at(0, last).y);
      for (let i = 1; i < cols; i++) gfx.lineTo(at(i, last).x, at(i, last).y);
      gfx.stroke({ color: 0xd8a24a, width: 2 });
    },
  };
}
