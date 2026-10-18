import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Media engine tests: `src/media/**/*.engine.test.tsx` run in Chromium,
// Firefox and WebKit (interaction, accessibility, performance). The editor's
// Chromium-only browser tests live in vitest.browser.config.ts.
// `ENGINES=chromium` narrows the run.
const engines = (process.env.ENGINES ?? 'chromium,firefox,webkit')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean) as ('chromium' | 'firefox' | 'webkit')[];

export default defineConfig({
  test: {
    include: ['src/media/**/*.engine.test.tsx'],
    testTimeout: 30_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: engines.map((browser) => ({ browser })),
    },
  },
});
