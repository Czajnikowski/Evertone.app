// The watch in the hero: the app's main screen (watchOS/Evertone/Pads/PadsView.swift), as much of it as a page
// can do, sounding through the app's own synthesizer (synth.js).
//
// Twelve pads to an octave, four semitones to a column, octaves 3–8 side by side with three columns in view.
// Dragging sideways slowly stops at any column; a flick goes on to the next whole octave. Pulling up past the
// bottom centres the last note played, or before any, jumps back to octave 5. The crown sets the volume.
// Tapping the instrument by the clock opens the list of instruments and the tuning (a4 from 415 to 466 Hz).
// A long press holds the note "na ucho": its pad flashes until tapped, and the first time a hint explains.
// Names come from the app's catalog for the page's language, and each pad reads as VoiceOver reads it there.

(() => {
  const watch = document.querySelector(".watch");
  if (!watch) return;

  const t = JSON.parse(watch.dataset.strings);
  const screen = watch.querySelector(".watch-screen");
  const pads = watch.querySelector(".pads");
  const status = watch.querySelector(".watch-status");
  const instrumentButton = watch.querySelector(".watch-instrument");
  const crown = watch.querySelector(".watch-crown");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // MARK: Icons, after the app's SF Symbols.

  const paths = {
    piano: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 13v7M12 13v7M16 13v7"/><path d="M6.5 4h3v9h-3zM14.5 4h3v9h-3z" fill="currentColor" stroke="none"/>',
    strings: '<path d="M12 2v7M10.5 3.5h3M12 9c-2.6 0-4 1.3-4 3 0 1 .9 1.5.9 2.5S7 16.1 7 17.6C7 20.1 9.2 22 12 22s5-1.9 5-4.4c0-1.5-1.9-2.1-1.9-3.1s.9-1.5.9-2.5c0-1.7-1.4-3-4-3zM10.5 17h3"/>',
    brass: '<path d="M3 10v4h3l8 5V5l-8 5H3zM17.5 8.5l2.5-1.5M18 12h3M17.5 15.5l2.5 1.5"/>',
    vox: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    fork: '<path d="M8.5 2.5v8.5a3.5 3.5 0 0 0 7 0V2.5M12 14.5v7"/>',
    ear: '<path d="M7 9a5 5 0 0 1 10 0c0 3.2-3.2 3.8-3.2 7a2.8 2.8 0 0 1-5.4 1"/><path d="M10 9.5a2 2 0 0 1 4 0c0 1.3-1.4 1.6-1.6 2.6"/>',
    pinch: '<path d="M9 12V5.5a1.5 1.5 0 0 1 3 0V11l3.5.6a2.5 2.5 0 0 1 2 2.5V16a5 5 0 0 1-5 5h-.6a5 5 0 0 1-4-2l-2.2-3a1.6 1.6 0 0 1 2.4-2z" fill="currentColor"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  };
  const icon = (name) =>
    `<svg class="watch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;

  // MARK: Settings, kept between visits like the app's.

  const stored = (key, fallback, valid) => {
    try {
      const value = JSON.parse(localStorage.getItem("evertone." + key));
      return valid(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const store = (key, value) => {
    try {
      localStorage.setItem("evertone." + key, JSON.stringify(value));
    } catch {}
  };

  const instruments = [
    { id: "piano", name: t.piano },
    { id: "strings", name: t.strings },
    { id: "brass", name: t.brass },
    { id: "vox", name: t.voice },
  ];
  const STANDARD_PITCH = 440;
  const PITCH_RANGE = [415, 466];
  const isPitch = (value) => Number.isInteger(value) && value >= PITCH_RANGE[0] && value <= PITCH_RANGE[1];

  let instrument = stored("instrument", "piano", (id) => instruments.some((i) => i.id === id));
  let concertPitch = stored("concertPitch", STANDARD_PITCH, isPitch);
  // The crown's level from 5% to 100% in 5% steps; first, the step closest to half volume.
  let level = stored("level", 0.75, (value) => typeof value === "number" && value >= 0.05 && value <= 1);
  let earHintShown = stored("earHintShown", false, (value) => typeof value === "boolean");

  /** From 2% at the crown's lowest step to 100% at its top, and 20% halfway up, as in the app. */
  const volume = (level) => {
    const floor = 0.02, lowest = 0.05;
    const along = (level) => (level - lowest) / (1 - lowest);
    const curve = Math.log((0.2 - floor) / (1 - floor)) / Math.log(along(0.5));
    return floor + (1 - floor) * Math.pow(along(level), curve);
  };
  const volumePercent = () => Math.round(volume(level) * 100);
  /** Notes play as loud as struck at the crown's 80%. */
  const synthGain = () => Math.pow(volume(level) / volume(0.8), 1.5);

  // MARK: Notes, by MIDI number: c5 (oktawa razkreślna's c) is 60, a5 is 69.

  const names = t.noteNames.split(",");
  const spoken = t.spokenNames.split(",");
  const OCTAVES = [3, 8];
  const START_OCTAVE = 5;
  const VISIBLE = 3;
  const ROWS = 4;
  const LOWEST = OCTAVES[0] * 12;
  const COLUMNS = (OCTAVES[1] - OCTAVES[0] + 1) * VISIBLE;
  const MAX_POSITION = COLUMNS - VISIBLE;
  const HOME_POSITION = (START_OCTAVE - OCTAVES[0]) * VISIBLE;
  const CONCERT_A = 69;

  const octaveOf = (midi) => Math.floor(midi / 12);
  const name = (midi) => names[midi % 12] + octaveOf(midi);
  const spokenName = (midi) => `${spoken[midi % 12]} ${octaveOf(midi)}`;
  const columnOf = (midi) => Math.floor((midi - LOWEST) / ROWS);
  const frequency = (midi, a) => a * Math.pow(2, (midi - CONCERT_A) / 12);
  const format = (string, values) => string.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));

  // MARK: The screen.

  const strip = document.createElement("div");
  strip.className = "pads-strip";
  const padByMidi = new Map();
  for (let column = 0; column < COLUMNS; column++) {
    const stack = document.createElement("div");
    stack.className = "pad-column"
      + (column % VISIBLE === 0 ? " octave-start" : "")
      + (column % VISIBLE === VISIBLE - 1 ? " octave-end" : "");
    for (let row = 0; row < ROWS; row++) {
      const midi = LOWEST + column * ROWS + row;
      const semitone = midi % 12;
      const label = semitone === 0 ? name(midi) : names[semitone];
      const pad = document.createElement("button");
      pad.type = "button";
      pad.className = "pad" + ([1, 3, 6, 8, 10].includes(semitone) ? "" : " light") + (semitone === 0 ? " home" : "");
      pad.dataset.midi = midi;
      pad.tabIndex = -1;
      pad.setAttribute("aria-label", spokenName(midi));
      // The grid runs left to right, but a name like "دو5" reads in the page's own direction.
      pad.innerHTML = `<span dir="${document.documentElement.dir}">${label}</span>`
        + `<span class="pad-glow" aria-hidden="true"><span dir="${document.documentElement.dir}">${label}</span></span>`
        + `<span class="pad-pinch" aria-hidden="true">${icon("pinch")}</span>`;
      stack.append(pad);
      padByMidi.set(midi, pad);
    }
    strip.append(stack);
  }
  // Pulled up as a whole, apart from the strip's sideways scrolling, so each keeps its own animation.
  const pullLayer = document.createElement("div");
  pullLayer.className = "pads-pull";
  pullLayer.append(strip);
  pads.append(pullLayer);

  const pullHint = document.createElement("div");
  pullHint.className = "pull-hint";
  pullHint.setAttribute("aria-hidden", "true");
  pads.append(pullHint);

  const badge = document.createElement("div");
  badge.className = "watch-badge";
  badge.setAttribute("aria-hidden", "true");
  screen.append(badge);

  const announcer = document.createElement("div");
  announcer.className = "visually-hidden";
  announcer.setAttribute("aria-live", "polite");
  screen.append(announcer);

  const levelBar = document.createElement("div");
  levelBar.className = "watch-level";
  levelBar.setAttribute("aria-hidden", "true");
  levelBar.innerHTML = '<div class="watch-level-track"><div class="watch-level-fill"></div></div>';
  screen.append(levelBar);
  const levelFill = levelBar.querySelector(".watch-level-fill");

  const sheet = document.createElement("div");
  sheet.className = "watch-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", t.instrumentTitle);
  sheet.innerHTML = `
    <div class="sheet-page sheet-list">
      <div class="sheet-bar">
        <button type="button" class="round" data-action="close" aria-label="${t.close}">${icon("close")}</button>
        <h2>${t.instrumentTitle}</h2>
        <span class="time" aria-hidden="true">9:41</span>
      </div>
      <ul class="sheet-rows">${instruments.map((i) => `
        <li><button type="button" class="sheet-row" data-instrument="${i.id}">${icon(i.id)}<span>${i.name}</span><span class="check">${icon("check")}</span></button></li>`).join("")}
      </ul>
      <ul class="sheet-rows">
        <li><button type="button" class="sheet-row" data-action="tuning">${icon("fork")}<span>${t.tuning}</span><span class="end"></span></button></li>
      </ul>
    </div>
    <div class="sheet-page sheet-dial">
      <div class="sheet-bar">
        <button type="button" class="round" data-action="back" aria-label="${t.back}">${icon("back")}</button>
        <h2>${t.tuning}</h2>
        <button type="button" class="round" data-action="reset" aria-label="${t.pitchReset}">${icon("reset")}</button>
      </div>
      <div class="dial-body">
        <div class="dial-value" role="slider" tabindex="0" aria-label="${t.tuning}" aria-valuemin="${PITCH_RANGE[0]}" aria-valuemax="${PITCH_RANGE[1]}">
          <span class="hz"></span>
          <span class="caption"></span>
        </div>
        <button type="button" class="fork" data-action="fork" aria-label="${format(t.pitchPlay, { name: spokenName(CONCERT_A) })}">${icon("fork")}</button>
      </div>
    </div>`;
  screen.append(sheet);
  const sheetList = sheet.querySelector(".sheet-list");
  const dialValue = sheet.querySelector(".dial-value");
  const resetButton = sheet.querySelector('[data-action="reset"]');

  // Beside the watch while a note is held: the hand that double taps on the left, the ear it plays to on the right,
  // and the sound flowing between. Only shown; it plays out by itself.
  const watchBody = watch.querySelector(".watch-body");
  const hand = document.createElement("div");
  hand.className = "watch-hand";
  hand.setAttribute("aria-hidden", "true");
  // The hand: Twemoji's pinching hand (CC-BY 4.0, Twitter and contributors), in one colour with the curled fingers
  // cut out, and its index finger apart so it can meet the thumb. The ear: Material Symbols "hearing" (Apache License
  // 2.0) without its waves, which flow to it here.
  hand.innerHTML = `<svg viewBox="0 3.5 36 29" fill="currentColor">
      <defs>
        <mask id="hand-lines"><rect width="36" height="36" fill="#fff"/><path d="M19.207 7.293c-.389-.391-1.023-.392-1.414-.001-.391.39-.392 1.023-.001 1.415.017.017 1.704 1.737 1.704 4.293v7.109c0 .852-.501 1.154-.97 1.154-.496 0-1.025-.332-1.025-1.264v-2c0-3.767-.303-7.77-2.553-8.895-.495-.247-1.095-.046-1.342.447-.247.494-.047 1.095.447 1.342.66.33 1.447 1.831 1.447 7.105v.996s-.004 1.001-.004 3.114c0 .852-.501 1.154-.97 1.154-.496 0-1.025-.332-1.025-1.264v-2c0-3.767-.303-7.77-2.553-8.895-.495-.248-1.095-.046-1.342.447-.247.494-.047 1.095.447 1.342.66.33 1.447 1.831 1.447 7.105v2c0 .021.005.039.005.06-.001.017-.01.032-.01.049 0 .852-.501 1.154-.97 1.154-.496.004-1.025-.328-1.025-1.26 0-3.394 0-7.618-2.553-8.895-.495-.248-1.095-.046-1.342.447-.247.494-.047 1.095.447 1.342C7.5 15.618 7.5 19.613 7.5 22c0 2.143 1.522 3.264 3.025 3.264.722 0 1.445-.263 1.999-.769.56.505 1.281.769 2.001.769 1.236 0 2.473-.769 2.846-2.232.368.151.761.232 1.154.232 1.476 0 2.97-1.083 2.97-3.154V13c0-3.375-2.194-5.613-2.288-5.707z" fill="#000"/></mask>
        <clipPath id="hand-palm"><path d="M0 0H21.5V12.6H36V36H0Z"/></clipPath>
        <clipPath id="hand-index"><path d="M20 0H36V12.6H20Z"/></clipPath>
      </defs>
      <g mask="url(#hand-lines)">
        <path d="M33.29 8.628C33.265 8.62 24.499 6 21.499 5c-1.2-.4-21-7-21 16 0 .637 2 11 4 11h11c8.375 0 5.642-10.68 15.92-12.106 1.739-.241 2.621-1.112 2.466-2.566-.165-1.549-1.975-2.059-3.534-2.059-1.146 0-5.754.233-9.026 1.951-.286-1.809-.826-4.013-.826-6.221 5 1 11.092 2.333 11.209 2.372 1.31.434 2.726-.271 3.162-1.582.438-1.309-.27-2.724-1.58-3.161z" clip-path="url(#hand-palm)"/>
        <g class="hand-index"><path d="M33.29 8.628C33.265 8.62 24.499 6 21.499 5c-1.2-.4-21-7-21 16 0 .637 2 11 4 11h11c8.375 0 5.642-10.68 15.92-12.106 1.739-.241 2.621-1.112 2.466-2.566-.165-1.549-1.975-2.059-3.534-2.059-1.146 0-5.754.233-9.026 1.951-.286-1.809-.826-4.013-.826-6.221 5 1 11.092 2.333 11.209 2.372 1.31.434 2.726-.271 3.162-1.582.438-1.309-.27-2.724-1.58-3.161z" clip-path="url(#hand-index)"/></g>
      </g>
      <circle class="hand-spark" cx="34" cy="12.6" r="1.6"/>
    </svg>`;
  const ear = document.createElement("div");
  ear.className = "watch-ear";
  ear.setAttribute("aria-hidden", "true");
  ear.innerHTML = `<svg viewBox="115 -885 565 810" fill="currentColor"><path d="M464-538q27-27 27-66t-27-67q-27-28-66-28t-67 28q-28 28-28 67t28 66q28 27 67 27t66-27ZM181-224q0-13-8.5-21.5T151-254q-13 0-21.5 8.5T121-224q4 60 47.5 101.5T272-81q57 0 99-31t62-82q20-51 39.5-79.5T546-345q66-53 95-113t29-146q0-120-76-196.5T398-877q-118 0-196 73.5T120-616q0 13 8.5 21.5T150-586q13 0 21.5-8.5T180-616q4-88 65-144.5T398-817q90 0 151 61.5T610-604q0 72-28 124.5T489-378q-39 29-62.5 63T382-231q-17 42-44.5 66T272-141q-35 0-61-24t-30-59Z"/></svg>`;
  const flow = document.createElement("div");
  flow.className = "sound-flow";
  flow.setAttribute("aria-hidden", "true");
  flow.innerHTML = '<svg viewBox="0 0 10 24"><path d="M2 2Q10 12 2 22"/></svg>'.repeat(3);
  watchBody.append(hand, ear, flow);

  /** Sizes the hand and the ear to the room beside the watch, keeping the page's 16px gutter. */
  function fitEarScene() {
    const gutter = 16;
    const box = watchBody.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const crown = box.width * 0.035;
    const left = box.left - gutter;
    const right = width - box.right - crown - gutter;
    const handGap = Math.min(Math.max(left * 0.2, 5), 24);
    const earGap = Math.min(Math.max(right * 0.25, 6), 44);
    const set = (name, px) => watchBody.style.setProperty(name, `${Math.max(px, 0)}px`);
    set("--hand-gap", handGap);
    set("--hand-size", Math.min(left - handGap, 64));
    set("--ear-gap", earGap);
    set("--ear-size", Math.min(right - earGap, 46));
  }

  const hint = document.createElement("div");
  hint.className = "ear-hint";
  hint.hidden = true;
  hint.setAttribute("role", "dialog");
  hint.setAttribute("aria-modal", "true");
  hint.setAttribute("aria-label", t.atTheEar);
  hint.innerHTML = `${icon("ear")}<p>${t.earHintRaiseAndTap}</p><p>${t.earHintOrTapPad}</p><button type="button">${t.ok}</button>`;
  screen.append(hint);

  const haptic = (pattern) => {
    try {
      navigator.vibrate?.(pattern);
    } catch {}
  };

  // MARK: Audio: the app's synthesizer in an AudioWorklet; one note at a time.

  let audio;
  let synth;
  let waitingNote;
  let lastSerial = 0;
  let report = { started: 0, sounding: 0, envelope: 0 };
  let idleTimer;

  /** Starts audio, from a tap or a key: browsers let a page make sound only after one. */
  function startAudio() {
    if (!audio) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      // As the app's playback category: heard with the ringer switch off too.
      try {
        if (navigator.audioSession) navigator.audioSession.type = "playback";
      } catch {}
      audio = new Context({ latencyHint: "interactive" });
      // The synthesizer from synth.js, which the page has already loaded; see there.
      const worklet = URL.createObjectURL(new Blob([`(${evertoneSynth})()`], { type: "text/javascript" }));
      audio.audioWorklet?.addModule(worklet).then(() => {
        synth = new AudioWorkletNode(audio, "evertone-synth", {
          numberOfInputs: 0,
          outputChannelCount: [1],
          processorOptions: { gain: synthGain() },
        });
        synth.connect(audio.destination);
        synth.port.onmessage = ({ data }) => (report = data);
        if (waitingNote) synth.port.postMessage({ note: waitingNote });
        waitingNote = null;
      }).catch(() => {});
    }
    // Also "interrupted" in Safari after a call or another app took the audio.
    if (audio.state !== "running") audio.resume().catch(() => {});
  }

  /** Plays `midi` with the instrument and tuning now; returns its serial. */
  function noteOn(midi, pitch = concertPitch) {
    startAudio();
    const note = { midi, frequency: frequency(midi, pitch), velocity: 0.8, instrument, serial: ++lastSerial };
    if (synth) synth.port.postMessage({ note });
    else waitingNote = note;
    clearTimeout(idleTimer);
    return note.serial;
  }

  const isSounding = (serial) => report.started < serial || report.sounding === serial;
  const envelopeOf = (serial) => (report.sounding === serial ? report.envelope : 0);

  /** Lets audio rest after 10 s with nothing sounding or held, as the app stops its engine. */
  function scheduleIdle() {
    clearTimeout(idleTimer);
    if (sounding !== null || armed !== null) return;
    idleTimer = setTimeout(() => {
      if (sounding === null && armed === null && audio?.state === "running") audio.suspend().catch(() => {});
    }, 10000);
  }

  // MARK: Playing: the pad sounding glows with its note, and the last one played keeps a mark.

  let sounding = null;
  let soundingSerial = 0;
  let marked = null;
  let armed = null;
  /** The glow of the note played over, kept until the new one is as bright. */
  let carried = 0;
  let glowDeadline = 0;

  /** As bright as the note is loud, on a decibel scale from 40 dB below its peak. */
  const brightness = (envelope) => (envelope > 0 ? Math.min(Math.max((20 * Math.log10(envelope) + 40) / 40, 0), 1) : 0);

  function envelopeNow() {
    const envelope = envelopeOf(soundingSerial);
    if (envelope >= carried) carried = 0;
    return Math.max(envelope, carried);
  }

  function glowOf(midi) {
    return padByMidi.get(midi).querySelector(".pad-glow");
  }

  /** Fades the pad's glow out from wherever it is. */
  function letGlowGo(midi) {
    const pad = padByMidi.get(midi);
    pad.classList.remove("sounding");
    const glow = glowOf(midi);
    glow.classList.remove("live");
    glow.style.opacity = "0";
  }

  function sound(midi) {
    if (sounding !== null) {
      const current = envelopeNow();
      if (sounding === midi) carried = current;
      else {
        carried = 0;
        letGlowGo(sounding);
      }
    } else {
      carried = 0;
    }
    soundingSerial = noteOn(midi);
    setMarked(midi);
    const wasSounding = sounding !== null;
    sounding = midi;
    padByMidi.get(midi).classList.add("sounding");
    glowOf(midi).classList.add("live");
    glowDeadline = performance.now() + 10000;
    if (!wasSounding) requestAnimationFrame(followGlow);
  }

  function followGlow() {
    if (sounding === null) return;
    if (!isSounding(soundingSerial) || performance.now() > glowDeadline) {
      letGlowGo(sounding);
      sounding = null;
      scheduleIdle();
      return;
    }
    glowOf(sounding).style.opacity = brightness(envelopeNow()).toFixed(3);
    requestAnimationFrame(followGlow);
  }

  function setMarked(midi) {
    if (marked !== null) padByMidi.get(marked).classList.remove("marked");
    marked = midi;
    padByMidi.get(midi).classList.add("marked");
    setFocusable(midi);
  }

  /** A tap: plays the pad, or plays the held note, or lets go of it if another pad is tapped. */
  function tap(midi) {
    if (armed !== null) {
      if (midi === armed) fire();
      else cancelHold();
      return;
    }
    haptic(8);
    sound(midi);
  }

  // MARK: "Na ucho": a long press holds the note; its pad flashes until tapped.

  function hold(midi) {
    if (midi === armed) {
      cancelHold();
      return;
    }
    startAudio();
    setMarked(midi);
    if (!earHintShown) showHint();
    arm(midi);
  }

  /** Holds `midi` and taps twice, in the rhythm of a double tap and of the pad's flashes. */
  function arm(midi) {
    if (armed !== null) padByMidi.get(armed).classList.remove("armed");
    armed = midi;
    const pad = padByMidi.get(midi);
    pad.classList.add("armed");
    pad.setAttribute("aria-label", format(t.earLabel, { name: spokenName(midi) }));
    clearTimeout(idleTimer);
    haptic(12);
    setTimeout(() => armed === midi && haptic(12), 320);
    showEarScene();
  }

  // MARK: The scene by the watch: the hand double taps a moment after a note is held, and the note plays to the ear.

  let sceneTimers = [];
  const clearScene = () => sceneTimers.splice(0).forEach(clearTimeout);
  const later = (ms, action) => sceneTimers.push(setTimeout(action, ms));

  /** The ear comes first, then the hand, which double taps; as the second tap lands, the note plays to the ear. */
  function showEarScene() {
    clearScene();
    watch.classList.remove("hand-shown", "tapping", "flowing", "hearing");
    // Under the first hint, it all waits until that's read.
    if (!hint.hidden) {
      watch.classList.remove("ear-shown");
      return;
    }
    fitEarScene();
    watch.classList.add("ear-shown");
    later(500, () => {
      watch.classList.add("hand-shown");
      later(800, () => {
        watch.classList.add("tapping");
        later(400, () => armed !== null && fire());
      });
    });
  }

  /** The note just played flows from the watch to the ear, which lights up as it arrives; then all of it goes. */
  function flowToEar() {
    clearScene();
    fitEarScene();
    watch.classList.add("ear-shown", "flowing");
    later(450, () => watch.classList.add("hearing"));
    later(1500, () => watch.classList.remove("ear-shown", "hand-shown", "tapping", "flowing", "hearing"));
  }

  function disarm() {
    if (armed === null) return;
    const pad = padByMidi.get(armed);
    pad.classList.remove("armed");
    pad.setAttribute("aria-label", spokenName(armed));
    armed = null;
    scheduleIdle();
    if (!watch.classList.contains("flowing")) {
      clearScene();
      watch.classList.remove("ear-shown", "hand-shown", "tapping");
    }
  }

  function fire() {
    const midi = armed;
    // The hand stays to the end of its double tap.
    const hand = ["hand-shown", "tapping"].filter((name) => watch.classList.contains(name));
    disarm();
    watch.classList.add(...hand);
    sound(midi);
    flowToEar();
  }

  function cancelHold() {
    disarm();
    haptic(12);
  }

  function showHint() {
    hint.hidden = false;
    setInert(true);
    hint.querySelector("button").focus({ preventScroll: true });
  }

  function closeHint() {
    hint.hidden = true;
    earHintShown = true;
    store("earHintShown", true);
    setInert(false);
    if (armed !== null) {
      padByMidi.get(armed).focus({ preventScroll: true });
      showEarScene();
    }
  }

  hint.querySelector("button").addEventListener("click", closeHint);


  // MARK: Scrolling sideways, and pulling up to jump back.

  let position = HOME_POSITION;
  let pull = 0;
  let pullArmed = true;
  const PULL_THRESHOLD = 30;
  /** Finger speed in px/s past which letting go counts as a flick. */
  const FLICK_SPEED = 250;

  const columnWidth = () => pads.clientWidth / VISIBLE;

  function layout(transition = "none") {
    strip.style.transition = transition;
    strip.style.transform = `translate3d(${-position * columnWidth()}px, 0, 0)`;
  }

  function layoutPull(transition = "none") {
    pullLayer.style.transition = transition;
    pullLayer.style.transform = `translate3d(0, ${pull}px, 0)`;
    const under = Math.max(0, -pull);
    pullHint.style.height = `${under}px`;
    pullHint.style.opacity = Math.min(1, under / PULL_THRESHOLD);
  }

  /** Where the strip is on screen right now, also halfway through an animation. */
  function currentPosition() {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(strip).transform);
    return -matrix.m41 / columnWidth();
  }

  function moveTo(target, transition) {
    position = target;
    layout(reduceMotion.matches ? "none" : transition);
  }

  /** Follows the finger inside the range and resists more and more beyond it, like a scroll view's edge. */
  function rubberBand(value, low, high, dimension) {
    const clamped = Math.min(Math.max(value, low), high);
    const excess = value - clamped;
    if (excess === 0 || dimension <= 0) return clamped;
    const resisted = (1 - 1 / ((Math.abs(excess) * 0.55) / dimension + 1)) * dimension;
    return clamped + (excess > 0 ? resisted : -resisted);
  }

  /** Dragged slowly, the nearest column; flicked, the next whole octave in the flick's direction. */
  function scrollTarget(released, velocity) {
    let target;
    if (Math.abs(velocity) > FLICK_SPEED) {
      const octave = released / VISIBLE;
      target = (velocity < 0 ? Math.floor(octave) + 1 : Math.ceil(octave) - 1) * VISIBLE;
    } else {
      target = Math.round(released);
    }
    return Math.min(Math.max(target, 0), MAX_POSITION);
  }

  const returnTitle = () => (marked !== null ? name(marked) : format(t.octave, { n: START_OCTAVE }));

  function setPullHint(done) {
    pullHint.innerHTML = `${icon(done ? "check" : "up")}<span>${returnTitle()}</span>`;
  }

  /** Centres the marked note, or else shows octave 5; then briefly says which. */
  function jumpBack() {
    const target = marked !== null ? Math.min(Math.max(columnOf(marked) - 1, 0), MAX_POSITION) : HOME_POSITION;
    const title = returnTitle();
    haptic([10, 60, 10]);
    announcer.textContent = title;
    moveTo(target, "transform 0.5s cubic-bezier(0.3, 1.25, 0.5, 1)");
    setPullHint(true);
    badge.textContent = title;
    badge.classList.add("shown");
    clearTimeout(jumpBack.timer);
    jumpBack.timer = setTimeout(() => badge.classList.remove("shown"), 900);
  }

  /** Scrolls so `midi` is in view, in the middle column where there's room, unless it already is. */
  function bringIntoView(midi) {
    const column = columnOf(midi);
    if (column >= Math.round(position) && column < Math.round(position) + VISIBLE) return;
    moveTo(Math.min(Math.max(column - 1, 0), MAX_POSITION), "transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)");
  }

  // One drag either scrolls sideways or pulls; the axis is picked from the first movement. A pad plays when
  // the finger lifts without having moved, as SwiftUI's tap does, and a press of half a second holds it.
  let gesture = null;

  pads.addEventListener("pointerdown", (event) => {
    if (gesture || event.button !== 0) return;
    const pad = event.target.closest(".pad");
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      midi: pad ? Number(pad.dataset.midi) : null,
      axis: null,
      start: currentPosition(),
      samples: [[event.timeStamp, event.clientX]],
      held: false,
    };
    if (pad) {
      gesture.timer = setTimeout(() => {
        if (!gesture || gesture.axis) return;
        gesture.held = true;
        hold(gesture.midi);
      }, 500);
    }
    // Gets audio ready while the finger is down, so the note isn't late when it lifts. On touch, browsers allow
    // sound only once it lifts, and the tap's own startAudio resumes it then.
    startAudio();
  });

  window.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.axis) {
      if (Math.hypot(dx, dy) < 10) return;
      gesture.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      clearTimeout(gesture.timer);
      try {
        pads.setPointerCapture(event.pointerId);
      } catch {}
      if (gesture.axis === "y") setPullHint(false);
    }
    if (gesture.axis === "x") {
      position = rubberBand(gesture.start - dx / columnWidth(), 0, MAX_POSITION, VISIBLE);
      gesture.samples.push([event.timeStamp, event.clientX]);
      while (gesture.samples.length > 2 && event.timeStamp - gesture.samples[0][0] > 100) gesture.samples.shift();
      layout();
    } else {
      pull = rubberBand(Math.min(dy, 0), 0, 0, pads.clientHeight);
      layoutPull();
      if (Math.abs(pull) >= PULL_THRESHOLD && pullArmed) {
        pullArmed = false;
        jumpBack();
      }
    }
  });

  function endGesture(event, cancelled) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const ended = gesture;
    gesture = null;
    clearTimeout(ended.timer);
    if (ended.axis === "x") {
      const [first, last] = [ended.samples[0], ended.samples[ended.samples.length - 1]];
      const elapsed = last[0] - first[0];
      const velocity = !cancelled && elapsed > 0 && event.timeStamp - last[0] < 80 ? ((last[1] - first[1]) / elapsed) * 1000 : 0;
      const target = scrollTarget(position, velocity);
      if (target !== Math.round(ended.start)) haptic(6);
      moveTo(target, "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)");
    } else if (ended.axis === "y") {
      pull = 0;
      pullArmed = true;
      layoutPull(reduceMotion.matches ? "none" : "transform 0.35s cubic-bezier(0.3, 1.2, 0.5, 1)");
    } else if (!cancelled && !ended.held && ended.midi !== null) {
      tap(ended.midi);
    }
  }

  // On the window: the hint, opening under a held finger, takes the pointer's events from the pads.
  window.addEventListener("pointerup", (event) => endGesture(event, false));
  window.addEventListener("pointercancel", (event) => endGesture(event, true));
  // Not focused by the mouse: focus would scroll a pad half out of view into it.
  pads.addEventListener("mousedown", (event) => event.preventDefault());
  // A long press is the pads' own, not the browser's menu.
  pads.addEventListener("contextmenu", (event) => event.preventDefault());

  // Keyboard: Enter or Space taps the focused pad (a click without a pointer).
  pads.addEventListener("click", (event) => {
    const pad = event.target.closest(".pad");
    if (pad && event.detail === 0) {
      startAudio();
      tap(Number(pad.dataset.midi));
    }
  });

  // Sideways scrolling on a trackpad or with Shift and the wheel; up and down is left to the page.
  let wheelTimer;
  pads.addEventListener("wheel", (event) => {
    const dx = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (Math.abs(dx) <= Math.abs(event.shiftKey ? 0 : event.deltaY)) return;
    event.preventDefault();
    const pixels = dx * (event.deltaMode === 1 ? 16 : 1);
    if (strip.style.transition !== "none") position = currentPosition();
    position = Math.min(Math.max(position + pixels / columnWidth(), 0), MAX_POSITION);
    layout();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => moveTo(Math.round(position), "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)"), 160);
  }, { passive: false });

  // One pad in the tab order at a time; the arrows move a semitone up or down a column, or a third across.
  function setFocusable(midi) {
    for (const pad of padByMidi.values()) pad.tabIndex = -1;
    padByMidi.get(midi).tabIndex = 0;
  }

  pads.addEventListener("keydown", (event) => {
    const pad = event.target.closest(".pad");
    if (!pad) return;
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -ROWS, ArrowRight: ROWS }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = padByMidi.get(Number(pad.dataset.midi) + step);
    if (!next) return;
    setFocusable(Number(next.dataset.midi));
    next.focus({ preventScroll: true });
  });

  pads.addEventListener("focusin", (event) => {
    const pad = event.target.closest(".pad");
    if (pad) bringIntoView(Number(pad.dataset.midi));
  });

  // Focus would otherwise scroll the clipped pads natively, under the strip's own position.
  pads.addEventListener("scroll", () => {
    pads.scrollLeft = 0;
    pads.scrollTop = 0;
  });

  new ResizeObserver(() => layout()).observe(pads);
  addEventListener("resize", () => watch.classList.contains("ear-shown") && fitEarScene());

  // MARK: The crown: the volume, or the tuning while it's open; in the list or the hint, it scrolls.

  let levelTimer;
  let crownTurn = 0;

  function showLevel(fill, dot) {
    levelBar.classList.toggle("dot", dot);
    levelFill.style.height = dot ? "" : `${fill * 100}%`;
    levelFill.style.bottom = dot ? `calc(${fill} * (100% - 5px))` : "0";
    levelBar.classList.add("shown");
    clearTimeout(levelTimer);
    levelTimer = setTimeout(() => levelBar.classList.remove("shown"), 1500);
  }

  function setLevel(value) {
    level = Math.min(Math.max(Math.round(value * 20) / 20, 0.05), 1);
    store("level", level);
    synth?.port.postMessage({ gain: synthGain() });
    showLevel(level, false);
    describeInstrument();
    describeCrown();
  }

  function turnCrown(steps) {
    if (!steps) return;
    crownTurn += steps;
    crown.style.backgroundPositionY = `${crownTurn * -2}px, 0`;
    if (!hint.hidden) {
      hint.scrollTop -= steps * 24;
    } else if (sheet.classList.contains("dial-open")) {
      setPitch(Math.min(Math.max(concertPitch + steps, PITCH_RANGE[0]), PITCH_RANGE[1]));
    } else if (sheet.classList.contains("open")) {
      sheetList.scrollTop -= steps * 24;
    } else {
      const before = level;
      setLevel(level + steps * 0.05);
      if (level !== before) haptic(4);
    }
  }

  function describeCrown() {
    const tuning = sheet.classList.contains("dial-open");
    crown.setAttribute("aria-label", tuning ? t.tuning : t.volume);
    crown.setAttribute("aria-valuemin", tuning ? PITCH_RANGE[0] : 5);
    crown.setAttribute("aria-valuemax", tuning ? PITCH_RANGE[1] : 100);
    crown.setAttribute("aria-valuenow", tuning ? concertPitch : Math.round(level * 100));
    crown.setAttribute("aria-valuetext", tuning ? format(t.hz, { n: concertPitch }) : `${volumePercent()}%`);
  }

  let wheelRest = 0;
  // Whether the wheel's deltaY is the finger's way, as with the Mac's natural scrolling. Safari says so; elsewhere,
  // natural on a Mac, where it's the default, and the classic way on other systems.
  const naturalScrolling = /Mac/.test(navigator.platform);

  crown.addEventListener("wheel", (event) => {
    event.preventDefault();
    // The list and the hint scroll as the page would under the same wheel.
    const scroller = !hint.hidden ? hint : sheet.classList.contains("open") && !sheet.classList.contains("dial-open") ? sheetList : null;
    if (scroller) {
      scroller.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      return;
    }
    // Turned up, as the finger or the wheel moves up, the crown goes up.
    const natural = event.webkitDirectionInvertedFromDevice ?? naturalScrolling;
    const up = natural ? event.deltaY : -event.deltaY;
    if (event.deltaMode === 1) {
      turnCrown(Math.sign(up));
      return;
    }
    // About one detent per notch of a mouse wheel, or per 40 px of a trackpad.
    wheelRest += up;
    const steps = Math.trunc(wheelRest / 40);
    wheelRest -= steps * 40;
    turnCrown(steps);
  }, { passive: false });

  // Dragged up or down, a detent every 8 px.
  let crownDrag = null;
  crown.addEventListener("pointerdown", (event) => {
    crownDrag = { id: event.pointerId, y: event.clientY };
    crown.setPointerCapture(event.pointerId);
  });
  crown.addEventListener("pointermove", (event) => {
    if (!crownDrag || event.pointerId !== crownDrag.id) return;
    const steps = Math.trunc((crownDrag.y - event.clientY) / 8);
    crownDrag.y -= steps * 8;
    turnCrown(steps);
  });
  const endCrownDrag = () => (crownDrag = null);
  crown.addEventListener("pointerup", endCrownDrag);
  crown.addEventListener("pointercancel", endCrownDrag);

  function sliderKeys(event, turn) {
    const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 4, PageDown: -4 }[event.key];
    if (steps === undefined) return;
    event.preventDefault();
    turn(steps);
  }
  crown.addEventListener("keydown", (event) => sliderKeys(event, turnCrown));
  dialValue.addEventListener("keydown", (event) => sliderKeys(event, turnCrown));

  // MARK: The instrument by the clock, the list of instruments, and the tuning.

  function describeInstrument() {
    const current = instruments.find((i) => i.id === instrument);
    const standard = concertPitch === STANDARD_PITCH;
    instrumentButton.innerHTML = icon(current.id) + (standard
      ? `<span>${current.name}</span>`
      : `<span class="tuned">${format(t.hz, { n: concertPitch })}</span>`);
    const value = standard ? `${volumePercent()}%` : format(t.volumeAndPitch, { 1: volumePercent(), 2: concertPitch });
    instrumentButton.setAttribute("aria-label", `${format(t.instrumentLabel, { name: current.name })}, ${value}`);
  }

  function describeSheet() {
    for (const row of sheet.querySelectorAll("[data-instrument]")) {
      const selected = row.dataset.instrument === instrument;
      row.querySelector(".check").style.visibility = selected ? "" : "hidden";
      row.setAttribute("aria-pressed", selected);
    }
    const end = sheet.querySelector('[data-action="tuning"] .end');
    end.textContent = format(t.hz, { n: concertPitch });
    end.classList.toggle("tuned", concertPitch !== STANDARD_PITCH);
  }

  /** What the pitch is known for, or how far it is from 440 Hz in cents. */
  function pitchCaption() {
    const known = { 415: t.pitchBaroque, 430: t.pitchClassical, 440: t.pitchStandard, 442: t.pitchOrchestra, 443: t.pitchOrchestra };
    if (known[concertPitch]) return known[concertPitch];
    const cents = Math.round(1200 * Math.log2(concertPitch / STANDARD_PITCH));
    return format(t.centsFrom440, { 1: cents > 0 ? "+" : "−", 2: Math.abs(cents) });
  }

  function describeDial() {
    dialValue.querySelector(".hz").innerHTML = `${concertPitch}<small>Hz</small>`;
    dialValue.querySelector(".caption").textContent = `${names[CONCERT_A % 12]} · ${pitchCaption()}`;
    dialValue.setAttribute("aria-valuenow", concertPitch);
    dialValue.setAttribute("aria-valuetext", format(t.hz, { n: concertPitch }));
    resetButton.hidden = concertPitch === STANDARD_PITCH;
  }

  function setPitch(value) {
    if (value === concertPitch) return;
    concertPitch = value;
    store("concertPitch", value);
    haptic(4);
    showLevel((value - PITCH_RANGE[0]) / (PITCH_RANGE[1] - PITCH_RANGE[0]), true);
    describeInstrument();
    describeSheet();
    describeDial();
    describeCrown();
  }

  /** The pads take no taps or focus while something covers them. */
  function setInert(inert) {
    pads.inert = inert;
    status.inert = inert;
  }

  function openSheet() {
    disarm();
    describeSheet();
    sheet.classList.add("open");
    setInert(true);
    sheet.querySelector(`[data-instrument="${instrument}"]`).focus({ preventScroll: true });
  }

  function closeSheet() {
    sheet.classList.remove("open", "dial-open");
    setInert(false);
    describeCrown();
    instrumentButton.focus({ preventScroll: true });
  }

  function openDial() {
    describeDial();
    sheet.classList.add("dial-open");
    describeCrown();
    dialValue.focus({ preventScroll: true });
  }

  function closeDial() {
    sheet.classList.remove("dial-open");
    describeCrown();
    sheet.querySelector('[data-action="tuning"]').focus({ preventScroll: true });
  }

  instrumentButton.addEventListener("click", openSheet);

  sheet.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.instrument) {
      instrument = button.dataset.instrument;
      store("instrument", instrument);
      describeInstrument();
      closeSheet();
      return;
    }
    switch (button.dataset.action) {
      case "close": closeSheet(); break;
      case "tuning": openDial(); break;
      case "back": closeDial(); break;
      case "reset":
        setPitch(STANDARD_PITCH);
        dialValue.focus({ preventScroll: true });
        break;
      case "fork":
        haptic(8);
        noteOn(CONCERT_A);
        scheduleIdle();
        break;
    }
  });

  watch.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!hint.hidden) closeHint();
    else if (sheet.classList.contains("dial-open")) closeDial();
    else if (sheet.classList.contains("open")) closeSheet();
    else if (armed !== null) cancelHold();
    else return;
    event.preventDefault();
  });

  // Leaving the page lets go of a held note, as the screen dimming does on the watch.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) disarm();
  });

  setFocusable(60);
  describeInstrument();
  describeCrown();
  layout();
  layoutPull();
})();
