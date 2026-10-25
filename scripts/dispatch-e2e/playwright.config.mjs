import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../../generated-artifacts/dispatch-tests/results',
  use: {
    browserName: 'chromium',
    headless: true,
    // Never retain cookies, tickets, signed upload URLs or original PDFs in traces.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
