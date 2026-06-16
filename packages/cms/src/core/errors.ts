import { APIError } from 'better-call';

export const CMS_ERRORS = {
  BRANCH_NOT_FOUND: { status: 404 as const, message: 'Branch not found' },
  BLOCK_NOT_FOUND: {
    status: 404 as const,
    message: 'Block not found in snapshot',
  },
  PARENT_NOT_FOUND: { status: 404 as const, message: 'Parent block not found' },
  ROOT_NOT_FOUND: {
    status: 404 as const,
    message: 'Root block not found in snapshot',
  },
  ROOT_HAS_CHILDREN: {
    status: 400 as const,
    message:
      'Cannot delete a page that has child pages; archive or move the children first',
  },
  ROOT_IN_USE: {
    status: 409 as const,
    message:
      'Cannot delete: this root is embedded as a reusable block on live pages; remove those references first',
  },
  COMMIT_NOT_FOUND: { status: 404 as const, message: 'Commit not found' },
  FOLDER_NOT_FOUND: { status: 404 as const, message: 'Folder not found' },
  FOLDER_HAS_CONTENT: {
    status: 400 as const,
    message: 'Cannot delete folder that contains assets or subfolders',
  },
  EMPTY_SNAPSHOT: {
    status: 400 as const,
    message: 'Empty snapshot — no versions found',
  },
  BLOCK_ALREADY_DELETED: {
    status: 400 as const,
    message: 'Block is already deleted',
  },
  TYPE_MISMATCH: {
    status: 400 as const,
    message: 'Block type does not match the expected type',
  },
  USER_ID_REQUIRED: {
    status: 400 as const,
    message:
      'userId is required for this route when neither the request nor middleware provides one',
  },
  CANNOT_MOVE_ROOT: {
    status: 400 as const,
    message: 'Cannot move the root block',
  },
  CANNOT_MOVE_INTO_SELF: {
    status: 400 as const,
    message: 'Cannot move an item into itself',
  },
  CANNOT_MOVE_INTO_DESCENDANT: {
    status: 400 as const,
    message: 'Cannot move an item into its own descendant',
  },
  MISSING_TARGET_PROPERTIES: {
    status: 400 as const,
    message: 'targetProperties is required when duplicating a root',
  },
  BRANCH_NAME_ALREADY_EXISTS: {
    status: 400 as const,
    message: 'A branch with this name already exists for this root',
  },
  CANNOT_RENAME_MAIN_BRANCH: {
    status: 400 as const,
    message: 'The main branch cannot be renamed',
  },
  CANNOT_DELETE_MAIN_BRANCH: {
    status: 400 as const,
    message: 'The main branch cannot be deleted',
  },
  BRANCH_HAS_PUBLICATIONS: {
    status: 400 as const,
    message: 'Cannot delete a branch that has active publications',
  },
  BRANCH_HAS_OPEN_MERGE_REQUESTS: {
    status: 400 as const,
    message: 'Cannot delete a branch that is part of open merge requests',
  },
  NO_COMMON_ANCESTOR: {
    status: 400 as const,
    message: 'The two branches share no common ancestor',
  },
  MERGE_REQUEST_NOT_FOUND: {
    status: 404 as const,
    message: 'Merge request not found',
  },
  MERGE_REQUEST_NOT_OPEN: {
    status: 400 as const,
    message: 'Merge request is not open',
  },
  MERGE_REQUEST_NOT_CLOSED: {
    status: 400 as const,
    message: 'Merge request is not closed',
  },
  MERGE_REQUEST_ALREADY_MERGED: {
    status: 400 as const,
    message: 'Merge request has already been merged and cannot be reopened',
  },
  MERGE_REQUEST_ALREADY_EXISTS: {
    status: 400 as const,
    message:
      'An open merge request already exists for this source and target branch',
  },
  MERGE_REQUEST_OUTDATED: {
    status: 400 as const,
    message:
      'Merge request is outdated because the source branch changed after it was opened',
  },
  UNRESOLVED_CONFLICTS: {
    status: 400 as const,
    message: 'Cannot merge: there are unresolved conflicts',
  },
  CONFLICT_NOT_FOUND: {
    status: 404 as const,
    message: 'Merge conflict not found',
  },
  RESOLVED_VERSION_NOT_FOUND: {
    status: 404 as const,
    message:
      'The provided resolvedVersionId does not reference an existing block version',
  },
  APPROVAL_NOT_FOUND: {
    status: 404 as const,
    message: 'Approval not found',
  },
  APPROVAL_ALREADY_REQUESTED: {
    status: 400 as const,
    message: 'An approval has already been requested from this reviewer',
  },
  APPROVAL_NOT_PENDING: {
    status: 400 as const,
    message: 'Approval is not pending',
  },
  APPROVAL_REVIEWER_MISMATCH: {
    status: 403 as const,
    message: 'Only the requested reviewer can approve or reject this request',
  },
  APPROVAL_STALE: {
    status: 400 as const,
    message:
      'Approval is stale: the branch has advanced past the approved commit',
  },
  MERGE_APPROVAL_REQUIRED: {
    status: 400 as const,
    message: 'Cannot merge: approval is required before execution',
  },
  PUBLICATION_APPROVAL_REQUIRED: {
    status: 400 as const,
    message: 'Cannot publish: approval is required before publication',
  },
  APPROVALS_NOT_FULLY_APPROVED: {
    status: 400 as const,
    message: 'Cannot proceed: not all requested approvals are approved',
  },
  BRANCHES_NOT_SAME_ROOT: {
    status: 400 as const,
    message: 'Source and target branches must belong to the same root',
  },
  PUBLICATION_NOT_FOUND: {
    status: 404 as const,
    message: 'Publication not found for this branch',
  },
  PUBLISHED_CONTENT_NOT_FOUND: {
    status: 404 as const,
    message: 'No published content found',
  },
  AMBIGUOUS_SLUG: {
    status: 400 as const,
    message:
      'Multiple roots match this slug — use rootId for an unambiguous lookup',
  },
  DATA_RETENTION_NOT_CONFIGURED: {
    status: 400 as const,
    message: 'dataRetention is not configured for this CMS instance',
  },
  MISSING_REQUIRED_S3_PARAMETERS: {
    status: 400 as const,
    message:
      'Missing required S3 parameters: hostname, accessKeyId, or secretAccessKey',
  },
  UNKNOWN_S3_PROVIDER: {
    status: 400 as const,
    message: 'Unknown S3 provider specified',
  },
  SLUG_GENERATION_FAILED: {
    status: 500 as const,
    message: 'Failed to generate a unique slug after maximum attempts',
  },
  TOO_MANY_FILES: {
    status: 400 as const,
    message: 'Too many files in upload batch',
  },
  FILE_TOO_LARGE: {
    status: 400 as const,
    message: 'One or more files exceed the maximum allowed size',
  },
  INVALID_FILE_TYPE: {
    status: 400 as const,
    message: 'One or more files have a disallowed MIME type',
  },
  UPLOAD_FAILED: {
    status: 500 as const,
    message: 'Server-side upload to S3 failed',
  },
  SLUG_ALREADY_EXISTS: {
    status: 409 as const,
    message:
      'A root with this slug on this collection with this parentRootId already exists',
  },
  SLUG_NOT_ENABLED: {
    status: 400 as const,
    message: 'This collection does not have slugs enabled',
  },
  REDIRECT_NOT_FOUND: {
    status: 404 as const,
    message: 'Redirect not found',
  },
  REDIRECT_INVALID: {
    status: 400 as const,
    message:
      'A redirect endpoint must be a page (rootId) or a path, matching its type',
  },
  REDIRECT_SOURCE_EXISTS: {
    status: 409 as const,
    message: 'An active redirect already exists for this source',
  },
  SLUG_EMPTY_NOT_ALLOWED: {
    status: 400 as const,
    message:
      'Empty slug is not allowed for this collection (allowRoot is false)',
  },
  NESTING_NOT_ENABLED: {
    status: 400 as const,
    message:
      'parentRootId is not allowed — this collection does not have nested pages enabled',
  },
  CIRCULAR_REFERENCE: {
    status: 400 as const,
    message: 'Cannot move a page under itself or one of its descendants',
  },
  PARENT_ROOT_NOT_FOUND: {
    status: 404 as const,
    message: 'Parent root not found in this collection',
  },
  REFERENCE_DEPTH_EXCEEDED: {
    status: 422 as const,
    message:
      'Reference nesting is too deep (a reusable block embeds others past the limit)',
  },
  ASSET_NOT_FOUND: { status: 404 as const, message: 'Asset not found' },
  VARIABLE_NOT_FOUND: { status: 404 as const, message: 'Variable not found' },
  VARIABLE_KEY_EXISTS: {
    status: 409 as const,
    message: 'A variable with this key already exists',
  },
  VARIABLE_IN_USE: {
    status: 409 as const,
    message: 'Cannot delete variable: it is still in use',
  },
  TEMPLATE_NOT_FOUND: { status: 404 as const, message: 'Template not found' },
  TEMPLATE_KEY_EXISTS: {
    status: 409 as const,
    message:
      'A template for this collection/block/property combination already exists',
  },
  ASSET_ACCESS_DENIED: {
    status: 403 as const,
    message: 'This asset is private and requires authentication',
  },
  COMMENT_THREAD_NOT_FOUND: {
    status: 404 as const,
    message: 'Comment thread not found',
  },
  COMMENT_THREAD_ALREADY_RESOLVED: {
    status: 400 as const,
    message: 'Comment thread is already resolved',
  },
  COMMENT_THREAD_NOT_RESOLVED: {
    status: 400 as const,
    message: 'Comment thread is not resolved',
  },
  COMMENT_MESSAGE_NOT_FOUND: {
    status: 404 as const,
    message: 'Comment message not found',
  },
  COMMENT_MESSAGE_DELETED: {
    status: 400 as const,
    message: 'Comment message has been deleted',
  },
  COMMENT_BODY_REQUIRED: {
    status: 400 as const,
    message: 'Body is required for comment messages',
  },
  COMMENT_AUTHOR_MISMATCH: {
    status: 403 as const,
    message: 'Only the author can edit or delete this message',
  },
  NOTIFICATION_NOT_FOUND: {
    status: 404 as const,
    message: 'Notification not found',
  },
  NOTIFICATION_RECIPIENT_MISMATCH: {
    status: 403 as const,
    message: 'You can only access your own notifications',
  },
} as const;

