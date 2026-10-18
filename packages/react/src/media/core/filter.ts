/**
 * The serializable filter of a media collection: it drives the list query,
 * the URL and shareable saved views. `encodeFilter` and `parseFilter` round
 * trip every valid state; `parseFilter` drops what it cannot validate.
 */

export type MediaKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'other';
export type AssetProvenance =
  | 'unknown'
  | 'captured'
  | 'ai_generated'
  | 'ai_edited';
export type AssetVisibility = 'private' | 'public';
export type ProcessingState = 'pending' | 'ready' | 'failed';
export type Orientation = 'landscape' | 'portrait' | 'square';
export type FilterSort =
  | 'created_desc'
  | 'created_asc'
  | 'name_asc'
  | 'size_desc'
  | 'updated_desc'
  | 'width_desc';

export type FilterState = {
  q?: string;
  kinds?: MediaKind[];
  /** Exact types or prefixes such as `image/*`. */
  mime?: string[];
  /** `null` is the root level; absent means every folder. */
  folderId?: string | null;
  /** With `folderId`: include the assets of every subfolder. */
  recursive?: boolean;
  /** Only assets without a folder. */
  unfiled?: boolean;
  provenance?: AssetProvenance[];
  visibility?: AssetVisibility[];
  processingState?: ProcessingState[];
  uploadedBy?: string[];
  /** ISO dates (`YYYY-MM-DD`) or timestamps, inclusive. */
  createdFrom?: string;
  createdTo?: string;
  /** Bytes. */
  sizeMin?: number;
  sizeMax?: number;
  widthMin?: number;
  heightMin?: number;
  orientation?: Orientation;
  usage?: 'used' | 'unused';
  usageScope?: 'published' | 'live';
  missingAlt?: boolean;
  expiringWithinDays?: number;
  archived?: boolean;
  sort: FilterSort;
};

export const MEDIA_KINDS: readonly MediaKind[] = [
  'image',
  'video',
  'audio',
  'document',
  'archive',
  'other',
];
export const ASSET_PROVENANCES: readonly AssetProvenance[] = [
  'unknown',
  'captured',
  'ai_generated',
  'ai_edited',
];
export const FILTER_SORTS: readonly FilterSort[] = [
  'created_desc',
  'created_asc',
  'name_asc',
  'size_desc',
  'updated_desc',
  'width_desc',
];
const VISIBILITIES: readonly AssetVisibility[] = ['private', 'public'];
const PROCESSING_STATES: readonly ProcessingState[] = [
  'pending',
  'ready',
  'failed',
];
const ORIENTATIONS: readonly Orientation[] = [
  'landscape',
  'portrait',
  'square',
];

export const DEFAULT_FILTER: FilterState = { sort: 'created_desc' };

/** The query-string key of the root folder (`folderId: null`). */
export const ROOT_FOLDER_PARAM = 'root';

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

/** `5242880` as `5mb`; whole units only, bytes otherwise. */
export function formatSizeParam(bytes: number): string {
  for (const unit of ['gb', 'mb', 'kb'] as const) {
    const factor = SIZE_UNITS[unit];
    if (bytes > 0 && bytes % factor === 0) return `${bytes / factor}${unit}`;
  }
  return String(bytes);
}

