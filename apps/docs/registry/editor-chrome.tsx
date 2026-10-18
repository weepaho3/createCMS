// @registry editor-chrome@0.3.2
'use client';

// The chrome state the editor shell parts share: device and layout, the
// open dialog or sheet, and small building blocks (icons, hint buttons).
// Map your block types to icons in `blockTypeIcon`.

import {
  BoxIcon,
  ImageIcon,
  LayoutGridIcon,
  ListIcon,
  SparklesIcon,
  TypeIcon,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Device = 'desktop' | 'tablet' | 'mobile';

/** Frame width per device: media queries in the canvas see this width. */
const deviceWidth: Record<Device, number | 'full'> = {
  desktop: 'full',
  tablet: 768,
  mobile: 375,
};

/**
 * Shell layout by viewport width: `phone` (< 640px) shows the canvas full
 * width with a bottom action bar and bottom sheets, `tablet` (640 to
 * 1023px) docks the left panel and opens the inspector as a drawer,
 * `desktop` docks both panels.
 */
type ShellLayout = 'phone' | 'tablet' | 'desktop';

/** One sheet at a time: opening another replaces it. */
type ShellSheet = 'props' | 'add' | 'outline' | null;

function useMediaQuery(query: string): boolean {
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

function useShellLayout(): ShellLayout {
  const phone = useMediaQuery('(max-width: 639px)');
  const tablet = useMediaQuery('(max-width: 1023px)');
  return phone ? 'phone' : tablet ? 'tablet' : 'desktop';
}

/** Form controls keep a 16px font under a coarse pointer (no iOS focus zoom). */
const COARSE_TEXT =
  'pointer-coarse:[&_input]:text-base pointer-coarse:[&_select]:text-base pointer-coarse:[&_textarea]:text-base';

type EditorChromeContextValue = {
  device: Device;
  setDevice: (device: Device) => void;
  mode: 'canvas' | 'form';
  layout: ShellLayout;
  sheet: ShellSheet;
  setSheet: (sheet: ShellSheet) => void;
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

export {
  COARSE_TEXT,
  EditorChromeContext,
  ToolbarHintButton,
  blockTypeIcon,
  deviceWidth,
  useEditorChrome,
  useMediaQuery,
  useShellLayout,
};
export type { Device, EditorChromeContextValue, ShellLayout, ShellSheet };
