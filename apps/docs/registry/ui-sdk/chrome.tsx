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
import { ToolbarButton } from '@ui-sdk/react/toolbar';
import {
  Tooltip,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
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
  toolbar: 'header',
  surface: 'div',
  'status-bar': 'footer',
  'bottom-bar': 'nav',
  palette: 'section',
  'palette-title': 'h2',
  outline: 'section',
  'outline-title': 'h2',
  inspector: 'div',
  form: 'div',
  'form-surface': 'div',
  'form-breadcrumb': 'nav',
  'form-child': 'li',
});

type ChromeState = StateOf<typeof editorChrome, 'root'>;

type ChromeContextValue = ChromeState & {
  api: PrimitiveHandle<typeof editorChrome>['api'];
};

const ChromeContext = React.createContext<ChromeContextValue | null>(null);

function ChromeRoot({
  mode = 'canvas',
  layout = 'desktop',
  dirty,
  requireCommitMessage,
  onSave,
  onPanelsChange,
  ...props
}: Pick<
  EditorChromeOptions,
  | 'mode'
  | 'layout'
  | 'dirty'
  | 'requireCommitMessage'
  | 'onSave'
  | 'onPanelsChange'
> &
  PartProps<'div', ChromeState>) {
  const [device, setDevice] = React.useState<Device>('desktop');
  const [panels, setPanels] = React.useState<Panels>({
    left: true,
    right: true,
  });
  const [sheet, setSheet] = React.useState<Sheet | null>(null);
  const [palette, setPalette] = React.useState<PalettePage | null>(null);
  const [commitOpen, setCommitOpen] = React.useState(false);
  const handle = usePrimitive(editorChrome, {
    mode,
    layout,
    dirty,
    requireCommitMessage,
    onSave,
    device,
    onDeviceChange: setDevice,
    panels,
    onPanelsChange: (next, details) => {
      setPanels(next);
      onPanelsChange?.(next, details);
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
    }),
    [mode, layout, device, panels, sheet, palette, commitOpen, handle.api],
  );
  return (
    <ChromeContext.Provider value={value}>
      {usePart(handle, 'root', {}, props, 'div')}
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
  'children' | 'render' | 'aria-label'
> & {
  label: string;
  shortcut?: string;
  size?: 'sm' | 'xs' | 'touch';
  inToolbar?: boolean;
  children: React.ReactNode;
};

export function IconButton({
  label,
  shortcut,
  size = 'sm',
  inToolbar = false,
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip shortcut={keysOf(shortcut)}>
      <TooltipTrigger
        render={inToolbar ? <ToolbarButton /> : <Button />}
        aria-label={label}
        className={['ed-button', className].filter(Boolean).join(' ')}
        data-variant="ghost"
        data-size={`icon-${size}`}
        {...props}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent
        sideOffset={6}
        className="ed-popup ed-tip"
        data-agent-hidden=""
      >
        {label}
        {shortcut ? <TooltipShortcut className="ed-kbd" /> : null}
      </TooltipContent>
    </Tooltip>
  );
}
