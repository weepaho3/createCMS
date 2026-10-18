import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Screenshot comparisons of the registry chrome. References are made only
// in the pinned Playwright container (.github/workflows/visual.yml), never
// locally: fonts and antialiasing differ per machine. Motion is reduced and
// animations are off, so a frame is deterministic.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    include: ['src/**/*.visual.test.tsx'],
    testTimeout: 30_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        contextOptions: { reducedMotion: 'reduce', deviceScaleFactor: 1 },
      }),
      viewport: { width: 1280, height: 800 },
      instances: [{ browser: 'chromium' }],
      expect: {
        toMatchScreenshot: {
          // Committed references; `__screenshots__/` holds failure output
          // and stays ignored.
          screenshotDirectory: '__visual__',
          comparatorName: 'pixelmatch',
          comparatorOptions: {
            threshold: 0.2,
            allowedMismatchedPixelRatio: 0.002,
          },
          screenshotOptions: { animations: 'disabled', caret: 'hide' },
        },
      },
    },
  },
});
