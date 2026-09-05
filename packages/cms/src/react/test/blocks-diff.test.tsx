import { cleanup, render } from '@testing-library/react';
// @vitest-environment happy-dom
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BlockTreeNode } from '../../core/blocks/reconstruct-snapshot';
import type {
  AnyBlockDefinition,
  CollectionDefinition,
} from '../../core/types/definitions';
import type {
  AnnotatedBlockTreeNode,
  BlockComponentMap,
  BlockDiffAnnotation,
} from '../blocks';

import { diffRichText } from '../../core/diff/text-diff';
import {
  BlocksRenderer,
  createBlocksMap,
  createContentRenderer,
  diffSegmentsToHtml,
  getBlockDiff,
} from '../blocks';
import { TrackingRuntimeProvider, useBlockTrackerRaw } from '../tracking';

// A minimal presentational collection (no `events`, so no <BlockTracker> and
// no <TrackingRuntimeProvider> needed): two leaf blocks and one container.
const blocks = {
  headline: {
    label: 'Headline',
    properties: { text: { type: 'string', label: 'Text' } },
  },
  paragraph: {
    label: 'Paragraph',
    properties: { text: { type: 'string', label: 'Text' } },
  },
  section: {
    label: 'Section',
    properties: {},
  },
} satisfies Record<string, AnyBlockDefinition>;

const collection = {
  label: 'Diff Test Page',
  root: { properties: {} },
  blocks,
} satisfies CollectionDefinition;

const components: BlockComponentMap<typeof blocks> = {
  headline: ({ properties }) => <h1>{properties?.text}</h1>,
  paragraph: ({ properties }) => <p>{properties?.text}</p>,
  section: ({ children }) => <section>{children}</section>,
};

const blocksMap = createBlocksMap(collection, components);

// An annotated diff tree exercising every wrapper rule:
// - root itself carries an annotation but is NEVER wrapped (renders as a
//   fragment),
// - added / deleted / modified / moved nodes get the default wrapper,
// - a pure `childrenReordered` parent does NOT (visual noise),
// - unchanged nodes render bare,
// - a multi-type node (`moved` + `modified`) picks `modified` as primary.
function makeAnnotatedTree(): AnnotatedBlockTreeNode {
  return {
    blockId: 'root',
    type: 'root',
    properties: {},
    diff: {
      changeTypes: ['modified'],
      slugChange: { from: 'old-slug', to: 'new-slug' },
    },
    children: [
      {
        blockId: 'blk_added',
        type: 'headline',
        properties: { text: 'New headline' },
        diff: { changeTypes: ['added'] },
        children: [],
      },
      {
        blockId: 'blk_del',
        type: 'paragraph',
        properties: { text: 'Ghost paragraph' },
        diff: { changeTypes: ['deleted'] },
        children: [],
      },
      {
        blockId: 'blk_mod',
        type: 'headline',
        properties: { text: 'Changed headline' },
        diff: {
          changeTypes: ['modified'],
          propertyChanges: [
            { path: ['text'], kind: 'changed', from: 'a', to: 'b' },
            { path: ['style', 'color'], kind: 'changed', from: 'x', to: 'y' },
            { path: ['style', 'size'], kind: 'added', to: 'lg' },
          ],
        },
        children: [],
      },
      {
        blockId: 'blk_plain',
        type: 'paragraph',
        properties: { text: 'Untouched' },
        children: [],
      },
      {
        blockId: 'blk_reorder',
        type: 'section',
        properties: {},
        diff: { changeTypes: ['childrenReordered'] },
        children: [
          {
            blockId: 'blk_c1',
            type: 'paragraph',
            properties: { text: 'First child' },
            children: [],
          },
          {
            blockId: 'blk_c2',
            type: 'paragraph',
            properties: { text: 'Second child' },
            diff: { changeTypes: ['moved'] },
            children: [],
          },
        ],
      },
      {
        blockId: 'blk_movmod',
        type: 'paragraph',
        properties: { text: 'Moved and modified' },
        diff: {
          changeTypes: ['moved', 'modified'],
          propertyChanges: [
            { path: ['text'], kind: 'changed', from: 'a', to: 'b' },
          ],
        },
        children: [],
      },
    ],
  };
}

