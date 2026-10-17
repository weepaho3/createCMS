import { describe, expect, it } from 'vitest';

import type { EditorDocument } from '../document';

import { makeDoc } from './fixtures';
import { mergeByNode } from './merge';

function edit(fn: (doc: EditorDocument) => void): EditorDocument {
  const doc = makeDoc();
  fn(doc);
  return doc;
}

const heading = (doc: EditorDocument) => doc.root.slots!.children![0]!;
const section = (doc: EditorDocument) => doc.root.slots!.children![1]!;

describe('mergeByNode', () => {
  it('takes changes to different nodes from both sides', () => {
    const local = edit((d) => {
      heading(d).props.text = 'Mine';
    });
    const server = edit((d) => {
      section(d).props.title = 'Theirs';
    });
    const result = mergeByNode(makeDoc(), local, server);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(heading(result.doc).props.text).toBe('Mine');
    expect(section(result.doc).props.title).toBe('Theirs');
  });

  it('reports a node both sides changed differently', () => {
    const local = edit((d) => {
      heading(d).props.text = 'Mine';
    });
    const server = edit((d) => {
      heading(d).props.text = 'Theirs';
    });
    expect(mergeByNode(makeDoc(), local, server)).toEqual({
      ok: false,
      conflicts: ['h1'],
    });
  });

  it('accepts the same change on both sides', () => {
    const both = edit((d) => {
      heading(d).props.text = 'Same';
    });
    expect(mergeByNode(makeDoc(), both, both).ok).toBe(true);
  });

  it('a removal on one side wins over an untouched node', () => {
    const local = edit((d) => {
      d.root.slots!.children = [heading(d)];
    });
    const result = mergeByNode(makeDoc(), local, makeDoc());
    expect(result.ok && result.doc.root.slots?.children).toHaveLength(1);
  });

  it('a removal against an edit of the removed subtree conflicts', () => {
    const local = edit((d) => {
      d.root.slots!.children = [heading(d)];
    });
    const server = edit((d) => {
      section(d).slots!.children![0]!.props.text = 'Theirs';
    });
    const result = mergeByNode(makeDoc(), local, server);
    expect(result.ok).toBe(false);
  });
});
