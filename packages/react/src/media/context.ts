import * as React from 'react';

import type { MediaFormatters, MediaMessages } from './messages';
import type { MediaStore } from './store';
import type { MediaAsset, MediaSelectionMode, MediaUploadState } from './types';

import { createMediaFormatters, defaultMediaMessages } from './messages';

export type MediaContextValue = {
  store: MediaStore;
  selection: MediaSelectionMode;
  /** Resolves the `src` of `Media.Thumbnail`; defaults to `asset.deliveryUrl`. */
  assetUrl: (asset: MediaAsset) => string;
};

export const MediaContext = React.createContext<MediaContextValue | null>(null);

// Separate from `MediaContext` so upload progress ticks re-render only the
// upload parts, not the grid.
export const MediaUploadsContext = React.createContext<MediaUploadState | null>(
  null,
);

/**
 * Reads the library context and throws a precise error when a part is
 * rendered outside `Media.Root`.
 */
export function useMediaContext(componentName: string): MediaContextValue {
  const value = React.useContext(MediaContext);
  if (value === null) {
    throw new Error(
      `${componentName} must be used within a Media.Root component.`,
    );
  }
  return value;
}

/** Reads the upload state provided by `Media.Root`; throws outside it. */
export function useMediaUploadsContext(
  componentName: string,
): MediaUploadState {
  const value = React.useContext(MediaUploadsContext);
  if (value === null) {
    throw new Error(
      `${componentName} must be used within a Media.Root component.`,
    );
  }
  return value;
}

export type MediaMessagesContextValue = {
  messages: MediaMessages;
  format: MediaFormatters;
};

// Defaults outside `Media.Root`, so labels resolve in triggers rendered
// before the root mounts.
export const MediaMessagesContext =
  React.createContext<MediaMessagesContextValue>({
    messages: defaultMediaMessages,
    format: createMediaFormatters(undefined),
  });

/** The active catalog and locale formatters (`Media.Root` `messages`/`locale`). */
export function useMediaMessages(): MediaMessagesContextValue {
  return React.useContext(MediaMessagesContext);
}
