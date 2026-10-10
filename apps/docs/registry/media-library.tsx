'use client';

// Styled wrappers for the Media.* parts. Does not render Media.Root;
// MediaLibraryLayout and every wrapper below must sit inside one.

import type {
  MediaAsset,
  MediaBulkResult,
  MediaSortBy,
  MediaSortDirection,
  MediaType,
  MediaUploadEntry,
} from '@createcms/react/media';

import {
  Media,
  mediaTypeOf,
  useMediaLibrary,
  useMediaSelection,
  useMediaUploads,
} from '@createcms/react/media';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  FileIcon,
  FileTextIcon,
  FilmIcon,
  FolderIcon,
  FolderPlusIcon,
  ImageIcon,
  LoaderCircleIcon,
  MusicIcon,
  UploadIcon,
} from 'lucide-react';
import * as React from 'react';

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export const MEDIA_LABELS = {
  breadcrumbs: 'Folder path',
  root: 'Library',
  search: 'Search assets',
  sort: 'Sort',
  sortNewest: 'Newest first',
  sortOldest: 'Oldest first',
  sortNameAsc: 'Name A–Z',
  sortNameDesc: 'Name Z–A',
  sortSizeAsc: 'Smallest first',
  sortSizeDesc: 'Largest first',
  newFolder: 'New folder',
  newFolderTitle: 'Create folder',
  newFolderDescription: 'The folder is created inside the current folder.',
  folderName: 'Folder name',
  create: 'Create',
  cancel: 'Cancel',
  dropzone: 'Drop files here or click to upload',
  dropzoneActive: 'Release to upload',
  dropzoneUploading: 'Uploading…',
  empty: 'No assets in this folder.',
  loadError: 'Could not load assets.',
  retry: 'Retry',
  mutationError: 'The last change failed.',
  dismiss: 'Dismiss',
  loadMore: 'Load more',
  uploads: 'Uploads',
  abortUploads: 'Cancel uploads',
  clearUploads: 'Clear finished',
  selected: (count: number) => `${count} selected`,
  clearSelection: 'Clear',
  moveToFolder: 'Move to folder',
  moveTitle: 'Move assets',
  moveDescription: 'Choose a destination for the selected assets.',
  makePublic: 'Make public',
  makePrivate: 'Make private',
  archive: 'Archive',
  archiveTitle: 'Archive assets?',
  archiveDescription:
    'Archived assets stop being served. Assets referenced by content are skipped.',
  skipped: (count: number) =>
    count === 1
      ? '1 asset was skipped because it is in use'
      : `${count} assets were skipped because they are in use`,
  private: 'Private',
  type: {
    image: 'Image',
    video: 'Video',
    audio: 'Audio',
    document: 'Document',
    other: 'File',
  } satisfies Record<MediaType, string>,
  uploadStatus: {
    pending: 'Queued',
    uploading: 'Uploading',
    success: 'Uploaded',
    error: 'Failed',
    aborted: 'Cancelled',
  } satisfies Record<MediaUploadEntry['status'], string>,
};

const TYPE_ICONS: Record<
  MediaType,
  React.ComponentType<{ className?: string }>
> = {
  image: ImageIcon,
  video: FilmIcon,
  audio: MusicIcon,
  document: FileTextIcon,
  other: FileIcon,
};

const SORT_OPTIONS: Array<{
  value: string;
  label: string;
  sortBy: MediaSortBy;
  sortDirection: MediaSortDirection;
}> = [
  {
    value: 'createdAt:desc',
    label: MEDIA_LABELS.sortNewest,
    sortBy: 'createdAt',
    sortDirection: 'desc',
  },
  {
    value: 'createdAt:asc',
    label: MEDIA_LABELS.sortOldest,
    sortBy: 'createdAt',
    sortDirection: 'asc',
  },
  {
    value: 'slug:asc',
    label: MEDIA_LABELS.sortNameAsc,
    sortBy: 'slug',
    sortDirection: 'asc',
  },
  {
    value: 'slug:desc',
    label: MEDIA_LABELS.sortNameDesc,
    sortBy: 'slug',
    sortDirection: 'desc',
  },
  {
    value: 'size:asc',
    label: MEDIA_LABELS.sortSizeAsc,
    sortBy: 'size',
    sortDirection: 'asc',
  },
  {
    value: 'size:desc',
    label: MEDIA_LABELS.sortSizeDesc,
    sortBy: 'size',
    sortDirection: 'desc',
  },
];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Mirrors the `accept` attribute for a listed asset: `.ext` against the slug, `type/*` and exact types against the MIME type. */
export function matchesAccept(
  accept: string | undefined,
  asset: Pick<MediaAsset, 'mimeType' | 'slug'>,
): boolean {
  if (!accept) return true;
  const rules = accept
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const type = asset.mimeType.toLowerCase();
  const name = asset.slug.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return null;
}

