# Phoneme splicer

Text to speech by stitching recorded English phonemes together. Static site: no build step, no backend.

[![Live Demo](https://img.shields.io/badge/Live-Website-brightgreen?style=for-the-badge&logo=githubpages)](https://circuit-raptor.github.io/Text-2-Speech/)

## Run it locally on PC

The recording is loaded with `fetch`, so open the folder through a web server (double-clicking `index.html` won't work):

```
python -m http.server
# then open http://localhost:8000
```


## How it works

1. `js/g2p.js` splits the text into words and pauses, looks each word up in the CMU Pronouncing Dictionary (`data/cmudict.txt`), and guesses unknown words from spelling rules (shown with a dotted underline). ARPABET is converted to the 44 chart phonemes, British-style by default.
2. `js/sprites.js` is the sprite table copied from EnglishClub's `activity.js`. `"21_1": [60000, 261]` means phoneme 21 (p) starts at 60 s and is 261 ms long; `_2` is its example word.
3. `js/engine.js` prepares every clip once when a voice loads, then `synthesize()` turns phonemes into one waveform:
   - **Consonant tails cut off.** Every consonant was recorded as "consonant + uh". Each one is cut where the vowel begins (found automatically; `CUT_MS` in `js/phonemes.js` overrides it for b, g and ʤ, where the automatic estimate was wrong). This removes the "dogu" sound.
   - **Pitch evened out.** Voiced sounds are re-pitched with PSOLA (`js/dsp.js`) to the voice's own median pitch, then given a gentle intonation: a fall across each phrase, a small lift on stressed vowels, a rise for questions.
   - **Level evened out.** Each class is set to a target level (`LEVEL_DB`), then a smoothed gain curve evens out the whole utterance and the peak is normalised.
   - Playback and WAV export use the same finished waveform.

## Voices

Three recordings live in `assets/voices/`: `male1.mp3` (the original EnglishClub recording), `male2.mp3` and `female.mp3`. They are time-aligned copies of the same performance, so they share the sprite times in `js/sprites.js`. Each one is cut from the reference table in `js/reference.js` (built from `male1.mp3` with `node tools/make-reference.mjs assets/voices/male1.mp3`), shifted by that recording's measured time offset. Pitch is measured per voice, so the pitch tuning follows the voice. To add a voice, drop the file in the folder and list it in `VOICES` at the top of `js/app.js`.

## The page

- Liquid-glass theme over a slow colour field (`css/style.css`); the glass is plain CSS (`backdrop-filter`), no images.
- The phoneme strip is a sliding window: it follows the newest word while typing and centres the word being spoken during playback (`followNewest` / `centerOf` in `js/app.js`).
- The floating spectrogram (`js/spectrogram.js`) reads an `AnalyserNode` that every sound passes through, so it shows speech and chart previews alike.

## Tuning

- The Tuning panel: pace, pitch, intonation, loudness evening, blend, word gap, volume.
- Per-class lengths and levels: `TARGET_MS`, `MAX_NOISE_MS`, `LEVEL_DB` in `js/phonemes.js`.
- Everything is also reachable from the console as `window.splicer` (`splicer.bank.units` holds the processed clips).

Regenerate the dictionary with `node tools/build-dict.mjs` after `npm install cmu-pronouncing-dictionary`.

## Credits and licensing

The recording and chart layout come from EnglishClub.com (Anthony Essberger). Pronunciations: CMU Pronouncing Dictionary (BSD-style licence).
