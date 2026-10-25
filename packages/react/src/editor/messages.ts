import * as React from 'react';

import type { Messages } from './core/messages';

import { EditorContext } from './context';
import { EN_MESSAGES, formatShortcut } from './core/messages';

/** The editor's text catalog; English outside an `Editor.Root`. */
export function useMessages(): Messages {
  return React.useContext(EditorContext)?.messages ?? EN_MESSAGES;
}

/** Formats `Mod+Shift+z` for the editor's platform and catalog. */
export function useShortcutLabel(): (combo: string) => string {
  const ctx = React.useContext(EditorContext);
  return React.useCallback(
    (combo: string) =>
      formatShortcut(combo, {
        messages: ctx?.messages ?? EN_MESSAGES,
        platform: ctx?.platform,
      }),
    [ctx],
  );
}
