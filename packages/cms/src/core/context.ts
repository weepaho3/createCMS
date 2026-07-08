import type {
  AnyCollectionDefinition,
  BranchProtectionConfig,
  CMSMiddleware,
  CMSProcedureContext,
  CollectionDefinition,
  CollectionWithName,
  DataRetentionConfig,
  DrizzleInstance,
  MergeStrategy,
} from './types';
import type { ResolvedSlugConfig } from './types/definitions';
import type {
  CMSAfterHook,
  CMSBeforeHook,
  CMSPlugin,
  CMSPluginContext,
} from './types/plugin';

const SLUG_DISABLED: ResolvedSlugConfig = { enabled: false } as const;
const SLUG_DEFAULTS = {
  allowIndex: true,
  normalize: true,
  nested: false,
} as const;

export function resolveCollectionSlug(
  slug: CollectionDefinition['slug'],
): ResolvedSlugConfig {
  return slug?.enabled
    ? { ...SLUG_DEFAULTS, ...slug }
    : (slug ?? SLUG_DISABLED);
}

export function processCollection(
  name: string,
  definition: CollectionDefinition,
): CollectionWithName {
  return {
    ...definition,
    name,
    blocks: definition.blocks ?? {},
    slug: resolveCollectionSlug(definition.slug),
  };
}

export function processCollections<
  TCollections extends Record<string, AnyCollectionDefinition>,
>(collections: TCollections) {
  return Object.fromEntries(
    Object.entries(collections).map(([name, collection]) => [
      name,
      processCollection(name, collection),
    ]),
  ) as { [K in keyof TCollections]: TCollections[K] & { name: string } };
}

export function resolveAuthMiddleware(authMiddleware: CMSMiddleware) {
  return authMiddleware;
}

export function createCMSContext(input: {
  db: DrizzleInstance;
  collections: Record<string, CollectionWithName>;
  dataRetention?: DataRetentionConfig;
  forceCommitMessage?: boolean;
  defaultBranchName?: string;
  branchProtection?: BranchProtectionConfig;
  mergeStrategy?: MergeStrategy;
}): CMSProcedureContext {
  return input;
}

export type PluginInitResult = {
  extraBeforeHooks: CMSBeforeHook[];
  extraAfterHooks: CMSAfterHook[];
};

/**
 * Runs plugin `init` functions sequentially, merging returned context into the
 * live `cmsContext` reference via `Object.assign` (same pattern as better-auth).
 *
 * Plugins that return `options.hooks` contribute additional hooks that are
 * appended after the plugin's own `hooks` field.
 */
export async function runPluginInit(
  cmsContext: CMSPluginContext,
  plugins: CMSPlugin[],
): Promise<PluginInitResult> {
  const extraBeforeHooks: PluginInitResult['extraBeforeHooks'] = [];
  const extraAfterHooks: PluginInitResult['extraAfterHooks'] = [];

  for (const plugin of plugins) {
    if (!plugin.init) continue;

    const result = await plugin.init(cmsContext);
    if (typeof result !== 'object' || result == null) continue;

    if (result.context) {
      // Array fields (e.g. scopeConditions) must be concatenated, not replaced
      const ctx = cmsContext as Record<string, unknown>;
      for (const [key, value] of Object.entries(result.context)) {
        if (Array.isArray(value) && Array.isArray(ctx[key])) {
          (ctx[key] as unknown[]).push(...value);
        } else {
          ctx[key] = value;
        }
      }
    }

    if (result.options?.hooks?.before) {
      extraBeforeHooks.push(...result.options.hooks.before);
    }
    if (result.options?.hooks?.after) {
      extraAfterHooks.push(...result.options.hooks.after);
    }
  }

  return { extraBeforeHooks, extraAfterHooks };
}
