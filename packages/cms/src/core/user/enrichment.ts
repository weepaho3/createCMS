import { sql, type SQL } from 'drizzle-orm';

import type { WithUserValue } from '../with-flags';
import type { ResolvedUserConfig } from './resolve';

import { extractUserFromRow, multiUserJoinFragments } from './join-helpers';

/**
 * One user-id field to enrich: a LEFT JOIN to the user table plus the mapping
 * of its resolved columns onto an output property.
 */
export type EnrichField = {
  /**
   * SQL expression for the foreign-key column the user table joins on. Usually
   * fully qualified (`'cms.branches.created_by'`) but may be a query-local alias
   * (`'c.created_by'` inside a CTE). Used verbatim in the JOIN's ON clause, so
   * the exact form matters.
   */
  cmsColumn: string;
  /** Unique SQL alias for this field's user JOIN (e.g. `'branch_user'`). */
  alias: string;
  /** Output property name to populate (e.g. `'createdByUser'`). */
  outputKey: string;
  /**
   * Optional snake_case select alias of the FK id column in the result row.
   * When set, {@link UserEnrichment.apply} short-circuits to `null` if the
   * row's id is falsy (the user was never referenced) instead of calling
   * `extractUserFromRow`. Mirrors the `row.x ? extract : null` guard used for
   * nullable references like `reviewed_by` / `resolved_by`.
   */
  nullGuardCol?: string;
};

export type UserEnrichment = {
  /** Append to the SELECT list. Empty SQL when enrichment is disabled. */
  readonly select: SQL;
  /** Append after FROM + the query's own JOINs. Empty SQL when disabled. */
  readonly join: SQL;
  /**
   * Append to GROUP BY — only interpolate this where the query actually has a
   * GROUP BY. Empty SQL when disabled.
   */
  readonly groupBy: SQL;
  /**
   * Populate `target` with the resolved user(s) for one result `row`. A true
   * no-op when enrichment is disabled: it leaves the output keys UNSET (the
   * current contract omits them entirely rather than setting them to null).
   */
  apply(target: Record<string, unknown>, row: Record<string, unknown>): void;
};

/**
 * Bundles the three raw-SQL join fragments and the row→output mapping for one
 * or more user-id fields, so each endpoint declares its enrichment once and
 * reuses it for both SQL splicing (`${enrich.select}` / `.join` / `.groupBy`)
 * and output mapping (`enrich.apply(item, row)`).
 *
 * When `withUser` / `userConfig` are absent the fragments are empty SQL and
 * `apply` is a no-op — identical to the `withUser && uc ? ... : null` /
 * `if (withUser && uc) { ... }` guards the call sites used inline before.
 *
 * A single field and a multi-field array both route through
 * `multiUserJoinFragments`; for one field it emits the same SQL the old
 * `userJoinFragments` call produced.
 */
export function userEnrichment(
  ctx: {
    context: { withUser?: WithUserValue; userConfig?: ResolvedUserConfig };
  },
  fields: EnrichField | EnrichField[],
): UserEnrichment {
  const withUser = ctx.context.withUser;
  const uc = ctx.context.userConfig;
  const list = Array.isArray(fields) ? fields : [fields];

  if (!withUser || !uc) {
    return {
      select: sql.raw(''),
      join: sql.raw(''),
      groupBy: sql.raw(''),
      apply: () => {},
    };
  }

  const frags = multiUserJoinFragments(
    uc,
    list.map((f) => ({ cmsColumn: f.cmsColumn, alias: f.alias })),
    withUser,
  );

  return {
    select: frags.selectColumns,
    join: frags.joinClause,
    groupBy: frags.groupByColumns,
    apply(target, row) {
      for (const f of list) {
        target[f.outputKey] =
          f.nullGuardCol && !row[f.nullGuardCol]
            ? null
            : extractUserFromRow(row, f.alias, uc, withUser);
      }
    },
  };
}
