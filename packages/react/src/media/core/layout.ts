/**
 * Pure collection layout: positions every item from the stored asset
 * dimensions, so virtualization, keyboard navigation and marquee hit tests
 * share exact geometry without measuring the DOM.
 */

export type LayoutMode = 'grid' | 'justified' | 'masonry' | 'list';

export type LayoutItem = {
  id: string;
  width?: number | null;
  height?: number | null;
};

/** Content coordinates: `y` grows from the top of the collection. */
export type Rect = { x: number; y: number; width: number; height: number };

export type LayoutRow = {
  index: number;
  top: number;
  height: number;
  /** Item indexes of the row, in reading order. */
  items: number[];
};

export type LayoutOptions = {
  mode?: LayoutMode;
  /** Px between cells and rows. @default 8 */
  gap?: number;
  /** Grid and masonry: smallest cell width. @default 160 */
  minCell?: number;
  /** Grid: cell aspect. @default 'square' */
  aspect?: 'square' | '4:3';
  /** Justified: target row height, clamped to 180-240. @default 200 */
  targetRowHeight?: number;
  /** List: row height, clamped to 48-56. @default 52 */
  listRowHeight?: number;
  /** Mirrors `x` for right-to-left documents. */
  rtl?: boolean;
};

export type CollectionLayout = {
  mode: LayoutMode;
  width: number;
  rows: LayoutRow[];
  /** One rect per item, by item index. */
  rects: Rect[];
  /** The row index of each item. */
  rowOf: number[];
  /** Grid and masonry: lanes; justified: the longest row; list: 1. */
  columns: number;
  totalHeight: number;
  /** Typical row height, for page up and down. */
  rowHeight: number;
  /** Masonry: the lane of each item. */
  laneOf?: number[];
};

const FALLBACK_ASPECT = 4 / 3;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function aspectOf(item: LayoutItem): number {
  const { width, height } = item;
  return width && height && width > 0 && height > 0
    ? width / height
    : FALLBACK_ASPECT;
}

/** `floor((width + gap) / (minCell + gap))`, at least 1. */
export function columnCount(width: number, minCell: number, gap: number) {
  return Math.max(1, Math.floor((width + gap) / (minCell + gap)));
}

/**
 * Lays out `items` in a viewport `width` px wide. Grid and list cells have
 * fixed sizes; justified rows scale each item to fill the width at about
 * the target height (the last row keeps the target); masonry places each
 * item in the shortest lane.
 */
