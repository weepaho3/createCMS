import * as React from 'react';

import type { FieldContextValue } from './types';

export const FieldContext = React.createContext<FieldContextValue | null>(null);

/** Reads the field context; throws a precise error outside `Editor.Field`. */
export function useFieldContext(componentName: string): FieldContextValue {
  const value = React.useContext(FieldContext);
  if (value === null) {
    throw new Error(
      `${componentName} must be used within an Editor.Field component.`,
    );
  }
  return value;
}
