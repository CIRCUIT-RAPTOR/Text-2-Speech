// Regenerates data/cmudict.txt from the `cmu-pronouncing-dictionary` npm package.
//
//   npm install cmu-pronouncing-dictionary
//   node tools/build-dict.mjs [path-to-package-index.js]
//
// Output: one word per line, "word PH1 PH2 ...", ARPABET with stress digits.
// Only the first pronunciation of each word is kept, and entries with
// characters other than a-z and apostrophes are dropped.
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const pkg = resolve(process.argv[2] ?? 'node_modules/cmu-pronouncing-dictionary/index.js');
const { dictionary } = await import(pathToFileURL(pkg).href);

const lines = [];
for (const [word, pron] of Object.entries(dictionary)) {
  if (/\(\d+\)$/.test(word)) continue;          // alternate pronunciations
  if (!/^[a-z']+$/.test(word)) continue;
  lines.push(`${word} ${pron}`);
}
lines.sort();

mkdirSync('data', { recursive: true });
writeFileSync('data/cmudict.txt', lines.join('\n') + '\n');
console.log(`wrote data/cmudict.txt (${lines.length} words)`);
