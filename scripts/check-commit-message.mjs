// Validates a Conventional Commit message against the convention documented in
// CONTRIBUTING.md ("Commit conventions"), with one project-specific rule on top:
// pre-1.0, a `minor` changeset for @createcms/core IS a breaking change, so the
// message must carry the marker (`!` in the subject, or a `BREAKING CHANGE:`
// footer). That rule is the whole point — it stops a break from landing as an
// ordinary-looking commit, which is how 223 commits ended up with zero markers.
//
// Pull requests are squash-merged, so the PR *title* becomes the subject on main:
// that is what CI feeds in here.
//
// Usage:
//   node scripts/check-commit-message.mjs "<subject>" ["<body>"]
//   PR_TITLE=… PR_BODY=… node scripts/check-commit-message.mjs
//
// Options:
//   --base <ref>   base ref for detecting changesets added by this PR
//                  (default: origin/main). Pass --no-changeset-check to skip.
//
// Exits non-zero with an explanation on the first failure class it finds.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
];

const MAX_SUBJECT_LENGTH = 100;

// `type(scope)!: description` — scope optional, `!` optional.
const SUBJECT_RE =
  /^(?<type>[a-z]+)(?:\((?<scope>[^()\n]+)\))?(?<bang>!)?: (?<description>.+)$/;

// The spec allows `BREAKING CHANGE:` and `BREAKING-CHANGE:`; nothing else.
const FOOTER_RE = /^BREAKING[ -]CHANGE: *(?<description>.*)$/;
// Anything clearly *meant* to be the footer — wrong case, plural, markdown bold,
// missing colon — so a near miss is reported as a malformed footer instead of
// silently counting as "no marker at all". Bullets and quotes are prose.
const FOOTER_LOOKALIKE_RE =
  /^\s*[*_]{0,2}\s*breaking[ _-]?changes?\s*[*_]{0,2}\s*(:|$)/i;
const PROSE_LINE_RE = /^\s*(?:[->]|\* )/;

const errors = [];
const notes = [];

function fail(message, hint) {
  errors.push(hint ? `${message}\n    → ${hint}` : message);
}

function parseArgs(argv) {
  const positional = [];
  let base = 'origin/main';
  let changesetCheck = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') base = argv[++i] ?? base;
    else if (arg.startsWith('--base=')) base = arg.slice('--base='.length);
    else if (arg === '--no-changeset-check') changesetCheck = false;
    else positional.push(arg);
  }

  return { positional, base, changesetCheck };
}

const { positional, base, changesetCheck } = parseArgs(process.argv.slice(2));

// Env first in CI: it keeps untrusted PR text out of the shell entirely.
const subject = (process.env.PR_TITLE ?? positional[0] ?? '').trim();
const body = process.env.PR_BODY ?? positional[1] ?? '';

if (!subject) {
  console.error(
    'check-commit-message: no subject given (pass one as an argument or via PR_TITLE).',
  );
  process.exit(2);
}

