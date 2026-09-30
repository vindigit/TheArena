#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const donorPath = path.join(root, 'public/assets/textures/metal/painted-metal-v1.webp');
const outputPath = path.join(root, 'public/assets/textures/seating/seating-v1.webp');
const inspectDir = path.join(root, '.tmp/seating');
const inspect = process.argv.includes('--inspect');
const size = 512;
const seed = 30092026;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
const smoothstep = (value) => value * value * (3 - 2 * value);

function lattice(x, y, period) {
  const px = ((x % period) + period) % period;
  const py = ((y % period) + period) % period;
  let value = Math.imul(px + seed, 374761393) ^ Math.imul(py + period, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
}

function periodicNoise(u, v, period) {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const a = lattice(ix, iy, period) * (1 - fx) + lattice(ix + 1, iy, period) * fx;
  const b = lattice(ix, iy + 1, period) * (1 - fx) + lattice(ix + 1, iy + 1, period) * fx;
  return a * (1 - fy) + b * fy;
}

const donorBytes = await readFile(donorPath);
if (hash(donorBytes) !== '8a3ee897045afe19429895dfd72ae1e02e07c0ab14e104c95afee80caaa92c29') {
  throw new Error('Accepted painted-metal donor hash changed');
}
const { data: donor } = await sharp(donorBytes)
  .resize(size, size, { kernel: 'lanczos3' })
  .blur(1.6)
  .toColourspace('srgb')
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const donorMean = Array.from({ length: size * size }, (_, i) =>
  (donor[i * 3] + donor[i * 3 + 1] + donor[i * 3 + 2]) / 3,
).reduce((sum, value) => sum + value, 0) / (size * size);
const pixels = Buffer.alloc(size * size * 3);

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const u = x / size;
    const v = y / size;
    const broad = periodicNoise(u, v, 3);
    const medium = periodicNoise(u, v, 7);
    const fine = periodicNoise(u, v, 13);
    const purple = smoothstep(Math.max(0, Math.min(1, (broad + 0.02) / 0.55)));
    const wear = smoothstep(Math.max(0, Math.min(1, (medium - 0.25) / 0.45)));
    const index = (y * size + x) * 3;
    const donorVariation = ((donor[index] + donor[index + 1] + donor[index + 2]) / 3 - donorMean) * 0.22;
    const tone = broad * 8 + medium * 3 + fine * 1.2 + donorVariation;
    pixels[index] = clamp(40 + tone + purple * 15 + wear * 5);
    pixels[index + 1] = clamp(39 + tone * 0.75 + purple * 6 + wear * 4);
    pixels[index + 2] = clamp(67 + tone * 1.05 + purple * 18 + wear * 6);
  }
}

const source = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
  .toColourspace('srgb').png().toBuffer();
const runtime = await sharp(source)
  .resize(256, 256, { kernel: 'lanczos3' })
  .webp({ quality: 90, effort: 6 })
  .toBuffer();
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, runtime);

if (inspect) {
  await mkdir(inspectDir, { recursive: true });
  await writeFile(path.join(inspectDir, 'source.png'), source);
  const tile = await sharp(runtime).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 3, background: '#fff' } })
    .composite([
      { input: tile, left: 0, top: 0 }, { input: tile, left: 256, top: 0 },
      { input: tile, left: 0, top: 256 }, { input: tile, left: 256, top: 256 },
    ]).png().toFile(path.join(inspectDir, 'tile-proof.png'));
  const small64 = await sharp(runtime).resize(64, 64, { kernel: 'lanczos3' }).resize(256, 256, { kernel: 'nearest' }).png().toBuffer();
  const small32 = await sharp(runtime).resize(32, 32, { kernel: 'lanczos3' }).resize(256, 256, { kernel: 'nearest' }).png().toBuffer();
  await sharp({ create: { width: 512, height: 256, channels: 3, background: '#fff' } })
    .composite([{ input: small64, left: 0, top: 0 }, { input: small32, left: 256, top: 0 }])
    .png().toFile(path.join(inspectDir, 'small-proof.png'));
}

console.log(JSON.stringify({
  donorBytes: donorBytes.length, donorSha256: hash(donorBytes),
  sourceBytes: source.length, sourceSha256: hash(source),
  runtimeBytes: runtime.length, runtimeSha256: hash(runtime),
  sourceSize: [size, size], runtimeSize: [256, 256], seed,
  output: path.relative(root, outputPath).replaceAll('\\', '/'),
}));
