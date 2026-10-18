import * as React from 'react';

import type { IntakeOptions } from './core/intake';

import { useMediaContext, useMediaMessages } from './context';
import { hasAssetDrag, readAssetDrag } from './core/drag';
import { moveRejection } from './core/folders';
import { dragHasFiles, normalizeDrop } from './core/intake';

/** Folders dragged within the library (tree items) carry their id in this type. */
export const FOLDER_DRAG_TYPE = 'application/x-createcms-folder+json';

/** Hovering a drop target this long expands a tree node or opens a crumb. */
export const DROP_DWELL_MS = 500;
/** How long `data-drop-flash` stays on a target after a drop. */
export const DROP_FLASH_MS = 700;

export type FolderDropState = {
  /** A drag the target accepts is over it. */
  over: boolean;
  /** `asset`, `folder` or `files` while `over`. */
  kind: 'asset' | 'folder' | 'files' | null;
  /** Briefly true after a drop (off with `prefers-reduced-motion`). */
  flash: boolean;
  /**
   * With `edges`: `before` or `after` while the drag is over the top or
   * bottom edge (the drop goes next to the folder, into its parent),
   * `inside` over the middle. `null` otherwise.
   */
  position: 'before' | 'after' | 'inside' | null;
};

export type FolderDropOptions = {
  /** Called once a drag stayed `DROP_DWELL_MS` over the target. */
  onDwell?: () => void;
  /** Accept OS files and upload them into the folder. @default true */
  files?: boolean;
  /** Limits of a folder drop. */
  intake?: IntakeOptions;
  disabled?: boolean;
  /**
   * Makes the top and bottom quarter of the element target `parentId`
   * instead of the folder, like dropping next to a row in a file tree.
   * Assets and folders only; files always go into the folder.
   */
  edges?: { parentId: string | null };
};

/** Share of a row's height at its top and bottom that drops next to it. */
const EDGE_SHARE = 0.25;

function reducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function folderPayload(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);
    return value &&
      typeof value === 'object' &&
      typeof (value as { id?: unknown }).id === 'string'
      ? (value as { id: string }).id
      : null;
  } catch {
    return null;
  }
}

/**
 * Makes an element a drop target for `folderId` (`null` = root level):
 * dragged assets move there, a dragged folder is reparented there, OS
 * files upload into it. Invalid targets (the assets' own folder, a folder
 * into itself or a descendant) get no indicator and refuse the drop. Spread
 * `props` on the element and read `state` for `data-*` attributes.
 */
