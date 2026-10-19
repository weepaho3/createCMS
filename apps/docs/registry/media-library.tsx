'use client';

// Styled wrappers for the Media.* parts. Does not render Media.Root;
// MediaLibraryLayout and every wrapper below must sit inside one.

import type {
  MediaAsset,
  MediaMessages,
  MediaType,
  MediaUploadEntry,
} from '@createcms/react/media';
import type {
  ConfirmDescriptor,
  FilterSort,
} from '@createcms/react/media/core';

import {
  Bulk,
  Download,
  Filter,
  Folder,
  Intake,
  Media,
  Picker,
  Preview,
  Selection,
  Upload,
  mediaErrorMessage,
  mediaTypeOf,
  useDownloads,
  useMediaFacets,
  useMediaContext,
  useMediaFilter,
  useMediaMessages,
  useMediaSelection,
  useMediaUploads,
  usePickerItem,
  usePreview,
} from '@createcms/react/media';
import {
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  CircleXIcon,
  FileIcon,
  FileTextIcon,
  FilmIcon,
  DownloadIcon,
  EllipsisIcon,
  EyeIcon,
  FolderIcon,
  FolderInputIcon,
  InfoIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  FolderPlusIcon,
  ImageIcon,
  LoaderCircleIcon,
  MusicIcon,
  RotateCwIcon,
  UploadIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
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
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { MediaDetailPanel } from './media-detail';
import { TreeToggle, treeClassName, treeItemClassName } from './tree';

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
  value: FilterSort;
  label: Exclude<keyof MediaMessages['sort'], 'label'>;
}> = [
  { value: 'created_desc', label: 'newest' },
  { value: 'created_asc', label: 'oldest' },
  { value: 'name_asc', label: 'nameAsc' },
  { value: 'size_desc', label: 'sizeDesc' },
];

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
      className={cn('min-w-0', className)}
      render={<Breadcrumb />}
      {...props}
    >
      {({ head, overflow, tail }) => (
        <BreadcrumbList>
          <MediaCrumb folder={null}>{t.folder.root}</MediaCrumb>
          {head.map((folder) => (
            <React.Fragment key={folder.id}>
              <BreadcrumbSeparator />
              <MediaCrumb folder={folder} />
            </React.Fragment>
          ))}
          {overflow.length > 0 ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={t.folder.overflow}
                    render={<button type="button" className="cursor-pointer" />}
                  >
                    <BreadcrumbEllipsis />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {overflow.map((folder) => (
                      <Media.Crumb
                        key={folder.id}
                        folder={folder}
                        render={<DropdownMenuItem />}
                      />
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </BreadcrumbItem>
            </>
          ) : null}
          {tail.map((folder) => (
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
        className={cn(
          'rounded-sm data-drop-over:ring-media-drop data-drop-over:ring-2',
          className,
        )}
        {...props}
        render={(crumbProps, state) =>
          state.current ? (
            <BreadcrumbPage
              className={crumbProps.className}
              data-current=""
              onDragEnter={crumbProps.onDragEnter}
              onDragOver={crumbProps.onDragOver}
              onDragLeave={crumbProps.onDragLeave}
              onDrop={crumbProps.onDrop}
            >
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
      className={cn('w-full sm:w-56', className)}
      render={<Input />}
      {...props}
    />
  );
}

function MediaSortSelect({ className }: { className?: string }) {
  const { messages: t } = useMediaMessages();
  const { filter, set } = useMediaFilter();
  return (
    <Select
      value={filter.sort}
      items={SORT_OPTIONS.map((option) => ({
        value: option.value,
        label: t.sort[option.label],
      }))}
      onValueChange={(next) => {
        const option = SORT_OPTIONS.find((entry) => entry.value === next);
        if (option) set({ sort: option.value });
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
            {t.sort[option.label]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MediaNewFolder({ className }: { className?: string }) {
  const { messages: t } = useMediaMessages();
  const [creating, setCreating] = React.useState(false);
  if (creating) {
    return (
      <Folder.Create
        data-slot="media-new-folder-input"
        className={cn('w-44', className)}
        render={<Input />}
        onDone={() => setCreating(false)}
      />
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      data-slot="media-new-folder"
      className={cn(className)}
      onClick={() => setCreating(true)}
    >
      <FolderPlusIcon data-icon="inline-start" aria-hidden="true" />
      {t.folder.create}
    </Button>
  );
}

const CHIP_CLASS =
  'rounded-full border px-3 py-1 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-primary aria-pressed:text-primary-foreground';

function MediaFilterBar({ className }: { className?: string }) {
  const facets = useMediaFacets();
  return (
    <div
      data-slot="media-filters"
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {(['image', 'video', 'document'] as const).map((kind) => (
        <Filter.Chip
          key={kind}
          dimension="kinds"
          value={kind}
          facets={facets}
          className={CHIP_CLASS}
        />
      ))}
      <Filter.Chip
        dimension="provenance"
        value="ai_generated"
        facets={facets}
        className={CHIP_CLASS}
      />
      <Filter.Chip dimension="usage" value="unused" className={CHIP_CLASS} />
      <Filter.Chip dimension="missingAlt" value={true} className={CHIP_CLASS} />
      <Filter.Clear
        render={<Button type="button" variant="ghost" size="sm" />}
      />
      <Filter.Scope className="text-muted-foreground basis-full text-xs">
        {({ label, searchAll, allLabel }) => (
          <>
            {label}{' '}
            <button type="button" className="underline" onClick={searchAll}>
              {allLabel}
            </button>
          </>
        )}
      </Filter.Scope>
    </div>
  );
}

// --- Folder tree -----------------------------------------------------------------

function MediaFolderTree({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Folder.Tree>, 'children'>) {
  return (
    <Folder.Tree
      data-slot="media-folder-tree"
      indent={12}
      // The empty space below the rows takes drops into the root.
      className={cn(treeClassName, 'min-h-24 pb-6', className)}
      {...props}
    >
      {(row) => (
        <Folder.Item
          row={row}
          // `aria-selected` marks the open folder, or the picked one.
          className={treeItemClassName}
        >
          <TreeToggle />
          <FolderIcon
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
          <span className="truncate">{row.name}</span>
          <Folder.Rename className="h-7" render={<Input />} />
        </Folder.Item>
      )}
    </Folder.Tree>
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
          'data-drop-over:ring-media-drop data-drop-over:ring-2 data-drop-flash:bg-primary/10',
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
      minCell={144}
      gap={12}
      className={cn(
        'outline-none transition-opacity data-[status=refreshing]:opacity-60',
        className,
      )}
      renderUpload={(entry) => <MediaUploadTile key={entry.id} entry={entry} />}
      {...props}
    />
  );
}

function MediaUploadTile({ entry }: { entry: MediaUploadEntry }) {
  return (
    <Media.UploadTile
      data-slot="media-upload-tile"
      className="bg-card flex flex-col gap-2 overflow-hidden rounded-lg border p-2 opacity-80"
    >
      <div className="bg-muted flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md">
        <Media.UploadPreview className="size-full object-cover" />
      </div>
      <Progress value={Math.round(entry.progress * 100)} />
    </Media.UploadTile>
  );
}

/** What `MediaLibraryLayout` offers the cards' actions menu. */
const MediaLayoutContext = React.createContext<{
  /** Shows the details of `assetId`; `name` focuses its file name field. */
  openDetails: (assetId: string, focus?: 'name') => void;
  trash: boolean;
} | null>(null);

/**
 * The entries of an asset's actions menu, for the `⋯` button and the
 * right click alike. They act on the selection when the asset is part of
 * a larger one (as Finder does), else on the asset alone.
 */
function MediaAssetMenuItems({
  asset,
  itemId,
  confirm,
  onMove,
}: {
  asset: MediaAsset;
  itemId: string | undefined;
  confirm: (descriptor: ConfirmDescriptor) => Promise<boolean>;
  onMove: () => void;
}) {
  const { messages: t } = useMediaMessages();
  const { store } = useMediaContext('MediaAssetMenuItems');
  const layout = React.useContext(MediaLayoutContext);
  const trash = layout?.trash ?? false;
  return (
    <>
      <DropdownMenuItem
        onClick={() =>
          void store.dispatch({ type: 'openPreview', id: asset.id })
        }
      >
        <EyeIcon aria-hidden="true" />
        {t.action.preview}
      </DropdownMenuItem>
      {layout ? (
        <DropdownMenuItem onClick={() => layout.openDetails(asset.id)}>
          <InfoIcon aria-hidden="true" />
          {t.action.details}
        </DropdownMenuItem>
      ) : null}
      {layout && !trash ? (
        <DropdownMenuItem onClick={() => layout.openDetails(asset.id, 'name')}>
          <PencilIcon aria-hidden="true" />
          {t.action.rename}
        </DropdownMenuItem>
      ) : null}
      <Bulk.Action
        action="download"
        itemId={itemId}
        render={<DropdownMenuItem />}
        className="aria-disabled:opacity-50"
      >
        <DownloadIcon aria-hidden="true" />
        {t.bulk.action.download}
      </Bulk.Action>
      {trash ? null : (
        <DropdownMenuItem onClick={onMove}>
          <FolderInputIcon aria-hidden="true" />
          {t.bulk.action.move}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      {trash ? (
        <>
          <Bulk.Action
            action="restore"
            itemId={itemId}
            render={<DropdownMenuItem />}
            className="aria-disabled:opacity-50"
          >
            <RotateCcwIcon aria-hidden="true" />
            {t.bulk.action.restore}
          </Bulk.Action>
          <Bulk.Action
            action="purge"
            itemId={itemId}
            confirm={confirm}
            render={<DropdownMenuItem variant="destructive" />}
            className="aria-disabled:opacity-50"
          >
            <Trash2Icon aria-hidden="true" />
            {t.bulk.action.purge}
          </Bulk.Action>
        </>
      ) : (
        <Bulk.Action
          action="archive"
          itemId={itemId}
          confirm={confirm}
          render={<DropdownMenuItem variant="destructive" />}
          className="aria-disabled:opacity-50"
        >
          <Trash2Icon aria-hidden="true" />
          {t.bulk.action.archive}
        </Bulk.Action>
      )}
    </>
  );
}

/**
 * The actions of one asset: a `⋯` button on the tile and the same menu on
 * right click (pointers with hover only; touch has the button). Opening it
 * on an unselected asset selects that asset first.
 */
function MediaAssetActions({
  asset,
  children,
}: {
  asset: MediaAsset;
  children: React.ReactNode;
}) {
  const { messages: t, format } = useMediaMessages();
  const selection = useMediaSelection();
  const { confirm, dialog } = useConfirmDialog();
  const [moveOpen, setMoveOpen] = React.useState(false);
  const hover = useMediaQuery('(hover: hover)');
  const inGroup =
    selection.selected.includes(asset.id) && selection.selected.length > 1;
  const itemId = inGroup ? undefined : asset.id;
  const onOpenChange = (open: boolean) => {
    if (open && !selection.selected.includes(asset.id))
      selection.select(asset.id);
  };
  const name = asset.originalName ?? asset.slug;
  const items = (
    <MediaAssetMenuItems
      asset={asset}
      itemId={itemId}
      confirm={confirm}
      onMove={() => setMoveOpen(true)}
    />
  );
  return (
    <>
      <ContextMenu onOpenChange={onOpenChange} disabled={!hover}>
        <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
        <ContextMenuContent>{items}</ContextMenuContent>
      </ContextMenu>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          aria-label={t.action.more({ name }, format)}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className="bg-background/90 hover:bg-background absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md opacity-0 shadow-sm transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <EllipsisIcon className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
      {moveOpen ? (
        <MediaMoveDialog open onOpenChange={setMoveOpen} itemId={itemId} />
      ) : null}
      {dialog}
    </>
  );
}

function MediaAssetCard({
  asset,
  className,
  actions = false,
  ...props
}: React.ComponentProps<typeof Media.Item> & {
  /** The `⋯` and right-click actions menu (off in the picker). */
  actions?: boolean;
}) {
  const { messages: t } = useMediaMessages();
  const type = mediaTypeOf(asset.mimeType);
  const Icon = TYPE_ICONS[type];
  const picker = usePickerItem(asset);
  // Checkboxes show on hover, focus and touch, and on every card once
  // anything is selected; the selection itself reads like Finder's.
  const { selected } = useMediaSelection();
  const body = (
    <>
      <div className="bg-muted group-data-selected/card:ring-media-selection relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md group-data-selected/card:ring-2">
        <Media.Thumbnail
          className="size-full object-cover data-error:hidden"
          fallback={
            <Icon className="text-muted-foreground size-8" aria-hidden="true" />
          }
        />
        <Selection.Checkbox
          className={cn(
            'absolute top-1.5 left-1.5 size-4 accent-[var(--color-media-selection)] transition-opacity',
            selected.length > 0
              ? 'opacity-100'
              : 'opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-sm" aria-hidden="true">
          <span className="group-data-selected/card:bg-media-selection rounded px-1 group-data-selected/card:text-white">
            {asset.originalName ?? asset.slug}
          </span>
        </span>
        {asset.status === 'private' ? (
          <Badge
            variant="outline"
            data-slot="media-asset-status"
            aria-hidden="true"
          >
            {t.visibility.private}
          </Badge>
        ) : null}
        {asset.processingState && asset.processingState !== 'ready' ? (
          <Badge
            variant={
              asset.processingState === 'failed' ? 'destructive' : 'secondary'
            }
            data-slot="media-asset-processing"
          >
            {t.processing[asset.processingState]}
          </Badge>
        ) : null}
      </div>
      <Picker.Reason className="text-muted-foreground text-xs" />
    </>
  );
  return (
    <Media.Item
      asset={asset}
      data-slot="media-asset-card"
      aria-disabled={picker.disabled || undefined}
      className={cn(
        'group/card relative hover:bg-muted/60 focus-visible:ring-ring/50 flex min-w-0 flex-col gap-1.5 rounded-lg p-1.5 outline-none focus-visible:ring-[3px]',
        'data-selected:bg-media-selection/15 data-selected:hover:bg-media-selection/20',
        'aria-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {actions ? (
        <MediaAssetActions asset={asset}>{body}</MediaAssetActions>
      ) : (
        body
      )}
    </Media.Item>
  );
}

// --- Intake ------------------------------------------------------------------------

function MediaDropzone({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Intake.Dropzone>) {
  const { messages: t } = useMediaMessages();
  return (
    <Intake.Dropzone
      data-slot="media-dropzone"
      className={cn(
        'text-muted-foreground flex w-full flex-wrap items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm transition-colors',
        'data-[drag-over=window]:border-media-drop data-[drag-over=zone]:border-media-drop data-[drag-over=zone]:ring-media-drop/40 data-[drag-over=zone]:text-foreground data-[drag-over=zone]:ring-2',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <UploadIcon className="size-4" aria-hidden="true" />
          <span>{t.dropzone.idle}</span>
          <Intake.Input
            accept={props.accept}
            render={<Button type="button" variant="outline" size="sm" />}
          />
          <Intake.FolderInput
            render={<Button type="button" variant="ghost" size="sm" />}
          />
          <Intake.Camera
            className="md:hidden"
            render={<Button type="button" variant="ghost" size="sm" />}
          >
            <CameraIcon aria-hidden="true" />
            {t.upload.camera}
          </Intake.Camera>
        </>
      )}
    </Intake.Dropzone>
  );
}

function MediaDropOverlay() {
  return (
    <Intake.Overlay
      data-slot="media-drop-overlay"
      className="bg-background/80 border-media-drop text-foreground fixed inset-4 z-50 flex items-center justify-center rounded-xl border-2 border-dashed text-lg font-medium backdrop-blur-sm"
    />
  );
}

function MediaFolderPrompt() {
  return (
    <Intake.FolderPrompt>
      {({ recreate, flatten, cancel, recreateLabel, flattenLabel }) => (
        <AlertDialog open onOpenChange={(open) => (open ? null : cancel())}>
          <AlertDialogContent data-slot="media-folder-prompt">
            <AlertDialogHeader>
              <AlertDialogTitle>{recreateLabel}</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" onClick={flatten}>
                {flattenLabel}
              </AlertDialogCancel>
              <AlertDialogAction type="button" onClick={recreate}>
                {recreateLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Intake.FolderPrompt>
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
    case 'paused':
      return (
        <CirclePauseIcon
          className={cn(className, 'text-muted-foreground')}
          aria-hidden="true"
        />
      );
    case 'queued':
    case 'preparing':
    case 'signing':
    case 'uploading':
    case 'completing':
    case 'retrying':
      return (
        <LoaderCircleIcon
          className={cn(className, 'text-muted-foreground animate-spin')}
          aria-hidden="true"
        />
      );
  }
}

function MediaUploadList({ className }: { className?: string }) {
  const { messages: t, format } = useMediaMessages();
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
          <Upload.RetryAll
            render={<Button type="button" variant="ghost" size="sm" />}
          />
          <Upload.Cancel
            render={<Button type="button" variant="ghost" size="sm" />}
          >
            {t.upload.abort}
          </Upload.Cancel>
          <Upload.Clear
            render={<Button type="button" variant="ghost" size="sm" />}
          />
        </div>
      </div>
      <Upload.List className="flex flex-col gap-2">
        {(entry) => (
          <Upload.Item
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
              {entry.status === 'error' || entry.status === 'aborted' ? (
                <Upload.Retry
                  render={<Button type="button" variant="ghost" size="sm" />}
                />
              ) : null}
              {entry.status !== 'success' &&
              entry.status !== 'error' &&
              entry.status !== 'aborted' ? (
                <Upload.Cancel
                  render={
                    <Button type="button" variant="ghost" size="icon-sm" />
                  }
                >
                  <XIcon aria-hidden="true" />
                </Upload.Cancel>
              ) : null}
            </div>
            <Upload.Duplicate>
              {({ keepExisting, uploadAnyway }) => (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground mr-auto">
                    {t.upload.duplicate({ name: entry.name }, format)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => keepExisting()}
                  >
                    {t.upload.useExisting}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={uploadAnyway}
                  >
                    {t.upload.uploadAnyway}
                  </Button>
                </div>
              )}
            </Upload.Duplicate>
            <Upload.Progress
              className="data-[status=aborted]:opacity-50 data-[status=error]:[&_[data-slot=progress-indicator]]:bg-destructive"
              render={<Progress value={Math.round(entry.progress * 100)} />}
            />
          </Upload.Item>
        )}
      </Upload.List>
    </section>
  );
}

// --- Downloads -----------------------------------------------------------------

function MediaDownloadList({ className }: { className?: string }) {
  const { messages: t } = useMediaMessages();
  const { jobs, clear } = useDownloads();
  if (jobs.length === 0) return null;
  return (
    <section
      data-slot="media-download-list"
      aria-label={t.download.title}
      className={cn(
        'bg-card flex flex-col gap-3 rounded-lg border p-3',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t.download.title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          {t.download.clear}
        </Button>
      </div>
      <Download.List className="flex flex-col gap-2">
        {(job) => (
          <Download.Item
            key={job.id}
            job={job}
            className="flex flex-col gap-1 text-sm"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{job.name}</span>
              <span className="text-muted-foreground text-xs">
                {job.status === 'error'
                  ? mediaErrorMessage(t, job.error ?? undefined)
                  : t.download.status[job.status]}
              </span>
              <Download.Cancel
                render={<Button type="button" variant="ghost" size="sm" />}
              />
            </div>
            <Download.Progress
              render={
                <Progress
                  value={
                    job.total > 0
                      ? Math.round((job.loaded / job.total) * 100)
                      : 0
                  }
                />
              }
            />
          </Download.Item>
        )}
      </Download.List>
    </section>
  );
}

// --- Preview -------------------------------------------------------------------

function MediaPreview() {
  const preview = usePreview();
  const icon = 'icon-sm' as const;
  return (
    <Preview.Root
      data-slot="media-preview"
      className="bg-background/95 fixed inset-0 z-50 flex flex-col outline-none backdrop-blur"
    >
      <div className="flex items-center gap-1 border-b p-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {preview.asset?.originalName ?? preview.asset?.slug}
        </span>
        <Preview.Position className="text-muted-foreground px-2 text-xs" />
        <Preview.ZoomOut
          render={<Button type="button" variant="ghost" size={icon} />}
        >
          <ZoomOutIcon aria-hidden="true" />
        </Preview.ZoomOut>
        <Preview.ZoomIn
          render={<Button type="button" variant="ghost" size={icon} />}
        >
          <ZoomInIcon aria-hidden="true" />
        </Preview.ZoomIn>
        <Preview.Rotate
          render={<Button type="button" variant="ghost" size={icon} />}
        >
          <RotateCwIcon aria-hidden="true" />
        </Preview.Rotate>
        <Preview.Close
          render={<Button type="button" variant="ghost" size={icon} />}
        >
          <XIcon aria-hidden="true" />
        </Preview.Close>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <Preview.Prev
          className="absolute left-2 z-10"
          render={<Button type="button" variant="outline" size="icon" />}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Preview.Prev>
        <Preview.Stage className="flex size-full items-center justify-center overflow-hidden p-6 [&_video]:max-h-full [&_video]:max-w-full" />
        <Preview.Next
          className="absolute right-2 z-10"
          render={<Button type="button" variant="outline" size="icon" />}
        >
          <ChevronRightIcon aria-hidden="true" />
        </Preview.Next>
      </div>
    </Preview.Root>
  );
}

// --- States --------------------------------------------------------------------

const MEDIA_EMPTY_CLASS =
  'text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm';

function MediaEmpty({
  className,
  ...props
}: React.ComponentProps<typeof Media.Empty>) {
  return (
    <Media.Empty
      data-slot="media-empty"
      className={cn(MEDIA_EMPTY_CLASS, className)}
      {...props}
    />
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
  ...props
}: React.ComponentProps<typeof Media.LoadMore>) {
  return (
    <Media.LoadMore
      data-slot="media-load-more"
      className={cn('self-center', className)}
      render={<Button type="button" variant="outline" />}
      {...props}
    />
  );
}

// --- Selection and bulk ------------------------------------------------------------

/** A confirm dialog driven by `Bulk.Action`'s `confirm` callback. */
function useConfirmDialog() {
  const { messages: t, format } = useMediaMessages();
  const [pending, setPending] = React.useState<{
    descriptor: ConfirmDescriptor;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const confirm = React.useCallback(
    (descriptor: ConfirmDescriptor) =>
      new Promise<boolean>((resolve) => setPending({ descriptor, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const inUse = pending?.descriptor.kind === 'archiveInUse';
  const purge = pending?.descriptor.kind === 'purge';
  const word = pending?.descriptor.requireTyping;
  const count = pending?.descriptor.count ?? 0;
  const [typed, setTyped] = React.useState('');
  const confirmed = !word || typed.trim() === word;
  const dialog = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (open) return;
        setTyped('');
        close(false);
      }}
    >
      <AlertDialogContent data-slot="media-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {purge ? t.bulk.purgeTitle : t.action.archiveTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {purge
              ? t.bulk.purgeDescription({ count }, format)
              : inUse
                ? t.bulk.archiveInUse({ count }, format)
                : t.action.archiveDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {word ? (
          <label className="flex flex-col gap-1 text-sm">
            <span>{t.bulk.purgeTyping({ word }, format)}</span>
            <Input
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.currentTarget.value)}
            />
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel type="button">{t.action.cancel}</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={!confirmed}
            onClick={() => {
              setTyped('');
              close(true);
            }}
          >
            {purge
              ? t.bulk.action.purge
              : inUse
                ? t.bulk.archiveAnyway
                : t.action.archive}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, dialog };
}

/** "Move to…": a folder tree in pick mode; Enter on a folder moves there. */
function MediaMoveDialog({
  open,
  onOpenChange,
  itemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Moves this asset instead of the selection. */
  itemId?: string;
}) {
  const { messages: t } = useMediaMessages();
  const [target, setTarget] = React.useState<string | null | undefined>(
    undefined,
  );
  const moveRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-slot="media-move-dialog">
        <DialogHeader>
          <DialogTitle>{t.move.title}</DialogTitle>
          <DialogDescription>{t.move.description}</DialogDescription>
        </DialogHeader>
        <button
          type="button"
          className="hover:bg-muted data-picked:bg-primary/10 flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm"
          data-picked={target === null ? '' : undefined}
          onClick={() => setTarget(null)}
        >
          <FolderIcon className="size-4" aria-hidden="true" />
          {t.folder.root}
        </button>
        <MediaFolderTree
          mode="pick"
          value={target ?? null}
          onValueChange={setTarget}
          onConfirm={(id) => {
            setTarget(id);
            requestAnimationFrame(() => moveRef.current?.click());
          }}
          className="max-h-64 overflow-y-auto"
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t.action.cancel}
          </Button>
          <Bulk.Action
            ref={moveRef}
            action="move"
            itemId={itemId}
            input={{ folderId: target ?? null }}
            disabled={target === undefined}
            onResult={() => onOpenChange(false)}
            render={<Button type="button" />}
          >
            {t.move.confirm}
          </Bulk.Action>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediaBulkBar({
  className,
  onDetails,
  trash = false,
}: {
  className?: string;
  /** The trash view: restore and delete permanently only. */
  trash?: boolean;
  /** Shows a Details button while exactly one asset is selected. */
  onDetails?: () => void;
}) {
  const { messages: t } = useMediaMessages();
  const { selected } = useMediaSelection();
  const { confirm, dialog } = useConfirmDialog();
  const [moveOpen, setMoveOpen] = React.useState(false);
  return (
    <>
      <Selection.Bar
        data-slot="media-selection-bar"
        className={cn(
          'bg-card sticky bottom-2 flex flex-wrap items-center gap-2 rounded-lg border p-2 shadow-md',
          className,
        )}
      >
        <Selection.Count className="px-1 text-sm font-medium" />
        {onDetails && selected.length === 1 ? (
          <Button type="button" size="sm" onClick={onDetails}>
            {t.detail.title}
          </Button>
        ) : null}
        <Selection.SelectAllMatching
          render={<Button type="button" variant="link" size="sm" />}
        />
        <Bulk.Bar className="flex flex-wrap items-center gap-2">
          {(actions) =>
            actions.map(({ action }) =>
              action.id === 'move' && !trash ? (
                <Button
                  key={action.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMoveOpen(true)}
                >
                  {t.bulk.action.move}
                </Button>
              ) : action.id === 'setProvenance' ||
                (trash
                  ? !['restore', 'purge', 'download'].includes(action.id)
                  : action.id === 'restore') ? null : (
                <Bulk.Action
                  key={action.id}
                  action={action.id}
                  confirm={confirm}
                  render={
                    <Button
                      type="button"
                      variant={
                        action.id === 'archive' || action.id === 'purge'
                          ? 'destructive'
                          : 'outline'
                      }
                      size="sm"
                    />
                  }
                  className="aria-disabled:opacity-50"
                />
              ),
            )
          }
        </Bulk.Bar>
        <Selection.Clear
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
            />
          }
        />
        <Selection.Hidden className="text-muted-foreground basis-full px-1 text-xs" />
        <p
          data-slot="media-visibility-hint"
          className="text-muted-foreground basis-full px-1 text-xs"
        >
          {t.visibility.hint}
        </p>
      </Selection.Bar>
      <MediaMoveDialog open={moveOpen} onOpenChange={setMoveOpen} />
      {dialog}
    </>
  );
}

function MediaOutcome() {
  const { messages: t } = useMediaMessages();
  return (
    <Bulk.Outcome
      data-slot="media-outcome"
      className="bg-foreground text-background fixed right-4 bottom-4 z-40 flex items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-lg"
    >
      {({ message, undo, dismiss }) => (
        <>
          <span>{message}</span>
          {undo ? (
            <button
              type="button"
              className="font-medium underline"
              onClick={undo}
            >
              {t.bulk.undo}
            </button>
          ) : null}
          <button type="button" aria-label={t.action.dismiss} onClick={dismiss}>
            <CircleXIcon className="size-4" aria-hidden="true" />
          </button>
        </>
      )}
    </Bulk.Outcome>
  );
}

// --- Layout --------------------------------------------------------------------

/** Default composition of every wrapper above; must be rendered inside Media.Root. */
/** Whether `query` matches; `false` on the server and before mount. */
function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * Default composition of every wrapper above; must be rendered inside
 * Media.Root. A click selects (Finder rules), Space opens the fullscreen
 * preview. With `detail`, the selected asset's preview and details follow
 * the selection in a side column from `xl` (1280 px); below that they open
 * in a responsive dialog (a side drawer, a bottom drawer on phones) on
 * double click, Enter or the selection bar's Details button.
 */
function MediaLibraryLayout({
  className,
  detail = true,
}: {
  className?: string;
  detail?: boolean;
}) {
  const { messages: t } = useMediaMessages();
  const { store } = useMediaContext('MediaLibraryLayout');
  const preview = usePreview();
  const selection = useMediaSelection();
  const { filter, set: setFilter } = useMediaFilter();
  const trash = filter.archived === true;
  const wide = useMediaQuery('(min-width: 80rem)');
  const single = selection.selected.length === 1;
  const [sheetOpen, setSheetOpen] = React.useState(false);
  React.useEffect(() => {
    if (!single) setSheetOpen(false);
  }, [single]);
  const showSheet = detail && !wide;
  const layoutValue = React.useMemo(
    () => ({
      trash,
      openDetails: (assetId: string, focus?: 'name') => {
        selection.select(assetId);
        if (showSheet) setSheetOpen(true);
        if (focus === 'name') {
          // The panel mounts or follows the selection on the next frames.
          setTimeout(() => {
            document
              .querySelector<HTMLInputElement>('[data-slot=media-detail] input')
              ?.focus();
          }, 150);
        }
      },
    }),
    [trash, selection, showSheet],
  );
  // The trash lists archived assets of every folder; leaving it opens the root.
  const toggleTrash = () => {
    if (trash) {
      setFilter({ archived: undefined });
      void store.dispatch({ type: 'openFolder', folderId: null });
    } else {
      setFilter({
        archived: true,
        folderId: undefined,
        unfiled: undefined,
        recursive: undefined,
      });
    }
  };
  return (
    <MediaLayoutContext.Provider value={layoutValue}>
      <div
        data-slot="media-library"
        className={cn(
          'grid gap-4 md:grid-cols-[14rem_1fr]',
          detail && 'xl:grid-cols-[14rem_1fr_20rem]',
          className,
        )}
      >
        <aside className="hidden flex-col gap-1 md:flex">
          <div
            onClickCapture={() => {
              if (trash) setFilter({ archived: undefined });
            }}
          >
            <MediaFolderTree />
          </div>
          <button
            type="button"
            data-slot="media-trash"
            aria-pressed={trash}
            onClick={toggleTrash}
            className="hover:bg-muted aria-pressed:bg-muted flex items-center gap-1 rounded-md py-1 ps-1 pr-2 text-left text-sm"
          >
            <span className="size-4" aria-hidden="true" />
            <Trash2Icon
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden="true"
            />
            {t.folder.trash}
          </button>
        </aside>
        <div className="flex min-w-0 flex-col gap-4">
          <div
            data-slot="media-toolbar"
            className="flex flex-wrap items-center gap-2"
          >
            {trash ? (
              <h2 className="mr-auto text-sm font-medium">{t.folder.trash}</h2>
            ) : (
              <MediaBreadcrumbs className="mr-auto" />
            )}
            <MediaSearch />
            <MediaSortSelect />
            {trash ? null : <MediaNewFolder />}
          </div>
          <MediaFilterBar />
          <MediaError />
          <MediaMutationError />
          {trash ? (
            <p className="text-muted-foreground text-sm">
              {t.folder.trashHint}
            </p>
          ) : (
            <>
              <MediaDropzone />
              <MediaFolderList>
                {(folder) => (
                  <MediaFolderCard key={folder.id} folder={folder} />
                )}
              </MediaFolderList>
            </>
          )}
          <MediaGrid
            spaceAction="preview"
            onAction={(asset) =>
              showSheet ? setSheetOpen(true) : preview.open(asset.id)
            }
          >
            {(asset) => <MediaAssetCard key={asset.id} asset={asset} actions />}
          </MediaGrid>
          <MediaEmpty />
          <MediaLoadMore />
          <MediaUploadList />
          <MediaDownloadList />
          <MediaPreview />
          <MediaBulkBar
            trash={trash}
            onDetails={showSheet ? () => setSheetOpen(true) : undefined}
          />
          <MediaOutcome />
          <MediaDropOverlay />
          <MediaFolderPrompt />
        </div>
        {detail && wide ? (
          <MediaDetailPanel className="sticky top-4 max-h-[calc(100vh-2rem)] self-start overflow-y-auto" />
        ) : null}
        {showSheet ? (
          <ResponsiveDialog
            open={sheetOpen && single}
            onOpenChange={setSheetOpen}
            desktopDirection="right"
          >
            <ResponsiveDialogContent
              showCloseButton
              className="data-[drawer-direction=right]:w-96 data-[drawer-direction=right]:max-w-[calc(100vw-2rem)]"
            >
              <ResponsiveDialogTitle className="sr-only">
                {t.detail.title}
              </ResponsiveDialogTitle>
              <MediaDetailPanel className="rounded-none border-0 bg-transparent pt-8" />
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        ) : null}
      </div>
    </MediaLayoutContext.Provider>
  );
}

export {
  MEDIA_EMPTY_CLASS,
  MediaAssetCard,
  MediaBreadcrumbs,
  MediaBulkBar,
  MediaCrumb,
  MediaDownloadList,
  MediaDropOverlay,
  MediaDropzone,
  MediaEmpty,
  MediaError,
  MediaFilterBar,
  MediaFolderCard,
  MediaFolderList,
  MediaFolderPrompt,
  MediaFolderTree,
  MediaGrid,
  MediaLibraryLayout,
  MediaLoadMore,
  MediaMoveDialog,
  MediaMutationError,
  MediaNewFolder,
  MediaOutcome,
  MediaPreview,
  MediaSearch,
  MediaSortSelect,
  MediaUploadList,
  MediaUploadTile,
};
