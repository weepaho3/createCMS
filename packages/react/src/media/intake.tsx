import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type {
  IntakeConstraints,
  IntakeFile,
  IntakeOptions,
  IntakeRejectReason,
  IntakeResult,
} from './core/intake';
import type { MediaStore, MediaStoreState } from './core/store';
import type { MediaUploadEntry } from './core/types';

import { mergeProps, useRender } from '../use-render';
import { useMediaContext, useMediaMessages } from './context';
import { hasAssetDrag } from './core/drag';
import {
  dragFilePreview,
  dragHasFiles,
  isTextInput,
  normalizeDrop,
  normalizeInput,
  normalizePaste,
  validateBatch,
} from './core/intake';
import { cameraAccept } from './core/touch';
import { useDropOverlay } from './dnd';
import { useSelector } from './use-store';

// --- intake state ------------------------------------------------------------------------

export type IntakeFolderPrompt = {
  folders: number;
  files: number;
  /** Creates the dropped folders, then uploads into them. */
  recreate: () => void;
  /** Uploads everything into the target folder. */
  flatten: () => void;
  cancel: () => void;
};

type IntakeSnapshot = {
  /** Files read so far while a folder drop is traversed; `null` otherwise. */
  reading: number | null;
  prompt: IntakeFolderPrompt | null;
};

type IntakeStore = {
  get(): IntakeSnapshot;
  set(patch: Partial<IntakeSnapshot>): void;
  subscribe(listener: () => void): () => void;
};

const intakeStores = new WeakMap<MediaStore, IntakeStore>();

