---
'@createcms/core': minor
---

Releases are now a scoped table: the multi-tenant plugin adds tenant_slug
to cms.releases and every release endpoint applies the scope predicate.

BREAKING CHANGE: with the multiTenant plugin, run `createcms generate` and
apply the migration that adds `releases.tenant_slug` (NOT NULL). Existing
release rows need a tenant_slug backfill before the NOT NULL constraint
can be applied.
