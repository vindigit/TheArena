import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AudioDirector } from '../src/audio.js';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

class MockAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  setValueAtTime(value, at) {
    this.value = value;
    this.events.push(['set', value, at]);
  }

  exponentialRampToValueAtTime(value, at) {
    this.value = value;
    this.events.push(['exponential', value, at]);
  }

  setTargetAtTime(value, at, constant) {
    this.value = value;
    this.events.push(['target', value, at, constant]);
  }
}

class MockNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.disconnected = true;
    this.connections = [];
  }
}

class MockAudioContext {
  constructor({ decodeFails = false } = {}) {
    this.state = 'suspended';
    this.currentTime = 4;
    this.sampleRate = 32000;
    this.destination = new MockNode('destination');
    this.decodeFails = decodeFails;
    this.sources = [];
    this.oscillators = [];
    this.gains = [];
    this.resumeCalls = 0;
  }

  async resume() {
    this.resumeCalls += 1;
    this.state = 'running';
  }

  createDynamicsCompressor() {
    const node = new MockNode('compressor');
    node.threshold = new MockAudioParam();
    node.knee = new MockAudioParam();
    node.ratio = new MockAudioParam();
    node.attack = new MockAudioParam();
    node.release = new MockAudioParam();
    return node;
  }

  createGain() {
    const node = new MockNode('gain');
    node.gain = new MockAudioParam(1);
    this.gains.push(node);
    return node;
  }

  createBufferSource() {
    const node = new MockNode('source');
    node.loop = false;
    node.playbackRate = new MockAudioParam(1);
    node.start = (at) => { node.startedAt = at; };
    node.stop = (at) => { node.stoppedAt = at; };
    this.sources.push(node);
    return node;
  }

  createOscillator() {
    const node = new MockNode('oscillator');
    node.frequency = new MockAudioParam();
    node.start = (at) => { node.startedAt = at; };
    node.stop = (at) => { node.stoppedAt = at; };
    this.oscillators.push(node);
    return node;
  }

  createBiquadFilter() {
    const node = new MockNode('filter');
    node.frequency = new MockAudioParam();
    node.Q = new MockAudioParam();
    return node;
  }

  createBuffer(channels, length, sampleRate) {
    const channelData = Array.from({ length: channels }, () => new Float32Array(length));
    return { channels, length, sampleRate, getChannelData: (channel) => channelData[channel] };
  }

  decodeAudioData(data, success, failure) {
    if (this.decodeFails) {
      const error = new Error('decode failed');
      queueMicrotask(() => failure?.(error));
      return Promise.reject(error);
    }
    const buffer = { decoded: true, byteLength: data.byteLength };
    queueMicrotask(() => success?.(buffer));
    return Promise.resolve(buffer);
  }
}

test('arena ambience loads and starts only after gesture unlock', async () => {
  const context = new MockAudioContext();
  const requests = [];
  const director = new AudioDirector({
    context,
    fetch: sampleFetch(requests),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: '/arena-loop.ogg',
  });

  assert.equal(director.ambienceStatus, 'idle');
  assert.equal(requests.length, 0);
  assert.equal(context.sources.length, 0);

  assert.equal(await director.unlock(), true);
  await director._ambienceLoadPromise;
  await Promise.resolve();

  assert.deepEqual(requests, ['/arena-loop.ogg']);
  assert.equal(director.ambienceStatus, 'playing');
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].loop, true);
  assert.equal(context.sources[0].loopStart, 0.25);
  assert.equal(context.sources[0].loopEnd, 8.25);
  assert.equal(context.sources[0].buffer, director._ambienceBuffer);
  assert.equal(context.sources[0].connections[0], director._ambienceGain);
  assert.equal(director._ambienceGain.connections[0], director._master);
  assert.equal(director._ambienceGain.gain.value, 0.22);
  assert.notEqual(director._ambienceGain, director._compressor);
});

