import type { AwsClient } from 'aws4fetch';

import type { StorageAdapter } from '../storage/adapter';
import type {
  StorageCapabilitiesOverride,
  StoragePreset,
} from '../storage/s3/presets';

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
   * `image/*`). The default is an EXPLICIT raster/document allowlist that
   * deliberately excludes `image/svg+xml` — an uploaded SVG can carry inline
   * script and, served same-origin, becomes stored XSS. Re-add SVG only if you
   * sanitize it and serve it from a separate origin.
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
  // Explicit allowlist — no `image/*` wildcard, so `image/svg+xml` (a stored-XSS
  // vector) is excluded by default. Widen via `allowedMimeTypes` if you need more.
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
