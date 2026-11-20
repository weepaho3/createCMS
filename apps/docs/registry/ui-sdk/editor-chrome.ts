// @registry ui-sdk-editor@0.3.2
import {
  createChange,
  definePrimitive,
  type ChangeDetails,
} from '@ui-sdk/core';

export type Device = 'desktop' | 'tablet' | 'mobile';
export type Layout = 'phone' | 'tablet' | 'desktop';
export type Sheet = 'props' | 'add' | 'outline';
export type PalettePage = 'commands' | 'add';
export type Side = 'left' | 'right';
export type Panels = Record<Side, boolean>;

export const DEVICE_WIDTH: Record<Device, number | 'full'> = {
  desktop: 'full',
  tablet: 768,
  mobile: 375,
};

const DEVICES: readonly Device[] = ['desktop', 'tablet', 'mobile'];

type ChromeReason =
  | 'press'
  | 'item-press'
  | 'trigger-press'
  | 'close-press'
  | 'escape-key'
  | 'outside-press'
  | 'back'
  | 'swipe'
  | 'shortcut'
  | 'action'
  | 'parent-close'
  | 'resize'
  | 'imperative';

type OnChange<T> = (value: T, details: ChangeDetails<ChromeReason>) => void;

export type EditorChromeOptions = {
  mode?: 'canvas' | 'form';
  layout?: Layout;
  dirty?: boolean;
  requireCommitMessage?: boolean;
  onSave?: () => Promise<unknown> | void;
  device?: Device;
  defaultDevice?: Device;
  onDeviceChange?: OnChange<Device>;
  panels?: Panels;
  defaultPanels?: Panels;
  onPanelsChange?: OnChange<Panels>;
  sheet?: Sheet | null;
  defaultSheet?: Sheet | null;
  onSheetChange?: OnChange<Sheet | null>;
  palette?: PalettePage | null;
  defaultPalette?: PalettePage | null;
  onPaletteChange?: OnChange<PalettePage | null>;
  commitOpen?: boolean;
  defaultCommitOpen?: boolean;
  onCommitOpenChange?: OnChange<boolean>;
};

type ChromeState = {
  mode: 'canvas' | 'form';
  layout: Layout;
  device: Device;
  panels: Panels;
  sheet: Sheet | null;
  palette: PalettePage | null;
  commitOpen: boolean;
};

type Details = { reason: ChromeReason; event?: Event };

const section =
  (name: string) => (_state: ChromeState, part: { id: string }) => ({
    'aria-labelledby': `${part.id}-${name}-title`,
  });

const title =
  (name: string) => (_state: ChromeState, part: { id: string }) => ({
    id: `${part.id}-${name}-title`,
  });

