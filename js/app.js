import { PHONEMES, BY_ID } from './phonemes.js';
import { loadDictionary, textToTokens } from './g2p.js';
import { VoiceBank, DEFAULTS, synthesize, playSamples, encodeWav, playWord, playPhoneme } from './engine.js';
import { LiveSpectrogram } from './spectrogram.js';

const $ = sel => document.querySelector(sel);

// Every voice is a recording with the same layout as the original (same sprite times in
// sprites.js), so adding one is just dropping the file into assets/voices/ and listing it here.
const VOICES = [
  { id: 'male1',  label: 'Male 1', url: 'assets/voices/male1.mp3' },     // the original EnglishClub recording
  { id: 'male2',  label: 'Male 2', url: 'assets/voices/male2.mp3' },
  { id: 'female', label: 'Female', url: 'assets/voices/female.mp3' },
];

const el = {
  status: $('#status'), text: $('#text'), tape: $('#tape'), voice: $('#voice'),
  play: $('#play'), wav: $('#wav'), chart: $('#chart'), tuning: $('#tuning'),
};

// Everything that makes sound goes through `out` -> analyser -> speakers, so the spectrogram
// sees speech and chart previews alike.
const ctx = new (window.AudioContext || window.webkitAudioContext)();
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;
analyser.smoothingTimeConstant = 0.25;
analyser.minDecibels = -100;
analyser.maxDecibels = -32;
const out = ctx.createGain();
out.connect(analyser);
analyser.connect(ctx.destination);
const spectro = new LiveSpectrogram($('#spectro'), analyser);

const state = {
  ctx,
  bank: null,
  banks: new Map(),       // voice id -> VoiceBank, so switching back is instant
  dictWords: 0,
  tokens: [],
  settings: { ...DEFAULTS },
  playing: null,          // { handle, raf }
  tiles: [],              // phoneme buttons on the tape, in playback order
  words: [],              // word strips on the tape, by token index
  oneShot: null,          // stop function for chart previews
};

// ---------------------------------------------------------------- the tape

function renderTape() {
  state.tokens = textToTokens(el.text.value);
  state.tiles = [];
  state.words = [];
  el.tape.replaceChildren();

  if (!state.tokens.length) {
    el.tape.append(Object.assign(document.createElement('p'), {
      className: 'empty', textContent: 'Type some English above to see its phonemes here.',
    }));
    return;
  }

  state.tokens.forEach((tok, ti) => {
    if (tok.kind === 'pause') {
      el.tape.append(Object.assign(document.createElement('span'), {
        className: 'pause', textContent: tok.text, title: `Pause ${tok.ms} ms`,
      }));
      return;
    }
    const strip = document.createElement('div');
    strip.className = 'word' + (tok.guessed ? ' guessed' : '');
    if (tok.guessed) strip.title = 'Not in the dictionary, so this pronunciation is a guess.';
    strip.append(Object.assign(document.createElement('span'), { className: 'spelling', textContent: tok.text }));
    const row = document.createElement('span');
    row.className = 'phonemes';
    for (const id of tok.ids) {
      const btn = tile(id, 'tile');
      btn.addEventListener('click', () => playTokens([{ kind: 'word', text: '', ids: [id], stress: [0] }]));
      state.tiles.push(btn);
      row.append(btn);
    }
    strip.append(row);
    state.words[ti] = strip;
    el.tape.append(strip);
  });
}

