// Type-only assertions for the client `Serialize` boundary. Checked by
// `check-types`, not executed. If Serialize stops mapping Date → string the
// `@ts-expect-error` below goes unused and tsc fails — self-verifying.

import type { Serialize } from './types';

// A Date becomes the ISO string the wire actually delivers; nested arrays/objects
// are rewritten too; non-Date primitives are untouched; arrays stay mutable.
type Row = {
  id: string;
  createdAt: Date;
  updatedAt: Date | null;
  count: number;
  nested: { at: Date }[];
  actorUser?: { name: string } | null;
};
type SRow = Serialize<Row>;

export const _serializedShape: SRow = {
  id: 'x',
  createdAt: '2026-07-07T00:00:00.000Z',
  updatedAt: null,
  count: 1,
  nested: [{ at: '2026-07-07T00:00:00.000Z' }],
};

// A mutable array stays mutable (push must compile) — regression guard for the
// `Array<infer U>`-before-`ReadonlyArray` ordering in Serialize.
export const _mutable = () => {
  const s: SRow = _serializedShape;
  s.nested.push({ at: 'iso' });
};

// @ts-expect-error - after Serialize, createdAt is `string`, not `Date`
export const _rejectsDate: SRow = { ...(_serializedShape as SRow), createdAt: new Date() };

// A function value is preserved as-is (not mapped into an object).
type _Fn = Serialize<{ fn: (x: number) => Date }>;
export const _fnPreserved: _Fn = { fn: (x) => new Date(x) };
