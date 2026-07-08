import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { assetFolders, assets } from '../src/schema';
import { setupTestCMS } from '../src/test-utils/cms';

// ============================================================================
// Folder Operations
// ============================================================================

describe('media.createFolder', () => {
  it('creates a root-level folder', async () => {
    const { cms, db } = await setupTestCMS();

    const result = await cms.api.media.createFolder({
      body: { name: 'Images' },
    });

    expect(result.folder.parentId).toBeNull();

    const [folder] = await db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.id, result.folder.id));

    expect(folder.name).toBe('Images');
    expect(folder.parentId).toBeNull();
  });

  it('creates a nested folder under an existing parent', async () => {
    const { cms, db } = await setupTestCMS();

    const parent = await cms.api.media.createFolder({
      body: { name: 'Media' },
    });

    const child = await cms.api.media.createFolder({
      body: { name: 'Logos', parentFolderId: parent.folder.id },
    });

    const [folder] = await db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.id, child.folder.id));

    expect(folder.parentId).toBe(parent.folder.id);
  });
});

describe('media.moveFolder', () => {
  it('moves a folder to a new parent', async () => {
    const { cms, db } = await setupTestCMS();

    const parentA = await cms.api.media.createFolder({
      body: { name: 'Parent A' },
    });
    const parentB = await cms.api.media.createFolder({
      body: { name: 'Parent B' },
    });
    const child = await cms.api.media.createFolder({
      body: { name: 'Child', parentFolderId: parentA.folder.id },
    });

    const result = await cms.api.media.moveFolder({
      body: { folderId: child.folder.id, newParentFolderId: parentB.folder.id },
    });

    expect(result.folder.parentId).toBe(parentB.folder.id);

    const [folder] = await db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.id, child.folder.id));

    expect(folder.parentId).toBe(parentB.folder.id);
  });

  it('moves a folder to root by setting parent to null', async () => {
    const { cms, db } = await setupTestCMS();

    const parent = await cms.api.media.createFolder({
      body: { name: 'Parent' },
    });
    const child = await cms.api.media.createFolder({
      body: { name: 'Child', parentFolderId: parent.folder.id },
    });

    const result = await cms.api.media.moveFolder({
      body: { folderId: child.folder.id },
    });

    expect(result.folder.parentId).toBeNull();

    const [folder] = await db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.id, child.folder.id));

    expect(folder.parentId).toBeNull();
  });

  it('prevents moving a folder into itself', async () => {
    const { cms } = await setupTestCMS();

    const folder = await cms.api.media.createFolder({
      body: { name: 'Folder' },
    });

    await expect(
      cms.api.media.moveFolder({
        body: {
          folderId: folder.folder.id,
          newParentFolderId: folder.folder.id,
        },
      }),
    ).rejects.toThrow(/Cannot move an item into itself/i);
  });

  it('prevents moving a folder into its own descendant', async () => {
    const { cms } = await setupTestCMS();

    const grandparent = await cms.api.media.createFolder({
      body: { name: 'Grandparent' },
    });
    const parent = await cms.api.media.createFolder({
      body: { name: 'Parent', parentFolderId: grandparent.folder.id },
    });
    const child = await cms.api.media.createFolder({
      body: { name: 'Child', parentFolderId: parent.folder.id },
    });

    await expect(
      cms.api.media.moveFolder({
        body: {
          folderId: grandparent.folder.id,
          newParentFolderId: child.folder.id,
        },
      }),
    ).rejects.toThrow(/Cannot move an item into its own descendant/i);
  });
});

describe('media.deleteFolder', () => {
  it('deletes an empty folder', async () => {
    const { cms, db } = await setupTestCMS();

    const folder = await cms.api.media.createFolder({
      body: { name: 'To Delete' },
    });

    const result = await cms.api.media.deleteFolder({
      body: { folderId: folder.folder.id },
    });

    expect(result.folderId).toBe(folder.folder.id);

    const [deletedFolder] = await db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.id, folder.folder.id));

    expect(deletedFolder).toBeUndefined();
  });

  it('blocks deletion when assets exist in the folder', async () => {
    const { cms, db } = await setupTestCMS();

    const folder = await cms.api.media.createFolder({
      body: { name: 'With Assets' },
    });

    await db.insert(assets).values({
      slug: 'test.png',
      mimeType: 'image/png',
      size: 1024,
      objectKey: 'test.png',
      folderId: folder.folder.id,
    });

    await expect(
      cms.api.media.deleteFolder({
        body: { folderId: folder.folder.id },
      }),
    ).rejects.toThrow(/contains assets or subfolders/i);
  });

  it('blocks deletion when child folders exist', async () => {
    const { cms } = await setupTestCMS();

    const parent = await cms.api.media.createFolder({
      body: { name: 'Parent' },
    });
    await cms.api.media.createFolder({
      body: { name: 'Child', parentFolderId: parent.folder.id },
    });

    await expect(
      cms.api.media.deleteFolder({
        body: { folderId: parent.folder.id },
      }),
    ).rejects.toThrow(/contains assets or subfolders/i);
  });

  it('throws when folder does not exist', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.media.deleteFolder({
        body: { folderId: 'non-existent-folder' },
      }),
    ).rejects.toThrow(/Folder not found/i);
  });
});

