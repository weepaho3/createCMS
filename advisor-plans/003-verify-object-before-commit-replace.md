# Plan 003: Verify the uploaded object before `media.commitReplace` repoints an asset

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b6a71a6..HEAD -- packages/cms/src/core/routes/media.ts packages/cms/src/core/storage/s3/utils.ts packages/cms/src/test-utils/s3.ts packages/cms/src/core/routes/test/media.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `b6a71a6`, 2026-09-04

## Why this matters

The browser replace flow is two calls: `createSignedReplace` validates the
declared file, mints a new slug/object key and returns a presigned PUT URL;
after the browser PUTs the bytes, `commitReplace` repoints the asset row.
`commitReplace` accepts `objectKey`, `slug`, `mimeType` and `size` from the
request body and writes them straight onto the row. Nothing checks that the
object exists, that the key is the one that was issued, that the type and size
match the object, or that the type is still on the configured allowlist.

Any authenticated editor can therefore repoint an in-scope asset at any key in
the bucket, declare any MIME type (bypassing `allowedMimeTypes`) and any size
(bypassing `maxFileSize` and skewing storage accounting). The public asset gate
then redirects unauthenticated visitors to that object with the declared type.
The in-process `replaceAsset` and `uploadAssets` paths already defend against
exactly this (they re-validate and sniff magic bytes), so the signed path is
the one gap.

After this plan `commitReplace` re-runs the allowlist/size validation,
requires `objectKey` to be derived from `slug` exactly as `createSignedReplace`
derives it, and performs an S3 `HEAD` to confirm the object exists with the
declared content length and content type before touching the row.

## Current state

Files:

- `packages/cms/src/core/routes/media.ts` — `createSignedReplace` (lines ~1360-1470), `commitReplace` (lines ~1473-1676). Both endpoints close over `maxFiles`, `maxFileSize`, `allowedMimeTypes`, `bucketName`, `getS3Client()`, `mediaConfig`.
- `packages/cms/src/core/storage/s3/utils.ts` — `putObject`, `deleteObject`, `signPutObject`, `throwS3Error`, `buildObjectKey`. No `HEAD` helper exists.
- `packages/cms/src/core/media/uploads.ts` — `validateFiles(files, { maxFiles, maxFileSize, allowedMimeTypes })`.
- `packages/cms/src/test-utils/s3.ts` — in-memory S3 server used by the media tests; already answers `HEAD` (same branch as `GET`, lines ~48-62) but does not set `content-length`.
- `packages/cms/src/core/routes/test/media.test.ts` — media endpoint tests; `describe('media.createSignedUpload', ...)` at line ~783 shows how signed flows are driven; a signed-replace `describe` exists near the "Plan 007 part A" comments (grep `createSignedReplace`).

`commitReplace` body and the start of its handler
(`packages/cms/src/core/routes/media.ts:1473-1490`):

```ts
commitReplace: createCMSEndpoint(
  '/media/commitReplace',
  {
    method: 'POST',
    body: z.object({
      assetId: z.string().min(1),
      objectKey: z.string().min(1),
      slug: z.string().min(1),
      mimeType: z.string().min(1),
      size: z.number().int().positive(),
    }),
    metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
  },
  async (ctx) => {
    const { scope } = ctx.context;
    const { assetId, objectKey, slug, mimeType, size } = ctx.body;

    const now = new Date();
    ...
    try {
      const repointedRow = await db.transaction(async (tx) => {
```

The row is updated inside that transaction with
`.set({ slug, objectKey, mimeType, size, updatedAt: now })` (line ~1550).

How `createSignedReplace` validates and derives the key
(`media.ts:1408-1420`):

```ts
validateFiles([{ name: file.name, size: file.size, type: file.type }], {
  maxFiles,
  maxFileSize,
  allowedMimeTypes,
});
const slug = await generateUniqueSlug(db, file.name, undefined, scope);
if (!slug) { throw new CMSError('SLUG_GENERATION_FAILED'); }
const objectKey = buildObjectKey(slug);
```

