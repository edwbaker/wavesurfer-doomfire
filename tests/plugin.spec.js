// The plugin in a real wavesurfer.js, run in tests/harness.html. Each test sets up its own waveform
// in the page and returns plain data to check here.
import { test, expect } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/harness.html");
  await page.waitForFunction(() => window.harness || window.harnessError);
  expect(await page.evaluate(() => window.harnessError ?? null), "harness failed to load").toBeNull();
});

const describe = (r) =>
  `${r.compared} columns, ${r.off} off by more than a row (worst ${r.worst}), ${r.missing} missing, ${r.extra} extra, lanes ${r.lanes}/${r.boxes}`;

// fuel matches the bars when nearly every column is within a row of them
const expectFuelFits = (r) => {
  const fits = r.compared > 20 && r.off <= r.compared * 0.03 && r.missing + r.extra <= Math.max(3, r.compared * 0.05);
  expect(fits, describe(r)).toBe(true);
};

test.describe("the plugin", () => {
  test("exports the plugin, stepFire and the palette", async ({ page }) => {
    const r = await page.evaluate(() => {
      const { mod, Plugin } = harness;
      return { create: typeof Plugin.create, stepFire: typeof mod.stepFire, palette: mod.DOOM_FIRE_PALETTE.length };
    });
    expect(r).toEqual({ create: "function", stepFire: "function", palette: 37 });
  });

  test("mounts its layer behind the waveform and burns once loaded", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { ws, fire } = await harness.setup({ ws: { height: 160 }, plugin: { pixelSize: 5 } });
      const wrapper = ws.getWrapper();
      const layer = wrapper.querySelector("[part=doomfire]");
      const burning = await harness.until(() => harness.hot(fire) > 50, 3000);
      const { columns, rows } = fire.getIntensities();
      return {
        api: typeof fire.ignite === "function" && typeof fire.on === "function",
        canvas: layer?.querySelector("canvas") === fire.getCanvas(),
        behind: wrapper.firstElementChild === layer,
        burning,
        columns,
        rows,
      };
    });
    expect(r).toMatchObject({ api: true, canvas: true, behind: true, burning: true, rows: 32 });
    expect(r.columns).toBeGreaterThanOrEqual(160);
  });

  for (const source of ["progress", "spectrum", "waveform"]) {
    test(`source '${source}' burns and animates`, async ({ page }) => {
      const r = await page.evaluate(async (source) => {
        const { ws, fire } = await harness.setup({ plugin: { source }, shape: "beats" });
        ws.setTime(2);
        await harness.wait(500);
        const a = fire.getIntensities().data.slice();
        await harness.wait(500);
        const b = fire.getIntensities().data;
        return { hot: harness.hot(fire), animating: a.some((v, i) => v !== b[i]) };
      }, source);
      expect(r.hot).toBeGreaterThan(0);
      expect(r.animating).toBe(true);
    });
  }

  test("a front layer sits over the waveform, screen-blended", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { ws, fire } = await harness.setup();
      fire.setOptions({ layer: "front" });
      await harness.wait(100);
      const layer = ws.getWrapper().querySelector("[part=doomfire]");
      return { last: ws.getWrapper().lastElementChild === layer, blend: layer.style.mixBlendMode };
    });
    expect(r).toEqual({ last: true, blend: "screen" });
  });

  test("setOptions changes, zoom and scroll keep it burning", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { ws, fire } = await harness.setup();
      fire.setOptions({ wind: "right", base: "bottom", palette: ["#000", "#39f", "#fff"], debug: true, pixelSize: 16 });
      await harness.wait(400);
      fire.setOptions({ debug: false, pixelSize: 5, base: "waveform", wind: "none", palette: undefined });
      ws.zoom(300);
      await harness.wait(300);
      ws.setScroll(400);
      await harness.wait(500);
      return { hot: harness.hot(fire), scroll: ws.getScroll() };
    });
    expect(r.scroll).toBe(400);
    expect(r.hot).toBeGreaterThan(50);
  });

  test("extinguish burns out, ignite relights", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { fire } = await harness.setup();
      const events = [];
      for (const e of ["ignite", "extinguish", "burnout"]) fire.on(e, () => events.push(e));
      fire.extinguish();
      const out = await harness.until(() => events.includes("burnout"), 8000);
      const cold = harness.hot(fire);
      const burningAfterOut = fire.isBurning();
      fire.ignite();
      const relit = await harness.until(() => harness.hot(fire) > 50, 3000);
      return { out, cold, burningAfterOut, relit, burning: fire.isBurning(), events };
    });
    expect(r).toEqual({ out: true, cold: 0, burningAfterOut: false, relit: true, burning: true, events: ["extinguish", "burnout", "ignite"] });
  });

  test("unregistering removes the layer; it registers again with no options", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { ws, fire } = await harness.setup();
      ws.unregisterPlugin(fire);
      const removed = !ws.getWrapper().querySelector("[part=doomfire]");
      const again = ws.registerPlugin(harness.Plugin.create());
      const relit = await harness.until(() => harness.hot(again) > 0, 3000);
      ws.destroy();
      await harness.wait(200);
      return { removed, relit };
    });
    expect(r).toEqual({ removed: true, relit: true });
  });

  test("a function source lights up when its data changes while paused", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const regions = [];
      const { fire } = await harness.setup({ plugin: { source: (t) => (regions.some((g) => g.start <= t && t < g.end) ? 1 : 0) } });
      await harness.wait(600);
      const before = harness.hot(fire);
      regions.push({ start: 1, end: 3 });
      const lit = await harness.until(() => harness.hot(fire) > 20, 1500);
      return { before, lit };
    });
    expect(r).toEqual({ before: 0, lit: true });
  });

  test("burnout arrives while off-screen, and the canvas is clear when it comes back", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { fire, container } = await harness.setup();
      let burnout = false;
      fire.on("burnout", () => {
        burnout = true;
      });
      container.style.cssText = "position: relative; top: 5000px";
      await harness.wait(200);
      fire.extinguish();
      const out = await harness.until(() => burnout, 5000);
      container.style.cssText = "";
      await harness.wait(500);
      return { out, alpha: harness.alphaSum(fire.getCanvas()), hot: harness.hot(fire) };
    });
    expect(r).toEqual({ out: true, alpha: 0, hot: 0 });
  });

  test("a burnt-out debug grid follows zoom and scroll", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { ws, fire } = await harness.setup({ plugin: { debug: true, pixelSize: 22 } });
      let out = false;
      fire.on("burnout", () => {
        out = true;
      });
      fire.extinguish();
      await harness.until(() => out, 6000);
      ws.zoom(300);
      await harness.wait(300);
      ws.setScroll(900);
      await harness.wait(400);
      return { out, left: fire.getCanvas().style.left, expected: `${Math.floor(ws.getScroll() / 22) * 22}px` };
    });
    expect(r.out).toBe(true);
    expect(r.left).toBe(r.expected);
  });
});

