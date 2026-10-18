import type { MediaUploadEntry } from './types';

/**
 * Error codes the media parts translate. Server and upload-client codes pass
 * through as-is; any other code is shown as `error.unknown`. Parts never
 * render a server-provided message string.
 */
export type MediaErrorCode =
  | 'ASSET_ACCESS_DENIED'
  | 'ASSET_NOT_FOUND'
  | 'CANNOT_MOVE_INTO_DESCENDANT'
  | 'CANNOT_MOVE_INTO_SELF'
  | 'CANNOT_REPLACE_VARIANT'
  | 'FILE_TOO_LARGE'
  | 'FOLDER_HAS_CONTENT'
  | 'FOLDER_NOT_FOUND'
  | 'INVALID_FILE_TYPE'
  | 'NETWORK_ERROR'
  | 'PARENT_NOT_FOUND'
  | 'SLUG_GENERATION_FAILED'
  | 'STORAGE_UNSUPPORTED'
  | 'TOO_MANY_FILES'
  | 'UPLOAD_EXPIRED'
  | 'UPLOAD_FAILED'
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_TOKEN_INVALID';

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
  selection: { count: MediaMessageFn<{ count: number }> };
  bulk: { skipped: MediaMessageFn<{ count: number }> };
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
  },
  bulk: {
    skipped: ({ count }, format) =>
      pluralize(
        count,
        format,
        `${format.number(count)} asset was skipped because it is in use`,
        `${format.number(count)} assets were skipped because they are in use`,
      ),
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
    FOLDER_NOT_FOUND: 'The folder no longer exists.',
    INVALID_FILE_TYPE: 'This file type is not allowed.',
    NETWORK_ERROR: 'The connection was lost.',
    PARENT_NOT_FOUND: 'The target folder no longer exists.',
    SLUG_GENERATION_FAILED: 'No free file name could be found.',
    STORAGE_UNSUPPORTED: 'The storage backend does not support this upload.',
    TOO_MANY_FILES: 'Too many files at once.',
    UPLOAD_EXPIRED: 'The upload link expired.',
    UPLOAD_FAILED: 'The upload failed.',
    UPLOAD_NOT_FOUND: 'The uploaded file was not found in storage.',
    UPLOAD_TOKEN_INVALID: 'The upload could not be verified.',
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
