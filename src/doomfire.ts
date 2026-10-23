// DoomFire plugin for wavesurfer.js v8.
// The fire algorithm and palette are from doom-fire-algorithm by Filipe Deschamps (MIT), after
// Fabien Sanglard's "How DOOM fire was done".
import WaveSurfer from "wavesurfer.js";
import type { DefinedPlugin, WaveSurferOptions } from "wavesurfer.js";

export type DoomFireColor = string | readonly number[];
export type DoomFireSource = "waveform" | "progress" | "spectrum" | ((time: number, column: number) => number);
export type DoomFireWind = "left" | "right" | "none";

export type DoomFirePluginOptions = {
  /** What lights the fire: the waveform, the playhead's progress, the spectrum at the playhead, or a function of (time, column) returning 0..1. */
  source?: DoomFireSource;
  /** 'waveform': the drawn bars are the fuel. 'bottom': a row of fuel along the floor, as in the original. */
  base?: "waveform" | "bottom";
  /** Progress source: seconds of audio a played stretch takes to burn down. 0 keeps it blazing. */
  burnTime?: number;
  /** Progress source: the share of its heat a burnt-down stretch keeps. */
  embers?: number;
  /** How hard playback stokes the fire. 0 keeps a steady full blaze; 2 is wilder. */
  stoke?: number;
  /** How many sparks loud hits throw off the playhead. 0 turns them off. */
  sparks?: number;
  /** Fire steps per second. */
  fps?: number;
  /** Which way the flames lean. */
  wind?: DoomFireWind;
  /** Loudness to heat. */
  scale?: "db" | "linear";
  /** Decibels below the loudest point that still give heat (48 for loudness, 72 for the spectrum). */
  dbRange?: number;
  /** Measure loudness against the loudest point in the file. */
  normalize?: boolean;
  /** Heat multiplier. */
  gain?: number;
  /** 'back': behind the waveform. 'front': screen-blended over it. */
  layer?: "front" | "back";
  /** CSS mix-blend-mode of the fire layer: 'normal' behind the waveform and 'screen' in front unless set. */
  blendMode?: string;
  /** CSS opacity of the fire layer. */
  opacity?: number;
  /** Cell size in CSS pixels, 1 or more. Smaller cells make finer, shorter flames: heat climbs one cell per step. */
  pixelSize?: number;
  /** Colours from cold to hot, CSS strings or [r, g, b], stretched over the 37 heat steps. */
  palette?: readonly DoomFireColor[];
  /** Print each cell's heat. Use a pixelSize of 14 or more. */
  debug?: boolean;
  /** Start lit. */
  burning?: boolean;
  /** Spectrum source: FFT size. */
  fftSize?: number;
  /** Spectrum source: the highest frequency shown. Defaults to Nyquist. */
  maxFrequency?: number;
};

export type DoomFirePluginEvents = {
  destroy: [];
  ignite: [];
  extinguish: [];
  burnout: [];
};

export type DoomFireApi = {
  ignite(): void;
  extinguish(): void;
  isBurning(): boolean;
  setOptions(options?: DoomFirePluginOptions | null): void;
  getCanvas(): HTMLCanvasElement;
  getIntensities(): { columns: number; rows: number; data: Uint8Array };
};

type DefaultedOption = "source" | "base" | "burnTime" | "embers" | "stoke" | "sparks" | "fps" | "wind" | "scale" | "normalize" | "gain" | "layer" | "opacity" | "pixelSize" | "debug" | "burning" | "fftSize";
type Options = Required<Pick<DoomFirePluginOptions, DefaultedOption>> & Omit<DoomFirePluginOptions, DefaultedOption>;
type Analysis = {
  channels: Float32Array[];
  length: number;
  rate: number;
  blocks: Float32Array;
  channelBlocks: Float32Array[];
  peak: number;
  channelPeaks: number[];
};
type Lane = {
  top: number;
  height: number;
  topChannel: number;
  bottomChannel: number;
  scale: number;
  align?: "top" | "bottom";
  pitch: number;
  minHeight: number;
  overlay?: boolean;
};
type Spark = { x: number; y: number; vx: number; vy: number; heat: number; cool: number };

export const DOOM_FIRE_PALETTE: [number, number, number][] = [
  [7, 7, 7],
  [31, 7, 7],
  [47, 15, 7],
  [71, 15, 7],
  [87, 23, 7],
  [103, 31, 7],
  [119, 31, 7],
  [143, 39, 7],
  [159, 47, 7],
  [175, 63, 7],
  [191, 71, 7],
  [199, 71, 7],
  [223, 79, 7],
  [223, 87, 7],
  [223, 87, 7],
  [215, 95, 7],
  [215, 95, 7],
  [215, 103, 15],
  [207, 111, 15],
  [207, 119, 15],
  [207, 127, 15],
  [207, 135, 23],
  [199, 135, 23],
  [199, 143, 23],
  [199, 151, 31],
  [191, 159, 31],
  [191, 159, 31],
  [191, 167, 39],
  [191, 167, 39],
  [191, 175, 47],
  [183, 175, 47],
  [183, 183, 47],
  [183, 183, 55],
  [207, 207, 111],
  [223, 223, 159],
  [239, 239, 199],
  [255, 255, 255],
];