function intakeStoreOf(store: MediaStore): IntakeStore {
  let existing = intakeStores.get(store);
  if (!existing) {
    let value: IntakeSnapshot = { reading: null, prompt: null };
    const listeners = new Set<() => void>();
    existing = {
      get: () => value,
      set(patch) {
        value = { ...value, ...patch };
        for (const listener of listeners) listener();
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    intakeStores.set(store, existing);
  }
  return existing;
}

export type IntakeHandlerOptions = IntakeConstraints & {
  /** Target folder; defaults to the open folder. */
  folderId?: string | null;
  /** Traversal limits of folder drops. */
  intake?: IntakeOptions;
  /** The successful uploads of one intake. */
  onUploaded?: (entries: MediaUploadEntry[]) => void;
  onRejected?: (file: File, reason: IntakeRejectReason) => void;
};

export type Intake = IntakeSnapshot & {
  /** Validates and queues files (a drop result, an input, a paste or your own source). */
  receive: (result: IntakeResult | File[]) => Promise<void>;
  /** Reads a `drop` event; call it synchronously from the handler. */
  receiveDrop: (dataTransfer: DataTransfer) => Promise<void>;
};

const selectFolder = (state: MediaStoreState) => state.folders.currentId;

/**
 * The intake of the enclosing `Media.Root`: validates against the
 * constraints, skips system files, asks whether to recreate a dropped
 * folder structure (`prompt`), and queues the files with the store
 * (`receive` command, file hooks applied). Drops are accepted while
 * uploads run. Results are announced.
 */
export function useIntake(options: IntakeHandlerOptions = {}): Intake {
  const { store, announce } = useMediaContext('useIntake');
  const { messages, format } = useMediaMessages();
  const intakeStore = intakeStoreOf(store);
  const snapshot = React.useSyncExternalStore(
    intakeStore.subscribe,
    intakeStore.get,
    intakeStore.get,
  );
  const currentFolder = useSelector(store, selectFolder, Object.is);
  const optionsRef = React.useRef(options);
  optionsRef.current = options;
  const folderId =
    options.folderId === undefined ? currentFolder : options.folderId;

  const queue = React.useCallback(
    async (files: IntakeFile[], recreate: boolean) => {
      const result = await store.dispatch<MediaUploadEntry[]>({
        type: 'receive',
        files,
        folderId,
        recreateFolders: recreate,
      });
      if (result.ok && result.value)
        optionsRef.current.onUploaded?.(result.value);
    },
    [store, folderId],
  );

  const receive = React.useCallback(
    async (input: IntakeResult | File[]) => {
      const result: IntakeResult = Array.isArray(input)
        ? {
            files: input.map((file) => ({ file, relativePath: file.name })),
            folders: [],
            skippedSystem: 0,
            truncated: null,
          }
        : input;
      const { accepted, rejected } = validateBatch(
        result.files,
        optionsRef.current,
      );
      for (const { item, reason } of rejected)
        optionsRef.current.onRejected?.(item.file, reason);
      const notes = [
        result.skippedSystem > 0
          ? messages.intake.skippedSystem(
              { count: result.skippedSystem },
              format,
            )
          : null,
        rejected.length > 0
          ? messages.intake.rejected({ count: rejected.length }, format)
          : null,
        result.truncated
          ? messages.intake.truncated({ count: result.files.length }, format)
          : null,
      ].filter(Boolean);
      if (notes.length > 0) announce(notes.join('. '));
      if (accepted.length === 0) return;
      const accept = new Set(accepted);
      const folders = result.folders.length;
      if (folders === 0) {
        await queue(accepted, false);
        return;
      }
      await new Promise<void>((resolve) => {
        const done = (recreate: boolean | null) => {
          intakeStore.set({ prompt: null });
          if (recreate === null) resolve();
          else
            void queue(
              result.files.filter((f) => accept.has(f)),
              recreate,
            ).then(resolve);
        };
        intakeStore.set({
          prompt: {
            folders,
            files: accepted.length,
            recreate: () => done(true),
            flatten: () => done(false),
            cancel: () => done(null),
          },
        });
      });
    },
    [announce, format, intakeStore, messages, queue],
  );

  const receiveDrop = React.useCallback(
    async (dataTransfer: DataTransfer) => {
      // Synchronous first step: the data transfer is cleared after the event.
      const reading = normalizeDrop(dataTransfer, {
        ...optionsRef.current.intake,
        onProgress: (count) => {
          if (count % 25 === 0) intakeStore.set({ reading: count });
        },
      });
      intakeStore.set({ reading: 0 });
      try {
        const result = await reading;
        intakeStore.set({ reading: null });
        await receive(result);
      } catch {
        intakeStore.set({ reading: null });
      }
    },
    [intakeStore, receive],
  );

  return React.useMemo(
    () => ({ ...snapshot, receive, receiveDrop }),
    [snapshot, receive, receiveDrop],
  );
}

// --- Intake.Dropzone ----------------------------------------------------------------------

type DropzoneState = {
  dragOver: 'window' | 'zone' | null;
  dragAccept: boolean;
  reading: boolean;
};

export type IntakeDropzoneProps = Omit<
  UseRenderComponentProps<'div', DropzoneState>,
  'children'
> &
  IntakeHandlerOptions & {
    children?:
      | React.ReactNode
      | ((state: DropzoneState & { count: number }) => React.ReactNode);
  };

/**
 * A drop area for OS files and folders. `data-drag-over` is `window` while
 * files are dragged anywhere over the page and `zone` over the area;
 * `data-drag-accept` tells (before the drop, from the count and, in
 * Chromium, the types) whether the files fit. Drops during uploads are
 * queued. The non-dragging alternatives are `Intake.Input` and
 * `Intake.FolderInput`.
 */
export function IntakeDropzone(props: IntakeDropzoneProps) {
  const {
    accept,
    maxSize,
    maxFiles,
    folderId,
    intake,
    onUploaded,
    onRejected,
    children,
    render,
    ...rest
  } = props;
  const options = {
    accept,
    maxSize,
    maxFiles,
    folderId,
    intake,
    onUploaded,
    onRejected,
  };
  const handler = useIntake(options);
  const overlay = useDropOverlay();
  const [over, setOver] = React.useState(false);
  const [preview, setPreview] = React.useState({
    count: 0,
    types: [] as string[],
  });
  const depth = React.useRef(0);

  const acceptable =
    (maxFiles === undefined || preview.count <= maxFiles) &&
    (!accept ||
      preview.types.length === 0 ||
      preview.types.every(
        (type) =>
          validateBatch([{ file: { name: '', type, size: 0 } }], { accept })
            .accepted.length === 1,
      ));

  const state: DropzoneState = {
    dragOver: over ? 'zone' : overlay.active ? 'window' : null,
    dragAccept: (over || overlay.active) && acceptable,
    reading: handler.reading !== null,
  };

  return useRender({
    defaultTagName: 'div',
    render,
    state,
    props: mergeProps<'div'>(
      {
        onDragEnter: (event: React.DragEvent) => {
          if (
            !dragHasFiles(event.dataTransfer.types) ||
            hasAssetDrag(event.dataTransfer.types)
          )
            return;
          event.preventDefault();
          depth.current += 1;
          if (depth.current === 1) {
            setOver(true);
            setPreview(dragFilePreview(event.dataTransfer));
          }
        },
        onDragOver: (event: React.DragEvent) => {
          if (
            !dragHasFiles(event.dataTransfer.types) ||
            hasAssetDrag(event.dataTransfer.types)
          )
            return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: () => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        },
        onDrop: (event: React.DragEvent) => {
          if (!dragHasFiles(event.dataTransfer.types)) return;
          event.preventDefault();
          depth.current = 0;
          setOver(false);
          void handler.receiveDrop(event.dataTransfer);
        },
      },
      rest,
      {
        children:
          typeof children === 'function'
            ? children({ ...state, count: preview.count })
            : children,
      },
    ),
  });
}

// --- Intake.Overlay --------------------------------------------------------------------------

export type IntakeOverlayProps = UseRenderComponentProps<
  'div',
  { count: number }
> &
  IntakeHandlerOptions;

/**
 * A full-window drop target shown while OS files are dragged over the page
 * (an enter/leave counter keeps it from flickering). Dropping anywhere on
 * it uploads into the open folder.
 */
export function IntakeOverlay(props: IntakeOverlayProps) {
  const {
    accept,
    maxSize,
    maxFiles,
    folderId,
    intake,
    onUploaded,
    onRejected,
    render,
    children,
    ...rest
  } = props;
  const { messages } = useMediaMessages();
  const handler = useIntake({
    accept,
    maxSize,
    maxFiles,
    folderId,
    intake,
    onUploaded,
    onRejected,
  });
  const overlay = useDropOverlay();
  const element = useRender({
    defaultTagName: 'div',
    render,
    state: { count: overlay.count },
    props: mergeProps<'div'>(
      {
        'data-drag-over': 'window',
        onDragOver: (event: React.DragEvent) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        },
        onDrop: (event: React.DragEvent) => {
          event.preventDefault();
          void handler.receiveDrop(event.dataTransfer);
        },
        children: children ?? messages.intake.overlay,
      },
      rest,
    ),
  });
  return overlay.active ? element : null;
}

// --- Intake.Input / Intake.FolderInput ---------------------------------------------------------

export type IntakeInputProps = Omit<
  UseRenderComponentProps<'button'>,
  'onClick'
> &
  IntakeHandlerOptions & {
    /** Mobile: open the camera (`environment`) or the selfie camera (`user`). */
    capture?: 'environment' | 'user';
  };

function useHiddenInput(
  options: IntakeHandlerOptions,
  attributes: React.InputHTMLAttributes<HTMLInputElement> & {
    webkitdirectory?: string;
  },
) {
  const handler = useIntake(options);
  const ref = React.useRef<HTMLInputElement | null>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      tabIndex={-1}
      aria-hidden="true"
      style={{ display: 'none' }}
      {...attributes}
      onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        void normalizeInput(files, options.intake).then((result) =>
          handler.receive(result),
        );
      }}
    />
  );
  return { open: () => ref.current?.click(), input };
}

