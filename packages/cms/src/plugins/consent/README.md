# Consent Plugin

Google Consent Mode v2 gating for `@createcms/core`. Buffers analytics and A/B side effects until the visitor decides, and gates rendering of embedded third-party content (a YouTube iframe, a map) behind a consent purpose — all on the client, **default-deny** until a CMP signal arrives.

> ⚠️ **Work in progress — not production-ready.** Part of [createCMS](https://github.com/weepaho3/createCMS), which is pre-1.0 and has **not been tested in production**. APIs may change.

See [`/docs/plugins/consent`](https://createcms.dev/docs/plugins/consent) for the full guide.

## Installation

### Server marker

The server plugin is a marker — no schema, endpoints, or hooks. It only registers consent as available; all logic runs on the client.

```ts
import { createCMS } from '@createcms/core';
import { consent } from '@createcms/core/plugins/consent';

export const cms = createCMS({
  db,
  collections,
  media: {
    /* ... */
  },
  plugins: [consent()],
});
```

### Client plugin

```ts
import { createCMSClient } from '@createcms/core/react';
import { consentClient } from '@createcms/core/plugins/consent/client';
import type { cms } from './cms';

export const cmsClient = createCMSClient<typeof cms>({
  baseURL: '/api/cms',
  plugins: [consentClient()],
});
```

## Usage

Set and read consent through the `consent` namespace. The four signals follow Consent Mode v2:

```ts
cmsClient.consent.setConsent({ analytics_storage: 'granted', ad_storage: 'denied' });
cmsClient.consent.isGranted('analytics_storage'); // boolean
```

| Action            | Signature                                         | Description                                                                  |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `setConsent`      | `(consent: Partial<ConsentState>) => void`        | Apply a real decision (treated like a Consent Mode `update`).                |
| `getConsent`      | `() => ConsentState`                              | Read the current state.                                                       |
| `isGranted`       | `(purpose: ConsentPurpose) => boolean`            | Check one purpose.                                                            |
| `isResolved`      | `() => boolean`                                   | `true` once a real decision arrived or the wait-window elapsed.              |
| `onChange`        | `(listener) => () => void`                        | Subscribe to changes; returns an unsubscribe.                                |
| `reset`           | `() => void`                                      | Revoke in-session: back to default-deny. Stays resolved; nothing persisted. |
| `useConsentState` | React hook                                         | Returns `{ state, resolved, isGranted }`, re-rendering on every change.      |
| `ConsentGate`     | `<ConsentGate purpose fallback?>`                 | Render wrapper bound to this client's gate (see below).                      |

### Gate an embed

`ConsentGate` renders its children only once `purpose` is granted, with an optional privacy-friendly fallback (never the third-party embed):

```tsx
const { ConsentGate } = cmsClient.consent;

<ConsentGate purpose="ad_storage" fallback={<p>Accept cookies to view this.</p>}>
  <iframe src="https://www.youtube.com/embed/..." />
</ConsentGate>;
```

## Driving the gate from a CMP

The plugin is CMP-agnostic. On the client it auto-reads Consent Mode v2 commands (`gtag('consent', 'default' | 'update', …)`) off `window.dataLayer`, so any CMP that emits them — Cookiebot, Usercentrics, OneTrust, or [c15t](https://c15t.com) via Google Tag Manager — drives the gate with no extra wiring. Calling `setConsent` from the CMP's update callback is the most reliable path under GTM.

For [c15t](https://c15t.com) — or any setup you'd rather drive explicitly than via `dataLayer` — the `@createcms/core/plugins/consent/c15t` adapter maps c15t's categories to the four signals and pushes the decision into the gate. It has **no `@c15t/*` dependency**, so it works with any c15t version:

```tsx
import { useConsentManager } from '@c15t/react';
import { useC15tConsentBridge } from '@createcms/core/plugins/consent/c15t';
import { cmsClient } from '@/lib/cms-client';

// Render inside c15t's <ConsentManagerProvider>.
export function ConsentBridge() {
  const { consents, hasConsented } = useConsentManager();
  useC15tConsentBridge(cmsClient, { consents, hasConsented });
  return null;
}
```

Default mapping: `measurement` → `analytics_storage`, `marketing` → `ad_storage` / `ad_user_data` / `ad_personalization` (`necessary` / `functionality` / `experience` are ignored). Pass a third argument to override.

## State

`ConsentState` has four signals, each `'granted'` or `'denied'` (default-deny):

| Signal               | Purpose                        |
| -------------------- | ------------------------------ |
| `analytics_storage`  | Analytics cookies and storage. |
| `ad_storage`         | Advertising storage.           |
| `ad_user_data`       | Sending user data for ads.     |
| `ad_personalization` | Ad personalization.            |

The plugin adds no database schema.

## Exports

| Subpath                                   | Contents                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@createcms/core/plugins/consent`         | Server marker `consent()` plus the gate primitives — `createConsentGate`, `parseConsentEntry(s)`, `resolveVisitorKey`, `startConsentAutoRead`, `DENIED_ALL`, `CONSENT_WAIT_MS`, and the consent types. |
| `@createcms/core/plugins/consent/client`  | The `consentClient()` client plugin (the `consent` namespace + `<ConsentGate>`).                                              |
| `@createcms/core/plugins/consent/c15t`    | The c15t adapter — `useC15tConsentBridge`, `consentModeFromC15t`, `DEFAULT_C15T_MAPPING`.                                     |
