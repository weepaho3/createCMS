import type {
  RichTextDoc,
  RichTextMark,
  RichTextNode,
} from '../rich-text/types';
import type { RichTextDiffSegment } from './types';

// Rich text word diff
//
// Flattens each value into word tokens per text block (paragraph, heading,
// code block, list item paragraph): a word keeps its trailing whitespace and
// the marks of the text it came from. Tokens compare by text; equal text
// with different marks is a `format` change. Common prefix and suffix are
// trimmed, an LCS covers the rest.

/**
 * Per-side token cap for the LCS mid-section. Above this the O(n*m) DP is
 * skipped and the differing middle collapses to one coarse del/ins pair.
 */
const MAX_LCS_TOKENS = 3000;

type Token = {
  text: string;
  marks: RichTextMark[];
  /** Mark identity for comparison: sorted types plus attrs. */
  markKey: string;
  block: number;
  blockType: string;
  level?: number;
};

const BLOCK_CONTAINERS = new Set([
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
]);

function markKeyOf(marks: readonly RichTextMark[]): string {
  return JSON.stringify(
    [...marks]
      .sort((a, b) => a.type.localeCompare(b.type))
      .map((m) => [m.type, m.attrs ?? null]),
  );
}

function tokenize(doc: RichTextDoc | null | undefined): Token[] {
  const tokens: Token[] = [];
  let block = -1;
  const inline = (
    nodes: readonly RichTextNode[],
    blockType: string,
    level: number | undefined,
  ) => {
    for (const node of nodes) {
      if (node.type === 'hardBreak') {
        tokens.push({
          text: '\n',
          marks: [],
          markKey: '[]',
          block,
          blockType,
          level,
        });
        continue;
      }
      if (node.type !== 'text') {
        inline(node.content ?? [], blockType, level);
        continue;
      }
      const marks = node.marks ?? [];
      const markKey = markKeyOf(marks);
      for (const word of (node.text ?? '').match(/\S+\s*|\s+/g) ?? []) {
        tokens.push({ text: word, marks, markKey, block, blockType, level });
      }
    }
  };
  const blocks = (nodes: readonly RichTextNode[]) => {
    for (const node of nodes) {
      if (BLOCK_CONTAINERS.has(node.type)) {
        blocks(node.content ?? []);
        continue;
      }
      if (node.type === 'horizontalRule' || node.type === 'image') continue;
      block += 1;
      const level =
        node.type === 'heading' && typeof node.attrs?.level === 'number'
          ? node.attrs.level
          : undefined;
      inline(node.content ?? [], node.type, level);
    }
  };
  blocks(doc?.content ?? []);
  return tokens;
}

const sameText = (a: Token, b: Token) => a.text === b.text;

function segment(
  type: RichTextDiffSegment['type'],
  token: Token,
  from?: Token,
): RichTextDiffSegment {
  const out: RichTextDiffSegment = {
    type,
    text: token.text,
    marks: token.marks,
    block: token.block,
    blockType: token.blockType,
  };
  if (token.level !== undefined) out.level = token.level;
  if (from) out.fromMarks = from.marks;
  return out;
}

/** A pair of equal text: `same`, or `format` when the marks differ. */
function pairSegment(from: Token, to: Token): RichTextDiffSegment {
  return from.markKey === to.markKey
    ? segment('same', to)
    : segment('format', to, from);
}

function lcsDiff(a: Token[], b: Token[]): RichTextDiffSegment[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = sameText(a[i]!, b[j]!)
        ? dp[(i + 1) * width + j + 1]! + 1
        : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!);
    }
  }
  const out: RichTextDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sameText(a[i]!, b[j]!)) {
      out.push(pairSegment(a[i]!, b[j]!));
      i++;
      j++;
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      out.push(segment('del', a[i++]!));
    } else {
      out.push(segment('ins', b[j++]!));
    }
  }
  while (i < n) out.push(segment('del', a[i++]!));
  while (j < m) out.push(segment('ins', b[j++]!));
  return out;
}

/** Joins neighbours of the same kind, block and marks. */
function mergeSegments(segments: RichTextDiffSegment[]): RichTextDiffSegment[] {
  const merged: RichTextDiffSegment[] = [];
  for (const next of segments) {
    if (next.text === '') continue;
    const last = merged.at(-1);
    if (
      last &&
      last.type === next.type &&
      last.block === next.block &&
      markKeyOf(last.marks) === markKeyOf(next.marks) &&
      markKeyOf(last.fromMarks ?? []) === markKeyOf(next.fromMarks ?? [])
    ) {
      last.text += next.text;
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

/**
 * Word-level diff of two `richText` values. Segments carry their text, its
 * marks, and the text block they belong to (`block` index, `blockType`,
 * heading `level`): `same` and `ins` follow the new value, `del` the old
 * one, and `format` is equal text whose marks changed (`fromMarks`).
 * Concatenating `same`, `format` and `ins` texts gives the new plain text;
 * `same`, `format` and `del` the old. Two empty values yield `[]`.
 */
export function diffRichText(
  from: RichTextDoc | null | undefined,
  to: RichTextDoc | null | undefined,
): RichTextDiffSegment[] {
  const a = tokenize(from);
  const b = tokenize(to);
  const min = Math.min(a.length, b.length);

  let prefix = 0;
  while (prefix < min && sameText(a[prefix]!, b[prefix]!)) prefix++;
  let suffix = 0;
  while (
    suffix < min - prefix &&
    sameText(a[a.length - 1 - suffix]!, b[b.length - 1 - suffix]!)
  ) {
    suffix++;
  }

  const out: RichTextDiffSegment[] = [];
  for (let k = 0; k < prefix; k++) out.push(pairSegment(a[k]!, b[k]!));
  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  if (midA.length > MAX_LCS_TOKENS || midB.length > MAX_LCS_TOKENS) {
    for (const token of midA) out.push(segment('del', token));
    for (const token of midB) out.push(segment('ins', token));
  } else {
    out.push(...lcsDiff(midA, midB));
  }
  for (let k = suffix; k > 0; k--) {
    out.push(pairSegment(a[a.length - k]!, b[b.length - k]!));
  }
  return mergeSegments(out);
}
