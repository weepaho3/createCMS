// @registry ui-sdk-editor@0.3.2
import {
  createChange,
  createFocusRecovery,
  createRovingFocus,
  createTreeReorder,
  createTypeahead,
  css,
  definePrimitive,
  dispatch,
  isRTL,
  isTypeaheadKey,
  labelOf,
  live,
  selects,
  treeReorderMessage,
  type ChangeDetails,
  type TreeReorderDraft,
  type TreeReorderReason,
  type TreeReorderRow,
} from '@ui-sdk/core';

type ExpandedReason = 'trigger-press' | 'list-navigation' | TreeReorderReason;
type SelectedReason = 'item-press' | 'list-navigation' | 'imperative';

export type BlockOutlineOptions = {
  rows?: TreeReorderRow[];
  defaultRows?: TreeReorderRow[];
  onRowsChange?: (
    rows: TreeReorderRow[],
    details: ChangeDetails<TreeReorderReason> & {
      key: string;
      parent: string | null;
      index: number;
    },
  ) => void;
  expanded?: string[];
  defaultExpanded?: string[];
  onExpandedChange?: (
    expanded: string[],
    details: ChangeDetails<ExpandedReason>,
  ) => void;
  selected?: string[];
  defaultSelected?: string[];
  onSelectedChange?: (
    selected: string[],
    details: ChangeDetails<SelectedReason>,
  ) => void;
  hovered?: string | null;
  onHover?: (key: string | null, details: ChangeDetails<'item-hover'>) => void;
  fixed?: string[];
  labels?: Record<string, string>;
  canPlace?: (key: string, parent: string | null) => boolean;
};

type OutlineState = {
  rows: TreeReorderRow[];
  expanded: string[];
  selected: string[];
  anchor: string | null;
  fixed: string[];
  labels: Record<string, string>;
  hovered: string | null;
  focused: string | null;
  moving: TreeReorderDraft | null;
  blocked: boolean;
};

export type OutlineRowState = {
  depth: number;
  parent: boolean;
  expanded: boolean;
  selected: boolean;
  moving: boolean;
};

const hasChildren = (rows: readonly TreeReorderRow[], index: number) =>
  index >= 0 && (rows[index + 1]?.depth ?? -1) > rows[index]!.depth;

function parentIndex(rows: readonly TreeReorderRow[], index: number) {
  const depth = rows[index]?.depth ?? 0;
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i]!.depth < depth) return i;
  }
  return -1;
}

type Place = {
  index: number;
  depth: number;
  parent: boolean;
  position: number;
  size: number;
};

const places = new WeakMap<readonly TreeReorderRow[], Map<string, Place>>();
function placeOf(rows: readonly TreeReorderRow[], key: string): Place {
  let map = places.get(rows);
  if (!map) {
    map = new Map();
    const siblings = new Map<number, string[]>();
    rows.forEach((row, index) => {
      const parent = parentIndex(rows, index);
      const list = siblings.get(parent) ?? [];
      list.push(row.key);
      siblings.set(parent, list);
    });
    rows.forEach((row, index) => {
      const list = siblings.get(parentIndex(rows, index))!;
      map!.set(row.key, {
        index,
        depth: row.depth,
        parent: hasChildren(rows, index),
        position: list.indexOf(row.key) + 1,
        size: list.length,
      });
    });
    places.set(rows, map);
  }
  return (
    map.get(key) ?? { index: -1, depth: 0, parent: false, position: 1, size: 1 }
  );
}

export function visibleRows(
  rows: readonly TreeReorderRow[],
  expanded: readonly string[],
  moving: string | null,
): TreeReorderRow[] {
  const shown: TreeReorderRow[] = [];
  let closed = Infinity;
  rows.forEach((row, index) => {
    if (row.depth <= closed) closed = Infinity;
    if (row.depth > closed && row.key !== moving) return;
    shown.push(row);
    if (
      closed === Infinity &&
      hasChildren(rows, index) &&
      !expanded.includes(row.key)
    ) {
      closed = row.depth;
    }
  });
  return shown;
}

