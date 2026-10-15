// Synthesis engine.
//
//   VoiceBank   prepares every phoneme clip of one recording (cut off the schwa that follows
//               each consonant, find pitch marks, measure loudness)
//   synthesize  tokens -> one Float32Array: level, pitch-flatten (PSOLA), join, add intonation,
//               even out loudness
//   playSamples / encodeWav / playWord / playPhoneme   output
//
// Nothing in synthesize() touches Web Audio, so it runs unchanged in Node for testing.

import { SPRITES } from './sprites.js';
import {
  PHONEMES, BY_ID, TARGET_MS, MAX_NOISE_MS, LEVEL_DB, VOICED_STOPS, CLOSURE_MS, CUT_TAIL_MS, CUT_MS,
  CALIBRATION_IDS,
} from './phonemes.js';
import { CUT_REF, CAL_REF } from './reference.js';
import {
  dbToLin, linToDb, median, estimatePitch, fillF0, findPitchMarks, findConsonantCut,
  envDb, levelEven, highpass, normalisePeak, formantOnsetMs,
} from './dsp.js';

const ONSET_THRESHOLD = 0.05;                       // fraction of a clip's peak that counts as "sound"
const VOICED = new Set(['short', 'long', 'diph', 'schwa', 'nasal', 'appr']);
const VOWEL = new Set(['short', 'long', 'diph', 'schwa']);

// --------------------------------------------------------------------- bank

export class VoiceBank {
  /**
   * @param {{samples: Float32Array, sampleRate: number, audioBuffer?: AudioBuffer, calibrate?: boolean}} src
   *   calibrate: cut consonants from the reference table (js/reference.js) after measuring this
   *   recording's time shift. Turn off only to build that reference (tools/make-reference.mjs).
   */
  constructor({ samples, sampleRate, audioBuffer = null, calibrate = true }) {
    this.calibrate = calibrate;
    this.shiftMs = 0;                     // how much later than the reference this recording sits
    this.samples = samples;
    this.sr = sampleRate;
    this.audioBuffer = audioBuffer;       // only used to preview raw clips from the chart
    this.f0 = 120;                        // this voice's typical pitch (Hz), measured below
    /** @type {Map<number, object>} phoneme id -> prepared unit */
    this.units = new Map();
    /** @type {Map<string, {at:number,len:number,slotAt:number,slotLen:number,gain:number}>} raw clips */
    this.clips = new Map();
    this.#prepare();
  }

  static async load(ctx, url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
    const audioBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
    return new VoiceBank({ samples: audioBuffer.getChannelData(0), sampleRate: audioBuffer.sampleRate, audioBuffer });
  }

  clip(id, kind = 1) {
    const c = this.clips.get(`${id}_${kind}`);
    if (!c) throw new Error(`No clip for ${id}_${kind}`);
    return c;
  }

