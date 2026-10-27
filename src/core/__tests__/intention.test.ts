import { describe, expect, it } from 'vitest';

import { processIntention } from '../intention';

describe('processIntention', () => {
  it('removes vowels before de-duplicating and preserves first occurrence order', () => {
    const result = processIntention('BANANA');

    expect(result.letters).toEqual(['B', 'N']);
    expect(result.characters.map((character) => character.classification)).toEqual([
      'kept',
      'vowel',
      'kept',
      'vowel',
      'duplicate',
      'vowel',
    ]);
    expect(result.characters[4]?.normalized).toBe('N');
    expect(result.characters[4]?.duplicateOf).toBe(2);
    expect(result.isEmpty).toBe(false);
  });

  it('classifies vowels and duplicates case-insensitively while emitting uppercase letters', () => {
    const result = processIntention('bBaA');

    expect(result.letters).toEqual(['B']);
    expect(result.characters.map((character) => character.normalized)).toEqual(['B', 'B', 'A', 'A']);
    expect(result.characters.map((character) => character.classification)).toEqual([
      'kept',
      'duplicate',
      'vowel',
      'vowel',
    ]);
    expect(result.characters[1]?.duplicateOf).toBe(0);
  });

  it('reports unsupported ASCII and Unicode characters with exact reasons and positions', () => {
    const result = processIntention('B 2!é');

    expect(result.letters).toEqual(['B']);
    expect(result.unsupported).toEqual([
      { char: ' ', index: 1, codePoint: 32, reason: 'whitespace' },
      { char: '2', index: 2, codePoint: 50, reason: 'digit' },
      { char: '!', index: 3, codePoint: 33, reason: 'punctuation' },
      { char: 'é', index: 4, codePoint: 233, reason: 'non-ascii' },
    ]);
    expect(result.characters.filter((character) => character.classification === 'unsupported')).toHaveLength(4);
  });

  it('iterates by code point so astral characters are reported whole and do not shift indices', () => {
    const result = processIntention('A😀B');

    expect(result.characters).toHaveLength(3);
    expect(result.characters.map((character) => character.index)).toEqual([0, 1, 2]);
    expect(result.letters).toEqual(['B']);
    expect(result.unsupported).toEqual([
      { char: '😀', index: 1, codePoint: 0x1f600, reason: 'non-ascii' },
    ]);
  });

  it('does not silently transliterate composed or decomposed Unicode', () => {
    const composed = processIntention('café');
    expect(composed.letters).toEqual(['C', 'F']);
    expect(composed.unsupported).toEqual([
      { char: 'é', index: 3, codePoint: 233, reason: 'non-ascii' },
    ]);

    const decomposed = processIntention('cafe\u0301');
    expect(decomposed.letters).toEqual(['C', 'F']);
    expect(decomposed.unsupported).toEqual([
      { char: '\u0301', index: 4, codePoint: 0x0301, reason: 'combining-mark' },
    ]);
  });

  it('returns an explicit empty result for empty and all-vowel input', () => {
    for (const input of ['', 'AEIOU', 'aeiou']) {
      const result = processIntention(input);

      expect(result.letters).toEqual([]);
      expect(result.isEmpty).toBe(true);
      expect(result.unsupported).toEqual([]);
    }
  });

  it('keeps unsupported diagnostics when no letters survive', () => {
    const result = processIntention('123 你好');

    expect(result.letters).toEqual([]);
    expect(result.isEmpty).toBe(true);
    expect(result.characters).toHaveLength(6);
    expect(result.unsupported.map((entry) => entry.reason)).toEqual([
      'digit',
      'digit',
      'digit',
      'whitespace',
      'non-ascii',
      'non-ascii',
    ]);
  });

  it('accounts for every input code point exactly once', () => {
    const input = 'LUNARZ🔯 Sigilizer!';
    const result = processIntention(input);

    expect(result.characters.map((character) => character.char).join('')).toBe(input);
    expect(result.characters).toHaveLength(Array.from(input).length);
  });

  it('classifies control characters separately from punctuation', () => {
    const result = processIntention('\u0000B\u007f');

    expect(result.letters).toEqual(['B']);
    expect(result.unsupported).toEqual([
      { char: '\u0000', index: 0, codePoint: 0, reason: 'control' },
      { char: '\u007f', index: 2, codePoint: 127, reason: 'control' },
    ]);
  });
});