`buildObjectKey` (`storage/s3/utils.ts:170-172`) returns the slug verbatim.

Existing S3 helper shape to copy (`storage/s3/utils.ts:113-124`):

```ts
export async function deleteObject(
  client: S3Client,
  params: { bucket: string; key: string },
): Promise<Response> {
  const url = `${client.buildBucketUrl(params.bucket)}/${params.key}`;
  return throwS3Error(client.s3.fetch(url, { method: 'DELETE' }));
}
```

`throwS3Error` (lines 27-45) throws `S3Error` on any non-2xx response.

How a validation error is thrown elsewhere in `media.ts` (line ~232, cursor
decoding): `throw new APIError(400, { code: 'VALIDATION_ERROR', message: '...' })`.
`APIError` is imported from `better-call` in that file. `UPLOAD_FAILED` is a
registered `CMSError` code (`errors-data.ts:238`), thrown as
`new CMSError('UPLOAD_FAILED', { message })` at `media.ts:~1773`.

Test S3 server `GET`/`HEAD` branch (`test-utils/s3.ts:48-62`):

```ts
if (method === 'GET' || method === 'HEAD') {
  const obj = store.get(key);
  if (!obj) { res.writeHead(404, ...); res.end(...); return; }
  res.writeHead(200, obj.contentType ? { 'content-type': obj.contentType } : {});
```

## Commands you will need

| Purpose    | Command                                                                         | Expected on success |
| ---------- | ------------------------------------------------------------------------------- | ------------------- |
| Install    | `bun install --frozen-lockfile`                                                 | exit 0              |
| Typecheck  | `bun run --filter=@createcms/core check-types`                                  | exit 0              |
| Tests      | `cd packages/cms && bunx vitest run src/core/routes/test/media.test.ts`         | all pass            |
| Full suite | `bun run --filter=@createcms/core test`                                         | all pass            |
| Lint       | `bun run lint && bunx oxfmt --check`                                            | exit 0              |

(From `CONTRIBUTING.md`; not executed by the advisor.)

## Scope

**In scope**:

- `packages/cms/src/core/storage/s3/utils.ts` — add `headObject`
- `packages/cms/src/core/routes/media.ts` — `commitReplace` handler only
- `packages/cms/src/test-utils/s3.ts` — set `content-length` on `GET`/`HEAD`
- `packages/cms/src/core/routes/test/media.test.ts` — new tests
- `.changeset/commit-replace-verify.md` (create)

**Out of scope**:

- `createSignedUpload` and its orphan-row problem (rows are inserted before the
  browser PUTs; abandoned uploads leave permanent rows). Same family, separate
  plan; do not add a confirm step here.
- `replaceAsset` / `uploadAssets` — already validate; do not touch.
- Adding a new error code to `errors-data.ts` (it also requires regenerating
  `client/errors-data.generated.ts` and updating the docs error-code test).
  Reuse `VALIDATION_ERROR` and `UPLOAD_FAILED`.
- Binding `commitReplace` to a persisted issuance record (nonce/pending row).
  Deferred; see Maintenance notes.

## Git workflow

- Branch: `advisor/003-commit-replace-verify`
- Commit: `fix(media): verify the uploaded object before commitReplace repoints the row`
- Changeset `.changeset/commit-replace-verify.md`:

  ```md
  ---
  '@createcms/core': patch
  ---

  `media.commitReplace` now re-validates the declared MIME type and size
  against the media config, requires `objectKey` to match the issued `slug`,
  and confirms the object exists in the bucket with the declared content
  length and type before repointing the asset row.
  ```

- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `headObject` to the S3 utils

In `packages/cms/src/core/storage/s3/utils.ts`, after `deleteObject`, add:

