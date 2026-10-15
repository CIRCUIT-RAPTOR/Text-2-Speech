// Signal-processing helpers. Pure functions on Float32Array: no DOM, no Web Audio,
// so they run in the browser and in Node tests alike.

export const dbToLin = db => 10 ** (db / 20);
export const linToDb = v => 20 * Math.log10(Math.max(v, 1e-9));

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[s.length >> 1];
}

// ------------------------------------------------------------------ filters

// RBJ biquad coefficients, normalised: [b0, b1, b2, a1, a2]
function biquad(type, fc, sr, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * fc) / sr, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  const [b0, b1, b2] = type === 'lp'
    ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
    : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const a0 = 1 + alpha;
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

function filter(x, [b0, b1, b2, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Low-pass with no phase shift (filter forwards, then backwards). */
export function zeroPhaseLowpass(x, sr, fc) {
  const c = biquad('lp', fc, sr);
  const f = filter(x, c).reverse();
  return filter(f, c).reverse();
}

export function bandpass(x, sr, lo, hi) {
  let y = filter(x, biquad('hp', lo, sr));
  if (hi < sr * 0.45) y = filter(y, biquad('lp', hi, sr));
  return y;
}

/** Remove DC and rumble. */
export function highpass(x, sr, fc = 70) {
  return filter(x, biquad('hp', fc, sr));
}

/** Short-time energy in dB: one value per `hopMs`, measured over a `winMs` window. */
export function envDb(x, sr, winMs = 12, hopMs = 4) {
  const hop = Math.max(1, Math.round((sr * hopMs) / 1000));
  const half = Math.round((sr * winMs) / 2000);
  const cs = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) cs[i + 1] = cs[i] + x[i] * x[i];
  const n = Math.floor(x.length / hop);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i * hop - half), b = Math.min(x.length, i * hop + half);
    out[i] = 10 * Math.log10((cs[b] - cs[a]) / Math.max(1, b - a) + 1e-12);
  }
  return { db: out, hop };
}

// -------------------------------------------------------------------- pitch

/**
 * Fundamental frequency track by normalised autocorrelation.
 * Returns one value per `hopMs` (0 = unvoiced) and the hop size in samples.
 */
export function estimatePitch(x, sr, { fmin = 60, fmax = 450, hopMs = 10, winMs = 40, thresh = 0.5 } = {}) {
  const k = Math.max(1, Math.floor(sr / 12000));               // work at ~12 kHz: plenty for f0, 4x cheaper
  const n = Math.floor(x.length / k);
  const srd = sr / k;
  const W = Math.round((winMs * srd) / 1000), hop = Math.max(1, Math.round((hopMs * srd) / 1000));
  const tmin = Math.max(2, Math.floor(srd / fmax)), tmax = Math.ceil(srd / fmin);
  const pad = W + tmax + 2;
  const xp = new Float32Array(n + 2 * pad);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += x[i * k + j];
    xp[pad + i] = s / k;
  }

  const frames = Math.floor(n / hop) + 1;
  const f0 = new Float32Array(frames), conf = new Float32Array(frames);
  const energy = new Float32Array(frames);
  let peakE = 0;
  for (let f = 0; f < frames; f++) {
    const s = pad + f * hop - (W >> 1);
    let e = 0;
    for (let i = 0; i < W; i++) e += xp[s + i] * xp[s + i];
    energy[f] = e / W;
    peakE = Math.max(peakE, energy[f]);
  }

  const r = new Float32Array(tmax + 2);
  for (let f = 0; f < frames; f++) {
    if (energy[f] < 0.01 * peakE) continue;                      // too quiet to trust (-20 dB)
    const s = pad + f * hop - (W >> 1);
    let e0 = 0;
    for (let i = 0; i < W; i++) e0 += xp[s + i] * xp[s + i];
    let rmax = 0;
    for (let t = tmin - 1; t <= tmax + 1; t++) {
      let num = 0, e1 = 0;
      for (let i = 0; i < W; i++) { const b = xp[s + i + t]; num += xp[s + i] * b; e1 += b * b; }
      r[t] = num / Math.sqrt(e0 * e1 + 1e-12);
      if (t >= tmin && t <= tmax && r[t] > rmax) rmax = r[t];
    }
    if (rmax < thresh) continue;
    // lowest lag whose peak is nearly as strong as the best: avoids octave-down errors
    let best = -1;
    for (let t = tmin; t <= tmax; t++) {
      if (r[t] >= r[t - 1] && r[t] >= r[t + 1] && r[t] >= 0.85 * rmax) { best = t; break; }
    }
    if (best < 0) continue;
    const d = r[best - 1] - 2 * r[best] + r[best + 1];
    const tt = d < 0 ? best + (0.5 * (r[best - 1] - r[best + 1])) / d : best;
    f0[f] = srd / tt;
    conf[f] = rmax;
  }
  return { f0, conf, hop: hop * k };
}