test('arena ambience has an independent level path and follows enable state', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: '/arena-loop.ogg',
  });
  await director.unlock();
  await director._ambienceLoadPromise;

  director.setAmbienceVolume(0.31);
  assert.deepEqual(director._ambienceGain.gain.events.at(-1), ['target', 0.31, 4, 0.025]);
  director.setEnabled(false);
  assert.deepEqual(director._ambienceGain.gain.events.at(-1), ['target', 0, 4, 0.025]);
  assert.equal(director.bounce(0.8), false);
  director.setEnabled(true);
  assert.deepEqual(director._ambienceGain.gain.events.at(-1), ['target', 0.31, 4, 0.025]);
});

test('failed ambience loading is silent and does not affect synthesized gameplay cues', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: async () => ({ ok: false, status: 404 }),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: '/missing.ogg',
    cooldowns: { bounce: 0 },
  });
  await director.unlock();
  await director._ambienceLoadPromise;

  assert.equal(director.ambienceStatus, 'unavailable');
  assert.equal(director._ambienceSource, null);
  assert.equal(director.bounce(0.7), true);
  assert.equal(context.oscillators.length, 1);
});

test('failed ambience decoding is silent and does not affect synthesized gameplay cues', async () => {
  const context = new MockAudioContext({ decodeFails: true });
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: '/invalid.ogg',
    cooldowns: { bounce: 0 },
  });
  await director.unlock();
  await director._ambienceLoadPromise;

  assert.equal(director.ambienceStatus, 'unavailable');
  assert.equal(director._ambienceSource, null);
  assert.equal(director.bounce(0.7), true);
  assert.equal(context.oscillators.length, 1);
});

test('ambience source survives context suspension and unlock resumes without duplication', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: '/arena-loop.ogg',
  });
  await director.unlock();
  await director._ambienceLoadPromise;
  const source = director._ambienceSource;

  context.state = 'suspended';
  assert.equal(await director.unlock(), true);
  await Promise.resolve();

  assert.equal(context.resumeCalls, 2);
  assert.equal(director._ambienceSource, source);
  assert.equal(context.sources.length, 1);
  assert.equal(director.ambienceStatus, 'playing');
});

test('dispose stops and disconnects the ambience source without closing an external context', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: '/arena-loop.ogg',
  });
  await director.unlock();
  await director._ambienceLoadPromise;
  const source = director._ambienceSource;

  await director.dispose();

  assert.equal(source.stoppedAt, 4);
  assert.equal(source.disconnected, true);
  assert.equal(director.ambienceStatus, 'disposed');
  assert.equal(director._ambienceBuffer, null);
  assert.equal(director.context, null);
  assert.equal(context.state, 'running');
});

