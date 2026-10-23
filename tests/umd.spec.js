// The script-tag build, dist/doomfire.min.js, loaded after wavesurfer.js's own script in tests/umd.html.
import { test, expect } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/umd.html");
});

test("attaches the plugin to the page's WaveSurfer, with the palette and stepFire", async ({ page }) => {
  const r = await page.evaluate(() => {
    const plugin = window.WaveSurfer.DoomFire;
    return {
      name: plugin?.name,
      create: typeof plugin?.create,
      palette: plugin?.DOOM_FIRE_PALETTE?.length,
      stepFire: typeof plugin?.stepFire,
      waveSurfer: typeof window.WaveSurfer.create,
    };
  });
  expect(r).toEqual({ name: "DoomFirePlugin", create: "function", palette: 37, stepFire: "function", waveSurfer: "function" });
});

test("burns on a waveform, and burns out when extinguished", async ({ page }) => {
  const r = await page.evaluate(async () => {
    // four seconds of 220 Hz beats, as samples and as a WAV for the media element
    const rate = 22050;
    const seconds = 4;
    const buffer = new AudioBuffer({ length: rate * seconds, numberOfChannels: 1, sampleRate: rate });
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = ((i / rate) % 0.5 < 0.18 ? 0.9 : 0.25) * Math.sin((2 * Math.PI * 220 * i) / rate);
    const wav = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const text = (offset, s) => [...s].forEach((c, i) => wav.setUint8(offset + i, c.charCodeAt(0)));
    text(0, "RIFF");
    wav.setUint32(4, 36 + samples.length * 2, true);
    text(8, "WAVEfmt ");
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 1, true);
    wav.setUint32(24, rate, true);
    wav.setUint32(28, rate * 2, true);
    wav.setUint16(32, 2, true);
    wav.setUint16(34, 16, true);
    text(36, "data");
    wav.setUint32(40, samples.length * 2, true);
    samples.forEach((v, i) => wav.setInt16(44 + i * 2, v * 32767, true));

    const ws = window.WaveSurfer.create({ container: "#waveform", height: 160, barWidth: 2, barGap: 1, barHeight: 0.6 });
    ws.setMuted(true);
    const fire = ws.registerPlugin(window.WaveSurfer.DoomFire.create({ pixelSize: 5 }));
    await ws.loadBlob(new Blob([wav.buffer], { type: "audio/wav" }), [samples], seconds);

    const hot = () => fire.getIntensities().data.filter((v) => v).length;
    const until = (fn, ms) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        const tick = () => (fn() ? resolve(true) : performance.now() - t0 > ms ? resolve(false) : setTimeout(tick, 30));
        tick();
      });
    const burning = await until(() => hot() > 50, 3000);
    let out = false;
    fire.on("burnout", () => {
      out = true;
    });
    fire.extinguish();
    const burntOut = await until(() => out, 8000);
    return { layer: Boolean(ws.getWrapper().querySelector("[part=doomfire]")), burning, burntOut, cold: hot() };
  });
  expect(r).toEqual({ layer: true, burning: true, burntOut: true, cold: 0 });
});

test("with CommonJS or AMD, it requires wavesurfer.js and leaves the page's global alone", async ({ page }) => {
  const r = await page.evaluate(async () => {
    const source = await (await fetch("/dist/doomfire.min.js")).text();
    const run = (module, require, define) => new Function("module", "exports", "require", "define", source)(module, module?.exports, require, define);
    const global = window.WaveSurfer.DoomFire;

    const required = [];
    const commonjs = { exports: {} };
    run(commonjs, (id) => (required.push(id), window.WaveSurfer), undefined);

    let amd = null;
    const define = (deps, factory) => {
      amd = { deps, plugin: factory(window.WaveSurfer) };
    };
    define.amd = {};
    run(undefined, undefined, define);

    const describe = (plugin) => ({ name: plugin.name, create: typeof plugin.create, palette: plugin.DOOM_FIRE_PALETTE.length });
    return { required, commonjs: describe(commonjs.exports), amdDeps: amd.deps, amd: describe(amd.plugin), globalUntouched: window.WaveSurfer.DoomFire === global };
  });
  const plugin = { name: "DoomFirePlugin", create: "function", palette: 37 };
  expect(r).toEqual({ required: ["wavesurfer.js"], commonjs: plugin, amdDeps: ["wavesurfer.js"], amd: plugin, globalUntouched: true });
});
