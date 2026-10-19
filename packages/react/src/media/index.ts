'use client';

// @createcms/react/media: headless media library. Parts live on namespaces
// (`Media.*`, `Selection.*`, `Bulk.*`, `Folder.*`, `Filter.*`, `Intake.*`,
// `Upload.*`, `Download.*`, `Preview.*`, `Detail.*`, `FocalPoint.*`,
// `Crop.*`, `ImageField.*`, `Picker.*`, `Usage.*`); hooks and types are
// flat named exports. The framework-free
// store, layout, selection, filter and intake logic is
// `@createcms/react/media/core`.
import {
  MediaEmpty,
  MediaError,
  MediaLoadMore,
  MediaMutationError,
  MediaSearch,
} from './collection';
import {
  DetailConflict,
  DetailError,
  DetailFacts,
  DetailFieldInput,
  DetailProvenance,
  DetailReset,
  DetailRevisions,
  DetailRoot,
  DetailSave,
} from './detail';
import {
  DownloadButton,
  DownloadCancel,
  DownloadItem,
  DownloadList,
  DownloadProgress,
} from './downloads';
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
  CropArea,
  CropAspect,
  CropInput,
  CropPreview,
  CropReset,
  CropRoot,
  CropZoom,
  FocalPointHandle,
  FocalPointPreview,
  FocalPointRoot,
} from './image-edit';
import {
  ImageFieldAlt,
  ImageFieldCaption,
  ImageFieldDecorative,
  ImageFieldRoot,
  ImageFieldStatus,
  ImageFieldSuggestAlt,
} from './image-field';
import {
  IntakeCamera,
  IntakeDropzone,
  IntakeFolderInput,
  IntakeFolderPrompt,
  IntakeInput,
  IntakeOverlay,
  IntakePaste,
  IntakeReading,
} from './intake';
import { PickerConfirm, PickerReason, PickerRoot } from './picker';
import {
  PreviewClose,
  PreviewNext,
  PreviewPosition,
  PreviewPrev,
  PreviewRoot,
  PreviewRotate,
  PreviewStage,
  PreviewZoomIn,
  PreviewZoomOut,
  PreviewZoomReset,
} from './preview';
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
  UploadCancel,
  UploadClear,
  UploadDuplicate,
  UploadItem,
  UploadList,
  UploadPause,
  UploadProgress,
  UploadRetry,
  UploadRetryAll,
} from './uploads';
import {
  UsageCount,
  UsageEmpty,
  UsageExternalItem,
  UsageExternalList,
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
  Camera: IntakeCamera,
  FolderPrompt: IntakeFolderPrompt,
  Reading: IntakeReading,
};

/** The upload panel: list, progress and per-entry or global actions. */
export const Upload = {
  List: UploadList,
  Item: UploadItem,
  Progress: UploadProgress,
  Cancel: UploadCancel,
  Retry: UploadRetry,
  RetryAll: UploadRetryAll,
  Pause: UploadPause,
  Clear: UploadClear,
  Duplicate: UploadDuplicate,
};

/** Archive downloads streamed in the browser. */
export const Download = {
  Button: DownloadButton,
  List: DownloadList,
  Item: DownloadItem,
  Progress: DownloadProgress,
  Cancel: DownloadCancel,
};

/** The full-screen preview with zoom, rotation and stepping. */
export const Preview = {
  Root: PreviewRoot,
  Stage: PreviewStage,
  Prev: PreviewPrev,
  Next: PreviewNext,
  Close: PreviewClose,
  ZoomIn: PreviewZoomIn,
  ZoomOut: PreviewZoomOut,
  ZoomReset: PreviewZoomReset,
  Rotate: PreviewRotate,
  Position: PreviewPosition,
};

/** The detail form: name, description, rights, origin, facts and versions. */
export const Detail = {
  Root: DetailRoot,
  Field: DetailFieldInput,
  Provenance: DetailProvenance,
  Facts: DetailFacts,
  Save: DetailSave,
  Reset: DetailReset,
  Error: DetailError,
  Conflict: DetailConflict,
  Revisions: DetailRevisions,
};

/** The asset's focal point. */
export const FocalPoint = {
  Root: FocalPointRoot,
  Handle: FocalPointHandle,
  Preview: FocalPointPreview,
};

