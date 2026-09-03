import { defineConfig, devices } from "@playwright/test";

const baseUrl = process.env.BASE_URL;
const fakeAudioPath = process.env.MIXED_FAKE_AUDIO_PATH;

if (!baseUrl) throw new Error("BASE_URL is required.");
if (!fakeAudioPath) throw new Error("MIXED_FAKE_AUDIO_PATH is required.");

const target = new URL(baseUrl);
const chromiumArgs = [
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${fakeAudioPath}`,
  ...(target.protocol === "http:"
    ? [`--unsafely-treat-insecure-origin-as-secure=${target.origin}`]
    : []),
];

export default defineConfig({
  expect: { timeout: 20_000 },
  fullyParallel: false,
  reporter: "list",
  testDir: "../e2e",
  testMatch: "mixed-user-lifecycle.spec.ts",
  timeout: 20 * 60_000,
  use: {
    ...devices["Desktop Chrome"],
    acceptDownloads: true,
    baseURL: target.origin,
    launchOptions: { args: chromiumArgs },
    permissions: ["microphone"],
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  workers: 1,
});
