export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' as const;

export type GlyphLetter = (typeof ALPHABET)[number];

export const GLYPH_BOX_SIZE = 100;

export interface GlyphDefinition {
  readonly letter: GlyphLetter;
  readonly width: number;
  readonly height: number;
  readonly paths: readonly string[];
}

function makeGlyph(letter: GlyphLetter, ...paths: string[]): GlyphDefinition {
  return Object.freeze({
    letter,
    width: GLYPH_BOX_SIZE,
    height: GLYPH_BOX_SIZE,
    paths: Object.freeze(paths),
  });
}

export const GLYPHS: Readonly<Record<GlyphLetter, GlyphDefinition>> = Object.freeze({
  A: makeGlyph('A', 'M 10 100 L 50 0 L 90 100', 'M 28 62 L 72 62'),
  B: makeGlyph(
    'B',
    'M 15 0 L 15 100',
    'M 15 0 L 55 0 Q 85 0 85 25 Q 85 50 55 50 L 15 50',
    'M 55 50 Q 90 50 90 75 Q 90 100 55 100 L 15 100',
  ),
  C: makeGlyph('C', 'M 90 20 Q 75 0 50 0 Q 10 0 10 50 Q 10 100 50 100 Q 75 100 90 80'),
  D: makeGlyph('D', 'M 15 0 L 15 100 L 45 100 Q 90 100 90 50 Q 90 0 45 0 L 15 0'),
  E: makeGlyph('E', 'M 85 0 L 15 0 L 15 100 L 85 100', 'M 15 50 L 70 50'),
  F: makeGlyph('F', 'M 85 0 L 15 0 L 15 100', 'M 15 50 L 70 50'),
  G: makeGlyph('G', 'M 90 20 Q 75 0 50 0 Q 10 0 10 50 Q 10 100 50 100 Q 85 100 90 75 L 90 55 L 55 55'),
  H: makeGlyph('H', 'M 15 0 L 15 100', 'M 85 0 L 85 100', 'M 15 50 L 85 50'),
  I: makeGlyph('I', 'M 50 0 L 50 100', 'M 25 0 L 75 0', 'M 25 100 L 75 100'),
  J: makeGlyph('J', 'M 70 0 L 70 70 Q 70 100 45 100 Q 20 100 15 75'),
  K: makeGlyph('K', 'M 15 0 L 15 100', 'M 85 0 L 15 55', 'M 15 55 L 90 100'),
  L: makeGlyph('L', 'M 15 0 L 15 100 L 85 100'),
  M: makeGlyph('M', 'M 10 100 L 10 0 L 50 55 L 90 0 L 90 100'),
  N: makeGlyph('N', 'M 15 100 L 15 0 L 85 100 L 85 0'),
  O: makeGlyph('O', 'M 50 0 Q 10 0 10 50 Q 10 100 50 100 Q 90 100 90 50 Q 90 0 50 0 Z'),
  P: makeGlyph('P', 'M 15 100 L 15 0 L 55 0 Q 90 0 90 30 Q 90 60 55 60 L 15 60'),
  Q: makeGlyph(
    'Q',
    'M 50 0 Q 10 0 10 50 Q 10 100 50 100 Q 90 100 90 50 Q 90 0 50 0 Z',
    'M 65 70 L 92 100',
  ),
  R: makeGlyph(
    'R',
    'M 15 100 L 15 0 L 55 0 Q 90 0 90 30 Q 90 60 55 60 L 15 60',
    'M 55 60 L 90 100',
  ),
  S: makeGlyph('S', 'M 85 20 Q 75 0 50 0 Q 15 0 15 25 Q 15 47 50 50 Q 85 53 85 75 Q 85 100 50 100 Q 25 100 15 80'),
  T: makeGlyph('T', 'M 10 0 L 90 0', 'M 50 0 L 50 100'),
  U: makeGlyph('U', 'M 15 0 L 15 65 Q 15 100 50 100 Q 85 100 85 65 L 85 0'),
  V: makeGlyph('V', 'M 10 0 L 50 100 L 90 0'),
  W: makeGlyph('W', 'M 5 0 L 25 100 L 50 35 L 75 100 L 95 0'),
  X: makeGlyph('X', 'M 10 0 L 90 100', 'M 90 0 L 10 100'),
  Y: makeGlyph('Y', 'M 10 0 L 50 50 L 90 0', 'M 50 50 L 50 100'),
  Z: makeGlyph('Z', 'M 15 0 L 85 0 L 15 100 L 85 100'),
});

const UPPERCASE_LETTER = /^[A-Z]$/;

export function getGlyph(letter: string): GlyphDefinition | undefined {
  const normalized = letter.toUpperCase();
  return UPPERCASE_LETTER.test(normalized) ? GLYPHS[normalized as GlyphLetter] : undefined;
}

export function glyphPath(letter: string): string | undefined {
  return getGlyph(letter)?.paths.join(' ');
}
