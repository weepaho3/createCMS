'use client';

import { createRealtime } from '@upstash/realtime/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as z from 'zod';

import type { AggregatedResults, LiveDelta } from './analytics/types';

// Local wire schema for the `delta` event; types the live subscription.
const liveDeltaSchema = z.object({
  variantId: z.string(),
  eventType: z.string(),
  count: z.literal(1), // each live delta is a single event (matches LiveDelta)
  timestamp: z.number(),
});

const { useRealtime } = createRealtime<{ delta: typeof liveDeltaSchema }>();

export type UseLiveResultsOptions = {
  testId: string;
  /** The SSR/initial absolute aggregate (from `getResults`). */
  initial: AggregatedResults;
  /**
   * Re-fetch the absolute aggregate to reconcile on (re)connect, e.g.
   * `() => client.abTest.getResults({ query: { testId } })`. Without it the hook
   * relies on `initial` + live deltas (increments published before the stream
   * connects are then not back-filled).
   */
  getResults?: () => Promise<AggregatedResults>;
};

export type UseLiveResultsResult = {
  results: AggregatedResults;
  isLive: boolean;
};

/**
 * Live A/B dashboard results over the shared {@link RealtimeProvider} connection
 * (public `ab:live:<testId>` channel). Applies `delta` increments live and
 * reconciles against the absolute `getResults` aggregate on each (re)connect.
 * Requires the app to be wrapped in a `RealtimeProvider`; without realtime the
 * stream never connects and `initial` (+ any `getResults` reconcile) stands.
 */
export function useLiveResults({
  testId,
  initial,
  getResults,
}: UseLiveResultsOptions): UseLiveResultsResult {
  const [results, setResults] = useState<AggregatedResults>(initial);

  const applyDelta = useCallback((delta: LiveDelta) => {
    setResults((prev) => {
      // Conversions count the test's GOAL event (the same rule getResults uses);
      // 'conversion' is the goal-less default.
      const goalEvent = prev.goalEvent ?? 'conversion';
      const variants = prev.variants.map((v) => {
        if (v.variantId !== delta.variantId) return v;
        const updated = { ...v };
        if (delta.eventType === 'impression') {
          updated.impressions += delta.count;
        }
        if (delta.eventType === goalEvent) {
          updated.conversions += delta.count;
        }
        const breakdown = { ...updated.eventBreakdown };
        const entry = breakdown[delta.eventType] ?? {
          count: 0,
          uniqueVisitors: 0,
          distinctInteractions: 0,
        };
        breakdown[delta.eventType] = {
          count: entry.count + delta.count,
          uniqueVisitors: entry.uniqueVisitors,
          // Live deltas don't carry interaction ids; the funnel refreshes on the
          // next getResults reconcile.
          distinctInteractions: entry.distinctInteractions,
        };
        updated.eventBreakdown = breakdown;
        updated.conversionRate =
          updated.impressions > 0
            ? Math.round((updated.conversions / updated.impressions) * 10000) /
              100
            : 0;
        return updated;
      });
      return {
        ...prev,
        variants,
        totalImpressions: variants.reduce((s, v) => s + v.impressions, 0),
        totalConversions: variants.reduce((s, v) => s + v.conversions, 0),
      };
    });
  }, []);

  const reconcile = useCallback(() => {
    getResults?.()
      .then((fresh) => setResults(fresh))
      .catch(() => {});
  }, [getResults]);

  const { status } = useRealtime({
    channels: [`ab:live:${testId}`],
    events: ['delta'],
    onData({ data }) {
      // The lib delivers `data` unvalidated (its wire schema is z.unknown());
      // validate against our schema before applying (defense-in-depth: ab:live
      // is a public channel, and this guards the aggregate against malformed
      // input).
      const parsed = liveDeltaSchema.safeParse(data);
      if (parsed.success) applyDelta(parsed.data);
    },
  });

  // Reconcile on each (re)connect: getResults returns the absolute aggregate, so
  // increments published before the stream connected aren't lost.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (status === 'connected' && prevStatus.current !== 'connected') {
      reconcile();
    }
    prevStatus.current = status;
  }, [status, reconcile]);

  return { results, isLive: status === 'connected' };
}
