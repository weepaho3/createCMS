// Asserts that the built `@createcms/react/media/core` and
// `@createcms/react/tree/core` entries stay React-free: their whole import
// graph has no bare specifier (no runtime dependency, so no `react`), no file
// carries a directive, and each entry loads in Node with every bare import
// refused.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
/** Each kernel entry and an export it must provide. */
const ENTRIES = [
  [
    path.join(PACKAGE_ROOT, 'dist', 'media', 'core', 'index.js'),
    'createMediaStore',
  ],
  [
    path.join(PACKAGE_ROOT, 'dist', 'tree', 'core', 'index.js'),
    'dropInstruction',
  ],
];
const SPECIFIER =
  /(?:^|[\s;}])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;
const DIRECTIVE = /^\s*['"]use (?:client|server)['"]/;

for (const [entry] of ENTRIES) {
  if (!fs.existsSync(entry)) {
    console.error(
      `check-media-core-dist: ${entry} is missing; run the build first.`,
    );
    process.exit(1);
  }
}

const problems = [];
const seen = new Set();
const queue = ENTRIES.map(([entry]) => entry);
while (queue.length > 0) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(PACKAGE_ROOT, file);
  if (DIRECTIVE.test(source)) problems.push(`${rel}: carries a directive`);
  for (const match of source.matchAll(SPECIFIER)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec.startsWith('.')) {
      queue.push(path.resolve(path.dirname(file), spec));
    } else {
      problems.push(`${rel}: imports "${spec}"`);
    }
  }
}

// Load the entry in a child process whose resolver refuses every bare
// specifier, so a dependency hidden from the static scan still fails here.
const hook = `data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (!specifier.startsWith('.') && !specifier.startsWith('file:') && !specifier.startsWith('node:') && !specifier.startsWith('data:')) {
    throw new Error('bare import refused: ' + specifier);
  }
  return next(specifier, context);
}`)}`;
const register = `data:text/javascript,${encodeURIComponent(
  `import { register } from 'node:module'; register(${JSON.stringify(hook)});`,
)}`;
for (const [entry, name] of ENTRIES) {
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      register,
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(entry).href)}); if (typeof m[${JSON.stringify(name)}] !== 'function') throw new Error(${JSON.stringify(`${name} missing`)});`,
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) {
    problems.push(
      `loading ${path.relative(PACKAGE_ROOT, entry)} without dependencies failed:\n${run.stderr}`,
    );
  }
}

if (problems.length > 0) {
  console.error(
    `check-media-core-dist: ${problems.length} problem(s)\n${problems.join('\n')}`,
  );
  process.exit(1);
}
console.log(
  `check-media-core-dist: ok (${seen.size} file(s), entries load without dependencies)`,
);
