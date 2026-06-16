// INTERNAL / test-only. The public `./schema` export was removed (consumers
// generate and import their own schema via `createcms generate`, mirroring
// better-auth). This file stays only so the package's own tests can import the
// table objects by relative path. Not part of the published API.
export * from './core/db/schema.generated';
