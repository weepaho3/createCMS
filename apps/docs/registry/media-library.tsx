'use client';

// Styled wrappers for the Media.* parts. Does not render Media.Root;
// MediaLibraryLayout and every wrapper below must sit inside one.

import type {
  MediaAsset,
  MediaBulkResult,
  MediaMessages,
  MediaSortBy,
  MediaSortDirection,
  MediaType,
  MediaUploadEntry,
} from '@createcms/react/media';

import {
  Media,
  mediaErrorMessage,
  mediaTypeOf,
  useMediaLibrary,
  useMediaMessages,
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
  label: Exclude<keyof MediaMessages['sort'], 'label'>;
  sortBy: MediaSortBy;
  sortDirection: MediaSortDirection;
}> = [
  {
    value: 'createdAt:desc',
    label: 'newest',
    sortBy: 'createdAt',
    sortDirection: 'desc',
  },
  {
    value: 'createdAt:asc',
    label: 'oldest',
    sortBy: 'createdAt',
    sortDirection: 'asc',
  },
  {
    value: 'slug:asc',
    label: 'nameAsc',
    sortBy: 'slug',
    sortDirection: 'asc',
  },
  {
    value: 'slug:desc',
    label: 'nameDesc',
    sortBy: 'slug',
    sortDirection: 'desc',
  },
  {
    value: 'size:asc',
    label: 'sizeAsc',
    sortBy: 'size',
    sortDirection: 'asc',
  },
  {
    value: 'size:desc',
    label: 'sizeDesc',
    sortBy: 'size',
    sortDirection: 'desc',
  },
];

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

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

// --- Breadcrumbs ---------------------------------------------------------------

