import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = import.meta.dirname;
const sources = readdirSync(dir).filter(
  (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name),
);

describe('canvas subscriptions', () => {
  it('no effect re-binds on the document version', () => {
    const offenders = sources.filter((name) =>
      /\}, \[[^\]]*\bversion\b[^\]]*\]\);/.test(
        readFileSync(join(dir, name), 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('no canvas part subscribes to the whole node table for event-time data', () => {
    const offenders = sources.filter((name) =>
      ['dnd-parts.tsx', 'inline-parts.tsx', 'components.tsx'].includes(name)
        ? /useDocSelector\(\(s\) => s\.nodes\)/.test(
            readFileSync(join(dir, name), 'utf8'),
          )
        : false,
    );
    expect(offenders).toEqual([]);
  });
});
