#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Encoder = require('vorbis-encoder-js').encoder;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'public', 'assets', 'audio', 'gameplay');
const sampleRate = 32000;
const quality = -0.1;
const targetRmsDbfs = -21;
const peakCeilingDbfs = -2;

const variants = [
  {
    file: 'backboard-soft-01.ogg',
    label: 'soft',
    seed: 150092026,
    duration: 0.17,
    panelFrequency: 246,
    panelDecay: 35,
    strike: 0.62,
    rattle: 0.16,
  },
  {
    file: 'backboard-medium-01.ogg',
    label: 'medium',
    seed: 250092026,
    duration: 0.205,
    panelFrequency: 258,
    panelDecay: 31,
    strike: 0.82,
    rattle: 0.21,
  },
  {
    file: 'backboard-hard-01.ogg',
    label: 'hard',
    seed: 350092026,
    duration: 0.245,
    panelFrequency: 238,
    panelDecay: 27,
    strike: 1,
    rattle: 0.27,
  },
];

const panelRatios = [1, 1.47, 2.18, 3.07];
const panelWeights = [1, 0.58, 0.31, 0.16];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function dbToGain(db) {
  return 10 ** (db / 20);
}

function measure(samples) {
  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return {
    peak,
    peakDbfs: 20 * Math.log10(Math.max(peak, Number.EPSILON)),
    rms,
    rmsDbfs: 20 * Math.log10(Math.max(rms, Number.EPSILON)),
  };
}

function synthesizeBackboard(settings) {
  const length = Math.round(settings.duration * sampleRate);
  const samples = new Float32Array(length);
  const random = seededRandom(settings.seed);
  const phases = panelRatios.map(() => random() * Math.PI * 2);
  let lowNoise = 0;
  let previousWhite = 0;

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const attack = Math.min(1, time / 0.00022);
    const endFade = Math.min(1, (settings.duration - time) / 0.012);
    let panel = 0;

    for (let mode = 0; mode < panelRatios.length; mode += 1) {
      const frequency = settings.panelFrequency * panelRatios[mode];
      phases[mode] += Math.PI * 2 * frequency / sampleRate;
      const modeDecay = settings.panelDecay * (1 + mode * 0.32);
      panel += Math.sin(phases[mode]) * panelWeights[mode] * Math.exp(-time * modeDecay);
    }

    const white = random() * 2 - 1;
    lowNoise = lowNoise * 0.88 + white * 0.12;
    const highNoise = white - previousWhite * 0.72;
    previousWhite = white;
    const flatStrike = (white * 0.48 + lowNoise * 0.52) * Math.exp(-time * 175) * settings.strike;
    const glassRattle = highNoise * Math.exp(-time * 76) * settings.rattle;
    const hardwareTick = Math.sin(Math.PI * 2 * 2860 * time) * Math.exp(-time * 150) * settings.rattle * 0.42;
    const reflectionTime = Math.max(0, time - 0.015);
    const shortIndoorTail = time >= 0.015
      ? Math.sin(Math.PI * 2 * settings.panelFrequency * 1.06 * reflectionTime)
        * Math.exp(-reflectionTime * 52) * settings.strike * 0.1
      : 0;
    const mixed = panel * 0.39 + flatStrike * 0.72 + glassRattle + hardwareTick + shortIndoorTail;

    samples[index] = Math.tanh(mixed * 0.88) / Math.tanh(0.88) * attack * endFade;
  }

  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;
  for (let index = 0; index < samples.length; index += 1) samples[index] -= mean;

  const initial = measure(samples);
  const rmsScale = dbToGain(targetRmsDbfs) / initial.rms;
  const peakScale = dbToGain(peakCeilingDbfs) / initial.peak;
  const scale = Math.min(rmsScale, peakScale);
  for (let index = 0; index < samples.length; index += 1) samples[index] *= scale;
  return samples;
}

async function encodeOgg(samples, title, seed) {
  const originalRandom = Math.random;
  const originalDateNow = Date.now;
  Math.random = seededRandom(seed ^ 0x3c3c3c3c);
  Date.now = () => 1759185600000 + seed;
  try {
    const encoder = new Encoder(sampleRate, 1, quality, {
      TITLE: title,
      ARTIST: 'TheArena',
      LICENSE: 'Original locally authored project asset',
    });
    encoder.encodeFrom({
      sampleRate,
      numberOfChannels: 1,
      length: samples.length,
      getChannelData: () => samples,
    });
    const encoded = encoder.finish();
    return Buffer.from(await encoded.arrayBuffer());
  } finally {
    Math.random = originalRandom;
    Date.now = originalDateNow;
  }
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  for (const variant of variants) {
    const samples = synthesizeBackboard(variant);
    const encoded = await encodeOgg(samples, variant.file.replace('.ogg', ''), variant.seed);
    const outputPath = path.join(outputDirectory, variant.file);
    await writeFile(outputPath, encoded);
    const metrics = measure(samples);
    console.log(JSON.stringify({
      file: path.relative(projectRoot, outputPath).replaceAll('\\', '/'),
      variant: variant.label,
      bytes: encoded.length,
      sampleRate,
      channels: 1,
      durationSeconds: samples.length / sampleRate,
      sourceRmsDbfs: Number(metrics.rmsDbfs.toFixed(2)),
      sourcePeakDbfs: Number(metrics.peakDbfs.toFixed(2)),
    }));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
