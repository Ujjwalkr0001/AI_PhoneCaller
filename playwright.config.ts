import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  workers: 1,
  use: {
    actionTimeout: 10000,
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
    browserName: 'chromium',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  reporter: 'list',
});
