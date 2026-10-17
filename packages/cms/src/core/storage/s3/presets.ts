import type { StorageCapabilities } from '../adapter';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const SEVEN_DAYS = 604_800;

/** The S3 API surface every preset starts from. */
const S3_BASE: StorageCapabilities = {
  signedPut: { supported: true, contentType: true, contentLength: true },
  signedPost: false,
  signedGet: { supported: true, disposition: true, maxExpiresIn: SEVEN_DAYS },
  rangeRead: true,
  copy: true,
  list: true,
  deleteMany: true,
  multipart: { supported: true, minPartSize: 5 * MIB, maxParts: 10_000 },
  objectAcl: false,
  conditionalPut: false,
  checksum: {
    sha256Put: false,
    crc64nvmeFullObject: false,
    contentMd5Part: true,
  },
  corsConfigurable: true,
  lifecycle: false,
};

function preset(
  overrides: Partial<Omit<StorageCapabilities, 'checksum'>> & {
    checksum?: Partial<StorageCapabilities['checksum']>;
  },
): StorageCapabilities {
  return {
    ...S3_BASE,
    ...overrides,
    checksum: { ...S3_BASE.checksum, ...overrides.checksum },
  };
}

/**
 * Capability defaults per S3-compatible provider, taken from each
 * provider's S3 compatibility documentation. Override single flags with
 * `media.capabilities`.
 */
export const providerCapabilities = {
  /** Amazon S3. Object ACLs work only on buckets that still allow ACLs. */
  aws: preset({
    signedPost: true,
    objectAcl: true,
    conditionalPut: true,
    checksum: { sha256Put: true, crc64nvmeFullObject: true },
    lifecycle: true,
  }),
  /** Cloudflare R2: no POST, no ACLs; presign only on the S3 API domain. */
  r2: preset({
    conditionalPut: true,
    checksum: { sha256Put: true },
    lifecycle: true,
  }),
  /** Backblaze B2: no POST, no ACLs. */
  b2: preset({}),
  /** DigitalOcean Spaces: canned ACLs, lifecycle for incomplete multiparts. */
  doSpaces: preset({ objectAcl: true, lifecycle: true }),
  /** Hetzner Object Storage: 5 GB single PUT, 750 requests/s per bucket and IP. */
  hetzner: preset({
    objectAcl: true,
    lifecycle: true,
    requestsPerSecond: 750,
    maxSinglePutSize: 5 * GIB,
  }),
  /** Bunny Storage: CORS fixed to `*`, no lifecycle, 500 requests/s. */
  bunny: preset({ corsConfigurable: false, requestsPerSecond: 500 }),
  /** Supabase Storage: no CORS through S3, no Content-MD5. */
  supabase: preset({
    corsConfigurable: false,
    checksum: { contentMd5Part: false },
  }),
  /** Any other S3-compatible server (MinIO, Garage, SeaweedFS). */
  generic: preset({}),
} satisfies Record<string, StorageCapabilities>;

export type StoragePreset = keyof typeof providerCapabilities;

/** A partial override for one or more capability flags. */
export type StorageCapabilitiesOverride = Partial<
  Omit<
    StorageCapabilities,
    'signedPut' | 'signedGet' | 'multipart' | 'checksum'
  >
> & {
  signedPut?: Partial<StorageCapabilities['signedPut']>;
  signedGet?: Partial<StorageCapabilities['signedGet']>;
  multipart?: Partial<StorageCapabilities['multipart']>;
  checksum?: Partial<StorageCapabilities['checksum']>;
};

/** `base` with `override` applied flag by flag. */
export function mergeCapabilities(
  base: StorageCapabilities,
  override: StorageCapabilitiesOverride | undefined,
): StorageCapabilities {
  if (!override) return base;
  return {
    ...base,
    ...override,
    signedPut: { ...base.signedPut, ...override.signedPut },
    signedGet: { ...base.signedGet, ...override.signedGet },
    multipart: { ...base.multipart, ...override.multipart },
    checksum: { ...base.checksum, ...override.checksum },
  };
}
