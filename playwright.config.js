import { defineConfig, devices } from '@playwright/test';

// The game needs a real WebGL context and a real WebAudio graph. Headless Chromium
// gets both: SwiftShader supplies WebGL, and the fake audio device lets the audio
// graph build and clocks advance without an output device present in CI.
const chromiumArgs = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-device-for-media-stream',
  '--mute-audio',
];

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:4180',
    // Recording every run adds GPU readbacks to an already busy SwiftShader runner.
    // Capture CI failures on retry; local runs have no retry and retain their first trace.
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: { args: chromiumArgs },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],

  // Tests run against the production build, so the suite validates what actually
  // ships. `pnpm test:e2e` builds first; this only serves dist/.
  webServer: {
    command: 'pnpm exec vite preview --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180',
    // Never reuse a server already on the port. A leftover `vite preview` serves whatever
    // it was started on, so reusing it ran the suite against a stale build and passed; the
    // strict port now makes that a loud "port in use" failure instead.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
