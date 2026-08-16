// Pure helpers behind scripts/linear-release.mjs: which PRs belong to a Linear
// issue, and which just-published package version lists those PRs in its
// changelog. No I/O and no dependencies, so `node --test` covers them without
// a Linear connection or an npm publish.

const PR_URL = /github\.com\/[^/\s)]+\/[^/\s)]+\/pull\/(\d+)/g;

/**
 * PR numbers referenced by a list of URLs or markdown snippets (an issue's
 * attachment URLs, or a changelog section). Deduplicated, ascending.
 */
export function prNumbersIn(texts) {
  const numbers = new Set();
  for (const text of texts) {
    for (const match of String(text ?? '').matchAll(PR_URL)) {
      numbers.add(Number(match[1]));
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * The body of the `## <version>` section of a Changesets CHANGELOG.md
 * (everything up to the next `## ` heading), or '' when the version has no
 * section.
 */
export function changelogSection(markdown, version) {
  const lines = String(markdown ?? '').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * Maps every PR number listed in a just-published version's changelog section
 * to the "name@version" strings that shipped it.
 *
 * `published`: [{ name, version }] as parsed from changesets'
 * `publishedPackages`; `changelogs`: Map of package name to CHANGELOG.md text
 * (packages without a changelog are skipped).
 */
export function attributePublished(published, changelogs) {
  const byPr = new Map();
  for (const { name, version } of published) {
    const markdown = changelogs.get(name);
    if (!markdown) continue;
    for (const pr of prNumbersIn([changelogSection(markdown, version)])) {
      const list = byPr.get(pr) ?? [];
      list.push(`${name}@${version}`);
      byPr.set(pr, list);
    }
  }
  return byPr;
}

/**
 * The comment for one issue. `shipped` holds the "name@version" strings whose
 * changelog lists one of the issue's PRs; when empty the issue landed on main
 * without a package release (repo tooling, tests, docs).
 */
export function commentFor({ prNumbers, shipped, releaseLine }) {
  const prs = prNumbers.length
    ? ` (PR ${prNumbers.map((n) => `#${n}`).join(', ')})`
    : '';
  if (shipped.length) {
    return `Shipped in ${[...new Set(shipped)].join(', ')}${prs}.`;
  }
  return `Landed on main${prs}, not part of a package release. Closed with the ${releaseLine} release run.`;
}
