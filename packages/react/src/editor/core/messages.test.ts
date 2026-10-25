import { describe, expect, it } from 'vitest';

import {
  ariaKeyShortcut,
  EN_MESSAGES,
  formatIssue,
  formatShortcut,
  mergeMessages,
} from './messages';

describe('messages', () => {
  it('merges partial catalogs deeply, later ones winning', () => {
    const merged = mergeMessages(
      EN_MESSAGES,
      { parts: { dragHandle: 'Ziehen' } },
      {
        parts: { inlineText: 'Text bearbeiten' },
        commands: { 'history.undo': 'Rückgängig' },
      },
    );
    expect(merged.parts.dragHandle).toBe('Ziehen');
    expect(merged.parts.inlineText).toBe('Text bearbeiten');
    expect(merged.parts.framePreview).toBe('Preview');
    expect(merged.commands['history.undo']).toBe('Rückgängig');
    expect(merged.commands['history.redo']).toBe('Redo');
    expect(EN_MESSAGES.parts.dragHandle).toBe('Drag to move');
  });

  it('formats field, structure and schema findings', () => {
    expect(
      formatIssue({ code: 'minItems', path: [], params: { min: 2 } }),
    ).toBe('Must have at least 2 item(s).');
    expect(
      formatIssue({
        code: 'slotMax',
        path: ['a'],
        params: { max: 3 },
        severity: 'error',
      }),
    ).toBe('Takes at most 3 block(s).');
    expect(
      formatIssue({
        code: 'schema',
        path: ['a', 'title'],
        params: { message: 'Too short' },
        severity: 'error',
      }),
    ).toBe('Too short');
    const de = mergeMessages(EN_MESSAGES, {
      field: { required: () => 'Pflichtfeld.' },
    });
    expect(formatIssue({ code: 'required', path: [] }, de)).toBe(
      'Pflichtfeld.',
    );
  });

  it('labels shortcuts per platform and catalog', () => {
    expect(formatShortcut('Mod+Shift+z', { platform: 'apple' })).toBe('⌘⇧Z');
    expect(formatShortcut('Mod+Shift+z', { platform: 'other' })).toBe(
      'Ctrl+Shift+Z',
    );
    const de = mergeMessages(EN_MESSAGES, {
      keys: { other: { mod: 'Strg', ctrl: 'Strg', shift: 'Umschalt' } },
    });
    expect(
      formatShortcut('Mod+Shift+z', { platform: 'other', messages: de }),
    ).toBe('Strg+Umschalt+Z');
    expect(ariaKeyShortcut('Mod+Shift+z', 'apple')).toBe('Meta+Shift+Z');
    expect(ariaKeyShortcut('Mod+Shift+z', 'other')).toBe('Control+Shift+Z');
  });
});
