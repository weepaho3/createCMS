---
"@createcms/core": patch
---

Add an optional **c15t adapter** for the consent gate at `@createcms/core/plugins/consent/c15t`.

[c15t](https://c15t.com) is a consent-management platform (banner + storage + Consent Mode); the createCMS consent gate is the consumer-side layer that buffers the CMS's own A/B + analytics effects until consent is decided. This adapter bridges them:

- `consentModeFromC15t(consents, mapping?)` — pure mapper from c15t's categories to Consent Mode v2 signals (default: `measurement` → `analytics_storage`, `marketing` → `ad_storage`/`ad_user_data`/`ad_personalization`; `necessary`/`functionality`/`experience` ignored). The mapping is overridable.
- `useC15tConsentBridge(client, { consents, hasConsented }, mapping?)` — a React hook that pushes c15t's decision into the gate once the visitor has decided.

It takes c15t's consent record as input and has **no `@c15t/*` dependency**, so it works with any c15t version — the consumer wires `useConsentManager()` in. (If c15t already emits Consent Mode commands onto `window.dataLayer` via GTM, the gate's auto-read picks them up and no adapter is needed; this is for the offline / no-dataLayer case or driving the gate explicitly.)
