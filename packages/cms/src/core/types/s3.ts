import type { AwsClient } from 'aws4fetch';

import type { TransformAdapter } from '../media/transform';
import type { VideoConfig } from '../media/video-provider';
import type { StorageAdapter } from '../storage/adapter';
import type {
  StorageCapabilitiesOverride,
  StoragePreset,
} from '../storage/s3/presets';
import type { ResolvedScope } from './definitions';

export type S3Client = {
  s3: AwsClient;
  buildBucketUrl: (bucket: string) => string;
};

export type ObjectAcl =
  | 'private'
  | 'public-read'
  | 'public-read-write'
  | 'authenticated-read'
  | 'bucket-owner-read'
  | 'bucket-owner-full-control';

/** A place outside content that uses assets (see `MediaConfig.usageSources`). */
export type MediaUsageSource = {
  /** Names the source in usage reports, e.g. `seo-settings`. */
  kind: string;
  /** The ids among `assetIds` this source uses. */
  assetsInUse: (assetIds: string[]) => Promise<Iterable<string>>;
};

/** A registered use of an asset outside the CMS (a site, a campaign tool). */
export type ExternalUsage = {
  assetId: string;
  /** Names the integration, e.g. `newsletter`. */
  consumer: string;
  /** Where the asset is used. */
  url: string;
  registeredAt: Date;
};

/**
 * Stores external usages for `registerExternalUsage` (see
 * `MediaConfig.externalUsage`). Integrations register and remove their own
 * entries; the CMS only reads them for usage reports and archive warnings.
 */
export type ExternalUsageRegistry = {
  /** Adds the usage; registering the same `assetId`, `consumer` and `url` again keeps one entry. */
  register(usage: {
    assetId: string;
    consumer: string;
    url: string;
  }): Promise<void>;
  /** Removes one usage, or every usage of `consumer` for the asset without `url`. Returns how many were removed. */
  remove(usage: {
    assetId: string;
    consumer: string;
    url?: string;
  }): Promise<number>;
  /** The usages of these assets. */
  list(assetIds: string[]): Promise<ExternalUsage[]>;
};

// ============================================================================
// Media Configuration
// ============================================================================

