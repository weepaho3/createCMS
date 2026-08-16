// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { collectFrameIssues } from './frame-issues';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('collectFrameIssues', () => {
  it('treats a rooted path href as relative', () => {
    const issues = collectFrameIssues(parse('<a href="/abs">x</a>'));
    expect(issues).toEqual([
      { kind: 'relative-url', attribute: 'href', value: '/abs' },
    ]);
  });

  it('does not flag an https href as relative', () => {
    expect(collectFrameIssues(parse('<a href="https://x">x</a>'))).toEqual([]);
  });

  it('treats a protocol-relative src as absolute', () => {
    expect(collectFrameIssues(parse('<img src="//cdn">'))).toEqual([]);
  });

  it('does not flag a hash href as relative', () => {
    expect(collectFrameIssues(parse('<a href="#x">x</a>'))).toEqual([]);
  });

  it('emits missing-href for an a without href', () => {
    expect(collectFrameIssues(parse('<a>x</a>'))).toEqual([
      { kind: 'missing-href' },
    ]);
  });

  it('emits one preview-anchors when both data attributes exist', () => {
    const issues = collectFrameIssues(
      parse(
        '<section data-editor-block="h1">' +
          '<h1 data-editor-field="text">Hello</h1>' +
          '</section>',
      ),
    );
    expect(issues).toEqual([{ kind: 'preview-anchors' }]);
  });

  it('orders relative-url, then missing-href, then preview-anchors', () => {
    const issues = collectFrameIssues(
      parse(
        '<img src="images/a.png">' +
          '<a>no href</a>' +
          '<a href="https://x">ok</a>' +
          '<div data-editor-block="b"></div>',
      ),
    );
    expect(issues).toEqual([
      { kind: 'relative-url', attribute: 'src', value: 'images/a.png' },
      { kind: 'missing-href' },
      { kind: 'preview-anchors' },
    ]);
  });
});
