// Firefly Ruins — what makes it breathe: fireflies, dust in the light, falling leaves, the wind, the bell.
//
// Wind is one number that everything reads (tree crown, reeds, banner, leaves, fireflies). A tap sends a breeze
// from where you tapped: the wind jumps, then settles back to the evening's light air.
import { Container, Sprite } from 'pixi.js';
import { paint, glowTexture, rnd, reseed, SUN } from './paint.js';
import { W, WATER } from './backdrop.js';
import { parts } from './objects.js';

export function makeLife(objects) {
  const layer = new Container();
  layer.studio = false;

  // Fireflies: soft additive glows that wander (smooth noise) and pulse; they stay above the bank and the pond.
  const flyTex = glowTexture(32, 'rgba(230,255,150,1)', 'rgba(150,255,80,0)');
  const flies = [];
  reseed(201);
  for (let i = 0; i < 46; i++) {
    const s = new Sprite(flyTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    const f = { s, x: rnd() * W, y: 380 + rnd() * 300, vx: 0, vy: 0, ph: rnd() * 20, sp: 0.5 + rnd(), size: 0.35 + rnd() * 0.5 };
    s.position.set(f.x, f.y);
    layer.addChild(s);
    flies.push(f);
  }
  // Dust motes inside the light shafts (tiny, slow, warm).
  const moteTex = glowTexture(8, 'rgba(255,230,190,1)', 'rgba(255,200,140,0)');
  const motes = [];
  for (let i = 0; i < 70; i++) {
    const s = new Sprite(moteTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    const m = { s, x: 300 + rnd() * 700, y: 200 + rnd() * 380, ph: rnd() * 10 };
    layer.addChild(s);
    motes.push(m);
  }
  // Leaves: little lit flakes falling from the tree crown, drifting with the wind.
  const leafTex = paint(8, 5, (ctx) => { ctx.fillStyle = '#d8b25a'; ctx.beginPath(); ctx.ellipse(4, 2.5, 4, 2.2, 0.3, 0, Math.PI * 2); ctx.fill(); });
  const tree = objects.all.find((o) => o.studioKey === 'tree');
  const leaves = [];
  for (let i = 0; i < 14; i++) {
    const s = new Sprite(leafTex);
    s.anchor.set(0.5);
    layer.addChild(s);
    leaves.push({ s, x: 0, y: 9999, vx: 0, vy: 0, spin: 0, ph: rnd() * 6 });
  }
  const dropLeaf = (l) => {
    const tx = tree && tree.parent ? tree.x : 1080, ty = tree && tree.parent ? tree.y - 300 * tree.scale.y : 300;
    l.x = tx + (rnd() - 0.5) * 300; l.y = ty + (rnd() - 0.5) * 140; l.vx = 0; l.vy = 10 + rnd() * 10;
  };
  leaves.forEach((l, i) => { dropLeaf(l); l.y += i * 20; });

  let wind = 0.25, gust = 0, gustX = 0, gustY = 0;
  const breeze = (x, y) => { gust = 1; gustX = x; gustY = y; };

  // ---- the bell: a pendulum; a tap near it rings it (a soft synthesized tone, after the first user gesture) ----
  const bellObj = objects.all.find((o) => o.studioKey === 'bell');
  let audio = null;
  function ring(strength) {
    const p = parts.get(bellObj);
    if (!p) return;
    p.vel += 2.4 * strength;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audio.currentTime, out = audio.createGain();
      out.gain.value = 0.18 * strength;
      out.connect(audio.destination);
      // A bronze bell: a few inharmonic partials, each decaying at its own rate.
      for (const [f, a, d] of [[392, 1, 3.2], [784 * 1.18, 0.5, 2.2], [392 * 2.76, 0.35, 1.4], [392 * 5.4, 0.15, 0.8]]) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(a, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
        o.connect(g).connect(out);
        o.start(t0);
        o.stop(t0 + d);
      }
    } catch { /* no audio: the bell still swings */ }
  }

  function step(t, dt) {
    gust *= Math.exp(-dt * 0.9);
    wind = 0.25 + Math.sin(t * 0.37) * 0.12 + gust * 1.6;

    for (const f of flies) {
      // Wander: a smooth random walk. A breeze pushes them away from where it came from.
      const ax = Math.sin(t * 0.7 * f.sp + f.ph) * 14 + Math.sin(t * 1.9 + f.ph * 2) * 6 - wind * 6;
      const ay = Math.cos(t * 0.6 * f.sp + f.ph * 1.3) * 10;
      let px = 0, py = 0;
      if (gust > 0.05) {
        const dx = f.x - gustX, dy = f.y - gustY, d = Math.hypot(dx, dy) + 30;
        px = (dx / d) * gust * 9000 / d; py = (dy / d) * gust * 9000 / d;
      }
      f.vx += (ax + px - f.vx) * Math.min(1, dt * 1.5);
      f.vy += (ay + py - f.vy) * Math.min(1, dt * 1.5);
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.x < -40) f.x = W + 40; else if (f.x > W + 40) f.x = -40;
      f.y = Math.max(300, Math.min(WATER + 110, f.y));
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 * f.sp + f.ph);
      f.s.position.set(f.x, f.y);
      f.s.alpha = 0.25 + 0.75 * pulse * pulse;
      f.s.scale.set(f.size * (0.8 + 0.4 * pulse));
    }
    for (const m of motes) {
      m.x += (Math.sin(t * 0.3 + m.ph) * 4 - wind * 10) * dt;
      m.y += Math.cos(t * 0.25 + m.ph) * 3 * dt;
      if (m.x < 250) m.x += 800;
      // Brightest inside the light: near the line from the sun down-left.
      const dx = m.x - SUN.x, dy = m.y - SUN.y, ang = Math.atan2(dy, dx);
      const inShaft = Math.max(0, Math.cos((ang - Math.PI * 0.95) * 6));
      m.s.position.set(m.x, m.y);
      m.s.alpha = (0.15 + 0.6 * inShaft) * (0.6 + 0.4 * Math.sin(t * 1.3 + m.ph));
    }
    for (const l of leaves) {
      l.vx += ((-wind * 40 + Math.sin(t * 2 + l.ph) * 20) - l.vx) * Math.min(1, dt * 2);
      l.x += l.vx * dt; l.y += l.vy * dt;
      l.s.rotation += dt * (2 + Math.sin(t + l.ph));
      l.s.position.set(l.x, l.y);
      l.s.scale.y = Math.cos(t * 3 + l.ph);
      if (l.y > WATER + 10 || l.x < -60) dropLeaf(l);
    }

    // Objects: crown, reeds, banner, flame, bell, boat (only their children move).
    for (const o of objects.all) {
      const p = parts.get(o);
      if (!p || !o.parent) continue;
      if (p.canopy) p.canopy.skew.x = -0.02 - wind * 0.025 + Math.sin(t * 1.4) * 0.008 * (1 + gust * 3);
      if (p.blades) for (const b of p.blades) b.b.rotation = b.r - wind * 0.12 * b.k + Math.sin(t * 1.8 * b.k + b.ph) * 0.05 * (1 + gust * 2);
      if (p.cloth) { p.sim.step(Math.min(dt, 1 / 30), -wind, t); p.sim.draw(p.cloth); }
      if (p.flame) {
        const fl = 0.85 + Math.sin(t * 13) * 0.06 + Math.sin(t * 23.7) * 0.05 + Math.sin(t * 5.3) * 0.04;
        p.flame.scale.set(0.75 * fl); p.halo.alpha = 0.3 * fl;
      }
      if (p.bell) {
        p.vel += (-p.angle * 9 - p.vel * 0.6 - wind * 0.05) * dt;
        p.angle += p.vel * dt;
        p.bell.rotation = p.angle;
      }
      if (p.bob) { p.bob.y = Math.sin(t * 1.3) * 2.2; p.bob.rotation = Math.sin(t * 0.9 + 1) * 0.025; }
    }
  }
  return { layer, step, breeze, ring, wind: () => wind };
}
