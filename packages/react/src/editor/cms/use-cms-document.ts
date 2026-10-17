import type {
  AnyCollectionDefinition,
  BlockTreeNode,
  LinkValue,
  ResolvedLink,
  ResolvedReference,
} from '@createcms/schema';

import * as React from 'react';

import type { EditorDocument, Field } from '../core';
import type {
  CmsDocumentResolve,
  CmsDocumentStatus,
  UseCmsDocumentOptions,
  UseCmsDocumentResult,
} from './types';

import { createCmsAdapter } from './adapter';
import { HEAD_MISMATCH, readCmsError } from './errors';
import { cmsValueToEditor, fromEditor } from './mapping';

/** The createcms error behind an adapter error (its `cause`), for `readCmsError`. */
function causeOf(err: unknown): unknown {
  return err instanceof Error && err.cause !== undefined ? err.cause : err;
}

export const CMS_RESOLVE_DEBOUNCE_MS = 100;

type PendingResolve =
  | {
      kind: 'reference';
      raw: string;
      spec: Field;
      resolve: (value: ResolvedReference | undefined) => void;
    }
  | {
      kind: 'link';
      raw: LinkValue;
      spec: Field;
      resolve: (value: ResolvedLink | undefined) => void;
    }
  | {
      kind: 'string';
      raw: string;
      spec: Field;
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

function readReferenceCollection(spec: Field): string {
  return spec.type === 'reference' ? spec.collection : '';
}

/** The id inside a reference value (`{ id }`), or `undefined`. */
function referenceId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

function sidecarReference(
  rootId: string,
  tree: BlockTreeNode,
  spec: Field,
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
    if (typeof rawVal === 'string' && typeof resolvedVal === 'string') {
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

  const resolveString = (value: unknown, spec: Field) => {
    if (typeof value !== 'string') return undefined;
    const cached = stringCacheRef.current.get(value);
    if (cached !== undefined) return cached;
    return new Promise<string | undefined>((resolve) => {
      pendingRef.current.push({ kind: 'string', raw: value, spec, resolve });
      scheduleFlush();
    }) as Promise<string>;
  };

  return {
    reference(value, spec) {
      const rootId = referenceId(value);
      if (rootId === undefined) return undefined;
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
      });
    },
    link(value, spec) {
      if (typeof value !== 'object' || value === null) return undefined;
      const link = value as LinkValue;
      const cached = linkCacheRef.current.get(JSON.stringify(link));
      if (cached) return cached;
      return new Promise<ResolvedLink | undefined>((resolve) => {
        pendingRef.current.push({ kind: 'link', raw: link, spec, resolve });
        scheduleFlush();
      });
    },
    text: resolveString,
    textarea: resolveString,
    richText: resolveString,
  } satisfies CmsDocumentResolve;
}

function settlePendingMisses(batch: PendingResolve[]): void {
  for (const item of batch) {
    item.resolve(undefined);
  }
}

