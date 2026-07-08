import type { NextRequest } from 'next/server';

import { NextResponse } from 'next/server';

import type { AbResolveResult } from '../plugins/ab-test/resolve';

import {
  CONTROL_CODE,
  DEFAULT_VARIANT_PREFIX,
  decideEdgeVariant,
  variantRewritePath,
} from '../ab-edge';

// ============================================================================
// AB_FANOUT — Next.js edge middleware (Pattern A: cache-per-variant)
// ============================================================================
//
// A THIN adapter over the framework-agnostic core in `@createcms/core/ab-edge`:
// supplies the Next primitives (NextRequest cookies, NextResponse.rewrite, the
// resolve fetch). The bucketing + rewrite decision lives in `decideEdgeVariant`.
// EDGE-SAFE (only `next/server` + the core; no Node built-ins).
//
// ALWAYS-REWRITE + CONSENT-FREE: every request is rewritten to
// `<prefix>/<code><pathname>` (the assigned branch, or the control sentinel) so
// it lands on the single `[abVariant]` route. The variant is kept consistent via
// a VARIANT-ONLY cookie `ab_<testId>=<code>` — no visitor id, no behavioural
// data, no third-party transmission → ePrivacy "strictly necessary" exemption,
// so fresh ad traffic gets real variants (not always control). The consent-gated
// pieces (persistent visitor id, GA4/dataLayer forwarding) live in the client
// pipeline, NOT here. There is NO passthrough, so scope this to PUBLIC CMS paths
// only (compose it in your proxy after the auth gate).

const DEFAULT_CMS_BASE = '/api/cms';
const DEFAULT_VARIANT_COOKIE_PREFIX = 'ab_';
const THIRTY_DAYS_SEC = 2_592_000;

export type AbTestMiddlewareOptions = {
  /** The slug-routed collection these public paths belong to (e.g. 'pages'). */
  collection: string;
  /** Where the CMS router is mounted. Default '/api/cms'. */
  cmsBaseUrl?: string;
  /**
   * The control sentinel code used as the variant-code segment when there is no
   * test / the visitor is outside traffic. Default 'control'. Must match the
   * value your `[abVariant]` route treats as "render control".
   */
  controlCode?: string;
  /**
   * The static path prefix the variant render route lives under
   * (`app/<prefix>/[abVariant]/[[...rest]]`). Default '/ab'. Keeps the
   * variant-coded route off the URL root so it does not shadow sibling app
   * routes (e.g. a `/app/*` dashboard). Must match your route folder.
   */
  variantPrefix?: string;
  /**
   * Name prefix for the per-test variant cookie (`<prefix><testId>`). Default
   * 'ab_'. The cookie stores ONLY the assigned variant code — no identifier.
   */
  variantCookiePrefix?: string;
  /**
   * Lifetime of the variant cookie in seconds. Default 30 days. Keep it close to
   * your test duration (ePrivacy discourages a long-lived cookie "without a
   * technical reason").
   */
  variantCookieMaxAge?: number;
  /**
   * How to fetch the resolve seam for a path. Default: GET
   * `<cmsBaseUrl>/<collection>/resolveAbVariant?path=`, forwarding the request
   * cookies so the CMS resolves the same tenant/language scope. This default
   * does the (cheap) resolve lookup PER REQUEST — a middleware fetch is not
   * served by the Next.js Data Cache. For high traffic, override this with a
   * reader backed by Vercel Edge Config / KV precomputed on test start/stop.
   */
  resolve?: (request: NextRequest, path: string) => Promise<AbResolveResult>;
};

// The A/B resolve seam failing means every request silently falls back to the
// control code. That fail-open is intentional (render/paint must never block),
// but a misconfigured resolve route would otherwise be invisible — so surface
// it ONCE per process, DEV-only, without changing the fail-open behaviour.
let warnedResolveFailure = false;
function warnResolveFailureOnce(err: unknown): void {
  if (process.env.NODE_ENV !== 'production' && !warnedResolveFailure) {
    warnedResolveFailure = true;
    console.warn(
      '[cms:ab] variant resolve failed, falling back to control:',
      err,
    );
  }
}

