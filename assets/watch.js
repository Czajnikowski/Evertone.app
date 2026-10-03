// The watch in the hero: twelve pads of octave 5, arranged like the app (four semitones to a column),
// playing through Web Audio. Tapping the instrument name steps through the four instruments.
// Names come from the app's catalog for the page's language: c shows its octave as in the app, and each pad
// reads as VoiceOver reads it there ("C sharp 5").

(() => {
  const watch = document.querySelector(".watch");
  if (!watch) return;

  const pads = watch.querySelector(".pads");
  const instrumentButton = watch.querySelector(".watch-status button");
  const names = pads.dataset.names.split(",");
  const spoken = pads.dataset.spoken.split(",");
  const instruments = instrumentButton.dataset.instruments.split(",");
  const voices = ["piano", "strings", "brass", "voice"];
  let voice = 0;

  // a5 = 440 Hz; octave 5 is c¹–h¹, as in the app.
  const frequency = (semitone) => 440 * Math.pow(2, (semitone - 9) / 12);

  for (let semitone = 0; semitone < 12; semitone++) {
    const pad = document.createElement("button");
    pad.type = "button";
    pad.className = "pad" + ([1, 3, 6, 8, 10].includes(semitone) ? "" : " light") + (semitone === 0 ? " home" : "");
    pad.textContent = semitone === 0 ? names[0] + "5" : names[semitone];
    pad.setAttribute("aria-label", spoken[semitone] + " 5");
    // The grid runs left to right, but a name like "دو5" reads in the page's own direction.
    pad.dir = document.documentElement.dir;
    pad.dataset.semitone = semitone;
    pads.append(pad);
  }

  let audio;
  let out;

  function context() {
    if (!audio) {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      const compressor = audio.createDynamicsCompressor();
      out = audio.createGain();
      out.gain.value = 0.35;
      out.connect(compressor).connect(audio.destination);
    }
    // Also "interrupted" in Safari after a call or another app took the audio.
    if (audio.state !== "running") audio.resume();
    return audio;
  }

  // A touch's pointerdown isn't a user gesture, so the first tap makes a suspended context that refuses to resume.
  // Its clock stands still while suspended, so resuming on the release still sounds the note struck on the press.
  function unlock() {
    if (audio && audio.state !== "running") audio.resume();
  }

  function envelope(ctx, attack, hold, release, peak = 1) {
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.setValueAtTime(peak, t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return { gain, end: t + attack + hold + release + 0.05 };
  }

  function vibrato(ctx, osc, f, depth, delay) {
    const lfo = ctx.createOscillator();
    const amount = ctx.createGain();
    lfo.frequency.value = 5.5;
    amount.gain.setValueAtTime(0, ctx.currentTime);
    amount.gain.linearRampToValueAtTime(f * depth, ctx.currentTime + delay);
    lfo.connect(amount).connect(osc.frequency);
    return lfo;
  }

  function play(semitone) {
    const ctx = context();
    const f = frequency(semitone);
    const t = ctx.currentTime;
    const started = [];
    let end;

    if (voices[voice] === "piano") {
      // A handful of harmonics, the higher ones dying away sooner.
      for (let n = 1; n <= 6; n++) {
        const osc = ctx.createOscillator();
        const env = envelope(ctx, 0.004, 0, 2.4 / n, 0.5 / Math.pow(n, 1.3));
        osc.frequency.value = f * n * (1 + 0.0004 * n * n);
        osc.connect(env.gain).connect(out);
        started.push(osc);
        end = Math.max(end || 0, env.end);
      }
    } else if (voices[voice] === "strings") {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const env = envelope(ctx, 0.15, 1.1, 0.5, 0.28);
      osc.type = "sawtooth";
      osc.frequency.value = f;
      filter.type = "lowpass";
      filter.frequency.value = 2200;
      osc.connect(filter).connect(env.gain).connect(out);
      started.push(osc, vibrato(ctx, osc, f, 0.004, 0.4));
      end = env.end;
    } else if (voices[voice] === "brass") {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const env = envelope(ctx, 0.05, 1.1, 0.25, 0.3);
      osc.type = "sawtooth";
      osc.frequency.value = f;
      filter.type = "lowpass";
      filter.Q.value = 2;
      filter.frequency.setValueAtTime(300, t);
      filter.frequency.exponentialRampToValueAtTime(f * 6, t + 0.09);
      filter.frequency.exponentialRampToValueAtTime(f * 4, t + 0.5);
      osc.connect(filter).connect(env.gain).connect(out);
      started.push(osc);
      end = env.end;
    } else {
      // Voice: a soft source through two formants of an open "a".
      const osc = ctx.createOscillator();
      const env = envelope(ctx, 0.12, 1.1, 0.4, 0.9);
      osc.type = "sawtooth";
      osc.frequency.value = f;
      for (const [formant, q, level] of [[800, 6, 1], [1200, 8, 0.5]]) {
        const band = ctx.createBiquadFilter();
        const g = ctx.createGain();
        band.type = "bandpass";
        band.frequency.value = formant;
        band.Q.value = q;
        g.gain.value = level;
        osc.connect(band).connect(g).connect(env.gain);
      }
      env.gain.connect(out);
      started.push(osc, vibrato(ctx, osc, f, 0.006, 0.35));
      end = env.end;
    }

    for (const node of started) {
      node.start(t);
      node.stop(end);
    }
    return end - t;
  }

  function strike(pad) {
    const seconds = play(Number(pad.dataset.semitone));
    for (const other of pads.children) other.classList.toggle("on", other === pad);
    clearTimeout(pad.timer);
    pad.timer = setTimeout(() => pad.classList.remove("on"), Math.min(seconds, 1.4) * 1000);
  }

  // Pointer down for touch and mouse, so the note starts under the finger; click only for the keyboard.
  pads.addEventListener("pointerdown", (event) => {
    const pad = event.target.closest(".pad");
    if (pad) strike(pad);
  });
  pads.addEventListener("pointerup", unlock);
  pads.addEventListener("click", (event) => {
    unlock();
    const pad = event.target.closest(".pad");
    if (pad && event.detail === 0) strike(pad);
  });

  function labelInstrument() {
    instrumentButton.textContent = instruments[voice];
    instrumentButton.setAttribute("aria-label", instrumentButton.dataset.label.replace("{name}", instruments[voice]));
  }
  labelInstrument();

  instrumentButton.addEventListener("click", () => {
    voice = (voice + 1) % voices.length;
    labelInstrument();
  });
})();
