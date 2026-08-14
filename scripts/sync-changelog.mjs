// Mirrors the release-history markdown into Fumadocs pages:
//
//   packages/cms/CHANGELOG.md  → apps/docs/content/docs/changelog.mdx
//   BREAKING-CHANGES.md        → apps/docs/content/docs/breaking-changes.mdx
//
// The changelog runs as part of `version-packages` (i.e. inside the Changesets
// "version" step), so the docs changelog is committed in the same release PR and
// stays in sync automatically — no manual step. BREAKING-CHANGES.md is
// hand-maintained per PR, so CI runs this script with `--check` to catch a page
// that drifted from its source.
//
// Usage:
//   node scripts/sync-changelog.mjs            # write the pages
//   node scripts/sync-changelog.mjs --check    # verify only, exit 1 on drift
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'https://github.com/weepaho3/createCMS';
const check = process.argv.includes('--check');

const pages = [
  {
    src: 'packages/cms/CHANGELOG.md',
    dest: 'apps/docs/content/docs/changelog.mdx',
    title: 'Changelog',
    description:
      'Release notes for @createcms/core, generated from Changesets.',
    // Drop the leading "# @createcms/core" package heading (the frontmatter
    // title replaces it); keep the "## <version>" sections.
    stripHeading: /^#\s+@createcms\/core\s*\n+/,
    missing:
      'No releases yet. Release notes will appear here after the first publish.\n',
  },
  {
    src: 'BREAKING-CHANGES.md',
    dest: 'apps/docs/content/docs/breaking-changes.mdx',
    title: 'Breaking changes',
    description:
      'Every consumer-visible break in @createcms/core, per release, with the migration.',
    stripHeading: /^#\s+Breaking changes\s*\n+/,
    missing: 'No breaking changes have been recorded yet.\n',
  },
];

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

// Repo-relative links (`./CONTRIBUTING.md`) resolve against the repository, not
// against the docs site, so they 404 once mirrored. Point the two pages that
// exist on the site at their site path, and everything else at GitHub.
const SITE_PATHS = new Map([
  ['packages/cms/CHANGELOG.md', '/docs/changelog'],
  ['BREAKING-CHANGES.md', '/docs/breaking-changes'],
]);

function rewriteRepoLinks(md) {
  return md.replace(
    /\]\(\.\/([^)\s#]+)(#[^)\s]*)?\)/g,
    (_match, target, hash = '') => {
      const site = SITE_PATHS.get(target);
      if (site) return `](${site})`;
      return `](${repo}/blob/main/${target}${hash})`;
    },
  );
}

let drifted = 0;

for (const page of pages) {
  const src = path.join(root, page.src);
  const dest = path.join(root, page.dest);

  let body;
  try {
    const raw = await readFile(src, 'utf8');
    body = escapeMdxOutsideCode(
      rewriteRepoLinks(raw.replace(page.stripHeading, '')),
    );
  } catch (err) {
    // Only "source not there yet" is a soft fallback; any other error
    // (permissions, I/O) must throw so it can never silently overwrite the page
    // with a placeholder.
    if (err.code !== 'ENOENT') throw err;
    body = page.missing;
  }

  const contents = `---
title: ${page.title}
description: ${page.description}
---

${body}`;

  if (check) {
    const current = await readFile(dest, 'utf8').catch(() => null);
    if (current === contents) continue;
    drifted++;
    console.error(
      `[sync-changelog] ${page.dest} is out of sync with ${page.src}.\n` +
        '  → Run `node scripts/sync-changelog.mjs` and commit the result.',
    );
    if (process.env.GITHUB_ACTIONS) {
      console.error(
        `::error file=${page.dest}::Out of sync with ${page.src} — run \`node scripts/sync-changelog.mjs\`.`,
      );
    }
    continue;
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, contents, 'utf8');
  console.log(`[sync-changelog] wrote ${page.dest}`);
}

if (drifted > 0) process.exit(1);
if (check) console.log('[sync-changelog] docs pages are in sync');
