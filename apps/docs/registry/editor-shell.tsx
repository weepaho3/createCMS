// @registry editor-shell@0.3.2
'use client';

// The assembled editor shell: provider, layouts per viewport (docked panels,
// tablet drawer, phone bottom bar and sheets) and the canvas surface. The
// parts live in editor-toolbar, editor-palette, editor-outline and
// editor-inspector. Plugins add UI through the named outlets
// (`Editor.Slot`): toolbar-start, toolbar-end, block-toolbar,
// inspector-header, inspector-footer, palette-footer, outline-row-actions and
// status-bar.
//
// Composes shadcn Sidebar and Tooltip and Base UI Drawer for the phone and
// tablet sheets. Do not replace those primitives with custom chrome.

import { Drawer } from '@base-ui/react/drawer';
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
import {
  ListTreeIcon,
  PlusIcon,
  Redo2Icon,
  SlidersHorizontalIcon,
  Undo2Icon,
  XIcon,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { Device, ShellSheet } from './editor-chrome';

import {
  deviceWidth,
  useShellLayout,
  COARSE_TEXT,
  EditorChromeContext,
  useEditorChrome,
} from './editor-chrome';
import { EditorInspector } from './editor-inspector';
import { EditorOutline } from './editor-outline';
import {
  AddBlockList,
  EditorAddBlockDialog,
  EditorPalette,
} from './editor-palette';
import {
  EditorCommandPalette,
  EditorSaveDialog,
  EditorToolbar,
} from './editor-toolbar';

type EditorProviderProps = React.ComponentProps<typeof SidebarProvider> & {
  requireCommitMessage?: boolean;
  mode?: 'canvas' | 'form';
};

function EditorProvider({
  className,
  children,
  requireCommitMessage = false,
  mode = 'canvas',
  style,
  ...props
}: EditorProviderProps) {
  const [device, setDevice] = React.useState<Device>('desktop');
  const [addOpen, setAddOpen] = React.useState(false);
  const [commandsOpen, setCommandsOpen] = React.useState(false);
  const [sheet, setSheet] = React.useState<ShellSheet>(null);
  const layout = useShellLayout();
  const [saveOpen, setSaveOpen] = React.useState(false);
  const scopeRef = React.useRef<HTMLDivElement | null>(null);
  const { dirty, saving, save } = useSave();
  const store = useEditorStore();

  useEditorKeyboard(scopeRef);

  // Mod+K and `/` run the `ui.commandPalette` and `ui.quickInsert` commands,
  // so rebinding them in the editor's shortcuts moves these dialogs too.
  React.useEffect(
    () =>
      store.on('ui', ({ action }) => {
        if (action === 'commandPalette') setCommandsOpen(true);
        if (action !== 'quickInsert' || mode !== 'canvas') return;
        if (layout === 'phone') setSheet('add');
        else setAddOpen(true);
      }),
    [store, mode, layout],
  );

  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (!dirty || saving) return;
      if (requireCommitMessage) setSaveOpen(true);
      else void save();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirty, requireCommitMessage, save, saving]);

  return (
    <TooltipProvider>
      <SidebarProvider
        className={cn(
          'relative h-full min-h-0 flex-1 overflow-hidden',
          className,
        )}
        style={
          {
            '--sidebar-width': '16rem',
            '--sidebar-width-icon': '3rem',
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        <Canvas.Provider>
          <EditorChromeContext.Provider
            value={{
              device,
              setDevice,
              mode,
              layout,
              sheet,
              setSheet,
              requireCommitMessage,
              addOpen,
              setAddOpen,
              commandsOpen,
              setCommandsOpen,
              saveOpen,
              setSaveOpen,
            }}
          >
            <div
              ref={scopeRef}
              data-slot="editor-shell"
              data-mode={mode}
              data-layout={layout}
              className={cn('flex min-h-0 min-w-0 flex-1', COARSE_TEXT)}
            >
              {children}
            </div>
            <EditorAddBlockDialog />
            <EditorCommandPalette />
            <EditorSaveDialog />
          </EditorChromeContext.Provider>
        </Canvas.Provider>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function EditorSurface({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  const { mode } = useEditorChrome();

  return (
    <div
      data-slot="editor-surface"
      className={cn(
        'min-h-0 flex-1',
        mode === 'form'
          ? 'flex flex-col overflow-hidden p-0'
          : 'overflow-auto p-3',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Frame options for `Canvas.Root surface="frame"` sized to the chosen
 * device, so the page's breakpoints, sticky and fixed elements behave as
 * on the site.
 */
function useDeviceFrame(): { width: number | 'full' } {
  const { device } = useEditorChrome();
  const width = deviceWidth[device];
  return React.useMemo(() => ({ width }), [width]);
}

function EditorRightSidebar() {
  return (
    <Sidebar side="right" collapsible="icon" className="absolute h-full">
      <SidebarContent>
        <EditorInspector />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * While open, the sheet owns a history entry: the browser's back gesture
 * closes it, and closing it otherwise drops the entry again.
 */
function useBackToClose(open: boolean, close: () => void) {
  const closeRef = React.useRef(close);
  closeRef.current = close;
  React.useEffect(() => {
    if (!open) return;
    const key = `editor-sheet-${Math.random().toString(36).slice(2)}`;
    window.history.pushState({ ...window.history.state, editorSheet: key }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped && window.history.state?.editorSheet === key) {
        window.history.back();
      }
    };
  }, [open]);
}

/**
 * The selected block, scrolled to the top of the canvas so it stays
 * visible above a bottom sheet.
 */
function revealBlock(id: string) {
  const surface = document.querySelector('[data-slot="editor-surface"]');
  if (!surface) return;
  const selector = `[data-editor-block="${CSS.escape(id)}"]`;
  const docs = [
    surface,
    ...[...surface.querySelectorAll('iframe')].flatMap((frame) =>
      frame.contentDocument ? [frame.contentDocument] : [],
    ),
  ];
  for (const doc of docs) {
    const el = doc.querySelector(selector);
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
  }
}

/** Drag handle, title and close button of a sheet. */
function SheetHeading({
  title,
  onClose,
}: {
  title: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center border-b px-3 pt-2 pb-1">
      <div
        aria-hidden
        className="bg-muted-foreground/40 h-1 w-10 rounded-full"
      />
      <div className="flex w-full items-center gap-2">
        <Drawer.Title className="flex-1 truncate text-sm font-medium">
          {title}
        </Drawer.Title>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={onClose}
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </Button>
      </div>
    </div>
  );
}

const SHEET_SNAP_POINTS = [0.35, 0.6, 1];

/**
 * A bottom sheet (Base UI Drawer): the properties sheet is non-modal with
 * snap points, so the canvas stays usable above it; add and outline are
 * modal. Lifts its content above the on-screen keyboard.
 */
function BottomSheet({
  open,
  onClose,
  title,
  modal,
  snapPoints,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  modal: boolean;
  snapPoints?: number[];
  children: React.ReactNode;
}) {
  useBackToClose(open, onClose);
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      modal={modal}
      disablePointerDismissal={!modal}
      snapPoints={snapPoints}
    >
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          {modal ? (
            <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-(--editor-duration-slow) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          ) : null}
          <Drawer.Viewport className="pointer-events-none fixed inset-0 z-50 flex items-end">
            <Drawer.Popup
              className={cn(
                'bg-background pointer-events-auto flex w-full flex-col rounded-t-xl border-t shadow-lg outline-none',
                'pb-[calc(env(safe-area-inset-bottom)+var(--drawer-keyboard-inset,0px))]',
                'translate-y-[calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px))]',
                'transition-transform duration-(--editor-duration-slow) ease-out data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[swiping]:transition-none motion-reduce:transition-none',
                snapPoints ? 'h-[calc(100dvh-1rem)]' : 'max-h-[85dvh]',
                COARSE_TEXT,
              )}
            >
              <SheetHeading title={title} onClose={onClose} />
              <Drawer.Content className="min-h-0 flex-1 overflow-y-auto">
                {children}
              </Drawer.Content>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  );
}

/** Phone sheets: properties of the selection, add block, outline. */
function PhoneSheets() {
  const { sheet, setSheet, mode } = useEditorChrome();
  const selected = useSelection().selected;
  const block = useAnyBlock(selected);
  const palette = usePalette();
  const title = selected
    ? (palette.find((item) => item.type === block?.type)?.label ?? 'Block')
    : 'Page';
  const close = React.useCallback(() => setSheet(null), [setSheet]);

  // Selecting a block opens its properties; the block scrolls above the sheet.
  const previous = React.useRef(selected);
  React.useEffect(() => {
    if (selected === previous.current) return;
    previous.current = selected;
    if (!selected) return;
    // In form mode the selected block's form is the page itself.
    if (mode === 'form') {
      if (sheet === 'outline') setSheet(null);
      return;
    }
    if (sheet === null) setSheet('props');
    if (sheet === null || sheet === 'props') revealBlock(selected);
  }, [selected, sheet, setSheet, mode]);

  return (
    <>
      <BottomSheet
        open={sheet === 'props'}
        onClose={close}
        title={title}
        modal={false}
        snapPoints={SHEET_SNAP_POINTS}
      >
        <EditorInspector />
      </BottomSheet>
      <BottomSheet
        open={sheet === 'add'}
        onClose={close}
        title="Add block"
        modal
      >
        <AddBlockList onAdded={close} />
      </BottomSheet>
      <BottomSheet
        open={sheet === 'outline'}
        onClose={close}
        title="Outline"
        modal
      >
        <EditorOutline scrollClassName="max-h-none" />
      </BottomSheet>
    </>
  );
}

/** Tablet: the inspector as a non-modal drawer from the right edge. */
function TabletInspector() {
  const { sheet, setSheet } = useEditorChrome();
  const open = sheet === 'props';
  const close = () => setSheet(null);
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      modal={false}
      disablePointerDismissal
      swipeDirection="right"
    >
      <Drawer.Portal>
        <Drawer.Viewport className="pointer-events-none fixed inset-0 z-50 flex justify-end">
          <Drawer.Popup
            className={cn(
              'bg-background pointer-events-auto flex h-full w-80 max-w-[85vw] flex-col border-l shadow-lg outline-none',
              'translate-x-[var(--drawer-swipe-movement-x,0px)] transition-transform duration-(--editor-duration-slow) ease-out data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full data-[swiping]:transition-none motion-reduce:transition-none',
              COARSE_TEXT,
            )}
          >
            <div className="flex items-center border-b px-3 py-1">
              <Drawer.Title className="flex-1 text-sm font-medium">
                Inspector
              </Drawer.Title>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={close}
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </div>
            <EditorInspector />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** Phone: add, outline, properties, undo and redo, above the home indicator. */
function EditorBottomBar() {
  const { setSheet, mode } = useEditorChrome();
  const history = useHistory();
  const inset = useKeyboardInset();
  const items: {
    label: string;
    icon: React.ElementType;
    onClick: () => void;
    disabled?: boolean;
  }[] = [
    { label: 'Add block', icon: PlusIcon, onClick: () => setSheet('add') },
    {
      label: 'Outline',
      icon: ListTreeIcon,
      onClick: () => setSheet('outline'),
    },
    ...(mode === 'canvas'
      ? [
          {
            label: 'Properties',
            icon: SlidersHorizontalIcon,
            onClick: () => setSheet('props'),
          },
        ]
      : []),
    {
      label: 'Undo',
      icon: Undo2Icon,
      onClick: () => history.undo(),
      disabled: !history.canUndo,
    },
    {
      label: 'Redo',
      icon: Redo2Icon,
      onClick: () => history.redo(),
      disabled: !history.canRedo,
    },
  ];
  return (
    <nav
      aria-label="Editor actions"
      data-slot="editor-bottom-bar"
      className="bg-background border-border flex shrink-0 items-stretch justify-around border-t pb-[env(safe-area-inset-bottom)]"
      style={inset > 0 ? { transform: `translateY(-${inset}px)` } : undefined}
    >
      {items.map(({ label, icon: Icon, onClick, disabled }) => (
        <button
          key={label}
          type="button"
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground hover:text-foreground flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] disabled:opacity-40"
        >
          <Icon className="size-5" />
          {label}
        </button>
      ))}
    </nav>
  );
}

type EditorShellProps = {
  className?: string;
  children?: React.ReactNode;
  requireCommitMessage?: boolean;
  mode?: 'canvas' | 'form';
};

function EditorShellLayout({ children }: { children?: React.ReactNode }) {
  const { mode, layout } = useEditorChrome();
  const canvas = mode === 'canvas';
  return (
    <>
      {/* Palette and outline in both modes: they are how a form-only
          editor reaches the blocks. The inspector is the form itself there. */}
      {layout !== 'phone' ? (
        <Sidebar side="left" collapsible="icon" className="absolute h-full">
          <SidebarContent>
            <EditorPalette />
            <EditorOutline />
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
      ) : null}
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <EditorToolbar />
        <EditorSurface>{children}</EditorSurface>
        <footer
          data-slot="editor-status-bar"
          className="border-border text-muted-foreground flex h-8 shrink-0 items-center gap-2 border-t px-3 text-xs empty:hidden"
        >
          <Editor.Slot name="status-bar" />
        </footer>
        {layout === 'phone' ? <EditorBottomBar /> : null}
      </SidebarInset>
      {canvas && layout === 'desktop' ? <EditorRightSidebar /> : null}
      {canvas && layout === 'tablet' ? <TabletInspector /> : null}
      {layout === 'phone' ? <PhoneSheets /> : null}
    </>
  );
}

function EditorShell({
  className,
  children,
  requireCommitMessage = false,
  mode = 'canvas',
}: EditorShellProps) {
  return (
    <EditorProvider
      className={className}
      requireCommitMessage={requireCommitMessage}
      mode={mode}
    >
      <EditorShellLayout>{children}</EditorShellLayout>
    </EditorProvider>
  );
}

export { EditorProvider, EditorShell, EditorSurface, useDeviceFrame };
export type { EditorProviderProps, EditorShellProps };
