import { afterAll, afterEach, beforeEach } from 'vitest';

import { beginTest, releaseClientsFrom } from './src/test-utils/db';

/**
 * Test-lifecycle hooks for the shared-PGlite test databases (see
 * src/test-utils/db.ts): `beforeEach` advances the test sequence so
 * `setupTestDB` knows when a new test begins, and the after-hooks release
 * *throwaway* instances (second and later DBs within one test). The shared
 * per-schema-set singletons are process-lived on purpose — on Linux, dropped
 * PGlite instances are never reclaimed, so keeping a handful alive beats
 * leaking one per test.
 *
 * Hook ordering makes the boundary sound: this file's hooks are registered
 * before any test-file hooks, so `beforeEach` here runs first and `afterEach`
 * here runs last (a test file's own `afterEach` can still use its clients).
 * Throwaways opened outside tests — `beforeAll` or module scope — sit below
 * the first boundary and are only released in `afterAll`.
 */
let boundary = 0;

beforeEach(() => {
  // Bumps the test sequence (so setupTestDB can tell a second DB request
  // within one test apart from the next test) and snapshots the throwaway
  // registry.
  boundary = beginTest();
});

afterEach(async () => {
  await releaseClientsFrom(boundary);
});

afterAll(async () => {
  await releaseClientsFrom(0);
});
