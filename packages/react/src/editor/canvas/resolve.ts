import type { AnyEditorSchema, Field, FieldKind } from '../core/schema';

import { fieldsOf } from '../core/schema';
import { useCanvasResolveContext } from './context';

/**
 * Turns a stored value into what the canvas renders: a referenced document,
 * a link's current href, text with variables filled in. Returns the value,
 * a promise of it, or `undefined` when there is nothing to show.
 */
export type FieldResolver = (value: unknown, field: Field) => unknown;

/** One resolver per field kind; kinds without one render their stored value. */
export type CanvasResolve = Partial<Record<FieldKind, FieldResolver>>;

export type CacheEntry =
  | { status: 'ready'; value: unknown }
  | { status: 'pending'; promise: Promise<unknown> }
  | { status: 'miss' };

export type ResolveCache = {
  lookup: (
    kind: FieldKind,
    raw: unknown,
    spec: Field,
    resolver: FieldResolver | undefined,
  ) => CacheEntry;
};

/** Cache key of one stored value: its kind plus its JSON text. */
export function cacheKey(kind: FieldKind, value: unknown): string {
  return (
    kind + '\0' + (typeof value === 'string' ? value : JSON.stringify(value))
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

function isNonEmptyRaw(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'string') return raw.length > 0;
  return true;
}

/**
 * Resolves every prop of one node through `resolve`. A prop whose kind has
 * no resolver, or whose value is empty, renders as stored. A pending or
 * missing resolution keeps the stored value and marks the node
 * `unresolved` (the canvas sets `data-unresolved` on its block anchor).
 */
export function resolveNodeProperties(
  type: string,
  rawProps: Record<string, unknown>,
  schema: AnyEditorSchema,
  resolve: CanvasResolve | undefined,
  cache: ResolveCache,
): { properties: Record<string, unknown>; unresolved: boolean } {
  const fields = fieldsOf(schema, type);
  const properties: Record<string, unknown> = {};
  let unresolved = false;

  for (const [key, raw] of Object.entries(rawProps)) {
    const field = fields[key];
    const resolver = field ? resolve?.[field.type] : undefined;
    if (!field || !resolver || !isNonEmptyRaw(raw)) {
      properties[key] = raw;
      continue;
    }
    const entry = cache.lookup(field.type, raw, field, resolver);
    if (entry.status === 'ready') {
      properties[key] = entry.value;
    } else {
      unresolved = true;
      properties[key] = raw;
    }
  }

  return { properties, unresolved };
}

/** The resolved value, or `undefined` while pending, missing, or without a resolver. */
export function readResolved(
  kind: FieldKind,
  value: unknown,
  spec: Field,
  resolve: CanvasResolve | undefined,
  cache: ResolveCache,
): unknown {
  const resolver = resolve?.[kind];
  if (!resolver) return undefined;
  const entry = cache.lookup(kind, value, spec, resolver);
  return entry.status === 'ready' ? entry.value : undefined;
}

/** Reads one value through the enclosing canvas's `resolve`; re-renders when it settles. */
export function useResolved<T = unknown>(
  kind: FieldKind,
  value: unknown,
  spec: Field,
): T | undefined {
  const ctx = useCanvasResolveContext('useResolved');
  return ctx.read(kind, value, spec) as T | undefined;
}
