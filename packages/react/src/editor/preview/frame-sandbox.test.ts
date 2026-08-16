import { describe, expect, it } from 'vitest';

import { frameSandboxAttribute } from './frame-sandbox';

describe('frameSandboxAttribute', () => {
  it('defaults to an empty string', () => {
    expect(frameSandboxAttribute(false)).toBe('');
    expect(frameSandboxAttribute(false, undefined)).toBe('');
  });

  it('adds allow-same-origin when selectable', () => {
    expect(frameSandboxAttribute(true)).toBe('allow-same-origin');
  });

  it('strips allow-scripts from the consumer value', () => {
    expect(frameSandboxAttribute(false, 'allow-scripts')).toBe('');
    expect(frameSandboxAttribute(true, 'allow-scripts allow-popups')).toBe(
      'allow-popups allow-same-origin',
    );
  });

  it('strips allow-forms and allow-top-navigation', () => {
    expect(
      frameSandboxAttribute(
        false,
        'allow-forms allow-popups allow-top-navigation',
      ),
    ).toBe('allow-popups');
    expect(
      frameSandboxAttribute(false, 'allow-top-navigation-by-user-activation'),
    ).toBe('');
  });

  it('does not duplicate allow-same-origin when selectable', () => {
    expect(frameSandboxAttribute(true, 'allow-same-origin')).toBe(
      'allow-same-origin',
    );
    expect(frameSandboxAttribute(true, 'allow-popups allow-same-origin')).toBe(
      'allow-popups allow-same-origin',
    );
  });
});
