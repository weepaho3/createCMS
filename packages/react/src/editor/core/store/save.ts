import type { EditorDocument, Op } from '../document';
import type { ValidationIssue } from '../schema';
import type {
  BeforeSaveGate,
  PersistenceOptions,
  SavePhase,
  SaveState,
  Timers,
} from './types';

import { EditorAdapterError } from '../adapter';
import { validateDocument } from '../schema';

/** Autosave waits this long after the last change. */
export const SAVE_DEBOUNCE_MS = 1500;
/** Autosave saves at least this often while changes keep coming. */
export const SAVE_MAX_WAIT_MS = 10_000;
/** First retry delay after a network failure; doubles up to `SAVE_RETRY_MAX_MS`. */
export const SAVE_RETRY_BASE_MS = 1000;
export const SAVE_RETRY_MAX_MS = 30_000;

export const INITIAL_SAVE_STATE: SaveState = {
  status: 'idle',
  dirty: false,
  error: null,
  conflict: null,
  version: null,
  issues: [],
};

export type SaveScheduler = {
  /** A local change (never remote) to save. */
  noteChange(ops: readonly Op[]): void;
  /** A new baseline: nothing unsaved, `version` as the base. */
  reset(version: string | null): void;
  save(options?: {
    message?: string;
    force?: boolean;
    phase?: 'save' | 'publish';
  }): Promise<void>;
  destroy(): void;
};

/**
 * Saves local changes through `persistence.save`: debounced, with a
 * maximum wait, never two saves at once (a save requested during a save
 * runs right after it), retrying network failures with exponential backoff. A
 * conflict stops autosave until the document is reloaded or saved with
 * `force`.
 */
