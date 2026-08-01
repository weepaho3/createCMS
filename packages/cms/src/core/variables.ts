import { and, eq, isNull } from 'drizzle-orm';

import type { BlockTreeNode } from './blocks/reconstruct-snapshot';
import type { VersionToIndex } from './content-index';
import type { ResolvedScope } from './types/definitions';
import type { DrizzleInstance } from './types/drizzle';

import { newId } from '../utils/nanoid';
import {
  blockVersions,
  branches,
  commitSnapshots,
  contentUsages,
  publications,
  roots,
  templateVariableUsages,
  templates,
  variables,
} from './db/schema.generated';
import { crossScopeColumns, rootScopeConditions } from './scope';

const VAR_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Extracts all variable keys referenced in a string value.
 * Returns a deduplicated array of keys.
 */
export function extractVariableKeys(value: string): string[] {
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  VAR_PATTERN.lastIndex = 0;
  while ((match = VAR_PATTERN.exec(value)) !== null) {
    keys.add(match[1]);
  }
  return [...keys];
}

/**
 * Scans all string properties of a block and returns a map of
 * propertyKey -> variableKeys[] for properties that contain {{...}} patterns.
 */
export function extractVariableKeysFromProperties(
  properties: Record<string, unknown>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [propKey, value] of Object.entries(properties)) {
    if (typeof value !== 'string') continue;
    const keys = extractVariableKeys(value);
    if (keys.length > 0) {
      result.set(propKey, keys);
    }
  }
  return result;
}

/**
 * Loads the variable `key -> value` map for the active scope. Called once per
 * read request and fed to {@link substituteVariables} / {@link resolveTemplateString}.
 *
 * - With the i18n plugin (`scope.variableResolver`): resolves each key in the
 *   active language, falling back through the chain (tenant filtered).
 * - Otherwise: a plain load, filtered by `scope.variables?.where` (the
 *   multi-tenant per-tenant partition; unfiltered when no scoping plugin is on).
 */
export async function loadVariables(
  db: DrizzleInstance,
  scope?: ResolvedScope,
): Promise<Map<string, string>> {
  if (scope?.variableResolver) {
    return scope.variableResolver.load(db, scope.variables?.insertColumns);
  }
  const rows = await db
    .select({ key: variables.key, value: variables.value })
    .from(variables)
    .where(scope?.variables?.where);
  return new Map(rows.map((r) => [r.key, r.value]));
}

/**
 * Replaces {{key}} patterns in all string properties of a single node.
 * Returns a new properties object (does not mutate the original).
 */