test.describe("fuel geometry", () => {
  test("matches the bars (mono)", async ({ page }) => {
    expectFuelFits(await page.evaluate(async () => harness.compareFuel(await harness.setup())));
  });

  test("matches the bars with a Timeline plugin, and base 'bottom' burns along the waveform", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const s = await harness.setup({ timeline: true });
      const fuel = harness.compareFuel(s);
      s.fire.setOptions({ base: "bottom" });
      await harness.wait(300);
      const fireBottom = s.fire.getCanvas().getBoundingClientRect().bottom;
      const waveBottom = s.ws.getWrapper().querySelector("[part=canvases]").getBoundingClientRect().bottom;
      return { fuel, fireBottom, waveBottom };
    });
    expectFuelFits(r.fuel);
    expect(Math.abs(r.fireBottom - r.waveBottom), `fire bottom ${r.fireBottom}, waveform bottom ${r.waveBottom}`).toBeLessThan(1);
  });

  test("matches the bars: stereo, normalized, louder right channel", async ({ page }) => {
    expectFuelFits(await page.evaluate(async () => harness.compareFuel(await harness.setup({ gains: [0.25, 1], ws: { normalize: true } }))));
  });

  test("matches the bars: split channels 120 and 40 px high", async ({ page }) => {
    expectFuelFits(
      await page.evaluate(async () => harness.compareFuel(await harness.setup({ gains: [0.9, 0.9], ws: { splitChannels: [{ height: 120 }, { height: 40 }] } }))),
    );
  });

  test("matches the bars when the media reports 200 s for 180 s of peaks", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const media = harness.wav(harness.makeBuffer(200, 8000, [1]));
      const s = await harness.setup({ load: (ws) => ws.load(URL.createObjectURL(media), [harness.sinePeaks(2000, 400)], 180) });
      await harness.until(() => Math.abs(s.ws.getDuration() - 200) < 1, 3000);
      await harness.wait(400);
      return { fuel: harness.compareFuel(s), duration: s.ws.getDuration() };
    });
    expect(r.duration).toBeCloseTo(200, 0);
    expectFuelFits(r.fuel);
  });

  test("matches bars raised to barMinHeight", async ({ page }) => {
    expectFuelFits(await page.evaluate(async () => harness.compareFuel(await harness.setup({ gains: [0.004], ws: { barMinHeight: 16 } }))));
  });

  test("zoomed-in sparse peaks: fuel only where bars are drawn", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const media = harness.wav(harness.makeBuffer(20, 8000, [1]));
      const s = await harness.setup({ ws: { minPxPerSec: 100 }, load: (ws) => ws.load(URL.createObjectURL(media), [harness.sinePeaks(200, 40)], 20) });
      await harness.wait(400);
      return harness.compareFuel(s);
    });
    expectFuelFits(r);
  });

  test("never starts above its own lane's top edge", async ({ page }) => {
    // two 128 px channels make a 256 px wrapper with 8 px cells, so lane 1 starts exactly on a cell boundary
    const r = await page.evaluate(async () => {
      const s = await harness.setup({ gains: [1, 1], plugin: { pixelSize: 8 }, ws: { splitChannels: [{}, {}], height: 128, normalize: true, barHeight: 1 } });
      const t = s.state();
      const lane1Top = s.ws.getWrapper().querySelector("[part=canvases]").children[1].offsetTop;
      const layerBottom = t.layer.offsetTop + t.layer.offsetHeight;
      let above = 0;
      let cols = 0;
      for (let c = t.padL; c < t.padL + t.cols; c++) {
        const top = t.fuelTop[t.simW + c];
        if (top < 0) continue;
        cols++;
        if (layerBottom - (t.rows - top) * t.cellPx < lane1Top) above++;
      }
      return { lanes: t.laneCount, cols, above };
    });
    expect(r.lanes).toBe(2);
    expect(r.cols).toBeGreaterThan(20);
    expect(r.above, "lane-1 columns whose fuel starts in lane 0").toBe(0);
  });

  test("scrolling cell by cell recomputes only the new columns and keeps matching the bars", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const s = await harness.setup({ ws: { minPxPerSec: 300 } });
      const cell = s.state().cellPx;
      let worst = { compared: 0, off: 0, extra: 0, missing: 0 };
      window.fullHeatCount = 0;
      for (let i = 1; i <= 30; i++) {
        s.ws.setScroll(i * cell);
        await harness.wait(60);
        if (i % 10 === 0) {
          const f = harness.compareFuel(s);
          if (f.off + f.extra + f.missing > worst.off + worst.extra + worst.missing) worst = f;
        }
      }
      return { full: window.fullHeatCount, worst };
    });
    expect(r.full, "full heat recomputes over 30 one-cell scrolls").toBeLessThanOrEqual(2);
    expect(r.worst.off + r.worst.extra + r.worst.missing, r.worst.compared ? describe(r.worst) : "clean").toBeLessThanOrEqual(3);
  });
});

