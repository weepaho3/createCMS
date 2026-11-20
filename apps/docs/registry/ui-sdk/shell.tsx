// @registry ui-sdk-editor@0.3.2
'use client';

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
import { useShortcut } from '@ui-sdk/react/shortcuts';
import {
  ListTreeIcon,
  PlusIcon,
  Redo2Icon,
  SlidersHorizontalIcon,
  Undo2Icon,
  XIcon,
} from 'lucide-react';
import * as React from 'react';

import type { Sheet as SheetName } from './chrome';

import { Chrome, DEVICE_WIDTH, useChrome, useLayout } from './chrome';
import { BlockPicker, CommandPalette } from './commands';
import { Inspector } from './inspector';
import { BlockOutline } from './outline';
import { BlockPalette } from './palette';
import { CommitDialog, EditorToolbar } from './toolbar';

const LEFT = 'ed-left';
const RIGHT = 'ed-right';

export function useDeviceFrame(): { width: number | 'full' } {
  const { device } = useChrome();
  const width = DEVICE_WIDTH[device];
  return React.useMemo(() => ({ width }), [width]);
}

function Sheet({
  name,
  title,
  children,
}: {
  name: SheetName;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  const { sheet, api } = useChrome();
  const props = name === 'props';
  return (
    <Drawer
      side="bottom"
      open={sheet === name}
      onOpenChange={(open, details) => {
        if (!open)
          api.closeSheet({ reason: details.reason, event: details.event });
      }}
      snapPoints={props ? [0.35, 0.6, 1] : undefined}
      modalAbove={props ? 0.6 : undefined}
    >
      <DrawerBackdrop className="ed-backdrop" />
      <DrawerContent className="ed-sheet" data-full={props || undefined}>
        <DrawerHandle
          aria-label={`Resize ${name === 'props' ? 'properties' : name}`}
          className="ed-sheet-handle"
        />
        <header className="ed-sheet-head">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerClose
            aria-label="Close"
            className="ed-button"
            data-variant="ghost"
            data-size="icon-touch"
          >
            <XIcon />
          </DrawerClose>
        </header>
        <div className="ed-sheet-body">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}

function PhoneSheets() {
  const { sheet, mode, api } = useChrome();
  const selected = useSelection().selected;
  const block = useAnyBlock(selected);
  const palette = usePalette();
  const title = selected
    ? (palette.find((item) => item.type === block?.type)?.label ?? 'Block')
    : 'Page';

  const previous = React.useRef(selected);
  React.useEffect(() => {
    if (selected === previous.current) return;
    previous.current = selected;
    if (!selected) return;
    if (mode === 'form') {
      if (sheet === 'outline') api.closeSheet();
      return;
    }
    if (sheet === null) api.openSheet('props');
    if (sheet === null || sheet === 'props') api.reveal(selected);
  }, [selected, sheet, mode, api]);

  return (
    <>
      <Sheet name="props" title={title}>
        <Inspector />
      </Sheet>
      <Sheet name="add" title="Add block">
        <BlockPicker onDone={() => api.closeSheet()} />
      </Sheet>
      <Sheet name="outline" title="Outline">
        <BlockOutline fill />
      </Sheet>
    </>
  );
}

function TabletInspector() {
  const { sheet, api } = useChrome();
  return (
    <Drawer
      side="right"
      modal={false}
      closeOnOutsidePress={false}
      open={sheet === 'props'}
      onOpenChange={(open, details) => {
        const why = { reason: details.reason, event: details.event };
        if (open) api.openSheet('props', why);
        else api.closeSheet(why);
      }}
    >
      <DrawerContent className="ed-side-sheet">
        <header className="ed-sheet-head">
          <DrawerTitle>Inspector</DrawerTitle>
          <DrawerClose
            aria-label="Close inspector"
            className="ed-button"
            data-variant="ghost"
            data-size="icon-sm"
          >
            <XIcon />
          </DrawerClose>
        </header>
        <Inspector />
      </DrawerContent>
    </Drawer>
  );
}

function BottomBar() {
  const { mode, api } = useChrome();
  const history = useHistory();
  const inset = useKeyboardInset();
  const actions: [string, React.ElementType, () => unknown, boolean?][] = [
    ['Add block', PlusIcon, () => api.openSheet('add', { reason: 'press' })],
    [
      'Outline',
      ListTreeIcon,
      () => api.openSheet('outline', { reason: 'press' }),
    ],
    ...(mode === 'canvas'
      ? [
          [
            'Properties',
            SlidersHorizontalIcon,
            () => api.openSheet('props', { reason: 'press' }),
          ] as [string, React.ElementType, () => unknown],
        ]
      : []),
    ['Undo', Undo2Icon, () => history.undo(), !history.canUndo],
    ['Redo', Redo2Icon, () => history.redo(), !history.canRedo],
  ];
  return (
    <Chrome.BottomBar
      className="ed-bottom-bar"
      style={inset > 0 ? { translate: `0 -${inset}px` } : undefined}
    >
      {actions.map(([label, Icon, run, disabled]) => (
        <Button
          key={label}
          disabled={disabled}
          onClick={() => {
            run();
          }}
          className="ed-bottom-action"
        >
          <Icon aria-hidden />
          {label}
        </Button>
      ))}
    </Chrome.BottomBar>
  );
}

function Main({ children }: { children?: React.ReactNode }) {
  const { layout } = useChrome();
  return (
    <Chrome.Main className="ed-main">
      <EditorToolbar />
      <Chrome.Surface className="ed-surface">{children}</Chrome.Surface>
      <Chrome.StatusBar className="ed-status">
        <Editor.Slot name="status-bar" />
      </Chrome.StatusBar>
      {layout === 'phone' ? <BottomBar /> : null}
    </Chrome.Main>
  );
}

function Layout({
  controller,
  children,
}: {
  controller: ReturnType<typeof createResizableController>;
  children?: React.ReactNode;
}) {
  const { layout, mode, api } = useChrome();
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
        aria-label="Editor panels"
        className="ed-panels"
        onLayoutCommit={() => {
          api.setPanel('left', !controller.isCollapsed(LEFT), {
            reason: 'resize',
          });
          if (right) {
            api.setPanel('right', !controller.isCollapsed(RIGHT), {
              reason: 'resize',
            });
          }
        }}
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

function Keymap({ mode }: { mode: 'canvas' | 'form' }) {
  const store = useEditorStore();
  const { layout, api } = useChrome();
  useShortcut('mod+b', () => api.togglePanel('left'), {
    description: 'Show or hide the sidebar',
    when: () => layout !== 'phone',
  });
  useShortcut('mod+s', () => void api.save(), { description: 'Save' });
  React.useEffect(
    () =>
      store.on('ui', ({ action }) => {
        if (action === 'commandPalette') api.openPalette('commands');
        if (action === 'quickInsert' && mode === 'canvas') api.addBlock();
      }),
    [store, mode, api],
  );
  return null;
}

export type EditorShellProps = {
  mode?: 'canvas' | 'form';
  requireCommitMessage?: boolean;
  children?: React.ReactNode;
};

export function EditorShell({
  mode = 'canvas',
  requireCommitMessage = false,
  children,
}: EditorShellProps) {
  const layout = useLayout();
  const { dirty, save } = useSave();
  const [controller] = React.useState(createResizableController);
  const scope = React.useRef<HTMLDivElement | null>(null);
  useEditorKeyboard(scope);

  return (
    <Canvas.Provider>
      <Chrome.Root
        ref={scope}
        aria-label="Page editor"
        className="ed-shell"
        mode={mode}
        layout={layout}
        dirty={dirty}
        requireCommitMessage={requireCommitMessage}
        onSave={() => save()}
        onPanelsChange={(panels, details) => {
          if (details.reason === 'resize') return;
          for (const [side, id] of [
            ['left', LEFT],
            ['right', RIGHT],
          ] as const) {
            const open = panels[side];
            if (open === !controller.isCollapsed(id)) continue;
            if (open) controller.expand(id);
            else controller.collapse(id);
          }
        }}
      >
        <Keymap mode={mode} />
        <Layout controller={controller}>{children}</Layout>
        <CommandPalette />
        <CommitDialog enabled={requireCommitMessage} />
      </Chrome.Root>
    </Canvas.Provider>
  );
}