/** A `button` that opens the file picker ("Upload files", `multiple`). */
export function IntakeInput(props: IntakeInputProps) {
  const {
    accept,
    maxSize,
    maxFiles,
    folderId,
    intake,
    onUploaded,
    onRejected,
    capture,
    render,
    children,
    ...rest
  } = props;
  const { messages } = useMediaMessages();
  const { open, input } = useHiddenInput(
    { accept, maxSize, maxFiles, folderId, intake, onUploaded, onRejected },
    { accept, multiple: maxFiles === undefined || maxFiles > 1, capture },
  );
  const button = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        onClick: open,
        children: children ?? messages.intake.files,
      },
      rest,
    ),
  });
  return (
    <>
      {button}
      {input}
    </>
  );
}

export type IntakeCameraProps = Omit<IntakeInputProps, 'accept' | 'capture'> & {
  /** `photo` (default) or `video`. */
  kind?: 'photo' | 'video';
  /** `environment` (default, rear camera) or `user`. */
  facing?: 'environment' | 'user';
};

/**
 * A `button` that opens the device camera and uploads the shot through the
 * same intake as `Intake.Input`. Browsers without a camera show their file
 * picker instead.
 */
export function IntakeCamera(props: IntakeCameraProps) {
  const {
    kind = 'photo',
    facing = 'environment',
    maxSize,
    folderId,
    intake,
    onUploaded,
    onRejected,
    render,
    children,
    ...rest
  } = props;
  const { messages } = useMediaMessages();
  const accept = cameraAccept(kind);
  const { open, input } = useHiddenInput(
    { accept, maxSize, maxFiles: 1, folderId, intake, onUploaded, onRejected },
    { accept, multiple: false, capture: facing },
  );
  const button = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        onClick: open,
        children:
          children ??
          (kind === 'photo' ? messages.upload.camera : messages.upload.video),
      },
      rest,
    ),
  });
  return (
    <>
      {button}
      {input}
    </>
  );
}

