import * as React from 'react';

import type { Announce, Politeness } from './core/announcer';

/** Hides content visually while keeping it in the accessibility tree. */
export const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

type Regions = Record<Politeness, { id: number; text: string }>;

/**
 * Two visually hidden live regions (polite `role="status"`, assertive
 * `role="alert"`) and the `announce` function that writes to them. The
 * same text twice in a row is announced twice: every message gets a new
 * key, so the region content changes.
 */
export function useLiveRegions(): {
  announce: Announce;
  regions: React.ReactElement;
} {
  const [regions, setRegions] = React.useState<Regions>({
    polite: { id: 0, text: '' },
    assertive: { id: 0, text: '' },
  });
  const announce = React.useCallback<Announce>(
    (message, politeness = 'polite') => {
      if (!message) return;
      setRegions((current) => ({
        ...current,
        [politeness]: { id: current[politeness].id + 1, text: message },
      }));
    },
    [],
  );
  const element = (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={VISUALLY_HIDDEN}
      >
        <span key={regions.polite.id}>{regions.polite.text}</span>
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        style={VISUALLY_HIDDEN}
      >
        <span key={regions.assertive.id}>{regions.assertive.text}</span>
      </div>
    </>
  );
  return { announce, regions: element };
}
