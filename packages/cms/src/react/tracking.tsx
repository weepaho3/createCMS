'use client';

import type { ComponentProps, ReactNode } from 'react';

import * as React from 'react';
import { createContext, useCallback, useContext, useMemo } from 'react';

import type {
  AnyBlockDefinition,
  BlockEventFire,
  BlockProperty,
  CollectionDefinition,
  EventDeclaration,
} from '../core/types/definitions';
import type { ClientCMSEvent } from '../plugins/ab-test/client-sinks';

import { resolveWireName } from '../core/events';

export { resolveWireName };

// ============================================================================
// M3c — BlockTracker: fire declared block events from functional blocks
// ============================================================================
//
// renderContentNode (RSC) wraps each FUNCTIONAL block (one in BlocksMap._events)
// in <BlockTracker> — children-as-props, so the block subtree stays whatever it
// was (RSC for presentational, 'use client' for a block that calls the hook).
// The dispatch + the served {testId, branchId} arrive through a CONSUMER-mounted
// <TrackingRuntimeProvider> (the package NEVER imports the consumer's cmsClient).
// fire() is narrowed PER BLOCK via createTrackedBlocks(collection).useTrackedBlock.

/**
 * The tracking runtime the consumer supplies via {@link TrackingRuntimeProvider}.
 * `dispatch` is the M3a sink fan-out (e.g. `cmsClient.abTest.dispatchEvent`); the
 * package reaches it through context, never by importing the client instance.
 * `ab` is the ambient, server-served A/B attribution for THIS page — single-valued
 * per the XOR rule, so every block event on the page binds to the one running test.
 */
export type TrackingRuntime = {
  dispatch: (event: ClientCMSEvent) => void;
  ab?: { testId: string; branchId: string };
};

const TrackingRuntimeContext = createContext<TrackingRuntime | null>(null);

/**
 * Mount once, high in the CLIENT tree, wrapping the rendered page. Supplies the
 * dispatch + ambient ab-context every {@link BlockTracker} below it reads.
 */
export function TrackingRuntimeProvider({
  runtime,
  children,
}: {
  runtime: TrackingRuntime;
  children: ReactNode;
}) {
  return (
    <TrackingRuntimeContext.Provider value={runtime}>
      {children}
    </TrackingRuntimeContext.Provider>
  );
}

/** Per-block identity injected by the renderer from the RSC node (serializable). */
export type BlockTrackingCtx = {
  blockType: string;
  blockId: string;
  /** The block's authored, branch-stable goal anchor (`trackingId` property). */
  trackingId?: string;
  /** The block's declared events — used to resolve wire names + dev-validate. */
  events?: Record<string, EventDeclaration>;
};

const BlockTrackingContext = createContext<BlockTrackingCtx | null>(null);

/**
 * Scopes the per-block tracking identity for its children. Rendered BY
 * renderContentNode around a functional block (children-as-props — the wrapped
 * subtree is server-rendered and just passed through). Itself renders nothing but
 * the context provider, so it is safe during SSR and never blocks paint.
 */
export function BlockTracker({
  blockType,
  blockId,
  trackingId,
  events,
  children,
}: BlockTrackingCtx & { children: ReactNode }) {
  const value = useMemo(
    () => ({ blockType, blockId, trackingId, events }),
    [blockType, blockId, trackingId, events],
  );
  return (
    <BlockTrackingContext.Provider value={value}>
      {children}
    </BlockTrackingContext.Provider>
  );
}

/**
 * Builds the {@link ClientCMSEvent} a fired block event dispatches. Pure +
 * exported so it is unit-testable without a React renderer: stamps the ambient
 * ab-context, maps the block identity to `source` (trackingId → handle, type →
 * block type), and marks it anonymous (the consent-free aggregate path; the
 * consent-gated legs live inside dispatch).
 */
