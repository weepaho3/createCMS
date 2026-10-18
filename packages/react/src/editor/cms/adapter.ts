import type { AnyCollectionDefinition, BlockTreeNode } from '@createcms/schema';

import type {
  EditorAdapter,
  EditorAdapterErrorKind,
  EditorDocument,
} from '../core';
import type { CmsDocumentClient } from './types';

import { EditorAdapterError } from '../core';
import {
  BLOCK_NOT_ALLOWED_IN_PARENT,
  COMMIT_MESSAGE_REQUIRED,
  HEAD_MISMATCH,
  PROTECTED_BRANCH,
  TYPE_MISMATCH,
  readCmsError,
} from './errors';
import { fromEditor, toEditor } from './mapping';

export type CreateCmsAdapterOptions = {
  /** One collection namespace of the createcms client (`cmsClient.pages`). */
  client: CmsDocumentClient;
  /** The collection definition the documents follow. */
  definition: AnyCollectionDefinition;
  /** The branch every `load(rootId)` / `save(rootId, ...)` reads and writes. */
  branchId: string;
  /** Ask `getBlockTree` for the `references` sidecar. Default `true`. */
  includeReferencePreviews?: boolean;
};

/** What `load` saw besides the document: head commit and reference previews. */
export type CmsLoadSnapshot = {
  doc: EditorDocument;
  tree: BlockTreeNode;
  headCommitId: string;
  references: Record<string, BlockTreeNode>;
};

/** A createcms-backed `EditorAdapter` plus the createcms details its hooks need. */
export type CmsAdapter = EditorAdapter & {
  /** `load` with the raw tree, head commit and reference sidecar. */
  loadSnapshot(rootId: string): Promise<CmsLoadSnapshot>;
};

const KIND_BY_CODE: Record<string, EditorAdapterErrorKind> = {
  [HEAD_MISMATCH]: 'conflict',
  [TYPE_MISMATCH]: 'validation',
  [BLOCK_NOT_ALLOWED_IN_PARENT]: 'validation',
  [COMMIT_MESSAGE_REQUIRED]: 'validation',
  [PROTECTED_BRANCH]: 'permission',
  FORBIDDEN: 'permission',
  UNAUTHORIZED: 'permission',
  ROOT_NOT_FOUND: 'not-found',
  BRANCH_NOT_FOUND: 'not-found',
};

/** Wraps a createcms client error as an `EditorAdapterError`, keeping `code` and field findings. */
export function toAdapterError(err: unknown): EditorAdapterError {
  if (err instanceof EditorAdapterError) return err;
  const cms = readCmsError(err);
  const kind =
    KIND_BY_CODE[cms.code] ??
    (err instanceof TypeError ? 'network' : 'unknown');
  return new EditorAdapterError(
    kind,
    cms.message,
    cms.fields ? { code: cms.code, fields: cms.fields } : { code: cms.code },
    { cause: err },
  );
}

/**
 * An `EditorAdapter` over a createcms collection client: `load` reads the
 * raw tree and the branch head, `save` writes with `expectedHeadCommitId`
 * set to `baseVersion` (omit it to overwrite) and returns the new commit id
 * as `version`. Trees are mapped with `toEditor`/`fromEditor`. Failures
 * throw `EditorAdapterError`; `HEAD_MISMATCH` is kind `conflict` and carries
 * the server's document and head as `details.serverDoc` and
 * `details.serverVersion` when they could be loaded.
 */
export function createCmsAdapter(options: CreateCmsAdapterOptions): CmsAdapter {
  const { client, definition, branchId } = options;
  const includeReferencePreviews = options.includeReferencePreviews ?? true;

  const loadSnapshot = async (rootId: string): Promise<CmsLoadSnapshot> => {
    try {
      const [blocks, branch] = await Promise.all([
        client.getBlockTree({
          query: { rootId, branchId, raw: true, includeReferencePreviews },
        }),
        client.getBranch({ query: { branchId } }),
      ]);
      return {
        doc: toEditor(blocks.tree, definition),
        tree: blocks.tree,
        headCommitId: branch.headCommitId,
        references: blocks.references ?? {},
      };
    } catch (err) {
      throw toAdapterError(err);
    }
  };

  return {
    loadSnapshot,
    async load(rootId) {
      return (await loadSnapshot(rootId)).doc;
    },
    // Sections (`$ref`) resolve in this adapter's collection; references
    // into another collection use an adapter on that collection's client.
    async resolveReference(ref) {
      return (await loadSnapshot(ref.id)).doc;
    },
    async save(rootId, doc, ctx) {
      try {
        const result = await client.updateBlocks({
          body: {
            rootId,
            branchId,
            tree: fromEditor(doc, definition),
            message: ctx.message,
            expectedHeadCommitId: ctx.baseVersion,
          },
        });
        return { version: result.commit.id };
      } catch (err) {
        const error = toAdapterError(err);
        if (error.kind !== 'conflict') throw error;
        // The editor offers "load the server's version": hand it along.
        const server = await loadSnapshot(rootId).catch(() => null);
        throw new EditorAdapterError(
          'conflict',
          error.message,
          server
            ? {
                ...error.details,
                serverDoc: server.doc,
                serverVersion: server.headCommitId,
              }
            : error.details,
          { cause: err },
        );
      }
    },
  };
}