type BaseMediaConfig = {
  /** AWS access key ID (or S3-compatible equivalent) */
  accessKeyId: string;
  /** AWS secret access key (or S3-compatible equivalent) */
  secretAccessKey: string;
  /** Optional session token for temporary credentials */
  sessionToken?: string;

  /** S3 bucket name for storing media assets */
  bucketName: string;

  /**
   * Public base URL for serving assets via CDN.
   * The public `asset` endpoint redirects to `{publicUrl}/{objectKey}`.
   *
   * Example for DigitalOcean Spaces: `https://toerbocms.fra1.cdn.digitaloceanspaces.com/`
   */
  publicUrl: string;

  // Upload limits
  /** Maximum file size in bytes. @default 4MB (4 * 1024 * 1024) */
  maxFileSize?: number;
  /** Maximum number of files per upload batch. @default 10 */
  maxFiles?: number;
  /**
   * Allowed MIME types. Exact matches, or a `type/*` wildcard prefix (e.g.
   * `image/*`). The default is an explicit raster and document allowlist.
   * `image/svg+xml` (and `.svg` names) is refused whatever this list says:
   * an uploaded SVG can carry script and, opened from the media origin,
   * becomes stored XSS. Every upload is also sniffed: markup is refused
   * under any type, and an image, video, audio or PDF type must match the
   * file's signature.
   * @default ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'application/pdf']
   */
  allowedMimeTypes?: string[];

  /**
   * Object ACL sent with uploads. `x-amz-acl: public-read` is sent only when
   * this is `'public-read'` and the storage reports `objectAcl` (AWS buckets
   * with ACLs enabled, DigitalOcean Spaces, Hetzner); otherwise no ACL header
   * is sent. Grant public reads with a bucket policy on the `pub/` prefix
   * instead (see `visibility`). @default false
   */
  acl?: 'public-read' | false;

  /**
   * Where objects live. `'prefix'`: keys start with `pub/` or `prv/` by
   * asset status, objects move by copy plus delete when the status changes,
   * and a bucket policy grants public reads on `pub/*` only, so private bytes
   * are reachable through the asset endpoint alone. Needs the `copy`
   * capability. `'legacy'`: keys carry no visibility segment and status
   * changes never move objects. Objects uploaded before switching keep
   * their keys until their next status change. @default 'prefix'
   */
  visibility?: 'prefix' | 'legacy';

  /**
   * Called after an asset's object moved (status change, replace) with the
   * asset endpoint paths whose CDN cache should be purged, e.g.
   * `/media/asset/ast_...`. Errors are logged, never thrown.
   */
  onPurge?: (paths: string[]) => void | Promise<void>;

  /**
   * Usages the content index cannot see, such as asset ids in plugin
   * tables or settings. An asset a source reports is skipped by
   * `archiveAssets` (unless `force`) and never reclaimed by pruning.
   */
  usageSources?: MediaUsageSource[];

  /**
   * Image transform service for renditions that are not stored: the asset
   * endpoint redirects `?w`/`?format` misses of public raster images to the
   * adapter's signed URL (see `imgproxyTransform`). Its widths are added to
   * the widths the endpoint snaps to.
   */
  transform?: TransformAdapter;

  /**
   * Hands long public videos to a streaming provider (see `muxVideo`): the
   * pruning pass ingests them and stores the playback URL in
   * `metadata.stream`; `Media.Video` plays it. Short clips stay files.
   */
  video?: VideoConfig;

  /**
   * Usages outside the CMS that integrations push through
   * `registerExternalUsage` and `removeExternalUsage`. They show as the
   * external group of `getAssetUsages` and only warn: `archiveAssets`
   * archives such assets and reports them in `externalUsages`.
   */
  externalUsage?: ExternalUsageRegistry;

  /**
   * Rendition widths, ascending. The asset endpoint snaps `?w=` up to the
   * next width here and answers RENDITION_WIDTH_UNSUPPORTED above the
   * largest; the media-optimize plugin produces these widths.
   * @default [320, 640, 1280, 1920]
   */
  renditionWidths?: number[];

  /**
   * Called when the asset endpoint is asked for a rendition that exists
   * neither exactly nor in a larger width, and serves the original instead.
   * Errors are logged, never thrown.
   */
  onRenditionMiss?: (miss: {
    assetId: string;
    variantKey: string;
  }) => void | Promise<void>;

  /**
   * Called after `purgeAssets` erased assets, for an audit log. Carries ids
   * and the reason code only, no personal data. Errors are logged, never
   * thrown.
   */
  onAssetPurge?: (purge: {
    assetIds: string[];
    reason: string;
  }) => void | Promise<void>;

  /**
   * Malware scanner. With one, new bytes (uploads, replaces, renditions)
   * land under the private prefix as `processingState: 'pending'`; the
   * pruning pass scans them, makes clean ones `ready` (and public where the
   * asset is), and deletes infected objects, marking the asset `failed`.
   * Only `ready` assets are delivered or made public.
   */
  scan?: ScanAdapter;

  /**
   * Multipart uploads for large files, where the storage supports them:
   * files above `threshold` (default 64 MiB) upload in parts of `partSize`
   * (default 8 MiB, at least the storage's minimum, raised so a file needs
   * at most 9,000 parts) that resume after an interruption.
   */
  multipart?: { threshold?: number; partSize?: number };

  /**
   * Origins besides the CMS's own that may call the state-changing media
   * endpoints with cookies (an admin UI on another domain). Cookie requests
   * from any other origin answer `ORIGIN_NOT_ALLOWED`; requests without
   * cookies and requests sending `x-createcms-media: 1` are not checked.
   * Default: none, so only same-origin cookie requests pass.
   */
  allowedOrigins?: string[];

  /**
   * Limits checked when uploads are signed, for the caller and scope.
   * `maxBytes` counts every stored byte in the scope (originals, renditions,
   * revisions, trash) plus the batch; `maxAssets` counts originals.
   * Exceeding either answers `QUOTA_EXCEEDED`.
   */
  quota?: (target: {
    actor: string | null;
    scope: ResolvedScope;
  }) =>
    | { maxBytes?: number; maxAssets?: number }
    | null
    | Promise<{ maxBytes?: number; maxAssets?: number } | null>;

  /**
   * Files one actor may sign per minute across `createSignedUpload`,
   * `createSignedReplace` and `createSignedRendition`, counted per server
   * process. Default 60; `0` turns the limit off.
   */
  uploadRateLimit?: number;

  /**
   * Called after `downloadIntent` signed downloads, for an audit log.
   * `ipHash` is a SHA-256 prefix of the client address when the request
   * carries one. Errors are logged, never thrown.
   */
  onAssetDownload?: (download: {
    assetIds: string[];
    actorId: string | null;
    variantKey: string | null;
    bulkJobId: string | null;
    ipHash: string | null;
  }) => void | Promise<void>;

  /**
   * Signatures `downloadIntent` hands one actor per minute (one per asset).
   * Counted per server process. Default 60; `0` turns the limit off.
   */
  downloadRateLimit?: number;

  /**
   * Runs an archive export started by `createZipExport` in the background,
   * for example `(task) => after(task)` in Next.js or `ctx.waitUntil(task())`
   * on a worker. Default: the task starts without being awaited, which a
   * serverless platform may stop early; the pruning pass continues every
   * unfinished export at its last stored part.
   */
  runExport?: (task: () => Promise<void>) => void;

  /**
   * Whether `replaceAsset` accepts a file of another MIME type than the
   * asset's. Default `true`; `false` answers `INVALID_FILE_TYPE`.
   */
  allowReplaceWithDifferentType?: boolean;

  /**
   * Overrides single capability flags of the provider preset (see
   * `providerCapabilities`). Ignored when `storage` is set.
   */
  capabilities?: StorageCapabilitiesOverride;

  /**
   * Treat an asset id that appears inside a longer string of any block
   * version (rich text HTML, stringified JSON) as a reference:
   * `archiveAssets` skips such assets unless called with `force`, and pruning
   * never reclaims them. Rich text is not indexed in `content_usages`, so
   * without this guard an image used only in rich text can be archived and
   * deleted. @default true
   */
  guardRichTextReferences?: boolean;

  // URL generation
  /** Signed URL expiration time in seconds. @default 300 */
  signedUrlExpiresIn?: number;

  /**
   * HMAC secret for the presign/complete upload tokens. Defaults to a key
   * derived from `secretAccessKey`; set it when the credentials are temporary
   * (STS), since a rotated secret invalidates tokens minted before the rotation.
   */
  uploadSecret?: string;

  /**
   * Custom storage backend. When set, every storage operation goes through
   * it. `provider` and credentials are still required by the type but unused
   * for storage I/O.
   */
  storage?: StorageAdapter;
};

