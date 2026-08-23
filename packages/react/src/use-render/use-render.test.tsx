// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RenderState } from './index';

import {
  composeRefs,
  getStateAttributes,
  mergeProps,
  useRender,
} from './index';

afterEach(cleanup);

type ProbeState = RenderState & {
  open?: boolean;
  count?: number;
  variant?: string;
};

function Probe(props: {
  render?: Parameters<typeof useRender>[0]['render'];
  state?: ProbeState;
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  stateAttributesMapping?: Parameters<
    typeof useRender
  >[0]['stateAttributesMapping'];
}) {
  const { render: renderProp, state, className, ref, onClick, ...rest } = props;
  return useRender({
    defaultTagName: 'button',
    render: renderProp,
    state,
    props: { className, ref, onClick, ...rest },
    stateAttributesMapping: props.stateAttributesMapping,
  });
}

describe('useRender: default tag', () => {
  it('renders defaultTagName with props', () => {
    const { getByTestId } = render(
      <Probe className="foo" data-testid="probe" />,
    );
    const el = getByTestId('probe');
    expect(el.tagName).toBe('BUTTON');
    expect(el.className).toBe('foo');
  });

  it('maps boolean state true to a present empty-string attribute', () => {
    const { getByTestId } = render(
      <Probe data-testid="probe" state={{ open: true }} />,
    );
    expect(getByTestId('probe').getAttribute('data-open')).toBe('');
  });

  it('maps boolean state false to an absent attribute', () => {
    const { getByTestId } = render(
      <Probe data-testid="probe" state={{ open: false }} />,
    );
    expect(getByTestId('probe').hasAttribute('data-open')).toBe(false);
  });

  it('stringifies non-boolean state values', () => {
    const { getByTestId } = render(
      <Probe data-testid="probe" state={{ count: 3 }} />,
    );
    expect(getByTestId('probe').getAttribute('data-count')).toBe('3');
  });

  it('stateAttributesMapping override wins over the default mapping', () => {
    const { getByTestId } = render(
      <Probe
        data-testid="probe"
        state={{ variant: 'primary' }}
        stateAttributesMapping={{
          variant: (value) => ({ 'data-kind': `custom-${String(value)}` }),
        }}
      />,
    );
    const el = getByTestId('probe');
    expect(el.getAttribute('data-kind')).toBe('custom-primary');
    expect(el.hasAttribute('data-variant')).toBe(false);
  });
});

describe('useRender: render as element', () => {
  it('clones the element and merges className', () => {
    const { getByTestId } = render(
      <Probe
        className="base"
        data-testid="probe"
        render={<a className="extra" href="#" />}
      />,
    );
    const el = getByTestId('probe');
    expect(el.tagName).toBe('A');
    expect(el.className).toBe('base extra');
  });

  it('merges style from both sources', () => {
    function StyledProbe() {
      return useRender({
        defaultTagName: 'button',
        props: {
          style: { color: 'red' },
          'data-testid': 'probe',
        } as React.ComponentPropsWithRef<'button'>,
        render: <button style={{ background: 'blue' }} />,
      });
    }
    const { getByTestId } = render(<StyledProbe />);
    const el = getByTestId('probe') as HTMLButtonElement;
    expect(el.style.color).toBe('red');
    expect(el.style.background).toBe('blue');
  });

  it('composes refs so both refs receive the node', () => {
    const internalRef = vi.fn();
    const consumerRef = vi.fn();
    function RefProbe() {
      return useRender({
        defaultTagName: 'button',
        props: {
          ref: internalRef,
          'data-testid': 'probe',
        } as React.ComponentPropsWithRef<'button'>,
        render: <button ref={consumerRef} />,
      });
    }
    render(<RefProbe />);
    expect(internalRef).toHaveBeenCalledTimes(1);
    expect(consumerRef).toHaveBeenCalledTimes(1);
    expect(internalRef.mock.calls[0]?.[0]).toBe(consumerRef.mock.calls[0]?.[0]);
  });

  it('runs the consumer handler first; internal handler skipped on preventDefault', () => {
    const internalOnClick = vi.fn();
    const consumerOnClick = vi.fn((event: React.MouseEvent) =>
      event.preventDefault(),
    );
    function ClickProbe() {
      return useRender({
        defaultTagName: 'button',
        props: {
          onClick: internalOnClick,
          'data-testid': 'probe',
        } as React.ComponentPropsWithRef<'button'>,
        render: <button onClick={consumerOnClick} />,
      });
    }
    const { getByTestId } = render(<ClickProbe />);
    getByTestId('probe').dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(consumerOnClick).toHaveBeenCalledTimes(1);
    expect(internalOnClick).not.toHaveBeenCalled();
  });
});

describe('useRender: render as function', () => {
  it('receives (props, state) with element-typed props (no cast needed)', () => {
    function FunctionProbe() {
      return useRender({
        defaultTagName: 'button',
        state: { open: true },
        render: (props, state) => (
          <button {...props} type="button" data-was-open={String(state.open)} />
        ),
        props: {
          'data-testid': 'probe',
        } as React.ComponentPropsWithRef<'button'>,
      });
    }
    const { getByTestId } = render(<FunctionProbe />);
    const el = getByTestId('probe');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.getAttribute('data-was-open')).toBe('true');
    expect(el.getAttribute('data-open')).toBe('');
  });
});

describe('mergeProps', () => {
  it('skips undefined sources', () => {
    const result = mergeProps<'button'>(undefined, { className: 'a' });
    expect(result.className).toBe('a');
  });

  it('lets a later source win for plain props', () => {
    const result = mergeProps<'button'>({ id: 'first' }, { id: 'second' });
    expect(result.id).toBe('second');
  });

  it('composes event handlers consumer-first', () => {
    const calls: string[] = [];
    const internal = () => calls.push('internal');
    const consumer = () => calls.push('consumer');
    const result = mergeProps<'button'>(
      { onClick: internal },
      { onClick: consumer },
    );
    (result.onClick as (event: unknown) => void)({
      defaultPrevented: false,
    });
    expect(calls).toEqual(['consumer', 'internal']);
  });
});

describe('composeRefs', () => {
  it('forwards the value to a callback ref and an object ref', () => {
    const callback = vi.fn();
    const objectRef = React.createRef<HTMLDivElement>();
    const composed = composeRefs<HTMLDivElement>(callback, objectRef);
    const node = document.createElement('div');
    composed?.(node);
    expect(callback).toHaveBeenCalledWith(node);
    expect(objectRef.current).toBe(node);
  });

  it('returns undefined when every ref is falsy', () => {
    expect(composeRefs(undefined, undefined)).toBeUndefined();
  });
});

describe('getStateAttributes', () => {
  it('maps the slot state key to data-slot', () => {
    const attributes = getStateAttributes({ slot: 'trigger' });
    expect(attributes['data-slot']).toBe('trigger');
  });
});