```ts
/**
 * HEADs an object. Returns `null` when the bucket answers 404; throws
 * `S3Error` on any other non-2xx response.
 */
export async function headObject(
  client: S3Client,
  params: { bucket: string; key: string },
): Promise<{ contentLength: number | null; contentType: string | null } | null> {
  const url = `${client.buildBucketUrl(params.bucket)}/${params.key}`;
  const res = await client.s3.fetch(url, { method: 'HEAD' });
  if (res.status === 404) return null;
  await throwS3Error(Promise.resolve(res));
  const len = res.headers.get('content-length');
  return {
    contentLength: len === null ? null : Number(len),
    contentType: res.headers.get('content-type'),
  };
}
```

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0.

### Step 2: Make the test S3 server report `content-length`

In `packages/cms/src/test-utils/s3.ts`, in the `GET`/`HEAD` branch, change the
`writeHead(200, ...)` call so the headers always include
`'content-length': String(obj.body.length)` in addition to the optional
`content-type`. Keep the rest of the branch unchanged (for `HEAD`, Node
discards the body written by `res.end`).

**Verify**: `cd packages/cms && bunx vitest run src/core/routes/test/media.test.ts` → all existing tests still pass.

### Step 3: Verify before repointing in `commitReplace`

In `packages/cms/src/core/routes/media.ts`, in the `commitReplace` handler,
after `const now = new Date();` and **before** the `orphanedNewObject`
declaration and the transaction, add these checks in order:

1. Re-run the config validation exactly as `createSignedReplace` does:

   ```ts
   validateFiles([{ name: slug, size, type: mimeType }], {
     maxFiles,
     maxFileSize,
     allowedMimeTypes,
   });
   ```

2. Require the key to be the one `createSignedReplace` would have issued:

   ```ts
   if (objectKey !== buildObjectKey(slug)) {
     throw new APIError(400, {
       code: 'VALIDATION_ERROR',
       message: 'objectKey does not match the slug issued by createSignedReplace',
     });
   }
   ```

3. Confirm the object exists and matches the declaration:

   ```ts
   const head = await headObject(getS3Client(), { bucket: bucketName, key: objectKey });
   if (!head) {
     throw new CMSError('UPLOAD_FAILED', {
       message: `No object at "${objectKey}"; the PUT to the signed URL did not complete`,
     });
   }
   if (head.contentLength !== null && head.contentLength !== size) {
     throw new APIError(400, {
       code: 'VALIDATION_ERROR',
       message: `Declared size ${size} does not match the uploaded object (${head.contentLength})`,
     });
   }
   if (head.contentType !== null && head.contentType.split(';')[0].trim() !== mimeType) {
     throw new APIError(400, {
       code: 'VALIDATION_ERROR',
       message: `Declared MIME type "${mimeType}" does not match the uploaded object ("${head.contentType}")`,
     });
   }
   ```

   Import `headObject` from `'../storage/s3/utils'` next to the existing
   `buildObjectKey` / `signPutObject` imports in `media.ts`. `validateFiles`,
   `buildObjectKey`, `APIError`, `CMSError`, `getS3Client`, `bucketName` are
   already in scope in this file — confirm by grep before adding imports.

Update the endpoint's JSDoc `@throws` lines to add:
`VALIDATION_ERROR if mimeType/size fail the media config or do not match the uploaded object, or objectKey does not derive from slug` and
`UPLOAD_FAILED if no object exists at objectKey`.

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0;
`cd packages/cms && bunx vitest run src/core/routes/test/media.test.ts` → existing tests pass (the happy-path signed-replace test PUTs to the test server before committing, so `HEAD` finds the object).

### Step 4: Tests

In `packages/cms/src/core/routes/test/media.test.ts`, find the existing
signed-replace `describe` (grep `createSignedReplace`). Model the new cases on
the happy-path test there (it creates an asset with `uploadAssets` against
`setupTestS3`, calls `createSignedReplace`, PUTs to `signedUrl` with `fetch`,
then calls `commitReplace`). Add:

1. **rejects a commit whose object was never uploaded**: call
   `createSignedReplace`, skip the PUT, call `commitReplace` with the returned
   `objectKey`/`slug` and the declared `mimeType`/`size` →
   `await expect(...).rejects.toMatchObject({ body: { code: 'UPLOAD_FAILED' } })`
   (match the assertion style the file already uses for CMS errors — grep
   `rejects.toThrow` / `toMatchObject` in the file and copy it).
