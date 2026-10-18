import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { BulkAction, BulkInput, ConfirmDescriptor } from './core/bulk';
import type { CommandResult, MediaStore, MediaStoreState } from './core/store';

import { mergeProps, useRender } from '../use-render';
import { useMediaContext, useMediaMessages } from './context';
import { archiveInUseConfirm, bulkContext } from './core/bulk';
import { selectionCount } from './core/selection';
import { assetName, useMediaItemContext } from './grid';
import { useSelector } from './use-store';

type RenderProps<
  TElement extends React.ElementType,
  TState extends Record<string, unknown>,
> = Omit<UseRenderComponentProps<TElement, TState>, 'children'>;

// --- hooks --------------------------------------------------------------------------

const selectSelection = (state: MediaStoreState) => ({
  selection: state.selection,
  total: state.collection.total,
  loaded: state.collection.ids.length,
});

export type MediaSelection = {
  selected: string[];
  /** Selected assets, unloaded ones of `allMatching` included. */
  count: number;
  allMatching: boolean;
  /** Selected ids a filter hides (with `keepHiddenSelection`). */
  hidden: number;
  mode: MediaStoreState['selection']['mode'];
  /** More assets match than are loaded, so `selectAllMatching` selects more than `selectAll`. */
  canSelectAllMatching: boolean;
  total: number | null;
  select: (
    id: string,
    modifiers?: { range?: boolean; toggle?: boolean },
  ) => void;
  toggle: (id: string) => void;
  selectAll: () => void;
  selectAllMatching: () => void;
  clear: () => void;
};

/** The selection of the enclosing `Media.Root` and its commands. */
export function useMediaSelection(): MediaSelection {
  const { store } = useMediaContext('useMediaSelection');
  const { selection, total, loaded } = useSelector(store, selectSelection);
  return React.useMemo(
    () => ({
      selected: selection.selected,
      count: selectionCount(selection, total),
      allMatching: selection.allMatching !== null,
      hidden: selection.hidden,
      mode: selection.mode,
      canSelectAllMatching:
        selection.mode === 'multiple' &&
        total !== null &&
        total > loaded &&
        !selection.allMatching,
      total,
      select: (id, modifiers) =>
        void store.dispatch({ type: 'select', id, modifiers }),
      toggle: (id) => void store.dispatch({ type: 'toggleSelection', id }),
      selectAll: () => void store.dispatch({ type: 'selectAll' }),
      selectAllMatching: () =>
        void store.dispatch({ type: 'selectAllMatching' }),
      clear: () => void store.dispatch({ type: 'clearSelection' }),
    }),
    [selection, total, loaded, store],
  );
}

// --- Selection.Checkbox ------------------------------------------------------------------

type CheckboxState = { checked: boolean };

export type SelectionCheckboxProps = UseRenderComponentProps<
  'input',
  CheckboxState
>;

/**
 * The always visible checkbox of a `Media.Item` (selection modes only):
 * it toggles the item without replacing the selection, for touch and for
 * discoverability. It is not a tab stop; the grid cell is.
 */
export function SelectionCheckbox(props: SelectionCheckboxProps) {
  const { render, ...rest } = props;
  const { store } = useMediaContext('Selection.Checkbox');
  const { messages, format } = useMediaMessages();
  const { asset, selected } = useMediaItemContext('Selection.Checkbox');
  const mode = useSelector(store, selectMode, Object.is);
  const element = useRender({
    defaultTagName: 'input',
    render,
    state: { checked: selected } satisfies CheckboxState,
    props: mergeProps<'input'>(
      {
        type: 'checkbox',
        checked: selected,
        tabIndex: -1,
        'aria-label': messages.selection.item(
          { name: assetName(asset) },
          format,
        ),
        onClick: (event: React.MouseEvent) => event.stopPropagation(),
        onChange: () =>
          void store.dispatch({ type: 'toggleSelection', id: asset.id }),
      },
      rest,
    ),
  });
  return mode === 'none' ? null : element;
}

const selectMode = (state: MediaStoreState) => state.selection.mode;

// --- Selection.Count / Bar / SelectAllMatching / Hidden / Clear -------------------------

