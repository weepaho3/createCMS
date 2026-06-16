import type { ReactNode } from 'react';

import { useEffect, useState } from 'react';

import type {
  CMSClientPlugin,
  CMSClientStore,
  CMSFetch,
} from '../../client/types';
import type { ConsentPurpose, ConsentState } from './types';

import { startConsentAutoRead } from './auto-read';
import { CONSENT_WAIT_MS, createConsentGate } from './gate';

export type { ConsentPurpose, ConsentSignal, ConsentState } from './types';
export type { ConsentGate } from './gate';

const PLUGIN_ID = 'consent' as const;

/** Shallow-equal two consent states across the four Consent Mode v2 signals. */
function sameConsent(a: ConsentState, b: ConsentState): boolean {
  return (
    a.analytics_storage === b.analytics_storage &&
    a.ad_storage === b.ad_storage &&
    a.ad_user_data === b.ad_user_data &&
    a.ad_personalization === b.ad_personalization
  );
}

/** Live snapshot of the gate, re-rendered via {@link useConsentState}. */
export type ConsentSnapshot = {
  state: ConsentState;
  /** True once a real decision arrived or the wait-window elapsed. */
  resolved: boolean;
  isGranted: (purpose: ConsentPurpose) => boolean;
};

/** Props for the bound `<ConsentGate>` render wrapper. */
export type ConsentGateProps = {
  /** The Consent Mode v2 signal that must be `granted` to render `children`. */
  purpose: ConsentPurpose;
  /** Rendered once `purpose` is granted (e.g. the embedded YouTube/Maps iframe). */
  children: ReactNode;
  /**
   * Rendered while `purpose` is denied or still pending (default-deny). A
   * privacy-friendly placeholder lives here — never the third-party embed.
   */
  fallback?: ReactNode;
};

/**
 * Client plugin that exposes the generic consent gate under its own namespace,
 * decoupled from A/B. Lets any consumer gate side effects or rendering of
 * embedded third-party content (YouTube, Maps, Vimeo) behind Google Consent
 * Mode v2 — render only after the visitor consents.
 *
 * The gate is created once per client (closed over in `getActions`, like
 * `abTest.useLiveResults`), auto-reads Consent Mode commands off the dataLayer,
 * and resolves after a short wait-window. Reached via the client proxy:
 *
 * ```tsx
 * import { consentClient } from '@createcms/core/plugins/consent/client';
 *
 * const client = createCMSClient<typeof cms>({
 *   baseURL: '/api/cms',
 *   plugins: [consentClient()],
 * });
 *
 * // Drive consent from a CMP callback:
 * client.consent.setConsent({ ad_storage: 'granted' });
 *
 * // Gate an embed (component bound to this client's gate):
 * const { ConsentGate } = client.consent;
 * <ConsentGate purpose="ad_storage" fallback={<p>Bitte Cookies akzeptieren.</p>}>
 *   <iframe src="https://www.youtube.com/embed/..." />
 * </ConsentGate>
 * ```
 */
export function consentClient() {
  return {
    id: PLUGIN_ID,

    getActions(_$fetch: CMSFetch, _$store: CMSClientStore, _baseURL: string) {
      const gate = createConsentGate();

      // Zero-config Consent Mode read + a wait-window fallback so a denied
      // default doesn't strand the gate. Render never waits on this; only the
      // gate's buffered side effects do.
      startConsentAutoRead(gate);
      if (typeof window !== 'undefined') {
        setTimeout(() => gate.resolve(), CONSENT_WAIT_MS);
      }

      /** React hook: subscribe to the gate and re-render on every change. */
      function useConsentState(): ConsentSnapshot {
        const [snap, setSnap] = useState(() => ({
          state: gate.getState(),
          resolved: gate.isResolved(),
        }));

        useEffect(() => {
          // Re-sync in case a decision landed in the render->effect gap. The
          // functional updater returns `prev` when nothing actually changed so
          // React bails out via Object.is — no wasted render on the common path.
          setSnap((prev) => {
            const state = gate.getState();
            const resolved = gate.isResolved();
            return prev.resolved === resolved && sameConsent(prev.state, state)
              ? prev
              : { state, resolved };
          });
          return gate.onChange((state, resolved) =>
            setSnap({ state, resolved }),
          );
        }, []);

        return {
          state: snap.state,
          resolved: snap.resolved,
          isGranted: (purpose) => snap.state[purpose] === 'granted',
        };
      }

      /** Render wrapper bound to this client's gate (default-deny). */
      function ConsentGate(props: ConsentGateProps): ReactNode {
        const { isGranted } = useConsentState();
        return isGranted(props.purpose)
          ? props.children
          : (props.fallback ?? null);
      }

      return {
        consent: {
          /**
           * Tell the CMS about the visitor's consent (Consent Mode v2) — a real
           * decision (treated like a Consent Mode `update`). Optional: the gate
           * also auto-reads Consent Mode commands off the dataLayer; when running
           * GTM, calling this from the CMP's update callback is the most reliable
           * path.
           */
          setConsent(consent: Partial<ConsentState>) {
            gate.applyUpdate(consent);
          },

          /** Read the current consent state. */
          getConsent(): ConsentState {
            return gate.getState();
          },

          /** Whether a given Consent Mode v2 signal is currently granted. */
          isGranted(purpose: ConsentPurpose): boolean {
            return gate.isGranted(purpose);
          },

          /** True once a real decision arrived or the wait-window elapsed. */
          isResolved(): boolean {
            return gate.isResolved();
          },

          /** Subscribe to consent changes. Returns an unsubscribe function. */
          onChange(
            listener: (state: ConsentState, resolved: boolean) => void,
          ): () => void {
            return gate.onChange(listener);
          },

          /** Revoke consent in-session: back to default-deny. */
          reset() {
            gate.reset();
          },

          useConsentState,
          ConsentGate,
        },
      };
    },
  } satisfies CMSClientPlugin;
}
