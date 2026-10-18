import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ImageRef } from './core/image-field';
import type { MediaAsset } from './core/types';

import { createMediaStore } from './core/store';
import {
  Detail,
  FocalPoint,
  ImageField,
  Media,
  MediaPickerHost,
  openMediaPicker,
  Picker,
  Preview,
  useDownloads,
  usePreview,
} from './index';
import { makeAsset, makeClient } from './test-fixtures';

afterEach(cleanup);

const list: MediaAsset[] = [
  makeAsset({ id: 'a1', originalName: 'one.png', width: 2000, height: 1000 }),
  makeAsset({ id: 'a2', originalName: 'two.png', width: 800, height: 600 }),
  makeAsset({
    id: 'a3',
    originalName: 'three.pdf',
    mimeType: 'application/pdf',
  }),
];

function setup(
  children: React.ReactNode,
  overrides: Parameters<typeof makeClient>[0] = {},
) {
  const client = makeClient({
    listAssets: vi.fn(async () => ({
      assets: list,
      total: list.length,
      hasMore: false,
      nextCursor: null,
    })),
    ...overrides,
  });
  const store = createMediaStore({ client, selection: 'multiple' });
  const view = render(
    <Media.Root client={client} store={store}>
      {children}
    </Media.Root>,
  );
  return { ...view, store, client };
}

async function load(store: ReturnType<typeof createMediaStore>) {
  await act(async () => {
    await store.dispatch({ type: 'init' });
  });
}

