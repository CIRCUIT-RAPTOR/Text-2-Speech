// The 44 phonemes of the chart, in the same order as EnglishClub's activity.js
// (index = sprite number, so SPRITES["<id>_1"] is the phoneme and "<id>_2" its example word).
//
// kind  : which panel of the chart it lives in
// cls   : sound class, used to decide how long each clip may play when stitching
// word  : [before, highlighted, after] letters of the example word

export const PHONEMES = [
  // monophthongs
  { id: 1,  sym: 'i:', kind: 'vowel',     cls: 'long',  word: ['sh', 'ee', 'p'] },
  { id: 2,  sym: 'ɪ',  kind: 'vowel',     cls: 'short', word: ['sh', 'i', 'p'] },
  { id: 3,  sym: 'ʊ',  kind: 'vowel',     cls: 'short', word: ['g', 'oo', 'd'] },
  { id: 4,  sym: 'u:', kind: 'vowel',     cls: 'long',  word: ['sh', 'oo', 't'] },
  { id: 7,  sym: 'e',  kind: 'vowel',     cls: 'short', word: ['b', 'e', 'd'] },
  { id: 8,  sym: 'ə',  kind: 'vowel',     cls: 'schwa', word: ['teach', 'er', ''] },
  { id: 9,  sym: 'ɜ:', kind: 'vowel',     cls: 'long',  word: ['b', 'ir', 'd'] },
  { id: 10, sym: 'ɔ:', kind: 'vowel',     cls: 'long',  word: ['d', 'oor', ''] },
  { id: 14, sym: 'æ',  kind: 'vowel',     cls: 'short', word: ['c', 'a', 't'] },
  { id: 15, sym: 'ʌ',  kind: 'vowel',     cls: 'short', word: ['', 'u', 'p'] },
  { id: 16, sym: 'ɑ:', kind: 'vowel',     cls: 'long',  word: ['f', 'ar', ''] },
  { id: 17, sym: 'ɒ',  kind: 'vowel',     cls: 'short', word: ['', 'o', 'n'] },
  // diphthongs
  { id: 5,  sym: 'ɪə', kind: 'diphthong', cls: 'diph',  word: ['h', 'ere', ''] },
  { id: 6,  sym: 'eɪ', kind: 'diphthong', cls: 'diph',  word: ['w', 'ai', 't'] },
  { id: 11, sym: 'ʊə', kind: 'diphthong', cls: 'diph',  word: ['c', 'u', 're'] },
  { id: 12, sym: 'ɔɪ', kind: 'diphthong', cls: 'diph',  word: ['b', 'oy', ''] },
  { id: 13, sym: 'əʊ', kind: 'diphthong', cls: 'diph',  word: ['sh', 'ow', ''] },
  { id: 18, sym: 'eə', kind: 'diphthong', cls: 'diph',  word: ['h', 'air', ''] },
  { id: 19, sym: 'aɪ', kind: 'diphthong', cls: 'diph',  word: ['m', 'y', ''] },
  { id: 20, sym: 'aʊ', kind: 'diphthong', cls: 'diph',  word: ['c', 'ow', ''] },
  // consonants
  { id: 21, sym: 'p',  kind: 'consonant', cls: 'stop',  word: ['', 'p', 'ea'] },
  { id: 22, sym: 'f',  kind: 'consonant', cls: 'fric',  word: ['', 'f', 'ly'] },
  { id: 23, sym: 't',  kind: 'consonant', cls: 'stop',  word: ['', 't', 'ea'] },
  { id: 24, sym: 'θ',  kind: 'consonant', cls: 'fric',  word: ['', 'th', 'ink'] },
  { id: 25, sym: 'ʧ',  kind: 'consonant', cls: 'affr',  word: ['', 'ch', 'eese'] },
  { id: 26, sym: 's',  kind: 'consonant', cls: 'fric',  word: ['', 's', 'ee'] },
  { id: 27, sym: 'ʃ',  kind: 'consonant', cls: 'fric',  word: ['', 'sh', 'all'] },
  { id: 28, sym: 'k',  kind: 'consonant', cls: 'stop',  word: ['', 'c', 'ar'] },
  { id: 29, sym: 'b',  kind: 'consonant', cls: 'stop',  word: ['', 'b', 'oat'] },
  { id: 30, sym: 'v',  kind: 'consonant', cls: 'fric',  word: ['', 'v', 'ideo'] },
  { id: 31, sym: 'd',  kind: 'consonant', cls: 'stop',  word: ['', 'd', 'og'] },
  { id: 32, sym: 'ð',  kind: 'consonant', cls: 'fric',  word: ['', 'th', 'is'] },
  { id: 33, sym: 'ʤ',  kind: 'consonant', cls: 'affr',  word: ['', 'J', 'une'] },
  { id: 34, sym: 'z',  kind: 'consonant', cls: 'fric',  word: ['', 'z', 'oo'] },
  { id: 35, sym: 'ʒ',  kind: 'consonant', cls: 'fric',  word: ['telev', 'is', 'ion'] },
  { id: 36, sym: 'g',  kind: 'consonant', cls: 'stop',  word: ['', 'g', 'o'] },
  { id: 37, sym: 'h',  kind: 'consonant', cls: 'fric',  word: ['', 'h', 'at'] },
  { id: 38, sym: 'm',  kind: 'consonant', cls: 'nasal', word: ['', 'm', 'an'] },
  { id: 39, sym: 'n',  kind: 'consonant', cls: 'nasal', word: ['', 'n', 'ow'] },
  { id: 40, sym: 'ŋ',  kind: 'consonant', cls: 'nasal', word: ['si', 'ng', 'er'] },
  { id: 41, sym: 'r',  kind: 'consonant', cls: 'appr',  word: ['', 'r', 'ed'] },
  { id: 42, sym: 'l',  kind: 'consonant', cls: 'appr',  word: ['', 'l', 'ove'] },
  { id: 43, sym: 'w',  kind: 'consonant', cls: 'appr',  word: ['', 'w', 'et'] },
  { id: 44, sym: 'j',  kind: 'consonant', cls: 'appr',  word: ['', 'y', 'es'] },
];

