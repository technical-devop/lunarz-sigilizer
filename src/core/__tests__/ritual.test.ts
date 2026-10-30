import { describe, expect, it } from 'vitest';

import { composeSigilVariants, seedFromLetters } from '../compose';
import { compositionToExportSvg, SIGIL_BACKGROUND, SIGIL_STROKE } from '../svg';
import { processIntention } from '../intention';

describe('ritual integration: intention to export', () => {
  it('turns a plain intention into kept letters, three prototype variants, and matching SVG', () => {
    const intention = processIntention('sleep through the whole night');
    expect(intention.letters.length).toBeGreaterThan(0);

    const compositions = composeSigilVariants(intention, 0);
    expect(compositions).toHaveLength(3);
    expect(new Set(compositions.map((composition) => composition.seed)).size).toBe(3);

    for (const composition of compositions) {
      expect(composition.letters.map((letter) => letter.letter)).toEqual(
        intention.letters,
      );
      expect(composition.isEmpty).toBe(false);
    }

    const first = compositions[0]!;
    const svg = compositionToExportSvg(first);
    expect(svg.match(/<path /g)).toHaveLength(first.letters.length);
    expect(svg).toContain(`stroke="${SIGIL_STROKE}"`);
    expect(svg).toContain(`stop-color="${SIGIL_BACKGROUND}"`);
    expect(svg).not.toContain('data-seed');
    expect(svg).not.toContain('data-source-index');
    expect(svg).not.toContain('data-surviving-index');
    expect(first.letters[0]).toHaveProperty('sourceIndex');
    expect(first.letters[0]).toHaveProperty('survivingIndex');
    expect(typeof first.seed).toBe('string');
    expect(first.seed.length).toBeGreaterThan(0);
  });

  it('regenerates with the same letters but new arrangements', () => {
    const intention = processIntention('Lunarz Sigilizer');
    const firstRound = composeSigilVariants(intention, 0);
    const secondRound = composeSigilVariants(intention, 1);

    expect(secondRound[0]!.letters.map((letter) => letter.letter)).toEqual(
      intention.letters,
    );
    expect(secondRound[0]!.seed).not.toBe(firstRound[0]!.seed);
    expect(JSON.stringify(secondRound[0]!.letters)).not.toBe(
      JSON.stringify(firstRound[0]!.letters),
    );
  });

  it('treats spaces and punctuation as quiet set-aside, never as letters', () => {
    const intention = processIntention('rest now, softly.');
    expect(intention.unsupported.map((entry) => entry.reason)).toContain('whitespace');
    expect(intention.unsupported.map((entry) => entry.reason)).toContain('punctuation');
    expect(intention.letters).not.toContain(' ');
    const compositions = composeSigilVariants(intention, 0);
    for (const composition of compositions) {
      expect(composition.isEmpty).toBe(false);
      expect(
        composition.letters.every((letter) => /^[B-DF-HJ-NP-TV-Z]$/u.test(letter.letter)),
      ).toBe(true);
    }
  });

  it('names unsupported Unicode explicitly while keeping positions intact', () => {
    const intention = processIntention('café 🔯 calm');
    expect(intention.unsupported).toContainEqual({
      char: 'é',
      index: 3,
      codePoint: 233,
      reason: 'non-ascii',
    });
    expect(intention.characters.map((character) => character.char).join('')).toBe(
      'café 🔯 calm',
    );
    expect(intention.letters).toEqual(['C', 'F', 'L', 'M']);
  });

  it('gives explicit, empty-safe feedback for empty and all-vowel input', () => {
    for (const input of ['', 'AEIOU']) {
      const intention = processIntention(input);
      expect(intention.letters).toEqual([]);
      expect(intention.isEmpty).toBe(true);
      expect(composeSigilVariants(intention, 0)).toEqual([]);
      expect(
        compositionToExportSvg({
          seed: seedFromLetters([]).toString(),
          width: 512,
          height: 512,
          letters: [],
          isEmpty: true,
          spineSurvivingIndex: null,
          connections: [],
          searchStats: {
            maxCandidatesPerLetter: 150,
            candidatesEvaluated: 0,
            acceptedConnections: 0,
          },
          variant: 'size-spine',
          variantName: '',
          scaleRecipe: '',
          canvasScale: 1,
        }),
      ).not.toContain('<path ');
    }
  });

  it('keeps letter metadata through composition for source highlighting', () => {
    const intention = processIntention('BANANA');
    expect(intention.letters).toEqual(['B', 'N']);
    const composition = composeSigilVariants(intention, 0)[0]!;
    expect(composition.letters.map((letter) => letter.sourceIndex)).toEqual([0, 2]);
    expect(composition.letters.map((letter) => letter.survivingIndex)).toEqual([0, 1]);
    expect(composition.letters.map((letter) => letter.glyphId)).toEqual(['B', 'N']);
  });
});
