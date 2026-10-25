import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { EditorError } from '../core/store';

import { useRender } from '../../use-render';
import { useMessages } from '../messages';

export type BlockErrorBoundaryProps = {
  /** When this value changes while showing the fallback, the children render again. */
  resetKey: unknown;
  /** Shown instead of the children after they threw. */
  fallback: (error: unknown) => React.ReactNode;
  onError?: (error: unknown, componentStack: string | undefined) => void;
  /** After a reset; `reason` is always `keys` (the reset key changed). */
  onReset?: (details: { reason: 'keys' }) => void;
  children?: React.ReactNode;
};

type BoundaryState = {
  error: unknown;
  failed: boolean;
  resetKey: unknown;
  /** Bumps on every reset, so `componentDidUpdate` can report it. */
  resets: number;
};

/**
 * Catches a render error below it so one failing block never unmounts the
 * whole editor. A changed `resetKey` (new props, an undo) renders the
 * children again.
 */
export class BlockErrorBoundary extends React.Component<
  BlockErrorBoundaryProps,
  BoundaryState
> {
  override state: BoundaryState = {
    error: null,
    failed: false,
    resetKey: this.props.resetKey,
    resets: 0,
  };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error, failed: true };
  }

  static getDerivedStateFromProps(
    props: BlockErrorBoundaryProps,
    state: BoundaryState,
  ): Partial<BoundaryState> | null {
    if (Object.is(props.resetKey, state.resetKey)) return null;
    if (!state.failed) return { resetKey: props.resetKey };
    return {
      resetKey: props.resetKey,
      failed: false,
      error: null,
      resets: state.resets + 1,
    };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    this.props.onError?.(error, info.componentStack ?? undefined);
  }

  override componentDidUpdate(
    _previous: BlockErrorBoundaryProps,
    previousState: BoundaryState,
  ): void {
    if (this.state.resets !== previousState.resets) {
      this.props.onReset?.({ reason: 'keys' });
    }
  }

  override render(): React.ReactNode {
    if (this.state.failed) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

/** The error a block threw while rendering, as `onError` reports it. */
export function renderError(
  error: unknown,
  nodeId: string,
  type: string,
  componentStack: string | undefined,
): EditorError {
  return {
    kind: 'render',
    message: error instanceof Error ? error.message : String(error),
    cause: error,
    nodeId,
    type,
    componentStack,
  };
}

type BlockErrorState = { blockId: string; blockType: string };

export type CanvasBlockErrorProps = UseRenderComponentProps<
  'div',
  BlockErrorState
> & {
  blockId: string;
  blockType: string;
  error: unknown;
};

/**
 * Shown in place of a block that threw while rendering. It carries the
 * block's anchor, so the block stays selectable and deletable, and shows
 * its type and id unless `children` replace them.
 */
export function CanvasBlockError({
  blockId,
  blockType,
  error: _error,
  render,
  children,
  ...rest
}: CanvasBlockErrorProps) {
  const messages = useMessages().parts;
  const anchors = { 'data-editor-block': blockId, 'data-block-error': '' };
  return useRender<'div', BlockErrorState>({
    defaultTagName: 'div',
    render,
    props: {
      role: 'alert',
      ...rest,
      ...anchors,
      children:
        children ?? messages.blockError({ type: blockType, id: blockId }),
    },
    state: { blockId, blockType },
  });
}

export type CanvasUnknownBlockProps = UseRenderComponentProps<
  'div',
  BlockErrorState
> & {
  blockId: string;
  blockType: string;
  /** The node's props, untouched. */
  props: Readonly<Record<string, unknown>>;
  /** Every slot of the node, rendered: children of an unknown block stay editable. */
  slots: Readonly<Record<string, React.ReactNode>>;
};

/**
 * Shown for a block type without a canvas component. Its data stays as
 * stored; the block is selectable and its slots render below the label.
 */
export function CanvasUnknownBlock({
  blockId,
  blockType,
  props: _props,
  slots,
  render,
  children,
  ...rest
}: CanvasUnknownBlockProps) {
  const messages = useMessages().parts;
  const anchors = { 'data-editor-block': blockId, 'data-unknown-block': '' };
  return useRender<'div', BlockErrorState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      ...anchors,
      children: (
        <>
          {children ?? messages.unknownBlock({ type: blockType })}
          {Object.entries(slots).map(([name, slot]) => (
            <div key={name} data-editor-slot={name}>
              {slot}
            </div>
          ))}
        </>
      ),
    },
    state: { blockId, blockType },
  });
}
