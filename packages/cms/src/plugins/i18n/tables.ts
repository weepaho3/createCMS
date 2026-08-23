import { pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

const cms = pgSchema('cms');

/**
 * Typed Drizzle handle for the `cms.roots` columns the i18n resolver queries,
 * including the plugin-owned `language` + `translation_key`, which the core
 * generated `roots` object does not carry (they are contributed only by
 * `i18nSchema`'s add-only merge). Drizzle permits multiple table objects over
 * one physical table; this is the i18n plugin's typed view for resolution
 * queries, not a schema source (migrations come from `i18nSchema`).
 */
export const i18nRoots = cms.table('roots', {
  id: text('id').primaryKey(),
  collection: text('collection').notNull(),
  archivedAt: timestamp('archived_at'),
  language: text('language').notNull(),
  translationKey: text('translation_key').notNull(),
});

/**
 * Typed view for the variable resolver: `cms.variables` plus the plugin-owned
 * `language` column. Used to load `(key, value)` across a language fallback
 * chain so the active language wins and missing values fall back. See
 * {@link i18nRoots} for why this is a separate typed handle, not a schema source.
 */
export const i18nVariables = cms.table('variables', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  language: text('language').notNull(),
});
