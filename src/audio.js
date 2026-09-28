/**
 * Small, asset-free sound director for the basketball demo.
 *
 * Call `unlock()` from a user gesture (the first pointer/key event), then call
 * the cue methods from gameplay.  Each cue has a short built-in cooldown, so
 * collision callbacks can safely call them every frame without producing a
 * wall of sound.
 */

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const nowMs = () => (globalThis.performance?.now?.() ?? Date.now());

const DEFAULT_COOLDOWNS = Object.freeze({
  bounce: 72,
  rim: 95,
  backboard: 110,
  swish: 160,
  shoe: 58,
  crowd: 650,
  score: 900,
});

/**
 * Synthesized court, ball, hoop, and audience cues built with Web Audio only.
 */
export class AudioDirector {
  /**
   * @param {{ volume?: number, enabled?: boolean, cooldowns?: Record<string, number>, context?: AudioContext }} [options]
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
  }

  /** A rubbery ball thump. Intensity is normally collision speed normalized to 0..1. */
  bounce(intensity = 0.7) {
    const power = clamp(intensity);
    return this._cue('bounce', () => {
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
    });
  }

  /** A short metallic ring when the ball catches the rim. */
  rim(intensity = 0.7) {
    const power = clamp(intensity);
    return this._cue('rim', () => {
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
    });
  }

  /** A flatter, glassy impact for the backboard. */
  backboard(intensity = 0.7) {
    const power = clamp(intensity);
    return this._cue('backboard', () => {
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
    });
  }

  /** A soft air rush for a clean make. */
  swish(intensity = 0.75) {
    const power = clamp(intensity);
    return this._cue('swish', () => this._swishBurst(this.context.currentTime, power));
  }

  /** Brief sneaker squeak/skid. Safe to call while the character is moving. */
  shoe(intensity = 0.45) {
    const power = clamp(intensity);
    return this._cue('shoe', () => {
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
    });
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
    this._lastCue.clear();
    this._noiseCache.clear();

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
    this._ownsContext = false;
    this.unlocked = false;
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
    compressor.connect(master);
    master.connect(this.context.destination);

    this._compressor = compressor;
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
