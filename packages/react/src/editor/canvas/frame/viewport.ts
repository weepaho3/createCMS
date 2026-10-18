/** A preview width; `full` takes the space the canvas has. */
export type Breakpoint = {
  readonly id: string;
  readonly width: number | 'full';
  readonly label?: string;
};

export const DEFAULT_BREAKPOINTS: readonly Breakpoint[] = [
  { id: 'mobile', width: 360, label: 'Mobile' },
  { id: 'tablet', width: 768, label: 'Tablet' },
  { id: 'desktop', width: 1280, label: 'Desktop' },
  { id: 'full', width: 'full', label: 'Full width' },
];

/** An auto-height frame never grows past this. */
export const MAX_AUTO_HEIGHT = 20_000;

/** Consecutive equal growth steps that count as a height feedback loop. */
export const HEIGHT_LOOP_STEPS = 10;

const MIN_SCALE = 0.05;

/** The scale that fits `width` into `available` (never above 1, never 0). */
export function fitScale(available: number, width: number): number {
  if (!(available > 0) || !(width > 0)) return 1;
  return Math.max(MIN_SCALE, Math.min(1, available / width));
}

/**
 * The breakpoint a free width falls into: the widest fixed one not wider
 * than `width` (991 gives 768), else the narrowest.
 */
export function breakpointFor(
  width: number,
  breakpoints: readonly Breakpoint[] = DEFAULT_BREAKPOINTS,
): Breakpoint | undefined {
  const fixed = breakpoints
    .filter((bp): bp is Breakpoint & { width: number } => bp.width !== 'full')
    .sort((a, b) => a.width - b.width);
  let match = fixed[0];
  for (const bp of fixed) if (bp.width <= width) match = bp;
  return match;
}

/**
 * Follows the content height of `doc` and reports it (at most once per
 * animation frame, capped at `maxHeight`). Growth by the same amount on
 * `HEIGHT_LOOP_STEPS` reports in a row is a feedback loop (a `100vh` block
 * in a frame sized to its content): tracking stops and `onLoop` runs.
 * The observer comes from `host`, whose realm keeps running callbacks.
 */
export function trackContentHeight(
  doc: Document,
  host: Window & typeof globalThis,
  options: {
    onHeight: (height: number) => void;
    onLoop: () => void;
    maxHeight?: number;
  },
): () => void {
  const maxHeight = options.maxHeight ?? MAX_AUTO_HEIGHT;
  let last = -1;
  let lastDelta = 0;
  let streak = 0;
  let frame = 0;
  let stopped = false;

  const measure = () => {
    frame = 0;
    if (stopped) return;
    const height = Math.min(
      maxHeight,
      Math.ceil(doc.documentElement.getBoundingClientRect().height),
    );
    if (height === last) return;
    const delta = height - last;
    if (last >= 0 && delta > 0 && delta === lastDelta) streak += 1;
    else streak = delta > 0 ? 1 : 0;
    lastDelta = delta;
    last = height;
    if (streak >= HEIGHT_LOOP_STEPS) {
      stop();
      options.onLoop();
      return;
    }
    options.onHeight(height);
  };

  const schedule = () => {
    if (!frame && !stopped) frame = host.requestAnimationFrame(measure);
  };

  const observer = new host.ResizeObserver(schedule);
  observer.observe(doc.documentElement);
  if (doc.body) observer.observe(doc.body);
  schedule();

  function stop() {
    stopped = true;
    observer.disconnect();
    if (frame) host.cancelAnimationFrame(frame);
  }
  return stop;
}
