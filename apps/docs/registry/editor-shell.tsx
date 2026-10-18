'use client';

// Plugins add UI through the named outlets (`Editor.Slot`): toolbar-start,
// toolbar-end, block-toolbar, inspector-header, inspector-footer,
// palette-footer, outline-row-actions and status-bar.
//
// Composes shadcn Sidebar, Tooltip, Command, ToggleGroup, Tabs, Separator,
// Kbd, Sheet, Button, Dialog and Input. Do not replace those primitives with
// custom chrome.

import type { FlatOutlineNodeRow } from '@createcms/react/editor';

import {
  Editor,
  useAnyBlock,
  useBlockActions,
  useEditor,
  useEditorKeyboard,
  useEditorStore,
  useFlatOutline,
  useHistory,
  usePalette,
  useCommand,
  useCommands,
  useSave,
  useSelection,
  useShortcutLabel,
} from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';
import { groupPaletteItems } from '@createcms/react/editor/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  BoxIcon,
  CopyIcon,
  GripVerticalIcon,
  ImageIcon,
  LayoutGridIcon,
  ListIcon,
  ChevronRightIcon,
  CommandIcon,
  LoaderCircleIcon,
  MonitorIcon,
  PanelRightIcon,
  PlusIcon,
  Redo2Icon,
  SaveIcon,
  SmartphoneIcon,
  SparklesIcon,
  TabletIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { PaletteItem } from './editor-canvas';
import { Form } from './editor-form';

type Device = 'desktop' | 'tablet' | 'mobile';

/** Frame width per device: media queries in the canvas see this width. */
const deviceWidth: Record<Device, number | 'full'> = {
  desktop: 'full',
  tablet: 768,
  mobile: 375,
};

type EditorChromeContextValue = {
  device: Device;
  setDevice: (device: Device) => void;
  mode: 'canvas' | 'form';
  requireCommitMessage: boolean;
  addOpen: boolean;
  setAddOpen: (open: boolean) => void;
  commandsOpen: boolean;
  setCommandsOpen: (open: boolean) => void;
  saveOpen: boolean;
  setSaveOpen: (open: boolean) => void;
};

const EditorChromeContext =
  React.createContext<EditorChromeContextValue | null>(null);

function useEditorChrome() {
  const value = React.useContext(EditorChromeContext);
  if (!value) {
    throw new Error('useEditorChrome must be used within EditorProvider.');
  }
  return value;
}

function blockTypeIcon(type: string) {
  switch (type) {
    case 'hero':
      return SparklesIcon;
    case 'featuresGrid':
      return LayoutGridIcon;
    case 'featureItem':
      return ListIcon;
    case 'image':
      return ImageIcon;
    case 'richText':
      return TypeIcon;
    default:
      return BoxIcon;
  }
}

function ToolbarHintButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1.5">
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

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
        if (action === 'quickInsert' && mode === 'canvas') setAddOpen(true);
      }),
    [store, mode],
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
              className="flex min-h-0 min-w-0 flex-1"
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

