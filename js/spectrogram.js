// Live spectrogram: reads an AnalyserNode and paints a scrolling, colourful spectrogram on a canvas.
// Time runs right to left (newest sound enters on the right), frequency runs bottom to top.

const STOPS = [            // [position 0..1, r, g, b] - dark indigo, blue, cyan, green, yellow, orange, pink-white
  [0.00, 20, 20, 110], [0.18, 50, 50, 190], [0.36, 30, 150, 240], [0.52, 40, 225, 190],
  [0.68, 190, 240, 80], [0.82, 255, 180, 60], [0.93, 255, 90, 110], [1.00, 255, 235, 245],
];

function buildLut() {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++;
    const [t0, r0, g0, b0] = STOPS[k], [t1, r1, g1, b1] = STOPS[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    lut.set([r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f, Math.min(255, 70 + t * 520)], i * 4);   // quiet = see-through
  }
  return lut;
}

export class LiveSpectrogram {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {AnalyserNode} analyser
   * @param {{maxHz?: number, speed?: number}} opts  speed = scroll speed in CSS pixels per second
   */
  constructor(canvas, analyser, { maxHz = 8000, speed = 120 } = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.analyser = analyser;
    this.maxHz = maxHz;
    this.speed = speed;
    this.bins = new Uint8Array(analyser.frequencyBinCount);
    this.lut = buildLut();
    this.strip = document.createElement('canvas');          // one column, stretched onto the main canvas
    this.activeUntil = 0;
    this.raf = 0;
    this.last = 0;
    this.carry = 0;
    this.#resize();
    new ResizeObserver(() => this.#resize()).observe(canvas);
  }

  /** Keep scrolling for the next `ms` milliseconds (call again to extend). */
  run(ms) {
    this.activeUntil = Math.max(this.activeUntil, performance.now() + ms);
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(t => this.#frame(t));
    }
  }

  #resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    // keep what was already drawn, scaled to the new size
    const old = document.createElement('canvas');
    old.width = this.canvas.width; old.height = this.canvas.height;
    old.getContext('2d').drawImage(this.canvas, 0, 0);
    this.canvas.width = w; this.canvas.height = h;
    if (old.width && old.height) this.g.drawImage(old, 0, 0, old.width, old.height, 0, 0, w, h);
    this.strip.width = 1; this.strip.height = h;
    this.dpr = dpr;
  }

  #frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.carry += dt * this.speed * this.dpr;
    const dx = Math.floor(this.carry);
    this.carry -= dx;
    if (dx > 0) this.#scroll(dx);
    this.raf = now < this.activeUntil ? requestAnimationFrame(t => this.#frame(t)) : 0;
  }

  #scroll(dx) {
    const { canvas, g, strip } = this;
    const W = canvas.width, H = canvas.height;
    this.analyser.getByteFrequencyData(this.bins);

    // one column of colour: row 0 is the top (maxHz), the last row is 0 Hz
    const nyquist = this.analyser.context.sampleRate / 2;
    const top = Math.min(this.bins.length - 1, (this.maxHz / nyquist) * this.bins.length);
    const img = new ImageData(1, H);
    for (let y = 0; y < H; y++) {
      const pos = (1 - y / (H - 1)) * top;
      const i0 = Math.floor(pos), f = pos - i0;
      const v = this.bins[i0] * (1 - f) + this.bins[Math.min(this.bins.length - 1, i0 + 1)] * f;
      const c = Math.round(255 * (v / 255) ** 0.85) * 4;
      img.data.set(this.lut.subarray(c, c + 4), y * 4);
    }
    strip.getContext('2d').putImageData(img, 0, 0);

    g.globalCompositeOperation = 'copy';
    g.drawImage(canvas, -dx, 0);
    g.globalCompositeOperation = 'source-over';
    g.imageSmoothingEnabled = false;
    g.drawImage(strip, 0, 0, 1, H, W - dx, 0, dx, H);
  }
}
