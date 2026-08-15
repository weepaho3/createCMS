import * as React from 'react';

import type { EditorContextValue } from './types';

// One context object for the whole package. `/editor/canvas` imports it from
// here (relative import inside the package), so bunchee bundles it into a
// single shared chunk and both entries observe the same instance.
export const EditorContext = React.createContext<EditorContextValue | null>(
  null,
);

/**
 * Reads the editor context and throws a precise error when a part is
 * rendered outside `Editor.Root` (shadcn's guard pattern).
 */
export function useEditorContext(componentName: string): EditorContextValue {
  const value = React.useContext(EditorContext);
  if (value === null) {
    throw new Error(
      `${componentName} must be used within an Editor.Root component.`,
    );
  }
  return value;
}
