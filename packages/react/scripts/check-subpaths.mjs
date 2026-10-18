// Asserts the packaging guarantees of the built `@createcms/react` subpaths:
// - every client entry starts with 'use client' (React Server Components
//   treat the entry as a client boundary only with the directive), and the
//   React-free `/editor/richtext` adapter carries none;
// - every React context is declared in exactly one file of `dist`, so
//   `/editor` and `/editor/canvas` share one editor context instead of each
//   bundling its own copy;
// - the import graphs of `/editor` and `/editor/canvas` never reach an
//   optional peer (Tiptap, Yjs) or the server-only HTML parser, so an app
//   without them builds and its bundle carries none of them.
// The React-free `/editor/core` and `/editor/render` entries are covered by
// check-core-dist.mjs.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const DIST = path.join(PACKAGE_ROOT, 'dist');

const CLIENT_ENTRIES = [
  'editor/index.js',
  'editor/canvas/index.js',
  'editor/cms/index.js',
  'media/index.js',
];
const DIRECTIVE_FREE_ENTRIES = ['editor/richtext/index.js'];
const PEER_FREE_ENTRIES = ['editor/index.js', 'editor/canvas/index.js'];
const FORBIDDEN = [/^@tiptap\//, /^yjs$/, /^y-protocols(\/|$)/, /^happy-dom$/];

const SPECIFIER =
  /(?:^|[\s;}])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*(?:\/\*[^*]*\*\/\s*)*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;
const DIRECTIVE = /^\s*['"]use client['"]/;
const CONTEXT =
  /(?:const|let|var)\s+(\w+)\s*=\s*(?:\/\*#__PURE__\*\/\s*)?[\w.]*createContext\(/g;

const problems = [];

for (const entry of CLIENT_ENTRIES) {
  const file = path.join(DIST, entry);
  if (!fs.existsSync(file)) {
    console.error(`check-subpaths: ${file} is missing; run the build first.`);
    process.exit(1);
  }
  if (!DIRECTIVE.test(fs.readFileSync(file, 'utf8'))) {
    problems.push(`${entry}: does not start with 'use client'`);
  }
}

for (const entry of DIRECTIVE_FREE_ENTRIES) {
  const source = fs.readFileSync(path.join(DIST, entry), 'utf8');
  if (DIRECTIVE.test(source)) problems.push(`${entry}: carries 'use client'`);
  if (/from\s*['"]react(?:\/|['"])/.test(source)) {
    problems.push(`${entry}: imports react`);
  }
}

/** Every `.js` file under `dist`. */
function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) return jsFiles(full);
    return dirent.name.endsWith('.js') ? [full] : [];
  });
}

const declaredIn = new Map();
for (const file of jsFiles(DIST)) {
  const rel = path.relative(DIST, file);
  for (const match of fs.readFileSync(file, 'utf8').matchAll(CONTEXT)) {
    const files = declaredIn.get(match[1]) ?? [];
    files.push(rel);
    declaredIn.set(match[1], files);
  }
}
for (const [name, files] of declaredIn) {
  if (files.length > 1) {
    problems.push(`context ${name} is declared in ${files.join(', ')}`);
  }
}
if (!declaredIn.has('EditorContext')) {
  problems.push('EditorContext not found in dist (pattern out of date?)');
}

for (const entry of PEER_FREE_ENTRIES) {
  const seen = new Set();
  const queue = [path.join(DIST, entry)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(SPECIFIER)) {
      const spec = match[1] ?? match[2] ?? match[3];
      if (spec.startsWith('.')) {
        queue.push(path.resolve(path.dirname(file), spec));
      } else if (FORBIDDEN.some((pattern) => pattern.test(spec))) {
        problems.push(
          `${entry}: reaches "${spec}" via ${path.relative(DIST, file)}`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error('check-subpaths: failed');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `check-subpaths: ok (${CLIENT_ENTRIES.length} client entries, ${declaredIn.size} contexts, ${PEER_FREE_ENTRIES.length} peer-free graphs)`,
);
