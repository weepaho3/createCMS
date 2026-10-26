import * as React from 'react';

type Rect = { x: number; y: number; width: number; height: number };

/** The box of block `id` in the frame's viewport, or `null` when absent. */
function blockRect(doc: Document, id: string): Rect | null {
  const el = doc.querySelector(`[data-editor-block="${CSS.escape(id)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

/**
 * Keeps the boxes of `ids` in `doc` current: re-measured once per frame
 * after a scroll in the frame, a resize of the frame or its content, and
 * whenever `ids` or `version` change.
 */
function useFrameRects(
  doc: Document | null,
  ids: readonly (string | null)[],
  version: unknown,
): (Rect | null)[] {
  const [rects, setRects] = React.useState<(Rect | null)[]>(() =>
    ids.map(() => null),
  );
  const key = ids.join('\0');
  const idsRef = React.useRef(ids);
  idsRef.current = ids;
  React.useLayoutEffect(() => {
    const ids = idsRef.current;
    const view = doc?.defaultView;
    if (!doc || !view) {
      setRects(ids.map(() => null));
      return;
    }
    const measure = () =>
      setRects((prev) => {
        const next = ids.map((id) => (id ? blockRect(doc, id) : null));
        return next.every((rect, i) => sameRect(rect, prev[i] ?? null))
          ? prev
          : next;
      });
    measure();
    let frame = 0;
    const schedule = () => {
      if (frame === 0) {
        frame = view.requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
      }
    };
    view.addEventListener('scroll', schedule, { passive: true });
    view.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    if (doc.documentElement) observer.observe(doc.documentElement);
    return () => {
      if (frame !== 0) view.cancelAnimationFrame(frame);
      view.removeEventListener('scroll', schedule);
      view.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [doc, key, version]);
  return rects;
}

function ringStyle(rect: Rect): React.CSSProperties {
  return {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    boxSizing: 'border-box',
    pointerEvents: 'none',
    ['--x' as string]: `${rect.x}px`,
    ['--y' as string]: `${rect.y}px`,
    ['--w' as string]: `${rect.width}px`,
    ['--h' as string]: `${rect.height}px`,
  };
}

/**
 * Selection and hover rings over a frame preview, in the host page: the
 * same `data-editor-selection-ring` and `data-editor-hover-ring` markers as
 * `Canvas.SelectionRing` and `Canvas.HoverRing`, plus `data-editor-frame-ring`,
 * clipped to the frame.
 */
export function FrameRings({
  doc,
  selected,
  hovered,
  version,
  blockType,
}: {
  doc: Document | null;
  selected: string | null;
  hovered: string | null;
  version: unknown;
  blockType: (id: string) => string | null;
}) {
  const hover = hovered !== selected ? hovered : null;
  const [selectedRect, hoverRect] = useFrameRects(
    doc,
    [selected, hover],
    version,
  );
  if (!selectedRect && !hoverRect) return null;
  return (
    <div
      data-editor-frame-rings=""
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {hover && hoverRect ? (
        <div
          data-editor-hover-ring=""
          data-editor-frame-ring=""
          data-state="hover"
          data-block-type={blockType(hover) ?? undefined}
          style={ringStyle(hoverRect)}
        />
      ) : null}
      {selected && selectedRect ? (
        <div
          data-editor-selection-ring=""
          data-editor-frame-ring=""
          data-state="selected"
          data-block-type={blockType(selected) ?? undefined}
          style={ringStyle(selectedRect)}
        />
      ) : null}
    </div>
  );
}
