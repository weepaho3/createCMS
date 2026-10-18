import type * as React from 'react';

import { act, cleanup, render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorStore } from './core/store';

import { Canvas } from './canvas/index';
import { renderCanvas, waitForLayout } from './canvas/test/harness';
import { useEditorContext } from './context';
import { requireValidDocument } from './core/store';
import { counterGenId, makeDoc, storeSchema } from './core/store/fixtures';
import { useChildren } from './hooks';
import { Editor } from './index';

afterEach(cleanup);

/**
 * axe violations inside `context`, as `rule: selectors` lines. `region`
 * is off: each part renders on its own, outside any landmark.
 */
async function violations(context: Element): Promise<string[]> {
  const results = await axe.run(context, {
    rules: { region: { enabled: false } },
  });
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes
        .map((node) => node.target.join(' '))
        .join(', ')}`,
  );
}

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

function mount(children: React.ReactNode, root?: { beforeSave?: boolean }) {
  const probe: Probe = { store: null };
  const doc = makeDoc();
  if (root?.beforeSave) doc.root.props.title = '';
  const utils = render(
    <Editor.Root
      schema={storeSchema}
      defaultValue={doc}
      genId={counterGenId()}
      persistence={
        root?.beforeSave
          ? { save: async () => ({ version: 'v2' }), autosave: false }
          : undefined
      }
      beforeSave={root?.beforeSave ? requireValidDocument() : undefined}
    >
      <StoreProbe probe={probe} />
      {children}
    </Editor.Root>,
  );
  if (!probe.store) throw new Error('store probe did not mount');
  return { ...utils, store: probe.store };
}

function OutlineRow({ blockId }: { blockId: string }) {
  const nested = useChildren(blockId);
  return (
    <Editor.OutlineItem blockId={blockId}>
      <span>{blockId}</span>
      {nested.length > 0 ? (
        <Editor.OutlineGroup blockId={blockId} slot="children">
          {nested.map((child) => (
            <OutlineRow key={child.id} blockId={child.id} />
          ))}
        </Editor.OutlineGroup>
      ) : null}
    </Editor.OutlineItem>
  );
}

function Outline() {
  const rows = useChildren('root_1');
  return (
    <Editor.Outline data-testid="outline">
      {rows.map((row) => (
        <OutlineRow key={row.id} blockId={row.id} />
      ))}
    </Editor.Outline>
  );
}

describe('axe in a real browser', () => {
  it('reports a button without a name', async () => {
    const { container } = render(<button type="button" />);
    expect(await violations(container)).toEqual([
      expect.stringMatching(/^button-name: /),
    ]);
  });

  it('Editor.LiveAnnouncer has no violations after an announcement', async () => {
    const { container, store } = mount(<Editor.LiveAnnouncer />);
    act(() => {
      store.remove('p1');
    });
    const region = container.querySelector('[data-editor-live-announcer]')!;
    expect(region.textContent).not.toBe('');
    expect(await violations(region)).toEqual([]);
  });

  it('the inline-text glass has no violations while editing', async () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InlineText />
      </Canvas.Overlay>,
    );
    const field = host.querySelector('[data-editor-field="text"]')!;
    await waitForLayout(field);
    const rect = field.getBoundingClientRect();
    field.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      }),
    );
    await waitForLayout(host);
    const glass = host.querySelector('[data-editor-inline-text]');
    expect(glass).not.toBeNull();
    expect(await violations(host)).toEqual([]);
  });

  it('Canvas.BlockToolbar has no violations with a selected block', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.BlockToolbar>
          <Canvas.DragHandle blockId="h1" />
          <button type="button">Duplicate</button>
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
    );
    act(() => {
      store.select('h1');
    });
    const toolbar = host.ownerDocument.querySelector(
      '[data-editor-block-toolbar]',
    );
    expect(toolbar).not.toBeNull();
    expect(await violations(toolbar!)).toEqual([]);
  });

  it('Editor.Outline has no violations, collapsed or expanded', async () => {
    const { getByTestId, store } = mount(<Outline />);
    const outline = getByTestId('outline');
    expect(await violations(outline)).toEqual([]);
    act(() => {
      store.select('p1');
    });
    expect(await violations(outline)).toEqual([]);
  });

  it('Editor.ErrorSummary has no violations while a save is blocked', async () => {
    const { getByTestId, store } = mount(
      <>
        <Editor.ErrorSummary data-testid="summary" />
        <Editor.Form blockId="root_1" />
      </>,
      { beforeSave: true },
    );
    await act(async () => {
      await store.save({ force: true });
    });
    await waitFor(() => {
      expect(getByTestId('summary')).not.toBeNull();
    });
    expect(await violations(getByTestId('summary'))).toEqual([]);
  });
});
