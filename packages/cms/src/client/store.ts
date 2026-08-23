import type { WritableAtom } from 'nanostores';

import type { CMSClientStore } from './types';

/**
 * Creates a `CMSClientStore` from a map of atoms.
 * Provides `invalidate` (toggle a signal) and `listen` (subscribe to a signal).
 */
export function createStore(
  atoms: Record<string, WritableAtom<unknown>>,
): CMSClientStore {
  return {
    invalidate(signal: string) {
      const atom = atoms[signal];
      if (atom) {
        const current = atom.get();
        atom.set(typeof current === 'boolean' ? !current : current);
      }
    },
    listen(signal: string, listener: () => void) {
      const atom = atoms[signal];
      // `listen` (fires on the NEXT change) rather than `subscribe` (fires
      // immediately); return the unsubscribe for caller teardown.
      if (atom) return atom.listen(listener);
      return () => {};
    },
    atoms,
  };
}
