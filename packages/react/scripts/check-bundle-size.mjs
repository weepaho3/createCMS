// Measures every entry of the built package the way an app pays for it:
// bundled alone with `bun build --minify` (react and react-dom external,
// every other import included, so `/editor/richtext` counts Tiptap), then
// gzip -9. Fails above the entry's budget in bundle-budgets.json and warns
// above its baseline by more than 5%; raise the baseline when a growth is
// accepted.
//
// Usage: bun packages/react/scripts/check-bundle-size.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { entries } = JSON.parse(
  readFileSync(path.join(root, 'bundle-budgets.json'), 'utf8'),
);
const out = mkdtempSync(path.join(tmpdir(), 'createcms-bundle-'));
const errors = [];
const rows = [];

try {
  for (const [entry, { baseline, budget }] of Object.entries(entries)) {
    const file = path.join(out, `${entry.replaceAll('/', '-')}.js`);
    const result = spawnSync(
      'bun',
      [
        'build',
        path.join(root, 'dist', entry, 'index.js'),
        '--minify',
        '--target=browser',
        '--external=react',
        '--external=react-dom',
        '--external=react/*',
        '--external=react-dom/*',
        `--outfile=${file}`,
      ],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) {
      errors.push(`${entry}: bun build failed\n${result.stderr}`);
      continue;
    }
    const size = gzipSync(readFileSync(file), { level: 9 }).length;
    const status =
      size > budget ? 'over budget' : size > baseline * 1.05 ? 'warning' : 'ok';
    rows.push({ entry, size, baseline, budget, status });
    if (status === 'over budget') {
      errors.push(`${entry}: ${size} B gzip is over its budget of ${budget} B`);
    } else if (status === 'warning') {
      console.warn(
        `check-bundle-size: warning: ${entry} grew to ${size} B gzip, more than 5% over its baseline of ${baseline} B`,
      );
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.table(rows);
if (errors.length > 0) {
  for (const error of errors) console.error(`check-bundle-size: ${error}`);
  process.exit(1);
}
console.log(`check-bundle-size: ok (${rows.length} entries)`);