export type CMSErrorCode = keyof typeof CMS_ERRORS;

export type CMSAPIError = APIError & {
  body?: {
    code?: CMSErrorCode | string;
  };
};

export function getCMSErrorCode(error: unknown): CMSErrorCode | undefined {
  if (error instanceof CMSError) {
    return error.cmsCode;
  }

  if (error instanceof APIError) {
    const code = (error as CMSAPIError).body?.code;
    if (code && code in CMS_ERRORS) {
      return code as CMSErrorCode;
    }
  }

  return undefined;
}

export function isCMSError(
  error: unknown,
  code?: CMSErrorCode,
): error is CMSAPIError {
  const cmsCode = getCMSErrorCode(error);

  if (!cmsCode) {
    return false;
  }

  return code ? cmsCode === code : true;
}

/**
 * Type-safe CMS error that extends better-call's APIError.
 * The `code` parameter is a string-literal union of all CMS error codes,
 * so typos are caught at compile time.
 */
export class CMSError extends APIError {
  public readonly cmsCode: CMSErrorCode;

  constructor(
    code: CMSErrorCode,
    overrides?: { message?: string; data?: Record<string, unknown> },
  ) {
    const def = CMS_ERRORS[code];
    super(def.status, {
      message: overrides?.message ?? def.message,
      code,
    });
    this.cmsCode = code;
  }
}

