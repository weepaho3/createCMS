import type {
  BlockProperty,
  LinkValue,
  ResolvedLink,
  ResolvedReference,
} from '@createcms/schema';

import type { AnyEditorSchema } from '../schema';

import { propertiesOf } from '../schema';
import { useCanvasResolveContext } from './context';

export type ResolveKind = 'reference' | 'link' | 'string';

export type CanvasResolve = {
  reference?: (
    rootId: string,
    spec: BlockProperty,
  ) => ResolvedReference | Promise<ResolvedReference> | undefined;
  link?: (
    value: LinkValue,
    spec: BlockProperty,
  ) => ResolvedLink | Promise<ResolvedLink> | undefined;
  string?: (
    value: string,
    spec: BlockProperty,
  ) => string | Promise<string> | undefined;
};

export type CacheEntry =
  | { status: 'ready'; value: unknown }
  | { status: 'pending'; promise: Promise<unknown> }
  | { status: 'miss' };

export type ResolveFn = (
  value: unknown,
  spec: BlockProperty,
) => unknown | Promise<unknown> | undefined;

export type ResolveCache = {
  lookup: (
    kind: ResolveKind,
    raw: unknown,
    spec: BlockProperty,
    resolver: ResolveFn | undefined,
  ) => CacheEntry;
};

function identityOf(kind: ResolveKind, value: unknown): string {
  if (kind === 'link') return JSON.stringify(value);
  return String(value);
}

export function cacheKey(kind: ResolveKind, value: unknown): string {
  return kind + '\0' + identityOf(kind, value);
}

/**
 * This package does not import core; the guard keys on the published
 * reference shape.
 */
export function isResolvedReference(
  value: unknown,
): value is ResolvedReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rootId' in value &&
    'collection' in value &&
    'tree' in value &&
    'properties' in value
  );
}

export function createResolveCache(options: {
  onTick: () => void;
  isMounted: () => boolean;
}): ResolveCache {
  const cache = new Map<string, CacheEntry>();

  return {
    lookup(kind, raw, spec, resolver) {
      if (!resolver) return { status: 'miss' };
      const key = cacheKey(kind, raw);
      const hit = cache.get(key);
      if (hit) return hit;

      let result: unknown;
      try {
        result = resolver(raw, spec);
      } catch {
        const miss: CacheEntry = { status: 'miss' };
        cache.set(key, miss);
        return miss;
      }

      if (result === undefined) {
        const miss: CacheEntry = { status: 'miss' };
        cache.set(key, miss);
        return miss;
      }

      if (result instanceof Promise) {
        const pending: CacheEntry = { status: 'pending', promise: result };
        cache.set(key, pending);
        void result.then(
          (value) => {
            cache.set(
              key,
              value === undefined
                ? { status: 'miss' }
                : { status: 'ready', value },
            );
            if (options.isMounted()) options.onTick();
          },
          () => {
            cache.set(key, { status: 'miss' });
            if (options.isMounted()) options.onTick();
          },
        );
        return pending;
      }

      const ready: CacheEntry = { status: 'ready', value: result };
      cache.set(key, ready);
      return ready;
    },
  };
}

function isNonEmptyRaw(kind: ResolveKind, raw: unknown): boolean {
  if (raw == null) return false;
  if (kind === 'reference' || kind === 'string') {
    return typeof raw === 'string' && raw.length > 0;
  }
  return true;
}

function resolverOf(
  kind: ResolveKind,
  resolve: CanvasResolve | undefined,
): ResolveFn | undefined {
  if (!resolve) return undefined;
  if (kind === 'reference') {
    return resolve.reference as ResolveFn | undefined;
  }
  if (kind === 'link') {
    return resolve.link as ResolveFn | undefined;
  }
  return resolve.string as ResolveFn | undefined;
}

type Route =
  | { kind: ResolveKind; resolver: ResolveFn | undefined }
  | { keep: true };

export function routeProperty(
  spec: BlockProperty,
  raw: unknown,
  resolve: CanvasResolve | undefined,
): Route {
  if (spec.type === 'reference' && typeof raw === 'string') {
    return { kind: 'reference', resolver: resolverOf('reference', resolve) };
  }
  if (spec.type === 'link') {
    return { kind: 'link', resolver: resolverOf('link', resolve) };
  }
  if (spec.type === 'string' || spec.type === 'richText') {
    if (resolve?.string) {
      return { kind: 'string', resolver: resolverOf('string', resolve) };
    }
    return { keep: true };
  }
  return { keep: true };
}

export function resolveNodeProperties(
  type: string,
  rawProps: Record<string, unknown>,
  schema: AnyEditorSchema,
  resolve: CanvasResolve | undefined,
  cache: ResolveCache,
): { properties: Record<string, unknown>; unresolved: boolean } {
  const specs = propertiesOf(schema, type);
  const properties: Record<string, unknown> = {};
  let unresolved = false;

  for (const [key, raw] of Object.entries(rawProps)) {
    const spec = specs[key];
    if (!spec) {
      properties[key] = raw;
      continue;
    }
    const routed = routeProperty(spec, raw, resolve);
    if ('keep' in routed) {
      properties[key] = raw;
      continue;
    }
    if (!routed.resolver) {
      if (isNonEmptyRaw(routed.kind, raw)) {
        unresolved = true;
      } else {
        properties[key] = raw;
      }
      continue;
    }
    const entry = cache.lookup(routed.kind, raw, spec, routed.resolver);
    if (entry.status === 'ready') {
      properties[key] = entry.value;
    } else {
      unresolved = true;
    }
  }

  return { properties, unresolved };
}

export function readResolved(
  kind: ResolveKind,
  value: unknown,
  spec: BlockProperty,
  resolve: CanvasResolve | undefined,
  cache: ResolveCache,
): unknown {
  if (kind === 'string' && !resolve?.string) return value;
  const resolver = resolverOf(kind, resolve);
  if (!resolver) return undefined;
  const entry = cache.lookup(kind, value, spec, resolver);
  if (entry.status === 'ready') return entry.value;
  return undefined;
}

export function useResolved<T = unknown>(
  kind: ResolveKind,
  value: unknown,
  spec: BlockProperty,
): T | undefined {
  const ctx = useCanvasResolveContext('useResolved');
  return ctx.read(kind, value, spec) as T | undefined;
}
