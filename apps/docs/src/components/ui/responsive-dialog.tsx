'use client';

// A dialog that is a bottom drawer (with swipe to close) on phones and a
// centred dialog or side drawer from `md` on, built on the Base UI Drawer.

import { Drawer } from '@base-ui/react/drawer';
import { XIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

type ResponsiveDialogDirection = 'bottom' | 'top' | 'left' | 'right' | 'center';

type DesktopDirection = Exclude<ResponsiveDialogDirection, 'bottom'>;

const SWIPE_CLOSE_DISTANCE_RATIO = 0.25;
const SWIPE_CLOSE_VELOCITY_PX_PER_MS = 0.4;
const SWIPE_VELOCITY_WINDOW_MS = 100;
const RESIZE_SETTLE_MS = 150;
const MORPH_TRANSITION_MS = 550;

interface ResponsiveDialogContextValue {
  direction: ResponsiveDialogDirection;
  isMobile: boolean;
  onOpenChange?: (open: boolean) => void;
  actionsRef: React.RefObject<Drawer.Root.Actions | null>;
  nestedCount: number;
}

const ResponsiveDialogContext =
  React.createContext<ResponsiveDialogContextValue | null>(null);

const useResponsiveDialogContext = () => {
  const ctx = React.useContext(ResponsiveDialogContext);

  if (!ctx) {
    throw new Error(
      'useResponsiveDialogContext must be used within a ResponsiveDialog',
    );
  }

  return ctx;
};

interface DialogStackMethods {
  register: (id: string) => void;
  unregister: (id: string) => void;
}

const DialogStackMethodsContext =
  React.createContext<DialogStackMethods | null>(null);

const DialogStackIdsContext = React.createContext<readonly string[]>([]);

const swipeDirectionFor = (
  direction: ResponsiveDialogDirection,
): 'up' | 'down' | 'left' | 'right' => {
  // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- the default branch maps bottom and center to a downward swipe on purpose
  switch (direction) {
    case 'top': {
      return 'up';
    }

    case 'left': {
      return 'left';
    }

    case 'right': {
      return 'right';
    }

    default: {
      return 'down';
    }
  }
};

interface ResponsiveDialogProps extends Omit<
  React.ComponentProps<typeof Drawer.Root>,
  'swipeDirection' | 'onOpenChange'
> {
  desktopDirection?: DesktopDirection;
  onOpenChange?: (open: boolean) => void;
}

interface ResponsiveDialogProviderProps {
  children: React.ReactNode;
}

const ResponsiveDialogProvider = ({
  children,
}: ResponsiveDialogProviderProps) => {
  const [openIds, setOpenIds] = React.useState<readonly string[]>([]);

  const stackMethods = React.useMemo<DialogStackMethods>(
    () => ({
      register: (id) => {
        setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      },
      unregister: (id) => {
        setOpenIds((prev) => prev.filter((x) => x !== id));
      },
    }),
    [],
  );

  return (
    <Drawer.Provider>
      <DialogStackMethodsContext.Provider value={stackMethods}>
        <DialogStackIdsContext.Provider value={openIds}>
          {children}
        </DialogStackIdsContext.Provider>
      </DialogStackMethodsContext.Provider>
    </Drawer.Provider>
  );
};

const ResponsiveDialog = ({
  onOpenChange,
  desktopDirection = 'center',
  children,
  ...props
}: ResponsiveDialogProps) => {
  const isMobile = useIsMobile();

  const direction: ResponsiveDialogDirection = isMobile
    ? 'bottom'
    : desktopDirection;

  const id = React.useId();
  const actionsRef = React.useRef<Drawer.Root.Actions | null>(null);
  const stackMethods = React.useContext(DialogStackMethodsContext);
  const openIds = React.useContext(DialogStackIdsContext);
  const isOpen = props.open === true;

  // Registers with the DialogStackMethods registry above this subtree while
  // open, so dialogs below it can dim; a mount/open lifecycle, not an event.
  React.useEffect(() => {
    if (!stackMethods || !isOpen) {
      return;
    }

    stackMethods.register(id);

    // oxlint-disable-next-line typescript/consistent-return -- only an open dialog registers in the stack
    return () => {
      stackMethods.unregister(id);
    };
  }, [stackMethods, id, isOpen]);

  const nestedCount = React.useMemo(() => {
    const idx = openIds.indexOf(id);

    return idx === -1 ? 0 : openIds.length - idx - 1;
  }, [openIds, id]);

  const handleOpenChange = React.useCallback(
    (open: boolean, eventDetails: Drawer.Root.ChangeEventDetails) => {
      if (!open && direction === 'center' && eventDetails.reason === 'swipe') {
        eventDetails.cancel();

        return;
      }

      onOpenChange?.(open);
    },
    [onOpenChange, direction],
  );

  const contextValue = React.useMemo(
    () => ({ direction, isMobile, onOpenChange, actionsRef, nestedCount }),
    [direction, isMobile, onOpenChange, actionsRef, nestedCount],
  );

  return (
    <ResponsiveDialogContext.Provider value={contextValue}>
      <Drawer.Root
        swipeDirection={swipeDirectionFor(direction)}
        onOpenChange={handleOpenChange}
        actionsRef={actionsRef}
        {...props}
      >
        {children}
      </Drawer.Root>
    </ResponsiveDialogContext.Provider>
  );
};

const useDirectionMorph = (
  direction: ResponsiveDialogDirection,
): [boolean, (node: HTMLElement | null) => void] => {
  const prevRef = React.useRef(direction);
  const [morphing, setMorphing] = React.useState(false);
  const popupRef = React.useRef<HTMLElement | null>(null);

  const fallbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearFallback = () => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  };

  // A direction flip starts the CSS morph and arms a fallback timeout for
  // when `transitionend` never fires. Layout effect so the morph flag is set
  // in the same commit as the new direction classes.
  React.useLayoutEffect(() => {
    if (prevRef.current === direction) {
      return;
    }

    prevRef.current = direction;
    setMorphing(true);
    clearFallback();
    fallbackTimerRef.current = setTimeout(() => {
      setMorphing(false);
    }, MORPH_TRANSITION_MS);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `clearFallback` only touches refs, the morph follows `direction` alone
  }, [direction]);

  // `transitionend` is the authoritative "morph finished" signal, so it ends
  // the morph early and disarms the fallback timeout.
  React.useEffect(() => {
    const node = popupRef.current;

    if (!node || !morphing) {
      return;
    }

    const onEnd = (e: TransitionEvent) => {
      if (e.target !== node) {
        return;
      }

      if (e.propertyName !== 'transform') {
        return;
      }

      clearFallback();
      setMorphing(false);
    };

    node.addEventListener('transitionend', onEnd);

    // oxlint-disable-next-line typescript/consistent-return -- only a running morph listens for its transition end
    return () => {
      node.removeEventListener('transitionend', onEnd);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `clearFallback` only touches refs, the listener follows `morphing` alone
  }, [morphing]);

  // Clears a still-armed fallback timeout on unmount.
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `clearFallback` only touches refs, so the unmount cleanup needs no dependencies
  React.useEffect(() => clearFallback, []);

  const attachPopup = React.useCallback((node: HTMLElement | null) => {
    popupRef.current = node;
  }, []);

  return [morphing, attachPopup];
};

const useIsWindowResizing = (settleMs = RESIZE_SETTLE_MS) => {
  const [resizing, setResizing] = React.useState(false);
  // While the viewport is being dragged (window `resize` + a settle timer),
  // the popup snaps instead of animating to its new size.
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onResize = () => {
      setResizing(true);

      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        setResizing(false);
      }, settleMs);
    };

    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [settleMs]);

  return resizing;
};

