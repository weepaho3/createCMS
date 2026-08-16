// Closes shipped Linear issues after a successful npm publish.
//
// Changesets is the source of truth for the changelog; Linear only needs to
// learn WHICH issues went out in WHICH version. That is the one piece Linear's
// (Business-only) Releases feature would provide, and the only piece we were
// missing — so it lives here instead.
//
// Contract: every issue sitting in the `Merged` state on the CMS team is code
// that was merged but not yet published. A successful publish is exactly the
// moment that stops being true, so this moves them to `Done`. The comment
// names the package version whose changelog lists the issue's PR (Linear's
// GitHub integration attaches the PR to the issue; Changesets links every
// changelog entry to its PR). An issue whose PR appears in no published
// changelog (repo tooling, tests, docs) gets a neutral note instead of a
// version. Attribution logic lives in ./linear-release-attribution.mjs.
//
// Runs from `.github/workflows/release.yml` only when
// `steps.changesets.outputs.published == 'true'`.
//
// Env:
//   LINEAR_API_KEY  — personal API key (repo secret)
//   PUBLISHED       — changesets/action `publishedPackages` output:
//                     [{"name":"@createcms/core","version":"0.6.0"}, {"name":"@createcms/react","version":"0.2.0"}]
//                     (one entry per package the run published; independent versions)
//   LINEAR_TEAM_KEY — optional, defaults to CMS
//   DRY_RUN         — optional, set to "1" to log without writing
//   ATTRIBUTION_ONLY: optional, "1" prints the PR -> version attribution from
//                     the local changelogs and exits (no Linear call)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  attributePublished,
  commentFor,
  prNumbersIn,
} from './linear-release-attribution.mjs';

const API = 'https://api.linear.app/graphql';
const TEAM_KEY = process.env.LINEAR_TEAM_KEY ?? 'CMS';
const FROM_STATE = 'Merged';
const TO_STATE = 'Done';
const DRY_RUN = process.env.DRY_RUN === '1';

/** Surfaces a problem without failing the job. Bookkeeping must never turn a
 *  successful publish red (see the tail of this file), but a silent skip would
 *  let a missing secret go unnoticed for releases on end — so under Actions
 *  this emits an annotation that shows up in the run summary. */
const warn = (message) => {
  console.error(
    process.env.GITHUB_ACTIONS
      ? `::warning title=linear-release::${message}`
      : `[linear-release] ${message}`,
  );
};

// No key is a setup error (repo secret missing), not a release error. The
// package is already on npm by the time this runs, so exit clean.
const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey && process.env.ATTRIBUTION_ONLY !== '1') {
  warn(
    'LINEAR_API_KEY is not set — skipping Linear bookkeeping. Add the secret under Settings → Secrets and variables → Actions.',
  );
  process.exit(0);
}

/** Minimal GraphQL client. Linear returns HTTP 200 with an `errors` array on
 *  failure, so a non-throwing fetch is not enough — check both. */
