'use client';

import { Editor } from '@createcms/react/editor';
import {
  groupPaletteItems,
  useBlockActions,
  useChildren,
  useEditor,
  useHistory,
  usePalette,
  useSave,
  useSelection,
} from '@createcms/react/editor';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { Form } from './editor-form';

type Device = 'desktop' | 'tablet' | 'mobile';

const deviceMaxWidth: Record<Device, string> = {
  desktop: 'max-w-none',
  tablet: 'max-w-[768px]',
  mobile: 'max-w-[375px]',
};

type EditorShellProps = {
  className?: string;
  children?: React.ReactNode;
  requireCommitMessage?: boolean;
};

function OutlineTree({ parentId, depth }: { parentId: string; depth: number }) {
  const children = useChildren(parentId);
  return children.map((child) => (
    <React.Fragment key={child.id}>
      <Editor.OutlineItem
        blockId={child.id}
        className={cn(
          'py-1 text-sm',
          depth > 0 && 'border-border border-l pl-2',
        )}
        style={{ paddingInlineStart: depth * 12 }}
      />
      <OutlineTree parentId={child.id} depth={depth + 1} />
    </React.Fragment>
  ));
}

function AddBlockDialog({
  open,
  onOpenChange,
  parentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string;
}) {
  const palette = usePalette();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add block</DialogTitle>
        </DialogHeader>
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {palette.map((item) => (
            <li key={item.type}>
              <Editor.AddBlock
                type={item.type}
                parentId={parentId}
                className="hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-50"
                onClick={() => onOpenChange(false)}
              >
                {item.label ?? item.type}
              </Editor.AddBlock>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditorShell({
  className,
  children,
  requireCommitMessage = false,
}: EditorShellProps) {
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const history = useHistory();
  const { dirty, saving, save } = useSave();
  const palette = usePalette();
  const groups = groupPaletteItems(palette);
  const [device, setDevice] = React.useState<Device>('desktop');
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [commitMessage, setCommitMessage] = React.useState('');
  const [addOpen, setAddOpen] = React.useState(false);

  const targetId = selected ?? rootId;
  const targetActions = useBlockActions(targetId);
  const addParent =
    selected && targetActions.canHaveChildren ? selected : rootId;

  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const handleSave = () => {
    if (requireCommitMessage) {
      setSaveOpen(true);
      return;
    }
    void save();
  };

  const confirmSave = () => {
    void save({ message: commitMessage || undefined });
    setSaveOpen(false);
    setCommitMessage('');
  };

  return (
    <div
      data-slot="editor-shell"
      className={cn(
        'grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-0',
        className,
      )}
    >
      <header className="border-border flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!history.canUndo}
          onClick={() => history.undo()}
        >
          Undo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!history.canRedo}
          onClick={() => history.redo()}
        >
          Redo
        </Button>
        <div className="flex gap-1">
          {(['desktop', 'tablet', 'mobile'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={device === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDevice(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAddOpen(true)}
        >
          Add block
        </Button>
      </header>
      <div className="grid min-h-0 grid-cols-[minmax(12rem,16rem)_1fr_minmax(14rem,20rem)]">
        <aside className="border-border flex flex-col gap-4 overflow-y-auto border-r p-3">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide">
              Palette
            </h2>
            {groups.map((group) => (
              <div key={group.group ?? 'ungrouped'} className="mb-3">
                {group.group ? (
                  <h3 className="text-muted-foreground mb-1 text-xs">
                    {group.group}
                  </h3>
                ) : null}
                <ul className="flex flex-col gap-1">
                  {group.items.map((item) => (
                    <li key={item.type}>
                      <Editor.AddBlock
                        type={item.type}
                        parentId={addParent}
                        className="hover:bg-muted w-full rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-50"
                      >
                        {item.label ?? item.type}
                      </Editor.AddBlock>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          <section role="tree">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide">
              Outline
            </h2>
            <OutlineTree parentId={rootId} depth={0} />
          </section>
        </aside>
        <div
          className={cn(
            'min-h-0 overflow-auto p-3',
            deviceMaxWidth[device],
            device !== 'desktop' && 'mx-auto w-full',
          )}
        >
          {children}
        </div>
        <aside className="border-border overflow-y-auto border-l p-3">
          <Form blockId={selected ?? rootId} />
        </aside>
      </div>
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
      <AddBlockDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        parentId={addParent}
      />
    </div>
  );
}

export { EditorShell };
export type { EditorShellProps };