const useSwipeClose = (
  direction: ResponsiveDialogDirection,
  actionsRef: React.RefObject<Drawer.Root.Actions | null>,
): ((node: HTMLElement | null) => void) => {
  const cleanupRef = React.useRef<(() => void) | null>(null);

  return React.useCallback(
    (node: HTMLElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;

      if (!node || direction === 'center') {
        return;
      }

      const popup = node;
      const doc = popup.ownerDocument ?? document;

      let pointerId: number | null = null;
      let startX = 0;
      let startY = 0;
      let sizeAtStart = 0;
      let samples: { x: number; y: number; t: number }[] = [];

      const pushSample = (x: number, y: number, t: number) => {
        samples.push({ x, y, t });
        const cutoff = t - SWIPE_VELOCITY_WINDOW_MS;

        while (samples.length > 2 && samples[0].t < cutoff) {
          samples.shift();
        }
      };

      const reset = () => {
        pointerId = null;
        samples = [];
        sizeAtStart = 0;
      };

      const handleDown = (e: PointerEvent) => {
        if (e.button !== 0) {
          return;
        }

        const target = e.target instanceof Element ? e.target : null;

        if (!target || !popup.contains(target)) {
          return;
        }

        if (target.closest('[data-base-ui-swipe-ignore]')) {
          return;
        }

        ({ pointerId } = e);
        startX = e.clientX;
        startY = e.clientY;
        const rect = popup.getBoundingClientRect();
        sizeAtStart =
          direction === 'left' || direction === 'right'
            ? rect.width
            : rect.height;
        samples = [];
        pushSample(e.clientX, e.clientY, e.timeStamp);
      };

      const handleMove = (e: PointerEvent) => {
        if (pointerId !== e.pointerId) {
          return;
        }

        pushSample(e.clientX, e.clientY, e.timeStamp);
      };

      const handleUp = (e: PointerEvent) => {
        if (pointerId !== e.pointerId) {
          return;
        }

        pushSample(e.clientX, e.clientY, e.timeStamp);

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const [oldest] = samples;
        const newest = samples.at(-1) ?? oldest;
        const windowDt = Math.max(newest.t - oldest.t, 16);
        const windowDx = newest.x - oldest.x;
        const windowDy = newest.y - oldest.y;

        let dragAlong: number;
        let velocityAlong: number;

        switch (direction) {
          case 'bottom': {
            dragAlong = dy;
            velocityAlong = windowDy / windowDt;
            break;
          }

          case 'top': {
            dragAlong = -dy;
            velocityAlong = -windowDy / windowDt;
            break;
          }

          case 'right': {
            dragAlong = dx;
            velocityAlong = windowDx / windowDt;
            break;
          }

          case 'left': {
            dragAlong = -dx;
            velocityAlong = -windowDx / windowDt;
            break;
          }

          default: {
            reset();

            return;
          }
        }

        const size = sizeAtStart;
        reset();

        if (dragAlong <= 0 || size <= 0) {
          return;
        }

        const distanceClose = dragAlong >= size * SWIPE_CLOSE_DISTANCE_RATIO;
        const flickClose = velocityAlong >= SWIPE_CLOSE_VELOCITY_PX_PER_MS;

        if (distanceClose || flickClose) {
          actionsRef.current?.close();
        }
      };

      const handleCancel = (e: PointerEvent) => {
        if (pointerId === e.pointerId) {
          reset();
        }
      };

      popup.addEventListener('pointerdown', handleDown, true);
      doc.addEventListener('pointermove', handleMove, true);
      doc.addEventListener('pointerup', handleUp, true);
      doc.addEventListener('pointercancel', handleCancel, true);

      cleanupRef.current = () => {
        popup.removeEventListener('pointerdown', handleDown, true);
        doc.removeEventListener('pointermove', handleMove, true);
        doc.removeEventListener('pointerup', handleUp, true);
        doc.removeEventListener('pointercancel', handleCancel, true);
      };
    },
    [direction, actionsRef],
  );
};

