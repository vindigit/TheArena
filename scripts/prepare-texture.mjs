#!/usr/bin/env node

import path from 'node:path';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [input, output, qualityArg = '76'] = process.argv.slice(2);
const quality = Number(qualityArg);

if (!input || !output || process.argv.length > 5 || !Number.isInteger(quality) || quality < 1 || quality > 100) {
  throw new Error('usage: npm run assets:optimize:texture -- <source.png> <candidate.webp> [quality 1-100]');
}

const insideRoot = (candidate) => {
  const relative = path.relative(root, candidate);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const source = await realpath(path.resolve(input));
const destination = path.resolve(output);
if (!insideRoot(source) || !insideRoot(destination) || source === destination) {
  throw new Error('input and output must be separate paths inside this repository');
}
if (path.extname(destination).toLowerCase() !== '.webp') {
  throw new Error('output must be a .webp file');
}

const metadata = await sharp(source).metadata();
if (!metadata.width || !metadata.height || metadata.width > 1024 || metadata.height > 1024) {
  throw new Error('source must have dimensions no larger than 1024 x 1024');
}
if (metadata.hasAlpha) throw new Error('this color-texture recipe expects an opaque source');

await mkdir(path.dirname(destination), { recursive: true });
if (!insideRoot(await realpath(path.dirname(destination)))) {
  throw new Error('output directory resolves outside this repository');
}
if (await stat(destination).catch(() => null)) {
  throw new Error('output already exists; use a new candidate filename');
}
const result = await sharp(source).webp({ quality, effort: 6 }).toFile(destination);
console.log(`${path.relative(root, destination)}: ${result.width}x${result.height}, ${result.size} bytes, WebP quality ${quality}`);
