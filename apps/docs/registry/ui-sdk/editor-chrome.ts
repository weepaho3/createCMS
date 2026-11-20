// @registry ui-sdk-editor@0.3.2
import {
  createChange,
  definePrimitive,
  dispatch,
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
const SIDES: readonly Side[] = ['left', 'right'];
const SHEETS: readonly Sheet[] = ['props', 'add', 'outline'];
const PAGES: readonly PalettePage[] = ['commands', 'add'];

function oneOf<T extends string>(
  value: T,
  allowed: readonly T[],
  what: string,
) {
  if (!allowed.includes(value)) {
    throw new Error(
      `Unknown ${what} "${value}". Use one of: ${allowed.join(', ')}.`,
    );
  }
}

export type BlockType = { value: string; label: string };

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
  | 'drag'
  | 'step-key'
  | 'collapse'
  | 'imperative';

type OnChange<T> = (value: T, details: ChangeDetails<ChromeReason>) => void;

export type EditorChromeOptions = {
  mode?: 'canvas' | 'form';
  layout?: Layout;
  dirty?: boolean;
  requireCommitMessage?: boolean;
  onSave?: (details: Details) => Promise<unknown> | void;
  blockTypes?: BlockType[];
  onInsertBlock?: (type: string, details: ChangeDetails<ChromeReason>) => void;
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

export type Details = { reason: ChromeReason; event?: Event };

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
    blockTypes: 'value',
    onInsertBlock: 'callback',
    device: 'string',
    defaultDevice: 'string',
    onDeviceChange: 'callback',
    panels: 'value',
    defaultPanels: 'value',
    onPanelsChange: 'callback',
    sheet: 'string',
    defaultSheet: 'string',
    onSheetChange: 'callback',
    palette: 'string',
    defaultPalette: 'string',
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
        oneOf(device, DEVICES, 'device');
        return (
          store.get().device !== device && change('device', device, details)
        );
      },
      setPanel(
        side: Side,
        open: boolean,
        details: Details = { reason: 'imperative' },
      ) {
        oneOf(side, SIDES, 'panel');
        const panels = store.get().panels;
        if (panels[side] === open) return false;
        return change('panels', { ...panels, [side]: open }, details);
      },
      togglePanel(side: Side, details: Details = { reason: 'imperative' }) {
        oneOf(side, SIDES, 'panel');
        const { layout, panels } = store.get();
        if (layout === 'phone') return false;
        if (side === 'right' && layout === 'tablet') {
          return api.toggleSheet('props', details);
        }
        return api.setPanel(side, !panels[side], details);
      },
      openSheet(sheet: Sheet, details: Details = { reason: 'imperative' }) {
        oneOf(sheet, SHEETS, 'sheet');
        return store.get().sheet !== sheet && change('sheet', sheet, details);
      },
      closeSheet(details: Details = { reason: 'imperative' }) {
        return store.get().sheet !== null && change('sheet', null, details);
      },
      toggleSheet(sheet: Sheet, details: Details = { reason: 'imperative' }) {
        oneOf(sheet, SHEETS, 'sheet');
        const open = store.get().sheet === sheet;
        return change('sheet', open ? null : sheet, details);
      },
      openPalette(
        page: PalettePage,
        details: Details = { reason: 'imperative' },
      ) {
        oneOf(page, PAGES, 'palette page');
        return store.get().palette !== page && change('palette', page, details);
      },
      closePalette(details: Details = { reason: 'imperative' }) {
        return store.get().palette !== null && change('palette', null, details);
      },
      addBlock(details: Details = { reason: 'imperative' }) {
        const { layout, mode } = store.get();
        if (mode !== 'canvas') return false;
        return layout === 'phone'
          ? api.openSheet('add', details)
          : api.openPalette('add', details);
      },
      blockTypes: () => context.options().blockTypes ?? [],
      insertBlock(type: string, details: Details = { reason: 'imperative' }) {
        const types = api.blockTypes();
        const found =
          types.find((t) => t.value === type) ??
          types.find((t) => t.label.toLowerCase() === type.toLowerCase());
        if (!found) {
          throw new Error(
            `Unknown block type "${type}". Use one of: ${types.map((t) => t.label).join(', ')}.`,
          );
        }
        return !dispatch(context, 'onInsertBlock', found.value, details);
      },
      setCommitOpen(
        open: boolean,
        details: Details = { reason: 'imperative' },
      ) {
        return (
          store.get().commitOpen !== open && change('commitOpen', open, details)
        );
      },
      async save(details: Details = { reason: 'imperative' }) {
        const { dirty, requireCommitMessage, onSave } = context.options();
        if (!dirty) return false;
        if (requireCommitMessage) return api.setCommitOpen(true, details);
        await onSave?.(details);
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
      role: 'region',
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
        let leaving = 0;
        const onPop = () => {
          if (leaving > 0) {
            leaving -= 1;
            return;
          }
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
            if (view.history.state?.edSheet === key) {
              leaving += 1;
              view.history.back();
            }
          }
        };
        view.addEventListener('beforeunload', warn);
        view.addEventListener('popstate', onPop);
        const stop = part.store.subscribe(follow);
        follow();
        return () => {
          stop();
          view.removeEventListener('beforeunload', warn);
          view.removeEventListener('popstate', onPop);
          if (entry !== null && view.history.state?.edSheet === entry) {
            view.history.back();
          }
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
    'outline-body': slot({}),
    inspector: slot({}),
    form: slot({}),
    'form-surface': slot({}),
    'form-breadcrumb': slot({
      attrs: () => ({ 'aria-label': 'Block path' }),
    }),
    'form-child': slot({}),
  }),
  agent: {
    actions: ['setDevice', 'togglePanel', 'insertBlock', 'save'],
    items: (api) => api.blockTypes(),
  },
});