function EditorAddBlockDialog() {
  const { addOpen, setAddOpen } = useEditorChrome();
  const editor = useEditor();
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const palette = usePalette();
  const groups = groupPaletteItems(palette);
  const targetId = selected ?? rootId;
  const targetActions = useBlockActions(targetId);
  const addParent =
    selected && targetActions.canHaveChildren ? selected : rootId;
  const parentActions = useBlockActions(addParent);

  return (
    <CommandDialog
      open={addOpen}
      onOpenChange={setAddOpen}
      title="Add block"
      description="Search and insert a block"
    >
      <Command>
        <CommandInput placeholder="Search blocks…" />
        <CommandList>
          <CommandEmpty>No blocks found.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup
              key={group.category ?? 'ungrouped'}
              heading={group.category ?? 'Blocks'}
            >
              {group.items.map((item) => {
                const Icon = blockTypeIcon(item.type);
                const allowed = parentActions.allowedChildTypes.includes(
                  item.type,
                );
                return (
                  <CommandItem
                    key={item.type}
                    value={`${item.label} ${item.type} ${group.category ?? ''}`}
                    disabled={!allowed}
                    onSelect={() => {
                      const id = editor.add(item.type, {
                        parent: { id: addParent },
                      });
                      if (id) editor.select(id);
                      setAddOpen(false);
                    }}
                  >
                    <Icon />
                    {item.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/** One command of the palette, disabled while it cannot run. */
function CommandPaletteItem({
  id,
  onRun,
}: {
  id: string;
  onRun: (run: () => void) => void;
}) {
  const command = useCommand(id);
  if (!command) return null;
  const label = command.label ?? id;
  return (
    <CommandItem
      value={`${label} ${id}`}
      disabled={!command.canExecute}
      onSelect={() => onRun(() => command.run())}
    >
      <span className="flex-1 truncate">{label}</span>
      {command.shortcutLabel ? <Kbd>{command.shortcutLabel}</Kbd> : null}
    </CommandItem>
  );
}

/** Every command of the editor (built-ins, then plugins), searchable. */
function EditorCommandPalette() {
  const { commandsOpen, setCommandsOpen } = useEditorChrome();
  const commands = useCommands();
  const ids = commands
    .map((command) => command.id)
    .filter((id) => id !== 'ui.commandPalette');

  return (
    <CommandDialog
      open={commandsOpen}
      onOpenChange={setCommandsOpen}
      title="Commands"
      description="Search and run an editor command"
    >
      <Command>
        <CommandInput placeholder="Search commands…" />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>
          <CommandGroup heading="Commands">
            {ids.map((id) => (
              <CommandPaletteItem
                key={id}
                id={id}
                onRun={(run) => {
                  setCommandsOpen(false);
                  // After the dialog closed: a command may open another one.
                  queueMicrotask(run);
                }}
              />
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function EditorSaveDialog() {
  const { requireCommitMessage, saveOpen, setSaveOpen } = useEditorChrome();
  const { saving, save } = useSave();
  const [commitMessage, setCommitMessage] = React.useState('');

  if (!requireCommitMessage) return null;

  const confirmSave = () => {
    void save({ message: commitMessage || undefined });
    setSaveOpen(false);
    setCommitMessage('');
  };

  return (
    <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Commit message</DialogTitle>
        </DialogHeader>
        <Input
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Describe your changes"
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSaveOpen(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={confirmSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditorToolbar({
  className,
  ...props
}: React.ComponentProps<'header'>) {
  const history = useHistory();
  const { dirty, saving, save } = useSave();
  const {
    device,
    setDevice,
    mode,
    requireCommitMessage,
    setAddOpen,
    setCommandsOpen,
    setSaveOpen,
  } = useEditorChrome();
  const { isMobile } = useSidebar();
  const undo = useCommand('history.undo');
  const redo = useCommand('history.redo');
  const quickInsert = useCommand('ui.quickInsert');
  const palette = useCommand('ui.commandPalette');
  const shortcutLabel = useShortcutLabel();

  const handleSave = () => {
    if (requireCommitMessage) {
      setSaveOpen(true);
      return;
    }
    void save();
  };

  return (
    <header
      data-slot="editor-toolbar"
      className={cn(
        'border-border flex h-12 shrink-0 items-center gap-1 border-b px-2',
        className,
      )}
      {...props}
    >
      {mode === 'form' ? null : <SidebarTrigger className="md:inline-flex" />}
      <Editor.Slot name="toolbar-start" />
      <ToolbarHintButton
        label={undo?.label ?? 'Undo'}
        shortcut={undo?.shortcutLabel}
        disabled={!history.canUndo}
        onClick={() => history.undo()}
      >
        <Undo2Icon />
      </ToolbarHintButton>
      <ToolbarHintButton
        label={redo?.label ?? 'Redo'}
        shortcut={redo?.shortcutLabel}
        disabled={!history.canRedo}
        onClick={() => history.redo()}
      >
        <Redo2Icon />
      </ToolbarHintButton>
      {mode === 'canvas' ? (
        <>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToggleGroup
            value={[device]}
            onValueChange={(value) => {
              const next = value[0];
              if (
                next === 'desktop' ||
                next === 'tablet' ||
                next === 'mobile'
              ) {
                setDevice(next);
              }
            }}
            variant="outline"
            size="sm"
            spacing={0}
          >
            <ToggleGroupItem value="desktop" aria-label="Desktop">
              <MonitorIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="tablet" aria-label="Tablet">
              <TabletIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="mobile" aria-label="Mobile">
              <SmartphoneIcon />
            </ToggleGroupItem>
          </ToggleGroup>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolbarHintButton
            label="Add block"
            shortcut={quickInsert?.shortcutLabel}
            onClick={() => setAddOpen(true)}
          >
            <PlusIcon />
          </ToolbarHintButton>
        </>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <Editor.Slot name="toolbar-end" />
        <ToolbarHintButton
          label={palette?.label ?? 'Commands'}
          shortcut={palette?.shortcutLabel}
          onClick={() => setCommandsOpen(true)}
        >
          <CommandIcon />
        </ToolbarHintButton>
        {mode === 'canvas' && isMobile ? (
          <Sheet>
            <SheetTrigger
              render={<Button type="button" variant="ghost" size="icon-sm" />}
            >
              <PanelRightIcon />
              <span className="sr-only">Inspector</span>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Inspector</SheetTitle>
              </SheetHeader>
              <EditorInspector />
            </SheetContent>
          </Sheet>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="sm"
                disabled={!dirty || saving}
                onClick={handleSave}
                className="relative"
              />
            }
          >
            {saving ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SaveIcon />
            )}
            Save
            {dirty && !saving ? (
              <span
                aria-hidden
                className="bg-primary-foreground size-1.5 rounded-full"
              />
            ) : null}
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-1.5">
            Save
            <Kbd>{shortcutLabel('Mod+s')}</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

function EditorPalette({ className, ...props }: React.ComponentProps<'div'>) {
  const palette = usePalette();
  const groups = groupPaletteItems(palette);
  const { setAddOpen } = useEditorChrome();

  return (
    <SidebarGroup data-slot="editor-palette" className={className} {...props}>
      <SidebarGroupLabel>Palette</SidebarGroupLabel>
      <SidebarGroupAction title="Add block" onClick={() => setAddOpen(true)}>
        <PlusIcon />
        <span className="sr-only">Add block</span>
      </SidebarGroupAction>
      <SidebarGroupContent>
        {groups.map((group) => (
          <div key={group.category ?? 'ungrouped'} className="mb-2">
            {group.category ? (
              <p className="text-sidebar-foreground/70 px-2 py-1 text-xs">
                {group.category}
              </p>
            ) : null}
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = blockTypeIcon(item.type);
                return (
                  <SidebarMenuItem key={item.type}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      render={<PaletteItem type={item.type} />}
                    >
                      <GripVerticalIcon className="text-muted-foreground" />
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </div>
        ))}
        <Editor.Slot name="palette-footer" />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const OUTLINE_ROW_PX = 32;

/** One block row: the APG tree item, a collapse toggle, icon and label. */
function OutlineRow({
  row,
  start,
}: {
  row: FlatOutlineNodeRow;
  start: number;
}) {
  const store = useEditorStore();
  const selected = useSelection().selected === row.id;
  const palette = usePalette();
  const label =
    palette.find((item) => item.type === row.type)?.label ?? row.type;
  const Icon = blockTypeIcon(row.type);
  return (
    <Editor.OutlineItem
      blockId={row.id}
      data-active={selected || undefined}
      className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active]:bg-sidebar-accent focus-visible:ring-sidebar-ring absolute left-0 flex w-full items-center gap-2 rounded-md pr-2 text-sm outline-none focus-visible:ring-2 data-[active]:font-medium"
      style={{
        top: 0,
        height: OUTLINE_ROW_PX,
        transform: `translateY(${start}px)`,
        paddingLeft: 8 + (row.level - 1) * 12,
      }}
    >
      {row.hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="flex size-4 shrink-0 items-center justify-center"
          onClick={(event) => {
            event.stopPropagation();
            store.setCollapsed(row.id, row.expanded);
          }}
        >
          <ChevronRightIcon
            className={cn(
              'size-3.5 transition-transform',
              row.expanded && 'rotate-90',
            )}
          />
        </button>
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <Editor.Slot name="outline-row-actions" props={{ blockId: row.id }} />
    </Editor.OutlineItem>
  );
}

/**
 * The block tree as a virtualized APG tree: only the rows in view mount,
 * keyboard navigation reaches every row (`Editor.Outline rows`), rows drag
 * to reorder and nest.
 */
function EditorOutline({ className, ...props }: React.ComponentProps<'div'>) {
  const rows = useFlatOutline();
  const ids = React.useMemo(
    () => rows.flatMap((row) => (row.kind === 'node' ? [row.id] : [])),
    [rows],
  );
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  // on purpose: the virtualizer's functions change every render; this
  // component re-renders with it, nothing below memoizes them.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => OUTLINE_ROW_PX,
    overscan: 8,
  });
  const reveal = React.useCallback(
    (id: string) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [rows, virtualizer],
  );

  return (
    <SidebarGroup data-slot="editor-outline" className={className} {...props}>
      <SidebarGroupLabel>Outline</SidebarGroupLabel>
      <SidebarGroupContent
        ref={scrollRef}
        className="max-h-[50vh] overflow-y-auto"
      >
        <Editor.Outline
          rows={ids}
          reveal={reveal}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            return row.kind === 'node' ? (
              <OutlineRow key={row.id} row={row} start={item.start} />
            ) : (
              <span
                key={row.id}
                aria-hidden
                className="text-muted-foreground absolute left-0 flex w-full items-end pb-1 text-xs"
                style={{
                  top: 0,
                  height: OUTLINE_ROW_PX,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: 8 + (row.level - 1) * 12,
                }}
              >
                {row.slot}
              </span>
            );
          })}
        </Editor.Outline>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function EditorInspector({ className, ...props }: React.ComponentProps<'div'>) {
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const block = useAnyBlock(selected);
  const palette = usePalette();
  const actions = useBlockActions(selected ?? '');
  const label =
    palette.find((item) => item.type === block?.type)?.label ??
    block?.type ??
    null;
  const Icon = blockTypeIcon(block?.type ?? '');

  return (
    <div
      data-slot="editor-inspector"
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      {...props}
    >
      <Tabs defaultValue="block" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="bg-background sticky top-0 z-10 border-b">
          <div className="flex items-center gap-2 px-3 py-2">
            {selected && block ? (
              <>
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {label}
                </span>
                <Editor.Slot
                  name="inspector-header"
                  props={{ blockId: selected }}
                />
                {actions.parent !== null ? (
                  <div className="flex items-center gap-1">
                    <ToolbarHintButton
                      label="Duplicate"
                      onClick={() => actions.duplicate()}
                    >
                      <CopyIcon />
                    </ToolbarHintButton>
                    <ToolbarHintButton
                      label="Delete"
                      onClick={() => actions.remove()}
                    >
                      <Trash2Icon />
                    </ToolbarHintButton>
                  </div>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground text-sm">Inspector</span>
            )}
          </div>
          <TabsList variant="line" className="w-full justify-start px-3">
            <TabsTrigger value="block">Block</TabsTrigger>
            <TabsTrigger value="page">Page</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          value="block"
          className="min-h-0 flex-1 overflow-y-auto p-3"
        >
          {selected ? (
            <Form blockId={selected} autoScroll />
          ) : (
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-sm">
              <BoxIcon className="size-8 opacity-40" />
              <p>Select a block to edit its fields.</p>
            </div>
          )}
        </TabsContent>
        <TabsContent
          value="page"
          className="min-h-0 flex-1 overflow-y-auto p-3"
        >
          <Form blockId={rootId} />
        </TabsContent>
      </Tabs>
      <div
        data-slot="editor-inspector-footer"
        className="border-t p-3 empty:hidden"
      >
        <Editor.Slot
          name="inspector-footer"
          props={{ blockId: selected ?? rootId }}
        />
      </div>
    </div>
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
  const { isMobile } = useSidebar();
  if (isMobile) return null;
  return (
    <Sidebar side="right" collapsible="icon" className="absolute h-full">
      <SidebarContent>
        <EditorInspector />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

type EditorShellProps = {
  className?: string;
  children?: React.ReactNode;
  requireCommitMessage?: boolean;
  mode?: 'canvas' | 'form';
};

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
      {mode === 'canvas' ? (
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
      </SidebarInset>
      {mode === 'canvas' ? <EditorRightSidebar /> : null}
    </EditorProvider>
  );
}

export {
  EditorInspector,
  EditorOutline,
  EditorPalette,
  EditorProvider,
  EditorShell,
  EditorSurface,
  EditorToolbar,
  useDeviceFrame,
  useEditorChrome,
};
export type { Device, EditorProviderProps, EditorShellProps };
