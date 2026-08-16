const FORBIDDEN = new Set([
  'allow-scripts',
  'allow-forms',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
]);

/**
 * Scripts, forms and top navigation stay out of the frame sandbox.
 */
export function frameSandboxAttribute(
  selectable: boolean,
  sandbox?: string,
): string {
  const tokens: string[] = [];
  for (const token of (sandbox ?? '').split(/\s+/)) {
    if (!token || FORBIDDEN.has(token) || tokens.includes(token)) {
      continue;
    }
    tokens.push(token);
  }
  if (selectable && !tokens.includes('allow-same-origin')) {
    tokens.push('allow-same-origin');
  }
  return tokens.join(' ');
}