// --- Breadcrumbs ---------------------------------------------------------------

function MediaBreadcrumbs({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Media.Breadcrumbs>, 'children'>) {
  return (
    <Media.Breadcrumbs
      data-slot="media-breadcrumbs"
      aria-label={MEDIA_LABELS.breadcrumbs}
      className={cn('min-w-0', className)}
      render={<Breadcrumb />}
      {...props}
    >
      {(path) => (
        <BreadcrumbList>
          <MediaCrumb folder={null}>{MEDIA_LABELS.root}</MediaCrumb>
          {path.map((folder) => (
            <React.Fragment key={folder.id}>
              <BreadcrumbSeparator />
              <MediaCrumb folder={folder} />
            </React.Fragment>
          ))}
        </BreadcrumbList>
      )}
    </Media.Breadcrumbs>
  );
}

function MediaCrumb({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Media.Crumb>, 'render'>) {
  return (
    <BreadcrumbItem data-slot="media-crumb">
      <Media.Crumb
        className={cn('cursor-pointer', className)}
        {...props}
        render={(crumbProps, state) =>
          state.current ? (
            <BreadcrumbPage className={crumbProps.className}>
              {crumbProps.children}
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink render={<button type="button" {...crumbProps} />} />
          )
        }
      />
    </BreadcrumbItem>
  );
}

// --- Toolbar -------------------------------------------------------------------

function MediaSearch({
  className,
  ...props
}: React.ComponentProps<typeof Media.Search>) {
  return (
    <Media.Search
      data-slot="media-search"
      placeholder={MEDIA_LABELS.search}
      aria-label={MEDIA_LABELS.search}
      className={cn('w-full sm:w-56', className)}
      render={<Input />}
      {...props}
    />
  );
}

function MediaSortSelect({ className }: { className?: string }) {
  const { sortBy, sortDirection, setSort } = useMediaLibrary();
  const value = `${sortBy}:${sortDirection}`;

  return (
    <Select
      value={value}
      items={SORT_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      }))}
      onValueChange={(next) => {
        const option = SORT_OPTIONS.find((entry) => entry.value === next);
        if (option) setSort(option.sortBy, option.sortDirection);
      }}
    >
      <SelectTrigger
        data-slot="media-sort"
        aria-label={MEDIA_LABELS.sort}
        className={cn('w-full sm:w-44', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MediaNewFolder({ className }: { className?: string }) {
  const { createFolder, clearMutationError } = useMediaLibrary();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const inputId = React.useId();

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await createFolder(trimmed);
      setName('');
      setOpen(false);
    } catch {
      // The store holds the rejection; MediaMutationError below renders it.
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) clearMutationError();
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            data-slot="media-new-folder"
            className={cn(className)}
          >
            <FolderPlusIcon data-icon="inline-start" aria-hidden="true" />
            {MEDIA_LABELS.newFolder}
          </Button>
        }
      />
      <DialogContent className="max-w-sm">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{MEDIA_LABELS.newFolderTitle}</DialogTitle>
            <DialogDescription>
              {MEDIA_LABELS.newFolderDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              {MEDIA_LABELS.folderName}
            </label>
            <Input
              id={inputId}
              value={name}
              autoFocus
              disabled={pending}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </div>
          <MediaMutationError />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              {MEDIA_LABELS.cancel}
            </Button>
            <Button type="submit" disabled={pending || name.trim() === ''}>
              {pending ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {MEDIA_LABELS.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Grid ----------------------------------------------------------------------

function MediaFolderList({
  className,
  ...props
}: React.ComponentProps<typeof Media.FolderList>) {
  return (
    <Media.FolderList
      data-slot="media-folder-list"
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 data-empty:hidden',
        className,
      )}
      {...props}
    />
  );
}

function MediaFolderCard({
  folder,
  className,
  ...props
}: React.ComponentProps<typeof Media.Folder>) {
  return (
    <li data-slot="media-folder-card" className="contents">
      <Media.Folder
        folder={folder}
        className={cn(
          'bg-card hover:bg-muted focus-visible:ring-ring/50 flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border p-3 text-left text-sm outline-none focus-visible:ring-[3px]',
          className,
        )}
        {...props}
      >
        <FolderIcon
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden="true"
        />
        <span className="truncate">{folder.name}</span>
      </Media.Folder>
    </li>
  );
}

function MediaGrid({
  className,
  ...props
}: React.ComponentProps<typeof Media.Grid>) {
  return (
    <Media.Grid
      data-slot="media-grid"
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 outline-none data-[status=loading]:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

function MediaAssetCard({
  asset,
  accept,
  className,
  ...props
}: React.ComponentProps<typeof Media.Item> & {
  /** Like the `accept` attribute; a non-matching asset renders nothing. */
  accept?: string;
}) {
  if (!matchesAccept(accept, asset)) return null;
  const type = mediaTypeOf(asset.mimeType);
  const Icon = TYPE_ICONS[type];

  return (
    <Media.Item
      asset={asset}
      data-slot="media-asset-card"
      className={cn(
        'bg-card focus-visible:ring-ring/50 flex min-w-0 flex-col gap-2 rounded-lg border p-2 outline-none focus-visible:ring-[3px]',
        'data-selected:ring-media-selection data-selected:ring-2 data-selected:ring-offset-1',
        className,
      )}
      {...props}
    >
      <div className="bg-muted flex aspect-square items-center justify-center overflow-hidden rounded-md">
        <Media.Thumbnail
          className="size-full object-cover data-error:hidden"
          fallback={
            <Icon className="text-muted-foreground size-8" aria-hidden="true" />
          }
        />
      </div>
      <span className="truncate text-sm" title={asset.slug}>
        {asset.slug}
      </span>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Badge variant="secondary">{MEDIA_LABELS.type[type]}</Badge>
        {asset.status === 'private' ? (
          <Badge variant="outline" data-slot="media-asset-status">
            {MEDIA_LABELS.private}
          </Badge>
        ) : null}
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatBytes(asset.size)}
        </span>
      </div>
    </Media.Item>
  );
}

// --- Dropzone ------------------------------------------------------------------

function MediaDropzone({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Media.Dropzone>, 'children'> & {
  children?: React.ComponentProps<typeof Media.Dropzone>['children'];
}) {
  return (
    <Media.Dropzone
      data-slot="media-dropzone"
      className={cn(
        'text-muted-foreground hover:bg-muted/50 focus-visible:ring-ring/50 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm outline-none transition-colors focus-visible:ring-[3px]',
        'data-drag-active:border-media-drop data-drag-active:ring-media-drop/40 data-drag-active:text-foreground data-drag-active:ring-2',
        'data-uploading:cursor-progress data-uploading:opacity-70',
        className,
      )}
      {...props}
    >
      {children ??
        (({ dragActive, uploading }) => (
          <>
            <UploadIcon className="size-4" aria-hidden="true" />
            {uploading
              ? MEDIA_LABELS.dropzoneUploading
              : dragActive
                ? MEDIA_LABELS.dropzoneActive
                : MEDIA_LABELS.dropzone}
          </>
        ))}
    </Media.Dropzone>
  );
}

// --- Uploads -------------------------------------------------------------------

function UploadStatusIcon({ status }: { status: MediaUploadEntry['status'] }) {
  const className = 'size-4 shrink-0';
  switch (status) {
    case 'success':
      return (
        <CircleCheckIcon
          className={cn(className, 'text-primary')}
          aria-hidden="true"
        />
      );
    case 'error':
      return (
        <CircleAlertIcon
          className={cn(className, 'text-destructive')}
          aria-hidden="true"
        />
      );
    case 'aborted':
      return (
        <CircleXIcon
          className={cn(className, 'text-muted-foreground')}
          aria-hidden="true"
        />
      );
    case 'pending':
    case 'uploading':
      return (
        <LoaderCircleIcon
          className={cn(className, 'text-muted-foreground animate-spin')}
          aria-hidden="true"
        />
      );
  }
}

function MediaUploadList({ className }: { className?: string }) {
  const { files } = useMediaUploads();
  if (files.length === 0) return null;

  return (
    <section
      data-slot="media-upload-list"
      aria-label={MEDIA_LABELS.uploads}
      className={cn(
        'bg-card flex flex-col gap-3 rounded-lg border p-3',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{MEDIA_LABELS.uploads}</h3>
        <div className="flex gap-1">
          <Media.UploadAbort
            render={<Button type="button" variant="ghost" size="sm" />}
          >
            {MEDIA_LABELS.abortUploads}
          </Media.UploadAbort>
          <Media.UploadClear
            render={<Button type="button" variant="ghost" size="sm" />}
          >
            {MEDIA_LABELS.clearUploads}
          </Media.UploadClear>
        </div>
      </div>
      <Media.UploadList className="flex flex-col gap-2">
        {(entry) => (
          <Media.UploadItem
            key={entry.id}
            entry={entry}
            data-slot="media-upload-item"
            className="flex flex-col gap-1 text-sm"
          >
            <div className="flex items-center gap-2">
              <UploadStatusIcon status={entry.status} />
              <span className="min-w-0 flex-1 truncate" title={entry.name}>
                {entry.name}
              </span>
              <span className="text-muted-foreground text-xs">
                {entry.status === 'error' && entry.error
                  ? entry.error.message
                  : MEDIA_LABELS.uploadStatus[entry.status]}
              </span>
            </div>
            <Media.UploadProgress
              className="data-[status=aborted]:opacity-50 data-[status=error]:[&_[data-slot=progress-indicator]]:bg-destructive"
              render={<Progress value={Math.round(entry.progress * 100)} />}
            />
          </Media.UploadItem>
        )}
      </Media.UploadList>
    </section>
  );
}

// --- States --------------------------------------------------------------------

function MediaEmpty({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Media.Empty>) {
  return (
    <Media.Empty
      data-slot="media-empty"
      className={cn(
        'text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm',
        className,
      )}
      {...props}
    >
      {children ?? MEDIA_LABELS.empty}
    </Media.Empty>
  );
}

function MediaError({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Media.Error>, 'children'>) {
  return (
    <Media.Error
      data-slot="media-error"
      className={cn(className)}
      render={<Alert variant="destructive" />}
      {...props}
    >
      {({ error, retry }) => (
        <>
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{MEDIA_LABELS.loadError}</AlertTitle>
          {errorMessage(error) ? (
            <AlertDescription>{errorMessage(error)}</AlertDescription>
          ) : null}
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              {MEDIA_LABELS.retry}
            </Button>
          </AlertAction>
        </>
      )}
    </Media.Error>
  );
}

function MediaMutationError({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Media.MutationError>, 'children'>) {
  return (
    <Media.MutationError
      data-slot="media-mutation-error"
      className={cn(className)}
      render={<Alert variant="destructive" />}
      {...props}
    >
      {({ error, dismiss }) => (
        <>
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{MEDIA_LABELS.mutationError}</AlertTitle>
          {errorMessage(error) ? (
            <AlertDescription>{errorMessage(error)}</AlertDescription>
          ) : null}
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={dismiss}>
              {MEDIA_LABELS.dismiss}
            </Button>
          </AlertAction>
        </>
      )}
    </Media.MutationError>
  );
}

function MediaLoadMore({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Media.LoadMore>) {
  return (
    <Media.LoadMore
      data-slot="media-load-more"
      className={cn('self-center not-data-has-more:hidden', className)}
      render={<Button type="button" variant="outline" />}
      {...props}
    >
      {children ?? MEDIA_LABELS.loadMore}
    </Media.LoadMore>
  );
}

// --- Selection bar -------------------------------------------------------------

function MediaSelectionBar({ className }: { className?: string }) {
  const { selected, clear } = useMediaSelection();
  const { folders, move, setStatus, archive } = useMediaLibrary();
  const [pending, setPending] = React.useState(false);
  const [skipped, setSkipped] = React.useState(0);
  const [moveOpen, setMoveOpen] = React.useState(false);

  React.useEffect(() => {
    if (selected.length === 0) setSkipped(0);
  }, [selected.length]);

  if (selected.length === 0) return null;

  const run = async (action: () => Promise<MediaBulkResult>) => {
    if (pending) return;
    setPending(true);
    setSkipped(0);
    try {
      const result = await action();
      setSkipped(result.skipped.length);
    } catch {
      // The store holds the rejection; MediaMutationError renders it.
    } finally {
      setPending(false);
    }
  };

  const ids = selected;

  return (
    <div
      data-slot="media-selection-bar"
      role="toolbar"
      aria-label={MEDIA_LABELS.selected(ids.length)}
      className={cn(
        'bg-card sticky bottom-2 flex flex-wrap items-center gap-2 rounded-lg border p-2 shadow-md',
        className,
      )}
    >
      <span className="px-1 text-sm font-medium">
        {MEDIA_LABELS.selected(ids.length)}
      </span>
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
            >
              {MEDIA_LABELS.moveToFolder}
            </Button>
          }
        />
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{MEDIA_LABELS.moveTitle}</DialogTitle>
            <DialogDescription>
              {MEDIA_LABELS.moveDescription}
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {[
              { id: null, name: MEDIA_LABELS.root },
              ...folders.map((folder) => ({
                id: folder.id,
                name: folder.name,
              })),
            ].map((target) => (
              <li key={target.id ?? 'root'}>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={pending}
                  onClick={() => {
                    setMoveOpen(false);
                    void run(() => move(ids, target.id));
                  }}
                >
                  <FolderIcon data-icon="inline-start" aria-hidden="true" />
                  {target.name}
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void run(() => setStatus(ids, 'public'))}
      >
        {MEDIA_LABELS.makePublic}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void run(() => setStatus(ids, 'private'))}
      >
        {MEDIA_LABELS.makePrivate}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
            >
              {MEDIA_LABELS.archive}
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{MEDIA_LABELS.archiveTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {MEDIA_LABELS.archiveDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">
              {MEDIA_LABELS.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={() => void run(() => archive(ids))}
            >
              {MEDIA_LABELS.archive}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto"
        disabled={pending}
        onClick={clear}
      >
        {MEDIA_LABELS.clearSelection}
      </Button>
      {skipped > 0 ? (
        <p
          data-slot="media-skipped"
          role="status"
          className="text-muted-foreground basis-full px-1 text-xs"
        >
          {MEDIA_LABELS.skipped(skipped)}
        </p>
      ) : null}
    </div>
  );
}

// --- Layout --------------------------------------------------------------------

/** Default composition of every wrapper above; must be rendered inside Media.Root. */
function MediaLibraryLayout({ className }: { className?: string }) {
  return (
    <div
      data-slot="media-library"
      className={cn('flex flex-col gap-4', className)}
    >
      <div
        data-slot="media-toolbar"
        className="flex flex-wrap items-center gap-2"
      >
        <MediaBreadcrumbs className="mr-auto" />
        <MediaSearch />
        <MediaSortSelect />
        <MediaNewFolder />
      </div>
      <MediaError />
      <MediaMutationError />
      <MediaDropzone />
      <MediaFolderList>
        {(folder) => <MediaFolderCard key={folder.id} folder={folder} />}
      </MediaFolderList>
      <MediaGrid>
        {(asset) => <MediaAssetCard key={asset.id} asset={asset} />}
      </MediaGrid>
      <MediaEmpty />
      <MediaLoadMore />
      <MediaUploadList />
      <MediaSelectionBar />
    </div>
  );
}

export {
  MediaAssetCard,
  MediaBreadcrumbs,
  MediaCrumb,
  MediaDropzone,
  MediaEmpty,
  MediaError,
  MediaFolderCard,
  MediaFolderList,
  MediaGrid,
  MediaLibraryLayout,
  MediaLoadMore,
  MediaMutationError,
  MediaNewFolder,
  MediaSearch,
  MediaSelectionBar,
  MediaSortSelect,
  MediaUploadList,
};
