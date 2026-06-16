import type {
  AnyCollectionDefinition,
  CollectionWithName,
  CMSProcedureCtx,
} from '../types';

import { createApprovalEndpoints } from './approvals';
import { createBlocksEndpoints } from './blocks';
import { createBranchEndpoints } from './branches';
import { createCommentEndpoints } from './comments';
import { createMergeEndpoints } from './merges';
import { createPublicationEndpoints } from './publications';
import { createRedirectEndpoints } from './redirects';

const BLOCK_ONLY_ENDPOINTS = new Set([
  'createBlock',
  'updateBlock',
  'deleteBlock',
  'moveBlock',
  'duplicateBlock',
  'updateBlocks',
]);

export function createCollectionEndpoints<
  TDef extends CollectionWithName,
  // The full collections map, threaded so the publication endpoint can type a
  // resolved reference's `properties` from its TARGET collection (RB6②). Defaults
  // to `{}` (references resolve to untyped ResolvedReference) when not supplied.
  TCollections extends Record<string, AnyCollectionDefinition> = {},
>(def: TDef, ctx: CMSProcedureCtx) {
  const allBlockEndpoints = createBlocksEndpoints(def, ctx);
  const hasBlocks = Object.keys(def.blocks ?? {}).length > 0;

  const blockEndpoints: typeof allBlockEndpoints = hasBlocks
    ? allBlockEndpoints
    : (Object.fromEntries(
        Object.entries(allBlockEndpoints).filter(
          ([key]) => !BLOCK_ONLY_ENDPOINTS.has(key),
        ),
      ) as typeof allBlockEndpoints);

  return {
    ...createApprovalEndpoints(def, ctx),
    ...blockEndpoints,
    ...createBranchEndpoints(def, ctx),
    ...createCommentEndpoints(def, ctx),
    ...createMergeEndpoints(def, ctx),
    ...createPublicationEndpoints<TDef, TCollections>(def, ctx),
    ...createRedirectEndpoints(def, ctx),
  };
}
