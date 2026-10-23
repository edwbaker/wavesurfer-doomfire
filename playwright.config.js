import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "tests",
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
      use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] } },
    },
  ],
  webServer: {
    command: "node tests/server.mjs",
    url: `http://127.0.0.1:${port}/package.json`,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
  },
});