const ResponsiveDialogPortal = (
  props: React.ComponentProps<typeof Drawer.Portal>,
) => <Drawer.Portal data-slot="responsive-dialog-portal" {...props} />;

type DrawerCloseProps = React.ComponentProps<typeof Drawer.Close>;

const ResponsiveDialogClose = ({ onClick, ...props }: DrawerCloseProps) => {
  const { onOpenChange } = useResponsiveDialogContext();

  return (
    <Drawer.Close
      data-slot="responsive-dialog-close"
      onClick={(e) => {
        onClick?.(e);
        onOpenChange?.(false);
      }}
      {...props}
    />
  );
};

const ResponsiveDialogOverlay = ({
  className,
  ...props
}: React.ComponentProps<typeof Drawer.Backdrop>) => (
  <Drawer.Backdrop
    data-slot="responsive-dialog-overlay"
    className={cn(
      'fixed inset-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs',
      'opacity-[calc(1-var(--drawer-swipe-progress))]',
      'transition-opacity duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]',
      'data-swiping:duration-0',
      'data-ending-style:opacity-0 data-starting-style:opacity-0',
      'data-ending-style:duration-[calc(var(--drawer-swipe-strength)*0.5s)]',
      className,
    )}
    {...props}
  />
);

const POPUP_BASE_CLASSES = cn(
  'group/drawer-content group relative z-50 flex h-auto flex-col border bg-background text-foreground ring-1 ring-foreground/1 outline-none',
  '[transition-property:transform,border-radius,opacity,width,max-width,height,max-height] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform',
  'data-[swiping]:[transition-duration:0ms] data-[swiping]:select-none',
  'data-[resizing]:[transition-duration:0ms]',
  'data-[ending-style]:duration-500',
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-transparent after:transition-[background-color] after:duration-500 after:ease-[cubic-bezier(0.32,0.72,0,1)] after:content-['']",
  'data-[nested-drawer-open]:after:bg-black/10',
);

