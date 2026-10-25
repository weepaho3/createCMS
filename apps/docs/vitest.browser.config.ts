import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// The registry items as an app renders them (Tailwind, shadcn, the demo
// pages) in Chromium, Firefox and WebKit.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    // The workspace links @createcms/react to its own React copy: one React
    // for the app and the package.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    include: ['src/**/*.browser.test.tsx'],
    testTimeout: 30_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      viewport: { width: 1280, height: 800 },
      instances: [
        { browser: 'chromium' },
        { browser: 'firefox' },
        { browser: 'webkit' },
      ],
    },
  },
});
