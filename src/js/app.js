/* =============================================================================
 * app.js — themes, controls, and the link/redirect plumbing.
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ===========================================================================
   * MAKE IT YOURS
   *
   * Everything that names the site lives here. Change these strings and the
   * wordmark, the browser tab, every prompt and the saved filename follow —
   * nothing else in the codebase hard-codes a name. The mark itself is the
   * inline <svg> inside the .brand link in index.html; swap that for your own
   * and the design is fully yours.
   * ======================================================================== */
  const BRAND = {
    name: 'Yozakura',
    title: 'Yozakura',
    /* Where the wordmark links back to. */
    home: 'https://nextlvl.win',
    /* What the pill under the scene says in each state. */
    prompts: {
      grown: 'Tap the tree to raise the code',
      revealing: 'Falling…',
      revealed: 'Tap again to let it grow',
      regrowing: 'Growing…'
    },
    downloadName: 'yozakura-qr.png'
  };

  const mix = global.Grove.mixHex;

  /* ------------------------------------------------------------- palettes */
  /* Four seasons. Each owns its sky, its ground, its foliage and the weather
   * falling through it. The identifier stays `sky` throughout the code because
   * that is what a preset really is — a sky plus what falls out of it.
   *
   * Foliage is seasonal first: the accent swatch tints it, but only by a third,
   * so autumn stays autumn whichever colour you pick. The accent owns the bloom,
   * the wildflowers and the UI outright. */
  const SKIES = [
    { id: 'sunny', label: 'Sunny',
      skyTop: '#4aa8e0', skyBottom: '#cfe9f4', sky: '#8ccdec',
      paper: '#ffffff', stage: '#e8f3f9',
      ground: '#e6dfc9', paving: '#ddd4bb', rim: '#bfb495',
      ink: '#1d2118', bark: '#6b5236',
      grass: ['#6fae4e', '#5c9a41', '#82c05f'],
      leaf: ['#7cc24f', '#96d465', '#5da33b', '#a9e07c', '#4a8a30'],
      weather: { kind: 'motes', count: 34 },
      defaultAccent: 4, sun: 0.85, stars: 0, bloom: 0.16, vignette: 0.07 },

    { id: 'fall', label: 'Fall',
      skyTop: '#e09a4c', skyBottom: '#f8e3c2', sky: '#efc389',
      paper: '#ffffff', stage: '#f2e2c8',
      ground: '#e4d2ac', paving: '#d8c69e', rim: '#b8a179',
      ink: '#241a10', bark: '#5f4227',
      grass: ['#b09a53', '#9c8646', '#c2ad66'],
      leaf: ['#e0703a', '#f0954e', '#c44f2c', '#f5b567', '#9c3a22'],
      weather: { kind: 'leaves', count: 46 },
      defaultAccent: 4, sun: 0.45, stars: 0, bloom: 0.30, vignette: 0.15 },

    { id: 'rainy', label: 'Rainy',
      skyTop: '#47555f', skyBottom: '#98a9b4', sky: '#6d7e89',
      paper: '#ffffff', stage: '#8b9aa4',
      ground: '#6f7d84', paving: '#7d8b92', rim: '#55636a',
      ink: '#14191c', bark: '#4a4038',
      grass: ['#4f7a52', '#446b47', '#5d8a5f'],
      leaf: ['#4e8a55', '#5f9c64', '#3f7245', '#74ad78', '#2f5c36'],
      weather: { kind: 'rain', count: 130 },
      defaultAccent: 3, sun: 0.0, stars: 0, bloom: 0.12, vignette: 0.22 },

    { id: 'winter', label: 'Winter',
      skyTop: '#8fabc4', skyBottom: '#e2edf4', sky: '#b4c8d9',
      paper: '#ffffff', stage: '#dde9f1',
      ground: '#d6e0e8', paving: '#e4ecf2', rim: '#b3c2ce',
      ink: '#171c22', bark: '#57493f',
      grass: ['#9fb3bf', '#8ea3b0', '#b4c5cf'],
      /* Snow-laden branches rather than bare ones — every dark module of the
       * code is a leaf, so the tree can never actually shed them all. */
      leaf: ['#eef5fb', '#ffffff', '#cfdeea', '#f7fbfe', '#b9cfe0'],
      weather: { kind: 'snow', count: 96 },
      defaultAccent: 5, sun: 0.25, stars: 0, bloom: 0.22, vignette: 0.10 },

    { id: 'night', label: 'Night',
      skyTop: '#0c0819', skyBottom: '#241243', sky: '#150d2c',
      paper: '#ffffff', stage: '#150d2c',
      ground: '#1a1030', paving: '#221540', rim: '#120b24',
      ink: '#07040f', bark: '#3d2f4f',
      grass: ['#24413c', '#2f5148', '#3b6455'],
      leaf: ['#ff9ec2', '#ffc0d8', '#e87ba8', '#ffd6e6', '#c96690'],
      /* Warm slow drifting specks read as fireflies under a blossom tree. */
      weather: { kind: 'motes', count: 30 },
      defaultAccent: 0, sun: 0, stars: 1.0, bloom: 0.52, vignette: 0.28 }
  ];

  /* Panel chrome, lifted straight from the site's tokens: --bg-alt for the
   * glass, --border for the hairlines, --text / --text-dim for type. Every sky
   * is a night sky, so there is only one set. */
  const CHROME = {
    panel: 'rgba(16, 11, 33, 0.74)',
    panelLine: 'rgba(255, 255, 255, 0.10)',
    text: '#f3ecff',
    textDim: '#b6aad4',
    field: 'rgba(255, 255, 255, 0.05)',
    chip: 'rgba(255, 255, 255, 0.045)',
    chipOn: 'rgba(255, 255, 255, 0.12)',
    tool: 'rgba(16, 11, 33, 0.62)'
  };

  /* The site's own accents: --pink, its hover rose, --violet, --cyan, --gold. */
  const ACCENTS = [
    { id: 'sakura', label: 'Sakura', hex: '#ff8fb1' },
    { id: 'rose',   label: 'Rose',   hex: '#ff5c8a' },
    { id: 'violet', label: 'Violet', hex: '#b39dff' },
    { id: 'cyan',   label: 'Cyan',   hex: '#7fe3f5' },
    { id: 'gold',   label: 'Gold',   hex: '#ffd9a0' },
    { id: 'frost',  label: 'Frost',  hex: '#d9e4ff' }
  ];

  /* How far the chosen accent pulls the seasonal foliage. A third is enough to
   * see your pick in the canopy without turning autumn green. */
  const ACCENT_PULL = 0.24;

  function buildTheme(skyIdx, accentIdx) {
    const s = SKIES[skyIdx] || SKIES[0];
    const a = ACCENTS[accentIdx] || ACCENTS[0];
    return Object.assign({}, s, {
      accent: a.hex,
      leaf: s.leaf.map((c) => mix(c, a.hex, ACCENT_PULL)),
      glow: 'rgba(255,236,190,ALPHA)',
      glowSolid: mix(a.hex, '#ffffff', 0.55)
    });
  }

  /* --------------------------------------------------------- link encoding */
  /* Share links carry `?q=<base64url>` whose plaintext is two digits of style
   * followed by the destination URL — compact, and readable when decoded. */
  function toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(b64) {
    let s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encodeConfig(cfg) {
    const sky = String(cfg.sky % 10);
    const accent = String(cfg.accent % 10);
    return toBase64Url(sky + accent + cfg.url);
  }

  function decodeConfig(q) {
    if (!q) return null;
    try {
      const plain = fromBase64Url(q);
      const sky = parseInt(plain[0], 10);
      const accent = parseInt(plain[1], 10);
      const url = plain.slice(2);
      if (!url) return null;
      return {
        sky: Number.isNaN(sky) ? 0 : Math.min(sky, SKIES.length - 1),
        accent: Number.isNaN(accent) ? 0 : Math.min(accent, ACCENTS.length - 1),
        url: url
      };
    } catch (e) { return null; }
  }

  /* Accept what people actually type: bare domains get https://. */
  function normaliseUrl(raw) {
    let v = String(raw || '').trim();
    if (!v) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
    if (v.startsWith('//')) return 'https:' + v;
    return 'https://' + v.replace(/^\/+/, '');
  }

  /* ------------------------------------------------------------------- app */
  const els = {};
  const state = {
    url: 'https://example.com/',
    sky: 0,
    accent: 1,
    ecl: 'M',
    /* 'direct'  — the QR holds the destination itself; always scannable.
     * 'grove'   — the QR holds a link back to this page, which plays the
     *             animation and then forwards. Lets you re-point the
     *             destination later without reprinting the code. */
    target: 'direct',
    autoRedirect: 0,
    /* Seconds between automatic colour changes; 0 is off. */
    cycle: 0,
    sound: false,
    /* Where scanned codes should land. Defaults to wherever this page is
     * served from, but you can point it at your production host (or a short
     * link that forwards here) while building codes locally. */
    base: ''
  };
  let scene = null;
  let arrivedVia = null;
  let redirectTimer = null;

  /* What is on screen right now. Normally this tracks the chosen style, but
   * while the auto-cycle runs it drifts on its own. Keeping it separate from
   * `state` is what stops a drifting colour from rewriting the encoded payload
   * — in "through this page" mode the style is part of the link, so a cycling
   * garden would otherwise mutate a code somebody has already printed. */
  const view = { sky: 0, accent: 1 };

  function $(sel) { return document.querySelector(sel); }

  function qrPayload() {
    if (state.target === 'grove') return shareLink();
    return normaliseUrl(state.url);
  }

  function defaultBase() { return location.origin + location.pathname; }

  function shareLink() {
    const base = (state.base || defaultBase()).replace(/[?#].*$/, '');
    const q = encodeConfig({ sky: state.sky, accent: state.accent, url: normaliseUrl(state.url) });
    const extra = state.autoRedirect > 0 ? '&go=' + state.autoRedirect : '';
    return base + '?q=' + q + extra;
  }

  function rebuildQr() {
    const payload = qrPayload();
    let qr;
    try {
      qr = global.QR.encode(payload, { ecl: state.ecl, boostEcl: state.ecl === 'M' });
    } catch (e) {
      setStatus('That URL is too long to encode — try shortening it.', true);
      return;
    }
    setStatus('Version ' + qr.version + ' · ' + qr.ecl + ' · ' + qr.size + '×' + qr.size + ' modules');
    scene.setMatrix(qr);
    els.share.value = shareLink();
    updateHistory();
  }

  function applyTheme(animate) {
    const skyDef = SKIES[view.sky] || SKIES[0];
    const theme = buildTheme(view.sky, view.accent);
    scene.setTheme(theme, animate);

    const root = document.documentElement.style;
    root.setProperty('--sky', theme.skyBottom);
    root.setProperty('--sky-top', theme.skyTop);
    root.setProperty('--accent', theme.accent);
    root.setProperty('--ink', '#0d0820');
    root.setProperty('--rim', theme.rim);
    root.setProperty('--panel', CHROME.panel);
    root.setProperty('--panel-line', CHROME.panelLine);
    root.setProperty('--text', CHROME.text);
    root.setProperty('--text-dim', CHROME.textDim);
    root.setProperty('--field', CHROME.field);
    root.setProperty('--chip', CHROME.chip);
    root.setProperty('--chip-on', CHROME.chipOn);
    root.setProperty('--tool', CHROME.tool);
    document.body.dataset.sky = skyDef.id;

    els.skies.forEach((b, i) => b.setAttribute('aria-pressed', String(i === view.sky)));
    els.accents.forEach((b, i) => b.setAttribute('aria-pressed', String(i === view.accent)));
  }

  /* ---------------------------------------------------------- auto-cycle */
  /* Walks the foliage colours, and moves the sky on each full lap, so the scene
   * drifts from midnight round to sunset if left alone. */
  let cycleTimer = null;

  function stopCycle() {
    clearTimeout(cycleTimer);
    cycleTimer = null;
  }

  function scheduleCycle() {
    stopCycle();
    if (!state.cycle) return;
    cycleTimer = setTimeout(() => {
      const nextAccent = (view.accent + 1) % ACCENTS.length;
      if (nextAccent === 0) view.sky = (view.sky + 1) % SKIES.length;
      view.accent = nextAccent;
      applyTheme(true);          // display only — the code is left alone
      scheduleCycle();
    }, state.cycle * 1000);
  }

  function setCycle(seconds) {
    const wasOn = state.cycle > 0;
    state.cycle = seconds;
    els.cycle.value = String(seconds);
    document.querySelector('#cycle-toggle').setAttribute('aria-pressed', String(seconds > 0));
    try { localStorage.setItem('grove.cycle', String(seconds)); } catch (e) { /* private mode */ }

    /* Stopping adopts whatever is on screen — "stop here" is what the button
     * looks like it does, so the encoded style should follow the eye. */
    if (wasOn && seconds === 0 &&
        (state.sky !== view.sky || state.accent !== view.accent)) {
      state.sky = view.sky;
      state.accent = view.accent;
      els.share.value = shareLink();
      updateHistory();
      if (state.target === 'grove') rebuildQr();
    }
    scheduleCycle();
  }

  function setStatus(msg, isError) {
    els.status.textContent = msg;
    els.status.classList.toggle('is-error', !!isError);
  }

  /* The editing session keeps its state in the hash so a reload restores the
   * work in progress. Arrivals from a scanned code carry `?q=` instead, which
   * is what switches the page into visitor mode — otherwise refreshing while
   * building a code would look identical to someone scanning it. */
  function updateHistory() {
    const q = encodeConfig({ sky: state.sky, accent: state.accent, url: normaliseUrl(state.url) });
    const extra = state.autoRedirect > 0 ? '&go=' + state.autoRedirect : '';
    try {
      history.replaceState(null, '', location.pathname + location.search + '#q=' + q + extra);
    } catch (e) {
      /* Sandboxed frames refuse history writes; session restore is a bonus,
       * not something worth breaking the encoder over. */
    }
  }

  /* --------------------------------------------------------------- reveal */
  function onStateChange(s) {
    els.hint.textContent = BRAND.prompts[s] || BRAND.prompts.grown;
    els.stage.dataset.state = s;
    if ((s === 'regrowing' || s === 'grown') && scene && scene.scanView) scene.setScanView(false);

    if (s === 'revealed') {
      if (global.GroveAudio && state.sound) global.GroveAudio.chime();
      /* Anyone who got here by scanning needs a way onward, whether or not
       * the countdown is switched on. */
      if (arrivedVia) showContinue();
    }
    if (s !== 'revealed' && redirectTimer) cancelRedirect();
    if (s === 'revealing' && global.GroveAudio && state.sound) global.GroveAudio.gust();
  }

  function showContinue() {
    if (!arrivedVia) return;
    let host = arrivedVia.url;
    try { host = new URL(normaliseUrl(arrivedVia.url)).host || arrivedVia.url; } catch (e) { /* keep raw */ }
    els.go.querySelector('.go-host').textContent = host;
    els.go.hidden = false;

    const count = els.go.querySelector('.go-count');
    if (state.autoRedirect <= 0) { count.textContent = ''; return; }

    let left = state.autoRedirect;
    const tick = () => {
      count.textContent = ' · ' + left + 's';
      if (left <= 0) { location.href = normaliseUrl(arrivedVia.url); return; }
      left--;
      redirectTimer = setTimeout(tick, 1000);
    };
    tick();
  }

  /* The overhead view is what a phone can read; the plaza view is what the
   * scene is for. Asking for one while the tree is still up reveals it first,
   * so the button always does something sensible. */
  function onScanChange(on) {
    const btn = $('#scan');
    if (btn) btn.setAttribute('aria-pressed', String(!!on));
    if (els.stage) els.stage.dataset.scan = on ? 'true' : 'false';
  }

  function toggleScan() {
    const want = !scene.scanView;
    if (want && scene.state !== 'revealed' && scene.state !== 'revealing') scene.reveal();
    scene.setScanView(want);
  }

  function cancelRedirect() {
    clearTimeout(redirectTimer);
    redirectTimer = null;
    const count = els.go && els.go.querySelector('.go-count');
    if (count) count.textContent = '';
  }

  /* ------------------------------------------------------------ flat export */
  /* A plain, high-contrast rendering with a proper quiet zone — this is the
   * one to print, never a screenshot of the isometric scene. */
  function renderFlat(scale, quiet) {
    const qr = scene.qr;
    const q = quiet === undefined ? 4 : quiet;
    const dim = (qr.size + q * 2) * scale;
    const c = document.createElement('canvas');
    c.width = c.height = dim;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, dim, dim);
    g.fillStyle = '#000000';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.get(x, y)) g.fillRect((x + q) * scale, (y + q) * scale, scale, scale);
      }
    }
    return c;
  }

  function openPoster() {
    const canvas = renderFlat(Math.max(6, Math.ceil(1400 / (scene.qr.size + 8))), 4);
    els.posterImg.src = canvas.toDataURL('image/png');
    els.posterCaption.textContent = qrPayload();
    const note = $('#poster-note');
    if (note) note.textContent = 'Or press and hold the image (right-click on desktop) to save it.';
    els.poster.hidden = false;
    els.poster.querySelector('.poster-close').focus();
    els.posterDownload.onclick = () => savePng(canvas);
  }

  /* Two ways to hand over the PNG. A page published as a Claude Artifact runs
   * sandboxed, where an <a download> does nothing, so it saves through the
   * host's own confirmation flow; anywhere else the ordinary object-URL link is
   * what works. Feature-detected, so one build covers both. */
  async function savePng(canvas) {
    const button = els.posterDownload;
    const note = $('#poster-note');
    const say = (msg) => { if (note) note.textContent = msg; };
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) { say('Could not render the image.'); return; }

    const host = global.claude;
    const downloads = host && typeof host.use === 'function' ? await host.use('downloads') : null;

    if (downloads) {
      button.disabled = true;
      try {
        await downloads.save({ filename: BRAND.downloadName, data: blob });
        say('Saved.');
      } catch (err) {
        say(err && err.code === 'declined'
          ? 'Save cancelled.'
          : 'Could not save here — press and hold the image instead.');
      } finally {
        button.disabled = false;
      }
      return;
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = BRAND.downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (e2) { /* nothing more to try */ }
      t.remove();
    }
    const old = button.dataset.label || button.textContent;
    button.dataset.label = old;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = button.dataset.label; }, 1400);
  }

  /* ------------------------------------------------------------------ boot */
  function init() {
    document.title = BRAND.title;
    const brand = document.querySelector('.brand');
    const wordmark = brand && brand.querySelector('span');
    if (wordmark) wordmark.textContent = BRAND.name;
    if (brand && BRAND.home) brand.href = BRAND.home;

    els.canvas = $('#stage-canvas');
    els.stage = $('#stage');
    els.hint = $('#hint');
    els.url = $('#url');
    els.status = $('#status');
    els.share = $('#share-link');
    els.go = $('#go');
    els.poster = $('#poster');
    els.posterImg = $('#poster-img');
    els.posterCaption = $('#poster-caption');
    els.posterDownload = $('#poster-download');
    /* Scoped to buttons: <body> also carries data-sky as a styling hook, and
     * an unscoped selector picks it up and shifts every index by one. */
    els.skies = Array.from(document.querySelectorAll('button[data-sky]'));
    els.accents = Array.from(document.querySelectorAll('button[data-accent]'));

    scene = new global.Grove.Scene(els.canvas, { onStateChange, onScanChange });

    /* `?q=` means a visitor scanned a code; `#q=` is our own session restore. */
    const params = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    const scanned = params.get('q');
    const cfg = decodeConfig(scanned || hashParams.get('q') || '');
    if (cfg) {
      state.url = cfg.url;
      state.sky = cfg.sky;
      state.accent = cfg.accent;
      if (scanned) arrivedVia = cfg;
      const go = parseInt((scanned ? params : hashParams).get('go') || '0', 10);
      state.autoRedirect = Number.isNaN(go) ? 0 : Math.min(Math.max(go, 0), 60);
    }

    try { state.base = localStorage.getItem('grove.base') || ''; } catch (e) { state.base = ''; }

    els.url.value = state.url;
    els.autoRedirect = $('#auto-redirect');
    els.autoRedirect.value = String(state.autoRedirect);
    els.base = $('#link-base');
    els.base.value = state.base;
    els.base.placeholder = defaultBase();
    els.cycle = $('#cycle');

    let savedCycle = 0;
    try { savedCycle = parseInt(localStorage.getItem('grove.cycle') || '0', 10) || 0; } catch (e) { savedCycle = 0; }

    /* Without a shared link to honour, start on the season's own accent —
     * otherwise the default swatch drags the seasonal foliage off-hue and a
     * summer tree comes up olive. */
    if (!cfg) {
      const def = SKIES[state.sky] && SKIES[state.sky].defaultAccent;
      if (def !== undefined) state.accent = def;
    }
    view.sky = state.sky;
    view.accent = state.accent;
    applyTheme(false);
    rebuildQr();
    setCycle(scene.reducedMotion ? 0 : savedCycle);

    /* --- controls --- */
    let debounce;
    els.url.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.url = els.url.value;
        rebuildQr();
      }, 260);
    });
    els.url.addEventListener('change', () => {
      els.url.value = normaliseUrl(els.url.value);
      state.url = els.url.value;
      rebuildQr();
    });

    const pickTheme = (fn) => () => {
      fn();
      applyTheme(true);
      updateHistory();
      els.share.value = shareLink();
      if (state.target === 'grove') rebuildQr();
      scheduleCycle();          // a manual pick restarts the clock
    };
    els.skies.forEach((b, i) => b.addEventListener('click', pickTheme(() => {
      state.sky = view.sky = i;
      /* A season arrives with its own accent, so "Fall" looks like autumn the
       * moment you tap it; the swatches still override afterwards. */
      const def = SKIES[i] && SKIES[i].defaultAccent;
      if (def !== undefined) state.accent = view.accent = def;
    })));
    els.accents.forEach((b, i) => b.addEventListener('click', pickTheme(() => { state.accent = view.accent = i; })));

    els.cycle.addEventListener('change', (e) => setCycle(parseInt(e.target.value, 10) || 0));
    $('#cycle-toggle').addEventListener('click', () => {
      setCycle(state.cycle > 0 ? 0 : 8);
    });

    $('#reveal').addEventListener('click', () => scene.toggle());
    $('#scan').addEventListener('click', toggleScan);
    $('#poster-open').addEventListener('click', openPoster);
    $('#copy-share').addEventListener('click', (e) => copy(shareLink(), e.currentTarget));
    els.poster.querySelector('.poster-close').addEventListener('click', () => { els.poster.hidden = true; });
    els.poster.addEventListener('click', (e) => { if (e.target === els.poster) els.poster.hidden = true; });

    $('#target').addEventListener('change', (e) => {
      state.target = e.target.value;
      rebuildQr();
    });
    $('#ecl').addEventListener('change', (e) => {
      state.ecl = e.target.value;
      rebuildQr();
    });
    els.autoRedirect.addEventListener('change', (e) => {
      state.autoRedirect = parseInt(e.target.value, 10) || 0;
      els.share.value = shareLink();
      updateHistory();
      if (state.target === 'grove') rebuildQr();
    });

    els.base.addEventListener('change', (e) => {
      state.base = e.target.value.trim();
      try { localStorage.setItem('grove.base', state.base); } catch (err) { /* private mode */ }
      els.share.value = shareLink();
      if (state.target === 'grove') rebuildQr();
    });

    $('#sound').addEventListener('click', (e) => {
      state.sound = !state.sound;
      e.currentTarget.setAttribute('aria-pressed', String(state.sound));
      if (state.sound && global.GroveAudio) global.GroveAudio.enable();
      else if (global.GroveAudio) global.GroveAudio.disable();
    });

    $('#go-now').addEventListener('click', () => {
      if (arrivedVia) location.href = normaliseUrl(arrivedVia.url);
    });
    $('#go-cancel').addEventListener('click', () => {
      cancelRedirect();
      els.go.hidden = true;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { els.poster.hidden = true; cancelRedirect(); els.go.hidden = true; }
    });

    /* Landing straight from a scanned code should show the payoff, not the
     * puzzle — the visitor already scanned it, they want to arrive. */
    if (arrivedVia) {
      els.stage.dataset.arrived = 'true';
      setTimeout(() => scene.reveal(), 700);
    }

    let resizeRaf;
    global.addEventListener('resize', () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => scene.resize());
    });
    scene.start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.GroveApp = { BRAND, encodeConfig, decodeConfig, normaliseUrl, SKIES, ACCENTS, buildTheme,
    get state() { return state; }, get scene() { return scene; }, renderFlat };
})(window);
