# A/B Testing Plugin

Content experiments for `@createcms/core`. Assigns visitors to branch variants deterministically, records impressions and conversions from block [events](/docs/concepts/events-tracking), and forwards aggregated results to pluggable analytics. Ships a server half and a client half.

> ⚠️ **Work in progress — not production-ready.** Part of [createCMS](https://github.com/weepaho3/createCMS), which is pre-1.0 and has **not been tested in production**. APIs may change.

See [`/docs/plugins/ab-test`](/docs/plugins/ab-test) for the full guide; this README is a concise map.

## Installation

Included in `@createcms/core`. Register the server plugin, regenerate + migrate the schema (it adds the `ab_tests`, `ab_test_variants`, and `ab_test_events` tables), then add the client plugin.

```ts
// lib/cms.ts
import { createCMS } from '@createcms/core';
import { abTest } from '@createcms/core/plugins/ab-test';

export const cms = createCMS({ db, collections, media, plugins: [abTest()] });
```

```ts
// lib/cms-client.ts
import { createCMSClient } from '@createcms/core/react';
import { abTestClient } from '@createcms/core/plugins/ab-test/client';

export const cmsClient = createCMSClient<typeof cms>()({
  baseURL: '/api/cms',
  plugins: [abTestClient()],
});
```

## Usage

The client plugin adds an `abTest` namespace. Record the impression for the variant a visitor was served, read their assignment, and manage consent:

```tsx
cmsClient.abTest.useImpression(testId, branchId); // fire once on mount
const { variantId, branchId } = await cmsClient.abTest.getVariant(testId);
cmsClient.abTest.setConsent({ analytics_storage: 'granted' });
```

| Action                      | Signature                                         | Purpose                                |
| --------------------------- | ------------------------------------------------- | -------------------------------------- |
| `recordImpression`          | `(testId, branchId) => void`                      | Record that a variant was shown.       |
| `useImpression`             | `(testId, branchId) => void`                      | React-hook form of `recordImpression`. |
| `getVariant`                | `(testId) => Promise<{ variantId, branchId, … }>` | Read the visitor's assignment.         |
| `dispatchEvent`             | `(event) => void`                                 | Fire a client event through the sinks. |
| `setConsent` / `getConsent` | Consent Mode v2 signals                           | Gate analytics forwarding on consent.  |
| `identify` / `reset`        | visitor context                                   | Set or clear the visitor key.          |

Impressions and the anonymous A/B aggregate leg are consent-free; the GA4/`dataLayer` forwarding leg is gated on `analytics_storage`.

## Server endpoints

The plugin registers ten endpoints under the `abTest` namespace — reachable as `cms.api.abTest.<name>` on the server and `client.abTest.<name>` on the client, each fully typed through `typeof cms`.

| Endpoint         | Method | Input                                                                          | Returns                           |
| ---------------- | ------ | ------------------------------------------------------------------------------ | --------------------------------- |
| `createTest`     | POST   | `rootId`, `collection`, `name`, `variants`, `trafficPercentage?`, `goal*?`     | `{ testId }`                      |
| `updateTest`     | POST   | `testId` + optional `name`, `status`, `trafficPercentage`, `goal*`, `variants` | `{ testId }`                      |
| `deleteTest`     | POST   | `testId`                                                                       | `{ testId }`                      |
| `getTest`        | GET    | `testId`                                                                       | Test with its `variants`          |
| `listTests`      | GET    | `collection?`, `status?`, `limit?`, `offset?`                                  | `{ tests, total, hasMore }`       |
| `listGoalEvents` | GET    | `rootId`                                                                       | `{ rootId, goals }`               |
| `assignVariant`  | POST   | `testId`, `context`                                                            | `{ variantId, branchId, inTest }` |
| `trackEvent`     | POST   | `eventType` + optional `testId`/`variantId`/`branchId`/`visitorId`/`consent`/… | `{}`                              |
| `getResults`     | GET    | `testId`, `from?`, `to?`                                                       | `AggregatedResults`               |
| `flushEvents`    | POST   | `testId?`                                                                      | Adapter flush result              |

`variants` needs ≥ 2 entries whose `weight` values sum to 100, exactly one flagged `isControl`, each on an already-published branch. `updateTest` follows the status machine `draft → running`, `running → paused`/`completed`, `paused → running`/`completed`. `trackEvent` is the public ingest (a distinct `abTestEvent` permission resource, so it can be opened to anonymous visitors).

## Architecture / layer map

Assignment and edge routing are split into a **strictly one-way** stack: each layer imports only from the one above it (verified from the source headers), so the pure bucketer stays framework-free and every non-Next runtime reuses the same core.

```
plugins/ab-test/assignment.ts   pure resolveVariant() — MurmurHash3 bucketing, no deps
        │  (contextKey + testId → deterministic bucket → variant)
        ▼
ab-edge/index.ts                framework-agnostic edge core ("Pattern A")
        │  decideEdgeVariant / variantRewritePath — rewrites to /<prefix>/<code>…
        ▼
next/middleware.ts              THIN Next adapter over @createcms/core/ab-edge
        │  (NextRequest cookies + NextResponse.rewrite only)
        ▼
render side  ──►  react/variant.ts     pickVariant() — picks the tree from the URL branch code
             └─►  react/tracking.tsx    'use client' <BlockTracker> — fires declared block events
```

`resolveVariant` is a pure murmur-hash bucketer: `contextKey + ':' + testId` hashes to a `0–9999` bucket, gated by `trafficPercentage`, then split across id-sorted variant weights — so the same visitor + test always lands on the same variant with no DB write. `ab-edge` wraps that into the Vercel-style always-rewrite decision; `next/middleware` is the ~20-line Next binding; the render side reads the coded URL segment back (`pickVariant`) and `BlockTracker` fires the impression/conversion events that feed `trackEvent`.

Export subpaths:

| Subpath                                             | Layer                                                 |
| --------------------------------------------------- | ----------------------------------------------------- |
| `@createcms/core/plugins/ab-test`                   | server plugin (`abTest`)                              |
| `@createcms/core/plugins/ab-test/client`            | client plugin (`abTestClient`)                        |
| `@createcms/core/plugins/ab-test/live`              | `useLiveResults` (pulls optional `@upstash/realtime`) |
| `@createcms/core/plugins/ab-test/analytics/upstash` | Upstash analytics adapter                             |
| `@createcms/core/ab-edge`                           | framework-agnostic edge core                          |
| `@createcms/core/next/middleware`                   | Next.js edge adapter                                  |
| `@createcms/core/react/variant`                     | render-side `pickVariant`                             |
| `@createcms/core/react/tracking`                    | `'use client'` `BlockTracker` runtime                 |

## Options

### Server — `abTest(options)`

| Option      | Type                     | Default               | Description                                      |
| ----------- | ------------------------ | --------------------- | ------------------------------------------------ |
| `analytics` | `AbTestAnalyticsAdapter` | `postgresAnalytics()` | Where events are stored / forwarded.             |
| `ga4`       | `Ga4ServerConfig`        | --                    | Server-side GA4 Measurement Protocol forwarding. |
| `rateLimit` | `AbTestRateLimitOptions` | --                    | Rate-limit the anonymous `trackEvent` ingest.    |

### Client — `abTestClient(options)`

| Option                 | Type      | Default | Description                                                                                  |
| ---------------------- | --------- | ------- | -------------------------------------------------------------------------------------------- |
| `disableDataLayerSink` | `boolean` | `false` | Drop the browser `dataLayer` leg when GA4 is forwarded server-side (avoids double-counting). |

## Live results

`useLiveResults` streams result deltas to the dashboard over the public `ab:live:<testId>` channel, riding the shared [`RealtimeProvider`](/docs/concepts/realtime) connection. Live delivery is decoupled from the storage adapter — it needs [`realtime`](/docs/reference/configuration#realtime) configured on the server; without it, the SSR `initial` snapshot (plus any `getResults` reconcile) stands.
