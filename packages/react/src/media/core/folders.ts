/**
 * Folder tree state and its pure helpers: visible rows with their ARIA
 * position, move validity, breadcrumb overflow and the persisted expanded
 * set. Keyboard navigation over the rows is the shared tree kernel's.
 */

import type { TreeRow } from '../../tree/core/rows';

export type FolderRecord = {
  id: string;
  name: string;
  parentId: string | null;
  /** Live assets directly in the folder. */
  assetCount?: number;
  /** Live assets in the folder and all subfolders. */
  assetCountRecursive?: number;
  /** Live direct subfolders. */
  folderCount?: number;
};

export type FolderNode = FolderRecord & {
  /** Child ids once listed; `null` until then. */
  children: string[] | null;
};

export type FolderTreeState = {
  nodes: Record<string, FolderNode>;
  /** Root-level folder ids once listed; `null` until then. */
  roots: string[] | null;
  expanded: string[];
  loading: string[];
  /** The open folder; `null` is the root level. */
  currentId: string | null;
  /** Folder ids from the top to the open folder (inclusive). */
  path: string[];
};

export function createFolderTree(
  currentId: string | null = null,
): FolderTreeState {
  return {
    nodes: {},
    roots: null,
    expanded: [],
    loading: [],
    currentId,
    path: currentId ? [currentId] : [],
  };
}

/** Stores the listed children of `parentId` (`null` = root level). */
export function setFolderChildren(
  state: FolderTreeState,
  parentId: string | null,
  folders: readonly FolderRecord[],
): FolderTreeState {
  const nodes = { ...state.nodes };
  const ids: string[] = [];
  for (const folder of folders) {
    const previous = nodes[folder.id];
    nodes[folder.id] = { ...folder, children: previous?.children ?? null };
    ids.push(folder.id);
  }
  if (parentId === null) return { ...state, nodes, roots: ids };
  const parent = nodes[parentId];
  if (parent) nodes[parentId] = { ...parent, children: ids };
  return { ...state, nodes };
}

/** Whether a node may have children (unknown counts count as "maybe"). */
export function mayHaveChildren(node: FolderNode): boolean {
  if (node.children) return node.children.length > 0;
  return node.folderCount === undefined || node.folderCount > 0;
}

export type FolderTreeRow = TreeRow & {
  name: string;
  /** Its children are being listed. */
  loading: boolean;
};

/** The visible rows of the tree in display order. */
export function folderTreeRows(state: FolderTreeState): FolderTreeRow[] {
  const rows: FolderTreeRow[] = [];
  const expanded = new Set(state.expanded);
  const loading = new Set(state.loading);
  const visit = (ids: readonly string[], level: number) => {
    ids.forEach((id, index) => {
      const node = state.nodes[id];
      if (!node) return;
      const hasChildren = mayHaveChildren(node);
      const isExpanded = hasChildren && expanded.has(id);
      rows.push({
        id,
        name: node.name,
        level,
        setsize: ids.length,
        posinset: index + 1,
        expanded: isExpanded,
        hasChildren,
        loading: loading.has(id),
        parentId: node.parentId,
      });
      if (isExpanded && node.children) visit(node.children, level + 1);
    });
  };
  visit(state.roots ?? [], 1);
  return rows;
}

/** Whether `id` is `ancestorId` or lies below it. */
export function isSelfOrDescendant(
  nodes: Readonly<Record<string, FolderRecord>>,
  ancestorId: string,
  id: string | null,
): boolean {
  const seen = new Set<string>();
  let current = id;
  while (current !== null && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = nodes[current]?.parentId ?? null;
  }
  return false;
}

export type MoveRejectReason = 'same-folder' | 'into-itself';

/**
 * Why assets from `sourceFolderIds` (or a folder, with `movingFolderId`)
 * cannot move to `targetId`, or `null`. Invalid targets show no drop
 * indicator.
 */
export function moveRejection(
  nodes: Readonly<Record<string, FolderRecord>>,
  targetId: string | null,
  move: { assetFolderIds: readonly (string | null)[] } | { folderId: string },
): MoveRejectReason | null {
  if ('folderId' in move) {
    if (isSelfOrDescendant(nodes, move.folderId, targetId)) {
      return 'into-itself';
    }
    return (nodes[move.folderId]?.parentId ?? null) === targetId
      ? 'same-folder'
      : null;
  }
  return move.assetFolderIds.length > 0 &&
    move.assetFolderIds.every((id) => id === targetId)
    ? 'same-folder'
    : null;
}

/**
 * Splits a breadcrumb path for display: from `max` items on, the middle
 * collapses into an overflow menu, keeping the first and the last two.
 */
export function collapseBreadcrumbs<T>(
  path: readonly T[],
  max = 4,
): { head: T[]; overflow: T[]; tail: T[] } {
  if (path.length < max) return { head: [...path], overflow: [], tail: [] };
  return {
    head: path.slice(0, 1),
    overflow: path.slice(1, path.length - 2),
    tail: path.slice(path.length - 2),
  };
}

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** The persisted expanded ids; `[]` when storage is missing or throws. */
export function loadExpanded(
  storage: StorageLike | null | undefined,
  key: string,
): string[] {
  try {
    const raw = storage?.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Persists the expanded ids; storage errors (quota, private mode) are ignored. */
export function saveExpanded(
  storage: StorageLike | null | undefined,
  key: string,
  expanded: readonly string[],
): void {
  try {
    storage?.setItem(key, JSON.stringify(expanded));
  } catch {
    // Expansion is a convenience; losing it is harmless.
  }
}
