import { describe, expect, it } from 'vitest';

import type { DocStore } from '../store/types';

import { createJsonDocStore } from '../store/doc-store';
import {
  DocStoreConformanceError,
  runDocStoreConformance,
} from './docstore-conformance';

describe('runDocStoreConformance', () => {
  it('passes on the JsonDocStore', () => {
    const passed = runDocStoreConformance((initialValue) =>
      createJsonDocStore({ initialValue }),
    );
    expect(passed).toHaveLength(10);
  });

  it('names the failed check for a store that records remote writes', () => {
    const leaky = (
      initialValue: Parameters<typeof createJsonDocStore>[0]['initialValue'],
    ): DocStore => {
      const store = createJsonDocStore({ initialValue });
      return {
        ...store,
        transact: (fn, meta) =>
          store.transact(fn, {
            ...meta,
            origin: meta?.origin === 'remote' ? 'local' : meta?.origin,
          }),
      };
    };
    expect(() => runDocStoreConformance(leaky)).toThrow(
      DocStoreConformanceError,
    );
    expect(() => runDocStoreConformance(leaky)).toThrow(/origin|remote/);
  });
});