  /**
   * Time shift of this recording relative to the reference one, in ms. The vowel onsets of the
   * calibration sounds are measured here and compared with the reference values; the median
   * difference is the shift (mp3 decoders disagree about encoder delay, so it can't be assumed).
   */
  #measureShift() {
    const { samples: data, sr } = this;
    const ms = v => Math.round((v * sr) / 1000);
    const diffs = [];
    for (const id of CALIBRATION_IDS) {
      if (CAL_REF[id] == null) continue;
      const [start, dur] = SPRITES[`${id}_1`];
      const seg = data.subarray(ms(start), Math.min(data.length, ms(start + dur + 40)));
      diffs.push(formantOnsetMs(seg, sr) - CAL_REF[id]);
    }
    if (diffs.length < 4) return 0;                       // no reference available: leave things as they are
    const m = median(diffs);
    const spread = median(diffs.map(d => Math.abs(d - m)));
    if (spread > 20 || Math.abs(m) > 80) {
      console.warn(`Could not align this recording to the reference (shift ${m.toFixed(0)} ms, spread ${spread.toFixed(0)} ms)`);
      return 0;
    }
    return m;
  }

  #prepare() {
    const { samples: data, sr } = this;
    const ms = v => Math.round((v * sr) / 1000);

    // 1. Raw clips (for the chart preview) and the audible part of each isolated phoneme.
    for (const [key, [startMs, durMs]] of Object.entries(SPRITES)) {
      const a = ms(startMs), b = Math.min(data.length, ms(startMs + durMs));
      const { db, hop } = envDb(data.subarray(a, b), sr, 4, 2);
      const peak = Math.max(...db);
      const thr = peak - 26;                                         // 5% of the peak amplitude
      const first = db.findIndex(v => v > thr);
      const last = db.length - 1 - [...db].reverse().findIndex(v => v > thr);
      const onset = Math.max(0, first * hop - ms(5)), offset = Math.min(b - a, (last + 1) * hop + ms(10));
      let sq = 0, pk = 0;
      for (let q = a + onset; q < a + offset; q++) { sq += data[q] * data[q]; pk = Math.max(pk, Math.abs(data[q])); }
      const rms = Math.sqrt(sq / Math.max(1, offset - onset)) || 1e-6;
      this.clips.set(key, {
        at: (a + onset) / sr, len: (offset - onset) / sr, slotAt: a / sr, slotLen: (b - a) / sr,
        gain: Math.min(0.08 / rms, 0.85 / (pk || 1), 8),
        _a: a + onset, _b: a + offset,
      });
    }

    // 2. One unit per phoneme: the clip with the vowel tail cut off consonants.
    //    Finding "where the vowel starts" automatically only works on the original recording; the
    //    other voices have flatter loudness. All the voices are time-aligned copies of the same
    //    performance, so instead each consonant is cut where the reference says, moved by this
    //    recording's measured time shift.
    const shift = this.calibrate ? this.#measureShift() : null;
    if (shift !== null) this.shiftMs = shift;
    for (const p of PHONEMES) {
      const c = this.clips.get(`${p.id}_1`);
      let x = Float32Array.from(data.subarray(c._a, c._b));
      let cut = null;
      if (p.kind === 'consonant') {
        const ref = shift !== null ? CUT_REF[p.id] : null;
        if (ref) {
          const slot = SPRITES[`${p.id}_1`][0];
          const a = Math.max(0, ms(slot + ref[0] + shift));
          const b = Math.min(data.length, Math.max(a + ms(15), ms(slot + ref[1] + shift)));
          x = Float32Array.from(data.subarray(a, b));
          cut = { cut: x.length, ref: true };
        } else {
          cut = findConsonantCut(x, sr, { voicedStop: VOICED_STOPS.has(p.id), tailMs: CUT_TAIL_MS[p.cls] ?? -4 });
          if (CUT_MS[p.id] != null) cut = { ...cut, cut: Math.min(x.length, ms(CUT_MS[p.id])) };
          x = x.slice(0, cut.cut);
        }
      }
      this.units.set(p.id, { id: p.id, cls: p.cls, x, cut, voiced: VOICED.has(p.cls), marks: null });
    }

    // 3. This voice's pitch: the median over all vowel clips.
    const all = [];
    for (const u of this.units.values()) {
      if (!VOWEL.has(u.cls)) continue;
      const { f0, conf } = estimatePitch(u.x, sr, { fmin: 60, fmax: 450, thresh: 0.7 });
      f0.forEach((v, i) => { if (v > 0 && conf[i] > 0.7) all.push(v); });
    }
    if (all.length) this.f0 = median(all);

    // 4. Pitch marks for the voiced units, and each unit's loudness.
    for (const u of this.units.values()) {
      if (u.voiced) {
        const est = estimatePitch(u.x, sr, { fmin: this.f0 * 0.65, fmax: this.f0 * 1.6, thresh: 0.45 });
        const f0 = fillF0(est.f0, this.f0);
        const marks = findPitchMarks(u.x, sr, f0, est.hop);
        if (marks.length >= 3) u.marks = marks;
        else u.voiced = false;                                      // too short to pitch-shift: use as noise
      }
      u.rmsDb = activeRmsDb(u.x, sr);
    }
  }
}

/** RMS in dB over the stretches of a clip that are not near-silent. */
function activeRmsDb(x, sr) {
  const { db, hop } = envDb(x, sr, 6, 3);
  const peak = Math.max(...db);
  let sum = 0, n = 0;
  for (let i = 0; i < db.length; i++) {
    if (db[i] > peak - 20) { for (let k = i * hop; k < Math.min(x.length, (i + 1) * hop); k++) { sum += x[k] * x[k]; n++; } }
  }
  return linToDb(Math.sqrt(sum / Math.max(1, n)));
}

// ----------------------------------------------------------------- settings

export const DEFAULTS = {
  pace: 1,          // 0.5 (slow) .. 2 (fast)
  pitch: 0,         // semitones relative to the voice's own pitch
  intonation: 1,    // 0 = monotone, 1 = gentle natural contour, 1.5 = lively
  evenness: 0.5,    // 0 = leave loudness alone, 1 = flatten it fully
  wordGap: 70,      // ms between words
  volume: 1,
  blend: 12,        // ms of cross-fade where a noise sound meets a voiced one
};

const ACCENT_ST = 1.5, DECLINATION_ST = 3, QUESTION_RISE_ST = 5;

// ---------------------------------------------------------------- synthesis

class Out {
  constructor(sr) { this.buf = new Float32Array(sr * 4); }
  ensure(n) {
    if (n <= this.buf.length) return;
    const bigger = new Float32Array(Math.max(n, this.buf.length * 2));
    bigger.set(this.buf);
    this.buf = bigger;
  }
}

