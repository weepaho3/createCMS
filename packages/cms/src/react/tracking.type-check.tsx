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
import type {
  BlockDefinition,
  CollectionDefinition,
} from '../core/types/definitions';

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

// ---------------------------------------------------------------------------
// Regression guard: the DECLARED collection form (e.g. `typeof myCollection`,
// where `events?` is optional, so `TBlocks[K]['events']` is `TEvents | undefined`).
// FunctionalBlocks must `NonNullable` the key-filter access too — otherwise
// `(TEvents | undefined) extends Record<…>` is false for every block and the
// facade resolves to no functional blocks. The `as const satisfies` form above
// keeps `events` present, so it can't catch this; this section can.
// ---------------------------------------------------------------------------
type DeclaredEvents = { submit: {}; click: {} };
type DeclaredBlocks = {
  hero: BlockDefinition<{ headline: { type: 'string'; label: 'H' } }, {}>;
  signupForm: BlockDefinition<
    { cta: { type: 'string'; label: 'CTA' } },
    DeclaredEvents
  >;
};
declare const declaredCol: CollectionDefinition<
  { title: { type: 'string'; label: 'T'; required: true } },
  DeclaredBlocks
>;
const declaredTracked = createTrackedBlocks(declaredCol);

function DeclaredFormTrackingTypeCheck() {
  // signupForm declared `events` → it MUST be a selectable functional block:
  const { fire } = declaredTracked.useTrackedBlock('signupForm');
  fire('submit');
  // @ts-expect-error unknown event name
  fire('typo');
  // @ts-expect-error 'hero' has no events → not a functional block
  declaredTracked.useTrackedBlock('hero');
  return null;
}

void DeclaredFormTrackingTypeCheck;
