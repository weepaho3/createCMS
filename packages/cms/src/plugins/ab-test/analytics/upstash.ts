import { sql } from 'drizzle-orm';

import type { TableDefinition } from '../../../core/db/types';
import type { DrizzleInstance } from '../../../core/types';
import type {
  AbTestAnalyticsAdapter,
  AggregatedResults,
  AggregatedVariantResult,
  AnalyticsEvent,
  UpstashAnalyticsOptions,
} from './types';

import { newId } from '../../../utils/nanoid';

// Prevent Turbopack/webpack from statically analyzing this import.
// The bundler rewrites bare `import('...')` calls into require/resolve
// that fail when the package lives in a different workspace. By
// constructing the specifier at runtime the import stays a true
// dynamic import that Node resolves at execution time.
const _upstashRedisId = ['@upstash', 'redis'].join('/');
const _importUpstashRedis = () =>
  new Function('id', 'return import(id)')(_upstashRedisId) as Promise<any>;

const aggregationsTable: TableDefinition = {
  tableName: 'ab_test_aggregations',
  indexPrefix: 'aba',
  columns: {
    id: {
      type: 'text',
      primaryKey: true,
      defaultId: true,
      defaultIdPrefix: 'abTestAgg',
    },
    testId: {
      type: 'text',
      notNull: true,
      references: { table: 'abTests', column: 'id', onDelete: 'cascade' },
    },
    variantId: {
      type: 'text',
      notNull: true,
      references: {
        table: 'abTestVariants',
        column: 'id',
        onDelete: 'cascade',
      },
    },
    eventType: { type: 'text', notNull: true },
    count: {
      type: 'integer',
      notNull: true,
      default: { kind: 'literal', value: 0 },
    },
    uniqueVisitors: {
      type: 'integer',
      notNull: true,
      default: { kind: 'literal', value: 0 },
    },
    periodStart: { type: 'timestamp', notNull: true },
    periodEnd: { type: 'timestamp', notNull: true },
    updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
  },
  indexes: {
    testPeriodIdx: { columns: ['testId', 'periodStart'] },
    uniqueBucketIdx: {
      columns: ['testId', 'variantId', 'eventType', 'periodStart'],
      unique: true,
    },
  },
};

/**
 * Upstash Redis Stream adapter for durable A/B event storage with batch flush.
 *
 * Requires `@upstash/redis` as a peer dependency. Events are stored in Redis
 * Streams and flushed to Postgres on demand. Live result deltas are NOT this
 * adapter's concern — the `trackEvent` endpoint publishes them over the shared
 * core realtime transport (see `publishLiveDelta`), so they work with any
 * analytics adapter.
 */
