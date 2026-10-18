import type { JsonValue } from '../core/document';
import type { EditorStore } from '../core/store';
import type { DndStore, DragSession } from './dnd';
import type { Measurer } from './measurer';

import {
  contentPointFromClient,
  createInsertAdapters,
  resolveDropTarget,
} from './insert-dom';

/** How files dropped from the desktop become blocks. */
export type CanvasFileDrop = {
  /** The block type a dropped file becomes (an image block). */
  blockType: string;
  /** The field that takes the uploaded value. */
  field: string;
  /** Uploads one file (an adapter's `uploadMedia`) and resolves the field value. */
  upload: (file: File) => Promise<JsonValue>;
  /** Only files whose type matches (`image/*`, `application/pdf`). Default: every file. */
  accept?: string;
};

function accepts(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  return accept.split(',').some((pattern) => {
    const token = pattern.trim();
    if (token.endsWith('/*')) return file.type.startsWith(token.slice(0, -1));
    return file.type === token;
  });
}

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

/**
 * Native drag and drop of files onto the canvas host (pointer drags cannot
 * carry desktop files): the drop indicator follows the same target logic
 * as block drags, and each dropped file is uploaded and inserted as a
 * `blockType` block at the drop position, in order. Returns the unbind
 * function.
 */
export function bindFileDrop(
  host: HTMLElement,
  deps: {
    store: EditorStore;
    dnd: DndStore;
    measurer: Measurer;
    options: () => CanvasFileDrop | undefined;
  },
): () => void {
  const { store, dnd, measurer } = deps;
  let depth = 0;

  const resolve = (event: DragEvent, session: DragSession) => {
    const { nodes, rootId } = store.getDoc();
    const adapters = createInsertAdapters(host, measurer, nodes, rootId);
    const point = contentPointFromClient(host, {
      x: event.clientX,
      y: event.clientY,
    });
    return resolveDropTarget(
      store.schema,
      nodes,
      rootId,
      session,
      point.x,
      point.y,
      adapters,
    );
  };

  const onDragOver = (event: DragEvent) => {
    const options = deps.options();
    if (!options || !hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    const session: DragSession = { kind: 'new', type: options.blockType };
    if (!dnd.getSession()) dnd.start(session);
    dnd.setDropTarget(resolve(event, session));
  };

  const onDragEnter = (event: DragEvent) => {
    if (deps.options() && hasFiles(event)) depth += 1;
  };

  const onDragLeave = (event: DragEvent) => {
    if (!deps.options() || !hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) dnd.end();
  };

  const onDrop = (event: DragEvent) => {
    const options = deps.options();
    if (!options || !hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    const target =
      dnd.getDropTarget() ??
      resolve(event, { kind: 'new', type: options.blockType });
    dnd.end();
    if (!target) return;
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
      accepts(file, options.accept),
    );
    void (async () => {
      let index = target.index;
      for (const file of files) {
        const value = await options.upload(file);
        const id = store.add(options.blockType, {
          parent: target.parent,
          index,
          props: { [options.field]: value },
        });
        if (id) {
          index += 1;
          store.select(id);
        }
      }
    })();
  };

  host.addEventListener('dragenter', onDragEnter);
  host.addEventListener('dragover', onDragOver);
  host.addEventListener('dragleave', onDragLeave);
  host.addEventListener('drop', onDrop);
  return () => {
    host.removeEventListener('dragenter', onDragEnter);
    host.removeEventListener('dragover', onDragOver);
    host.removeEventListener('dragleave', onDragLeave);
    host.removeEventListener('drop', onDrop);
  };
}
