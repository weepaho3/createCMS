import type { MediaErrorCode } from './core/errors';
import type { MediaKind } from './core/filter';
import type { MediaUploadEntry } from './core/types';

export type { MediaErrorCode };

export type MediaTypeLabel = 'image' | 'video' | 'audio' | 'document' | 'other';

/** Locale-bound formatters passed to every message function. */
export type MediaFormatters = {
  locale: string | undefined;
  /** Bytes in the largest unit below 1024 (byte, kilobyte, megabyte, gigabyte). */
  bytes: (value: number) => string;
  number: (value: number) => string;
  /** A 0-1 fraction as a percentage. */
  percent: (fraction: number) => string;
  date: (value: Date | string | number) => string;
  /** A remaining duration, e.g. "in 2 minutes". */
  eta: (seconds: number) => string;
  /** The `Intl.PluralRules` category of `count`. */
  plural: (count: number) => Intl.LDMLPluralRule;
  /** True on macOS and iOS, where shortcuts use `⌘`. */
  apple: boolean;
};

/** A message with parameters, formatted with the active locale. */
export type MediaMessageFn<P> = (params: P, format: MediaFormatters) => string;

export type MediaMessages = {
  folder: {
    path: string;
    root: string;
    create: string;
    createTitle: string;
    createDescription: string;
    name: string;
    deleteConfirm: MediaMessageFn<{
      name: string;
      folders: number;
      assets: number;
      inUse: number;
      pages: number;
    }>;
    /** Accessible name of `Folder.Tree`. */
    tree: string;
    /** The default name of a folder created inline. */
    defaultName: string;
    rename: string;
    delete: string;
    deleteTitle: string;
    deleteMode: { moveToParent: string; archiveContents: string };
    /** Shown when used assets are affected: the user types the folder name. */
    typeToConfirm: MediaMessageFn<{ name: string }>;
    created: MediaMessageFn<{ name: string }>;
    renamed: MediaMessageFn<{ name: string }>;
    deleted: MediaMessageFn<{ name: string }>;
    /** The breadcrumb overflow menu button. */
    overflow: string;
    count: MediaMessageFn<{ count: number }>;
  };
  grid: {
    /** Accessible name of `Media.Grid`. */
    label: string;
    /** The facts of an asset, read after its name. */
    describe: MediaMessageFn<{
      type: string;
      width: number | null;
      height: number | null;
      size: number;
    }>;
    uploading: MediaMessageFn<{ name: string; percent: number }>;
    loadingMore: string;
    /** After a page was appended. */
    loadedMore: MediaMessageFn<{
      count: number;
      loaded: number;
      total: number | null;
    }>;
  };
  empty: Record<
    'folder-empty' | 'no-results' | 'error' | 'no-permission',
    string
  >;
  filter: {
    label: string;
    clear: string;
    remove: MediaMessageFn<{ label: string }>;
    kind: Record<MediaKind, string>;
    provenance: Record<
      'unknown' | 'captured' | 'ai_generated' | 'ai_edited',
      string
    >;
    usage: Record<'used' | 'unused', string>;
    missingAlt: string;
    /** The scope hint of a search inside a folder. */
    searchIn: MediaMessageFn<{ folder: string }>;
    allFolders: string;
    chip: MediaMessageFn<{ label: string; count: number | null }>;
  };
  intake: {
    overlay: string;
    files: string;
    folder: string;
    paste: string;
    reading: MediaMessageFn<{ count: number }>;
    recreate: MediaMessageFn<{ folders: number; files: number }>;
    flatten: string;
    skippedSystem: MediaMessageFn<{ count: number }>;
    rejected: MediaMessageFn<{ count: number }>;
    truncated: MediaMessageFn<{ count: number }>;
  };
  move: {
    title: string;
    description: string;
    confirm: string;
    /** The drag preview's counter. */
    dragCount: MediaMessageFn<{ count: number }>;
    insert: string;
  };
  search: { label: string };
  sort: {
    label: string;
    newest: string;
    oldest: string;
    nameAsc: string;
    nameDesc: string;
    sizeAsc: string;
    sizeDesc: string;
  };
  action: {
    create: string;
    cancel: string;
    retry: string;
    dismiss: string;
    loadMore: string;
    clearSelection: string;
    move: string;
    moveTitle: string;
    moveDescription: string;
    makePublic: string;
    makePrivate: string;
    archive: string;
    archiveTitle: string;
    archiveDescription: string;
  };
  visibility: {
    private: string;
    public: string;
    /** Shown next to the public/private actions. */
    hint: string;
  };
  dropzone: { idle: string; active: string; uploading: string };
  list: { empty: string; loadError: string; mutationError: string };
  selection: {
    count: MediaMessageFn<{ count: number }>;
    all: MediaMessageFn<{ count: number }>;
    cleared: string;
    selectAllMatching: MediaMessageFn<{ count: number }>;
    hidden: MediaMessageFn<{ count: number }>;
    /** Accessible name of an item's checkbox. */
    item: MediaMessageFn<{ name: string }>;
  };
  bulk: {
    skipped: MediaMessageFn<{ count: number }>;
    /** Accessible name of `Bulk.Bar`. */
    bar: string;
    action: Record<
      | 'move'
      | 'makePublic'
      | 'makePrivate'
      | 'setProvenance'
      | 'download'
      | 'archive'
      | 'restore',
      string
    >;
    /** Why an action is disabled, by `data-disabled-reason`. */
    disabled: Record<string, string>;
    moved: MediaMessageFn<{ count: number; folder: string }>;
    archived: MediaMessageFn<{ count: number }>;
    restored: MediaMessageFn<{ count: number }>;
    visibility: MediaMessageFn<{ count: number; status: 'private' | 'public' }>;
    undo: string;
    undone: string;
    archiveInUse: MediaMessageFn<{ count: number }>;
    archiveAnyway: string;
  };
  type: Record<MediaTypeLabel, string>;
  upload: {
    title: string;
    all: string;
    abort: string;
    clear: string;
    status: Record<MediaUploadEntry['status'], string>;
    progress: MediaMessageFn<{ done: number; total: number; percent: number }>;
    eta: MediaMessageFn<{ seconds: number }>;
    /** `reason` is the translated `error.*` message for the entry's code. */
    failed: MediaMessageFn<{ reason: string }>;
    started: MediaMessageFn<{ count: number }>;
    finished: MediaMessageFn<{ done: number; total: number; failed: number }>;
    entryDone: MediaMessageFn<{ name: string }>;
    entryFailed: MediaMessageFn<{ name: string; reason: string }>;
    entryCancelled: MediaMessageFn<{ name: string }>;
  };
  image: {
    /** Labels `useAssetImage` returns as `provenanceLabel`. */
    provenance: Record<'ai_generated' | 'ai_edited', string>;
  };
  usage: {
    title: string;
    count: MediaMessageFn<{ roots: number }>;
    /** Roots outside the caller's scope. */
    hiddenRoots: MediaMessageFn<{ count: number }>;
    scopeLabel: string;
    scope: Record<'live' | 'published' | 'history', string>;
    missingAlt: string;
    empty: string;
    loadMore: string;
  };
  picker: {
    title: string;
    choose: string;
    select: string;
    disabled: {
      dimensions: MediaMessageFn<{ minWidth: number; minHeight: number }>;
    };
  };
  /** A keyboard shortcut label for `key` with the platform modifier. */
  shortcut: MediaMessageFn<{ key: string }>;
  error: Record<MediaErrorCode, string> & {
    unknown: string;
    size: MediaMessageFn<{ max: number }>;
    type: MediaMessageFn<{ accepted: string }>;
  };
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/** A partial catalog; missing keys fall back to the defaults. */
export type MediaMessagesInput = DeepPartial<MediaMessages>;

function pluralize(
  count: number,
  format: MediaFormatters,
  one: string,
  other: string,
): string {
  return format.plural(count) === 'one' ? one : other;
}

/** The English catalog every part falls back to. */
export const defaultMediaMessages: MediaMessages = {
  folder: {
    path: 'Folder path',
    root: 'Library',
    create: 'New folder',
    createTitle: 'Create folder',
    createDescription: 'The folder is created inside the current folder.',
    name: 'Folder name',
    deleteConfirm: ({ name, folders, assets, inUse, pages }, format) => {
      const parts = [
        `Delete "${name}"?`,
        `It contains ${format.number(folders)} ${pluralize(folders, format, 'folder', 'folders')} and ${format.number(assets)} ${pluralize(assets, format, 'file', 'files')}.`,
      ];
      if (inUse > 0) {
        parts.push(
          `${format.number(inUse)} ${pluralize(inUse, format, 'file is', 'files are')} used on ${format.number(pages)} ${pluralize(pages, format, 'page', 'pages')}.`,
        );
      }
      return parts.join(' ');
    },
    tree: 'Folders',
    defaultName: 'New folder',
    rename: 'Rename',
    delete: 'Delete folder',
    deleteTitle: 'Delete folder?',
    deleteMode: {
      moveToParent: 'Move its contents to the parent folder',
      archiveContents: 'Archive its contents',
    },
    typeToConfirm: ({ name }) => `Type "${name}" to confirm`,
    created: ({ name }) => `Folder created: ${name}`,
    renamed: ({ name }) => `Folder renamed: ${name}`,
    deleted: ({ name }) => `Folder deleted: ${name}`,
    overflow: 'Show more folders',
    count: ({ count }, format) =>
      `${format.number(count)} ${pluralize(count, format, 'file', 'files')}`,
  },
  grid: {
    label: 'Assets',
    describe: ({ type, width, height, size }, format) =>
      [
        type,
        width && height
          ? `${format.number(width)} by ${format.number(height)} pixels`
          : null,
        format.bytes(size),
      ]
        .filter(Boolean)
        .join(', '),
    uploading: ({ name, percent }, format) =>
      `${name}, uploading ${format.percent(percent / 100)}`,
    loadingMore: 'Loading more assets…',
    loadedMore: ({ count, loaded, total }, format) =>
      total === null
        ? `${format.number(count)} more assets loaded`
        : `${format.number(count)} more assets loaded, ${format.number(loaded)} of ${format.number(total)}`,
  },
  empty: {
    'folder-empty': 'This folder is empty.',
    'no-results': 'No assets match the filters.',
    error: 'Could not load assets.',
    'no-permission': 'You do not have access to these assets.',
  },
  filter: {
    label: 'Filters',
    clear: 'Clear filters',
    remove: ({ label }) => `Remove filter ${label}`,
    kind: {
      image: 'Images',
      video: 'Videos',
      audio: 'Audio',
      document: 'Documents',
      archive: 'Archives',
      other: 'Other files',
    },
    provenance: {
      unknown: 'Unknown origin',
      captured: 'Captured',
      ai_generated: 'AI-generated',
      ai_edited: 'AI-edited',
    },
    usage: { used: 'In use', unused: 'Not in use' },
    missingAlt: 'Missing alt text',
    searchIn: ({ folder }) => `Searching in ${folder}`,
    allFolders: 'All folders',
    chip: ({ label, count }, format) =>
      count === null ? label : `${label} (${format.number(count)})`,
  },
  intake: {
    overlay: 'Drop files to upload',
    files: 'Upload files',
    folder: 'Upload folder',
    paste: 'Paste from clipboard',
    reading: ({ count }, format) =>
      `Reading folder… ${format.number(count)} ${pluralize(count, format, 'file', 'files')}`,
    recreate: ({ folders, files }, format) =>
      `Recreate the folder structure (${format.number(folders)} ${pluralize(folders, format, 'folder', 'folders')}, ${format.number(files)} ${pluralize(files, format, 'file', 'files')})`,
    flatten: 'Put everything in the current folder',
    skippedSystem: ({ count }, format) =>
      `${format.number(count)} system ${pluralize(count, format, 'file was', 'files were')} skipped`,
    rejected: ({ count }, format) =>
      `${format.number(count)} ${pluralize(count, format, 'file was', 'files were')} rejected`,
    truncated: ({ count }, format) =>
      `Only the first ${format.number(count)} files were read`,
  },
  move: {
    title: 'Move to',
    description: 'Choose the destination folder.',
    confirm: 'Move here',
    dragCount: ({ count }, format) =>
      `${format.number(count)} ${pluralize(count, format, 'item', 'items')}`,
    insert: 'Insert into editor',
  },
  search: { label: 'Search assets' },
  sort: {
    label: 'Sort',
    newest: 'Newest first',
    oldest: 'Oldest first',
    nameAsc: 'Name (A-Z)',
    nameDesc: 'Name (Z-A)',
    sizeAsc: 'Smallest first',
    sizeDesc: 'Largest first',
  },
  action: {
    create: 'Create',
    cancel: 'Cancel',
    retry: 'Retry',
    dismiss: 'Dismiss',
    loadMore: 'Load more',
    clearSelection: 'Clear',
    move: 'Move to folder',
    moveTitle: 'Move assets',
    moveDescription: 'Choose a destination for the selected assets.',
    makePublic: 'Make public',
    makePrivate: 'Make private',
    archive: 'Archive',
    archiveTitle: 'Archive assets?',
    archiveDescription:
      'Archived assets stop being served. Assets referenced by content are skipped.',
  },
  visibility: {
    private: 'Private',
    public: 'Public',
    hint: 'Visibility controls delivery through the asset endpoint. It is not an access boundary: files remain reachable in storage.',
  },
  dropzone: {
    idle: 'Drop files here or click to upload',
    active: 'Release to upload',
    uploading: 'Uploading…',
  },
  list: {
    empty: 'No assets in this folder.',
    loadError: 'Could not load assets.',
    mutationError: 'The last change failed.',
  },
  selection: {
    count: ({ count }, format) => `${format.number(count)} selected`,
    all: ({ count }, format) => `All ${format.number(count)} selected`,
    cleared: 'Selection cleared',
    selectAllMatching: ({ count }, format) =>
      `Select all ${format.number(count)}`,
    hidden: ({ count }, format) =>
      pluralize(
        count,
        format,
        `${format.number(count)} selected item is hidden by filters`,
        `${format.number(count)} selected items are hidden by filters`,
      ),
    item: ({ name }) => `Select ${name}`,
  },
  bulk: {
    skipped: ({ count }, format) =>
      pluralize(
        count,
        format,
        `${format.number(count)} asset was skipped because it is in use`,
        `${format.number(count)} assets were skipped because they are in use`,
      ),
    bar: 'Bulk actions',
    action: {
      move: 'Move to…',
      makePublic: 'Make public',
      makePrivate: 'Make private',
      setProvenance: 'Set provenance',
      download: 'Download',
      archive: 'Archive',
      restore: 'Restore',
    },
    disabled: {
      empty: 'Select assets first.',
      unsupported: 'Not available on this server.',
      archived: 'These assets are archived already.',
      'not-archived': 'Only archived assets can be restored.',
      'all-public': 'All selected assets are public.',
      'all-private': 'All selected assets are private.',
      'too-many': 'Select loaded assets for this action.',
    },
    moved: ({ count, folder }, format) =>
      `${format.number(count)} ${pluralize(count, format, 'asset', 'assets')} moved to ${folder}.`,
    archived: ({ count }, format) =>
      `${format.number(count)} ${pluralize(count, format, 'asset', 'assets')} archived.`,
    restored: ({ count }, format) =>
      `${format.number(count)} ${pluralize(count, format, 'asset', 'assets')} restored.`,
    visibility: ({ count, status }, format) =>
      `${format.number(count)} ${pluralize(count, format, 'asset is', 'assets are')} ${status} now.`,
    undo: 'Undo',
    undone: 'Undone.',
    archiveInUse: ({ count }, format) =>
      `${format.number(count)} ${pluralize(count, format, 'asset is', 'assets are')} still in use. Archive anyway? Content keeps pointing at them.`,
    archiveAnyway: 'Archive anyway',
  },
  type: {
    image: 'Image',
    video: 'Video',
    audio: 'Audio',
    document: 'Document',
    other: 'File',
  },
  upload: {
    title: 'Uploads',
    all: 'All uploads',
    abort: 'Cancel uploads',
    clear: 'Clear finished',
    status: {
      queued: 'Queued',
      preparing: 'Preparing',
      signing: 'Preparing',
      uploading: 'Uploading',
      completing: 'Processing',
      retrying: 'Retrying',
      paused: 'Paused',
      success: 'Uploaded',
      error: 'Failed',
      aborted: 'Cancelled',
    },
    progress: ({ done, total, percent }, format) =>
      `${format.number(done)} of ${format.number(total)} ${pluralize(total, format, 'file', 'files')} (${format.percent(percent / 100)})`,
    eta: ({ seconds }, format) => format.eta(seconds),
    failed: ({ reason }) => `Failed: ${reason}`,
    started: ({ count }, format) =>
      `${format.number(count)} ${pluralize(count, format, 'file is', 'files are')} uploading`,
    finished: ({ done, total, failed }, format) =>
      failed > 0
        ? `${format.number(done)} of ${format.number(total)} files uploaded, ${format.number(failed)} failed`
        : `${format.number(done)} of ${format.number(total)} files uploaded`,
    entryDone: ({ name }) => `${name} uploaded`,
    entryFailed: ({ name, reason }) => `${name} failed: ${reason}`,
    entryCancelled: ({ name }) => `${name} cancelled`,
  },
  image: {
    provenance: { ai_generated: 'AI-generated', ai_edited: 'AI-edited' },
  },
  usage: {
    title: 'Usage',
    count: ({ roots }, format) =>
      `Used on ${format.number(roots)} ${pluralize(roots, format, 'page', 'pages')}`,
    scopeLabel: 'Show usage in',
    scope: {
      live: 'All branches',
      published: 'Published',
      history: 'History',
    },
    missingAlt: 'Only without alt text',
    empty: 'Not used anywhere',
    loadMore: 'Show more',
    hiddenRoots: ({ count }, format) =>
      pluralize(
        count,
        format,
        `${format.number(count)} more page you cannot see`,
        `${format.number(count)} more pages you cannot see`,
      ),
  },
  picker: {
    title: 'Select asset',
    choose: 'Choose',
    select: 'Select',
    disabled: {
      dimensions: ({ minWidth, minHeight }, format) =>
        `Needs at least ${format.number(minWidth)} × ${format.number(minHeight)} px`,
    },
  },
  shortcut: ({ key }, format) => (format.apple ? `⌘${key}` : `Ctrl+${key}`),
  error: {
    unknown: 'Something went wrong.',
    size: ({ max }, format) => `The file is larger than ${format.bytes(max)}.`,
    type: ({ accepted }) => `Only these file types are allowed: ${accepted}.`,
    ASSET_ACCESS_DENIED: 'This asset is not available.',
    ASSET_NOT_FOUND: 'The asset no longer exists.',
    CANNOT_MOVE_INTO_DESCENDANT:
      'A folder cannot be moved into its own subfolder.',
    CANNOT_MOVE_INTO_SELF: 'A folder cannot be moved into itself.',
    CANNOT_REPLACE_VARIANT: 'A generated variant cannot be replaced.',
    FILE_TOO_LARGE: 'The file is too large.',
    FOLDER_HAS_CONTENT: 'The folder is not empty.',
    FOLDER_NAME_TAKEN: 'A folder with this name already exists here.',
    FOLDER_NOT_FOUND: 'The folder no longer exists.',
    INVALID_FILE_TYPE: 'This file type is not allowed.',
    NETWORK_ERROR: 'The connection was lost.',
    PARENT_NOT_FOUND: 'The target folder no longer exists.',
    SLUG_GENERATION_FAILED: 'No free file name could be found.',
    STORAGE_UNSUPPORTED: 'The storage backend does not support this upload.',
    TOO_MANY_FILES: 'Too many files at once.',
    UNSUPPORTED: 'This action is not available.',
    UPLOAD_EXPIRED: 'The upload link expired.',
    UPLOAD_FAILED: 'The upload failed.',
    UPLOAD_NOT_FOUND: 'The uploaded file was not found in storage.',
    UPLOAD_TOKEN_INVALID: 'The upload could not be verified.',
    VERSION_CONFLICT: 'Someone else changed this asset. Reload and try again.',
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = deepMerge(out[key], value);
  }
  return out as T;
}

/** `defaultMediaMessages` with `input` merged over it, key by key. */
export function mergeMediaMessages(
  input?: MediaMessagesInput,
  base: MediaMessages = defaultMediaMessages,
): MediaMessages {
  return input ? deepMerge(base, input) : base;
}

/** The translated message for an error code; unknown codes use `error.unknown`. */
export function mediaErrorMessage(
  messages: MediaMessages,
  code: string | undefined,
): string {
  if (code && Object.hasOwn(messages.error, code)) {
    const value = messages.error[code as MediaErrorCode];
    if (typeof value === 'string') return value;
  }
  return messages.error.unknown;
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Formatters bound to `locale` (`undefined` uses the runtime default). */
export function createMediaFormatters(
  locale: string | undefined,
): MediaFormatters {
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent' });
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const plural = new Intl.PluralRules(locale);

  return {
    locale,
    bytes: (value) => {
      let unit = 0;
      let scaled = value;
      while (scaled >= 1024 && unit < BYTE_UNITS.length - 1) {
        scaled /= 1024;
        unit++;
      }
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: BYTE_UNITS[unit],
        unitDisplay: 'short',
        maximumFractionDigits: unit === 0 ? 0 : 1,
      }).format(scaled);
    },
    number: (value) => number.format(value),
    percent: (fraction) => percent.format(fraction),
    date: (value) => date.format(new Date(value)),
    eta: (seconds) =>
      seconds < 60
        ? relative.format(Math.ceil(seconds), 'second')
        : seconds < 3600
          ? relative.format(Math.ceil(seconds / 60), 'minute')
          : relative.format(Math.ceil(seconds / 3600), 'hour'),
    plural: (count) => plural.select(count),
    apple: isApplePlatform(),
  };
}
