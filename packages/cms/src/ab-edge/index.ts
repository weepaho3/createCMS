import type { AbResolveResult } from '../plugins/ab-test/resolve';

import { resolveVariant } from '../plugins/ab-test/assignment';

// ============================================================================
// Framework-agnostic edge A/B core (Pattern A)
// ============================================================================
//
// The portable heart of edge cache-per-variant A/B: deterministic bucketing +
// the rewrite decision, with NO framework dependency (no next/server, no Node
// built-ins — only the pure `resolveVariant` murmur hash + a type-only import).
// `@createcms/core/next/middleware` is just a thin adapter over `decideEdgeVariant`;
// any runtime with a request interceptor + a per-variant cache (Cloudflare
// Workers, SvelteKit hooks, Remix entry.server, Astro middleware, …) writes the
// same ~20-line adapter against this module.

export type {
  AbResolveResult,
  ResolvedAbVariant,
} from '../plugins/ab-test/resolve';
export { resolveVariant } from '../plugins/ab-test/assignment';
export type {
  VariantInput,
  AssignmentResult,
} from '../plugins/ab-test/assignment';

/**
 * The control sentinel code. Pattern A ALWAYS rewrites (Vercel "precompute"
 * model): a request with no running test / no consent / outside traffic is
 * rewritten to `/<CONTROL_CODE><pathname>` so it still lands on the single
 * `[abVariant]` route — there is no un-coded passthrough. It is never a real
 * branch id (ids are prefixed), and the render route maps it to the control
 * tree (pickVariant fails closed to control for any non-variant code anyway).
 */
export const CONTROL_CODE = 'control';

/**
 * The static path prefix the render route lives under (`app/<prefix>/[abVariant]/
 * [[...rest]]`). Pattern A rewrites every public request UNDER this prefix so the
 * variant-coded route never sits at the URL root — otherwise a root catch-all
 * would shadow sibling app routes (e.g. a `/app/*` dashboard). It is internal +
 * transparent (the browser keeps the original URL), so the value only needs to
 * differ from your real top-level app prefixes; with always-rewrite even a real
 * page slugged `/ab` still works (it is rewritten THROUGH the prefix).
 */
export const DEFAULT_VARIANT_PREFIX = '/ab';

/**
 * Build the variant-coded rewrite path: `<prefix>/<code><pathname>`. The variant
 * code is the first segment AFTER the static prefix — the cache key — never a
 * header/searchParam, so each variant is its own CDN/ISR cache entry (Vercel
 * Flags precompute pattern, nested under `<prefix>` to coexist with other app
 * routes). The matching render route reads the code segment back.
 */
export function variantRewritePath(
  prefix: string,
  code: string,
  pathname: string,
): string {
  // For the root path, omit the trailing slash (`<prefix>/<code>`, not
  // `<prefix>/<code>/`) so the optional-catch-all variant route matches cleanly.
  const suffix = pathname === '/' ? '' : pathname;
  return `${prefix}/${encodeURIComponent(code)}${suffix}`;
}

/** Parse a first-party consent cookie value; analytics granted → true. */
export function parseConsentCookie(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const state = JSON.parse(decodeURIComponent(value)) as Record<
      string,
      unknown
    >;
    return state.analytics_storage === 'granted';
  } catch {
    return false;
  }
}

/**
 * Edge-safe random visitor id (mirrors the client `anon_` key shape). Uses the
 * `crypto` global (Web Crypto), available in every edge/worker/browser runtime.
 */
export function generateEdgeVisitorId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `anon_${hex}`;
}

/**
 * PURE bucketing: given a one-shot `key`, the branch to render IN-TEST, or null =
 * serve control (no running test, or the roll lands outside the test traffic).
 * NO consent / NO persistent identifier — the caller passes an EPHEMERAL random
 * key for a first assignment and then persists only the chosen branch (a
 * variant-only cookie), so nothing identifying is stored. Reuses the same
 * weighted hash as the server pick.
 */
export function pickEdgeVariant(opts: {
  key: string;
  resolve: AbResolveResult;
}): { branchId: string | null } {
  const test = opts.resolve.test;
  if (!test) return { branchId: null };

  const result = resolveVariant(
    opts.key,
    test.testId,
    test.trafficPercentage,
    test.variants.map((v) => ({
      id: v.variantId,
      weight: v.weight,
      isControl: v.isControl,
    })),
  );
  if (!result.inTest) return { branchId: null }; // outside traffic → control

  const picked = test.variants.find((v) => v.variantId === result.variantId);
  return { branchId: picked?.branchId ?? null };
}

/**
 * The framework-agnostic edge decision (ALWAYS-rewrite / Vercel precompute).
 * CONSENT-FREE by design: serving a variant + a VARIANT-ONLY cookie (no visitor
 * id, no behavioural data, no third-party transmission) falls under the ePrivacy
 * "strictly necessary" exemption, so fresh ad traffic gets real variants (not
 * always control).
 *
 * - `assignedCode` is the value of the test's variant cookie (`ab_<testId>`) — a
 *   branch id, or the control sentinel — from a previous visit. If still valid
 *   it is REUSED (consistent variant across requests, no re-roll).
 * - Otherwise a FIRST assignment is rolled from an ephemeral random key; the
 *   chosen code is returned in `assignCode` for the adapter to persist in the
 *   variant cookie. Out-of-traffic → the control sentinel (no impression).
 *
 * `rewritePath` is always non-null. Returns the `testId` so the adapter knows
 * which cookie to set. No persistent identifier is ever minted here — the
 * consent-gated visitor id + GA4 forwarding live in the client pipeline.
 */
export function decideEdgeVariant(input: {
  pathname: string;
  resolve: AbResolveResult;
  assignedCode: string | null;
  controlCode?: string;
  variantPrefix?: string;
}): { rewritePath: string; assignCode: string | null; testId: string | null } {
  const controlCode = input.controlCode ?? CONTROL_CODE;
  const prefix = input.variantPrefix ?? DEFAULT_VARIANT_PREFIX;
  const test = input.resolve.test;

  if (!test) {
    return {
      rewritePath: variantRewritePath(prefix, controlCode, input.pathname),
      assignCode: null,
      testId: null,
    };
  }

  // Reuse a still-valid prior assignment (a published variant branch, or the
  // control sentinel for an out-of-traffic visitor) → consistent, no re-roll.
  const reusable =
    input.assignedCode === controlCode ||
    (input.assignedCode != null &&
      test.variants.some((v) => v.branchId === input.assignedCode));
  if (reusable) {
    return {
      rewritePath: variantRewritePath(
        prefix,
        input.assignedCode!,
        input.pathname,
      ),
      assignCode: null,
      testId: test.testId,
    };
  }

  // First assignment: roll once from an ephemeral (non-persisted) random key.
  const { branchId } = pickEdgeVariant({
    key: generateEdgeVisitorId(),
    resolve: input.resolve,
  });
  const code = branchId ?? controlCode; // out-of-traffic → control sentinel
  return {
    rewritePath: variantRewritePath(prefix, code, input.pathname),
    assignCode: code,
    testId: test.testId,
  };
}