function stripAnnotations(node: AnnotatedBlockTreeNode): BlockTreeNode {
  return {
    blockId: node.blockId,
    type: node.type,
    properties: node.properties,
    children: node.children.map(stripAnnotations),
  };
}

describe('diff-aware block rendering', () => {
  afterEach(() => cleanup());

  it('wraps added/deleted/modified/moved nodes with the default data-diff wrapper', () => {
    const { container } = render(
      <BlocksRenderer
        blocks={blocksMap}
        tree={makeAnnotatedTree()}
        diff={{}}
      />,
    );

    const added = container.querySelector('[data-diff="added"]');
    expect(added).not.toBeNull();
    expect(added?.getAttribute('data-diff-types')).toBe('added');
    expect(added?.getAttribute('data-diff-props')).toBeNull();
    expect(added?.querySelector('h1')?.textContent).toBe('New headline');

    const deleted = container.querySelector('[data-diff="deleted"]');
    expect(deleted).not.toBeNull();
    expect(deleted?.getAttribute('data-diff-types')).toBe('deleted');
    expect(deleted?.querySelector('p')?.textContent).toBe('Ghost paragraph');

    const moved = container.querySelector('[data-diff="moved"]');
    expect(moved).not.toBeNull();
    expect(moved?.getAttribute('data-diff-types')).toBe('moved');
    expect(moved?.querySelector('p')?.textContent).toBe('Second child');

    // Exactly the five changed blocks are wrapped — nothing else.
    expect(container.querySelectorAll('[data-diff]')).toHaveLength(5);
  });

  it('emits unique top-level property names as data-diff-props', () => {
    const { container } = render(
      <BlocksRenderer
        blocks={blocksMap}
        tree={makeAnnotatedTree()}
        diff={{}}
      />,
    );

    const modified = Array.from(
      container.querySelectorAll('[data-diff="modified"]'),
    ).find((el) => el.textContent === 'Changed headline');
    expect(modified?.getAttribute('data-diff-types')).toBe('modified');
    expect(modified?.getAttribute('data-diff-props')).toBe('text style');
  });

  it('picks the primary change type as added > deleted > modified > moved', () => {
    const { container } = render(
      <BlocksRenderer
        blocks={blocksMap}
        tree={makeAnnotatedTree()}
        diff={{}}
      />,
    );

    // `['moved', 'modified']` — `modified` wins as primary, but
    // data-diff-types keeps the annotation's own order.
    const movmod = Array.from(
      container.querySelectorAll('[data-diff="modified"]'),
    ).find((el) => el.textContent === 'Moved and modified');
    expect(movmod).not.toBeNull();
    expect(movmod?.getAttribute('data-diff-types')).toBe('moved modified');
  });

  it('does not wrap unchanged nodes, pure childrenReordered parents, or the root', () => {
    const { container } = render(
      <BlocksRenderer
        blocks={blocksMap}
        tree={makeAnnotatedTree()}
        diff={{}}
      />,
    );

    // Unchanged block renders bare, directly under the root fragment.
    const plain = Array.from(container.querySelectorAll('p')).find(
      (el) => el.textContent === 'Untouched',
    );
    expect(plain?.parentElement).toBe(container);

    // The pure-childrenReordered section is not wrapped...
    const section = container.querySelector('section');
    expect(section?.parentElement).toBe(container);
    // ...though its truly moved child still is.
    expect(section?.querySelector('[data-diff="moved"]')).not.toBeNull();

    // The root is annotated but renders as a fragment — its children sit
    // directly in the container, with no enclosing [data-diff] element.
    expect(container.querySelector('h1')?.closest('[data-diff]')).toBe(
      container.querySelector('[data-diff="added"]'),
    );
  });

  it('uses a custom wrap callback and passes it node + annotation', () => {
    const captured: {
      node: AnnotatedBlockTreeNode;
      annotation: BlockDiffAnnotation;
    }[] = [];

    const { container } = render(
      <BlocksRenderer
        blocks={blocksMap}
        tree={makeAnnotatedTree()}
        diff={{
          wrap: ({ element, node, annotation }) => {
            captured.push({ node, annotation });
            return <mark data-node={node.blockId}>{element}</mark>;
          },
        }}
      />,
    );

    // The callback's output replaces the default wrapper entirely.
    expect(container.querySelectorAll('[data-diff]')).toHaveLength(0);
    expect(container.querySelectorAll('mark')).toHaveLength(5);
    expect(
      container.querySelector('mark[data-node="blk_added"] h1')?.textContent,
    ).toBe('New headline');

    // Called once per wrapped node, with the node's own annotation.
    expect(captured).toHaveLength(5);
    const addedCall = captured.find((c) => c.node.blockId === 'blk_added');
    expect(addedCall?.annotation.changeTypes).toEqual(['added']);
    expect(addedCall?.node.type).toBe('headline');
    // Pure-childrenReordered and unchanged nodes never reach the callback.
    expect(captured.some((c) => c.node.blockId === 'blk_reorder')).toBe(false);
    expect(captured.some((c) => c.node.blockId === 'blk_plain')).toBe(false);
  });

  it('threads the diff prop through createContentRenderer', () => {
    const RenderPage = createContentRenderer(collection, components);
    const { container } = render(
      <RenderPage tree={makeAnnotatedTree()} diff={{}} />,
    );

    expect(container.querySelectorAll('[data-diff]')).toHaveLength(5);
    expect(container.querySelector('[data-diff="added"] h1')?.textContent).toBe(
      'New headline',
    );
  });

  it('renders byte-identically to a plain tree when the diff prop is absent', () => {
    const annotated = makeAnnotatedTree();

    const withAnnotations = render(
      <BlocksRenderer blocks={blocksMap} tree={annotated} />,
    );
    const annotatedHtml = withAnnotations.container.innerHTML;
    cleanup();

    const plain = render(
      <BlocksRenderer blocks={blocksMap} tree={stripAnnotations(annotated)} />,
    );

    expect(annotatedHtml).toBe(plain.container.innerHTML);
    expect(annotatedHtml).not.toContain('data-diff');
  });
});

