import type { BlockTreeNode } from './tree';

// ============================================================================
// Resolved Reference (populated at read time by getPublishedContent)
// ============================================================================

/**
 * One published NON-CONTROL branch of a referenced root, as a snapshot. Used
 * by the block-level A/B `variants` on {@link ResolvedReference}. The CONTROL
 * branch is NOT in this list: it fills the top-level `tree`/`properties` of
 * the `ResolvedReference` (the no-JS / AB-off fallback), so re-embedding it
 * here would serialize its subtree twice. `properties` mirrors the (depth-1
 * typed) reference `properties`.
 */
export type PublishedBranchSnapshot<TProps = Record<string, unknown>> = {
  branchId: string;
  properties: TProps;
  tree: BlockTreeNode;
};

export type ResolvedReference<TProps = Record<string, unknown>> = {
  rootId: string;
  collection: string;
  properties: TProps;
  tree: BlockTreeNode;
  /**
   * Present only when this referenced root has a RUNNING A/B test (server
   * fan-out). Top-level `tree`/`properties` are the CONTROL branch (a no-JS /
   * AB-disabled client renders it as-is); the client pre-render pass picks the
   * visitor's variant from `variants` and swaps it in. `variants` lists ONLY
   * the non-control ALTERNATIVE branches, so the control is never duplicated.
   * A pick that matches no `variants` entry leaves the control tree in place.
   * An OPTIONAL field (not a discriminated union) so `isResolvedReference`,
   * which narrows on `tree`/`properties`, keeps matching.
   */
  abTest?: {
    testId: string;
    trafficPercentage: number;
    variants: PublishedBranchSnapshot<TProps>[];
  };
};

/** The kinds a `link` property can point at. */
export type LinkKind = 'internal' | 'external' | 'email' | 'phone';

/**
 * The AUTHORED value of a `link` property, a discriminated union over `kind`.
 * An `internal` link stores the target's `rootId` (a language-aware reference,
 * resolved to the current path at read time, NOT an embedded tree); the other
 * kinds store their literal target. Kept as the stored value in `raw` mode
 * (write input + the editor read).
 */
export type LinkValue =
  | {
      kind: 'internal';
      rootId: string;
      /** The target's collection, needed to resolve its language-aware path. */
      collection: string;
      fragment?: string;
      query?: string;
    }
  | { kind: 'external'; url: string }
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phone: string };

/**
 * The RESOLVED value of a `link` on the published read path (`resolved` mode):
 * every kind is normalised to an `href` for the renderer. An `internal` link's
 * `href` is the target's CURRENT, language-aware path (or `null` when the
 * target is gone / out of scope: the renderer disables the link). External /
 * email / phone are static pass-throughs (`href` = url / `mailto:` / `tel:`).
 */
export type ResolvedLink =
  | {
      kind: 'internal';
      targetRootId: string;
      collection: string;
      href: string | null;
      fragment?: string;
      query?: string;
    }
  | { kind: 'external'; href: string }
  | { kind: 'email'; href: string }
  | { kind: 'phone'; href: string };