// ============================================================================
// List Folders
// ============================================================================

describe('media.listFolders', () => {
  it('returns root-level folders (sorted by name) when no parentId is given', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.media.createFolder({ body: { name: 'Beta' } });
    await cms.api.media.createFolder({ body: { name: 'Alpha' } });

    const result = await cms.api.media.listFolders();

    expect(result.folders.map((f) => f.name)).toEqual(['Alpha', 'Beta']);
    expect(result.folders.every((f) => f.parentId === null)).toBe(true);
  });

  it('returns the direct children of a parent folder', async () => {
    const { cms } = await setupTestCMS();

    const parent = await cms.api.media.createFolder({
      body: { name: 'Media' },
    });
    await cms.api.media.createFolder({
      body: { name: 'Logos', parentFolderId: parent.folder.id },
    });
    await cms.api.media.createFolder({
      body: { name: 'Icons', parentFolderId: parent.folder.id },
    });
    // a root-level sibling that must NOT appear under the parent
    await cms.api.media.createFolder({ body: { name: 'Root sibling' } });

    const result = await cms.api.media.listFolders({
      query: { parentFolderId: parent.folder.id },
    });

    expect(result.folders.map((f) => f.name)).toEqual(['Icons', 'Logos']);
    expect(result.folders.every((f) => f.parentId === parent.folder.id)).toBe(
      true,
    );
  });

  it('returns an empty list for a leaf or unknown parent', async () => {
    const { cms } = await setupTestCMS();
    const leaf = await cms.api.media.createFolder({ body: { name: 'Leaf' } });

    expect(
      (await cms.api.media.listFolders({
        query: { parentFolderId: leaf.folder.id },
      })).folders,
    ).toEqual([]);
    expect(
      (await cms.api.media.listFolders({ query: { parentFolderId: 'nope' } }))
        .folders,
    ).toEqual([]);
  });
});

// ============================================================================
// List Assets
// ============================================================================

