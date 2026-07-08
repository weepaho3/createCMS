import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';

import type { ReferenceResolver } from '../../core/types/definitions';
import type { DrizzleInstance } from '../../core/types/drizzle';

import { rootScopeConditions } from '../../core/scope';
import { i18nRoots } from './tables';

/**
 * The i18n plugin's reference resolver. Owns ALL translation-group
 * resolution: a stored reference value (`rot_` rootId or `tgr_` group key) is
 * resolved to the rootId(s) it relates to, honouring the active language + its
 * fallback chain. Core carries this on the resolved scope and rides it from the
 * read path and the A/B co-render walk; without the i18n plugin core uses its
 * own identity default and none of this code runs.
 *
 * Because the i18n factory builds this ONLY when a language is active, the impl
 * assumes i18n is on (no `'language' in scopeColumns` self-gate) and queries the
 * plugin-owned `language` / `translation_key` columns through a TYPED roots view
 * (D5) instead of raw SQL — tenant scoping reuses the generic
 * `rootScopeConditions` (language excluded), so there is no raw tenant predicate.
 *
 * Closes over the active `language` + `fallback` chain (the resolution policy);
 * `db` + `scopeColumns` (the merged tenant predicate) arrive per call.
 *   - resolveRenderTargets: tgr_ → best sibling along [language, ...fallback];
 *     rot_ → active-language sibling of its group, else the stored anchor;
 *     other values → themselves.
 *   - resolveConflictTargets: the whole-group SUPERSET a key could render as
 *     (the A/B co-render conflict set).
 *   - expandGroup / groupKeysFor: translation-group expansion / its `tgr_` keys.
 */
export function buildI18nReferenceResolver(
  language: string,
  fallback: readonly string[],
): ReferenceResolver {
  const languageChain = [language, ...fallback];
  return {
    async resolveRenderTargets(db, scopeColumns, collection, storedValues) {
      const tenantConds = rootScopeConditions(scopeColumns, ['language']);

      const valueToRootId = new Map<string, string>();
      const tgrValues: string[] = [];
      const rotValues: string[] = [];
      for (const value of storedValues) {
        if (value.startsWith('tgr_')) tgrValues.push(value);
        else if (value.startsWith('rot_')) rotValues.push(value);
        else valueToRootId.set(value, value); // unknown prefix — used as-is
      }

      if (tgrValues.length > 0) {
        // One query for all keys across all chain languages; pick the sibling
        // whose language is highest in the chain.
        const rows = await db
          .select({
            id: i18nRoots.id,
            translationKey: i18nRoots.translationKey,
            language: i18nRoots.language,
          })
          .from(i18nRoots)
          .where(
            and(
              inArray(i18nRoots.translationKey, tgrValues),
              inArray(i18nRoots.language, languageChain),
              eq(i18nRoots.collection, collection),
              isNull(i18nRoots.archivedAt),
              ...tenantConds,
            ),
          );
        const rank = new Map(languageChain.map((l, i) => [l, i]));
        const best = new Map<string, { id: string; rank: number }>();
        for (const r of rows) {
          const rk = rank.get(r.language) ?? Number.POSITIVE_INFINITY;
          const cur = best.get(r.translationKey);
          if (!cur || rk < cur.rank)
            best.set(r.translationKey, { id: r.id, rank: rk });
        }
        for (const value of tgrValues) {
          const b = best.get(value);
          if (b) valueToRootId.set(value, b.id); // missing in all chain langs → unresolved
        }
      }

      if (rotValues.length > 0) {
        // 1) stored anchor → its translation group key (tenant-scoped; NOT
        //    archived-filtered — the anchor itself may be archived).
        const groupRows = await db
          .select({
            id: i18nRoots.id,
            translationKey: i18nRoots.translationKey,
          })
          .from(i18nRoots)
          .where(
            and(
              inArray(i18nRoots.id, rotValues),
              eq(i18nRoots.collection, collection),
              ...tenantConds,
            ),
          );
        const groupByRot = new Map<string, string>();
        for (const r of groupRows) groupByRot.set(r.id, r.translationKey);

        // 2) each group → its ACTIVE-language sibling (only).
        const groupKeys = [...new Set(groupByRot.values())];
        const siblingByGroup = new Map<string, string>();
        if (groupKeys.length > 0) {
          const sibRows = await db
            .select({
              id: i18nRoots.id,
              translationKey: i18nRoots.translationKey,
            })
            .from(i18nRoots)
            .where(
              and(
                inArray(i18nRoots.translationKey, groupKeys),
                eq(i18nRoots.language, language),
                eq(i18nRoots.collection, collection),
                isNull(i18nRoots.archivedAt),
                ...tenantConds,
              ),
            );
          for (const r of sibRows) siblingByGroup.set(r.translationKey, r.id);
        }

        // 3) anchor → active-language sibling, else the stored anchor itself.
        for (const value of rotValues) {
          const group = groupByRot.get(value);
          const sibling = group ? siblingByGroup.get(group) : undefined;
          valueToRootId.set(value, sibling ?? value);
        }
      }

      return valueToRootId;
    },
    async resolveConflictTargets(db, scopeColumns, storedKeys) {
      return resolveReferenceTargets(db, storedKeys, scopeColumns);
    },
    async expandGroup(db, _scopeColumns, rootIds) {
      return [...(await expandTranslationGroups(db, rootIds))];
    },
    async groupKeysFor(db, _scopeColumns, rootIds) {
      return groupTranslationKeys(db, rootIds);
    },
  };
}