describe('Preview', () => {
  function Opener() {
    const preview = usePreview();
    return (
      <button type="button" onClick={() => preview.open('a1')}>
        open
      </button>
    );
  }

  it('opens as a dialog, steps with keys and returns focus on close', async () => {
    const { store, getByRole, queryByRole } = setup(
      <>
        <Opener />
        <Preview.Root>
          <Preview.Stage>
            {({ kind }) =>
              kind === 'pdf' ? <span data-kind="pdf" /> : undefined
            }
          </Preview.Stage>
          <Preview.Position />
          <Preview.Prev />
          <Preview.Next />
          <Preview.Close />
        </Preview.Root>
      </>,
    );
    await load(store);
    expect(queryByRole('dialog')).toBeNull();
    const opener = getByRole('button', { name: 'open' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = getByRole('dialog', { name: 'Preview of one.png' });
    expect(document.activeElement).toBe(dialog);
    expect(dialog.textContent).toContain('1 of 3');
    expect(
      getByRole('button', { name: 'Previous' }).hasAttribute('disabled'),
    ).toBe(true);

    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(store.getState().preview.openId).toBe('a2');
    fireEvent.keyDown(dialog, { key: '+' });
    expect(store.getState().preview.zoom).toBeGreaterThan(1);
    // Zoomed: arrows pan instead of stepping.
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(store.getState().preview.openId).toBe('a2');
    fireEvent.keyDown(dialog, { key: '0' });
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(
      getByRole('dialog').querySelector('[data-kind="pdf"]'),
    ).not.toBeNull();

    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' });
    expect(queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('Detail', () => {
  it('edits a draft, saves with expectedUpdatedAt and shows a conflict', async () => {
    const newer = {
      ...list[0],
      originalName: 'theirs.png',
      updatedAt: '2026-02-01T00:00:00.000Z',
    };
    const updateAsset = vi.fn(async () => {
      throw { body: { code: 'ASSET_CONFLICT', data: { asset: newer } } };
    });
    const { store, getByRole, getByLabelText, findByText } = setup(
      <Detail.Root>
        <label>
          Name
          <Detail.Field field="originalName" />
        </label>
        <Detail.Provenance />
        <Detail.Facts />
        <Detail.Save />
        <Detail.Conflict>
          {({ theirs, takeTheirs }) => (
            <button type="button" onClick={takeTheirs}>
              take {theirs.originalName}
            </button>
          )}
        </Detail.Conflict>
      </Detail.Root>,
      { updateAsset },
    );
    await load(store);
    await act(async () => {
      await store.dispatch({ type: 'openDetail', id: 'a1' });
    });
    const save = getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(getByLabelText('Name'), { target: { value: 'mine.png' } });
    expect(save.hasAttribute('disabled')).toBe(false);
    expect(getByRole('form').textContent).toContain('2,000 × 1,000 px');

    await act(async () => {
      fireEvent.click(save);
    });
    expect(updateAsset).toHaveBeenCalledWith({
      body: {
        assetId: 'a1',
        patch: { originalName: 'mine.png' },
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    fireEvent.click(await findByText('take theirs.png'));
    await waitFor(() =>
      expect((getByLabelText('Name') as HTMLInputElement).value).toBe(
        'theirs.png',
      ),
    );
  });
});

describe('FocalPoint', () => {
  it('moves the handle by keyboard and commits', () => {
    const commit = vi.fn();
    const { getByRole } = render(
      <FocalPoint.Root
        image={{ src: '/a.png', width: 100, height: 100 }}
        defaultValue={{ x: 0.5, y: 0.5 }}
        onValueCommit={commit}
      >
        <FocalPoint.Handle />
        <FocalPoint.Preview data-testid="preview" />
      </FocalPoint.Root>,
    );
    const handle = getByRole('slider', { name: 'Focal point' });
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(commit).toHaveBeenLastCalledWith({ x: 0.6, y: 0.5 });
    expect(handle.getAttribute('aria-valuetext')).toBe(
      '60% from the left, 50% from the top',
    );
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(commit).toHaveBeenLastCalledWith({ x: 0.5, y: 0.5 });
  });
});

describe('ImageField', () => {
  function Field(props: {
    initial: ImageRef;
    requireAlt?: boolean;
    suggest?: () => Promise<string | null>;
  }) {
    const [value, setValue] = React.useState<ImageRef>(props.initial);
    return (
      <ImageField.Root
        value={value}
        onValueChange={setValue}
        requireAlt={props.requireAlt}
        suggesters={props.suggest ? [{ suggest: props.suggest }] : []}
      >
        <ImageField.Alt />
        <ImageField.Decorative />
        <ImageField.SuggestAlt />
        <ImageField.Status />
        <output>{JSON.stringify(value)}</output>
      </ImageField.Root>
    );
  }

  it('requires alt text or decorative and fills only empty alt with a suggestion', async () => {
    const suggest = vi.fn(async () => 'Two people');
    const { getByRole, getByText, container } = render(
      <Field initial={{ assetId: 'a1' }} requireAlt suggest={suggest} />,
    );
    const alt = getByRole('textbox', { name: 'Alternative text' });
    expect(alt.getAttribute('aria-invalid')).toBe('true');
    getByText('Alternative text missing');

    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Suggest' }));
    });
    expect(JSON.parse(container.querySelector('output')!.textContent!)).toEqual(
      {
        assetId: 'a1',
        alt: 'Two people',
        altSource: 'ai-suggested',
      },
    );
    getByText('Suggested, please check');
    expect(
      getByRole('button', { name: 'Suggest' }).hasAttribute('disabled'),
    ).toBe(true);

    fireEvent.change(alt, { target: { value: 'Two people at a desk' } });
    expect(
      JSON.parse(container.querySelector('output')!.textContent!).altSource,
    ).toBe('user');

    fireEvent.click(getByRole('checkbox'));
    expect(alt.hasAttribute('disabled')).toBe(true);
  });
});

describe('Picker', () => {
  it('locks assets that miss the constraints and confirms valid choices', async () => {
    const confirmed = vi.fn();
    const constraints = { mode: 'multiple' as const, max: 2, minWidth: 1200 };
    const { store, getByRole, getAllByTestId } = setup(
      <Picker.Root constraints={constraints}>
        <Media.Grid minCell={150} gap={10}>
          {(asset) => (
            <Media.Item key={asset.id} asset={asset} data-testid="item">
              <Picker.Reason />
            </Media.Item>
          )}
        </Media.Grid>
        <Picker.Confirm onConfirm={confirmed} />
      </Picker.Root>,
    );
    await load(store);
    await act(async () => {
      await store.dispatch({ type: 'setViewport', width: 500, height: 800 });
    });
    const items = getAllByTestId('item');
    expect(items[1].textContent).toContain('Needs at least 1,200 × 0 px');
    const confirm = getByRole('button', { name: 'Choose' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await act(async () => {
      await store.dispatch({ type: 'toggleSelection', id: 'a2' });
    });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await act(async () => {
      await store.dispatch({ type: 'clearSelection' });
      await store.dispatch({ type: 'toggleSelection', id: 'a1' });
    });
    fireEvent.click(getByRole('button', { name: 'Choose' }));
    expect(confirmed).toHaveBeenCalledWith([list[0]]);
  });

  it('resolves openMediaPicker through the mounted host', async () => {
    const { getByRole } = render(
      <MediaPickerHost>
        {(request) => (
          <>
            <button type="button" onClick={() => request.resolve([list[0]])}>
              pick
            </button>
            <button type="button" onClick={request.cancel}>
              cancel
            </button>
          </>
        )}
      </MediaPickerHost>,
    );
    let picked: Promise<MediaAsset[] | null>;
    act(() => {
      picked = openMediaPicker({ mode: 'single' });
    });
    fireEvent.click(getByRole('button', { name: 'pick' }));
    expect(await picked!).toEqual([list[0]]);
    act(() => {
      picked = openMediaPicker({ mode: 'single' });
    });
    fireEvent.click(getByRole('button', { name: 'cancel' }));
    expect(await picked!).toBeNull();
  });
});

describe('useDownloads', () => {
  it('is unsupported without downloadIntent', async () => {
    let supported: boolean | undefined;
    function Probe() {
      supported = useDownloads().supported;
      return null;
    }
    const { store } = setup(<Probe />);
    await load(store);
    expect(supported).toBe(false);
  });
});