/** Replace unvoiced frames by the nearest voiced value, and drop isolated outliers. */
export function fillF0(f0, fallback) {
  const out = Float32Array.from(f0);
  for (let i = 1; i < out.length - 1; i++) {                     // 3-point median on voiced neighbours
    if (out[i] > 0 && out[i - 1] > 0 && out[i + 1] > 0) out[i] = median([f0[i - 1], f0[i], f0[i + 1]]);
  }
  let last = 0;
  for (let i = 0; i < out.length; i++) { if (out[i] > 0) last = out[i]; else if (last) out[i] = last; }
  last = 0;
  for (let i = out.length - 1; i >= 0; i--) { if (out[i] > 0) last = out[i]; else if (last) out[i] = last; }
  for (let i = 0; i < out.length; i++) if (!(out[i] > 0)) out[i] = fallback;
  return out;
}

/**
 * Pitch marks: one sample index per glottal cycle, placed on the waveform peak.
 * @param f0 per-frame f0, already filled (no zeros)
 */
export function findPitchMarks(x, sr, f0, hop) {
  const len = x.length;
  const period = i => sr / f0[Math.min(f0.length - 1, Math.max(0, Math.round(i / hop)))];
  const mean = f0.reduce((a, b) => a + b, 0) / f0.length;
  const xl = zeroPhaseLowpass(x, sr, Math.min(1200, Math.max(500, 5 * mean)));
  let hi = -Infinity, lo = Infinity;
  for (const v of xl) { if (v > hi) hi = v; if (v < lo) lo = v; }
  const sign = hi >= -lo ? 1 : -1;

  const marks = [];
  const T0 = period(0);
  let best = -Infinity, m = 0;
  for (let k = 0; k < Math.min(len, Math.round(1.2 * T0)); k++) if (sign * xl[k] > best) { best = sign * xl[k]; m = k; }
  marks.push(m);
  for (;;) {
    const T = period(m);
    const a = m + Math.round(0.75 * T), b = Math.min(len - 1, m + Math.round(1.25 * T));
    if (b - a < 2 || a >= len) break;
    let bs = -Infinity, bk = a;
    for (let k = a; k <= b; k++) {
      const dev = Math.abs(k - (m + T)) / (0.25 * T);             // 0 at the expected spot, 1 at the edge
      const score = sign * xl[k] * (1 - 0.5 * dev);
      if (score > bs) { bs = score; bk = k; }
    }
    marks.push(bk);
    m = bk;
  }
  return Int32Array.from(marks);
}

// ------------------------------------------------- consonant / vowel boundary

/**
 * The recordings of consonants are "consonant + schwa" ("tuh", "fuh", "luh").
 * Find where the vowel begins so the consonant can be cut off in front of it.
 * Returns the cut position in samples (everything before it is the consonant).
 */
