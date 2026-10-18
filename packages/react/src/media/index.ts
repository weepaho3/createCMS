'use client';

// @createcms/react/media: headless media library. Parts live on namespaces
// (`Media.*`, `Selection.*`, `Bulk.*`, `Folder.*`, `Filter.*`, `Intake.*`,
// `Usage.*`); hooks and types are flat named exports. The framework-free
// store, layout, selection, filter and intake logic is
// `@createcms/react/media/core`.
import {
  MediaEmpty,
  MediaError,
  MediaLoadMore,
  MediaMutationError,
  MediaSearch,
} from './collection';
import { FilterChip, FilterClear, FilterScope } from './filter';
import {
  FolderCreate,
  FolderItem,
  FolderNameInput,
  FolderRename,
  FolderToggle,
  FolderTree,
  MediaBreadcrumbs,
  MediaCrumb,
  MediaFolder,
  MediaFolderList,
} from './folders';
import {
  MediaGrid,
  MediaItem,
  MediaMarquee,
  MediaThumbnail,
  MediaUploadPreview,
  MediaUploadTile,
} from './grid';
import { MediaImage, MediaPicture } from './image-components';
import {
  IntakeDropzone,
  IntakeFolderInput,
  IntakeFolderPrompt,
  IntakeInput,
  IntakeOverlay,
  IntakePaste,
  IntakeReading,
} from './intake';
import { MediaRoot } from './root';
import {
  BulkActionButton,
  BulkBar,
  BulkOutcomeView,
  SelectionBar,
  SelectionCheckbox,
  SelectionClear,
  SelectionCount,
  SelectionHidden,
  SelectionSelectAllMatching,
} from './selection';
import {
  MediaUploadAbort,
  MediaUploadClear,
  MediaUploadItem,
  MediaUploadList,
  MediaUploadProgress,
} from './uploads';
import {
  UsageCount,
  UsageEmpty,
  UsageItem,
  UsageList,
  UsageLoadMore,
  UsageMissingAltFilter,
  UsageOccurrence,
  UsageRoot,
  UsageScopeSwitch,
} from './usage';

export const Media = {
  Root: MediaRoot,
  Grid: MediaGrid,
  Item: MediaItem,
  Thumbnail: MediaThumbnail,
  UploadTile: MediaUploadTile,
  UploadPreview: MediaUploadPreview,
  Marquee: MediaMarquee,
  Breadcrumbs: MediaBreadcrumbs,
  Crumb: MediaCrumb,
  FolderList: MediaFolderList,
  Folder: MediaFolder,
  Search: MediaSearch,
  LoadMore: MediaLoadMore,
  Empty: MediaEmpty,
  Error: MediaError,
  MutationError: MediaMutationError,
  UploadList: MediaUploadList,
  UploadItem: MediaUploadItem,
  UploadProgress: MediaUploadProgress,
  UploadAbort: MediaUploadAbort,
  UploadClear: MediaUploadClear,
  Image: MediaImage,
  Picture: MediaPicture,
};

/** The selection: checkbox, count, bar, select all matching, hidden notice, clear. */
export const Selection = {
  Checkbox: SelectionCheckbox,
  Count: SelectionCount,
  Bar: SelectionBar,
  SelectAllMatching: SelectionSelectAllMatching,
  Hidden: SelectionHidden,
  Clear: SelectionClear,
};

/** Bulk actions from the action registry, and the result with undo. */
export const Bulk = {
  Bar: BulkBar,
  Action: BulkActionButton,
  Outcome: BulkOutcomeView,
};

/** The folder tree, inline create and rename. */
export const Folder = {
  Tree: FolderTree,
  Item: FolderItem,
  Toggle: FolderToggle,
  Rename: FolderRename,
  Create: FolderCreate,
  NameInput: FolderNameInput,
};

/** Filter chips with facet counts, clearing and the search scope. */
export const Filter = {
  Chip: FilterChip,
  Clear: FilterClear,
  Scope: FilterScope,
};

/** Getting files in: drop zone, window overlay, inputs, paste, folder prompt. */
export const Intake = {
  Dropzone: IntakeDropzone,
  Overlay: IntakeOverlay,
  Input: IntakeInput,
  FolderInput: IntakeFolderInput,
  Paste: IntakePaste,
  FolderPrompt: IntakeFolderPrompt,
  Reading: IntakeReading,
};

/** Where an asset is used: `Usage.Root` and its parts. */
export const Usage = {
  Root: UsageRoot,
  Count: UsageCount,
  ScopeSwitch: UsageScopeSwitch,
  MissingAltFilter: UsageMissingAltFilter,
  List: UsageList,
  Item: UsageItem,
  Occurrence: UsageOccurrence,
  Empty: UsageEmpty,
  LoadMore: UsageLoadMore,
};

