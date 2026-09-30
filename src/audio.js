/**
 * Small sound director for the basketball demo.
 *
 * Call `unlock()` from a user gesture (the first pointer/key event), then call
 * the cue methods from gameplay.  Each cue has a short built-in cooldown, so
 * collision callbacks can safely call them every frame without producing a
 * wall of sound. Basketball bounces, rim impacts, backboard hits, shoe
 * squeaks, and dunks use short decoded samples when available; every cue
 * retains its synthesized Web Audio fallback. A separately-gained arena bed
 * starts only after unlock and fails silently if its file is unavailable.
 */

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const nowMs = () => (globalThis.performance?.now?.() ?? Date.now());

const DEFAULT_COOLDOWNS = Object.freeze({
  bounce: 72,
  rim: 95,
  dunk: 420,
  backboard: 110,
  swish: 160,
  shoe: 58,
  crowd: 650,
  score: 900,
});

const assetBaseUrl = import.meta.env?.BASE_URL ?? '/';
const DEFAULT_BOUNCE_SAMPLE_URLS = Object.freeze([
  `${assetBaseUrl}assets/audio/gameplay/dribble-01.ogg`,
  `${assetBaseUrl}assets/audio/gameplay/dribble-02.ogg`,
  `${assetBaseUrl}assets/audio/gameplay/dribble-03.ogg`,
]);
const DEFAULT_RIM_SAMPLE_URLS = Object.freeze([
  `${assetBaseUrl}assets/audio/gameplay/rim-light-01.ogg`,
  `${assetBaseUrl}assets/audio/gameplay/rim-medium-01.ogg`,
  `${assetBaseUrl}assets/audio/gameplay/rim-hard-01.ogg`,
]);
const DEFAULT_DUNK_SAMPLE_URL = `${assetBaseUrl}assets/audio/gameplay/dunk-impact-01.ogg`;
const DEFAULT_BACKBOARD_SAMPLE_URLS = Object.freeze([
  `${assetBaseUrl}assets/audio/gameplay/backboard-soft-01.ogg`,
  `${assetBaseUrl}assets/audio/gameplay/backboard-medium-01.ogg`,
  `${assetBaseUrl}assets/audio/gameplay/backboard-hard-01.ogg`,
]);
const DEFAULT_SHOE_SAMPLE_URLS = Object.freeze([
  `${assetBaseUrl}assets/audio/gameplay/shoe-squeak-01.ogg`,
  `${assetBaseUrl}assets/audio/gameplay/shoe-squeak-02.ogg`,
  `${assetBaseUrl}assets/audio/gameplay/shoe-skid-01.ogg`,
]);
const DEFAULT_AMBIENCE_URL = `${assetBaseUrl}assets/audio/ambience/arena-loop-01.ogg`;
const DEFAULT_AMBIENCE_LOOP_START = 0.25;
const DEFAULT_AMBIENCE_LOOP_END = 8.25;

/**
 * Synthesized court, ball, hoop, and audience cues built with Web Audio only.
 */
export class AudioDirector {
  /**
   * @param {{ volume?: number, ambienceVolume?: number, ambienceUrl?: string | null, ambienceLoopStart?: number, ambienceLoopEnd?: number, enabled?: boolean, cooldowns?: Record<string, number>, context?: AudioContext, bounceSampleUrls?: string[], rimSampleUrls?: string[], dunkSampleUrl?: string | null, backboardSampleUrls?: string[], shoeSampleUrls?: string[], fetch?: typeof fetch }} [options]
   */
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.volume = clamp(options.volume ?? 0.42);
    this.context = options.context ?? null;
    this._ownsContext = false;
    this.unlocked = false;
    this.disposed = false;