export function layout(
  viewport: { width: number },
  items: readonly LayoutItem[],
  options: LayoutOptions = {},
): CollectionLayout {
  const mode = options.mode ?? 'grid';
  const gap = Math.max(0, options.gap ?? 8);
  const width = Math.max(0, viewport.width);
  const rects: Rect[] = [];
  const rows: LayoutRow[] = [];
  const rowOf: number[] = [];
  let columns = 1;
  let rowHeight = 0;
  let laneOf: number[] | undefined;

  const pushRow = (indexes: number[], top: number, height: number) => {
    const index = rows.length;
    rows.push({ index, top, height, items: indexes });
    for (const i of indexes) rowOf[i] = index;
  };

  if (mode === 'list') {
    rowHeight = clamp(options.listRowHeight ?? 52, 48, 56);
    items.forEach((_, i) => {
      const top = i * (rowHeight + gap);
      rects.push({ x: 0, y: top, width, height: rowHeight });
      pushRow([i], top, rowHeight);
    });
  } else if (mode === 'grid') {
    const minCell = Math.max(1, options.minCell ?? 160);
    columns = columnCount(width, minCell, gap);
    const cell = Math.max(0, (width - gap * (columns - 1)) / columns);
    rowHeight = options.aspect === '4:3' ? (cell * 3) / 4 : cell;
    for (let start = 0; start < items.length; start += columns) {
      const top = rows.length * (rowHeight + gap);
      const indexes: number[] = [];
      for (let i = start; i < Math.min(start + columns, items.length); i++) {
        rects[i] = {
          x: (i - start) * (cell + gap),
          y: top,
          width: cell,
          height: rowHeight,
        };
        indexes.push(i);
      }
      pushRow(indexes, top, rowHeight);
    }
  } else if (mode === 'justified') {
    const target = clamp(options.targetRowHeight ?? 200, 180, 240);
    rowHeight = target;
    let top = 0;
    let pending: number[] = [];
    let aspectSum = 0;
    const place = (indexes: number[], height: number) => {
      let x = 0;
      for (const i of indexes) {
        const w = aspectOf(items[i]) * height;
        rects[i] = { x, y: top, width: w, height };
        x += w + gap;
      }
      pushRow(indexes, top, height);
      columns = Math.max(columns, indexes.length);
      top += height + gap;
    };
    items.forEach((item, i) => {
      pending.push(i);
      aspectSum += aspectOf(item);
      const height = (width - gap * (pending.length - 1)) / aspectSum;
      if (height <= target) {
        place(pending, Math.max(height, 0));
        pending = [];
        aspectSum = 0;
      }
    });
    if (pending.length > 0) place(pending, target);
  } else {
    const minCell = Math.max(1, options.minCell ?? 160);
    columns = columnCount(width, minCell, gap);
    const lane = Math.max(0, (width - gap * (columns - 1)) / columns);
    const bottoms = Array.from({ length: columns }, () => 0);
    laneOf = [];
    let heightSum = 0;
    items.forEach((item, i) => {
      let target = 0;
      for (let l = 1; l < columns; l++) {
        if (bottoms[l] < bottoms[target]) target = l;
      }
      const height = lane / aspectOf(item);
      rects[i] = {
        x: target * (lane + gap),
        y: bottoms[target],
        width: lane,
        height,
      };
      bottoms[target] += height + gap;
      laneOf![i] = target;
      heightSum += height;
    });
    rowHeight = items.length > 0 ? heightSum / items.length : lane;
    for (let start = 0; start < items.length; start += columns) {
      const indexes: number[] = [];
      let top = Infinity;
      let bottom = 0;
      for (let i = start; i < Math.min(start + columns, items.length); i++) {
        indexes.push(i);
        top = Math.min(top, rects[i].y);
        bottom = Math.max(bottom, rects[i].y + rects[i].height);
      }
      pushRow(indexes, top, bottom - top);
    }
  }

  if (options.rtl) {
    for (const rect of rects) rect.x = width - rect.x - rect.width;
  }

  let totalHeight = 0;
  for (const rect of rects) {
    totalHeight = Math.max(totalHeight, rect.y + rect.height);
  }

  const result: CollectionLayout = {
    mode,
    width,
    rows,
    rects,
    rowOf,
    columns,
    totalHeight,
    rowHeight,
  };
  if (laneOf) result.laneOf = laneOf;
  return result;
}

export type NavigationKey =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'rowStart'
  | 'rowEnd'
  | 'first'
  | 'last'
  | 'pageUp'
  | 'pageDown';

/** The navigation key of a `KeyboardEvent.key`, with `ctrlOrMeta` for `Home`/`End`. */
export function navigationKeyOf(
  key: string,
  ctrlOrMeta = false,
): NavigationKey | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'Home':
      return ctrlOrMeta ? 'first' : 'rowStart';
    case 'End':
      return ctrlOrMeta ? 'last' : 'rowEnd';
    case 'PageUp':
      return 'pageUp';
    case 'PageDown':
      return 'pageDown';
    default:
      return null;
  }
}

function centerX(rect: Rect) {
  return rect.x + rect.width / 2;
}

/** The item of `row` whose horizontal center is closest to `x`. */
function closestInRow(layout: CollectionLayout, row: LayoutRow, x: number) {
  let best = row.items[0];
  let distance = Infinity;
  for (const i of row.items) {
    const d = Math.abs(centerX(layout.rects[i]) - x);
    if (d < distance) {
      best = i;
      distance = d;
    }
  }
  return best;
}

