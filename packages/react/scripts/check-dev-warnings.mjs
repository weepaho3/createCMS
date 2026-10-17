// Asserts that a production build of every editor entry drops the dev-only
// warning texts: each warning call site sits behind
// `process.env.NODE_ENV !== 'production'`, so a minifier removes it. Runs with
// Bun (`bun scripts/check-dev-warnings.mjs`) after the package build.
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const ENTRIES = ['editor', 'editor/canvas', 'editor/cms', 'editor/core'].map(
  (entry) => path.join(PACKAGE_ROOT, 'dist', entry, 'index.js'),
);
// One phrase per dev warning message (not the `EDITOR_CODES` summaries, which
// the core exports on purpose); none may survive a production build.
const WARNING_TEXTS = [
  'is not inline editable until',
  '" is ignored',
  'rendered no [data-editor-block] attribute',
  'no component mapped for block type',
  'declares no property',
  'no control for',
  ') threw while rendering',
  'migration(s) or repair(s)',
];

const result = await Bun.build({
  entrypoints: ENTRIES,
  minify: true,
  target: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['react', 'react-dom', 'react/jsx-runtime', '@createcms/*'],
});
if (!result.success) {
  console.error('check-dev-warnings: production build failed');
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const problems = [];
for (const output of result.outputs) {
  const text = await output.text();
  for (const phrase of WARNING_TEXTS) {
    if (text.includes(phrase)) {
      problems.push(`${path.basename(output.path)}: keeps "${phrase}"`);
    }
  }
}
if (problems.length > 0) {
  console.error(
    `check-dev-warnings: ${problems.length} problem(s)\n${problems.join('\n')}`,
  );
  process.exit(1);
}
console.log(
  `check-dev-warnings: ok (${result.outputs.length} bundle(s) without warning texts)`,
);
