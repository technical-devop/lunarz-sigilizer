import { describe, expect, it } from 'vitest';

import {
  composeSigil,
  composeSigilVariants,
  createSeededRandom,
  seedFromLetters,
  SIGIL_HEIGHT,
  SIGIL_WIDTH,
  variantSeeds,
} from '../compose';
import { processIntention } from '../intention';

const CONSONANT_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ';

describe('prototype composition adapter', () => {
  it('composes every surviving letter once, in order, with source identity', () => {
    const intention = processIntention('LUNARZ SIGILIZER 42!');
    const composition = composeSigil(intention, { seed: 12345 });

    expect(composition.letters.map((letter) => letter.letter)).toEqual([
      'L',
      'N',
      'R',
      'Z',
      'S',
      'G',
    ]);
    expect(composition.letters.map((letter) => letter.sourceIndex)).toEqual([
      0, 2, 4, 5, 7, 9,
    ]);
    expect(composition.letters.map((letter) => letter.survivingIndex)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(composition.isEmpty).toBe(false);
    expect(composition.variant).toBe('size-spine');
    expect(composition.spineSurvivingIndex).toBe(0);

    for (const letter of composition.letters) {
      expect(letter.glyphId).toBe(letter.letter);
      expect(letter.path).toBe(letter.path);
      expect(Number.isFinite(letter.transform.x)).toBe(true);
      expect(Number.isFinite(letter.transform.y)).toBe(true);
      expect(Number.isFinite(letter.transform.rotation)).toBe(true);
      expect(letter.transform.scale).toBeGreaterThan(0);
    }
  });

  it('uses spine-dominant for all three choices with a different spine each', () => {
    const intention = processIntention('I BUILD RESILIENT STRENGTH');
    const variants = composeSigilVariants(intention, 0);

    expect(variants).toHaveLength(3);
    expect(variants.map((composition) => composition.variant)).toEqual([
      'size-spine',
      'size-spine',
      'size-spine',
    ]);
    expect(variants.map((composition) => composition.variantName)).toEqual([
      'Spine Dominant',
      'Spine Dominant',
      'Spine Dominant',
    ]);
    expect(variants.map((composition) => composition.spineSurvivingIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(new Set(variants.map((composition) => composition.scaleRecipe)).size).toBe(1);
    expect(variants.map((composition) => composition.seed)).toEqual(
      variantSeeds(intention.letters, 0).map(String),
    );

    const keptSourceIndexes = intention.characters
      .filter((character) => character.classification === 'kept')
      .map((character) => character.index);

    for (const composition of variants) {
      expect(composition.letters.map((letter) => letter.letter)).toEqual(
        intention.letters,
      );
      expect(composition.letters.map((letter) => letter.sourceIndex)).toEqual(
        keptSourceIndexes,
      );
      expect(composition.letters.map((letter) => letter.survivingIndex)).toEqual(
        intention.letters.map((_, index) => index),
      );
      expect(composition.connections).toHaveLength(intention.letters.length - 1);
      expect(composition.searchStats.acceptedConnections).toBe(
        composition.connections.length,
      );
      expect(composition.connections.every((connection) => {
        return (
          connection.fromSurvivingIndex >= 0 &&
          connection.fromSurvivingIndex < intention.letters.length &&
          connection.toSurvivingIndex >= 0 &&
          connection.toSurvivingIndex < intention.letters.length &&
          connection.fromLetter === intention.letters[connection.fromSurvivingIndex] &&
          connection.toLetter === intention.letters[connection.toSurvivingIndex]
        );
      })).toBe(true);

      const spineScale =
        composition.letters[composition.spineSurvivingIndex!]!.transform.scale /
        composition.canvasScale;
      expect(spineScale).toBeCloseTo(1.22, 6);
    }

    const signatures = variants.map((composition) =>
      JSON.stringify(composition.letters.map((letter) => letter.transform)),
    );
    expect(new Set(signatures).size).toBe(3);

    const anchorSignatures = variants.map((composition) =>
      JSON.stringify(
        composition.connections.map((connection) => [
          connection.fromSegment,
          connection.toSegment,
        ]),
      ),
    );
    expect(new Set(anchorSignatures).size).toBe(3);
  });

  it('regenerates with the same letters but new seeds and arrangements', () => {
    const intention = processIntention('steady light');
    const first = composeSigilVariants(intention, 0);
    const second = composeSigilVariants(intention, 1);

    expect(second.map((composition) => composition.seed)).not.toEqual(
      first.map((composition) => composition.seed),
    );
    for (let slot = 0; slot < 3; slot += 1) {
      expect(second[slot]!.letters.map((letter) => letter.letter)).toEqual(
        intention.letters,
      );
      expect(
        JSON.stringify(second[slot]!.letters.map((letter) => letter.transform)),
      ).not.toBe(JSON.stringify(first[slot]!.letters.map((letter) => letter.transform)));
    }
  });

  it('is deterministic for the same seed and varies with a different seed', () => {
    const intention = processIntention('SIGIL');
    const first = composeSigil(intention, { seed: 777 });
    const second = composeSigil(intention, { seed: 777 });
    const other = composeSigil(intention, { seed: 778 });

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(other.seed).not.toBe(first.seed);
  });

  it('centers a single surviving letter deterministically', () => {
    for (const variantKey of ['size-spine', 'size-steps', 'size-anchor']) {
      const first = composeSigil(processIntention('K'), { seed: 5, variantKey });
      const second = composeSigil(processIntention('K'), { seed: 5, variantKey });

      expect(first.letters).toHaveLength(1);
      expect(first.letters[0]?.transform.labelX).toBeCloseTo(SIGIL_WIDTH / 2, 6);
      expect(first.letters[0]?.transform.labelY).toBeCloseTo(SIGIL_HEIGHT / 2, 6);
      expect(second.letters[0]?.transform).toEqual(first.letters[0]?.transform);
    }
  });

  it('keeps the first letter as the spine and the prototype scale recipe', () => {
    const intention = processIntention('BCDFGHJKLM');
    for (const [slot, variantKey] of [
      'size-spine',
      'size-steps',
      'size-anchor',
    ].entries()) {
      const composition = composeSigil(intention, {
        seed: variantSeeds(intention.letters, 0)[slot]!,
        variantKey,
      });
      const canvasScale = composition.canvasScale;
      const rawScales = composition.letters.map(
        (letter) => letter.transform.scale / canvasScale,
      );

      expect(composition.spineSurvivingIndex).toBe(0);
      if (variantKey === 'size-spine') {
        expect(rawScales[0]).toBeCloseTo(1.22, 6);
        expect(rawScales[1]).toBeCloseTo(0.705, 6);
      } else if (variantKey === 'size-steps') {
        expect(rawScales[0]).toBeCloseTo(1.22, 6);
        expect(rawScales[rawScales.length - 1]).toBeCloseTo(0.58, 6);
      } else {
        expect(rawScales[0]).toBeCloseTo(1.12, 6);
        expect(rawScales[rawScales.length - 1]).toBeCloseTo(0.92, 6);
      }
      expect(new Set(rawScales).size).toBeGreaterThan(1);
    }
  });

  it('derives a stable seed from surviving letters when no seed is supplied', () => {
    const fromMixedCase = composeSigil(processIntention('Sigil'));
    const fromConsonants = composeSigil(processIntention('sgl'));

    expect(fromMixedCase.seed).toBe(
      seedFromLetters(['S', 'G', 'L']).toString(),
    );
    expect(fromConsonants.seed).toBe(fromMixedCase.seed);
    expect(fromConsonants.letters.map((letter) => letter.transform)).toEqual(
      fromMixedCase.letters.map((letter) => letter.transform),
    );
  });

  it('never includes vowels or unsupported characters in a composition', () => {
    const composition = composeSigil(processIntention('B!A?C😀D'), { seed: 3 });

    expect(composition.letters.map((letter) => letter.letter)).toEqual([
      'B',
      'C',
      'D',
    ]);
  });

  it('returns an explicit empty composition when no letters survive', () => {
    for (const input of ['', 'AEIOU', '!!!', '你好']) {
      const composition = composeSigil(processIntention(input), { seed: 1 });

      expect(composition.isEmpty).toBe(true);
      expect(composition.letters).toEqual([]);
      expect(composition.width).toBe(SIGIL_WIDTH);
      expect(composition.height).toBe(SIGIL_HEIGHT);
    }
  });

  it('normalizes numeric seeds and rejects non-finite values', () => {
    const intention = processIntention('K');

    expect(composeSigil(intention, { seed: -1 }).seed).toBe('4294967295');
    expect(composeSigil(intention, { seed: 0x100000000 }).seed).toBe('0');
    expect(composeSigil(intention, { seed: '14759392546341412399' }).seed).toBe(
      '14759392546341412399',
    );
    expect(() => composeSigil(intention, { seed: Number.NaN })).toThrow(RangeError);
    expect(() =>
      composeSigil(intention, { seed: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });
});

describe('letter counts 1, 2, 11 and 21', () => {
  it(
    'composes 1, 2, 11 and 21 letters with exact joins',
    () => {
      for (const count of [1, 2, 11, 21]) {
        const phrase = CONSONANT_ALPHABET.slice(0, count);
        const intention = processIntention(phrase);
        const started = performance.now();
        const variants = composeSigilVariants(intention, 0);
        const elapsed = performance.now() - started;

        expect(variants).toHaveLength(3);
        expect(variants.map((composition) => composition.variant)).toEqual([
          'size-spine',
          'size-spine',
          'size-spine',
        ]);
        if (count >= 3) {
          expect(
            variants.map((composition) => composition.spineSurvivingIndex),
          ).toEqual([0, 1, 2]);
        }
        for (const composition of variants) {
          expect(composition.letters).toHaveLength(count);
          expect(composition.connections).toHaveLength(Math.max(0, count - 1));
          expect(composition.searchStats.acceptedConnections).toBe(
            composition.connections.length,
          );
          expect(
            composition.connections.every(
              (connection) =>
                connection.kind === 'shared' &&
                connection.overlapLength + 1e-9 >= 0.075,
            ),
          ).toBe(true);
        }
        expect(elapsed).toBeLessThan(30000);
      }
    },
    60000,
  );
});

describe('deterministic random source', () => {
  it('returns repeatable values in the unit interval', () => {
    const first = createSeededRandom(123);
    const second = createSeededRandom(123);
    const firstValues = Array.from({ length: 12 }, () => first());
    const secondValues = Array.from({ length: 12 }, () => second());

    expect(firstValues).toEqual(secondValues);
    expect(firstValues.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('returns a different sequence for a different seed', () => {
    const first = createSeededRandom(1);
    const second = createSeededRandom(2);

    expect(Array.from({ length: 8 }, () => first())).not.toEqual(
      Array.from({ length: 8 }, () => second()),
    );
  });
});

describe('seedFromLetters', () => {
  it('is stable and stays in the unsigned 32-bit range', () => {
    const seed = seedFromLetters(['L', 'N', 'R', 'Z']);

    expect(seed).toBe(seedFromLetters(['L', 'N', 'R', 'Z']));
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
