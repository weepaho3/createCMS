import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attributePublished,
  changelogSection,
  commentFor,
  prNumbersIn,
} from './linear-release-attribution.mjs';

const CORE = `# @createcms/core

## 0.7.0

### Minor Changes

- [#91](https://github.com/weepaho3/createCMS/pull/91) [\`2e132f7\`](https://github.com/weepaho3/createCMS/commit/2e132f74bc4e762bcd0048a3b9f3164454948f49) Thanks [@weepaho3](https://github.com/weepaho3)! - Block components receive an edit prop.

### Patch Changes

- [#93](https://github.com/weepaho3/createCMS/pull/93) [\`c449046\`](https://github.com/weepaho3/createCMS/commit/c4490467cfb2d8c5004761bb08afa4ac69c14f5a) Thanks [@weepaho3](https://github.com/weepaho3)! - resolveTree.

- [#94](https://github.com/weepaho3/createCMS/pull/94) [\`db18bed\`](https://github.com/weepaho3/createCMS/commit/db18bed1b49402a470ba38399919169c79fc8cbb) Thanks [@weepaho3](https://github.com/weepaho3)! - Template helpers.

## 0.6.0

### Minor Changes

- [#76](https://github.com/weepaho3/createCMS/pull/76) [\`1e6edbf\`](https://github.com/weepaho3/createCMS/commit/1e6edbf) Thanks! - Merges.
`;

const REACT = `# @createcms/react

## 0.2.0

### Minor Changes

- [#95](https://github.com/weepaho3/createCMS/pull/95) [\`abc1234\`](https://github.com/weepaho3/createCMS/commit/abc1234) Thanks! - Field parts.
`;

describe('prNumbersIn', () => {
  it('extracts, dedupes and sorts PR numbers from URLs', () => {
    assert.deepEqual(
      prNumbersIn([
        'https://github.com/weepaho3/createCMS/pull/94',
        'https://github.com/weepaho3/createCMS/pull/12',
        'https://github.com/weepaho3/createCMS/pull/94',
      ]),
      [12, 94],
    );
  });

  it('ignores commit links and non-PR URLs', () => {
    assert.deepEqual(
      prNumbersIn([
        'https://github.com/weepaho3/createCMS/commit/2e132f7',
        'https://linear.app/example/issue/ABC-1/x',
        undefined,
      ]),
      [],
    );
  });
});

describe('changelogSection', () => {
  it('returns the body of the requested version only', () => {
    const section = changelogSection(CORE, '0.7.0');
    assert.match(section, /pull\/91/);
    assert.match(section, /pull\/94/);
    assert.doesNotMatch(section, /pull\/76/);
    assert.doesNotMatch(section, /^## /m);
  });

  it('returns the last section when it is at the end of the file', () => {
    assert.match(changelogSection(CORE, '0.6.0'), /pull\/76/);
  });

  it('returns an empty string for an unknown version', () => {
    assert.equal(changelogSection(CORE, '9.9.9'), '');
    assert.equal(changelogSection(undefined, '0.7.0'), '');
  });
});

describe('attributePublished', () => {
  const changelogs = new Map([
    ['@createcms/core', CORE],
    ['@createcms/react', REACT],
  ]);

  it('maps PRs of the published versions to name@version', () => {
    const byPr = attributePublished(
      [
        { name: '@createcms/core', version: '0.7.0' },
        { name: '@createcms/react', version: '0.2.0' },
      ],
      changelogs,
    );
    assert.deepEqual(byPr.get(91), ['@createcms/core@0.7.0']);
    assert.deepEqual(byPr.get(94), ['@createcms/core@0.7.0']);
    assert.deepEqual(byPr.get(95), ['@createcms/react@0.2.0']);
    assert.equal(byPr.get(76), undefined);
  });

  it('skips packages without a changelog', () => {
    const byPr = attributePublished(
      [{ name: '@createcms/other', version: '1.0.0' }],
      changelogs,
    );
    assert.equal(byPr.size, 0);
  });

  it('collects both packages when one PR ships in two', () => {
    const both = new Map([
      ['@createcms/core', CORE],
      ['@createcms/react', REACT.replace('pull/95', 'pull/94')],
    ]);
    const byPr = attributePublished(
      [
        { name: '@createcms/core', version: '0.7.0' },
        { name: '@createcms/react', version: '0.2.0' },
      ],
      both,
    );
    assert.deepEqual(byPr.get(94), [
      '@createcms/core@0.7.0',
      '@createcms/react@0.2.0',
    ]);
  });
});

describe('commentFor', () => {
  it('names the package version and the PR when shipped', () => {
    assert.equal(
      commentFor({
        prNumbers: [94],
        shipped: ['@createcms/core@0.7.0'],
        releaseLine: '@createcms/core@0.7.0',
      }),
      'Shipped in @createcms/core@0.7.0 (PR #94).',
    );
  });

  it('writes a neutral note when no package lists the PR', () => {
    assert.equal(
      commentFor({
        prNumbers: [84],
        shipped: [],
        releaseLine: '@createcms/core@0.7.0',
      }),
      'Landed on main (PR #84), not part of a package release. Closed with the @createcms/core@0.7.0 release run.',
    );
  });

  it('omits the PR part when the issue has no PR', () => {
    assert.equal(
      commentFor({ prNumbers: [], shipped: [], releaseLine: 'a new release' }),
      'Landed on main, not part of a package release. Closed with the a new release release run.',
    );
  });
});
