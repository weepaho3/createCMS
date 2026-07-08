export const $ERROR_CODES = {
  AB_TEST_NOT_FOUND: {
    status: 404 as const,
    message: 'A/B test not found',
  },
  AB_TEST_INVALID_STATUS: {
    status: 400 as const,
    message: 'Invalid status transition for this A/B test',
  },
  AB_TEST_DUPLICATE_RUNNING: {
    status: 409 as const,
    message: 'Another test is already running for this root',
  },
  AB_TEST_CROSS_EMBED_CONFLICT: {
    status: 409 as const,
    message:
      'Cannot run: a co-rendering root (an embedded reusable block or its host page) already has a running test — at most one A/B axis may vary per render',
  },
  AB_TEST_BRANCH_NOT_PUBLISHED: {
    status: 400 as const,
    message: 'All variant branches must be published',
  },
  AB_TEST_NO_CONTEXT: {
    status: 400 as const,
    message: 'No visitor context set. Call identify() first.',
  },
  AB_TEST_FLUSH_NOT_SUPPORTED: {
    status: 400 as const,
    message: 'Flush is not supported by the current analytics adapter',
  },
  AB_TEST_VARIANT_NOT_FOUND: {
    status: 404 as const,
    message: 'A/B test variant not found',
  },
  AB_TEST_TRACKING_ID_MISSING: {
    status: 400 as const,
    message:
      'A functional block (one that declares events) is missing its trackingId — every such block must have a non-empty trackingId before the branch can be published',
  },
  AB_TEST_TRACKING_ID_DUPLICATE: {
    status: 400 as const,
    message:
      'Duplicate trackingId in this branch — each functional block must have a unique trackingId',
  },
  AB_TEST_TRACKING_ID_DRIFT: {
    status: 409 as const,
    message:
      'trackingId drift across A/B variant branches — the set of functional trackingIds must be identical across all variant branches of a root, so a chosen goal exists in every arm',
  },
} as const;
