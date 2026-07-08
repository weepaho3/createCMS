---
"@createcms/core": patch
---

Testing-strategy hardening (test-01 … test-17). Mostly internal (coverage tooling,
new test suites, a faster test harness), with two shipped changes:

- **New `cms.$flushNotifications()`** — awaits all in-flight fire-and-forget
  notification dispatches. Handy in serverless/short-lived contexts (and the
  deterministic seam the tests now use instead of real `setTimeout` waits).
- The Next revalidate webhook loads `next/cache` via a normal `await import(...)`
  instead of a `Function`-eval'd import — behaviour-identical in a Next app, and
  now mockable/testable.

Coverage tooling (`@vitest/coverage-v8`, `bun run test:coverage`) plus new suites
for the previously-untested browser client, Next adapter, React render paths
(happy-dom), the error contract, and the client/server HTTP-method contract; the
notification and publication suites are now deterministic (no real-clock sleeps),
and the test DB harness memoizes generated migrations (~23% faster suite).
