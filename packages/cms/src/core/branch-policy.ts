import type {
  BranchProtectionConfig,
  CMSProcedureContext,
  MergeStrategy,
} from './types';

/** The default branch name when none is configured. */
export const DEFAULT_BRANCH_NAME = 'main';

/** The default merge strategy when none is configured. */
export const DEFAULT_MERGE_STRATEGY: MergeStrategy = 'fast-forward';

/**
 * The resolved branch-governance policy for a request, with all defaults
 * applied. Read once per route from the closure context.
 */
export type ResolvedBranchPolicy = {
  defaultBranchName: string;
  protectPublishedBranches: boolean;
  requireApprovalToMerge: boolean;
  requireApprovalBeforePublish: boolean;
  requiredReviewers: number;
  mergeStrategy: MergeStrategy;
};

/**
 * Resolves {@link CMSProcedureContext} branch settings into a policy with defaults.
 * A per-collection `override` (the collection's own `branchProtection`) wins over
 * the global config field-by-field; an unset field inherits the global value,
 * then the default. Read once per route from the closure context.
 */
export function resolveBranchPolicy(
  ctx: CMSProcedureContext,
  override?: Partial<BranchProtectionConfig>,
): ResolvedBranchPolicy {
  const global = ctx.branchProtection ?? {};
  // Field-by-field: collection override (incl. an explicit `false`) wins, else
  // the global value, else undefined → the default applied below.
  const pick = <K extends keyof BranchProtectionConfig>(
    key: K,
  ): BranchProtectionConfig[K] | undefined => override?.[key] ?? global[key];
  return {
    defaultBranchName: ctx.defaultBranchName ?? DEFAULT_BRANCH_NAME,
    // Default false: a published branch stays editable in place unless opted in.
    protectPublishedBranches: pick('protectPublishedBranches') === true,
    // Default false: a merge needs no approval unless explicitly opted in.
    requireApprovalToMerge: pick('requireApprovalToMerge') === true,
    // Default false: keep the existing conditional publish behavior.
    requireApprovalBeforePublish: pick('requireApprovalBeforePublish') === true,
    requiredReviewers: Math.max(1, pick('requiredReviewers') ?? 1),
    // Default 'fast-forward': keep the leanest history unless opted into merge commits.
    mergeStrategy: ctx.mergeStrategy ?? DEFAULT_MERGE_STRATEGY,
  };
}

/**
 * Whether an approval gate passes: every requested reviewer has approved AND at
 * least `requiredReviewers` distinct reviewers approved. At `requiredReviewers=1`
 * this is exactly "all requested reviewers approved" (the prior behavior).
 */
export function approvalGatePasses(
  state: { allApproved: boolean; approved: number },
  requiredReviewers: number,
): boolean {
  return state.allApproved && state.approved >= requiredReviewers;
}
