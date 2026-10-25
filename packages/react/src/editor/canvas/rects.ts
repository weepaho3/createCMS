import * as React from 'react';

import type { MeasuredKind, Measurer } from './measurer';
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

/**
 * A measured rect that stays current while the calling component is
 * mounted (the measurer tracks it); `null` without a measurer or element.
 */
export function useMeasuredRect(
  measurer: Measurer | null,
  kind: MeasuredKind,
  id: string,
  key?: string,
): CanvasRect | null {
  React.useEffect(() => {
    if (!measurer || !id) return;
    return measurer.track(kind, id, key);
  }, [measurer, kind, id, key]);
  return React.useSyncExternalStore(
    measurer ? measurer.subscribe : subscribeNoop,
    () => (measurer && id ? measurer.get(kind, id, key) : null),
    () => null,
  );
}

export function useBlockRect(id: string): CanvasRect | null {
  const ctx = useCanvasContext('useBlockRect');
  return useMeasuredRect(ctx.measurer, 'block', id);
}

export function useFieldRect(id: string, key: string): CanvasRect | null {
  const ctx = useCanvasContext('useFieldRect');
  return useMeasuredRect(ctx.measurer, 'field', id, key);
}