const own = (el: HTMLElement | undefined, event?: Event) => {
  if (!event) return true;
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest(
    'button, a[href], input, textarea, select, [role="button"], [role="treeitem"]',
  );
  return control === el;
};

export const blockOutline = definePrimitive({
  name: 'editor-tree',
  options: {
    rows: 'value',
    defaultRows: 'value',
    onRowsChange: 'callback',
    expanded: 'list',
    defaultExpanded: 'list',
    onExpandedChange: 'callback',
    selected: 'list',
    defaultSelected: 'list',
    onSelectedChange: 'callback',
    hovered: 'string',
    onHover: 'callback',
    fixed: 'list',
    labels: 'value',
    canPlace: 'value',
  },
  controlled: ['rows', 'expanded', 'selected'],
  live: ['hovered'],
  state: (options: BlockOutlineOptions): OutlineState => ({
    rows: options.rows ?? options.defaultRows ?? [],
    expanded: options.expanded ?? options.defaultExpanded ?? [],
    selected: options.selected ?? options.defaultSelected ?? [],
    anchor: null,
    fixed: options.fixed ?? [],
    labels: options.labels ?? {},
    hovered: options.hovered ?? null,
    focused: null,
    moving: null,
    blocked: false,
  }),
  sync: (options) => {
    const next: Partial<OutlineState> = {
      hovered: options.hovered ?? null,
      fixed: options.fixed ?? [],
      labels: options.labels ?? {},
    };
    if (options.rows !== undefined) next.rows = options.rows;
    if (options.expanded !== undefined) next.expanded = options.expanded;
    if (options.selected !== undefined) next.selected = options.selected;
    return next;
  },
  api: (context) => {
    const { store } = context;
    const change = createChange(context);
    const typeahead = createTypeahead();
    const fixed = (key: string) => store.get().fixed.includes(key);
    const known = (key: string) =>
      store.get().rows.some((row) => row.key === key);
    const check = (key: string) => {
      if (known(key)) return;
      const keys = store.get().rows.map((row) => row.key);
      throw new Error(
        `No block "${key}" in the outline. Blocks: ${keys.join(', ')}.`,
      );
    };
    const allowed = (key: string, parent: string | null) =>
      context.options().canPlace?.(key, parent) ?? true;

    context.onDestroy(
      store.subscribe(() => {
        const { moving, blocked } = store.get();
        let next = false;
        if (moving) {
          const index = moving.rows.findIndex((row) => row.key === moving.key);
          const parent = parentIndex(moving.rows, index);
          next = !allowed(
            moving.key,
            parent === -1 ? null : moving.rows[parent]!.key,
          );
        }
        if (next !== blocked) store.set({ blocked: next });
      }),
    );

    const setOpen = (
      key: string,
      open: boolean,
      details: { reason: ExpandedReason; event?: Event },
    ) => {
      const { expanded } = store.get();
      if (fixed(key) || expanded.includes(key) === open) return false;
      return change(
        'expanded',
        open ? [...expanded, key] : expanded.filter((k) => k !== key),
        details,
      );
    };

    const roving = createRovingFocus<OutlineState, { value: string }>(context, {
      slot: 'row',
      key: 'focused',
      claims: (state, item) =>
        state.selected.length === 0 ||
        !visible(state).some((row) => row.key === state.selected[0]) ||
        item.key === state.selected[0],
    });

    const tree = createTreeReorder<OutlineState>(context, {
      key: 'rows',
      draft: 'moving',
      indent: () => 16,
      preview: true,
      disabled: fixed,
      label: (key) => store.get().labels[key],
      set: (value, details) => {
        if (!allowed(details.key, details.parent)) return false;
        if (!change('rows', value, details)) return false;
        if (details.parent) {
          setOpen(details.parent, true, {
            reason: details.reason,
            event: details.event,
          });
        }
        return true;
      },
      message: (message) => {
        const text = treeReorderMessage(message);
        return message.type === 'move' && store.get().blocked
          ? `${text} Can't drop here.`
          : text;
      },
    });

    const visible = (state: OutlineState) =>
      visibleRows(
        tree.rows(state),
        [...state.expanded, ...state.fixed],
        state.moving?.key ?? null,
      );

    const recovery = createFocusRecovery<{ value: string }>({
      fallback: (lost) => {
        const state = store.get();
        const shown = new Set(visible(state).map((row) => row.key));
        const rows = tree.rows(state);
        let index = rows.findIndex((row) => row.key === lost.key);
        for (
          let i = parentIndex(rows, index);
          i >= 0;
          i = parentIndex(rows, i)
        ) {
          if (shown.has(rows[i]!.key))
            return context.element('row', rows[i]!.key);
        }
        const keys = visible(state).map((row) => row.key);
        if (index === -1) index = 0;
        const next =
          rows.slice(index + 1).find((row) => shown.has(row.key)) ??
          rows
            .slice(0, Math.max(index, 0))
            .reverse()
            .find((row) => shown.has(row.key));
        return next
          ? context.element('row', next.key)
          : context.element('row', keys[0]);
      },
    });

    const expandSiblings = (key: string, event: KeyboardEvent) => {
      const state = store.get();
      const rows = tree.rows(state);
      const index = rows.findIndex((row) => row.key === key);
      const up = parentIndex(rows, index);
      const depth = rows[index]?.depth ?? 0;
      const siblings = rows.filter(
        (row, i) =>
          row.depth === depth &&
          parentIndex(rows, i) === up &&
          hasChildren(rows, i) &&
          !fixed(row.key) &&
          !state.expanded.includes(row.key),
      );
      if (siblings.length === 0) return;
      change(
        'expanded',
        [...state.expanded, ...siblings.map((row) => row.key)],
        {
          reason: 'list-navigation',
          event,
        },
      );
    };

    const range = (from: string, to: string) => {
      const keys = visible(store.get()).map((row) => row.key);
      const a = keys.indexOf(from);
      const b = keys.indexOf(to);
      if (a === -1 || b === -1) return [to];
      return keys.slice(Math.min(a, b), Math.max(a, b) + 1);
    };

    const choose = (
      next: string[],
      anchor: string | null,
      details: { reason: SelectedReason; event?: Event },
    ) => {
      if (anchor !== null) store.set({ anchor });
      const current = store.get().selected;
      if (
        next.length === current.length &&
        next.every((k, i) => k === current[i])
      ) {
        return false;
      }
      return change('selected', next, details);
    };

    const api = {
      roving,
      tree,
      recovery,
      visible,
      select(
        keys: string | string[],
        details: { reason: SelectedReason; event?: Event } = {
          reason: 'imperative',
        },
      ) {
        const next = Array.isArray(keys) ? keys : [keys];
        next.forEach(check);
        return choose(next, next[0] ?? null, details);
      },
      toggle(key: string, event?: Event) {
        check(key);
        return setOpen(key, !store.get().expanded.includes(key), {
          reason: event ? 'trigger-press' : 'imperative',
          event,
        });
      },
      move(key: string, before: string | null, depth: number) {
        check(key);
        if (before !== null) check(before);
        if (fixed(key)) throw new Error(`"${key}" can't move.`);
        return tree.move(key, before, depth);
      },
      hover(key: string | null, event?: PointerEvent) {
        if (store.get().hovered === key) return;
        dispatch(context, 'onHover', key, { reason: 'item-hover', event });
      },
      items: () => {
        const { labels } = store.get();
        return tree.rows(store.get()).map((row) => ({
          value: row.key,
          label:
            labels[row.key] ??
            (context.element('row', row.key)
              ? labelOf(context.element('row', row.key)!)
              : row.key),
        }));
      },
      press(key: string, event?: MouseEvent) {
        const { selected, anchor } = store.get();
        if (event?.shiftKey && (anchor ?? selected[0])) {
          return choose(range(anchor ?? selected[0]!, key), null, {
            reason: 'item-press',
            event,
          });
        }
        if (event?.metaKey || event?.ctrlKey) {
          const next = selected.includes(key)
            ? selected.filter((k) => k !== key)
            : [...selected, key];
          return choose(next, key, { reason: 'item-press', event });
        }
        return choose([key], key, { reason: 'item-press', event });
      },
      keydown(event: KeyboardEvent, el: HTMLElement, key: string) {
        if (event.target !== el) return;
        const state = store.get();
        const mod = event.ctrlKey || event.metaKey;
        if (!state.moving && event.key === '*') {
          event.preventDefault();
          expandSiblings(key, event);
          return;
        }
        if (
          !state.moving &&
          !mod &&
          isTypeaheadKey(event) &&
          (event.key !== ' ' || typeahead.active())
        ) {
          const items = roving.items();
          const at = typeahead(
            event.key,
            items.map((item) => labelOf(item.el)),
            items.findIndex((item) => item.el === el),
          );
          if (at === -1) return;
          event.preventDefault();
          const target = items[at]!.key;
          roving.focus(target);
          choose([target], target, { reason: 'list-navigation', event });
          return;
        }
        if (!state.moving && mod && event.key === ' ') {
          event.preventDefault();
          const next = state.selected.includes(key)
            ? state.selected.filter((k) => k !== key)
            : [...state.selected, key];
          choose(next, key, { reason: 'list-navigation', event });
          return;
        }
        if (!state.moving && mod && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          choose(
            visible(state).map((row) => row.key),
            null,
            { reason: 'list-navigation', event },
          );
          return;
        }
        if (tree.keydown(event, key)) return;
        const rows = tree.rows(state);
        const { index, parent } = placeOf(rows, key);
        const open = state.expanded.includes(key) || fixed(key);
        const rtl = isRTL(el);
        const inward = rtl ? 'ArrowLeft' : 'ArrowRight';
        const outward = rtl ? 'ArrowRight' : 'ArrowLeft';
        if (event.altKey) return;
        if (event.key === inward && parent) {
          event.preventDefault();
          if (!open) setOpen(key, true, { reason: 'list-navigation', event });
          else roving.focus(rows[index + 1]!.key);
          return;
        }
        if (event.key === outward) {
          event.preventDefault();
          if (parent && open && !fixed(key)) {
            setOpen(key, false, { reason: 'list-navigation', event });
            return;
          }
          const up = parentIndex(rows, index);
          if (up !== -1) roving.focus(rows[up]!.key);
          return;
        }
        if (
          mod &&
          ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
        ) {
          const keys = roving.items().map((item) => item.key);
          const at = keys.indexOf(key);
          const target =
            event.key === 'Home'
              ? keys[0]
              : event.key === 'End'
                ? keys.at(-1)
                : keys[at + (event.key === 'ArrowUp' ? -1 : 1)];
          if (target) {
            event.preventDefault();
            roving.focus(target);
          }
          return;
        }
        const moved = roving.keydown(event, el);
        if (!moved || moved.key === moved.from || mod) return;
        const anchor = state.anchor ?? state.selected[0] ?? moved.from;
        if (moved.shift) {
          choose(range(anchor, moved.key), null, {
            reason: 'list-navigation',
            event,
          });
        } else {
          choose([moved.key], moved.key, { reason: 'list-navigation', event });
        }
      },
    };
    return api;
  },
  slots: (slot) => ({
    root: slot<{}, { rows: TreeReorderRow[]; moving: boolean }>({
      role: 'tree',
      keys: { none: 'Each row handles its own keys.' },
      state: (state, { api }) => ({
        rows: api.visible(state),
        moving: state.moving !== null,
      }),
      attrs: (state) => ({
        'aria-multiselectable': 'true',
        'data-moving': state.moving ? '' : undefined,
      }),
      on: {
        pointerleave: (event, { api }) =>
          api.hover(null, event as PointerEvent),
      },
    }),
    row: slot<{ value: string }, OutlineRowState>({
      props: { value: 'string' },
      role: 'treeitem',
      focus: 'roving',
      press: ({ api, key, el }, event) => {
        if (own(el, event)) api.press(key, event as MouseEvent | undefined);
      },
      keys: [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        ' ',
        'Enter',
        'Escape',
        '*',
        'typeahead',
      ],
      selects: selects({
        focused: ({ key }) => [key, null],
        selected: ({ key }) => [key],
        expanded: ({ key }) => [key],
      }),
      state: (state, { key, api }) => {
        const place = placeOf(api.tree.rows(state), key);
        return {
          depth: place.depth,
          parent: place.parent,
          expanded: state.expanded.includes(key) || state.fixed.includes(key),
          selected: state.selected.includes(key),
          moving: api.tree.moving(state, key),
        };
      },
      attrs: (state, part) => {
        const { api, key, id } = part;
        const place = placeOf(api.tree.rows(state), key);
        const moving = api.tree.moving(state, key);
        return {
          'aria-level': String(place.depth + 1),
          'aria-posinset': String(place.position),
          'aria-setsize': String(place.size),
          'aria-selected': String(state.selected.includes(key)),
          'aria-expanded': place.parent
            ? String(state.expanded.includes(key) || state.fixed.includes(key))
            : undefined,
          'aria-describedby': `${id}-instructions`,
          tabindex: api.roving.tabIndex(state, part),
          'data-selected': state.selected.includes(key) ? '' : undefined,
          'data-moving': moving ? '' : undefined,
          'data-dragging': api.tree.dragging(state, key) ? '' : undefined,
          'data-blocked':
            moving && state.moving?.key === key && state.blocked
              ? ''
              : undefined,
          style: css({ '--depth': String(place.depth) }),
        };
      },
      live: live((state, part) => ({
        'data-hovered': state.hovered === part.key ? '' : undefined,
      })),
      on: {
        keydown: (event, { el, api, key }) => {
          if (el) api.keydown(event, el, key);
        },
        pointerdown: (event, { api, key, el }) => {
          if (event.pointerType === 'touch' || !own(el, event)) return;
          if (
            event.target instanceof Element &&
            event.target.closest('button, a, input')
          ) {
            return;
          }
          api.tree.pointerdown(event, key);
        },
        pointerenter: (event, { api, key }) => api.hover(key, event),
      },
      bind: (el, part) => {
        let selected = part.store.get().selected[0] === part.key;
        const follow = () => {
          const now = part.store.get().selected[0] === part.key;
          if (now && !selected && el.ownerDocument.activeElement !== el) {
            part.api.roving.remember(part.key);
            el.scrollIntoView({ block: 'nearest' });
          }
          selected = now;
        };
        const cleanups = [
          part.api.roving.bind(el, part),
          part.api.tree.bind(el, part.key),
          part.api.recovery.bind(el, part),
          part.store.subscribe(follow),
        ];
        return () => cleanups.forEach((cleanup) => cleanup());
      },
    }),
    text: slot<{ value: string }>({
      props: { value: { kind: 'string', from: 'row' } },
    }),
    toggle: slot<{ value: string }, { expanded: boolean; parent: boolean }>({
      props: { value: { kind: 'string', from: 'row' } },
      state: (state, { key, api }) => ({
        expanded: state.expanded.includes(key),
        parent:
          placeOf(api.tree.rows(state), key).parent &&
          !state.fixed.includes(key),
      }),
      attrs: (state, { key, api }) => ({
        'aria-hidden': 'true',
        'data-parent':
          placeOf(api.tree.rows(state), key).parent &&
          !state.fixed.includes(key)
            ? ''
            : undefined,
        'data-expanded': state.expanded.includes(key) ? '' : undefined,
      }),
      press: ({ api, key, store }, event) => {
        event?.stopPropagation();
        const { rows, fixed } = store.get();
        if (!placeOf(rows, key).parent || fixed.includes(key)) return;
        api.toggle(key, event);
      },
      on: {
        pointerdown: (event) => event.preventDefault(),
      },
    }),
    handle: slot<{ value: string }>({
      props: { value: { kind: 'string', from: 'row' } },
      attrs: () => ({ 'aria-hidden': 'true' }),
      on: {
        pointerdown: (event, { api, key }) => {
          event.stopPropagation();
          api.tree.pointerdown(event, key);
        },
      },
    }),
    instructions: slot({
      attrs: (_state, { id }) => ({ id: `${id}-instructions`, hidden: '' }),
    }),
  }),
  agent: {
    actions: ['select', 'toggle', 'move'],
    closed: true,
    items: (api) => api.items(),
  },
});