describe('media.listAssets', () => {
  it('returns empty list when no assets exist', async () => {
    const { cms } = await setupTestCMS();

    const result = await cms.api.media.listAssets();

    expect(result.assets).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('returns a ready-to-use public url for each asset', async () => {
    const { cms, db } = await setupTestCMS();

    await db.insert(assets).values({
      slug: 'photo.png',
      mimeType: 'image/png',
      size: 1024,
      objectKey: 'photo.png',
      status: 'public',
    });

    const result = await cms.api.media.listAssets();

    // `${publicUrl}/${objectKey}` built server-side (DUMMY_MEDIA_CONFIG.publicUrl).
    expect(result.assets[0].url).toBe('https://cdn.test.local/photo.png');
  });

  it('returns assets filtered by folder', async () => {
    const { cms, db } = await setupTestCMS();

    const folder = await cms.api.media.createFolder({
      body: { name: 'Images' },
    });

    await db.insert(assets).values({
      slug: 'image1.png',
      mimeType: 'image/png',
      size: 1024,
      objectKey: 'image1.png',
      folderId: folder.folder.id,
      status: 'private',
    });

    await db.insert(assets).values({
      slug: 'image2.png',
      mimeType: 'image/png',
      size: 2048,
      objectKey: 'image2.png',
      status: 'private',
    });

    const result = await cms.api.media.listAssets({
      query: { folderId: folder.folder.id },
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].slug).toBe('image1.png');
    expect(result.total).toBe(1);
  });

  it('filters assets by search term', async () => {
    const { cms, db } = await setupTestCMS();

    await db.insert(assets).values({
      slug: 'my-document.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      objectKey: 'my-document.pdf',
      status: 'private',
    });

    await db.insert(assets).values({
      slug: 'image.png',
      mimeType: 'image/png',
      size: 2048,
      objectKey: 'image.png',
      status: 'private',
    });

    const result = await cms.api.media.listAssets({
      query: { search: 'document' },
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].slug).toBe('my-document.pdf');
    expect(result.total).toBe(1);
  });

  it('filters assets by status', async () => {
    const { cms, db } = await setupTestCMS();

    await db.insert(assets).values({
      slug: 'private-file.png',
      mimeType: 'image/png',
      size: 1024,
      objectKey: 'private-file.png',
      status: 'private',
    });

    await db.insert(assets).values({
      slug: 'public.png',
      mimeType: 'image/png',
      size: 2048,
      objectKey: 'public.png',
      status: 'public',
    });

    const result = await cms.api.media.listAssets({
      query: { status: 'public' },
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].slug).toBe('public.png');
    expect(result.assets[0].status).toBe('public');
  });

  it('paginates results', async () => {
    const { cms, db } = await setupTestCMS();

    for (let i = 0; i < 5; i++) {
      await db.insert(assets).values({
        slug: `file${i}.png`,
        mimeType: 'image/png',
        size: 1000 + i,
        objectKey: `file${i}.png`,
        status: 'private',
      });
    }

    const page1 = await cms.api.media.listAssets({
      query: { limit: 2, offset: 0 },
    });

    expect(page1.assets).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.hasMore).toBe(true);

    const page2 = await cms.api.media.listAssets({
      query: { limit: 2, offset: 2 },
    });

    expect(page2.assets).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    const page3 = await cms.api.media.listAssets({
      query: { limit: 2, offset: 4 },
    });

    expect(page3.assets).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
  });
});

// ============================================================================
// createSignedUpload (client-side presigned URLs)
// ============================================================================

describe('media.createSignedUpload', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
  });

  it('returns signed URLs for client-side upload', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const result = await cms.api.media.createSignedUpload({
      body: { files: [{ name: 'photo.jpg', size: 1024, type: 'image/jpeg' }] },
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].id).toBeDefined();
    expect(result.assets[0].objectKey).toContain('photo.jpg');
    expect(result.assets[0].signedUrl).toBeDefined();
    expect(result.assets[0].signedUrl).toContain('X-Amz-');
    expect(result.assets[0].headers).toBeDefined();
    expect(result.assets[0].headers['Content-Type']).toBe('image/jpeg');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('creates asset records in the database with private status', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const result = await cms.api.media.createSignedUpload({
      body: {
        files: [{ name: 'doc.pdf', size: 2048, type: 'application/pdf' }],
      },
    });

    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, result.assets[0].id));

    expect(asset).toBeDefined();
    expect(asset.slug).toBe('doc.pdf');
    expect(asset.mimeType).toBe('application/pdf');
    expect(asset.size).toBe(2048);
    expect(asset.status).toBe('private');
  });

  it('handles multiple files in a single request', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const result = await cms.api.media.createSignedUpload({
      body: {
        files: [
          { name: 'file1.jpg', size: 1024, type: 'image/jpeg' },
          { name: 'file2.png', size: 2048, type: 'image/png' },
          { name: 'file3.pdf', size: 4096, type: 'application/pdf' },
        ],
      },
    });

    expect(result.assets).toHaveLength(3);
    for (const asset of result.assets) {
      expect(asset.signedUrl).toBeDefined();
    }
  });

  it('places assets in the specified folder', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const folder = await cms.api.media.createFolder({
      body: { name: 'Uploads' },
    });

    const result = await cms.api.media.createSignedUpload({
      body: {
        files: [{ name: 'photo.jpg', size: 1024, type: 'image/jpeg' }],
        folderId: folder.folder.id,
      },
    });

    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, result.assets[0].id));

    expect(asset.folderId).toBe(folder.folder.id);
    // Object key is just the slug in flat S3 structure (no folder in path)
    expect(asset.objectKey).toBe('photo.jpg');
  });

  it('uses the signed URL to upload to S3rver successfully', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const pixel = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const result = await cms.api.media.createSignedUpload({
      body: {
        files: [
          { name: 'pixel.png', size: pixel.byteLength, type: 'image/png' },
        ],
      },
    });

    const signedUrl = result.assets[0].signedUrl;

    const uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      headers: {
        'content-type': 'image/png',
        'content-length': pixel.byteLength.toString(),
      },
      body: pixel,
    });

    expect(uploadResponse.ok).toBe(true);
  });
});

// ============================================================================
// uploadAssets (server-side proxy upload)
// ============================================================================

describe('media.uploadAssets', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
  });

  it('uploads a file buffer directly to S3', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const pixel = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const result = await cms.api.media.uploadAssets({
      body: {
        files: [
          {
            name: 'server-image.png',
            size: pixel.byteLength,
            type: 'image/png',
            buffer: new Blob([pixel]),
          },
        ],
      },
    });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].id).toBeDefined();
    expect(result.assets[0].objectKey).toContain('server-image.png');

    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, result.assets[0].id));

    expect(asset).toBeDefined();
    expect(asset.slug).toBe('server-image.png');
    expect(asset.status).toBe('private');
  });

  it('uploads multiple files in server mode', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const pixel = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const result = await cms.api.media.uploadAssets({
      body: {
        files: [
          {
            name: 'one.png',
            size: pixel.byteLength,
            type: 'image/png',
            buffer: new Blob([pixel]),
          },
          {
            name: 'two.png',
            size: pixel.byteLength,
            type: 'image/png',
            buffer: new Blob([pixel]),
          },
        ],
      },
    });

    expect(result.assets).toHaveLength(2);
  });
});

// ============================================================================
// Upload Validation (shared by both routes)
// ============================================================================

