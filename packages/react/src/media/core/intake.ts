/**
 * Turns drops, pastes and file inputs into a flat list of files with their
 * relative paths. A `DataTransfer` is readable only during the `drop` event
 * itself, so `normalizeDrop` collects every entry synchronously before its
 * first `await` and reads directories afterwards.
 */

export type IntakeFile = {
  file: File;
  /** `Folder/Sub/name.jpg` for files from a dropped folder, the file name otherwise. */
  relativePath: string;
};

export type IntakeLimitReason = 'files' | 'depth' | 'bytes';

export type IntakeResult = {
  files: IntakeFile[];
  /** Relative folder paths of the dropped folders, parents before children. */
  folders: string[];
  /** System files (`.DS_Store`, `Thumbs.db`, dot files, `__MACOSX/`) left out. */
  skippedSystem: number;
  /** Set when a limit stopped the traversal early. */
  truncated: IntakeLimitReason | null;
};

export type IntakeOptions = {
  /** @default 500 */
  maxFiles?: number;
  /** Folder levels below a dropped folder. @default 10 */
  maxDepth?: number;
  maxTotalBytes?: number;
  /** @default true */
  skipSystemFiles?: boolean;
  /** Called with the number of files read so far while folders are traversed. */
  onProgress?: (files: number) => void;
};

/** The parts of `FileSystemEntry` the traversal uses. */
export type EntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?(success: (file: File) => void, error?: (err: unknown) => void): void;
  createReader?(): {
    readEntries(
      success: (entries: EntryLike[]) => void,
      error?: (err: unknown) => void,
    ): void;
  };
};

export type DataTransferItemLike = {
  kind: string;
  type?: string;
  getAsFile(): File | null;
  getAsEntry?(): EntryLike | null;
  webkitGetAsEntry?(): EntryLike | null;
};

export type DataTransferLike = {
  items?: ArrayLike<DataTransferItemLike> | null;
  files?: ArrayLike<File> | null;
  types?: ArrayLike<string> | null;
};

const SYSTEM_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/** OS metadata files and dot files, including anything under `__MACOSX/`. */
export function isSystemFile(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '__MACOSX')) return true;
  const name = segments[segments.length - 1] ?? '';
  return SYSTEM_NAMES.has(name.toLowerCase()) || name.startsWith('.');
}

/** Whether a drag carries files (checked in `dragenter`/`dragover`, before the drop). */
export function dragHasFiles(types: ArrayLike<string> | null | undefined) {
  return !!types && Array.from(types).includes('Files');
}

/** The files a drag offers, counted before the drop (types only in Chromium). */
export function dragFilePreview(dataTransfer: DataTransferLike): {
  count: number;
  types: string[];
} {
  const items = Array.from(dataTransfer.items ?? []).filter(
    (item) => item.kind === 'file',
  );
  return {
    count: items.length,
    types: items.map((item) => item.type ?? '').filter(Boolean),
  };
}

type DropSnapshot = { entries: EntryLike[]; files: File[] };

/** The synchronous half of `normalizeDrop`; call it inside the `drop` handler. */
export function collectDrop(dataTransfer: DataTransferLike): DropSnapshot {
  const entries: EntryLike[] = [];
  const files: File[] = [];
  const items = Array.from(dataTransfer.items ?? []);
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = item.getAsEntry?.() ?? item.webkitGetAsEntry?.() ?? null;
      // Folders need the entry API; a dropped file is read directly, since
      // WebKit can hand out an entry whose file() never resolves.
      if (entry?.isDirectory) {
        entries.push(entry);
        continue;
      }
      const file = item.getAsFile();
      if (file) files.push(file);
      else if (entry) entries.push(entry);
    }
    return { entries, files };
  }
  return { entries, files: Array.from(dataTransfer.files ?? []) };
}

function readFile(entry: EntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error(`${entry.fullPath} is not readable`));
      return;
    }
    entry.file(resolve, reject);
  });
}

