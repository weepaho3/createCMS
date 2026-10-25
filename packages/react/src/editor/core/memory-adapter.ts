import type { EditorAdapter } from './adapter';
import type { EditorDocument } from './document';

import { EditorAdapterError } from './adapter';

export type MemoryAdapterOptions = {
  /** Delay in ms before each call settles, to show loading and saving states. Default 0. */
  latencyMs?: number;
};

/** An `EditorAdapter` over documents kept in memory, plus the current versions. */
export type MemoryAdapter = EditorAdapter & {
  /** The stored document `id` (a copy), or `undefined`. */
  get(id: string): EditorDocument | undefined;
  /** The stored version of `id`: `"1"` for a seeded document, counting up per save. */
  version(id: string): string | undefined;
};

const copy = (doc: EditorDocument): EditorDocument => structuredClone(doc);

/**
 * An `EditorAdapter` without a backend: documents live in memory for the
 * page's lifetime. `save` rejects a stale `baseVersion` with a `conflict`
 * error, like a server would; `load` of an unknown id throws `not-found`.
 * For demos, tests and prototypes before a backend exists.
 */
export function createMemoryAdapter(
  documents: Readonly<Record<string, EditorDocument>>,
  options: MemoryAdapterOptions = {},
): MemoryAdapter {
  const store = new Map<string, { doc: EditorDocument; version: number }>(
    Object.entries(documents).map(([id, doc]) => [
      id,
      { doc: copy(doc), version: 1 },
    ]),
  );
  const settle = async () => {
    const ms = options.latencyMs ?? 0;
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  };
  const entry = (id: string) => {
    const found = store.get(id);
    if (!found) {
      throw new EditorAdapterError('not-found', `No document "${id}".`, {
        id,
      });
    }
    return found;
  };
  return {
    async load(id) {
      await settle();
      return copy(entry(id).doc);
    },
    async save(id, doc, ctx) {
      await settle();
      const current = store.get(id);
      if (
        current &&
        ctx.baseVersion !== undefined &&
        ctx.baseVersion !== String(current.version)
      ) {
        throw new EditorAdapterError(
          'conflict',
          'The document changed since it was loaded.',
          { id, version: String(current.version) },
        );
      }
      const version = (current?.version ?? 0) + 1;
      store.set(id, { doc: copy(doc), version });
      return { version: String(version) };
    },
    get(id) {
      const found = store.get(id);
      return found ? copy(found.doc) : undefined;
    },
    version(id) {
      const found = store.get(id);
      return found ? String(found.version) : undefined;
    },
  };
}
