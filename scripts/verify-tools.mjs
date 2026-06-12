/**
 * Verifies player tools end-to-end in a real browser: crew upgrade (firefighters
 * deploy on foot), hydrant purchase + placement via the toolbar, repair tool on
 * a burned building, and the dispatch beacon.
 */
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4189, strictPort: true } });
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4189/?seed=42');
await page.waitForSelector('#start-btn');
await page.click('#start-btn');
await page.waitForTimeout(400);

// fund and buy crew + hydrant through the shop
await page.evaluate(() => window.game.economy.earn(5000));
await page.click('#shop-toggle');
const buy = async (name) => {
  for (const row of await page.$$('.shop-item')) {
    const label = await row.$eval('.iname', (el) => el.textContent);
    if (label.startsWith(name)) { await (await row.$('button')).click(); return; }
  }
  throw new Error('not found: ' + name);
};
await buy('Firefighter Crew');
await buy('Hydrant Kit');
await page.click('#shop-toggle');
console.log('crew level:', await page.evaluate(() => window.game.units.crewLevel),
  'hydrant stock:', await page.evaluate(() => window.game.toolbar.hydrantStock));

// place hydrant: select tool, click a road cell on screen
await page.click('#tool-hydrant');
const screenPt = await page.evaluate(() => {
  const g = window.game;
  const d = g.city.stationDoor;
  // find a road cell a few cells from the door and project to screen
  const v = { x: d.x, y: 1, z: d.z + 4 };
  const THREEv = new (Object.getPrototypeOf(g.cameraRig.target).constructor)(v.x, v.y, v.z);
  THREEv.project(g.renderer.camera);
  return { x: (THREEv.x + 1) / 2 * window.innerWidth, y: (-THREEv.y + 1) / 2 * window.innerHeight };
});
await page.mouse.click(screenPt.x, screenPt.y);
await page.waitForTimeout(300);
console.log('hydrants placed:', await page.evaluate(() => window.game.units.hydrants.length),
  'tool now:', await page.evaluate(() => window.game.toolbar.tool));

// burn a house fully (no response), then repair it
const house = await page.evaluate(() => {
  const g = window.game;
  const d = g.city.stationDoor;
  let best = null, bestD = Infinity;
  for (const b of g.city.buildings) {
    if (b.kind !== 'house') continue;
    const dd = Math.hypot((b.x0 + b.x1) / 2 - d.x, (b.z0 + b.z1) / 2 - d.z);
    if (dd > 30 && dd < bestD) { bestD = dd; best = b; }
  }
  // torch every voxel so burnout completes within the test budget
  for (let x = best.x0; x <= best.x1; x++) for (let z = best.z0; z <= best.z1; z++) for (let y = 1; y < 40; y++) {
    const idx = g.city.grid.idx(x, y, z);
    if (g.city.grid.material[idx] !== 0) g.fire.ignite(idx);
  }
  return { id: best.id, x: Math.round((best.x0 + best.x1) / 2), z: Math.round((best.z0 + best.z1) / 2) };
});
// wait for it to burn out (sped up by torching everything)
let damaged = 0;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000);
  const b = await page.evaluate((id) => {
    const bb = window.game.city.buildings[id];
    return { burning: bb.burningCount, damaged: bb.damagedVoxels };
  }, house.id);
  damaged = b.damaged;
  if (b.burning === 0 && b.damaged > 0) break;
}
console.log('house damaged voxels:', damaged);
const repair = await page.evaluate(({ id }) => {
  const g = window.game;
  const b = g.city.buildings[id];
  const cashBefore = g.economy.cash;
  // use the repair path directly at a building voxel (tool click equivalent)
  g.toolbar.select('repair');
  const y = Math.max(1, g.city.grid.topY(Math.round((b.x0+b.x1)/2), Math.round((b.z0+b.z1)/2)));
  g.tryRepair({ x: Math.round((b.x0 + b.x1) / 2), y, z: Math.round((b.z0 + b.z1) / 2) });
  return { cashSpent: cashBefore - g.economy.cash, damagedAfter: b.damagedVoxels, resolved: b.resolved };
}, house);
console.log('repair:', JSON.stringify(repair));

// crew: dispatch an engine to a fresh fire and watch firefighters deploy
const fire2 = await page.evaluate(() => {
  const g = window.game;
  const d = g.city.stationDoor;
  let best = null, bestD = Infinity;
  for (const b of g.city.buildings) {
    if (b.kind !== 'house') continue;
    const dd = Math.hypot((b.x0 + b.x1) / 2 - d.x, (b.z0 + b.z1) / 2 - d.z);
    if (dd > 14 && dd < bestD) { bestD = dd; best = b; }
  }
  const fx = Math.round((best.x0 + best.x1) / 2), fz = Math.round((best.z0 + best.z1) / 2);
  for (const [x, z] of [[fx, fz], [fx + 1, fz]]) {
    const y = g.city.grid.topY(x, z);
    if (y >= 0) g.fire.ignite(g.city.grid.idx(x, y, z));
  }
  g.units.selected = g.units.units[0];
  g.units.orderAt(fx, fz);
  g.units.selected = null;
  return { fx, fz };
});
let deployed = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => {
    const e = window.game.units.units[0];
    return { state: e.state, crew: e.crew.map((c) => ({ st: c.state, dep: c.deployed })) };
  });
  if (s.crew.some((c) => c.dep)) { deployed = true; console.log('crew deployed:', JSON.stringify(s)); break; }
}
await page.evaluate(({ fx, fz }) => {
  const g = window.game;
  g.cameraRig.target.set(fx, 0, fz);
  g.cameraRig.distance = 36;
}, fire2);
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/nv-10-crew.png' });
console.log('firefighters deployed:', deployed);
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
await server.close();
process.exit(errors.length || !deployed ? 1 : 0);
