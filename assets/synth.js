// The app's synthesizer (watchOS/SynthKit), line for line, as an AudioWorklet: the watch on the page sounds
// as the app does. Each note is a bank of modal partials plus filtered noise, through a Freeverb room and a
// limiter; one note at a time, a new one fading out the last. See SynthVoice.swift for the models.
//
// Loaded on the page as an ordinary script, it only defines evertoneSynth(); watch.js runs that function's
// source in the audio worklet, from a blob, so nothing is fetched there and it works opened from disk too.
//
// Messages in: { note: { midi, frequency, velocity, instrument, serial } } and { gain }.
// Messages out, every few blocks: { started, sounding, envelope } (serials as in SynthEngine).

// eslint-disable-next-line no-unused-vars
function evertoneSynth() {
  const BLOCK = 32;
  const MAX_VOICES = 8;
  const MAX_PARTIALS = 64;
  const MAX_PLAYERS = 3;

  const cents = (value) => Math.pow(2, value / 1200);
  const smoothstep = (x) => {
    const t = Math.min(Math.max(x, 0), 1);
    return t * t * (3 - 2 * t);
  };
  const logBump = (f, center, octaves, gain) => {
    const d = Math.log2(f / center) / octaves;
    return gain * Math.exp(-d * d);
  };

  /** xorshift32, uniform in -1...1. */
  class Noise {
    constructor(seed) {
      this.state = seed >>> 0 || 0x9e3779b9;
    }
    next() {
      let s = this.state;
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      this.state = s >>> 0;
      return (s | 0) / 2147483648;
    }
    unit() {
      return this.next() * 0.5 + 0.5;
    }
  }

  /** Transposed direct form II; RBJ cookbook coefficients. */
  class Biquad {
    constructor() {
      this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
      this.z1 = 0; this.z2 = 0;
    }
    bandPass(frequency, q, sampleRate) {
      const w = (2 * Math.PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
      const alpha = Math.sin(w) / (2 * q);
      const a0 = 1 + alpha;
      this.b0 = alpha / a0; this.b1 = 0; this.b2 = -alpha / a0;
      this.a1 = (-2 * Math.cos(w)) / a0; this.a2 = (1 - alpha) / a0;
      return this;
    }
    lowPass(frequency, sampleRate, q = 0.707) {
      const w = (2 * Math.PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
      const alpha = Math.sin(w) / (2 * q);
      const a0 = 1 + alpha;
      const c = Math.cos(w);
      this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = (1 - c) / 2 / a0;
      this.a1 = (-2 * c) / a0; this.a2 = (1 - alpha) / a0;
      return this;
    }
    process(x) {
      const y = this.b0 * x + this.z1;
      this.z1 = this.b1 * x - this.a1 * y + this.z2;
      this.z2 = this.b2 * x - this.a2 * y;
      return y;
    }
    reset() {
      this.z1 = 0;
      this.z2 = 0;
    }
  }

  /** Mono Freeverb: eight damped combs into four all-passes. */
  class Reverb {
    constructor(sampleRate) {
      const scale = sampleRate / 44100;
      this.combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((base) => {
        const length = Math.floor(base * scale);
        return { buffer: new Float32Array(length), length, index: 0, filterState: 0 };
      });
      this.allPasses = [556, 441, 341, 225].map((base) => {
        const length = Math.floor(base * scale);
        return { buffer: new Float32Array(length), length, index: 0 };
      });
      this.feedback = 0.8;
      this.damping = 0.4;
    }
    process(input) {
      let sum = 0;
      for (const c of this.combs) {
        const delayed = c.buffer[c.index];
        c.filterState = delayed * (1 - this.damping) + c.filterState * this.damping;
        c.buffer[c.index] = input + c.filterState * this.feedback;
        if (++c.index === c.length) c.index = 0;
        sum += delayed;
      }
      let output = sum * 0.125;
      for (const a of this.allPasses) {
        const delayed = a.buffer[a.index];
        a.buffer[a.index] = output + delayed * 0.5;
        output = delayed - output;
        if (++a.index === a.length) a.index = 0;
      }
      return output;
    }
  }

  /** Response over log frequency: 40 Hz–10.24 kHz at 32 points per octave. */
  class ResponseTable {
    constructor() {
      this.values = new Float64Array(257).fill(1);
    }
    fill(response) {
      for (let i = 0; i < 257; i++) this.values[i] = response(40 * Math.pow(2, i / 32));
    }
    gain(frequency) {
      const position = Math.log2(Math.max(frequency, 40) / 40) * 32;
      const i = Math.min(Math.floor(position), 255);
      const fraction = Math.min(position - i, 1);
      return this.values[i] + (this.values[i + 1] - this.values[i]) * fraction;
    }
  }

  // A sung open "a": frequency and bandwidth for a male and a female voice, and level in dB.
  const VOWEL_A = [
    [[730, 90], [850, 100], 0],
    [[1150, 110], [1300, 120], -4],
    [[2550, 160], [2900, 200], -4],
    [[3300, 200], [3700, 260], -5],
    [[4200, 260], [4800, 320], -16],
  ];

  class Voice {
    constructor(sampleRate, seed) {
      this.sampleRate = sampleRate;
      const buffer = () => new Float64Array(MAX_PARTIALS);
      this.re = buffer(); this.im = buffer(); this.wr = buffer(); this.wi = buffer();
      this.harmonic = buffer(); this.baseFrequency = buffer(); this.baseAmplitude = buffer(); this.decayRate = buffer();
      this.player = new Int32Array(MAX_PARTIALS);
      this.response = new ResponseTable();
      this.count = 0;
      this.players = Array.from({ length: MAX_PLAYERS }, () => ({
        detune: 1, vibratoRate: 5.5, vibratoPhase: 0, drift: 0, driftTarget: 0, driftTimer: 0, pressure: 1, pressureTarget: 1,
      }));
      this.playerCount = 1;
      this.isActive = false;
      this.isFadingOut = false;
      this.fadeStart = 0;
      this.fadeLength = 0.03;
      this.instrument = "piano";
      this.level = 0;
      this.peakLevel = 0;
      this.f0 = 440; this.midi = 69; this.velocity = 1; this.gain = 1; this.time = 0;
      this.releaseStart = 1.6; this.releaseLength = 0.4; this.attackLength = 0.1;
      this.noise = new Noise(seed);
      this.noiseFilter = new Biquad();
      this.noiseFilter2 = new Biquad();
      this.noiseLevel = 0;
      this.noiseLevelTarget = 0;
      this.highestFrequency = Math.min(9000, sampleRate * 0.45);
    }

    get isSounding() {
      return this.isActive && !this.isFadingOut && (this.time < 0.1 || this.level > this.gain * 0.01);
    }

    get envelope() {
      return this.peakLevel > 0 ? Math.min(this.level / this.peakLevel, 1) : 0;
    }

    start(midi, frequency, velocity, instrument) {
      this.instrument = instrument;
      this.midi = midi;
      this.f0 = frequency;
      this.velocity = Math.min(Math.max(velocity, 0), 1);
      this.time = 0;
      this.peakLevel = 0;
      this.isActive = true;
      this.isFadingOut = false;
      this.noiseLevel = 0;
      this.noiseFilter.reset();
      this.noiseFilter2.reset();

      if (instrument === "piano") this.startPiano();
      else if (instrument === "strings") this.startEnsemble(3, 20, 7);
      else if (instrument === "brass") this.startEnsemble(2, 28, 4);
      else this.startEnsemble(2, 32, 5);

      this.normalizeLoudness();
      for (let k = 0; k < this.count; k++) {
        this.re[k] = 1e-6;
        this.im[k] = 0;
      }
      this.update(0);
      this.noiseLevel = instrument === "piano" ? this.noiseLevelTarget : 0;
    }

    fadeOut(seconds = 0.03) {
      if (this.isFadingOut) return;
      this.isFadingOut = true;
      this.fadeStart = this.time;
      this.fadeLength = seconds;
    }

    fade(t) {
      return this.isFadingOut ? Math.max(0, 1 - (t - this.fadeStart) / this.fadeLength) : 1;
    }

    startPiano() {
      const v = this.velocity, f0 = this.f0, midi = this.midi;
      const b = Math.min(Math.max(2.5e-4 * Math.exp(0.045 * (midi - 60)), 4e-5), 0.02);
      const t60 = Math.min(Math.max(7 * Math.pow(2, -(midi - 48) / 18), 0.35), 12);
      const strike = 1 / 8;
      const hammerCutoff = f0 * (2.8 + 9 * v * v) + 500 * v + 350;
      this.attackLength = 0.0045 - 0.0025 * v;
      const unison = 0.35 + 0.5 * this.noise.unit();

      this.count = 0;
      let n = 1;
      while (this.count + 2 <= MAX_PARTIALS) {
        const fn = n * f0 * Math.sqrt(1 + b * n * n);
        if (fn > this.highestFrequency) break;
        const hammer = (0.25 + Math.abs(Math.sin(Math.PI * n * strike))) / (1 + Math.pow(fn / hammerCutoff, 2));
        const board = 1 + logBump(fn, 180, 1.0, 0.6) + logBump(fn, 600, 1.2, 0.25);
        const amplitude = (hammer * board) / Math.pow(n, 0.5);
        const prompt = (6.91 / t60) * (1 + Math.pow(fn / 900, 1.7));
        for (let c = 0; c < 2; c++) {
          const k = this.count;
          this.harmonic[k] = n;
          this.player[k] = c;
          this.baseFrequency[k] = fn * cents(c === 0 ? -unison / 2 : unison / 2);
          this.baseAmplitude[k] = amplitude * (c === 0 ? 0.82 : 0.28);
          this.decayRate[k] = c === 0 ? prompt : prompt * 0.28;
          this.count++;
        }
        n++;
      }
      this.releaseStart = 7;
      this.releaseLength = 0.5;
      this.response.fill(() => 1);
      this.noiseFilter.bandPass(140 + Math.min(f0, 600) * 0.4, 0.7, this.sampleRate);
      this.noiseFilter2.lowPass(900 + 1800 * v, this.sampleRate);
    }

    startEnsemble(players, maxHarmonic, spread) {
      this.playerCount = players;
      const perPlayer = Math.min(maxHarmonic, Math.floor(MAX_PARTIALS / players), Math.max(1, Math.floor(this.highestFrequency / this.f0)));
      for (let p = 0; p < players; p++) {
        const offset = players === 1 ? 0 : (p / (players - 1) - 0.5) * 2 * spread;
        const player = this.players[p];
        player.detune = cents(offset + (this.noise.unit() - 0.5) * 2);
        player.vibratoRate = 5.1 + 1.0 * this.noise.unit();
        player.vibratoPhase = 2 * Math.PI * this.noise.unit();
        player.drift = 0;
        player.driftTarget = (this.noise.unit() - 0.5) * 6;
        player.driftTimer = 0;
        player.pressure = 1;
        player.pressureTarget = 1;
      }
      this.count = 0;
      for (let p = 0; p < players; p++) {
        for (let n = 1; n <= perPlayer; n++) {
          const k = this.count++;
          this.harmonic[k] = n;
          this.player[k] = p;
          this.baseFrequency[k] = n * this.f0;
          this.baseAmplitude[k] = 1;
          this.decayRate[k] = 0;
        }
      }

      const v = this.velocity, sr = this.sampleRate;
      if (this.instrument === "strings") {
        this.attackLength = 0.22 - 0.12 * v;
        this.releaseStart = 1.7;
        this.releaseLength = 0.45;
        this.response.fill((f) => {
          const body = 0.35 + logBump(f, 280, 0.25, 1.0) + logBump(f, 460, 0.3, 0.8) + logBump(f, 700, 0.35, 0.5) + logBump(f, 2500, 0.7, 0.9);
          const dip = 1 - logBump(f, 1400, 0.35, 0.35);
          const rolloff = 1 / (1 + Math.pow(f / 5500, 4));
          return body * dip * rolloff;
        });
        for (let k = 0; k < this.count; k++) this.baseAmplitude[k] = 1 / Math.pow(this.harmonic[k], 1.1 - 0.3 * v);
        this.noiseFilter.bandPass(3200, 0.8, sr);
        this.noiseFilter2.lowPass(7000, sr);
      } else if (this.instrument === "brass") {
        this.attackLength = 0.06 - 0.025 * v;
        this.releaseStart = 1.35;
        this.releaseLength = 0.18;
        this.response.fill((f) => {
          const bell = Math.sqrt(f / (f + 900));
          const mouthpiece = 1 / (1 + Math.pow(f / 4500, 3));
          return bell * mouthpiece * (1 + logBump(f, 1200, 0.8, 0.3));
        });
        for (let k = 0; k < this.count; k++) this.baseAmplitude[k] = 1 / Math.pow(this.harmonic[k], 0.55);
        this.noiseFilter.bandPass(1600, 1.2, sr);
        this.noiseFilter2.lowPass(5000, sr);
      } else {
        this.attackLength = 0.14 - 0.05 * v;
        this.releaseStart = 1.7;
        this.releaseLength = 0.4;
        const register = Math.min(Math.max((this.midi - 48) / 12, 0), 1);
        this.response.fill((f) => {
          let sum = 0.01;
          for (const [male, female, level] of VOWEL_A) {
            const center = male[0] + (female[0] - male[0]) * register;
            const width = male[1] + (female[1] - male[1]) * register;
            const d = center * center - f * f;
            sum += Math.pow(2, level / 6.02) * ((width * f) / Math.sqrt(d * d + width * width * f * f));
          }
          return sum;
        });
        for (let k = 0; k < this.count; k++) this.baseAmplitude[k] = 1 / Math.pow(this.harmonic[k], 1.15 - 0.3 * v);
        this.noiseFilter.bandPass(1000, 0.6, sr);
        this.noiseFilter2.bandPass(2800, 1.5, sr);
      }
    }

    normalizeLoudness() {
      let power = 0;
      for (let k = 0; k < this.count; k++) {
        const a = this.baseAmplitude[k] * this.response.gain(this.baseFrequency[k]);
        power += a * a;
      }
      const rms = Math.sqrt(Math.max(power, 1e-9));
      this.gain = (0.22 * (0.08 + 0.92 * this.velocity * this.velocity)) / rms;
    }

    envelopeAt(t) {
      let e = smoothstep(t / Math.max(this.attackLength, 0.005));
      if (this.instrument === "brass") e *= 1 + 0.12 * Math.exp(-Math.pow((t - this.attackLength * 1.4) / 0.04, 2));
      if (t > this.releaseStart) e *= Math.max(0, 1 - smoothstep((t - this.releaseStart) / this.releaseLength));
      return e;
    }

    update(blockLength) {
      const dt = blockLength / this.sampleRate;
      const target = this.time + (blockLength === 0 ? 0 : dt);
      const twoPiOverRate = (2 * Math.PI) / this.sampleRate;
      const instrument = this.instrument;
      let total = 0;

      if (instrument !== "piano") {
        for (let p = 0; p < this.playerCount; p++) {
          const player = this.players[p];
          player.vibratoPhase += 2 * Math.PI * player.vibratoRate * dt;
          if (player.vibratoPhase > 2 * Math.PI) player.vibratoPhase -= 2 * Math.PI;
          player.driftTimer -= dt;
          if (player.driftTimer <= 0) {
            player.driftTimer = 0.25 + 0.5 * this.noise.unit();
            player.driftTarget = (this.noise.unit() - 0.5) * 6;
            player.pressureTarget = 0.88 + 0.24 * this.noise.unit();
          }
          const follow = Math.min(1, dt * 3);
          player.drift += (player.driftTarget - player.drift) * follow;
          player.pressure += (player.pressureTarget - player.pressure) * follow;
        }
      }

      const envelope = this.envelopeAt(target);
      const fadeGain = this.fade(target);
      const ensemble = Math.sqrt(this.playerCount);
      for (let k = 0; k < this.count; k++) {
        let frequency = this.baseFrequency[k];
        let amplitude = this.baseAmplitude[k] * this.gain;
        const n = this.harmonic[k];
        if (instrument === "piano") {
          const contact = smoothstep(target / (this.attackLength * (1 + 0.08 * n)));
          amplitude *= contact * Math.exp(-this.decayRate[k] * target);
          if (target > this.releaseStart) amplitude *= Math.max(0, 1 - (target - this.releaseStart) / this.releaseLength);
        } else if (instrument === "strings") {
          const p = this.players[this.player[k]];
          const vibratoDepth = 14 * smoothstep((target - 0.2) / 0.4);
          frequency *= p.detune * cents(vibratoDepth * Math.sin(p.vibratoPhase) + p.drift);
          const speak = smoothstep(target / (0.03 + 0.012 * n));
          amplitude *= (envelope * speak * p.pressure * this.response.gain(frequency)) / ensemble;
        } else if (instrument === "brass") {
          const p = this.players[this.player[k]];
          const intensity = envelope * (0.35 + 0.65 * this.velocity);
          const bend = -30 * Math.exp(-target / 0.03);
          const vibratoDepth = 7 * smoothstep((target - 0.35) / 0.3);
          frequency *= p.detune * cents(bend + vibratoDepth * Math.sin(p.vibratoPhase) + p.drift * 0.4);
          amplitude *= (Math.pow(Math.max(intensity, 1e-4), 1 + 0.3 * (n - 1)) * this.response.gain(frequency) * p.pressure) / ensemble;
        } else {
          const p = this.players[this.player[k]];
          const vibratoDepth = 28 * smoothstep((target - 0.25) / 0.35);
          frequency *= p.detune * cents(vibratoDepth * Math.sin(p.vibratoPhase) + p.drift * 1.2);
          amplitude *= (envelope * this.response.gain(frequency) * (0.93 + 0.07 * p.pressure)) / ensemble;
        }
        amplitude *= fadeGain;
        if (frequency > this.highestFrequency) amplitude = 0;
        total += amplitude;

        const omega = frequency * twoPiOverRate;
        const magnitude = Math.max(Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]), 1e-9);
        if (blockLength === 0) {
          const scale = Math.max(amplitude, 1e-6) / magnitude;
          this.re[k] *= scale;
          this.im[k] *= scale;
          this.wr[k] = Math.cos(omega);
          this.wi[k] = Math.sin(omega);
        } else {
          const r = Math.pow(Math.max(amplitude, 1e-7) / magnitude, 1 / blockLength);
          this.wr[k] = r * Math.cos(omega);
          this.wi[k] = r * Math.sin(omega);
        }
      }
      this.level = total;
      this.peakLevel = Math.max(this.peakLevel, total);

      const v = this.velocity;
      let noise;
      if (instrument === "piano") noise = 0.5 * v * Math.exp(-target / 0.025);
      else if (instrument === "strings") noise = envelope * (0.012 + 0.03 * Math.exp(-target / 0.08)) * (0.5 + v);
      else if (instrument === "brass") noise = 0.12 * v * Math.exp(-target / 0.045) + 0.006 * envelope;
      else noise = envelope * (0.01 + 0.04 * Math.exp(-target / 0.1)) * (0.6 + 0.6 * v);
      this.noiseLevelTarget = noise * this.gain * 0.4 * fadeGain;
    }

    /** Adds `length` samples to `out` from `offset`. */
    render(out, offset, length) {
      if (!this.isActive) return;
      this.update(length);
      const { re, im, wr, wi } = this;
      const count = this.count;
      for (let i = 0; i < length; i++) {
        let sum = 0;
        for (let k = 0; k < count; k++) {
          const r = re[k], m = im[k];
          re[k] = r * wr[k] - m * wi[k];
          im[k] = r * wi[k] + m * wr[k];
          sum += im[k];
        }
        out[offset + i] += sum;
      }

      const step = (this.noiseLevelTarget - this.noiseLevel) / length;
      if (Math.max(this.noiseLevel, this.noiseLevelTarget) > 1e-6) {
        let level = this.noiseLevel;
        for (let i = 0; i < length; i++) {
          level += step;
          out[offset + i] += this.noiseFilter2.process(this.noiseFilter.process(this.noise.next())) * level;
        }
      }
      this.noiseLevel = this.noiseLevelTarget;

      this.time += length / this.sampleRate;
      const finished = (this.isFadingOut && this.time >= this.fadeStart + this.fadeLength)
        || this.time > this.releaseStart + this.releaseLength
        || (this.instrument === "piano" && this.time > 0.1 && this.level < this.gain * 2e-4);
      if (finished) this.isActive = false;
    }
  }

  class EvertoneSynth extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const sr = sampleRate;
      this.voices = Array.from({ length: MAX_VOICES }, (_, i) => new Voice(sr, 0x1234 + i * 7919));
      this.reverb = new Reverb(sr);
      this.block = new Float64Array(BLOCK);
      this.limiterGain = 1;
      this.limiterRelease = Math.exp(-1 / (0.3 * sr));
      this.gainSmoothing = 1 - Math.exp(-1 / (0.02 * sr));
      this.targetGain = options.processorOptions?.gain ?? 1;
      this.currentGain = this.targetGain;
      this.waiting = null;
      this.currentVoice = null;
      this.currentSerial = 0;
      this.startedSerial = 0;
      this.reported = 0;
      this.port.onmessage = ({ data }) => {
        // Only the latest note: with one at a time, an older one would never be heard.
        if (data.note) this.waiting = data.note;
        if (data.gain !== undefined) this.targetGain = Math.max(data.gain, 0);
      };
    }

    startWaitingNote() {
      const note = this.waiting;
      if (!note) return;
      const free = this.voices.find((voice) => !voice.isActive);
      if (!free) {
        for (const voice of this.voices) voice.fadeOut();
        return;
      }
      for (const voice of this.voices) if (voice.isActive) voice.fadeOut();
      free.start(note.midi, note.frequency, note.velocity, note.instrument);
      this.currentVoice = free;
      this.currentSerial = note.serial;
      this.startedSerial = note.serial;
      this.waiting = null;
    }

    process(_, outputs) {
      const out = outputs[0][0];
      const frames = out.length;
      const block = this.block;
      for (let offset = 0; offset < frames; offset += BLOCK) {
        const length = Math.min(BLOCK, frames - offset);
        this.startWaitingNote();
        block.fill(0);
        for (const voice of this.voices) if (voice.isActive) voice.render(block, 0, length);
        for (let i = 0; i < length; i++) {
          const dry = block[i];
          const wet = this.reverb.process(dry);
          this.currentGain += (this.targetGain - this.currentGain) * this.gainSmoothing;
          let sample = (dry + wet * 0.14) * this.currentGain;
          const level = Math.abs(sample) * this.limiterGain;
          if (level > 0.9) this.limiterGain *= 0.9 / level;
          sample *= this.limiterGain;
          this.limiterGain = 1 - (1 - this.limiterGain) * this.limiterRelease;
          // The app's main mixer plays at 0.8.
          out[offset + i] = sample * 0.8;
        }
      }

      // About every 20 ms: enough for the pad's glow to follow the note.
      if (++this.reported >= 8) {
        this.reported = 0;
        const voice = this.currentVoice?.isSounding ? this.currentVoice : null;
        this.port.postMessage({
          started: this.startedSerial,
          sounding: voice ? this.currentSerial : 0,
          envelope: voice ? voice.envelope : 0,
        });
      }
      return true;
    }
  }

  registerProcessor("evertone-synth", EvertoneSynth);
}
