import { and, eq, type SQL } from 'drizzle-orm';

import type { ResolvedScope } from './types/definitions';
import type { DrizzleInstance } from './types/drizzle';

import { templates } from './db/schema.generated';
import { loadVariables, resolveTemplateString } from './variables';

/**
 * Loads the RAW template strings for a `(collection, blockType)` pair within the
 * active scope as a `propertyKey -> template string` map (empty when none apply).
 *
 * Used by createBlock to seed a new block's missing properties: the raw string
 * (which may contain `{{variable}}` placeholders) is stored as-is, so embedded
 * variables stay LIVE and resolve at read time like any other content — not
 * frozen at creation. Pass the active `scope.templates?.where` so multi-tenant /
 * i18n only see their own (tenant/language) templates, and the active `tx` as
 * `exec` so it shares the transaction.
 */
export async function loadTemplateStrings(
  exec: DrizzleInstance,
  collection: string,
  blockType: string,
  scopeWhere?: SQL,
): Promise<Record<string, string>> {
  const rows = await exec
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.collection, collection),
        eq(templates.blockType, blockType),
        scopeWhere,
      ),
    );
  const out: Record<string, string> = {};
  for (const row of rows) out[row.propertyKey] = row.template;
  return out;
}

/**
 * Like {@link loadTemplateStrings} but with `{{variable}}` placeholders already
 * substituted against the active scope's variables — for the `getTemplateDefaults`
 * route that prefills the editor UI (which wants the resolved display value).
 */
export async function resolveTemplateDefaults(
  exec: DrizzleInstance,
  collection: string,
  blockType: string,
  scope?: ResolvedScope,
): Promise<Record<string, string>> {
  const strings = await loadTemplateStrings(
    exec,
    collection,
    blockType,
    scope?.templates?.where,
  );
  const keys = Object.keys(strings);
  if (keys.length === 0) return {};

  const vars = await loadVariables(exec, scope);
  const defaults: Record<string, string> = {};
  for (const key of keys) {
    defaults[key] = resolveTemplateString(strings[key], vars);
  }
  return defaults;
}