describe('upload validation', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
  });

  it('createSignedUpload rejects files exceeding maxFileSize', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    await expect(
      cms.api.media.createSignedUpload({
        body: {
          files: [
            {
              name: 'huge.bin',
              size: 1024 * 1024 * 100,
              type: 'application/octet-stream',
            },
          ],
        },
      }),
    ).rejects.toThrow(/maximum is/i);
  });

  it('createSignedUpload rejects too many files', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const files = Array.from({ length: 20 }, (_, i) => ({
      name: `file${i}.jpg`,
      size: 1024,
      type: 'image/jpeg',
    }));

    await expect(
      cms.api.media.createSignedUpload({ body: { files } }),
    ).rejects.toThrow(/maximum is/i);
  });

  it('createSignedUpload rejects disallowed MIME types', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    await expect(
      cms.api.media.createSignedUpload({
        body: {
          files: [
            {
              name: 'malware.exe',
              size: 1024,
              type: 'application/x-msdownload',
            },
          ],
        },
      }),
    ).rejects.toThrow(/disallowed MIME type/i);
  });

  it('createSignedUpload rejects upload to non-existent folder', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    await expect(
      cms.api.media.createSignedUpload({
        body: {
          files: [{ name: 'file.jpg', size: 1024, type: 'image/jpeg' }],
          folderId: 'non-existent-folder',
        },
      }),
    ).rejects.toThrow(/Folder not found/i);
  });

  it('uploadAssets rejects files exceeding maxFileSize', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    await expect(
      cms.api.media.uploadAssets({
        body: {
          files: [
            {
              name: 'huge.bin',
              size: 1024 * 1024 * 100,
              type: 'application/octet-stream',
              buffer: new Blob([]),
            },
          ],
        },
      }),
    ).rejects.toThrow(/maximum is/i);
  });

  it('uploadAssets rejects disallowed MIME types', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    await expect(
      cms.api.media.uploadAssets({
        body: {
          files: [
            {
              name: 'malware.exe',
              size: 1024,
              type: 'application/x-msdownload',
              buffer: new Blob([]),
            },
          ],
        },
      }),
    ).rejects.toThrow(/disallowed MIME type/i);
  });

  it('uploadAssets rejects an SVG payload smuggled in as image/png (magic-byte sniff)', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    // Declared as an allowed raster type, but the bytes are a script-bearing
    // SVG — the exact stored-XSS vector the server-side sniff must catch.
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );

    await expect(
      cms.api.media.uploadAssets({
        body: {
          files: [
            {
              name: 'evil.png',
              size: svg.byteLength,
              type: 'image/png',
              buffer: new Blob([svg]),
            },
          ],
        },
      }),
    ).rejects.toThrow(/disallowed MIME type/i);
  });

  it('uploadAssets rejects declared image/png whose bytes are actually JPEG', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    // Real JPEG magic bytes (FF D8 FF) declared as image/png → content mismatch.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    await expect(
      cms.api.media.uploadAssets({
        body: {
          files: [
            {
              name: 'mislabeled.png',
              size: jpeg.byteLength,
              type: 'image/png',
              buffer: new Blob([jpeg]),
            },
          ],
        },
      }),
    ).rejects.toThrow(/disallowed MIME type/i);
  });

  it('uploadAssets accepts a real JPEG declared as image/jpeg', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    const result = await cms.api.media.uploadAssets({
      body: {
        files: [
          {
            name: 'real.jpg',
            size: jpeg.byteLength,
            type: 'image/jpeg',
            buffer: new Blob([jpeg]),
          },
        ],
      },
    });

    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, result.assets[0].id));
    expect(asset.mimeType).toBe('image/jpeg');
  });

  it('createSignedUpload rejects empty files array', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    await expect(
      cms.api.media.createSignedUpload({ body: { files: [] } }),
    ).rejects.toThrow();
  });

  it('uploadAssets rejects empty files array', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    await expect(
      cms.api.media.uploadAssets({ body: { files: [] as any } }),
    ).rejects.toThrow();
  });

  it('uploadAssets places asset in the specified folder', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const folder = await cms.api.media.createFolder({
      body: { name: 'Server Uploads' },
    });

    const pixel = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const result = await cms.api.media.uploadAssets({
      body: {
        files: [
          {
            name: 'placed.png',
            size: pixel.byteLength,
            type: 'image/png',
            buffer: new Blob([pixel]),
          },
        ],
        folderId: folder.folder.id,
      },
    });

    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, result.assets[0].id));

    expect(asset.folderId).toBe(folder.folder.id);
    // Object key is just the slug in flat S3 structure (no folder in path)
    expect(asset.objectKey).toBe('placed.png');
  });

  it('uploadAssets rejects upload to non-existent folder', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const pixel = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    await expect(
      cms.api.media.uploadAssets({
        body: {
          files: [
            {
              name: 'orphan.png',
              size: pixel.byteLength,
              type: 'image/png',
              buffer: new Blob([pixel]),
            },
          ],
          folderId: 'non-existent-folder',
        },
      }),
    ).rejects.toThrow(/Folder not found/i);
  });
});

// ============================================================================
// variantOf support
// ============================================================================

