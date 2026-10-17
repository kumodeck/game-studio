// Firefly Ruins — the still pond in front of the ruins.
//
// The reflection is the real scene: each frame the world above the waterline is drawn (half size) into a
// RenderTexture, and that picture is shown upside down below the waterline in 64 thin horizontal strips, each
// shifted sideways by a slow wave. Strips deeper down (closer to the viewer) wobble more and fade toward the water
// colour, like a real pond seen at a low angle. No shader: strips of one texture are cheap and work everywhere.
// So when you move the arch in the editor, its reflection moves too (main.js redraws the reflection before the
// editor draws, see .studio/adapter.js).
import { Container, Graphics, Rectangle, RenderTexture, Sprite, Texture } from 'pixi.js';
import { paint, rnd, reseed, SUN } from './paint.js';
import { W, WATER } from './backdrop.js';

const M = 480;            // reflection covers the world plus this margin left/right (wide screens)
const DEPTH = 360;        // how far below the waterline the pond goes (bottom of the tallest phone view)
const RS = 0.75;          // reflection resolution (world px → texture px); 0.5 looked blocky near the viewer
const STRIPS = 64;

export function makePond(renderer) {
  const pond = new Container();
  pond.studio = false;

  // Water body: dark teal, lighter toward the far edge (the sky's light at a grazing angle).
  // Taller than the reflection: tall phones see far below the waterline.
  const body = new Sprite(paint(W + 2 * M, DEPTH + 400, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6b6a7a'); g.addColorStop(0.1, '#2d3a4a'); g.addColorStop(0.5, '#0f1a26'); g.addColorStop(1, '#09111a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }));
  body.position.set(-M, WATER);
  pond.addChild(body);

  // The reflection: what is above the waterline, from y = WATER - REACH up to WATER.
  const REACH = 600;
  const rt = RenderTexture.create({ width: Math.ceil((W + 2 * M) * RS), height: Math.ceil(REACH * RS), resolution: 1 });
  const refl = new Container();
  const strips = [];
  const sh = DEPTH / STRIPS;
  for (let i = 0; i < STRIPS; i++) {
    // Strip i shows the scene row that is (i + 0.5) * sh above the waterline (mirror), squashed a little with depth
    // (a pond seen from slightly above reflects a slightly shorter world).
    const srcH = sh * RS * 1.05;
    const srcY = Math.max(0, REACH * RS - (i + 1) * srcH);
    const tex = new Texture({ source: rt.source, frame: new Rectangle(0, srcY, rt.width, srcH) });
    const s = new Sprite(tex);
    s.anchor.set(0, 1);
    s.scale.set(1 / RS, -(sh / srcH) * 1.001);
    s.position.set(-M, WATER + i * sh);
    const k = i / STRIPS;
    s.alpha = 0.7 * (1 - k * 0.6);
    s.tint = 0x92a2b8; // water darkens and cools what it reflects
    refl.addChild(s);
    strips.push({ s, k, ph: rnd() * 6 });
  }
  pond.addChild(refl);

  // Sun glitter: short bright dashes under the sun, dancing.
  const dashTex = paint(24, 4, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,230,180,0)'); g.addColorStop(0.5, 'rgba(255,240,200,1)'); g.addColorStop(1, 'rgba(255,230,180,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const glitter = [];
  reseed(17);
  for (let i = 0; i < 70; i++) {
    const s = new Sprite(dashTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    const d = rnd();
    const y = WATER + 4 + d * d * 220;
    s.position.set(SUN.x + (rnd() - 0.5) * (30 + d * 260), y);
    s.scale.set(0.6 + d * 2.2, 0.6 + d * 0.8);
    pond.addChild(s);
    glitter.push({ s, ph: rnd() * 10, sp: 1.5 + rnd() * 3, a: 0.25 + (1 - d) * 0.6 });
  }

  // Ripple rings (tap on the water, the boat bumping, fish): flattened ellipses that grow and fade.
  const ripples = [];
  const rippleLayer = new Graphics();
  pond.addChild(rippleLayer);
  const ripple = (x, y, strength = 1) => ripples.push({ x, y, t: 0, s: strength });

  // The waterline: a thin bright edge where the water meets the bank (sky light skimming).
  const edge = new Graphics().rect(-M, WATER - 1, W + 2 * M, 2).fill({ color: 0xffd7a0, alpha: 0.35 });
  pond.addChild(edge);

  /** Redraw the reflection picture from the current scene (call with the pond and front layers hidden). */
  function capture(stage) {
    renderer.render({ container: stage, target: rt, clear: true, transform: new stage.localTransform.constructor(RS, 0, 0, RS, M * RS, -(WATER - REACH) * RS) });
  }

  function step(t, dt) {
    for (const st of strips) {
      // Bigger, slower waves near the viewer; tiny shimmer near the far edge.
      st.s.x = -M + Math.sin(t * (0.9 - st.k * 0.4) + st.k * 14 + st.ph) * (0.6 + st.k * st.k * 9);
    }
    for (const g of glitter) {
      const v = Math.sin(t * g.sp + g.ph);
      g.s.alpha = Math.max(0, v) * g.a;
    }
    rippleLayer.clear();
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.t += dt;
      if (r.t > 2.4) { ripples.splice(i, 1); continue; }
      for (let k = 0; k < 3; k++) {
        const tt = r.t - k * 0.25;
        if (tt <= 0) continue;
        const rad = tt * 60 * r.s;
        const persp = 0.18 + ((r.y - WATER) / DEPTH) * 0.25; // flatter far away
        rippleLayer.ellipse(r.x, r.y, rad, rad * persp).stroke({ color: 0xffe6c4, width: 1.5, alpha: Math.max(0, 0.45 * (1 - tt / 2.2)) });
      }
    }
  }
  return { pond, capture, step, ripple };
}
