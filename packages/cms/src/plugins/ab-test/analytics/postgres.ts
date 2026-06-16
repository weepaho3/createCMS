import { sql } from 'drizzle-orm';

import type { DrizzleInstance } from '../../../core/types';
import type {
  ABTestAnalyticsAdapter,
  AggregatedResults,
  AggregatedVariantResult,
  CMSEvent,
} from './types';

import { newId } from '../../../utils/nanoid';
import { defaultAdapterTables } from '../schema';

export function postgresAnalytics(): ABTestAnalyticsAdapter {
  let db: DrizzleInstance;

  return {
    tables: defaultAdapterTables,

    init(instance) {
      db = instance;
    },

    async track(event: CMSEvent) {
      // Mint when no usable id is supplied. Guard against a blank id too: `??`
      // would let "" through and a second "" would be swallowed by ON CONFLICT,
      // silently dropping a distinct event.
      const id =
        event.id && event.id.length > 0 ? event.id : newId('abTestEvent');
      await db.execute(sql`
        INSERT INTO cms.ab_test_events
          (id, test_id, variant_id, visitor_id, event_type, source_handle, source_type, interaction_id, metadata, created_at)
        VALUES (
          ${id},
          ${event.ab?.testId ?? null},
          ${event.ab?.variantId ?? null},
          ${event.visitorId ?? null},
          ${event.name},
          ${event.source?.handle ?? null},
          ${event.source?.type ?? null},
          ${event.interactionId ?? null},
          ${event.metadata ? sql`${JSON.stringify(event.metadata)}::jsonb` : sql`NULL`},
          ${event.timestamp}
        )
        ON CONFLICT (id) DO NOTHING
      `);
    },

    async query(testId, options) {
      const fromClause = options?.from
        ? sql` AND e.created_at >= ${options.from}`
        : sql``;
      const toClause = options?.to
        ? sql` AND e.created_at <= ${options.to}`
        : sql``;

      const rows = (await db.execute(sql`
        SELECT
          e.variant_id,
          v.name AS variant_name,
          e.event_type,
          COUNT(*)::int AS count,
          COUNT(DISTINCT e.visitor_id)::int AS unique_visitors,
          COUNT(DISTINCT e.interaction_id)::int AS distinct_interactions
        FROM cms.ab_test_events e
        INNER JOIN cms.ab_test_variants v ON v.id = e.variant_id
        WHERE e.test_id = ${testId}
          ${fromClause}
          ${toClause}
        GROUP BY e.variant_id, v.name, e.event_type
        ORDER BY e.variant_id, e.event_type
      `)) as {
        rows: Array<{
          variant_id: string;
          variant_name: string;
          event_type: string;
          count: number;
          unique_visitors: number;
          distinct_interactions: number;
        }>;
      };

      // Funnel attempts per variant: total distinct interaction ids (one per
      // <TrackedForm> submit). NOT a sum of per-event distincts — an interaction
      // appears in both its attempt + success legs, so it must be counted once.
      const attemptRows = (await db.execute(sql`
        SELECT e.variant_id, COUNT(DISTINCT e.interaction_id)::int AS attempts
        FROM cms.ab_test_events e
        WHERE e.test_id = ${testId}
          AND e.interaction_id IS NOT NULL
          ${fromClause}
          ${toClause}
        GROUP BY e.variant_id
      `)) as { rows: Array<{ variant_id: string; attempts: number }> };
      const attemptsByVariant = new Map(
        attemptRows.rows.map((r) => [r.variant_id, r.attempts]),
      );

      const variantMap = new Map<string, AggregatedVariantResult>();

      for (const row of rows.rows) {
        let v = variantMap.get(row.variant_id);
        if (!v) {
          v = {
            variantId: row.variant_id,
            variantName: row.variant_name,
            impressions: 0,
            conversions: 0,
            uniqueVisitors: 0,
            conversionRate: 0,
            attempts: attemptsByVariant.get(row.variant_id) ?? 0,
            completionRate: 0,
            eventBreakdown: {},
          };
          variantMap.set(row.variant_id, v);
        }

        v.eventBreakdown[row.event_type] = {
          count: row.count,
          uniqueVisitors: row.unique_visitors,
          distinctInteractions: row.distinct_interactions,
        };

        if (row.event_type === 'impression') {
          v.impressions = row.count;
          v.uniqueVisitors = row.unique_visitors;
        } else if (row.event_type === 'conversion') {
          v.conversions = row.count;
        }
      }

      const variants = [...variantMap.values()];
      for (const v of variants) {
        v.conversionRate =
          v.impressions > 0
            ? Math.round((v.conversions / v.impressions) * 10000) / 100
            : 0;
      }

      return {
        testId,
        variants,
        totalImpressions: variants.reduce((s, v) => s + v.impressions, 0),
        totalConversions: variants.reduce((s, v) => s + v.conversions, 0),
      } satisfies AggregatedResults;
    },
  };
}