describe('variantOf support', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
  });

  it('createSignedUpload stores variantOf in the asset record', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    // Create primary asset first
    const primary = await cms.api.media.createSignedUpload({
      body: { files: [{ name: 'photo.webp', size: 1024, type: 'image/webp' }] },
    });

    const primaryId = primary.assets[0].id;

    // Create variant linked to primary
    const variant = await cms.api.media.createSignedUpload({
      body: {
        files: [
          {
            name: 'photo.jpeg',
            size: 2048,
            type: 'image/jpeg',
            variantOf: primaryId,
          },
        ],
      },
    });

    const [variantAsset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, variant.assets[0].id));

    expect(variantAsset.variantOf).toBe(primaryId);
    expect(variantAsset.mimeType).toBe('image/jpeg');
  });

  it('uploadAssets stores variantOf in the asset record', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const pixel = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    // Create primary asset
    const primary = await cms.api.media.uploadAssets({
      body: {
        files: [
          {
            name: 'photo.png',
            size: pixel.byteLength,
            type: 'image/png',
            buffer: new Blob([pixel]),
          },
        ],
      },
    });

    const primaryId = primary.assets[0].id;

    // Create variant
    const variant = await cms.api.media.uploadAssets({
      body: {
        files: [
          {
            name: 'photo-original.png',
            size: pixel.byteLength,
            type: 'image/png',
            buffer: new Blob([pixel]),
            variantOf: primaryId,
          },
        ],
      },
    });

    const [variantAsset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, variant.assets[0].id));

    expect(variantAsset.variantOf).toBe(primaryId);
  });

  it('primary asset has null variantOf by default', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const result = await cms.api.media.createSignedUpload({
      body: {
        files: [{ name: 'standalone.jpg', size: 1024, type: 'image/jpeg' }],
      },
    });

    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, result.assets[0].id));

    expect(asset.variantOf).toBeNull();
  });
});

// ============================================================================
// Slug Collision Handling
// ============================================================================

describe('slug collision handling', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
  });

  it('appends counter when slug already exists', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const first = await cms.api.media.createSignedUpload({
      body: { files: [{ name: 'photo.jpg', size: 1024, type: 'image/jpeg' }] },
    });

    const second = await cms.api.media.createSignedUpload({
      body: { files: [{ name: 'photo.jpg', size: 1024, type: 'image/jpeg' }] },
    });

    expect(first.assets[0].slug).toBe('photo.jpg');
    expect(second.assets[0].slug).toBe('photo-2.jpg');

    // Verify both exist in DB
    const rows = await db.select({ slug: assets.slug }).from(assets);

    const slugs = rows.map((r) => r.slug);
    expect(slugs).toContain('photo.jpg');
    expect(slugs).toContain('photo-2.jpg');
  });

  it('increments counter for multiple collisions', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      const result = await cms.api.media.createSignedUpload({
        body: {
          files: [{ name: 'banner.png', size: 1024, type: 'image/png' }],
        },
      });
      results.push(result.assets[0].slug);
    }

    expect(results).toEqual([
      'banner.png',
      'banner-2.png',
      'banner-3.png',
      'banner-4.png',
    ]);
  });

  it('handles files without extensions', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const first = await cms.api.media.createSignedUpload({
      body: { files: [{ name: 'readme', size: 100, type: 'application/pdf' }] },
    });

    const second = await cms.api.media.createSignedUpload({
      body: { files: [{ name: 'readme', size: 100, type: 'application/pdf' }] },
    });

    expect(first.assets[0].slug).toBe('readme');
    expect(second.assets[0].slug).toBe('readme-2');
  });
});

// ============================================================================
// Variant Delivery via Asset Endpoint
// ============================================================================

describe('variant delivery via asset endpoint', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
  });

  it('serves variant when format/width match an existing variant', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    // Create primary asset
    const [primary] = await db
      .insert(assets)
      .values({
        slug: 'hero.jpg',
        mimeType: 'image/jpeg',
        size: 5000,
        objectKey: 'hero.jpg',
        status: 'public',
      })
      .returning();

    // Create a webp variant
    await db.insert(assets).values({
      slug: 'hero-800-webp.webp',
      mimeType: 'image/webp',
      size: 2000,
      objectKey: 'hero-800-webp.webp',
      status: 'public',
      variantOf: primary.id,
    });

    // Request by id with format=webp&w=800 should resolve to variant (the
    // variant lookup keys off the primary's current slug).
    const res = await cms.router.handler(
      new Request(
        `http://localhost/api/cms/media/asset/${primary.id}?format=webp&w=800`,
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('hero-800-webp.webp');
  });

  it('falls back to original when variant does not exist', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 5000,
        objectKey: 'photo.jpg',
        status: 'public',
      })
      .returning({ id: assets.id });

    // Request a variant that doesn't exist — should fall back to original
    const res = await cms.router.handler(
      new Request(
        `http://localhost/api/cms/media/asset/${asset.id}?format=webp&w=400`,
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('photo.jpg');
  });

  it('returns download Content-Disposition when download=true', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'report.pdf',
        mimeType: 'application/pdf',
        size: 10000,
        objectKey: 'report.pdf',
        status: 'public',
      })
      .returning({ id: assets.id });

    const res = await cms.router.handler(
      new Request(
        `http://localhost/api/cms/media/asset/${asset.id}?download=true`,
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('content-disposition')).toContain(
      'attachment; filename="report.pdf"',
    );
  });
});

