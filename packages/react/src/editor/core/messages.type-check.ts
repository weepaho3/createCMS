import type { Messages } from './messages';

import { EN_MESSAGES } from './messages';

// A complete catalog must name every entry.
// @ts-expect-error - `parts` is missing
export const incomplete: Messages = {
  field: EN_MESSAGES.field,
  structure: EN_MESSAGES.structure,
  schema: EN_MESSAGES.schema,
  commands: EN_MESSAGES.commands,
  announce: EN_MESSAGES.announce,
  keys: EN_MESSAGES.keys,
};

export const complete: Messages = { ...EN_MESSAGES };
