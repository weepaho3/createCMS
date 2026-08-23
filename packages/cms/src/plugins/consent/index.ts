import type { CMSPlugin } from '../../core/types/plugin';

export type { ConsentSignal, ConsentState, ConsentPurpose } from './types';
export type { ConsentGate, ConsentMode, ParsedConsentEntry } from './gate';
export {
  DENIED_ALL,
  CONSENT_WAIT_MS,
  createConsentGate,
  parseConsentEntry,
  parseConsentEntries,
  resolveVisitorKey,
} from './gate';
export { startConsentAutoRead } from './auto-read';

const PLUGIN_ID = 'consent' as const;

/**
 * The consent plugin. Provides generic Google Consent Mode v2 infrastructure
 * (buffer-then-flush gate, dataLayer/CMP auto-read, state model) for
 * consumers such as A/B tracking and consent-gated rendering.
 *
 * Server-side it is a marker plugin (no schema/endpoints/hooks); the client
 * capability (gate + setConsent/getConsent + the <ConsentGate> render wrapper)
 * is exposed via the client entry.
 */
export function consent(): CMSPlugin {
  return { id: PLUGIN_ID };
}