/** AWS S3 configuration */
export type AWSMediaConfig = BaseMediaConfig & {
  provider: 'aws';
  /** AWS region (e.g., 'us-east-1', 'eu-central-1') */
  region: string;
  /** @default false - AWS uses virtual-hosted-style URLs */
  forcePathStyle?: boolean;
};

/** DigitalOcean Spaces configuration */
export type DigitalOceanMediaConfig = BaseMediaConfig & {
  provider: 'digitalOcean';
  /** Region identifier like 'nyc3', 'ams3', 'sgp1' */
  region: string;
  /** @default true - DigitalOcean Spaces uses path-style URLs */
  forcePathStyle?: boolean;
};

/** Cloudflare R2 configuration */
export type CloudflareMediaConfig = BaseMediaConfig & {
  provider: 'cloudflare';
  /** Cloudflare Account ID for R2 */
  accountId: string;
  /** Optional jurisdiction for compliance (e.g., 'eu', 'fedramp') */
  jurisdiction?: string;
  /** @default true - R2 uses path-style URLs */
  forcePathStyle?: boolean;
};

/** Custom S3-compatible provider */
export type CustomMediaConfig = BaseMediaConfig & {
  provider: 'custom';
  /** Capability preset of the S3-compatible service. @default 'generic' */
  preset?: StoragePreset;
  /** Custom S3-compatible endpoint hostname (e.g., 'minio.example.com') */
  hostname: string;
  /** Region for signing */
  region: string;
  /** @default true - Use HTTPS instead of HTTP */
  secure?: boolean;
  /** @default true - Custom/minio typically uses path-style */
  forcePathStyle?: boolean;
};

/** Discriminated union of all media provider configurations */
/** The verdict of a malware scan; `unsupported` counts as clean. */
export type ScanVerdict = 'clean' | 'infected' | 'unsupported';

/**
 * Scans one stored object (ClamAV over clamd `INSTREAM`, a GuardDuty
 * result tag, a vendor API). Read the bytes through `storage`. A thrown
 * error leaves the asset `pending` for the next pass.
 */
export type ScanAdapter = {
  scan(object: {
    assetId: string;
    objectKey: string;
    mimeType: string;
    size: number;
    storage: StorageAdapter;
  }): Promise<ScanVerdict>;
};

export type MediaConfig =
  | AWSMediaConfig
  | DigitalOceanMediaConfig
  | CloudflareMediaConfig
  | CustomMediaConfig;

// ============================================================================
// Default Values
// ============================================================================

export const MEDIA_DEFAULTS = {
  maxFileSize: 4 * 1024 * 1024, // 4MB
  maxFiles: 10,
  // Explicit allowlist; widen it via `allowedMimeTypes`. SVG is refused
  // whatever the list says (`validateFiles`).
  allowedMimeTypes: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'application/pdf',
  ],
  signedUrlExpiresIn: 300,
  renditionWidths: [320, 640, 1280, 1920],
} as const;