export function useFolderDrop(
  folderId: string | null,
  options: FolderDropOptions = {},
): {
  props: Pick<
    React.HTMLAttributes<HTMLElement>,
    'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'
  >;
  state: FolderDropState;
} {
  const { store, announce } = useMediaContext('useFolderDrop');
  const { messages, format } = useMediaMessages();
  const [state, setState] = React.useState<FolderDropState>({
    over: false,
    kind: null,
    flash: false,
    position: null,
  });
  const depth = React.useRef(0);
  const dwell = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  const stopDwell = () => {
    if (dwell.current !== null) clearTimeout(dwell.current);
    dwell.current = null;
  };
  React.useEffect(() => stopDwell, []);

  /** Where a drag at `event` would go, and how it is shown. */
  const targetOf = (
    event: React.DragEvent,
  ): { folderId: string | null; position: FolderDropState['position'] } => {
    const edges = optionsRef.current.edges;
    const internal =
      hasAssetDrag(event.dataTransfer.types) ||
      Array.from(event.dataTransfer.types).includes(FOLDER_DRAG_TYPE);
    if (!edges || !internal) {
      return { folderId, position: edges ? 'inside' : null };
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const edge = Math.max(4, rect.height * EDGE_SHARE);
    if (y < edge) return { folderId: edges.parentId, position: 'before' };
    if (y > rect.height - edge) {
      return { folderId: edges.parentId, position: 'after' };
    }
    return { folderId, position: 'inside' };
  };

  const kindOf = (
    types: ArrayLike<string>,
    target: string | null = folderId,
  ): FolderDropState['kind'] => {
    if (hasAssetDrag(types)) {
      // Asset data is unreadable before the drop; validity uses the selection.
      const { selection, collection } = store.getState();
      const from = selection.selected.map(
        (id) => collection.byId[id]?.folderId ?? null,
      );
      if (
        moveRejection(store.getState().folders.nodes, target, {
          assetFolderIds: from,
        })
      ) {
        return null;
      }
      return 'asset';
    }
    if (Array.from(types).includes(FOLDER_DRAG_TYPE)) {
      return store.client.moveFolder ? 'folder' : null;
    }
    if (optionsRef.current.files !== false && dragHasFiles(types))
      return 'files';
    return null;
  };

  /** Internal drags handled here do not reach an enclosing target. */
  const claim = (event: React.DragEvent, kind: FolderDropState['kind']) => {
    if (kind === 'asset' || kind === 'folder') event.stopPropagation();
  };

  const props = {
    onDragEnter: (event: React.DragEvent) => {
      if (optionsRef.current.disabled) return;
      const target = targetOf(event);
      const kind = kindOf(event.dataTransfer.types, target.folderId);
      if (!kind) return;
      event.preventDefault();
      claim(event, kind);
      depth.current += 1;
      if (depth.current === 1) {
        setState({
          over: true,
          kind,
          flash: false,
          position: target.position,
        });
        stopDwell();
        dwell.current = setTimeout(
          () => optionsRef.current.onDwell?.(),
          DROP_DWELL_MS,
        );
      }
    },
    onDragOver: (event: React.DragEvent) => {
      if (optionsRef.current.disabled) return;
      const target = targetOf(event);
      const kind = kindOf(event.dataTransfer.types, target.folderId);
      if (!kind) {
        // An edge can be invalid where the middle is not (or the reverse).
        if (state.position !== null) {
          setState((s) => ({ ...s, position: null }));
        }
        return;
      }
      event.preventDefault();
      claim(event, kind);
      if (target.position !== state.position) {
        setState((s) => ({
          ...s,
          over: true,
          kind,
          position: target.position,
        }));
      }
      event.dataTransfer.dropEffect =
        hasAssetDrag(event.dataTransfer.types) ||
        Array.from(event.dataTransfer.types).includes(FOLDER_DRAG_TYPE)
          ? 'move'
          : 'copy';
    },
    onDragLeave: (event: React.DragEvent) => {
      if (depth.current === 0) return;
      // Balances the claimed enter, so an enclosing target keeps its count.
      claim(event, state.kind);
      depth.current -= 1;
      if (depth.current === 0) {
        stopDwell();
        setState({ over: false, kind: null, flash: false, position: null });
      }
    },
    onDrop: (event: React.DragEvent) => {
      const target = targetOf(event);
      const kind = kindOf(event.dataTransfer.types, target.folderId);
      depth.current = 0;
      stopDwell();
      if (!kind || optionsRef.current.disabled) {
        setState({ over: false, kind: null, flash: false, position: null });
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const flash = !reducedMotion();
      setState({ over: false, kind: null, flash, position: null });
      const folderId = target.folderId;
      if (flash)
        setTimeout(
          () => setState((s) => ({ ...s, flash: false })),
          DROP_FLASH_MS,
        );
      if (kind === 'asset') {
        const payload = readAssetDrag(event.dataTransfer);
        if (!payload) return;
        void store
          .dispatch({ type: 'move', ids: payload.ids, folderId })
          .then((result) => {
            if (!result.ok) return;
            const name =
              folderId === null
                ? messages.folder.root
                : (store.getState().folders.nodes[folderId]?.name ??
                  messages.folder.root);
            const count = Array.isArray(result.value)
              ? result.value.length
              : payload.ids.length;
            announce(messages.bulk.moved({ count, folder: name }, format));
          });
      } else if (kind === 'folder') {
        const moving = folderPayload(
          event.dataTransfer.getData(FOLDER_DRAG_TYPE),
        );
        if (!moving) return;
        if (
          moveRejection(store.getState().folders.nodes, folderId, {
            folderId: moving,
          })
        )
          return;
        void store.dispatch({
          type: 'moveFolder',
          folderId: moving,
          parentId: folderId,
        });
      } else {
        // Entries must be collected synchronously inside `drop`.
        const reading = normalizeDrop(
          event.dataTransfer,
          optionsRef.current.intake,
        );
        void reading.then((result) =>
          store.dispatch({
            type: 'receive',
            files: result.files,
            folderId,
            recreateFolders: result.folders.length > 0,
          }),
        );
      }
    },
  };
  return { props, state };
}

/** Drag props for a folder (tree item or folder tile) so it can be moved onto another folder. */
export function folderDragProps(
  folderId: string,
): Pick<React.HTMLAttributes<HTMLElement>, 'draggable' | 'onDragStart'> {
  return {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.stopPropagation();
      event.dataTransfer.setData(
        FOLDER_DRAG_TYPE,
        JSON.stringify({ id: folderId }),
      );
      event.dataTransfer.effectAllowed = 'move';
    },
  };
}

export type DropOverlayState = {
  /** Files from the OS are dragged anywhere over the window. */
  active: boolean;
  /** Files announced by the drag (types only in Chromium before the drop). */
  count: number;
};

/**
 * Tracks OS file drags over the whole window with an enter/leave counter,
 * so the overlay does not flicker over child elements. Only drags carrying
 * `Files` count; drags of assets from the library itself do not.
 */
export function useDropOverlay(enabled = true): DropOverlayState {
  const [state, setState] = React.useState<DropOverlayState>({
    active: false,
    count: 0,
  });
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let depth = 0;
    const reset = () => {
      depth = 0;
      setState({ active: false, count: 0 });
    };
    const isFileDrag = (event: DragEvent) =>
      dragHasFiles(event.dataTransfer?.types) &&
      !hasAssetDrag(event.dataTransfer?.types);
    const onEnter = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      depth += 1;
      if (depth === 1) {
        const items = Array.from(event.dataTransfer?.items ?? []).filter(
          (i) => i.kind === 'file',
        );
        setState({ active: true, count: items.length });
      }
    };
    const onLeave = (event: DragEvent) => {
      if (!isFileDrag(event) || depth === 0) return;
      depth -= 1;
      if (depth === 0) setState({ active: false, count: 0 });
    };
    const onOver = (event: DragEvent) => {
      // Without this the browser opens a file dropped outside a target.
      if (isFileDrag(event)) event.preventDefault();
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
    };
  }, [enabled]);
  return state;
}
