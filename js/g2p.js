// Text -> phonemes.
//
//   1. tokenise the text into words and pauses (digits are spoken as words)
//   2. look each word up in the CMU pronouncing dictionary (ARPABET)
//   3. if it isn't there, guess with a small set of spelling rules
//   4. convert ARPABET to the 44 chart phonemes (British-style by default)
//
// The CMU dictionary is American, the chart is British (RP). The conversion
// below bridges the two with a handful of rules; they are approximations.

import { ARPA_TO_SYM, idOf } from './phonemes.js';

const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);
const isVowel = t => !!t && VOWELS.has(t.replace(/\d/, ''));
const base = t => t.replace(/\d/, '');
const stressOf = t => t.match(/\d/)?.[0] ?? '';

// ---------------------------------------------------------------- dictionary

let DICT = null;

export async function loadDictionary(url = 'data/cmudict.txt') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const text = await res.text();
  DICT = new Map();
  for (const line of text.split('\n')) {
    const sp = line.indexOf(' ');
    if (sp > 0) DICT.set(line.slice(0, sp), line.slice(sp + 1));
  }
  return DICT.size;
}

// ------------------------------------------------------------------- numbers

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function below1000(n) {
  const out = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) out.push(ONES[n]); }
  else if (n > 0 || out.length === 0) out.push(ONES[n]);
  return out;
}

export function numberToWords(str) {
  const [intPart, frac] = str.split('.');
  let n = Number(intPart);
  if (!Number.isSafeInteger(n) || n >= 1e12) return [...intPart].map(d => ONES[+d]);   // too big: digit by digit
  if (n === 0) return ['zero', ...(frac ? ['point', ...[...frac].map(d => ONES[+d])] : [])];
  const out = [];
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= size) { out.push(...below1000(Math.floor(n / size)), name); n %= size; }
  }
  if (n > 0) out.push(...below1000(n));
  if (frac) out.push('point', ...[...frac].map(d => ONES[+d]));
  return out;
}

// ------------------------------------------------- spelling rules (fallback)

// Ordered, longest-match-first. Output is ARPABET. Deliberately small:
// it only has to cope with names, coinages and typos.
const RULES = [
  ['tch', 'CH'], ['dge', 'JH'], ['igh', 'AY'], ['tion', 'SH AH0 N'], ['sion', 'ZH AH0 N'],
  ['ch', 'CH'], ['sh', 'SH'], ['th', 'TH'], ['ph', 'F'], ['ck', 'K'], ['qu', 'K W'], ['wh', 'W'],
  ['ng', 'NG'], ['nk', 'NG K'], ['gh', ''],
  ['ee', 'IY1'], ['ea', 'IY1'], ['ai', 'EY1'], ['ay', 'EY1'], ['oa', 'OW1'], ['oo', 'UW1'],
  ['ou', 'AW1'], ['ow', 'OW1'], ['oi', 'OY1'], ['oy', 'OY1'], ['au', 'AO1'], ['aw', 'AO1'],
  ['ie', 'IY1'], ['ei', 'EY1'],
  ['ar', 'AA1 R'], ['or', 'AO1 R'], ['er', 'ER0'], ['ir', 'ER1'], ['ur', 'ER1'],
  ['a', 'AE1'], ['e', 'EH1'], ['i', 'IH1'], ['o', 'AA1'], ['u', 'AH1'], ['y', 'IH1'],
  ['b', 'B'], ['c', 'K'], ['d', 'D'], ['f', 'F'], ['g', 'G'], ['h', 'HH'], ['j', 'JH'], ['k', 'K'],
  ['l', 'L'], ['m', 'M'], ['n', 'N'], ['p', 'P'], ['r', 'R'], ['s', 'S'], ['t', 'T'], ['v', 'V'],
  ['w', 'W'], ['x', 'K S'], ['z', 'Z'], ["'", ''],
];
const MAGIC = { a: 'EY1', e: 'IY1', i: 'AY1', o: 'OW1', u: 'Y UW1' };

export function guessArpa(word) {
  let w = word;
  const out = [];
  // leading silent letters
  if (/^kn/.test(w)) w = w.slice(1);
  else if (/^wr/.test(w)) w = w.slice(1);
  let i = 0;
  while (i < w.length) {
    const rest = w.slice(i);
    // "a_e" style long vowels: vowel + consonant + final e
    const m = rest.match(/^([aeiou])([^aeiou])e$/);
    if (m) { out.push(MAGIC[m[1]], ...ARPA_OF(m[2])); break; }
    if (rest === 'e' && i > 0) break;                                   // silent final e
    if (rest === 'le' && i > 0 && !isVowelLetter(w[i - 1])) { out.push('AH0 L'); break; }
    if (rest === 'y' && i > 0) { out.push('IY0'); break; }
    if (/^c[eiy]/.test(rest)) { out.push('S'); i += 1; continue; }
    if (/^g[eiy]/.test(rest) && i > 0) { out.push('JH'); i += 1; continue; }
    if (rest === 'mb') { out.push('M'); break; }
    const rule = RULES.find(([g]) => rest.startsWith(g));
    if (!rule) { i += 1; continue; }                                    // unknown character: skip
    if (rule[1]) out.push(rule[1]);
    i += rule[0].length;
  }
  return out.join(' ').split(' ').filter(Boolean);
}
const isVowelLetter = c => 'aeiou'.includes(c);
const ARPA_OF = ch => (RULES.find(([g]) => g === ch)?.[1] ?? '').split(' ').filter(Boolean);

// ------------------------------------------------------------ ARPABET -> chart