/** `5mb`, `1.5gb`, `300kb` or plain bytes; `undefined` when invalid. */
export function parseSizeParam(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/i.exec(value.trim());
  if (!match) return undefined;
  const bytes = Number(match[1]) * SIZE_UNITS[(match[2] ?? 'b').toLowerCase()];
  return Number.isFinite(bytes) ? Math.round(bytes) : undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?$/;

function list<T extends string>(
  value: string | null,
  allowed?: readonly T[],
): T[] | undefined {
  if (!value) return undefined;
  const items = [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  const valid = allowed
    ? items.filter((item): item is T =>
        (allowed as readonly string[]).includes(item),
      )
    : (items as T[]);
  return valid.length > 0 ? valid : undefined;
}

function positiveInt(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Drops empty values and impossible combinations, so equal filters have
 * one shape: no empty strings or lists, `recursive` only with a folder,
 * `usageScope` only with `usage`, `unfiled` and `folderId` exclusive.
 */
export function normalizeFilter(filter: FilterState): FilterState {
  const out: FilterState = { sort: filter.sort };
  const q = filter.q?.trim();
  if (q) out.q = q;
  const lists = [
    'kinds',
    'mime',
    'provenance',
    'visibility',
    'processingState',
    'uploadedBy',
  ] as const;
  for (const key of lists) {
    const value = filter[key];
    if (value && value.length > 0) {
      Object.assign(out, { [key]: [...new Set<string>(value)] });
    }
  }
  if (filter.unfiled) out.unfiled = true;
  else if (filter.folderId !== undefined) {
    out.folderId = filter.folderId;
    if (filter.recursive && filter.folderId !== null) out.recursive = true;
  }
  for (const key of ['createdFrom', 'createdTo'] as const) {
    if (filter[key]) out[key] = filter[key];
  }
  for (const key of [
    'sizeMin',
    'sizeMax',
    'widthMin',
    'heightMin',
    'expiringWithinDays',
  ] as const) {
    const value = filter[key];
    if (value !== undefined && Number.isFinite(value) && value >= 0) {
      out[key] = value;
    }
  }
  if (filter.orientation) out.orientation = filter.orientation;
  if (filter.usage) {
    out.usage = filter.usage;
    if (filter.usageScope) out.usageScope = filter.usageScope;
  }
  if (filter.missingAlt) out.missingAlt = true;
  if (filter.archived) out.archived = true;
  return out;
}

/**
 * The filter as a query string with short keys (`q`, `type=image,video`,
 * `folder`, `from`, `to`, `size=0-5mb`, `usage=unused`, ...), without the
 * leading `?`. The default sort is omitted.
 */
export function encodeFilter(filter: FilterState): string {
  const f = normalizeFilter(filter);
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.kinds) params.set('type', f.kinds.join(','));
  if (f.mime) params.set('mime', f.mime.join(','));
  if (f.folderId !== undefined) {
    params.set('folder', f.folderId ?? ROOT_FOLDER_PARAM);
  }
  if (f.recursive) params.set('sub', '1');
  if (f.unfiled) params.set('unfiled', '1');
  if (f.provenance) params.set('prov', f.provenance.join(','));
  if (f.visibility) params.set('vis', f.visibility.join(','));
  if (f.processingState) params.set('state', f.processingState.join(','));
  if (f.uploadedBy) params.set('by', f.uploadedBy.join(','));
  if (f.createdFrom) params.set('from', f.createdFrom);
  if (f.createdTo) params.set('to', f.createdTo);
  if (f.sizeMin !== undefined || f.sizeMax !== undefined) {
    params.set(
      'size',
      `${f.sizeMin === undefined ? '' : formatSizeParam(f.sizeMin)}-${
        f.sizeMax === undefined ? '' : formatSizeParam(f.sizeMax)
      }`,
    );
  }
  if (f.widthMin !== undefined) params.set('w', String(f.widthMin));
  if (f.heightMin !== undefined) params.set('h', String(f.heightMin));
  if (f.orientation) params.set('orient', f.orientation);
  if (f.usage) params.set('usage', f.usage);
  if (f.usageScope) params.set('scope', f.usageScope);
  if (f.missingAlt) params.set('alt', 'missing');
  if (f.expiringWithinDays !== undefined) {
    params.set('expiring', String(f.expiringWithinDays));
  }
  if (f.archived) params.set('archived', '1');
  if (f.sort !== DEFAULT_FILTER.sort) params.set('sort', f.sort);
  return params.toString();
}

/** Reads a query string (with or without `?`); unknown keys and invalid values are ignored. */
export function parseFilter(
  search: string | URLSearchParams,
  base: FilterState = DEFAULT_FILTER,
): FilterState {
  const params =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;
  const f: FilterState = {
    sort: oneOf(params.get('sort'), FILTER_SORTS) ?? base.sort,
  };
  const q = params.get('q');
  if (q) f.q = q;
  f.kinds = list(params.get('type'), MEDIA_KINDS);
  f.mime = list(params.get('mime'))?.filter((m) =>
    /^[a-z0-9.+-]+\/(?:\*|[a-z0-9.+-]+)$/i.test(m),
  );
  const folder = params.get('folder');
  if (folder !== null && folder !== '') {
    f.folderId = folder === ROOT_FOLDER_PARAM ? null : folder;
  }
  if (params.get('sub') === '1') f.recursive = true;
  if (params.get('unfiled') === '1') f.unfiled = true;
  f.provenance = list(params.get('prov'), ASSET_PROVENANCES);
  f.visibility = list(params.get('vis'), VISIBILITIES);
  f.processingState = list(params.get('state'), PROCESSING_STATES);
  f.uploadedBy = list(params.get('by'));
  const from = params.get('from');
  if (from && DATE.test(from)) f.createdFrom = from;
  const to = params.get('to');
  if (to && DATE.test(to)) f.createdTo = to;
  const size = params.get('size');
  if (size?.includes('-')) {
    const [min, max] = size.split('-', 2);
    if (min) f.sizeMin = parseSizeParam(min);
    if (max) f.sizeMax = parseSizeParam(max);
  }
  f.widthMin = positiveInt(params.get('w'));
  f.heightMin = positiveInt(params.get('h'));
  f.orientation = oneOf(params.get('orient'), ORIENTATIONS);
  f.usage = oneOf(params.get('usage'), ['used', 'unused'] as const);
  f.usageScope = oneOf(params.get('scope'), ['published', 'live'] as const);
  if (params.get('alt') === 'missing') f.missingAlt = true;
  f.expiringWithinDays = positiveInt(params.get('expiring'));
  if (params.get('archived') === '1') f.archived = true;
  return normalizeFilter(f);
}

/** Two filters select the same assets in the same order. */
export function filtersEqual(a: FilterState, b: FilterState): boolean {
  return encodeFilter(a) === encodeFilter(b);
}

/** How many filters beyond folder and sort are active (for a "Filters (3)" badge). */
export function activeFilterCount(filter: FilterState): number {
  const f = normalizeFilter(filter);
  const ignored = new Set(['sort', 'folderId', 'recursive', 'unfiled', 'q']);
  return Object.keys(f).filter((key) => !ignored.has(key)).length;
}

/** `replace` while typing, `push` for discrete changes (a chip, a folder). */
export type FilterWriteMode = 'replace' | 'push';

export type FilterUrlAdapter = {
  read(): FilterState;
  write(filter: FilterState, mode: FilterWriteMode): void;
  /** Called on back and forward navigation; returns the unsubscribe. */
  subscribe?(listener: () => void): () => void;
};

/** Keeps the filter in memory only (the picker leaves the URL alone). */
export function createMemoryFilterAdapter(
  initial: FilterState = DEFAULT_FILTER,
): FilterUrlAdapter {
  let current = normalizeFilter(initial);
  return {
    read: () => current,
    write(filter) {
      current = normalizeFilter(filter);
    },
  };
}

type HistoryWindow = {
  location: { search: string; pathname: string; hash: string };
  history: {
    state: unknown;
    pushState(data: unknown, unused: string, url?: string): void;
    replaceState(data: unknown, unused: string, url?: string): void;
  };
  addEventListener(type: 'popstate', listener: () => void): void;
  removeEventListener(type: 'popstate', listener: () => void): void;
};

/**
 * Mirrors the filter in `location.search` with `history.replaceState` or
 * `pushState`, keeping query parameters the filter does not own. `prefix`
 * namespaces the keys (`m.q`, `m.type`, ...) when the page has its own.
 */
export function createHistoryFilterAdapter(
  options: { prefix?: string; window?: HistoryWindow } = {},
): FilterUrlAdapter {
  const prefix = options.prefix ?? '';
  const win: HistoryWindow | undefined =
    options.window ?? (typeof window === 'undefined' ? undefined : window);
  const own = (key: string) => key.startsWith(prefix);
  const read = (): FilterState => {
    if (!win) return DEFAULT_FILTER;
    const all = new URLSearchParams(win.location.search);
    const mine = new URLSearchParams();
    for (const [key, value] of all) {
      if (own(key)) mine.set(key.slice(prefix.length), value);
    }
    return parseFilter(mine);
  };
  return {
    read,
    write(filter, mode) {
      if (!win) return;
      const all = new URLSearchParams(win.location.search);
      for (const key of Array.from(all.keys())) {
        if (own(key) && (prefix || FILTER_KEYS.has(key))) all.delete(key);
      }
      for (const [key, value] of new URLSearchParams(encodeFilter(filter))) {
        all.set(`${prefix}${key}`, value);
      }
      const query = all.toString();
      const url = `${win.location.pathname}${query ? `?${query}` : ''}${win.location.hash}`;
      if (mode === 'push') win.history.pushState(win.history.state, '', url);
      else win.history.replaceState(win.history.state, '', url);
    },
    subscribe(listener) {
      if (!win) return () => {};
      win.addEventListener('popstate', listener);
      return () => win.removeEventListener('popstate', listener);
    },
  };
}

const FILTER_KEYS = new Set([
  'q',
  'type',
  'mime',
  'folder',
  'sub',
  'unfiled',
  'prov',
  'vis',
  'state',
  'by',
  'from',
  'to',
  'size',
  'w',
  'h',
  'orient',
  'usage',
  'scope',
  'alt',
  'expiring',
  'archived',
  'sort',
]);

/** The `listAssets` sort of a filter sort. */
export function sortOfFilter(sort: FilterSort): {
  sortBy: 'createdAt' | 'originalName' | 'size' | 'updatedAt' | 'width';
  sortDirection: 'asc' | 'desc';
} {
  switch (sort) {
    case 'created_asc':
      return { sortBy: 'createdAt', sortDirection: 'asc' };
    case 'name_asc':
      return { sortBy: 'originalName', sortDirection: 'asc' };
    case 'size_desc':
      return { sortBy: 'size', sortDirection: 'desc' };
    case 'updated_desc':
      return { sortBy: 'updatedAt', sortDirection: 'desc' };
    case 'width_desc':
      return { sortBy: 'width', sortDirection: 'desc' };
    case 'created_desc':
      return { sortBy: 'createdAt', sortDirection: 'desc' };
  }
}

/**
 * The filter as `listAssets` parameters (lists comma separated). The sort
 * is left out (see `sortOfFilter`); `processingState` has no server column
 * and is not sent.
 */
export function filterToQuery(
  filter: FilterState,
): Record<string, string | number | boolean> {
  const f = normalizeFilter(filter);
  const query: Record<string, string | number | boolean> = {};
  if (f.q) query.q = f.q;
  if (f.kinds) query.kinds = f.kinds.join(',');
  if (f.mime) query.mime = f.mime.join(',');
  if (f.unfiled || f.folderId === null) query.unfiled = true;
  else if (f.folderId !== undefined) {
    query.folderId = f.folderId;
    if (f.recursive) query.recursive = true;
  }
  if (f.provenance) query.provenance = f.provenance.join(',');
  if (f.visibility) query.visibility = f.visibility.join(',');
  if (f.uploadedBy) query.uploadedBy = f.uploadedBy.join(',');
  if (f.createdFrom) query.createdFrom = f.createdFrom;
  if (f.createdTo) query.createdTo = f.createdTo;
  for (const key of [
    'sizeMin',
    'sizeMax',
    'widthMin',
    'heightMin',
    'expiringWithinDays',
  ] as const) {
    if (f[key] !== undefined) query[key] = f[key];
  }
  if (f.orientation) query.orientation = f.orientation;
  if (f.usage) {
    query.usage = f.usage;
    if (f.usageScope) query.usageScope = f.usageScope;
  }
  if (f.missingAlt) query.missingAlt = true;
  if (f.archived) query.archived = true;
  return query;
}

/** Whether only folder and sort are set (newly uploaded assets can be inserted locally). */
export function isPlainFolderView(filter: FilterState): boolean {
  const f = normalizeFilter(filter);
  return Object.keys(f).every((key) =>
    ['sort', 'folderId', 'unfiled'].includes(key),
  );
}
