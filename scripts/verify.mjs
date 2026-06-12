/**
 * Headless browser smoke test: boots the game, starts a run, ignites a fire
 * near the HQ, dispatches engines (player-style), and tracks containment.
 * Run with: node scripts/verify.mjs (requires `npm run build` + playwright chromium)
 */
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4173, strictPort: true } });
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto('http://localhost:4173/?seed=42');
await page.waitForSelector('#start-btn', { timeout: 10000 });
await page.screenshot({ path: '/tmp/fv-1-title.png' });

await page.click('#start-btn');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/fv-2-city.png' });

// torch the nearest wooden house to the HQ (spreads properly), then dispatch both engines
const setup = await page.evaluate(() => {
  const g = window.game;
  const door = g.city.stationDoor;
  let best = null;
  let bestD = Infinity;
  for (const b of g.city.buildings) {
    if (b.kind !== 'house') continue;
    const d = Math.hypot((b.x0 + b.x1) / 2 - door.x, (b.z0 + b.z1) / 2 - door.z);
    if (d > 14 && d < bestD) {
      bestD = d;
      best = b;
    }
  }
  const fx = Math.round((best.x0 + best.x1) / 2);
  const fz = Math.round((best.z0 + best.z1) / 2);
  for (const [x, z] of [[fx, fz], [fx + 1, fz]]) {
    const y = g.city.grid.topY(x, z);
    if (y >= 0) g.fire.ignite(g.city.grid.idx(x, y, z));
  }
  return { door, fx, fz, dist: bestD };
});
console.log('outbreak at', setup.fx, setup.fz, 'door', setup.door);

// give the clusterizer a beat, then dispatch like a player click
await page.waitForTimeout(1500);
await page.evaluate(({ fx, fz }) => {
  const g = window.game;
  for (const u of g.units.units) {
    g.units.selected = u;
    g.units.orderAt(fx, fz);
  }
  g.units.selected = null;
}, setup);

// play like an active commander for 3 minutes: idle engines get dispatched
// to the nearest cluster every 10s (the player's job)
let contained = false;
for (let t = 10; t <= 180; t += 10) {
  await page.waitForTimeout(10000);
  const s = await page.evaluate(() => {
    const g = window.game;
    for (const u of g.units.units) {
      if (u.state !== 'idle') continue;
      const near = g.clusters.nearestCluster(u.x, u.z);
      if (near) {
        g.units.selected = u;
        g.units.orderAt(near.cx, near.cz);
      }
    }
    g.units.selected = null;
    return {
      fire: g.fire.activeFire.size,
      ext: g.fire.totalExtinguished,
      burned: g.fire.totalBurnedOut,
      units: g.units.units.map((u) => `${u.state} w=${u.water.toFixed(0)}`),
      tickMs: g.fire.lastTickMs.toFixed(2),
      weather: g.weather.kind,
      saved: g.economy.buildingsSaved,
      lost: g.economy.buildingsLost,
      integrity: g.economy.integrity,
      cash: g.economy.cash,
    };
  });
  console.log(
    `t=${t}s fire=${s.fire} ext=${s.ext} burned=${s.burned} tick=${s.tickMs}ms wx=${s.weather} saved=${s.saved} lost=${s.lost} integ=${s.integrity} cash=${Math.round(s.cash)} units=[${s.units.join(' | ')}]`,
  );
  if (t === 30) await page.screenshot({ path: '/tmp/fv-3-fire.png' });
  if (s.fire === 0 && t >= 30) contained = true;
}
console.log('player-managed session done; contained at least once:', contained);
await page.screenshot({ path: '/tmp/fv-4-end.png' });

const final = await page.evaluate(() => ({
  cash: window.game.economy.cash,
  score: window.game.economy.score,
  integrity: window.game.economy.integrity,
  saved: window.game.economy.buildingsSaved,
  lost: window.game.economy.buildingsLost,
}));
console.log('economy:', JSON.stringify(final));

console.log('console errors:', errors.length ? errors.slice(0, 6) : 'none');
await browser.close();
await server.close();
process.exit(errors.length > 0 ? 1 : 0);
