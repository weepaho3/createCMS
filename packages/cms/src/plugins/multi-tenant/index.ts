import { APIError } from 'better-call';
import { sql } from 'drizzle-orm';

import type {
  CMSMiddlewareRequest,
  MiddlewareResult,
  ScopeConditionFactory,
} from '../../core/types/definitions';
import type { CMSPlugin } from '../../core/types/plugin';

import { multiTenantSchema } from './schema';

/**
 * Extends the core MiddlewareResult to require tenantSlug.
 * Use this to type your authMiddleware when using multiTenant.
 *
 * @example
 * ```ts
 * import { resolveTenantSlug } from '@createcms/core/plugins/multi-tenant';
 *
 * authMiddleware: async (ctx): Promise<MultiTenantMiddlewareResult> => {
 *   const session = await getSession(ctx);
 *   // Secure default: the tenant comes from the trusted session, NOT the
 *   // request. Only pass { allowRequestOverride: true } after an admin check.
 *   const tenantSlug = resolveTenantSlug(ctx, session.organizationSlug);
 *   return {
 *     userId: session.userId,
 *     tenantSlug,
 *   };
 * }
 * ```
 */
export type MultiTenantMiddlewareResult = MiddlewareResult & {
  tenantSlug: string;
};

/**
 * Resolves the tenant slug for the current request.
 *
 * Secure by default: reads the tenant from the session `fallback` and
 * IGNORES any request-supplied `tenantSlug` (`body`/`query`). This prevents
 * a caller from crossing tenant boundaries by putting a `tenantSlug` in the
 * request. Request-supplied values are only consulted when you explicitly
 * pass `{ allowRequestOverride: true }`.
 *
 * When overrides are enabled the priority is:
 * `body.tenantSlug -> query.tenantSlug -> fallback`.
 *
 * @param ctx      - The middleware context (must have `request`)
 * @param fallback - Trusted tenant slug from the session (e.g.
 *                   `session.organizationSlug`)
 * @param opts     - Pass `{ allowRequestOverride: true }` ONLY after an admin
 *                   check to honor a request-supplied `tenantSlug`
 *                   (e.g. admin cross-tenant access). Gate this behind an
 *                   authorization check — never enable it unconditionally.
 */
export function resolveTenantSlug(
  ctx: { request?: CMSMiddlewareRequest },
  fallback?: string,
  opts?: { allowRequestOverride?: boolean },
): string | undefined {
  if (opts?.allowRequestOverride === true) {
    return (
      (ctx.request?.body?.tenantSlug as string | undefined) ??
      (ctx.request?.query?.tenantSlug as string | undefined) ??
      fallback
    );
  }
  return fallback;
}

// A plugin id is an api namespace + URL segment, so it must be a valid JS
// identifier (enforced by validatePluginPaths on the api-design branch).
// camelCase, not kebab-case.
const PLUGIN_ID = 'multiTenant' as const;

const $ERROR_CODES = {
  TENANT_SLUG_REQUIRED: {
    status: 400,
    message:
      'tenantSlug is required -- authMiddleware must return { tenantSlug } when multiTenant plugin is active',
  },
} as const;

export function multiTenant() {
  return {
    id: PLUGIN_ID,

    schema: multiTenantSchema,

    $ERROR_CODES,

    init(_ctx) {
      const factory: ScopeConditionFactory = (mwResult) => {
        const tenantSlug = (mwResult as Record<string, unknown>).tenantSlug;

        if (typeof tenantSlug !== 'string' || tenantSlug.length === 0) {
          throw new APIError(400, {
            message: $ERROR_CODES.TENANT_SLUG_REQUIRED.message,
            code: 'TENANT_SLUG_REQUIRED',
          });
        }

        const insertColumns = { tenant_slug: tenantSlug };

        return {
          roots: {
            where: sql`"cms"."roots"."tenant_slug" = ${tenantSlug}`,
            insertColumns,
          },
          assets: {
            where: sql`"cms"."assets"."tenant_slug" = ${tenantSlug}`,
            insertColumns,
          },
          assetFolders: {
            where: sql`"cms"."asset_folders"."tenant_slug" = ${tenantSlug}`,
            insertColumns,
          },
          redirects: {
            where: sql`"cms"."redirects"."tenant_slug" = ${tenantSlug}`,
            insertColumns,
          },
          templates: {
            where: sql`"cms"."templates"."tenant_slug" = ${tenantSlug}`,
            insertColumns,
          },
          variables: {
            where: sql`"cms"."variables"."tenant_slug" = ${tenantSlug}`,
            insertColumns,
          },
        };
      };

      return {
        context: {
          scopeConditions: [factory],
        },
      };
    },
  } satisfies CMSPlugin;
}
