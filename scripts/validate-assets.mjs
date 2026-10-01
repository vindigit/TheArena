#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, realpath, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import sharp from 'sharp';
import { checkLukeRig } from './validate-luke-rig.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(projectRoot, 'public');
const manifestPath = path.join(publicRoot, 'assets', 'manifest.json');
const schemaPath = path.join(publicRoot, 'assets', 'manifest.schema.json');
const textureFormats = new Set(['webp', 'png', 'ktx2']);

function insideDirectory(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSignature(format, data) {
  if (format === 'glb') {
    if (data.length < 12 || data.toString('ascii', 0, 4) !== 'glTF') throw new Error('invalid GLB magic');
    if (data.readUInt32LE(4) !== 2) throw new Error('GLB must use version 2');
    if (data.readUInt32LE(8) !== data.length) throw new Error('GLB header length does not match file');
  } else if (format === 'png') {
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error('invalid PNG signature');
    }
  } else if (format === 'webp') {
    if (data.length < 12 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') {
      throw new Error('invalid WebP signature');
    }
  } else if (format === 'ktx2') {
    const signature = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (data.length < 28 || !data.subarray(0, 12).equals(signature)) throw new Error('invalid KTX2 signature');
  } else if (format === 'ogg') {
    if (data.length < 4 || data.toString('ascii', 0, 4) !== 'OggS') throw new Error('invalid OGG signature');
  } else if (format === 'mp3') {
    const id3 = data.length >= 3 && data.toString('ascii', 0, 3) === 'ID3';
    const frame = data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0;
    if (!id3 && !frame) throw new Error('invalid MP3 signature');
  }
}

async function seamMetrics(data) {
  const { data: pixels, info } = await sharp(data)
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const comparedChannels = Math.min(channels, 3);
  let leftRightSum = 0;
  let topBottomSum = 0;
  let peak = 0;

  for (let y = 0; y < height; y += 1) {
    for (let channel = 0; channel < comparedChannels; channel += 1) {
      const left = pixels[(y * width) * channels + channel];
      const right = pixels[(y * width + width - 1) * channels + channel];
      const difference = Math.abs(left - right);
      leftRightSum += difference;
      peak = Math.max(peak, difference);
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let channel = 0; channel < comparedChannels; channel += 1) {
      const top = pixels[x * channels + channel];
      const bottom = pixels[((height - 1) * width + x) * channels + channel];
      const difference = Math.abs(top - bottom);
      topBottomSum += difference;
      peak = Math.max(peak, difference);
    }
  }

  const leftRightMean = leftRightSum / (height * comparedChannels);
  const topBottomMean = topBottomSum / (width * comparedChannels);
  return {
    width,
    height,
    leftRightMean,
    topBottomMean,
    combinedMean: (leftRightSum + topBottomSum) / ((width + height) * comparedChannels),
    peak,
  };
}

function formatSeam(metrics) {
  return `left/right ${metrics.leftRightMean.toFixed(2)}, top/bottom ${metrics.topBottomMean.toFixed(2)}, combined ${metrics.combinedMean.toFixed(2)}, peak ${metrics.peak} (RGB 0–255)`;
}

async function inspectRuntime(asset, entry) {
  const label = `${asset.id}: ${entry.path}`;
  if (path.posix.normalize(entry.path) !== entry.path || entry.path.includes('\\')) {
    throw new Error(`${label}: runtime path is not normalized`);
  }
  if (path.posix.extname(entry.path) !== `.${entry.format}`) {
    throw new Error(`${label}: format does not match the filename extension`);
  }
  const absolutePath = path.resolve(publicRoot, ...entry.path.split('/'));
  if (!insideDirectory(absolutePath, publicRoot)) throw new Error(`${label}: path escapes public/`);
  const resolvedPath = await realpath(absolutePath);
  if (!insideDirectory(resolvedPath, publicRoot)) throw new Error(`${label}: symlink escapes public/`);
  if (!(await stat(resolvedPath)).isFile()) throw new Error(`${label}: expected a regular file`);

  const data = await readFile(resolvedPath);
  if (data.length !== entry.bytes) {
    throw new Error(`${label}: bytes mismatch (manifest ${entry.bytes}, file ${data.length})`);
  }
  if (entry.maxBytes !== undefined && data.length > entry.maxBytes) {
    throw new Error(`${label}: file exceeds maxBytes (${data.length} > ${entry.maxBytes})`);
  }
  const hash = createHash('sha256').update(data).digest('hex');
  if (hash !== entry.sha256) throw new Error(`${label}: SHA-256 mismatch (actual ${hash})`);
  assertSignature(entry.format, data);

  if (textureFormats.has(entry.format)) {
    if (!entry.dimensions) throw new Error(`${label}: texture dimensions are required`);
    let width;
    let height;
    if (entry.format === 'ktx2') {
      width = data.readUInt32LE(20);
      height = data.readUInt32LE(24);
    } else {
      const metadata = await sharp(data).metadata();
      width = metadata.width;
      height = metadata.height;
    }
    if (width !== entry.dimensions.width || height !== entry.dimensions.height) {
      throw new Error(`${label}: dimensions mismatch (manifest ${entry.dimensions.width}×${entry.dimensions.height}, file ${width}×${height})`);
    }
    if (entry.tiling) {
      if (entry.format === 'ktx2') throw new Error(`${label}: seam checks need a PNG or WebP source`);
      const metrics = await seamMetrics(data);
      console.log(`  SEAM ${label}: ${formatSeam(metrics)}`);
      if (metrics.leftRightMean > entry.tiling.maxMeanRgbError || metrics.topBottomMean > entry.tiling.maxMeanRgbError) {
        throw new Error(`${label}: seam mean exceeds maxMeanRgbError ${entry.tiling.maxMeanRgbError}`);
      }
      if (entry.tiling.maxPeakRgbError !== undefined && metrics.peak > entry.tiling.maxPeakRgbError) {
        throw new Error(`${label}: seam peak exceeds maxPeakRgbError ${entry.tiling.maxPeakRgbError}`);
      }
    }
  } else if (entry.dimensions || entry.tiling) {
    throw new Error(`${label}: dimensions and tiling apply only to textures`);
  }

  console.log(`  OK   ${label} (${data.length} bytes, SHA-256 verified)`);
  return data.length;
}