function tile(id, className) {
  const p = BY_ID.get(id);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${className} ${p.kind}`;
  b.textContent = p.sym;
  b.setAttribute('aria-label', `Phoneme ${p.sym}, as in ${p.word.join('')}`);
  return b;
}

// Sliding window: the strip scrolls sideways instead of wrapping.

/** Scroll position that puts a word in the middle of the window. */
const centerOf = strip => strip.offsetLeft + strip.offsetWidth / 2 - el.tape.clientWidth / 2;

/** While typing: keep the newest word in view, near the right edge. */
function followNewest(smooth = true) {
  const last = state.words.findLast(Boolean);
  if (!last) return;
  const left = last.offsetLeft + last.offsetWidth - el.tape.clientWidth + el.tape.clientWidth * 0.16;
  el.tape.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
}

// ---------------------------------------------------------------- playback

function setPlaying(on) {
  el.play.classList.toggle('playing', on);
  el.play.setAttribute('aria-label', on ? 'Stop' : 'Speak');
}

function stopAll() {
  state.oneShot?.();
  state.oneShot = null;
  if (!state.playing) return;
  cancelAnimationFrame(state.playing.raf);
  state.playing.handle.stop();
  state.playing = null;
  clearLive();
  setPlaying(false);
}

function clearLive() {
  state.tiles.forEach(t => t.classList.remove('live'));
  state.words.forEach(w => w?.classList.remove('live'));
}

async function playTokens(tokens, { highlight = false } = {}) {
  if (!state.bank) return;
  await ctx.resume();
  stopAll();
  const tl = synthesize(tokens, state.bank, state.settings);
  if (!tl.events.length) return;

  const handle = playSamples(ctx, tl, { volume: state.settings.volume, dest: out });
  const when = handle.when;
  const run = { handle, raf: 0 };
  state.playing = run;
  setPlaying(true);
  spectro.run(tl.duration * 1000 + 900);

  // The browser's own smooth scrolling restarts on every new word and ends up lagging behind, so
  // the strip is steered here instead: each frame it closes a fraction of the gap to the target.
  let lastSeq = -1, lastWord = -1, target = null, lastT = performance.now();
  const tick = () => {
    const now = ctx.currentTime - when;
    const t = performance.now();
    if (target !== null) {
      const cur = el.tape.scrollLeft;
      el.tape.scrollLeft = cur + (target - cur) * (1 - Math.exp(-(t - lastT) / 90));
    }
    lastT = t;
    if (highlight) {
      const ev = tl.events.find(e => now >= e.start && now < e.start + e.len);
      if (ev && ev.seq !== lastSeq) {
        state.tiles[lastSeq]?.classList.remove('live');
        state.tiles[ev.seq]?.classList.add('live');
        if (ev.tokenIndex !== lastWord) {
          state.words[lastWord]?.classList.remove('live');
          state.words[ev.tokenIndex]?.classList.add('live');
          target = centerOf(state.words[ev.tokenIndex]);
          lastWord = ev.tokenIndex;
        }
        lastSeq = ev.seq;
      }
    }
    if (now > tl.duration + 0.1) { if (state.playing === run) stopAll(); return; }
    run.raf = requestAnimationFrame(tick);
  };
  run.raf = requestAnimationFrame(tick);
}

const speak = () => playTokens(state.tokens, { highlight: true });

function saveWav() {
  const tl = synthesize(state.tokens, state.bank, state.settings);
  if (!tl.events.length) return;
  const blob = encodeWav(tl.samples, tl.sr, state.settings.volume);
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'speech.wav' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ------------------------------------------------------------------- chart

const MONO = [[1, 2, 3, 4], [7, 8, 9, 10], [14, 15, 16, 17]];
const DIPH = [[5, 6, null], [11, 12, 13], [18, 19, 20]];
const CONS = [[21, 22, 23, 24, 25, 26, 27, 28], [29, 30, 31, 32, 33, 34, 35, 36], [37, 38, 39, 40, 41, 42, 43, 44]];

function chartGroup(title, rows, cols, className) {
  const sec = document.createElement('div');
  sec.className = `group ${className}`;
  sec.style.setProperty('--cols', cols);
  sec.append(Object.assign(document.createElement('h3'), { textContent: title }));
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const id of rows.flat()) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (id) {
      const p = BY_ID.get(id);
      const t = tile(id, 'key');
      t.addEventListener('click', () => preview(() => playPhoneme(ctx, state.bank, id, { ...state.settings, dest: out })));
      const w = document.createElement('button');
      w.type = 'button';
      w.className = 'example';
      w.setAttribute('aria-label', `Play the word ${p.word.join('')}`);
      const [pre, hl, post] = p.word;
      w.append(pre, Object.assign(document.createElement('b'), { textContent: hl }), post);
      w.addEventListener('click', () => preview(() => playWord(ctx, state.bank, id, { ...state.settings, dest: out })));
      cell.append(t, w);
    }
    grid.append(cell);
  }
  sec.append(grid);
  return sec;
}

async function preview(start) {
  if (!state.bank) return;
  await ctx.resume();
  stopAll();
  state.oneShot = start();
  spectro.run(1700);
}

function renderChart() {
  const vowels = document.createElement('div');
  vowels.className = 'vowels';
  vowels.append(chartGroup('Monophthongs', MONO, 4, 'mono'), chartGroup('Diphthongs', DIPH, 3, 'diph'));
  el.chart.append(vowels, chartGroup('Consonants', CONS, 8, 'cons'));
}

// ------------------------------------------------------------------ tuning

function bindTuning() {
  for (const input of el.tuning.querySelectorAll('input[type=range]')) {
    const output = el.tuning.querySelector(`output[for=${input.id}]`);
    const sync = () => {
      state.settings[input.dataset.key] = Number(input.value);
      const v = Number(input.value);
      output.textContent = {
        x: `${v.toFixed(2)}x`,
        '%': `${Math.round(v * 100)}%`,
        st: `${v > 0 ? '+' : ''}${v.toFixed(1)} st`,
        n: v.toFixed(2),
      }[input.dataset.fmt] ?? `${v} ms`;
    };
    input.value = state.settings[input.dataset.key];
    input.addEventListener('input', sync);
    sync();
  }
}

// -------------------------------------------------------------------- boot

let debounce;
el.text.addEventListener('input', () => {
  clearTimeout(debounce);
  stopAll();
  debounce = setTimeout(() => { renderTape(); followNewest(); }, 120);
});
el.text.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); speak(); }
});
addEventListener('keydown', e => { if (e.key === 'Escape') stopAll(); });
el.play.addEventListener('click', () => (state.playing ? stopAll() : speak()));
el.wav.addEventListener('click', saveWav);

renderChart();
bindTuning();

function fail(err) {
  console.error(err);
  el.status.textContent = location.protocol === 'file:'
    ? 'The recordings can’t load from a file. Serve the folder instead, for example with: python -m http.server'
    : `Couldn’t load the voice: ${err.message}`;
  document.body.classList.remove('ready');
  document.body.classList.add('failed');
}

async function useVoice(id) {
  const voice = VOICES.find(v => v.id === id);
  stopAll();
  el.play.disabled = el.wav.disabled = true;
  el.status.textContent = `Loading the ${voice.label} voice…`;
  try {
    if (!state.banks.has(id)) state.banks.set(id, await VoiceBank.load(ctx, voice.url));
    state.bank = state.banks.get(id);
    el.voice.value = id;
    try { localStorage.setItem('voice', id); } catch { /* private mode: no memory, no problem */ }
    el.play.disabled = el.wav.disabled = false;
    el.status.textContent = `${voice.label} loaded. ${PHONEMES.length} phonemes, ${state.dictWords.toLocaleString()} dictionary words.`;
    document.body.classList.remove('failed');
    document.body.classList.add('ready');
  } catch (err) {
    fail(err);
  }
}

// List the voices, greying out the ones whose file isn't in assets/voices/.
async function setupVoices() {
  const found = await Promise.all(VOICES.map(async v => {
    try { return (await fetch(v.url, { method: 'HEAD' })).ok; } catch { return false; }
  }));
  VOICES.forEach((v, i) => {
    el.voice.append(Object.assign(document.createElement('option'), {
      value: v.id, disabled: !found[i], textContent: found[i] ? v.label : `${v.label} (file not found)`,
    }));
  });
  let saved = null;
  try { saved = localStorage.getItem('voice'); } catch { /* ignore */ }
  const first = VOICES.find((v, i) => found[i] && v.id === saved) ?? VOICES.find((v, i) => found[i]);
  return first?.id ?? null;
}

el.voice.addEventListener('change', () => useVoice(el.voice.value));

try {
  state.dictWords = await loadDictionary();
  const first = await setupVoices();
  if (!first) throw new Error('no voice recording found in assets/voices/');
  renderTape();
  followNewest(false);
  await useVoice(first);
} catch (err) {
  fail(err);
}

// handy for tuning from the console: window.splicer.bank.units, .settings, ...
window.splicer = state;
