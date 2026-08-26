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

  /* A five-petal blossom, precomputed as unit points. Sampled around a
   * raised-cosine lobe rather than alternating two radii: the exponent below 1
   * gives broad round petals split by a narrow notch, which is what separates
   * sakura from an asterisk. */
  const BLOSSOM = (() => {
    const pts = [], N = 20;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU - Math.PI / 2;
      const lobe = Math.pow(Math.abs(Math.cos(2.5 * a)), 0.55);
      const r = 0.52 + 0.48 * lobe;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  })();

  /* Dark patches on the face, in units of the moon's radius. Every reference
   * reads as the moon because of these; the latent code on its own is far too
   * faint to do that job. */
  const MARIA = [
    { x: -0.30, y: -0.26, r: 0.40, a: 1.00 },
    { x:  0.16, y: -0.40, r: 0.27, a: 0.75 },
    { x:  0.34, y:  0.05, r: 0.34, a: 0.85 },
    { x: -0.10, y:  0.30, r: 0.30, a: 0.60 },
    { x: -0.46, y:  0.24, r: 0.22, a: 0.55 },
    { x:  0.06, y: -0.06, r: 0.18, a: 0.50 }
  ];

  /* Phase boundaries as fractions of the reveal, so overlaps are easy to see. */
  const T = {
    revealDuration: 2000,
    regrowDuration: 1500,
    gust:     [0.00, 0.16],   // the branch shivers, blossom begins to let go
    flight:   [0.04, 0.62],   // blossom crosses to the moon and settles
    withdraw: [0.34, 0.70],   // the emptied branch draws back off frame
    ink:      [0.30, 0.88],   // the face brightens, the modules go dark
    push:     [0.06, 0.74],   // the camera leaves the tree and closes on the moon
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
    _moon(push) {
      const t = push === undefined ? 0 : push;
      const s = Math.min(this.vw, this.vh);
      /* The moon holds the middle of the frame throughout — it has to, since
       * the code is inscribed in it and a phone has to read it. The reveal only
       * closes the last little distance as the blossom parts. */
      const full = Math.min(this.vw * 0.46, this.vh * 0.36);
      const r = lerp(full * 0.84, full, t);
      const cx = lerp(this.vw * 0.53, this.vw / 2, t) + this.drift.x * 0.35 * (1 - t * 0.6);
      const cy = lerp(this.vh * 0.42, this.vh * 0.46, t) + this.drift.y * 0.35 * (1 - t * 0.6);
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

      /* Cherry bark is read by its lenticels — short horizontal dashes across
       * the grain. Seeded once per limb so they hold still while it sways. */
      const bark = (thick, rnd) => {
        if (thick < 0.011) return null;
        const cnt = 3 + (rnd() * 5 | 0);
        const out = [];
        for (let q = 0; q < cnt; q++) {
          /* Short and scattered across the width. Long ones spaced one per
           * segment read as bamboo nodes rather than lenticels. */
          out.push({ u: 0.04 + rnd() * 0.92, w: 0.10 + rnd() * 0.20, o: (rnd() - 0.5) * 1.25 });
        }
        return out;
      };

      const grow = (x, y, dx, dy, len, thick, depth, phase) => {
        /* Each limb is laid down as a run of short segments that turn a little
         * at every step, so it arrives as a curve. Drawn as one straight quad
         * it read as a chopstick, and a node of them as a folding fan. */
        const SEG = 5;
        const curl = (rand() - 0.5) * 1.45;
        const droop = (0.12 + depth * 0.05) / SEG;
        const endThick = thick * 0.64;
        let px = x, py = y, ux = dx, uy = dy;
        for (let k = 0; k < SEG; k++) {
          const a = curl / SEG;
          const rx = ux * Math.cos(a) - uy * Math.sin(a);
          const ry = ux * Math.sin(a) + uy * Math.cos(a) + droop;
          const m0 = Math.hypot(rx, ry) || 1;
          ux = rx / m0; uy = ry / m0;
          const qx = px + ux * (len / SEG), qy = py + uy * (len / SEG);
          const t1 = lerp(thick, endThick, k / SEG);
          limbs.push({ x1: px, y1: py, x2: qx, y2: qy,
                       thick: t1, thick2: lerp(thick, endThick, (k + 1) / SEG),
                       depth, phase: phase + k * 0.26, marks: bark(t1, rand) });
          px = qx; py = qy;
        }
        /* Spread is how far blossom scatters from a node, and it has to stay
         * small. At a fraction of the branch length it threw blossom across a
         * quarter of the viewport and the canopy detached from the bough. */
        if (depth >= 4 || len < 0.035) { tips.push({ x: px, y: py, spread: 0.028 }); return; }
        tips.push({ x: px, y: py, spread: 0.020 });
        const kids = rand() < 0.72 ? 2 : 1;
        for (let i = 0; i < kids; i++) {
          const turn = (i === 0 ? -1 : 1) * (0.20 + rand() * 0.5) + (rand() - 0.5) * 0.2;
          const nx = ux * Math.cos(turn) - uy * Math.sin(turn);
          const ny = ux * Math.sin(turn) + uy * Math.cos(turn) + 0.10;
          const m = Math.hypot(nx, ny) || 1;
          grow(px, py, nx / m, ny / m, len * (0.60 + rand() * 0.18), thick * 0.66,
               depth + 1, phase + SEG * 0.26);
        }
      };

      /* A trunk running the full height of the near edge, bare wood, flagged so
       * no blossom is hung on it. This is the thing that makes the frame read as
       * standing under a tree rather than looking at one. */
      const trunk = [];
      {
        let px = 0.985, py = 1.16, ux = -0.03, uy = -1;
        const m0 = Math.hypot(ux, uy); ux /= m0; uy /= m0;
        const SEG = 20, len = 1.5, thick = 0.082, endThick = 0.036;
        const bow = -0.13;
        for (let k = 0; k < SEG; k++) {
          /* A total bow shared across the segments, plus a little wander. Dead
           * straight reads as a fence post; a per-step constant accumulates and
           * swings the whole trunk off frame. */
          const a = bow / SEG + (rand() - 0.5) * 0.055;
          const rx = ux * Math.cos(a) - uy * Math.sin(a);
          const ry = ux * Math.sin(a) + uy * Math.cos(a);
          const mm = Math.hypot(rx, ry) || 1; ux = rx / mm; uy = ry / mm;
          const qx = px + ux * (len / SEG), qy = py + uy * (len / SEG);
          /* A continuous swell along the trunk, so the silhouette is not two
           * parallel rules. Phase is shared between the two ends of a segment
           * so neighbours still meet flush. */
          const gnarl = (t) => 1 + 0.085 * Math.sin(t * 5.1 + 0.7) + 0.045 * Math.sin(t * 11.3);
          const t1 = lerp(thick, endThick, k / SEG) * gnarl(k);
          trunk.push({ x1: px, y1: py, x2: qx, y2: qy,
                       thick: t1, thick2: lerp(thick, endThick, (k + 1) / SEG) * gnarl(k + 1),
                       depth: 0, trunk: true, phase: k * 0.09, marks: bark(t1, rand) });
          px = qx; py = qy;
        }
        for (const t of trunk) limbs.push(t);
      }

      /* Boughs reaching in from the trunk and from three edges, so the moon is
       * veiled on every side but the middle. Aimed to cross the disc without
       * converging on its centre — the code has to resolve there. */
      const at = (f) => trunk[Math.min(trunk.length - 1, Math.round(f * (trunk.length - 1)))];
      const arms = [
        { from: at(0.88), dx: -0.94, dy: -0.30, len: 0.20, thick: 0.021 },
        { from: at(0.74), dx: -0.99, dy: -0.09, len: 0.17, thick: 0.018 },
        { from: at(0.60), dx: -0.97, dy:  0.16, len: 0.21, thick: 0.020 },
        { from: at(0.46), dx: -0.86, dy:  0.30, len: 0.14, thick: 0.015 },
        { from: at(0.30), dx: -0.90, dy:  0.36, len: 0.17, thick: 0.017 },
        /* in from the corners and edges, so blossom rings the frame and the
         * middle of the disc stays clear enough to read */
        { x: -0.10, y: -0.06, dx:  0.84, dy:  0.50, len: 0.22, thick: 0.020 },
        { x: -0.10, y:  0.30, dx:  0.92, dy:  0.20, len: 0.16, thick: 0.016 },
        { x: -0.10, y:  0.74, dx:  0.90, dy: -0.16, len: 0.16, thick: 0.016 },
        { x: -0.10, y:  1.06, dx:  0.92, dy: -0.30, len: 0.22, thick: 0.019 },
        { x:  0.42, y:  1.14, dx:  0.30, dy: -0.95, len: 0.15, thick: 0.015 }
      ];
      arms.forEach((a, i) => {
        const x = a.from ? a.from.x2 : a.x, y = a.from ? a.from.y2 : a.y;
        const m = Math.hypot(a.dx, a.dy);
        grow(x, y, a.dx / m, a.dy / m, a.len, a.thick, 1, 0.7 + i * 0.55);
      });

      /* Where blown blossom reckons "away" from — the foot of the trunk. */
      this.entry = { x: 0.95, y: 1.0, dx: -0.9, dy: -0.2 };
      this.limbs = limbs;
      this.tips = tips;
    }

    /* One blossom per dark module, plus blossom that carries no data so the
     * branch looks laden rather than counted out. */
    _buildBlossoms() {
      const qr = this.qr, n = this.n;
      const rand = mulberry32(hashString('bloom:' + qr.version + ':' + qr.mask + ':' + n));

      /* How much room a module has to spill into: a module ringed by other
       * dark ones can wear a fat blossom, an isolated one has to stay inside
       * its cell or it eats the contrast a scanner needs. */
      const dk = (x, y) => (x < 0 || y < 0 || x >= n || y >= n) ? 0 : this._allDark[y * n + x];
      const targets = [];
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (!qr.get(x, y)) continue;
          const open = 4 - (dk(x - 1, y) + dk(x + 1, y) + dk(x, y - 1) + dk(x, y + 1));
          targets.push({ x, y, role: global.QR.moduleRole(qr, x, y), bed: 0.52 + (4 - open) * 0.065 });
        }
      }

      /* Blossom sites run the length of every limb, not just its end. Hanging
       * it all off the nodes gives a row of discrete pom-poms; spreading it
       * along the wood is what makes a bough look laden. */
      const sites = [];
      for (const L of this.limbs) {
        if (L.trunk) continue;
        const len = Math.hypot(L.x2 - L.x1, L.y2 - L.y1);
        /* Few sites, each wide. Many tight ones sleeved every limb in an even
         * tube of pink; sakura clusters in puffs with wood showing between. */
        const count = Math.max(1, Math.round(len * 34));
        const ux = (L.x2 - L.x1) / (len || 1), uy = (L.y2 - L.y1) / (len || 1);
        for (let i = 0; i < count; i++) {
          const u = 0.1 + rand() * 0.9;
          const off = (rand() - 0.5) * 0.05;
          sites.push({
            x: lerp(L.x1, L.x2, u) - uy * off,
            y: lerp(L.y1, L.y2, u) + ux * off + 0.008,
            spread: (0.026 + L.depth * 0.012) * (0.6 + rand() * 0.9),
            depth: L.depth, phase: L.phase
          });
        }
      }
      const site = (i) => sites[(i * 7 + 3) % sites.length];
      const place = (s) => {
        const a = rand() * TAU, rr = s.spread * Math.pow(rand(), 0.55);
        /* Flattened and biased downward — blossom hangs off a bough. */
        return { hx: s.x + Math.cos(a) * rr, hy: s.y + Math.sin(a) * rr * 0.62 + rr * 0.35 };
      };

      /* Blossom veils the moon, but the middle of the disc is where the code has
       * to read, so density falls off toward the centre instead of stopping at a
       * hard edge — a clean hole would look cut out, and a full cover made the
       * finder patterns unfindable. Fractions of the viewport, not of the moon,
       * because homes are built once and have to survive a resize. */
      const clearCentre = (x, y) => {
        const dx = (x - 0.5) / 0.28, dy = (y - 0.44) / 0.23;
        const d = Math.hypot(dx, dy);
        return d >= 1 || rand() < 0.12 + 0.84 * d;
      };
      const home = (s, i) => {
        let h = place(s);
        for (let k = 0; k < 6 && !clearCentre(h.hx, h.hy); k++) h = place(site(i + k * 31));
        return h;
      };

      this.blossoms = targets.map((t, i) => {
        const s = site(i);
        const h = home(s, i);
        /* Finder patterns settle first — they are what a scanner hunts for, and
         * watching the three corners arrive first reads as intent. */
        const priority = clamp(
          t.role === 'finder' ? 0.02 :
          t.role === 'timing' ? 0.16 :
          0.28 + rand() * 0.62, 0, 1);
        const dur = 0.3 + rand() * 0.16;
        return {
          hx: h.hx, hy: h.hy, depth: s.depth, phase: s.phase,
          tx: t.x, ty: t.y, role: t.role, bed: t.bed,
          dur, delay: priority * (1 - dur), land: priority * (1 - dur) + dur,
          arc: (rand() - 0.5) * 0.5,
          size: 1.0 + rand() * 0.55,
          spin: rand() * TAU, spinRate: (rand() - 0.5) * 5,
          flutter: rand() * TAU,
          tone: rand()
        };
      });

      const extra = Math.round(clamp(2100 - targets.length, 850, 1500));
      this.filler = [];
      for (let i = 0; i < extra; i++) {
        const s = site(i * 3 + 1);
        const h = place(s);
        /* Filler carries no module, so it is simply dropped near the centre
         * rather than re-sited — that is what thins the veil over the code. */
        if (!clearCentre(h.hx, h.hy)) continue;
        const away = Math.atan2(h.hy - this.entry.y, h.hx - this.entry.x) + (rand() - 0.5) * 1.2;
        this.filler.push({
          hx: h.hx, hy: h.hy, depth: s.depth, phase: s.phase,
          dx: Math.cos(away) * (0.4 + rand() * 0.8),
          dy: Math.sin(away) * (0.3 + rand() * 0.7) + 0.35,
          delay: rand() * 0.5,
          bud: rand() < 0.22,
          size: 0.85 + rand() * 0.55,
          spin: rand() * TAU, spinRate: (rand() - 0.5) * 8,
          flutter: rand() * TAU,
          tone: rand()
        });
      }
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
        swayAmp: 0.010 + rand() * 0.020,
        swayFreq: 0.26 + rand() * 0.46,
        swayPhase: rand() * TAU,
        spin: rand() * TAU, spinRate: (rand() - 0.5) * 0.7,
        flip: rand() * TAU, flipRate: 0.32 + rand() * 0.62,
        tone: rand()
      }));
      this.petalsBack = make(22, false);
      this.petalsFront = make(26, true);
    }

    _recolour() {
      if (!this.theme) return;
      const pal = this.theme.leaf;
      this._fadeCache.clear();
      /* Blossom in front of the moon picks up its light — every reference shows
       * the flowers crossing the disc reading paler than the ones against sky. */
      this._litPal = pal.map(c => mixHex(c, '#ffffff', 0.24));
      /* Cherry centres are a small warm boss where the stamens sit. Tied to the
       * bark colour so it stays right across all three moods. */
      this._corePal = [
        mixHex(pal[4], shade(this.theme.branch, 0.18), 0.38),
        mixHex(pal[2], shade(this.theme.branch, 0.40), 0.30)
      ];
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
    /* Branch and the blossom still on it are foreground. As the reveal runs they
     * scale outward about the moon and fade, so the camera reads as pushing
     * through the blossom rather than the tree sliding sideways — which is the
     * only move that works when boughs come in from three different edges. */
    _fg(push, withdraw) {
      const m = this._moonCache;
      const k = 1 + push * 0.30 + easeInCubic(withdraw) * 1.9;
      return {
        k,
        fx: (v) => (m.cx + (v * this.vw - m.cx) * k) / this.vw,
        fy: (v) => (m.cy + (v * this.vh - m.cy) * k) / this.vh,
        /* All the way to zero. Stopping at 0.05 left the withdrawn branches as
         * pale scratches across the finished code, right where a scanner is
         * looking for clean contrast. */
        alpha: 1 - smoothstep(withdraw)
      };
    }

    /* One sway field, sampled by the wood and by every blossom hanging off it,
     * so a cluster and its branch move as a single thing. Each petal having its
     * own phase is what made the tree shimmer instead of sway — from a distance
     * independent jitter averages out to no motion at all, just noise.
     *
     * Mostly vertical, amplitude growing toward the tips, and phase running out
     * along the limb so the lift travels rather than the whole tree pulsing. */
    _swayAt(depth, phase, now) {
      const t = now / 1000;
      const amp = (0.0020 + depth * 0.0032) * (0.6 + this.wind * 0.45);
      const a = Math.sin(t * 0.62 - phase);
      const b = Math.sin(t * 0.37 - phase * 1.6);
      return { dx: amp * (a * 0.40 + b * 0.16), dy: amp * (a * 0.95 + b * 0.38) };
    }

    _blossomAt(b, p) {
      const flight = span(p, T.flight[0], T.flight[1]);
      const local = clamp((flight - b.delay) / b.dur, 0, 1);
      const m = this._moonCache, fg = this._fgCache;
      const hx = fg ? fg.fx(b.hx) : b.hx, hy = fg ? fg.fy(b.hy) : b.hy;
      if (local <= 0) {
        const sw = this._swayAt(b.depth, b.phase, performance.now());
        return { x: hx + sw.dx, y: hy + sw.dy, t: 0, landed: false };
      }
      const tx = (m.x0 + (b.tx + 0.5) * m.module) / this.vw;
      const ty = (m.y0 + (b.ty + 0.5) * m.module) / this.vh;
      if (local >= 1) return { x: tx, y: ty, t: 1, landed: true };
      const e = easeInOutCubic(local);
      /* A sideways bow on the path, so the swarm sweeps across rather than
       * converging in a straight line. */
      const bow = Math.sin(local * Math.PI) * b.arc;
      const px = -(ty - hy), py = (tx - hx);
      const pm = Math.hypot(px, py) || 1;
      return {
        x: lerp(hx, tx, e) + (px / pm) * bow,
        y: lerp(hy, ty, e) + (py / pm) * bow,
        t: local, landed: false
      };
    }

    _fillerAt(f, p) {
      const blow = span(p, T.gust[0], 0.6);
      const t = clamp((blow - f.delay) / (1 - f.delay || 1), 0, 1);
      const fg = this._fgCache;
      const hx = fg ? fg.fx(f.hx) : f.hx, hy = fg ? fg.fy(f.hy) : f.hy;
      if (t <= 0) {
        const sw = this._swayAt(f.depth, f.phase, performance.now());
        return { x: hx + sw.dx, y: hy + sw.dy, alpha: 1 };
      }
      const e = easeInCubic(t);
      return { x: hx + f.dx * e, y: hy + f.dy * e, alpha: 1 - t * t };
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
      const push = smoothstep(span(p, T.push[0], T.push[1]));
      const m = this._moonCache = this._moon(push);
      const inkT = smoothstep(span(p, T.ink[0], T.ink[1]));
      const lock = span(p, T.lock[0], T.lock[1]);
      const withdraw = smoothstep(span(p, T.withdraw[0], T.withdraw[1]));
      const fg = this._fgCache = this._fg(push, withdraw);
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
      this._paintFace(face, mixHex(face, th.maria, 0.30 + inkT * 0.5), mixHex(th.maria, th.moduleInk, inkT));
      g.save();
      g.beginPath();
      g.arc(m.cx, m.cy, m.r * 0.995, 0, TAU);
      g.clip();
      g.imageSmoothingEnabled = false;
      g.drawImage(this._tex, m.x0, m.y0, this.n * m.module, this.n * m.module);
      /* Maria over the face, inside the same clip. Drawn after the code rather
       * than under it — the code bitmap is opaque across the whole inscribed
       * square, so underneath they would only ever show in the corners. They
       * fade out as the face goes to paper, so they never cost the scanner. */
      if (inkT < 0.98) {
        for (const s of MARIA) {
          const bx = m.cx + s.x * m.r, by = m.cy + s.y * m.r, br = s.r * m.r;
          const gr = g.createRadialGradient(bx, by, 0, bx, by, br);
          const tone = mixHex(th.maria, th.moonLimb, 0.5);
          gr.addColorStop(0, rgba(tone, 0.55 * (1 - inkT) * s.a));
          gr.addColorStop(0.62, rgba(tone, 0.27 * (1 - inkT) * s.a));
          gr.addColorStop(1, rgba(tone, 0));
          g.fillStyle = gr;
          g.fillRect(bx - br, by - br, br * 2, br * 2);
        }
      }
      g.restore();

      /* ---- the branch, drawing back off frame as it empties ---- */
      if (fg.alpha > 0.02) {
        g.globalAlpha = fg.alpha;
        const barkDark = shade(th.branch, -0.55);
        const barkLit = shade(th.branch, 0.30);
        const sBase = Math.min(this.vw, this.vh) * fg.k;

        /* Geometry once per limb, shared by both the thin and the fat path. */
        const quad = (L) => {
          const sw = this._swayAt(L.depth, L.phase, now);
          let ax = fg.fx(L.x1) * this.vw + sw.dx * this.vw;
          let ay = fg.fy(L.y1) * this.vh + sw.dy * this.vh;
          let bx = fg.fx(L.x2) * this.vw + sw.dx * this.vw;
          let by = fg.fy(L.y2) * this.vh + sw.dy * this.vh;
          const dx = bx - ax, dy = by - ay;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          const w1 = Math.max(0.6, L.thick * sBase) * 0.5;
          const w2 = Math.max(0.4, L.thick2 * sBase) * 0.5;
          /* Run each quad a little past both ends. Butt-jointed trapezoids
           * leave a hairline of sky at every turn, which striped the trunk
           * with dark rungs. */
          const cap = Math.max(w1, w2) * 0.6;
          ax -= ux * cap; ay -= uy * cap; bx += ux * cap; by += uy * cap;
          return { ax, ay, bx, by, ux, uy, px: -uy, py: ux, w1, w2 };
        };

        /* Anything wide enough to see across gets a real gradient over its
         * width. Discrete width passes stack into hard vertical stripes, which
         * is what made the trunk read as bamboo. */
        const fat = [], thin = [];
        for (const L of this.limbs) (L.thick * sBase >= 9 ? fat : thin).push(L);

        for (const L of fat) {
          const q = quad(L);
          const w = Math.max(q.w1, q.w2);
          const mx = (q.ax + q.bx) / 2, my = (q.ay + q.by) / 2;
          const lit = q.px * -0.5 + q.py * -0.86;
          const grad = g.createLinearGradient(
            mx - q.px * w, my - q.py * w, mx + q.px * w, my + q.py * w);
          /* Highlight sits where the light actually falls, not down the middle. */
          const hs = clamp(0.5 - lit * 0.26, 0.18, 0.82);
          grad.addColorStop(0, barkDark);
          grad.addColorStop(clamp(hs - 0.30, 0.04, 0.9), mixHex(barkDark, th.branch, 0.7));
          grad.addColorStop(hs, barkLit);
          grad.addColorStop(clamp(hs + 0.28, 0.1, 0.96), th.branch);
          grad.addColorStop(1, shade(barkDark, -0.15));
          g.fillStyle = grad;
          g.beginPath();
          g.moveTo(q.ax + q.px * -q.w1, q.ay + q.py * -q.w1);
          g.lineTo(q.bx + q.px * -q.w2, q.by + q.py * -q.w2);
          g.lineTo(q.bx + q.px * q.w2, q.by + q.py * q.w2);
          g.lineTo(q.ax + q.px * q.w1, q.ay + q.py * q.w1);
          g.closePath();
          g.fill();
        }

        /* Twigs are a few pixels across; three flat tones is plenty and a
         * gradient apiece would not survive the count. */
        const pass = (widthK, offK, style) => {
          g.fillStyle = style;
          for (let i = 0; i < thin.length; i += 40) {
            const end = Math.min(i + 40, thin.length);
            g.beginPath();
            for (let k = i; k < end; k++) {
              const L = thin[k], q = quad(L);
              const lit = q.px * -0.5 + q.py * -0.86;
              const w1 = q.w1 * widthK, w2 = q.w2 * widthK;
              const o1 = q.w1 * offK * lit, o2 = q.w2 * offK * lit;
              g.moveTo(q.ax + q.px * (o1 - w1), q.ay + q.py * (o1 - w1));
              g.lineTo(q.bx + q.px * (o2 - w2), q.by + q.py * (o2 - w2));
              g.lineTo(q.bx + q.px * (o2 + w2), q.by + q.py * (o2 + w2));
              g.lineTo(q.ax + q.px * (o1 + w1), q.ay + q.py * (o1 + w1));
              g.closePath();
            }
            g.fill();
          }
        };
        pass(1.00, 0.00, barkDark);
        pass(0.66, 0.22, th.branch);
        pass(0.28, 0.40, barkLit);
        g.globalAlpha = 1;
        this._barkMarks(g, fg, th, now);
      }

      /* ---- blossom: still on the branch, in flight, or landed ---- */
      const items = [];
      const s = Math.min(this.vw, this.vh);
      const settled = this._settledTones();
      for (const b of this.blossoms) {
        const at = this._blossomAt(b, p);
        if (at.landed) {
          /* A landed blossom does not become paint. The module underneath is
           * already inked for the scanner; the blossom sits on it so the
           * finished code still reads as a tree in flower. */
          items.push({
            x: m.x0 + (b.tx + 0.5) * m.module,
            y: m.y0 + (b.ty + 0.5) * m.module,
            r: m.module * b.bed,
            colour: settled[(b.tone * settled.length) | 0] || settled[0],
            spin: b.spin, squash: 1, alpha: 1
          });
          continue;
        }
        const onBranch = at.t <= 0;
        const bx = at.x * this.vw, by = at.y * this.vh;
        const onMoon = onBranch &&
          (bx - m.cx) * (bx - m.cx) + (by - m.cy) * (by - m.cy) < m.r * m.r;
        items.push({
          x: bx, y: by,
          r: b.size * s * 0.017 * (onBranch ? fg.k : 1),
          colour: onMoon ? this._litPal[b.colourIdx] : this._blossomColour(b, at.t),
          core: this._corePal[b.tone < 0.5 ? 0 : 1],
          spin: onBranch ? b.spin : b.spin + now / 1000 * b.spinRate,
          /* A wide squash range is what gives a few flowers edge-on, the way a
           * real spray shows some faces and some profiles. */
          squash: onBranch ? 0.44 + 0.56 * Math.abs(Math.cos(b.flutter))
                           : 0.55 + 0.45 * Math.abs(Math.cos(b.flutter + now / 900)),
          alpha: onBranch ? fg.alpha : 1
        });
      }
      for (const f of this.filler) {
        const at = this._fillerAt(f, p);
        if (at.alpha <= 0.02) continue;
        const onBranch = at.alpha >= 1;
        const fx = at.x * this.vw, fy = at.y * this.vh;
        const onMoon = onBranch &&
          (fx - m.cx) * (fx - m.cx) + (fy - m.cy) * (fy - m.cy) < m.r * m.r;
        items.push({
          x: fx, y: fy,
          r: f.size * s * 0.016 * (onBranch ? fg.k : 1),
          colour: onMoon ? this._litPal[f.colourIdx] : f.colour,
          core: this._corePal[f.tone < 0.5 ? 0 : 1],
          bud: f.bud,
          spin: onBranch ? f.spin : f.spin + now / 1000 * f.spinRate,
          squash: onBranch ? 0.44 + 0.56 * Math.abs(Math.cos(f.flutter))
                           : 0.55 + 0.45 * Math.abs(Math.cos(f.flutter + now / 900)),
          alpha: at.alpha * (onBranch ? fg.alpha : 1)
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
    /* Landed blossom keeps a little tonal variation so a filled region reads
     * as many flowers rather than one dark mass — all of it still well inside
     * the module ink, which is what the contrast budget is spent on. */
    _settledTones() {
      const th = this.theme;
      const key = th.moduleInk + th.leaf[2];
      if (this._tonesFor !== key) {
        this._tonesFor = key;
        /* Pulled a fifth of the way toward the mood's blossom so a filled
         * module reads as dark sakura rather than ink. Contrast against the
         * moon face stays around 10:1, well past anything a scanner needs. */
        const base = mixHex(th.moduleInk, th.leaf[2], 0.2);
        this._tones = [-0.16, -0.05, 0.06, 0.17, 0.28].map(k => shade(base, k));
      }
      return this._tones;
    }

    /* Bark. Cherry reads by its lenticels — short dashes across the grain, each
     * with a lit edge just below it. Drawn after the tone passes and inset well
     * inside the limb width so none of it lands on sky. */
    _barkMarks(g, fg, th, now) {
      if (fg.alpha <= 0.02) return;
      const s = Math.min(this.vw, this.vh) * fg.k;
      const tone = [shade(th.branch, -0.62), shade(th.branch, 0.40)];
      for (let pass = 0; pass < 2; pass++) {
        g.fillStyle = tone[pass];
        g.globalAlpha = (pass ? 0.26 : 0.42) * fg.alpha;
        g.beginPath();
        let n = 0;
        for (const L of this.limbs) {
          if (!L.marks) continue;
          const sw = this._swayAt(L.depth, L.phase, now);
          const ax = fg.fx(L.x1) * this.vw + sw.dx * this.vw;
          const ay = fg.fy(L.y1) * this.vh + sw.dy * this.vh;
          const dx = fg.fx(L.x2) * this.vw + sw.dx * this.vw - ax;
          const dy = fg.fy(L.y2) * this.vh + sw.dy * this.vh - ay;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len, px = -uy, py = ux;
          for (const mk of L.marks) {
            const w = lerp(L.thick, L.thick2, mk.u) * s;
            if (w < 3) continue;
            const ta = Math.max(0.5, w * 0.048);
            const shift = pass ? ta * 2.1 : 0;
            const cx = ax + dx * mk.u + px * (mk.o * w * 0.5) + ux * shift;
            const cy = ay + dy * mk.u + py * (mk.o * w * 0.5) + uy * shift;
            const hl = w * mk.w * 0.5;
            g.moveTo(cx - px * hl + ux * ta, cy - py * hl + uy * ta);
            g.lineTo(cx + px * hl + ux * ta, cy + py * hl + uy * ta);
            g.lineTo(cx + px * hl - ux * ta, cy + py * hl - uy * ta);
            g.lineTo(cx - px * hl - ux * ta, cy - py * hl - uy * ta);
            g.closePath();
            if (++n % 40 === 0) { g.fill(); g.beginPath(); }
          }
        }
        g.fill();
      }
      g.globalAlpha = 1;
    }

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
            if (it.bud) {
              /* An unopened bud is a tight ball. Mixing them through the open
               * flowers is most of what separates a cherry in bloom from a
               * scatter of identical stamps. */
              const br = r * 0.5;
              for (let q = 0; q < 8; q++) {
                const a = (q / 8) * TAU;
                const bx = Math.cos(a) * br, by = Math.sin(a) * br * 0.84;
                const x = it.x + bx * cs - by * sn, y = it.y + bx * sn + by * cs;
                if (q === 0) g.moveTo(x, y); else g.lineTo(x, y);
              }
              g.closePath();
              continue;
            }
            for (let q = 0; q < BLOSSOM.length; q++) {
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

      /* Centres last, over the petals. Five petals around an empty middle read
       * as a paper cut-out; the eye is looking for the little dark boss. Only
       * on flowers big enough on screen to show one. */
      if (this._corePal) {
        const cores = new Map();
        for (const it of items) {
          if (it.bud || !it.core || it.r < 4.4) continue;
          const step = it.alpha >= 1 ? STEPS : Math.max(1, Math.round(it.alpha * STEPS));
          const key = it.core + '|' + step;
          let arr = cores.get(key);
          if (!arr) { arr = []; cores.set(key, arr); }
          arr.push(it);
        }
        for (const [key, arr] of cores) {
          const cut = key.lastIndexOf('|');
          g.fillStyle = key.slice(0, cut);
          g.globalAlpha = (+key.slice(cut + 1)) / STEPS;
          for (let i = 0; i < arr.length; i += CHUNK) {
            const end = Math.min(i + CHUNK, arr.length);
            g.beginPath();
            for (let k = i; k < end; k++) {
              const it = arr[k];
              const cr = it.r * (0.13 + (it.squash % 0.09));
              for (let q = 0; q < 6; q++) {
                const a = (q / 6) * TAU + it.spin;
                const x = it.x + Math.cos(a) * cr;
                const y = it.y + Math.sin(a) * cr * it.squash;
                if (q === 0) g.moveTo(x, y); else g.lineTo(x, y);
              }
              g.closePath();
            }
            g.fill();
          }
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
