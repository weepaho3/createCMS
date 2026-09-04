// Type-only assertions for the client-visibility filter.
// Checked by `check-types`, never executed. Confirms:
//   1-2. `media.uploadAssets` / `media.replaceAsset` are ABSENT from the
//        client's type surface — both take a `Blob`/`ArrayBuffer` body that
//        can't survive the client's JSON serialization, so they're marked
//        `scope: 'server'` in core/routes/media.ts.
//   3.   Their browser-callable counterparts (`createSignedReplace` +
//        `commitReplace`) are still present and callable — the filter must
//        not over-reach.
//   4.   Server-side `cms.api.media.replaceAsset` (and `uploadAssets`) are
//        UNCHANGED and still callable — the regression guard for the trap:
//        filtering happens only in the client's view (client/types.ts),
//        never inside `ServerApiCallers` (core/factory.ts).
// If `scope: 'server'` is ever removed from either endpoint, assertions 1-2
// go unused and `check-types` fails — self-verifying.

import type { DrizzleInstance } from '../core/types/drizzle';

import { allowAnonymous, createCMS } from '../index';
import { DUMMY_MEDIA_CONFIG } from '../test-utils/fixtures';
import type { CMSClientInstance } from './types';

declare const db: DrizzleInstance;

const cms = createCMS({
  db,
  media: DUMMY_MEDIA_CONFIG,
  collections: {},
  authMiddleware: allowAnonymous(),
});

declare const client: CMSClientInstance<typeof cms>;

// 1. `media.uploadAssets` is absent from the client's type surface.
export const _uploadAssetsAbsent = () =>
  // @ts-expect-error - uploadAssets is scope:'server'; absent from the client
  client.media.uploadAssets;

// 2. `media.replaceAsset` is absent from the client's type surface.
export const _replaceAssetAbsent = () =>
  // @ts-expect-error - replaceAsset is scope:'server'; absent from the client
  client.media.replaceAsset;

// 3. The browser-callable counterparts remain present and callable — the
// filter targets exactly the two branded endpoints, nothing else.
export const _createSignedReplaceCallable = () =>
  client.media.createSignedReplace({
    body: {
      assetId: 'ast_x',
      file: { name: 'a.png', size: 1, type: 'image/png' },
    },
  });

export const _commitReplaceCallable = () =>
  client.media.commitReplace({
    body: {
      assetId: 'ast_x',
      objectKey: 'obj_x',
      slug: 'slug_x',
      mimeType: 'image/png',
      size: 1,
    },
  });

// 4. Server-side `cms.api.media.replaceAsset` / `uploadAssets` stay callable.
export const _serverReplaceAssetCallable = () =>
  cms.api.media.replaceAsset({
    body: {
      assetId: 'ast_x',
      file: { name: 'a.png', size: 1, type: 'image/png', buffer: new Blob() },
    },
  });

export const _serverUploadAssetsCallable = () =>
  cms.api.media.uploadAssets({
    body: {
      files: [
        { name: 'a.png', size: 1, type: 'image/png', buffer: new Blob() },
      ],
    },
  });
