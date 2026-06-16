import type { AwsClient } from 'aws4fetch';

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
// Optimization Options
// ============================================================================

export type CompressOptions = {
  /** JPEG/PNG quality (1-100). @default 80 */
  quality?: number;
};

export type ResizeOptions = {
  /** Maximum width/height in pixels. @default 2000 */
  maxSize?: number;
};

export type ConvertOptions = {
  /** Only WebP conversion is supported. */
  format: 'webp';
  /**
   * When true, also store a copy in the original format (resized + compressed
   * but not converted). Useful for email clients that don't support WebP.
   * @default false
   */
  storeOriginal?: boolean;
};

export type OptimizationConfig = {
  /** Image compression options. Omit to disable. */
  compress?: CompressOptions;
  /** Resize options. Omit to disable. */
  resize?: ResizeOptions;
  /** Format conversion options. Omit to disable. */
  convert?: ConvertOptions;
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
  /** Allowed MIME type patterns. @default ['image/*', 'video/*', 'application/pdf'] */
  allowedMimeTypes?: string[];

  // URL generation
  /** Signed URL expiration time in seconds. @default 120 */
  signedUrlExpiresIn?: number;
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
  allowedMimeTypes: ['image/*', 'video/*', 'application/pdf'],
  signedUrlExpiresIn: 120,
} as const;
