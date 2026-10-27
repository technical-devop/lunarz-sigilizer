import { describe, expect, it } from 'vitest';

import { ALPHABET, GLYPHS, GLYPH_BOX_SIZE, getGlyph, glyphPath } from '../glyphs';

const SURVIVING_CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';

describe('glyph library', () => {
  it('defines vector glyphs for every letter that can survive intention processing', () => {
    for (const letter of SURVIVING_CONSONANTS) {
      const glyph = getGlyph(letter);

      expect(glyph, letter).toBeDefined();
      expect(glyph?.letter).toBe(letter);
      expect(glyph?.width).toBe(GLYPH_BOX_SIZE);
      expect(glyph?.height).toBe(GLYPH_BOX_SIZE);
      expect(glyph?.paths.length).toBeGreaterThan(0);
    }
  });

  it('covers the full alphabet with non-empty SVG path data', () => {
    expect(Object.keys(GLYPHS)).toHaveLength(ALPHABET.length);

    for (const letter of ALPHABET) {
      const glyph = GLYPHS[letter]!;

      expect(glyph.letter).toBe(letter);
      expect(glyph.paths.length).toBeGreaterThan(0);

      for (const path of glyph.paths) {
        expect(path.length).toBeGreaterThan(0);
        expect(path.startsWith('M ')).toBe(true);
      }
    }
  });

  it('resolves letters case-insensitively to the same immutable glyph definition', () => {
    expect(getGlyph('s')).toBe(GLYPHS.S);
    expect(getGlyph('S')).toBe(GLYPHS.S);
    expect(Object.isFrozen(GLYPHS.S!)).toBe(true);
    expect(Object.isFrozen(GLYPHS.S!.paths)).toBe(true);
  });

  it('rejects non-letters and multi-character input', () => {
    for (const value of ['', '1', '!', 'AB', '😀', 'ß']) {
      expect(getGlyph(value)).toBeUndefined();
    }
  });

  it('joins every stroke of a glyph into one path document', () => {
    expect(glyphPath('B')).toBe(GLYPHS.B!.paths.join(' '));
    expect(glyphPath('b')).toBe(GLYPHS.B!.paths.join(' '));
    expect(glyphPath('1')).toBeUndefined();
  });
});
