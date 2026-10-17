import type { EditorDocument } from './document';
import type {
  AnyEditorSchema,
  ValidateDocumentOptions,
  ValidationIssue,
} from './schema';
import type { MergeResult } from './store/merge';

import { validateDocument } from './schema';
import { mergeByNode } from './store/merge';

/** Documents with fewer nodes than this stay on the main thread. */
export const WORKER_THRESHOLD = 500;

/** The worker side of a port: `postMessage` and message events. */
export type WorkerPort = {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void;
};

type Request =
  | {
      id: number;
      task: 'validateDocument';
      doc: EditorDocument;
      options: ValidateDocumentOptions;
    }
  | {
      id: number;
      task: 'mergeByNode';
      base: EditorDocument;
      local: EditorDocument;
      server: EditorDocument;
    };

/** A request before it gets its id. */
type RequestBody = Request extends infer R
  ? R extends unknown
    ? Omit<R, 'id'>
    : never
  : never;

type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; message: string };

/** The heavy whole-document tasks, on a worker when one is given and the document is big. */
export type WorkerTasks = {
  validateDocument(
    doc: EditorDocument,
    options?: ValidateDocumentOptions,
  ): Promise<ValidationIssue[]>;
  mergeByNode(
    base: EditorDocument,
    local: EditorDocument,
    server: EditorDocument,
  ): Promise<MergeResult>;
  /** Stops listening to the worker; pending tasks reject. */
  dispose(): void;
};

function countNodes(doc: EditorDocument): number {
  let count = 0;
  const stack = [doc.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    count += 1;
    for (const children of Object.values(node.slots ?? {})) {
      stack.push(...children);
    }
  }
  return count;
}

/**
 * Runs whole-document validation and the conflict merge off the main thread.
 * The worker runs `serveWorkerTasks` with the same schema (schemas carry
 * functions, so they cannot be posted). Without a `worker`, or for
 * documents below `threshold` nodes, tasks run on the main thread. The
 * store itself never moves to a worker: rendering reads it synchronously.
 */
export function createWorkerTasks(options: {
  schema: AnyEditorSchema;
  worker?: WorkerPort;
  threshold?: number;
}): WorkerTasks {
  const { schema, worker } = options;
  const threshold = options.threshold ?? WORKER_THRESHOLD;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  const onMessage = (event: { data: unknown }) => {
    const response = event.data as Response;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok) entry.resolve(response.result);
    else entry.reject(new Error(response.message));
  };
  worker?.addEventListener('message', onMessage);

  const post = <T>(request: RequestBody): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      worker!.postMessage({ ...request, id }, []);
    });

  return {
    validateDocument(doc, validateOptions = {}) {
      if (!worker || countNodes(doc) < threshold) {
        return validateDocument(doc, schema, validateOptions);
      }
      return post<ValidationIssue[]>({
        task: 'validateDocument',
        doc,
        options: validateOptions,
      });
    },
    mergeByNode(base, local, server) {
      if (!worker || countNodes(local) < threshold) {
        return Promise.resolve(mergeByNode(base, local, server));
      }
      return post<MergeResult>({ task: 'mergeByNode', base, local, server });
    },
    dispose() {
      worker?.removeEventListener('message', onMessage);
      for (const entry of pending.values()) {
        entry.reject(new Error('worker tasks disposed'));
      }
      pending.clear();
    },
  };
}

/**
 * The worker half of `createWorkerTasks`: answers its requests with the
 * given schema. Call it in the worker script (`serveWorkerTasks(self,
 * { schema })`); returns a function that stops serving.
 */
export function serveWorkerTasks(
  port: WorkerPort,
  options: { schema: AnyEditorSchema },
): () => void {
  const onMessage = (event: { data: unknown }) => {
    const request = event.data as Request;
    const run = async (): Promise<unknown> => {
      if (request.task === 'validateDocument') {
        return validateDocument(request.doc, options.schema, request.options);
      }
      return mergeByNode(request.base, request.local, request.server);
    };
    run().then(
      (result) => port.postMessage({ id: request.id, ok: true, result }, []),
      (error: unknown) =>
        port.postMessage(
          {
            id: request.id,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          },
          [],
        ),
    );
  };
  port.addEventListener('message', onMessage);
  return () => port.removeEventListener('message', onMessage);
}
