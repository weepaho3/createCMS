// @vitest-environment happy-dom
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditProps } from '../core/edit';
import type { CanvasComponents } from './map';

import { makeDoc } from '../core/store/fixtures';
import { Canvas } from './index';
import { blockIssues } from './issue-marker';
import { canvasBlocks } from './test/fixtures';
import { renderCanvas } from './test/harness';

afterEach(cleanup);

function Image({ edit }: { edit: EditProps }) {
  return <figure {...edit.block} />;
}

const components = { ...canvasBlocks, image: Image } as CanvasComponents;

function docWithEmptyImage() {
  const doc = makeDoc();
  doc.root.slots!.children!.push({ id: 'img1', type: 'image', props: {} });
  return doc;
}

describe('blockIssues', () => {
  it('groups missing required fields and save findings per block, once', () => {
    const issues = blockIssues(
      [{ blockId: 'img1', blockType: 'image', key: 'url', label: 'Image' }],
      [
        {
          id: 'required:img1.url',
          label: 'Image: Image: This field is required.',
          blockId: 'img1',
          field: { blockId: 'img1', key: 'url' },
        },
        {
          id: 'maxLength:h1.text',
          label: 'Heading "Hello": Text: Too long.',
          blockId: 'h1',
          field: { blockId: 'h1', key: 'text' },
        },
        { id: 'schema:', label: 'Broken', blockId: null, field: null },
      ],
      'This field is required.',
    );
    expect([...issues.keys()]).toEqual(['img1', 'h1']);
    expect(issues.get('img1')).toEqual([
      {
        id: 'required:img1.url',
        key: 'url',
        message: 'Image: This field is required.',
      },
    ]);
    expect(issues.get('h1')).toHaveLength(1);
  });
});

describe('Canvas.IssueMarker', () => {
  it('marks a block with an empty required field', () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.IssueMarker />
      </Canvas.Overlay>,
      { tree: docWithEmptyImage(), components },
    );
    const markers = host.querySelectorAll('[data-editor-issue-marker]');
    expect(markers).toHaveLength(1);
    const marker = markers[0]!;
    expect(marker.getAttribute('data-count')).toBe('1');
    expect(marker.getAttribute('data-block-type')).toBe('image');
    expect(marker.getAttribute('aria-label')).toBe(
      'Image: Image: This field is required.',
    );
    expect(marker.textContent).toBe('1');
  });

  it('selects the block and focuses the first faulty field on click', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.IssueMarker />
      </Canvas.Overlay>,
      { tree: docWithEmptyImage(), components },
    );
    const marker = host.querySelector('[data-editor-issue-marker]')!;
    act(() => {
      fireEvent.click(marker);
    });
    expect(store.getSession().selection).toEqual(['img1']);
    expect(store.getSession().focusedField).toEqual({
      blockId: 'img1',
      key: 'url',
    });
  });

  it('disappears once the problem is fixed', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.IssueMarker />
      </Canvas.Overlay>,
      { tree: docWithEmptyImage(), components },
    );
    act(() => {
      store.update('img1', { url: 'asset_1' });
    });
    expect(host.querySelector('[data-editor-issue-marker]')).toBeNull();
  });
});
