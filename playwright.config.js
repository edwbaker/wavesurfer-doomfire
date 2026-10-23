import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "tests",
  // the demo fetches wavesurfer.js and renders its test tape first, and browsers start slowly on some machines
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--autoplay-policy=no-user-gesture-required",
            "--mute-audio",
            // Run audio in the browser process: starting the audio service's own process can take
            // seconds, and the page waits on it when it opens its first AudioContext.
            "--disable-features=AudioServiceOutOfProcess",
          ],
        },
      },
    },
  ],
  webServer: {
    command: "node tests/server.mjs",
    url: `http://127.0.0.1:${port}/package.json`,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
  },
});
