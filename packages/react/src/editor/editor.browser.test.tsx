import { cleanup, render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Editor, useEditor, useSelection } from './index';
import { makeTree, storeSchema } from './store/fixtures';

afterEach(cleanup);

function Probe() {
  const editor = useEditor();
  const selection = useSelection();
  return (
    <div>
      <span data-testid="root">{editor.getState().rootId}</span>
      <span data-testid="selected">{selection.selected ?? 'none'}</span>
      <button type="button" onClick={() => editor.select('h1')}>
        select
      </button>
    </div>
  );
}

describe('Editor.Root in a real browser', () => {
  it('mounts the store and renders through the hooks', () => {
    const { getByTestId } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <Probe />
      </Editor.Root>,
    );
    expect(getByTestId('root').textContent).toBe('root_1');
    expect(getByTestId('selected').textContent).toBe('none');
  });

  it('reacts to a real click event', () => {
    const { getByTestId, getByRole } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <Probe />
      </Editor.Root>,
    );
    act(() => {
      getByRole('button', { name: 'select' }).click();
    });
    expect(getByTestId('selected').textContent).toBe('h1');
  });
});
