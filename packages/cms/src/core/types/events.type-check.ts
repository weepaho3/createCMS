/**
 * Type-level guarantees for event declarations + the derived `fire` signature.
 *
 * This file ships NOTHING (no `exports` entry references it, so bunchee never
 * builds it) but IS covered by `tsc --noEmit` (the type-check gate includes
 * `src` and excludes only `*.test.ts`). A `@ts-expect-error` that stops being an
 * error fails the gate ("unused '@ts-expect-error' directive"), so these double
 * as the M2 "fire('typo') / missing param are compile errors" tests.
 */
import type { BlockEventFire } from './definitions';

import {
  defineBlock,
  defineCollection,
  defineCollections,
  defineRoot,
  trackingId,
} from '../define';

// --- defineBlock infers events (const), narrowing the fire union ------------

const signupForm = defineBlock({
  label: 'Signup Form',
  properties: {
    ...trackingId(),
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
});

// `events` is inferred with literal keys, not widened to a generic record.
type SignupEvents = NonNullable<(typeof signupForm)['events']>;
declare const fire: BlockEventFire<SignupEvents>;

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

// --- a non-functional block has no fireable events --------------------------

const heading = defineBlock({
  label: 'Heading',
  properties: { text: { type: 'string', required: true, label: 'Text' } },
});
declare const fireHeading: BlockEventFire<
  NonNullable<(typeof heading)['events']>
>;
// @ts-expect-error no events declared → nothing is fireable
fireHeading('submit');

// --- a functional block MUST declare a trackingId property (compile-pflicht) -

// @ts-expect-error declaring `events` without a trackingId property is rejected
const missingTrackingId = defineBlock({
  label: 'No Tracking',
  properties: { cta: { type: 'string', required: true, label: 'CTA' } },
  events: { submit: {} },
});
void missingTrackingId;

// --- a functional block must compile when registered in a collection --------
// (regression test for the M2a fix: defineCollection's TBlocks constraint must
// accept the 2-generic/events-carrying BlockDefinition, not just the 1-arg form.)

const pageRoot = defineRoot({
  properties: { title: { type: 'string', required: true, label: 'Title' } },
});

const pages = defineCollection({
  label: 'Pages',
  root: pageRoot,
  blocks: { signupForm, heading },
});
const okCollections = defineCollections({ pages });

// --- reference validation must STILL fire for events-carrying blocks --------
// (regression test for the M2a fix: ExtractReferencedCollections must infer
// props past the 2nd generic, else a bad `collection:` on an events-block is
// silently un-validated.)

const linker = defineBlock({
  label: 'Linker',
  properties: {
    ...trackingId(),
    target: { type: 'reference', collection: 'doesNotExist', label: 'Target' },
  },
  events: { clicked: {} },
});
const linkerCol = defineCollection({
  label: 'Linker',
  root: pageRoot,
  blocks: { linker },
});
// @ts-expect-error a reference to a missing collection on an events-block is still flagged
defineCollections({ linkerCol });

// Reference the bindings so unused-symbol checks stay happy.
export type __SignupEvents = SignupEvents;
export type __Heading = typeof heading;
export type __Ok = typeof okCollections;