export function upstashAnalytics(
  options: UpstashAnalyticsOptions,
): AbTestAnalyticsAdapter {
  let db: DrizzleInstance;
  let redis: any;

  const adapter: AbTestAnalyticsAdapter = {
    tables: { abTestAggregations: aggregationsTable } satisfies Record<
      string,
      TableDefinition
    >,

    async init(instance) {
      db = instance;

      const upstashRedis = await _importUpstashRedis();
      redis = new upstashRedis.Redis({
        url: options.url,
        token: options.token,
      });
    },

    async track(event: AnalyticsEvent) {
      // The Upstash adapter is the A/B-dashboard sink: it streams per-test
      // events (keyed by testId) for live deltas + flush-to-aggregations, and
      // it does NOT provision an ab_test_events table. A non-A/B analytics
      // event (no `ab`) therefore has no durable home in this adapter and is
      // DROPPED — there is no other sink to catch it until the M3 event-bus
      // ships (see AB_MEASUREMENT_DESIGN §9 carry-forward). Make the drop loud
      // rather than silent so a single-sink upstash deployment can see it.
      if (!event.ab) {
        console.warn(
          `[cms] upstashAnalytics dropped a non-A/B event ("${event.name}"): this A/B-realtime adapter has no durable store for non-A/B events. Use the postgres adapter (or wait for the M3 event-bus) to persist page_view / form_submit events.`,
        );
        return;
      }
      const { testId, variantId } = event.ab;

      const streamKey = `ab:events:${testId}`;
      const entry: Record<string, string> = {
        testId,
        variantId,
        visitorId: event.visitorId ?? '',
        anonymous: String(event.anonymous),
        eventType: event.name,
        timestamp: event.timestamp.toISOString(),
      };
      if (event.metadata) {
        entry.metadata = JSON.stringify(event.metadata);
      }

      await redis.xadd(streamKey, '*', entry);
      // Live result deltas are published by the trackEvent endpoint via the
      // shared core realtime transport (see publishLiveDelta) — not here. This
      // adapter only owns durable event storage.
    },

    async query(testId, options) {
      const fromClause = options?.from
        ? sql` AND a.period_start >= ${options.from}`
        : sql``;
      const toClause = options?.to
        ? sql` AND a.period_end <= ${options.to}`
        : sql``;

      const rows = (await db.execute(sql`
        SELECT
          a.variant_id,
          v.name AS variant_name,
          a.event_type,
          SUM(a.count)::int AS count,
          SUM(a.unique_visitors)::int AS unique_visitors
        FROM cms.ab_test_aggregations a
        INNER JOIN cms.ab_test_variants v ON v.id = a.variant_id
        WHERE a.test_id = ${testId}
          ${fromClause}
          ${toClause}
        GROUP BY a.variant_id, v.name, a.event_type
        ORDER BY a.variant_id, a.event_type
      `)) as {
        rows: Array<{
          variant_id: string;
          variant_name: string;
          event_type: string;
          count: number;
          unique_visitors: number;
        }>;
      };

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
            // The upstash pre-aggregate flush does not track interaction ids, so
            // the funnel (attempts/completionRate) is the postgres path only.
            attempts: 0,
            completionRate: 0,
            eventBreakdown: {},
          };
          variantMap.set(row.variant_id, v);
        }

        v.eventBreakdown[row.event_type] = {
          count: row.count,
          uniqueVisitors: row.unique_visitors,
          distinctInteractions: 0,
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

    async flush(testId) {
      const streamKeys: string[] = [];

      if (testId) {
        streamKeys.push(`ab:events:${testId}`);
      } else {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, {
            match: 'ab:events:*',
            count: 100,
          });
          cursor = nextCursor;
          streamKeys.push(...keys);
        } while (cursor !== '0');
      }

      let totalFlushed = 0;

      for (const streamKey of streamKeys) {
        const cursorKey = `ab:cursor:${streamKey}`;
        const lastId = (await redis.get(cursorKey)) ?? '0-0';

        const results = await redis.xread(
          [{ key: streamKey, id: lastId as string }],
          { count: 10000 },
        );

        if (!results || results.length === 0) continue;

        const stream = results[0];
        if (!stream || !stream.messages || stream.messages.length === 0)
          continue;

        const agg = new Map<string, { count: number; visitors: Set<string> }>();

        let maxId = lastId as string;
        for (const msg of stream.messages) {
          maxId = msg.id;
          const d = msg.message as Record<string, string>;
          const key = `${d.testId}:${d.variantId}:${d.eventType}`;
          let bucket = agg.get(key);
          if (!bucket) {
            bucket = { count: 0, visitors: new Set() };
            agg.set(key, bucket);
          }
          bucket.count++;
          bucket.visitors.add(d.visitorId);
        }

        const now = new Date();
        const periodStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        const periodEnd = new Date(periodStart.getTime() + 86400000);

        for (const [key, bucket] of agg) {
          const [tId, variantId, eventType] = key.split(':');
          const id = newId('abTestAgg');

          await db.execute(sql`
            INSERT INTO cms.ab_test_aggregations
              (id, test_id, variant_id, event_type, count, unique_visitors, period_start, period_end, updated_at)
            VALUES
              (${id}, ${tId}, ${variantId}, ${eventType}, ${bucket.count}, ${bucket.visitors.size}, ${periodStart}, ${periodEnd}, NOW())
            ON CONFLICT (test_id, variant_id, event_type, period_start) DO UPDATE SET
              count = cms.ab_test_aggregations.count + EXCLUDED.count,
              unique_visitors = GREATEST(cms.ab_test_aggregations.unique_visitors, EXCLUDED.unique_visitors),
              updated_at = NOW()
          `);

          totalFlushed += bucket.count;
        }

        await redis.set(cursorKey, maxId);
        await redis.xtrim(streamKey, { strategy: 'MINID', threshold: maxId });
      }

      return { flushed: totalFlushed };
    },
  };

  return adapter;
}