// ============================================================================
// Public URL (CDN) vs Signed URL
// ============================================================================

describe('public URL (CDN) delivery', () => {
  it('uses short cache headers and direct CDN URL', async () => {
    const { cms, db } = await setupTestCMS();

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'hero.jpg',
        mimeType: 'image/jpeg',
        size: 2048,
        objectKey: 'hero.jpg',
        status: 'public',
      })
      .returning({ id: assets.id });

    const res = await cms.router.handler(
      new Request(`http://localhost/api/cms/media/asset/${asset.id}`),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://cdn.test.local/hero.jpg');
    // Short-cached (re-resolvable) so a replaceAsset swap propagates; NOT immutable.
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    expect(res.headers.get('cache-control')).not.toContain('immutable');
    expect(res.headers.get('location')).not.toContain('X-Amz-');
  });
});

// ============================================================================
// variantOf Validation
// ============================================================================

describe('variantOf validation', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
  });

  it('rejects createSignedUpload with non-existent variantOf', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    await expect(
      cms.api.media.createSignedUpload({
        body: {
          files: [
            {
              name: 'variant.jpg',
              size: 1024,
              type: 'image/jpeg',
              variantOf: 'nonexistent-asset-id',
            },
          ],
        },
      }),
    ).rejects.toThrow(/Asset not found/i);
  });

  it('rejects uploadAssets with non-existent variantOf', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const pixel = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    await expect(
      cms.api.media.uploadAssets({
        body: {
          files: [
            {
              name: 'variant.png',
              size: pixel.byteLength,
              type: 'image/png',
              buffer: new Blob([pixel]),
              variantOf: 'nonexistent-asset-id',
            },
          ],
        },
      }),
    ).rejects.toThrow(/Asset not found/i);
  });
});

// ============================================================================
// Sequential Upload Slug Safety
// ============================================================================

describe('sequential upload slug safety', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
  });

  it('generates unique slugs when uploading same filename sequentially', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const slugs: string[] = [];
    for (let i = 0; i < 5; i++) {
      const result = await cms.api.media.createSignedUpload({
        body: {
          files: [{ name: 'sequential.jpg', size: 1024, type: 'image/jpeg' }],
        },
      });
      slugs.push(result.assets[0].slug);
    }

    const uniqueSlugs = new Set(slugs);

    // All slugs must be unique
    expect(uniqueSlugs.size).toBe(5);

    // Verify all exist in DB
    const rows = await db.select({ slug: assets.slug }).from(assets);

    for (const slug of slugs) {
      expect(rows.some((r) => r.slug === slug)).toBe(true);
    }
  });

  it('handles multiple files with the same name in a single batch', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;

    const result = await cms.api.media.createSignedUpload({
      body: {
        files: [
          { name: 'batch.jpg', size: 1024, type: 'image/jpeg' },
          { name: 'batch.jpg', size: 2048, type: 'image/jpeg' },
          { name: 'batch.jpg', size: 4096, type: 'image/jpeg' },
        ],
      },
    });

    const slugs = result.assets.map((a) => a.slug);
    const uniqueSlugs = new Set(slugs);
    expect(uniqueSlugs.size).toBe(3);
  });
});

describe('media.archiveAsset', () => {
  it('archives an asset: hidden from listAssets, row archivedAt set', async () => {
    const { cms, db } = await setupTestCMS();

    const folder = await cms.api.media.createFolder({ body: { name: 'Imgs' } });

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'archive-me.png',
        mimeType: 'image/png',
        size: 1024,
        objectKey: 'archive-me.png',
        folderId: folder.folder.id,
      })
      .returning();

    const before = await cms.api.media.listAssets({
      query: { folderId: folder.folder.id },
    });
    expect(before.assets.map((a: any) => a.id)).toContain(asset.id);

    const res = await cms.api.media.archiveAssets({
      body: { assetIds: [asset.id] },
    });
    expect(res.archived).toBe(1);
    expect(res.archivedIds).toContain(asset.id);

    const after = await cms.api.media.listAssets({
      query: { folderId: folder.folder.id },
    });
    expect(after.assets.map((a: any) => a.id)).not.toContain(asset.id);

    const [row] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(row.archivedAt).not.toBeNull();
  });

  it('archives variants alongside their original', async () => {
    const { cms, db } = await setupTestCMS();

    const [original] = await db
      .insert(assets)
      .values({
        slug: 'orig.png',
        mimeType: 'image/png',
        size: 2048,
        objectKey: 'orig.png',
      })
      .returning();

    const [variant] = await db
      .insert(assets)
      .values({
        slug: 'orig-w200.png',
        mimeType: 'image/png',
        size: 512,
        objectKey: 'orig-w200.png',
        variantOf: original.id,
      })
      .returning();

    const res = await cms.api.media.archiveAssets({
      body: { assetIds: [original.id] },
    });
    expect(res.archived).toBe(2);

    const [variantRow] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, variant.id));
    expect(variantRow.archivedAt).not.toBeNull();
  });

  it('throws ASSET_NOT_FOUND for unknown ids', async () => {
    const { cms } = await setupTestCMS();
    await expect(
      cms.api.media.archiveAssets({ body: { assetIds: ['asset_nope'] } }),
    ).rejects.toThrow(/found/i);
  });
});

