import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { FolderTreeRow } from './core/folders';
import type { MediaStoreState } from './core/store';
import type { MediaFolder as FolderRecord } from './core/types';

import { mergeProps, useRender } from '../use-render';
import { useMediaContext, useMediaMessages } from './context';
import { errorCodeOf } from './core/errors';
import {
  collapseBreadcrumbs,
  folderTreeRows,
  treeKeyOf,
  treeNavigate,
} from './core/folders';
import { currentFolders } from './core/store';
import {
  createTypeAhead,
  isTypeAheadKey,
  matchTypeAhead,
} from './core/typeahead';
import { folderDragProps, useFolderDrop } from './dnd';
import { mediaErrorMessage } from './messages';
import { useSelector } from './use-store';

type RenderProps<
  TElement extends React.ElementType,
  TState extends Record<string, unknown>,
> = Omit<UseRenderComponentProps<TElement, TState>, 'children'>;

// --- Media.Breadcrumbs / Media.Crumb --------------------------------------------

export type BreadcrumbPath = {
  /** The first folder below the root. */
  head: FolderRecord[];
  /** The middle of a deep path, for an overflow menu. */
  overflow: FolderRecord[];
  /** The last two folders (the current one last). */
  tail: FolderRecord[];
  /** The whole path, current folder last. */
  all: FolderRecord[];
};

export type MediaBreadcrumbsProps = RenderProps<
  'nav',
  Record<string, never>
> & {
  /** From this many folders on, the middle collapses into `overflow`. @default 4 */
  collapseFrom?: number;
  children: (path: BreadcrumbPath) => React.ReactNode;
};

const selectPath = (state: MediaStoreState) => ({
  path: state.folders.path,
  nodes: state.folders.nodes,
});

/**
 * `nav` labelled `folder.path` with the folders from the root to the open
 * one. A start folder opened by id gets its full path from
 * `getFolderPath`; deep paths split into `head`, `overflow` and `tail`.
 */
export function MediaBreadcrumbs(props: MediaBreadcrumbsProps) {
  const { children, collapseFrom = 4, render, ...rest } = props;
  const { store } = useMediaContext('Media.Breadcrumbs');
  const { messages } = useMediaMessages();
  const { path, nodes } = useSelector(store, selectPath);
  const all = path.flatMap((id) => (nodes[id] ? [nodes[id]] : []));
  const { head, overflow, tail } = collapseBreadcrumbs(all, collapseFrom);
  return useRender({
    defaultTagName: 'nav',
    render,
    props: mergeProps<'nav'>({ 'aria-label': messages.folder.path }, rest, {
      children: children({ head, overflow, tail, all }),
    }),
  });
}

type CrumbState = { current: boolean; dropOver: boolean; dropFlash: boolean };

export type MediaCrumbProps = UseRenderComponentProps<'button', CrumbState> & {
  /** The folder this crumb opens; `null` is the root. */
  folder: FolderRecord | null;
};

const selectCurrentFolder = (state: MediaStoreState) => state.folders.currentId;

/**
 * A `button` that opens `folder`; `aria-current="page"` on the open one.
 * It is a drop target, also while open: assets and folders dropped on it
 * move there, and hovering a drag for 500 ms opens another folder.
 */
export function MediaCrumb(props: MediaCrumbProps) {
  const { folder, render, children, ...rest } = props;
  const { store } = useMediaContext('Media.Crumb');
  const { messages } = useMediaMessages();
  const currentId = useSelector(store, selectCurrentFolder, Object.is);
  const id = folder?.id ?? null;
  const current = id === currentId;
  const open = () => void store.dispatch({ type: 'openFolder', folderId: id });
  // The open folder stays a drop target: a folder from below can move up
  // into it; assets already in it are refused by the drop rules.
  const drop = useFolderDrop(id, { onDwell: current ? undefined : open });

  return useRender({
    defaultTagName: 'button',
    render,
    state: {
      current,
      dropOver: drop.state.over,
      dropFlash: drop.state.flash,
    } satisfies CrumbState,
    props: mergeProps<'button'>(
      {
        type: 'button',
        'aria-current': current ? 'page' : undefined,
        onClick: open,
        children: children ?? (folder ? folder.name : messages.folder.root),
        ...drop.props,
      },
      rest,
    ),
  });
}

