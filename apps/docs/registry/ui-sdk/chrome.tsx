// @registry ui-sdk-editor@0.3.2
'use client';

// Shared state of the editor chrome (device, layout, panels, the open
// sheet, the command palette) and the small parts every panel uses: the
// icon button named by its tooltip and the block type icons. Styles live in
// editor-ui-sdk.css, keyed on the `ed-*` classes and UI SDK state attributes.

import { Button } from '@ui-sdk/react/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui-sdk/react/tooltip';
import {
  BoxIcon,
  ImageIcon,
  LayoutGridIcon,
  ListIcon,
  SparklesIcon,
  TypeIcon,
} from 'lucide-react';
import * as React from 'react';

export type Device = 'desktop' | 'tablet' | 'mobile';

/** Frame width per device: the canvas's media queries see this width. */
export const DEVICE_WIDTH: Record<Device, number | 'full'> = {
  desktop: 'full',
  tablet: 768,
  mobile: 375,
};

/**
 * `phone` (< 640px): canvas full width, bottom bar, sheets. `tablet` (640
 * to 1023px): left panel docked, inspector in a drawer. `desktop`: both
 * panels docked.
 */
export type Layout = 'phone' | 'tablet' | 'desktop';

export type Sheet = 'props' | 'add' | 'outline';

/** Pages of the command palette: the commands, adding a block, moving the selection. */
export type PalettePage = 'commands' | 'add' | 'move';

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

export type Chrome = {
  mode: 'canvas' | 'form';
  layout: Layout;
  device: Device;
  setDevice: (device: Device) => void;
  /** Whether a docked panel shows. A hidden panel is gone, not a rail. */
  panels: { left: boolean; right: boolean };
  togglePanel: (side: 'left' | 'right') => void;
  sheet: Sheet | null;
  setSheet: (sheet: Sheet | null) => void;
  /** The palette page that is open, or `null` while it is closed. */
  palette: PalettePage | null;
  openPalette: (page: PalettePage) => void;
  closePalette: () => void;
  requireCommitMessage: boolean;
  commitOpen: boolean;
  setCommitOpen: (open: boolean) => void;
};

export const ChromeContext = React.createContext<Chrome | null>(null);

export function useChrome(): Chrome {
  const chrome = React.useContext(ChromeContext);
  if (!chrome) throw new Error('useChrome must be used within EditorShell.');
  return chrome;
}

/** Map your block types to icons here. */
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
  React.ComponentProps<typeof Button>,
  'children' | 'className'
> & {
  label: string;
  /** Shown in the tooltip; the editor's keymap runs it. */
  shortcut?: string;
  size?: 'sm' | 'xs';
  className?: string;
  /** The part to render, like a `ToolbarButton`. Default a UI SDK `Button`. */
  base?: React.ReactElement;
  children: React.ReactNode;
};

/** An icon-only button. Its tooltip names it and shows the shortcut. */
export function IconButton({
  label,
  shortcut,
  size = 'sm',
  className,
  base,
  children,
  ...props
}: IconButtonProps) {
  const element = base ?? <Button />;
  return (
    <Tooltip>
      <TooltipTrigger
        render={React.cloneElement(
          element as React.ReactElement<Record<string, unknown>>,
          {
            ...props,
            className: ['ed-button', className].filter(Boolean).join(' '),
            'data-variant': 'ghost',
            'data-size': `icon-${size}`,
          },
        )}
      >
        {children}
        <span className="ed-sr">{label}</span>
      </TooltipTrigger>
      <TooltipContent sideOffset={6} className="ed-popup ed-tip">
        {label}
        {shortcut ? <kbd className="ed-kbd">{shortcut}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}
