import type { WritableAtom } from 'nanostores';

import type { CMSAtomListener, CMSFetch } from './types';

import { encodeFlagQuery } from '../core/with-flags';

/**
 * Creates a Proxy-based client that maps property access to API calls.
 *
 * - `client.pages.listRoots()` -> `$fetch("/pages/listRoots", ...)`
 * - Direct properties on `routes` (plugin actions, atom hooks, $fetch, $store)
 *   are returned as-is.
 * - On successful API calls, matching `atomListeners` are triggered to
 *   invalidate dependent query atoms.
 */
export function createDynamicPathProxy(
  routes: Record<string, unknown>,
  $fetch: CMSFetch,
  pathMethods: Record<string, string>,
  atoms: Record<string, WritableAtom<unknown>>,
  atomListeners: CMSAtomListener[],
): any {
  return new Proxy(routes, {
    get(target, prop: string) {
      if (prop in target) {
        const value = target[prop];
        if (typeof value === 'object' && value !== null) {
          return createNamespaceProxy(
            prop,
            value as Record<string, unknown>,
            $fetch,
            pathMethods,
            atoms,
            atomListeners,
          );
        }
        return value;
      }

      return createNamespaceProxy(
        prop,
        {},
        $fetch,
        pathMethods,
        atoms,
        atomListeners,
      );
    },
  });
}

function createNamespaceProxy(
  namespace: string,
  routes: Record<string, unknown>,
  $fetch: CMSFetch,
  pathMethods: Record<string, string>,
  atoms: Record<string, WritableAtom<unknown>>,
  atomListeners: CMSAtomListener[],
) {
  return new Proxy(routes, {
    get(target, method: string) {
      if (method in target) return target[method];

      return (opts?: { body?: unknown; query?: Record<string, unknown> }) => {
        const routePath = `/${namespace}/${method}`;
        const httpMethod =
          pathMethods[routePath] ?? (opts?.body !== undefined ? 'POST' : 'GET');

        const query = encodeFlagQuery(opts?.query);

        return $fetch(routePath, {
          method: httpMethod,
          ...opts,
          ...(query ? { query } : {}),
        }).then((data) => {
          triggerListeners(routePath, atoms, atomListeners);
          return data;
        });
      };
    },
  });
}

function triggerListeners(
  routePath: string,
  atoms: Record<string, WritableAtom<unknown>>,
  atomListeners: CMSAtomListener[],
) {
  const matches = atomListeners.filter((l) => l.matcher(routePath));
  if (!matches.length) return;

  const visited = new Set<string>();
  for (const match of matches) {
    const signal = atoms[match.signal];
    if (!signal || visited.has(match.signal)) continue;
    visited.add(match.signal);

    // Defer to a microtask so the toggle runs after the current call settles,
    // and read the CURRENT value at set-time (not a value captured earlier) so
    // rapid successive mutations can't cancel each other out and drop an
    // invalidation.
    setTimeout(() => {
      const current = signal.get();
      signal.set(typeof current === 'boolean' ? !current : current);
    }, 0);

    match.callback?.(routePath);
  }
}
