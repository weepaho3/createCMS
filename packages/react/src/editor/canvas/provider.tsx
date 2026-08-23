import * as React from 'react';

import type { CanvasInteractive } from './components';
import type { Measurer } from './measurer';

import { createDndStore, type DndStore } from './dnd';
import { createPointerStore, type PointerStore } from './pointer';

/**
 * One registered Canvas.Root surface. The handle object is stable for the
 * surface's lifetime; the owning Root updates `interactive` and `editing` in
 * place so gesture-time reads see current values without re-registering
 * (registration order is the paint-order tiebreak and must not change).
 */
export type CanvasSurfaceHandle = {
  readonly host: HTMLElement;
  readonly measurer: Measurer;
  readonly interactive: CanvasInteractive;
  readonly editing: boolean;
};

export type CanvasSessionContextValue = {
  readonly dnd: DndStore;
  readonly pointer: PointerStore;
  subscribeSurfaces: (listener: () => void) => () => void;
  /** Registered surfaces in mount order; reads are synchronous so gesture
   * handlers always see the current set without a re-render. */
  getSurfaces: () => ReadonlyArray<CanvasSurfaceHandle>;
  registerSurface: (surface: CanvasSurfaceHandle) => () => void;
};

export function createCanvasSession(): CanvasSessionContextValue {
  const dnd = createDndStore();
  const pointer = createPointerStore();
  const listeners = new Set<() => void>();
  let surfaces: ReadonlyArray<CanvasSurfaceHandle> = [];

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    dnd,
    pointer,
    subscribeSurfaces(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSurfaces() {
      return surfaces;
    },
    registerSurface(surface) {
      surfaces = [...surfaces, surface];
      notify();
      return () => {
        surfaces = surfaces.filter((entry) => entry !== surface);
        notify();
      };
    },
  };
}

export const CanvasSessionContext =
  React.createContext<CanvasSessionContextValue | null>(null);

export function useCanvasSession(
  componentName: string,
): CanvasSessionContextValue {
  const value = React.useContext(CanvasSessionContext);
  if (value === null) {
    throw new Error(
      `${componentName} must be used within a Canvas.Provider or Canvas.Root component.`,
    );
  }
  return value;
}

export type CanvasProviderProps = {
  children?: React.ReactNode;
};

/**
 * Owns one drag session (dnd and pointer stores) shared by every part below
 * it. `Canvas.Root` registers itself as a surface, so gesture parts such as
 * `Canvas.PaletteItem` work outside the canvas host (for example a shell
 * sidebar) while each Root resolves drops when the pointer is over its own
 * host. Without a Provider, `Canvas.Root` creates the session itself.
 */
export function CanvasProvider({ children }: CanvasProviderProps) {
  const sessionRef = React.useRef<CanvasSessionContextValue | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = createCanvasSession();
  }
  const session = sessionRef.current;

  React.useEffect(() => {
    return () => {
      session.dnd.destroy();
      session.pointer.destroy();
    };
  }, [session]);

  return (
    <CanvasSessionContext.Provider value={session}>
      {children}
    </CanvasSessionContext.Provider>
  );
}