// --- Media.FolderList / Media.Folder ----------------------------------------------

type FolderListState = { empty: boolean };

export type MediaFolderListProps = RenderProps<'ul', FolderListState> & {
  children: (folder: FolderRecord) => React.ReactNode;
};

/** The subfolders of the open folder as a `ul`. */
export function MediaFolderList(props: MediaFolderListProps) {
  const { children, render, ...rest } = props;
  const { store } = useMediaContext('Media.FolderList');
  const folders = useSelector(store, currentFolders);
  return useRender({
    defaultTagName: 'ul',
    render,
    state: { empty: folders.length === 0 } satisfies FolderListState,
    props: mergeProps<'ul'>(rest, {
      children: folders.map((folder) => children(folder)),
    }),
  });
}

type FolderState = { dropOver: boolean; dropFlash: boolean };

export type MediaFolderProps = UseRenderComponentProps<
  'button',
  FolderState
> & {
  folder: FolderRecord;
};

/**
 * A `button` that opens `folder`; a drop target for assets, folders and
 * OS files, and draggable onto another folder. `children` defaults to its
 * name.
 */
export function MediaFolder(props: MediaFolderProps) {
  const { folder, render, children, ...rest } = props;
  const { store } = useMediaContext('Media.Folder');
  const drop = useFolderDrop(folder.id);
  return useRender({
    defaultTagName: 'button',
    render,
    state: {
      dropOver: drop.state.over,
      dropFlash: drop.state.flash,
    } satisfies FolderState,
    props: mergeProps<'button'>(
      {
        type: 'button',
        onClick: () =>
          void store.dispatch({ type: 'openFolder', folderId: folder.id }),
        children: children ?? folder.name,
        ...drop.props,
      },
      store.client.moveFolder ? folderDragProps(folder.id) : undefined,
      rest,
    ),
  });
}

// --- Folder.Tree / Folder.Item --------------------------------------------------------

type TreeContextValue = {
  rows: FolderTreeRow[];
  focusId: string | null;
  setFocusId: (id: string) => void;
  /** `pick` (the Move dialog) selects a target instead of opening it. */
  mode: 'navigate' | 'pick';
  picked: string | null | undefined;
  onPick?: (folderId: string | null) => void;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
};

const TreeContext = React.createContext<TreeContextValue | null>(null);

export type FolderTreeState = { rows: FolderTreeRow[]; loading: boolean };

const selectTree = (state: MediaStoreState) => state.folders;

/**
 * The folder tree as rows: `rows` (visible, with level, set size, position,
 * expanded and loading state), `currentId` and the tree commands.
 */
export function useFolderTree() {
  const { store } = useMediaContext('useFolderTree');
  const folders = useSelector(store, selectTree, Object.is);
  const rows = React.useMemo(() => folderTreeRows(folders), [folders]);
  return React.useMemo(
    () => ({
      rows,
      currentId: folders.currentId,
      path: folders.path,
      expand: (folderId: string) =>
        store.dispatch({ type: 'expandFolder', folderId }),
      collapse: (folderId: string) =>
        store.dispatch({ type: 'collapseFolder', folderId }),
      open: (folderId: string | null) =>
        store.dispatch({ type: 'openFolder', folderId }),
    }),
    [rows, folders.currentId, folders.path, store],
  );
}

export type FolderTreeProps = RenderProps<
  'ul',
  { mode: 'navigate' | 'pick'; dropOver: boolean }
> & {
  children: (row: FolderTreeRow) => React.ReactNode;
  /** `pick` chooses a target (the Move dialog) instead of opening folders. */
  mode?: 'navigate' | 'pick';
  /** In `pick` mode: the chosen folder (`null` = root level). */
  value?: string | null;
  onValueChange?: (folderId: string | null) => void;
  /** In `pick` mode: Enter on a row. */
  onConfirm?: (folderId: string | null) => void;
};

