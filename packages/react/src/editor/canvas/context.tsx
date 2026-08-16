import type { BlockProperty } from '@createcms/schema';

import * as React from 'react';

import type { Measurer } from './measurer';

export type CanvasResolveContextValue = {
  read: (
    kind: 'reference' | 'link' | 'string',
    value: unknown,
    spec: BlockProperty,
  ) => unknown;
};

export type CanvasContextValue = CanvasResolveContextValue & {
  host: HTMLElement | null;
  measurer: Measurer | null;
  dragging: boolean;
  editing: boolean;
};

export const CanvasContext = React.createContext<CanvasContextValue | null>(
  null,
);

export const CanvasResolveContext = CanvasContext;

export function useCanvasContext(componentName: string): CanvasContextValue {
  const value = React.useContext(CanvasContext);
  if (value === null) {
    throw new Error(
      `${componentName} must be used within a Canvas.Root component.`,
    );
  }
  return value;
}

export function useCanvasResolveContext(
  componentName: string,
): CanvasContextValue {
  return useCanvasContext(componentName);
}