async function checkManifest() {
  const [schema, manifest] = await Promise.all([
    readFile(schemaPath, 'utf8').then(JSON.parse),
    readFile(manifestPath, 'utf8').then(JSON.parse),
  ]);
  const validate = new Ajv({ allErrors: true }).compile(schema);
  if (!validate(manifest)) {
    const details = validate.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('\n  ');
    throw new Error(`manifest schema validation failed:\n  ${details}`);
  }

  const errors = [];
  const ids = new Set();
  const paths = new Set();
  let fileCount = 0;
  let totalBytes = 0;
  for (const asset of manifest.assets) {
    if (ids.has(asset.id)) errors.push(`duplicate asset ID: ${asset.id}`);
    ids.add(asset.id);
    for (const [name, result] of Object.entries(asset.validation.checks)) {
      // A review preview exists specifically to obtain appearance approval.
      // Technical pending/failing checks still block publication.
      if (asset.status === 'preview' && name === 'appearanceApproval' && result === 'pending') continue;
      if (result === 'fail' || result === 'pending') errors.push(`${asset.id}: ${name} check is ${result}`);
    }
    for (const entry of asset.runtime) {
      if (paths.has(entry.path)) errors.push(`duplicate runtime path: ${entry.path}`);
      paths.add(entry.path);
      try {
        totalBytes += await inspectRuntime(asset, entry);
        fileCount += 1;
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  if (errors.length) throw new Error(`asset validation failed:\n  ${errors.join('\n  ')}`);
  const playerFiles = (await readdir(path.join(publicRoot, 'assets', 'models', 'player'))).filter(name => name.endsWith('.glb'));
  if (playerFiles.length !== 1 || playerFiles[0] !== 'luke-player-v1.glb') {
    throw new Error('Only the canonical Luke GLB may be published in the player asset directory');
  }
  const playerAssets = manifest.assets.filter(asset => asset.runtime.some(entry => entry.path.startsWith('assets/models/player/')));
  if (playerAssets.length !== 1 || playerAssets[0].id !== 'luke-player-v1') {
    throw new Error('Luke must be the only player model in the production inventory');
  }
  await checkLukeRig();
  console.log(`Assets valid: ${manifest.assets.filter(a => a.status === 'accepted').length} accepted assets, ${manifest.assets.filter(a => a.status === 'preview').length} preview assets, ${fileCount} runtime files, ${totalBytes} bytes.`);
}

async function main() {
  if (process.argv[2] === '--seam') {
    if (!process.argv[3] || process.argv.length !== 4) throw new Error('usage: npm run assets:check -- --seam <PNG-or-WebP-path>');
    const sourcePath = path.resolve(process.cwd(), process.argv[3]);
    if (!insideDirectory(sourcePath, projectRoot)) throw new Error('seam inspection path must be inside this repository');
    const data = await readFile(sourcePath);
    const metrics = await seamMetrics(data);
    console.log(`${path.relative(projectRoot, sourcePath)} (${metrics.width}×${metrics.height}): ${formatSeam(metrics)}`);
  } else if (process.argv.length === 2) {
    await checkManifest();
  } else {
    throw new Error('usage: npm run assets:check [-- --seam <PNG-or-WebP-path>]');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
