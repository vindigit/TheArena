// Run against Vite or the production preview. PLAYWRIGHT_MODULE can point to a
// bundled Playwright installation; no runtime browser package ships with game.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const [url = 'http://127.0.0.1:5173/', out = '.tmp/recovered-browser'] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const touch = viewport.width !== 1280;
    const page = await browser.newPage({ viewport, hasTouch: touch, isMobile: touch });
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => {
      let now = 0; const queue = [];
      performance.now = () => now;
      Object.defineProperty(Event.prototype, 'timeStamp', { get: () => now });
      window.requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
      window.cancelAnimationFrame = () => {};
      window.__advance = (milliseconds, slice = 1000 / 60) => {
        const end = now + milliseconds;
        while (now < end - 1e-6) {
          now = Math.min(end, now + slice);
          for (const callback of queue.splice(0)) callback(now);
        }
      };
    });
    const target = new URL(url); target.searchParams.set('inspect', '1');
    await page.goto(target.href);
    await page.waitForFunction(() => window.__arenaInspection?.snapshot().status === 'ready', null, { polling: 50 });
    const advance = milliseconds => page.evaluate(ms => window.__advance(ms), milliseconds);
    const snapshot = () => page.evaluate(() => window.__arenaInspection.snapshot());
    await advance(200);
    const options = await page.locator('#playerSelect option').count();
    assert.ok(options >= 2, 'At least two complete playable characters');
    if (touch) {
      const value = await page.locator('#playerSelect option').nth(1).getAttribute('value');
      await page.locator('#playerSelect').selectOption(value);
      await page.waitForFunction(() => !document.querySelector('#startButton').disabled, null, { polling: 50 });
      await advance(200);
    }
    await page.screenshot({ path: path.join(out, `selection-${viewport.width}.png`) });
    const startBox = await page.locator('#startButton').boundingBox();
    if (touch) await page.touchscreen.tap(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    else await page.mouse.click(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    await advance(500);
    const initial = await snapshot();
    assert.equal(initial.started, true); assert.equal(initial.status, 'ready');
    assert.ok(initial.asset.bones >= 26 && initial.asset.triangles > 1000);
    assert.equal(await page.locator('#playerPicker').isVisible(), false);
    const press = touch ? async () => {
      const box = await page.locator('#touchShoot').boundingBox();
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
      return async () => { await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await session.detach(); };
    } : async () => { await page.keyboard.down('Space'); return () => page.keyboard.up('Space'); };
    const release = await press();
    await advance(660);
    assert.equal((await snapshot()).ball.mode, 'gather');
    await page.screenshot({ path: path.join(out, `gather-${viewport.width}.png`) });
    await release(); await advance(205);
    const shot = await snapshot();
    assert.equal(shot.releaseCount, 1, 'Input commits exactly one physical release');
    assert.ok(Math.abs(shot.detachedAt - .2) < 1e-7, 'Physical release remains at 200 ms across controls');
    assert.equal(shot.ball.mode, 'flight');
    await page.screenshot({ path: path.join(out, `release-${viewport.width}.png`) });
    await advance(700);
    const reset = touch ? async () => {
      const box = await page.locator('#touchReset').boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    } : () => page.keyboard.press('KeyR');
    await reset(); await advance(100);
    assert.equal((await snapshot()).releaseCount, 0);
    const position = (await snapshot()).position;
    if (touch) {
      const box = await page.locator('#touchStick').boundingBox();
      const session = await page.context().newCDPSession(page);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 35 }] });
      await advance(450);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await session.detach();
    } else {
      await page.keyboard.down('KeyW'); await advance(450); await page.keyboard.up('KeyW');
    }
    const moving = await snapshot();
    assert.ok(Math.hypot(moving.position[0] - position[0], moving.position[2] - position[2]) > .5, 'Movement reaches game simulation');
    assert.equal(moving.action, 'move');
    await page.screenshot({ path: path.join(out, `movement-${viewport.width}.png`) });
    assert.deepEqual(errors, [], 'No browser or asset-loading errors');
    results.push({ viewport, touch, character: initial.asset.id, shot, moving, errors });
    console.log(JSON.stringify({ pass: true, viewport, character: initial.asset.id }));
    await page.close();
  }
  await writeFile(path.join(out, 'verification.json'), JSON.stringify({ pass: true, results }, null, 2));
  console.log(JSON.stringify({ pass: true, viewports: results.map(result => result.viewport), out }));
} finally { await browser.close(); }
