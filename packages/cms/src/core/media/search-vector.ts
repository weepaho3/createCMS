/**
 * The weighted full-text document of an asset: A the original file name,
 * B the description, C credit and copyright. Shared by the `assets` GIN
 * index and the `listAssets` query, which must use the identical expression
 * for the planner to pick the index. Column names are unqualified.
 */
export const ASSET_SEARCH_VECTOR_SQL =
  "(setweight(to_tsvector('simple', coalesce(original_name, '')), 'A') || " +
  "setweight(to_tsvector('simple', coalesce(metadata->>'description', '')), 'B') || " +
  "setweight(to_tsvector('simple', coalesce(metadata->'rights'->>'credit', '') || ' ' || coalesce(metadata->'rights'->>'copyright', '')), 'C'))";
