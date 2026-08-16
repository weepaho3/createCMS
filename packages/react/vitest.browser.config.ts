import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Real-browser run (Chromium via Playwright) for tests that need layout,
// measurement or events happy-dom cannot emulate. Only `*.browser.test.tsx`
// files; the node/happy-dom suite lives in vitest.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.tsx'],
    testTimeout: 30_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
