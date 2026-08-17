// @vitest-environment happy-dom

import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditorApi } from '../hooks';
import type { CmsDocumentClient } from './types';

import { Editor, useEditor, useSave } from '../index';
import { counterGenId, makeTree, storeSchema } from '../store/fixtures';
import {
  BLOCK_NOT_ALLOWED_IN_PARENT,
  COMMIT_MESSAGE_REQUIRED,
  PROTECTED_BRANCH,
  TYPE_MISMATCH,
} from './errors';
import { CMS_RESOLVE_DEBOUNCE_MS, useCmsDocument } from './use-cms-document';

afterEach(cleanup);

const defaultRootId = 'root_1';
const defaultBranchId = 'br_1';

function makeClient(
  overrides: Partial<CmsDocumentClient> = {},
): CmsDocumentClient {
  return {
    getBlockTree: vi.fn(async () => ({
      tree: makeTree(),
      reconstructed: false,
      references: {
        ref_1: {
          blockId: 'ref_1',
          type: 'root',
          properties: { label: 'Hero' },
          children: [],
        },
      },
    })),
    getBranch: vi.fn(async () => ({ headCommitId: 'c1' })),
    updateBlocks: vi.fn(async () => ({
      commit: { id: 'c2' },
      changed: true,
    })),
    resolveTree: vi.fn(async ({ body }) => ({
      tree: body.tree,
      references: {},
    })),
    ...overrides,
  };
}

function renderDoc(
  options: {
    client?: CmsDocumentClient;
    rootId?: string;
    branchId?: string;
    message?: () => string | undefined;
    templates?: CmsDocumentClient extends never
      ? never
      : import('./types').CmsTemplatesClient;
    collection?: string;
  } = {},
) {
  const client = options.client ?? makeClient();
  return renderHook(
    () =>
      useCmsDocument({
        client,
        rootId: options.rootId ?? defaultRootId,
        branchId: options.branchId ?? defaultBranchId,
        message: options.message,
        templates: options.templates,
        collection: options.collection,
      }),
    { initialProps: undefined },
  );
}

function flushResolve(ms = CMS_RESOLVE_DEBOUNCE_MS) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useCmsDocument load', () => {
  it('loads the tree and sets key from headCommitId', async () => {
    const client = makeClient();
    const { result } = renderDoc({ client });

    expect(result.current.status).toBe('loading');

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    expect(result.current.tree?.blockId).toBe('root_1');
    expect(result.current.key).toBe('root_1:br_1:c1');
    expect(client.getBlockTree).toHaveBeenCalledWith({
      query: {
        rootId: defaultRootId,
        branchId: defaultBranchId,
        raw: true,
        includeReferencePreviews: true,
      },
    });
  });
});

describe('useCmsDocument client ref', () => {
  it('keeps the first client when the prop identity changes', async () => {
    const first = makeClient();
    const second = makeClient();
    const { result, rerender } = renderHook(
      ({ client }) =>
        useCmsDocument({
          client,
          rootId: defaultRootId,
          branchId: defaultBranchId,
        }),
      { initialProps: { client: first } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(first.getBlockTree).toHaveBeenCalledTimes(1);
    expect(second.getBlockTree).not.toHaveBeenCalled();

    rerender({ client: second });
    expect(second.getBlockTree).not.toHaveBeenCalled();
  });

  it('reloads on the first client when rootId changes', async () => {
    const first = makeClient();
    const { result, rerender } = renderHook(
      ({ rootId }) =>
        useCmsDocument({
          client: first,
          rootId,
          branchId: defaultBranchId,
        }),
      { initialProps: { rootId: defaultRootId } },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(first.getBlockTree).toHaveBeenCalledTimes(1);

    rerender({ rootId: 'root_2' });
    await waitFor(() => {
      expect(first.getBlockTree).toHaveBeenCalledTimes(2);
    });
  });
});

describe('useCmsDocument save', () => {
  it('roundtrips save with expectedHeadCommitId and keeps key', async () => {
    const client = makeClient();
    const { result } = renderDoc({ client });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    const tree = result.current.tree!;
    await act(async () => {
      await result.current.save(tree);
    });

    expect(client.updateBlocks).toHaveBeenCalledWith({
      body: expect.objectContaining({
        expectedHeadCommitId: 'c1',
        tree: expect.objectContaining({
          type: 'root',
          properties: expect.objectContaining({ __slug: 'home' }),
        }),
      }),
    });
    expect(result.current.headCommitId).toBe('c2');
    expect(result.current.key).toBe('root_1:br_1:c1');
  });

  it('sends message from the hook option or meta override', async () => {
    const client = makeClient();
    const { result: withHookMessage } = renderHook(() =>
      useCmsDocument({
        client,
        rootId: defaultRootId,
        branchId: defaultBranchId,
        message: () => 'edited',
      }),
    );

    await waitFor(() => {
      expect(withHookMessage.current.status).toBe('idle');
    });

    await act(async () => {
      await withHookMessage.current.save(withHookMessage.current.tree!);
    });
    expect(client.updateBlocks).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ message: 'edited' }),
    });

    await act(async () => {
      await withHookMessage.current.save(withHookMessage.current.tree!, {
        message: 'x',
      });
    });
    expect(client.updateBlocks).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ message: 'x' }),
    });
  });

  it('enters conflict on HEAD_MISMATCH then force-saves without head', async () => {
    const client = makeClient({
      updateBlocks: vi
        .fn()
        .mockRejectedValueOnce({
          code: 'HEAD_MISMATCH',
          message: 'The branch has advanced',
        })
        .mockResolvedValueOnce({
          commit: { id: 'c3' },
          changed: true,
        }),
    });
    const { result } = renderDoc({ client });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    const tree = result.current.tree!;
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.save(tree);
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toMatchObject({ code: 'HEAD_MISMATCH' });

    await waitFor(() => {
      expect(result.current.status).toBe('conflict');
    });
    expect(result.current.headCommitId).toBe('c1');

    await act(async () => {
      await result.current.save({ force: true });
    });

    const lastCall = vi.mocked(client.updateBlocks).mock.calls.at(-1);
    expect(lastCall?.[0].body.expectedHeadCommitId).toBeUndefined();
    expect(lastCall?.[0].body.tree).toEqual(tree);
  });

  it('maps TYPE_MISMATCH issues to error.fields', async () => {
    const client = makeClient({
      updateBlocks: vi.fn().mockRejectedValue({
        code: TYPE_MISMATCH,
        message: 'Type mismatch',
        data: {
          blockId: 'h1',
          issues: [{ path: ['text'], message: 'Required' }],
        },
      }),
    });
    const { result } = renderDoc({ client });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    await act(async () => {
      try {
        await result.current.save(result.current.tree!);
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error?.fields).toEqual([
      { blockId: 'h1', key: 'text', message: 'Required' },
    ]);
  });

  it.each([
    BLOCK_NOT_ALLOWED_IN_PARENT,
    PROTECTED_BRANCH,
    COMMIT_MESSAGE_REQUIRED,
  ] as const)('passes through %s', async (code) => {
    const client = makeClient({
      updateBlocks: vi.fn().mockRejectedValue({
        code,
        message: `${code} message`,
      }),
    });
    const { result } = renderDoc({ client });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    await act(async () => {
      try {
        await result.current.save(result.current.tree!);
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.error?.code).toBe(code);
    });
  });
});