export type SelectionCountProps = RenderProps<'span', { count: number }>;

/** "4 selected" or "All 312 selected"; nothing without a selection. */
export function SelectionCount(props: SelectionCountProps) {
  const { render, ...rest } = props;
  const { messages, format } = useMediaMessages();
  const { count, allMatching } = useMediaSelection();
  const element = useRender({
    defaultTagName: 'span',
    render,
    state: { count },
    props: mergeProps<'span'>(rest, {
      children: allMatching
        ? messages.selection.all({ count }, format)
        : messages.selection.count({ count }, format),
    }),
  });
  return count > 0 ? element : null;
}

export type SelectionBarProps = UseRenderComponentProps<
  'div',
  { count: number }
>;

/** A container shown while something is selected, with `data-count`. */
export function SelectionBar(props: SelectionBarProps) {
  const { render, ...rest } = props;
  const { count } = useMediaSelection();
  const element = useRender({
    defaultTagName: 'div',
    render,
    state: { count },
    props: rest,
  });
  return count > 0 ? element : null;
}

export type SelectionSelectAllMatchingProps = UseRenderComponentProps<'button'>;

/**
 * "Select all 312": selects every asset matching the current filter on the
 * server, loaded or not. Rendered only when more match than are loaded.
 */
export function SelectionSelectAllMatching(
  props: SelectionSelectAllMatchingProps,
) {
  const { render, children, ...rest } = props;
  const { messages, format } = useMediaMessages();
  const { canSelectAllMatching, total, selectAllMatching } =
    useMediaSelection();
  const element = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        onClick: selectAllMatching,
        children:
          children ??
          messages.selection.selectAllMatching({ count: total ?? 0 }, format),
      },
      rest,
    ),
  });
  return canSelectAllMatching ? element : null;
}

export type SelectionHiddenProps = RenderProps<'p', { count: number }>;

/** "3 selected items are hidden by filters" (with `keepHiddenSelection`). */
export function SelectionHidden(props: SelectionHiddenProps) {
  const { render, ...rest } = props;
  const { messages, format } = useMediaMessages();
  const { hidden } = useMediaSelection();
  const element = useRender({
    defaultTagName: 'p',
    render,
    state: { count: hidden },
    props: mergeProps<'p'>(rest, {
      children: messages.selection.hidden({ count: hidden }, format),
    }),
  });
  return hidden > 0 ? element : null;
}

export type SelectionClearProps = UseRenderComponentProps<'button'>;

/** Clears the selection; rendered only while something is selected. */
export function SelectionClear(props: SelectionClearProps) {
  const { render, children, ...rest } = props;
  const { messages } = useMediaMessages();
  const { count, clear } = useMediaSelection();
  const element = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        onClick: clear,
        children: children ?? messages.action.clearSelection,
      },
      rest,
    ),
  });
  return count > 0 ? element : null;
}

// --- bulk actions ------------------------------------------------------------------------

export type BulkOutcome = {
  id: number;
  message: string;
  undo?: () => Promise<CommandResult>;
};

type OutcomeStore = {
  get(): BulkOutcome | null;
  set(outcome: BulkOutcome | null): void;
  subscribe(listener: () => void): () => void;
};

const outcomes = new WeakMap<MediaStore, OutcomeStore>();

function outcomeStoreOf(store: MediaStore): OutcomeStore {
  let existing = outcomes.get(store);
  if (!existing) {
    let value: BulkOutcome | null = null;
    const listeners = new Set<() => void>();
    existing = {
      get: () => value,
      set(next) {
        value = next;
        for (const listener of listeners) listener();
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    outcomes.set(store, existing);
  }
  return existing;
}

let outcomeId = 0;

const undoOf = (outcome: BulkOutcome) => outcome.undo;

/** After a removal the store moved the focus; put the DOM focus there. */
function focusCell(store: MediaStore) {
  const id = store.getState().selection.focus;
  if (!id || typeof document === 'undefined') return;
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(`[data-cell-id="${CSS.escape(id)}"]`)
      ?.focus();
  });
}

