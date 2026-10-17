import { addHook, sanitize } from 'isomorphic-dompurify';

// Absolute URLs must use one of these schemes; relative URLs, fragments and
// paths pass. Everything else (javascript:, data:, vbscript:, ...) is removed.
const SAFE_URI =
  /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

addHook('afterSanitizeAttributes', (node) => {
  if (node.hasAttribute('target')) {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Sanitizes a `richText` HTML value before it reaches
 * `dangerouslySetInnerHTML`: strips scripts and event handlers, limits link
 * protocols to http, https, mailto and tel, and adds `rel="noopener
 * noreferrer"` to every element that keeps a `target`.
 */
export function sanitizeRichTextHtml(html: unknown): string {
  if (typeof html !== 'string' || html === '') return '';
  return sanitize(html, {
    ADD_ATTR: ['target'],
    ALLOWED_URI_REGEXP: SAFE_URI,
  });
}
