import { and, eq, inArray } from 'drizzle-orm';

import type { ResolvedScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { newId } from '../../utils/nanoid';
import { assetFolders, assets } from '../db/schema.generated';
import { CMSError, errorMessages } from '../errors';
import {
  buildObjectKey,
  createSlug,
  isFileTypeAllowed,
} from '../storage/s3/utils';

const MAX_SLUG_ATTEMPTS = 100;

type UploadFileInput = {
  name: string;
  size: number;
  type: string;
  variantOf?: string;
};

type PrepareUploadInput = {
  actor: string | undefined;
  files: UploadFileInput[];
  folderId?: string;
  maxFiles: number;
  maxFileSize: number;
  allowedMimeTypes: string[];
  scope: ResolvedScope;
};

export async function prepareAssetUpload(
  db: DrizzleInstance,
  input: PrepareUploadInput,
) {
  const { actor, files, folderId, scope } = input;

  validateFiles(files, {
    maxFiles: input.maxFiles,
    maxFileSize: input.maxFileSize,
    allowedMimeTypes: input.allowedMimeTypes,
  });

  if (folderId) {
    await assertFolderExists(db, folderId, scope);
  }

  await validateVariantRefs(db, files);

  const prepared: {
    id: string;
    slug: string;
    objectKey: string;
    file: UploadFileInput;
  }[] = [];

  const batchSlugs = new Set<string>();

  for (const file of files) {
    const id = newId('asset');
    const slug = await generateUniqueSlug(db, file.name, batchSlugs, scope);
    if (!slug) {
      throw new CMSError('SLUG_GENERATION_FAILED');
    }

    batchSlugs.add(slug);

    const objectKey = buildObjectKey(slug);

    prepared.push({ id, slug, objectKey, file });
  }

  return { actor, folderId, prepared };
}

async function generateUniqueSlug(
  db: DrizzleInstance,
  baseName: string,
  inFlightSlugs?: Set<string>,
  scope?: ResolvedScope,
): Promise<string | null> {
  const baseSlug = createSlug(baseName);

  let slug = baseSlug;
  let counter = 2;

  while (counter <= MAX_SLUG_ATTEMPTS + 1) {
    if (!inFlightSlugs?.has(slug)) {
      const conditions = [eq(assets.slug, slug)];
      if (scope?.assets?.where) conditions.push(scope.assets.where as any);

      const [existing] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(...conditions));

      if (!existing) return slug;
    }

    const dotIndex = baseSlug.lastIndexOf('.');
    if (dotIndex > 0) {
      slug = `${baseSlug.slice(0, dotIndex)}-${counter}${baseSlug.slice(dotIndex)}`;
    } else {
      slug = `${baseSlug}-${counter}`;
    }

    counter++;
  }

  return null;
}

function validateFiles(
  files: UploadFileInput[],
  config: {
    maxFiles: number;
    maxFileSize: number;
    allowedMimeTypes: string[];
  },
) {
  if (files.length > config.maxFiles) {
    throw new CMSError('TOO_MANY_FILES', {
      message: errorMessages.tooManyFiles(files.length, config.maxFiles),
    });
  }

  for (const file of files) {
    if (file.size > config.maxFileSize) {
      throw new CMSError('FILE_TOO_LARGE', {
        message: errorMessages.fileTooLarge(
          file.name,
          file.size,
          config.maxFileSize,
        ),
      });
    }

    if (!isFileTypeAllowed(file.type, config.allowedMimeTypes)) {
      throw new CMSError('INVALID_FILE_TYPE', {
        message: errorMessages.invalidFileType(file.name, file.type),
      });
    }
  }
}

async function assertFolderExists(
  db: DrizzleInstance,
  folderId: string,
  scope: ResolvedScope,
) {
  const conditions = [eq(assetFolders.id, folderId)];
  if (scope.assetFolders?.where)
    conditions.push(scope.assetFolders.where as any);

  const [folder] = await db
    .select({ id: assetFolders.id })
    .from(assetFolders)
    .where(and(...conditions));

  if (!folder) {
    throw new CMSError('FOLDER_NOT_FOUND', {
      message: errorMessages.folderNotFound(folderId),
    });
  }
}

async function validateVariantRefs(
  db: DrizzleInstance,
  files: UploadFileInput[],
) {
  const variantIds = [
    ...new Set(files.map((file) => file.variantOf).filter(Boolean) as string[]),
  ];

  if (variantIds.length === 0) return;

  const existing = await db
    .select({ id: assets.id })
    .from(assets)
    .where(inArray(assets.id, variantIds));

  const existingSet = new Set(existing.map((asset) => asset.id));
  for (const id of variantIds) {
    if (!existingSet.has(id)) {
      throw new CMSError('ASSET_NOT_FOUND', {
        message: errorMessages.assetNotFound(id),
      });
    }
  }
}