/** Every child of a directory: `readEntries` returns batches (100 in Chromium) until empty. */
async function readDirectory(entry: EntryLike): Promise<EntryLike[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const all: EntryLike[] = [];
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

function relativeOf(entry: EntryLike): string {
  return entry.fullPath.replace(/^\/+/, '') || entry.name;
}

/** The asynchronous half: traverses the collected entries within the limits. */
export async function readDrop(
  snapshot: DropSnapshot,
  options: IntakeOptions = {},
): Promise<IntakeResult> {
  const maxFiles = options.maxFiles ?? 500;
  const maxDepth = options.maxDepth ?? 10;
  const skip = options.skipSystemFiles ?? true;
  const result: IntakeResult = {
    files: [],
    folders: [],
    skippedSystem: 0,
    truncated: null,
  };
  let bytes = 0;

  const add = (file: File, relativePath: string): boolean => {
    if (skip && isSystemFile(relativePath)) {
      result.skippedSystem++;
      return true;
    }
    if (result.files.length >= maxFiles) {
      result.truncated = 'files';
      return false;
    }
    if (
      options.maxTotalBytes !== undefined &&
      bytes + file.size > options.maxTotalBytes
    ) {
      result.truncated = 'bytes';
      return false;
    }
    bytes += file.size;
    result.files.push({ file, relativePath });
    options.onProgress?.(result.files.length);
    return true;
  };

  for (const file of snapshot.files) {
    if (!add(file, file.name)) return result;
  }

  const walk = async (entry: EntryLike, depth: number): Promise<boolean> => {
    const path = relativeOf(entry);
    if (entry.isFile) return add(await readFile(entry), path);
    if (!entry.isDirectory) return true;
    if (skip && isSystemFile(path)) {
      result.skippedSystem++;
      return true;
    }
    if (depth > maxDepth) {
      result.truncated = 'depth';
      return true;
    }
    result.folders.push(path);
    const children = await readDirectory(entry);
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (!(await walk(child, depth + 1))) return false;
    }
    return true;
  };

  for (const entry of snapshot.entries) {
    if (!(await walk(entry, 0))) break;
  }
  result.folders.sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  );
  return result;
}

/**
 * All files of a drop, folders traversed. Call it synchronously from the
 * `drop` handler (not after an `await`): entries are collected before the
 * first `await`.
 */
export function normalizeDrop(
  dataTransfer: DataTransferLike,
  options?: IntakeOptions,
): Promise<IntakeResult> {
  return readDrop(collectDrop(dataTransfer), options);
}

/** Files of an `<input type="file">`, with `webkitRelativePath` for folder inputs. */
export function normalizeInput(
  files: ArrayLike<File>,
  options?: IntakeOptions,
): Promise<IntakeResult> {
  const list = Array.from(files);
  const pathOf = (file: File) =>
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name;
  if (!list.some((file) => pathOf(file) !== file.name)) {
    return readDrop({ entries: [], files: list }, options);
  }
  // A folder input lists files flat with paths; replay them as a tree.
  const root = new Map<string, EntryLike & { children?: EntryLike[] }>();
  const top: EntryLike[] = [];
  const dir = (path: string): EntryLike & { children: EntryLike[] } => {
    const existing = root.get(path);
    if (existing?.children)
      return existing as EntryLike & { children: EntryLike[] };
    const name = path.slice(path.lastIndexOf('/') + 1);
    const node = {
      isFile: false,
      isDirectory: true,
      name,
      fullPath: `/${path}`,
      children: [] as EntryLike[],
      createReader() {
        let done = false;
        return {
          readEntries: (success: (entries: EntryLike[]) => void) => {
            success(done ? [] : node.children);
            done = true;
          },
        };
      },
    };
    root.set(path, node);
    const parent = folderOfPath(path);
    if (parent) dir(parent).children.push(node);
    else top.push(node);
    return node;
  };
  const loose: File[] = [];
  for (const file of list) {
    const path = pathOf(file);
    const parent = folderOfPath(path);
    if (!parent) {
      loose.push(file);
      continue;
    }
    dir(parent).children.push({
      isFile: true,
      isDirectory: false,
      name: file.name,
      fullPath: `/${path}`,
      file: (success) => success(file),
    });
  }
  return readDrop({ entries: top, files: loose }, options);
}

