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
const targetRmsDbfs = -18.5;
const peakCeilingDbfs = -1.5;

const variants = [
  {
    file: 'dribble-01.ogg',
    seed: 129092026,
    duration: 0.235,
    bodyStart: 176,
    bodyEnd: 61,
    bodyDecay: 27,
    shellFrequency: 318,
    shellDecay: 43,
    woodFrequency: 690,
    woodDecay: 67,
  },
  {
    file: 'dribble-02.ogg',
    seed: 229092026,
    duration: 0.225,
    bodyStart: 188,
    bodyEnd: 66,
    bodyDecay: 29,
    shellFrequency: 346,
    shellDecay: 46,
    woodFrequency: 735,
    woodDecay: 72,
  },
  {
    file: 'dribble-03.ogg',
    seed: 329092026,
    duration: 0.245,
    bodyStart: 164,
    bodyEnd: 57,
    bodyDecay: 25,
    shellFrequency: 294,
    shellDecay: 40,
    woodFrequency: 648,
    woodDecay: 63,
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

function synthesizeBounce(settings) {
  const length = Math.round(settings.duration * sampleRate);
  const samples = new Float32Array(length);
  const random = seededRandom(settings.seed);
  let bodyPhase = 0;
  let shellPhase = random() * Math.PI * 2;
  let woodPhase = random() * Math.PI * 2;
  let lowNoise = 0;

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const bodyFrequency = settings.bodyEnd
      + (settings.bodyStart - settings.bodyEnd) * Math.exp(-time * 31);
    bodyPhase += Math.PI * 2 * bodyFrequency / sampleRate;
    shellPhase += Math.PI * 2 * settings.shellFrequency / sampleRate;
    woodPhase += Math.PI * 2 * settings.woodFrequency / sampleRate;

    const white = random() * 2 - 1;
    lowNoise = lowNoise * 0.84 + white * 0.16;
    const highNoise = white - lowNoise;
    const attack = Math.min(1, time / 0.00045);
    const endFade = Math.min(1, (settings.duration - time) / 0.014);

    const body = Math.sin(bodyPhase) * Math.exp(-time * settings.bodyDecay) * 0.86;
    const shell = Math.sin(shellPhase) * Math.exp(-time * settings.shellDecay) * 0.25;
    const wood = Math.sin(woodPhase) * Math.exp(-time * settings.woodDecay) * 0.105;
    const floorSlap = highNoise * Math.exp(-time * 118) * 0.39;
    const leatherTexture = lowNoise * Math.exp(-time * 54) * 0.16;
    const pressureClick = Math.sin(Math.PI * 2 * 1160 * time) * Math.exp(-time * 145) * 0.075;
    const mixed = body + shell + wood + floorSlap + leatherTexture + pressureClick;

    samples[index] = Math.tanh(mixed * 1.08) / Math.tanh(1.08) * attack * endFade;
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
  // libogg selects a stream serial through Math.random(). Pinning it makes the
  // encoded container reproducible in addition to the seeded PCM synthesis.
  // The Emscripten build also seeds its C PRNG through time(), backed by
  // Date.now(), so pin both sources for the short encoding call.
  const originalRandom = Math.random;
  const originalDateNow = Date.now;
  Math.random = seededRandom(seed ^ 0xa5a5a5a5);
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
    const samples = synthesizeBounce(variant);
    const encoded = await encodeOgg(samples, variant.file.replace('.ogg', ''), variant.seed);
    const outputPath = path.join(outputDirectory, variant.file);
    await writeFile(outputPath, encoded);
    const metrics = measure(samples);
    console.log(JSON.stringify({
      file: path.relative(projectRoot, outputPath).replaceAll('\\', '/'),
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
