import { Globe, Lock } from 'lucide-react';
import { type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { TypeTable, type TypeNode } from './type-table';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const methodVariants: Record<HttpMethod, string> = {
  GET: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  POST: 'text-sky-700 dark:text-sky-400 bg-sky-500/10 border-sky-500/25',
  PUT: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
  PATCH: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
  DELETE: 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/25',
};

export interface APIMethodProps {
  /** HTTP verb the endpoint is called with. */
  method: HttpMethod;
  /** Route path. Use `{collection}` for the per-collection segment. */
  path: string;
  /** Permission resource checked by authorization (e.g. `root`, `block`). */
  resource?: string;
  /** Permission operation checked by authorization (`create` | `read` | `update` | `delete`). */
  operation?: string;
  /** The endpoint is reachable without a session (only the public media asset gate). */
  public?: boolean;
  /**
   * The endpoint runs the auth chain but is conventionally anonymous-readable
   * (the `publishedContent` carve-out: `getPublishedContent`, `resolveRedirect`,
   * `resolveAbVariant`).
   */
  anonymousRead?: boolean;
  /** Request fields (body for `POST`, query for `GET`). Rendered as a {@link TypeTable}. */
  params?: Record<string, TypeNode>;
  /** Short description of the resolved value, e.g. `{ commit, rootId }`. */
  returns?: ReactNode;
  children?: ReactNode;
}

/**
 * Renders one endpoint the better-auth way: an HTTP-verb badge, the route path,
 * the exact `resource:operation` permission it checks, its typed parameters, and
 * its return shape. Author it as a single self-closing tag per method:
 *
 * ```mdx
 * <APIMethod method="POST" path="/{collection}/createRoot" resource="root" operation="create"
 *   returns="{ commit, rootId, branchId }" params={{
 *     properties: { type: 'RootProperties', description: "The root's typed properties." },
 *     slug: { type: 'string', required: false, description: 'URL slug for the entry.' },
 *   }} />
 * ```
 */
export function APIMethod({
  method,
  path,
  resource,
  operation,
  public: isPublic,
  anonymousRead,
  params,
  returns,
  children,
}: APIMethodProps) {
  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border bg-fd-card text-fd-card-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-fd-muted/40 px-3 py-2.5">
        <span
          className={cn(
            'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide',
            methodVariants[method],
          )}
        >
          {method}
        </span>
        <code className="break-all font-mono text-sm text-fd-foreground">
          {path}
        </code>
        <span className="ms-auto">
          <AuthBadge
            resource={resource}
            operation={operation}
            isPublic={isPublic}
            anonymousRead={anonymousRead}
          />
        </span>
      </div>
      {params && (
        <div className="px-1">
          <TypeTable type={params} />
        </div>
      )}
      {returns && (
        <div className="flex flex-col gap-1 border-t px-4 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-3">
          <span className="shrink-0 font-medium text-fd-muted-foreground">
            Returns
          </span>
          <code className="font-mono text-fd-foreground">{returns}</code>
        </div>
      )}
      {children}
    </div>
  );
}

function AuthBadge({
  resource,
  operation,
  isPublic,
  anonymousRead,
}: {
  resource?: string;
  operation?: string;
  isPublic?: boolean;
  anonymousRead?: boolean;
}) {
  if (isPublic) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <Globe className="size-3" />
        Public
      </span>
    );
  }

  if (anonymousRead) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Globe className="size-3" />
        Anonymous read
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium text-fd-muted-foreground">
      <Lock className="size-3" />
      {resource && operation ? (
        <code className="font-mono">
          {resource}:{operation}
        </code>
      ) : (
        'Requires session'
      )}
    </span>
  );
}
