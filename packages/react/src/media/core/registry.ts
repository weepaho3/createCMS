/**
 * An ordered registry of extensions keyed by `id`: registering an existing
 * id replaces it in place. `list()` returns a new array per change, so it
 * works as a store snapshot.
 */
export type Registry<T extends { id: string }> = {
  /** Adds or replaces `item`; returns the unregister function. */
  register(item: T): () => void;
  list(): readonly T[];
  get(id: string): T | undefined;
  subscribe(listener: () => void): () => void;
};

export function createRegistry<T extends { id: string }>(
  initial: readonly T[] = [],
): Registry<T> {
  let items: readonly T[] = [...initial];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    register(item) {
      const index = items.findIndex((entry) => entry.id === item.id);
      items =
        index === -1
          ? [...items, item]
          : items.map((entry, i) => (i === index ? item : entry));
      notify();
      return () => {
        if (!items.includes(item)) return;
        items = items.filter((entry) => entry !== item);
        notify();
      };
    },
    list: () => items,
    get: (id) => items.find((entry) => entry.id === id),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
