import type { coreSchema } from '../../core/db/core-schema';
import type { TableDefinition, TableMap } from '../../core/db/types';
import type { AbTestAnalyticsAdapter } from './analytics/types';

import { definePluginSchema } from '../../core/db/define';

type CoreTables = (typeof coreSchema)['tables'] & TableMap;

const abTestStatus = {
  enumName: 'ab_test_status',
  values: ['draft', 'running', 'paused', 'completed'] as const,
};

const abTests: TableDefinition = {
  tableName: 'ab_tests',
  indexPrefix: 'abt',
  columns: {
    id: {
      type: 'text',
      primaryKey: true,
      defaultId: true,
      defaultIdPrefix: 'abTest',
    },
    rootId: {
      type: 'text',
      notNull: true,
      references: { table: 'roots', column: 'id', onDelete: 'cascade' },
    },
    collection: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    // The chosen conversion goal: the block instance's trackingId (goalHandle)
    // and the resolved wire name (goalEvent, the stored event_type counted as
    // the conversion). Both nullable; a test may run goal-less and measure
    // impressions only until a goal is picked.
    goalHandle: { type: 'text' },
    goalEvent: { type: 'text' },
    status: {
      type: { enum: 'abTestStatus' },
      notNull: true,
      default: { kind: 'literal', value: 'draft' },
    },
    trafficPercentage: {
      type: 'integer',
      notNull: true,
      default: { kind: 'literal', value: 100 },
    },
    startedAt: { type: 'timestamp' },
    endedAt: { type: 'timestamp' },
    createdBy: { type: 'text' },
    createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
    updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
  },
  indexes: {
    rootIdx: { columns: ['rootId'] },
    statusIdx: { columns: ['status'] },
    collectionIdx: { columns: ['collection'] },
  },
};

const abTestVariants: TableDefinition = {
  tableName: 'ab_test_variants',
  indexPrefix: 'abv',
  columns: {
    id: {
      type: 'text',
      primaryKey: true,
      defaultId: true,
      defaultIdPrefix: 'abTestVariant',
    },
    testId: {
      type: 'text',
      notNull: true,
      references: { table: 'abTests', column: 'id', onDelete: 'cascade' },
    },
    branchId: {
      type: 'text',
      notNull: true,
      references: { table: 'branches', column: 'id' },
    },
    name: { type: 'text', notNull: true },
    weight: { type: 'integer', notNull: true },
    isControl: {
      type: 'boolean',
      notNull: true,
      default: { kind: 'literal', value: false },
    },
  },
  indexes: {
    testIdx: { columns: ['testId'] },
  },
};

const coreTables = { abTests, abTestVariants };

export const defaultAdapterTables: Record<string, TableDefinition> = {
  abTestEvents: {
    tableName: 'ab_test_events',
    indexPrefix: 'abe',
    columns: {
      id: {
        type: 'text',
        primaryKey: true,
        defaultId: true,
        defaultIdPrefix: 'abTestEvent',
      },
      // Nullable: non-A/B analytics events (form_submit, page_view) carry no
      // test/variant. A/B events cascade-delete with their test/variant.
      testId: {
        type: 'text',
        references: { table: 'abTests', column: 'id', onDelete: 'cascade' },
      },
      variantId: {
        type: 'text',
        references: {
          table: 'abTestVariants',
          column: 'id',
          onDelete: 'cascade',
        },
      },
      // Nullable: anonymous events store no identifier (the variant comes from
      // the URL or the variant cookie). Only the consent-gated unique-visitor
      // and GA4 paths set it.
      visitorId: { type: 'text' },
      eventType: { type: 'text', notNull: true },
      // Originating functional block instance (the author-assigned trackingId).
      sourceHandle: { type: 'text' },
      sourceType: { type: 'text' },
      // Funnel grouping: shared by the attempt and success legs of one
      // interaction (a form submit). Nullable; most events carry none. Groups,
      // does not dedup.
      interactionId: { type: 'text' },
      metadata: { type: 'jsonb', jsonType: 'Record<string, unknown>' },
      createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
    },
    indexes: {
      testEventIdx: { columns: ['testId', 'eventType'] },
      visitorIdx: { columns: ['testId', 'visitorId'] },
      interactionIdx: { columns: ['testId', 'interactionId'] },
    },
  },
};

export function buildSchema(adapter?: AbTestAnalyticsAdapter) {
  const tables: Record<string, TableDefinition> = {
    ...coreTables,
    ...(adapter?.tables ?? defaultAdapterTables),
  };
  return definePluginSchema<CoreTables>()({
    tables,
    enums: { abTestStatus },
  });
}
