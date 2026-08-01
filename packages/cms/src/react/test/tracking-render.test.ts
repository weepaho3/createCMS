import { act, cleanup, renderHook } from '@testing-library/react';
// @vitest-environment happy-dom
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BlockTracker,
  TrackingRuntimeProvider,
  useBlockTrackerRaw,
} from '../tracking';

describe('BlockTracker → dispatch wiring', () => {
  afterEach(() => cleanup());

  it('fires a declared event through the runtime dispatch, stamped from context', () => {
    const dispatch = vi.fn();

    // <TrackingRuntimeProvider> supplies dispatch + ambient ab-context; the
    // <BlockTracker> scopes the per-block identity (type/id/trackingId/events).
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(TrackingRuntimeProvider, {
        runtime: { dispatch, ab: { testId: 't1', branchId: 'b1' } },
        children: createElement(BlockTracker, {
          blockType: 'ctaSection',
          blockId: 'blk_1',
          trackingId: 'cta-main',
          events: { click: { name: 'cms_cta_click' } },
          children,
        }),
      });

    const { result } = renderHook(() => useBlockTrackerRaw('ctaSection'), {
      wrapper,
    });

    act(() => {
      result.current.fire('click', { placement: 'cta' });
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    const event = dispatch.mock.calls[0][0];
    // Wire name resolved from the declared event's `name` override.
    expect(event.name).toBe('cms_cta_click');
    // Ambient ab-context stamped from the runtime.
    expect(event.ab).toEqual({ testId: 't1', branchId: 'b1' });
    // Source mapped from the enclosing BlockTracker (trackingId → handle).
    expect(event.source).toEqual({ handle: 'cta-main', type: 'ctaSection' });
    // Params forwarded, event marked anonymous (consent-free aggregate leg).
    expect(event.params).toEqual({ placement: 'cta' });
    expect(event.anonymous).toBe(true);
  });
});
