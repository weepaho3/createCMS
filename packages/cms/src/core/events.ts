import type { EventDeclaration } from './types/definitions';

/**
 * Resolves the GA4/dataLayer wire name for a block event key: the author's
 * `EventDeclaration.name` override, else the default `cms_<blockType>_<key>`.
 * Pure + framework-free so BOTH the client tracker (react/tracking.tsx, where a
 * fire happens) and the server goal-picker (ab-test listGoalEvents) resolve
 * names identically: the stored event_type and the offered goal must be the
 * same string.
 */
export function resolveWireName(
  key: string,
  blockType: string,
  events: Record<string, EventDeclaration> | undefined,
): string {
  return events?.[key]?.name ?? `cms_${blockType}_${key}`;
}