function MediaBreadcrumbs({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Media.Breadcrumbs>, 'children'>) {
  const { messages: t } = useMediaMessages();
  return (
    <Media.Breadcrumbs
      data-slot="media-breadcrumbs"
      aria-label={t.folder.path}
      className={cn('min-w-0', className)}
      render={<Breadcrumb />}
      {...props}
    >
      {(path) => (
        <BreadcrumbList>
          <MediaCrumb folder={null}>{t.folder.root}</MediaCrumb>
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
        className={className}
        {...props}
        render={(crumbProps, state) =>
          state.current ? (
            <BreadcrumbPage className={crumbProps.className} data-current="">
              {crumbProps.children}
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              render={
                <button
                  type="button"
                  {...crumbProps}
                  className={cn('cursor-pointer', crumbProps.className)}
                />
              }
            />
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
  const { messages: t } = useMediaMessages();
  return (
    <Media.Search
      data-slot="media-search"
      placeholder={t.search.label}
      aria-label={t.search.label}
      className={cn('w-full sm:w-56', className)}
      render={<Input />}
      {...props}
    />
  );
}

function MediaSortSelect({ className }: { className?: string }) {
  const { messages: t } = useMediaMessages();
  const { sortBy, sortDirection, setSort } = useMediaLibrary();
  const value = `${sortBy}:${sortDirection}`;

  return (
    <Select
      value={value}
      items={SORT_OPTIONS.map((option) => ({
        value: option.value,
        label: t.sort[option.label],
      }))}
      onValueChange={(next) => {
        const option = SORT_OPTIONS.find((entry) => entry.value === next);
        if (option) setSort(option.sortBy, option.sortDirection);
      }}
    >
      <SelectTrigger
        data-slot="media-sort"
        aria-label={t.sort.label}
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
  const { messages: t } = useMediaMessages();
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

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) clearMutationError();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            data-slot="media-new-folder"
            className={cn(className)}
          >
            <FolderPlusIcon data-icon="inline-start" aria-hidden="true" />
            {t.folder.create}
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
            <DialogTitle>{t.folder.createTitle}</DialogTitle>
            <DialogDescription>{t.folder.createDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              {t.folder.name}
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
              onClick={() => onOpenChange(false)}
            >
              {t.action.cancel}
            </Button>
            <Button type="submit" disabled={pending || name.trim() === ''}>
              {pending ? (
                <LoaderCircleIcon
                  data-icon="inline-start"
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {t.action.create}
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
  const { messages: t, format } = useMediaMessages();
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
        <Badge variant="secondary">{t.type[type]}</Badge>
        {asset.status === 'private' ? (
          <Badge variant="outline" data-slot="media-asset-status">
            {t.visibility.private}
          </Badge>
        ) : null}
        <span className="text-muted-foreground text-xs tabular-nums">
          {format.bytes(asset.size)}
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
  const { messages: t } = useMediaMessages();
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
              ? t.dropzone.uploading
              : dragActive
                ? t.dropzone.active
                : t.dropzone.idle}
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
  const { messages: t } = useMediaMessages();
  const { files } = useMediaUploads();
  if (files.length === 0) return null;

  return (
    <section
      data-slot="media-upload-list"
      aria-label={t.upload.title}
      className={cn(
        'bg-card flex flex-col gap-3 rounded-lg border p-3',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t.upload.title}</h3>
        <div className="flex gap-1">
          <Media.UploadAbort
            render={<Button type="button" variant="ghost" size="sm" />}
          >
            {t.upload.abort}
          </Media.UploadAbort>
          <Media.UploadClear
            render={<Button type="button" variant="ghost" size="sm" />}
          >
            {t.upload.clear}
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
                {entry.status === 'error'
                  ? mediaErrorMessage(t, entry.error?.code)
                  : t.upload.status[entry.status]}
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

const MEDIA_EMPTY_CLASS =
  'text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm';

function MediaEmpty({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Media.Empty>) {
  const { messages: t } = useMediaMessages();
  return (
    <Media.Empty
      data-slot="media-empty"
      className={cn(MEDIA_EMPTY_CLASS, className)}
      {...props}
    >
      {children ?? t.list.empty}
    </Media.Empty>
  );
}

function MediaError({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Media.Error>, 'children'>) {
  const { messages: t } = useMediaMessages();
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
          <AlertTitle>{t.list.loadError}</AlertTitle>
          <AlertDescription>
            {mediaErrorMessage(t, errorCode(error))}
          </AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              {t.action.retry}
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
  const { messages: t } = useMediaMessages();
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
          <AlertTitle>{t.list.mutationError}</AlertTitle>
          <AlertDescription>
            {mediaErrorMessage(t, errorCode(error))}
          </AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="sm" onClick={dismiss}>
              {t.action.dismiss}
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
  const { messages: t } = useMediaMessages();
  return (
    <Media.LoadMore
      data-slot="media-load-more"
      className={cn('self-center not-data-has-more:hidden', className)}
      render={<Button type="button" variant="outline" />}
      {...props}
    >
      {children ?? t.action.loadMore}
    </Media.LoadMore>
  );
}

// --- Selection bar -------------------------------------------------------------

function MediaSelectionBar({ className }: { className?: string }) {
  const { messages: t, format } = useMediaMessages();
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
      aria-label={t.selection.count({ count: ids.length }, format)}
      className={cn(
        'bg-card sticky bottom-2 flex flex-wrap items-center gap-2 rounded-lg border p-2 shadow-md',
        className,
      )}
    >
      <span className="px-1 text-sm font-medium">
        {t.selection.count({ count: ids.length }, format)}
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
              {t.action.move}
            </Button>
          }
        />
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.action.moveTitle}</DialogTitle>
            <DialogDescription>{t.action.moveDescription}</DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {[
              { id: null, name: t.folder.root },
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
        {t.action.makePublic}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => void run(() => setStatus(ids, 'private'))}
      >
        {t.action.makePrivate}
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
              {t.action.archive}
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.action.archiveTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.action.archiveDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">
              {t.action.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={() => void run(() => archive(ids))}
            >
              {t.action.archive}
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
        {t.action.clearSelection}
      </Button>
      {skipped > 0 ? (
        <p
          data-slot="media-skipped"
          role="status"
          className="text-muted-foreground basis-full px-1 text-xs"
        >
          {t.bulk.skipped({ count: skipped }, format)}
        </p>
      ) : null}
      <p
        data-slot="media-visibility-hint"
        className="text-muted-foreground basis-full px-1 text-xs"
      >
        {t.visibility.hint}
      </p>
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
  MEDIA_EMPTY_CLASS,
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