describe('ghost nodes and tracking', () => {
  afterEach(() => cleanup());

  // A functional block (declared `events`) whose component fires on mount —
  // enough to observe whether the renderer wrapped it in a <BlockTracker>.
  const trackedBlocks = {
    cta: {
      label: 'CTA',
      properties: { label: { type: 'string', label: 'Label' } },
      events: { click: { name: 'cms_cta_click' } },
    },
  } satisfies Record<string, AnyBlockDefinition>;

  const trackedCollection = {
    label: 'Tracked Diff Page',
    root: { properties: {} },
    blocks: trackedBlocks,
  } satisfies CollectionDefinition;

  function FireOnMount({ label }: { label: string }) {
    const { fire } = useBlockTrackerRaw();
    useEffect(() => {
      fire('click', { label });
    }, [fire, label]);
    return <button type="button">{label}</button>;
  }

  it('does not wrap deleted ghost nodes in a BlockTracker', () => {
    // The ghost's unscoped fire() dev-warns — silence it for the assertion.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatch = vi.fn();

    const map = createBlocksMap(trackedCollection, {
      cta: ({ properties }) => <FireOnMount label={properties?.label ?? ''} />,
    });

    const tree: AnnotatedBlockTreeNode = {
      blockId: 'root',
      type: 'root',
      properties: {},
      children: [
        {
          blockId: 'blk_live',
          type: 'cta',
          properties: { label: 'live' },
          children: [],
        },
        {
          blockId: 'blk_ghost',
          type: 'cta',
          properties: { label: 'ghost' },
          diff: { changeTypes: ['deleted'] },
          children: [],
        },
      ],
    };

    render(
      <TrackingRuntimeProvider runtime={{ dispatch }}>
        <BlocksRenderer blocks={map} tree={tree} diff={{}} />
      </TrackingRuntimeProvider>,
    );

    const events = dispatch.mock.calls.map(([event]) => event);
    const live = events.find((event) => event.params?.label === 'live');
    const ghost = events.find((event) => event.params?.label === 'ghost');

    // The live functional block is tracked: wire-resolved name + block source.
    expect(live?.name).toBe('cms_cta_click');
    expect(live?.source).toEqual({ type: 'cta' });

    // The ghost's tracker was skipped: its fire() stays unscoped — the raw
    // event key (no wire resolution) and no block source, so nothing a review
    // render emits can be attributed to the deleted block.
    expect(ghost?.name).toBe('click');
    expect(ghost?.source).toBeUndefined();

    warn.mockRestore();
  });
});