describe('useCmsDocument resolve', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a ResolvedReference from the load sidecar', async () => {
    const { result } = renderDoc({});

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    const resolved = await result.current.resolve.reference!('ref_1', {
      type: 'reference',
      collection: 'reusableBlocks',
      label: 'Block',
    });

    expect(resolved).toEqual({
      rootId: 'ref_1',
      collection: 'reusableBlocks',
      properties: { label: 'Hero' },
      tree: {
        blockId: 'ref_1',
        type: 'root',
        properties: { label: 'Hero' },
        children: [],
      },
    });
  });

  it('batches reference misses into one resolveTree call', async () => {
    const client = makeClient();
    const { result } = renderDoc({ client });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    act(() => {
      void result.current.resolve.reference!('miss_a', {
        type: 'reference',
        collection: 'pages',
        label: 'A',
      });
      void result.current.resolve.reference!('miss_b', {
        type: 'reference',
        collection: 'pages',
        label: 'B',
      });
    });

    flushResolve();
    await waitFor(() => {
      expect(client.resolveTree).toHaveBeenCalledTimes(1);
    });
    expect(client.resolveTree).toHaveBeenCalledWith({
      body: expect.objectContaining({ includeReferencePreviews: true }),
    });
  });
});

describe('useCmsDocument reload and onAdd', () => {
  it('reload() refetches and updates key when head changes', async () => {
    const client = makeClient();
    const { result } = renderDoc({ client });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(client.getBlockTree).toHaveBeenCalledTimes(1);

    vi.mocked(client.getBranch).mockResolvedValueOnce({ headCommitId: 'c9' });

    await act(async () => {
      await result.current.reload();
    });

    expect(client.getBlockTree).toHaveBeenCalledTimes(2);
    expect(result.current.key).toBe('root_1:br_1:c9');
  });

  it('onAdd returns {} without templates', async () => {
    const { result } = renderDoc({});

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    await expect(result.current.onAdd('hero')).resolves.toEqual({});
  });

  it('onAdd merges template defaults when configured', async () => {
    const templates = {
      getTemplateDefaults: vi.fn(async () => ({
        defaults: { headline: 'Hi' },
      })),
    };
    const { result } = renderDoc({
      templates,
      collection: 'pages',
    });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    await expect(result.current.onAdd('hero')).resolves.toEqual({
      headline: 'Hi',
    });
    expect(templates.getTemplateDefaults).toHaveBeenCalledWith({
      query: { collection: 'pages', blockType: 'hero' },
    });
  });
});

describe('useCmsDocument Editor.Root integration', () => {
  it('clears dirty after store save through onSave', async () => {
    const client = makeClient();
    const probe: {
      api: EditorApi | null;
      save: ReturnType<typeof useSave> | null;
    } = { api: null, save: null };

    function Probe() {
      probe.api = useEditor();
      probe.save = useSave();
      return null;
    }

    function Harness() {
      const doc = useCmsDocument({
        client,
        rootId: defaultRootId,
        branchId: defaultBranchId,
      });
      if (!doc.tree) return <span data-testid="loading" />;
      return (
        <Editor.Root
          schema={storeSchema}
          defaultValue={doc.tree}
          genId={counterGenId()}
          onSave={doc.save}
          onChange={doc.onChange}
        >
          <Probe />
        </Editor.Root>
      );
    }

    render(<Harness />);

    await waitFor(() => {
      expect(probe.api).not.toBeNull();
    });

    act(() => {
      probe.api!.update('h1', { text: 'Changed' });
    });
    expect(probe.save!.dirty).toBe(true);

    await act(async () => {
      await probe.save!.save();
    });

    expect(client.updateBlocks).toHaveBeenCalled();
    expect(probe.save!.dirty).toBe(false);
  });
});
