export type EditorScrollToOptions = ScrollIntoViewOptions & {
  /**
   * When set, look up `[data-block-id="<id>"]` inside this node only. No
   * fallback to the form registry.
   */
  container?: ParentNode;
};

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function scrollElementIntoView(
  el: Element,
  opts?: ScrollIntoViewOptions,
): void {
  el.scrollIntoView({
    block: opts?.block ?? 'nearest',
    inline: opts?.inline ?? 'nearest',
    behavior: prefersReducedMotion() ? 'auto' : (opts?.behavior ?? 'smooth'),
  });
}