// ── Subject ────────────────────────────────────────────────────────────────
// GitHub appends " (#123)" to the squashed subject; the PR title itself does
// not carry it, but tolerate it so the same check works on a real commit.
const subjectForLength = subject.replace(/\s*\(#\d+\)$/, '');
const match = SUBJECT_RE.exec(subjectForLength);

if (!match) {
  fail(
    `Subject does not parse as a Conventional Commit: "${subject}"`,
    'Expected `type(scope): description` — e.g. `fix(media): stop leaking superseded S3 objects`. ' +
      'Mark a breaking change with `!` before the colon: `feat(media)!: …`.',
  );
} else {
  const { type, description, bang } = match.groups;

  if (!TYPES.includes(type)) {
    fail(`Unknown commit type "${type}".`, `Use one of: ${TYPES.join(', ')}.`);
  }
  if (description.trim().length < 8) {
    fail(
      `Subject description is too short: "${description}".`,
      'Say what changed, in the imperative.',
    );
  }
  if (description.endsWith('.')) {
    fail(
      'Subject description ends with a period.',
      'Drop the trailing period.',
    );
  }
  if (subjectForLength.length > MAX_SUBJECT_LENGTH) {
    fail(
      `Subject is ${subjectForLength.length} characters (max ${MAX_SUBJECT_LENGTH}).`,
      'Move the detail into the body — that is where a BREAKING CHANGE footer lives too.',
    );
  }
  if (bang) notes.push('subject carries the `!` breaking marker');
}

// ── BREAKING CHANGE footer ─────────────────────────────────────────────────
// HTML comments are the PR template's guidance, not part of the message: an
// untouched template must never read as a marker (or as a malformed one).
const bodyLines = body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
let hasFooter = false;

for (const [index, line] of bodyLines.entries()) {
  const footer = FOOTER_RE.exec(line);
  if (footer) {
    hasFooter = true;
    // The description may continue on the following lines, so only an empty
    // footer with nothing after it is missing its description.
    const continued = (bodyLines[index + 1] ?? '').trim().length > 0;
    if (!footer.groups.description.trim() && !continued) {
      fail(
        'The `BREAKING CHANGE:` footer has no description.',
        'Name what breaks and what to do instead — that text is what upgraders read.',
      );
    }
    continue;
  }
  // Not the real footer, but unmistakably an attempt at one.
  if (FOOTER_LOOKALIKE_RE.test(line) && !PROSE_LINE_RE.test(line)) {
    fail(
      `Malformed breaking-change footer: "${line.trim()}"`,
      'It must be exactly `BREAKING CHANGE: <description>` (or `BREAKING-CHANGE:`), ' +
        'upper-case, unformatted, at the start of its own line.',
    );
  }
}

if (hasFooter) notes.push('body carries a `BREAKING CHANGE:` footer');

const marked = Boolean(match?.groups.bang) || hasFooter;

// ── Cross-check against the changesets this PR adds ────────────────────────
// Pre-1.0 a `minor` bump for @createcms/core means "breaking" (CONTRIBUTING.md
// → Versioning), so the two signals must agree in both directions.
function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function addedChangesetFiles() {
  // Committed on this branch …
  const committed = git([
    'diff',
    '--name-only',
    '--diff-filter=AM',
    `${base}...HEAD`,
    '--',
    '.changeset/*.md',
  ]);
  // … plus anything still in the working tree, so a local run before committing
  // sees the changeset the contributor just wrote (`?? path` = untracked).
  const working = git(['status', '--porcelain', '--', '.changeset/*.md'])
    .split('\n')
    .map((line) => line.slice(3).trim());

  return [...new Set([...committed.split('\n'), ...working])]
    .map((line) => line.trim())
    .filter((line) => line && !line.endsWith('.changeset/README.md'));
}

function declaresCoreMinor(file) {
  const absolute = path.join(root, file);
  // A changeset the branch deleted (or a rename entry) has nothing to read.
  if (!existsSync(absolute)) return false;
  const raw = readFileSync(absolute, 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1];
  if (!frontmatter) return false;
  return frontmatter
    .split(/\r?\n/)
    .some((line) =>
      /^\s*['"]?@createcms\/core['"]?\s*:\s*['"]?minor['"]?\s*$/.test(line),
    );
}

let changesetVerdict = null; // null = check did not run

if (changesetCheck) {
  try {
    const files = addedChangesetFiles();
    changesetVerdict = files.filter(declaresCoreMinor);
  } catch (err) {
    // A shallow clone or a missing base ref is not the contributor's fault:
    // skip the cross-check rather than failing the run on it.
    notes.push(
      `changeset cross-check skipped (${err.message.split('\n')[0].trim()})`,
    );
  }
}

if (changesetVerdict !== null) {
  const minorChangesets = changesetVerdict;

  if (minorChangesets.length > 0 && !marked) {
    fail(
      `This PR adds a \`minor\` changeset for @createcms/core (${minorChangesets.join(', ')}) ` +
        'but the message carries no breaking-change marker.',
      'Pre-1.0, minor IS the breaking channel. Add `!` to the subject ' +
        '(`feat(scope)!: …`) and a `BREAKING CHANGE:` footer describing the migration, ' +
        'plus an entry in BREAKING-CHANGES.md under "## Unreleased". ' +
        'If the change is not breaking, make the changeset a patch.',
    );
  }

  if (minorChangesets.length === 0 && marked) {
    fail(
      'The message is marked as breaking, but this PR adds no `minor` changeset for @createcms/core.',
      'Run `bunx changeset` and pick **minor** — pre-1.0 that is the breaking channel. ' +
        'Then add the entry to BREAKING-CHANGES.md under "## Unreleased".',
    );
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
const isActions = Boolean(process.env.GITHUB_ACTIONS);

if (errors.length > 0) {
  console.error(`\ncheck-commit-message: ${subject}\n`);
  for (const error of errors) {
    console.error(`  ✗ ${error}`);
    if (isActions) {
      console.error(
        `::error title=Commit convention::${error.replace(/\n\s*/g, ' ')}`,
      );
    }
  }
  console.error(
    '\nSee CONTRIBUTING.md → "Commit conventions". ' +
      'The PR title is the squashed commit subject, so fix it there.\n',
  );
  process.exit(1);
}

console.log(`check-commit-message: OK — ${subject}`);
for (const note of notes) console.log(`  · ${note}`);
