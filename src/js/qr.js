/* =============================================================================
 * qr.js — a dependency-free QR Code (Model 2) encoder.
 *
 * Supports versions 1-40, error-correction levels L/M/Q/H, and the three
 * segment modes we care about for URLs: numeric, alphanumeric and byte (UTF-8).
 * The encoder picks the smallest version that fits and the mask with the lowest
 * penalty score, exactly as ISO/IEC 18004 prescribes.
 *
 * Exposes a single global: QR.encode(text, opts) -> { size, modules, version,
 * ecl, mask } where `modules` is a size*size Uint8Array of 0/1 in row-major
 * order (1 = dark).
 * ========================================================================== */
(function (global) {
  'use strict';

  /* --- Error-correction levels. `bits` is the 2-bit value used in format info. */
  const ECC = {
    L: { ordinal: 0, bits: 1 },
    M: { ordinal: 1, bits: 0 },
    Q: { ordinal: 2, bits: 3 },
    H: { ordinal: 3, bits: 2 }
  };

  /* Number of error-correction codewords per block, indexed [ecl][version]. */
  const ECC_CODEWORDS_PER_BLOCK = [
    // 0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
    [ -1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
    [ -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
    [ -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
    [ -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]  // H
  ];

  /* Number of error-correction blocks, indexed [ecl][version]. */
  const ECC_BLOCKS = [
    // 0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
    [ -1,  1,  1,  1,  1,  1,  2,  2,  2,  2,  4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
    [ -1,  1,  1,  1,  2,  2,  4,  4,  4,  5,  5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
    [ -1,  1,  1,  2,  2,  4,  4,  6,  6,  8,  8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
    [ -1,  1,  1,  2,  4,  4,  4,  5,  6,  8,  8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]  // H
  ];

  const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  /* ---------------------------------------------------------------- GF(256) */
  /* Multiplication in the Galois field used by Reed-Solomon, modulo the QR
   * primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D). */
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  /* Monic generator polynomial of the given degree, coefficients descending. */
  function rsDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  /* Remainder of data divided by the generator — i.e. the EC codewords. */
  function rsRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (const b of data) {
      const factor = b ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
    }
    return result;
  }

  /* ------------------------------------------------------------ bit buffer */
  class BitBuffer {
    constructor() { this.bits = []; }
    append(value, len) {
      for (let i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
    }
    get length() { return this.bits.length; }
  }

  /* ---------------------------------------------------------------- segments */
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    const out = [];
    for (const ch of str) {
      let cp = ch.codePointAt(0);
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return Uint8Array.from(out);
  }

  const MODE = {
    numeric:      { bits: 1, charCountBits: [10, 12, 14] },
    alphanumeric: { bits: 2, charCountBits: [ 9, 11, 13] },
    byte:         { bits: 4, charCountBits: [ 8, 16, 16] }
  };

  function charCountBits(mode, version) {
    const i = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    return mode.charCountBits[i];
  }

  /* Choose the most compact mode that can represent the whole string. Mixing
   * modes mid-string can occasionally save a few bits, but for URLs the gain is
   * negligible and a single segment keeps the encoder easy to reason about. */
  function makeSegment(text) {
    if (/^[0-9]*$/.test(text)) {
      return { mode: MODE.numeric, numChars: text.length, write(bb) {
        for (let i = 0; i < text.length; i += 3) {
          const chunk = text.substr(i, 3);
          bb.append(parseInt(chunk, 10), chunk.length * 3 + 1);
        }
      }};
    }
    if (/^[0-9A-Z $%*+\-./:]*$/.test(text)) {
      return { mode: MODE.alphanumeric, numChars: text.length, write(bb) {
        let i = 0;
        for (; i + 2 <= text.length; i += 2) {
          bb.append(ALPHANUMERIC.indexOf(text[i]) * 45 + ALPHANUMERIC.indexOf(text[i + 1]), 11);
        }
        if (i < text.length) bb.append(ALPHANUMERIC.indexOf(text[i]), 6);
      }};
    }
    const bytes = utf8Bytes(text);
    return { mode: MODE.byte, numChars: bytes.length, write(bb) {
      for (const b of bytes) bb.append(b, 8);
    }};
  }

  function segmentBitLength(seg, version) {
    const bb = new BitBuffer();
    seg.write(bb);
    return 4 + charCountBits(seg.mode, version) + bb.length;
  }

  /* ------------------------------------------------------- capacity helpers */
  /* Total number of data+EC modules available in a version, before EC split. */
  function rawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function rawCodewords(ver) { return Math.floor(rawDataModules(ver) / 8); }

  function dataCodewords(ver, ecl) {
    return rawCodewords(ver) -
      ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * ECC_BLOCKS[ecl.ordinal][ver];
  }

  function alignmentPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  /* --------------------------------------------------------------- codewords */
  function buildCodewords(seg, version, ecl) {
    const capacityBits = dataCodewords(version, ecl) * 8;
    const bb = new BitBuffer();
    bb.append(seg.mode.bits, 4);
    bb.append(seg.numChars, charCountBits(seg.mode, version));
    seg.write(bb);

    /* Terminator, then pad to a byte boundary, then alternating pad bytes. */
    bb.append(0, Math.min(4, capacityBits - bb.length));
    bb.append(0, (8 - (bb.length % 8)) % 8);
    for (let pad = 0xec; bb.length < capacityBits; pad ^= 0xec ^ 0x11) bb.append(pad, 8);

    const data = new Uint8Array(bb.length / 8);
    bb.bits.forEach((bit, i) => { data[i >>> 3] |= bit << (7 - (i & 7)); });
    return data;
  }

  /* Split into blocks, append EC codewords to each, then interleave. */
  function addEccAndInterleave(data, version, ecl) {
    const numBlocks = ECC_BLOCKS[ecl.ordinal][version];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][version];
    const raw = rawCodewords(version);
    const numShortBlocks = numBlocks - (raw % numBlocks);
    const shortBlockLen = Math.floor(raw / numBlocks);

    const divisor = rsDivisor(blockEccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      const dat = Array.from(data.slice(k, k + len));
      k += len;
      const ecc = rsRemainder(dat, divisor);
      /* Short blocks get a placeholder byte so every block has the same length
       * while interleaving; the placeholder is skipped on the way out. */
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(Array.from(ecc)));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i]);
      }
    }
    return Uint8Array.from(result);
  }

  /* ------------------------------------------------------------ the matrix */
  class Matrix {
    constructor(version) {
      this.version = version;
      this.size = version * 4 + 17;
      this.modules = new Uint8Array(this.size * this.size);
      this.isFunction = new Uint8Array(this.size * this.size);
    }
    get(x, y) { return this.modules[y * this.size + x]; }
    set(x, y, dark) { this.modules[y * this.size + x] = dark ? 1 : 0; }
    setFunction(x, y, dark) {
      this.set(x, y, dark);
      this.isFunction[y * this.size + x] = 1;
    }
    reserved(x, y) { return this.isFunction[y * this.size + x] === 1; }
  }

  function drawFinder(m, cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < m.size && y >= 0 && y < m.size) {
          m.setFunction(x, y, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  function drawAlignment(m, cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        m.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  function drawFormatBits(m, ecl, mask) {
    const data = (ecl.bits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = (((data << 10) | rem) ^ 0x5412) & 0x7fff;

    /* First copy, wrapped around the top-left finder. */
    for (let i = 0; i <= 5; i++) m.setFunction(8, i, (bits >>> i) & 1);
    m.setFunction(8, 7, (bits >>> 6) & 1);
    m.setFunction(8, 8, (bits >>> 7) & 1);
    m.setFunction(7, 8, (bits >>> 8) & 1);
    for (let i = 9; i < 15; i++) m.setFunction(14 - i, 8, (bits >>> i) & 1);

    /* Second copy, split between the other two finders. */
    for (let i = 0; i < 8; i++) m.setFunction(m.size - 1 - i, 8, (bits >>> i) & 1);
    for (let i = 8; i < 15; i++) m.setFunction(8, m.size - 15 + i, (bits >>> i) & 1);
    m.setFunction(8, m.size - 8, 1); // the always-dark module
  }

  function drawFunctionPatterns(m, ecl) {
    /* Timing patterns. */
    for (let i = 0; i < m.size; i++) {
      m.setFunction(6, i, i % 2 === 0);
      m.setFunction(i, 6, i % 2 === 0);
    }

    drawFinder(m, 3, 3);
    drawFinder(m, m.size - 4, 3);
    drawFinder(m, 3, m.size - 4);

    /* Alignment patterns, skipping the three that collide with finders. */
    const pos = alignmentPositions(m.version);
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const corner = (i === 0 && j === 0) ||
                       (i === 0 && j === pos.length - 1) ||
                       (i === pos.length - 1 && j === 0);
        if (!corner) drawAlignment(m, pos[i], pos[j]);
      }
    }

    /* Reserve the format area now; the real bits are written once the mask is
     * chosen. Version info is fixed, so it can be written immediately. */
    drawFormatBits(m, ecl, 0);

    if (m.version >= 7) {
      let rem = m.version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (m.version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = (bits >>> i) & 1;
        const a = m.size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        m.setFunction(a, b, bit);
        m.setFunction(b, a, bit);
      }
    }
  }

  /* Zigzag placement: two-module-wide columns, right to left, alternating up
   * and down, skipping the vertical timing column. */
  function drawCodewords(m, codewords) {
    let i = 0;
    for (let right = m.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < m.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? m.size - 1 - vert : vert;
          if (!m.reserved(x, y) && i < codewords.length * 8) {
            m.set(x, y, (codewords[i >>> 3] >>> (7 - (i & 7))) & 1);
            i++;
          }
          /* Any remaining modules stay light — the spec's remainder bits. */
        }
      }
    }
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
    }
    throw new Error('bad mask');
  }

  function applyMask(m, mask) {
    for (let y = 0; y < m.size; y++) {
      for (let x = 0; x < m.size; x++) {
        if (!m.reserved(x, y) && maskBit(mask, x, y)) {
          m.modules[y * m.size + x] ^= 1;
        }
      }
    }
  }

  /* The four penalty rules from the spec, used to pick the friendliest mask.
   * Rules 1 and 3 share a scan: a sliding history of the last seven run
   * lengths lets us spot 1:1:3:1:1 finder lookalikes cheaply. */
  function penaltyScore(m) {
    const size = m.size;
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;
    let result = 0;

    /* Count 1:1:3:1:1 patterns sitting in the middle of the run history. */
    const countFinderLookalikes = (hist) => {
      const n = hist[1];
      const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
      return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) +
             (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
    };
    /* The very first run is bordered by the quiet zone, so it counts as if it
     * extended a full symbol width beyond the edge. */
    const pushRun = (hist, len) => {
      if (hist[0] === 0) len += size;
      hist.pop();
      hist.unshift(len);
    };
    const terminate = (hist, runColor, runLen) => {
      if (runColor === 1) { pushRun(hist, runLen); runLen = 0; }
      pushRun(hist, runLen + size);
      return countFinderLookalikes(hist);
    };

    /* Rules 1 and 3, once across rows and once down columns. */
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        const hist = [0, 0, 0, 0, 0, 0, 0];
        let runColor = 0, runLen = 0;
        for (let b = 0; b < size; b++) {
          const c = pass === 0 ? m.get(b, a) : m.get(a, b);
          if (c === runColor) {
            runLen++;
            if (runLen === 5) result += N1;
            else if (runLen > 5) result++;
          } else {
            pushRun(hist, runLen);
            if (runColor === 0) result += countFinderLookalikes(hist) * N3;
            runColor = c;
            runLen = 1;
          }
        }
        result += terminate(hist, runColor, runLen) * N3;
      }
    }

    /* Rule 2: solid 2x2 blocks of one colour. */
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m.get(x, y);
        if (c === m.get(x + 1, y) && c === m.get(x, y + 1) && c === m.get(x + 1, y + 1)) {
          result += N2;
        }
      }
    }

    /* Rule 4: how far the dark-module ratio strays from 50%. */
    let dark = 0;
    for (let i = 0; i < m.modules.length; i++) dark += m.modules[i];
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * N4;

    return result;
  }

  /* -------------------------------------------------------------- the API */
  /**
   * Encode `text` as a QR symbol.
   * opts.ecl        — 'L' | 'M' | 'Q' | 'H' (default 'M')
   * opts.minVersion — smallest version to consider (default 1)
   * opts.maxVersion — largest version to consider (default 40)
   * opts.boostEcl   — raise the EC level for free if the data still fits (default true)
   * opts.mask       — force a mask 0-7 instead of choosing the best
   */
  function encode(text, opts) {
    opts = opts || {};
    const minVersion = Math.max(1, opts.minVersion || 1);
    const maxVersion = Math.min(40, opts.maxVersion || 40);
    const boost = opts.boostEcl !== false;
    let ecl = ECC[(opts.ecl || 'M').toUpperCase()];
    if (!ecl) throw new Error('unknown error-correction level: ' + opts.ecl);

    const seg = makeSegment(String(text));

    /* Smallest version that holds the data at the requested EC level. */
    let version = -1;
    for (let v = minVersion; v <= maxVersion; v++) {
      if (segmentBitLength(seg, v) <= dataCodewords(v, ecl) * 8) { version = v; break; }
    }
    if (version < 0) throw new Error('data too long for a QR code at level ' + (opts.ecl || 'M'));

    /* Bump the EC level as far as the chosen version allows, for free. */
    if (boost) {
      for (const name of ['M', 'Q', 'H']) {
        const cand = ECC[name];
        if (cand.ordinal > ecl.ordinal &&
            segmentBitLength(seg, version) <= dataCodewords(version, cand) * 8) {
          ecl = cand;
        }
      }
    }

    const m = new Matrix(version);
    drawFunctionPatterns(m, ecl);
    drawCodewords(m, addEccAndInterleave(buildCodewords(seg, version, ecl), version, ecl));

    /* Try every mask, keep the one with the lowest penalty. */
    let bestMask = opts.mask;
    if (bestMask === undefined || bestMask === null) {
      let bestScore = Infinity;
      for (let mask = 0; mask < 8; mask++) {
        applyMask(m, mask);
        drawFormatBits(m, ecl, mask);
        const score = penaltyScore(m);
        if (score < bestScore) { bestScore = score; bestMask = mask; }
        applyMask(m, mask); // XOR again to undo
      }
    }
    applyMask(m, bestMask);
    drawFormatBits(m, ecl, bestMask);

    const eclName = Object.keys(ECC).find(k => ECC[k] === ecl);
    return {
      size: m.size,
      modules: m.modules,
      isFunction: m.isFunction,
      version: version,
      ecl: eclName,
      mask: bestMask,
      get: (x, y) => m.modules[y * m.size + x] === 1
    };
  }

  /* Classify a module so the renderer can style finders and timing rails
   * differently from payload data. */
  function moduleRole(qr, x, y) {
    const s = qr.size;
    const inFinder = (cx, cy) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7;
    if (inFinder(0, 0) || inFinder(s - 7, 0) || inFinder(0, s - 7)) return 'finder';
    const nearFinder = (cx, cy) => x >= cx - 1 && x <= cx + 7 && y >= cy - 1 && y <= cy + 7;
    if (nearFinder(0, 0) || nearFinder(s - 7, 0) || nearFinder(0, s - 7)) return 'quiet';
    if (x === 6 || y === 6) return 'timing';
    if (qr.isFunction[y * s + x]) return 'align';
    return 'data';
  }

  global.QR = { encode, moduleRole, ECC_LEVELS: ['L', 'M', 'Q', 'H'] };
})(typeof window !== 'undefined' ? window : globalThis);