test('main starts audio from desktop, touch-compatible click, and keyboard paths then disposes it', () => {
  assert.match(mainSource, /function unlockAndStart\(\) \{\s*if \(player\.group\.userData\.assetStatus !== 'ready'\) return;\s*game\.started = true;\s*audio\.unlock\(\);/);
  assert.match(mainSource, /startButton\.addEventListener\('click', unlockAndStart\);/);
  assert.match(mainSource, /canvas\.addEventListener\('click', \(\) => \{\s*if \(!game\.started\) \{\s*unlockAndStart\(\);/);
  assert.match(mainSource, /window\.addEventListener\('keydown',[\s\S]*?unlockAndStart\(\);/);
  assert.match(mainSource, /window\.addEventListener\('beforeunload', \(\) => \{[\s\S]*?audio\.dispose\(\);/);
});

function sampleFetch(log) {
  return async (url) => {
    log.push(url);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(24 + log.length),
    };
  };
}

test('bounce samples start loading only after unlock and rotate without repetition', async () => {
  const context = new MockAudioContext();
  const requests = [];
  const director = new AudioDirector({
    context,
    fetch: sampleFetch(requests),
    bounceSampleUrls: ['/one.ogg', '/two.ogg', '/three.ogg'],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
    cooldowns: { bounce: 0 },
  });

  assert.equal(director.bounceSampleStatus, 'idle');
  assert.equal(requests.length, 0);
  assert.equal(await director.unlock(), true);
  await director._bounceLoadPromise;
  assert.deepEqual(requests, ['/one.ogg', '/two.ogg', '/three.ogg']);
  assert.equal(director.bounceSampleStatus, 'ready');

  assert.equal(director.bounce(0.48), true);
  assert.equal(director.bounce(0.72), true);
  assert.equal(director.bounce(1), true);
  const played = context.sources.slice(-3);
  assert.equal(played[0].buffer, director._bounceBuffers[0]);
  assert.equal(played[1].buffer, director._bounceBuffers[1]);
  assert.equal(played[2].buffer, director._bounceBuffers[2]);
  assert.ok(played[0].playbackRate.value < played[1].playbackRate.value);
  assert.ok(played[1].connections[0].gain.value < played[2].connections[0].gain.value);
});

test('rapid bounce calls retain the existing cooldown', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: ['/one.ogg'],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._bounceLoadPromise;

  assert.equal(director.bounce(0.7), true);
  assert.equal(director.bounce(0.7), false);
  assert.equal(context.sources.length, 1);
});

test('decode failure keeps the synthesized bounce fallback available', async () => {
  const context = new MockAudioContext({ decodeFails: true });
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: ['/broken.ogg'],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._bounceLoadPromise;

  assert.equal(director.bounceSampleStatus, 'fallback');
  assert.equal(director.bounce(0.7), true);
  assert.equal(context.oscillators.length, 1);
  assert.equal(context.sources.length, 2);
});

test('load failure also keeps the synthesized bounce fallback available', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: async () => ({ ok: false, status: 404 }),
    bounceSampleUrls: ['/missing.ogg'],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._bounceLoadPromise;

  assert.equal(director.bounceSampleStatus, 'fallback');
  assert.equal(director.bounce(0.48), true);
  assert.equal(context.oscillators.length, 1);
});

test('rim samples load after unlock and intensity selects light, medium, and hard variants', async () => {
  const context = new MockAudioContext();
  const requests = [];
  const director = new AudioDirector({
    context,
    fetch: sampleFetch(requests),
    bounceSampleUrls: [],
    rimSampleUrls: ['/light.ogg', '/medium.ogg', '/hard.ogg'],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
    cooldowns: { rim: 0 },
  });

  assert.equal(director.rimSampleStatus, 'idle');
  assert.equal(requests.length, 0);
  assert.equal(await director.unlock(), true);
  await director._rimLoadPromise;
  assert.deepEqual(requests, ['/light.ogg', '/medium.ogg', '/hard.ogg']);
  assert.equal(director.rimSampleStatus, 'ready');

  assert.equal(director.rim(0.18), true);
  assert.equal(director.rim(0.6), true);
  assert.equal(director.rim(0.92), true);
  const played = context.sources.slice(-3);
  assert.equal(played[0].buffer, director._rimBuffers[0]);
  assert.equal(played[1].buffer, director._rimBuffers[1]);
  assert.equal(played[2].buffer, director._rimBuffers[2]);
  assert.ok(played[0].connections[0].gain.value < played[1].connections[0].gain.value);
  assert.ok(played[1].connections[0].gain.value < played[2].connections[0].gain.value);
});

test('rapid rim calls retain the existing cooldown', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: ['/rim.ogg'],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._rimLoadPromise;

  assert.equal(director.rim(0.7), true);
  assert.equal(director.rim(0.7), false);
  assert.equal(context.sources.length, 1);
});

test('rim decode failure keeps the original synthesized fallback available', async () => {
  const context = new MockAudioContext({ decodeFails: true });
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: ['/broken.ogg'],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._rimLoadPromise;

  assert.equal(director.rimSampleStatus, 'fallback');
  assert.equal(director.rim(0.92), true);
  assert.equal(context.oscillators.length, 4);
  assert.equal(context.sources.length, 1);
});

test('rim load failure keeps the original synthesized fallback available', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: async () => ({ ok: false, status: 404 }),
    bounceSampleUrls: [],
    rimSampleUrls: ['/missing.ogg'],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._rimLoadPromise;

  assert.equal(director.rimSampleStatus, 'fallback');
  assert.equal(director.rim(0.18), true);
  assert.equal(context.oscillators.length, 4);
});

test('main keeps ordinary collision intensity and the authored dunk rim cue', () => {
  assert.match(mainSource, /audio\.rim\(clamp\(Math\.abs\(incoming\) \/ 7, 0\.18, 1\)\);/);
  assert.match(mainSource, /if \(isDunk\) \{[\s\S]*?audio\.rim\(0\.92\);[\s\S]*?\}/);
  assert.match(mainSource, /if \(ball\.finishKind && \(ball\.canScore \|\| ball\.scored\)\) return;/);
  assert.equal((mainSource.match(/audio\.rim\(/g) ?? []).length, 2);
});

test('dunk sample starts loading only after unlock and retains intensity response', async () => {
  const context = new MockAudioContext();
  const requests = [];
  const director = new AudioDirector({
    context,
    fetch: sampleFetch(requests),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: '/dunk.ogg',
    ambienceUrl: null,
    cooldowns: { dunk: 0 },
  });

  assert.equal(director.dunkSampleStatus, 'idle');
  assert.equal(requests.length, 0);
  assert.equal(await director.unlock(), true);
  await director._dunkLoadPromise;
  assert.deepEqual(requests, ['/dunk.ogg']);
  assert.equal(director.dunkSampleStatus, 'ready');

  assert.equal(director.dunk(0.35), true);
  assert.equal(director.dunk(1), true);
  const played = context.sources.slice(-2);
  assert.equal(played[0].buffer, director._dunkBuffer);
  assert.equal(played[1].buffer, director._dunkBuffer);
  assert.ok(played[0].playbackRate.value < played[1].playbackRate.value);
  assert.ok(played[0].connections[0].gain.value < played[1].connections[0].gain.value);
});

test('repeated dunk finish cues use the shared cooldown architecture', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: '/dunk.ogg',
    ambienceUrl: null,
  });
  await director.unlock();
  await director._dunkLoadPromise;

  assert.equal(director.cooldowns.dunk, 420);
  assert.equal(director.dunk(1), true);
  assert.equal(director.dunk(1), false);
  assert.equal(context.sources.length, 1);
});