const POPUP_DIRECTION_CLASSES = {
  bottom: cn(
    'max-h-[95dvh] w-full! max-w-full! overflow-y-auto',
    'origin-[50%_0%] rounded-t-xl rounded-b-none',
    '[transform:translateY(calc(50dvh-50%+var(--drawer-swipe-movement-y,0px)))]',
    'data-[starting-style]:[transform:translateY(100dvh)]',
    'data-[ending-style]:[transform:translateY(100dvh)]',
  ),
  top: cn(
    'max-h-[95dvh] w-full! max-w-full! overflow-y-auto',
    'origin-[50%_100%] rounded-t-none rounded-b-xl',
    '[transform:translateY(calc(-50dvh+50%+var(--drawer-swipe-movement-y,0px)))]',
    'data-[starting-style]:[transform:translateY(-100dvh)]',
    'data-[ending-style]:[transform:translateY(-100dvh)]',
  ),
  right: cn(
    'h-full max-h-full w-2/3 max-w-64 overflow-y-auto',
    'origin-[0%_50%] rounded-l-xl rounded-r-none',
    '[transform:translateX(calc(50vw-50%+var(--drawer-swipe-movement-x,0px)))]',
    'data-[starting-style]:[transform:translateX(100vw)]',
    'data-[ending-style]:[transform:translateX(100vw)]',
  ),
  left: cn(
    'h-full max-h-full w-2/3 max-w-64 overflow-y-auto',
    'origin-[100%_50%] rounded-l-none rounded-r-xl',
    '[transform:translateX(calc(-50vw+50%+var(--drawer-swipe-movement-x,0px)))]',
    'data-[starting-style]:[transform:translateX(-100vw)]',
    'data-[ending-style]:[transform:translateX(-100vw)]',
  ),
  center: cn(
    'h-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto',
    'origin-center rounded-xl',
    '[transform:scale(1)] opacity-100',
    'data-[starting-style]:[transform:scale(0.95)] data-[starting-style]:opacity-0',
    'data-[ending-style]:[transform:scale(0.95)] data-[ending-style]:opacity-0',
  ),
} satisfies Record<ResponsiveDialogDirection, string>;

