// The demo page, index.html, as a visitor uses it. It loads wavesurfer.js from jsDelivr.
import { test, expect } from "./fixtures.js";

// a mono 16-bit WAV of 220 Hz beats
const wavFile = (seconds, rate = 22050) => {
  const length = Math.round(seconds * rate);
  const buffer = Buffer.alloc(44 + length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + length * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    const gain = (i / rate) % 0.5 < 0.18 ? 0.9 : 0.25;
    buffer.writeInt16LE(Math.round(gain * 32767 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
  }
  return buffer;
};

const status = (page) => page.locator("#stage-status");

// the page fetches wavesurfer.js and renders its test tape before it's ready
test.describe.configure({ timeout: 60_000 });

test.beforeEach(async ({ page }) => {
  // count the decodes the page starts and finishes
  await page.addInitScript(() => {
    window.decodes = { started: 0, finished: 0 };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (...args) {
      window.decodes.started++;
      return decode.apply(this, args).finally(() => window.decodes.finished++);
    };
  });
});

const ready = async (page) => {
  await page.goto("/");
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
};

const fireAlpha = (page) =>
  page.locator("[part=doomfire] canvas").evaluate((canvas) => {
    const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let alpha = 0;
    for (let i = 3; i < d.length; i += 4) alpha += d[i];
    return alpha;
  });

test("renders the test tape and sets it on fire", async ({ page }) => {
  await ready(page);
  await expect(page.locator("#time")).toHaveText(/^0:00 \/ \d+:\d\d$/);
  await expect(page.locator("#time")).not.toHaveText("0:00 / 0:00");
  await expect(page.locator("#fire-state")).toHaveText("Burning");
  await expect.poll(() => fireAlpha(page)).toBeGreaterThan(0);
  await expect(page.locator("#heat")).toHaveText(/^Heat at the playhead: \d+ \/ 36$/);
});

test("plays and pauses", async ({ page }) => {
  await ready(page);
  const play = page.locator("#play");
  await play.click();
  await expect(play).toHaveText("Pause");
  await expect(page.locator("#time")).not.toHaveText(/^0:00 /, { timeout: 5_000 });
  await play.click();
  await expect(play).toHaveText("Play");
});

test("extinguish lets the fire burn out, ignite relights it", async ({ page }) => {
  await ready(page);
  const button = page.locator("#fire");
  const state = page.locator("#fire-state");
  await button.click();
  await expect(state).toHaveText("Fuel off, fading…");
  await expect(state).toHaveText("Out", { timeout: 10_000 });
  await expect.poll(() => fireAlpha(page)).toBe(0);
  await expect(button).toHaveText("Ignite");
  await button.click();
  await expect(state).toHaveText("Burning");
  await expect.poll(() => fireAlpha(page)).toBeGreaterThan(0);
});

test("a file chosen while zoomed in is decoded once and shown whole, from the start", async ({ page }) => {
  await ready(page);
  await page.locator("#zoom").evaluate((zoom) => {
    zoom.value = "200";
    zoom.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#zoom-value")).toHaveText("200 px/s");
  await page.locator("#play").click();
  await expect(page.locator("#time")).not.toHaveText(/^0:00 /, { timeout: 5_000 });

  await page.locator("#file").setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: wavFile(3) });
  await expect(page.locator("#file-status")).toHaveText("tone.wav · 0:03");
  await expect(page.locator("#zoom")).toHaveValue("0");
  await expect(page.locator("#zoom-value")).toHaveText("Fit");
  await expect(page.locator("#time")).toHaveText("0:00 / 0:03");
  await expect(page.locator("#play")).toHaveText("Play");
  expect(await page.evaluate(() => window.decodes)).toEqual({ started: 1, finished: 1 });
});

test("when a second file is chosen before the first decodes, the second one wins", async ({ page }) => {
  await ready(page);
  const files = [
    { name: "long.wav", base64: wavFile(60).toString("base64") },
    { name: "short.wav", base64: wavFile(2).toString("base64") },
  ];
  // choose both in the same task, so the long file is still decoding when the short one is chosen
  await page.locator("#file").evaluate(async (input, files) => {
    const chosen = await Promise.all(
      files.map(async ({ name, base64 }) => new File([await (await fetch(`data:audio/wav;base64,${base64}`)).blob()], name, { type: "audio/wav" })),
    );
    for (const file of chosen) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, files);
  await page.waitForFunction(() => window.decodes.finished === 2);
  await expect(page.locator("#file-status")).toHaveText("short.wav · 0:02");
  await expect(page.locator("#time")).toHaveText("0:00 / 0:02");
});

test("explains why the demo can't run when jsDelivr is blocked", async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.goto("/");
  await expect(status(page)).toContainText("Couldn't load wavesurfer.js from cdn.jsdelivr.net");
});
