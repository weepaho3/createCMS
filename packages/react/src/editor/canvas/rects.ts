import * as React from 'react';

import type { CanvasRect } from './rect';

import { useCanvasContext } from './context';

const subscribeNoop = () => () => {};

export function useBlockRect(id: string): CanvasRect | null {
  const ctx = useCanvasContext('useBlockRect');
  const m = ctx.measurer;
  return React.useSyncExternalStore(
    m ? m.subscribe : subscribeNoop,
    () => (m ? m.getBlockRect(id) : null),
    () => null,
  );
}

export function useFieldRect(id: string, key: string): CanvasRect | null {
  const ctx = useCanvasContext('useFieldRect');
  const m = ctx.measurer;
  return React.useSyncExternalStore(
    m ? m.subscribe : subscribeNoop,
    () => (m ? m.getFieldRect(id, key) : null),
    () => null,
  );
}