export {
  createEditorHrefAdapter,
  invalidateAssetUsageCounts,
  useAssetUsageCounts,
  useAssetUsages,
  useUsage,
} from './usage';
export type {
  EditorHrefAdapter,
  MediaUsageItem,
  MediaUsageOccurrence,
  MediaUsagePage,
  MediaUsageScope,
  UseAssetUsagesState,
  UsageCountProps,
  UsageEmptyProps,
  UsageItemProps,
  UsageListProps,
  UsageLoadMoreProps,
  UsageMissingAltFilterProps,
  UsageOccurrenceProps,
  UsageRootProps,
  UsageScopeSwitchProps,
} from './usage';
export { useAssetImage } from './image-components';
export type { MediaImageProps } from './image-components';
export type { AssetImage, AssetImageOptions, ImageAsset } from './image';

export type { MediaRootProps } from './root';
export type {
  ItemContextValue,
  MediaGridProps,
  MediaItemProps,
  MediaMarqueeProps,
  MediaThumbnailProps,
  MediaType,
  MediaUploadPreviewProps,
  MediaUploadTileProps,
} from './grid';
export {
  assetName,
  mediaTypeOf,
  useGridLayout,
  useMediaItemContext,
} from './grid';
export type {
  MediaEmptyProps,
  MediaErrorProps,
  MediaLoadMoreProps,
  MediaMutationErrorProps,
  MediaSearchProps,
} from './collection';
export type {
  BreadcrumbPath,
  FolderCreateProps,
  FolderDeletePreview,
  FolderDeleteState,
  FolderItemProps,
  FolderNameInputProps,
  FolderRenameProps,
  FolderToggleProps,
  FolderTreeProps,
  FolderTreeState,
  MediaBreadcrumbsProps,
  MediaCrumbProps,
  MediaFolderListProps,
  MediaFolderProps,
} from './folders';
export { useFolderDelete, useFolderTree } from './folders';
export type {
  BulkActionItem,
  BulkActionProps,
  BulkBarProps,
  BulkOutcome,
  BulkOutcomeProps,
  MediaSelection,
  SelectionBarProps,
  SelectionCheckboxProps,
  SelectionClearProps,
  SelectionCountProps,
  SelectionHiddenProps,
  SelectionSelectAllMatchingProps,
} from './selection';
export { useBulkActions, useMediaSelection } from './selection';
export type {
  FilterChipProps,
  FilterClearProps,
  FilterScopeProps,
  MediaFilter,
} from './filter';
export { useMediaFacets, useMediaFilter } from './filter';
export type {
  Intake as IntakeHandler,
  IntakeDropzoneProps,
  IntakeFolderPrompt as IntakeFolderPromptState,
  IntakeFolderPromptProps,
  IntakeHandlerOptions,
  IntakeInputProps,
  IntakeOverlayProps,
  IntakePasteProps,
  IntakeReadingProps,
} from './intake';
export { useIntake, useIntakePaste } from './intake';
export type {
  DropOverlayState,
  FolderDropOptions,
  FolderDropState,
} from './dnd';
export {
  DROP_DWELL_MS,
  DROP_FLASH_MS,
  FOLDER_DRAG_TYPE,
  folderDragProps,
  useDropOverlay,
  useFolderDrop,
} from './dnd';
export type { MediaContextValue, MediaMessagesContextValue } from './context';
export {
  useMediaAnnouncer,
  useMediaContext,
  useMediaMessages,
} from './context';
export type { MediaLibrary } from './hooks';
export {
  useMediaAsset,
  useMediaCollection,
  useMediaEvent,
  useMediaLibrary,
  useMediaUploads,
} from './hooks';
export type {
  MediaErrorCode,
  MediaFormatters,
  MediaMessageFn,
  MediaMessages,
  MediaMessagesInput,
  MediaTypeLabel,
} from './messages';
export {
  createMediaFormatters,
  defaultMediaMessages,
  mediaErrorMessage,
  mergeMediaMessages,
} from './messages';
export type {
  MediaAllMatching,
  MediaAsset,
  MediaAssetFilterQuery,
  MediaAssetListQuery,
  MediaAssetListResult,
  MediaAssetStatus,
  MediaBulkTarget,
  MediaClient,
  MediaFacets,
  MediaFolder as MediaFolderRecord,
  MediaSelectionMode,
  MediaServerEvent,
  MediaSortBy,
  MediaSortDirection,
  MediaUploadedAsset,
  MediaUploadEntry,
  MediaUploadState,
} from './types';
export type {
  MediaUploadAbortProps,
  MediaUploadClearProps,
  MediaUploadItemProps,
  MediaUploadListProps,
  MediaUploadProgressProps,
} from './uploads';
export type { ReadableStore } from './use-store';
export { useMediaStore, useSelector } from './use-store';
