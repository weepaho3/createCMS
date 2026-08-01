import { describe, expect, it } from 'vitest';

import { resolveWireName } from '../../core/events';
import { buildBlockEvent } from '../tracking';

const RUNTIME_WITH_AB = {
  dispatch: () => {},
  ab: { testId: 't1', branchId: 'b1' },
};
const RUNTIME_NO_AB = { dispatch: () => {} };

const BLOCK = {
  blockType: 'ctaSection',
  blockId: 'blk_1',
  trackingId: 'cta-main',
  events: {
    click: { name: 'cms_cta_click' }, // explicit wire-name override
    hover: {}, // no override → default cms_<type>_<key>
  },
};

describe('M3c — resolveWireName', () => {
  it('uses the declared name override when present', () => {
    expect(resolveWireName('click', 'ctaSection', BLOCK.events)).toBe(
      'cms_cta_click',
    );
  });

  it('defaults to cms_<blockType>_<key> when no override', () => {
    expect(resolveWireName('hover', 'ctaSection', BLOCK.events)).toBe(
      'cms_ctaSection_hover',
    );
  });

  it('defaults when there are no declared events at all', () => {
    expect(resolveWireName('x', 'ctaSection', undefined)).toBe(
      'cms_ctaSection_x',
    );
  });
});

describe('M3c — buildBlockEvent', () => {
  it('resolves the wire name + stamps ab, source, params, anonymous', () => {
    expect(
      buildBlockEvent('click', { placement: 'cta' }, RUNTIME_WITH_AB, BLOCK),
    ).toEqual({
      name: 'cms_cta_click', // resolved from the event KEY 'click'
      anonymous: true,
      ab: { testId: 't1', branchId: 'b1' },
      source: { handle: 'cta-main', type: 'ctaSection' },
      params: { placement: 'cta' },
    });
  });

  it('applies the default wire name + omits ab for a non-A/B event', () => {
    const event = buildBlockEvent('hover', undefined, RUNTIME_NO_AB, BLOCK);
    expect(event.name).toBe('cms_ctaSection_hover');
    expect('ab' in event).toBe(false);
    expect(event.source).toEqual({ handle: 'cta-main', type: 'ctaSection' });
    expect(event.anonymous).toBe(true);
  });

  it('passes the raw key + omits source when fired outside a BlockTracker', () => {
    const event = buildBlockEvent('click', undefined, RUNTIME_WITH_AB, null);
    expect(event.name).toBe('click'); // nothing to resolve against
    expect('source' in event).toBe(false);
    expect(event.ab).toEqual({ testId: 't1', branchId: 'b1' });
  });

  it('omits params when none are passed', () => {
    const event = buildBlockEvent('hover', undefined, RUNTIME_WITH_AB, BLOCK);
    expect('params' in event).toBe(false);
  });
});