function clearResolveState(
  sidecarRef: React.RefObject<Map<string, BlockTreeNode>>,
  linkCacheRef: React.RefObject<Map<string, ResolvedLink>>,
  stringCacheRef: React.RefObject<Map<string, string>>,
  pendingRef: React.RefObject<PendingResolve[]>,
  timerRef: React.RefObject<ReturnType<typeof setTimeout> | null>,
  resolveEpochRef: React.RefObject<number>,
): void {
  const pending = pendingRef.current;
  pendingRef.current = [];
  settlePendingMisses(pending);
  sidecarRef.current.clear();
  linkCacheRef.current.clear();
  stringCacheRef.current.clear();
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
  const definitionRef = React.useRef<AnyCollectionDefinition>(
    options.definition,
  );
  const {
    rootId,
    branchId,
    message,
    includeReferencePreviews = true,
    templates,
    collection,
  } = options;

  const [doc, setDoc] = React.useState<EditorDocument | null>(null);
  const [headCommitId, setHeadCommitId] = React.useState<string | null>(null);
  const [key, setKey] = React.useState('');
  const [status, setStatus] = React.useState<CmsDocumentStatus>('loading');
  const [error, setError] = React.useState<
    import('./errors').CmsDocumentError | null
  >(null);

  const lastTreeRef = React.useRef<BlockTreeNode | null>(null);
  const pendingForceDocRef = React.useRef<EditorDocument | null>(null);
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
      settlePendingMisses(batch);
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
      if (epoch !== resolveEpochRef.current) {
        settlePendingMisses(batch);
        return;
      }

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
          item.resolve(stringCacheRef.current.get(item.raw) ?? item.raw);
        }
      }
    } catch {
      if (epoch !== resolveEpochRef.current) {
        settlePendingMisses(batch);
        return;
      }
      settlePendingMisses(batch);
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
      const snapshot = await createCmsAdapter({
        client: clientRef.current,
        definition: definitionRef.current,
        branchId,
        includeReferencePreviews,
      }).loadSnapshot(rootId);
      if (gen !== generationRef.current) return;

      const head = snapshot.headCommitId;
      setDoc(snapshot.doc);
      setHeadCommitId(head);
      setKey(`${rootId}:${branchId}:${head}`);
      lastTreeRef.current = snapshot.tree;
      pendingForceDocRef.current = null;

      sidecarRef.current = new Map(Object.entries(snapshot.references));
      setStatus('idle');
      setError(null);
    } catch (err) {
      if (gen !== generationRef.current) return;
      setStatus('error');
      setError(readCmsError(causeOf(err)));
    }
  }, [rootId, branchId, includeReferencePreviews]);

  React.useEffect(() => {
    rootIdRef.current = rootId;
    branchIdRef.current = branchId;
    void reload();
  }, [reload, rootId, branchId]);

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
      docOrForce: EditorDocument | { force: true },
      meta?: { message?: string; force?: boolean },
    ): Promise<void> => {
      let doc: EditorDocument;
      let force: boolean;
      if (isForceArg(docOrForce)) {
        const pending = pendingForceDocRef.current;
        if (!pending) {
          throw new Error('useCmsDocument: no document to force-save');
        }
        doc = pending;
        force = true;
      } else {
        doc = docOrForce;
        force = meta?.force === true;
      }

      const fromMessage = message?.();
      const msg = meta?.message ?? fromMessage;
      const bodyMessage = msg !== undefined && msg !== '' ? msg : undefined;

      setStatus('saving');
      try {
        const adapter = createCmsAdapter({
          client: clientRef.current,
          definition: definitionRef.current,
          branchId,
        });
        const result = await adapter.save(rootId, doc, {
          ops: [],
          baseVersion:
            force || headCommitId === null ? undefined : headCommitId,
          message: bodyMessage,
        });
        setHeadCommitId(result.version);
        lastTreeRef.current = fromEditor(doc, definitionRef.current);
        pendingForceDocRef.current = null;
        setStatus('idle');
        setError(null);
      } catch (err) {
        const cmsError = readCmsError(causeOf(err));
        if (cmsError.code === HEAD_MISMATCH) {
          setStatus('conflict');
          setError(cmsError);
          pendingForceDocRef.current = doc;
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
    (change: { getDocument: () => EditorDocument }) => {
      lastTreeRef.current = fromEditor(
        change.getDocument(),
        definitionRef.current,
      );
    },
    [],
  );

  const onAdd = React.useCallback(
    async (blockType: string): Promise<Record<string, unknown>> => {
      if (!templates || !collection) return {};
      const { defaults } = await templates.getTemplateDefaults({
        query: { collection, blockType },
      });
      const specs = definitionRef.current.blocks?.[blockType]?.properties ?? {};
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(defaults)) {
        const spec = specs[key];
        out[key] = spec ? cmsValueToEditor(spec, value) : value;
      }
      return out;
    },
    [templates, collection],
  );

  return {
    doc,
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
