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
  type EditorChromeOptions,
  type Layout,
} from './editor-chrome';

export {
  DEVICE_WIDTH,
  type Device,
  type Layout,
  type PalettePage,
  type Sheet,
} from './editor-chrome';

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

const HandleContext = React.createContext<PrimitiveHandle<
  typeof editorChrome
> | null>(null);

function ChromeRoot({
  mode,
  layout,
  dirty,
  requireCommitMessage,
  onSave,
  onPanelsChange,
  ...props
}: EditorChromeOptions & PartProps<'div', ChromeState>) {
  const handle = usePrimitive(editorChrome, {
    mode,
    layout,
    dirty,
    requireCommitMessage,
    onSave,
    onPanelsChange,
  });
  return (
    <HandleContext.Provider value={handle}>
      {usePart(handle, 'root', {}, props, 'div')}
    </HandleContext.Provider>
  );
}

export const Chrome = { ...parts, Root: ChromeRoot };

export function useChrome() {
  const handle = React.useContext(HandleContext);
  if (!handle) throw new Error('useChrome needs the editor shell around it.');
  const { instance } = handle;
  const state = React.useSyncExternalStore(
    instance.subscribe,
    () => instance.get() as ChromeState,
    () => instance.get() as ChromeState,
  );
  return { ...state, api: handle.api };
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
