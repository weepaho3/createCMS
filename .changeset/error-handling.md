---
"@createcms/core": patch
---

Error-handling hardening (err-01 … err-18).

Consumer-visible:

- **`cms.$ERROR_CODES` is now the complete registry** (core codes + plugin codes),
  matching `client.$ERROR_CODES` — a plugin-free install previously exposed `{}`
  on the server (err-02). Duplicate/shadowing plugin codes now `console.warn`
  instead of silently overriding (err-16).
- **Validation errors carry their details**: every `VALIDATION_ERROR` (400)
  response body now includes the Zod `issues` array (err-06). Documented in the
  errors reference.
- **New `onAPIError(error, request)` option** on `createCMS` to attach
  logging/monitoring for unexpected, validation, and middleware errors (err-07).
- **State-conflict codes are now `409`** (were `400`): `BRANCH_NAME_ALREADY_EXISTS`,
  `MERGE_REQUEST_ALREADY_EXISTS`, `ROOT_HAS_CHILDREN`, `FOLDER_HAS_CONTENT`,
  `BRANCH_HAS_PUBLICATIONS`, `BRANCH_HAS_OPEN_MERGE_REQUESTS` (err-11).
- **`CMSError` `data` now reaches the wire** and is surfaced on
  `CMSClientError.data` (block-placement + type-mismatch context, err-01).
- `getCMSErrorCode`/`isCMSError` now recognize plugin error codes, not just core
  ones (err-03).
- **Network/transport failures** (offline/DNS/CORS) are now wrapped in
  `CMSClientError` (`status: 0`, `code: 'NETWORK_ERROR'`) so `err instanceof
  CMSClientError` holds (err-14).
- Removed never-thrown codes `MERGE_REQUEST_OUTDATED`, `COMMENT_BODY_REQUIRED`,
  `AB_TEST_WEIGHTS_INVALID`, and the decorative `media-optimize` `$ERROR_CODES`
  (err-04, err-05).
- The Next revalidate webhook now returns the standard `{ message }` error shape
  and rejects malformed JSON with a clean `400` (err-15).

Observability: S3 upload failures now log + carry the underlying cause;
Upstash realtime distinguishes a missing peer from a real misconfiguration; the
A/B middleware and analytics sinks emit a dev-only warning on the first fail-open
(err-08, err-12, err-18). Plugin error-code tables added to the ab-test and i18n
docs (err-13).
