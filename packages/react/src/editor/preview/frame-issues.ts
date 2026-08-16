export type FramePreviewIssue =
  | { kind: 'relative-url'; attribute: 'src' | 'href'; value: string }
  | { kind: 'missing-href' }
  | { kind: 'preview-anchors' };

const ABSOLUTE_URL = /^([a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;

function isRelativeUrl(value: string): boolean {
  if (value === '' || value.startsWith('#')) return false;
  return !ABSOLUTE_URL.test(value);
}

export function collectFrameIssues(
  doc: Document,
): readonly FramePreviewIssue[] {
  const issues: FramePreviewIssue[] = [];

  for (const el of doc.querySelectorAll('[src], [href]')) {
    if (el.hasAttribute('src')) {
      const value = el.getAttribute('src') ?? '';
      if (isRelativeUrl(value)) {
        issues.push({ kind: 'relative-url', attribute: 'src', value });
      }
    }
    if (el.hasAttribute('href')) {
      const value = el.getAttribute('href') ?? '';
      if (isRelativeUrl(value)) {
        issues.push({ kind: 'relative-url', attribute: 'href', value });
      }
    }
  }

  for (const a of doc.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (href === null || href === '') {
      issues.push({ kind: 'missing-href' });
    }
  }

  if (doc.querySelector('[data-editor-block], [data-editor-field]')) {
    issues.push({ kind: 'preview-anchors' });
  }

  return issues;
}