const defaults: Required<Pick<DoomFirePluginOptions, DefaultedOption>> = {
  source: "waveform",
  base: "waveform",
  burnTime: 2.5,
  embers: 0.3,
  stoke: 1,
  sparks: 1,
  fps: 30,
  wind: "left",
  scale: "db",
  normalize: true,
  gain: 1,
  layer: "back",
  opacity: 1,
  pixelSize: 4,
  debug: false,
  burning: true,
  fftSize: 2048,
};
const numericOptions = new Set(["burnTime", "embers", "stoke", "sparks", "fps", "gain", "opacity", "fftSize", "pixelSize", "dbRange", "maxFrequency"]);
const finiteNumber = (value: unknown): number | undefined => {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
};

/** One step of the fire, row by row from the top: each cell takes the cell below, cooled by 0-2 and blown by the wind. */
export function stepFire(fire: Uint8Array, width: number, height: number, wind: DoomFireWind = "left", random: () => number = Math.random, reverse = false): void {
  for (let row = 0; row < height - 1; row++) {
    const rowStart = row * width;
    const below = rowStart + width;
    if (wind === "left") {
      for (let col = 0; col < width; col++) {
        const decay = (random() * 3) | 0;
        const value = fire[below + col] - decay;
        const dst = col - decay;
        if (dst >= 0) fire[rowStart + dst] = value > 0 ? value : 0;
      }
    } else if (wind === "right") {
      for (let col = width - 1; col >= 0; col--) {
        const decay = (random() * 3) | 0;
        const value = fire[below + col] - decay;
        const dst = col + decay;
        if (dst < width) fire[rowStart + dst] = value > 0 ? value : 0;
      }
    } else {
      for (let i = 0; i < width; i++) {
        const col = reverse ? width - 1 - i : i;
        const decay = (random() * 3) | 0;
        const value = fire[below + col] - decay;
        const dst = col + ((random() * 3) | 0) - 1;
        if (dst >= 0 && dst < width) fire[rowStart + dst] = value > 0 ? value : 0;
      }
    }
  }
}

function shiftRows(array: Uint8Array | Int16Array | Float32Array, width: number, k: number, empty = 0): void {
  for (let s = 0; s < array.length; s += width) {
    if (k > 0) {
      array.copyWithin(s, s + k, s + width);
      array.fill(empty, s + width - k, s + width);
    } else {
      array.copyWithin(s - k, s, s + width + k);
      array.fill(empty, s, s - k);
    }
  }
}

const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
function packRGBA(r: number, g: number, b: number, a: number): number {
  return littleEndian ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}
const toByte = (v: number): number => (v > 0 ? (v < 255 ? Math.round(v) : 255) : 0);

let colorProbe: CanvasRenderingContext2D | null = null;
function toRGB(color: DoomFireColor): readonly number[] {
  if (typeof color !== "string") return color;
  if (!colorProbe) {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    colorProbe = probe.getContext("2d", { willReadFrequently: true });
    if (!colorProbe) return [0, 0, 0];
  }
  colorProbe.clearRect(0, 0, 1, 1);
  colorProbe.fillStyle = "#000";
  colorProbe.fillStyle = color;
  colorProbe.fillRect(0, 0, 1, 1);
  const [r, g, b] = colorProbe.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

const MAX_HEAT = 36;
function buildPalette(colors?: readonly DoomFireColor[]): { packed: Uint32Array; css: string[] } {
  const list = colors && colors.length ? colors : DOOM_FIRE_PALETTE;
  const stops = (list.length === 1 ? [list[0], list[0]] : list).map(toRGB);
  const packed = new Uint32Array(MAX_HEAT + 1);
  const css: string[] = [];
  for (let i = 0; i <= MAX_HEAT; i++) {
    const x = (i / MAX_HEAT) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(x));
    const f = x - k;
    const [r, g, b] = [0, 1, 2].map((ch) => toByte(stops[k][ch] + (stops[k + 1][ch] - stops[k][ch]) * f));
    const alpha = i === 0 ? 0 : Math.min(1, i / 4);
    packed[i] = packRGBA(r, g, b, Math.round(alpha * 255));
    css.push(`rgba(${r},${g},${b},${alpha})`);
  }
  return { packed, css };
}

function createFFT(n: number): (re: Float64Array, im: Float64Array) => void {
  const bits = Math.round(Math.log2(n));
  const reversed = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    reversed[i] = r;
  }
  const cos = new Float64Array(n >> 1);
  const sin = new Float64Array(n >> 1);
  for (let i = 0; i < n >> 1; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = reversed[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const stride = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * stride];
          const wi = sin[k * stride];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  };
}

const BLOCK = 256;
function scanPeak(channels: Float32Array[], from: number, to: number, max: number): number {
  for (const data of channels) {
    for (let i = from; i < to; i++) {
      const v = data[i];
      if (v > max) max = v;
      else if (-v > max) max = -v;
    }
  }
  return max;
}

