/* =============================================================================
 * moon.js — 月と桜. A branch, a moon, and a code written in fallen blossom.
 *
 * A low moon fills the frame. A cherry branch crosses it in silhouette, and the
 * code lies latent in the moon's maria — the dark patches on its face — just
 * legible if you look. Tap it and the blossom lifts off the branch, spirals
 * across, and settles into those patches until the code is solid; the branch
 * draws back off the frame as it empties, leaving the face clean to scan.
 *
 * Deliberately not the isometric garden. There is no ground plane and no
 * projection here: the moon is a disc, the code is a square inscribed in it,
 * and the branch is drawn in screen space. That makes the code axis-aligned and
 * always square, which is exactly what a scanner wants.
 *
 * Exposes Grove.Scene with the same interface the garden had, so the app layer
 * does not care which scene it is driving.
 * ========================================================================== */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeInCubic = (t) => t * t * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function span(t, from, to) { return clamp((t - from) / (to - from), 0, 1); }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mixHex(a, b, t) {
    const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
    const r = Math.round(lerp((na >> 16) & 255, (nb >> 16) & 255, t));
    const g = Math.round(lerp((na >> 8) & 255, (nb >> 8) & 255, t));
    const bl = Math.round(lerp(na & 255, nb & 255, t));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }

  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amount >= 0) { r += (255 - r) * amount; g += (255 - g) * amount; b += (255 - b) * amount; }
    else { const k = 1 + amount; r *= k; g *= k; b *= k; }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  function rgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha.toFixed(3) + ')';
  }

  function parseRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* Blend two palettes; hex strings and arrays of them interpolate, numbers
   * interpolate, anything else snaps at the halfway point. */
  function mixTheme(a, b, t) {
    if (a === b || t >= 1) return b;
    const out = {};
    for (const key of Object.keys(b)) {
      const av = a[key], bv = b[key];
      if (typeof bv === 'string' && bv.charAt(0) === '#' && typeof av === 'string' && av.charAt(0) === '#') {
        out[key] = mixHex(av, bv, t);
      } else if (Array.isArray(bv) && Array.isArray(av) && av.length === bv.length) {
        out[key] = bv.map((v, i) => (typeof v === 'string' && v.charAt(0) === '#' ? mixHex(av[i], v, t) : v));
      } else if (typeof bv === 'number' && typeof av === 'number') {
        out[key] = av + (bv - av) * t;
      } else {
        out[key] = t < 0.5 && av !== undefined ? av : bv;
      }
    }
    return out;
  }

  /* A five-petal blossom, precomputed as unit points. Broad petals with shallow
   * notches — deep ones read as a star rather than sakura. */
  const BLOSSOM = (() => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const r = (i % 2 === 0) ? 1 : 0.68;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  })();

  /* Phase boundaries as fractions of the reveal, so overlaps are easy to see. */
  const T = {
    revealDuration: 2000,
    regrowDuration: 1500,
    gust:     [0.00, 0.16],   // the branch shivers, blossom begins to let go
    flight:   [0.04, 0.62],   // blossom crosses to the moon and settles
    withdraw: [0.34, 0.70],   // the emptied branch draws back off frame
    ink:      [0.30, 0.88],   // the face brightens, the modules go dark
    lock:     [0.80, 1.00]    // halo swells, a light sweeps the face
  };

  class Scene {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.opts = Object.assign({ onStateChange: null, quietZone: 4 }, opts || {});

      this.qr = null;
      this.theme = null;
      this.blossoms = [];
      this.filler = [];
      this.limbs = [];
      this.petals = [];
      this.stars = [];

      this.state = 'grown';
      this.progress = 0;
      this.time = 0;
      this.lastFrame = 0;
      this.running = false;
      this.reducedMotion = global.matchMedia
        ? global.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

      this.wind = 0;
      this.drift = { x: 0, y: 0, tx: 0, ty: 0 };
      this._fadeCache = new Map();

      this._buildStars();
      this._buildPetals();
      this._bind();

      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(canvas);
      }
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.stop();
        else if (!this.reducedMotion) this.start();
      });

      this.resize();
    }

    /* ------------------------------------------------------------- geometry */
    /* The moon, and the square of code inscribed in its face. The square's
     * corners have to stay inside the disc or the quiet zone spills onto the
     * night sky and stops being a quiet zone — hence 1.28r rather than the
     * 1.41r that would touch the limb exactly. */
    _moon() {
      const r = Math.min(this.vw * 0.46, this.vh * 0.36);
      const cx = this.vw / 2 + this.drift.x * 0.35;
      const cy = this.vh * 0.44 + this.drift.y * 0.35;
      const side = r * 1.28;
      const n = this.qr ? this.qr.size : 25;
      const quiet = this.opts.quietZone;
      const module = side / (n + quiet * 2);
      return {
        cx, cy, r, side, module,
        x0: cx - side / 2 + quiet * module,
        y0: cy - side / 2 + quiet * module
      };
    }

    setMatrix(qr) {
      this.qr = qr;
      this.n = qr.size;
      this._allDark = new Uint8Array(this.n * this.n);
      for (let y = 0; y < this.n; y++) {
        for (let x = 0; x < this.n; x++) {
          if (qr.get(x, y)) this._allDark[y * this.n + x] = 1;
        }
      }
      this._buildBranch();
      this._buildBlossoms();
      this._recolour();
      this.time = 0;
      this.progress = this.state === 'revealed' ? 1 : 0;
      if (this.state === 'revealing' || this.state === 'regrowing') this._setState('grown');
      this.draw();
    }

    setTheme(theme, animate) {
      if (animate && this.themeBase && !this.reducedMotion) {
        this._themeFrom = this.theme || this.themeBase;
        this._themeT = 0;
      } else {
        this._themeFrom = theme;
        this._themeT = 1;
      }
      this.themeBase = theme;
      this.theme = this._themeT >= 1 ? theme : mixTheme(this._themeFrom, theme, 0);
      this._texKey = null;
      if (this.qr) this._recolour();
      this.draw();
      if (this._themeT < 1) this.start();
    }

    get themeFading() { return this._themeT !== undefined && this._themeT < 1; }

    /* A branch entering from off frame, in viewport fractions so it survives a
     * resize. Grown recursively, then flattened to segments for drawing. */
    _buildBranch() {
      const rand = mulberry32(hashString('branch:' + this.qr.version + ':' + this.qr.mask));
      const limbs = [];
      const tips = [];

      const grow = (x, y, dx, dy, len, thick, depth) => {
        const ex = x + dx * len, ey = y + dy * len;
        limbs.push({ x1: x, y1: y, x2: ex, y2: ey, thick,
                     thick2: thick * (depth === 0 ? 0.8 : 0.72), depth });
        /* Spread is how far blossom scatters from a node, and it has to stay
         * small. At a fraction of the branch length it threw blossom across a
         * quarter of the viewport and the canopy detached from the bough. */
        if (depth >= 3 || len < 0.05) { tips.push({ x: ex, y: ey, spread: 0.028 }); return; }
        tips.push({ x: ex, y: ey, spread: 0.020 });
        const kids = depth === 0 ? 3 : 2;
        for (let i = 0; i < kids; i++) {
          /* Sub-branches fan forward and downward — the shape of a bough seen
           * from below, rather than a bush. */
          const turn = (rand() - 0.45) * 1.1;
          const nx = dx * Math.cos(turn) - dy * Math.sin(turn);
          const ny = dx * Math.sin(turn) + dy * Math.cos(turn) + 0.16;
          const m = Math.hypot(nx, ny) || 1;
          grow(ex, ey, nx / m, ny / m, len * (0.62 + rand() * 0.16), thick * 0.68, depth + 1);
        }
      };

      /* In from the top-left, arcing across the upper face of the moon. */
      this.entry = { x: -0.18, y: 0.04, dx: 0.9, dy: 0.34 };
      grow(this.entry.x, this.entry.y, this.entry.dx, this.entry.dy, 0.4, 0.055, 0);

      this.limbs = limbs;
      this.tips = tips;
    }

    /* One blossom per dark module, plus blossom that carries no data so the
     * branch looks laden rather than counted out. */
    _buildBlossoms() {
      const qr = this.qr, n = this.n;
      const rand = mulberry32(hashString('bloom:' + qr.version + ':' + qr.mask + ':' + n));

      const targets = [];
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (qr.get(x, y)) targets.push({ x, y, role: global.QR.moduleRole(qr, x, y) });
        }
      }

      /* Blossom sites run the length of every limb, not just its end. Hanging
       * it all off the nodes gives a row of discrete pom-poms; spreading it
       * along the wood is what makes a bough look laden. */
      const sites = [];
      for (const L of this.limbs) {
        if (L.depth < 1) continue;
        const len = Math.hypot(L.x2 - L.x1, L.y2 - L.y1);
        const count = Math.max(3, Math.round(len * 70));
        for (let i = 0; i < count; i++) {
          const u = 0.1 + rand() * 0.9;
          sites.push({
            x: lerp(L.x1, L.x2, u),
            y: lerp(L.y1, L.y2, u),
            spread: 0.012 + L.depth * 0.006
          });
        }
      }
      const site = (i) => sites[(i * 7 + 3) % sites.length];
      const home = (s) => {
        const a = rand() * TAU, rr = s.spread * Math.pow(rand(), 0.55);
        /* Flattened and biased downward — blossom hangs off a bough. */
        return { hx: s.x + Math.cos(a) * rr, hy: s.y + Math.sin(a) * rr * 0.62 + rr * 0.35 };
      };

      this.blossoms = targets.map((t, i) => {
        const s = site(i);
        const h = home(s);
        /* Finder patterns settle first — they are what a scanner hunts for, and
         * watching the three corners arrive first reads as intent. */
        const priority = clamp(
          t.role === 'finder' ? 0.02 :
          t.role === 'timing' ? 0.16 :
          0.28 + rand() * 0.62, 0, 1);
        const dur = 0.3 + rand() * 0.16;
        return {
          hx: h.hx, hy: h.hy,
          tx: t.x, ty: t.y, role: t.role,
          dur, delay: priority * (1 - dur), land: priority * (1 - dur) + dur,
          arc: (rand() - 0.5) * 0.5,
          size: 1.0 + rand() * 0.55,
          spin: rand() * TAU, spinRate: (rand() - 0.5) * 5,
          flutter: rand() * TAU,
          tone: rand()
        };
      });

      const extra = Math.round(clamp(2000 - targets.length, 700, 1700));
      this.filler = Array.from({ length: extra }, (_, i) => {
        const s = site(i * 3 + 1);
        const h = home(s);
        const away = Math.atan2(h.hy - this.entry.y, h.hx - this.entry.x) + (rand() - 0.5) * 1.2;
        return {
          hx: h.hx, hy: h.hy,
          dx: Math.cos(away) * (0.4 + rand() * 0.8),
          dy: Math.sin(away) * (0.3 + rand() * 0.7) + 0.35,
          delay: rand() * 0.5,
          size: 0.85 + rand() * 0.55,
          spin: rand() * TAU, spinRate: (rand() - 0.5) * 8,
          flutter: rand() * TAU,
          tone: rand()
        };
      });
    }

    _buildStars() {
      const rand = mulberry32(0x5741a2);
      this.stars = Array.from({ length: 150 }, () => ({
        x: rand(), y: rand(),
        r: 0.4 + Math.pow(rand(), 2.4) * 1.8,
        base: 0.25 + rand() * 0.75,
        rate: 0.3 + rand() * 1.1,
        phase: rand() * TAU
      }));
    }

    _buildPetals() {
      const rand = mulberry32(0x5eed1eaf);
      const make = (count, near) => Array.from({ length: count }, () => ({
        x: rand(), y: rand(),
        depth: near ? 0.5 + rand() * 0.5 : rand() * 0.45,
        fall: 0.02 + rand() * 0.035,
        swayAmp: 0.014 + rand() * 0.03,
        swayFreq: 0.5 + rand() * 0.9,
        swayPhase: rand() * TAU,
        spin: rand() * TAU, spinRate: (rand() - 0.5) * 1.6,
        flip: rand() * TAU, flipRate: 0.9 + rand() * 1.8,
        tone: rand()
      }));
      this.petalsBack = make(22, false);
      this.petalsFront = make(26, true);
    }

    _recolour() {
      if (!this.theme) return;
      const pal = this.theme.leaf;
      this._fadeCache.clear();
      const paint = (list) => {
        for (const b of list) {
          b.colourIdx = Math.floor(b.tone * pal.length) % pal.length;
          b.colour = pal[b.colourIdx];
        }
      };
      paint(this.blossoms);
      paint(this.filler);
      paint(this.petalsBack);
      paint(this.petalsFront);
    }

    /* -------------------------------------------------------------- control */
    _setState(s) {
      if (this.state === s) return;
      this.state = s;
      if (this.opts.onStateChange) this.opts.onStateChange(s);
    }

    toggle() { (this.state === 'revealed' || this.state === 'revealing') ? this.conceal() : this.reveal(); }

    reveal() {
      if (this.state === 'revealed' || this.state === 'revealing') return;
      if (this.reducedMotion) { this.progress = 1; this._setState('revealed'); this.draw(); return; }
      this.time = this.progress * T.revealDuration;
      this._setState('revealing');
      this.start();
    }

    conceal() {
      if (this.state === 'grown' || this.state === 'regrowing') return;
      if (this.reducedMotion) { this.progress = 0; this._setState('grown'); this.draw(); return; }
      this.time = (1 - this.progress) * T.regrowDuration;
      this._setState('regrowing');
      this.start();
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.lastFrame = performance.now();
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(64, now - this.lastFrame);
        this.lastFrame = now;
        this.update(dt);
        this.draw();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    stop() { this.running = false; }

    update(dt) {
      if (this.state === 'revealing') {
        this.time += dt;
        const p = clamp(this.time / T.revealDuration, 0, 1);
        this.progress = p;
        if (p >= 1) { this.progress = 1; this._setState('revealed'); }
      } else if (this.state === 'regrowing') {
        this.time += dt;
        const p = clamp(this.time / T.regrowDuration, 0, 1);
        this.progress = 1 - p;
        if (p >= 1) { this.progress = 0; this._setState('grown'); }
      }

      if (this._themeT !== undefined && this._themeT < 1) {
        this._themeT = clamp(this._themeT + dt / 900, 0, 1);
        this.theme = mixTheme(this._themeFrom, this.themeBase, smoothstep(this._themeT));
        this._texKey = null;
        this._recolour();
      }

      const t = performance.now() / 1000;
      const gust = span(this.progress, T.gust[0], T.gust[1]) * (1 - span(this.progress, 0.5, 0.8));
      this.wind = 0.35 + Math.sin(t * 0.7) * 0.3 + gust * 2.2;

      this.drift.x = lerp(this.drift.x, this.drift.tx, 1 - Math.pow(0.004, dt / 1000));
      this.drift.y = lerp(this.drift.y, this.drift.ty, 1 - Math.pow(0.004, dt / 1000));

      if (!this.reducedMotion) {
        const secs = dt / 1000;
        for (const list of [this.petalsBack, this.petalsFront]) {
          for (const q of list) {
            const k = 0.45 + q.depth;
            q.y += q.fall * k * secs;
            q.x += (this.wind * 0.05 * k + Math.sin(t * q.swayFreq + q.swayPhase) * q.swayAmp) * secs;
            q.spin += q.spinRate * secs;
            q.flip += q.flipRate * secs;
            if (q.y > 1.15) { q.y = -0.15; q.x = Math.random() * 1.2 - 0.1; }
            if (q.x > 1.2) q.x -= 1.4;
            if (q.x < -0.2) q.x += 1.4;
          }
        }
      }
    }

    /* Where a blossom is, in viewport fractions. */
    _blossomAt(b, p) {
      const flight = span(p, T.flight[0], T.flight[1]);
      const local = clamp((flight - b.delay) / b.dur, 0, 1);
      const m = this._moonCache;
      if (local <= 0) {
        const s = Math.sin(performance.now() / 620 + b.flutter) * this.wind * 0.004;
        return { x: b.hx + s, y: b.hy + s * 0.5, t: 0, landed: false };
      }
      const tx = (m.x0 + (b.tx + 0.5) * m.module) / this.vw;
      const ty = (m.y0 + (b.ty + 0.5) * m.module) / this.vh;
      if (local >= 1) return { x: tx, y: ty, t: 1, landed: true };
      const e = easeInOutCubic(local);
      /* A sideways bow on the path, so the swarm sweeps across rather than
       * converging in a straight line. */
      const bow = Math.sin(local * Math.PI) * b.arc;
      const px = -(ty - b.hy), py = (tx - b.hx);
      const pm = Math.hypot(px, py) || 1;
      return {
        x: lerp(b.hx, tx, e) + (px / pm) * bow,
        y: lerp(b.hy, ty, e) + (py / pm) * bow,
        t: local, landed: false
      };
    }

    _fillerAt(f, p) {
      const blow = span(p, T.gust[0], 0.6);
      const t = clamp((blow - f.delay) / (1 - f.delay || 1), 0, 1);
      if (t <= 0) {
        const s = Math.sin(performance.now() / 640 + f.flutter) * this.wind * 0.004;
        return { x: f.hx + s, y: f.hy + s * 0.5, alpha: 1 };
      }
      const e = easeInCubic(t);
      return { x: f.hx + f.dx * e, y: f.hy + f.dy * e, alpha: 1 - t * t };
    }

    _blossomColour(b, t) {
      if (t <= 0.5) return b.colour;
      const step = Math.min(8, Math.round(easeInCubic((t - 0.5) / 0.5) * 8));
      if (step === 0) return b.colour;
      const key = b.colourIdx * 16 + step;
      let c = this._fadeCache.get(key);
      if (!c) { c = mixHex(b.colour, this.theme.moduleInk, step / 8); this._fadeCache.set(key, c); }
      return c;
    }

    /* The moon's face as a 1px-per-module image: moonlight, the latent maria,
     * and the modules that have been filled in. One drawImage puts it down. */
    _paintFace(faceHex, latentHex, inkHex) {
      const n = this.n;
      if (!this._tex || this._tex.width !== n) {
        this._tex = document.createElement('canvas');
        this._tex.width = this._tex.height = n;
        this._texKey = null;
      }
      const flight = span(this.progress, T.flight[0], T.flight[1]);
      const key = faceHex + latentHex + inkHex + flight.toFixed(3);
      if (this._texKey === key) return;
      this._texKey = key;

      const c = this._tex.getContext('2d');
      const img = c.createImageData(n, n);
      const face = parseRgb(faceHex), latent = parseRgb(latentHex), ink = parseRgb(inkHex);
      const dark = this._allDark;
      for (const b of this.blossoms) {
        b._landed = flight >= b.land;
      }
      const landedAt = new Uint8Array(n * n);
      for (const b of this.blossoms) if (b._landed) landedAt[b.ty * n + b.tx] = 1;

      for (let i = 0; i < n * n; i++) {
        const src = !dark[i] ? face : (landedAt[i] ? ink : latent);
        const o = i * 4;
        img.data[o] = src[0]; img.data[o + 1] = src[1]; img.data[o + 2] = src[2]; img.data[o + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    }

    /* ------------------------------------------------------------------ draw */
    draw() {
      if (!this.qr || !this.theme) return;
      const g = this.ctx, th = this.theme, p = this.progress, d = this.dpr;

      if ((this._sizeCheck = (this._sizeCheck || 0) + 1) % 20 === 0) {
        const box = this.canvas.getBoundingClientRect();
        if (Math.abs(box.width - this.vw) > 1 || Math.abs(box.height - this.vh) > 1) this.resize();
      }

      g.setTransform(d, 0, 0, d, 0, 0);
      const m = this._moonCache = this._moon();
      const inkT = smoothstep(span(p, T.ink[0], T.ink[1]));
      const lock = span(p, T.lock[0], T.lock[1]);
      const withdraw = smoothstep(span(p, T.withdraw[0], T.withdraw[1]));
      const now = performance.now();

      /* ---- night sky ---- */
      const sky = g.createLinearGradient(0, 0, 0, this.vh);
      sky.addColorStop(0, th.skyTop);
      sky.addColorStop(1, th.skyBottom);
      g.fillStyle = sky;
      g.fillRect(0, 0, this.vw, this.vh);

      /* ---- stars, thinning where the moon washes them out ---- */
      if (!this.reducedMotion && th.stars > 0.01) {
        const t = now / 1000;
        g.fillStyle = '#ffffff';
        g.beginPath();
        let any = false;
        for (const s of this.stars) {
          const sx = s.x * this.vw, sy = s.y * this.vh;
          const near = Math.hypot(sx - m.cx, sy - m.cy) / (m.r * 1.9);
          if (near < 1) continue;
          const tw = 0.55 + 0.45 * Math.sin(t * s.rate + s.phase);
          const r = s.r * (0.5 + s.base * tw * th.stars);
          g.moveTo(sx + r, sy);
          g.arc(sx, sy, r, 0, TAU);
          any = true;
        }
        if (any) { g.globalAlpha = 0.9 * th.stars; g.fill(); g.globalAlpha = 1; }
      }

      /* ---- petals behind the moon ---- */
      if (!this.reducedMotion) this._drawPetals(g, this.petalsBack, 0.4);

      /* ---- halo ---- */
      const halo = (th.halo || 0.4) * (1 + lock * 0.9);
      const hg = g.createRadialGradient(m.cx, m.cy, m.r * 0.9, m.cx, m.cy, m.r * 2.1);
      hg.addColorStop(0, rgba(th.moonGlow, 0.42 * halo));
      hg.addColorStop(0.5, rgba(th.moonGlow, 0.12 * halo));
      hg.addColorStop(1, rgba(th.moonGlow, 0));
      g.fillStyle = hg;
      g.fillRect(0, 0, this.vw, this.vh);

      /* ---- the moon itself ---- */
      const face = mixHex(th.moonFace, th.paper, inkT);
      const limb = mixHex(th.moonLimb, shade(th.paper, -0.06).replace('rgb', 'rgba') === '' ? th.paper : th.moonLimb, 0);
      const disc = g.createRadialGradient(
        m.cx - m.r * 0.32, m.cy - m.r * 0.34, m.r * 0.1,
        m.cx, m.cy, m.r);
      disc.addColorStop(0, shade(face, 0.06));
      disc.addColorStop(0.72, face);
      disc.addColorStop(1, mixHex(th.moonLimb, face, inkT * 0.75));
      g.fillStyle = disc;
      g.beginPath();
      g.arc(m.cx, m.cy, m.r, 0, TAU);
      g.fill();

      /* ---- the code, written into the face ---- */
      this._paintFace(face, mixHex(face, th.maria, 1 - inkT * 0.15), mixHex(th.maria, th.moduleInk, inkT));
      g.save();
      g.beginPath();
      g.arc(m.cx, m.cy, m.r * 0.995, 0, TAU);
      g.clip();
      g.imageSmoothingEnabled = false;
      g.drawImage(this._tex, m.x0, m.y0, this.n * m.module, this.n * m.module);
      g.restore();

      /* ---- the branch, drawing back off frame as it empties ---- */
      if (withdraw < 1) {
        const slide = easeInCubic(withdraw);
        const ox = -slide * 0.5 * this.vw, oy = -slide * 0.24 * this.vh;
        const sway = Math.sin(now / 900) * this.wind * 0.004;
        g.globalAlpha = 1 - withdraw * 0.85;
        const barkDark = shade(th.branch, -0.5);
        const barkLit = shade(th.branch, 0.3);
        const pass = (widthK, offK, style) => {
          g.fillStyle = style;
          for (let i = 0; i < this.limbs.length; i += 40) {
            const end = Math.min(i + 40, this.limbs.length);
            g.beginPath();
            for (let k = i; k < end; k++) {
              const L = this.limbs[k];
              const ax = L.x1 * this.vw + ox + sway * this.vw * L.depth;
              const ay = L.y1 * this.vh + oy;
              const bx = L.x2 * this.vw + ox + sway * this.vw * (L.depth + 1);
              const by = L.y2 * this.vh + oy;
              const dx = bx - ax, dy = by - ay;
              const len = Math.hypot(dx, dy) || 1;
              let px = -dy / len, py = dx / len;
              if (px * -0.5 + py * -0.86 < 0) { px = -px; py = -py; }
              const s = Math.min(this.vw, this.vh);
              const w1 = Math.max(0.6, L.thick * s * widthK) * 0.5;
              const w2 = Math.max(0.4, L.thick2 * s * widthK) * 0.5;
              const o1 = L.thick * s * offK * 0.5, o2 = L.thick2 * s * offK * 0.5;
              g.moveTo(ax + px * (o1 - w1), ay + py * (o1 - w1));
              g.lineTo(bx + px * (o2 - w2), by + py * (o2 - w2));
              g.lineTo(bx + px * (o2 + w2), by + py * (o2 + w2));
              g.lineTo(ax + px * (o1 + w1), ay + py * (o1 + w1));
              g.closePath();
            }
            g.fill();
          }
        };
        pass(1.0, 0, barkDark);
        pass(0.66, 0.2, th.branch);
        pass(0.24, 0.4, barkLit);
        g.globalAlpha = 1;
      }

      /* ---- blossom: still on the branch, in flight, or landed ---- */
      const items = [];
      const s = Math.min(this.vw, this.vh);
      const slide = easeInCubic(withdraw);
      const bOx = -slide * 0.5 * this.vw, bOy = -slide * 0.24 * this.vh;
      for (const b of this.blossoms) {
        const at = this._blossomAt(b, p);
        if (at.landed) continue;
        const onBranch = at.t <= 0;
        items.push({
          x: at.x * this.vw + (onBranch ? bOx : 0),
          y: at.y * this.vh + (onBranch ? bOy : 0),
          r: b.size * s * 0.011,
          colour: this._blossomColour(b, at.t),
          spin: b.spin + now / 1000 * b.spinRate,
          squash: 0.55 + 0.45 * Math.abs(Math.cos(b.flutter + now / 900)),
          alpha: onBranch ? 1 - withdraw * 0.9 : 1
        });
      }
      for (const f of this.filler) {
        const at = this._fillerAt(f, p);
        if (at.alpha <= 0.02) continue;
        const onBranch = at.alpha >= 1;
        items.push({
          x: at.x * this.vw + (onBranch ? bOx : 0),
          y: at.y * this.vh + (onBranch ? bOy : 0),
          r: f.size * s * 0.010,
          colour: f.colour,
          spin: f.spin + now / 1000 * f.spinRate,
          squash: 0.55 + 0.45 * Math.abs(Math.cos(f.flutter + now / 900)),
          alpha: at.alpha * (onBranch ? 1 - withdraw * 0.9 : 1)
        });
      }
      this._stamp(g, items);

      /* ---- petals in front, clearing as the code sharpens ---- */
      if (!this.reducedMotion) this._drawPetals(g, this.petalsFront, 0.75 * (1 - inkT));

      /* ---- a light sweeping the face as it locks ---- */
      if (lock > 0 && lock < 1) {
        const sweep = lerp(-m.r, m.r, lock);
        g.save();
        g.beginPath();
        g.arc(m.cx, m.cy, m.r * 0.995, 0, TAU);
        g.clip();
        const lg = g.createLinearGradient(m.cx - m.r, m.cy + sweep - m.r * 0.4,
                                          m.cx + m.r, m.cy + sweep + m.r * 0.1);
        lg.addColorStop(0, 'rgba(255,255,255,0)');
        lg.addColorStop(0.5, rgba(th.moonGlow, 0.3 * (1 - Math.abs(lock * 2 - 1))));
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = lg;
        g.fillRect(m.cx - m.r, m.cy - m.r, m.r * 2, m.r * 2);
        g.restore();
      }

      /* ---- vignette ---- */
      const vig = (th.vignette || 0) * (1 - inkT * 0.35);
      if (vig > 0.005) {
        const rr = Math.hypot(this.vw, this.vh) * 0.62;
        const vg = g.createRadialGradient(this.vw / 2, this.vh * 0.44, rr * 0.45,
                                          this.vw / 2, this.vh * 0.44, rr);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,' + vig.toFixed(3) + ')');
        g.fillStyle = vg;
        g.fillRect(0, 0, this.vw, this.vh);
      }
    }

    /* Blossom stamped in colour+alpha buckets, chunked — canvas rasterises a
     * path slower than linearly in its subpath count. */
    _stamp(g, items) {
      if (!items.length) return;
      const STEPS = 5, CHUNK = 40;
      const buckets = new Map();
      for (const it of items) {
        const step = it.alpha >= 1 ? STEPS : Math.max(1, Math.round(it.alpha * STEPS));
        const key = it.colour + '|' + step;
        let arr = buckets.get(key);
        if (!arr) { arr = []; buckets.set(key, arr); }
        arr.push(it);
      }
      for (const [key, arr] of buckets) {
        const cut = key.lastIndexOf('|');
        g.fillStyle = key.slice(0, cut);
        g.globalAlpha = (+key.slice(cut + 1)) / STEPS;
        for (let i = 0; i < arr.length; i += CHUNK) {
          const end = Math.min(i + CHUNK, arr.length);
          g.beginPath();
          for (let k = i; k < end; k++) {
            const it = arr[k];
            const r = Math.max(0.7, it.r);
            const cs = Math.cos(it.spin), sn = Math.sin(it.spin);
            for (let q = 0; q < 10; q++) {
              const bx = BLOSSOM[q][0] * r, by = BLOSSOM[q][1] * r * it.squash;
              const px = it.x + bx * cs - by * sn;
              const py = it.y + bx * sn + by * cs;
              if (q === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.closePath();
          }
          g.fill();
        }
      }
      g.globalAlpha = 1;
    }

    _drawPetals(g, list, alpha) {
      if (alpha <= 0.01 || !this.theme) return;
      const items = [];
      const s = Math.min(this.vw, this.vh);
      const now = performance.now();
      for (const q of list) {
        items.push({
          x: q.x * this.vw, y: q.y * this.vh,
          r: lerp(2.6, 7.5, q.depth) * (s / 400),
          colour: q.colour,
          spin: q.spin,
          squash: Math.max(0.12, Math.abs(Math.cos(q.flip))),
          alpha: alpha
        });
      }
      this._stamp(g, items);
    }

    /* -------------------------------------------------------------- plumbing */
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const vw = Math.max(1, rect.width), vh = Math.max(1, rect.height);
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const w = Math.round(vw * dpr), h = Math.round(vh * dpr);
      if (w === this.canvas.width && h === this.canvas.height && this.vw === vw) return;
      this.vw = vw; this.vh = vh; this.dpr = dpr;
      this.canvas.width = w; this.canvas.height = h;
      this._texKey = null;
      this.draw();
    }

    _bind() {
      const c = this.canvas;
      let down = false, moved = 0, sx = 0, sy = 0;
      c.addEventListener('pointerdown', (e) => { down = true; moved = 0; sx = e.clientX; sy = e.clientY; });
      global.addEventListener('pointermove', (e) => {
        if (down) { moved += Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy); sx = e.clientX; sy = e.clientY; }
        const r = c.getBoundingClientRect();
        this.drift.tx = (e.clientX - r.left - r.width / 2) * 0.04;
        this.drift.ty = (e.clientY - r.top - r.height / 2) * 0.02;
        this.start();
      });
      global.addEventListener('pointerup', () => {
        if (down && moved < 8) this.toggle();
        down = false;
      });
      c.addEventListener('pointerleave', () => { this.drift.tx = 0; this.drift.ty = 0; });
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(); }
      });
    }
  }

  global.Grove = { Scene, mixHex, shade };
})(window);
