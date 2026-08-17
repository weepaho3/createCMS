import type {
  BlockProperty,
  BlockTreeNode,
  LinkValue,
  ResolvedLink,
  ResolvedReference,
} from '@createcms/schema';

import * as React from 'react';

import type {
  CmsDocumentResolve,
  CmsDocumentStatus,
  UseCmsDocumentOptions,
  UseCmsDocumentResult,
} from './types';

import { HEAD_MISMATCH, readCmsError } from './errors';

export const CMS_RESOLVE_DEBOUNCE_MS = 100;

type PendingResolve =
  | {
      kind: 'reference';
      raw: string;
      spec: BlockProperty;
      resolve: (value: ResolvedReference | undefined) => void;
    }
  | {
      kind: 'link';
      raw: LinkValue;
      spec: BlockProperty;
      resolve: (value: ResolvedLink | undefined) => void;
    }
  | {
      kind: 'string';
      raw: string;
      spec: BlockProperty;
      resolve: (value: string | undefined) => void;
    };

function isForceArg(value: unknown): value is { force: true } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'force' in value &&
    (value as { force: unknown }).force === true &&
    !('blockId' in value)
  );
}

function readReferenceCollection(spec: BlockProperty): string {
  const collection = (spec as { collection?: string }).collection;
  return typeof collection === 'string' ? collection : '';
}

function sidecarReference(
  rootId: string,
  tree: BlockTreeNode,
  spec: BlockProperty,
): ResolvedReference {
  const properties =
    tree.properties && typeof tree.properties === 'object'
      ? tree.properties
      : {};
  return {
    rootId,
    collection: readReferenceCollection(spec),
    properties,
    tree,
  };
}

function walkTreesInLockstep(
  raw: BlockTreeNode,
  resolved: BlockTreeNode,
  linkCache: Map<string, ResolvedLink>,
  stringCache: Map<string, string>,
): void {
  const rawProps = raw.properties ?? {};
  const resolvedProps = resolved.properties ?? {};
  for (const key of Object.keys(rawProps)) {
    const rawVal = rawProps[key];
    const resolvedVal = resolvedProps[key];
    if (rawVal === undefined || resolvedVal === undefined) continue;
    if (
      typeof rawVal === 'object' &&
      rawVal !== null &&
      typeof resolvedVal === 'object' &&
      resolvedVal !== null &&
      JSON.stringify(rawVal) !== JSON.stringify(resolvedVal)
    ) {
      if (typeof rawVal === 'object' && rawVal !== null && 'kind' in rawVal) {
        linkCache.set(JSON.stringify(rawVal), resolvedVal as ResolvedLink);
      }
    }
    if (
      typeof rawVal === 'string' &&
      typeof resolvedVal === 'string' &&
      rawVal !== resolvedVal
    ) {
      stringCache.set(rawVal, resolvedVal);
    }
  }
  const resolvedChildrenById = new Map(
    (resolved.children ?? []).map((child) => [child.blockId, child]),
  );
  for (const rawChild of raw.children ?? []) {
    const resolvedChild = resolvedChildrenById.get(rawChild.blockId);
    if (resolvedChild) {
      walkTreesInLockstep(rawChild, resolvedChild, linkCache, stringCache);
    }
  }
}

function createResolveObject(
  sidecarRef: React.RefObject<Map<string, BlockTreeNode>>,
  linkCacheRef: React.RefObject<Map<string, ResolvedLink>>,
  stringCacheRef: React.RefObject<Map<string, string>>,
  pendingRef: React.RefObject<PendingResolve[]>,
  timerRef: React.RefObject<ReturnType<typeof setTimeout> | null>,
  lastTreeRef: React.RefObject<BlockTreeNode | null>,
  resolveEpochRef: React.RefObject<number>,
  flushResolve: () => Promise<void>,
): CmsDocumentResolve {
  const scheduleFlush = () => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushResolve();
    }, CMS_RESOLVE_DEBOUNCE_MS);
  };

  return {
    reference(rootId, spec) {
      const sidecar = sidecarRef.current.get(rootId);
      if (sidecar) {
        return sidecarReference(rootId, sidecar, spec);
      }
      return new Promise<ResolvedReference | undefined>((resolve) => {
        pendingRef.current.push({
          kind: 'reference',
          raw: rootId,
          spec,
          resolve,
        });
        scheduleFlush();
      }) as Promise<ResolvedReference>;
    },
    link(value, spec) {
      const cached = linkCacheRef.current.get(JSON.stringify(value));
      if (cached) return cached;
      return new Promise<ResolvedLink | undefined>((resolve) => {
        pendingRef.current.push({ kind: 'link', raw: value, spec, resolve });
        scheduleFlush();
      }) as Promise<ResolvedLink>;
    },
    string(value, spec) {
      const cached = stringCacheRef.current.get(value);
      if (cached !== undefined) return cached;
      return new Promise<string | undefined>((resolve) => {
        pendingRef.current.push({ kind: 'string', raw: value, spec, resolve });
        scheduleFlush();
      }) as Promise<string>;
    },
  } satisfies CmsDocumentResolve;
}

