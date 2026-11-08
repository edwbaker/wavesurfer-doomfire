// Leaks: the plugin registered and unregistered, and whole players created and destroyed, over and over.
// After a forced garbage collection nothing from a finished cycle may still be alive, nothing may still
// be asking for animation frames, and the heap must not grow with the number of cycles.
import { test, expect } from "./fixtures.js";

// forty-odd players and plugins, each burning for a moment: slow on a busy machine
test.describe.configure({ timeout: 180_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/harness.html");
  await page.waitForFunction(() => window.harness || window.harnessError);
  expect(await page.evaluate(() => window.harnessError ?? null), "harness failed to load").toBeNull();
});

// Chrome's own counts, taken through the DevTools protocol after collecting garbage
const probe = async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const collect = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
  };
  // the live objects whose prototype `prototype` evaluates to, narrowed by `filter` if given
  const live = async (prototype, filter = "(object) => true") => {
    const { result } = await cdp.send("Runtime.evaluate", { expression: prototype });
    const { objects } = await cdp.send("Runtime.queryObjects", { prototypeObjectId: result.objectId });
    const { result: count } = await cdp.send("Runtime.callFunctionOn", {
      objectId: objects.objectId,
      functionDeclaration: `function () { return this.filter(${filter}).length; }`,
      returnByValue: true,
    });
    await cdp.send("Runtime.releaseObject", { objectId: objects.objectId });
    await cdp.send("Runtime.releaseObject", { objectId: result.objectId });
    return count.value;
  };
  return async () => {
    await collect();
    const { metrics } = await cdp.send("Performance.getMetrics");
    const metric = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    return {
      plugins: await live("harness.Plugin.prototype"),
      fireCanvases: await live("HTMLCanvasElement.prototype", '(canvas) => canvas.getAttribute("part") === "doomfire-canvas"'),
      intersectionObservers: await live("IntersectionObserver.prototype"),
      listeners: metric.JSEventListeners,
      nodes: metric.Nodes,
      heap: metric.JSHeapUsedSize,
    };
  };
};

// animation frames the page asks for in a second, once everything has been torn down
const framesRequested = (page) =>
  page.evaluate(async () => {
    let frames = 0;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      frames++;
      return raf(callback);
    };
    await harness.wait(1000);
    window.requestAnimationFrame = raf;
    return frames;
  });

// Each cycle runs in the page: `cycle` names one of the cycles below, run `count` times.
const runCycles = (page, cycle, count) =>
  page.evaluate(
    async ({ cycle, count }) => {
      const { WaveSurfer, Plugin, makeBuffer, wait } = harness;
      const buffer = makeBuffer(2, 22050, [1, 0.8]);
      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      const stage = document.getElementById("stage");
      const newPlayer = async () => {
        const container = document.createElement("div");
        stage.appendChild(container);
        const ws = WaveSurfer.create({ container, height: 120, barWidth: 2, barGap: 1, barHeight: 0.6 });
        await ws.loadBlob(new Blob(), channels, buffer.duration);
        return { ws, container };
      };
      // let a fire burn for a few frames, scroll and resize it, and play with its options
      const exercise = async (ws, fire) => {
        await wait(120);
        fire.setOptions({ source: "progress", palette: ["#000", "#f80", "#fff"] });
        ws.zoom(200);
        ws.setScroll(100);
        await wait(60);
        fire.extinguish();
        fire.ignite();
      };
      if (cycle === "register") {
        window.leakPlayer ??= await newPlayer();
        const { ws } = window.leakPlayer;
        for (let i = 0; i < count; i++) {
          const fire = ws.registerPlugin(Plugin.create());
          await exercise(ws, fire);
          ws.unregisterPlugin(fire);
          ws.zoom(0);
        }
      } else {
        for (let i = 0; i < count; i++) {
          const { ws, container } = await newPlayer();
          await exercise(ws, ws.registerPlugin(Plugin.create()));
          ws.destroy();
          container.remove();
        }
      }
    },
    { cycle, count },
  );

// a control: the counts do see a plugin while it is alive, so a zero after teardown means something
test("the probe sees a plugin that is still alive", async ({ page }) => {
  const measure = await probe(page);
  const before = await measure();
  await page.evaluate(async () => {
    window.kept = await harness.setup();
  });
  const alive = await measure();
  expect(alive).toMatchObject({ plugins: 1, fireCanvases: 1, intersectionObservers: before.intersectionObservers + 1 });
  expect(await framesRequested(page), "animation frames requested in a second by a burning fire").toBeGreaterThan(10);
});

for (const [cycle, description] of [
  ["register", "registering and unregistering the plugin on one player"],
  ["player", "creating and destroying whole players with the plugin"],
]) {
  test(`${description} leaves nothing behind`, async ({ page }) => {
    const measure = await probe(page);
    await runCycles(page, cycle, 3); // warm up: caches and compiled code settle in the first cycles
    const before = await measure();
    await runCycles(page, cycle, 10);
    const early = await measure();
    await runCycles(page, cycle, 25);
    const after = await measure();
    const frames = await framesRequested(page);
    const growth = after.heap - early.heap;
    test.info().annotations.push({ type: "counts", description: JSON.stringify({ before, early, after, frames, growth }) });

    expect(after.plugins, "plugin instances still alive").toBe(0);
    expect(after.fireCanvases, "fire canvases still alive").toBe(0);
    expect(after.intersectionObservers, "IntersectionObservers still alive").toBe(before.intersectionObservers);
    expect(frames, "animation frames requested in a second after teardown").toBe(0);
    expect(after.listeners, "event listeners").toBeLessThanOrEqual(before.listeners);
    expect(after.nodes, "DOM nodes").toBeLessThanOrEqual(before.nodes + 20);
    // twenty-five more cycles may not cost more than a few kilobytes each
    expect(growth, `heap grew ${(growth / 1024).toFixed(0)} KB over 25 cycles`).toBeLessThan(25 * 8 * 1024);
  });
}