export function buildBlockEvent(
  key: string,
  params: Record<string, string | number | boolean> | undefined,
  runtime: TrackingRuntime,
  block: BlockTrackingCtx | null,
  interactionId?: string,
): ClientCMSEvent {
  return {
    // The typed API fires the event KEY; the wire (GA4/dataLayer + the stored
    // event_type) carries the resolved wire name. Outside a BlockTracker
    // (block === null) there is nothing to resolve against, so the key passes.
    name: block ? resolveWireName(key, block.blockType, block.events) : key,
    anonymous: true,
    ...(runtime.ab ? { ab: runtime.ab } : {}),
    ...(block
      ? { source: { handle: block.trackingId, type: block.blockType } }
      : {}),
    ...(interactionId ? { interactionId } : {}),
    ...(params ? { params } : {}),
  };
}

/**
 * The UNTYPED core hook. Reads the runtime + the per-block identity from context
 * and returns a `fire` that builds a {@link ClientCMSEvent} and dispatches it
 * (anonymous aggregate by design — the consent-gated legs are inside dispatch).
 * If no {@link TrackingRuntimeProvider} is mounted, `fire` is a dev-warned no-op
 * (degrade-safe). Prefer the typed {@link createTrackedBlocks} facade.
 */
export function useBlockTrackerRaw(expectedBlockType?: string): {
  fire: (
    name: string,
    params?: Record<string, string | number | boolean>,
  ) => void;
  /** Like {@link fire} but stamps a funnel `interactionId` (M4 — <TrackedForm>). */
  fireInteraction: (
    name: string,
    interactionId: string,
    params?: Record<string, string | number | boolean>,
  ) => void;
} {
  const runtime = useContext(TrackingRuntimeContext);
  const block = useContext(BlockTrackingContext);

  const emit = useCallback(
    (
      name: string,
      params: Record<string, string | number | boolean> | undefined,
      interactionId: string | undefined,
    ) => {
      if (!runtime) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[cms] useBlockTracker fire("${name}") called with no <TrackingRuntimeProvider> mounted — event dropped.`,
          );
        }
        return;
      }
      if (process.env.NODE_ENV !== 'production') {
        // Fired outside any <BlockTracker> (e.g. a <TrackedForm> not inside a
        // functional block): the event name is NOT wire-resolved and carries no
        // source, so it won't match a picked goal. Loud, not silent.
        if (!block) {
          console.warn(
            `[cms] fire("${name}") called outside a <BlockTracker> — the event name is unresolved (no wire name) and has no source; render the firing component inside a functional block.`,
          );
        }
        // The block key is a TYPE-only selector; the dispatched source is the
        // ENCLOSING <BlockTracker>. Warn when they disagree (wrong-key call, or
        // a call from outside the block's own subtree) so a mis-stamped event
        // is loud, not silent.
        if (
          block &&
          expectedBlockType &&
          block.blockType !== expectedBlockType
        ) {
          console.warn(
            `[cms] useTrackedBlock("${expectedBlockType}").fire is running inside a "${block.blockType}" block — the event is stamped with "${block.blockType}". Call it from the block's own component.`,
          );
        }
        if (block?.events && !(name in block.events)) {
          console.warn(
            `[cms] fire("${name}") is not a declared event of block "${block.blockType}".`,
          );
        }
      }
      runtime.dispatch(
        buildBlockEvent(name, params, runtime, block, interactionId),
      );
    },
    [runtime, block, expectedBlockType],
  );

  const fire = useCallback(
    (name: string, params?: Record<string, string | number | boolean>) =>
      emit(name, params, undefined),
    [emit],
  );

  const fireInteraction = useCallback(
    (
      name: string,
      interactionId: string,
      params?: Record<string, string | number | boolean>,
    ) => emit(name, params, interactionId),
    [emit],
  );

  return { fire, fireInteraction };
}

// ============================================================================
// Typed facade — fire narrowed to a block's declared events
// ============================================================================

/** The functional blocks of a collection (those that declared a non-empty `events`).
 *  `events` is optional on `BlockDefinition`, so the key-filter must `NonNullable`
 *  the access too — otherwise `(TEvents | undefined) extends Record<…>` is false for
 *  every block and the facade resolves to no functional blocks. (The value side
 *  already strips it.) */
type FunctionalBlocks<TBlocks extends Record<string, AnyBlockDefinition>> = {
  [K in keyof TBlocks as NonNullable<TBlocks[K]['events']> extends Record<
    string,
    EventDeclaration
  >
    ? [keyof NonNullable<TBlocks[K]['events']>] extends [never]
      ? never
      : K
    : never]: NonNullable<TBlocks[K]['events']>;
};