function vertical(layout: CollectionLayout, index: number, step: 1 | -1) {
  const count = layout.rects.length;
  if (layout.mode === 'grid' || layout.mode === 'list') {
    const next = index + step * layout.columns;
    if (next < 0) return index;
    if (next >= count) {
      // A row below exists but is shorter: clamp to its last item.
      return layout.rowOf[index] < layout.rows.length - 1 ? count - 1 : index;
    }
    return next;
  }
  if (layout.mode === 'masonry' && layout.laneOf) {
    const lane = layout.laneOf[index];
    for (let i = index + step; i >= 0 && i < count; i += step) {
      if (layout.laneOf[i] === lane) return i;
    }
    return index;
  }
  const row = layout.rows[layout.rowOf[index] + step];
  return row ? closestInRow(layout, row, centerX(layout.rects[index])) : index;
}

/**
 * The item index a key moves the focus to from `index`; never outside the
 * items. Left and right follow reading order across rows (mirrored with
 * `rtl`); up and down keep the column (grid, list), the lane (masonry) or
 * the closest horizontal center (justified); page keys move by
 * `floor(viewportHeight / rowHeight)` rows.
 */
export function navigate(
  layout: CollectionLayout,
  index: number,
  key: NavigationKey,
  options: { rtl?: boolean; viewportHeight?: number } = {},
): number {
  const count = layout.rects.length;
  if (count === 0) return -1;
  const from = clamp(index, 0, count - 1);
  const forward = options.rtl ? 'left' : 'right';
  switch (key) {
    case 'left':
    case 'right':
      return clamp(from + (key === forward ? 1 : -1), 0, count - 1);
    case 'up':
      return vertical(layout, from, -1);
    case 'down':
      return vertical(layout, from, 1);
    case 'first':
      return 0;
    case 'last':
      return count - 1;
    case 'rowStart':
      return layout.rows[layout.rowOf[from]].items[0];
    case 'rowEnd': {
      const items = layout.rows[layout.rowOf[from]].items;
      return items[items.length - 1];
    }
    case 'pageUp':
    case 'pageDown': {
      const perPage = Math.max(
        1,
        Math.floor(
          (options.viewportHeight ?? layout.rowHeight) /
            Math.max(layout.rowHeight, 1),
        ),
      );
      let at = from;
      for (let i = 0; i < perPage; i++) {
        const next = vertical(layout, at, key === 'pageUp' ? -1 : 1);
        if (next === at) break;
        at = next;
      }
      return at;
    }
  }
}

/**
 * The rows to mount for a scroll position: those intersecting the viewport
 * plus `overscan` rows on each side, as an inclusive range. `[0, -1]` when
 * nothing is laid out.
 */
export function visibleRows(
  layout: CollectionLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan = 2,
): [number, number] {
  const { rows } = layout;
  if (rows.length === 0) return [0, -1];
  const bottom = scrollTop + viewportHeight;
  let first = -1;
  let last = -1;
  for (const row of rows) {
    if (row.top + row.height >= scrollTop && row.top <= bottom) {
      if (first === -1) first = row.index;
      last = row.index;
    }
  }
  if (first === -1) {
    // Scrolled past the content (a shrinking list): keep the tail mounted.
    first = last = rows[rows.length - 1].top < scrollTop ? rows.length - 1 : 0;
  }
  return [
    Math.max(0, first - overscan),
    Math.min(rows.length - 1, last + overscan),
  ];
}

export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Item indexes whose rect intersects `rect`, mounted or not. */
export function itemsInRect(layout: CollectionLayout, rect: Rect): number[] {
  const out: number[] = [];
  layout.rects.forEach((item, i) => {
    if (intersects(item, rect)) out.push(i);
  });
  return out;
}