// ============================================================================
// moveAssets
// ============================================================================

describe('media.moveAssets', () => {
  const insertAsset = (db: any, slug: string, extra: object = {}) =>
    db
      .insert(assets)
      .values({
        slug,
        mimeType: 'image/png',
        size: 10,
        objectKey: slug,
        status: 'public',
        ...extra,
      })
      .returning({ id: assets.id });

  it('moves assets into a folder', async () => {
    const { cms, db } = await setupTestCMS();
    const folder = await cms.api.media.createFolder({
      body: { name: 'Logos' },
    });
    const [a1] = await insertAsset(db, 'a1.png');
    const [a2] = await insertAsset(db, 'a2.png');

    const result = await cms.api.media.moveAssets({
      body: { assetIds: [a1.id, a2.id], folderId: folder.folder.id },
    });

    expect(result.moved).toBe(2);
    expect(new Set(result.movedIds)).toEqual(new Set([a1.id, a2.id]));
    expect(result.skipped).toEqual([]);

    const rows = await db
      .select({ folderId: assets.folderId })
      .from(assets)
      .where(inArray(assets.id, [a1.id, a2.id]));
    expect(rows.every((r: any) => r.folderId === folder.folder.id)).toBe(true);
  });

  it('moves an asset to the root with folderId null', async () => {
    const { cms, db } = await setupTestCMS();
    const folder = await cms.api.media.createFolder({ body: { name: 'F' } });
    const [a] = await insertAsset(db, 'r.png', { folderId: folder.folder.id });

    await cms.api.media.moveAssets({
      body: { assetIds: [a.id], folderId: null },
    });

    const [row] = await db
      .select({ folderId: assets.folderId })
      .from(assets)
      .where(eq(assets.id, a.id));
    expect(row.folderId).toBeNull();
  });

  it('co-moves variants with their original', async () => {
    const { cms, db } = await setupTestCMS();
    const folder = await cms.api.media.createFolder({ body: { name: 'F' } });
    const [orig] = await insertAsset(db, 'o.png');
    const [variant] = await insertAsset(db, 'o-200.webp', {
      mimeType: 'image/webp',
      variantOf: orig.id,
    });

    await cms.api.media.moveAssets({
      body: { assetIds: [orig.id], folderId: folder.folder.id },
    });

    const [v] = await db
      .select({ folderId: assets.folderId })
      .from(assets)
      .where(eq(assets.id, variant.id));
    expect(v.folderId).toBe(folder.folder.id); // variant followed its original
  });

  it('skips a variant id passed on its own (never moved independently)', async () => {
    const { cms, db } = await setupTestCMS();
    const folder = await cms.api.media.createFolder({ body: { name: 'F' } });
    const [orig] = await insertAsset(db, 'o.png');
    const [variant] = await insertAsset(db, 'o-200.webp', {
      mimeType: 'image/webp',
      variantOf: orig.id,
    });

    const result = await cms.api.media.moveAssets({
      body: { assetIds: [variant.id], folderId: folder.folder.id },
    });

    expect(result.moved).toBe(0);
    expect(result.skipped).toEqual([variant.id]);

    // The variant did NOT move — it stays put with its (un-moved) original.
    const [v] = await db
      .select({ folderId: assets.folderId })
      .from(assets)
      .where(eq(assets.id, variant.id));
    expect(v.folderId).toBeNull();
    void orig;
  });

  it('throws FOLDER_NOT_FOUND for an unknown target folder', async () => {
    const { cms, db } = await setupTestCMS();
    const [a] = await insertAsset(db, 'x.png');
    await expect(
      cms.api.media.moveAssets({
        body: { assetIds: [a.id], folderId: 'fld_nope' },
      }),
    ).rejects.toThrow(/folder not found/i);
  });

  it('skips non-existent and archived ids (surfaced in skipped)', async () => {
    const { cms, db } = await setupTestCMS();
    const [live] = await insertAsset(db, 'l.png');
    const [archived] = await insertAsset(db, 'arch.png', {
      archivedAt: new Date(),
    });

    const result = await cms.api.media.moveAssets({
      body: {
        assetIds: [live.id, archived.id, 'ast_nope00000000000000'],
        folderId: null,
      },
    });

    expect(result.moved).toBe(1);
    expect(result.movedIds).toEqual([live.id]);
    expect(new Set(result.skipped)).toEqual(
      new Set([archived.id, 'ast_nope00000000000000']),
    );
  });

  it('throws ASSET_NOT_FOUND when no ids reference a live asset', async () => {
    const { cms } = await setupTestCMS();
    await expect(
      cms.api.media.moveAssets({
        body: { assetIds: ['ast_nope00000000000000'], folderId: null },
      }),
    ).rejects.toThrow(/found/i);
  });
});

