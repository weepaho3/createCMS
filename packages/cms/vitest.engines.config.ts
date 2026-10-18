import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Engine tests: `*.engine.test.ts` run in Chromium, Firefox and WebKit
// against a test CMS with an in-memory S3 server (src/test-utils/
// engine-server.ts). `ENGINES=chromium` narrows the run.
const engines = (process.env.ENGINES ?? 'chromium,firefox,webkit')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean) as ('chromium' | 'firefox' | 'webkit')[];

export default defineConfig({
  test: {
    include: ['src/**/*.engine.test.ts'],
    globalSetup: ['src/test-utils/engine-server.ts'],
    testTimeout: 30_000,
    // PGlite in the global setup never shuts down cleanly (see
    // src/test-utils/db.ts); do not wait long for it after the run.
    teardownTimeout: 2_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: engines.map((browser) => ({ browser })),
    },
  },
});
