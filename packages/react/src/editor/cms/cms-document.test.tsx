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

import { counterGenId } from '../core/store/fixtures';
import { Editor, useEditor, useSave } from '../index';
import { createCmsAdapter } from './adapter';
import {
  BLOCK_NOT_ALLOWED_IN_PARENT,
  COMMIT_MESSAGE_REQUIRED,
  PROTECTED_BRANCH,
  TYPE_MISMATCH,
} from './errors';
import { fromCollection } from './mapping';
import { cmsSchema, makeCmsTree } from './test/cms-fixtures';
import { CMS_RESOLVE_DEBOUNCE_MS, useCmsDocument } from './use-cms-document';

const editorSchema = fromCollection(cmsSchema);

afterEach(cleanup);

const defaultRootId = 'root_1';
const defaultBranchId = 'br_1';

function makeClient(
  overrides: Partial<CmsDocumentClient> = {},
): CmsDocumentClient {
  return {
    getBlockTree: vi.fn(async () => ({
      tree: makeCmsTree(),
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
        definition: cmsSchema,
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

    expect(result.current.doc?.root.id).toBe('root_1');
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
          definition: cmsSchema,
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
          definition: cmsSchema,
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

describe('useCmsDocument persistence', () => {
  async function saveOnce(
    result: { current: ReturnType<typeof useCmsDocument> },
    ctx: { baseVersion?: string; message?: string } = {},
  ) {
    let caught: unknown;
    let version: string | undefined;
    await act(async () => {
      try {
        const saved = await result.current.persistence.save(
          result.current.doc!,
          { ops: [], phase: 'save', ...ctx },
        );
        version = saved.version;
      } catch (err) {
        caught = err;
      }
    });
    return { caught, version };
  }

  it('starts from the loaded head, saves with expectedHeadCommitId and keeps the key', async () => {
    const client = makeClient();
    const { result } = renderDoc({ client });
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(result.current.persistence.baseVersion).toBe('c1');
    expect(result.current.persistence.autosave).toBe(false);

    const { version } = await saveOnce(result, { baseVersion: 'c1' });

    expect(version).toBe('c2');
    expect(client.updateBlocks).toHaveBeenCalledWith({
      body: expect.objectContaining({
        expectedHeadCommitId: 'c1',
        tree: expect.objectContaining({
          type: 'root',
          properties: expect.objectContaining({ __slug: 'home' }),
        }),
      }),
    });
    expect(result.current.key).toBe('root_1:br_1:c1');
  });

  it('sends the message from the hook option unless the save brings its own', async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useCmsDocument({
        client,
        definition: cmsSchema,
        rootId: defaultRootId,
        branchId: defaultBranchId,
        message: () => 'edited',
      }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    await saveOnce(result);
    expect(client.updateBlocks).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ message: 'edited' }),
    });
    await saveOnce(result, { message: 'x' });
    expect(client.updateBlocks).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ message: 'x' }),
    });
  });

  it('turns HEAD_MISMATCH into a conflict carrying the server document and head', async () => {
    const client = makeClient({
      updateBlocks: vi.fn().mockRejectedValueOnce({
        code: 'HEAD_MISMATCH',
        message: 'The branch has advanced',
      }),
    });
    const { result } = renderDoc({ client });
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    const { caught } = await saveOnce(result, { baseVersion: 'c1' });

    expect(caught).toMatchObject({
      kind: 'conflict',
      details: {
        code: 'HEAD_MISMATCH',
        serverVersion: 'c1',
        serverDoc: expect.objectContaining({ schemaVersion: 1 }),
      },
    });
  });

  it('maps TYPE_MISMATCH issues to validation details with fields', async () => {
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

    const { caught } = await saveOnce(result);

    expect(caught).toMatchObject({
      kind: 'validation',
      details: {
        fields: [{ blockId: 'h1', key: 'text', message: 'Required' }],
      },
    });
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

    const { caught } = await saveOnce(result);

    expect(caught).toMatchObject({ details: { code } });
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

    const resolved = await result.current.resolve.reference(
      { id: 'ref_1' },
      {
        type: 'reference',
        collection: 'reusableBlocks',
        label: 'Block',
      },
    );

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

  it('settles an unchanged string to the stored value', async () => {
    const client = makeClient();
    const { result } = renderDoc({ client });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    let resolved: string | undefined;
    act(() => {
      const out = result.current.resolve.text('Hello', {
        type: 'text',
        label: 'Text',
      });
      void Promise.resolve(out).then((value) => {
        resolved = value;
      });
    });

    flushResolve();
    await waitFor(() => {
      expect(resolved).toBe('Hello');
    });
    expect(client.resolveTree).toHaveBeenCalledTimes(1);
  });

  it('batches reference misses into one resolveTree call', async () => {
    const client = makeClient();
    const { result } = renderDoc({ client });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    act(() => {
      void result.current.resolve.reference(
        { id: 'miss_a' },
        {
          type: 'reference',
          collection: 'pages',
          label: 'A',
        },
      );
      void result.current.resolve.reference(
        { id: 'miss_b' },
        {
          type: 'reference',
          collection: 'pages',
          label: 'B',
        },
      );
    });

    flushResolve();
    await waitFor(() => {
      expect(client.resolveTree).toHaveBeenCalledTimes(1);
    });
    expect(client.resolveTree).toHaveBeenCalledWith({
      body: expect.objectContaining({ includeReferencePreviews: true }),
    });
  });

  it('settles a queued miss as undefined when reload runs before debounce', async () => {
    const client = makeClient();
    const { result } = renderDoc({ client });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });

    let resolved: unknown = 'pending';
    act(() => {
      const out = result.current.resolve.reference(
        { id: 'miss_a' },
        {
          type: 'reference',
          collection: 'pages',
          label: 'A',
        },
      );
      void Promise.resolve(out).then((value: unknown) => {
        resolved = value;
      });
    });

    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => {
      expect(resolved).toBeUndefined();
    });
    expect(client.resolveTree).not.toHaveBeenCalled();
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
  it('saves through persistence and clears dirty', async () => {
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
        definition: cmsSchema,
        rootId: defaultRootId,
        branchId: defaultBranchId,
      });
      if (!doc.doc) return <span data-testid="loading" />;
      return (
        <Editor.Root
          schema={editorSchema}
          defaultValue={doc.doc}
          genId={counterGenId()}
          persistence={doc.persistence}
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

describe('createCmsAdapter.resolveReference', () => {
  it('loads a referenced root of the collection as a document', async () => {
    const client = makeClient();
    const adapter = createCmsAdapter({
      client,
      definition: cmsSchema,
      branchId: defaultBranchId,
    });
    const doc = await adapter.resolveReference!({
      collection: 'pages',
      id: 'root_2',
    });
    expect(doc.root.type).toBe('root');
    expect(client.getBlockTree).toHaveBeenCalledWith({
      query: expect.objectContaining({ rootId: 'root_2' }),
    });
  });
});