export type BulkActionItem = {
  action: BulkAction;
  /** `true`, or the reason code it is disabled for. */
  enabled: true | string;
  label: string;
};

/**
 * The registered actions for the selection (or `itemId` alone), with
 * whether each can run and its translated label (built-ins through
 * `bulk.action`, custom actions by their own label).
 */
export function useBulkActions(itemId?: string): BulkActionItem[] {
  const { store } = useMediaContext('useBulkActions');
  const { messages } = useMediaMessages();
  const state = useSelector(store, identity, Object.is);
  const registered = React.useSyncExternalStore(
    store.registries.assetActions.subscribe,
    store.registries.assetActions.list,
    store.registries.assetActions.list,
  );
  return React.useMemo(() => {
    const context = bulkContext(store, itemId, state);
    const scope = itemId ? 'item' : 'selection';
    return registered
      .filter(
        (action) =>
          (action.scope ?? 'both') === 'both' || action.scope === scope,
      )
      .map((action) => ({
        action,
        enabled: action.canExecute(context),
        label:
          (messages.bulk.action as Record<string, string>)[action.label] ??
          action.label,
      }));
  }, [registered, state, store, itemId, messages]);
}

const identity = (state: MediaStoreState) => state;

export type BulkBarProps = RenderProps<'div', { count: number }> & {
  children: (actions: BulkActionItem[]) => React.ReactNode;
};

/** `role="toolbar"` with the bulk actions of the selection; nothing without one. */
export function BulkBar(props: BulkBarProps) {
  const { children, render, ...rest } = props;
  const { messages } = useMediaMessages();
  const { count } = useMediaSelection();
  const actions = useBulkActions();
  const element = useRender({
    defaultTagName: 'div',
    render,
    state: { count },
    props: mergeProps<'div'>(
      { role: 'toolbar', 'aria-label': messages.bulk.bar },
      rest,
      { children: children(actions) },
    ),
  });
  return count > 0 ? element : null;
}

type BulkActionState = { disabledReason: string | null; running: boolean };

export type BulkActionProps = UseRenderComponentProps<
  'button',
  BulkActionState
> & {
  /** The registered action id (`move`, `archive`, a custom id). */
  action: string;
  /** What the action needs beyond the selection (`folderId` for `move`). */
  input?: BulkInput;
  /** Asks the user; called for actions with a confirmation and for assets an archive skipped. */
  confirm?: (descriptor: ConfirmDescriptor) => boolean | Promise<boolean>;
  /** One asset instead of the selection (an item menu). */
  itemId?: string;
  onResult?: (result: CommandResult) => void;
};

/**
 * A `button` that runs a registered action. A disabled action keeps focus
 * (`aria-disabled`) and says why in `data-disabled-reason` and `title`.
 * Results are announced, offered for undo through `Bulk.Outcome`, and the
 * focus moves to the next item after a removal. Assets an archive skipped
 * because they are in use are archived with `force` only after `confirm`
 * agreed to the listed assets.
 */
