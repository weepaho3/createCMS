// bunchee shares modules imported by both the server entry and a `'use client'`
// entry. If CMS_ERRORS lands in one of those client chunks, Next.js stubs the
// map on the server and CMSError throws TypeError on `def.status`. Server files
// must import the map from a chunk that is not a client boundary.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../dist',
);
const entry = path.join(dist, 'errors-data.js');

if (!fs.existsSync(entry)) {
  throw new Error(
    'dist/errors-data.js is missing; add the ./errors-data export',
  );
}

const entryText = fs.readFileSync(entry, 'utf8');
const entryStart = entryText.trimStart();
if (
  entryStart.startsWith("'use client'") ||
  entryStart.startsWith('"use client"')
) {
  throw new Error('dist/errors-data.js must not be a use-client chunk');
}
if (!entryText.includes('PUBLISHED_CONTENT_NOT_FOUND')) {
  throw new Error(
    'dist/errors-data.js must contain CMS_ERRORS, not re-export it from a client chunk',
  );
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

function isUseClient(text) {
  const start = text.trimStart();
  return start.startsWith("'use client'") || start.startsWith('"use client"');
}

const leaked = [];
for (const file of walk(dist)) {
  const text = fs.readFileSync(file, 'utf8');
  if (isUseClient(text)) continue;
  for (const match of text.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g,
  )) {
    if (!/\bCMS_ERRORS\b/.test(match[1])) continue;
    const importedPath = path.resolve(path.dirname(file), match[2]);
    if (!fs.existsSync(importedPath)) continue;
    const imported = fs.readFileSync(importedPath, 'utf8');
    if (isUseClient(imported)) {
      leaked.push(
        `${path.relative(dist, file)} <- ${path.relative(dist, importedPath)}`,
      );
    }
  }
}

if (leaked.length > 0) {
  throw new Error(
    `CMS_ERRORS is imported from a use-client chunk (${leaked.join('; ')}). ` +
      'Next.js stubs those on the server, so CMSError throws TypeError on def.status.',
  );
}
