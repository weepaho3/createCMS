// @registry ui-sdk-editor@0.3.2
'use client';

// The editor's frame: toolbar, the docked panels (palette and outline on
// the left, the inspector on the right) as resizable panels that show or
// hide whole, the edit surface and the status bar. Phones get a bottom bar
// and sheets, tablets the inspector in a drawer. Plugins add UI through the
// named outlets (`Editor.Slot`).

import {
  Editor,
  useAnyBlock,
  useEditorKeyboard,
  useEditorStore,
  useHistory,
  useKeyboardInset,
  usePalette,
  useSave,
  useSelection,
} from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';
import { Button } from '@ui-sdk/react/button';
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerHandle,
  DrawerTitle,
} from '@ui-sdk/react/drawer';
import {
  Resizable,
  ResizableHandle,
  ResizablePanel,
  createResizableController,
} from '@ui-sdk/react/resizable';
import {
  ListTreeIcon,
  PlusIcon,
  Redo2Icon,
  SlidersHorizontalIcon,
  Undo2Icon,
  XIcon,
} from 'lucide-react';
import * as React from 'react';

import type { Chrome, Device, PalettePage, Sheet } from './chrome';

import { ChromeContext, DEVICE_WIDTH, useChrome, useLayout } from './chrome';
import { BlockPicker, CommandPalette } from './commands';
import { Inspector } from './inspector';
import { BlockOutline } from './outline';
import { BlockPalette } from './palette';
import { CommitDialog, EditorToolbar } from './toolbar';

const LEFT = 'ed-left';
const RIGHT = 'ed-right';

/** Frame options for `Canvas.Root surface="frame"`, as wide as the chosen device. */
export function useDeviceFrame(): { width: number | 'full' } {
  const { device } = useChrome();
  const width = DEVICE_WIDTH[device];
  return React.useMemo(() => ({ width }), [width]);
}

/** While a sheet is open it owns a history entry, so the back gesture closes it. */
function useBackToClose(open: boolean, close: () => void) {
  const closeRef = React.useRef(close);
  closeRef.current = close;
  React.useEffect(() => {
    if (!open) return;
    const key = Math.random().toString(36).slice(2);
    window.history.pushState({ ...window.history.state, edSheet: key }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped && window.history.state?.edSheet === key)
        window.history.back();
    };
  }, [open]);
}

/** Scrolls the block to the top of the canvas, above a bottom sheet. */
function revealBlock(id: string) {
  const surface = document.querySelector('[data-slot="editor-surface"]');
  if (!surface) return;
  const selector = `[data-editor-block="${CSS.escape(id)}"]`;
  for (const doc of [
    surface,
    ...[...surface.querySelectorAll('iframe')].flatMap((f) =>
      f.contentDocument ? [f.contentDocument] : [],
    ),
  ]) {
    const el = doc.querySelector(selector);
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
  }
}

