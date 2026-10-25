import type {
  RichTextAdapter,
  RichTextCommands,
  RichTextHandle,
  RichTextMountOptions,
} from './adapter';
import type { RichTextDoc } from './types';

export type LazyRichTextAdapter = RichTextAdapter & {
  /** Starts loading the editor (on hover or selection, or when idle). */
  preload(): Promise<RichTextAdapter>;
};

/**
 * A rich text adapter that loads the real one on first use (or on
 * `preload()`), so the editor chunk stays out of the initial bundle. Until
 * it arrives the element stays as rendered; calls made meanwhile apply once
 * it mounts.
 * `load` dynamically imports the editor subpath and creates its adapter
 * (`createTiptapAdapter()` from `@createcms/react/editor/richtext`).
 */
export function lazyRichTextAdapter(
  load: () => Promise<RichTextAdapter>,
): LazyRichTextAdapter {
  let loading: Promise<RichTextAdapter> | null = null;
  const preload = () => {
    loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
  return {
    preload,
    mount(el: HTMLElement, options: RichTextMountOptions): RichTextHandle {
      let real: RichTextHandle | null = null;
      let destroyed = false;
      let value: RichTextDoc = options.value;
      let editable = options.editable ?? true;
      let focus = false;
      void preload().then((adapter) => {
        if (destroyed) return;
        real = adapter.mount(el, { ...options, value, editable });
        if (focus) real.focus();
      });
      const commands: RichTextCommands = {
        toggleMark: (name) => real?.commands.toggleMark(name),
        setLink: (link) => real?.commands.setLink(link),
        setNode: (type, attrs) => real?.commands.setNode(type, attrs),
        isActive: (name, attrs) =>
          real?.commands.isActive(name, attrs) ?? false,
      };
      return {
        setValue(next) {
          value = next;
          real?.setValue(next);
        },
        setEditable(next) {
          editable = next;
          real?.setEditable(next);
        },
        focus() {
          if (real) real.focus();
          else focus = true;
        },
        destroy() {
          destroyed = true;
          real?.destroy();
          real = null;
        },
        commands,
      };
    },
  };
}
