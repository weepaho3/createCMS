export type CmsFieldError = {
  blockId: string;
  key: string;
  message: string;
};

export type CmsDocumentError = {
  code: string;
  message: string;
  fields?: CmsFieldError[];
};

export const HEAD_MISMATCH = 'HEAD_MISMATCH';
export const TYPE_MISMATCH = 'TYPE_MISMATCH';
export const BLOCK_NOT_ALLOWED_IN_PARENT = 'BLOCK_NOT_ALLOWED_IN_PARENT';
export const PROTECTED_BRANCH = 'PROTECTED_BRANCH';
export const COMMIT_MESSAGE_REQUIRED = 'COMMIT_MESSAGE_REQUIRED';

type WireBody = {
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
};

type WireError = WireBody & { body?: WireBody };

function readWire(top: WireError): {
  code: string | undefined;
  message: string;
  data: Record<string, unknown> | undefined;
} {
  const body = top.body;
  const code =
    typeof top.code === 'string'
      ? top.code
      : typeof body?.code === 'string'
        ? body.code
        : undefined;
  const data =
    top.data && typeof top.data === 'object'
      ? top.data
      : body?.data && typeof body.data === 'object'
        ? body.data
        : undefined;
  const message =
    typeof top.message === 'string'
      ? top.message
      : typeof body?.message === 'string'
        ? body.message
        : 'Unknown CMS error';
  return { code, message, data };
}

function mapTypeMismatchFields(
  data: Record<string, unknown>,
): CmsFieldError[] | undefined {
  const issues = data.issues;
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  const blockId = typeof data.blockId === 'string' ? data.blockId : '';
  const fields: CmsFieldError[] = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    const row = issue as { path?: unknown[]; message?: string };
    const path = Array.isArray(row.path) ? row.path : [];
    const head = path[0];
    const key =
      typeof head === 'string'
        ? head
        : typeof head === 'number'
          ? String(head)
          : '';
    const msg = typeof row.message === 'string' ? row.message : '';
    fields.push({ blockId, key, message: msg });
  }
  return fields.length > 0 ? fields : undefined;
}

export function readCmsError(err: unknown): CmsDocumentError {
  if (!err || typeof err !== 'object') {
    return { code: 'UNKNOWN', message: 'Unknown CMS error' };
  }
  const { code, message, data } = readWire(err as WireError);
  let fields: CmsFieldError[] | undefined;
  if (code === TYPE_MISMATCH && data) {
    fields = mapTypeMismatchFields(data);
  }
  const error: CmsDocumentError = { code: code ?? 'UNKNOWN', message };
  if (fields) error.fields = fields;
  return error;
}
