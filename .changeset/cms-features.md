---
"@createcms/core": patch
---

Product-capability pass (cms-02, 03, 04, 06, 08, 10, 13, 14, 18). New content
features plus a search-scope security fix. Some changes are behavior-affecting;
schema-affecting ones need a regenerate + migration.

- **Search scope (security, cms-08).** `search.query` now applies the SAME read
  boundary as normal endpoints: a result is returned only if its underlying
  entity is visible under the active scope (a correlated `EXISTS` per entity
  type), and notifications are filtered to the requesting user. This closes a
  cross-tenant content leak and a cross-user notification-title leak. When no
  scoping plugin is active, behavior is unchanged.
- **Scheduled publishing / expiry (cms-02, schema).** New `scheduled_publications`
  table + endpoints to schedule a publish/unpublish, and `admin.runScheduled`
  (call it from your cron, like `admin.runPruning`) which processes due rows via
  the real publish machinery. Claims each row atomically so overlapping cron runs
  never double-publish.
- **Releases / atomic multi-page publish (cms-13, schema).** New `releases` /
  `release_items` tables + `publishRelease`, which publishes every item in ONE
  transaction (all-or-nothing), reusing the existing per-root publish path.
- **List / multi-reference property type (cms-03).** New `list` property kind
  (`{ type: 'list', of: <scalar | reference> }`) validated as a JSON array with
  optional min/max length. List references are indexed for the reusable-block
  delete guard and resolved at read exactly like a single reference.
- **Stricter property validation (cms-04, behavior).** `date` is now validated as
  an ISO datetime, string/number properties accept declarative
  `minLength`/`maxLength`/`pattern`/`min`/`max` constraints, and `image` /
  `reference` ids (including inside lists) are checked to EXIST at write time.
  Writes that previously stored an invalid date or a dangling id now throw a
  validation error instead of failing later at render.
- **Merge approval gate (cms-06, behavior).** `executeMerge` now blocks a merge by
  default when an OPEN approval request exists on it (previously only enforced
  behind the governance flags), mirroring `publishBranch`. A merge with no
  approval requests is unaffected. Also fixes the content-workflow guide, which
  wrongly claimed every merge requires an approval.
- **Optimistic concurrency (cms-18).** Content mutations accept an optional
  `expectedHeadCommitId`; if the branch head has moved, the write is rejected with
  a `HEAD_MISMATCH` (409) conflict instead of silently interleaving. Omitted =
  unchanged behavior.
- **Numeric list sort (cms-10).** `listRoots` sorts numeric properties as numbers
  (guarded cast, non-numeric values sort last) instead of as text where "10" < "9".
- **Typed plugin hook actions (cms-14).** `CMSHookAction` is now the finite union
  of real endpoint keys (plus an open arm), so plugin hook actions autocomplete.

Regenerate your Drizzle schema (`createcms generate`) and add a migration to pick
up the new `scheduled_publications`, `releases`, and `release_items` tables.
