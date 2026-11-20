// @registry ui-sdk-editor@0.3.2
import {
  createChange,
  createRovingFocus,
  createTreeReorder,
  createTypeahead,
  css,
  definePrimitive,
  elements,
  isTypeaheadKey,
  labelOf,
  selects,
  treeReorderMessage,
  type ChangeDetails,
  type TreeReorderDraft,
  type TreeReorderReason,
  type TreeReorderRow,
} from '@ui-sdk/core';

type ExpandedReason =
  | 'toggle-press'
  | 'list-navigation'
  | 'drop'
  | 'imperative';
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
  onHover?: (key: string | null) => void;
  fixed?: string[];
  canPlace?: (key: string, parent: string | null) => boolean;
};

type OutlineState = {
  rows: TreeReorderRow[];
  expanded: string[];
  selected: string[];
  fixed: string[];
  hovered: string | null;
  focused: string | null;
  moving: TreeReorderDraft | null;
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

function parentKey(rows: readonly TreeReorderRow[], index: number) {
  const depth = rows[index]?.depth ?? 0;
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i]!.depth < depth) return rows[i]!.key;
  }
  return null;
}

const places = new WeakMap<
  readonly TreeReorderRow[],
  Map<string, { index: number; depth: number; parent: boolean }>
>();
function placeOf(rows: readonly TreeReorderRow[], key: string) {
  let map = places.get(rows);
  if (!map) {
    map = new Map(
      rows.map((row, index) => [
        row.key,
        { index, depth: row.depth, parent: hasChildren(rows, index) },
      ]),
    );
    places.set(rows, map);
  }
  return map.get(key) ?? { index: -1, depth: 0, parent: false };
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
    canPlace: 'value',
  },
  controlled: ['rows', 'expanded', 'selected'],
  state: (options: BlockOutlineOptions): OutlineState => ({
    rows: options.rows ?? options.defaultRows ?? [],
    expanded: options.expanded ?? options.defaultExpanded ?? [],
    selected: options.selected ?? options.defaultSelected ?? [],
    fixed: options.fixed ?? [],
    hovered: options.hovered ?? null,
    focused: null,
    moving: null,
  }),
  sync: (options) => {
    const next: Partial<OutlineState> = {
      hovered: options.hovered ?? null,
      fixed: options.fixed ?? [],
    };
    if (options.rows !== undefined) next.rows = options.rows;
    if (options.expanded !== undefined) next.expanded = options.expanded;
    if (options.selected !== undefined) next.selected = options.selected;
    return next;
  },
  api: (context) => {
    const { store } = context;
    const change = createChange(context);
    const fixed = (key: string) => store.get().fixed.includes(key);
    const typeahead = createTypeahead();
    const allowed = (key: string, parent: string | null) =>
      context.options().canPlace?.(key, parent) ?? true;
    const blocked = (state: OutlineState) => {
      const draft = state.moving;
      if (!draft) return false;
      const index = draft.rows.findIndex((row) => row.key === draft.key);
      return !allowed(draft.key, parentKey(draft.rows, index));
    };

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
      remember: false,
      preferred: (item) => item.key === store.get().selected[0],
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
      set: (value, details) => {
        if (!allowed(details.key, details.parent)) return false;
        if (!change('rows', value, details)) return false;
        if (details.parent) {
          setOpen(details.parent, true, {
            reason: 'drop',
            event: details.event,
          });
        }
        return true;
      },
      message: (message) => {
        const text = treeReorderMessage(message);
        return message.type === 'move' && blocked(store.get())
          ? `${text} Can't drop here.`
          : text;
      },
    });

    const visible = (state: OutlineState) =>
      visibleRows(tree.rows(state), state.expanded, state.moving?.key ?? null);

    const range = (from: string, to: string) => {
      const keys = visible(store.get()).map((row) => row.key);
      const a = keys.indexOf(from);
      const b = keys.indexOf(to);
      if (a === -1 || b === -1) return [to];
      return keys.slice(Math.min(a, b), Math.max(a, b) + 1);
    };

    const api = {
      roving,
      tree,
      visible,
      blocked,
      fixed,
      hover: (key: string | null) => context.options().onHover?.(key),
      items: () =>
        elements(context, 'row').map((row) => ({
          value: row.key,
          label: labelOf(row.el),
        })),
      select(
        keys: string | string[],
        details: { reason: SelectedReason; event?: Event } = {
          reason: 'imperative',
        },
      ) {
        const next = Array.isArray(keys) ? keys : [keys];
        const current = store.get().selected;
        if (
          next.length === current.length &&
          next.every((k, i) => k === current[i])
        ) {
          return false;
        }
        return change('selected', next, details);
      },
      toggle(key: string, event?: Event) {
        return setOpen(key, !store.get().expanded.includes(key), {
          reason: 'toggle-press',
          event,
        });
      },
      move(key: string, before: string | null, depth: number) {
        return tree.move(key, before, depth);
      },
      press(key: string, event?: MouseEvent) {
        const current = store.get().selected;
        if (event?.shiftKey && current[0]) {
          return api.select(range(current[0], key), {
            reason: 'item-press',
            event,
          });
        }
        if (event?.metaKey || event?.ctrlKey) {
          const next = current.includes(key)
            ? current.filter((k) => k !== key)
            : [...current, key];
          return api.select(next, { reason: 'item-press', event });
        }
        return api.select([key], { reason: 'item-press', event });
      },
      keydown(event: KeyboardEvent, el: HTMLElement, key: string) {
        if (
          !store.get().moving &&
          isTypeaheadKey(event) &&
          (event.key !== ' ' || typeahead.active())
        ) {
          const items = elements(context, 'row');
          const at = typeahead(
            event.key,
            items.map((item) => labelOf(item.el)),
            items.findIndex((item) => item.el === el),
          );
          if (at === -1) return;
          event.preventDefault();
          const target = items[at]!.key;
          roving.focus(target);
          api.select([target], { reason: 'list-navigation', event });
          return;
        }
        if (tree.keydown(event, key)) return;
        const state = store.get();
        const rows = tree.rows(state);
        const { index, depth, parent } = placeOf(rows, key);
        const open = state.expanded.includes(key) || fixed(key);
        if (event.key === 'ArrowRight' && parent && !event.altKey) {
          event.preventDefault();
          if (!open) setOpen(key, true, { reason: 'list-navigation', event });
          else roving.focus(rows[index + 1]!.key);
          return;
        }
        if (event.key === 'ArrowLeft' && !event.altKey) {
          event.preventDefault();
          if (parent && open && !fixed(key)) {
            setOpen(key, false, { reason: 'list-navigation', event });
            return;
          }
          for (let i = index - 1; i >= 0; i--) {
            if (rows[i]!.depth < depth) return roving.focus(rows[i]!.key);
          }
          return;
        }
        if (event.altKey) return;
        const moved = roving.keydown(event, el);
        if (!moved || moved.key === moved.from) return;
        const anchor = state.selected[0] ?? moved.from;
        api.select(moved.shift ? range(anchor, moved.key) : [moved.key], {
          reason: 'list-navigation',
          event,
        });
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
      attrs: (state, { id }) => ({
        'aria-multiselectable': 'true',
        'aria-describedby': `${id}-instructions`,
        'data-moving': state.moving ? '' : undefined,
      }),
    }),
    row: slot<{ value: string }, OutlineRowState>({
      props: { value: 'string' },
      role: 'treeitem',
      focus: 'roving',
      press: ({ api, key }, event) =>
        api.press(key, event as MouseEvent | undefined),
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
        'typeahead',
      ],
      selects: selects({ focused: ({ key }) => [key, null] }),
      state: (state, { key, api }) => {
        const place = placeOf(api.tree.rows(state), key);
        return {
          depth: place.depth,
          parent: place.parent,
          expanded: state.expanded.includes(key),
          selected: state.selected.includes(key),
          moving: api.tree.moving(state, key),
        };
      },
      attrs: (state, part) => {
        const { api, key } = part;
        const { depth, parent } = placeOf(api.tree.rows(state), key);
        const moving = api.tree.moving(state, key);
        return {
          'aria-level': String(depth + 1),
          'aria-selected': String(state.selected.includes(key)),
          'aria-expanded': parent
            ? String(state.expanded.includes(key) || state.fixed.includes(key))
            : undefined,
          tabindex: api.roving.tabIndex(state, part),
          'data-selected': state.selected.includes(key) ? '' : undefined,
          'data-hovered': state.hovered === key ? '' : undefined,
          'data-moving': moving ? '' : undefined,
          'data-dragging': api.tree.dragging(state, key) ? '' : undefined,
          'data-blocked':
            moving && state.moving?.key === key && api.blocked(state)
              ? ''
              : undefined,
          style: css({ '--depth': String(depth) }),
        };
      },
      on: {
        keydown: (event, { el, api, key }) => {
          if (el) api.keydown(event as KeyboardEvent, el, key);
        },
        pointerdown: (event, { api, key }) => {
          const pointer = event as PointerEvent;
          if (pointer.pointerType === 'touch') return;
          if ((pointer.target as Element).closest('button, a, input')) return;
          api.tree.pointerdown(pointer, key);
        },
        pointerenter: (_event, { api, key }) => api.hover(key),
      },
      bind: (el, part) => {
        let selected = part.store.get().selected[0] === part.key;
        const follow = () => {
          const now = part.store.get().selected[0] === part.key;
          if (now && !selected && el.ownerDocument.activeElement !== el) {
            el.scrollIntoView({ block: 'nearest' });
          }
          selected = now;
        };
        const cleanups = [
          part.api.roving.bind(el, part),
          part.api.tree.bind(el, part.key),
          part.store.subscribe(follow),
        ];
        return () => cleanups.forEach((cleanup) => cleanup());
      },
    }),
    toggle: slot<{ value: string }, { expanded: boolean; parent: boolean }>({
      props: { value: { kind: 'string', from: 'row' } },
      state: (state, { key, api }) => ({
        expanded: state.expanded.includes(key),
        parent: placeOf(api.tree.rows(state), key).parent,
      }),
      attrs: (state, { key }) => ({
        'aria-hidden': 'true',
        'data-expanded': state.expanded.includes(key) ? '' : undefined,
      }),
      on: {
        pointerdown: (event) => event.preventDefault(),
        click: (event, { api, key }) => {
          event.stopPropagation();
          api.toggle(key, event);
        },
      },
    }),
    handle: slot<{ value: string }>({
      props: { value: { kind: 'string', from: 'row' } },
      attrs: () => ({
        'aria-hidden': 'true',
        style: css({ 'touch-action': 'none' }),
      }),
      on: {
        pointerdown: (event, { api, key }) => {
          event.stopPropagation();
          api.tree.pointerdown(event as PointerEvent, key);
        },
      },
    }),
    instructions: slot({
      attrs: (_state, { id }) => ({ id: `${id}-instructions`, hidden: '' }),
    }),
  }),
  agent: {
    actions: ['select', 'toggle', 'move'],
    items: (api) => api.items(),
  },
});
