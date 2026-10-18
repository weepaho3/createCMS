import * as React from 'react';

import type { Field, FieldKind } from '../core/schema';
import type { CanvasInteractive } from './components';
import type { DndStore } from './dnd';
import type { Measurer } from './measurer';
import type { PointerStore } from './pointer';
import type { PreviewSurface } from './surface';

export type CanvasResolveContextValue = {
  read: (kind: FieldKind, value: unknown, spec: Field) => unknown;
};

export type InlineCaretPoint = { x: number; y: number };

export type CanvasContextValue = CanvasResolveContextValue & {
  host: HTMLElement | null;
  measurer: Measurer | null;
  pointer: PointerStore | null;
  dnd: DndStore | null;
  interactive: CanvasInteractive;
  dragging: boolean;
  editing: boolean;
  inlineCaret: React.RefObject<InlineCaretPoint | null>;
  /** Where the canvas renders; `null` until the host mounted. */
  surface: PreviewSurface | null;
  /**
   * The host-page layer over a frame surface (toolbars, menus); `null` for
   * an inline surface, whose overlay already lives in the host page.
   */
  hostLayer: HTMLElement | null;
  /**
   * Whether a click on a text field of `blockId` starts editing under the
   * click model (see `CanvasRootProps.clickToEdit`).
   */
  clickEdits: (blockId: string) => boolean;
};

/**
 * `select-and-edit`: a click on a text field selects the block and starts
 * editing. `select-first`: the first tap selects, a tap on the selected
 * block edits.
 */
export type CanvasClickToEdit = 'select-and-edit' | 'select-first';

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

/** Where the canvas renders and how its coordinates map to the host page; `null` until mounted. */
export function useSurface(): PreviewSurface | null {
  return useCanvasContext('useSurface').surface;
}
