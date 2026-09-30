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
const targetRmsDbfs = -20;
const peakCeilingDbfs = -2;

const variants = [
  {
    file: 'rim-light-01.ogg',
    label: 'light',
    seed: 140092026,
    duration: 0.225,
    fundamental: 610,
    decay: 25,
    strike: 0.66,
    lowBody: 0.08,
  },
  {
    file: 'rim-medium-01.ogg',
    label: 'medium',
    seed: 240092026,
    duration: 0.275,
    fundamental: 622,
    decay: 21,
    strike: 0.82,
    lowBody: 0.105,
  },
  {
    file: 'rim-hard-01.ogg',
    label: 'hard',
    seed: 340092026,
    duration: 0.335,
    fundamental: 598,
    decay: 17.5,
    strike: 1,
    lowBody: 0.135,
  },
];

const modeRatios = [1, 1.618, 2.37, 3.51, 4.64];
const modeWeights = [1, 0.62, 0.39, 0.24, 0.14];

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

function synthesizeRim(settings) {
  const length = Math.round(settings.duration * sampleRate);
  const samples = new Float32Array(length);
  const random = seededRandom(settings.seed);
  const phases = modeRatios.map(() => random() * Math.PI * 2);
  const detunePhases = modeRatios.map(() => random() * Math.PI * 2);
  let lowNoise = 0;

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const attack = Math.min(1, time / 0.00028);
    const endFade = Math.min(1, (settings.duration - time) / 0.014);
    let ring = 0;

    for (let mode = 0; mode < modeRatios.length; mode += 1) {
      const frequency = settings.fundamental * modeRatios[mode];
      phases[mode] += Math.PI * 2 * frequency / sampleRate;
      detunePhases[mode] += Math.PI * 2 * (frequency * (1.0025 + mode * 0.0007)) / sampleRate;
      const modeDecay = settings.decay * (1 + mode * 0.22);
      const doublet = Math.sin(phases[mode]) + Math.sin(detunePhases[mode]) * 0.32;
      ring += doublet * modeWeights[mode] * Math.exp(-time * modeDecay);
    }

    const white = random() * 2 - 1;
    lowNoise = lowNoise * 0.74 + white * 0.26;
    const highNoise = white - lowNoise;
    const strike = highNoise * Math.exp(-time * 255) * settings.strike;
    const scrape = lowNoise * Math.exp(-time * 92) * settings.strike * 0.2;
    const ballContact = Math.sin(Math.PI * 2 * 175 * time) * Math.exp(-time * 68) * settings.lowBody;
    const flex = Math.sin(Math.PI * 2 * (365 - time * 120) * time) * Math.exp(-time * 48) * settings.lowBody * 0.52;
    const mixed = ring * 0.42 + strike * 0.7 + scrape + ballContact + flex;

    samples[index] = Math.tanh(mixed * 0.9) / Math.tanh(0.9) * attack * endFade;
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
  Math.random = seededRandom(seed ^ 0x5a5a5a5a);
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
    const samples = synthesizeRim(variant);
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
