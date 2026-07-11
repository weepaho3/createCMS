import { describe, expect, it } from 'vitest';

import { setupTestCMS } from '../../../test-utils/cms';

/**
 * Guards the client/server path contract.
 *
 * The client proxy builds every request URL as `/<namespace>/<method>`
 * (see src/client/proxy.ts: `` `/${namespace}/${method}` ``), so each endpoint
 * MUST be mounted at exactly that path on the server. A drift is invisible to
 * handler-level tests — those call `cms.api.<ns>.<method>()` directly and bypass
 * HTTP routing entirely — but breaks every real client call with a 404 (the
 * client requests `/variables/listVariables` while the server only has
 * `/variables`). This test exercises the declared paths that the router mounts.
 */
describe('endpoint path convention', () => {
  it('mounts every endpoint at /<namespace>/<method> (matches the client proxy)', async () => {
    const { cms } = await setupTestCMS();

    const offenders: string[] = [];
    for (const [ns, methods] of Object.entries(
      cms.api as Record<string, Record<string, { path?: unknown }>>,
    )) {
      for (const [method, endpoint] of Object.entries(methods)) {
        const path = endpoint?.path;
        // Skip non-endpoint members (no declared HTTP path).
        if (typeof path !== 'string') continue;
        // Skip direct-URL routes with a path parameter (e.g. the public asset
        // redirect `/media/asset/:assetId` — rou3 `:param` syntax, or legacy
        // `{param}` braces). These are addressed by URL, not through the RPC
        // client proxy, so the `/<ns>/<method>` rule never applies.
        if (path.includes('{') || path.includes(':')) continue;
        const expected = `/${ns}/${method}`;
        if (path !== expected) {
          offenders.push(
            `${ns}.${method} is mounted at "${path}" but the client calls "${expected}"`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  // The client seeds a STATIC default `pathMethods` (src/client/config.ts) for the
  // core POSTs that take no/optional body — the proxy's body-presence heuristic
  // would otherwise dispatch GET and 404. If any of these endpoints changed method
  // (or moved), the static client map would silently drift; this locks it to the
  // server's generated `$pathMethods`.
  it('server $pathMethods marks the body-optional core POSTs the client hard-codes', async () => {
    const { cms } = await setupTestCMS();
    const pathMethods = (cms as unknown as { $pathMethods: Record<string, string> })
      .$pathMethods;
    for (const path of [
      '/admin/reindexSearch',
      '/admin/runPruning',
      '/notifications/markNotificationsRead',
      '/notifications/markNotificationsUnread',
    ]) {
      expect(pathMethods[path]).toBe('POST');
    }
  });

  // Locks the client's authoritative override map (`cms.$pathMethods`, built in
  // factory.ts and handed to createCMSClient) to the server's DECLARED method for
  // every endpoint. WHY this matters: the client proxy dispatches each call by
  // looking up `pathMethods[path]` and only falls back to body-presence inference
  // when the path is absent. So if a server endpoint flips POST->GET (or vice
  // versa) without the generated map updating in lockstep, the client keeps
  // issuing the old verb and the server answers 405 Method Not Allowed at runtime.
  // Handler-level tests never see this — they invoke `cms.api.<ns>.<method>()`
  // directly and bypass HTTP method routing entirely — so this contract is the
  // only place a method drift is caught.
  it('server $pathMethods matches each endpoint\'s declared HTTP method', async () => {
    const { cms } = await setupTestCMS();
    const pathMethods = (cms as unknown as { $pathMethods: Record<string, string> })
      .$pathMethods;

    const offenders: string[] = [];
    for (const [ns, methods] of Object.entries(
      cms.api as Record<
        string,
        Record<string, { path?: unknown; options?: { method?: string | string[] } }>
      >,
    )) {
      for (const [method, endpoint] of Object.entries(methods)) {
        const path = endpoint?.path;
        if (typeof path !== 'string') continue;
        // Same skip as the path test: param/direct-URL routes aren't RPC-proxied,
        // so the client never consults `$pathMethods` for them.
        if (path.includes('{') || path.includes(':')) continue;

        // Normalize exactly like the factory (factory.ts): an endpoint may declare
        // `method` as a string or an array; prefer the first non-GET verb, else the
        // first entry. This is the value the client's override map is derived from.
        const m = endpoint?.options?.method;
        const declared = Array.isArray(m) ? (m.find((x) => x !== 'GET') ?? m[0]) : m;

        if (pathMethods[path] !== declared) {
          offenders.push(
            `${ns}.${method} ("${path}") declares method ${JSON.stringify(declared)} ` +
              `but $pathMethods has ${JSON.stringify(pathMethods[path])} ` +
              `(client would dispatch the wrong verb -> 405)`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