/** The crop of one image use. */
export const Crop = {
  Root: CropRoot,
  Area: CropArea,
  Zoom: CropZoom,
  Aspect: CropAspect,
  Input: CropInput,
  Reset: CropReset,
  Preview: CropPreview,
};

/** Alt text, decorative switch and caption of one image use. */
export const ImageField = {
  Root: ImageFieldRoot,
  Alt: ImageFieldAlt,
  Decorative: ImageFieldDecorative,
  Caption: ImageFieldCaption,
  SuggestAlt: ImageFieldSuggestAlt,
  Status: ImageFieldStatus,
};

/** Picker constraints inside a `Media.Root`. */
export const Picker = {
  Root: PickerRoot,
  Reason: PickerReason,
  Confirm: PickerConfirm,
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
  ExternalList: UsageExternalList,
  ExternalItem: UsageExternalItem,
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
  MediaExternalUsage,
  MediaUsageItem,
  MediaUsageOccurrence,
  MediaUsagePage,
  MediaUsageScope,
  UseAssetUsagesState,
  UsageCountProps,
  UsageEmptyProps,
  UsageExternalItemProps,
  UsageExternalListProps,
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
  FolderDropKind,
  FolderDropOptions,
  FolderDropRules,
  FolderDropState,
} from './dnd';
export {
  DROP_DWELL_MS,
  DROP_FLASH_MS,
  FOLDER_DRAG_TYPE,
  folderDragProps,
  useDropOverlay,
  useFolderDrop,
  useFolderDropRules,
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
  MediaRevision,
  MediaSelectionMode,
  MediaServerEvent,
  MediaSortBy,
  MediaSortDirection,
  MediaUploadedAsset,
  MediaUploadEntry,
  MediaUploadState,
} from './types';
export type {
  UploadCancelProps,
  UploadClearProps,
  UploadDuplicateProps,
  UploadDuplicateRenderProps,
  UploadItemProps,
  UploadListProps,
  UploadPauseProps,
  UploadProgressProps,
  UploadRetryAllProps,
  UploadRetryProps,
} from './uploads';
export {
  isUploadActive,
  isUploadDuplicate,
  useUploadEntry,
  useUploadsPending,
} from './uploads';
export type {
  DownloadButtonProps,
  DownloadCancelProps,
  DownloadItemProps,
  DownloadListProps,
  DownloadProgressProps,
  MediaDownloads,
} from './downloads';
export { useDownloads } from './downloads';
export type {
  MediaPreview,
  PreviewButtonProps,
  PreviewPositionProps,
  PreviewRootProps,
  PreviewStageProps,
} from './preview';
export { usePreview } from './preview';
export type {
  AssetDetail,
  DetailConflictProps,
  DetailErrorProps,
  DetailFactsProps,
  DetailFieldProps,
  DetailProvenanceProps,
  DetailResetProps,
  DetailRevisionsProps,
  DetailRootProps,
  DetailSaveProps,
} from './detail';
export { useAssetDetail } from './detail';
export type {
  CropAreaProps,
  CropAspectProps,
  CropInputProps,
  CropPreviewProps,
  CropResetProps,
  CropRootProps,
  CropZoomProps,
  EditableImage,
  FocalPointHandleProps,
  FocalPointPreviewProps,
  FocalPointRootProps,
} from './image-edit';
export { useCropEditor } from './image-edit';
export type {
  ImageFieldAltProps,
  ImageFieldCaptionProps,
  ImageFieldDecorativeProps,
  ImageFieldRootProps,
  ImageFieldState,
  ImageFieldStatusProps,
  ImageFieldSuggestAltProps,
} from './image-field';
export { useImageField } from './image-field';
export type {
  MediaPickerHostProps,
  MediaPickerRequest,
  PickerConfirmProps,
  PickerReasonProps,
  PickerRootProps,
} from './picker';
export {
  MediaPickerHost,
  openMediaPicker,
  pickerReasonText,
  usePickerConstraints,
  usePickerItem,
} from './picker';
export type { IntakeCameraProps } from './intake';
export type { ReadableStore } from './use-store';
export { useMediaStore, useSelector } from './use-store';