export function createSaveScheduler(options: {
  persistence: PersistenceOptions | undefined;
  timers: Timers;
  getDocument: () => EditorDocument;
  setState: (patch: Partial<SaveState>) => void;
  getState: () => SaveState;
  /** Issues that block this save (a promise when a gate is async). */
  gate: (
    doc: EditorDocument,
    ops: readonly Op[],
    phase: SavePhase,
  ) => readonly ValidationIssue[] | Promise<readonly ValidationIssue[]>;
  onBeforeSave: (doc: EditorDocument, ops: readonly Op[]) => void;
  onAfterSave: (version: string) => void;
  onError: (error: Error) => void;
}): SaveScheduler {
  const { persistence, timers, setState, getState } = options;
  const autosave =
    persistence?.autosave === false ? null : (persistence?.autosave ?? {});
  const debounceMs = autosave?.debounceMs ?? SAVE_DEBOUNCE_MS;
  const maxWaitMs = autosave?.maxWaitMs ?? SAVE_MAX_WAIT_MS;

  let localRev = 0;
  let savedRev = 0;
  let unsaved: Op[] = [];
  let version: string | null = persistence?.baseVersion ?? null;
  let inFlight: Promise<void> | null = null;
  let again = false;
  let debounce: unknown = null;
  let maxWait: unknown = null;
  let retry: unknown = null;
  let attempt = 0;
  let destroyed = false;

  setState({ version });

  const clear = (handle: unknown): null => {
    if (handle !== null) timers.clearTimeout(handle);
    return null;
  };
  const clearAll = (): void => {
    debounce = clear(debounce);
    maxWait = clear(maxWait);
    retry = clear(retry);
  };

  const schedule = (): void => {
    if (!autosave || destroyed || getState().status === 'conflict') return;
    debounce = clear(debounce);
    debounce = timers.setTimeout(() => {
      debounce = null;
      void run({ phase: 'autosave' });
    }, debounceMs);
    if (maxWait === null) {
      maxWait = timers.setTimeout(() => {
        maxWait = null;
        void run({ phase: 'autosave' });
      }, maxWaitMs);
    }
  };

  const run = (opts: {
    message?: string;
    force?: boolean;
    phase: SavePhase;
  }): Promise<void> => {
    if (!persistence || destroyed) return Promise.resolve();
    if (inFlight) {
      again = true;
      return inFlight;
    }
    if (localRev === savedRev && !opts.force) return Promise.resolve();
    clearAll();
    const rev = localRev;
    const ops = unsaved.slice();
    const doc = options.getDocument();
    const proceed = (issues: readonly ValidationIssue[]): Promise<void> => {
      if (issues.length > 0) {
        again = false;
        setState({ status: 'invalid', error: null, issues });
        return Promise.resolve();
      }
      return send(rev, ops, doc, opts);
    };
    const gated = options.gate(doc, ops, opts.phase);
    if (!('then' in gated)) return proceed(gated);
    // An async gate holds the slot, so no second save starts meanwhile.
    const waiting = gated.then((issues) => {
      inFlight = null;
      return proceed(issues);
    });
    inFlight = waiting;
    return waiting;
  };

  const send = (
    rev: number,
    ops: Op[],
    doc: EditorDocument,
    opts: { message?: string; force?: boolean; phase: SavePhase },
  ): Promise<void> => {
    if (!persistence) return Promise.resolve();
    setState({ status: 'saving', error: null, issues: [] });
    options.onBeforeSave(doc, ops);
    const ctx: Parameters<PersistenceOptions['save']>[1] = {
      ops,
      baseVersion: version !== null && !opts.force ? version : undefined,
      force: opts.force === true ? true : undefined,
      message: opts.message,
      phase: opts.phase,
    };
    inFlight = persistence
      .save(doc, ctx)
      .then(
        (result) => {
          attempt = 0;
          savedRev = rev;
          unsaved = unsaved.slice(ops.length);
          version = result.version;
          setState({
            status: 'idle',
            dirty: localRev !== savedRev,
            error: null,
            conflict: null,
            version,
          });
          options.onAfterSave(result.version);
        },
        (raw: unknown) => {
          const error = raw instanceof Error ? raw : new Error(String(raw));
          options.onError(error);
          if (
            error instanceof EditorAdapterError &&
            error.kind === 'conflict'
          ) {
            const serverDoc = error.details.serverDoc;
            const serverVersion = error.details.serverVersion;
            setState({
              status: 'conflict',
              error,
              conflict: {
                serverDoc:
                  typeof serverDoc === 'object' && serverDoc !== null
                    ? (serverDoc as EditorDocument)
                    : null,
                serverVersion:
                  typeof serverVersion === 'string' ? serverVersion : null,
              },
            });
            again = false;
            return;
          }
          setState({ status: 'error', error });
          if (error instanceof EditorAdapterError && error.kind === 'network') {
            const delay = Math.min(
              SAVE_RETRY_BASE_MS * 2 ** attempt,
              SAVE_RETRY_MAX_MS,
            );
            attempt += 1;
            retry = timers.setTimeout(() => {
              retry = null;
              void run({ phase: opts.phase });
            }, delay);
          }
          again = false;
        },
      )
      .finally(() => {
        inFlight = null;
        if (again && !destroyed) {
          again = false;
          void run({ phase: 'autosave' });
        }
      });
    return inFlight;
  };

  return {
    noteChange(ops) {
      localRev += 1;
      unsaved.push(...ops);
      if (!getState().dirty) setState({ dirty: true });
      schedule();
    },
    reset(next) {
      clearAll();
      attempt = 0;
      savedRev = localRev;
      unsaved = [];
      version = next;
      setState({ ...INITIAL_SAVE_STATE, version });
    },
    save: (opts = {}) => run({ ...opts, phase: opts.phase ?? 'save' }),
    destroy() {
      destroyed = true;
      clearAll();
    },
  };
}

/**
 * A `beforeSave` gate that blocks on `validateDocument` errors (warnings
 * pass). Runs for `save` and `publish` by default, so autosave keeps
 * storing drafts; `publish` validates with the publish phase.
 */
export function requireValidDocument(
  options: { phases?: readonly SavePhase[] } = {},
): BeforeSaveGate {
  const phases = options.phases ?? ['save', 'publish'];
  return async ({ doc, schema, phase }) => {
    if (!phases.includes(phase)) return [];
    const issues = await validateDocument(doc, schema, {
      phase: phase === 'publish' ? 'publish' : 'edit',
    });
    return issues.filter((issue) => issue.severity === 'error');
  };
}