describe('getBlockDiff', () => {
  it('returns the annotation for annotated nodes and null otherwise', () => {
    const tree = makeAnnotatedTree();
    const added = tree.children[0]!;
    expect(getBlockDiff(added)).toBe(added.diff);

    const plain = tree.children[3]!;
    expect(getBlockDiff(plain)).toBeNull();
  });
});

describe('diffSegmentsToHtml', () => {
  it('emits classic <del>/<ins> for a plain word change', () => {
    expect(
      diffSegmentsToHtml(
        diffRichText('<p>Hello world</p>', '<p>Hello there</p>'),
      ),
    ).toBe(
      '<p>Hello ' +
        '<del data-diff-text="del">world</del>' +
        '<ins data-diff-text="ins">there</ins>' +
        '</p>',
    );
  });

  it('passes same runs through raw and wraps only the text of ins/del runs', () => {
    // Tags inside `same` runs pass raw; a deleted run's tags are dropped
    // (never emitted), its text survives tag-stripped inside <del>.
    expect(
      diffSegmentsToHtml([
        { type: 'same', html: 'Hello <em>world</em> ' },
        { type: 'del', html: '<b>old</b>' },
        { type: 'ins', html: 'new' },
      ]),
    ).toBe(
      'Hello <em>world</em> ' +
        '<del data-diff-text="del">old</del>' +
        '<ins data-diff-text="ins">new</ins>',
    );
  });

  it('emits a formatting-only change as the new HTML with no inline highlight', () => {
    // Bolding a word diffs as pure tag insertions — tags are never wrapped in
    // <ins>, so the output is exactly the new document, valid and unmarked.
    const segments = diffRichText(
      '<p>hello world</p>',
      '<p>hello <strong>world</strong></p>',
    );
    const html = diffSegmentsToHtml(segments);
    expect(html).toBe('<p>hello <strong>world</strong></p>');
    expect(html).not.toContain('<ins');
    expect(html).not.toContain('<del');
  });

  it('emits only the new structural tags for a block-tag replacement', () => {
    // <p> → <div>: the old tags are dropped, the new ones emitted bare — no
    // mis-nested mix of both documents' structure.
    expect(
      diffSegmentsToHtml(diffRichText('<p>alpha</p>', '<div>alpha</div>')),
    ).toBe('<div>alpha</div>');
  });

  it('emits inserted tags bare and wraps each inserted text run in <ins>', () => {
    expect(
      diffSegmentsToHtml(
        diffRichText('<p></p>', '<p>hello <strong>world</strong></p>'),
      ),
    ).toBe(
      '<p>' +
        '<ins data-diff-text="ins">hello </ins>' +
        '<strong><ins data-diff-text="ins">world</ins></strong>' +
        '</p>',
    );
  });

  it('strips tags from a deleted run, keeping its text runs in <del>', () => {
    // Old inline structure must not leak into the new document: each run of
    // text between the dropped tags becomes its own <del>.
    expect(
      diffSegmentsToHtml([
        { type: 'same', html: '<p>keep ' },
        { type: 'del', html: 'foo <em>bar</em> baz' },
        { type: 'same', html: '</p>' },
      ]),
    ).toBe(
      '<p>keep ' +
        '<del data-diff-text="del">foo </del>' +
        '<del data-diff-text="del">bar</del>' +
        '<del data-diff-text="del"> baz</del>' +
        '</p>',
    );
  });

  it('returns an empty string for no segments', () => {
    expect(diffSegmentsToHtml([])).toBe('');
  });
});