2. **rejects a disallowed MIME type**: PUT the bytes, then `commitReplace` with
   `mimeType: 'application/x-msdownload'` (or any type not in
   `allowedMimeTypes` of the test config) → rejects with `VALIDATION_ERROR`.
3. **rejects a size that does not match the object**: PUT 5 bytes, commit with
   `size: 999` → rejects with `VALIDATION_ERROR`.
4. **rejects an objectKey that does not derive from slug**: PUT, then commit
   with `objectKey: 'some-other-key'` → rejects with `VALIDATION_ERROR`.
5. **rejects a mismatched content type**: PUT with header
   `Content-Type: image/png`, commit with `mimeType: 'image/jpeg'` → rejects
   with `VALIDATION_ERROR`.
6. **the asset row is unchanged after each rejection**: in tests 2-5, select
   the asset row afterwards and assert `objectKey` still equals the original.

**Verify**: `cd packages/cms && bunx vitest run src/core/routes/test/media.test.ts` → all pass, 5-6 new tests.

### Step 5: Full verification and changeset

Create the changeset from the Git workflow section.

**Verify**: `bun run --filter=@createcms/core check-types && bun run lint && bunx oxfmt --check && bun run --filter=@createcms/core test` → all exit 0.

## Test plan

- Five or six new tests in `media.test.ts` (Step 4), modelled on the existing
  signed-replace happy-path test in the same file.
- Existing signed-replace and signed-upload tests must keep passing.

## Done criteria

- [ ] `grep -n "export async function headObject" packages/cms/src/core/storage/s3/utils.ts` → 1 hit
- [ ] `grep -n "headObject(" packages/cms/src/core/routes/media.ts` → at least 1 hit inside `commitReplace`
- [ ] `grep -n "objectKey !== buildObjectKey(slug)" packages/cms/src/core/routes/media.ts` → 1 hit
- [ ] `cd packages/cms && bunx vitest run src/core/routes/test/media.test.ts` → all pass with the new tests
- [ ] `bun run --filter=@createcms/core check-types`, `bun run lint`, `bunx oxfmt --check`, `bun run --filter=@createcms/core test` all exit 0
- [ ] `.changeset/commit-replace-verify.md` exists
- [ ] `git status` shows only in-scope files modified
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- `commitReplace`'s body schema no longer matches the excerpt (fields added or
  removed).
- `buildObjectKey(slug)` no longer returns the slug verbatim, or
  `createSignedReplace` derives the key differently — then the equality check
  in Step 3.2 must mirror whatever derivation it uses; if that derivation
  depends on state not available in `commitReplace`, stop.
- The test S3 server cannot be made to return `content-length` on `HEAD`
  (Step 2) — the size check cannot be tested; stop rather than skipping it.
- `S3Client` (from `core/types/s3`) exposes no `s3.fetch` / `buildBucketUrl`
  the way `deleteObject` uses them.
- The existing happy-path signed-replace test fails after Step 3 because it
  never actually PUTs to the test server — report; do not weaken the check.
- Any verification fails twice.

## Maintenance notes

- This closes the declared-metadata gap but does not bind `commitReplace` to
  a specific issuance: an editor can still call `createSignedReplace`, upload
  a valid object, and commit it to a different in-scope asset id. A persisted
  pending-replace row (assetId → objectKey, expiry) consumed by `commitReplace`
  is the full fix; it needs a schema addition and a pruning rule, so it was
  deferred.
- `createSignedUpload` has the mirror-image problem (rows written before the
  PUT, never confirmed). When a confirm step is added there, reuse
  `headObject` and the same three checks.
- The `content-type` comparison strips parameters (`; charset=...`). If a
  provider normalizes types (e.g. `image/jpg` → `image/jpeg`), the check will
  reject; a reviewer should watch for provider-specific reports.
