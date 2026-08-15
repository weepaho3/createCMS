import { configDefaults, defineConfig } from 'vitest/config';

// DOM tests opt in per file with `// @vitest-environment happy-dom` (same
// convention as packages/cms); everything else runs in node. Browser-mode
// tests (`*.browser.test.tsx`) run through vitest.browser.config.ts only.
export default defineConfig({
  test: {
    testTimeout: 15_000,
    exclude: [...configDefaults.exclude, 'src/**/*.browser.test.tsx'],
  },
});
