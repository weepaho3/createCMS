// Fails when a published package would ship without its docs: each one packs
// `docs/llms.txt`, and @createcms/core its agent skill. Run after
// `bun run docs:packages`, before publishing.

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const required = {
  'packages/cms': [
    'docs/llms.txt',
    'docs/README.md',
    'skills/createcms/SKILL.md',
  ],
  'packages/react': ['docs/llms.txt', 'docs/README.md'],
};

let failed = false;
for (const [dir, files] of Object.entries(required)) {
  const out = execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: path.resolve(import.meta.dirname, '..', dir),
      encoding: 'utf8',
    },
  );
  const packed = new Set(JSON.parse(out)[0].files.map((file) => file.path));
  for (const file of files) {
    if (!packed.has(file)) {
      console.error(`${dir} packs no ${file}. Run \`bun run docs:packages\`.`);
      failed = true;
    }
  }
  const pages = [...packed].filter(
    (file) => file.startsWith('docs/') && file.endsWith('.md'),
  );
  console.log(`${dir}: ${pages.length} docs pages`);
}
if (failed) process.exit(1);
