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
const targetRmsDbfs = -22.5;
const peakCeilingDbfs = -3.5;

const variants = [
  {
    file: 'shoe-squeak-01.ogg',
    label: 'short rising chirp',
    seed: 160092026,
    duration: 0.125,
    startFrequency: 2280,
    endFrequency: 3420,
    tone: 0.78,
    friction: 0.32,
    flutterHz: 28,
  },
  {
    file: 'shoe-squeak-02.ogg',
    label: 'short falling chirp',
    seed: 260092026,
    duration: 0.15,
    startFrequency: 3260,
    endFrequency: 2440,
    tone: 0.7,
    friction: 0.38,
    flutterHz: 34,
  },
  {
    file: 'shoe-skid-01.ogg',
    label: 'brief lateral skid',
    seed: 360092026,
    duration: 0.205,
    startFrequency: 2140,
    endFrequency: 2740,
    tone: 0.52,
    friction: 0.56,
    flutterHz: 22,
  },
];

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

function onePoleAlpha(cutoffHz) {
  return 1 - Math.exp(-Math.PI * 2 * cutoffHz / sampleRate);
}

function synthesizeShoe(settings) {
  const length = Math.round(settings.duration * sampleRate);
  const samples = new Float32Array(length);
  const random = seededRandom(settings.seed);
  const lowAlpha = onePoleAlpha(720);
  const highAlpha = onePoleAlpha(6200);
  let lowNoise = 0;
  let highNoise = 0;
  let phase = random() * Math.PI * 2;
  let rubberMemory = 0;

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const progress = time / settings.duration;
    const attack = Math.min(1, time / 0.00065);
    const endFade = Math.min(1, (settings.duration - time) / 0.014);
    const decay = Math.exp(-progress * (settings.label.includes('skid') ? 1.35 : 2.15));
    const flutter = 0.76
      + 0.18 * Math.sin(Math.PI * 2 * settings.flutterHz * time + 0.4)
      + 0.06 * Math.sin(Math.PI * 2 * settings.flutterHz * 0.37 * time + 1.6);
    const curve = progress * progress * (3 - 2 * progress);
    const centerFrequency = settings.startFrequency
      + (settings.endFrequency - settings.startFrequency) * curve
      + Math.sin(Math.PI * 2 * 41 * time) * 72;
    phase += Math.PI * 2 * centerFrequency / sampleRate;

    const rubberTone = (
      Math.sin(phase)
      + Math.sin(phase * 1.46 + 0.7) * 0.24
      + Math.sin(phase * 1.91 + 1.1) * 0.1
    ) * settings.tone;

    const white = random() * 2 - 1;
    lowNoise += lowAlpha * (white - lowNoise);
    highNoise += highAlpha * (white - highNoise);
    const frictionBand = (highNoise - lowNoise) * settings.friction;
    rubberMemory = rubberMemory * 0.64 + frictionBand * 0.36;
    const soleRelease = Math.sin(Math.PI * 2 * 1180 * time)
      * Math.exp(-time * 95) * 0.1;
    const mixed = (rubberTone * 0.62 + rubberMemory * 0.78 + soleRelease)
      * flutter * decay;

    samples[index] = Math.tanh(mixed * 0.82) / Math.tanh(0.82) * attack * endFade;
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
  Math.random = seededRandom(seed ^ 0x2d2d2d2d);
  Date.now = () => 1759272000000 + seed;
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
    const samples = synthesizeShoe(variant);
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
