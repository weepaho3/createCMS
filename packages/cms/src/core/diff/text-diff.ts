import type { TextDiffSegment } from './types';

// ============================================================================
// Rich-text word diff (htmldiff-style)
//
// Tokenizes two HTML fragments into atomic tokens — each tag is one token,
// each word keeps its trailing whitespace — then diffs the token streams:
// common prefix/suffix trim followed by an LCS over the remainder. Equal tags
// act as `same` anchors, so a word change inside <p>…</p> keeps the tags
// untouched.
//
// Invariants: concatenating the `same` + `del` segments reproduces `from`
// byte-for-byte; concatenating `same` + `ins` reproduces `to`.
// ============================================================================

/**
 * Per-side token cap for the LCS mid-section. Above this the O(n*m) DP is
 * skipped and the differing middle collapses to one coarse del/ins pair.
 */
const MAX_LCS_TOKENS = 3000;

/** A full HTML tag captured as a single token. */
const TAG_TOKEN = /^<[^>]*>$/;

// ============================================================================
// Tokenization
// ============================================================================

/**
 * Splits an HTML string into tag tokens and whitespace-preserving word
 * tokens. Whitespace runs are folded into the preceding word token (never
 * into a tag), so joining the tokens reproduces the input byte-for-byte.
 */
function tokenize(html: string): string[] {
  const parts = html.split(/(<[^>]*>|\s+)/);
  const tokens: string[] = [];

  for (const part of parts) {
    if (part === '') continue;

    if (/^\s+$/.test(part)) {
      const last = tokens.length - 1;
      if (last >= 0 && !TAG_TOKEN.test(tokens[last])) {
        tokens[last] += part;
        continue;
      }
    }
    tokens.push(part);
  }
  return tokens;
}

// ============================================================================
// Token diff
// ============================================================================

/** Standard LCS dynamic programming over two token arrays, emitted as one segment per token. */
function lcsDiff(a: string[], b: string[]): TextDiffSegment[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;

  // dp[i][j] = LCS length of a[i..] vs b[j..]
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const segments: TextDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      segments.push({ type: 'same', html: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      segments.push({ type: 'del', html: a[i] });
      i++;
    } else {
      segments.push({ type: 'ins', html: b[j] });
      j++;
    }
  }
  while (i < n) segments.push({ type: 'del', html: a[i++] });
  while (j < m) segments.push({ type: 'ins', html: b[j++] });

  return segments;
}

/** Collapses adjacent segments of the same type and drops empty ones. */
function mergeSegments(segments: TextDiffSegment[]): TextDiffSegment[] {
  const merged: TextDiffSegment[] = [];
  for (const segment of segments) {
    if (segment.html === '') continue;
    const last = merged[merged.length - 1];
    if (last && last.type === segment.type) {
      last.html += segment.html;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

// ============================================================================
// diffRichText
// ============================================================================

/**
 * Word-level diff of two rich-text (HTML) strings.
 *
 * Returns merged runs of `same` / `del` / `ins` segments whose `html` values
 * are raw fragments of the inputs: `same` + `del` concatenate back to `from`,
 * `same` + `ins` back to `to`. Two empty inputs yield `[]`.
 */
export function diffRichText(from: string, to: string): TextDiffSegment[] {
  if (from === to) {
    return from === '' ? [] : [{ type: 'same', html: from }];
  }

  const fromTokens = tokenize(from);
  const toTokens = tokenize(to);
  const minLength = Math.min(fromTokens.length, toTokens.length);

  let prefixLength = 0;
  while (
    prefixLength < minLength &&
    fromTokens[prefixLength] === toTokens[prefixLength]
  ) {
    prefixLength++;
  }

  let suffixLength = 0;
  while (
    suffixLength < minLength - prefixLength &&
    fromTokens[fromTokens.length - 1 - suffixLength] ===
      toTokens[toTokens.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  const midFrom = fromTokens.slice(prefixLength, fromTokens.length - suffixLength);
  const midTo = toTokens.slice(prefixLength, toTokens.length - suffixLength);

  const segments: TextDiffSegment[] = [];
  if (prefixLength > 0) {
    segments.push({
      type: 'same',
      html: fromTokens.slice(0, prefixLength).join(''),
    });
  }

  if (midFrom.length > MAX_LCS_TOKENS || midTo.length > MAX_LCS_TOKENS) {
    if (midFrom.length > 0) segments.push({ type: 'del', html: midFrom.join('') });
    if (midTo.length > 0) segments.push({ type: 'ins', html: midTo.join('') });
  } else {
    segments.push(...lcsDiff(midFrom, midTo));
  }

  if (suffixLength > 0) {
    segments.push({
      type: 'same',
      html: fromTokens.slice(fromTokens.length - suffixLength).join(''),
    });
  }

  return mergeSegments(segments);
}