/**
 * @param tokens output of textToTokens()
 * @returns {{samples: Float32Array, sr: number, duration: number,
 *            events: {id:number, seq:number, tokenIndex:number, start:number, len:number}[]}}
 */
export function synthesize(tokens, bank, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const base = bank.f0 * 2 ** (o.pitch / 12);
  // Pass 1 lays the sounds out at a flat pitch; pass 2 renders with the intonation contour
  // fitted to where the sounds actually landed.
  const flat = render(tokens, bank, o, () => base);
  const contour = makeContour(flat.events, tokens, o, base);
  const final = render(tokens, bank, o, contour);

  let x = final.out.buf.subarray(0, Math.ceil(final.cursor + 0.05 * bank.sr));
  x = highpass(x, bank.sr, 70);
  x = levelEven(x, bank.sr, o.evenness);
  normalisePeak(x, 0.9);
  return { samples: x, sr: bank.sr, duration: x.length / bank.sr, events: final.events };
}

function render(tokens, bank, o, f0At) {
  const sr = bank.sr;
  const ms = v => Math.round((v * sr) / 1000);
  const out = new Out(sr);
  const events = [];
  const blend = ms(o.blend);
  let cursor = 0, nextCenter = null, seq = 0, phrase = 0;

  tokens.forEach((tok, ti) => {
    if (tok.kind === 'pause') {
      cursor += ms(tok.ms / o.pace); nextCenter = null; phrase++;
      return;
    }
    const lastIdx = tok.ids.length - 1;
    const beforePause = !tokens[ti + 1] || tokens[ti + 1].kind === 'pause';

    tok.ids.forEach((id, j) => {
      const u = bank.units.get(id);
      const stress = tok.stress?.[j] ?? 0;
      let startS, endS;

      if (u.voiced) {
        // ---- voiced: PSOLA, time-scaled to the target length, pitch from the contour
        let factor = 1;
        if (VOWEL.has(u.cls)) factor = stress === 1 ? 1.15 : stress === 2 ? 1 : 0.85;
        if (beforePause && j >= lastIdx - 1) factor *= 1.2;
        const D = ms((TARGET_MS[u.cls] * factor) / o.pace);
        const M = u.marks;
        const Ta0 = Math.round(M[1] - M[0]);
        const ts0 = nextCenter ?? Math.max(0, cursor - blend) + Ta0;
        const r = psola(out, u, ts0, D, f0At, sr, dbToLin(LEVEL_DB[u.cls] - u.rmsDb));
        startS = nextCenter === null ? ts0 - Ta0 : ts0;
        endS = r.next;
        nextCenter = r.next;
      } else {
        // ---- noise / burst: copied, cropped if too long, faded at the edges
        const isStop = u.cls === 'stop' || u.cls === 'affr';
        const closure = isStop && j > 0 ? ms((VOICED_STOPS.has(id) ? CLOSURE_MS.voiced : CLOSURE_MS.voiceless) / o.pace) : 0;
        const L = Math.min(u.x.length, ms((MAX_NOISE_MS[u.cls] ?? 90) / o.pace));
        const fadeIn = isStop ? ms(2) : blend, fadeOut = Math.min(isStop ? ms(6) : blend, L >> 1);
        startS = isStop && j > 0 ? cursor + closure : Math.max(0, cursor - (isStop ? 0 : blend));
        const g = dbToLin(LEVEL_DB[u.cls] - u.rmsDb);
        out.ensure(startS + L + 1);
        for (let i = 0; i < L; i++) {
          const fi = i < fadeIn ? 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn) : 1;
          const fo = i >= L - fadeOut ? 0.5 - 0.5 * Math.cos((Math.PI * (L - 1 - i)) / fadeOut) : 1;
          out.buf[startS + i] += u.x[i] * g * fi * fo;
        }
        endS = startS + L;
        nextCenter = null;
      }
      events.push({ id, seq: seq++, tokenIndex: ti, start: startS / sr, len: Math.max(0, endS - startS) / sr, stress, phrase });
      cursor = endS;
    });
    cursor += ms(o.wordGap / o.pace);
    nextCenter = null;
  });
  return { out, events, cursor };
}

/**
 * Pitch-synchronous overlap-add. Re-times a voiced unit to `D` samples and renders it at the
 * pitch given by f0At(t). Returns where the next voiced unit's first grain should be centred, so
 * consecutive voiced sounds stay in phase.
 */