interface ResponsiveDialogContentProps extends React.ComponentProps<
  typeof Drawer.Popup
> {
  showCloseButton?: boolean;
}

const ResponsiveDialogHandle = ({
  className,
  ...props
}: React.ComponentProps<'div'>) => (
  <div
    data-slot="responsive-dialog-handle"
    aria-hidden
    className={cn('mx-auto h-1 w-25 shrink-0 rounded-full bg-muted', className)}
    {...props}
  />
);

const ResponsiveDialogContent = ({
  className,
  children,
  showCloseButton,
  ref,
  style,
  ...props
}: ResponsiveDialogContentProps) => {
  const { direction, isMobile, actionsRef, nestedCount } =
    useResponsiveDialogContext();

  const attachSwipeClose = useSwipeClose(direction, actionsRef);
  const isResizing = useIsWindowResizing();
  const [isMorphing, attachMorph] = useDirectionMorph(direction);
  const snapDuringResize = isResizing && !isMorphing;

  const setPopupRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      attachSwipeClose(node);
      attachMorph(node);

      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- a React ref is either a callback or an object, and typeof tells them apart
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [attachSwipeClose, attachMorph, ref],
  );

  return (
    <ResponsiveDialogPortal>
      <ResponsiveDialogOverlay />
      <Drawer.Viewport
        data-slot="responsive-dialog-viewport"
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        <Drawer.Popup
          ref={setPopupRef}
          data-slot="responsive-dialog-content"
          data-drawer-direction={direction}
          data-base-ui-swipe-ignore={direction === 'center' ? '' : undefined}
          data-nested-drawer-open={nestedCount > 0 ? '' : undefined}
          data-resizing={snapDuringResize ? '' : undefined}
          style={style}
          className={cn(
            POPUP_BASE_CLASSES,
            POPUP_DIRECTION_CLASSES[direction],
            className,
          )}
          {...props}
        >
          {isMobile && (
            <ResponsiveDialogHandle className="absolute top-3 left-1/2 -translate-x-1/2" />
          )}
          {!isMobile && showCloseButton === true && (
            <ResponsiveDialogClose
              render={
                <Button
                  variant="ghost"
                  className="absolute top-2 right-2"
                  size="icon-sm"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </ResponsiveDialogClose>
          )}
          {/* Base UI starts a mouse or pen swipe on any press in the popup outside
              Drawer.Content and captures the pointer, so checkboxes and list rows never get the click.
              `contents` keeps the children as direct flex items of the popup. */}
          <Drawer.Content className="contents">{children}</Drawer.Content>
        </Drawer.Popup>
      </Drawer.Viewport>
    </ResponsiveDialogPortal>
  );
};

const ResponsiveDialogHeader = ({
  className,
  ...props
}: React.ComponentProps<'div'>) => (
  <div
    data-slot="responsive-dialog-header"
    className={cn('flex flex-col gap-0.5 p-4 md:text-left', className)}
    {...props}
  />
);

const ResponsiveDialogFooter = ({
  className,
  ...props
}: React.ComponentProps<'div'>) => (
  <div
    data-slot="responsive-dialog-footer"
    className={cn('mt-auto flex justify-end gap-2 rounded-b-xl p-4', className)}
    {...props}
  />
);

const ResponsiveDialogTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof Drawer.Title>) => (
  <Drawer.Title
    data-slot="responsive-dialog-title"
    className={cn('text-base font-medium text-foreground', className)}
    {...props}
  />
);

const ResponsiveDialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof Drawer.Description>) => (
  <Drawer.Description
    data-slot="responsive-dialog-description"
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
);

// Portal, Overlay and Handle stay module-private: only ResponsiveDialogContent
// composes them, and nothing outside this file imports them.
export {
  ResponsiveDialog,
  ResponsiveDialogProvider,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
};