function substituteInProperties(
  properties: Record<string, unknown>,
  vars: Map<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'string') {
      VAR_PATTERN.lastIndex = 0;
      if (VAR_PATTERN.test(value)) {
        VAR_PATTERN.lastIndex = 0;
        result[key] = value.replace(
          VAR_PATTERN,
          (_, varKey) => vars.get(varKey) ?? `{{${varKey}}}`,
        );
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * A resolved reference inlined into a block property (read path): carries the
 * target's `properties` (the typed convenience copy, read for data-only refs)
 * AND its `tree`, plus — for an embedded block under a running A/B test — an
 * `abTest.variants[]` of the same shape. Narrowed structurally (no value import).
 */
type EmbeddedSnapshot = {
  properties: Record<string, unknown>;
  tree: BlockTreeNode;
};
type EmbeddedReference = EmbeddedSnapshot & {
  abTest?: { variants: EmbeddedSnapshot[] };
};

function isEmbeddedReference(value: unknown): value is EmbeddedReference {
  return (
    value != null &&
    typeof value === 'object' &&
    'tree' in value &&
    'properties' in value
  );
}

/**
 * Substitute the snapshot's tree in place, then re-alias its `properties` to the
 * substituted root props. `properties` and `tree.properties` start as the same
 * object, but `substituteVariables` reassigns `tree.properties` to a fresh
 * object — re-aliasing keeps the typed copy and the tree consistent.
 */
function substituteSnapshot(
  snapshot: EmbeddedSnapshot,
  vars: Map<string, string>,
): void {
  substituteVariables(snapshot.tree, vars);
  snapshot.properties = snapshot.tree.properties;
}

/**
 * Recursively walks a block tree and substitutes {{key}} patterns
 * in all string properties with values from the variables map.
 * Mutates the tree nodes in place for performance.
 *
 * Descends into resolved references embedded in a node's properties — the
 * inlined target tree AND, for a running-test block, every A/B variant subtree
 * — so embedded content (control and variants alike) gets the same substitution
 * as the host page. The resolved tree is finite (references are inlined, cyclic
 * ones stay raw strings), so this terminates without a separate cycle guard.
 */
export function substituteVariables(
  tree: BlockTreeNode,
  vars: Map<string, string>,
): void {
  if (vars.size === 0) return;

  tree.properties = substituteInProperties(tree.properties, vars);
  for (const value of Object.values(tree.properties)) {
    if (!isEmbeddedReference(value)) continue;
    substituteSnapshot(value, vars);
    if (value.abTest) {
      for (const variant of value.abTest.variants) {
        substituteSnapshot(variant, vars);
      }
    }
  }
  for (const child of tree.children) {
    substituteVariables(child, vars);
  }
}

/**
 * Resolves a template string by replacing {{key}} patterns with variable values.
 */
export function resolveTemplateString(
  template: string,
  vars: Map<string, string>,
): string {
  VAR_PATTERN.lastIndex = 0;
  return template.replace(
    VAR_PATTERN,
    (_, varKey) => vars.get(varKey) ?? `{{${varKey}}}`,
  );
}

/**
 * Inserts content_usages variable rows for newly-created block versions, within the same
 * transaction that created them. Insert-only and keyed by the immutable
 * blockVersionId — the version-keyed counterpart of
 * insertAssetReferencesForVersions; see its doc for why this replaces the old
 * branch-blind delete-then-reinsert. MUST be called at every block-version
 * insert site (variable keys are free text, so there is no FK to validate).
 */
export async function insertVariableUsagesForVersions(
  tx: DrizzleInstance,
  rootId: string,
  versions: VersionToIndex[],
): Promise<void> {
  const rows: {
    id: string;
    targetKind: 'variable';
    targetKey: string;
    blockVersionId: string;
    rootId: string;
    blockId: string;
    propertyKey: string;
  }[] = [];

  for (const version of versions) {
    const extracted = extractVariableKeysFromProperties(version.properties);
    for (const [propKey, varKeys] of extracted) {
      for (const varKey of varKeys) {
        rows.push({
          id: newId('contentUsage'),
          targetKind: 'variable',
          targetKey: varKey,
          blockVersionId: version.blockVersionId,
          rootId,
          blockId: version.blockId,
          propertyKey: propKey,
        });
      }
    }
  }

  if (rows.length > 0) {
    await tx.insert(contentUsages).values(rows).onConflictDoNothing();
  }
}

/**
 * Fast existence check — returns true if the variable is referenced by live
 * content (a non-deleted block version in some non-archived branch head) or by
 * any template. Authoritative + branch-correct, like the asset liveness check.
 */
export async function isVariableInUse(
  db: DrizzleInstance,
  variableKey: string,
  scope?: ResolvedScope,
): Promise<boolean> {
  // Tenant-scoped (language excluded): with i18n fallback a value can be
  // rendered by any language that lacks its own override, so "in use" spans
  // languages within the tenant — conservative and safe for the delete guard.
  const tenantConds = rootScopeConditions(crossScopeColumns(scope?.roots));
  const [blockHit, templateHit] = await Promise.all([
    db
      .select({ id: contentUsages.id })
      .from(contentUsages)
      .innerJoin(
        commitSnapshots,
        eq(commitSnapshots.blockVersionId, contentUsages.blockVersionId),
      )
      .innerJoin(branches, eq(branches.headCommitId, commitSnapshots.commitId))
      .innerJoin(roots, eq(roots.id, branches.rootId))
      .innerJoin(
        blockVersions,
        eq(blockVersions.id, contentUsages.blockVersionId),
      )
      .where(
        and(
          eq(contentUsages.targetKind, 'variable'),
          eq(contentUsages.targetKey, variableKey),
          isNull(roots.archivedAt),
          eq(blockVersions.deleted, false),
          ...tenantConds,
        ),
      )
      .limit(1),
    // Template usage is intentionally NOT scope-filtered: templateVariableUsages
    // carries no tenant/language column, so this is conservative (a key used by
    // any template, in any scope, blocks the delete). Safe (over-blocks, never
    // under-blocks); a precise per-scope template guard would need the column.
    db
      .select({ id: templateVariableUsages.id })
      .from(templateVariableUsages)
      .where(eq(templateVariableUsages.variableKey, variableKey))
      .limit(1),
  ]);
  return blockHit.length > 0 || templateHit.length > 0;
}

/**
 * Full usage details for a variable — used by the dedicated usages endpoint.
 * Block usages are the distinct live (rootId, blockId, propertyKey) tuples in
 * branch heads; template usages are unchanged.
 */
export async function getVariableUsageDetails(
  db: DrizzleInstance,
  variableKey: string,
  scope?: ResolvedScope,
): Promise<{
  blockUsageCount: number;
  templateUsageCount: number;
  blockUsages: { rootId: string; blockId: string; propertyKey: string }[];
  templateUsages: {
    templateId: string;
    collection: string;
    blockType: string;
    propertyKey: string;
  }[];
}> {
  const [blockRows, templateRows] = await Promise.all([
    db
      .selectDistinct({
        rootId: roots.id,
        blockId: contentUsages.blockId,
        propertyKey: contentUsages.propertyKey,
      })
      .from(contentUsages)
      .innerJoin(
        commitSnapshots,
        eq(commitSnapshots.blockVersionId, contentUsages.blockVersionId),
      )
      .innerJoin(branches, eq(branches.headCommitId, commitSnapshots.commitId))
      .innerJoin(roots, eq(roots.id, branches.rootId))
      .innerJoin(
        blockVersions,
        eq(blockVersions.id, contentUsages.blockVersionId),
      )
      .where(
        and(
          eq(contentUsages.targetKind, 'variable'),
          eq(contentUsages.targetKey, variableKey),
          isNull(roots.archivedAt),
          eq(blockVersions.deleted, false),
          ...rootScopeConditions(crossScopeColumns(scope?.roots)),
        ),
      ),
    db
      .select({
        templateId: templateVariableUsages.templateId,
        collection: templates.collection,
        blockType: templates.blockType,
        propertyKey: templates.propertyKey,
      })
      .from(templateVariableUsages)
      .innerJoin(templates, eq(templates.id, templateVariableUsages.templateId))
      .where(eq(templateVariableUsages.variableKey, variableKey)),
  ]);

  return {
    blockUsageCount: blockRows.length,
    templateUsageCount: templateRows.length,
    blockUsages: blockRows,
    templateUsages: templateRows,
  };
}

/**
 * Finds all published roots whose LIVE content (the published branch's head)
 * uses a specific variable. Used for targeted revalidation when a variable
 * value changes. Version-keyed so it follows the actual served head, not a
 * branch-blind index.
 */
export async function findPublishedRootsUsingVariable(
  db: DrizzleInstance,
  variableKey: string,
  scope?: ResolvedScope,
): Promise<
  {
    rootId: string;
    branchId: string;
    collection: string;
    slug: string | null;
  }[]
> {
  const rows = await db
    .selectDistinct({
      rootId: roots.id,
      branchId: branches.id,
      collection: roots.collection,
      slug: roots.slug,
    })
    .from(contentUsages)
    .innerJoin(
      commitSnapshots,
      eq(commitSnapshots.blockVersionId, contentUsages.blockVersionId),
    )
    .innerJoin(branches, eq(branches.headCommitId, commitSnapshots.commitId))
    .innerJoin(publications, eq(publications.branchId, branches.id))
    .innerJoin(roots, eq(roots.id, branches.rootId))
    .innerJoin(
      blockVersions,
      eq(blockVersions.id, contentUsages.blockVersionId),
    )
    .where(
      and(
        eq(contentUsages.targetKind, 'variable'),
        eq(contentUsages.targetKey, variableKey),
        isNull(roots.archivedAt),
        eq(blockVersions.deleted, false),
        // Tenant-scoped (language excluded): a base-language value change can
        // affect fallback consumers in any language within the tenant.
        ...rootScopeConditions(crossScopeColumns(scope?.roots)),
      ),
    );

  return rows.map((row) => ({
    ...row,
    slug: row.slug ?? null,
  }));
}