/** A `button` that opens a folder picker ("Upload folder", `webkitdirectory`). */
export function IntakeFolderInput(props: Omit<IntakeInputProps, 'capture'>) {
  const {
    accept,
    maxSize,
    maxFiles,
    folderId,
    intake,
    onUploaded,
    onRejected,
    render,
    children,
    ...rest
  } = props;
  const { messages } = useMediaMessages();
  const { open, input } = useHiddenInput(
    { accept, maxSize, maxFiles, folderId, intake, onUploaded, onRejected },
    { multiple: true, webkitdirectory: '' },
  );
  const button = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        onClick: open,
        children: children ?? messages.intake.folder,
      },
      rest,
    ),
  });
  return (
    <>
      {button}
      {input}
    </>
  );
}

// --- Intake.Paste ------------------------------------------------------------------------------

/**
 * Uploads pasted files (screenshots become `pasted-YYYY-MM-DD-HHmmss.png`)
 * while `target` (or, with `document`, the page) receives the paste. A
 * paste into a text field is never intercepted.
 */
export function useIntakePaste(
  target: React.RefObject<HTMLElement | null> | 'document',
  options: IntakeHandlerOptions = {},
): void {
  const handler = useIntake(options);
  const receive = React.useRef(handler.receive);
  receive.current = handler.receive;
  React.useEffect(() => {
    const el =
      target === 'document'
        ? typeof document === 'undefined'
          ? null
          : document
        : target.current;
    if (!el) return;
    const onPaste = (event: Event) => {
      const paste = event as ClipboardEvent;
      if (isTextInput(paste.target)) return;
      const files = normalizePaste(paste.clipboardData);
      if (files.length === 0) return;
      paste.preventDefault();
      void receive.current(files);
    };
    el.addEventListener('paste', onPaste);
    return () => el.removeEventListener('paste', onPaste);
  }, [target]);
}

export type IntakePasteProps = Omit<
  UseRenderComponentProps<'button'>,
  'onClick'
> &
  IntakeHandlerOptions;

/**
 * A `button` that reads images from the clipboard (`navigator.clipboard.read`,
 * which needs permission and a secure context); rendered only where the
 * API exists.
 */
export function IntakePaste(props: IntakePasteProps) {
  const {
    accept,
    maxSize,
    maxFiles,
    folderId,
    intake,
    onUploaded,
    onRejected,
    render,
    children,
    ...rest
  } = props;
  const { messages } = useMediaMessages();
  const handler = useIntake({
    accept,
    maxSize,
    maxFiles,
    folderId,
    intake,
    onUploaded,
    onRejected,
  });
  const supported =
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.read === 'function';
  const pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        files.push(new File([blob], `image.${type.split('/')[1]}`, { type }));
      }
      await handler.receive(normalizePaste({ files }));
    } catch {
      // Permission denied or nothing to paste.
    }
  };
  const element = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        onClick: () => void pasteFromClipboard(),
        children: children ?? messages.intake.paste,
      },
      rest,
    ),
  });
  return supported ? element : null;
}

// --- Intake.FolderPrompt / Intake.Reading ----------------------------------------------------------

export type IntakeFolderPromptProps = {
  children: (
    prompt: IntakeFolderPrompt & {
      recreateLabel: string;
      flattenLabel: string;
    },
  ) => React.ReactNode;
};

/** Renders `children` while a folder drop asks whether to recreate its structure. */
export function IntakeFolderPrompt({ children }: IntakeFolderPromptProps) {
  const { prompt } = useIntake();
  const { messages, format } = useMediaMessages();
  if (!prompt) return null;
  return (
    <>
      {children({
        ...prompt,
        recreateLabel: messages.intake.recreate(
          { folders: prompt.folders, files: prompt.files },
          format,
        ),
        flattenLabel: messages.intake.flatten,
      })}
    </>
  );
}

export type IntakeReadingProps = UseRenderComponentProps<
  'div',
  { count: number }
>;

/** "Reading folder… 340 files" while a dropped folder is traversed (`role="status"`). */
export function IntakeReading(props: IntakeReadingProps) {
  const { render, children, ...rest } = props;
  const { reading } = useIntake();
  const { messages, format } = useMediaMessages();
  const element = useRender({
    defaultTagName: 'div',
    render,
    state: { count: reading ?? 0 },
    props: mergeProps<'div'>(
      {
        role: 'status',
        children:
          children ?? messages.intake.reading({ count: reading ?? 0 }, format),
      },
      rest,
    ),
  });
  return reading === null ? null : element;
}
