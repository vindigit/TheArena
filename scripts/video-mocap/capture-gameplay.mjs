// Deterministic gameplay capture for review evidence (see docs/VIDEO_MOCAP.md).
// usage: node capture-gameplay.mjs URL OUT_DIR [width height]  (needs playwright)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [url, out, w, h] = [process.argv[2], process.argv[3], +(process.argv[4] || 1280), +(process.argv[5] || 720)];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
// Virtual time: performance.now/Date advance only in __advance, and queued
// requestAnimationFrame callbacks run once per advanced game frame.
await page.addInitScript(() => {
  let now = 0; const q = []; const base = Date.now();
  performance.now = () => now; Date.now = () => base + now;
  Object.defineProperty(Event.prototype, 'timeStamp', { get() { return now; } });
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  window.__advance = (ms, slice = 1000 / 60) => { const end = now + ms; while (now < end - 1e-6) { now = Math.min(end, now + slice); const run = q.splice(0); for (const cb of run) cb(now); } };
});
await page.goto(url); await page.waitForTimeout(2500);
const step = async ms => { await page.evaluate(m => window.__advance(m), ms); };
await step(3000);
let n = 0; const frame = async (count = 1) => { for (let i = 0; i < count; i++) { await step(1000 / 30); await page.screenshot({ path: `${out}/${String(n++).padStart(4, "0")}.png`, timeout: 180000 }); } };
const diag = () => page.evaluate(() => document.querySelector('.feedback, #feedback')?.textContent || '');
await page.keyboard.down('Space'); await step(50); await page.keyboard.up('Space'); await step(1500);
// Two jump shots: hold ~0.66 s (green centre), release, watch the flight.
for (let rep = 0; rep < 2; rep++) {
  await frame(8);
  await page.keyboard.down('Space'); await frame(20); await page.keyboard.up('Space'); await frame(40);
  await page.keyboard.press('KeyR'); await step(600);
}
// Drive at the hoop, then layup.
for (const walk of [62, 72]) {
  await page.keyboard.down('KeyW'); await frame(walk);
  await page.keyboard.press('KeyF'); await page.keyboard.up('KeyW'); await frame(45);
  await page.keyboard.press('KeyR'); await step(600);
}
console.log(JSON.stringify({ frames: n, errors }));
await browser.close();
