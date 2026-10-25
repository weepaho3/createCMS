import type { Breakpoint, Localized, Responsive } from './types';

/** Breakpoints from smallest to largest; `base` sits below `sm`. */
export const BREAKPOINTS: readonly Breakpoint[] = ['sm', 'md', 'lg', 'xl'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a value is a `{ $r: { base, ... } }` wrapper. */
export function isResponsiveValue(
  value: unknown,
): value is { $r: { base: unknown } & Partial<Record<Breakpoint, unknown>> } {
  return isRecord(value) && isRecord(value.$r) && 'base' in value.$r;
}

/** Whether a value is a `{ $l: { [locale]: V } }` wrapper. */
export function isLocalizedValue(
  value: unknown,
): value is { $l: Partial<Record<string, unknown>> } {
  return isRecord(value) && isRecord(value.$l);
}

/**
 * The value of a responsive field at one breakpoint, mobile first: a missing
 * breakpoint inherits from the next smaller one, down to `base`. A plain
 * value is returned as is.
 */
export function resolveResponsive<V>(
  value: Responsive<V>,
  breakpoint: Breakpoint | 'base',
): V {
  if (!isResponsiveValue(value)) return value as V;
  const entries = value.$r as { base: V } & Partial<Record<Breakpoint, V>>;
  if (breakpoint === 'base') return entries.base;
  for (let i = BREAKPOINTS.indexOf(breakpoint); i >= 0; i -= 1) {
    const step = BREAKPOINTS[i];
    if (step !== undefined && entries[step] !== undefined) {
      return entries[step];
    }
  }
  return entries.base;
}

/**
 * The value of a localized field for `locale`, then for each locale of
 * `fallbackChain` in order. `undefined` when none has a value. A plain value
 * is returned as is.
 */
export function resolveLocalized<V>(
  value: Localized<V>,
  locale: string,
  fallbackChain: readonly string[] = [],
): V | undefined {
  if (!isLocalizedValue(value)) return value as V;
  const entries = value.$l as Partial<Record<string, V>>;
  for (const candidate of [locale, ...fallbackChain]) {
    const hit = entries[candidate];
    if (hit !== undefined) return hit;
  }
  return undefined;
}