export const errorMessages = {
  blockNotFound: (blockId: string) => `Block not found in snapshot: ${blockId}`,
  parentNotFound: (parentBlockId: string) =>
    `Parent block not found: ${parentBlockId}`,
  blockAlreadyDeleted: (blockId: string) =>
    `Block is already deleted: ${blockId}`,
  typeMismatch: (expected: string, actual: string) =>
    `Type mismatch: expected "${expected}" but block is "${actual}"`,
  folderNotFound: (folderId: string) => `Folder not found: ${folderId}`,
  folderHasContent: (folderId: string) =>
    `Folder contains assets or subfolders and cannot be deleted: ${folderId}`,
  tooManyFiles: (count: number, max: number) =>
    `Upload contains ${count} files but the maximum is ${max}`,
  fileTooLarge: (fileName: string, size: number, max: number) =>
    `File "${fileName}" is ${(size / 1024 / 1024).toFixed(1)}MB but the maximum is ${(max / 1024 / 1024).toFixed(1)}MB`,
  invalidFileType: (fileName: string, mimeType: string) =>
    `File "${fileName}" has disallowed MIME type "${mimeType}"`,
  uploadFailed: (fileName: string, status: number) =>
    `Server-side upload failed for "${fileName}" with status ${status}`,
  assetNotFound: (assetId: string) => `Asset not found: ${assetId}`,
} as const;
