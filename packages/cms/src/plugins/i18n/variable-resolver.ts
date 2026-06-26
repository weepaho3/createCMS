import { and, inArray } from 'drizzle-orm';

import type { VariableResolver } from '../../core/types/definitions';

import { variableScopeConditions } from '../../core/scope';
import { i18nVariables } from './tables';

/**
 * The i18n plugin's variable resolver (Seam B, variables). Loads the variable
 * map for the active language WITH fallback: it queries every variable whose
 * language is in `[language, ...fallback]` (within the active tenant), then for
 * each `key` keeps the value from the highest-ranked language in the chain — so
 * the active language wins, and a value missing there falls back down the chain.
 *
 * Like the reference resolver, it is built ONLY when a language is active, so it
 * assumes i18n is on. Tenant scoping reuses the generic `variableScopeConditions`
 * (language excluded — the chain resolves language, not a hard equality).
 */
export function buildI18nVariableResolver(
  language: string,
  fallback: readonly string[],
): VariableResolver {
  const languageChain = [language, ...fallback];
  const rank = new Map(languageChain.map((l, i) => [l, i]));
  return {
    async load(db, scopeColumns) {
      const tenantConds = variableScopeConditions(scopeColumns, ['language']);
      const rows = await db
        .select({
          key: i18nVariables.key,
          value: i18nVariables.value,
          language: i18nVariables.language,
        })
        .from(i18nVariables)
        .where(
          and(inArray(i18nVariables.language, languageChain), ...tenantConds),
        );

      const best = new Map<string, { value: string; rank: number }>();
      for (const row of rows) {
        const rk = rank.get(row.language) ?? Number.POSITIVE_INFINITY;
        const current = best.get(row.key);
        if (!current || rk < current.rank) {
          best.set(row.key, { value: row.value, rank: rk });
        }
      }

      const resolved = new Map<string, string>();
      for (const [key, { value }] of best) resolved.set(key, value);
      return resolved;
    },
  };
}
