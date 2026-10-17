import { Application, Graphics } from 'pixi.js';
import { applyPlacement } from './studio-placement.js';

const app = new Application();
await app.init({ resizeTo: window, background: '#fdf3e1', antialias: true });
document.body.append(app.canvas);

const player = new Graphics().roundRect(-30, -30, 60, 60, 12).fill(0x3949ab);
player.label = 'player';
player.position.set(120, 200);
const coin = (x) => {
  const c = new Graphics().circle(0, 0, 18).fill(0xfbc02d);
  c.label = 'coin';
  c.position.set(x, 120);
  return c;
};
const coins = [coin(240), coin(320)];
const boss = new Graphics().star(0, 0, 5, 40).fill(0xd81b60);
boss.studioKey = 'boss';
boss.position.set(300, 300);
app.stage.addChild(player, ...coins, boss);

const report = await applyPlacement(app.stage, './placement.json');
const pos = (o) => [Math.round(o.position.x * 10) / 10, Math.round(o.position.y * 10) / 10];
window.__placementCheck = { report, player: pos(player), playerAngle: player.rotation, coin2Scale: coins[1].scale.x, boss: pos(boss) };