async function defaultResolve(
  request: NextRequest,
  options: AbTestMiddlewareOptions,
  path: string,
): Promise<AbResolveResult> {
  const base = options.cmsBaseUrl ?? DEFAULT_CMS_BASE;
  const url = new URL(
    `${base}/${options.collection}/resolveAbVariant`,
    request.nextUrl.origin,
  );
  url.searchParams.set('path', path);
  try {
    const res = await fetch(url, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });
    if (!res.ok) return { test: null };
    return (await res.json()) as AbResolveResult;
  } catch (err) {
    warnResolveFailureOnce(err);
    return { test: null }; // fail open to control — render/paint never blocks
  }
}

/**
 * Next.js Pattern A A/B fan-out — ALWAYS rewrites the request to the variant-
 * coded `[abVariant]` route. Compose it inside your `proxy.ts` (Next 16) AFTER
 * the auth gate, and only for PUBLIC CMS paths (it has no passthrough):
 * ```ts
 * // proxy.ts
 * const abTest = abTestMiddleware({ collection: 'pages' });
 * export default async function proxy(request) {
 *   if (isProtected(request)) return authGate(request); // not rewritten
 *   return abTest(request); // public CMS content → /ab/<code>/<path>
 * }
 * ```
 */
export function abTestMiddleware(options: AbTestMiddlewareOptions) {
  const controlCode = options.controlCode ?? CONTROL_CODE;
  const variantPrefix = options.variantPrefix ?? DEFAULT_VARIANT_PREFIX;
  const cookiePrefix =
    options.variantCookiePrefix ?? DEFAULT_VARIANT_COOKIE_PREFIX;
  const cookieMaxAge = options.variantCookieMaxAge ?? THIRTY_DAYS_SEC;
  const resolve =
    options.resolve ?? ((req, path) => defaultResolve(req, options, path));

  return async (request: NextRequest): Promise<NextResponse> => {
    const { pathname } = request.nextUrl;

    // Resolve, reuse-or-assign the variant, then ALWAYS rewrite to
    // `<prefix>/<code><pathname>`. Any failure fails closed to the control code,
    // so the request still lands on the `[abVariant]` route (never a 404).
    let rewritePath: string;
    let setCookie: { name: string; value: string } | null = null;
    try {
      const resolved = await resolve(request, pathname);
      const testId = resolved.test?.testId ?? null;
      const assignedCode = testId
        ? (request.cookies.get(`${cookiePrefix}${testId}`)?.value ?? null)
        : null;

      const decision = decideEdgeVariant({
        pathname,
        resolve: resolved,
        assignedCode,
        controlCode,
        variantPrefix,
      });
      rewritePath = decision.rewritePath;
      // A first assignment → persist the chosen variant code (variant-only).
      if (decision.assignCode && decision.testId) {
        setCookie = {
          name: `${cookiePrefix}${decision.testId}`,
          value: decision.assignCode,
        };
      }
    } catch (err) {
      warnResolveFailureOnce(err);
      rewritePath = variantRewritePath(variantPrefix, controlCode, pathname);
    }

    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = rewritePath; // transparent — browser URL unchanged
    const response = NextResponse.rewrite(rewriteUrl);

    if (setCookie) {
      response.cookies.set(setCookie.name, setCookie.value, {
        path: '/',
        maxAge: cookieMaxAge,
        sameSite: 'lax',
        secure: true,
        // httpOnly: the cookie is sent with every request, so cross-page
        // conversion attribution reads it SERVER-side (no client read needed) —
        // keep it httpOnly to harden against XSS. It holds only the variant code.
        httpOnly: true,
      });
    }
    return response;
  };
}