/**
 * An APG tree (`role="tree"`) of the folders with lazy children: opening a
 * node lists its children (`aria-busy` meanwhile), the expanded set is
 * kept in `localStorage`. Up/Down move, Right opens or enters, Left closes
 * or goes to the parent, Home/End, `*` opens the siblings, typing jumps by
 * name; F2 or Enter renames and Space opens (navigate mode), Space picks
 * and Enter confirms (pick mode). `children` renders each
 * visible row, usually a `Folder.Item`.
 */
export function FolderTree(props: FolderTreeProps) {
  const {
    children,
    mode = 'navigate',
    value,
    onValueChange,
    onConfirm,
    render,
    ...rest
  } = props;
  const { store } = useMediaContext('Folder.Tree');
  const { messages } = useMediaMessages();
  const { rows, currentId } = useFolderTree();
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLUListElement | null>(null);
  const typeAhead = React.useRef(createTypeAhead());
  const pendingFocus = React.useRef(false);
  const rtl = React.useRef(false);

  const effectiveFocus =
    focusId && rows.some((row) => row.id === focusId)
      ? focusId
      : ((mode === 'pick' ? value : currentId) ?? rows[0]?.id ?? null);

  React.useEffect(() => {
    if (!pendingFocus.current || !effectiveFocus) return;
    pendingFocus.current = false;
    ref.current
      ?.querySelector<HTMLElement>(
        `[data-folder-id="${CSS.escape(effectiveFocus)}"]`,
      )
      ?.focus();
  });
  React.useLayoutEffect(() => {
    rtl.current = ref.current?.closest('[dir]')?.getAttribute('dir') === 'rtl';
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (renaming || !effectiveFocus) return;
    // Rename with F2 (Windows) or Enter (Finder); Space opens the folder.
    if (mode === 'navigate' && (event.key === 'F2' || event.key === 'Enter')) {
      event.preventDefault();
      setRenaming(effectiveFocus);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (mode === 'pick') {
        onValueChange?.(effectiveFocus);
        if (event.key === 'Enter') onConfirm?.(effectiveFocus);
      } else {
        void store.dispatch({ type: 'openFolder', folderId: effectiveFocus });
      }
      return;
    }
    let key = treeKeyOf(event.key);
    if (key === 'left' && rtl.current) key = 'right';
    else if (key === 'right' && rtl.current) key = 'left';
    if (key) {
      event.preventDefault();
      const result = treeNavigate(rows, effectiveFocus, key);
      for (const id of result.expand ?? [])
        void store.dispatch({ type: 'expandFolder', folderId: id });
      if (result.collapse)
        void store.dispatch({
          type: 'collapseFolder',
          folderId: result.collapse,
        });
      if (result.focus) {
        pendingFocus.current = true;
        setFocusId(result.focus);
      }
      return;
    }
    if (
      isTypeAheadKey(event.key, {
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
      })
    ) {
      const search = typeAhead.current.push(event.key, event.timeStamp);
      const from = rows.findIndex((row) => row.id === effectiveFocus);
      const match = matchTypeAhead(
        rows.map((row) => row.name),
        from,
        search,
      );
      if (match !== -1) {
        pendingFocus.current = true;
        setFocusId(rows[match].id);
      }
    }
  };

  const contextValue = React.useMemo<TreeContextValue>(
    () => ({
      rows,
      focusId: effectiveFocus,
      setFocusId,
      mode,
      picked: value,
      onPick: onValueChange,
      renaming,
      setRenaming,
    }),
    [rows, effectiveFocus, mode, value, onValueChange, renaming],
  );

  // Drops on the tree outside a folder row go to the root.
  const rootDrop = useFolderDrop(null, {
    files: false,
    disabled: mode === 'pick',
  });
  const element = useRender({
    defaultTagName: 'ul',
    render,
    state: { mode, dropOver: rootDrop.state.over },
    props: mergeProps<'ul'>(
      { ref, role: 'tree', 'aria-label': messages.folder.tree, onKeyDown },
      mode === 'navigate' ? rootDrop.props : undefined,
      rest,
      {
        children: rows.map((row) => (
          <React.Fragment key={row.id}>{children(row)}</React.Fragment>
        )),
      },
    ),
  });
  return (
    <TreeContext.Provider value={contextValue}>{element}</TreeContext.Provider>
  );
}

type FolderItemState = {
  current: boolean;
  expanded: boolean;
  loading: boolean;
  picked: boolean;
  renaming: boolean;
  dropOver: boolean;
  dropFlash: boolean;
  /** `before`/`after`: the drop goes next to the folder (its parent); `inside`: into it. */
  dropPosition: 'before' | 'after' | 'inside' | null;
};

export type FolderItemProps = UseRenderComponentProps<'li', FolderItemState> & {
  row: FolderTreeRow;
};

const RowContext = React.createContext<FolderTreeRow | null>(null);

/**
 * One `treeitem` with `aria-level`, `aria-setsize`, `aria-posinset`,
 * `aria-expanded` (folders that may have children) and `aria-busy` while
 * its children load. A click opens (or picks) the folder, a double click
 * renames it. A drop target (hovering 500 ms opens a closed node): the
 * middle of the row drops into the folder, its top and bottom edge next to
 * it (into its parent), shown as `data-drop-position`. Draggable onto other
 * folders.
 */
export function FolderItem(props: FolderItemProps) {
  const { row, render, children, ...rest } = props;
  const { store } = useMediaContext('Folder.Item');
  const tree = React.useContext(TreeContext);
  if (!tree)
    throw new Error('Folder.Item must be used within a Folder.Tree component.');
  const currentId = useSelector(store, selectCurrentFolder, Object.is);
  const drop = useFolderDrop(row.id, {
    onDwell: () => {
      if (row.hasChildren && !row.expanded) {
        void store.dispatch({ type: 'expandFolder', folderId: row.id });
      }
    },
    disabled: tree.mode === 'pick',
    edges: { parentId: row.parentId },
  });
  const picked = tree.mode === 'pick' && tree.picked === row.id;
  const renaming = tree.renaming === row.id;

  const element = useRender({
    defaultTagName: 'li',
    render,
    state: {
      current: currentId === row.id,
      expanded: row.expanded,
      loading: row.loading,
      picked,
      renaming,
      dropOver: drop.state.over,
      dropFlash: drop.state.flash,
      dropPosition: drop.state.over ? drop.state.position : null,
    } satisfies FolderItemState,
    props: mergeProps<'li'>(
      {
        role: 'treeitem',
        'aria-level': row.level,
        'aria-setsize': row.setsize,
        'aria-posinset': row.posinset,
        'aria-expanded': row.hasChildren ? row.expanded : undefined,
        'aria-busy': row.loading || undefined,
        'aria-selected': tree.mode === 'pick' ? picked : currentId === row.id,
        'aria-current':
          tree.mode === 'navigate' && currentId === row.id ? 'page' : undefined,
        tabIndex: tree.focusId === row.id ? 0 : -1,
        'data-folder-id': row.id,
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation();
          tree.setFocusId(row.id);
          if (tree.mode === 'pick') tree.onPick?.(row.id);
          else void store.dispatch({ type: 'openFolder', folderId: row.id });
        },
        onDoubleClick: () => {
          if (tree.mode === 'navigate') tree.setRenaming(row.id);
        },
        onFocus: (event: React.FocusEvent) => {
          if (event.target === event.currentTarget) tree.setFocusId(row.id);
        },
      },
      tree.mode === 'navigate' ? drop.props : undefined,
      tree.mode === 'navigate' && store.client.moveFolder
        ? folderDragProps(row.id)
        : undefined,
      rest,
      { children },
    ),
  });
  return <RowContext.Provider value={row}>{element}</RowContext.Provider>;
}

