// Closes shipped Linear issues after a successful npm publish.
//
// Changesets is the source of truth for the changelog; Linear only needs to
// learn WHICH issues went out in WHICH version. That is the one piece Linear's
// (Business-only) Releases feature would provide, and the only piece we were
// missing — so it lives here instead.
//
// Contract: every issue sitting in the `Merged` state on the CMS team is code
// that was merged but not yet published. A successful publish is exactly the
// moment that stops being true, so this moves them to `Done` and records the
// version that shipped them.
//
// Runs from `.github/workflows/release.yml` only when
// `steps.changesets.outputs.published == 'true'`.
//
// Env:
//   LINEAR_API_KEY  — personal API key (repo secret)
//   PUBLISHED       — changesets/action `publishedPackages` output:
//                     [{"name":"@createcms/core","version":"0.6.0"}]
//   LINEAR_TEAM_KEY — optional, defaults to CMS
//   DRY_RUN         — optional, set to "1" to log without writing

const API = 'https://api.linear.app/graphql';
const TEAM_KEY = process.env.LINEAR_TEAM_KEY ?? 'CMS';
const FROM_STATE = 'Merged';
const TO_STATE = 'Done';
const DRY_RUN = process.env.DRY_RUN === '1';

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error('[linear-release] LINEAR_API_KEY is not set.');
  process.exit(1);
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

/** Parses the changesets `publishedPackages` output into "name@version" lines.
 *  Tolerates an empty/missing value so a manual run cannot crash the release. */
const parsePublished = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && p.name && p.version)
      .map((p) => `${p.name}@${p.version}`);
  } catch {
    console.warn('[linear-release] Could not parse PUBLISHED; continuing.');
    return [];
  }
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
      nodes { id identifier title }
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
  const versions = parsePublished(process.env.PUBLISHED);
  const versionLine = versions.length ? versions.join(', ') : 'a new release';

  const { workflowStates } = await gql(STATE_QUERY, { teamKey: TEAM_KEY });
  const byName = new Map(workflowStates.nodes.map((s) => [s.name, s.id]));

  const fromId = byName.get(FROM_STATE);
  const toId = byName.get(TO_STATE);

  // A missing state is a setup error, not a release error — say so loudly but
  // do NOT fail the workflow: the package is already on npm at this point, and
  // failing here would turn a successful publish into a red build.
  if (!fromId || !toId) {
    console.error(
      `[linear-release] Team "${TEAM_KEY}" is missing the "${FROM_STATE}" or "${TO_STATE}" state. Found: ${[...byName.keys()].join(', ')}`,
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
    `[linear-release] Shipping ${issues.nodes.length} issue(s) in ${versionLine}${DRY_RUN ? ' (dry run)' : ''}:`,
  );

  for (const issue of issues.nodes) {
    console.log(`  ${issue.identifier}  ${issue.title}`);
    if (DRY_RUN) continue;

    await gql(UPDATE_MUTATION, { id: issue.id, stateId: toId });
    await gql(COMMENT_MUTATION, {
      issueId: issue.id,
      body: `Shipped in ${versionLine}.`,
    });
  }
};

// Never fail the release over bookkeeping. The publish already succeeded; a
// Linear hiccup must not turn the run red, or the next release starts from a
// broken-looking main. Errors are logged for the run summary instead.
main().catch((err) => {
  console.error('[linear-release]', err);
});
