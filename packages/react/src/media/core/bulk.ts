import type { CommandResult, MediaStore, MediaStoreState } from './store';
import type { MediaAsset, MediaAssetStatus } from './types';

import { selectionCount } from './selection';

/**
 * Bulk and item actions as a command registry: `canExecute` explains why an
 * action is unavailable, `confirm` describes the dialog it needs, `run`
 * dispatches store commands. The core carries codes, never display text;
 * parts translate labels and reasons through the catalog.
 */

export type BulkContext = {
  store: MediaStore;
  state: MediaStoreState;
  /** The ids the action works on (the loaded part of `allMatching`). */
  ids: string[];
  /** All targeted assets, counting unloaded ones of `allMatching`. */
  count: number;
  /** The loaded assets among `ids`. */
  assets: MediaAsset[];
  /** `item`: one asset's menu; `selection`: the bulk bar. */
  target: 'selection' | 'item';
};

export type ConfirmDescriptor = {
  /** Which dialog: a catalog key such as `archive` or `archiveInUse`. */
  kind: string;
  count: number;
  /** Destructive actions get a destructive confirm button. */
  destructive?: boolean;
  /** Assets the dialog lists, with the reason code each one is listed for. */
  items?: { id: string; reason: string }[];
  /** The user types this to confirm (risky deletions only). */
  requireTyping?: string;
};

/** What a run needs beyond the selection; each action reads its own fields. */
export type BulkInput = {
  /** `move`: the target folder (`null` = root level). */
  folderId?: string | null;
  /** `archive`: archive assets in use too (after a confirmation). */
  force?: boolean;
  /** `setProvenance`. */
  provenance?: NonNullable<MediaAsset['provenance']>;
  /** `download`: opens a URL (defaults to `window.open`). */
  open?: (url: string) => void;
};

export type BulkAction = {
  id: string;
  /** A catalog key under `bulk.action` for built-ins, display text for custom actions. */
  label: string;
  /** Where the action is offered. @default 'both' */
  scope?: 'selection' | 'item' | 'both';
  /** `true`, or the reason code it is disabled for (`data-disabled-reason`). */
  canExecute(context: BulkContext): true | string;
  confirm?(context: BulkContext): ConfirmDescriptor | null;
  run(context: BulkContext, input?: BulkInput): Promise<CommandResult>;
};

/** The context of the current selection (`target: 'selection'`) or of one asset. */
export function bulkContext(
  store: MediaStore,
  itemId?: string,
  state: MediaStoreState = store.getState(),
): BulkContext {
  const { selection, collection } = state;
  const ids = itemId
    ? [itemId]
    : selection.allMatching
      ? collection.ids.filter(
          (id) => !selection.allMatching!.except.includes(id),
        )
      : selection.selected;
  return {
    store,
    state,
    ids,
    count: itemId ? 1 : selectionCount(selection, collection.total),
    assets: ids.flatMap((id) =>
      collection.byId[id] ? [collection.byId[id]] : [],
    ),
    target: itemId ? 'item' : 'selection',
  };
}

const commandIds = (context: BulkContext) =>
  context.target === 'item' ? context.ids : undefined;

const needsSelection = (context: BulkContext): true | string =>
  context.count > 0 ? true : 'empty';

const hasMethod = (context: BulkContext, method: keyof MediaStore['client']) =>
  typeof context.store.client[method] === 'function';

export const moveAction: BulkAction = {
  id: 'move',
  label: 'move',
  canExecute: needsSelection,
  run: (context, input) =>
    input?.folderId === undefined
      ? Promise.resolve({ ok: false, code: 'MISSING_INPUT', error: null })
      : context.store.dispatch({
          type: 'move',
          ids: commandIds(context),
          folderId: input.folderId,
        }),
};