test.describe("heat and options", () => {
  test("a quiet split channel burns cooler than a loud one", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const s = await harness.setup({ gains: [1, 0.01], shape: "beats", ws: { splitChannels: [{}, {}], normalize: true, height: 100 } });
      const t = s.state();
      const { data, columns } = s.fire.getIntensities();
      const mean = (l) => {
        let sum = 0;
        let n = 0;
        for (let c = t.padL; c < t.padL + t.cols; c++) {
          const k = l * t.simW + c;
          if (t.fuelTop[k] < 0) continue;
          for (let row = t.fuelTop[k]; row <= t.fuelBottom[k]; row++) {
            sum += data[row * columns + (c - t.padL)];
            n++;
          }
        }
        return n ? sum / n : 0;
      };
      return { lanes: t.laneCount, loud: mean(0), quiet: mean(1) };
    });
    expect(r.lanes).toBe(2);
    expect(r.quiet, `fuel heat ${r.loud} (loud) vs ${r.quiet} (quiet, -40 dB)`).toBeLessThan(r.loud * 0.5);
  });

  test("sparks rise from a lower split channel when the first is silent", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const s = await harness.setup({ gains: [0, 1], shape: "beats", seconds: 30, ws: { splitChannels: [{}, {}], height: 100 } });
      s.ws.setTime(2);
      await s.ws.play();
      const playing = s.ws.isPlaying();
      let most = 0;
      for (let i = 0; i < 20; i++) {
        await harness.wait(50);
        most = Math.max(most, s.state().sparks.length);
      }
      s.ws.pause();
      return { playing, most };
    });
    expect(r.playing).toBe(true);
    expect(r.most).toBeGreaterThan(0);
  });

  test("out-of-range palette numbers are clamped", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const s = await harness.setup();
      const bytes = (i) => {
        const v = s.state().palette.packed[i];
        return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24];
      };
      s.fire.setOptions({ palette: harness.mod.DOOM_FIRE_PALETTE.map((c) => c.map((v) => v - 10)) });
      const cold = bytes(0);
      s.fire.setOptions({ palette: harness.mod.DOOM_FIRE_PALETTE.map((c) => c.map((v) => v * 1.2)) });
      return { coldAlpha: cold[3], hottest: bytes(36) };
    });
    expect(r).toEqual({ coldAlpha: 0, hottest: [255, 255, 255, 255] });
  });

  test("a one-colour palette is used, not replaced", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const s = await harness.setup();
      s.fire.setOptions({ palette: ["#33aaff"] });
      const p = s.state().palette.packed;
      const bytes = (i) => [p[i] & 255, (p[i] >>> 8) & 255, (p[i] >>> 16) & 255, p[i] >>> 24];
      return { hottest: bytes(36), coldAlpha: bytes(0)[3] };
    });
    expect(r).toEqual({ hottest: [51, 170, 255, 255], coldAlpha: 0 });
  });

  test("NaN options are ignored and setOptions() needs no argument", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const s = await harness.setup();
      let threw = "";
      try {
        s.fire.setOptions();
        s.fire.setOptions(null);
      } catch (e) {
        threw = e.message;
      }
      s.fire.setOptions({ stoke: NaN });
      await harness.wait(400);
      s.fire.setOptions({ stoke: 1 });
      await harness.wait(2500);
      const lit = harness.hot(s.fire);
      s.fire.setOptions({ fps: NaN });
      await harness.wait(400);
      s.fire.setOptions({ fps: 30 });
      await harness.wait(400);
      const a = s.fire.getIntensities().data.slice();
      await harness.wait(600);
      const b = s.fire.getIntensities().data;
      return { threw, lit, animating: a.some((v, i) => v !== b[i]) };
    });
    expect(r.threw).toBe("");
    expect(r.lit).toBeGreaterThan(50);
    expect(r.animating).toBe(true);
  });
});

