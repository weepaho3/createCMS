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

export type FolderDropKind = 'asset' | 'folder' | 'files';

export type FolderDropState = {
  /** A drag the target accepts is over it. */
  over: boolean;
  /** `asset`, `folder` or `files` while `over`. */
  kind: FolderDropKind | null;
  /** Briefly true after a drop (off with `prefers-reduced-motion`). */
  flash: boolean;
};

export type FolderDropOptions = {
  /** Called once a drag stayed `DROP_DWELL_MS` over the target. */
  onDwell?: () => void;
  /** Accept OS files and upload them into the folder. @default true */
  files?: boolean;
  /** Limits of a folder drop. */
  intake?: IntakeOptions;
  disabled?: boolean;
};

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
 * The folder a drag started in this document carries. The payload is
 * unreadable before the drop, so invalid folder targets (into itself or a
 * descendant) are known only through this.
 */
let draggedFolderId: string | null = null;

export type FolderDropRules = {
  /** What a drag carries, before any target is known; `null` when the library ignores it. */
  kindOf: (types: ArrayLike<string>) => FolderDropKind | null;
  /** Whether a drag of `kind` may drop into `folderId` (`null` = root level). */
  allows: (kind: FolderDropKind, folderId: string | null) => boolean;
  /** Runs a drop into `folderId`: moves assets or a folder, uploads files. */
  perform: (
    event: React.DragEvent,
    kind: FolderDropKind,
    folderId: string | null,
  ) => void;
};

/**
 * The drop rules shared by every folder target (tree rows, folder tiles,
 * breadcrumbs): assets move, a folder is reparented, OS files upload.
 * Assets cannot drop into their own folder, a folder not into itself, a
 * descendant or its current parent.
 */
export function useFolderDropRules(
  options: Pick<FolderDropOptions, 'files' | 'intake'> = {},
): FolderDropRules {
  const { store, announce } = useMediaContext('useFolderDropRules');
  const { messages, format } = useMediaMessages();
  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  return React.useMemo<FolderDropRules>(
    () => ({
      kindOf: (types) => {
        if (hasAssetDrag(types)) return 'asset';
        if (Array.from(types).includes(FOLDER_DRAG_TYPE)) {
          return store.client.moveFolder ? 'folder' : null;
        }
        if (optionsRef.current.files !== false && dragHasFiles(types)) {
          return 'files';
        }
        return null;
      },
      allows: (kind, folderId) => {
        const { selection, collection, folders } = store.getState();
        if (kind === 'asset') {
          // Asset data is unreadable before the drop; validity uses the selection.
          const from = selection.selected.map(
            (id) => collection.byId[id]?.folderId ?? null,
          );
          return !moveRejection(folders.nodes, folderId, {
            assetFolderIds: from,
          });
        }
        if (kind === 'folder' && draggedFolderId !== null) {
          return !moveRejection(folders.nodes, folderId, {
            folderId: draggedFolderId,
          });
        }
        return true;
      },
      perform: (event, kind, folderId) => {
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
    }),
    [store, announce, messages, format],
  );
}

/**
 * Makes an element a drop target for `folderId` (`null` = root level) by
 * the shared folder drop rules. Invalid targets get no indicator and refuse
 * the drop. Spread `props` on the element and read `state` for `data-*`
 * attributes. Tree rows use `Folder.Tree`'s own drop handling instead.
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
  const rules = useFolderDropRules(options);
  const [state, setState] = React.useState<FolderDropState>({
    over: false,
    kind: null,
    flash: false,
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

  const accepted = (types: ArrayLike<string>): FolderDropKind | null => {
    if (optionsRef.current.disabled) return null;
    const kind = rules.kindOf(types);
    return kind && rules.allows(kind, folderId) ? kind : null;
  };

  /** Internal drags handled here do not reach an enclosing target. */
  const claim = (event: React.DragEvent, kind: FolderDropKind | null) => {
    if (kind === 'asset' || kind === 'folder') event.stopPropagation();
  };

  const props = {
    onDragEnter: (event: React.DragEvent) => {
      const kind = accepted(event.dataTransfer.types);
      if (!kind) return;
      event.preventDefault();
      claim(event, kind);
      depth.current += 1;
      if (depth.current === 1) {
        setState({ over: true, kind, flash: false });
        stopDwell();
        dwell.current = setTimeout(
          () => optionsRef.current.onDwell?.(),
          DROP_DWELL_MS,
        );
      }
    },
    onDragOver: (event: React.DragEvent) => {
      const kind = accepted(event.dataTransfer.types);
      if (!kind) return;
      event.preventDefault();
      claim(event, kind);
      event.dataTransfer.dropEffect = kind === 'files' ? 'copy' : 'move';
    },
    onDragLeave: (event: React.DragEvent) => {
      if (depth.current === 0) return;
      // Balances the claimed enter, so an enclosing target keeps its count.
      claim(event, state.kind);
      depth.current -= 1;
      if (depth.current === 0) {
        stopDwell();
        setState({ over: false, kind: null, flash: false });
      }
    },
    onDrop: (event: React.DragEvent) => {
      const kind = accepted(event.dataTransfer.types);
      depth.current = 0;
      stopDwell();
      if (!kind) {
        setState({ over: false, kind: null, flash: false });
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const flash = !reducedMotion();
      setState({ over: false, kind: null, flash });
      if (flash)
        setTimeout(
          () => setState((s) => ({ ...s, flash: false })),
          DROP_FLASH_MS,
        );
      rules.perform(event, kind, folderId);
    },
  };
  return { props, state };
}

/** Drag props for a folder (tree item or folder tile) so it can be moved onto another folder. */
export function folderDragProps(
  folderId: string,
): Pick<
  React.HTMLAttributes<HTMLElement>,
  'draggable' | 'onDragStart' | 'onDragEnd'
> {
  return {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.stopPropagation();
      event.dataTransfer.setData(
        FOLDER_DRAG_TYPE,
        JSON.stringify({ id: folderId }),
      );
      event.dataTransfer.effectAllowed = 'move';
      draggedFolderId = folderId;
    },
    onDragEnd: () => {
      draggedFolderId = null;
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
