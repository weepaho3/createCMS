import { pgSchema, text, timestamp } from 'drizzle-orm/pg-core';

const cms = pgSchema('cms');

/**
 * Typed Drizzle handle for the `cms.roots` columns the i18n resolver queries,
 * INCLUDING the plugin-owned `language` + `translation_key` — which the core
 * generated `roots` object does NOT carry (they are contributed only by
 * `i18nSchema`'s add-only merge). Drizzle permits multiple table objects over
 * one physical table; this is the i18n plugin's typed VIEW for resolution
 * queries. It is NOT a schema source — migrations come from `i18nSchema`.
 */
export const i18nRoots = cms.table('roots', {
  id: text('id').primaryKey(),
  collection: text('collection').notNull(),
  archivedAt: timestamp('archived_at'),
  language: text('language').notNull(),
  translationKey: text('translation_key').notNull(),
});
