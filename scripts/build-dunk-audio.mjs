#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Encoder = require('vorbis-encoder-js').encoder;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'public', 'assets', 'audio', 'gameplay');
const outputFile = 'dunk-impact-01.ogg';
const sampleRate = 32000;
const quality = -0.1;
const duration = 0.46;
const seed = 170092026;
const targetRmsDbfs = -19.5;
const peakCeilingDbfs = -2.2;

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

function synthesizeDunk() {
  const length = Math.round(duration * sampleRate);
  const samples = new Float32Array(length);
  const random = seededRandom(seed);
  const netLowAlpha = onePoleAlpha(1050);
  const netHighAlpha = onePoleAlpha(6900);
  const strikeLowAlpha = onePoleAlpha(360);
  const strikeHighAlpha = onePoleAlpha(4600);
  const rimModes = [
    { frequency: 565, decay: 20, gain: 0.24, phase: 0.15 },
    { frequency: 918, decay: 23, gain: 0.17, phase: 1.12 },
    { frequency: 1368, decay: 28, gain: 0.1, phase: 0.62 },
    { frequency: 2115, decay: 34, gain: 0.055, phase: 1.8 },
  ];
  const supportModes = [
    { frequency: 92, decay: 12.5, gain: 0.19, phase: 0.3 },
    { frequency: 147, decay: 14.5, gain: 0.13, phase: 1.1 },
    { frequency: 224, decay: 18, gain: 0.075, phase: 2.05 },
  ];
  let netLow = 0;
  let netHigh = 0;
  let strikeLow = 0;
  let strikeHigh = 0;
  let compressionPhase = 0;

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const attack = Math.min(1, time / 0.00055);
    const endFade = Math.min(1, (duration - time) / 0.018);
    const white = random() * 2 - 1;

    netLow += netLowAlpha * (white - netLow);
    netHigh += netHighAlpha * (white - netHigh);
    strikeLow += strikeLowAlpha * (white - strikeLow);
    strikeHigh += strikeHighAlpha * (white - strikeHigh);

    const compressionFrequency = 68 + (182 - 68) * Math.exp(-time * 31);
    compressionPhase += Math.PI * 2 * compressionFrequency / sampleRate;
    const ballCompression = (
      Math.sin(compressionPhase) * 0.74
      + Math.sin(compressionPhase * 2.02 + 0.4) * 0.16
    ) * Math.exp(-time * 24);

    let rimFlex = 0;
    for (const mode of rimModes) {
      const paired = Math.sin(Math.PI * 2 * mode.frequency * time + mode.phase)
        + Math.sin(Math.PI * 2 * mode.frequency * 1.012 * time + mode.phase + 0.35) * 0.52;
      rimFlex += paired * Math.exp(-time * mode.decay) * mode.gain;
    }

    const strike = (strikeHigh - strikeLow) * Math.exp(-time * 92) * 0.68;
    const netEnvelope = time >= 0.008
      ? Math.exp(-(time - 0.008) * 43) * (0.7 + 0.3 * Math.sin(Math.PI * 2 * 53 * time) ** 2)
      : 0;
    const netSnap = (netHigh - netLow) * netEnvelope * 0.57;

    let netKnots = 0;
    for (const knotAt of [0.014, 0.0225, 0.034, 0.048, 0.067]) {
      const knotTime = time - knotAt;
      if (knotTime >= 0 && knotTime < 0.018) {
        netKnots += Math.sin(Math.PI * 2 * (2800 + knotAt * 13000) * knotTime)
          * Math.exp(-knotTime * 210) * 0.085;
      }
    }

    let supportVibration = 0;
    const supportTime = time - 0.017;
    if (supportTime >= 0) {
      for (const mode of supportModes) {
        supportVibration += Math.sin(Math.PI * 2 * mode.frequency * supportTime + mode.phase)
          * Math.exp(-supportTime * mode.decay) * mode.gain;
      }
    }

    const mixed = ballCompression + rimFlex + strike + netSnap + netKnots + supportVibration;
    samples[index] = Math.tanh(mixed * 0.78) / Math.tanh(0.78) * attack * endFade;
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

async function encodeOgg(samples) {
  const originalRandom = Math.random;
  const originalDateNow = Date.now;
  Math.random = seededRandom(seed ^ 0x2d2d2d2d);
  Date.now = () => 1759272000000 + seed;
  try {
    const encoder = new Encoder(sampleRate, 1, quality, {
      TITLE: 'dunk-impact-01',
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
  const samples = synthesizeDunk();
  const encoded = await encodeOgg(samples);
  const outputPath = path.join(outputDirectory, outputFile);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
