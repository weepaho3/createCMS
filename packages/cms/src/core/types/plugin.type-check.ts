// Type-only assertions for the `definePlugin` authoring helper (ts-03). Checked
// by `check-types` (tsc --noEmit over src), not executed. The `@ts-expect-error`
// directives are self-verifying: if the guarantee regresses, the directive goes
// unused and tsc fails.
//
// Why the helper exists: authoring a plugin inline is fragile. The
// `{ id: 'abTest', endpoints } satisfies CMSPlugin` pattern rejects typo'd
// fields but WIDENS `id` to `string`, and `const p: CMSPlugin = {...}` erases
// `endpoints` to `Record<string, Endpoint>`. Either way `InferPluginNamespaces`
// can no longer key `cms.api` by the literal `id`, so `cms.api.<id>` degrades to
// a `string` index signature. `definePlugin` preserves BOTH the literal `id`
// (via the `const` type-param modifier) and the exact `endpoints` record, while
// still rejecting unknown top-level keys.

import type { Endpoint } from 'better-call';

import { allowAnonymous, defineCollections, definePlugin } from '../define';
import { createCMS } from '../factory';
import type { DrizzleInstance } from './drizzle';
import type { MediaConfig } from './s3';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

declare const db: DrizzleInstance;
declare const media: MediaConfig;
declare const ep: Endpoint;
const collections = defineCollections({});

const abPlugin = definePlugin({
  id: 'abTest',
  endpoints: { getStatus: ep },
});

// --- `id` stays a literal (not widened to `string`) ------------------------
export type _IdLiteral = Expect<Equal<(typeof abPlugin)['id'], 'abTest'>>;

// --- the exact `endpoints` record is preserved (not `Record<string, …>`) ----
export type _EndpointsPreserved = Expect<
  Equal<keyof (typeof abPlugin)['endpoints'], 'getStatus'>
>;

// --- a plugin with the full optional surface still compiles ----------------
export const _full = definePlugin({
  id: 'full',
  endpoints: { x: ep },
  hooks: { before: [], after: [] },
  async init() {
    return { context: {} };
  },
});

// --- an unknown top-level key is rejected (safer than `satisfies`) ----------
export const _rejectsUnknownKey = definePlugin({
  id: 'x',
  endpoints: { x: ep },
  // @ts-expect-error - `endpointz` is not a CMSPlugin field
  endpointz: {},
});

// --- the literal `id` surfaces as a real `cms.api.<id>` namespace key -------
const cms = createCMS({
  db,
  media,
  collections,
  plugins: [abPlugin],
  authMiddleware: allowAnonymous(),
});
void cms.api.abTest;

// --- …and there is NO `string` index signature: an arbitrary namespace key
//     is a compile error (would compile if `id` had widened to `string`).
export const _noNamespaceIndexSignature = () =>
  // @ts-expect-error - `somethingArbitrary` is not a plugin namespace on cms.api
  cms.api.somethingArbitrary;