export type FolderToggleProps = UseRenderComponentProps<
  'span',
  { expanded: boolean }
>;

/** The disclosure icon of a `Folder.Item` (decorative; the item carries `aria-expanded`). */
export function FolderToggle(props: FolderToggleProps) {
  const { render, ...rest } = props;
  const { store } = useMediaContext('Folder.Toggle');
  const row = React.useContext(RowContext);
  if (!row)
    throw new Error(
      'Folder.Toggle must be used within a Folder.Item component.',
    );
  const element = useRender({
    defaultTagName: 'span',
    render,
    state: { expanded: row.expanded },
    props: mergeProps<'span'>(
      {
        'aria-hidden': true,
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation();
          void store.dispatch({
            type: row.expanded ? 'collapseFolder' : 'expandFolder',
            folderId: row.id,
          });
        },
      },
      rest,
    ),
  });
  return row.hasChildren ? element : null;
}

// --- inline name editing ---------------------------------------------------------------

type NameInputState = { error: boolean };

export type FolderNameInputProps = Omit<
  UseRenderComponentProps<'input', NameInputState>,
  'onSubmit'
> & {
  initialValue: string;
  /** Resolves with an error code to keep editing, or nothing when done. */
  onSubmit: (name: string) => Promise<string | void>;
  onCancel: () => void;
};

