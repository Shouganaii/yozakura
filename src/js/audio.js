/* =============================================================================
 * audio.js — a few bars of synthesised ambience. No audio files, no network.
 * Everything stays silent until the visitor explicitly turns sound on, which
 * also satisfies browsers' autoplay rules.
 * ========================================================================== */
(function (global) {
  'use strict';

  let ctx = null;
  let windGain = null;
  let enabled = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    /* Wind is pink-ish noise through a slowly wandering band-pass. */
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.7;

    /* A slow LFO on the filter keeps the breeze from sounding like static. */
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(filter.frequency);

    windGain = ctx.createGain();
    windGain.gain.value = 0;

    src.connect(filter).connect(windGain).connect(ctx.destination);
    src.start();
    lfo.start();
    return ctx;
  }

  function enable() {
    if (!ensure()) return;
    enabled = true;
    if (ctx.state === 'suspended') ctx.resume();
    windGain.gain.cancelScheduledValues(ctx.currentTime);
    windGain.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 1.2);
  }

  function disable() {
    enabled = false;
    if (!ctx) return;
    windGain.gain.cancelScheduledValues(ctx.currentTime);
    windGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
  }

  /* A swell of wind under the leaf flight. */
  function gust() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    windGain.gain.cancelScheduledValues(t);
    windGain.gain.setValueAtTime(windGain.gain.value, t);
    windGain.gain.linearRampToValueAtTime(0.16, t + 0.5);
    windGain.gain.linearRampToValueAtTime(0.045, t + 2.6);
  }

  /* A short pentatonic sparkle when the code locks in. */
  function chime() {
    if (!enabled || !ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.075;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.2);
    });
  }

  global.GroveAudio = { enable, disable, gust, chime };
})(window);