function analyseAudio(buffer: AudioBuffer): Analysis {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));
  const length = buffer.length;
  const count = Math.ceil(length / BLOCK);
  const blocks = new Float32Array(count);
  const channelBlocks = channels.map((data) => {
    const own = new Float32Array(count);
    for (let b = 0, i = 0; b < count; b++) {
      let max = 0;
      const end = Math.min(length, i + BLOCK);
      for (; i < end; i++) {
        const v = data[i];
        if (v > max) max = v;
        else if (-v > max) max = -v;
      }
      own[b] = max;
      if (max > blocks[b]) blocks[b] = max;
    }
    return own;
  });
  const peakOf = (values: Float32Array) => {
    let peak = 0;
    for (let b = 0; b < values.length; b++) if (values[b] > peak) peak = values[b];
    return peak;
  };
  return {
    channels,
    length,
    // samples per second of the buffer as wavesurfer sees it (pre-decoded peaks have their own)
    rate: buffer.duration > 0 ? length / buffer.duration : 0,
    blocks,
    channelBlocks,
    peak: peakOf(blocks),
    channelPeaks: channelBlocks.map(peakOf),
  };
}

const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

const DoomFirePlugin: DefinedPlugin<DoomFirePluginOptions, DoomFirePluginEvents, DoomFireApi> = WaveSurfer.definePlugin<DoomFirePluginOptions, DoomFirePluginEvents, DoomFireApi>(
  "DoomFirePlugin",
  (ctx, options) => {
    const withDefaults = (current: Options, next?: DoomFirePluginOptions | null): Options => {
      const merged: Record<string, unknown> = { ...current };
      for (const [key, value] of Object.entries(next || {})) {
        if (value == null || !numericOptions.has(key)) {
          merged[key] = value === undefined && key in defaults ? defaults[key as DefaultedOption] : value;
          continue;
        }
        const number = finiteNumber(value);
        if (number !== undefined) merged[key] = number;
      }
      return merged as Options;
    };
    let opts = withDefaults({ ...defaults }, options);
    let palette = buildPalette(opts.palette);
    let burning = opts.burning;
    let burntOut = !burning;

    const layer = document.createElement("div");
    layer.setAttribute("part", "doomfire");
    Object.assign(layer.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      pointerEvents: "none",
    });
    const canvas = document.createElement("canvas");
    canvas.setAttribute("part", "doomfire-canvas");
    Object.assign(canvas.style, {
      position: "absolute",
      display: "block",
      top: "auto", // the shadow DOM stylesheet pins canvases to the top
      bottom: "0",
      left: "0",
      imageRendering: "pixelated",
      pointerEvents: "none",
    });
    layer.appendChild(canvas);
    const g = canvas.getContext("2d") as CanvasRenderingContext2D;

    const mount = () => {
      const wrapper = ctx.wavesurfer.getWrapper();
      const back = opts.layer === "back";
      layer.style.zIndex = back ? "0" : "3";
      layer.style.mixBlendMode = opts.blendMode ?? (back ? "normal" : "screen");
      layer.style.opacity = String(opts.opacity);
      if (back) wrapper.prepend(layer);
      else wrapper.appendChild(layer);
    };
    mount();
    ctx.scope.add(() => layer.remove());

    let cellPx = 0;
    let cols = 0;
    let rows = 0;
    let padL = 0;
    let padR = 0;
    let simW = 0;
    let fire = new Uint8Array(0);
    let heat = new Float32Array(0);
    let colTime = new Float64Array(0);
    let colSpan = 0;
    let originPx = 0;
    let canvasLeft = -1;
    let image: ImageData | null = null;
    let pixels = new Uint32Array(0);
    let dpr = 1;
    let viewW = 0;
    let viewH = 0;
    let viewTop = -1;
    let totalW = -1;
    let duration = -1;
    let heatDirty = true;
    let heatShift = 0;
    let redraw = true;
    let reverse = false;
    let lanes: Lane[] = [];
    let laneCount = 0;
    let perPx = 0;
    let fuelTop = new Int16Array(0);
    let fuelBottom = new Int16Array(0);
    let fuelCore = new Int16Array(0);
    let levels = new Uint8Array(0);
    const burnsWaveform = () => opts.base === "waveform" && opts.source !== "spectrum";

    let stokeLevel = 0;
    let slowLevel = 0;
    let stokeCol = -1;
    let sparkBudget = 0;
    let pulse = 1;
    let pulseLevel = 0;
    let sparks: Spark[] = [];

    let audio: Analysis | null = null;
    const loadAudio = () => {
      const buffer = ctx.wavesurfer.getDecodedData();
      audio = buffer && buffer.length ? analyseAudio(buffer) : null;
      heatDirty = true;
      spectrumKey = "";
    };

    const windPadding = (): [number, number] => {
      const reach = Math.min(rows * 2, MAX_HEAT) + 1;
      if (opts.wind === "left") return [0, reach];
      if (opts.wind === "right") return [reach, 0];
      const wobble = Math.min(rows, MAX_HEAT) + 1;
      return [wobble, wobble];
    };

    const resizeBacking = () => {
      if (!cols || !rows) return;
      if (opts.debug) {
        dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(cols * cellPx * dpr);
        canvas.height = Math.round(rows * cellPx * dpr);
        image = null;
      } else {
        canvas.width = cols;
        canvas.height = rows;
        image = g.createImageData(cols, rows);
        pixels = new Uint32Array(image.data.buffer);
      }
      redraw = true;
    };

    const regrid = (cell: number, newCols: number, newRows: number) => {
      const oldW = simW;
      const oldPadL = padL;
      const oldRows = rows;
      const oldCell = cellPx;
      const old = fire;
      cellPx = cell;
      cols = newCols;
      rows = newRows;
      [padL, padR] = windPadding();
      simW = padL + cols + padR;
      fire = new Uint8Array(simW * rows);
      if (old.length && oldCell === cell) {
        const keep = Math.min(oldRows, rows);
        for (let r = 1; r <= keep; r++) {
          const src = (oldRows - r) * oldW;
          const dst = (rows - r) * simW;
          for (let c = 0; c < simW; c++) {
            const from = c - padL + oldPadL;
            if (from >= 0 && from < oldW) fire[dst + c] = old[src + from];
          }
        }
      }
      heat = new Float32Array(simW);
      colTime = new Float64Array(simW);
      sparks = [];
      canvas.style.width = `${cols * cell}px`;
      canvas.style.height = `${rows * cell}px`;
      resizeBacking();
      heatDirty = true;
      spectrumKey = "";
    };

    const shiftColumns = (k: number) => {
      for (const spark of sparks) spark.x -= k;
      if (k >= simW || -k >= simW) fire.fill(0);
      else shiftRows(fire, simW, k);
    };

    const syncLayout = () => {
      const ws = ctx.wavesurfer;
      const wrapper = ws.getWrapper();
      const contentW = wrapper.clientWidth;
      const width = Math.min(ws.getWidth(), contentW);
      // the drawn waveform's own box: plugins such as Timeline and Spectrogram add content to the wrapper too
      const waveform = wrapper.querySelector<HTMLElement>("[part=canvases]");
      const top = waveform ? waveform.offsetTop : 0;
      const height = waveform ? waveform.offsetHeight : wrapper.clientHeight;
      if (width <= 0 || height <= 0) return false;
      const cell = Math.max(1, Math.round(opts.pixelSize ?? defaults.pixelSize));
      const newCols = Math.ceil(width / cell) + 1;
      const newRows = Math.ceil(height / cell);
      if (cell !== cellPx || newCols !== cols || newRows !== rows) {
        regrid(cell, newCols, newRows);
      } else {
        const [l, r] = windPadding();
        if (l !== padL || r !== padR) regrid(cell, newCols, newRows);
      }
      const scroll = Math.min(ws.getScroll(), Math.max(0, contentW - width));
      const origin = Math.floor(scroll / cell) * cell;
      if (origin !== originPx) {
        const k = (origin - originPx) / cell;
        if (opts.source === "spectrum") {
          heatDirty = true;
        } else {
          shiftColumns(k);
          heatShift += k;
        }
        originPx = origin;
        redraw = true;
      }
      if (origin !== canvasLeft) {
        canvasLeft = origin;
        canvas.style.left = `${origin}px`;
      }
      const d = ws.getDuration();
      const dur = Number.isFinite(d) && d > 0 ? d : 0;
      if (top !== viewTop || height !== viewH) {
        layer.style.top = `${top}px`;
        layer.style.height = `${height}px`;
      }
      if (contentW !== totalW || dur !== duration || height !== viewH || top !== viewTop) {
        totalW = contentW;
        duration = dur;
        viewH = height;
        viewTop = top;
        heatDirty = true;
      }
      viewW = width;
      return true;
    };

    /** The loudest sample between two sample positions, over one channel or all of them. */
    const peakBetween = (a: Analysis, from: number, to: number, channel = -1) => {
      let s0 = Math.floor(from);
      let s1 = Math.ceil(to);
      if (s0 < 0) s0 = 0;
      if (s1 > a.length) s1 = a.length;
      if (s1 <= s0) {
        if (s0 >= a.length) return 0;
        s1 = s0 + 1;
      }
      let max = 0;
      const channels = channel < 0 ? a.channels : [a.channels[channel]];
      const blocks = channel < 0 ? a.blocks : a.channelBlocks[channel];
      const firstBlock = Math.ceil(s0 / BLOCK);
      const endBlock = Math.floor(s1 / BLOCK);
      if (endBlock - firstBlock >= 2) {
        for (let b = firstBlock; b < endBlock; b++) if (blocks[b] > max) max = blocks[b];
        max = scanPeak(channels, s0, firstBlock * BLOCK, max);
        max = scanPeak(channels, endBlock * BLOCK, s1, max);
      } else {
        max = scanPeak(channels, s0, s1, max);
      }
      return max;
    };

    const loudnessToHeat = (amplitude: number, a: Analysis) => {
      const level = opts.normalize && a.peak > 0 ? amplitude / a.peak : amplitude;
      if (opts.scale === "db") return level > 0 ? clamp01(1 + (20 * Math.log10(level)) / (opts.dbRange ?? 48)) : 0;
      return clamp01(level);
    };

    const computeLanes = (a: Analysis): Lane[] => {
      const wsOptions = ctx.wavesurfer.options;
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const lane = (o: Partial<WaveSurferOptions>, topChannel: number, bottomChannel: number) => {
        // wavesurfer normalizes a waveform by the peak of all the channels drawn in it
        const peak = o.maxPeak || Math.max(a.channelPeaks[topChannel] ?? 0, a.channelPeaks[bottomChannel] ?? 0);
        const scale = (o.barHeight || 1) / (o.normalize && peak > 0 ? peak : 1);
        // bars sit on a grid of this pitch, each drawing the samples that round to its slot
        const bars = Boolean(o.barWidth || o.barGap || o.barAlign);
        const barWidth = o.barWidth || 1 / ratio;
        const pitch = bars ? barWidth + (o.barGap || (o.barWidth ? barWidth / 2 : 0)) : 0;
        return { topChannel, bottomChannel, scale, align: o.barAlign, pitch, minHeight: bars ? o.barMinHeight || 0 : 0 };
      };
      const split = wsOptions.splitChannels;
      const bands = split
        ? a.channels.map((_, ch) => ({ overlay: ch > 0 && Boolean(split[ch]?.overlay), ...lane({ ...wsOptions, ...split[ch] }, ch, ch) }))
        : [lane(wsOptions, 0, a.channels.length > 1 ? 1 : 0)];
      // the boxes wavesurfer drew each waveform in, which honour per-channel heights and overlays
      const boxes = ctx.wavesurfer.getWrapper().querySelector("[part=canvases]")?.children;
      if (boxes && boxes.length === bands.length) {
        return bands.map((band, i) => {
          const box = boxes[i] as HTMLElement;
          return { top: box.offsetTop - viewTop, height: box.offsetHeight, ...band };
        });
      }
      let stacked = 0;
      const slots = bands.map((band) => ("overlay" in band && band.overlay ? Math.max(0, stacked - 1) : stacked++));
      const height = viewH / Math.max(1, stacked);
      return bands.map((band, i) => ({ top: slots[i] * height, height, ...band }));
    };

    // the first sample behind CSS pixel x: in bar mode, of the first bar slot at or after x
    const sampleAt = (x: number, pitch: number) => (pitch ? Math.ceil((Math.ceil(x / pitch) - 0.5) * pitch * perPx) : x * perPx);

    const computeColumns = (from: number, to: number) => {
      const a = audio;
      if (!laneCount) {
        if (opts.source !== "waveform" && opts.source !== "progress") return;
        for (let c = from; c < to; c++) {
          const s0 = (originPx + (c - padL) * cellPx) * perPx;
          const s1 = s0 + cellPx * perPx;
          heat[c] = a && perPx > 0 && s1 > 0 && s0 < a.length ? loudnessToHeat(peakBetween(a, s0, s1), a) : 0;
        }
        return;
      }
      if (!a) return;
      const rowAt = (y: number) => Math.min(rows - 1, Math.max(0, rows - Math.ceil((viewH - y) / cellPx)));
      lanes.forEach((lane, l) => {
        const half = lane.height / 2;
        for (let c = from; c < to; c++) {
          const x0 = originPx + (c - padL) * cellPx;
          const s0 = sampleAt(x0, lane.pitch);
          const s1 = sampleAt(x0 + cellPx, lane.pitch);
          if (s1 <= s0 || s1 <= 0 || s0 >= a.length) continue;
          const topPeak = peakBetween(a, s0, s1, lane.topChannel);
          const bottomPeak = lane.bottomChannel === lane.topChannel ? topPeak : peakBetween(a, s0, s1, lane.bottomChannel);
          heat[l * simW + c] = loudnessToHeat(topPeak > bottomPeak ? topPeak : bottomPeak, a);
          let up = topPeak * half * lane.scale;
          let down = bottomPeak * half * lane.scale;
          if (up + down < lane.minHeight) {
            if (lane.align) down = lane.minHeight - up;
            else up = down = lane.minHeight / 2;
          }
          let y0 = lane.top + half - up;
          let y1 = lane.top + half + down;
          if (lane.align === "top") {
            y0 = lane.top;
            y1 = lane.top + up + down;
          } else if (lane.align === "bottom") {
            y1 = lane.top + lane.height;
            y0 = y1 - up - down;
          }
          y0 = Math.max(y0, lane.top);
          y1 = Math.min(y1, lane.top + lane.height);
          if (y1 - y0 < 1) continue;
          fuelTop[l * simW + c] = rowAt(y0);
          fuelBottom[l * simW + c] = rowAt(y1 - 0.01);
          const core = lane.align === "top" ? lane.top : lane.align === "bottom" ? lane.top + lane.height : lane.top + half;
          fuelCore[l * simW + c] = rowAt(Math.min(Math.max(core, y0), y1 - 0.01));
        }
      });
    };

    const setColumnTimes = () => {
      const secPerPx = totalW > 0 ? duration / totalW : 0;
      colSpan = cellPx * secPerPx;
      for (let c = 0; c < simW; c++) colTime[c] = (originPx + (c - padL) * cellPx) * secPerPx;
    };

    const computeHeat = () => {
      heatDirty = false;
      heatShift = 0;
      setColumnTimes();
      const a = audio;
      // columns map to samples the way wavesurfer lays out the bars: by position across the drawn width
      perPx = a && totalW > 0 ? a.length / totalW : 0;
      lanes = a && burnsWaveform() && perPx > 0 ? computeLanes(a) : [];
      laneCount = lanes.length;
      const size = Math.max(1, laneCount) * simW;
      if (heat.length !== size) heat = new Float32Array(size);
      if (laneCount) {
        if (fuelTop.length !== size) {
          fuelTop = new Int16Array(size);
          fuelBottom = new Int16Array(size);
          fuelCore = new Int16Array(size);
        }
        fuelTop.fill(-1);
        heat.fill(0);
      }
      computeColumns(0, simW);
    };

    // scrolling by whole cells only brings new columns into view: move the rest along with the fire
    const shiftHeat = () => {
      const k = heatShift;
      heatShift = 0;
      if (!Number.isInteger(k) || k >= simW || -k >= simW) {
        computeHeat();
        return;
      }
      setColumnTimes();
      shiftRows(heat, simW, k);
      if (laneCount) {
        shiftRows(fuelTop, simW, k, -1);
        shiftRows(fuelBottom, simW, k);
        shiftRows(fuelCore, simW, k);
      }
      computeColumns(k > 0 ? simW - k : 0, k > 0 ? simW : -k);
    };

    let fftSize = 0;
    let fft: ((re: Float64Array, im: Float64Array) => void) | null = null;
    let re = new Float64Array(0);
    let im = new Float64Array(0);
    let hann = new Float64Array(0);
    let spectrumKey = "";
    const computeSpectrum = () => {
      const a = audio;
      const visible = Math.max(1, Math.round(viewW / cellPx));
      const now = ctx.wavesurfer.getCurrentTime();
      const n = 2 ** Math.round(Math.log2(Math.min(32768, Math.max(64, opts.fftSize))));
      const range = opts.dbRange ?? 72;
      const key = `${now}|${simW}|${visible}|${n}|${range}|${opts.maxFrequency}|${opts.normalize}`;
      if (key === spectrumKey) return;
      spectrumKey = key;
      heat.fill(0);
      if (!a || !a.rate) return;
      if (n !== fftSize) {
        fftSize = n;
        fft = createFFT(n);
        re = new Float64Array(n);
        im = new Float64Array(n);
        hann = new Float64Array(n);
        for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      }
      const start = Math.round(duration > 0 ? (now / duration) * a.length : now * a.rate) - (n >> 1);
      const channelCount = a.channels.length;
      for (let i = 0; i < n; i++) {
        const index = start + i;
        let v = 0;
        if (index >= 0 && index < a.length) {
          for (let ch = 0; ch < channelCount; ch++) v += a.channels[ch][index];
          v /= channelCount;
        }
        re[i] = v * hann[i];
        im[i] = 0;
      }
      fft?.(re, im);
      const half = n >> 1;
      const nyquist = a.rate / 2;
      const top = Math.min(opts.maxFrequency ?? nyquist, nyquist);
      const bins = Math.max(1, Math.min(half, Math.round((top / nyquist) * half)));
      const scale = 4 / n / (opts.normalize && a.peak > 0 ? a.peak : 1);
      for (let c = 0; c < visible; c++) {
        const b0 = 1 + Math.floor((c * bins) / visible);
        const b1 = Math.max(b0 + 1, 1 + Math.floor(((c + 1) * bins) / visible));
        let max = 0;
        for (let b = b0; b < b1 && b <= half; b++) {
          const mag = re[b] * re[b] + im[b] * im[b];
          if (mag > max) max = mag;
        }
        const level = Math.sqrt(max) * scale;
        heat[padL + c] = level > 0 ? clamp01(1 + (20 * Math.log10(level)) / range) : 0;
      }
    };

    const computeLevels = () => {
      const laneRows = Math.max(1, laneCount);
      if (levels.length !== laneRows * simW) levels = new Uint8Array(laneRows * simW);
      const gain = opts.gain * MAX_HEAT * (opts.source === "spectrum" ? 1 : pulse);
      const source = opts.source;
      const toLevel = (h: number) => {
        const v = Math.round(h * gain);
        return v > 0 ? (v < MAX_HEAT ? v : MAX_HEAT) : 0;
      };
      if (typeof source === "function") {
        for (let c = 0; c < simW; c++) {
          const level = toLevel(clamp01(Number(source(colTime[c] + colSpan / 2, c - padL))));
          for (let l = 0; l < laneRows; l++) levels[l * simW + c] = level;
        }
        return;
      }
      if (source === "spectrum") computeSpectrum();
      if (source === "progress") {
        const now = ctx.wavesurfer.getCurrentTime();
        const burnTime = Math.max(0, opts.burnTime);
        const embers = clamp01(opts.embers);
        for (let c = 0; c < simW; c++) {
          const since = now - colTime[c];
          const envelope = since < 0 ? 0 : burnTime > 0 ? embers + (1 - embers) * Math.exp(-since / burnTime) : 1;
          for (let l = 0; l < laneRows; l++) levels[l * simW + c] = toLevel(heat[l * simW + c] * envelope);
        }
        return;
      }
      for (let i = 0; i < levels.length; i++) levels[i] = toLevel(heat[i]);
    };

    const applyFuel = () => {
      for (let l = 0; l < laneCount; l++) {
        for (let c = 0; c < simW; c++) {
          const k = l * simW + c;
          const level = levels[k];
          const top = fuelTop[k];
          if (!level || top < 0) continue;
          const bottom = fuelBottom[k];
          const core = fuelCore[k];
          for (let r = top; r <= bottom; r++) {
            const d = r < core ? (core - r) / (core - top + 1) : (r - core) / (bottom - core + 1);
            const v = Math.round(level * (1 - 0.45 * d)) - ((Math.random() * 3) | 0);
            fire[r * simW + c] = v > 0 ? v : 0;
          }
        }
      }
    };

    const updateStoke = () => {
      const ws = ctx.wavesurfer;
      const a = audio;
      const playing = ws.isPlaying();
      let live = 0;
      stokeCol = -1;
      if (a && duration > 0 && totalW > 0 && opts.source !== "spectrum") {
        const now = ws.getCurrentTime();
        stokeCol = ((now / duration) * totalW - originPx) / cellPx + padL;
        if (playing) {
          const reference = opts.normalize && a.peak > 0 ? a.peak : 1;
          const at = (now / duration) * a.length;
          const span = (0.03 / duration) * a.length;
          live = Math.pow(clamp01(peakBetween(a, at - span, at + span) / reference), 0.6);
        }
      }
      const rise = live - slowLevel;
      stokeLevel = live > stokeLevel ? live : stokeLevel * 0.8;
      slowLevel += (live - slowLevel) * 0.1;
      pulseLevel = live > pulseLevel ? live : pulseLevel * 0.9;
      const calm = 1 - 0.5 * Math.min(1, Math.max(0, opts.stoke));
      const target = playing && stokeCol >= 0 ? calm + (1 - calm) * pulseLevel : calm;
      pulse += (target - pulse) * 0.3;
      if (!playing || opts.sparks <= 0) {
        sparkBudget = 0;
        return;
      }
      if (rise > 0.08) sparkBudget += rise * 24 * opts.sparks;
      sparkBudget += live * live * 0.5 * opts.sparks;
    };

    const stokeRadius = () => Math.max(2, Math.round(36 / cellPx));

    const applyStoke = () => {
      const peak = Math.min(1, stokeLevel * opts.stoke);
      if (stokeCol < 0 || peak < 0.04) return;
      const radius = stokeRadius();
      const spread = radius * 0.6;
      const fuel = burnsWaveform();
      const laneRows = fuel ? laneCount : 1;
      const last = Math.min(simW - 1, Math.ceil(stokeCol + radius));
      for (let c = Math.max(0, Math.floor(stokeCol - radius)); c <= last; c++) {
        const x = (c + 0.5 - stokeCol) / spread;
        const strength = peak * Math.exp(-x * x);
        if (strength < 0.04) continue;
        const hot = Math.round(MAX_HEAT * strength);
        const jet = Math.round(strength * rows * 0.35);
        for (let l = 0; l < laneRows; l++) {
          const top = fuel ? fuelTop[l * simW + c] : rows - 1;
          if (top < 0) continue;
          const bottom = fuel ? fuelBottom[l * simW + c] : rows - 1;
          for (let r = Math.max(0, top - jet); r <= bottom; r++) {
            const i = r * simW + c;
            const v = hot - ((Math.random() * 3) | 0);
            if (v > fire[i]) fire[i] = v;
          }
        }
      }
    };

    const moveSparks = () => {
      let count = stokeCol >= 0 ? Math.min(12, Math.floor(sparkBudget)) : 0;
      sparkBudget -= count;
      if (sparkBudget > 20) sparkBudget = 20;
      const radius = stokeRadius();
      const lean = opts.wind === "left" ? -1 : opts.wind === "right" ? 1 : 0;
      const jet = Math.round(Math.min(1, stokeLevel * opts.stoke) * rows * 0.35);
      while (count-- > 0) {
        const c = Math.round(stokeCol + (Math.random() * 2 - 1) * radius * 0.6);
        if (c < 0 || c >= simW) continue;
        let top = rows - 1;
        if (burnsWaveform()) {
          // any lane burning in this column, picked at random
          top = -1;
          for (let l = 0, seen = 0; l < laneCount; l++) {
            const laneTop = fuelTop[l * simW + c];
            if (laneTop >= 0 && Math.random() * ++seen < 1) top = laneTop;
          }
        }
        if (top < 0) continue;
        sparks.push({
          x: c,
          y: Math.max(1, top - Math.random() * (jet + 3)),
          vx: lean * (0.2 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.5,
          vy: -(0.6 + Math.random() * 0.7),
          heat: MAX_HEAT - Math.random() * 3,
          cool: 0.7 + Math.random() * 0.8,
        });
      }
      if (sparks.length > 96) sparks.splice(0, sparks.length - 96);
      let kept = 0;
      for (const spark of sparks) {
        spark.x += spark.vx;
        spark.y += spark.vy;
        spark.heat -= spark.cool;
        const c = Math.round(spark.x);
        const r = Math.round(spark.y);
        if (spark.heat < 1 || r < 0 || r >= rows || c < 0 || c >= simW) continue;
        const i = r * simW + c;
        const v = Math.round(spark.heat);
        if (v > fire[i]) fire[i] = v;
        sparks[kept++] = spark;
      }
      sparks.length = kept;
    };

    const seed = () => {
      const base = (rows - 1) * simW;
      if (!burning) {
        fire.fill(0, base, base + simW);
        stokeLevel = 0;
        sparkBudget = 0;
        return;
      }
      updateStoke();
      computeLevels();
      if (burnsWaveform()) {
        fire.fill(0, base, base + simW);
        applyFuel();
      } else {
        fire.set(levels, base);
      }
      applyStoke();
    };

    const relight = () => {
      if (burning) {
        if (burnsWaveform()) applyFuel();
        applyStoke();
      }
      moveSparks();
    };

    const draw = () => {
      if (!cols || !rows) return;
      if (opts.debug) {
        drawDebug();
        return;
      }
      if (!image) resizeBacking();
      if (!image) return;
      const colors = palette.packed;
      for (let r = 0; r < rows; r++) {
        let s = r * simW + padL;
        let d = r * cols;
        const end = d + cols;
        while (d < end) pixels[d++] = colors[fire[s++]];
      }
      g.putImageData(image, 0, 0);
    };

    const drawDebug = () => {
      const size = cellPx;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cols * size, rows * size);
      const showText = size >= 12;
      if (showText) {
        const fontSize = Math.max(7, Math.floor(size * 0.42));
        g.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        g.textAlign = "center";
        g.textBaseline = "middle";
      }
      const hot = MAX_HEAT * 0.55;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = fire[r * simW + padL + c];
          const x = c * size;
          const y = r * size;
          if (v) {
            g.fillStyle = palette.css[v];
            g.fillRect(x, y, size - 1, size - 1);
          }
          if (showText) {
            g.fillStyle = v > hot ? "rgba(0,0,0,0.78)" : v ? "rgba(255,255,255,0.92)" : "rgba(128,128,128,0.4)";
            g.fillText(String(v), x + size / 2, y + size / 2 + 0.5);
          }
        }
      }
    };

    const isDark = () => {
      for (let r = 0; r < rows; r++) {
        const start = r * simW + padL;
        for (let i = start; i < start + cols; i++) if (fire[i]) return false;
      }
      return true;
    };

    let cancelFrame: (() => void) | null = null;
    let lastTime = 0;
    let backlog = 0;
    let onScreen = true;
    const frame = (now: number) => {
      cancelFrame = null;
      const visible = onScreen && syncLayout();
      // out of view only a fading fire keeps stepping, so that 'burnout' still arrives
      if (!visible && (burning || burntOut)) return;
      if (visible && heatDirty) computeHeat();
      else if (visible && heatShift) shiftHeat();
      const interval = 1e3 / Math.min(120, Math.max(1, opts.fps));
      if (!lastTime) {
        lastTime = now;
        backlog = interval;
      }
      backlog = Math.min(backlog + now - lastTime, interval * 4);
      lastTime = now;
      let steps = 0;
      while (backlog >= interval) {
        backlog -= interval;
        seed();
        stepFire(fire, simW, rows, opts.wind, Math.random, (reverse = !reverse));
        relight();
        steps++;
      }
      if (visible && (steps || redraw)) {
        draw();
        redraw = false;
      }
      // a burning fire keeps the loop running even when dark: a function source can light it at any time
      if (steps && !burning && isDark()) {
        if (!burntOut) {
          burntOut = true;
          fire.fill(0);
          sparks = [];
          ctx.emit("burnout");
        }
        return;
      }
      cancelFrame = ctx.scope.raf(frame);
    };

    const wake = (force = false) => {
      if (cancelFrame || ctx.scope.disposed) return;
      if (!onScreen && (burning || burntOut)) return;
      if (!force && !burning && burntOut) return;
      lastTime = 0;
      cancelFrame = ctx.scope.raf(frame);
    };

    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver((entries) => {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (onScreen) {
          redraw = true;
          wake(true);
        }
      });
      observer.observe(layer);
      ctx.scope.add(() => observer.disconnect());
    }
    ctx.scope.add(
      ctx.wavesurfer.on("decode", () => {
        loadAudio();
        wake();
      }),
    );
    ctx.scope.add(
      ctx.wavesurfer.on("redraw", () => {
        heatDirty = true;
        wake(opts.debug);
      }),
    );
    // a burnt-out debug grid still shows its zeros, so it has to follow the layout
    for (const name of ["zoom", "scroll", "resize"] as const) ctx.scope.add(ctx.wavesurfer.on(name, () => wake(opts.debug)));
    const wakeEvents = ["ready", "timeupdate", "seeking", "play"] as const;
    for (const name of wakeEvents) ctx.scope.add(ctx.wavesurfer.on(name, () => wake()));
    ctx.scope.add(() => {
      audio = null;
      fire = new Uint8Array(0);
    });
    if (ctx.wavesurfer.getDecodedData()) loadAudio();
    wake(true);

    const ignite = () => {
      if (burning || ctx.scope.disposed) return;
      burning = true;
      burntOut = false;
      ctx.emit("ignite");
      wake();
    };

    const extinguish = () => {
      if (!burning || ctx.scope.disposed) return;
      burning = false;
      ctx.emit("extinguish");
      wake(true);
    };

    const setOptions = (changes?: DoomFirePluginOptions | null) => {
      if (ctx.scope.disposed) return;
      const next = changes || {};
      const previous = opts;
      opts = withDefaults(opts, next);
      if ("palette" in next) palette = buildPalette(opts.palette);
      if ("layer" in next || "blendMode" in next || "opacity" in next) mount();
      if (opts.debug !== previous.debug) resizeBacking();
      heatDirty = true;
      spectrumKey = "";
      redraw = true;
      if (next.burning === true) ignite();
      else if (next.burning === false) extinguish();
      wake(true);
    };

    const getIntensities = () => {
      const data = new Uint8Array(cols * rows);
      for (let r = 0; r < rows; r++) data.set(fire.subarray(r * simW + padL, r * simW + padL + cols), r * cols);
      return { columns: cols, rows, data };
    };

    return {
      ignite,
      extinguish,
      isBurning: () => burning,
      setOptions,
      getCanvas: () => canvas,
      getIntensities,
    };
  },
);

export default DoomFirePlugin;
