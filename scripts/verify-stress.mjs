/**
 * Stress test: ignites a large multi-block fire, runs ~80s, and reports sim
 * tick cost, active-set sizes and render stats. Also captures a close-up of
 * the blaze for visual review.
 */
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4176, strictPort: true } });
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto('http://localhost:4176/?seed=42');
await page.waitForSelector('#start-btn');
await page.click('#start-btn');
await page.waitForTimeout(500);

// torch a wide area
await page.evaluate(() => {
  const g = window.game;
  for (let x = 30; x < 100; x += 6) {
    for (let z = 30; z < 100; z += 6) {
      const y = g.city.grid.topY(x, z);
      if (y >= 0) g.fire.ignite(g.city.grid.idx(x, y, z));
    }
  }
  // zoom the camera into the blaze
  g; // (camera rig not exposed; default view is fine)
});

let maxTick = 0;
let maxFire = 0;
for (let t = 10; t <= 80; t += 10) {
  await page.waitForTimeout(10000);
  const s = await page.evaluate(() => ({
    fire: window.game.fire.activeFire.size,
    hot: window.game.fire.hotCells.size,
    tickMs: window.game.fire.lastTickMs,
  }));
  maxTick = Math.max(maxTick, s.tickMs);
  maxFire = Math.max(maxFire, s.fire);
  console.log(`t=${t}s fire=${s.fire} hot=${s.hot} tick=${s.tickMs.toFixed(2)}ms`);
}
await page.screenshot({ path: '/tmp/fv-7-inferno.png' });
console.log(`max active fire: ${maxFire}, max tick: ${maxTick.toFixed(2)}ms`);
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
await server.close();
process.exit(errors.length > 0 || maxTick > 16 ? 1 : 0);
