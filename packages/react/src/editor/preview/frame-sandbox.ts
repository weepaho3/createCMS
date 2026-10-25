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

/**
 * Whether listeners the host adds inside `doc` run. WebKit runs none in a
 * frame sandboxed without `allow-scripts` (observers still fire), so the
 * host has to read clicks from its own document there.
 */
export function frameListenersRun(doc: Document): boolean {
  let ran = false;
  const probe = () => {
    ran = true;
  };
  const EventCtor = doc.defaultView?.Event ?? Event;
  doc.addEventListener('editor-listener-probe', probe);
  doc.dispatchEvent(new EventCtor('editor-listener-probe'));
  doc.removeEventListener('editor-listener-probe', probe);
  return ran;
}
