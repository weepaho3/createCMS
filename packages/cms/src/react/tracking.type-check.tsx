/**
 * Type-level guarantees for the M3c typed tracking facade. Ships NOTHING (no
 * `exports` entry references it, so bunchee never builds it) but IS covered by
 * `tsc --noEmit`. A `@ts-expect-error` that stops being an error fails the gate,
 * so this doubles as the "useTrackedBlock('x').fire narrows to x's events" test.
 *
 * The collection is built `as const satisfies CollectionDefinition` — the exact
 * shape a real consumer authors (apps/web's pagesCollection) — because that is
 * what preserves the literal event keys the narrowing depends on. The hooks are
 * called inside a Capitalized function so react-hooks lint treats it as a
 * component; it is never rendered.
 */
import type { CollectionDefinition } from '../core/types/definitions';

import { createTrackedBlocks } from './tracking';

const pages = {
  label: 'Pages',
  root: {
    properties: { title: { type: 'string', required: true, label: 'Title' } },
  },
  blocks: {
    signupForm: {
      label: 'Signup Form',
      properties: {
        trackingId: { type: 'string', label: 'Tracking ID' },
        cta: { type: 'string', required: true, label: 'CTA' },
      },
      events: {
        submit: {},
        submitSuccess: {
          name: 'generate_lead',
          params: {
            plan: { type: 'string', required: true, label: 'Plan' },
            seats: { type: 'number', label: 'Seats' },
          },
        },
      },
    },
    heading: {
      label: 'Heading',
      properties: { text: { type: 'string', required: true, label: 'Text' } },
    },
  },
} as const satisfies CollectionDefinition;

const tracked = createTrackedBlocks(pages);

function TrackingTypeCheck() {
  const { fire } = tracked.useTrackedBlock('signupForm');

  // OK — declared event with no params:
  fire('submit');
  // OK — declared event with its required param (+ optional one):
  fire('submitSuccess', { plan: 'pro' });
  fire('submitSuccess', { plan: 'pro', seats: 5 });

  // @ts-expect-error unknown event name
  fire('typo');
  // @ts-expect-error missing required `plan` param
  fire('submitSuccess');
  // @ts-expect-error `plan` has the wrong type
  fire('submitSuccess', { plan: 123 });
  // @ts-expect-error `seats` has the wrong type
  fire('submitSuccess', { plan: 'pro', seats: 'five' });

  // @ts-expect-error 'heading' is presentational (no events) → not a valid key
  tracked.useTrackedBlock('heading');

  return null;
}

void TrackingTypeCheck;
