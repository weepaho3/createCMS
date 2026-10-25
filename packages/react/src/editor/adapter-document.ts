import * as React from 'react';

import type {
  EditorAdapterErrorKind,
  PersistenceAdapter,
} from './core/adapter';
import type { EditorDocument } from './core/document';
import type { PersistenceOptions } from './core/store';

import { EditorAdapterError } from './core/adapter';

export type AdapterDocumentStatus = 'loading' | 'idle' | 'error';

export type AdapterDocumentError = {
  readonly kind: EditorAdapterErrorKind;
  readonly message: string;
};

export type UseAdapterDocumentOptions = {
  adapter: PersistenceAdapter;
  /** The document to load and save. */
  id: string;
  /** The version of the document `load` returns, when the adapter knows it. */
  baseVersion?: string;
  /** Pass-through to `PersistenceOptions.autosave`. */
  autosave?: PersistenceOptions['autosave'];
};

export type UseAdapterDocumentResult = {
  /** The loaded document, `null` while the first load runs or after it failed. */
  readonly doc: EditorDocument | null;
  /** Changes with every load: key `Editor.Root` with it to start over. */
  readonly key: string;
  readonly status: AdapterDocumentStatus;
  /** The last load failure. */
  readonly error: AdapterDocumentError | null;
  /** Pass to `Editor.Root`: saves through the adapter. */
  readonly persistence: PersistenceOptions;
  reload(): Promise<void>;
};

function errorOf(err: unknown): AdapterDocumentError {
  if (err instanceof EditorAdapterError) {
    return { kind: err.kind, message: err.message };
  }
  return {
    kind: 'unknown',
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Loads document `id` through a `PersistenceAdapter` (an `EditorAdapter`,
 * `createMemoryAdapter`, ...) and returns what `Editor.Root` needs to edit
 * and save it: `doc` as `defaultValue`, `key`, and `persistence`. A reload
 * that loses the race to a newer one is dropped.
 */
export function useAdapterDocument(
  options: UseAdapterDocumentOptions,
): UseAdapterDocumentResult {
  const { adapter, id, baseVersion, autosave } = options;
  const [doc, setDoc] = React.useState<EditorDocument | null>(null);
  const [status, setStatus] = React.useState<AdapterDocumentStatus>('loading');
  const [error, setError] = React.useState<AdapterDocumentError | null>(null);
  const [generation, setGeneration] = React.useState(0);
  const latest = React.useRef(0);

  const reload = React.useCallback(async () => {
    latest.current += 1;
    const run = latest.current;
    setStatus('loading');
    setError(null);
    try {
      const loaded = await adapter.load(id);
      if (run !== latest.current) return;
      setDoc(loaded);
      setGeneration(run);
      setStatus('idle');
    } catch (err) {
      if (run !== latest.current) return;
      setError(errorOf(err));
      setStatus('error');
    }
  }, [adapter, id]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const persistence = React.useMemo<PersistenceOptions>(
    () => ({
      baseVersion,
      autosave,
      save: (next, ctx) =>
        adapter.save(id, next, {
          ops: ctx.ops,
          baseVersion: ctx.force ? undefined : ctx.baseVersion,
          message: ctx.message,
        }),
    }),
    [adapter, id, baseVersion, autosave],
  );

  return {
    doc,
    key: `${id}:${generation}`,
    status,
    error,
    persistence,
    reload,
  };
}