const DEFAULT_PASTE_NAME = /^image\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** `pasted-YYYY-MM-DD-HHmmss.<ext>` in local time. */
export function pastedFileName(date: Date, extension: string): string {
  return `pasted-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(
    date.getSeconds(),
  )}.${extension}`;
}

/**
 * The files of a paste. Screenshots arrive as `image.png`; they are
 * renamed to `pasted-YYYY-MM-DD-HHmmss.png` so two pastes do not collide.
 */
export function normalizePaste(
  clipboard: { files?: ArrayLike<File> | null } | null,
  now: Date = new Date(),
): File[] {
  return Array.from(clipboard?.files ?? []).map((file) => {
    const match = DEFAULT_PASTE_NAME.exec(file.name);
    if (!match) return file;
    return new File([file], pastedFileName(now, match[1].toLowerCase()), {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}

/** Whether a keyboard or paste target is a text field the library must not intercept. */
export function isTextInput(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    type?: string;
  };
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return ![
    'button',
    'checkbox',
    'radio',
    'file',
    'submit',
    'reset',
    'range',
    'color',
  ].includes((el.type ?? 'text').toLowerCase());
}

// --- validation ---------------------------------------------------------------

export type IntakeRejectReason =
  | 'type'
  | 'size'
  | 'count'
  | 'dimensions'
  | 'aspect';

export type IntakeConstraints = {
  /** Like the `accept` attribute: `.ext`, `type/*` or exact types, comma separated. */
  accept?: string;
  /** Bytes. */
  maxSize?: number;
  maxFiles?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Width / height, accepted within `aspectTolerance` (default 0.01). */
  aspect?: number;
  aspectTolerance?: number;
};

/** Mirrors the browser's `accept` matching: `.ext`, `type/*` and exact MIME types. */
export function acceptsFile(
  accept: string | undefined,
  file: { name: string; type: string },
): boolean {
  if (!accept) return true;
  const rules = accept
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/**
 * Why `file` breaks `constraints`, or `null`. Dimension and aspect checks
 * run only when `dimensions` are known (images, after decoding the header).
 */
export function validate(
  file: { name: string; type: string; size: number },
  constraints: IntakeConstraints,
  dimensions?: { width: number; height: number } | null,
): IntakeRejectReason | null {
  if (!acceptsFile(constraints.accept, file)) return 'type';
  if (constraints.maxSize !== undefined && file.size > constraints.maxSize) {
    return 'size';
  }
  if (dimensions) {
    const { width, height } = dimensions;
    if (
      (constraints.minWidth !== undefined && width < constraints.minWidth) ||
      (constraints.minHeight !== undefined && height < constraints.minHeight) ||
      (constraints.maxWidth !== undefined && width > constraints.maxWidth) ||
      (constraints.maxHeight !== undefined && height > constraints.maxHeight)
    ) {
      return 'dimensions';
    }
    if (constraints.aspect !== undefined && height > 0) {
      const tolerance = constraints.aspectTolerance ?? 0.01;
      if (
        Math.abs(width / height - constraints.aspect) >
        tolerance * constraints.aspect
      ) {
        return 'aspect';
      }
    }
  }
  return null;
}

export type IntakeRejection<T> = { item: T; reason: IntakeRejectReason };

/** Splits `items` into accepted and rejected; files past `maxFiles` are `count`. */
export function validateBatch<
  T extends { file: { name: string; type: string; size: number } },
>(
  items: readonly T[],
  constraints: IntakeConstraints,
): { accepted: T[]; rejected: IntakeRejection<T>[] } {
  const accepted: T[] = [];
  const rejected: IntakeRejection<T>[] = [];
  for (const item of items) {
    const reason = validate(item.file, constraints);
    if (reason) rejected.push({ item, reason });
    else if (
      constraints.maxFiles !== undefined &&
      accepted.length >= constraints.maxFiles
    ) {
      rejected.push({ item, reason: 'count' });
    } else accepted.push(item);
  }
  return { accepted, rejected };
}

/** The folder of a relative path (`A/B/x.jpg` gives `A/B`), `''` at the top. */
export function folderOfPath(relativePath: string): string {
  const index = relativePath.lastIndexOf('/');
  return index === -1 ? '' : relativePath.slice(0, index);
}
