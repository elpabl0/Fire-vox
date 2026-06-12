/**
 * Verifies the strategy-layer batch in a real browser: helipads, refill-resume,
 * delayed fire reporting, monthly budget, turret aim, traffic jams, all-units order.
 */
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4193, strictPort: true } });
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4193/?seed=42');
await page.waitForSelector('#start-btn');
await page.click('#start-btn');
await page.waitForTimeout(400);

// --- helipads: buy two helicopters, both should land on distinct pads on the roof
await page.evaluate(() => window.game.economy.earn(9999));
await page.click('#shop-toggle');
const buy = async (name) => {
  for (const row of await page.$$('.shop-item')) {
    const label = await row.$eval('.iname', (el) => el.textContent);
    if (label.startsWith(name)) { await (await row.$('button')).click(); return; }
  }
};
await buy('Helicopter');
await buy('Helicopter');
await page.click('#shop-toggle');
const pads = await page.evaluate(() => {
  const g = window.game;
  const helis = g.units.units.filter((u) => u.kind === 'helicopter');
  return { pads: g.city.helipads, helis: helis.map((h) => ({ x: h.x, z: h.z, y: h.y, state: h.state, pad: h.pad })) };
});
console.log('helipads:', JSON.stringify(pads.pads), '\nhelis:', JSON.stringify(pads.helis));

// --- delayed reporting: ignite a fire far away; no alert arrow until reported
await page.evaluate(() => {
  const g = window.game;
  // far corner, few witnesses
  for (const [x, z] of [[230, 230], [231, 230]]) {
    const y = g.city.grid.topY(x, z);
    if (y >= 0) g.fire.ignite(g.city.grid.idx(x, y, z));
  }
});
await page.waitForTimeout(4000); // ~1.4s game time
const early = await page.evaluate(() => ({
  arrows: [...document.querySelectorAll('.alert-arrow')].filter((a) => a.style.display !== 'none').length,
  reported: window.game.clusters.clusters.map((c) => window.game.detection.isReported(c.id)),
}));
console.log('early (should be unreported):', JSON.stringify(early));
// fast-forward detection by aging it artificially
await page.evaluate(() => window.game.detection.update(60));
await page.waitForTimeout(1500);
const later = await page.evaluate(() => ({
  arrows: [...document.querySelectorAll('.alert-arrow')].filter((a) => a.style.display !== 'none').length,
  reported: window.game.clusters.clusters.map((c) => window.game.detection.isReported(c.id)),
}));
console.log('after delay (should be reported, arrows > 0):', JSON.stringify(later));

// --- monthly budget: force month end
const month = await page.evaluate(() => {
  const g = window.game;
  const cash = g.economy.cash;
  g.budget.timeLeft = 0.01;
  return cash;
});
await page.waitForTimeout(1500);
const monthAfter = await page.evaluate(() => ({
  month: window.game.budget.month,
  report: window.game.budget.lastReport,
  cash: window.game.economy.cash,
}));
console.log('month settled:', JSON.stringify(monthAfter.report), 'cash', month, '->', monthAfter.cash);

// budget panel renders
await page.click('#budget-toggle');
await page.waitForTimeout(400);
const rows = await page.evaluate(() => document.querySelectorAll('#budget-report .b-row').length);
console.log('budget panel rows:', rows);
await page.screenshot({ path: '/tmp/st-1-budget.png' });
await page.click('#budget-toggle');

// --- refill resume: engine fighting a big fire runs dry, must come back
const resumeInfo = await page.evaluate(() => {
  const g = window.game;
  const d = g.city.stationDoor;
  let best = null, bestD = Infinity;
  for (const b of g.city.buildings) {
    if (b.kind !== 'house') continue;
    const dd = Math.hypot((b.x0+b.x1)/2 - d.x, (b.z0+b.z1)/2 - d.z);
    if (dd > 14 && dd < bestD) { bestD = dd; best = b; }
  }
  // big stubborn fire
  for (let x = best.x0; x <= best.x1; x++) for (let z = best.z0; z <= best.z1; z++) {
    const y = g.city.grid.topY(x, z);
    if (y >= 0) g.fire.ignite(g.city.grid.idx(x, y, z));
  }
  const e = g.units.units[0];
  g.units.selected = e;
  g.units.orderAt((best.x0+best.x1)/2, (best.z0+best.z1)/2);
  g.units.selected = null;
  return { fx: Math.round((best.x0+best.x1)/2), fz: Math.round((best.z0+best.z1)/2) };
});
// wait until fighting, then drain the tank
let resumed = false;
let sawReturn = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => {
    const e = window.game.units.units[0];
    if (e.state === 'fighting' && e.water > 5) e.water = 2; // force a refill trip soon
    return { state: e.state, water: e.water, ac: e.assignedCluster, fire: window.game.fire.activeFire.size };
  });
  if (s.state === 'returning' || s.state === 'refilling') sawReturn = true;
  if (sawReturn && (s.state === 'dispatching' || s.state === 'fighting') && s.fire > 0) {
    resumed = true;
    console.log('engine resumed after refill:', JSON.stringify(s));
    break;
  }
}
console.log('refill->resume worked:', resumed);

// --- turret: while fighting, chassis heading should NOT track the target
const turret = await page.evaluate(() => {
  const e = window.game.units.units[0];
  return { state: e.state, heading: e.heading, turret: e.turretAngle, differs: Math.abs(e.heading - e.turretAngle) > 0.05 };
});
console.log('turret sample:', JSON.stringify(turret));

// --- traffic: count queued cars (speed ~0 with a blocker) as a jam signal
const jam = await page.evaluate(() => {
  const cars = window.game.civilians.cars;
  const stopped = cars.filter((c) => c.speed < 0.3).length;
  return { cars: cars.length, stopped };
});
console.log('traffic:', JSON.stringify(jam));

// --- all-units order
await page.evaluate(() => {
  const g = window.game;
  g.units.selectAll = true;
  g.units.orderAt(150, 150);
});
await page.waitForTimeout(300);
const allOrder = await page.evaluate(() => ({
  ordered: window.game.units.units.filter((u) => u.orderedTarget).length,
  total: window.game.units.units.length,
  selectAllReset: window.game.units.selectAll === false,
}));
console.log('all-units order:', JSON.stringify(allOrder));

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
await server.close();
process.exit(errors.length || !resumed ? 1 : 0);
