import * as React from 'react';

import type { CanvasRect, CanvasViewBox } from './rect';

import { useCanvasContext } from './context';

const subscribeNoop = () => () => {};

const UNBOUNDED_VIEW: CanvasViewBox = {
  scrollLeft: 0,
  scrollTop: 0,
  clientWidth: Number.POSITIVE_INFINITY,
  clientHeight: Number.POSITIVE_INFINITY,
};

/** Re-renders overlay chrome when the canvas host scrolls. */
export function useHostViewBox(host: HTMLElement | null): CanvasViewBox {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useLayoutEffect(() => {
    if (!host) return;
    const onScroll = () => bump();
    host.addEventListener('scroll', onScroll, { passive: true });
    return () => host.removeEventListener('scroll', onScroll);
  }, [host]);
  if (!host) return UNBOUNDED_VIEW;
  return {
    scrollLeft: host.scrollLeft,
    scrollTop: host.scrollTop,
    // Unmeasured hosts (happy-dom before layout, or a 0×0 box) must not
    // clip overlay chrome to an empty intersection.
    clientWidth: host.clientWidth || Number.POSITIVE_INFINITY,
    clientHeight: host.clientHeight || Number.POSITIVE_INFINITY,
  };
}

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
