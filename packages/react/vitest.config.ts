import { defineConfig } from 'vitest/config';

// DOM tests opt in per file with `// @vitest-environment happy-dom` (same
// convention as packages/cms); everything else runs in node.
export default defineConfig({
  test: {
    testTimeout: 15_000,
  },
});