test.describe("idling, scale and columns", () => {
  test("the spectrum follows scale: linear lights fewer bands than decibels", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const s = await harness.setup({ plugin: { source: "spectrum" }, shape: "beats" });
      s.ws.setTime(0.1); // inside a loud beat
      // the spectrum source burns from the bottom row, which holds its heat as it is
      const lit = async (scale) => {
        s.fire.setOptions({ scale });
        await harness.wait(300);
        const { columns, rows, data } = s.fire.getIntensities();
        return data.subarray((rows - 1) * columns).filter((v) => v).length;
      };
      return { db: await lit("db"), linear: await lit("linear") };
    });
    expect(r.db).toBeGreaterThan(0);
    expect(r.linear, `bands lit: ${r.db} in decibels, ${r.linear} linear`).toBeLessThan(r.db);
  });

  test("a dark, idle fire stops stepping until something lights it", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const s = await harness.setup({ gains: [0] }); // silence: no fuel and nothing alight
      await harness.wait(300);
      let frames = 0;
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) => {
        frames++;
        return raf(callback);
      };
      await harness.wait(1000);
      const idleFrames = frames;
      window.requestAnimationFrame = raf;
      // new options wake it: a function source lights the floor, as the silence draws no bars to burn
      s.fire.setOptions({ source: () => 1, base: "bottom" });
      const lit = await harness.until(() => harness.hot(s.fire) > 50, 3000);
      return { idleFrames, lit, burning: s.fire.isBurning() };
    });
    expect(r.idleFrames, "animation frames requested in a second of idling").toBeLessThan(3);
    expect(r).toMatchObject({ lit: true, burning: true });
  });

  test("columnAt gives the column a time falls in, and -1 out of view", async ({ page }) => {
    const r = await page.evaluate(async () => {
      const s = await harness.setup({ seconds: 6 });
      const at = (time) => s.fire.columnAt(time);
      const width = s.ws.getWrapper().clientWidth;
      const fitted = { start: at(0), middle: at(3), expectedMiddle: Math.floor(width / 2 / s.state().cellPx), before: at(-1), after: at(60) };
      s.ws.zoom(400);
      await harness.wait(300);
      s.ws.setScroll(1200);
      await harness.wait(400);
      // the time at the left edge of the first column in view
      const edge = (s.state().originPx / s.ws.getWrapper().clientWidth) * s.ws.getDuration();
      return { ...fitted, startScrolledAway: at(0), edge: at(edge + 0.001) };
    });
    expect(r).toMatchObject({ start: 0, before: -1, after: -1, startScrolledAway: -1, edge: 0 });
    expect(r.middle).toBe(r.expectedMiddle);
  });
});
