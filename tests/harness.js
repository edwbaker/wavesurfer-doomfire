// Loads the built plugin into the page, with the test-only window into its state that tests/server.mjs
// adds, and gives the specs helpers to set up a waveform and compare the fire's fuel with the bars
// wavesurfer drew.
import WaveSurfer from "wavesurfer.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = (fn, ms) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => (fn() ? resolve(true) : performance.now() - t0 > ms ? resolve(false) : setTimeout(tick, 30));
    tick();
  });
const hot = (fire) => {
  let n = 0;
  for (const v of fire.getIntensities().data) if (v) n++;
  return n;
};

// beats: loud half-second hits; swell: a slow rise and fall, so neighbouring columns differ by less
// than a cell and any mismatch with the bars is geometry, not sampling
const beats = (t) => (t % 0.5 < 0.18 ? 1 : 0.25) * Math.sin(2 * Math.PI * 220 * t);
const swell = (t) => (0.3 + 0.7 * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 1.5))) * Math.sin(2 * Math.PI * 220 * t);
const shapes = { beats, swell };

const makeBuffer = (seconds, rate, gains, shape = swell) => {
  const length = Math.round(seconds * rate);
  const buffer = new AudioBuffer({ length, numberOfChannels: gains.length, sampleRate: rate });
  gains.forEach((gain, ch) => {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = gain * shape(i / rate);
  });
  return buffer;
};

const wav = (buffer) => {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const view = new DataView(new ArrayBuffer(44 + length * channels * 2));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + length * channels * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, length * channels * 2, true);
  const data = [...Array(channels)].map((_, ch) => buffer.getChannelData(ch));
  let o = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      view.setInt16(o, Math.max(-1, Math.min(1, data[ch][i])) * 32767, true);
      o += 2;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
};

// a slow sine of peaks, for loading with ws.load(url, peaks, duration)
const sinePeaks = (count, period) => {
  const peaks = new Float32Array(count);
  for (let i = 0; i < count; i++) peaks[i] = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((2 * Math.PI * i) / period));
  return peaks;
};

const stage = document.getElementById("stage");

const makeSetup = (Plugin) =>
  async ({ ws: wsOptions = {}, plugin = {}, gains = [1], shape = "swell", seconds = 6, rate = 22050, timeline = false, load } = {}) => {
    const container = document.createElement("div");
    stage.appendChild(container);
    const ws = WaveSurfer.create({ container, height: 200, barWidth: 2, barGap: 1, barHeight: 0.6, sampleRate: rate, ...wsOptions });
    ws.setMuted(true);
    if (timeline) ws.registerPlugin(TimelinePlugin.create());
    const fire = ws.registerPlugin(Plugin.create({ pixelSize: 6, ...plugin }));
    if (load) {
      await load(ws);
    } else {
      // Hand wavesurfer.js the samples, as the demo does, so it doesn't decode the WAV again:
      // decoding opens an AudioContext, which can take seconds.
      const buffer = makeBuffer(seconds, rate, gains, shapes[shape]);
      const channels = gains.map((_, ch) => buffer.getChannelData(ch));
      await ws.loadBlob(wav(buffer), channels, buffer.duration);
    }
    await wait(500);
    return { ws, fire, container, state: () => fire.__state() };
  };

// Compares each column's fuel rows with the bars wavesurfer drew there, read back from its canvases.
const compareFuel = ({ ws, state }) => {
  const t = state();
  const layerTop = t.layer.offsetTop;
  const layerH = t.layer.offsetHeight;
  const cell = t.cellPx;
  const rows = t.rows;
  // the row whose cell [top, bottom) contains y
  const rowAt = (y) => Math.min(rows - 1, Math.max(0, rows - Math.ceil((layerTop + layerH - y) / cell)));
  const boxes = [...ws.getWrapper().querySelector("[part=canvases]").children];
  const extents = boxes.map((box) => {
    const ext = new Map();
    for (const cv of box.querySelectorAll("canvas")) {
      const w = cv.width;
      const h = cv.height;
      if (!w || !h || !cv.offsetWidth) continue;
      const scale = w / cv.offsetWidth;
      const data = cv.getContext("2d").getImageData(0, 0, w, h).data;
      for (let px = 0; px < w; px++) {
        let lo = -1;
        let hi = -1;
        for (let py = 0; py < h; py++) {
          if (data[(py * w + px) * 4 + 3] > 64) {
            if (lo < 0) lo = py;
            hi = py;
          }
        }
        if (lo < 0) continue;
        const x = Math.floor(cv.offsetLeft + px / scale);
        const y0 = box.offsetTop + lo / scale;
        const y1 = box.offsetTop + (hi + 1) / scale;
        const prev = ext.get(x);
        ext.set(x, prev ? [Math.min(prev[0], y0), Math.max(prev[1], y1)] : [y0, y1]);
      }
    }
    return ext;
  });
  let compared = 0;
  let off = 0;
  let worst = 0;
  let missing = 0;
  let extra = 0;
  for (let l = 0; l < t.laneCount; l++) {
    const ext = extents[Math.min(l, extents.length - 1)];
    for (let c = t.padL; c < t.padL + t.cols - 1; c++) {
      const x0 = t.originPx + (c - t.padL) * cell;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let x = x0; x < x0 + cell; x++) {
        const e = ext.get(x);
        if (e) {
          if (e[0] < y0) y0 = e[0];
          if (e[1] > y1) y1 = e[1];
        }
      }
      const k = l * t.simW + c;
      const ft = t.fuelTop[k];
      const fb = t.fuelBottom[k];
      if (!(y1 - y0 >= 1)) {
        if (ft >= 0) extra++;
        continue;
      }
      if (ft < 0) {
        missing++;
        continue;
      }
      const d = Math.max(Math.abs(rowAt(y0) - ft), Math.abs(rowAt(y1 - 0.01) - fb));
      compared++;
      if (d > 1) off++;
      if (d > worst) worst = d;
    }
  }
  return { compared, off, worst, missing, extra, lanes: t.laneCount, boxes: boxes.length };
};

const alphaSum = (canvas) => {
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let alpha = 0;
  for (let i = 3; i < d.length; i += 4) alpha += d[i];
  return alpha;
};

try {
  const mod = await import("./doomfire.under-test.js");
  window.harness = { WaveSurfer, mod, Plugin: mod.default, setup: makeSetup(mod.default), compareFuel, makeBuffer, wav, sinePeaks, wait, until, hot, alphaSum };
} catch (error) {
  window.harnessError = String((error && error.stack) || error);
}