export const archiveAction: BulkAction = {
  id: 'archive',
  label: 'archive',
  canExecute: (context) =>
    context.state.collection.query.archived
      ? 'archived'
      : needsSelection(context),
  confirm: (context) => ({
    kind: 'archive',
    count: context.count,
    destructive: true,
  }),
  run: (context, input) =>
    context.store.dispatch({
      type: 'archive',
      ids: commandIds(context),
      force: input?.force,
    }),
};

export const restoreAction: BulkAction = {
  id: 'restore',
  label: 'restore',
  canExecute: (context) => {
    if (!hasMethod(context, 'restoreAssets')) return 'unsupported';
    if (!context.state.collection.query.archived) return 'not-archived';
    return needsSelection(context);
  },
  run: (context) =>
    context.store.dispatch({ type: 'restore', ids: context.ids }),
};

function visibilityAction(status: MediaAssetStatus): BulkAction {
  return {
    id: status === 'public' ? 'makePublic' : 'makePrivate',
    label: status === 'public' ? 'makePublic' : 'makePrivate',
    canExecute: (context) => {
      const ready = needsSelection(context);
      if (ready !== true) return ready;
      if (
        !context.state.selection.allMatching &&
        context.assets.length > 0 &&
        context.assets.every((asset) => asset.status === status)
      ) {
        return status === 'public' ? 'all-public' : 'all-private';
      }
      return true;
    },
    run: (context) =>
      context.store.dispatch({
        type: 'setVisibility',
        ids: commandIds(context),
        status,
      }),
  };
}

export const makePublicAction = visibilityAction('public');
export const makePrivateAction = visibilityAction('private');

export const setProvenanceAction: BulkAction = {
  id: 'setProvenance',
  label: 'setProvenance',
  canExecute: (context) => {
    if (!hasMethod(context, 'updateAsset')) return 'unsupported';
    if (context.state.selection.allMatching && context.target === 'selection') {
      return 'too-many';
    }
    return needsSelection(context);
  },
  run: (context, input) =>
    input?.provenance
      ? context.store.dispatch({
          type: 'setProvenance',
          ids: context.ids,
          provenance: input.provenance,
        })
      : Promise.resolve({ ok: false, code: 'MISSING_INPUT', error: null }),
};

/** Opens each asset's download (`?download=true` on the asset endpoint). */
export const downloadAction: BulkAction = {
  id: 'download',
  label: 'download',
  canExecute: (context) => {
    if (context.state.selection.allMatching && context.target === 'selection') {
      return 'too-many';
    }
    return context.assets.length > 0 ? true : 'empty';
  },
  run: async (context, input) => {
    const open =
      input?.open ??
      ((url: string) => {
        const win = (globalThis as { open?: (url: string) => void }).open;
        win?.(url);
      });
    for (const asset of context.assets) {
      const separator = asset.deliveryUrl.includes('?') ? '&' : '?';
      open(`${asset.deliveryUrl}${separator}download=true`);
    }
    return { ok: true, value: context.assets.map((asset) => asset.id) };
  },
};

/** The actions every library starts with, in bar order. */
export const builtInBulkActions: readonly BulkAction[] = [
  moveAction,
  makePublicAction,
  makePrivateAction,
  setProvenanceAction,
  downloadAction,
  archiveAction,
  restoreAction,
];

/** Registers the built-in actions on `store` (ids already registered are kept). */
export function registerBuiltInBulkActions(store: MediaStore): () => void {
  const off: (() => void)[] = [];
  for (const action of builtInBulkActions) {
    if (!store.registries.assetActions.get(action.id)) {
      off.push(store.registries.assetActions.register(action));
    }
  }
  return () => {
    for (const unregister of off) unregister();
  };
}

/**
 * The confirmation an archive needs after the server skipped assets in use:
 * the skipped ids with their reasons, to archive them with `force`.
 */
export function archiveInUseConfirm(
  skippedReasons: Record<string, string>,
): ConfirmDescriptor | null {
  const items = Object.entries(skippedReasons).map(([id, reason]) => ({
    id,
    reason,
  }));
  return items.length > 0
    ? { kind: 'archiveInUse', count: items.length, destructive: true, items }
    : null;
}
