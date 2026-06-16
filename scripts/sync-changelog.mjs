// Mirrors the Changesets-generated package CHANGELOG into a Fumadocs docs page.
// Runs as part of `version-packages` (i.e. inside the Changesets "version" step),
// so the docs changelog is committed in the same release PR and stays in sync
// automatically — no manual step.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'packages/cms/CHANGELOG.md');
const dest = path.join(root, 'apps/docs/content/docs/changelog.mdx');

const frontmatter = `---
title: Changelog
description: Release notes for @createcms/core, generated from Changesets.
---

`;

let body;
try {
  const raw = await readFile(src, 'utf8');
  body = raw
    // Drop the leading "# @createcms/core" package heading (the frontmatter
    // title replaces it); keep the "## <version>" sections.
    .replace(/^#\s+@createcms\/core\s*\n+/, '')
    // MDX-safety: changelog text is never JSX, so render angle brackets and
    // braces literally instead of letting MDX try to parse them.
    .replace(/</g, '&lt;')
    .replace(/\{/g, '&#123;');
} catch {
  body =
    'No releases yet. Release notes will appear here after the first publish.\n';
}

await mkdir(path.dirname(dest), { recursive: true });
await writeFile(dest, frontmatter + body, 'utf8');
console.log(`[sync-changelog] wrote ${path.relative(root, dest)}`);