export const editorChrome = definePrimitive({
  name: 'editor',
  options: {
    mode: 'string',
    layout: 'string',
    dirty: 'boolean',
    requireCommitMessage: 'boolean',
    onSave: 'action',
    device: 'string',
    defaultDevice: 'string',
    onDeviceChange: 'callback',
    panels: 'value',
    defaultPanels: 'value',
    onPanelsChange: 'callback',
    sheet: 'value',
    defaultSheet: 'value',
    onSheetChange: 'callback',
    palette: 'value',
    defaultPalette: 'value',
    onPaletteChange: 'callback',
    commitOpen: 'boolean',
    defaultCommitOpen: 'boolean',
    onCommitOpenChange: 'callback',
  },
  controlled: ['device', 'panels', 'sheet', 'palette', 'commitOpen'],
  state: (options: EditorChromeOptions): ChromeState => ({
    mode: options.mode ?? 'canvas',
    layout: options.layout ?? 'desktop',
    device: options.device ?? options.defaultDevice ?? 'desktop',
    panels: options.panels ??
      options.defaultPanels ?? { left: true, right: true },
    sheet: options.sheet ?? options.defaultSheet ?? null,
    palette: options.palette ?? options.defaultPalette ?? null,
    commitOpen: options.commitOpen ?? options.defaultCommitOpen ?? false,
  }),
  sync: (options) => {
    const next: Partial<ChromeState> = {};
    if (options.mode !== undefined) next.mode = options.mode;
    if (options.layout !== undefined) next.layout = options.layout;
    if (options.device !== undefined) next.device = options.device;
    if (options.panels !== undefined) next.panels = options.panels;
    if (options.sheet !== undefined) next.sheet = options.sheet;
    if (options.palette !== undefined) next.palette = options.palette;
    if (options.commitOpen !== undefined) next.commitOpen = options.commitOpen;
    return next;
  },
  api: (context) => {
    const { store } = context;
    const change = createChange(context);

    const api = {
      isDirty: () => context.options().dirty === true,
      setDevice(device: Device, details: Details = { reason: 'imperative' }) {
        if (!DEVICES.includes(device)) return false;
        return (
          store.get().device !== device && change('device', device, details)
        );
      },
      setPanel(
        side: Side,
        open: boolean,
        details: Details = { reason: 'imperative' },
      ) {
        const panels = store.get().panels;
        if (panels[side] === open) return false;
        return change('panels', { ...panels, [side]: open }, details);
      },
      togglePanel(side: Side, event?: Event) {
        const { layout, panels } = store.get();
        if (layout === 'phone') return false;
        if (side === 'right' && layout === 'tablet') {
          return api.toggleSheet('props', event);
        }
        return api.setPanel(side, !panels[side], { reason: 'press', event });
      },
      openSheet(sheet: Sheet, details: Details = { reason: 'imperative' }) {
        return store.get().sheet !== sheet && change('sheet', sheet, details);
      },
      closeSheet(details: Details = { reason: 'imperative' }) {
        return store.get().sheet !== null && change('sheet', null, details);
      },
      toggleSheet(sheet: Sheet, event?: Event) {
        const open = store.get().sheet === sheet;
        return change('sheet', open ? null : sheet, { reason: 'press', event });
      },
      openPalette(
        page: PalettePage,
        details: Details = { reason: 'imperative' },
      ) {
        return store.get().palette !== page && change('palette', page, details);
      },
      closePalette(details: Details = { reason: 'imperative' }) {
        return store.get().palette !== null && change('palette', null, details);
      },
      addBlock(event?: Event) {
        const { layout, mode } = store.get();
        if (mode !== 'canvas') return false;
        return layout === 'phone'
          ? api.openSheet('add', { reason: 'press', event })
          : api.openPalette('add', { reason: 'press', event });
      },
      setCommitOpen(
        open: boolean,
        details: Details = { reason: 'imperative' },
      ) {
        return (
          store.get().commitOpen !== open && change('commitOpen', open, details)
        );
      },
      async save(event?: Event) {
        const { dirty, requireCommitMessage, onSave } = context.options();
        if (!dirty) return false;
        if (requireCommitMessage) {
          return api.setCommitOpen(true, { reason: 'press', event });
        }
        await onSave?.();
        return true;
      },
      reveal(blockId: string) {
        const surface = context.element('surface');
        if (!surface) return;
        const selector = `[data-editor-block="${CSS.escape(blockId)}"]`;
        const docs: ParentNode[] = [surface];
        for (const frame of surface.querySelectorAll('iframe')) {
          if (frame.contentDocument) docs.push(frame.contentDocument);
        }
        for (const doc of docs) {
          const el = doc.querySelector(selector);
          if (!el) continue;
          el.scrollIntoView({ block: 'start', behavior: 'smooth' });
          return;
        }
      },
    };
    return api;
  },
  slots: (slot) => ({
    root: slot<{}, ChromeState>({
      state: (state) => state,
      attrs: (state) => ({
        'data-mode': state.mode,
        'data-layout': state.layout,
      }),
      bind: (el, part) => {
        const view = el.ownerDocument.defaultView;
        if (!view) return;
        const warn = (event: BeforeUnloadEvent) => {
          if (part.api.isDirty()) event.preventDefault();
        };
        // A phone sheet owns a history entry while it is open, so the back
        // gesture closes the sheet instead of leaving the editor.
        let entry: string | null = null;
        const onPop = () => {
          if (entry === null) return;
          entry = null;
          part.api.closeSheet({ reason: 'back' });
        };
        const follow = () => {
          const { sheet, layout } = part.store.get();
          const open = sheet !== null && layout === 'phone';
          if (open && entry === null) {
            entry = Math.random().toString(36).slice(2);
            view.history.pushState(
              { ...view.history.state, edSheet: entry },
              '',
            );
          } else if (!open && entry !== null) {
            const key = entry;
            entry = null;
            if (view.history.state?.edSheet === key) view.history.back();
          }
        };
        view.addEventListener('beforeunload', warn);
        view.addEventListener('popstate', onPop);
        const stop = part.store.subscribe(follow);
        return () => {
          stop();
          view.removeEventListener('beforeunload', warn);
          view.removeEventListener('popstate', onPop);
        };
      },
    }),
    main: slot({}),
    toolbar: slot({}),
    surface: slot<{}, { mode: ChromeState['mode'] }>({
      state: (state) => ({ mode: state.mode }),
      attrs: (state) => ({ 'data-mode': state.mode }),
    }),
    'status-bar': slot({}),
    'bottom-bar': slot({
      attrs: () => ({ 'aria-label': 'Editor actions' }),
    }),
    palette: slot({ attrs: section('palette') }),
    'palette-title': slot({ attrs: title('palette') }),
    outline: slot({ attrs: section('outline') }),
    'outline-title': slot({ attrs: title('outline') }),
    inspector: slot({}),
    form: slot({}),
    'form-surface': slot({}),
    'form-breadcrumb': slot({
      attrs: () => ({ 'aria-label': 'Block path' }),
    }),
    'form-child': slot({}),
  }),
  agent: {
    actions: [
      'setDevice',
      'togglePanel',
      'openSheet',
      'closeSheet',
      'openPalette',
      'closePalette',
      'addBlock',
      'save',
    ],
  },
});
