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
  // Pre-bundled up front: discovering these mid-run reloads the page and
  // leaves a second React copy behind.
  optimizeDeps: {
    include: [
      '@ui-sdk/react/alert-dialog',
      '@ui-sdk/react/async-options',
      '@ui-sdk/react/button',
      '@ui-sdk/react/checkbox',
      '@ui-sdk/react/color-picker',
      '@ui-sdk/react/combobox',
      '@ui-sdk/react/command',
      '@ui-sdk/react/dialog',
      '@ui-sdk/react/drawer',
      '@ui-sdk/react/input',
      '@ui-sdk/react/menu',
      '@ui-sdk/react/number-input',
      '@ui-sdk/react/popover',
      '@ui-sdk/react/resizable',
      '@ui-sdk/react/select',
      '@ui-sdk/react/separator',
      '@ui-sdk/react/tabs',
      '@ui-sdk/react/textarea',
      '@ui-sdk/react/toggle',
      '@ui-sdk/react/toolbar',
      '@ui-sdk/react/tooltip',
      '@ui-sdk/react/tree',
    ],
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
