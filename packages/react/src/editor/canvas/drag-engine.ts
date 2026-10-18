import type { AnyEditorSchema } from '../core/schema';
import type { EditorStore } from '../core/store';
import type { DndStore, DragSession } from './dnd';
import type { InsertTarget } from './insert';
import type { PointerStore } from './pointer';
import type { CanvasSurfaceHandle } from './provider';

import { isHTMLElement } from '../dom';
import { blockElements } from './anchors';
import { adjustMoveIndex, planMultiMove } from './dnd';
import { stickyTarget } from './drag-geometry';
import {
  contentPointFromClient,
  createInsertAdapters,
  resolveDropTarget,
} from './insert-dom';

type Point = { x: number; y: number };

/** Why a drag ended without a drop. */
export type DragCancelReason =
  | 'escape'
  | 'pointer-cancel'
  | 'blur'
  | 'source-removed'
  | 'no-target';

/**
 * The drag lifecycle every input drives (pointer, keyboard): one session
 * at a time in the shared dnd store, drop targets resolved per surface,
 * the drop committed as one undo step.
 */
export type DragEngine = {
  /** A drag of `session` begins now. */
  start(session: DragSession): void;
  /** The pointer moved to a host-page client point. */
  move(point: Point): void;
  /** Shows `target` as the drop target (keyboard drags pick their own). */
  setTarget(target: InsertTarget | null, surface?: CanvasSurfaceHandle): void;
  /** Drops at the current target; returns the ids that landed. */
  end(): string[];
  cancel(reason: DragCancelReason): void;
  /** Listens to target changes; returns the unsubscribe function. */
  onTarget(listener: (target: InsertTarget | null) => void): () => void;
};

function focusBlock(host: HTMLElement, id: string): void {
  const el = blockElements(host, id)[0];
  if (isHTMLElement(el)) el.focus({ preventScroll: true });
}

/** How long dropped blocks carry `data-dropped` (the drop flash). */
export const DROP_FLASH_MS = 700;

function flashDropped(host: HTMLElement, ids: readonly string[]): void {
  const els = ids.flatMap((id) => blockElements(host, id));
  for (const el of els) el.setAttribute('data-dropped', '');
  setTimeout(() => {
    for (const el of els) el.removeAttribute('data-dropped');
  }, DROP_FLASH_MS);
}

function containsClientPoint(
  entry: CanvasSurfaceHandle,
  client: Point,
): boolean {
  // In a frame the whole frame viewport is canvas: the page area below or
  // beside the content takes drops too.
  if (entry.surface.kind === 'frame') {
    const view = entry.surface.window;
    return (
      client.x >= 0 &&
      client.x <= view.innerWidth &&
      client.y >= 0 &&
      client.y <= view.innerHeight
    );
  }
  const rect = entry.host.getBoundingClientRect();
  return (
    client.x >= rect.left &&
    client.x <= rect.right &&
    client.y >= rect.top &&
    client.y <= rect.bottom
  );
}

/** A host-page point in the client coordinates of `entry`'s document. */
export function toLocal(entry: CanvasSurfaceHandle, page: Point): Point {
  return entry.surface.fromHost(page);
}

/** Editable surface under a host-page point; the last registered match wins. */
export function surfaceAtClient(
  surfaces: ReadonlyArray<CanvasSurfaceHandle>,
  page: Point,
): CanvasSurfaceHandle | null {
  for (let i = surfaces.length - 1; i >= 0; i--) {
    const surface = surfaces[i]!;
    if (surface.interactive !== 'edit') continue;
    if (containsClientPoint(surface, toLocal(surface, page))) {
      return surface;
    }
  }
  return null;
}

/**
 * The blocks a drag of `id` moves: the outermost selected blocks in
 * document order when `id` is part of a multi-selection, else `id` alone.
 */
export function draggedIds(store: EditorStore, id: string): string[] {
  const selection = store.getSession().selection;
  if (selection.length < 2 || !selection.includes(id)) return [id];
  const { nodes, rootId } = store.getDoc();
  const chosen = new Set(selection.filter((entry) => entry !== rootId));
  const out: string[] = [];
  const walk = (nodeId: string) => {
    const node = nodes[nodeId];
    if (!node) return;
    if (chosen.has(nodeId)) {
      out.push(nodeId);
      return;
    }
    for (const children of Object.values(node.slots)) {
      for (const child of children) walk(child);
    }
  };
  walk(rootId);
  return out.length > 0 ? out : [id];
}

