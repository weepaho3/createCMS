// @registry ui-sdk-editor@0.3.2
'use client';

import type { StateOf } from '@ui-sdk/core';

import { Button } from '@ui-sdk/react/button';
import {
  createParts,
  usePart,
  usePrimitive,
  type PartProps,
  type PrimitiveHandle,
} from '@ui-sdk/react/primitive';
import { useShortcutHint } from '@ui-sdk/react/shortcuts';
import {
  createTooltipController,
  Tooltip,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
  type TooltipController,
} from '@ui-sdk/react/tooltip';
import {
  BoxIcon,
  ImageIcon,
  LayoutGridIcon,
  ListIcon,
  SparklesIcon,
  TypeIcon,
} from 'lucide-react';
import * as React from 'react';

import {
  editorChrome,
  type Device,
  type EditorChromeOptions,
  type Layout,
  type PalettePage,
  type Panels,
  type Sheet,
} from './editor-chrome';

export { DEVICE_WIDTH } from './editor-chrome';
export type { Device, Layout, PalettePage, Sheet };

const parts = createParts(editorChrome, {
  main: 'div',
  toolbar: 'div',
  surface: 'div',
  'status-bar': 'div',
  'bottom-bar': 'nav',
  palette: 'section',
  'palette-title': 'h2',
  outline: 'section',
  'outline-title': 'h2',
  'outline-body': 'div',
  inspector: 'div',
  form: 'div',
  'form-surface': 'div',
  'form-breadcrumb': 'nav',
  'form-child': 'li',
});

type ChromeState = StateOf<typeof editorChrome, 'root'>;

type Hint = { label: string; shortcut?: string };

type ChromeContextValue = ChromeState & {
  api: PrimitiveHandle<typeof editorChrome>['api'];
  tooltip: TooltipController<Hint>;
};

const ChromeContext = React.createContext<ChromeContextValue | null>(null);

function ChromeRoot({
  mode = 'canvas',
  layout = 'desktop',
  dirty,
  requireCommitMessage,
  onSave,
  blockTypes,
  onInsertBlock,
  onPanelsChange,
  children,
  ...props
}: Pick<
  EditorChromeOptions,
  | 'mode'
  | 'layout'
  | 'dirty'
  | 'requireCommitMessage'
  | 'onSave'
  | 'blockTypes'
  | 'onInsertBlock'
  | 'onPanelsChange'
> &
  Omit<PartProps<'div', ChromeState>, 'children'> & {
    children?: React.ReactNode;
  }) {
  const [device, setDevice] = React.useState<Device>('desktop');
  const [panels, setPanels] = React.useState<Panels>({
    left: true,
    right: true,
  });
  const [sheet, setSheet] = React.useState<Sheet | null>(null);
  const [palette, setPalette] = React.useState<PalettePage | null>(null);
  const [commitOpen, setCommitOpen] = React.useState(false);
  const [tooltip] = React.useState(() => createTooltipController<Hint>());
  const handle = usePrimitive(editorChrome, {
    mode,
    layout,
    dirty,
    requireCommitMessage,
    onSave,
    blockTypes,
    onInsertBlock,
    device,
    onDeviceChange: setDevice,
    panels,
    onPanelsChange: (next, details) => {
      onPanelsChange?.(next, details);
      if (!details.canceled) setPanels(next);
    },
    sheet,
    onSheetChange: setSheet,
    palette,
    onPaletteChange: setPalette,
    commitOpen,
    onCommitOpenChange: setCommitOpen,
  });
  const value = React.useMemo(
    () => ({
      mode,
      layout,
      device,
      panels,
      sheet,
      palette,
      commitOpen,
      api: handle.api,
      tooltip,
    }),
    [
      mode,
      layout,
      device,
      panels,
      sheet,
      palette,
      commitOpen,
      handle.api,
      tooltip,
    ],
  );
  return (
    <ChromeContext.Provider value={value}>
      {usePart(
        handle,
        'root',
        {},
        {
          ...props,
          children: (
            <>
              {children}
              <Tooltip controller={tooltip}>
                <TooltipContent<Hint>
                  sideOffset={6}
                  aria-label="Button hint"
                  className="ed-popup ed-tip"
                >
                  {(state) => (
                    <>
                      {state.payload?.label}
                      {state.payload?.shortcut ? (
                        <TooltipShortcut
                          shortcut={state.payload.shortcut}
                          className="ed-kbd"
                        />
                      ) : null}
                    </>
                  )}
                </TooltipContent>
              </Tooltip>
            </>
          ),
        },
        'div',
      )}
    </ChromeContext.Provider>
  );
}

export const Chrome = { ...parts, Root: ChromeRoot };

export function useChrome(): ChromeContextValue {
  const chrome = React.useContext(ChromeContext);
  if (!chrome) throw new Error('useChrome needs the editor shell around it.');
  return chrome;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useLayout(): Layout {
  const phone = useMediaQuery('(max-width: 639px)');
  const tablet = useMediaQuery('(max-width: 1023px)');
  return phone ? 'phone' : tablet ? 'tablet' : 'desktop';
}

export const keysOf = (shortcut: string | undefined) => shortcut?.toLowerCase();

export function blockIcon(type: string): React.ElementType {
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

type IconButtonProps = Omit<
  React.ComponentProps<typeof TooltipTrigger>,
  'children' | 'render' | 'aria-label' | 'controller' | 'payload'
> & {
  label: string;
  shortcut?: string;
  size?: 'sm' | 'xs' | 'touch';
  render?: React.ReactElement;
  children: React.ReactNode;
};

export function IconButton({
  label,
  shortcut,
  size = 'sm',
  render,
  className,
  children,
  ...props
}: IconButtonProps) {
  const { tooltip } = useChrome();
  const keys = keysOf(shortcut);
  const hint = useShortcutHint(keys ?? 'escape');
  return (
    <TooltipTrigger
      controller={tooltip}
      payload={{ label, shortcut: keys }}
      render={render ?? <Button focusableWhenDisabled />}
      aria-label={label}
      aria-keyshortcuts={keys ? hint.ariaKeyshortcuts : undefined}
      className={['ed-button', className].filter(Boolean).join(' ')}
      data-variant="ghost"
      data-size={`icon-${size}`}
      {...props}
    >
      {children}
    </TooltipTrigger>
  );
}
