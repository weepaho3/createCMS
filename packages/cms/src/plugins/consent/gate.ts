import type { ConsentPurpose, ConsentSignal, ConsentState } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Default-deny: nothing is granted until a CMP / Consent Mode signal says so. */
export const DENIED_ALL: ConsentState = {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
};

/**
 * How long (ms) to buffer events before resolving the gate when no consent
 * DECISION has arrived yet — the Consent Mode `wait_for_update` window. Render
 * is NEVER blocked on this; only event emission waits.
 */
export const CONSENT_WAIT_MS = 2000;

// ============================================================================
// Pure: parse Consent Mode v2 entries off a dataLayer
// ============================================================================

const SIGNALS: ConsentPurpose[] = [
  'analytics_storage',
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
];

function isSignal(value: unknown): value is ConsentSignal {
  return value === 'granted' || value === 'denied';
}

/** `default` = the pre-interaction seed; `update` = a real consent decision. */
export type ConsentMode = 'default' | 'update';

export type ParsedConsentEntry = {
  mode: ConsentMode;
  state: Partial<ConsentState>;
};

/**
 * Extracts the mode + partial {@link ConsentState} from a single dataLayer entry
 * IF it is a Consent Mode command (`gtag('consent','default'|'update',{...})`,
 * which lands on the dataLayer as an arguments-like `['consent', mode, params]`).
 * Returns `null` for any non-consent entry. The `mode` matters: a `default` only
 * seeds state, while an `update` is the user's decision (see {@link ConsentGate}).
 */
export function parseConsentEntry(entry: unknown): ParsedConsentEntry | null {
  if (entry == null || typeof entry !== 'object') return null;
  // Works for both real arrays and the arguments-objects gtag pushes.
  const indexed = entry as Record<number, unknown>;
  if (indexed[0] !== 'consent') return null;
  const mode = indexed[1];
  if (mode !== 'default' && mode !== 'update') return null;
  const params = indexed[2];
  if (params == null || typeof params !== 'object') return null;

  const out: Partial<ConsentState> = {};
  for (const signal of SIGNALS) {
    const v = (params as Record<string, unknown>)[signal];
    if (isSignal(v)) out[signal] = v;
  }
  return Object.keys(out).length > 0 ? { mode, state: out } : null;
}

/** Parses every Consent Mode command on a dataLayer, in order. */
export function parseConsentEntries(
  dataLayer: readonly unknown[],
): ParsedConsentEntry[] {
  const out: ParsedConsentEntry[] = [];
  for (const entry of dataLayer) {
    const parsed = parseConsentEntry(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ============================================================================
// Pure: the consent gate (default-deny, buffer-then-flush state machine)
// ============================================================================

type BufferedEffect = { effect: () => void; onDrop?: () => void };

export type ConsentGate = {
  getState(): ConsentState;
  isGranted(purpose: ConsentPurpose): boolean;
  /** True once a real decision arrived or the wait-window elapsed. */
  isResolved(): boolean;
  /**
   * Seed state from a Consent Mode `default` command. Updates state but does NOT
   * resolve the gate — a denied default must not collapse the wait-window before
   * the async CMP `update` arrives.
   */
  applyDefault(update: Partial<ConsentState>): void;
  /**
   * Apply a real consent decision — a Consent Mode `update` or an explicit host
   * `setConsent`. Resolves + drains the buffer once the decision carries an
   * `analytics_storage` value (a partial update touching only `ad_*` keeps the
   * gate pending so a later analytics grant still flushes).
   */
  applyUpdate(update: Partial<ConsentState>): void;
  /** Resolve the wait-window with whatever we have (stays default-deny). */
  resolve(): void;
  /**
   * Queue an `analytics_storage`-gated side effect. Runs immediately if already
   * resolved+granted, calls `onDrop` if resolved+denied, and buffers while
   * pending. `onDrop` lets callers release a dedup guard so a later grant can
   * re-fire.
   */
  run(effect: () => void, onDrop?: () => void): void;
  /** Subscribe to state changes (apply / resolve / reset). Returns unsubscribe. */
  onChange(
    listener: (state: ConsentState, resolved: boolean) => void,
  ): () => void;
  /** Revoke consent (e.g. `abTest.reset()`): back to denied, stops fan-out. */
  reset(): void;
};

export function createConsentGate(
  initial: ConsentState = DENIED_ALL,
): ConsentGate {
  let state: ConsentState = { ...initial };
  let resolved = false;
  let buffer: BufferedEffect[] = [];
  const listeners = new Set<(s: ConsentState, r: boolean) => void>();

  const notify = () => {
    for (const l of listeners) l({ ...state }, resolved);
  };

  const drain = () => {
    if (!resolved) return;
    const pending = buffer;
    buffer = [];
    const granted = state.analytics_storage === 'granted';
    for (const item of pending) {
      if (granted) item.effect();
      else item.onDrop?.();
    }
  };

  return {
    getState() {
      return { ...state };
    },
    isGranted(purpose) {
      return state[purpose] === 'granted';
    },
    isResolved() {
      return resolved;
    },
    applyDefault(update) {
      state = { ...state, ...update };
      notify();
    },
    applyUpdate(update) {
      state = { ...state, ...update };
      // Only a decision about analytics (or one arriving after we've already
      // resolved) drains. A partial update touching only ad_* keeps buffering.
      if ('analytics_storage' in update || resolved) {
        resolved = true;
        notify();
        drain();
      } else {
        notify();
      }
    },
    resolve() {
      if (resolved) return;
      resolved = true;
      notify();
      drain();
    },
    run(effect, onDrop) {
      if (!resolved) {
        buffer.push({ effect, onDrop });
        return;
      }
      if (state.analytics_storage === 'granted') effect();
      else onDrop?.();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      const pending = buffer;
      buffer = [];
      state = { ...DENIED_ALL };
      resolved = true;
      for (const item of pending) item.onDrop?.();
      notify();
    },
  };
}

// ============================================================================
// Pure: visitor-key resolution (consent-gated persistence)
// ============================================================================

/**
 * Decides which visitor key to use and whether it may be persisted. Before
 * `analytics_storage` is granted, the key is in-memory only (page lifetime, no
 * device storage). On grant, an existing cookie wins; otherwise the in-memory
 * key is promoted to the cookie so a buffered impression and later events share
 * one identity.
 */
export function resolveVisitorKey(opts: {
  granted: boolean;
  cookieKey: string | null;
  memKey: string | null;
  generate: () => string;
}): { key: string; persist: boolean; memKey: string } {
  if (opts.granted) {
    if (opts.cookieKey) {
      return { key: opts.cookieKey, persist: false, memKey: opts.cookieKey };
    }
    const key = opts.memKey ?? opts.generate();
    return { key, persist: true, memKey: key };
  }
  const key = opts.memKey ?? opts.generate();
  return { key, persist: false, memKey: key };
}
