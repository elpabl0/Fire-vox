/**
 * Mobile verification: emulates a phone (touch, 390x844), checks tap-to-dispatch,
 * one-finger drag pan, CDP pinch zoom, on-screen pause button, and captures the
 * responsive layout.
 */
import { chromium, devices } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { port: 4191, strictPort: true } });
const errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 13'], browserName: undefined });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4191/?seed=42');
await page.waitForSelector('#start-btn');
await page.screenshot({ path: '/tmp/mb-1-title.png' });
await page.tap('#start-btn');
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/mb-2-game.png' });

// 1. one-finger drag pans the camera
const before = await page.evaluate(() => ({ x: window.game.cameraRig.target.x, z: window.game.cameraRig.target.z }));
const cdp = await context.newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 400 }] });
for (let i = 1; i <= 10; i++) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195 - i * 12, y: 400 - i * 8 }] });
  await page.waitForTimeout(30);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(200);
const after = await page.evaluate(() => ({ x: window.game.cameraRig.target.x, z: window.game.cameraRig.target.z }));
const panned = Math.hypot(after.x - before.x, after.z - before.z);
console.log('drag pan moved target by', panned.toFixed(1), 'voxels');

// drag must NOT have issued an order
const ordered0 = await page.evaluate(() => window.game.units.units.some((u) => u.orderedTarget));
console.log('order issued by drag (should be false):', ordered0);

// 2. pinch zoom
const distBefore = await page.evaluate(() => window.game.cameraRig.distance);
await cdp.send('Input.synthesizePinchGesture', { x: 195, y: 400, scaleFactor: 2.0, relativeSpeed: 600 });
await page.waitForTimeout(300);
const distAfter = await page.evaluate(() => window.game.cameraRig.distance);
console.log('pinch zoom distance:', distBefore.toFixed(0), '->', distAfter.toFixed(0));

// pinch must not have issued an order either
const ordered1 = await page.evaluate(() => window.game.units.units.some((u) => u.orderedTarget));
console.log('order issued by pinch (should be false):', ordered1);

// 3. tap a fire to dispatch
const firePt = await page.evaluate(() => {
  const g = window.game;
  const d = g.city.stationDoor;
  const fx = d.x + 18, fz = d.z;
  let lit = false;
  for (let r = 0; r < 8 && !lit; r++) {
    const y = g.city.grid.topY(fx + r, fz);
    if (y >= 0 && g.fire.ignite(g.city.grid.idx(fx + r, y, fz))) lit = true;
  }
  g.cameraRig.target.set(fx, 0, fz);
  g.cameraRig.distance = 60;
  return { fx, fz };
});
await page.waitForTimeout(800);
// project fire point to screen
const pt = await page.evaluate(({ fx, fz }) => {
  const g = window.game;
  const v = new (g.cameraRig.target.constructor)(fx, 2, fz);
  v.project(g.renderer.camera);
  return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((-v.y + 1) / 2) * window.innerHeight };
}, firePt);
await page.touchscreen.tap(pt.x, pt.y);
await page.waitForTimeout(400);
const state = await page.evaluate(() => window.game.units.units.map((u) => `${u.state} ordered=${!!u.orderedTarget}`));
console.log('after tap on fire:', JSON.stringify(state));

// 4. pause button
await page.tap('#btn-pause');
await page.waitForTimeout(200);
console.log('paused via button:', await page.evaluate(() => window.game.paused));
await page.tap('#btn-pause');

await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/mb-3-dispatched.png' });
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