// ============================================================================
// replaceAsset
// ============================================================================

describe('media.replaceAsset', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
  });

  const pixel = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const file = (name: string, type = 'image/png') => ({
    name,
    size: pixel.byteLength,
    type,
    buffer: new Blob([pixel]),
  });
  const insertAsset = (db: any, slug: string, extra: object = {}) =>
    db
      .insert(assets)
      .values({
        slug,
        mimeType: 'image/png',
        size: 8,
        objectKey: slug,
        status: 'public',
        ...extra,
      })
      .returning({ id: assets.id });

  it('replaces bytes behind a stable id (new slug/objectKey, same id/folder/status)', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;
    const folder = await cms.api.media.createFolder({
      body: { name: 'Brand' },
    });
    const [orig] = await insertAsset(db, 'acme-logo.png', {
      folderId: folder.folder.id,
    });

    const result = await cms.api.media.replaceAsset({
      body: { assetId: orig.id, file: file('globex-logo.png') },
    });

    expect(result.asset.id).toBe(orig.id); // id unchanged — the whole point
    expect(result.asset.slug).not.toBe('acme-logo.png'); // new slug → cache bust
    expect(result.asset.slug).toContain('globex-logo');
    expect(result.asset.objectKey).toBe(result.asset.slug);

    const [row] = await db.select().from(assets).where(eq(assets.id, orig.id));
    expect(row.slug).toBe(result.asset.slug);
    expect(row.objectKey).toBe(result.asset.objectKey);
    expect(row.folderId).toBe(folder.folder.id); // folder unchanged
    expect(row.status).toBe('public'); // status unchanged
    expect(row.archivedAt).toBeNull();
  });

  it('mints a different slug even when the replacement has the same filename', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;
    const [orig] = await insertAsset(db, 'logo.png');

    const result = await cms.api.media.replaceAsset({
      body: { assetId: orig.id, file: file('logo.png') },
    });

    expect(result.asset.slug).not.toBe('logo.png'); // self-collision → suffix
    expect(result.asset.slug).toContain('logo');
  });

  it('archives the old variants', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;
    const [orig] = await insertAsset(db, 'hero.png');
    const [variant] = await insertAsset(db, 'hero-200-webp.webp', {
      mimeType: 'image/webp',
      variantOf: orig.id,
    });

    await cms.api.media.replaceAsset({
      body: { assetId: orig.id, file: file('hero-new.png') },
    });

    const [v] = await db
      .select({ archivedAt: assets.archivedAt })
      .from(assets)
      .where(eq(assets.id, variant.id));
    expect(v.archivedAt).not.toBeNull(); // old variant archived
  });

  it('rejects replacing a variant directly (CANNOT_REPLACE_VARIANT)', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;
    const [orig] = await insertAsset(db, 'o.png');
    const [variant] = await insertAsset(db, 'o-200.webp', {
      mimeType: 'image/webp',
      variantOf: orig.id,
    });

    await expect(
      cms.api.media.replaceAsset({
        body: { assetId: variant.id, file: file('x.png') },
      }),
    ).rejects.toThrow(/variant/i);
  });

  it('throws ASSET_NOT_FOUND for a missing or archived asset', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;
    const [archived] = await insertAsset(db, 'a.png', {
      archivedAt: new Date(),
    });

    await expect(
      cms.api.media.replaceAsset({
        body: { assetId: archived.id, file: file('x.png') },
      }),
    ).rejects.toThrow(/found/i);
    await expect(
      cms.api.media.replaceAsset({
        body: { assetId: 'ast_nope00000000000000', file: file('x.png') },
      }),
    ).rejects.toThrow(/found/i);
  });

  it('rejects an invalid file type', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;
    const [orig] = await insertAsset(db, 'o.png');

    await expect(
      cms.api.media.replaceAsset({
        body: {
          assetId: orig.id,
          file: file('evil.exe', 'application/x-msdownload'),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a declared image whose bytes contradict it (magic-byte sniff)', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });
    cleanup = s3.cleanup;
    const [orig] = await insertAsset(db, 'o.png');

    // Script-bearing SVG declared as image/png — must be rejected before the
    // replacement object is minted, so the stored image is never swapped for it.
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );

    await expect(
      cms.api.media.replaceAsset({
        body: {
          assetId: orig.id,
          file: {
            name: 'evil.png',
            size: svg.byteLength,
            type: 'image/png',
            buffer: new Blob([svg]),
          },
        },
      }),
    ).rejects.toThrow(/disallowed MIME type/i);

    // The row still points at the original object — nothing was replaced.
    const [row] = await db.select().from(assets).where(eq(assets.id, orig.id));
    expect(row.slug).toBe('o.png');
  });
});
