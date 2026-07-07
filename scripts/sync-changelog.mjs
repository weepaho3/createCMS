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

// MDX parses `<` and `{` as JSX/expression syntax, so changelog prose that
// contains e.g. `Record<string, never>` or `{id}` would break the page. Escape
// those two characters to entities — but ONLY outside code, because inside a
// fenced block or inline code span MDX renders entities literally, which would
// corrupt the very code the changelog is quoting (e.g. `createNotificationRouter<typeof cms>`).
function escapeMdxOutsideCode(md) {
  // Split on fenced code blocks first (``` … ``` / ~~~ … ~~~); the capturing
  // group keeps the fences in the array at odd indices, prose at even indices.
  return md
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part; // fenced code — leave verbatim
      // In prose, protect inline code spans the same way, escape only the rest.
      return part
        .split(/(`[^`\n]*`)/g)
        .map((seg, j) =>
          j % 2 === 1
            ? seg // inline code — leave verbatim
            : seg.replace(/</g, '&lt;').replace(/\{/g, '&#123;'),
        )
        .join('');
    })
    .join('');
}

let body;
try {
  const raw = await readFile(src, 'utf8');
  body = escapeMdxOutsideCode(
    // Drop the leading "# @createcms/core" package heading (the frontmatter
    // title replaces it); keep the "## <version>" sections.
    raw.replace(/^#\s+@createcms\/core\s*\n+/, ''),
  );
} catch (err) {
  // Only "no changelog yet" is a soft fallback; any other error (permissions,
  // I/O) must throw so it can never silently overwrite the page with a placeholder.
  if (err.code !== 'ENOENT') throw err;
  body =
    'No releases yet. Release notes will appear here after the first publish.\n';
}

await mkdir(path.dirname(dest), { recursive: true });
await writeFile(dest, frontmatter + body, 'utf8');
console.log(`[sync-changelog] wrote ${path.relative(root, dest)}`);
