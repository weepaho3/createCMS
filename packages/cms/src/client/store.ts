import type { WritableAtom } from 'nanostores';

import type { CMSClientStore } from './types';

/**
 * Creates a `CMSClientStore` from a map of atoms.
 * Provides `notify` (toggle a signal) and `listen` (subscribe to a signal).
 */
export function createStore(
  atoms: Record<string, WritableAtom<unknown>>,
): CMSClientStore {
  return {
    notify(signal: string) {
      const atom = atoms[signal];
      if (atom) {
        const current = atom.get();
        atom.set(typeof current === 'boolean' ? !current : current);
      }
    },
    listen(signal: string, listener: () => void) {
      const atom = atoms[signal];
      // Use `listen` (deferred — fires on the NEXT change, matching the method
      // name) rather than `subscribe` (fires immediately). Return the
      // unsubscribe so callers can tear down; a no-op when the atom is missing.
      if (atom) return atom.listen(listener);
      return () => {};
    },
    atoms,
  };
}
