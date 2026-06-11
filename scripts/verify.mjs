/**
 * Headless browser smoke test: boots the game, starts a run, ignites a fire,
 * lets the engine AI respond autonomously, and tracks containment over time.
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

// ignite a small fresh outbreak near the centre (like a wave ignition)
const ignited = await page.evaluate(() => {
  const g = window.game;
  let lit = 0;
  for (const [x, z] of [[60, 60], [61, 60]]) {
    const y = g.city.grid.topY(x, z);
    if (y >= 0 && g.fire.ignite(g.city.grid.idx(x, y, z))) lit++;
  }
  return lit;
});
console.log('ignited voxels:', ignited);

// watch the AI respond for 90s of game time
for (let t = 10; t <= 90; t += 10) {
  await page.waitForTimeout(10000);
  const s = await page.evaluate(() => ({
    fire: window.game.fire.activeFire.size,
    ext: window.game.fire.totalExtinguished,
    burned: window.game.fire.totalBurnedOut,
    units: window.game.units.units.map((u) => `${u.state} w=${u.water.toFixed(0)}`),
    tickMs: window.game.fire.lastTickMs.toFixed(2),
  }));
  console.log(`t=${t}s fire=${s.fire} extinguished=${s.ext} burnedOut=${s.burned} tick=${s.tickMs}ms units=[${s.units.join(' | ')}]`);
  if (t === 30) await page.screenshot({ path: '/tmp/fv-3-fire.png' });
  if (s.fire === 0 && t >= 30) {
    console.log('CONTAINED');
    break;
  }
}
await page.screenshot({ path: '/tmp/fv-4-end.png' });

const final = await page.evaluate(() => ({
  cash: window.game.economy.cash,
  score: window.game.economy.score,
  integrity: window.game.economy.integrity,
  saved: window.game.economy.buildingsSaved,
  lost: window.game.economy.buildingsLost,
}));
console.log('economy:', JSON.stringify(final));

console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
await server.close();
process.exit(errors.length > 0 ? 1 : 0);
