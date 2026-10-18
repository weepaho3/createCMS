import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { MediaStoreState } from './core/store';

import { mergeProps, useRender } from '../use-render';
import { useMediaContext, useMediaMessages } from './context';
import { emptyReason } from './core/store';
import { useSelector } from './use-store';

type RenderProps<
  TElement extends React.ElementType,
  TState extends Record<string, unknown>,
> = Omit<UseRenderComponentProps<TElement, TState>, 'children'>;

// --- Media.Search ---------------------------------------------------------------

export type MediaSearchProps = UseRenderComponentProps<'input'>;

const selectQuery = (state: MediaStoreState) => state.collection.query.q ?? '';

/**
 * An `input[type="search"]` bound to the filter's `q`: the store reloads
 * 250 ms after typing stops and the URL is replaced, not pushed. Escape in
 * a non-empty field clears it.
 */
export function MediaSearch(props: MediaSearchProps) {
  const { render, ...rest } = props;
  const { store } = useMediaContext('Media.Search');
  const { messages } = useMediaMessages();
  const stored = useSelector(store, selectQuery, Object.is);
  // Local text so typing never waits for the store.
  const [text, setText] = React.useState(stored);
  React.useEffect(() => setText(stored), [stored]);

  return useRender({
    defaultTagName: 'input',
    render,
    props: mergeProps<'input'>(
      {
        type: 'search',
        'aria-label': messages.search.label,
        value: text,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          setText(event.target.value);
          void store.dispatch({
            type: 'setFilter',
            filter: { q: event.target.value },
            debounce: true,
          });
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Escape' && text) {
            event.preventDefault();
            setText('');
            void store.dispatch({
              type: 'setFilter',
              filter: { q: undefined },
            });
          }
        },
      },
      rest,
    ),
  });
}

// --- Media.LoadMore -------------------------------------------------------------

type LoadMoreState = { hasMore: boolean; loading: boolean };

export type MediaLoadMoreProps = UseRenderComponentProps<
  'button',
  LoadMoreState
>;

const selectLoadMore = (state: MediaStoreState) => ({
  hasMore: state.collection.cursor !== null,
  loading: state.collection.status === 'appending',
  loaded: state.collection.ids.length,
  total: state.collection.total,
});

/**
 * A `button` that appends the next page and announces how many arrived.
 * Rendered only while a next page exists; `aria-busy` while it loads.
 */
export function MediaLoadMore(props: MediaLoadMoreProps) {
  const { render, children, ...rest } = props;
  const { store, announce } = useMediaContext('Media.LoadMore');
  const { messages, format } = useMediaMessages();
  const { hasMore, loading } = useSelector(store, selectLoadMore);

  const element = useRender({
    defaultTagName: 'button',
    render,
    state: { hasMore, loading } satisfies LoadMoreState,
    props: mergeProps<'button'>(
      {
        type: 'button',
        'aria-busy': loading || undefined,
        'aria-disabled': loading || undefined,
        onClick: () => {
          if (loading) return;
          const before = store.getState().collection.ids.length;
          void store.dispatch({ type: 'loadMore' }).then((result) => {
            if (!result.ok) return;
            const { ids, total } = store.getState().collection;
            announce(
              messages.grid.loadedMore(
                { count: ids.length - before, loaded: ids.length, total },
                format,
              ),
            );
          });
        },
        children:
          children ??
          (loading ? messages.grid.loadingMore : messages.action.loadMore),
      },
      rest,
    ),
  });
  return hasMore ? element : null;
}

// --- Media.Empty ----------------------------------------------------------------

type EmptyReason = NonNullable<ReturnType<typeof emptyReason>>;
type EmptyState = { reason: EmptyReason };

export type MediaEmptyProps = UseRenderComponentProps<'div', EmptyState>;

/**
 * Rendered only when the collection is empty, with `data-empty-reason`:
 * `folder-empty`, `no-results` (filters match nothing), `error` or
 * `no-permission`. `children` defaults to the catalog text of the reason.
 */
export function MediaEmpty(props: MediaEmptyProps) {
  const { render, children, ...rest } = props;
  const { store } = useMediaContext('Media.Empty');
  const { messages } = useMediaMessages();
  const reason = useSelector(store, emptyReason, Object.is);
  const element = useRender({
    defaultTagName: 'div',
    render,
    stateAttributesMapping: {
      reason: (value) => ({ 'data-empty-reason': value }),
    },
    state: { reason: reason ?? 'folder-empty' } satisfies EmptyState,
    props: mergeProps<'div'>(rest, {
      children: children ?? (reason ? messages.empty[reason] : null),
    }),
  });
  return reason ? element : null;
}

// --- Media.Error / Media.MutationError ----------------------------------------------

export type MediaErrorProps = RenderProps<'div', Record<string, never>> & {
  children: (args: { error: unknown; retry: () => void }) => React.ReactNode;
};

const selectListError = (state: MediaStoreState) => ({
  failed: state.collection.status === 'error',
  error: state.collection.error,
});

/** `div[role="alert"]` for a failed list request; `retry` reloads. */
export function MediaError(props: MediaErrorProps) {
  const { children, render, ...rest } = props;
  const { store } = useMediaContext('Media.Error');
  const { failed, error } = useSelector(store, selectListError);
  const element = useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>({ role: 'alert' }, rest, {
      children: failed
        ? children({
            error,
            retry: () => void store.dispatch({ type: 'load' }),
          })
        : null,
    }),
  });
  return failed ? element : null;
}

export type MediaMutationErrorProps = RenderProps<
  'div',
  Record<string, never>
> & {
  children: (args: { error: unknown; dismiss: () => void }) => React.ReactNode;
};

const selectMutationError = (state: MediaStoreState) => ({
  failed: state.mutation.status === 'error',
  error: state.mutation.error,
});

/** `div[role="alert"]` for a rejected bulk change; `dismiss` resets it. */
export function MediaMutationError(props: MediaMutationErrorProps) {
  const { children, render, ...rest } = props;
  const { store } = useMediaContext('Media.MutationError');
  const { failed, error } = useSelector(store, selectMutationError);
  const element = useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>({ role: 'alert' }, rest, {
      children: failed
        ? children({
            error,
            dismiss: () => void store.dispatch({ type: 'clearMutationError' }),
          })
        : null,
    }),
  });
  return failed ? element : null;
}
