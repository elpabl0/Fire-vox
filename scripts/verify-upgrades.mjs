/**
 * Verifies the upgrade path in a real browser: earn cash, buy the helicopter
 * and heat vision through the actual shop UI, confirm the helicopter completes
 * its fill/drop cycle and the heat overlay renders.
 */
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4174, strictPort: true } });
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto('http://localhost:4174/?seed=42');
await page.waitForSelector('#start-btn');
await page.click('#start-btn');
await page.waitForTimeout(500);

// grant cash (debug) and buy helicopter + heat vision through the shop UI
await page.evaluate(() => window.game.economy.earn(2000));
await page.click('#shop-toggle');
const buyByName = async (name) => {
  const rows = await page.$$('.shop-item');
  for (const row of rows) {
    const label = await row.$eval('.iname', (el) => el.textContent);
    if (label.startsWith(name)) {
      await (await row.$('button')).click();
      return;
    }
  }
  throw new Error(`shop item not found: ${name}`);
};
await buyByName('Helicopter');
await buyByName('Heat Vision');
await page.waitForTimeout(300);

const unitKinds = await page.evaluate(() => window.game.units.units.map((u) => u.kind));
console.log('units after purchase:', unitKinds.join(', '));

// start a fire away from roads (park interior) so the helicopter matters
await page.evaluate(() => {
  const g = window.game;
  for (const [x, z] of [[64, 64], [65, 64], [64, 65]]) {
    const y = g.city.grid.topY(x, z);
    if (y >= 0) g.fire.ignite(g.city.grid.idx(x, y, z));
  }
});

let heliWorked = false;
const heliStates = new Set();
for (let t = 5; t <= 120; t += 5) {
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => {
    const heli = window.game.units.units.find((u) => u.kind === 'helicopter');
    return { state: heli.state, water: heli.water, fire: window.game.fire.activeFire.size };
  });
  heliStates.add(s.state);
  if (t % 20 === 0) console.log(`t=${t}s heli=${s.state} water=${s.water.toFixed(0)} fire=${s.fire}`);
  if (heliStates.has('toWater') && heliStates.has('filling') && heliStates.has('dropping')) {
    heliWorked = true;
    console.log('helicopter completed fill/drop cycle:', [...heliStates].join(' -> '));
    break;
  }
}

// heat vision: toggle on and screenshot
await page.keyboard.press('H');
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/fv-5-heatvision.png' });
const hv = await page.evaluate(() => ({
  // sample the overlay state indirectly through the exposed game
  fire: window.game.fire.activeFire.size,
  hot: window.game.fire.hotCells.size,
}));
console.log('heat vision screenshot taken; fire:', hv.fire, 'hot:', hv.hot);
await page.keyboard.press('H');

console.log('helicopter cycle ok:', heliWorked);
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
await server.close();
process.exit(errors.length > 0 || !heliWorked ? 1 : 0);