export function findConsonantCut(x, sr, { voicedStop = false, tailMs = -4 } = {}) {
  const ms = v => Math.round((v * sr) / 1000);
  if (voicedStop) {
    // b, d, g are voiced all the way through, so look for the burst instead
    const { db, hop } = envDb(bandpass(x, sr, 2500, 9000), sr);
    let bi = 2, bd = -Infinity;
    for (let i = 2; i < Math.floor(db.length * 0.75); i++) if (db[i] - db[i - 2] > bd) { bd = db[i] - db[i - 2]; bi = i; }
    const cut = Math.min(x.length, bi * hop + ms(32));
    return { cut, burst: bi * hop, vowel: null };
  }
  const { db: lf, hop } = envDb(bandpass(x, sr, 250, 1100), sr);
  let pk = 0;
  for (let i = 0; i < lf.length; i++) if (lf[i] > lf[pk]) pk = i;
  let v = pk;                                                      // start of the vowel body (within 10 dB of its peak)
  while (v > 0 && lf[v - 1] >= lf[pk] - 10) v--;
  let r = v, steps = 0;                                            // walk back down to the foot of the rise
  while (r > 0 && lf[r - 1] <= lf[r] + 0.5 && steps < 12) { r--; steps++; }
  const cut = Math.max(ms(15), Math.min(x.length, r * hop + ms(tailMs)));
  return { cut, burst: null, vowel: v * hop, foot: r * hop };
}

// ----------------------------------------------------------- utterance level

/** Even out loudness across the utterance: pull quiet stretches up and loud ones down. */
export function levelEven(x, sr, strength = 0.5) {
  if (strength <= 0) return x;
  const hop = Math.round(0.01 * sr), half = Math.round(0.015 * sr);
  const n = Math.ceil(x.length / hop);
  const cs = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) cs[i + 1] = cs[i] + x[i] * x[i];
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i * hop - half), b = Math.min(x.length, i * hop + half);
    rms[i] = Math.sqrt((cs[b] - cs[a]) / Math.max(1, b - a));
  }
  const floor = dbToLin(-45);
  const target = median(Array.from(rms).filter(v => v > floor));
  if (!target) return x;
  const g = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    if (rms[i] > floor) g[i] = Math.min(dbToLin(6), Math.max(dbToLin(-6), (target / rms[i]) ** strength));
  }
  const a = Math.exp(-hop / sr / 0.04);                            // smooth the gain curve (zero phase)
  for (let i = 1; i < n; i++) g[i] = a * g[i - 1] + (1 - a) * g[i];
  for (let i = n - 2; i >= 0; i--) g[i] = a * g[i + 1] + (1 - a) * g[i];
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const p = i / hop, i0 = Math.min(n - 1, Math.floor(p)), i1 = Math.min(n - 1, i0 + 1), f = p - i0;
    out[i] = x[i] * (g[i0] * (1 - f) + g[i1] * f);
  }
  return out;
}

export function normalisePeak(x, peak = 0.9) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) { const k = peak / m; for (let i = 0; i < x.length; i++) x[i] *= k; }
  return x;
}

// ------------------------------------------------------------- voice alignment

/**
 * Where the vowel starts in a "sonorant + schwa" recording (m, n, ng, l, r, w, j), in ms from the
 * start of `x`. Looks at the formant band (700-3500 Hz), where the vowel is far louder than the
 * nasal/liquid murmur, and walks back from its peak to the foot of the rise. Used only to measure
 * how far a recording is shifted in time compared with the reference (see engine.js).
 */
export function formantOnsetMs(x, sr) {
  const { db, hop } = envDb(bandpass(x, sr, 700, 3500), sr, 12, 4);
  let pk = 0;
  for (let i = 0; i < db.length; i++) if (db[i] > db[pk]) pk = i;
  let v = pk;
  while (v > 0 && db[v - 1] >= db[pk] - 12) v--;
  return (v * hop * 1000) / sr;
}