/**
 * Builds the per-collection typed tracking facade. Pass the collection
 * DEFINITION (single source of truth, same object as `createBlocksMap`).
 * `useTrackedBlock('signupForm').fire` is narrowed to that block's declared
 * events — `fire('typo')`, a missing required param, or a wrong-typed param are
 * all compile errors; a non-functional block key is rejected too.
 *
 * The block key is a TYPE-level selector: the dispatched source is always the
 * ENCLOSING <BlockTracker> (set by the renderer from the rendered node), so call
 * `useTrackedBlock('x')` from block x's own component. A mismatch dev-warns.
 *
 * @example
 * ```tsx
 * // blocks/index.tsx
 * export const trackedBlocks = createTrackedBlocks(pagesCollection);
 *
 * // signup-form.tsx ('use client')
 * const { fire } = trackedBlocks.useTrackedBlock('signupForm');
 * <form action={() => fire('submitSuccess', { plan: 'pro' })} />
 * ```
 */
export function createTrackedBlocks<
  TProps extends Record<string, BlockProperty>,
  TBlocks extends Record<string, AnyBlockDefinition>,
>(_collection: CollectionDefinition<TProps, TBlocks>) {
  function useTrackedBlock<K extends keyof FunctionalBlocks<TBlocks> & string>(
    block: K,
  ): { fire: BlockEventFire<FunctionalBlocks<TBlocks>[K]> } {
    // The block-key literal selects the event union at the TYPE level; at
    // runtime the BlockTracker has already scoped identity, so the raw hook's
    // fire forwards the (compile-checked) name + params unchanged. The cast is
    // the single controlled erasure point (mirrors BlocksMap._components: any).
    // `block` is passed for the dev-mismatch warning, not for dispatch.
    return useBlockTrackerRaw(block) as {
      fire: BlockEventFire<FunctionalBlocks<TBlocks>[K]>;
    };
  }
  return { useTrackedBlock };
}

// ============================================================================
// TrackedForm — the funnel golden path (M4)
// ============================================================================

type TrackedFormState = { ok: boolean };

/**
 * Wraps a `<form>` so one submit becomes a funnel: it mints an `interactionId`,
 * fires the `attempt` event when the submit STARTS, runs `action`, and fires the
 * `success` event only if `action` resolves — both legs share the interactionId
 * so `completion_rate` (= successes / attempts) can pair them. A throw from
 * `action` leaves the attempt unmatched (a started-but-not-completed interaction).
 *
 * Must be rendered inside a functional block (the renderer's <BlockTracker>), so
 * the events stamp that block's source. Uses React 19 `useActionState` — render
 * it only on React 19 (the rest of this module works on 18). `attempt`/`success`
 * are the block's declared event keys (a typo dev-warns via the raw tracker).
 *
 * @example
 * ```tsx
 * <TrackedForm attempt="submitAttempt" success="submitSuccess" action={subscribe}>
 *   <input name="email" /> <button>Join</button>
 * </TrackedForm>
 * ```
 */
export function TrackedForm({
  attempt,
  success,
  action,
  children,
  ...formProps
}: {
  attempt: string;
  success: string;
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
} & Omit<ComponentProps<'form'>, 'action' | 'children'>) {
  const { fireInteraction } = useBlockTrackerRaw();

  const run = useCallback(
    async (_prev: TrackedFormState, formData: FormData) => {
      const interactionId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `ix_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
      fireInteraction(attempt, interactionId);
      try {
        await action(formData);
        fireInteraction(success, interactionId);
        return { ok: true };
      } catch {
        return { ok: false }; // attempt stays unmatched (failed interaction)
      }
    },
    [attempt, success, action, fireInteraction],
  );

  // React 19. Namespaced so importing this module never breaks on React 18 —
  // only rendering <TrackedForm> requires 19.
  const [, formAction] = React.useActionState<TrackedFormState, FormData>(run, {
    ok: false,
  });

  return (
    <form action={formAction} {...formProps}>
      {children}
    </form>
  );
}
