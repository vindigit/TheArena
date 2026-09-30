#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Encoder = require('vorbis-encoder-js').encoder;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'public', 'assets', 'audio', 'ambience');
const outputFile = 'arena-loop-01.ogg';
const sampleRate = 32000;
const loopDuration = 8;
const loopLength = sampleRate * loopDuration;
const loopGuardSeconds = 0.25;
const loopGuardLength = sampleRate * loopGuardSeconds;
const quality = -0.1;
const seed = 30092026;
const targetRmsDbfs = -28.5;
const peakCeilingDbfs = -7;

function seededRandom(initialSeed) {
  let state = initialSeed >>> 0;
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

function gainToDb(gain) {
  return 20 * Math.log10(Math.max(gain, Number.EPSILON));
}

function measure(samples) {
  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return { peak, peakDbfs: gainToDb(peak), rms, rmsDbfs: gainToDb(rms) };
}

function circularLowpass(input, cutoffHz, passes = 2) {
  let current = input;
  const alpha = 1 - Math.exp(-Math.PI * 2 * cutoffHz / sampleRate);

  for (let pass = 0; pass < passes; pass += 1) {
    const output = new Float32Array(input.length);
    let state = 0;
    // Repeating the same period converges the filter state at the loop boundary.
    for (let cycle = 0; cycle < 8; cycle += 1) {
      for (let index = 0; index < current.length; index += 1) {
        state += alpha * (current[index] - state);
        if (cycle === 7) output[index] = state;
      }
    }
    current = output;
  }

  return current;
}

function periodicDistance(a, b) {
  const direct = Math.abs(a - b);
  return Math.min(direct, loopDuration - direct);
}

function rotateAtQuietestJoin(samples) {
  let bestIndex = 0;
  let bestScore = Infinity;
  const length = samples.length;

  for (let index = 1; index < length - 2; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const next = samples[index + 1];
    const after = samples[index + 2];
    const levelStep = Math.abs(next - current);
    const slopeStep = Math.abs((next - current) - (after - next))
      + Math.abs((current - previous) - (next - current));
    const score = levelStep + slopeStep * 0.35;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index + 1;
    }
  }

  const rotated = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    rotated[index] = samples[(bestIndex + index) % length];
  }
  return rotated;
}

function synthesizeLoop() {
  const random = seededRandom(seed);
  const crowdNoise = new Float32Array(loopLength);
  const hvacNoise = new Float32Array(loopLength);
  const movementNoise = new Float32Array(loopLength);

  for (let index = 0; index < loopLength; index += 1) {
    crowdNoise[index] = random() * 2 - 1;
    hvacNoise[index] = random() * 2 - 1;
    movementNoise[index] = random() * 2 - 1;
  }

  const crowdHigh = circularLowpass(crowdNoise, 1750, 3);
  const crowdLow = circularLowpass(crowdNoise, 115, 3);
  const hvacAir = circularLowpass(hvacNoise, 92, 3);
  const movementHigh = circularLowpass(movementNoise, 2850, 2);
  const movementLow = circularLowpass(movementNoise, 420, 2);
  const samples = new Float32Array(loopLength);
  const movementEvents = [
    { at: 1.45, width: 0.18, gain: 0.075 },
    { at: 4.38, width: 0.24, gain: 0.055 },
    { at: 6.62, width: 0.15, gain: 0.065 },
  ];

  for (let index = 0; index < loopLength; index += 1) {
    const time = index / sampleRate;
    const slowCrowdMotion = 0.78
      + Math.sin(Math.PI * 2 * time / loopDuration) * 0.08
      + Math.sin(Math.PI * 4 * time / loopDuration + 1.15) * 0.055;
    const crowd = (crowdHigh[index] - crowdLow[index]) * slowCrowdMotion * 0.74;
    const hvac = hvacAir[index] * 0.54
      + Math.sin(Math.PI * 2 * 60 * time + 0.4) * 0.043
      + Math.sin(Math.PI * 2 * 120 * time + 1.1) * 0.012;

    let movementEnvelope = 0;
    for (const event of movementEvents) {
      const distance = periodicDistance(time, event.at);
      movementEnvelope += Math.exp(-(distance * distance) / (2 * event.width * event.width)) * event.gain;
    }
    const movement = (movementHigh[index] - movementLow[index]) * movementEnvelope;
    samples[index] = crowd + hvac + movement;
  }

  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;
  for (let index = 0; index < samples.length; index += 1) samples[index] -= mean;

  const initial = measure(samples);
  const scale = Math.min(
    dbToGain(targetRmsDbfs) / initial.rms,
    dbToGain(peakCeilingDbfs) / initial.peak,
  );
  for (let index = 0; index < samples.length; index += 1) samples[index] *= scale;

  return rotateAtQuietestJoin(samples);
}

function withLoopGuards(loop) {
  const guarded = new Float32Array(loop.length + loopGuardLength * 2);
  guarded.set(loop.subarray(loop.length - loopGuardLength), 0);
  guarded.set(loop, loopGuardLength);
  guarded.set(loop.subarray(0, loopGuardLength), loopGuardLength + loop.length);
  return guarded;
}

async function encodeOgg(samples) {
  const originalRandom = Math.random;
  const originalDateNow = Date.now;
  Math.random = seededRandom(seed ^ 0x5a17a5e1);
  Date.now = () => 1759272000000 + seed;
  try {
    const encoder = new Encoder(sampleRate, 1, quality, {
      TITLE: 'arena-loop-01',
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
  const loop = synthesizeLoop();
  const encodedSamples = withLoopGuards(loop);
  const encoded = await encodeOgg(encodedSamples);
  const outputPath = path.join(outputDirectory, outputFile);
  await writeFile(outputPath, encoded);

  const metrics = measure(loop);
  const boundaryStep = Math.abs(loop[0] - loop[loop.length - 1]);
  console.log(JSON.stringify({
    file: path.relative(projectRoot, outputPath).replaceAll('\\', '/'),
    bytes: encoded.length,
    codec: 'Vorbis in Ogg',
    sampleRate,
    channels: 1,
    loopDurationSeconds: loop.length / sampleRate,
    encodedDurationSeconds: encodedSamples.length / sampleRate,
    loopStartSeconds: loopGuardSeconds,
    loopEndSeconds: loopGuardSeconds + loopDuration,
    sourceRmsDbfs: Number(metrics.rmsDbfs.toFixed(2)),
    sourcePeakDbfs: Number(metrics.peakDbfs.toFixed(2)),
    sourceBoundaryStepDbfs: Number(gainToDb(boundaryStep).toFixed(2)),
    clippedSamples: Array.from(loop).filter((sample) => Math.abs(sample) >= 1).length,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
