/**
 * Touch conventions of the library: a long press (500 ms, cancelled by more
 * than 10 px of movement, so scrolling never selects) starts the selection
 * mode. Deliberately longer than the editor's drag activation (250 ms).
 */

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_TOLERANCE_PX = 10;

export type LongPress = {
  down(x: number, y: number, pointerType: string): void;
  move(x: number, y: number): void;
  up(): void;
  /** True right after a long press fired, so the following click is ignored. */
  consumeClick(): boolean;
  /** Whether the current press fired, without consuming it. */
  fired(): boolean;
  cancel(): void;
};

/** Tracks one pointer; `onLongPress` fires for touch and pen only. */
export function createLongPress(
  onLongPress: () => void,
  options: { delay?: number; tolerance?: number } = {},
): LongPress {
  const delay = options.delay ?? LONG_PRESS_MS;
  const tolerance = options.tolerance ?? LONG_PRESS_TOLERANCE_PX;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin: { x: number; y: number } | null = null;
  let fired = false;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    origin = null;
  };
  return {
    down(x, y, pointerType) {
      cancel();
      fired = false;
      if (pointerType === 'mouse') return;
      origin = { x, y };
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        onLongPress();
      }, delay);
    },
    move(x, y) {
      if (origin && Math.hypot(x - origin.x, y - origin.y) > tolerance)
        cancel();
    },
    up() {
      cancel();
    },
    consumeClick() {
      const was = fired;
      fired = false;
      return was;
    },
    fired: () => fired,
    cancel,
  };
}

/** Optional haptic tick (10 ms) where the platform has one. */
export function vibrateTick(): void {
  const nav = globalThis.navigator as
    | { vibrate?: (ms: number) => boolean }
    | undefined;
  try {
    nav?.vibrate?.(10);
  } catch {
    // Vibration is a nicety.
  }
}

/**
 * The `accept` of a camera input with the explicit type first (Android
 * hides the camera when only image types are listed otherwise).
 */
export function cameraAccept(kind: 'photo' | 'video'): string {
  return kind === 'photo' ? 'image/jpeg,image/*' : 'video/mp4,video/*';
}
