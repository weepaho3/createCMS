// Type-only assertions for the media catalog, checked by `check-types` and
// never executed.

import type { MediaMessagesInput } from './messages';

// A partial override is allowed: every key is optional.
export const partial: MediaMessagesInput = { folder: { root: 'Mediathek' } };

export const wrongParameter: MediaMessagesInput = {
  selection: {
    // @ts-expect-error `selection.count` receives `{ count }`, not `{ total }`.
    count: ({ total }) => `${total}`,
  },
};

export const wrongType: MediaMessagesInput = {
  // @ts-expect-error `folder.root` is a string, not a function.
  folder: { root: () => 'Mediathek' },
};
