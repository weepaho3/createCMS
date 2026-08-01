import type { PropertyChange, TextDiffSegment } from './types';

// ============================================================================
// Types
// ============================================================================

type DiffOptions = {
  isRichText?: (path: (string | number)[]) => boolean;
  diffText?: (from: string, to: string) => TextDiffSegment[];
};

// ============================================================================
// Helpers
// ============================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

/**
 * Cell cap for the LCS DP mid-section (trimmed from-length × to-length).
 * Above it the DP is skipped and the middle yields no pairs, so
 * {@link diffArray}'s gap handling pairs the whole middle positionally —
 * coarser alignment, but linear instead of quadratic on huge arrays.
 */
const MAX_LCS_CELLS = 250_000;

/**
 * Longest common subsequence over deep-equal items, as ascending
 * `[fromIndex, toIndex]` pairs. The common prefix and suffix pair directly;
 * the O(n*m) DP covers only the remaining middle and is skipped entirely
 * (no middle pairs) when its cell count exceeds {@link MAX_LCS_CELLS}. Ties
 * in the backtrack prefer consuming from the `from` side, keeping the
 * alignment deterministic.
 */
function lcsPairs(from: unknown[], to: unknown[]): [number, number][] {
  const n = from.length;
  const m = to.length;
  const minLength = Math.min(n, m);

  let prefixLength = 0;
  while (
    prefixLength < minLength &&
    deepEqual(from[prefixLength], to[prefixLength])
  ) {
    prefixLength++;
  }

  let suffixLength = 0;
  while (
    suffixLength < minLength - prefixLength &&
    deepEqual(from[n - 1 - suffixLength], to[m - 1 - suffixLength])
  ) {
    suffixLength++;
  }

  const pairs: [number, number][] = [];
  for (let k = 0; k < prefixLength; k++) pairs.push([k, k]);

  const midN = n - prefixLength - suffixLength;
  const midM = m - prefixLength - suffixLength;
  if (midN > 0 && midM > 0 && midN * midM <= MAX_LCS_CELLS) {
    const dp: number[][] = Array.from({ length: midN + 1 }, () =>
      new Array<number>(midM + 1).fill(0),
    );
    for (let i = 1; i <= midN; i++) {
      for (let j = 1; j <= midM; j++) {
        dp[i][j] = deepEqual(
          from[prefixLength + i - 1],
          to[prefixLength + j - 1],
        )
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    const midPairs: [number, number][] = [];
    let i = midN;
    let j = midM;
    while (i > 0 && j > 0) {
      if (deepEqual(from[prefixLength + i - 1], to[prefixLength + j - 1])) {
        midPairs.push([prefixLength + i - 1, prefixLength + j - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    pairs.push(...midPairs.reverse());
  }

  for (let k = suffixLength; k > 0; k--) pairs.push([n - k, m - k]);
  return pairs;
}

// ============================================================================
// Walkers
// ============================================================================

function diffValue(
  from: unknown,
  to: unknown,
  path: (string | number)[],
  opts: DiffOptions,
  out: PropertyChange[],
): void {
  if (isPlainObject(from) && isPlainObject(to)) {
    diffObject(from, to, path, opts, out);
    return;
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    diffArray(from, to, path, opts, out);
    return;
  }
  if (deepEqual(from, to)) return;

  const change: PropertyChange = { path, kind: 'changed', from, to };
  if (
    typeof from === 'string' &&
    typeof to === 'string' &&
    opts.diffText &&
    opts.isRichText?.(path)
  ) {
    change.textDiff = opts.diffText(from, to);
  }
  out.push(change);
}

function diffObject(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  path: (string | number)[],
  opts: DiffOptions,
  out: PropertyChange[],
): void {
  for (const key of Object.keys(from)) {
    const keyPath = [...path, key];
    if (!Object.prototype.hasOwnProperty.call(to, key)) {
      out.push({ path: keyPath, kind: 'removed', from: from[key] });
      continue;
    }
    diffValue(from[key], to[key], keyPath, opts, out);
  }
  for (const key of Object.keys(to)) {
    if (!Object.prototype.hasOwnProperty.call(from, key)) {
      out.push({ path: [...path, key], kind: 'added', to: to[key] });
    }
  }
}

function diffArray(
  from: unknown[],
  to: unknown[],
  path: (string | number)[],
  opts: DiffOptions,
  out: PropertyChange[],
): void {
  const boundaries: [number, number][] = [
    ...lcsPairs(from, to),
    [from.length, to.length],
  ];

  let fromCursor = 0;
  let toCursor = 0;
  for (const [matchFrom, matchTo] of boundaries) {
    const fromGap = matchFrom - fromCursor;
    const toGap = matchTo - toCursor;
    const shared = Math.min(fromGap, toGap);

    for (let k = 0; k < shared; k++) {
      diffValue(
        from[fromCursor + k],
        to[toCursor + k],
        [...path, toCursor + k],
        opts,
        out,
      );
    }
    for (let k = shared; k < fromGap; k++) {
      out.push({
        path: [...path, fromCursor + k],
        kind: 'removed',
        from: from[fromCursor + k],
      });
    }
    for (let k = shared; k < toGap; k++) {
      out.push({
        path: [...path, toCursor + k],
        kind: 'added',
        to: to[toCursor + k],
      });
    }

    fromCursor = matchFrom + 1;
    toCursor = matchTo + 1;
  }
}

// ============================================================================
// diffProperties
// ============================================================================

/**
 * Deterministic deep diff of two block-property records.
 *
 * Walks both objects key by key: keys only in `to` yield `added`, keys only in
 * `from` yield `removed`, keys in both recurse when both sides are plain
 * objects, align via {@link diffArray} when both sides are arrays, and
 * otherwise yield a single `changed` entry when the values differ. Output
 * order is deterministic at every nesting level: `from`-keys first
 * (removed/changed in `from` key order), then added keys in `to` key order.
 *
 * Arrays are aligned by LCS on deep-equal items. Leftover items in each gap
 * pair up positionally and diff like any other value pair (the path uses the
 * NEW index): object pairs recurse, scalar pairs yield one `changed` entry
 * (eligible for `textDiff`). Unpaired leftovers are reported as `removed`
 * (path index into the OLD array) / `added` (path index into the NEW array).
 * Reordered equal items therefore surface as a removed+added pair, not as a
 * move. The LCS is size-capped: past a cell budget on the prefix/suffix-
 * trimmed middle, the middle is paired purely positionally instead — same
 * output shapes, coarser alignment.
 *
 * When `opts.isRichText` matches the path of a `changed` entry whose sides
 * are both strings and `opts.diffText` is provided, the word-level
 * `textDiff` segments are attached to the change.
 */
export function diffProperties(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  opts?: {
    isRichText?: (path: (string | number)[]) => boolean;
    diffText?: (from: string, to: string) => TextDiffSegment[];
  },
): PropertyChange[] {
  const out: PropertyChange[] = [];
  diffObject(from, to, [], opts ?? {}, out);
  return out;
}
