/**
 * Cross-site request protection for the state-changing media endpoints.
 * Only requests that carry cookies can be forged by another site, so
 * requests without a `Cookie` header (bearer tokens, API keys, server
 * calls) always pass. A cookie request passes when the browser says it is
 * same-origin (`Sec-Fetch-Site`), when its `Origin` is the request's own
 * origin or listed in `allowedOrigins`, or when it sends
 * `x-createcms-media: 1` (a custom header no other site can set without a
 * CORS preflight).
 */

/** The header a cross-origin admin may send instead of being listed. */
export const MEDIA_CSRF_HEADER = 'x-createcms-media';

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** The request's own origin from its URL or forwarded host and protocol. */
function ownOrigin(headers: Headers, url: string | undefined): string | null {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (host) {
    const proto =
      headers.get('x-forwarded-proto')?.split(',')[0].trim() ??
      (url ? new URL(url).protocol.replace(':', '') : 'https');
    return normalizeOrigin(`${proto}://${host.split(',')[0].trim()}`);
  }
  return url ? normalizeOrigin(url) : null;
}

/**
 * Whether a state-changing media request may run. `headers` and `url` are
 * those of the HTTP request; both are absent for server calls.
 */
export function isMediaOriginAllowed(
  allowedOrigins: readonly string[] | undefined,
  headers: Headers | undefined,
  url?: string,
): boolean {
  if (!headers || !headers.get('cookie')) return true;
  if (headers.get(MEDIA_CSRF_HEADER) === '1') return true;
  const site = headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return true;
  const origin = headers.get('origin');
  if (!origin || origin === 'null') {
    // No Origin and no fetch metadata: not a browser's cross-site request.
    return site === null && origin === null;
  }
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (normalized === ownOrigin(headers, url)) return true;
  return (allowedOrigins ?? []).some(
    (allowed) => normalizeOrigin(allowed) === normalized,
  );
}