test('dunk decode failure keeps the synthesized layered fallback available', async () => {
  const context = new MockAudioContext({ decodeFails: true });
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: '/broken.ogg',
    ambienceUrl: null,
  });
  await director.unlock();
  await director._dunkLoadPromise;

  assert.equal(director.dunkSampleStatus, 'fallback');
  assert.equal(director.dunk(1), true);
  assert.equal(context.oscillators.length, 4);
  assert.equal(context.sources.length, 2);
});

test('dunk load failure keeps the synthesized layered fallback available', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: async () => ({ ok: false, status: 404 }),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: [],
    dunkSampleUrl: '/missing.ogg',
    ambienceUrl: null,
  });
  await director.unlock();
  await director._dunkLoadPromise;

  assert.equal(director.dunkSampleStatus, 'fallback');
  assert.equal(director.dunk(0.65), true);
  assert.equal(context.oscillators.length, 4);
  assert.equal(context.sources.length, 2);
});

test('main calls the dunk cue only from the established release event and preserves rim and score cues', () => {
  assert.match(mainSource, /launchBall\(start, target, isDunk \? 0\.42 : clamp\(0\.64 \+ distance \* 0\.04, 0\.64, 0\.78\), \{[\s\S]*?finishKind: isDunk \? 'DUNK' : 'LAYUP'/);
  assert.match(mainSource, /if \(isDunk\) \{[\s\S]*?arena\.hoop\.net\.userData\.energy = 0\.9;[\s\S]*?audio\.rim\(0\.92\);[\s\S]*?audio\.dunk\(1\);[\s\S]*?\}/);
  assert.match(mainSource, /if \(!game\.started \|\| game\.ball\.mode !== 'dribble' \|\| game\.charge\.active\) return;/);
  assert.match(mainSource, /game\.ball\.mode = 'finish';[\s\S]*?game\.ball\.finishKind = dunk \? 'DUNK' : 'LAYUP';/);
  assert.match(mainSource, /const releaseAt = p\.action === 'dunk' \? 0\.57 : 0\.59;/);
  assert.match(mainSource, /if \(!p\.finishReleased && p\.actionProgress >= releaseAt\) releaseFinish\(\);/);
  assert.match(mainSource, /audio\.score\(ball\.finishKind === 'DUNK' \? 1 : 0\.78\);/);
  assert.match(mainSource, /function unlockAndStart\(\) \{\s*if \(player\.group\.userData\.assetStatus !== 'ready'\) return;\s*game\.started = true;\s*audio\.unlock\(\);/);
  assert.equal((mainSource.match(/audio\.dunk\(/g) ?? []).length, 1);
});

test('backboard samples load only after unlock and intensity selects soft, medium, and hard variants', async () => {
  const context = new MockAudioContext();
  const requests = [];
  const director = new AudioDirector({
    context,
    fetch: sampleFetch(requests),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: ['/soft.ogg', '/medium.ogg', '/hard.ogg'],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
    cooldowns: { backboard: 0 },
  });

  assert.equal(director.backboardSampleStatus, 'idle');
  assert.equal(requests.length, 0);
  assert.equal(await director.unlock(), true);
  await director._backboardLoadPromise;
  assert.deepEqual(requests, ['/soft.ogg', '/medium.ogg', '/hard.ogg']);
  assert.equal(director.backboardSampleStatus, 'ready');

  assert.equal(director.backboard(0.2), true);
  assert.equal(director.backboard(0.62), true);
  assert.equal(director.backboard(1), true);
  const played = context.sources.slice(-3);
  assert.equal(played[0].buffer, director._backboardBuffers[0]);
  assert.equal(played[1].buffer, director._backboardBuffers[1]);
  assert.equal(played[2].buffer, director._backboardBuffers[2]);
  assert.ok(played[0].connections[0].gain.value < played[1].connections[0].gain.value);
  assert.ok(played[1].connections[0].gain.value < played[2].connections[0].gain.value);
});

test('rapid backboard calls retain the existing collision cooldown', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: ['/board.ogg'],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._backboardLoadPromise;

  assert.equal(director.backboard(0.7), true);
  assert.equal(director.backboard(0.7), false);
  assert.equal(context.sources.length, 1);
});

test('backboard decode failure keeps the original synthesized fallback available', async () => {
  const context = new MockAudioContext({ decodeFails: true });
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: ['/broken.ogg'],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._backboardLoadPromise;

  assert.equal(director.backboardSampleStatus, 'fallback');
  assert.equal(director.backboard(1), true);
  assert.equal(context.oscillators.length, 1);
  assert.equal(context.sources.length, 1);
});

test('backboard load failure keeps the original synthesized fallback available', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: async () => ({ ok: false, status: 404 }),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: ['/missing.ogg'],
    shoeSampleUrls: [],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._backboardLoadPromise;

  assert.equal(director.backboardSampleStatus, 'fallback');
  assert.equal(director.backboard(0.2), true);
  assert.equal(context.oscillators.length, 1);
});

test('main keeps the existing backboard collision response and intensity call', () => {
  assert.match(mainSource, /ball\.velocity\.z = Math\.abs\(ball\.velocity\.z\) \* 0\.68;/);
  assert.match(mainSource, /ball\.velocity\.x \*= 0\.82;[\s\S]*?ball\.velocity\.y \*= 0\.9;/);
  assert.match(mainSource, /audio\.backboard\(clamp\(ball\.velocity\.length\(\) \/ 7, 0\.2, 1\)\);/);
  assert.equal((mainSource.match(/audio\.backboard\(/g) ?? []).length, 1);
});

test('shoe samples load only after unlock, rotate variants, and retain intensity response', async () => {
  const context = new MockAudioContext();
  const requests = [];
  const director = new AudioDirector({
    context,
    fetch: sampleFetch(requests),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: ['/chirp-one.ogg', '/chirp-two.ogg', '/skid.ogg'],
    dunkSampleUrl: null,
    ambienceUrl: null,
    cooldowns: { shoe: 0 },
  });

  assert.equal(director.shoeSampleStatus, 'idle');
  assert.equal(requests.length, 0);
  assert.equal(await director.unlock(), true);
  await director._shoeLoadPromise;
  assert.deepEqual(requests, ['/chirp-one.ogg', '/chirp-two.ogg', '/skid.ogg']);
  assert.equal(director.shoeSampleStatus, 'ready');

  assert.equal(director.shoe(0.24), true);
  director._nextShoeCueAt = 0;
  assert.equal(director.shoe(0.5), true);
  director._nextShoeCueAt = 0;
  assert.equal(director.shoe(0.72), true);
  const played = context.sources.slice(-3);
  assert.equal(played[0].buffer, director._shoeBuffers[0]);
  assert.equal(played[1].buffer, director._shoeBuffers[1]);
  assert.equal(played[2].buffer, director._shoeBuffers[2]);
  assert.ok(played[0].playbackRate.value < played[2].playbackRate.value);
  assert.ok(played[0].connections[0].gain.value < played[2].connections[0].gain.value);
});

test('shoe running cadence avoids rapid repetition while retaining the existing cooldown', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: ['/shoe.ogg'],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._shoeLoadPromise;

  assert.equal(director.cooldowns.shoe, 58);
  assert.equal(director.shoe(0.72), true);
  assert.equal(director.shoe(0.72), false);
  assert.equal(context.sources.length, 1);

  director._nextShoeCueAt = 0;
  assert.equal(director.shoe(0.72), false);
  assert.equal(context.sources.length, 1);
});

test('shoe decode failure keeps the original synthesized fallback available', async () => {
  const context = new MockAudioContext({ decodeFails: true });
  const director = new AudioDirector({
    context,
    fetch: sampleFetch([]),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: ['/broken.ogg'],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._shoeLoadPromise;

  assert.equal(director.shoeSampleStatus, 'fallback');
  assert.equal(director.shoe(0.5), true);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources.at(-1).connections[0].kind, 'filter');
});

test('shoe load failure keeps the original synthesized fallback available', async () => {
  const context = new MockAudioContext();
  const director = new AudioDirector({
    context,
    fetch: async () => ({ ok: false, status: 404 }),
    bounceSampleUrls: [],
    rimSampleUrls: [],
    backboardSampleUrls: [],
    shoeSampleUrls: ['/missing.ogg'],
    dunkSampleUrl: null,
    ambienceUrl: null,
  });
  await director.unlock();
  await director._shoeLoadPromise;

  assert.equal(director.shoeSampleStatus, 'fallback');
  assert.equal(director.shoe(0.24), true);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].connections[0].kind, 'filter');
});

test('main keeps walking and sprinting intensity capped at the existing movement call site', () => {
  assert.match(mainSource, /const targetSpeed = hasMove \? \(input\.sprint \? 5\.45 : 3\.38\) : 0;/);
  assert.match(mainSource, /if \(p\.currentSpeed > 1\.25\) audio\.shoe\(clamp\(p\.currentSpeed \/ 5\.5, 0\.2, 0\.72\)\);/);
  assert.equal((mainSource.match(/audio\.shoe\(/g) ?? []).length, 1);
});