function Sheet({
  open,
  onClose,
  title,
  props: propsSheet = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** The properties sheet: snaps to 35, 60 and 100%, modal only when full. */
  props?: boolean;
  children: React.ReactNode;
}) {
  useBackToClose(open, onClose);
  return (
    <Drawer
      side="bottom"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      snapPoints={propsSheet ? [0.35, 0.6, 1] : undefined}
      modalAbove={propsSheet ? 0.6 : undefined}
    >
      <DrawerBackdrop className="ed-backdrop" />
      <DrawerContent className="ed-sheet" data-full={propsSheet || undefined}>
        <DrawerHandle aria-label="Resize" className="ed-sheet-handle" />
        <header className="ed-sheet-head">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerClose
            className="ed-button"
            data-variant="ghost"
            data-size="icon-touch"
          >
            <XIcon />
            <span className="ed-sr">Close</span>
          </DrawerClose>
        </header>
        <div className="ed-sheet-body">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}

function PhoneSheets() {
  const { sheet, setSheet, mode } = useChrome();
  const selected = useSelection().selected;
  const block = useAnyBlock(selected);
  const palette = usePalette();
  const close = React.useCallback(() => setSheet(null), [setSheet]);
  const title = selected
    ? (palette.find((item) => item.type === block?.type)?.label ?? 'Block')
    : 'Page';

  // A new selection opens its properties and scrolls the block above the sheet.
  const previous = React.useRef(selected);
  React.useEffect(() => {
    if (selected === previous.current) return;
    previous.current = selected;
    if (!selected) return;
    if (mode === 'form') {
      if (sheet === 'outline') setSheet(null);
      return;
    }
    if (sheet === null) setSheet('props');
    if (sheet === null || sheet === 'props') revealBlock(selected);
  }, [selected, sheet, setSheet, mode]);

  return (
    <>
      <Sheet open={sheet === 'props'} onClose={close} title={title} props>
        <Inspector />
      </Sheet>
      <Sheet open={sheet === 'add'} onClose={close} title="Add block">
        <BlockPicker onDone={close} />
      </Sheet>
      <Sheet open={sheet === 'outline'} onClose={close} title="Outline">
        <BlockOutline fill />
      </Sheet>
    </>
  );
}

function TabletInspector() {
  const { sheet, setSheet } = useChrome();
  return (
    <Drawer
      side="right"
      modal={false}
      closeOnOutsidePress={false}
      open={sheet === 'props'}
      onOpenChange={(open) => setSheet(open ? 'props' : null)}
    >
      <DrawerContent className="ed-side-sheet">
        <header className="ed-sheet-head">
          <DrawerTitle>Inspector</DrawerTitle>
          <DrawerClose
            className="ed-button"
            data-variant="ghost"
            data-size="icon-sm"
          >
            <XIcon />
            <span className="ed-sr">Close</span>
          </DrawerClose>
        </header>
        <Inspector />
      </DrawerContent>
    </Drawer>
  );
}

function BottomBar() {
  const { setSheet, mode } = useChrome();
  const history = useHistory();
  const inset = useKeyboardInset();
  const actions: [string, React.ElementType, () => void, boolean?][] = [
    ['Add block', PlusIcon, () => setSheet('add')],
    ['Outline', ListTreeIcon, () => setSheet('outline')],
    ...(mode === 'canvas'
      ? [
          ['Properties', SlidersHorizontalIcon, () => setSheet('props')] as [
            string,
            React.ElementType,
            () => void,
          ],
        ]
      : []),
    ['Undo', Undo2Icon, () => history.undo(), !history.canUndo],
    ['Redo', Redo2Icon, () => history.redo(), !history.canRedo],
  ];
  return (
    <nav
      aria-label="Editor actions"
      data-slot="editor-bottom-bar"
      className="ed-bottom-bar"
      style={inset > 0 ? { translate: `0 -${inset}px` } : undefined}
    >
      {actions.map(([label, Icon, run, disabled]) => (
        <Button
          key={label}
          disabled={disabled}
          onClick={run}
          className="ed-bottom-action"
        >
          <Icon aria-hidden />
          {label}
        </Button>
      ))}
    </nav>
  );
}

function Surface({ children }: { children?: React.ReactNode }) {
  const { mode } = useChrome();
  return (
    <div data-slot="editor-surface" data-mode={mode} className="ed-surface">
      {children}
    </div>
  );
}

function Main({ children }: { children?: React.ReactNode }) {
  const { layout } = useChrome();
  return (
    <div className="ed-main">
      <EditorToolbar />
      <Surface>{children}</Surface>
      <footer data-slot="editor-status-bar" className="ed-status">
        <Editor.Slot name="status-bar" />
      </footer>
      {layout === 'phone' ? <BottomBar /> : null}
    </div>
  );
}

function Layout({
  controller,
  onPanels,
  children,
}: {
  controller: ReturnType<typeof createResizableController>;
  onPanels: (panels: Chrome['panels']) => void;
  children?: React.ReactNode;
}) {
  const { layout, mode } = useChrome();
  const right = mode === 'canvas' && layout === 'desktop';
  if (layout === 'phone') {
    return (
      <>
        <Main>{children}</Main>
        <PhoneSheets />
      </>
    );
  }
  return (
    <>
      <Resizable
        controller={controller}
        className="ed-panels"
        onLayoutCommit={() =>
          onPanels({
            left: !controller.isCollapsed(LEFT),
            right: right && !controller.isCollapsed(RIGHT),
          })
        }
      >
        <ResizablePanel
          id={LEFT}
          defaultSize="264px"
          minSize="200px"
          maxSize="420px"
          collapsible
          collapsedSize={0}
          className="ed-panel"
          data-side="left"
        >
          <BlockPalette />
          <BlockOutline />
        </ResizablePanel>
        <ResizableHandle aria-label="Resize sidebar" className="ed-resize" />
        <ResizablePanel className="ed-center">
          <Main>{children}</Main>
        </ResizablePanel>
        {right ? (
          <>
            <ResizableHandle
              aria-label="Resize inspector"
              className="ed-resize"
            />
            <ResizablePanel
              id={RIGHT}
              defaultSize="300px"
              minSize="240px"
              maxSize="480px"
              collapsible
              collapsedSize={0}
              className="ed-panel"
              data-side="right"
            >
              <Inspector />
            </ResizablePanel>
          </>
        ) : null}
      </Resizable>
      {mode === 'canvas' && layout === 'tablet' ? <TabletInspector /> : null}
    </>
  );
}

export type EditorShellProps = {
  mode?: 'canvas' | 'form';
  requireCommitMessage?: boolean;
  children?: React.ReactNode;
};

/** The whole editor chrome around the edit surface (`children`). */
export function EditorShell({
  mode = 'canvas',
  requireCommitMessage = false,
  children,
}: EditorShellProps) {
  const layout = useLayout();
  const store = useEditorStore();
  const { dirty, saving, save } = useSave();
  const [device, setDevice] = React.useState<Device>('desktop');
  const [panels, setPanels] = React.useState({ left: true, right: true });
  const [sheet, setSheet] = React.useState<Sheet | null>(null);
  const [palette, setPalette] = React.useState<PalettePage | null>(null);
  const [commitOpen, setCommitOpen] = React.useState(false);
  const [controller] = React.useState(createResizableController);
  const scope = React.useRef<HTMLDivElement | null>(null);
  useEditorKeyboard(scope);

  const togglePanel = React.useCallback(
    (side: 'left' | 'right') => {
      const id = side === 'left' ? LEFT : RIGHT;
      if (controller.isCollapsed(id)) controller.expand(id);
      else controller.collapse(id);
      setPanels((prev) => ({ ...prev, [side]: !controller.isCollapsed(id) }));
    },
    [controller],
  );

  // Mod+K and `/` run `ui.commandPalette` and `ui.quickInsert`, so rebinding
  // those commands moves these dialogs too.
  React.useEffect(
    () =>
      store.on('ui', ({ action }) => {
        if (action === 'commandPalette') setPalette('commands');
        if (action !== 'quickInsert' || mode !== 'canvas') return;
        if (layout === 'phone') setSheet('add');
        else setPalette('add');
      }),
    [store, mode, layout],
  );

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'b' && layout !== 'phone') {
        event.preventDefault();
        togglePanel('left');
      }
      if (key !== 's') return;
      event.preventDefault();
      if (!dirty || saving) return;
      if (requireCommitMessage) setCommitOpen(true);
      else void save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, save, requireCommitMessage, layout, togglePanel]);

  const chrome: Chrome = {
    mode,
    layout,
    device,
    setDevice,
    panels,
    togglePanel,
    sheet,
    setSheet,
    palette,
    openPalette: setPalette,
    closePalette: () => setPalette(null),
    requireCommitMessage,
    commitOpen,
    setCommitOpen,
  };

  return (
    <Canvas.Provider>
      <ChromeContext.Provider value={chrome}>
        <div
          ref={scope}
          data-slot="editor-shell"
          data-mode={mode}
          data-layout={layout}
          className="ed-shell"
        >
          <Layout controller={controller} onPanels={setPanels}>
            {children}
          </Layout>
        </div>
        <CommandPalette />
        <CommitDialog />
      </ChromeContext.Provider>
    </Canvas.Provider>
  );
}
