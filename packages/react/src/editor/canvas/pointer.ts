export type PointerSnapshot = { x: number; y: number } | null;

export type PointerStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PointerSnapshot;
  setFromEvent: (event: PointerEvent, host: HTMLElement) => void;
  clear: () => void;
  destroy: () => void;
};

function samePoint(a: PointerSnapshot, b: PointerSnapshot): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.x === b.x && a.y === b.y;
}

export function createPointerStore(): PointerStore {
  const listeners = new Set<() => void>();
  let snapshot: PointerSnapshot = null;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    setFromEvent(event, host) {
      const box = host.getBoundingClientRect();
      const x = Math.round(event.clientX - box.left + host.scrollLeft);
      const y = Math.round(event.clientY - box.top + host.scrollTop);
      const next = { x, y };
      if (samePoint(snapshot, next)) return;
      snapshot = next;
      notify();
    },
    clear() {
      if (snapshot === null) return;
      snapshot = null;
      notify();
    },
    destroy() {
      snapshot = null;
      listeners.clear();
    },
  };
}