/**
 * @param {string[]} arpa   e.g. ['HH','AH0','L','OW1']
 * @param {string}   word   the spelling, used to choose between close vowels
 * @param {boolean}  rhotic keep post-vowel R (American) instead of dropping it (British)
 * @returns {{ids: number[], stress: number[]}} phoneme ids and, for vowels, the stress digit (1 = primary)
 */
export function arpaToIds(arpa, word, rhotic = false) {
  const syms = [], stress = [];
  const emit = (sym, st = 0) => { syms.push(sym); stress.push(st); };
  for (let i = 0; i < arpa.length; i++) {
    const t = arpa[i];
    const b = base(t);
    const s = stressOf(t);
    const st = s === '' ? 0 : Number(s);
    const prev = arpa[i - 1] && base(arpa[i - 1]);
    const nextR = arpa[i + 1] && base(arpa[i + 1]) === 'R';
    // an R that is not followed by a vowel is not pronounced in British English
    const dropR = nextR && !rhotic && !isVowel(arpa[i + 2]);
    const eatR = () => { if (dropR) i++; };

    switch (b) {
      case 'AA':
        emit(/o/.test(word) || prev === 'W' ? 'ɒ' : 'ɑ:', st); eatR(); break;
      case 'AO':
        emit(!nextR && /[^aeiou]o[^aeiouwrl]/.test(word) ? 'ɒ' : 'ɔ:', st); eatR(); break;
      case 'AH':
        emit(s === '0' ? 'ə' : 'ʌ', st); break;
      case 'ER':
        if (rhotic) { emit(s === '0' ? 'ə' : 'ɜ:', st); emit('r'); }
        else if (s !== '0' && isVowel(arpa[i + 1])) { emit('ʌ', st); emit('r'); }   // hurry, worry: not "her-ry"
        else emit(s === '0' ? 'ə' : 'ɜ:', st);
        break;
      case 'IY':
        emit(s === '0' ? 'ɪ' : 'i:', st); break;
      case 'IH': case 'EH': case 'UH': {
        const short = { IH: 'ɪ', EH: 'e', UH: 'ʊ' }[b];
        const diph = { IH: 'ɪə', EH: 'eə', UH: 'ʊə' }[b];
        if (dropR) { emit(diph, st); i++; } else emit(short, st);
        break;
      }
      case 'R':
        // an R left over after a vowel that was not handled above (e.g. "AY R")
        if (!rhotic && prev && VOWELS.has(prev) && !isVowel(arpa[i + 1])) break;
        emit('r'); break;
      default:
        if (ARPA_TO_SYM[b]) emit(ARPA_TO_SYM[b], VOWELS.has(b) ? st : 0);
    }
  }
  return { ids: syms.map(idOf), stress };
}

// Small words are not accented in running speech.
const FUNCTION_WORDS = new Set(('the a an of to in on at is are was were be been am and or but for with as it its he she we you ' +
  'they i my your his her our their me him us them can will would could should do does did from by than so if that this').split(' '));

// -------------------------------------------------------------------- tokenise

const TOKEN_RE = /[a-z]+(?:'[a-z]+)*|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|[.,!?;:\n]|-{2,}|[()]/gi;
const PAUSE_MS = { ',': 220, ';': 300, ':': 300, '.': 420, '!': 420, '?': 420, '\n': 450, '--': 250, '(': 150, ')': 150 };

function lookup(word) {
  const w = word.toLowerCase();
  if (DICT?.has(w)) return { arpa: DICT.get(w).split(' '), guessed: false };
  // possessives and contractions: "dave's" -> "dave" + s/z/iz
  const m = w.match(/^(.+)'s$/);
  if (m && DICT?.has(m[1])) {
    const arpa = DICT.get(m[1]).split(' ');
    const last = base(arpa[arpa.length - 1]);
    if (['S', 'Z', 'SH', 'ZH', 'CH', 'JH'].includes(last)) arpa.push('IH0', 'Z');
    else if (['P', 'T', 'K', 'F', 'TH'].includes(last)) arpa.push('S');
    else arpa.push('Z');
    return { arpa, guessed: false };
  }
  const plain = w.replace(/'/g, '');
  if (DICT?.has(plain)) return { arpa: DICT.get(plain).split(' '), guessed: false };
  return { arpa: guessArpa(w), guessed: true };
}

/**
 * @returns {Array<{kind:'word',text:string,ids:number[],guessed:boolean}|{kind:'pause',text:string,ms:number}>}
 */
export function textToTokens(text, { rhotic = false } = {}) {
  const tokens = [];
  const push = (word, spoken = word) => {
    const { arpa, guessed } = lookup(spoken);
    const { ids, stress } = arpaToIds(arpa, spoken.toLowerCase(), rhotic);
    const accent = FUNCTION_WORDS.has(spoken.toLowerCase()) ? stress.map(() => 0) : stress;
    tokens.push({ kind: 'word', text: word, ids, stress: accent, guessed });
  };
  for (const m of text.replace(/&/g, ' and ').replace(/%/g, ' percent ').matchAll(TOKEN_RE)) {
    const tok = m[0];
    if (/^\d/.test(tok)) {
      numberToWords(tok.replace(/,/g, '')).forEach(w => push(w));        // "23" -> "twenty", "three"
    } else if (PAUSE_MS[tok]) {
      const last = tokens[tokens.length - 1];
      if (last?.kind === 'pause') last.ms = Math.max(last.ms, PAUSE_MS[tok]);   // "..." or ", \n": one pause
      else tokens.push({ kind: 'pause', text: tok === '\n' ? '¶' : tok, ms: PAUSE_MS[tok] });
    } else {
      push(tok);
    }
  }
  return tokens;
}
