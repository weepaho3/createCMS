import type { ConsentGate } from './gate';

import { parseConsentEntry } from './gate';

// ============================================================================
// Consent auto-read (Google Consent Mode v2 on window.dataLayer)
// ============================================================================

type DataLayer = unknown[] & { __cmsConsentObserved?: boolean };

function routeConsentEntry(gate: ConsentGate, entry: unknown): void {
  const parsed = parseConsentEntry(entry);
  if (!parsed) return;
  // A `default` only seeds state; an `update` (or explicit setConsent) is the
  // decision that may resolve the gate.
  if (parsed.mode === 'default') gate.applyDefault(parsed.state);
  else gate.applyUpdate(parsed.state);
}

/**
 * Zero-config consent: reads Consent Mode v2 commands off `window.dataLayer`
 * (already-present `default`/`update` entries and future pushes) and feeds the
 * gate. Resilient to GTM/gtag.js loading later, which reassigns `dataLayer` or
 * its `push` and would discard an in-place patch, via a short re-scan poll over
 * the wait window that re-reads `window.dataLayer` fresh each tick (and re-scans
 * from 0 if the array was replaced). The `push` patch is only a fast path.
 */
export function startConsentAutoRead(gate: ConsentGate): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { dataLayer?: DataLayer };

  let scannedArray: DataLayer | null = null;
  let idx = 0;

  const scan = () => {
    const dl: DataLayer = (w.dataLayer = w.dataLayer || []);
    if (dl !== scannedArray) {
      // First scan, or the host (GTM) replaced the array; re-read from 0.
      scannedArray = dl;
      idx = 0;
    }
    for (; idx < dl.length; idx++) routeConsentEntry(gate, dl[idx]);

    // Best-effort fast path: observe pushes on the current array (once).
    if (!dl.__cmsConsentObserved) {
      dl.__cmsConsentObserved = true;
      const originalPush = dl.push.bind(dl);
      dl.push = ((...args: unknown[]) => {
        const ret = originalPush(...args);
        try {
          for (const arg of args) routeConsentEntry(gate, arg);
        } catch {
          // Never let consent observation break a host dataLayer push.
        }
        return ret;
      }) as typeof dl.push;
    }
  };

  scan();

  // Poll fallback: survives GTM clobbering the push hook / replacing the array.
  const interval = setInterval(() => {
    if (gate.isResolved()) {
      clearInterval(interval);
      return;
    }
    try {
      scan();
    } catch {
      // ignore
    }
  }, 300);
}
