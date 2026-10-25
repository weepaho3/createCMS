// Stamps every registry source file with the release it ships with and pins
// the items' `@createcms/react` dependency to that release:
//
//   // @registry editor-shell@0.4.0        (first line of each .ts/.tsx file)
//   /* @registry editor-canvas@0.4.0 */    (first line of each .css file)
//   "dependencies": ["@createcms/react@^0.4.0", ...]
//
// Registry items version in lockstep with `@createcms/react`: copied code
// has no update command, so the stamp tells a consumer which release their
// copy came from and which changelog entries apply to it. Runs inside
// `version-packages` (the Changesets version step), so the release PR
// carries the new stamps; CI runs it with `--check`.
//
// Usage:
//   node apps/docs/scripts/stamp-registry.mjs            # write stamps
//   node apps/docs/scripts/stamp-registry.mjs --check    # verify, exit 1 on drift
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(docs, '../..');
const check = process.argv.includes('--check');

const version = JSON.parse(
  readFileSync(path.join(repo, 'packages/react/package.json'), 'utf8'),
).version;
const pin = `@createcms/react@^${version}`;

const STAMP = /^(?:\/\/ @registry \S+|\/\* @registry \S+ \*\/)\n/;
const drift = [];
let pinsChanged = false;

const registryPath = path.join(docs, 'registry.json');
const registryText = readFileSync(registryPath, 'utf8');
const registry = JSON.parse(registryText);

for (const item of registry.items) {
  const deps = item.dependencies ?? [];
  const next = deps.map((dep) =>
    dep === '@createcms/react' || dep.startsWith('@createcms/react@')
      ? pin
      : dep,
  );
  if (next.join() !== deps.join()) {
    drift.push(`${item.name}: dependency is not ${pin}`);
    item.dependencies = next;
    pinsChanged = true;
  }

  for (const file of item.files ?? []) {
    const source = path.join(docs, file.path);
    const text = readFileSync(source, 'utf8');
    const stamp = file.path.endsWith('.css')
      ? `/* @registry ${item.name}@${version} */\n`
      : `// @registry ${item.name}@${version}\n`;
    const stamped = stamp + text.replace(STAMP, '');
    if (stamped !== text) {
      drift.push(`${file.path}: stamp is not ${item.name}@${version}`);
      if (!check) writeFileSync(source, stamped);
    }
  }
}

if (check) {
  if (drift.length > 0) {
    console.error('stamp-registry: registry is not stamped for this release');
    for (const line of drift) console.error(`  ${line}`);
    console.error('  run: node apps/docs/scripts/stamp-registry.mjs');
    process.exit(1);
  }
  console.log(`stamp-registry: ok (@createcms/react ${version})`);
} else {
  // Rewritten only when a pin moved; `version-packages` formats it after.
  if (pinsChanged) {
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  }
  console.log(
    `stamp-registry: ${drift.length} change(s) for @createcms/react ${version}`,
  );
}
