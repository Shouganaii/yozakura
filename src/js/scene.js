/* =============================================================================
 * scene.js — the isometric grove.
 *
 * The central idea: every dark module of the QR code exists as a leaf on the
 * tree. Tapping the tree sends the leaves swirling down to land on the exact
 * grid cells they encode, so the code assembles itself out of the canopy rather
 * than merely being uncovered. The camera then tilts to straight-down and the
 * blocks flatten, which is what makes the result actually scannable.
 * ========================================================================== */
(function (global) {
  'use strict';

  /* --------------------------------------------------------------- helpers */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutBack = (t) => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const easeInCubic = (t) => t * t * t;

  /* A five-petal blossom as a closed polygon — petal tips and the notches
   * between them, alternating. Precomputed as unit points so stamping one is
   * ten multiply-adds, which is what makes thousands of them affordable. */
  const BLOSSOM = (() => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const r = (i % 2 === 0) ? 1 : 0.68;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  })();

  /* Map a global 0..1 clock onto a sub-range of the timeline. */
  function span(t, from, to) { return clamp((t - from) / (to - from), 0, 1); }

  /* Deterministic PRNG so a given URL always grows the same tree. */
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

  /* Shift a hex colour's lightness — used for the lit/shadowed cube faces. */
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amount >= 0) {
      r = r + (255 - r) * amount; g = g + (255 - g) * amount; b = b + (255 - b) * amount;
    } else {
      const k = 1 + amount;
      r *= k; g *= k; b *= k;
    }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha.toFixed(3) + ')';
  }

  /* Blend two whole palettes. Hex strings and arrays of them interpolate;
   * anything else snaps at the halfway point. */
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

  function mixHex(a, b, t) {
    const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
    const r = Math.round(lerp((na >> 16) & 255, (nb >> 16) & 255, t));
    const g = Math.round(lerp((na >> 8) & 255, (nb >> 8) & 255, t));
    const bl = Math.round(lerp(na & 255, nb & 255, t));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }

  /* --------------------------------------------------------------- timeline */
  /* All phase boundaries live here so the choreography is easy to retune. */
  const T = {
    revealDuration: 1800,
    regrowDuration: 1400,
    gust:    [0.00, 0.15],  // wind ramps, canopy shivers
    flight:  [0.04, 0.56],  // leaves detach and fly to their modules
    sink:    [0.34, 0.52],  // trunk withdraws into the ground
    tilt:    [0.44, 0.78],  // camera lifts to look across the plaza
    flatten: [0.52, 0.82],  // blocks collapse to paint
    lock:    [0.78, 1.00]   // contrast snaps, the flare goes off
  };

  /* ------------------------------------------------------------------ Scene */
  class Scene {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.opts = Object.assign({ onStateChange: null, quietZone: 4 }, opts || {});

      this.qr = null;
      this.theme = null;
      this.leaves = [];
      this.petals = [];
      this.branches = [];
      this.grass = [];
      this.motes = [];
      this.heights = null;

      this.state = 'grown';           // grown | revealing | revealed | regrowing
      this.progress = 0;              // 0 = full tree, 1 = flat QR
      this.time = 0;
      this.lastFrame = 0;
      this.running = false;
      this.reducedMotion = global.matchMedia
        ? global.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

      /* Camera. pitch 0 = eye level, PI/2 = straight down. */
      this.cam = { yaw: Math.PI / 4, pitch: 0.6155, zoom: 10, cx: 0, cy: 0 };
      this.userYaw = 0;               // drag-to-orbit offset
      this.userYawTarget = 0;
      this.parallax = { x: 0, y: 0, tx: 0, ty: 0 };
      this.wind = 0;
      this.shockwave = -1;            // radius of the landing ripple, <0 = idle
      this.cineGain = 1;              // drops to 0 while the viewer drags
      this._fadeCache = new Map();

      this._buildStars();
      this._buildAmbient();
      this._bindPointer();

      /* Track the canvas box directly rather than listening for window resizes.
       * The stage also changes size when the builder panel is hidden, and again
       * when the deferred webfont swaps in and reflows — neither fires a window
       * resize, and a stale backing store means the browser stretches a square
       * code into a rectangle. */
      /* Resized synchronously in the callback rather than deferred to a frame:
       * ResizeObserver already fires after layout, and a page whose frames are
       * throttled would otherwise sit on a stale backing store indefinitely.
       * Setting width/height changes the backing store, not the observed box,
       * so this cannot feed back into itself. */
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(canvas);
      }

      /* Petals keep the loop running indefinitely, so hand the frames back
       * whenever the tab is not on screen. */
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.stop();
        else if (!this.reducedMotion) this.start();
      });
      this.resize();
    }

    /* Petals drifting across the viewport itself, independent of the scene.
     * Two layers: one behind everything, one in front, which is what gives the
     * screen depth. Coordinates are fractions of the viewport, so a resize
     * costs nothing and the field survives a new QR code. */
    _buildAmbient() {
      const rand = mulberry32(0x5eed1eaf);
      const make = (count, near) => Array.from({ length: count }, () => {
        const depth = near ? 0.45 + rand() * 0.55 : rand() * 0.5;
        return {
          x: rand(), y: rand(), depth: depth,
          fall: 0.018 + rand() * 0.034,
          swayAmp: 0.012 + rand() * 0.03,
          swayFreq: 0.5 + rand() * 0.9,
          swayPhase: rand() * TAU,
          spin: rand() * TAU,
          spinRate: (rand() - 0.5) * 1.5,
          /* The signature anime petal read: it tumbles edge-on, so its width
           * pinches to nothing and swells again as it turns over. */
          flip: rand() * TAU,
          flipRate: 0.9 + rand() * 1.9,
          tone: rand()
        };
      });
      /* A pool sized for the heaviest weather; each season uses the front of
       * it, so switching seasons costs nothing and never reallocates. */
      this.ambientBack = make(70, false);
      this.ambientFront = make(80, true);
      this.ambCount = { back: 16, front: 20 };
      this.ripples = [];
      this.droplets = [];
    }

    /* Motion per weather. Rain falls hard and straight, snow wanders, leaves
     * tumble, sun motes barely move at all. */
    _weather() {
      return (this.theme && this.theme.weather) || { kind: 'motes', count: 34 };
    }

    /* A fixed star field in viewport space, densest at the top where the sky is
     * deepest. Each twinkles on its own slow cycle. */
    _buildStars() {
      const rand = mulberry32(0x5741a2);
      this.stars = Array.from({ length: 130 }, () => ({
        x: rand(),
        y: Math.pow(rand(), 1.7) * 0.72,   // crowd them toward the top
        r: 0.4 + Math.pow(rand(), 2.4) * 1.7,
        base: 0.25 + rand() * 0.7,
        twinkleRate: 0.35 + rand() * 1.1,
        phase: rand() * TAU
      }));
    }

    _drawStars(g, strength) {
      if (strength <= 0.01 || !this.stars) return;
      const t = performance.now() / 1000;
      const w = this.vw, h = this.vh;
      g.fillStyle = '#ffffff';
      g.beginPath();
      let any = false;
      for (const st of this.stars) {
        const tw = 0.55 + 0.45 * Math.sin(t * st.twinkleRate + st.phase);
        const a = st.base * tw * strength;
        if (a < 0.04) continue;
        /* Alpha per star would mean a fill per star, so brightness is carried
         * by radius instead and the whole field goes down in one path. */
        const r = st.r * (0.5 + a);
        g.moveTo(st.x * w + r, st.y * h);
        g.arc(st.x * w, st.y * h, r, 0, TAU);
        any = true;
      }
      if (any) { g.globalAlpha = 0.85 * strength; g.fill(); g.globalAlpha = 1; }
    }

    _updateAmbient(dt) {
      const t = performance.now() / 1000;
      const secs = dt / 1000;
      const w = this._weather();

      /* Snow falls through still air; everything else gets gusts. */
      const breeze = 0.28 + 0.22 * Math.sin(t * 0.19);
      const gust = Math.pow(Math.max(0, Math.sin(t * 0.13 + 1.1)), 4) * 1.5;
      this.ambientWind = w.kind === 'snow' ? breeze * 0.45 : breeze + gust;

      const FALL = { motes: 0.5, leaves: 2.5, rain: 22, snow: 3.0 };
      const SWAY = { motes: 1.3, leaves: 1.0, rain: 0.06, snow: 1.7 };
      const SLANT = { motes: 1, leaves: 1, rain: 2.4, snow: 0.7 };
      const speed = FALL[w.kind] || 1;
      const swayK = SWAY[w.kind] || 1;
      const slant = SLANT[w.kind] || 1;

      this.ambCount.back = Math.min(this.ambientBack.length, Math.round(w.count * 0.42));
      this.ambCount.front = Math.min(this.ambientFront.length, Math.round(w.count * 0.58));

      const step = (list, n) => {
        for (let i = 0; i < n; i++) {
          const q = list[i];
          const scale = 0.45 + q.depth;
          q.y += q.fall * speed * scale * secs;
          q.x += (this.ambientWind * 0.055 * scale * slant +
                  Math.sin(t * q.swayFreq + q.swayPhase) * q.swayAmp * swayK) * secs;
          q.spin += q.spinRate * secs;
          q.flip += q.flipRate * secs * (0.7 + this.ambientWind * 0.35);
          if (q.y > 1.15) { q.y = -0.15; q.x = -0.1 + Math.random() * 1.1; }
          if (q.x > 1.2) q.x -= 1.4;
          if (q.x < -0.2) q.x += 1.4;
        }
      };
      step(this.ambientBack, this.ambCount.back);
      step(this.ambientFront, this.ambCount.front);

      /* Rain dimples the plaza. Ripples live in grid space so they sit on the
       * floor properly however the camera is angled. */
      if (w.kind === 'rain' && this.n) {
        this._rippleClock = (this._rippleClock || 0) + dt;
        while (this._rippleClock > 55) {
          this._rippleClock -= 55;
          if (this.ripples.length < 22) {
            this.ripples.push({ x: Math.random() * this.n, y: Math.random() * this.n, t: 0 });
          }
        }
        for (let i = this.ripples.length - 1; i >= 0; i--) {
          this.ripples[i].t += secs / 1.1;
          if (this.ripples[i].t >= 1) this.ripples.splice(i, 1);
        }
      } else if (this.ripples.length) {
        this.ripples.length = 0;
      }

      for (let i = this.droplets.length - 1; i >= 0; i--) {
        this.droplets[i].t += secs / 2.4;
        if (this.droplets[i].t >= 1) this.droplets.splice(i, 1);
      }
    }

    _drawAmbient(g, list, alpha, count) {
      if (alpha <= 0.01 || !this.theme || !count) return;
      const kind = this._weather().kind;
      const w = this.vw, h = this.vh;

      if (kind === 'rain') {
        /* Streaks, not drops: a falling drop reads as a line at any shutter a
         * screen can manage. Slant follows the same wind the tree feels. */
        const slant = this.ambientWind * 0.22;
        g.strokeStyle = mixHex(this.theme.skyBottom, '#ffffff', 0.55);
        g.lineCap = 'round';
        g.globalAlpha = alpha * 0.42;
        for (let pass = 0; pass < 2; pass++) {
          g.lineWidth = pass === 0 ? 0.7 : 1.1;
          g.beginPath();
          let any = false;
          for (let i = 0; i < count; i++) {
            const q = list[i];
            if ((q.depth > 0.5) !== (pass === 1)) continue;
            const len = lerp(14, 40, q.depth);
            const x = q.x * w, y = q.y * h;
            g.moveTo(x - slant * len, y - len);
            g.lineTo(x, y);
            any = true;
          }
          if (any) g.stroke();
        }
        g.globalAlpha = 1;
        return;
      }

      if (kind === 'snow') {
        g.fillStyle = '#ffffff';
        g.globalAlpha = alpha * 0.9;
        g.beginPath();
        for (let i = 0; i < count; i++) {
          const q = list[i];
          const r = lerp(1.1, 3.4, q.depth);
          const x = q.x * w, y = q.y * h;
          g.moveTo(x + r, y);
          g.arc(x, y, r, 0, TAU);
        }
        g.fill();
        g.globalAlpha = 1;
        return;
      }

      /* Leaves and sun motes both ride the petal silhouette; motes are just
       * smaller, slower and fainter. */
      const mote = kind === 'motes';
      const pal = this.theme.leaf;
      const buckets = new Map();
      for (let i = 0; i < count; i++) {
        const q = list[i];
        const colour = mote ? '#fff3d0' : pal[Math.floor(q.tone * pal.length) % pal.length];
        let arr = buckets.get(colour);
        if (!arr) { arr = []; buckets.set(colour, arr); }
        arr.push(q);
      }
      g.globalAlpha = mote ? alpha * 0.55 : alpha;
      for (const [colour, arr] of buckets) {
        g.fillStyle = colour;
        g.beginPath();
        for (const q of arr) {
          const x = q.x * w, y = q.y * h;
          const r = mote ? lerp(1.1, 2.6, q.depth) : lerp(3.6, 10.5, q.depth);
          if (mote) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); continue; }
          const cs = Math.cos(q.spin) * r, sn = Math.sin(q.spin) * r;
          /* |cos| of the flip angle is the foreshortening of a turning leaf. */
          const width = 0.62 * Math.abs(Math.cos(q.flip));
          const vx = -sn * width, vy = cs * width;
          g.moveTo(x - cs, y - sn);
          g.lineTo(x + cs * 0.15 - vx, y + sn * 0.15 - vy);
          g.lineTo(x + cs, y + sn);
          g.lineTo(x + cs * 0.15 + vx, y + sn * 0.15 + vy);
          g.closePath();
        }
        g.fill();
      }
      g.globalAlpha = 1;
    }

    /* Wet marks left where blossom has come down in the rain. */
    _drawDroplets(g, P, alpha) {
      if (!this.droplets.length || alpha <= 0.01) return;
      g.fillStyle = '#2c3a42';
      for (const d of this.droplets) {
        /* Spreads a little as it soaks in, then dries off. */
        const a = (1 - d.t) * 0.3 * alpha;
        if (a < 0.02) continue;
        const rad = d.r * (1 + d.t * 0.7);
        const c = P(d.x, d.y, 0);
        const e = P(d.x + rad, d.y, 0);
        const f = P(d.x, d.y + rad, 0);
        g.globalAlpha = a;
        g.beginPath();
        g.ellipse(c[0], c[1], Math.hypot(e[0] - c[0], e[1] - c[1]),
                  Math.hypot(f[0] - c[0], f[1] - c[1]),
                  Math.atan2(e[1] - c[1], e[0] - c[0]), 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    /* Expanding rings where rain strikes the plaza. */
    _drawRipples(g, P, zoom, alpha) {
      if (!this.ripples.length || alpha <= 0.01) return;
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(0.6, zoom * 0.03);
      for (const r of this.ripples) {
        const a = (1 - r.t) * 0.32 * alpha;
        if (a < 0.02) continue;
        const rad = r.t * 1.6;
        const c = P(r.x, r.y, 0);
        const e = P(r.x + rad, r.y, 0);
        const f = P(r.x, r.y + rad, 0);
        g.globalAlpha = a;
        g.beginPath();
        g.ellipse(c[0], c[1], Math.hypot(e[0] - c[0], e[1] - c[1]),
                  Math.hypot(f[0] - c[0], f[1] - c[1]),
                  Math.atan2(e[1] - c[1], e[0] - c[0]), 0, TAU);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    /* ------------------------------------------------------------ geometry */
    setMatrix(qr) {
      this.qr = qr;
      this.n = qr.size;
      this.heights = new Float32Array(this.n * this.n);
      /* Every dark module, landed or not. The plaza is paved with the code from
       * the first frame — you can just make it out in the stonework long before
       * anything falls, which is the whole conceit. */
      this._allDark = new Uint8Array(this.n * this.n);
      for (let y = 0; y < this.n; y++) {
        for (let x = 0; x < this.n; x++) {
          if (qr.get(x, y)) this._allDark[y * this.n + x] = 1;
        }
      }
      this._buildTree();
      this._buildGrass();
      this._recolour();
      this.time = 0;
      this.progress = this.state === 'revealed' ? 1 : 0;
      if (this.state === 'revealing' || this.state === 'regrowing') this._setState('grown');
      this.draw(0);
    }

    /* Palettes cross-fade rather than snap, so the auto-cycle reads as the
     * light changing over the garden instead of a hard swap. */
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
      if (this.qr) this._recolour();
      this.draw(0);
      if (this._themeT < 1) this.start();
    }

    get themeFading() { return this._themeT !== undefined && this._themeT < 1; }

    /* Grow a branch skeleton, then hang one leaf per dark module on it. */
    _buildTree() {
      const qr = this.qr, n = this.n;
      const rand = mulberry32(hashString(qr.version + ':' + qr.mask + ':' + n));

      /* Collect every dark module; these are the landing sites. */
      const targets = [];
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (qr.get(x, y)) targets.push({ x, y, role: global.QR.moduleRole(qr, x, y) });
        }
      }

      /* Recursive branches, in world units where the plot spans 0..n. */
      const cx = n / 2, cy = n / 2;
      const trunkH = n * 0.56;
      const branches = [];
      const tips = [];

      const grow = (x, y, z, dx, dy, dz, len, thick, depth) => {
        const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
        /* Limbs taper toward their tip, and harder the further out they are. */
        branches.push({ x1: x, y1: y, z1: z, x2: ex, y2: ey, z2: ez,
                        thick, thick2: thick * (depth === 0 ? 0.66 : depth >= 3 ? 0.38 : 0.62), depth });
        if (depth >= 4 || len < n * 0.045) { tips.push({ x: ex, y: ey, z: ez, spread: len * 1.25 }); return; }
        /* Interior nodes carry foliage too — without them the crown reads as a
         * hollow ring once the tips are pushed outward below. */
        if (depth >= 2) tips.push({ x: ex, y: ey, z: ez, spread: len * 0.85 });
        const kids = depth === 0 ? 4 : rand() < 0.28 ? 3 : 2;
        const base = rand() * TAU;
        for (let i = 0; i < kids; i++) {
          const ang = base + (i / kids) * TAU + (rand() - 0.5) * 0.8;
          const tilt = 0.52 + rand() * 0.55;
          const nx = dx + Math.cos(ang) * tilt;
          const ny = dy + Math.sin(ang) * tilt;
          const nz = dz * (0.55 + rand() * 0.3);
          const m = Math.hypot(nx, ny, nz) || 1;
          grow(ex, ey, ez, nx / m, ny / m, nz / m, len * (0.62 + rand() * 0.16), thick * 0.62, depth + 1);
        }
      };
      grow(cx, cy, 0, 0, 0, 1, trunkH, n * 0.085, 0);

      let crownR = 0.0001;
      for (const t of tips) crownR = Math.max(crownR, Math.hypot(t.x - cx, t.y - cy));
      const widen = clamp((n * 0.42) / crownR, 1, 2.0);
      for (const br of branches) {
        br.x1 = cx + (br.x1 - cx) * widen; br.y1 = cy + (br.y1 - cy) * widen;
        br.x2 = cx + (br.x2 - cx) * widen; br.y2 = cy + (br.y2 - cy) * widen;
      }
      for (const t of tips) {
        t.x = cx + (t.x - cx) * widen; t.y = cy + (t.y - cy) * widen;
        t.spread *= Math.min(widen, 1.5);
      }

      let crownReach = 0, crownTop = trunkH;
      for (const t of tips) {
        crownReach = Math.max(crownReach, Math.hypot(t.x - cx, t.y - cy) + t.spread);
        crownTop = Math.max(crownTop, t.z + t.spread * 0.8);
      }
      this.crownReach = crownReach;
      this.crownTop = crownTop;

      this.branches = branches;
      this.trunkTop = trunkH;

      /* Foliage sites run the length of every branch, not just its end. Leaves
       * hugging the limbs is what makes a canopy look grown rather than
       * stuck on, and it fills the volume the widen step opens up. */
      const sites = [];
      for (const br of branches) {
        if (br.depth < 1) continue;
        const segLen = Math.hypot(br.x2 - br.x1, br.y2 - br.y1, br.z2 - br.z1);
        const count = Math.max(2, Math.round(segLen * 2.4));
        for (let i = 0; i < count; i++) {
          const t = 0.12 + rand() * 0.88;
          sites.push({
            x: lerp(br.x1, br.x2, t),
            y: lerp(br.y1, br.y2, t),
            z: lerp(br.z1, br.z2, t),
            spread: segLen * (0.30 + 0.16 * br.depth)
          });
        }
      }
      const siteAt = (i) => sites[i % sites.length];

      const canopy = [];
      for (let i = 0; i < targets.length; i++) {
        const site = siteAt(i * 3 + 1);
        const a = rand() * TAU, b = Math.acos(2 * rand() - 1);
        const r = site.spread * Math.pow(rand(), 0.45);
        canopy.push({
          x: site.x + r * Math.sin(b) * Math.cos(a),
          y: site.y + r * Math.sin(b) * Math.sin(a),
          z: site.z + r * Math.cos(b) * 0.75
        });
      }

      /* Blossom that carries no data. The canopy needs far more leaves than a
       * short URL has dark modules, so the surplus is decorative: it blows
       * away on the gust while the encoding leaves stay and land. Chaff and
       * signal, separating in front of you. The count is chosen so a dense v2
       * canopy and a sparse v9 one end up at about the same total. */
      const fillerCount = Math.round(clamp(3600 - targets.length, 1200, 3100));
      this.petals = [];
      for (let i = 0; i < fillerCount; i++) {
        const site = siteAt(i * 7 + 3);
        const a = rand() * TAU, b = Math.acos(2 * rand() - 1);
        const r = site.spread * Math.pow(rand(), 0.4);
        const px = site.x + r * Math.sin(b) * Math.cos(a);
        const py = site.y + r * Math.sin(b) * Math.sin(a);
        const away = Math.atan2(py - cy, px - cx) + (rand() - 0.5) * 1.1;
        this.petals.push({
          hx: px, hy: py, hz: Math.max(site.z + r * Math.cos(b) * 0.75, n * 0.1),
          driftX: Math.cos(away) * n * (0.5 + rand() * 0.9),
          driftY: Math.sin(away) * n * (0.5 + rand() * 0.9),
          driftZ: n * (0.12 + rand() * 0.5),
          delay: rand() * 0.55,
          spin: rand() * TAU,
          spinRate: (rand() - 0.5) * 9,
          size: 0.7 + rand() * 0.46,
          tone: rand(),
          flutter: rand() * TAU
        });
      }

      const angleOf = (p) => Math.atan2(p.y - cy, p.x - cx);
      const order = targets.map((t, i) => i).sort((a, b) => angleOf(targets[a]) - angleOf(targets[b]));
      const canopyOrder = canopy.map((c, i) => i).sort((a, b) => angleOf(canopy[a]) - angleOf(canopy[b]));

      const maxR = Math.hypot(cx, cy);
      this.leaves = order.map((ti, k) => {
        const t = targets[ti];
        const c = canopy[canopyOrder[k]];
        const dist = Math.hypot(t.x + 0.5 - cx, t.y + 0.5 - cy) / maxR;
        /* Finder patterns land first — they are the anchors a scanner hunts
         * for, and it reads as intent rather than randomness. */
        const priority = clamp(
          t.role === 'finder' ? 0.02 :
          t.role === 'timing' ? 0.18 :
          0.30 + dist * 0.58 + (rand() - 0.5) * 0.12, 0, 1);
        const dur = 0.34 + rand() * 0.14;
        const travel = Math.hypot(t.x + 0.5 - c.x, t.y + 0.5 - c.y);
        return {
          hx: c.x, hy: c.y, hz: Math.max(c.z, n * 0.12),
          tx: t.x, ty: t.y, role: t.role,
          dur: dur,
          delay: priority * (1 - dur),
          land: priority * (1 - dur) + dur,
          swirl: (rand() - 0.5) * Math.min(travel * 0.7, n * 0.18),
          lift: n * (0.06 + rand() * 0.14),
          spin: rand() * TAU,
          spinRate: (rand() - 0.5) * 7,
          size: 0.86 + rand() * 0.38,
          tone: rand(),
          flutter: rand() * TAU
        };
      });
      this._recolour();
    }

    /* Grass grows in tufts rather than evenly, which is most of what makes a
     * verge read as planted instead of scattered. Each blade is a tapered,
     * curved sliver; a few carry a wildflower at the tip. */
    _buildGrass() {
      const n = this.n, rand = mulberry32(hashString('grass' + n));
      const blades = [];
      const edge = 2.1;
      const tufts = Math.round(n * 5.2);

      for (let i = 0; i < tufts; i++) {
        const side = i % 4;
        const t = rand() * (n + edge * 2) - edge;
        let ox, oy;
        if (side === 0) { ox = t; oy = -edge * rand(); }
        else if (side === 1) { ox = t; oy = n + edge * rand(); }
        else if (side === 2) { ox = -edge * rand(); oy = t; }
        else { ox = n + edge * rand(); oy = t; }

        const vigour = 0.55 + rand() * 0.75;          // how lush this tuft is
        const count = 4 + Math.floor(rand() * 6);
        for (let k = 0; k < count; k++) {
          const spread = 0.55;
          blades.push({
            x: ox + (rand() - 0.5) * spread,
            y: oy + (rand() - 0.5) * spread,
            h: n * (0.018 + rand() * 0.058) * vigour,
            lean: (rand() - 0.5) * 1.25,
            curl: 0.25 + rand() * 0.6,               // how far the blade arcs over
            width: n * (0.0026 + rand() * 0.0032),
            tone: rand(),
            phase: rand() * TAU,
            stiff: 0.45 + rand() * 0.8,              // stiffer blades sway less
            flower: rand() < 0.055 ? rand() : -1
          });
        }
      }
      this.grass = blades;

      /* Leaves that came down a while ago and are just lying there. They sell
       * the plaza as somewhere weather actually happens — and they clear as the
       * code takes over, so nothing is resting on it when you go to scan. */
      this.fallen = Array.from({ length: 70 }, () => ({
        x: -1 + rand() * (n + 2),
        y: -1 + rand() * (n + 2),
        rot: rand() * TAU,
        size: 0.30 + rand() * 0.26,
        tone: rand()
      }));

      /* Petals that have already let go, drifting down on a loop. They are
       * what keeps the scene alive while nobody is touching it. */
      this.motes = Array.from({ length: 40 }, () => ({
        x: rand() * n, y: rand() * n, z: n * (0.05 + rand() * 0.62),
        fall: 0.9 + rand() * 1.5,
        size: 0.34 + rand() * 0.32, phase: rand() * TAU, tone: rand(),
        spin: rand() * TAU, spinRate: (rand() - 0.5) * 3.2,
        rest: 0, fade: 1
      }));
    }

    _recolour() {
      if (!this.theme || !this.leaves.length) return;
      const pal = this.theme.leaf;
      this._fadeCache.clear();
      for (const l of this.leaves) {
        l.colourIdx = Math.floor(l.tone * pal.length) % pal.length;
        l.colour = pal[l.colourIdx];
      }
      for (const pt of this.petals) {
        pt.colourIdx = Math.floor(pt.tone * pal.length) % pal.length;
        pt.colour = pal[pt.colourIdx];
      }
      for (const f of (this.fallen || [])) f.colour = pal[Math.floor(f.tone * pal.length) % pal.length];
      for (const g of this.grass) g.colour = this.theme.grass[Math.floor(g.tone * this.theme.grass.length) % this.theme.grass.length];
      for (const m of this.motes) m.colour = pal[Math.floor(m.tone * pal.length) % pal.length];
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
      if (this.reducedMotion) { this.progress = 1; this._setState('revealed'); this.draw(0); return; }
      this.time = this.progress * T.revealDuration;
      this._setState('revealing');
      this.start();
    }

    conceal() {
      if (this.state === 'grown' || this.state === 'regrowing') return;
      if (this.reducedMotion) { this.progress = 0; this._setState('grown'); this.draw(0); return; }
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
        this.draw(dt);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    stop() { this.running = false; }

    /* --------------------------------------------------------------- update */
    update(dt) {
      if (this.state === 'revealing') {
        this.time += dt;
        const p = clamp(this.time / T.revealDuration, 0, 1);
        if (this.progress < T.flatten[0] && p >= T.flatten[0]) this.shockwave = 0;
        this.progress = p;
        if (p >= 1) { this.progress = 1; this._setState('revealed'); }
      } else if (this.state === 'regrowing') {
        this.time += dt;
        const p = clamp(this.time / T.regrowDuration, 0, 1);
        this.progress = 1 - p;
        if (p >= 1) { this.progress = 0; this._setState('grown'); }
      }

      if (this._themeT !== undefined && this._themeT < 1) {
        this._themeT = clamp(this._themeT + dt / 900, 0, 1);   // matches the CSS token transition
        this.theme = mixTheme(this._themeFrom, this.themeBase, smoothstep(this._themeT));
        this._recolour();
      }

      /* Wind gusts: a slow idle breeze that spikes as the reveal begins. */
      const gust = span(this.progress, T.gust[0], T.gust[1]) * (1 - span(this.progress, 0.5, 0.8));
      this.wind = Math.sin(performance.now() / 1400) * 0.35 + 0.35 + gust * 2.4;

      if (this.shockwave >= 0) {
        this.shockwave += dt / 1000 * this.n * 1.9;
        if (this.shockwave > this.n * 1.6) this.shockwave = -1;
      }

      /* Hand the shot back to the viewer the moment they touch it, and take it
       * back gently a few seconds after they let go. */
      this.cineGain = lerp(this.cineGain, this.cineHold ? 0 : 1, 1 - Math.pow(0.28, dt / 1000));
      this.userYaw = lerp(this.userYaw, this.userYawTarget, 1 - Math.pow(0.001, dt / 1000));
      this.parallax.x = lerp(this.parallax.x, this.parallax.tx, 1 - Math.pow(0.004, dt / 1000));
      this.parallax.y = lerp(this.parallax.y, this.parallax.ty, 1 - Math.pow(0.004, dt / 1000));

      /* A leaf lets go somewhere in the canopy, tumbles down, comes to rest on
       * the stone and fades out; then another one goes. Continuous, and slow
       * enough to notice without ever demanding attention. */
      const shedSecs = dt / 1000;
      const shedNow = performance.now() / 1000;
      for (const m of this.motes) {
        if (m.rest > 0) {
          m.rest -= shedSecs;
          m.fade = clamp(m.rest / 1.8, 0, 1);
          if (m.rest <= 0) this._shed(m);
          continue;
        }
        m.z -= m.fall * shedSecs;
        m.x += (this.wind * 0.22 + Math.sin(shedNow * 1.2 + m.phase) * 0.45) * shedSecs;
        m.y += Math.cos(shedNow * 0.85 + m.phase) * 0.3 * shedSecs;
        m.spin += m.spinRate * shedSecs;
        if (m.z <= 0) {
          m.z = 0; m.rest = 2.6; m.fade = 1;
          /* In the rain a blossom comes down wet, and leaves the mark of it
           * on the stone for a moment after it has gone. */
          if (this.theme && this.theme.droplets && this.droplets.length < 40) {
            this.droplets.push({ x: m.x, y: m.y, t: 0, r: 0.22 + Math.random() * 0.2 });
          }
        }
      }

      if (!this.reducedMotion) this._updateAmbient(dt);

      /* With petals always falling there is no truly idle frame to skip, so the
       * loop keeps running — the settled state costs well under a millisecond.
       * Under reduced motion nothing drifts, and the loop can genuinely rest. */
      const settled = (this.reducedMotion && this.state === 'revealed' &&
        !this.themeFading &&
        Math.abs(this.userYaw - this.userYawTarget) < 0.001 &&
        Math.abs(this.parallax.x - this.parallax.tx) < 0.2 &&
        this.shockwave < 0);
      if (settled) this.stop();
    }

    /* Send a shed leaf back up into the canopy to fall again. */
    _shed(m) {
      const src = this.petals && this.petals.length
        ? this.petals[(Math.random() * this.petals.length) | 0] : null;
      if (src) { m.x = src.hx; m.y = src.hy; m.z = src.hz; }
      else { m.x = Math.random() * this.n; m.y = Math.random() * this.n; m.z = this.n * 0.5; }
      m.rest = 0;
      m.fade = 1;
    }

    /* A blossom petal: hangs on the branch, then is torn off by the gust and
     * carried out of frame. Position is a pure function of progress, so
     * scrubbing the timeline backwards works for free. */
    _petalPosition(pt, p) {
      const blow = span(p, T.gust[0], 0.58);
      const t = clamp((blow - pt.delay) / (1 - pt.delay || 1), 0, 1);
      if (t <= 0) {
        const s = Math.sin(performance.now() / 640 + pt.flutter) * this.wind * 0.2;
        return { x: pt.hx + s, y: pt.hy + s * 0.6,
                 z: pt.hz + Math.cos(performance.now() / 720 + pt.flutter) * 0.14, alpha: 1 };
      }
      const e = easeInCubic(t);
      const arc = Math.sin(t * Math.PI);
      return {
        x: pt.hx + pt.driftX * e,
        y: pt.hy + pt.driftY * e,
        z: pt.hz + pt.driftZ * arc - pt.hz * 0.35 * e,
        alpha: 1 - t * t
      };
    }

    /* Leaf colour, turning to ink over the last stretch of the flight. Values
     * are quantised and memoised, so a canopy of 1500 leaves costs a handful of
     * colour computations per frame instead of one apiece. */
    _leafColour(l, t) {
      if (t <= 0.55) return l.colour;
      const step = Math.min(8, Math.round(easeInCubic((t - 0.55) / 0.45) * 8));
      if (step === 0) return l.colour;
      const key = l.colourIdx * 16 + step;
      let c = this._fadeCache.get(key);
      if (!c) { c = mixHex(l.colour, this.theme.ink, step / 8); this._fadeCache.set(key, c); }
      return c;
    }

    /* How far along its flight a leaf is: 0 = still on the branch, 1 = landed. */
    _leafLocal(l, flightSpan) {
      return clamp((flightSpan - l.delay) / l.dur, 0, 1);
    }

    /* Where a leaf is right now, in world space. */
    _leafPosition(l, p) {
      const flightSpan = span(p, T.flight[0], T.flight[1]);
      const local = this._leafLocal(l, flightSpan);
      if (local <= 0) {
        /* Still attached: sway with the wind. */
        const s = Math.sin(performance.now() / 620 + l.flutter) * this.wind * 0.18;
        return { x: l.hx + s, y: l.hy + s * 0.6, z: l.hz + Math.cos(performance.now() / 700 + l.flutter) * 0.12, landed: false, t: 0 };
      }
      if (local >= 1) return { x: l.tx + 0.5, y: l.ty + 0.5, z: 0, landed: true, t: 1 };

      const e = easeInOutCubic(local);
      const tx = l.tx + 0.5, ty = l.ty + 0.5;
      /* A quadratic arc with a sideways swirl, so the swarm spirals in. */
      const swirl = Math.sin(local * Math.PI) * l.swirl;
      const perpX = -(ty - l.hy), perpY = (tx - l.hx);
      const pm = Math.hypot(perpX, perpY) || 1;
      const x = lerp(l.hx, tx, e) + (perpX / pm) * swirl;
      const y = lerp(l.hy, ty, e) + (perpY / pm) * swirl;
      const z = lerp(l.hz, 0, easeInCubic(local)) + Math.sin(local * Math.PI) * l.lift;
      return { x, y, z, landed: false, t: local };
    }

    /* ----------------------------------------------------------- projection */
    /* A slow, never-quite-repeating drift, the way an anime establishing shot
     * keeps the camera alive without ever calling attention to itself. The
     * three periods are deliberately non-harmonic (41s / 57s / 34s) so the
     * motion does not visibly loop. It fades out as the code takes over, and
     * backs off while the viewer is dragging so it never fights them. */
    _cinematic() {
      if (this.reducedMotion) return { yaw: 0, pitch: 0, zoom: 1 };
      const t = performance.now() / 1000;
      const alive = 1 - smoothstep(span(this.progress, T.sink[0], T.tilt[1]));
      const k = alive * this.cineGain;
      return {
        yaw: (Math.sin(t * 0.153) * 0.115 + Math.sin(t * 0.0611 + 2.2) * 0.045) * k,
        pitch: Math.sin(t * 0.110 + 1.3) * 0.052 * k,
        zoom: 1 + (Math.sin(t * 0.185 + 0.7) * 0.028 + Math.sin(t * 0.079 + 3.1) * 0.014) * k
      };
    }

    _camera() {
      const p = this.progress;
      /* The garden sits isometric, where a tree has room to stand *in* its
       * plot rather than in front of it. The reveal then rotates the plaza
       * square-on and lifts the eye to straight down together, so the code
       * lands as a centred square with no perspective left for a scanner to
       * undo — the view that has to be square is the code's, not the garden's.
       * Yaw runs 45° → 0° and never crosses zero, so the painter ordering the
       * ground pass relies on stays valid the whole way. */
      const lift = smoothstep(span(p, T.tilt[0], T.tilt[1]));
      const cine = this._cinematic();
      const pitch = lerp(0.6155 + cine.pitch, Math.PI / 2, lift);
      const yaw = lerp(Math.PI / 4 + this.userYaw + cine.yaw + this.parallax.x * 0.0016,
                       0, lift);
      return { pitch, yaw, tilt: lift, lift, zoomScale: lerp(cine.zoom, 1, lift) };
    }

    _basis(cam, zoom) {
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      return {
        ex: [cy * zoom, sy * sp * zoom],
        ey: [-sy * zoom, cy * sp * zoom],
        ez: [0, -cp * zoom],
        depthX: sy, depthY: cy
      };
    }

    /* Fit the whole scene into the viewport for the current camera angle. */
    _fit(cam) {
      const n = this.n, quiet = this.opts.quietZone;
      /* While the tree is up the crown is the widest thing on screen, so it
       * has to be inside the bounding volume or the canopy gets clipped. */
      const alive = 1 - smoothstep(span(this.progress, T.sink[0], T.tilt[1]));
      /* Only about two thirds of the crown is framed: the outer blossom is
       * allowed to bleed off the sides, which fills the stage and reads as a
       * canopy you are standing under rather than a specimen on a plinth. */
      const reach = (this.crownReach || 0) * alive * 0.62;
      const top = (this.crownTop || this.trunkTop) * alive * 0.94;
      const b = this._basis(cam, 1);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const lo = Math.min(-quiet, n / 2 - reach);
      const hi = Math.max(n + quiet, n / 2 + reach);
      for (const x of [lo, hi]) for (const y of [lo, hi]) for (const z of [0, top]) {
        const sx = x * b.ex[0] + y * b.ey[0] + z * b.ez[0];
        const sy = x * b.ex[1] + y * b.ey[1] + z * b.ez[1];
        if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
      }
      /* The card needs more margin than the plot did — its shadow falls below
       * it, and a card pressed against the viewport edge stops reading as
       * something floating. */
      const pad = 1.02 + 0.16 * smoothstep(span(this.progress, T.tilt[0], T.tilt[1]));
      const zoom = Math.min(this.vw / ((maxX - minX) * pad), this.vh / ((maxY - minY) * pad));
      return {
        zoom,
        cx: this.vw / 2 - ((minX + maxX) / 2) * zoom,
        cy: this.vh / 2 - ((minY + maxY) / 2) * zoom
      };
    }

    /* ----------------------------------------------------------------- draw */
    draw() {
      if (!this.qr || !this.theme) return;

      /* Self-heal a drifted backing store. The ResizeObserver above catches
       * this everywhere it runs, but an environment that suspends layout while
       * a page is not composited can miss the callback entirely — and a canvas
       * whose backing store no longer matches its box gets stretched by the
       * browser, which turns the square code into a rectangle. Checked
       * occasionally rather than every frame, since it forces layout. */
      if ((this._sizeCheck = (this._sizeCheck || 0) + 1) % 20 === 0) {
        const box = this.canvas.getBoundingClientRect();
        if (Math.abs(box.width - this.vw) > 1 || Math.abs(box.height - this.vh) > 1) {
          this.resize();
        }
      }

      const g = this.ctx, n = this.n, th = this.theme, p = this.progress;
      const dpr = this.dpr;

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, this.vw, this.vh);

      /* The sky is a two-stop gradient that washes out to paper as the code
       * takes over — atmosphere first, then pure contrast for the scanner. */
      /* The scene keeps its own weather and light all the way through; only
       * the plaza goes to white-on-green as the code forms. */
      const skyTop = th.skyTop;
      const skyBottom = th.skyBottom;
      if (skyTop === skyBottom) {
        g.fillStyle = skyTop;
      } else {
        const sky = g.createLinearGradient(0, 0, 0, this.vh);
        sky.addColorStop(0, skyTop);
        sky.addColorStop(1, skyBottom);
        g.fillStyle = sky;
      }
      g.fillRect(0, 0, this.vw, this.vh);

      const cam = this._camera();
      const fit = this._fit(cam);
      fit.zoom *= cam.zoomScale;
      const b = this._basis(cam, fit.zoom);
      const ox = fit.cx + this.parallax.x * (1 - cam.tilt) * 0.5;
      const oy = fit.cy + this.parallax.y * (1 - cam.tilt) * 0.5;

      const P = (x, y, z) => [
        ox + x * b.ex[0] + y * b.ey[0] + z * b.ez[0],
        oy + x * b.ex[1] + y * b.ey[1] + z * b.ez[1]
      ];

      /* A soft bloom of the foliage colour behind the crown. On the dusk
       * palette this is what makes the blossom read as luminous rather than
       * merely tinted; in daylight it is a faint haze. */
      const canopyLife = 1 - smoothstep(span(p, T.gust[0], T.sink[1]));
      if (canopyLife > 0.01) {
        const c = P(n / 2, n / 2, this.trunkTop * 1.05);
        const rad = Math.max(40, n * 0.72 * fit.zoom);
        const bloom = g.createRadialGradient(c[0], c[1], rad * 0.05, c[0], c[1], rad);
        const strength = (th.bloom || 0.2) * canopyLife;
        bloom.addColorStop(0, hexToRgba(th.accent, strength));
        bloom.addColorStop(0.5, hexToRgba(th.accent, strength * 0.4));
        bloom.addColorStop(1, hexToRgba(th.accent, 0));
        g.fillStyle = bloom;
        g.fillRect(0, 0, this.vw, this.vh);
      }

      const flatten = smoothstep(span(p, T.flatten[0], T.flatten[1]));
      const blockH = lerp(0.85, 0, flatten);   // in cell units, so it reads at any version
      const inkT = smoothstep(span(p, T.flatten[0], T.lock[1]));
      const paving = mixHex(th.paving, '#ffffff', inkT);
      /* The code's dark modules settle into planted green rather than black —
       * still dark enough against pale stone for a scanner, but the plaza reads
       * as a garden rather than a printout. */
      const ink = mixHex(th.ink, th.moduleGreen || '#000000', inkT);

      /* Stars first, fading as the sky washes out toward the code. */
      if (!this.reducedMotion) this._drawStars(g, th.stars || 0);

      /* Petals behind the scene. Once the code is flat these are the only ones
       * left, and they drift behind its card — nothing ever floats across a
       * symbol somebody is trying to scan. */
      if (!this.reducedMotion) this._drawAmbient(g, this.ambientBack, 0.5, this.ambCount.back);

      /* ---- ground slab + quiet zone ---- */
      const quiet = this.opts.quietZone;
      {
        this._quad(g, P(-quiet, -quiet, 0), P(n + quiet, -quiet, 0), P(n + quiet, n + quiet, 0), P(-quiet, n + quiet, 0),
          mixHex(th.ground, '#ffffff', inkT));
      }

      /* The whole plot is a slab, not a decal: the two faces the camera can see
       * are drawn to their full depth so it sits in the world with weight. They
       * only go away in the overhead view, where there are no sides to see. */
      /* The slab's sides go as the eye lifts overhead — from straight down
       * there are no sides to see. */
      if (cam.lift < 0.995) {
        const lo = -quiet, hi = n + quiet, d = -0.9;
        const rimA = shade(th.rim, 0.12), rimB = shade(th.rim, -0.12);
        this._quad(g, P(lo, hi, 0), P(hi, hi, 0), P(hi, hi, d), P(lo, hi, d), rimA, 1 - cam.lift);
        this._quad(g, P(hi, lo, 0), P(hi, hi, 0), P(hi, hi, d), P(hi, lo, d), rimB, 1 - cam.lift);
      }

      /* ---- paving grid + risen modules ---- */
      this._drawGround(g, P, b, paving, ink, blockH, flatten, inkT);

      /* Leaves lying on the paving, fading out as the code sharpens: the
       * static scatter, plus whatever has just come down and not yet gone. */
      if (inkT < 0.98 && this.fallen) {
        const resting = this.fallen.slice();
        for (const m of this.motes) {
          if (m.rest > 0) {
            resting.push({ x: m.x, y: m.y, rot: m.spin, size: m.size,
                           colour: m.colour, fade: m.fade });
          }
        }
        const buckets = new Map();
        for (const f of resting) {
          let arr = buckets.get(f.colour);
          if (!arr) { arr = []; buckets.set(f.colour, arr); }
          arr.push(f);
        }
        g.globalAlpha = (1 - inkT) * 0.85;
        for (const [colour, arr] of buckets) {
          g.fillStyle = colour;
          g.beginPath();
          for (const f of arr) {
            if (f.fade !== undefined && f.fade < 0.02) continue;
            const k = f.fade === undefined ? 1 : f.fade;
            const cs = Math.cos(f.rot), sn = Math.sin(f.rot);
            const ax = f.size * k, ay = f.size * 0.5 * k;
            /* Corners in grid space, so the projection foreshortens them the
             * way anything lying flat on the ground would be. */
            const pts = [[-ax, 0], [0, -ay], [ax, 0], [0, ay]];
            for (let k = 0; k < 4; k++) {
              const px = f.x + pts[k][0] * cs - pts[k][1] * sn;
              const py = f.y + pts[k][0] * sn + pts[k][1] * cs;
              const q = P(px, py, 0.01);
              if (k === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]);
            }
            g.closePath();
          }
          g.fill();
        }
        g.globalAlpha = 1;
      }

      if (!this.reducedMotion) {
        this._drawDroplets(g, P, 1 - inkT * 0.7);
        this._drawRipples(g, P, fit.zoom, 1 - inkT * 0.6);
      }

      /* ---- soft shadow of the canopy ---- */
      const canopyAlpha = 1 - smoothstep(span(p, T.flight[0], T.sink[1]));
      if (canopyAlpha > 0.01 && flatten < 1) {
        const c = P(n / 2, n / 2, 0);
        const rx = n * 0.36 * fit.zoom, ry = rx * Math.sin(cam.pitch);
        g.save();
        g.translate(c[0], c[1]);
        g.scale(1, ry / rx);
        const grad = g.createRadialGradient(0, 0, rx * 0.15, 0, 0, rx);
        grad.addColorStop(0, 'rgba(58,46,32,' + (0.16 * canopyAlpha).toFixed(3) + ')');
        grad.addColorStop(0.65, 'rgba(58,46,32,' + (0.08 * canopyAlpha).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(58,46,32,0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill();
        g.restore();
      }

      /* ---- sprites: branches, leaves, motes ----------------------------
       * Canvas fills are the bottleneck here, so anything sharing a colour is
       * accumulated into one path. Leaves only need to sort against the trunk,
       * not against each other, so they split into a behind/in-front pair. */
      const dz = (x, y, z) => x * b.depthX + y * b.depthY + z * 0.001;
      const trunkDepth = dz(n / 2, n / 2, 0);

      /* Grass: filled tapered blades, batched per shade. Each is two quadratic
       * curves meeting at the tip, so it narrows the way a real blade does
       * rather than reading as a drawn line. */
      if (flatten < 1) {
        g.globalAlpha = 1 - flatten;
        const byShade = this._grassBatch || (this._grassBatch = new Map());
        byShade.clear();
        for (const blade of this.grass) {
          let list = byShade.get(blade.colour);
          if (!list) { list = []; byShade.set(blade.colour, list); }
          list.push(blade);
        }
        const now = performance.now();
        const flowers = [];
        for (const [colour, list] of byShade) {
          g.fillStyle = colour;
          for (let i = 0; i < list.length; i += 40) {
            const end = Math.min(i + 40, list.length);
            g.beginPath();
            for (let k = i; k < end; k++) {
              const bl = list[k];
              const sway = Math.sin(now / 760 + bl.phase) * this.wind * 0.16 / bl.stiff;
              const leanX = bl.lean * bl.curl + sway;
              const leanY = (bl.lean * 0.35 + sway) * 0.5;
              const base = P(bl.x, bl.y, 0);
              const mid = P(bl.x + leanX * 0.32, bl.y + leanY * 0.32, bl.h * 0.62);
              const tip = P(bl.x + leanX, bl.y + leanY, bl.h);
              /* Offset the base sideways in screen space to give the blade width. */
              const w = Math.max(0.55, bl.width * fit.zoom);
              g.moveTo(base[0] - w, base[1]);
              g.quadraticCurveTo(mid[0] - w * 0.35, mid[1], tip[0], tip[1]);
              g.quadraticCurveTo(mid[0] + w * 0.35, mid[1], base[0] + w, base[1]);
              g.closePath();
              if (bl.flower >= 0) flowers.push({ tip, tone: bl.flower, r: w * 1.5 });
            }
            g.fill();
          }
        }
        /* Wildflowers, in the blossom palette so the verge echoes the canopy. */
        if (flowers.length) {
          const pal = th.leaf;
          for (let i = 0; i < pal.length; i++) {
            g.fillStyle = pal[i];
            g.beginPath();
            let any = false;
            for (const f of flowers) {
              if (Math.floor(f.tone * pal.length) % pal.length !== i) continue;
              g.moveTo(f.tip[0] + f.r, f.tip[1]);
              g.arc(f.tip[0], f.tip[1], f.r, 0, TAU);
              any = true;
            }
            if (any) g.fill();
          }
        }
        g.globalAlpha = 1;
      }

      /* Leaves and blossom, bucketed by colour; two passes around the trunk. */
      const behind = [], front = [];
      const flightSpan = span(p, T.flight[0], T.flight[1]);
      const now = performance.now();
      for (const l of this.leaves) {
        if (flightSpan >= l.land) continue;              // landed: drawn as a block
        const pos = this._leafPosition(l, p);
        const d = dz(pos.x, pos.y, pos.z);
        const c = P(pos.x, pos.y, pos.z);
        const item = { c, colour: this._leafColour(l, pos.t), spin: l.spin + now / 1000 * l.spinRate,
                       r: l.size * fit.zoom * 0.5, alpha: 1,
                       squash: 0.55 + 0.45 * Math.abs(Math.cos(l.flutter + now / 900)) };
        (d < trunkDepth ? behind : front).push(item);
      }
      for (const pt of this.petals) {
        const pos = this._petalPosition(pt, p);
        if (pos.alpha <= 0.02) continue;
        const d = dz(pos.x, pos.y, pos.z);
        const c = P(pos.x, pos.y, pos.z);
        const item = { c, colour: pt.colour, spin: pt.spin + now / 1000 * pt.spinRate,
                       r: pt.size * fit.zoom * 0.5, alpha: pos.alpha,
                       squash: 0.55 + 0.45 * Math.abs(Math.cos(pt.flutter + now / 900)) };
        (d < trunkDepth ? behind : front).push(item);
      }

      const CHUNK = 48;   // subpaths per flush; see the note in _drawGround
      const ALPHA_STEPS = 5;

      /* Each season stamps its own silhouette: a five-petal blossom for the
       * cherry seasons, a pointed leaf for the rest. Fading petals are
       * quantised into a few alpha buckets so a whole cloud still costs a
       * handful of fills. */
      const blossomShape = th.leafShape === 'blossom';
      const drawLeaves = (list) => {
        if (!list.length) return;
        const buckets = new Map();
        for (const it of list) {
          const step = it.alpha >= 1 ? ALPHA_STEPS : Math.max(1, Math.round(it.alpha * ALPHA_STEPS));
          const key = it.colour + '|' + step;
          let arr = buckets.get(key);
          if (!arr) { arr = []; buckets.set(key, arr); }
          arr.push(it);
        }
        for (const [key, arr] of buckets) {
          const cut = key.lastIndexOf('|');
          g.fillStyle = key.slice(0, cut);
          const step = +key.slice(cut + 1);
          g.globalAlpha = step / ALPHA_STEPS;
          for (let i = 0; i < arr.length; i += CHUNK) {
            const end = Math.min(i + CHUNK, arr.length);
            g.beginPath();
            for (let k = i; k < end; k++) {
              const it = arr[k];
              const r = Math.max(0.6, it.r);
              const x = it.c[0], y = it.c[1];
              if (blossomShape) {
                const c2 = Math.cos(it.spin), s2 = Math.sin(it.spin);
                /* `squash` is the same edge-on foreshortening the drifting
                 * petals use, so a blossom turns over as it falls. */
                const sq = it.squash === undefined ? 1 : it.squash;
                for (let q = 0; q < 10; q++) {
                  const bx = BLOSSOM[q][0] * r, by = BLOSSOM[q][1] * r * sq;
                  const px = x + bx * c2 - by * s2;
                  const py = y + bx * s2 + by * c2;
                  if (q === 0) g.moveTo(px, py); else g.lineTo(px, py);
                }
                g.closePath();
                continue;
              }
              const cs = Math.cos(it.spin) * r, sn = Math.sin(it.spin) * r;
              const vx = -sn * 0.62, vy = cs * 0.62;
              g.moveTo(x - cs, y - sn);                       // tip
              g.lineTo(x + cs * 0.15 - vx, y + sn * 0.15 - vy); // shoulder
              g.lineTo(x + cs, y + sn);                       // tail
              g.lineTo(x + cs * 0.15 + vx, y + sn * 0.15 + vy);
              g.closePath();
            }
            g.fill();
          }
        }
        g.globalAlpha = 1;
      };

      drawLeaves(behind);

      /* Branches, back to front. */
      const sink = smoothstep(span(p, T.sink[0], T.sink[1]));
      if (sink < 1) {
        const shrink = 1 - sink;
        const segs = [];
        for (const br of this.branches) {
          const sway = this.wind * 0.16;
          const w1 = br.z1 / this.trunkTop, w2 = br.z2 / this.trunkTop;
          segs.push({
            d: dz((br.x1 + br.x2) / 2, (br.y1 + br.y2) / 2, (br.z1 + br.z2) / 2 * shrink),
            a1: P(br.x1 + sway * w1 * w1, br.y1 + sway * w1 * w1 * 0.5, br.z1 * shrink),
            a2: P(br.x2 + sway * w2 * w2, br.y2 + sway * w2 * w2 * 0.5, br.z2 * shrink),
            thick: br.thick * fit.zoom * shrink,
            thick2: br.thick2 * fit.zoom * shrink,
            depth: br.depth
          });
        }
        segs.sort((a, c) => a.d - c.d);

        /* Each limb is drawn three times across its own width — a shadowed
         * base, the bark itself, and a narrow highlight offset toward the
         * light. Three tapered slivers is all it takes to read as a round
         * branch instead of a drawn line.
         *
         * Done as three passes over every limb rather than three fills per
         * limb: a fillStyle assignment reparses the colour string, and doing
         * that ~300 times a frame cost more than all the geometry put
         * together. */
        const LX = -0.55, LY = -0.84;          // light comes from up and to the left
        const bark = th.bark;
        if (this._barkKey !== bark) {
          this._barkKey = bark;
          this._barkDark = shade(bark, -0.34);
          this._barkLit = shade(bark, 0.26);
          this._barkBody = [0, 1, 2, 3, 4].map((d) => (d === 0 ? bark : shade(bark, 0.06 * d)));
        }

        const limbPath = (s, widthK, offK) => {
          const dx = s.a2[0] - s.a1[0], dy = s.a2[1] - s.a1[1];
          const len = Math.hypot(dx, dy) || 1;
          let px = -dy / len, py = dx / len;
          if (px * LX + py * LY < 0) { px = -px; py = -py; }
          const w1 = Math.max(0.5, s.thick * widthK) * 0.5;
          const w2 = Math.max(0.35, s.thick2 * widthK) * 0.5;
          const o1 = s.thick * offK * 0.5, o2 = s.thick2 * offK * 0.5;
          g.moveTo(s.a1[0] + px * (o1 - w1), s.a1[1] + py * (o1 - w1));
          g.lineTo(s.a2[0] + px * (o2 - w2), s.a2[1] + py * (o2 - w2));
          g.lineTo(s.a2[0] + px * (o2 + w2), s.a2[1] + py * (o2 + w2));
          g.lineTo(s.a1[0] + px * (o1 + w1), s.a1[1] + py * (o1 + w1));
          g.closePath();
        };

        const limbPass = (widthK, offK, style, byDepth) => {
          if (!byDepth) {
            g.fillStyle = style;
            for (let i = 0; i < segs.length; i += 40) {
              const end2 = Math.min(i + 40, segs.length);
              g.beginPath();
              for (let k = i; k < end2; k++) limbPath(segs[k], widthK, offK);
              g.fill();
            }
            return;
          }
          for (let d = 0; d <= 4; d++) {
            g.fillStyle = this._barkBody[d];
            g.beginPath();
            let any = false;
            for (const sg of segs) {
              if (sg.depth !== d) continue;
              limbPath(sg, widthK, offK);
              any = true;
            }
            if (any) g.fill();
          }
        };

        limbPass(1.0, 0, this._barkDark, false);
        limbPass(0.72, 0.20, null, true);
        limbPass(0.26, 0.40, this._barkLit, false);

        /* Bark plates, only on the trunk where there is width enough to see. */
        for (const sg of segs) {
          if (sg.depth !== 0 || sg.thick <= 5) continue;
          const dx = sg.a2[0] - sg.a1[0], dy = sg.a2[1] - sg.a1[1];
          const len = Math.hypot(dx, dy) || 1;
          const px = -dy / len, py = dx / len;
          g.strokeStyle = shade(bark, -0.42);
          g.lineWidth = Math.max(0.7, sg.thick * 0.07);
          g.beginPath();
          const plates = Math.max(7, Math.round(len / (sg.thick * 0.55)));
          for (let k = 1; k < plates; k++) {
            const t = k / plates;
            const w = (sg.thick + (sg.thick2 - sg.thick) * t) * 0.42;
            const cxp = sg.a1[0] + dx * t, cyp = sg.a1[1] + dy * t;
            /* Staggered short strokes, kept to the shadow side. */
            const lane = ((k % 3) - 1) * 0.42;
            const from = lane - 0.26, to = lane + 0.20;
            const skew = ((k % 2) ? 0.3 : -0.3) * w;
            g.moveTo(cxp + px * w * from + dx / len * skew, cyp + py * w * from + dy / len * skew);
            g.lineTo(cxp + px * w * to + dx / len * skew, cyp + py * w * to + dy / len * skew);
          }
          g.stroke();
        }
      }

      drawLeaves(front);

      /* Leaves on their way down. The ones already resting are drawn flat on
       * the stone further up, fading, so the fall has somewhere to end. */
      if (flatten < 1) {
        g.globalAlpha = (1 - flatten) * 0.85;
        const drifting = [];
        for (const m of this.motes) {
          if (m.rest > 0) continue;
          drifting.push({ c: P(m.x, m.y, m.z), colour: m.colour,
                          spin: m.spin, r: m.size * fit.zoom * 0.5, alpha: 1 });
        }
        drawLeaves(drifting);
        g.globalAlpha = 1;
      }

      /* Petals in front fade as the code forms: nothing may drift across a
       * symbol somebody is about to scan. The layer behind carries on. */
      if (!this.reducedMotion) this._drawAmbient(g, this.ambientFront, 0.85 * (1 - inkT), this.ambCount.front);

      /* Vignette. It has to key off the code forming, not off the scan view:
       * left at full strength over the finished plaza it pulled white down to
       * about 204 and cost enough contrast to stop the code decoding outright.
       * The clear centre is widened for the same reason. */
      const vig = (th.vignette || 0) * (1 - inkT * 0.75);
      if (vig > 0.005) {
        const r = Math.hypot(this.vw, this.vh) * 0.62;
        const shade2 = g.createRadialGradient(this.vw / 2, this.vh * 0.46, r * 0.55,
                                              this.vw / 2, this.vh * 0.46, r);
        shade2.addColorStop(0, 'rgba(0,0,0,0)');
        shade2.addColorStop(1, 'rgba(0,0,0,' + vig.toFixed(3) + ')');
        g.fillStyle = shade2;
        g.fillRect(0, 0, this.vw, this.vh);
      }

      /* A flare off the plaza as the code locks in — the beat the whole
       * sequence has been building to gets a bloom of its own. */
      const flare = Math.max(0, 1 - Math.abs(p - T.flatten[0]) / 0.18);
      if (flare > 0.01) {
        const fc = P(n / 2, n / 2, 0);
        const rad = Math.max(this.vw, this.vh) * (0.35 + 0.55 * (1 - flare));
        const burst = g.createRadialGradient(fc[0], fc[1], 0, fc[0], fc[1], rad);
        const e = flare * flare;
        burst.addColorStop(0, hexToRgba(th.accent, 0.42 * e));
        burst.addColorStop(0.45, hexToRgba(th.accent, 0.16 * e));
        burst.addColorStop(1, hexToRgba(th.accent, 0));
        g.fillStyle = burst;
        g.fillRect(0, 0, this.vw, this.vh);
      }

      /* ---- the scan-line sweep that signs off the reveal ---- */
      const lock = span(p, T.lock[0], T.lock[1]);
      if (lock > 0 && lock < 1) {
        const y = lerp(0, this.vh, lock);
        const grad = g.createLinearGradient(0, y - this.vh * 0.16, 0, y + this.vh * 0.04);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.72, th.glow.replace('ALPHA', '0.30'));
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, y - this.vh * 0.16, this.vw, this.vh * 0.2);
      }
    }

    /* Paving grid; dark modules rise as blocks once their leaf has landed.
     *
     * Canvas rasterises a path in time that grows faster than the number of
     * subpaths in it, so geometry is flushed a row at a time — measurably
     * quicker than both one fill per tile and one giant path. Once the blocks
     * have collapsed to paint, the whole plot is a two-colour bitmap and goes
     * out in a single transformed drawImage. */
    _drawGround(g, P, b, paving, ink, blockH, flatten, inkT) {
      const n = this.n, p = this.progress, th = this.theme;
      this._updateLanded(p);
      const darkArr = this._dark, riseArr = this._rise, freshArr = this._fresh;
      const ex0 = b.ex[0], ex1 = b.ex[1], ey0 = b.ey[0], ey1 = b.ey[1];

      const quad = (ax, ay, bx, by, cx, cy, dx, dy) => {
        g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.lineTo(dx, dy); g.closePath();
      };

      /* --- one slab for all the light paving, then the checker on top --- */
      const c00 = P(0, 0, 0), c10 = P(n, 0, 0), c11 = P(n, n, 0), c01 = P(0, n, 0);
      g.fillStyle = paving;
      g.beginPath();
      quad(c00[0], c00[1], c10[0], c10[1], c11[0], c11[1], c01[0], c01[1]);
      g.fill();

      /* The checker is texture, not data. It has to be shaded from the already
       * brightened paving and fade out as the code takes over — otherwise every
       * light module finishes a shade darker than the quiet zone around it, and
       * that is contrast taken straight off what a scanner has to work with. */
      const checkerT = 1 - inkT;
      if (checkerT > 0.01) {
        g.fillStyle = shade(paving, -0.07 * checkerT);
        for (let gy = 0; gy < n; gy++) {
          g.beginPath();
          let any = false;
          for (let gx = (gy & 1) ? 0 : 1; gx < n; gx += 2) {
            if (darkArr[gy * n + gx]) continue;
            const o = P(gx, gy, 0);
            quad(o[0], o[1], o[0] + ex0, o[1] + ex1,
                 o[0] + ex0 + ey0, o[1] + ex1 + ey1, o[0] + ey0, o[1] + ey1);
            any = true;
          }
          if (any) g.fill();
        }
      }

      /* --- the latent code, laid into the stonework ---------------------
       * Every dark module, whether or not its leaf has landed yet, drawn just
       * far enough from the paving to be legible if you look for it. Landed
       * modules are painted over at full strength by the tops pass below, so
       * this only ever shows through where the code has yet to arrive. */
      const latent = this._allDark;
      if (latent) {
        g.fillStyle = mixHex(paving, ink, 0.20);
        for (let gy = 0; gy < n; gy++) {
          g.beginPath();
          let any = false;
          for (let gx = 0; gx < n; gx++) {
            const i = gy * n + gx;
            if (!latent[i] || darkArr[i]) continue;
            const o = P(gx, gy, 0);
            quad(o[0], o[1], o[0] + ex0, o[1] + ex1,
                 o[0] + ex0 + ey0, o[1] + ex1 + ey1, o[0] + ey0, o[1] + ey1);
            any = true;
          }
          if (any) g.fill();
        }
      }

      /* --- blocks, a row at a time: sides first, then tops --- */
      const raised = blockH > 0.0001;
      const inkEastFill = shade(ink, -0.16);
      const inkSouthFill = shade(ink, -0.3);
      const flashes = [];

      for (let gy = 0; gy < n; gy++) {
        if (raised) {
          for (let face = 0; face < 2; face++) {
            g.fillStyle = face === 0 ? inkEastFill : inkSouthFill;
            g.beginPath();
            let any = false;
            for (let gx = 0; gx < n; gx++) {
              const i = gy * n + gx;
              if (!darkArr[i]) continue;
              const h = this._blockHeight(gx, gy, i, blockH, flatten);
              if (h <= 0.0001) continue;
              const o = P(gx, gy, 0), t = P(gx, gy, h);
              if (face === 0) {
                quad(o[0] + ex0, o[1] + ex1, o[0] + ex0 + ey0, o[1] + ex1 + ey1,
                     t[0] + ex0 + ey0, t[1] + ex1 + ey1, t[0] + ex0, t[1] + ex1);
              } else {
                quad(o[0] + ey0, o[1] + ey1, o[0] + ex0 + ey0, o[1] + ex1 + ey1,
                     t[0] + ex0 + ey0, t[1] + ex1 + ey1, t[0] + ey0, t[1] + ey1);
              }
              any = true;
            }
            if (any) g.fill();
          }
        }

        g.fillStyle = ink;
        g.beginPath();
        let any = false;
        for (let gx = 0; gx < n; gx++) {
          const i = gy * n + gx;
          if (!darkArr[i]) continue;
          const h = raised ? this._blockHeight(gx, gy, i, blockH, flatten) : 0;
          const t = P(gx, gy, h);
          if (freshArr[i] > 0.01) { flashes.push({ t, f: freshArr[i] }); continue; }
          quad(t[0], t[1], t[0] + ex0, t[1] + ex1,
               t[0] + ex0 + ey0, t[1] + ex1 + ey1, t[0] + ey0, t[1] + ey1);
          any = true;
        }
        if (any) g.fill();
      }

      /* Grass growing out of the code's dark modules. Kept short and inside the
       * cell — blades that overhang would blur the very edges a scanner keys
       * on. Flushed a row at a time, like everything else here. */
      if (inkT > 0.06 && th.moduleBlade) {
        /* The same tapered, curved blade the verge is planted with, sized to a
         * cell. Height and sway are both held down deliberately: grass that
         * overhangs its module would soften the edges a scanner keys on, so
         * this reads as turf without ever leaving the square it grows in. */
        g.fillStyle = th.moduleBlade;
        g.globalAlpha = Math.min(1, inkT * 1.25);
        const H = 0.5 * inkT;
        const cellPx = Math.hypot(ex0, ex1);
        const wpx = Math.max(0.5, cellPx * 0.085);
        const gust = Math.sin(performance.now() / 900) * 0.04 * this.wind;
        for (let gy = 0; gy < n; gy++) {
          g.beginPath();
          let any = false;
          for (let gx = 0; gx < n; gx++) {
            if (!darkArr[gy * n + gx]) continue;
            const hash = (Math.imul(gx + 1, 73856093) ^ Math.imul(gy + 1, 19349663)) >>> 0;
            for (let b = 0; b < 4; b++) {
              const r1 = ((hash >> (b * 6)) & 255) / 255;
              const r2 = ((hash >> (b * 6 + 8)) & 255) / 255;
              const bx = gx + 0.18 + r1 * 0.64;
              const by = gy + 0.18 + r2 * 0.64;
              const lean = (r1 - 0.5) * 0.3 + gust;
              const h = H * (0.62 + r2 * 0.6);
              const b0 = P(bx, by, 0);
              const mid = P(bx + lean * 0.34, by + lean * 0.12, h * 0.6);
              const tip = P(bx + lean, by + lean * 0.3, h);
              g.moveTo(b0[0] - wpx, b0[1]);
              g.quadraticCurveTo(mid[0] - wpx * 0.35, mid[1], tip[0], tip[1]);
              g.quadraticCurveTo(mid[0] + wpx * 0.35, mid[1], b0[0] + wpx, b0[1]);
              g.closePath();
              any = true;
            }
          }
          if (any) g.fill();
        }
        g.globalAlpha = 1;
      }

      /* Freshly landed modules flash warm; there are never many at once. */
      for (const fl of flashes) {
        g.fillStyle = mixHex(ink, th.glowSolid, fl.f);
        g.beginPath();
        const t = fl.t;
        quad(t[0], t[1], t[0] + ex0, t[1] + ex1,
             t[0] + ex0 + ey0, t[1] + ex1 + ey1, t[0] + ey0, t[1] + ey1);
        g.fill();
      }
    }

    /* A one-pixel-per-module image of the finished code. */
    _paintTexture(paving, ink) {
      const n = this.n;
      if (!this._tex || this._tex.width !== n) {
        this._tex = document.createElement('canvas');
        this._tex.width = this._tex.height = n;
        this._texKey = null;
      }
      const key = paving + '|' + ink;
      if (this._texKey === key) return;
      this._texKey = key;

      const c = this._tex.getContext('2d');
      const img = c.createImageData(n, n);
      const parse = (hex) => {
        const v = parseInt(hex.slice(1), 16);
        return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
      };
      const lt = parse(paving), dk = parse(ink);
      const dark = this._dark;
      for (let i = 0; i < n * n; i++) {
        const s = dark[i] ? dk : lt;
        const o = i * 4;
        img.data[o] = s[0]; img.data[o + 1] = s[1]; img.data[o + 2] = s[2]; img.data[o + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    }


    /* Height of one module: its landing pop, plus the passing shockwave. */
    _blockHeight(gx, gy, i, blockH, flatten) {
      let h = blockH * this._rise[i];
      if (this.shockwave >= 0) {
        const n = this.n;
        const d = Math.hypot(gx + 0.5 - n / 2, gy + 0.5 - n / 2);
        const w = 1 - clamp(Math.abs(d - this.shockwave) / (n * 0.13), 0, 1);
        h += w * w * 0.6 * (1 - flatten);
      }
      return h;
    }

    _updateLanded(p) {
      const n = this.n, count = n * n;
      if (!this._dark || this._dark.length !== count) {
        this._dark = new Uint8Array(count);
        this._rise = new Float32Array(count);
        this._fresh = new Float32Array(count);
      }
      this._dark.fill(0);
      const flightSpan = span(p, T.flight[0], T.flight[1]);
      for (const l of this.leaves) {
        if (flightSpan < l.land) continue;
        const i = l.ty * n + l.tx;
        const since = flightSpan - l.land;
        this._dark[i] = 1;
        this._rise[i] = easeOutBack(clamp(since / 0.055, 0, 1));
        /* `fresh` drives a brief flash as the block settles into place. */
        this._fresh[i] = clamp(1 - since / 0.14, 0, 1);
      }
    }

    _quad(g, a, b2, c, d, fill, alpha) {
      if (fill) g.fillStyle = fill;
      if (alpha !== undefined) g.globalAlpha = alpha;
      g.beginPath();
      g.moveTo(a[0], a[1]); g.lineTo(b2[0], b2[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]);
      g.closePath();
      g.fill();
      if (alpha !== undefined) g.globalAlpha = 1;
    }

    /* ------------------------------------------------------------- plumbing */
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const vw = Math.max(1, rect.width);
      const vh = Math.max(1, rect.height);
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const w = Math.round(vw * dpr), h = Math.round(vh * dpr);
      if (w === this.canvas.width && h === this.canvas.height && this.vw === vw) return;
      this.vw = vw;
      this.vh = vh;
      this.dpr = dpr;
      this.canvas.width = w;
      this.canvas.height = h;
      this.draw(0);
    }

    _bindPointer() {
      const c = this.canvas;
      let dragging = false, lastX = 0, moved = 0;

      const down = (e) => {
        dragging = true; moved = 0;
        this.cineHold = true;
        clearTimeout(this._cineTimer);
        lastX = (e.touches ? e.touches[0].clientX : e.clientX);
      };
      const move = (e) => {
        const x = (e.touches ? e.touches[0].clientX : e.clientX);
        const y = (e.touches ? e.touches[0].clientY : e.clientY);
        const rect = c.getBoundingClientRect();
        if (dragging) {
          const dx = x - lastX;
          lastX = x;
          moved += Math.abs(dx);
          this.userYawTarget = clamp(this.userYawTarget + dx * 0.005, -0.62, 0.62);
          this.start();
        } else if (!e.touches) {
          this.parallax.tx = (x - rect.left - rect.width / 2) * 0.05;
          this.parallax.ty = (y - rect.top - rect.height / 2) * 0.02;
          this.start();
        }
      };
      const up = () => {
        if (dragging && moved < 6) this.toggle();
        if (dragging) {
          clearTimeout(this._cineTimer);
          this._cineTimer = setTimeout(() => { this.cineHold = false; this.start(); }, 4500);
        }
        dragging = false;
      };

      c.addEventListener('pointerdown', down);
      global.addEventListener('pointermove', move);
      global.addEventListener('pointerup', up);
      c.addEventListener('pointerleave', () => { this.parallax.tx = 0; this.parallax.ty = 0; });
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(); }
      });
    }
  }

  global.Grove = { Scene, mixHex, shade };
})(window);