export function BulkActionButton(props: BulkActionProps) {
  const {
    action: actionId,
    input,
    confirm,
    itemId,
    onResult,
    render,
    children,
    ...rest
  } = props;
  const { store, announce } = useMediaContext('Bulk.Action');
  const { messages, format } = useMediaMessages();
  const actions = useBulkActions(itemId);
  const item = actions.find((entry) => entry.action.id === actionId);
  const [running, setRunning] = React.useState(false);
  const disabledReason = !item
    ? 'unsupported'
    : item.enabled === true
      ? null
      : item.enabled;

  const describe = (
    action: BulkAction,
    result: CommandResult,
    count: number,
  ): string | null => {
    if (!result.ok) return null;
    switch (action.id) {
      case 'move': {
        const folderId = input?.folderId ?? null;
        const folder =
          folderId === null
            ? messages.folder.root
            : (store.getState().folders.nodes[folderId]?.name ??
              messages.folder.root);
        return messages.bulk.moved({ count, folder }, format);
      }
      case 'archive':
        return messages.bulk.archived({ count }, format);
      case 'restore':
        return messages.bulk.restored({ count }, format);
      case 'purge':
        return messages.bulk.purged({ count }, format);
      case 'makePublic':
      case 'makePrivate':
        return messages.bulk.visibility(
          { count, status: action.id === 'makePublic' ? 'public' : 'private' },
          format,
        );
      default:
        return null;
    }
  };

  const run = async () => {
    if (!item || item.enabled !== true || running) return;
    const { action } = item;
    const context = bulkContext(store, itemId);
    const descriptor = action.confirm?.(context);
    if (descriptor && confirm && !(await confirm(descriptor))) return;
    setRunning(true);
    let result = await action.run(context, input);
    if (
      result.ok &&
      action.id === 'archive' &&
      confirm &&
      (result.skipped?.length ?? 0) > 0
    ) {
      const inUse = archiveInUseConfirm(
        store.getState().mutation.skippedReasons,
      );
      if (inUse && (await confirm(inUse))) {
        const forced = await store.dispatch({
          type: 'archive',
          ids: inUse.items?.map((entry) => entry.id),
          force: true,
        });
        if (forced.ok) {
          const done = [
            ...(Array.isArray(result.value) ? (result.value as string[]) : []),
            ...(Array.isArray(forced.value) ? (forced.value as string[]) : []),
          ];
          result = { ...forced, value: done };
        }
      }
    }
    setRunning(false);
    onResult?.(result);
    if (!result.ok) return;
    const count = Array.isArray(result.value)
      ? result.value.length
      : context.count;
    const message = describe(action, result, count);
    if (message) {
      announce(message);
      outcomeStoreOf(store).set({
        id: ++outcomeId,
        message,
        undo: result.undo,
      });
    }
    focusCell(store);
  };

  const label = item?.label ?? actionId;
  return useRender({
    defaultTagName: 'button',
    render,
    state: { disabledReason, running } satisfies BulkActionState,
    stateAttributesMapping: {
      disabledReason: (value) =>
        value ? { 'data-disabled-reason': value } : null,
    },
    props: mergeProps<'button'>(
      {
        type: 'button',
        'aria-disabled': disabledReason !== null || running || undefined,
        'aria-busy': running || undefined,
        title: disabledReason
          ? (messages.bulk.disabled[disabledReason] ?? undefined)
          : undefined,
        onClick: () => void run(),
        children: children ?? label,
      },
      rest,
    ),
  });
}

export type BulkOutcomeProps = RenderProps<'div', Record<string, never>> & {
  children: (outcome: {
    message: string;
    /** Reverts the change; absent when it is not invertible. */
    undo?: () => void;
    dismiss: () => void;
  }) => React.ReactNode;
  /** Hides the outcome after this many ms. @default 8000 */
  timeout?: number;
};

/**
 * The result of the last bulk action ("4 assets moved to Products") with
 * its undo while it lasts (a toast). It is announced already; this part
 * is visual and carries no live region.
 */
export function BulkOutcomeView(props: BulkOutcomeProps) {
  const { children, timeout = 8000, render, ...rest } = props;
  const { store, announce } = useMediaContext('Bulk.Outcome');
  const { messages } = useMediaMessages();
  const outcomeStore = outcomeStoreOf(store);
  const outcome = React.useSyncExternalStore(
    outcomeStore.subscribe,
    outcomeStore.get,
    outcomeStore.get,
  );
  React.useEffect(() => {
    if (!outcome) return;
    const timer = setTimeout(() => {
      if (outcomeStore.get()?.id === outcome.id) outcomeStore.set(null);
    }, timeout);
    return () => clearTimeout(timer);
  }, [outcome, outcomeStore, timeout]);
  const element = useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(rest, {
      children: outcome
        ? children({
            message: outcome.message,
            undo: undoOf(outcome)
              ? () => {
                  const undo = undoOf(outcome);
                  if (!undo) return;
                  outcomeStore.set(null);
                  void undo().then((result) => {
                    if (result.ok) announce(messages.bulk.undone);
                  });
                }
              : undefined,
            dismiss: () => outcomeStore.set(null),
          })
        : null,
    }),
  });
  return outcome ? element : null;
}
