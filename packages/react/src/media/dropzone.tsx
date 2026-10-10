import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { MediaLibraryState, MediaUploadedAsset } from './types';

import { mergeProps, useRender } from '../use-render';
import { useMediaContext, useMediaUploadsContext } from './context';
import { useSelector } from './use-store';

export type MediaDropzoneState = { dragActive: boolean; uploading: boolean };

export type MediaRejectReason = 'type' | 'size' | 'count';

export type MediaDropzoneProps = Omit<
  UseRenderComponentProps<'button', MediaDropzoneState & { disabled: boolean }>,
  'children'
> & {
  /** Like the `accept` attribute: `.ext`, `type/*` or exact types, comma separated. */
  accept?: string;
  /** Files per drop or pick beyond this count are rejected as `count` (default 10). */
  maxFiles?: number;
  /** Bytes; larger files are rejected as `size`. */
  maxSize?: number;
  /** Target folder; defaults to the current folder of `Media.Root`. */
  folderId?: string | null;
  /** The successful uploads of one drop or pick. */
  onUploaded?: (assets: MediaUploadedAsset[]) => void;
  onRejected?: (file: File, reason: MediaRejectReason) => void;
  children: React.ReactNode | ((state: MediaDropzoneState) => React.ReactNode);
};

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

/** Mirrors the browser's `accept` matching: `.ext`, `type/*` and exact MIME types. */
export function acceptsFile(accept: string | undefined, file: File): boolean {
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

const REASON_TEXT: Record<MediaRejectReason, string> = {
  type: 'unsupported type',
  size: 'too large',
  count: 'too many files',
};

function summarize(
  uploaded: number,
  failed: number,
  rejected: MediaRejectReason[],
): string {
  const parts: string[] = [];
  if (uploaded > 0) parts.push(`${uploaded} uploaded`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (rejected.length > 0) {
    const reasons = [...new Set(rejected)].map((r) => REASON_TEXT[r]);
    parts.push(`${rejected.length} rejected: ${reasons.join(', ')}`);
  }
  return parts.join(', ');
}

const selectFolderId = (state: MediaLibraryState) => state.folderId;

/**
 * A `button` that opens a file picker and accepts drops. Files are checked
 * against `accept`, `maxSize` and `maxFiles` before `upload()` runs; the
 * button is `aria-disabled` (never `disabled`) and ignores drops while an
 * upload is in flight. The result summary of the last attempt lives in a
 * polite `output` referenced by `aria-describedby`.
 */
export function MediaDropzone(props: MediaDropzoneProps) {
  const {
    accept,
    maxFiles = 10,
    maxSize,
    folderId: folderIdProp,
    onUploaded,
    onRejected,
    children,
    render,
    ...rest
  } = props;
  const { store } = useMediaContext('Media.Dropzone');
  const uploads = useMediaUploadsContext('Media.Dropzone');
  const currentFolderId = useSelector(store, selectFolderId, Object.is);
  const folderId = folderIdProp === undefined ? currentFolderId : folderIdProp;

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const depth = React.useRef(0);
  const [dragActive, setDragActive] = React.useState(false);
  const [summary, setSummary] = React.useState<{
    attempt: number;
    text: string;
  }>({ attempt: 0, text: '' });
  const uploading = uploads.isUploading;
  const summaryId = `${React.useId()}-summary`;

  const callbacksRef = React.useRef({ onUploaded, onRejected });
  React.useLayoutEffect(() => {
    callbacksRef.current = { onUploaded, onRejected };
  });

  const submit = async (incoming: File[]): Promise<void> => {
    if (uploading || incoming.length === 0) return;
    const rejected: MediaRejectReason[] = [];
    const reject = (file: File, reason: MediaRejectReason) => {
      rejected.push(reason);
      callbacksRef.current.onRejected?.(file, reason);
    };
    const accepted: File[] = [];
    for (const file of incoming) {
      if (!acceptsFile(accept, file)) reject(file, 'type');
      else if (maxSize !== undefined && file.size > maxSize)
        reject(file, 'size');
      else if (accepted.length >= maxFiles) reject(file, 'count');
      else accepted.push(file);
    }

    let uploaded = 0;
    let failed = 0;
    if (accepted.length > 0) {
      try {
        const entries = await uploads.upload(
          accepted,
          folderId ? { folderId } : undefined,
        );
        const results: MediaUploadedAsset[] = [];
        for (const entry of entries) {
          if (entry.status === 'success' && entry.result) {
            results.push(entry.result);
          } else {
            failed++;
          }
        }
        uploaded = results.length;
        if (results.length > 0) callbacksRef.current.onUploaded?.(results);
      } catch {
        failed = accepted.length;
      }
    }
    setSummary((prev) => ({
      attempt: prev.attempt + 1,
      text: summarize(uploaded, failed, rejected),
    }));
  };

  const resetDrag = () => {
    depth.current = 0;
    setDragActive(false);
  };

  const state: MediaDropzoneState & { disabled: boolean } = {
    dragActive,
    uploading,
    disabled: uploading,
  };

  const button = useRender({
    defaultTagName: 'button',
    render,
    state,
    props: mergeProps<'button'>(
      {
        type: 'button',
        'aria-disabled': uploading ? 'true' : undefined,
        'aria-describedby': summary.text ? summaryId : undefined,
        onClick: () => {
          if (!uploading) inputRef.current?.click();
        },
        onDragEnter: (event: React.DragEvent) => {
          event.preventDefault();
          depth.current += 1;
          if (depth.current === 1) setDragActive(true);
        },
        onDragLeave: () => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragActive(false);
        },
        onDragOver: (event: React.DragEvent) => {
          event.preventDefault();
        },
        onDrop: (event: React.DragEvent) => {
          event.preventDefault();
          const files = Array.from(event.dataTransfer?.files ?? []);
          resetDrag();
          void submit(files);
        },
      },
      rest,
      {
        children: typeof children === 'function' ? children(state) : children,
      },
    ),
  });

  return (
    <>
      {button}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={maxFiles > 1}
        tabIndex={-1}
        aria-hidden="true"
        style={{ display: 'none' }}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void submit(files);
        }}
      />
      <output
        key={summary.attempt}
        id={summaryId}
        aria-live="polite"
        style={VISUALLY_HIDDEN}
      >
        {summary.text}
      </output>
    </>
  );
}
