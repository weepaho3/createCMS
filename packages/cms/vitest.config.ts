import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    // Releases every PGlite a test opened as soon as it ends — without this
    // the suite leaks WASM instances until worker exit and can exhaust
    // machine memory (see vitest.setup.ts).
    setupFiles: ['./vitest.setup.ts'],
    // Coverage is opt-in (`bun run test:coverage`), so this config is inert for a
    // normal `vitest run`. No thresholds yet — ratchet directory-level minimums
    // in once the baseline is measured (test-01). React render paths run under
    // happy-dom via per-file `// @vitest-environment happy-dom`.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/**/test/**',
        'src/test-utils/**',
        'src/**/*.type-check.ts',
        'src/**/*.type-check.tsx',
        'src/core/db/schema.generated.ts',
        'src/schema.ts',
      ],
      reporter: ['text', 'text-summary', 'lcov'],
    },
  },
});