function psola(out, u, ts0, D, f0At, sr, gain) {
  const { x, marks: M } = u;
  const n = M.length;
  const La = M[n - 1] - M[0];
  const Ts0 = sr / f0At(ts0 / sr);
  const alpha = Math.min(1.8, Math.max(0.4, Math.max(Ts0, D - Ts0) / La));
  const Ls = alpha * La;

  let ts = ts0, i = 0;
  for (;;) {
    const s = ts - ts0;
    if (s > Ls) break;
    const ta = M[0] + s / alpha;
    while (i + 1 < n && Math.abs(M[i + 1] - ta) < Math.abs(M[i] - ta)) i++;
    const Ta = i === 0 ? M[1] - M[0] : i === n - 1 ? M[n - 1] - M[n - 2] : (M[i + 1] - M[i - 1]) / 2;
    const Ts = sr / f0At(ts / sr);
    const H = Math.max(2, Math.round(Ta));
    const centre = Math.round(ts);
    out.ensure(centre + H + 2);
    const k = (gain * Ts) / Ta;
    for (let d = -H; d <= H; d++) {
      const a = M[i] + d, t = centre + d;
      if (a < 0 || a >= x.length || t < 0) continue;
      out.buf[t] += x[a] * k * (0.5 + 0.5 * Math.cos((Math.PI * d) / H));
    }
    ts += Ts;
  }
  return { next: Math.round(ts) };
}

/** Intonation: gentle fall across each phrase, a small lift on stressed vowels, a rise for questions. */
function makeContour(events, tokens, o, base) {
  const phrases = new Map();
  for (const ev of events) {
    const p = phrases.get(ev.phrase) ?? { start: ev.start, end: 0, question: false };
    p.end = Math.max(p.end, ev.start + ev.len);
    phrases.set(ev.phrase, p);
  }
  // a phrase ending in "?" is a question
  let idx = 0;
  for (const tok of tokens) {
    if (tok.kind === 'pause') { if (tok.text === '?' && phrases.has(idx)) phrases.get(idx).question = true; idx++; }
  }
  const accents = events.filter(e => e.stress === 1 && VOWEL.has(BY_ID.get(e.id).cls));
  const amount = o.intonation;

  return t => {
    let st = 0;                                    // semitones relative to `base` (which already includes o.pitch)
    for (const p of phrases.values()) {
      if (t < p.start || t > p.end + 0.05) continue;
      const span = Math.max(0.4, p.end - p.start);
      st -= DECLINATION_ST * amount * Math.min(1, (t - p.start) / span);
      if (p.question) {
        const from = p.end - 0.35;
        if (t > from) st += QUESTION_RISE_ST * amount * Math.min(1, ((t - from) / 0.35) ** 2);
      }
    }
    for (const e of accents) {
      const a = e.start - 0.02, b = e.start + e.len + 0.03;
      if (t >= a && t <= b) st += ACCENT_ST * amount * (0.5 - 0.5 * Math.cos((2 * Math.PI * (t - a)) / (b - a)));
    }
    return base * 2 ** (st / 12);
  };
}

// ------------------------------------------------------------------- output

/** Play a synthesised utterance. Returns {stop()} and the context time it starts at. */
export function playSamples(ctx, synth, { volume = 1, when = ctx.currentTime + 0.05, dest = ctx.destination } = {}) {
  const buffer = ctx.createBuffer(1, synth.samples.length, synth.sr);
  buffer.copyToChannel(synth.samples, 0);
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.buffer = buffer;
  src.connect(gain).connect(dest);
  src.start(when);
  return { when, stop() { try { src.stop(); } catch { /* already ended */ } gain.disconnect(); } };
}

export function encodeWav(samples, sampleRate, volume = 1) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s * volume)) * 0x7fff, true));
  return new Blob([view], { type: 'audio/wav' });
}

// ---- raw previews from the chart (the recording as it is, no processing) ----

function playOnce(ctx, bank, { at, len, gain }, volume, dest = ctx.destination) {
  const g = ctx.createGain();
  g.gain.value = volume * gain;
  const src = ctx.createBufferSource();
  src.buffer = bank.audioBuffer;
  src.connect(g).connect(dest);
  src.start(ctx.currentTime + 0.03, at, len);
  return () => { try { src.stop(); } catch { /* already ended */ } g.disconnect(); };
}

/** Play the original example word exactly as recorded. Returns a stop function. */
export function playWord(ctx, bank, id, { volume = 1, dest } = {}) {
  const c = bank.clip(id, 2);
  return playOnce(ctx, bank, { at: c.slotAt, len: c.slotLen, gain: c.gain }, volume, dest);
}

/** Play one isolated phoneme exactly as recorded (including its trailing vowel). */
export function playPhoneme(ctx, bank, id, { volume = 1, dest } = {}) {
  const c = bank.clip(id, 1);
  return playOnce(ctx, bank, { at: c.at, len: c.len, gain: c.gain }, volume, dest);
}
