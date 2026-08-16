import type { BlockProperty } from '@createcms/schema';

import * as React from 'react';

export type CanvasResolveContextValue = {
  read: (
    kind: 'reference' | 'link' | 'string',
    value: unknown,
    spec: BlockProperty,
  ) => unknown;
};

export const CanvasResolveContext =
  React.createContext<CanvasResolveContextValue | null>(null);

export function useCanvasResolveContext(
  componentName: string,
): CanvasResolveContextValue {
  const value = React.useContext(CanvasResolveContext);
  if (value === null) {
    throw new Error(
      `${componentName} must be used within a Canvas.Root component.`,
    );
  }
  return value;
}
