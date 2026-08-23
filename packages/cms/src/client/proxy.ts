import type { WritableAtom } from 'nanostores';

import type { CMSAtomListener, CMSFetch } from './types';

import { encodeFlagQuery } from '../core/with-flags';

/**
 * Proxy-based client mapping property access to API calls:
 * `client.pages.listRoots()` -> `$fetch("/pages/listRoots", ...)`. Properties
 * that exist on `routes` (plugin actions, atom hooks, $fetch, $store) are
 * returned as-is; on a successful non-GET call the matching `atomListeners`
 * fire to invalidate dependent query atoms.
 *
 * Not referentially stable: every property access mints a new namespace proxy
 * and every method access a new function, so
 * `client.pages.list !== client.pages.list`. Never put `client.x.y` in a React
 * dependency array, or the effect re-runs every render.
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
          // Only mutations invalidate: a GET toggle would refetch every
          // subscribed query atom in a loop after a plain read.
          if (httpMethod !== 'GET') {
            triggerListeners(routePath, atoms, atomListeners);
          }
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

    // Deferred to a microtask so the toggle runs after the current call
    // settles; read at set-time so rapid mutations can't drop an invalidation.
    queueMicrotask(() => {
      const current = signal.get();
      signal.set(typeof current === 'boolean' ? !current : current);
    });

    match.callback?.(routePath);
  }
}