function clearResolveState(
  sidecarRef: React.MutableRefObject<Map<string, BlockTreeNode>>,
  linkCacheRef: React.MutableRefObject<Map<string, ResolvedLink>>,
  stringCacheRef: React.MutableRefObject<Map<string, string>>,
  pendingRef: React.MutableRefObject<PendingResolve[]>,
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  resolveEpochRef: React.MutableRefObject<number>,
): void {
  sidecarRef.current.clear();
  linkCacheRef.current.clear();
  stringCacheRef.current.clear();
  pendingRef.current = [];
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
  resolveEpochRef.current += 1;
}

export function useCmsDocument(
  options: UseCmsDocumentOptions,
): UseCmsDocumentResult {
  const clientRef = React.useRef(options.client);
  const {
    rootId,
    branchId,
    message,
    includeReferencePreviews = true,
    templates,
    collection,
  } = options;

  const [tree, setTree] = React.useState<BlockTreeNode | null>(null);
  const [headCommitId, setHeadCommitId] = React.useState<string | null>(null);
  const [key, setKey] = React.useState('');
  const [status, setStatus] = React.useState<CmsDocumentStatus>('loading');
  const [error, setError] = React.useState<
    import('./errors').CmsDocumentError | null
  >(null);

  const lastTreeRef = React.useRef<BlockTreeNode | null>(null);
  const pendingForceTreeRef = React.useRef<BlockTreeNode | null>(null);
  const generationRef = React.useRef(0);

  const sidecarRef = React.useRef(new Map<string, BlockTreeNode>());
  const linkCacheRef = React.useRef(new Map<string, ResolvedLink>());
  const stringCacheRef = React.useRef(new Map<string, string>());
  const pendingRef = React.useRef<PendingResolve[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveEpochRef = React.useRef(0);

  const rootIdRef = React.useRef(rootId);
  const branchIdRef = React.useRef(branchId);

  const flushResolveRef = React.useRef<() => Promise<void>>(async () => {});

  const resolveObjRef = React.useRef<CmsDocumentResolve>(
    createResolveObject(
      sidecarRef,
      linkCacheRef,
      stringCacheRef,
      pendingRef,
      timerRef,
      lastTreeRef,
      resolveEpochRef,
      () => flushResolveRef.current(),
    ),
  );

  flushResolveRef.current = async () => {
    const epoch = resolveEpochRef.current;
    const postedTree = lastTreeRef.current;
    const batch = pendingRef.current;
    pendingRef.current = [];

    if (!postedTree) {
      for (const item of batch) item.resolve(undefined);
      return;
    }

    try {
      const result = await clientRef.current.resolveTree({
        body: {
          rootId: rootIdRef.current,
          branchId: branchIdRef.current,
          tree: postedTree,
          includeReferencePreviews: true,
        },
      });
      if (epoch !== resolveEpochRef.current) return;

      if (result.references) {
        for (const [id, node] of Object.entries(result.references)) {
          sidecarRef.current.set(id, node);
        }
      }

      walkTreesInLockstep(
        postedTree,
        result.tree,
        linkCacheRef.current,
        stringCacheRef.current,
      );

      for (const item of batch) {
        if (item.kind === 'reference') {
          const hit = sidecarRef.current.get(item.raw);
          item.resolve(
            hit ? sidecarReference(item.raw, hit, item.spec) : undefined,
          );
        } else if (item.kind === 'link') {
          item.resolve(
            linkCacheRef.current.get(JSON.stringify(item.raw)) ?? undefined,
          );
        } else {
          item.resolve(stringCacheRef.current.get(item.raw) ?? undefined);
        }
      }
    } catch {
      if (epoch !== resolveEpochRef.current) return;
      for (const item of batch) item.resolve(undefined);
    }
  };

  const reload = React.useCallback(async () => {
    generationRef.current += 1;
    const gen = generationRef.current;
    setStatus('loading');
    setError(null);

    clearResolveState(
      sidecarRef,
      linkCacheRef,
      stringCacheRef,
      pendingRef,
      timerRef,
      resolveEpochRef,
    );
    resolveObjRef.current = createResolveObject(
      sidecarRef,
      linkCacheRef,
      stringCacheRef,
      pendingRef,
      timerRef,
      lastTreeRef,
      resolveEpochRef,
      () => flushResolveRef.current(),
    );

    try {
      const [blockResult, branchResult] = await Promise.all([
        clientRef.current.getBlockTree({
          query: {
            rootId,
            branchId,
            raw: true,
            includeReferencePreviews,
          },
        }),
        clientRef.current.getBranch({ query: { branchId } }),
      ]);
      if (gen !== generationRef.current) return;

      const head = branchResult.headCommitId;
      setTree(blockResult.tree);
      setHeadCommitId(head);
      setKey(`${rootId}:${branchId}:${head}`);
      lastTreeRef.current = blockResult.tree;
      pendingForceTreeRef.current = null;

      sidecarRef.current = new Map(
        Object.entries(blockResult.references ?? {}),
      );
      setStatus('idle');
      setError(null);
    } catch (err) {
      if (gen !== generationRef.current) return;
      setStatus('error');
      setError(readCmsError(err));
    }
  }, [rootId, branchId, includeReferencePreviews]);

  React.useEffect(() => {
    rootIdRef.current = rootId;
    branchIdRef.current = branchId;
    void reload();
  }, [reload]);

  React.useEffect(() => {
    return () => {
      generationRef.current += 1;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const saveImpl = React.useCallback(
    async (
      treeOrForce: BlockTreeNode | { force: true },
      meta?: { message?: string; force?: boolean },
    ): Promise<void> => {
      let tree: BlockTreeNode;
      let force = false;
      if (isForceArg(treeOrForce)) {
        const pending = pendingForceTreeRef.current;
        if (!pending) {
          throw new Error('useCmsDocument: no tree to force-save');
        }
        tree = pending;
        force = true;
      } else {
        tree = treeOrForce;
        force = meta?.force === true;
      }

      const fromMessage = message?.();
      const msg = meta?.message ?? fromMessage;
      const bodyMessage = msg !== undefined && msg !== '' ? msg : undefined;

      setStatus('saving');
      try {
        const result = await clientRef.current.updateBlocks({
          body: {
            rootId,
            branchId,
            tree,
            ...(bodyMessage !== undefined ? { message: bodyMessage } : {}),
            ...(force || headCommitId === null
              ? {}
              : { expectedHeadCommitId: headCommitId }),
          },
        });
        setHeadCommitId(result.commit.id);
        lastTreeRef.current = tree;
        pendingForceTreeRef.current = null;
        setStatus('idle');
        setError(null);
      } catch (err) {
        const cmsError = readCmsError(err);
        if (cmsError.code === HEAD_MISMATCH) {
          setStatus('conflict');
          setError(cmsError);
          pendingForceTreeRef.current = tree;
          throw err;
        }
        setStatus('error');
        setError(cmsError);
        throw err;
      }
    },
    [rootId, branchId, message, headCommitId],
  );

  const save = saveImpl as UseCmsDocumentResult['save'];

  const onChange = React.useCallback(
    (change: { getTree: () => BlockTreeNode }) => {
      lastTreeRef.current = change.getTree();
    },
    [],
  );

  const onAdd = React.useCallback(
    async (blockType: string): Promise<Record<string, unknown>> => {
      if (!templates || !collection) return {};
      const { defaults } = await templates.getTemplateDefaults({
        query: { collection, blockType },
      });
      return { ...defaults };
    },
    [templates, collection],
  );

  return {
    tree,
    key,
    headCommitId,
    resolve: resolveObjRef.current,
    status,
    error,
    save,
    reload,
    onChange,
    onAdd,
  };
}