/**
 * A text field for a folder name with the text selected: Enter submits,
 * Escape cancels, a failure (`FOLDER_NAME_TAKEN`) stays inline as
 * `aria-invalid` with the message in `aria-errormessage`.
 */
export function FolderNameInput(props: FolderNameInputProps) {
  const { initialValue, onSubmit, onCancel, render, ...rest } = props;
  const { messages } = useMediaMessages();
  const [value, setValue] = React.useState(initialValue);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLInputElement | null>(null);
  const errorId = `${React.useId()}-error`;
  React.useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const submit = async () => {
    const name = value.trim();
    if (!name || busy) return;
    if (name === initialValue && initialValue !== messages.folder.defaultName) {
      onCancel();
      return;
    }
    setBusy(true);
    const code = await onSubmit(name);
    setBusy(false);
    if (code) setError(code);
  };

  const input = useRender({
    defaultTagName: 'input',
    render,
    state: { error: error !== null } satisfies NameInputState,
    props: mergeProps<'input'>(
      {
        ref,
        type: 'text',
        'aria-label': messages.folder.name,
        'aria-invalid': error !== null || undefined,
        'aria-errormessage': error ? errorId : undefined,
        'aria-busy': busy || undefined,
        value,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          setValue(event.target.value);
          setError(null);
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        },
        onBlur: () => {
          if (!busy && !error) void submit();
        },
        onClick: (event: React.MouseEvent) => event.stopPropagation(),
      },
      rest,
    ),
  });
  return (
    <>
      {input}
      {error ? (
        <span id={errorId} role="alert" data-folder-name-error="">
          {mediaErrorMessage(messages, error)}
        </span>
      ) : null}
    </>
  );
}

export type FolderRenameProps = Omit<
  FolderNameInputProps,
  'initialValue' | 'onSubmit' | 'onCancel'
>;

/**
 * Inside a `Folder.Item`: the rename field while the item is being renamed
 * (F2, Enter or a double click), nothing otherwise.
 */
export function FolderRename(props: FolderRenameProps) {
  const { store, announce } = useMediaContext('Folder.Rename');
  const { messages, format } = useMediaMessages();
  const tree = React.useContext(TreeContext);
  const row = React.useContext(RowContext);
  if (!tree || !row)
    throw new Error(
      'Folder.Rename must be used within a Folder.Item component.',
    );
  if (tree.renaming !== row.id) return null;
  return (
    <FolderNameInput
      {...props}
      initialValue={row.name}
      onCancel={() => tree.setRenaming(null)}
      onSubmit={async (name) => {
        const result = await store.dispatch({
          type: 'renameFolder',
          folderId: row.id,
          name,
        });
        if (!result.ok) return result.code;
        tree.setRenaming(null);
        announce(messages.folder.renamed({ name }, format));
      }}
    />
  );
}