    this.cooldowns = { ...DEFAULT_COOLDOWNS, ...(options.cooldowns ?? {}) };
    this._lastCue = new Map();
    this._noiseCache = new Map();
    this._master = null;
    this._compressor = null;
    this._ambienceGain = null;
    this._fetch = options.fetch ?? globalThis.fetch?.bind(globalThis) ?? null;
    this._bounceSampleUrls = options.bounceSampleUrls ?? DEFAULT_BOUNCE_SAMPLE_URLS;
    this._bounceBuffers = [];
    this._bounceSampleIndex = 0;
    this._bounceLoadPromise = null;
    this.bounceSampleStatus = 'idle';
    this._rimSampleUrls = options.rimSampleUrls ?? DEFAULT_RIM_SAMPLE_URLS;
    this._rimBuffers = [];
    this._rimLoadPromise = null;
    this.rimSampleStatus = 'idle';
    this._dunkSampleUrl = options.dunkSampleUrl === undefined ? DEFAULT_DUNK_SAMPLE_URL : options.dunkSampleUrl;
    this._dunkBuffer = null;
    this._dunkLoadPromise = null;
    this.dunkSampleStatus = 'idle';
    this._backboardSampleUrls = options.backboardSampleUrls ?? DEFAULT_BACKBOARD_SAMPLE_URLS;
    this._backboardBuffers = [];
    this._backboardLoadPromise = null;
    this.backboardSampleStatus = 'idle';
    this._shoeSampleUrls = options.shoeSampleUrls ?? DEFAULT_SHOE_SAMPLE_URLS;
    this._shoeBuffers = [];
    this._shoeSampleIndex = 0;
    this._shoeLoadPromise = null;
    this._nextShoeCueAt = 0;
    this.shoeSampleStatus = 'idle';
    this.ambienceVolume = clamp(options.ambienceVolume ?? 0.22);
    this._ambienceUrl = options.ambienceUrl === undefined ? DEFAULT_AMBIENCE_URL : options.ambienceUrl;
    this.ambienceLoopStart = Math.max(0, options.ambienceLoopStart ?? DEFAULT_AMBIENCE_LOOP_START);
    this.ambienceLoopEnd = Math.max(this.ambienceLoopStart, options.ambienceLoopEnd ?? DEFAULT_AMBIENCE_LOOP_END);
    this._ambienceBuffer = null;
    this._ambienceSource = null;
    this._ambienceLoadPromise = null;
    this.ambienceStatus = 'idle';
  }

  /**
   * Creates/resumes the Web Audio context. Call this inside a user gesture.
   * @returns {Promise<boolean>} Whether sound is ready to play.
   */
  async unlock() {
    if (this.disposed) return false;

    const context = this._getOrCreateContext();
    if (!context) return false;

    try {
      if (context.state === 'suspended') await context.resume();
      this.unlocked = context.state === 'running';
      if (this.unlocked) {
        void this._loadBounceSamples();
        void this._loadRimSamples();
        void this._loadDunkSample();
        void this._loadBackboardSamples();
        void this._loadShoeSamples();
        const ambienceLoad = this._loadAmbience();
        if (ambienceLoad) void ambienceLoad.then(() => this._startAmbience());
        else this._startAmbience();
      }
      return this.unlocked;
    } catch {
      // Browsers can reject resume() outside a gesture. The next input can try again.
      this.unlocked = false;
      return false;
    }
  }

  setVolume(volume) {
    this.volume = clamp(volume);
    if (this._master && this.context) {
      this._master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.015);
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this._syncAmbienceGain();
  }

  /** Sets the arena-bed level independently of gameplay cues. */
  setAmbienceVolume(volume) {
    this.ambienceVolume = clamp(volume);
    this._syncAmbienceGain();
  }

  /** A rubbery ball thump. Intensity is normally collision speed normalized to 0..1. */
  bounce(intensity = 0.7) {
    const power = clamp(intensity);
    return this._cue('bounce', () => {
      if (this._bounceBuffers.length) {
        this._sampleBounce(power);
        return;
      }
      this._synthBounce(power);
    });
  }

  _synthBounce(power) {
    const at = this.context.currentTime;
    const gain = 0.025 + power * 0.095;

    this._tone({
      at,
      frequency: 135 + power * 65,
      sweepTo: 52 + power * 20,
      duration: 0.115 + power * 0.035,
      gain,
      type: 'sine',
    });
    this._noise({
      at,
      duration: 0.055 + power * 0.035,
      gain: gain * 0.55,
      filter: 'lowpass',
      frequency: 430 + power * 360,
      q: 0.7,
    });
    this._noise({
      at: at + 0.002,
      duration: 0.018,
      gain: gain * 0.26,
      filter: 'bandpass',
      frequency: 1250,
      q: 1.5,
    });
  }

  _sampleBounce(power) {
    const at = this.context.currentTime;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const buffer = this._bounceBuffers[this._bounceSampleIndex % this._bounceBuffers.length];
    this._bounceSampleIndex += 1;

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(0.94 + power * 0.12, at);
    gain.gain.setValueAtTime(0.22 + power * 0.78, at);
    source.connect(gain);
    gain.connect(this._compressor);
    source.start(at);
  }

  /** A short metallic ring when the ball catches the rim. */
  rim(intensity = 0.7) {
    const power = clamp(intensity);
    return this._cue('rim', () => {
      if (this._rimBuffers.some(Boolean)) {
        this._sampleRim(power);
        return;
      }
      this._synthRim(power);
    });
  }

  _synthRim(power) {
    const at = this.context.currentTime;
    const baseGain = 0.008 + power * 0.035;
    const partials = [1, 1.64, 2.37, 3.49];

    partials.forEach((partial, index) => {
      this._tone({
        at: at + index * 0.002,
        frequency: (620 + power * 180) * partial,
        sweepTo: (610 + power * 170) * partial,
        duration: 0.1 + index * 0.045 + power * 0.09,
        gain: baseGain / (1 + index * 0.55),
        type: 'sine',
        attack: 0.001,
        release: 0.11 + index * 0.025,
      });
    });
    this._noise({
      at,
      duration: 0.025,
      gain: baseGain * 0.8,
      filter: 'bandpass',
      frequency: 2700,
      q: 2.2,
    });
  }

  _sampleRim(power) {
    const at = this.context.currentTime;
    const preferredIndex = power < 0.4 ? 0 : power < 0.75 ? 1 : 2;
    const candidates = this._rimBuffers
      .map((buffer, index) => ({ buffer, index }))
      .filter(({ buffer }) => buffer)
      .sort((a, b) => Math.abs(a.index - preferredIndex) - Math.abs(b.index - preferredIndex));
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();

    source.buffer = candidates[0].buffer;
    source.playbackRate.setValueAtTime(0.98 + power * 0.04, at);
    gain.gain.setValueAtTime(0.28 + power * 0.72, at);
    source.connect(gain);
    gain.connect(this._compressor);
    source.start(at);
  }

  /** A layered rim-flex, net-snap, and ball-compression hit for an authored dunk. */
  dunk(intensity = 0.9) {
    const power = clamp(intensity);
    return this._cue('dunk', () => {
      if (this._dunkBuffer) {
        this._sampleDunk(power);
        return;
      }
      this._synthDunk(power);
    });
  }

  _synthDunk(power) {
    const at = this.context.currentTime;
    const bodyGain = 0.025 + power * 0.065;
    const metalGain = 0.006 + power * 0.022;

    this._tone({
      at,
      frequency: 180 + power * 22,
      sweepTo: 62 + power * 8,
      duration: 0.09,
      gain: bodyGain,
      type: 'sine',
      attack: 0.001,
      release: 0.09,
    });
    [565, 918, 1368].forEach((frequency, index) => {
      this._tone({
        at: at + index * 0.0015,
        frequency: frequency * (0.98 + power * 0.04),
        duration: 0.12 + index * 0.035 + power * 0.08,
        gain: metalGain / (1 + index * 0.5),
        type: 'sine',
        attack: 0.001,
        release: 0.11 + index * 0.025,
      });
    });
    this._noise({
      at,
      duration: 0.028,
      gain: bodyGain * 0.62,
      filter: 'bandpass',
      frequency: 2400,
      q: 1.1,
    });
    this._noise({
      at: at + 0.008,
      duration: 0.065 + power * 0.025,
      gain: bodyGain * 0.42,
      filter: 'highpass',
      frequency: 1450,
      q: 0.7,
      rate: 1.16,
    });
  }

  _sampleDunk(power) {
    const at = this.context.currentTime;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();

    source.buffer = this._dunkBuffer;
    source.playbackRate.setValueAtTime(0.97 + power * 0.06, at);
    gain.gain.setValueAtTime(0.34 + power * 0.66, at);
    source.connect(gain);
    gain.connect(this._compressor);
    source.start(at);
  }

  /** A flatter, glassy impact for the backboard. */
  backboard(intensity = 0.7) {
    const power = clamp(intensity);
    return this._cue('backboard', () => {
      if (this._backboardBuffers.some(Boolean)) {
        this._sampleBackboard(power);
        return;
      }
      this._synthBackboard(power);
    });
  }

  _synthBackboard(power) {
    const at = this.context.currentTime;
    const gain = 0.018 + power * 0.05;

    this._tone({
      at,
      frequency: 230 + power * 80,
      sweepTo: 95,
      duration: 0.075,
      gain,
      type: 'triangle',
      release: 0.06,
    });
    this._noise({
      at,
      duration: 0.045 + power * 0.025,
      gain: gain * 0.78,
      filter: 'bandpass',
      frequency: 1550 + power * 700,
      q: 0.85,
    });
  }

  _sampleBackboard(power) {
    const at = this.context.currentTime;
    const preferredIndex = power < 0.45 ? 0 : power < 0.78 ? 1 : 2;
    const candidates = this._backboardBuffers
      .map((buffer, index) => ({ buffer, index }))
      .filter(({ buffer }) => buffer)
      .sort((a, b) => Math.abs(a.index - preferredIndex) - Math.abs(b.index - preferredIndex));
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();

    source.buffer = candidates[0].buffer;
    source.playbackRate.setValueAtTime(0.98 + power * 0.04, at);
    gain.gain.setValueAtTime(0.3 + power * 0.7, at);
    source.connect(gain);
    gain.connect(this._compressor);
    source.start(at);
  }

  /** A soft air rush for a clean make. */
  swish(intensity = 0.75) {
    const power = clamp(intensity);
    return this._cue('swish', () => this._swishBurst(this.context.currentTime, power));
  }

  /** Brief sneaker squeak/skid. Safe to call while the character is moving. */
  shoe(intensity = 0.45) {
    const power = clamp(intensity);
    const time = nowMs();
    if (time < this._nextShoeCueAt) return false;

    const played = this._cue('shoe', () => {
      if (this._shoeBuffers.length) {
        this._sampleShoe(power);
        return;
      }
      this._synthShoe(power);
    });
    if (played) {
      const spacingVariation = [0, 14, -8][this._shoeSampleIndex % 3];
      this._nextShoeCueAt = time + clamp(260 - power * 110 + spacingVariation, 170, 235);
    }
    return played;
  }

  _synthShoe(power) {
    const at = this.context.currentTime;
    const gain = 0.005 + power * 0.025;
    this._noise({
      at,
      duration: 0.025 + power * 0.045,
      gain,
      filter: 'bandpass',
      frequency: 1800 + power * 1250,
      q: 4.8,
      rate: 0.82 + power * 0.45,
    });
  }

  _sampleShoe(power) {
    const at = this.context.currentTime;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const buffer = this._shoeBuffers[this._shoeSampleIndex % this._shoeBuffers.length];
    this._shoeSampleIndex += 1;

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(0.96 + power * 0.08, at);
    gain.gain.setValueAtTime(0.3 + power * 0.62, at);
    source.connect(gain);
    gain.connect(this._compressor);
    source.start(at);
  }

  /** A compact arena bed / clap burst. Use sparingly (for possession changes or highlights). */
  crowd(intensity = 0.28) {
    const power = clamp(intensity);
    return this._cue('crowd', () => this._crowdBurst(this.context.currentTime, power));
  }

  /** Clean make + a small, celebratory crowd lift. */
  score(intensity = 0.8) {
    const power = clamp(intensity);
    return this._cue('score', () => {
      const at = this.context.currentTime;
      this._swishBurst(at, Math.min(1, power * 0.88));
      this._crowdBurst(at + 0.06, 0.45 + power * 0.5, 0.82);

      // A restrained arcade-style confirmation, deliberately lower than the court sounds.
      this._tone({
        at: at + 0.035,
        frequency: 523.25,
        sweepTo: 523.25,
        duration: 0.085,
        gain: 0.013 + power * 0.015,
        type: 'sine',
        release: 0.07,
      });
      this._tone({
        at: at + 0.13,
        frequency: 783.99,
        sweepTo: 783.99,
        duration: 0.12,
        gain: 0.012 + power * 0.014,
        type: 'sine',
        release: 0.1,
      });
    });
  }

  /** Closes the internally-created context and releases generated buffers. */
  async dispose() {
    this.disposed = true;
    if (this._ambienceSource) {
      try {
        this._ambienceSource.stop(this.context?.currentTime ?? 0);
      } catch {
        // An already-ended source is safe to ignore during teardown.
      }
      this._ambienceSource.disconnect?.();
      this._ambienceSource = null;
    }
    this._lastCue.clear();
    this._noiseCache.clear();
    this._bounceBuffers = [];
    this._bounceLoadPromise = null;
    this.bounceSampleStatus = 'disposed';
    this._rimBuffers = [];
    this._rimLoadPromise = null;
    this.rimSampleStatus = 'disposed';
    this._dunkBuffer = null;
    this._dunkLoadPromise = null;
    this.dunkSampleStatus = 'disposed';
    this._backboardBuffers = [];
    this._backboardLoadPromise = null;
    this.backboardSampleStatus = 'disposed';
    this._shoeBuffers = [];
    this._shoeLoadPromise = null;
    this.shoeSampleStatus = 'disposed';
    this._ambienceBuffer = null;
    this._ambienceLoadPromise = null;
    this.ambienceStatus = 'disposed';

    if (this._ownsContext && this.context && this.context.state !== 'closed') {
      try {
        await this.context.close();
      } catch {
        // Closing an audio context can fail during browser teardown; it is safe to ignore.
      }
    }
    this.context = null;
    this._master = null;
    this._compressor = null;
    this._ambienceGain = null;
    this._ownsContext = false;
    this.unlocked = false;
  }

  _loadBounceSamples() {
    if (this._bounceLoadPromise || !this.context || !this._fetch || !this._bounceSampleUrls.length) {
      return this._bounceLoadPromise;
    }

    const context = this.context;
    this.bounceSampleStatus = 'loading';
    this._bounceLoadPromise = Promise.allSettled(this._bounceSampleUrls.map(async (url) => {
      const response = await this._fetch(url);
      if (!response.ok) throw new Error(`Bounce sample request failed: ${response.status}`);
      return this._decodeAudioData(context, await response.arrayBuffer());
    })).then((results) => {
      if (this.disposed || this.context !== context) return [];
      this._bounceBuffers = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
      this.bounceSampleStatus = this._bounceBuffers.length ? 'ready' : 'fallback';
      return this._bounceBuffers;
    });
    return this._bounceLoadPromise;
  }

  _loadRimSamples() {
    if (this._rimLoadPromise || !this.context || !this._fetch || !this._rimSampleUrls.length) {
      return this._rimLoadPromise;
    }

    const context = this.context;
    this.rimSampleStatus = 'loading';
    this._rimLoadPromise = Promise.allSettled(this._rimSampleUrls.map(async (url) => {
      const response = await this._fetch(url);
      if (!response.ok) throw new Error(`Rim sample request failed: ${response.status}`);
      return this._decodeAudioData(context, await response.arrayBuffer());
    })).then((results) => {
      if (this.disposed || this.context !== context) return [];
      this._rimBuffers = results.map((result) => (result.status === 'fulfilled' ? result.value : null));
      this.rimSampleStatus = this._rimBuffers.some(Boolean) ? 'ready' : 'fallback';
      return this._rimBuffers;
    });
    return this._rimLoadPromise;
  }

  _loadDunkSample() {
    if (this._dunkLoadPromise || !this.context || !this._fetch || !this._dunkSampleUrl) {
      return this._dunkLoadPromise;
    }

    const context = this.context;
    this.dunkSampleStatus = 'loading';
    this._dunkLoadPromise = (async () => {
      try {
        const response = await this._fetch(this._dunkSampleUrl);
        if (!response.ok) throw new Error(`Dunk sample request failed: ${response.status}`);
        const buffer = await this._decodeAudioData(context, await response.arrayBuffer());
        if (this.disposed || this.context !== context) return null;
        this._dunkBuffer = buffer;
        this.dunkSampleStatus = 'ready';
        return buffer;
      } catch {
        if (!this.disposed && this.context === context) this.dunkSampleStatus = 'fallback';
        return null;
      }
    })();
    return this._dunkLoadPromise;
  }

  _loadBackboardSamples() {
    if (this._backboardLoadPromise || !this.context || !this._fetch || !this._backboardSampleUrls.length) {
      return this._backboardLoadPromise;
    }

    const context = this.context;
    this.backboardSampleStatus = 'loading';
    this._backboardLoadPromise = Promise.allSettled(this._backboardSampleUrls.map(async (url) => {
      const response = await this._fetch(url);
      if (!response.ok) throw new Error(`Backboard sample request failed: ${response.status}`);
      return this._decodeAudioData(context, await response.arrayBuffer());
    })).then((results) => {
      if (this.disposed || this.context !== context) return [];
      this._backboardBuffers = results.map((result) => (result.status === 'fulfilled' ? result.value : null));
      this.backboardSampleStatus = this._backboardBuffers.some(Boolean) ? 'ready' : 'fallback';
      return this._backboardBuffers;
    });
    return this._backboardLoadPromise;
  }

  _loadShoeSamples() {
    if (this._shoeLoadPromise || !this.context || !this._fetch || !this._shoeSampleUrls.length) {
      return this._shoeLoadPromise;
    }

    const context = this.context;
    this.shoeSampleStatus = 'loading';
    this._shoeLoadPromise = Promise.allSettled(this._shoeSampleUrls.map(async (url) => {
      const response = await this._fetch(url);
      if (!response.ok) throw new Error(`Shoe sample request failed: ${response.status}`);
      return this._decodeAudioData(context, await response.arrayBuffer());
    })).then((results) => {
      if (this.disposed || this.context !== context) return [];
      this._shoeBuffers = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);
      this.shoeSampleStatus = this._shoeBuffers.length ? 'ready' : 'fallback';
      return this._shoeBuffers;
    });
    return this._shoeLoadPromise;
  }

  _loadAmbience() {
    if (this._ambienceLoadPromise || !this.context || !this._fetch || !this._ambienceUrl) {
      return this._ambienceLoadPromise;
    }

    const context = this.context;
    this.ambienceStatus = 'loading';
    this._ambienceLoadPromise = (async () => {
      try {
        const response = await this._fetch(this._ambienceUrl);
        if (!response.ok) throw new Error(`Ambience request failed: ${response.status}`);
        const buffer = await this._decodeAudioData(context, await response.arrayBuffer());
        if (this.disposed || this.context !== context) return null;
        this._ambienceBuffer = buffer;
        this.ambienceStatus = 'ready';
        return buffer;
      } catch {
        if (!this.disposed && this.context === context) this.ambienceStatus = 'unavailable';
        return null;
      }
    })();
    return this._ambienceLoadPromise;
  }

  _startAmbience() {
    if (!this._ambienceBuffer || this._ambienceSource || !this._ready()) return false;

    const source = this.context.createBufferSource();
    source.buffer = this._ambienceBuffer;
    source.loop = true;
    const bufferDuration = Number.isFinite(this._ambienceBuffer.duration)
      ? this._ambienceBuffer.duration
      : this.ambienceLoopEnd;
    source.loopStart = Math.min(this.ambienceLoopStart, bufferDuration);
    source.loopEnd = Math.min(this.ambienceLoopEnd, bufferDuration);
    source.connect(this._ambienceGain);
    source.onended = () => {
      if (this._ambienceSource === source) {
        this._ambienceSource = null;
        if (!this.disposed) this.ambienceStatus = 'ready';
      }
    };
    this._ambienceSource = source;
    this.ambienceStatus = 'playing';
    source.start(this.context.currentTime);
    return true;
  }

  _syncAmbienceGain() {
    if (!this._ambienceGain || !this.context) return;
    const gain = this.enabled ? this.ambienceVolume : 0;
    this._ambienceGain.gain.setTargetAtTime(gain, this.context.currentTime, 0.025);
  }

  _decodeAudioData(context, data) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => (value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const succeed = finish(resolve);
      const fail = finish(reject);
      try {
        const pending = context.decodeAudioData(data, succeed, fail);
        pending?.then(succeed, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  _cue(name, play) {
    if (!this.enabled || this.disposed || !this._ready()) return false;

    const time = nowMs();
    const last = this._lastCue.get(name) ?? -Infinity;
    if (time - last < (this.cooldowns[name] ?? 0)) return false;

    this._lastCue.set(name, time);
    play();
    return true;
  }

  _ready() {
    return this.context && this.unlocked && this.context.state === 'running' && this._master;
  }

  _getOrCreateContext() {
    if (this.context) {
      this._buildOutput();
      return this.context;
    }

    const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextConstructor) return null;

    try {
      this.context = new AudioContextConstructor();
      this._ownsContext = true;
      this._buildOutput();
      return this.context;
    } catch {
      return null;
    }
  }

  _buildOutput() {
    if (!this.context || this._master) return;

    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 14;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.15;

    const master = this.context.createGain();
    master.gain.value = this.volume;
    const ambienceGain = this.context.createGain();
    ambienceGain.gain.value = this.enabled ? this.ambienceVolume : 0;
    compressor.connect(master);
    ambienceGain.connect(master);
    master.connect(this.context.destination);

    this._compressor = compressor;
    this._ambienceGain = ambienceGain;
    this._master = master;
  }

  _tone({
    at,
    frequency,
    sweepTo = frequency,
    duration,
    gain,
    type = 'sine',
    attack = 0.003,
    release = 0.08,
  }) {
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const stopAt = at + duration + release + 0.02;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, frequency), at);
    if (sweepTo !== frequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), at + duration);
    }

    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), at + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration + release);

    oscillator.connect(envelope);
    envelope.connect(this._compressor);
    oscillator.start(at);
    oscillator.stop(stopAt);
  }

  _noise({
    at,
    duration,
    gain,
    filter = 'bandpass',
    frequency = 1000,
    q = 1,
    rate = 1,
  }) {
    const source = this.context.createBufferSource();
    const biquad = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    const release = Math.min(0.11, duration * 0.7);
    const end = at + duration;

    source.buffer = this._noiseBuffer(Math.max(0.18, duration + release + 0.03));
    source.playbackRate.value = rate;
    biquad.type = filter;
    biquad.frequency.setValueAtTime(frequency, at);
    biquad.Q.value = q;

    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), at + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end + release);

    source.connect(biquad);
    biquad.connect(envelope);
    envelope.connect(this._compressor);
    source.start(at);
    source.stop(end + release + 0.02);
  }

  _noiseBuffer(seconds) {
    const frameCount = Math.ceil(seconds * this.context.sampleRate);
    const key = Math.ceil(frameCount / 2048) * 2048;
    const existing = this._noiseCache.get(key);
    if (existing) return existing;

    const buffer = this.context.createBuffer(1, key, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let pink = 0;

    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      // Mildly correlated noise avoids harsh digital hiss while retaining transients.
      pink = pink * 0.87 + white * 0.13;
      data[index] = pink + white * 0.18;
    }

    this._noiseCache.set(key, buffer);
    return buffer;
  }

  _swishBurst(at, power) {
    const gain = 0.012 + power * 0.04;
    this._noise({
      at,
      duration: 0.12 + power * 0.1,
      gain,
      filter: 'bandpass',
      frequency: 3000 + power * 1200,
      q: 0.65,
      rate: 1.1,
    });
    this._noise({
      at: at + 0.032,
      duration: 0.1,
      gain: gain * 0.45,
      filter: 'highpass',
      frequency: 1750,
      q: 0.45,
    });
  }

  _crowdBurst(at, power, duration = 0.55) {
    const gain = 0.005 + power * 0.025;
    this._noise({
      at,
      duration,
      gain,
      filter: 'bandpass',
      frequency: 850 + power * 450,
      q: 0.28,
      rate: 0.62 + power * 0.12,
    });

    // Tiny staggered clap-like transients keep the crowd from reading as a flat hiss.
    const claps = 2 + Math.round(power * 3);
    for (let index = 0; index < claps; index += 1) {
      this._noise({
        at: at + 0.035 + index * (0.055 + Math.random() * 0.026),
        duration: 0.018 + Math.random() * 0.018,
        gain: gain * (0.32 + Math.random() * 0.35),
        filter: 'bandpass',
        frequency: 1400 + Math.random() * 1450,
        q: 0.8,
        rate: 1.1 + Math.random() * 0.5,
      });
    }
  }
}

export default AudioDirector;
