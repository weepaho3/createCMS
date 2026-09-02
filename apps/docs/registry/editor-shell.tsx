'use client';

// Composes shadcn Sidebar, Tooltip, Command, ToggleGroup, Tabs, Separator,
// Kbd, Sheet, Button, Dialog, Input, and Collapsible. Do not replace those
// primitives with custom chrome.

import { Editor } from '@createcms/react/editor';
import {
  groupPaletteItems,
  useAnyBlock,
  useBlockActions,
  useChildren,
  useEditor,
  useEditorKeyboard,
  useHistory,
  usePalette,
  useSave,
  useSelection,
} from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';
import {
  BoxIcon,
  CopyIcon,
  GripVerticalIcon,
  ImageIcon,
  LayoutGridIcon,
  ListIcon,
  ChevronRightIcon,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  SidebarMenuSub,
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

const deviceMaxWidth: Record<Device, string> = {
  desktop: 'max-w-none',
  tablet: 'max-w-[768px]',
  mobile: 'max-w-[375px]',
};

type EditorChromeContextValue = {
  device: Device;
  setDevice: (device: Device) => void;
  requireCommitMessage: boolean;
  addOpen: boolean;
  setAddOpen: (open: boolean) => void;
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
};

function EditorProvider({
  className,
  children,
  requireCommitMessage = false,
  style,
  ...props
}: EditorProviderProps) {
  const [device, setDevice] = React.useState<Device>('desktop');
  const [addOpen, setAddOpen] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const scopeRef = React.useRef<HTMLDivElement | null>(null);
  const { dirty, saving, save } = useSave();

  useEditorKeyboard(scopeRef);

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
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        if (!dirty || saving) return;
        if (requireCommitMessage) setSaveOpen(true);
        else void save();
        return;
      }
      if (key === 'k') {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest('input, textarea, select, [contenteditable="true"]')
        ) {
          return;
        }
        event.preventDefault();
        setAddOpen(true);
      }
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
              requireCommitMessage,
              addOpen,
              setAddOpen,
              saveOpen,
              setSaveOpen,
            }}
          >
            <div
              ref={scopeRef}
              data-slot="editor-shell"
              className="flex min-h-0 min-w-0 flex-1"
            >
              {children}
            </div>
            <EditorAddBlockDialog />
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
              key={group.group ?? 'ungrouped'}
              heading={group.group ?? 'Blocks'}
            >
              {group.items.map((item) => {
                const Icon = blockTypeIcon(item.type);
                const allowed = parentActions.allowedChildTypes.includes(
                  item.type,
                );
                return (
                  <CommandItem
                    key={item.type}
                    value={`${item.label} ${item.type} ${group.group ?? ''}`}
                    disabled={!allowed}
                    onSelect={() => {
                      const id = editor.add(item.type, {
                        parentId: addParent,
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
  const { device, setDevice, requireCommitMessage, setAddOpen, setSaveOpen } =
    useEditorChrome();
  const { isMobile } = useSidebar();

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
      <SidebarTrigger className="md:inline-flex" />
      <ToolbarHintButton
        label="Undo"
        shortcut="⌘Z"
        disabled={!history.canUndo}
        onClick={() => history.undo()}
      >
        <Undo2Icon />
      </ToolbarHintButton>
      <ToolbarHintButton
        label="Redo"
        shortcut="⌘⇧Z"
        disabled={!history.canRedo}
        onClick={() => history.redo()}
      >
        <Redo2Icon />
      </ToolbarHintButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToggleGroup
        value={[device]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === 'desktop' || next === 'tablet' || next === 'mobile') {
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
        shortcut="⌘K"
        onClick={() => setAddOpen(true)}
      >
        <PlusIcon />
      </ToolbarHintButton>
      <div className="ml-auto flex items-center gap-1">
        {isMobile ? (
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
            <Kbd>⌘S</Kbd>
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
          <div key={group.group ?? 'ungrouped'} className="mb-2">
            {group.group ? (
              <p className="text-sidebar-foreground/70 px-2 py-1 text-xs">
                {group.group}
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
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function OutlineNode({ blockId }: { blockId: string }) {
  const children = useChildren(blockId);
  const block = useAnyBlock(blockId);
  const selected = useSelection().selected === blockId;
  const palette = usePalette();
  const [open, setOpen] = React.useState(true);
  const hasChildren = children.length > 0;
  const label =
    palette.find((item) => item.type === block?.type)?.label ??
    block?.type ??
    blockId;
  const Icon = blockTypeIcon(block?.type ?? '');

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={selected}
          tooltip={label}
          className="h-auto items-stretch overflow-visible py-0"
          render={
            <Editor.OutlineItem
              blockId={blockId}
              aria-expanded={hasChildren ? open : undefined}
            />
          }
        >
          <span className="flex h-8 w-full min-w-0 items-center gap-2">
            {hasChildren ? (
              <CollapsibleTrigger
                className="pointer-events-auto size-4 shrink-0"
                onClick={(event) => event.stopPropagation()}
              >
                <ChevronRightIcon
                  className={cn(
                    'size-3.5 transition-transform',
                    open && 'rotate-90',
                  )}
                />
                <span className="sr-only">Toggle</span>
              </CollapsibleTrigger>
            ) : (
              <span className="size-3.5 shrink-0" />
            )}
            <Icon />
            <span>{label}</span>
          </span>
          {hasChildren ? (
            <CollapsibleContent className="w-full">
              <SidebarMenuSub className="mx-0 mr-0 border-l-0 px-0 pr-0">
                {children.map((child) => (
                  <OutlineNode key={child.id} blockId={child.id} />
                ))}
              </SidebarMenuSub>
            </CollapsibleContent>
          ) : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function EditorOutline({ className, ...props }: React.ComponentProps<'div'>) {
  const rootId = useEditor((state) => state.rootId);
  const children = useChildren(rootId);

  return (
    <SidebarGroup data-slot="editor-outline" className={className} {...props}>
      <SidebarGroupLabel>Outline</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu role="tree">
          {children.map((child) => (
            <OutlineNode key={child.id} blockId={child.id} />
          ))}
        </SidebarMenu>
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
                {actions.parentId !== null ? (
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
    </div>
  );
}

function EditorSurface({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  const { device } = useEditorChrome();

  return (
    <div
      data-slot="editor-surface"
      className={cn(
        'min-h-0 flex-1 overflow-auto p-3',
        deviceMaxWidth[device],
        device !== 'desktop' && 'mx-auto w-full',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
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
};

function EditorShell({
  className,
  children,
  requireCommitMessage = false,
}: EditorShellProps) {
  return (
    <EditorProvider
      className={className}
      requireCommitMessage={requireCommitMessage}
    >
      <Sidebar side="left" collapsible="icon" className="absolute h-full">
        <SidebarContent>
          <EditorPalette />
          <EditorOutline />
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <EditorToolbar />
        <EditorSurface>{children}</EditorSurface>
      </SidebarInset>
      <EditorRightSidebar />
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
  useEditorChrome,
};
export type { Device, EditorProviderProps, EditorShellProps };
