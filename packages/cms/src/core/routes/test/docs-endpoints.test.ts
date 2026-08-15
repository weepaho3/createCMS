import { describe, expect, it } from 'vitest';

import { setupTestCMS } from '../../../test-utils/cms';
import {
  type APIMethodBlock,
  diffSets,
  parseAPIMethods,
  readDocDir,
} from '../../../test-utils/docs';

/**
 * Pins `content/docs/reference/**` against the endpoints the built `cms.api`
 * actually exposes.
 *
 * The reference pages document each endpoint with an `<APIMethod fn="…"
 * resource="…" operation="…" />` block, which makes them a structured record
 * rather than prose — so this test compares SETS instead of grepping. A new
 * endpoint that ships without a block fails here, and a block whose endpoint
 * was renamed or removed fails here too.
 *
 * The `resource` / `operation` attributes are checked against the endpoint's
 * real `metadata.cms`, the same metadata `endpoint-authz-contract.test.ts`
 * pins. Those attributes render as the permission chip a reader plans their
 * access-control rules against, so a stale chip becomes a wrong rule.
 */

/**
 * `cms.api` namespaces content endpoints by COLLECTION, so the built instance
 * uses the test fixture's collection name while the docs write `{collection}`
 * and omit the `collection` attribute. Blocks without the attribute map here.
 */
const COLLECTION_NS = 'pages';

/**
 * Docs directory scanned for blocks. Plugin endpoints are documented under
 * `plugins/` and are absent from a plugin-less `setupTestCMS()`, so that
 * directory stays out of both sides of the comparison.
 */
const REFERENCE_DIR = 'reference';

type EndpointMeta = {
  permissionResource: string | undefined;
  operation: string | undefined;
};

function collectEndpoints(api: unknown): Map<string, EndpointMeta> {
  const found = new Map<string, EndpointMeta>();
  for (const [ns, endpoints] of Object.entries(
    api as Record<string, Record<string, unknown>>,
  )) {
    for (const [name, value] of Object.entries(endpoints)) {
      // Same shape check as endpoint-authz-contract.test.ts: a callable that
      // carries better-call `options.metadata` is an endpoint.
      const endpoint = value as {
        options?: { metadata?: { cms?: Partial<EndpointMeta> } };
      };
      if (
        typeof value !== 'function' ||
        endpoint.options?.metadata === undefined
      ) {
        continue;
      }
      found.set(`${ns}.${name}`, {
        permissionResource: endpoint.options.metadata.cms?.permissionResource,
        operation: endpoint.options.metadata.cms?.operation,
      });
    }
  }
  return found;
}

/** `<namespace>.<method>`, matching the keys `collectEndpoints` produces. */
function keyOf(block: APIMethodBlock): string {
  return `${block.attrs.collection ?? COLLECTION_NS}.${block.attrs.fn}`;
}

const blocks = parseAPIMethods(readDocDir(REFERENCE_DIR));

describe('docs coverage: endpoints', () => {
  it('parses the APIMethod blocks (guard against a vacuous pass)', () => {
    expect(blocks.length).toBeGreaterThan(50);
    const withoutFn = blocks
      .filter((block) => !block.attrs.fn)
      .map((block) => `${block.page}: ${JSON.stringify(block.attrs)}`);
    expect(
      withoutFn,
      `<APIMethod> blocks with no \`fn\` attribute:\n  ${withoutFn.join('\n  ')}`,
    ).toEqual([]);
  });

  it('documents each endpoint exactly once', () => {
    const seen = new Map<string, string[]>();
    for (const block of blocks) {
      seen.set(keyOf(block), [...(seen.get(keyOf(block)) ?? []), block.page]);
    }
    const duplicated = [...seen]
      .filter(([, pages]) => pages.length > 1)
      .map(([key, pages]) => `${key} (on ${pages.join(', ')})`)
      .sort();
    expect(
      duplicated,
      `endpoints with more than one <APIMethod> block: ${duplicated.join('; ')}`,
    ).toEqual([]);
  });

  it('documents exactly the endpoints cms.api exposes', async () => {
    const { cms } = await setupTestCMS();
    const { undocumented, stale } = diffSets(
      collectEndpoints(cms.api).keys(),
      blocks.map(keyOf),
    );

    expect(
      undocumented,
      `endpoints with no <APIMethod> block under docs/${REFERENCE_DIR}: ${undocumented.join(', ')}`,
    ).toEqual([]);
    expect(
      stale,
      `docs/${REFERENCE_DIR} documents endpoints cms.api does not expose: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('documents the right permission resource and operation for every endpoint', async () => {
    const { cms } = await setupTestCMS();
    const endpoints = collectEndpoints(cms.api);

    const wrong: string[] = [];
    for (const block of blocks) {
      const key = keyOf(block);
      const meta = endpoints.get(key);
      if (!meta) continue; // reported by the coverage test above

      // The public media gate does its own access control and declares no
      // `permissionResource`; the docs mark it with the `public` flag instead
      // of a permission chip. Every other endpoint must show both labels.
      const expected = block.flags.has('public')
        ? { resource: undefined, operation: undefined }
        : { resource: meta.permissionResource, operation: meta.operation };

      if (block.attrs.resource !== expected.resource) {
        wrong.push(
          `${key}: documented resource ${block.attrs.resource ?? '(none)'}, ` +
            `actual ${meta.permissionResource ?? '(none)'} [${block.page}]`,
        );
      }
      if (block.attrs.operation !== expected.operation) {
        wrong.push(
          `${key}: documented operation ${block.attrs.operation ?? '(none)'}, ` +
            `actual ${meta.operation ?? '(none)'} [${block.page}]`,
        );
      }
    }

    expect(
      wrong.sort(),
      `wrong permission labels in docs/${REFERENCE_DIR}:\n  ${wrong.join('\n  ')}`,
    ).toEqual([]);
  });
});