export function createDragEngine(deps: {
  store: EditorStore;
  schema: AnyEditorSchema;
  dnd: DndStore;
  pointer: PointerStore;
  getSurfaces: () => ReadonlyArray<CanvasSurfaceHandle>;
}): DragEngine {
  const { store, schema, dnd, pointer, getSurfaces } = deps;
  const listeners = new Set<(target: InsertTarget | null) => void>();
  let sticky: { target: InsertTarget; at: Point } | null = null;
  let lastSurface: CanvasSurfaceHandle | null = null;

  const publish = (target: InsertTarget | null) => {
    dnd.setDropTarget(target);
    for (const listener of listeners) listener(target);
  };

  const reset = () => {
    sticky = null;
    lastSurface = null;
  };

  return {
    start(session) {
      reset();
      dnd.start(session);
    },
    move(page) {
      const session = dnd.getSession();
      const surface = surfaceAtClient(getSurfaces(), page);
      if (!session) return;
      if (surface === null) {
        sticky = null;
        publish(null);
        return;
      }
      const { host, measurer } = surface;
      const local = toLocal(surface, page);
      // Read at event time: the gesture never subscribes to the node table.
      const { nodes, rootId } = store.getDoc();
      const adapters = createInsertAdapters(host, measurer, nodes, rootId, {
        framePage: surface.surface.kind === 'frame',
      });
      const point = contentPointFromClient(host, local);
      pointer.setFromEvent(
        { clientX: local.x, clientY: local.y } as PointerEvent,
        host,
      );
      const next = resolveDropTarget(
        schema,
        nodes,
        rootId,
        session,
        point.x,
        point.y,
        adapters,
      );
      sticky = stickyTarget(
        lastSurface === surface ? sticky : null,
        next,
        point,
      );
      lastSurface = surface;
      publish(sticky?.target ?? null);
    },
    setTarget(target, surface) {
      if (surface) lastSurface = surface;
      sticky = null;
      publish(target);
    },
    end() {
      const target = dnd.getDropTarget();
      const active = dnd.getSession();
      const dropHost = lastSurface?.host ?? null;
      reset();
      if (!active || !target) {
        dnd.end();
        return [];
      }
      let landed: string[] = [];
      if (active.kind === 'new') {
        const id = store.add(active.type, {
          parent: target.parent,
          index: target.index,
          props: active.properties,
        });
        if (id) landed = [id];
      } else if (active.ids && active.ids.length > 1) {
        const nodes = store.getDoc().nodes;
        const plan = planMultiMove(
          nodes,
          active.ids,
          target.parent,
          target.index,
        );
        const result = store.transact(
          () => {
            for (const step of plan) {
              store.move(step.id, { parent: target.parent, index: step.index });
            }
          },
          { label: 'Move blocks' },
        );
        if (result.ok) landed = [...active.ids];
      } else {
        const nodes = store.getDoc().nodes;
        const from = nodes[active.id]?.parent ?? null;
        const fromIndex = from
          ? (nodes[from.id]?.slots[from.slot]?.indexOf(active.id) ?? -1)
          : -1;
        const adjusted = adjustMoveIndex(
          nodes,
          active.id,
          target.parent,
          target.index,
        );
        const samePlace =
          from !== null &&
          from.id === target.parent.id &&
          from.slot === target.parent.slot &&
          fromIndex === adjusted;
        if (
          !samePlace &&
          store.move(active.id, {
            parent: target.parent,
            index: adjusted,
          })
        ) {
          landed = [active.id];
        }
      }
      if (landed.length > 0) {
        store.setSelection(landed);
        if (dropHost) {
          focusBlock(dropHost, landed[0]!);
          flashDropped(dropHost, landed);
        }
      }
      dnd.end();
      return landed;
    },
    cancel() {
      reset();
      dnd.end();
      for (const listener of listeners) listener(null);
    },
    onTarget(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
