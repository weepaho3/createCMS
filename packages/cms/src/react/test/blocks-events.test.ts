import { describe, expect, it } from 'vitest';

import type {
  AnyBlockDefinition,
  CollectionDefinition,
} from '../../core/types/definitions';

import { createBlocksMap, extractBlockEvents } from '../blocks';

// A collection with ONE functional block (declares events + trackingId) and
// TWO presentational blocks (no events) — the M3b registration must carry the
// events of the functional block only.
const blocks = {
  signupForm: {
    label: 'Signup Form',
    properties: {
      trackingId: { type: 'string', label: 'Tracking ID' },
      heading: { type: 'string', label: 'Heading' },
    },
    events: {
      submitSuccess: {
        label: 'Signup completed',
        params: { plan: { type: 'string', label: 'Plan' } },
      },
      submitError: {},
    },
  },
  headline: {
    label: 'Headline',
    properties: { text: { type: 'string', label: 'Text' } },
  },
  emptyEvents: {
    label: 'Has an empty events object',
    properties: { text: { type: 'string', label: 'Text' } },
    events: {}, // declared but empty → still presentational
  },
} satisfies Record<string, AnyBlockDefinition>;

const collection = {
  label: 'Test',
  root: { properties: {} },
  blocks,
} satisfies CollectionDefinition;

describe('M3b — extractBlockEvents', () => {
  it('extracts events for functional blocks only', () => {
    expect(extractBlockEvents(blocks)).toEqual({
      signupForm: {
        submitSuccess: {
          label: 'Signup completed',
          params: { plan: { type: 'string', label: 'Plan' } },
        },
        submitError: {},
      },
    });
  });

  it('omits presentational blocks (no events) and empty-events blocks', () => {
    const events = extractBlockEvents(blocks);
    expect('headline' in events).toBe(false);
    expect('emptyEvents' in events).toBe(false);
  });

  it('returns an empty map for undefined blocks', () => {
    expect(extractBlockEvents(undefined)).toEqual({});
  });
});

describe('M3b — createBlocksMap carries the events seam', () => {
  const map = createBlocksMap(collection, {
    signupForm: () => null,
    headline: () => null,
    emptyEvents: () => null,
  });

  it('brands the map and carries every component', () => {
    expect(map.__brand).toBe('BlocksMap');
    expect(Object.keys(map._components).sort()).toEqual([
      'emptyEvents',
      'headline',
      'signupForm',
    ]);
  });

  it('carries _events for functional blocks only', () => {
    expect(Object.keys(map._events)).toEqual(['signupForm']);
    // `type in map._events` is the runtime "is this block functional?" test.
    expect('signupForm' in map._events).toBe(true);
    expect('headline' in map._events).toBe(false);
  });
});
