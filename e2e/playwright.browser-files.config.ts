import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '61-browser-local-files.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true, viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'npm run dev -w apps/web -- --host 127.0.0.1',
    cwd: require('node:path').resolve(__dirname, '..'),
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
  },
});
