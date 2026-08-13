import { afterAll, afterEach, beforeEach } from 'vitest';

import { markClientBoundary, releaseClientsFrom } from './src/test-utils/db';

/**
 * Releases every PGlite instance a test opened as soon as the test ends.
 * Without this, nothing lets go of the clients: each one pins its data dir
 * plus WASM heap (hundreds of MB) until the worker exits, so a file with
 * dozens of `setupTestCMS` calls accumulates gigabytes — multiplied by
 * parallel workers, enough to exhaust machine memory.
 *
 * Hook ordering makes the boundary sound: this file's hooks are registered
 * before any test-file hooks, so `beforeEach` here runs first (boundary is
 * taken before a test file's own `beforeEach` opens per-test clients) and
 * `afterEach` here runs last (a test file's own `afterEach` can still use its
 * clients). Clients opened outside tests — `beforeAll` or module scope — sit
 * below the first boundary and are only released in `afterAll`.
 */
let boundary = 0;

beforeEach(() => {
  boundary = markClientBoundary();
});

afterEach(async () => {
  await releaseClientsFrom(boundary);
});

afterAll(async () => {
  await releaseClientsFrom(0);
});
