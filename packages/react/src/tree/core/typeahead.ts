/**
 * Type-ahead for grids and trees: printable keys typed within
 * `TYPE_AHEAD_MS` of each other build one search string; the focus moves to
 * the next label starting with it.
 */

export const TYPE_AHEAD_MS = 500;

export type TypeAhead = {
  /** Adds `char` (a single printable key) at `now` ms and returns the search string. */
  push(char: string, now: number): string;
  reset(): void;
};

export function createTypeAhead(timeout = TYPE_AHEAD_MS): TypeAhead {
  let buffer = '';
  let last = -Infinity;
  return {
    push(char, now) {
      buffer = now - last > timeout ? char : buffer + char;
      last = now;
      return buffer;
    },
    reset() {
      buffer = '';
      last = -Infinity;
    },
  };
}

/** Whether a `KeyboardEvent.key` starts or continues a type-ahead search. */
export function isTypeAheadKey(
  key: string,
  modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {},
): boolean {
  return (
    key.length === 1 &&
    key !== ' ' &&
    !modifiers.ctrl &&
    !modifiers.meta &&
    !modifiers.alt
  );
}

/**
 * The index of the first label starting with `search` (case-insensitive),
 * searching after `from` and wrapping. A repeated single character cycles
 * through the matches; `-1` without a match.
 */
export function matchTypeAhead(
  labels: readonly string[],
  from: number,
  search: string,
): number {
  if (labels.length === 0 || !search) return -1;
  const needle = search.toLocaleLowerCase();
  const repeated = needle.split('').every((c) => c === needle[0]);
  const start = repeated || needle.length === 1 ? from + 1 : from;
  for (let step = 0; step < labels.length; step++) {
    const i =
      (((start + step) % labels.length) + labels.length) % labels.length;
    const label = labels[i].toLocaleLowerCase();
    if (label.startsWith(needle)) return i;
    if (repeated && label.startsWith(needle[0]) && needle.length > 1) {
      // `aaa` cycles through the labels starting with `a`.
      return i;
    }
  }
  return -1;
}
