import { describe, expect, it } from 'vitest';

import { ALPHABET, GLYPHS, GLYPH_BOX_SIZE, getGlyph, glyphPath } from '../glyphs';

const SURVIVING_CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';

describe('prototype glyph skeletons', () => {
  it('covers the full alphabet with the prototype unit-square coordinates', () => {
    expect(Object.keys(GLYPHS)).toHaveLength(ALPHABET.length);
    expect(GLYPH_BOX_SIZE).toBe(1);

    for (const letter of ALPHABET) {
      const glyph = GLYPHS[letter]!;
      expect(glyph.char).toBe(letter);
      expect(glyph.strokes.length).toBeGreaterThan(0);
      expect(glyph.anchors.length).toBeGreaterThan(0);
      expect(glyph.paths.length).toBe(glyph.strokes.length);

      const bounds = glyph.bounds;
      expect(bounds.minX).toBeGreaterThanOrEqual(0);
      expect(bounds.minY).toBeGreaterThanOrEqual(0);
      expect(bounds.maxX).toBeLessThanOrEqual(1.05);
      expect(bounds.maxY).toBeLessThanOrEqual(1.05);
    }
  });

  it('preserves the reference stroke coordinates for selected glyphs', () => {
    expect(GLYPHS.A!.strokes[0]!.points.map((point) => point.asList())).toEqual([
      [0.5, 0],
      [0.1, 1],
    ]);
    expect(GLYPHS.B!.strokes).toHaveLength(3);
    expect(GLYPHS.B!.strokes[1]!.points.map((point) => point.asList())).toEqual([
      [0.18, 0],
      [0.64, 0],
      [0.8, 0.14],
      [0.8, 0.31],
      [0.64, 0.45],
      [0.18, 0.45],
    ]);
    expect(GLYPHS.O!.strokes).toHaveLength(1);
    expect(GLYPHS.O!.strokes[0]!.closed).toBe(true);
    expect(GLYPHS.O!.strokes[0]!.points).toHaveLength(20);
    expect(GLYPHS.Q!.strokes).toHaveLength(2);
    expect(GLYPHS.Q!.strokes[1]!.points[0]!.asList()).toEqual([
      0.775065778,
      0.793892626,
    ]);
    expect(GLYPHS.X!.strokes).toHaveLength(2);
  });

  it('generates prototype anchors with endpoint, corner and segment kinds', () => {
    const glyph = GLYPHS.B!;
    const ids = glyph.anchors.map((anchor) => anchor.anchorId);

    expect(ids).toContain('B:0:e0');
    expect(ids).toContain('B:0:e1');
    expect(ids).toContain('B:1:c1');
    expect(ids).toContain('B:1:s0');
    expect(ids).toContain('B:2:s4');
    expect(glyph.anchors.every((anchor, index) => index === 0 || ids[index - 1]! <= anchor.anchorId)).toBe(
      true,
    );

    for (const anchor of glyph.anchors) {
      expect(anchor.tangent.norm()).toBeCloseTo(1, 12);
      expect(anchor.normal.norm()).toBeCloseTo(1, 12);
    }

    expect(GLYPHS.O!.anchors.some((anchor) => anchor.kind === 'segment')).toBe(true);
    expect(GLYPHS.O!.anchors.some((anchor) => anchor.kind === 'endpoint')).toBe(false);
  });

  it('resolves case-insensitively and rejects non-letters', () => {
    expect(getGlyph('b')).toBe(GLYPHS.B);
    expect(getGlyph('B')).toBe(GLYPHS.B);
    for (const value of ['', '1', '!', 'AB', '😀', 'ß']) {
      expect(getGlyph(value)).toBeUndefined();
    }
    for (const letter of SURVIVING_CONSONANTS) {
      expect(getGlyph(letter), letter).toBeDefined();
    }
  });

  it('joins every stroke into path data, closing the closed prototype strokes', () => {
    expect(glyphPath('B')).toBe(GLYPHS.B!.paths.join(' '));
    expect(glyphPath('b')).toBe(GLYPHS.B!.paths.join(' '));
    expect(glyphPath('O')).toContain('Z');
    expect(glyphPath('1')).toBeUndefined();
  });
});