/**
 * Expand a set of rootIds to ALL their translation-group siblings. A reference
 * stores a `rot_` anchor but the read-time auto-upgrade renders the active-
 * language sibling, so the co-render check must treat the whole group as one
 * logical block. `translation_key` is a globally-unique, tenant-bound group id
 * → no tenant predicate needed.
 */
async function expandTranslationGroups(
  db: DrizzleInstance,
  rootIds: string[],
): Promise<Set<string>> {
  const out = new Set(rootIds);
  if (rootIds.length === 0) return out;
  const groupKeys = db
    .select({ translationKey: i18nRoots.translationKey })
    .from(i18nRoots)
    .where(inArray(i18nRoots.id, rootIds));
  const rows = await db
    .select({ id: i18nRoots.id })
    .from(i18nRoots)
    .where(inArray(i18nRoots.translationKey, groupKeys));
  for (const r of rows) out.add(r.id);
  return out;
}

/**
 * The translation-group key(s) (`tgr_`) for a set of roots. A host may embed the
 * group via a `tgr_` key rather than a `rot_` rootId, so the co-render up-walk
 * match set must include these.
 */
async function groupTranslationKeys(
  db: DrizzleInstance,
  rootIds: string[],
): Promise<string[]> {
  if (rootIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ translationKey: i18nRoots.translationKey })
    .from(i18nRoots)
    .where(
      and(inArray(i18nRoots.id, rootIds), isNotNull(i18nRoots.translationKey)),
    );
  return rows.map((r) => r.translationKey);
}

/**
 * Resolve reference targetKeys (`rot_` rootIds OR `tgr_` group keys) to the
 * rootIds they actually RENDER — expanding a `tgr_` to its whole group (a
 * conservative superset; the read path picks one sibling, we keep all).
 * Tenant-scoped: an author-typed foreign rootId resolves to nothing → the
 * co-render set never crosses tenants.
 */
async function resolveReferenceTargets(
  db: DrizzleInstance,
  keys: string[],
  scopeColumns?: Record<string, unknown>,
): Promise<string[]> {
  if (keys.length === 0) return [];
  const rows = await db
    .select({ id: i18nRoots.id })
    .from(i18nRoots)
    .where(
      and(
        or(
          inArray(i18nRoots.id, keys),
          inArray(i18nRoots.translationKey, keys),
        ),
        isNull(i18nRoots.archivedAt),
        ...rootScopeConditions(scopeColumns, ['language']),
      ),
    );
  return rows.map((r) => r.id);
}
