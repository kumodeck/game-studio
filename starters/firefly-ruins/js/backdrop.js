// Firefly Ruins — the stage behind the objects: sky, sun, far hills in haze, light shafts, drifting mist, the bank.
//
// Depth comes from "air": each hill layer further back is lighter and closer to the sky colour (aerial
// perspective), and mist bands drift between them at different speeds. None of this is editable
// (`studio = false`): it is the place, not the props.
//
// Everything is painted wider and taller than the 1280×800 world, so wide screens and tall phones never see an edge.
import { Container, Sprite } from 'pixi.js';
import { paint, rnd, reseed, SUN, glowTexture } from './paint.js';

export const W = 1280, H = 800, WATER = 600; // world size; WATER = the pond's waterline (objects stand on it)
const M = 480; // margin painted around the world
const off = (o) => ((o.studio = false), o);

export function makeBackdrop() {
  const back = off(new Container());

  // Sky: deep teal-blue at the top → dusty rose → gold at the horizon behind the ruins.
  const sky = new Sprite(paint(W + 2 * M, WATER + M, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#16263d');
    g.addColorStop(0.38, '#3b4a6a');
    g.addColorStop(0.66, '#9c7f8e');
    g.addColorStop(0.86, '#f0b07a');
    g.addColorStop(1, '#ffd49a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Warm bloom of the sun across the sky.
    const sx = SUN.x + M, sy = SUN.y + M;
    const r = ctx.createRadialGradient(sx, sy, 0, sx, sy, 700);
    r.addColorStop(0, 'rgba(255,214,150,0.85)');
    r.addColorStop(0.25, 'rgba(255,170,110,0.35)');
    r.addColorStop(1, 'rgba(255,150,110,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, w, h);
    // Thin cloud streaks lit from below.
    reseed(5);
    for (let i = 0; i < 16; i++) {
      const y = M + 60 + rnd() * 300, x = rnd() * w, len = 200 + rnd() * 500;
      const near = Math.max(0, 1 - Math.abs(x + len / 2 - sx) / 900);
      const c = ctx.createLinearGradient(x, 0, x + len, 0);
      const col = `rgba(${255}, ${170 + near * 60 | 0}, ${140 + near * 30 | 0}, ${0.12 + near * 0.3})`;
      c.addColorStop(0, 'rgba(255,180,150,0)'); c.addColorStop(0.5, col); c.addColorStop(1, 'rgba(255,180,150,0)');
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(x + len / 2, y, len / 2, 3 + rnd() * 6, 0, 0, Math.PI * 2); ctx.fill();
    }
  }));
  sky.position.set(-M, -M);
  back.addChild(sky);

  // The sun itself: a hot core and a wide additive halo.
  const sunHalo = new Sprite(glowTexture(256, 'rgba(255,236,190,1)', 'rgba(255,170,90,0)'));
  sunHalo.anchor.set(0.5);
  sunHalo.position.set(SUN.x, SUN.y);
  sunHalo.scale.set(2.2);
  sunHalo.blendMode = 'add';
  sunHalo.alpha = 0.75;
  const sunCore = new Sprite(glowTexture(64, 'rgba(255,250,235,1)', 'rgba(255,220,160,0)'));
  sunCore.anchor.set(0.5);
  sunCore.position.set(SUN.x, SUN.y);
  sunCore.scale.set(1.3);
  sunCore.blendMode = 'add';
  back.addChild(sunHalo, sunCore);

  // Hills: four layers, far → near, each a ridge line with tree tufts, coloured toward the sky by distance.
  const ridge = (seedN, baseY, amp, col, haze, tufts) => {
    reseed(seedN);
    const w = W + 2 * M, h = WATER - baseY + amp + 40;
    const s = new Sprite(paint(w, h, (ctx) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, h);
      let y = amp;
      const ph = rnd() * 10;
      for (let x = 0; x <= w; x += 8) {
        y = amp * (0.55 + 0.3 * Math.sin(x * 0.004 + ph) + 0.15 * Math.sin(x * 0.013 + ph * 2)) + (rnd() - 0.5) * 2;
        ctx.lineTo(x, y);
        if (tufts && rnd() < tufts) { // tree tops on the ridge
          const th = 8 + rnd() * 22;
          ctx.lineTo(x + 2, y - th); ctx.lineTo(x + 5, y);
        }
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      // Haze toward the bottom (mist pools in the valleys).
      const g = ctx.createLinearGradient(0, amp * 0.4, 0, h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, haze);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }));
    s.position.set(-M, baseY - amp);
    return s;
  };
  const hills = [
    ridge(3, 470, 70, '#b98d8f', 'rgba(255,200,160,0.9)', 0),
    ridge(4, 505, 80, '#7d6c80', 'rgba(250,190,150,0.8)', 0.15),
    ridge(6, 540, 70, '#4a4d62', 'rgba(230,170,140,0.6)', 0.35),
    ridge(8, 572, 50, '#2a3240', 'rgba(150,120,110,0.35)', 0.55),
  ];
  back.addChild(...hills);

  // Light shafts from the sun, fanning down-left through the ruins (additive, slowly breathing).
  const shaftTex = paint(900, 120, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,220,160,0.55)'); g.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, h / 2 - 6); ctx.lineTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(0, h / 2 + 6); ctx.fill();
  });
  const shafts = off(new Container());
  reseed(9);
  const shaftList = [];
  for (let i = 0; i < 6; i++) {
    const s = new Sprite(shaftTex);
    s.anchor.set(0, 0.5);
    s.position.set(SUN.x, SUN.y);
    s.rotation = Math.PI * (0.86 + i * 0.045 + rnd() * 0.02);
    s.scale.set(0.8 + rnd() * 0.5, 0.6 + rnd() * 1.2);
    s.blendMode = 'add';
    s.alpha = 0.08 + rnd() * 0.08;
    shafts.addChild(s);
    shaftList.push({ s, a: s.alpha, ph: rnd() * 6 });
  }

  // Mist bands (front of the hills, behind the ruins) that drift.
  const mistTex = paint(700, 60, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,225,205,0.5)'); g.addColorStop(1, 'rgba(255,225,205,0)');
    ctx.fillStyle = g; ctx.save(); ctx.scale(1, h / w); ctx.fillRect(0, 0, w, w); ctx.restore();
  });
  const mists = [];
  reseed(12);
  for (let i = 0; i < 7; i++) {
    const s = new Sprite(mistTex);
    s.anchor.set(0.5);
    s.position.set(-200 + rnd() * (W + 400), 515 + rnd() * 70);
    s.scale.set(1 + rnd(), 0.8 + rnd() * 0.8);
    s.alpha = 0.35 + rnd() * 0.3;
    mists.push({ s, v: 4 + rnd() * 8 });
  }
  const mist = off(new Container());
  mist.addChild(...mists.map((m) => m.s));
  back.addChild(mist);

  // The bank the ruins stand on: dark earth with grass, its lip catching the sun.
  const bank = new Sprite(paint(W + 2 * M, 70, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#3d4a2a'); g.addColorStop(0.35, '#26301f'); g.addColorStop(1, '#141a14');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 22);
    reseed(14);
    for (let x = 0; x <= w; x += 12) ctx.lineTo(x, 18 + Math.sin(x * 0.01) * 5 + rnd() * 3);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    for (let i = 0; i < 1400; i++) { // grass blades along the lip
      const x = rnd() * w, y = 18 + Math.sin(x * 0.01) * 5, hh = 4 + rnd() * 12;
      const lit = Math.max(0, 1 - Math.abs(x - (SUN.x + M)) / 700);
      ctx.strokeStyle = `rgba(${90 + lit * 140 | 0}, ${110 + lit * 90 | 0}, ${50 + lit * 20 | 0}, 0.8)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x + (rnd() - 0.6) * 5, y - hh); ctx.stroke();
    }
  }));
  bank.position.set(-M, WATER - 40);

  function step(t, dt) {
    for (const m of mists) {
      m.s.x += m.v * dt;
      if (m.s.x > W + 450) m.s.x = -450;
    }
    for (const sh of shaftList) sh.s.alpha = sh.a * (0.7 + 0.3 * Math.sin(t * 0.5 + sh.ph));
    sunHalo.scale.set(2.2 + Math.sin(t * 0.7) * 0.04);
  }
  // `shafts` and `bank` are returned separately: main.js puts the bank in front of the hills and the shafts in
  // front of the ruins (light falls ON them).
  return { back, bank: off(bank), shafts, step };
}
