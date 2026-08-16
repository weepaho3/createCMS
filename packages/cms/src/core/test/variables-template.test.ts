import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as root from '../../index';
import * as client from '../../react/index';
import {
  extractVariableKeys as legacyExtractVariableKeys,
  resolveTemplateString as legacyResolveTemplateString,
  VAR_PATTERN as legacyVarPattern,
} from '../variables';
import {
  VAR_PATTERN,
  extractVariableKeys,
  extractVariableKeysFromProperties,
  resolveTemplateString,
} from '../variables-template';

describe('resolveTemplateString', () => {
  it('replaces a known key with its value', () => {
    expect(
      resolveTemplateString('Hello {{brand}}', new Map([['brand', 'Toerbo']])),
    ).toBe('Hello Toerbo');
  });

  it('leaves an unknown key literal', () => {
    expect(resolveTemplateString('Hi {{missing}}', new Map())).toBe(
      'Hi {{missing}}',
    );
  });

  it('replaces a repeated key everywhere', () => {
    expect(
      resolveTemplateString('{{a}}-{{a}}-{{a}}', new Map([['a', 'x']])),
    ).toBe('x-x-x');
  });

  it('accepts keys with digits and underscores', () => {
    expect(
      resolveTemplateString('{{brand_2}}', new Map([['brand_2', 'two']])),
    ).toBe('two');
  });

  it('does not treat a spaced token as a variable', () => {
    expect(
      resolveTemplateString('{{ brand }}', new Map([['brand', 'Toerbo']])),
    ).toBe('{{ brand }}');
  });

  it('returns an empty string for an empty template', () => {
    expect(resolveTemplateString('', new Map([['a', 'x']]))).toBe('');
  });

  it('gives the same result on consecutive calls', () => {
    const vars = new Map([['a', 'x']]);
    expect(resolveTemplateString('{{a}} {{a}}', vars)).toBe('x x');
    expect(resolveTemplateString('{{a}} {{a}}', vars)).toBe('x x');
  });

  it('is unaffected by a manual test() on the shared regex', () => {
    VAR_PATTERN.test('{{x}}');
    expect(resolveTemplateString('{{a}}', new Map([['a', 'x']]))).toBe('x');
  });
});

describe('extractVariableKeys', () => {
  it('returns deduplicated keys in first-appearance order', () => {
    expect(extractVariableKeys('{{a}} and {{b}} and {{a}}')).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns an empty array without tokens', () => {
    expect(extractVariableKeys('plain text')).toEqual([]);
  });
});

describe('extractVariableKeysFromProperties', () => {
  it('maps only string properties that contain tokens', () => {
    const result = extractVariableKeysFromProperties({
      title: '{{a}} {{b}}',
      n: 3,
      x: 'plain',
    });
    expect(result).toEqual(new Map([['title', ['a', 'b']]]));
  });
});

describe('VAR_PATTERN', () => {
  it('is the global {{key}} regex', () => {
    expect(VAR_PATTERN).toBeInstanceOf(RegExp);
    expect(VAR_PATTERN.global).toBe(true);
    expect(VAR_PATTERN.source).toBe('\\{\\{(\\w+)\\}\\}');
  });
});

describe('module purity', () => {
  it('has no imports or requires in its source', () => {
    const source = readFileSync(
      new URL('../variables-template.ts', import.meta.url),
      'utf8',
    );
    const lines = source.split('\n');
    expect(lines.some((line) => line.startsWith('import '))).toBe(false);
    expect(lines.some((line) => line.includes('require('))).toBe(false);
  });
});

describe('entry points', () => {
  it('exposes the same function from the root, the client barrel and the server module', () => {
    expect(root.resolveTemplateString).toBe(resolveTemplateString);
    expect(client.resolveTemplateString).toBe(resolveTemplateString);
    expect(legacyResolveTemplateString).toBe(resolveTemplateString);

    expect(root.extractVariableKeys).toBe(extractVariableKeys);
    expect(client.extractVariableKeys).toBe(extractVariableKeys);
    expect(legacyExtractVariableKeys).toBe(extractVariableKeys);

    expect(root.VAR_PATTERN).toBe(VAR_PATTERN);
    expect(client.VAR_PATTERN).toBe(VAR_PATTERN);
    expect(legacyVarPattern).toBe(VAR_PATTERN);
  });
});