export type FolderCreateProps = Omit<
  FolderNameInputProps,
  'initialValue' | 'onSubmit' | 'onCancel'
> & {
  /** Parent of the new folder; defaults to the open folder. */
  parentId?: string | null;
  onDone: (folder: FolderRecord | null) => void;
};

/**
 * An inline field that creates a folder: prefilled with the selected
 * default name, Enter creates, Escape cancels, a name conflict stays
 * inline. Announces "Folder created: name".
 */
export function FolderCreate(props: FolderCreateProps) {
  const { parentId, onDone, ...rest } = props;
  const { store, announce } = useMediaContext('Folder.Create');
  const { messages, format } = useMediaMessages();
  return (
    <FolderNameInput
      {...rest}
      initialValue={messages.folder.defaultName}
      onCancel={() => onDone(null)}
      onSubmit={async (name) => {
        const result = await store.dispatch<FolderRecord>(
          parentId === undefined
            ? { type: 'createFolder', name }
            : { type: 'createFolder', name, parentId },
        );
        if (!result.ok) return result.code;
        announce(messages.folder.created({ name }, format));
        onDone(result.value ?? null);
      }}
    />
  );
}

// --- deleting -----------------------------------------------------------------------

export type FolderDeletePreview = {
  folders: number;
  assets: number;
  assetsInUse: number;
  pages: number;
};

export type FolderDeleteState = {
  status: 'loading' | 'ready' | 'deleting' | 'error';
  preview: FolderDeletePreview | null;
  /** The user must type the folder name: used assets are affected. */
  requireTyping: string | null;
  error: string | null;
  /** Deletes with `mode`; `typed` must equal `requireTyping` when set. */
  confirm: (
    mode: 'empty-only' | 'move-to-parent' | 'archive-contents',
    typed?: string,
  ) => Promise<boolean>;
};

/**
 * The delete flow of a folder: a dry-run preview (subfolders, assets, used
 * assets and the pages using them), then `confirm(mode)`. Typing the
 * folder name is required only when used assets are affected.
 */
export function useFolderDelete(
  folder: FolderRecord | null,
): FolderDeleteState {
  const { store, announce } = useMediaContext('useFolderDelete');
  const { messages, format } = useMediaMessages();
  const [state, setState] = React.useState<
    Omit<FolderDeleteState, 'confirm' | 'requireTyping'>
  >({
    status: 'loading',
    preview: null,
    error: null,
  });
  const id = folder?.id ?? null;
  React.useEffect(() => {
    if (!id) return;
    let live = true;
    setState({ status: 'loading', preview: null, error: null });
    void store
      .dispatch<FolderDeletePreview>({
        type: 'deleteFolder',
        folderId: id,
        dryRun: true,
      })
      .then((result) => {
        if (!live) return;
        setState(
          result.ok
            ? { status: 'ready', preview: result.value ?? null, error: null }
            : { status: 'error', preview: null, error: result.code },
        );
      });
    return () => {
      live = false;
    };
  }, [id, store]);
  const requireTyping =
    folder && state.preview && state.preview.assetsInUse > 0
      ? folder.name
      : null;
  const confirm = React.useCallback<FolderDeleteState['confirm']>(
    async (mode, typed) => {
      if (!folder) return false;
      if (requireTyping && typed !== requireTyping) return false;
      setState((s) => ({ ...s, status: 'deleting' }));
      const result = await store.dispatch({
        type: 'deleteFolder',
        folderId: folder.id,
        mode,
      });
      if (!result.ok) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: result.code ?? errorCodeOf(result.error) ?? null,
        }));
        return false;
      }
      announce(messages.folder.deleted({ name: folder.name }, format));
      return true;
    },
    [folder, requireTyping, store, announce, messages, format],
  );
  return { ...state, requireTyping, confirm };
}
