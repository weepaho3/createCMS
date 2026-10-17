import * as React from 'react';

import type { EditorDocument } from './core/document';
import type { EditorPlugin } from './core/plugin';
import type { AnyEditorSchema } from './core/schema';
import type {
  EditorChange,
  EditorError,
  EditorStore,
  PersistenceOptions,
} from './core/store';
import type { FieldControlProps, FieldControls } from './field/types';
import type { EditorScrollToOptions } from './scroll';
import type { EditorContextValue } from './types';

import { EditorContext } from './context';
import { createEditorStore } from './core/store';
import { isHTMLElement } from './dom';
import { scrollElementIntoView } from './scroll';

const EMPTY_FIELDS: FieldControls = {};

type EditorRootCommonProps = {
  /** After every applied change of any origin (local, history, remote, load). */
  onChange?: (change: EditorChange) => void;
  /** A command or save that failed. */
  onError?: (error: EditorError) => void;
  /** Control components per field kind, used by `Editor.FieldControl` (kinds without an entry use the built-in default; plugins add `custom` kinds). Read once at mount. */
  fields?: FieldControls;
  /**
   * Asks before leaving the page while changes are unsaved. Default: on
   * when `persistence` is given.
   */
  guardUnload?: boolean;
  children?: React.ReactNode;
};

/** `Editor.Root` creates its store from a schema and a document. */
export type EditorRootOwnStoreProps = EditorRootCommonProps & {
  /** The editor schema: root, components, placement. */
  schema: AnyEditorSchema;
  /** The initial document (`root.type === 'root'`). Read once at mount; use `key` to load a different document. */
  defaultValue: EditorDocument;
  /** Id generator for new blocks (default: `createBlockId`). Read once at mount. */
  genId?: () => string;
  /** Saving: the save function, the base version, autosave timing. Read once at mount. */
  persistence?: PersistenceOptions;
  /** Read once at mount. */
  plugins?: readonly EditorPlugin[];
  /** Policy for remote ops that break placement. Read once at mount. */
  remotePlacement?: 'reject' | 'accept-and-warn';
  store?: undefined;
};

/** `Editor.Root` uses a store created elsewhere (`createEditorStore`). */
export type EditorRootStoreProps = EditorRootCommonProps & {
  /** A store that outlives this root: re-mounts and other roots can share it. */
  store: EditorStore;
  schema?: undefined;
  defaultValue?: undefined;
  genId?: undefined;
  persistence?: undefined;
  plugins?: undefined;
  remotePlacement?: undefined;
};

export type EditorRootProps = EditorRootOwnStoreProps | EditorRootStoreProps;

/** `fields` with each plugin's `custom` controls under `custom` (explicit `fields` win). */
function withPluginControls(
  fields: FieldControls,
  plugins: readonly EditorPlugin[],
): FieldControls {
  const custom: Record<
    string,
    React.ComponentType<FieldControlProps<'custom'>>
  > = {};
  for (const plugin of plugins) {
    for (const [kind, def] of Object.entries(plugin.fields ?? {})) {
      if (def.control && !(kind in custom)) {
        custom[kind] = def.control as React.ComponentType<
          FieldControlProps<'custom'>
        >;
      }
    }
  }
  if (Object.keys(custom).length === 0) return fields;
  return { ...fields, custom: { ...custom, ...fields.custom } };
}

/**
 * Provider-only root: renders no DOM element. Uses `store`, or creates one
 * once from `schema` + `defaultValue` (remount with `key` to reset), and
 * exposes `{ schema, store, fields, registerScrollTarget, scrollTo }` to
 * every part below it. Callback props are read fresh on every call, so
 * inline handlers are fine.
 */
export function EditorRoot(props: EditorRootProps) {
  const { onChange, onError, fields = EMPTY_FIELDS, children } = props;
  const callbacksRef = React.useRef({ onChange, onError });
  React.useLayoutEffect(() => {
    callbacksRef.current = { onChange, onError };
  });

  const ctxRef = React.useRef<EditorContextValue | null>(null);
  if (ctxRef.current === null) {
    const store: EditorStore =
      props.store ??
      createEditorStore({
        schema: props.schema,
        initialValue: props.defaultValue,
        genId: props.genId,
        persistence: props.persistence,
        plugins: props.plugins,
        remotePlacement: props.remotePlacement,
      });
    const targets = new Map<string, HTMLElement>();
    const registerScrollTarget = (
      blockId: string,
      el: HTMLElement,
    ): (() => void) => {
      targets.set(blockId, el);
      return () => {
        if (targets.get(blockId) === el) targets.delete(blockId);
      };
    };
    const scrollTo = (
      blockId: string,
      opts?: EditorScrollToOptions,
    ): boolean => {
      if (opts?.container) {
        const found = opts.container.querySelector(
          '[data-block-id="' + CSS.escape(blockId) + '"]',
        );
        if (!isHTMLElement(found)) return false;
        scrollElementIntoView(found, opts);
        return true;
      }
      const el = targets.get(blockId);
      if (!el) return false;
      scrollElementIntoView(el, opts);
      return true;
    };
    ctxRef.current = {
      schema: store.schema,
      store,
      fields: withPluginControls(fields, store.plugins),
      registerScrollTarget,
      scrollTo,
    };
  }
  const store = ctxRef.current.store;
  const guardUnload = props.guardUnload ?? props.persistence !== undefined;

  React.useEffect(() => {
    const offChange = store.on('change', (change) =>
      callbacksRef.current.onChange?.(change),
    );
    const offError = store.on('error', (error) =>
      callbacksRef.current.onError?.(error),
    );
    return () => {
      offChange();
      offError();
    };
  }, [store]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const view = document.defaultView;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void store.save();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!guardUnload || !store.isDirty()) return;
      event.preventDefault();
    };
    document.addEventListener('visibilitychange', onVisibility);
    view?.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      view?.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [store, guardUnload]);

  return (
    <EditorContext.Provider value={ctxRef.current}>
      {children}
    </EditorContext.Provider>
  );
}
