import { defineConfig } from 'vitest/config';

// Node tests for the docs app; `*.browser.test.tsx` files run in
// vitest.browser.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/*.browser.test.tsx', '**/node_modules/**'],
  },
});