const gql = async (query, variables = {}) => {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`[linear-release] HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(
      `[linear-release] GraphQL error: ${JSON.stringify(json.errors)}`,
    );
  }
  return json.data;
};

/** Parses the changesets `publishedPackages` output into [{ name, version }].
 *  Tolerates an empty/missing value so a manual run cannot crash the release. */
const parsePublished = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && p.name && p.version)
      .map((p) => ({ name: String(p.name), version: String(p.version) }));
  } catch {
    console.warn('[linear-release] Could not parse PUBLISHED; continuing.');
    return [];
  }
};

/** CHANGELOG.md text per workspace package name (packages without one are
 *  absent). Read from the checkout the release ran in, where the version PR
 *  has just been merged, so the published versions' sections are present. */
const loadChangelogs = () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const changelogs = new Map();
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return changelogs;
  for (const dir of readdirSync(packagesDir)) {
    const manifest = path.join(packagesDir, dir, 'package.json');
    const changelog = path.join(packagesDir, dir, 'CHANGELOG.md');
    if (!existsSync(manifest) || !existsSync(changelog)) continue;
    try {
      const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
      if (name) changelogs.set(name, readFileSync(changelog, 'utf8'));
    } catch (err) {
      warn(`Could not read ${manifest}: ${err?.message ?? err}`);
    }
  }
  return changelogs;
};

const STATE_QUERY = `
  query States($teamKey: String!) {
    workflowStates(
      filter: { team: { key: { eq: $teamKey } } }
      first: 100
    ) {
      nodes { id name }
    }
  }
`;

const ISSUES_QUERY = `
  query MergedIssues($teamKey: String!, $stateId: ID!) {
    issues(
      filter: {
        team: { key: { eq: $teamKey } }
        state: { id: { eq: $stateId } }
      }
      first: 250
    ) {
      nodes {
        id
        identifier
        title
        attachments(first: 20) { nodes { url } }
      }
    }
  }
`;

const UPDATE_MUTATION = `
  mutation Ship($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) { success }
  }
`;

const COMMENT_MUTATION = `
  mutation Note($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) { success }
  }
`;

const main = async () => {
  const published = parsePublished(process.env.PUBLISHED);
  const versions = published.map((p) => `${p.name}@${p.version}`);
  const versionLine = versions.length ? versions.join(', ') : 'a new release';
  const byPr = attributePublished(published, loadChangelogs());

  // Local self-check: print the PR -> version attribution read from the
  // workspace changelogs and exit without touching Linear.
  if (process.env.ATTRIBUTION_ONLY === '1') {
    for (const [pr, shipped] of [...byPr.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      console.log(`  #${pr}  ${shipped.join(', ')}`);
    }
    return;
  }

  const { workflowStates } = await gql(STATE_QUERY, { teamKey: TEAM_KEY });
  const byName = new Map(workflowStates.nodes.map((s) => [s.name, s.id]));

  const fromId = byName.get(FROM_STATE);
  const toId = byName.get(TO_STATE);

  // A missing state is a setup error, not a release error — say so loudly but
  // do NOT fail the workflow: the package is already on npm at this point, and
  // failing here would turn a successful publish into a red build.
  if (!fromId || !toId) {
    warn(
      `Team "${TEAM_KEY}" is missing the "${FROM_STATE}" or "${TO_STATE}" state. Found: ${[...byName.keys()].join(', ')}`,
    );
    return;
  }

  const { issues } = await gql(ISSUES_QUERY, {
    teamKey: TEAM_KEY,
    stateId: fromId,
  });

  if (issues.nodes.length === 0) {
    console.log(
      `[linear-release] No issues in "${FROM_STATE}" — nothing to do.`,
    );
    return;
  }

  console.log(
    `[linear-release] Closing ${issues.nodes.length} issue(s) after publishing ${versionLine}${DRY_RUN ? ' (dry run)' : ''}:`,
  );

  for (const issue of issues.nodes) {
    const prNumbers = prNumbersIn(
      (issue.attachments?.nodes ?? []).map((a) => a.url),
    );
    const shipped = prNumbers.flatMap((pr) => byPr.get(pr) ?? []);
    const body = commentFor({ prNumbers, shipped, releaseLine: versionLine });
    console.log(`  ${issue.identifier}  ${issue.title}\n      ${body}`);
    if (DRY_RUN) continue;

    await gql(UPDATE_MUTATION, { id: issue.id, stateId: toId });
    await gql(COMMENT_MUTATION, { issueId: issue.id, body });
  }
};

// Never fail the release over bookkeeping. The publish already succeeded; a
// Linear hiccup must not turn the run red, or the next release starts from a
// broken-looking main. Errors are logged for the run summary instead.
main().catch((err) => {
  warn(`Bookkeeping failed: ${err?.message ?? err}`);
  console.error(err);
});
