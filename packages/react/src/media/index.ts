'use client';

// @createcms/react/media: headless media library. Parts live on the `Media`
// namespace (`Media.Root`, …); hooks and types are flat named exports.
import {
  MediaBreadcrumbs,
  MediaCrumb,
  MediaEmpty,
  MediaError,
  MediaFolder,
  MediaFolderList,
  MediaGrid,
  MediaItem,
  MediaLoadMore,
  MediaMutationError,
  MediaRoot,
  MediaSearch,
  MediaThumbnail,
} from './components';
import { MediaDropzone } from './dropzone';
import { MediaImage, MediaPicture } from './image-components';
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
  Breadcrumbs: MediaBreadcrumbs,
  Crumb: MediaCrumb,
  FolderList: MediaFolderList,
  Folder: MediaFolder,
  Search: MediaSearch,
  LoadMore: MediaLoadMore,
  Empty: MediaEmpty,
  Error: MediaError,
  MutationError: MediaMutationError,
  Dropzone: MediaDropzone,
  UploadList: MediaUploadList,
  UploadItem: MediaUploadItem,
  UploadProgress: MediaUploadProgress,
  UploadAbort: MediaUploadAbort,
  UploadClear: MediaUploadClear,
  Image: MediaImage,
  Picture: MediaPicture,
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

export type {
  ItemContextValue,
  MediaBreadcrumbsProps,
  MediaCrumbProps,
  MediaEmptyProps,
  MediaErrorProps,
  MediaFolderListProps,
  MediaFolderProps,
  MediaGridProps,
  MediaItemProps,
  MediaLoadMoreProps,
  MediaMutationErrorProps,
  MediaRootProps,
  MediaSearchProps,
  MediaThumbnailProps,
  MediaType,
} from './components';
export { mediaTypeOf, useMediaItemContext } from './components';
export type { MediaContextValue, MediaMessagesContextValue } from './context';
export { useMediaContext, useMediaMessages } from './context';
export type {
  MediaDropzoneProps,
  MediaDropzoneState,
  MediaRejectReason,
} from './dropzone';
export { acceptsFile } from './dropzone';
export type { MediaLibrary, MediaSelection } from './hooks';
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
export {
  useMediaAsset,
  useMediaLibrary,
  useMediaSelection,
  useMediaUploads,
} from './hooks';
export type {
  CreateMediaStoreOptions,
  MediaStore,
  MediaStoreActions,
} from './store';
export { SEARCH_DEBOUNCE_MS, createMediaStore } from './store';
export type {
  MediaAsset,
  MediaAssetStatus,
  MediaBulkResult,
  MediaClient,
  MediaFolder,
  MediaLibraryState,
  MediaListStatus,
  MediaMutationState,
  MediaSelectionMode,
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
export { useSelector } from './use-store';
