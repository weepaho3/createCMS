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
 * The consent plugin. Owns the generic Google Consent Mode v2 infrastructure
 * (the buffer-then-flush gate, the dataLayer/CMP auto-read, the state model)
 * that any consumer can ride — A/B tracking, analytics sinks, or consent-gated
 * rendering of embedded third-party content.
 *
 * Server-side it is a marker plugin (no schema/endpoints/hooks): consent is a
 * client-side concern today. The client capability (gate + setConsent/getConsent
 * + the <ConsentGate> render wrapper) is exposed via the client entry.
 */
export function consent(): CMSPlugin {
  return { id: PLUGIN_ID };
}
