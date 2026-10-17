import { APIError } from 'better-call';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { CMSMiddleware } from '../../types/definitions';

import { setupMultiTenantTestCMS } from '../../../plugins/multi-tenant/test/utils/cms';
import { assets } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { createMemoryStorage } from '../../../test-utils/storage';

function header(
  request: { headers?: HeadersInit; request?: Request } | undefined,
  name: string,
): string | null {
  return (
    request?.request?.headers.get(name) ??
    new Headers(request?.headers).get(name)
  );
}

// Accepts `x-user`; rejects requests without it. `x-tenant` sets the tenant.
const auth: CMSMiddleware = async (ctx) => {
  const userId = header(ctx.request, 'x-user');
  if (!userId) throw new APIError(401, { message: 'Sign in' });
  return { userId, tenantSlug: header(ctx.request, 'x-tenant') ?? undefined };
};

function storage() {
  return createMemoryStorage({
    signedGet: { supported: true, disposition: true, maxExpiresIn: 604_800 },
  });
}

const get = (
  handler: (r: Request) => Promise<Response>,
  id: string,
  headers: Record<string, string> = {},
) =>
  handler(
    new Request(`http://localhost/api/cms/media/asset/${id}`, { headers }),
  );

describe('asset gate', () => {
  async function setup() {
    const media = storage();
    const seen: number[] = [];
    const signGet = media.signGet.bind(media);
    media.signGet = async (key, opts) => {
      seen.push(opts.expiresIn);
      return signGet(key, opts);
    };
    const ctx = await setupTestCMS({
      media: { storage: media },
      authMiddleware: auth,
    });
    const [priv, pub] = await ctx.db
      .insert(assets)
      .values([
        {
          slug: 'secret.png',
          mimeType: 'image/png',
          size: 1,
          objectKey: 'prv/ast_1/secret.png',
          status: 'private',
        },
        {
          slug: 'open.png',
          mimeType: 'image/png',
          size: 1,
          objectKey: 'pub/ast_2/open.png',
          status: 'public',
        },
      ])
      .returning({ id: assets.id });
    return { ...ctx, priv, pub, seen };
  }

  it('redirects a public image to the bucket URL without auth', async () => {
    const { cms, pub } = await setup();
    const res = await get(cms.router.handler, pub.id);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://cdn.test.local/pub/ast_2/open.png',
    );
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('denies a private asset to an anonymous caller', async () => {
    const { cms, priv } = await setup();
    const res = await get(cms.router.handler, priv.id);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ASSET_ACCESS_DENIED');
  });

  it('serves a private asset through a short signed GET, never cached', async () => {
    const { cms, priv, seen } = await setup();
    const res = await get(cms.router.handler, priv.id, { 'x-user': 'u1' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('memory://prv/ast_1/secret.png');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(seen).toEqual([300]);
  });
});

describe('asset gate with the multi-tenant plugin', () => {
  async function setup() {
    const ctx = await setupMultiTenantTestCMS({ authMiddleware: auth });
    await ctx.db.execute(sql`
      INSERT INTO cms.assets (id, slug, mime_type, size, object_key, status, tenant_slug)
      VALUES
        ('ast_acme_pub', 'a.png', 'image/png', 1, 't/acme/pub/a.png', 'public', 'acme'),
        ('ast_acme_prv', 'b.png', 'image/png', 1, 't/acme/prv/b.png', 'private', 'acme')
    `);
    return ctx;
  }

  it.each([
    ['public', 'ast_acme_pub', 'acme', 302],
    ['public', 'ast_acme_pub', 'globex', 404],
    ['public', 'ast_acme_pub', undefined, 302],
    ['private', 'ast_acme_prv', 'acme', 'signed'],
    ['private', 'ast_acme_prv', 'globex', 404],
    ['private', 'ast_acme_prv', undefined, 403],
  ] as const)(
    '%s asset requested by tenant %s',
    async (_kind, id, tenant, expected) => {
      const { cms } = await setup();
      const headers: Record<string, string> = tenant
        ? { 'x-user': 'u1', 'x-tenant': tenant }
        : {};
      const res = await get(cms.router.handler, id, headers);
      if (expected === 'signed') {
        // The dummy config cannot sign; the request got past every check.
        expect(res.status).toBe(302);
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        return;
      }
      expect(res.status).toBe(expected);
    },
  );
});
