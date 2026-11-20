import { checkServer, mount } from '@ui-sdk/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { editorChrome } from '../../../../../registry/ui-sdk/editor-chrome';

const markup = `<root aria-label="Page editor"><surface></surface></root>`;

let view: ReturnType<typeof mount<typeof editorChrome>> | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

const open = (
  options: Parameters<typeof mount<typeof editorChrome>>[1] = {},
) => {
  view = mount(editorChrome, options, markup);
  return view;
};

describe('editor chrome primitive', () => {
  it('shows and hides a docked panel whole', () => {
    const onPanelsChange = vi.fn();
    const v = open({ onPanelsChange });
    expect(v.api.togglePanel('left', { reason: 'press' })).toBe(true);
    expect(v.state.panels).toEqual({ left: false, right: true });
    expect(onPanelsChange).toHaveBeenLastCalledWith(
      { left: false, right: true },
      expect.objectContaining({ reason: 'press' }),
    );
    v.api.togglePanel('left');
    expect(v.state.panels.left).toBe(true);
  });

  it('has no panels on a phone, and the inspector is a sheet on a tablet', () => {
    const phone = open({ layout: 'phone' });
    expect(phone.api.togglePanel('left')).toBe(false);
    expect(phone.state.panels.left).toBe(true);
    phone.unmount();
    const tablet = open({ layout: 'tablet' });
    tablet.api.togglePanel('right');
    expect(tablet.state.sheet).toBe('props');
    expect(tablet.state.panels.right).toBe(true);
    tablet.api.togglePanel('right');
    expect(tablet.state.sheet).toBeNull();
  });

  it('adds a block through the palette, the add sheet on a phone, never in form mode', () => {
    const desktop = open();
    desktop.api.addBlock();
    expect(desktop.state.palette).toBe('add');
    desktop.unmount();
    const phone = open({ layout: 'phone' });
    phone.api.addBlock();
    expect(phone.state.sheet).toBe('add');
    expect(phone.state.palette).toBeNull();
    phone.unmount();
    const form = open({ mode: 'form' });
    expect(form.api.addBlock()).toBe(false);
    expect(form.state.palette).toBeNull();
  });

  it('saves only a dirty document, through the commit dialog when it needs a message', async () => {
    const onSave = vi.fn(async () => {});
    const clean = open({ onSave });
    expect(await clean.api.save()).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    clean.unmount();
    const dirty = open({ onSave, dirty: true });
    expect(await dirty.api.save()).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
    dirty.unmount();
    const message = open({ onSave, dirty: true, requireCommitMessage: true });
    await message.api.save();
    expect(message.state.commitOpen).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('a controlled value changes only when the app passes it back', () => {
    const onDeviceChange = vi.fn();
    const v = open({ device: 'desktop', onDeviceChange });
    expect(v.api.setDevice('tablet')).toBe(true);
    expect(onDeviceChange).toHaveBeenCalledWith(
      'tablet',
      expect.objectContaining({ reason: 'imperative' }),
    );
    expect(v.state.device).toBe('desktop');
  });

  it('a change the app cancels stays out', () => {
    const v = open({
      onSheetChange: (_sheet, details) => details.cancel(),
      layout: 'phone',
    });
    expect(v.api.openSheet('outline')).toBe(false);
    expect(v.state.sheet).toBeNull();
  });

  it('refuses a device it does not know', () => {
    const v = open();
    expect(() => v.api.setDevice('watch' as never)).toThrow(/Unknown device/);
    expect(() => v.api.openSheet('drawer' as never)).toThrow(/Unknown sheet/);
    expect(() => v.api.togglePanel('top' as never)).toThrow(/Unknown panel/);
    expect(v.api.setDevice('tablet')).toBe(true);
    expect(v.state.device).toBe('tablet');
  });

  it('a phone sheet owns a history entry, and Back closes it', async () => {
    const v = open({ layout: 'phone' });
    const length = window.history.length;
    v.api.openSheet('outline');
    expect(window.history.length).toBe(length + 1);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(v.state.sheet).toBeNull();
    expect(v.changes.at(-1)).toMatchObject({ key: 'sheet', reason: 'back' });
  });

  it('a sheet opened right after another closed stays open', async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const v = open({ layout: 'phone' });
    v.api.openSheet('add');
    v.api.closeSheet();
    v.api.openSheet('outline');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(v.state.sheet).toBe('outline');
  });

  it('a change the app cancels for panels leaves them as they were', () => {
    const v = open({ onPanelsChange: (_panels, details) => details.cancel() });
    expect(v.api.setPanel('left', false)).toBe(false);
    expect(v.state.panels.left).toBe(true);
  });

  it('marks the mode and layout on the root and renders on the server', () => {
    const v = open({ mode: 'form', layout: 'tablet' });
    expect(v.root.dataset.mode).toBe('form');
    expect(v.root.dataset.layout).toBe('tablet');
    expect(v.part('surface')!.dataset.mode).toBe('form');
    expect(() =>
      checkServer(editorChrome, { mode: 'form' }, markup),
    ).not.toThrow();
  });
});
