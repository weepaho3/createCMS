import type {
  BlockProperty,
  HasRequiredKeys,
  InferBlockProperties,
} from './properties';

// ============================================================================
// Event declarations (functional blocks declare the events they emit)
// ============================================================================

/** Scalar property subset usable as an event parameter (no references/media). */
export type ScalarBlockProperty = Extract<
  BlockProperty,
  { type: 'string' | 'number' | 'boolean' | 'select' | 'date' }
>;

/**
 * Declares a meaningful event a functional block can emit (e.g. a form's
 * `submitSuccess`). Living on the block DEFINITION makes it the single source
 * of truth for the typed `fire(...)` union, the test-creation goal picker, and
 * the analytics wire name. `name` overrides the GA4/dataLayer wire name
 * (defaults to `cms_<blockType>_<eventKey>`, computed by the measurement
 * layer). Whether an event counts as a conversion is decided per test in the
 * UI, not here.
 */
export type EventDeclaration = {
  /** Analytics wire-name override (snake_case). Defaults to cms_<type>_<key>. */
  name?: string;
  params?: Record<string, ScalarBlockProperty>;
  label?: string;
};

/** Parameters object type for one event declaration (or `undefined` if none). */
export type InferEventParams<E extends EventDeclaration> = E extends {
  params: infer P extends Record<string, BlockProperty>;
}
  ? InferBlockProperties<P>
  : undefined;

/** Call-args tuple for `fire`: required iff the event declares a required param. */
type EventFireArgs<E extends EventDeclaration> = E extends {
  params: infer P extends Record<string, BlockProperty>;
}
  ? HasRequiredKeys<P> extends true
    ? [params: InferBlockProperties<P>]
    : [params?: InferBlockProperties<P>]
  : [];

/** Event keys a block declares. */
export type BlockEventNames<TEvents extends Record<string, EventDeclaration>> =
  keyof TEvents & string;

/**
 * The typed `fire` signature derived from a block's event declarations; the
 * runtime tracker implements this. `fire('unknown')`, a missing required
 * param, and a wrong-typed param are all compile errors.
 */
export type BlockEventFire<TEvents extends Record<string, EventDeclaration>> = <
  K extends BlockEventNames<TEvents>,
>(
  name: K,
  ...args: EventFireArgs<TEvents[K]>
) => void;

/**
 * Compile-time requirement: a block that declares `events` (a functional block)
 * MUST carry a `trackingId` string property, the stable, per-instance,
 * cross-branch goal anchor. Intersected into `defineBlock`'s parameter so a
 * functional block missing it fails to compile. Spread `...trackingId()` into
 * `properties` to satisfy it. (The property is optional at create; the VALUE
 * is enforced at publish by the tracking-id guard.)
 */
export type RequireTrackingId<
  TProps extends Record<string, BlockProperty>,
  TEvents extends Record<string, EventDeclaration>,
> = [keyof TEvents] extends [never]
  ? unknown // no events at all (empty)
  : string extends keyof TEvents
    ? unknown // the `Record<string, never>` default (index signature) = no events
    : TProps extends { trackingId: { type: 'string' } }
      ? unknown
      : {
          __error_missing_trackingId: "A block that declares `events` must include a `trackingId` property of type 'string' — spread `...trackingId()` into `properties`.";
        };