export const BY_ID = new Map(PHONEMES.map(p => [p.id, p]));
const BY_SYM = new Map(PHONEMES.map(p => [p.sym, p.id]));
export const idOf = sym => {
  const id = BY_SYM.get(sym);
  if (id === undefined) throw new Error(`Unknown phoneme symbol: ${sym}`);
  return id;
};

// ---- tunables for the synthesis (all per sound class) ----------------------

// Voiced sounds (vowels, nasals, l r w j) are time-scaled to this length at pace 1.
export const TARGET_MS = { short: 100, schwa: 70, long: 150, diph: 190, nasal: 80, appr: 75 };

// Noise and burst sounds can't be stretched, only cropped: they never play longer than this.
export const MAX_NOISE_MS = { fric: 110, affr: 110, stop: 90, nasal: 90, appr: 90 };

// Level of each class in dBFS (RMS). Consonants sit below vowels, as in natural speech.
export const LEVEL_DB = { short: -21, long: -21, diph: -21, schwa: -24, nasal: -27, appr: -26, fric: -31, affr: -31, stop: -31 };

// Silence before a stop's burst when it follows another sound in the same word.
export const VOICED_STOPS = new Set([29, 31, 36, 33]);        // b d g ʤ
export const CLOSURE_MS = { voiceless: 45, voiced: 30 };

// Where to cut a consonant clip, relative to the automatic vowel-onset estimate (ms).
export const CUT_TAIL_MS = { nasal: 0, appr: 15, fric: -4, affr: -4, stop: -4 };

// Hand-set cut positions (ms from the start of the audible clip) where the automatic estimate
// is wrong. Only used when building the reference (tools/make-reference.mjs); every voice is cut
// from js/reference.js, which is derived from these. Found by looking at spectrograms of the original recording: in these three the
// automatic cut left 25-35 ms of the "uh" vowel on b and g (the "dogu" sound), and cut ʤ
// before its frication had finished. The recordings keep the same timing across voices,
// so these hold for the male/female versions too.
export const CUT_MS = { 29: 20, 36: 50, 33: 80 };

// Sonorants whose vowel onset is measured in every voice to find that recording's time shift.
export const CALIBRATION_IDS = [38, 39, 40, 41, 42, 43, 44];

// ARPABET (CMU dictionary) -> chart symbol, for the sounds that map one-to-one.
export const ARPA_TO_SYM = {
  AE: 'æ', AW: 'aʊ', AY: 'aɪ', B: 'b', CH: 'ʧ', D: 'd', DH: 'ð', EH: 'e',
  EY: 'eɪ', F: 'f', G: 'g', HH: 'h', IH: 'ɪ', JH: 'ʤ', K: 'k', L: 'l',
  M: 'm', N: 'n', NG: 'ŋ', OW: 'əʊ', OY: 'ɔɪ', P: 'p', R: 'r', S: 's',
  SH: 'ʃ', T: 't', TH: 'θ', UH: 'ʊ', UW: 'u:', V: 'v', W: 'w', Y: 'j',
  Z: 'z', ZH: 'ʒ',
};
