// @registry ui-sdk-ui@0.3.2
'use client';

// The styled building blocks the UI SDK editor shares: button variants on
// `@ui-sdk/react/button`, field and popup surfaces, keyboard hints and the
// icon button with a tooltip. Every behavior (focus, keyboard, ARIA,
// dismissal) comes from UI SDK; this file only adds the look, from the same
// tokens as the shadcn editor.

import { Button as ButtonPart } from '@ui-sdk/react/button';
import { Input as InputPart } from '@ui-sdk/react/input';
import { Separator as SeparatorPart } from '@ui-sdk/react/separator';
import { Textarea as TextareaPart } from '@ui-sdk/react/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui-sdk/react/tooltip';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent text-sm font-medium outline-none transition-colors select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-disabled:pointer-events-none data-disabled:opacity-50 data-pending:cursor-progress [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        outline:
          'border-border bg-background hover:bg-muted data-open:bg-muted dark:bg-input/30',
        ghost: 'hover:bg-muted data-open:bg-muted',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20',
      },
      size: {
        default: 'h-8 px-2.5',
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        icon: 'size-8',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ButtonProps = Omit<React.ComponentProps<typeof ButtonPart>, 'className'> &
  VariantProps<typeof buttonVariants> & { className?: string };

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <ButtonPart
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

const fieldClass =
  'border-input w-full min-w-0 rounded-lg border bg-transparent px-2.5 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-input/30';

function Input({
  className,
  ...props
}: Omit<React.ComponentProps<typeof InputPart>, 'className'> & {
  className?: string;
}) {
  return <InputPart className={cn(fieldClass, 'h-8', className)} {...props} />;
}

function Textarea({
  className,
  ...props
}: Omit<React.ComponentProps<typeof TextareaPart>, 'className'> & {
  className?: string;
}) {
  return (
    <TextareaPart
      className={cn(fieldClass, 'min-h-16 py-2', className)}
      {...props}
    />
  );
}

function Separator({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SeparatorPart>, 'className'> & {
  className?: string;
}) {
  return (
    <SeparatorPart
      className={cn(
        'bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch',
        className,
      )}
      {...props}
    />
  );
}

/** The surface of every popup: menus, select lists, tooltips, popovers. */
const popupClass =
  'bg-popover text-popover-foreground z-50 rounded-lg border shadow-md outline-none origin-(--transform-origin) transition-[opacity,scale] duration-(--editor-duration) data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-none';

/** One row of a menu, select list or command list. */
const itemClass =
  'relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 pointer-coarse:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4';

/** The centered card of a modal dialog. */
const dialogClass =
  'bg-background fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border p-6 shadow-lg outline-none transition-[opacity,scale] duration-(--editor-duration) data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 sm:max-w-lg motion-reduce:transition-none';

const backdropClass =
  'fixed inset-0 z-50 bg-black/30 transition-opacity duration-(--editor-duration) data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none';

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'bg-muted text-muted-foreground pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1 font-sans text-xs font-medium select-none',
        className,
      )}
      {...props}
    />
  );
}

/**
 * An icon button whose tooltip names it, with the shortcut as a hint. The
 * shortcut only shows: the editor's own keymap runs it.
 */
function HintButton({
  label,
  shortcut,
  disabled,
  onClick,
  size = 'icon-sm',
  className,
  children,
  ...props
}: Omit<ButtonProps, 'children' | 'onClick'> & {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            disabled={disabled}
            focusableWhenDisabled
            onClick={onClick}
            className={className}
            {...props}
          />
        }
      >
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent
        sideOffset={6}
        className={cn(
          popupClass,
          'flex items-center gap-1.5 px-2 py-1 text-xs',
        )}
      >
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export {
  Button,
  HintButton,
  Input,
  Kbd,
  Separator,
  Textarea,
  backdropClass,
  buttonVariants,
  dialogClass,
  fieldClass,
  itemClass,
  popupClass,
};
export type { ButtonProps };
