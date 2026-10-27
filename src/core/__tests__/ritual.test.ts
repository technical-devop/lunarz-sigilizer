import { describe, expect, it } from 'vitest';

import { composeSigil, seedFromLetters } from '../compose';
import { compositionToExportSvg, SIGIL_BACKGROUND, SIGIL_STROKE } from '../svg';
import { processIntention } from '../intention';

function distinctVariantSeeds(letters: readonly string[], regen: number): number[] {
  const base = seedFromLetters(letters);
  return [0, 1, 2].map((slot) => (base + regen * 7919 + slot * 0x9e3779b9) >>> 0);
}

describe('ritual integration: intention to export', () => {
  it('turns a plain intention into kept letters, three distinct variants, and matching SVG', () => {
    const intention = processIntention('sleep through the whole night');
    expect(intention.letters.length).toBeGreaterThan(0);

    const seeds = distinctVariantSeeds(intention.letters, 0);
    expect(new Set(seeds).size).toBe(3);

    const compositions = seeds.map((seed) => composeSigil(intention, { seed }));
    for (const composition of compositions) {
      expect(composition.letters.map((letter) => letter.letter)).toEqual(intention.letters);
      expect(composition.isEmpty).toBe(false);
    }

    const transforms = compositions.map((composition) =>
      JSON.stringify(composition.letters.map((letter) => letter.transform)),
    );
    expect(new Set(transforms).size).toBe(3);

    const first = compositions[0]!;
    const svg = compositionToExportSvg(first);
    expect(svg.match(/<path /g)).toHaveLength(first.letters.length);
    // Export stays clean: geometry + shared colors only, metadata lives in memory.
    expect(svg).toContain(`stroke="${SIGIL_STROKE}"`);
    expect(svg).toContain(`stop-color="${SIGIL_BACKGROUND}"`);
    expect(svg).not.toContain('data-seed');
    expect(svg).not.toContain('data-source-index');
    expect(svg).not.toContain('data-surviving-index');
    expect(first.letters[0]).toHaveProperty('sourceIndex');
    expect(first.letters[0]).toHaveProperty('survivingIndex');
    expect(first).toHaveProperty('seed');
  });

  it('regenerates with the same letters but new arrangements', () => {
    const intention = processIntention('Lunarz Sigilizer');
    const firstRound = distinctVariantSeeds(intention.letters, 0).map((seed) =>
      composeSigil(intention, { seed }),
    );
    const secondRound = distinctVariantSeeds(intention.letters, 1).map((seed) =>
      composeSigil(intention, { seed }),
    );

    expect(secondRound[0]!.letters.map((letter) => letter.letter)).toEqual(intention.letters);
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
    const composition = composeSigil(intention, { seed: 7 });
    expect(composition.isEmpty).toBe(false);
    expect(composition.letters.every((letter) => /^[B-DF-HJ-NP-TV-Z]$/u.test(letter.letter))).toBe(
      true,
    );
  });

  it('names unsupported Unicode explicitly while keeping positions intact', () => {
    const intention = processIntention('café 🔯 calm');
    expect(intention.unsupported).toContainEqual({
      char: 'é',
      index: 3,
      codePoint: 233,
      reason: 'non-ascii',
    });
    expect(intention.characters.map((character) => character.char).join('')).toBe('café 🔯 calm');
    expect(intention.letters).toEqual(['C', 'F', 'L', 'M']);
  });

  it('gives explicit, empty-safe feedback for empty and all-vowel input', () => {
    for (const input of ['', 'AEIOU vowels']) {
      const intention = processIntention(input === '' ? '' : 'AEIOU');
      expect(intention.letters).toEqual([]);
      expect(intention.isEmpty).toBe(true);
      const composition = composeSigil(intention, { seed: 1 });
      expect(composition.isEmpty).toBe(true);
      expect(composition.letters).toEqual([]);
      expect(compositionToExportSvg(composition)).not.toContain('<path ');
    }
  });

  it('keeps letter metadata through composition for source highlighting', () => {
    const intention = processIntention('BANANA');
    expect(intention.letters).toEqual(['B', 'N']);
    const composition = composeSigil(intention, { seed: 42 });
    expect(composition.letters.map((letter) => letter.sourceIndex)).toEqual([0, 2]);
    expect(composition.letters.map((letter) => letter.survivingIndex)).toEqual([0, 1]);
    expect(composition.letters.map((letter) => letter.glyphId)).toEqual(['B', 'N']);
  });
});
