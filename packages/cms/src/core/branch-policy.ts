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
  dismissStaleApprovals: boolean;
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
  const pick = <K extends keyof BranchProtectionConfig>(
    key: K,
  ): BranchProtectionConfig[K] | undefined => override?.[key] ?? global[key];
  return {
    defaultBranchName: ctx.defaultBranchName ?? DEFAULT_BRANCH_NAME,
    // Default false: a published branch stays editable in place unless opted in.
    protectPublishedBranches: pick('protectPublishedBranches') === true,
    requireApprovalToMerge: pick('requireApprovalToMerge') === true,
    // Default false: keep the existing conditional publish behavior.
    requireApprovalBeforePublish: pick('requireApprovalBeforePublish') === true,
    // Default false: an approval survives a subsequent push, matching GitHub's
    // default. Opt in to require re-approval after every push.
    dismissStaleApprovals: pick('dismissStaleApprovals') === true,
    requiredReviewers: Math.max(1, pick('requiredReviewers') ?? 1),
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
